import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as Path from "node:path";
import { finished } from "node:stream/promises";

import {
  DESKTOP_UPDATE_RESTART_MARKER_FILE,
  type DesktopRuntimeInfo,
  type DesktopUpdateActionResult,
  type DesktopUpdateChannel,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
} from "@t3tools/contracts";
import { resolveDesktopRuntimeInfo } from "@t3tools/desktop/src/app/DesktopRuntimeInfo.ts";
import { normalizeDesktopUpdateReleaseNotes } from "@t3tools/desktop/src/updates/releaseNotes.ts";
import { resolveDefaultDesktopUpdateChannel } from "@t3tools/desktop/src/updates/updateChannels.ts";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "@t3tools/desktop/src/updates/updateMachine.ts";
import {
  getAutoUpdateDisabledReason,
  resolveUpdateFeedChannelName,
  shouldBroadcastDownloadProgress,
} from "@t3tools/desktop/src/updates/updatePolicy.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  fetchLatestUpdateInfo,
  isUpdateNewer,
  nativeUpdateArtifactName,
  resolveUpdateFeedConfig,
  type FeedUpdateInfo,
  type UpdateFeedConfig,
} from "./nativeUpdateFeed.ts";

const STARTUP_CHECK_DELAY_MS = 15_000;
const POLL_INTERVAL_MS = 4 * 60_000;
const UPDATER_CACHE_NAME = "local-studio-native-updater";

type UpdateAction = "check" | "download" | "install" | "channel";

export interface NativeUpdates {
  readonly stateAtom: Atom.Atom<DesktopUpdateState>;
  readonly quitForInstallRevisionAtom: Atom.Atom<number>;
  readonly setChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  readonly check: (reason: string) => Promise<DesktopUpdateCheckResult>;
  readonly download: () => Promise<DesktopUpdateActionResult>;
  readonly install: () => Promise<DesktopUpdateActionResult>;
}

export interface NativeUpdatesOptions {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly appVersion: string;
  readonly t3Home: string;
  readonly initialChannel: DesktopUpdateChannel;
  readonly persistChannel: (channel: DesktopUpdateChannel) => Promise<void>;
}

type DownloadedUpdate = { readonly version: string; readonly appPath: string };

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function readRuntimeInfo(): DesktopRuntimeInfo {
  let translated = false;
  if (process.platform === "darwin") {
    try {
      translated =
        execFileSync("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"], {
          encoding: "utf8",
        }).trim() === "1";
    } catch {
      translated = false;
    }
  }
  return resolveDesktopRuntimeInfo({
    platform: process.platform,
    processArch: process.arch,
    runningUnderArm64Translation: translated,
  });
}

function channelFilePlatformSuffix(): string {
  if (process.platform === "darwin") return "-mac";
  if (process.platform === "linux") return process.arch === "arm64" ? "-linux-arm64" : "-linux";
  return "";
}

function updaterCacheDir(): string {
  const base =
    process.platform === "darwin"
      ? Path.join(homedir(), "Library", "Caches")
      : process.env.XDG_CACHE_HOME?.trim() || Path.join(homedir(), ".cache");
  return Path.join(base, UPDATER_CACHE_NAME);
}

function run(command: string, args: ReadonlyArray<string>): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(command, [...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error)
      reject(new Error(`${Path.basename(command)} failed: ${stderr.trim() || error.message}`));
    else resolve(stdout);
  });
  return promise;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const bundleIdentifier = (appPath: string) =>
  run("/usr/bin/plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    Path.join(appPath, "Contents", "Info.plist"),
  ]).then((value) => value.trim());

const INSTALL_SCRIPT = [
  'pid="$1"; target="$2"; source="$3"; backup="$4"',
  'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
  'rm -rf "$backup"',
  'if mv "$target" "$backup"; then',
  '  if mv "$source" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; fi',
  "fi",
  'open "$target"',
].join("\n");

export function createNativeUpdates(options: NativeUpdatesOptions): NativeUpdates {
  const { registry, appVersion } = options;
  const runtimeInfo = readRuntimeInfo();
  const bundlePath = process.env.LOCAL_STUDIO_APP_BUNDLE?.trim() || null;
  const cacheDir = updaterCacheDir();
  const restartMarkerDir = Path.join(options.t3Home, "runtime");
  const restartMarkerPath = Path.join(restartMarkerDir, DESKTOP_UPDATE_RESTART_MARKER_FILE);

  const stateAtom = Atom.make(
    createInitialDesktopUpdateState(appVersion, runtimeInfo, options.initialChannel),
  ).pipe(Atom.keepAlive);
  const quitForInstallRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);

  let feedConfig: UpdateFeedConfig | null = null;
  let disabledReason: string | null = null;
  let configured = false;
  let quitting = false;
  let activeAction: UpdateAction | null = null;
  let availableInfo: FeedUpdateInfo | null = null;
  let downloaded: DownloadedUpdate | null = null;

  const getState = () => registry.get(stateAtom);
  const setState = (state: DesktopUpdateState) => registry.set(stateAtom, state);
  const updateState = (f: (state: DesktopUpdateState) => DesktopUpdateState) =>
    setState(f(getState()));
  const now = () => new Date().toISOString();

  const tryStart = (action: UpdateAction) => {
    if (activeAction !== null) return false;
    activeAction = action;
    return true;
  };
  const finish = (action: UpdateAction) => {
    if (activeAction === action) activeAction = null;
  };

  const baseState = (channel: DesktopUpdateChannel, enabled: boolean): DesktopUpdateState => ({
    ...createInitialDesktopUpdateState(appVersion, runtimeInfo, channel),
    enabled,
    status: enabled ? "idle" : "disabled",
  });

  const handleUpdateAvailable = (info: FeedUpdateInfo) => {
    const state = getState();
    if (resolveDefaultDesktopUpdateChannel(info.version) !== state.channel) {
      availableInfo = null;
      setState(reduceDesktopUpdateStateOnNoUpdate(state, now()));
      return;
    }
    const { releaseNotes, omittedReleaseCount } = normalizeDesktopUpdateReleaseNotes(
      info.releaseNotes,
      info.version,
      state.channel,
    );
    availableInfo = info;
    setState(
      reduceDesktopUpdateStateOnUpdateAvailable(
        state,
        info.version,
        now(),
        releaseNotes,
        omittedReleaseCount,
      ),
    );
    console.info(`[native-updater] update available: ${info.version}`);
  };

  const checkForUpdates = async (
    reason: string,
    reservation: "acquire" | "held" = "acquire",
    allowDowngrade?: boolean,
  ): Promise<boolean> => {
    if (quitting || !configured || feedConfig === null) return false;
    const state = getState();
    if (state.status === "downloading") return false;
    if (reservation === "acquire" && !tryStart("check")) return false;
    try {
      setState(reduceDesktopUpdateStateOnCheckStart(state, now()));
      console.info(`[native-updater] checking for updates (${reason})`);
      const channel = state.channel;
      const feedChannel = resolveUpdateFeedChannelName(channel);
      const info = await fetchLatestUpdateInfo({
        config: feedConfig,
        channelFile: `${feedChannel}${channelFilePlatformSuffix()}.yml`,
        feedChannel,
        allowPrerelease: channel === "nightly",
        fullChangelog: channel === "nightly",
        currentVersion: appVersion,
      });
      if (
        isUpdateNewer({
          latestVersion: info.version,
          currentVersion: appVersion,
          allowDowngrade: allowDowngrade ?? channel === "nightly",
        })
      ) {
        handleUpdateAvailable(info);
      } else {
        availableInfo = null;
        setState(reduceDesktopUpdateStateOnNoUpdate(getState(), now()));
      }
    } catch (error) {
      console.error(`[native-updater] update check failed: ${message(error)}`);
      updateState((current) =>
        reduceDesktopUpdateStateOnCheckFailure(current, message(error), now()),
      );
    } finally {
      if (reservation === "acquire") finish("check");
    }
    return true;
  };

  const verifiedDownload = async (info: FeedUpdateInfo): Promise<DownloadedUpdate> => {
    if (bundlePath === null) throw new Error("The native app is not running from an app bundle.");
    const expected = nativeUpdateArtifactName(info.version, process.arch);
    const file = info.files.find((entry) => Path.posix.basename(entry.url) === expected);
    if (file === undefined) {
      const listed = info.files.map((entry) => Path.posix.basename(entry.url)).join(", ");
      throw new Error(
        `Release ${info.version} has no native app build for this Mac: the update feed lists ${listed || "no files"} but not ${expected}.`,
      );
    }
    const pendingDir = Path.join(cacheDir, "pending");
    await rm(pendingDir, { recursive: true, force: true });
    await mkdir(pendingDir, { recursive: true });
    const archivePath = Path.join(pendingDir, expected);
    const response = await fetch(new URL(file.url, info.fileBaseUrl));
    if (!response.ok || response.body === null) {
      throw new Error(`HttpError: ${response.status} ${response.statusText} for ${file.url}`);
    }
    const total = file.size ?? Number(response.headers.get("content-length") ?? 0);
    const hash = createHash("sha512");
    let received = 0;
    const reader = response.body.getReader();
    const output = createWriteStream(archivePath);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.byteLength;
        if (!output.write(value)) await once(output, "drain");
        if (total <= 0) continue;
        const percent = Math.min(100, (received / total) * 100);
        const state = getState();
        if (shouldBroadcastDownloadProgress(state, percent) || state.message !== null) {
          setState(reduceDesktopUpdateStateOnDownloadProgress(state, percent));
        }
      }
    } finally {
      output.end();
      await finished(output);
    }
    if (hash.digest("base64") !== file.sha512) {
      throw new Error(`sha512 checksum mismatch for ${expected}.`);
    }
    const extractDir = Path.join(pendingDir, "extracted");
    await run("/usr/bin/ditto", ["-x", "-k", archivePath, extractDir]);
    const appName = (await readdir(extractDir)).find((entry) => entry.endsWith(".app"));
    if (appName === undefined) throw new Error(`${expected} does not contain an app bundle.`);
    const appPath = Path.join(extractDir, appName);
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
    const [expectedId, actualId] = await Promise.all([
      bundleIdentifier(bundlePath),
      bundleIdentifier(appPath),
    ]);
    if (expectedId !== actualId) {
      throw new Error(`${expected} contains ${actualId}, not ${expectedId}.`);
    }
    return { version: info.version, appPath };
  };

  const download = async (): Promise<DesktopUpdateActionResult> => {
    const state = getState();
    if (!configured || state.status !== "available" || availableInfo === null) {
      return { accepted: false, completed: false, state };
    }
    if (!tryStart("download")) return { accepted: false, completed: false, state };
    const info = availableInfo;
    try {
      setState(reduceDesktopUpdateStateOnDownloadStart(state));
      console.info(`[native-updater] downloading update ${info.version}`);
      downloaded = await verifiedDownload(info);
      setState(reduceDesktopUpdateStateOnDownloadComplete(getState(), info.version));
      console.info(`[native-updater] update downloaded: ${info.version}`);
      return { accepted: true, completed: true, state: getState() };
    } catch (error) {
      console.error(`[native-updater] download failed: ${message(error)}`);
      updateState((current) => reduceDesktopUpdateStateOnDownloadFailure(current, message(error)));
      return { accepted: true, completed: false, state: getState() };
    } finally {
      finish("download");
    }
  };

  const install = async (): Promise<DesktopUpdateActionResult> => {
    const state = getState();
    const installable =
      state.status === "downloaded" ||
      (state.status === "error" &&
        (state.errorContext === null || state.errorContext === "install"));
    if (
      quitting ||
      !configured ||
      bundlePath === null ||
      downloaded === null ||
      state.downloadedVersion !== downloaded.version ||
      !installable ||
      !tryStart("install")
    ) {
      return { accepted: false, completed: false, state };
    }
    quitting = true;
    try {
      await mkdir(restartMarkerDir, { recursive: true });
      await writeFile(restartMarkerPath, "").catch(() => undefined);
      if (!existsSync(downloaded.appPath)) {
        throw new Error("The downloaded update is no longer on disk. Download it again.");
      }
      const helper = spawn(
        "/bin/sh",
        [
          "-c",
          INSTALL_SCRIPT,
          "sh",
          String(process.ppid),
          bundlePath,
          downloaded.appPath,
          `${bundlePath}.previous`,
        ],
        { detached: true, stdio: "ignore" },
      );
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      helper.once("spawn", () => resolve());
      helper.once("error", reject);
      await promise;
      helper.unref();
      console.info(`[native-updater] installing ${downloaded.version} after quit`);
      registry.set(quitForInstallRevisionAtom, registry.get(quitForInstallRevisionAtom) + 1);
      return { accepted: true, completed: false, state: getState() };
    } catch (error) {
      quitting = false;
      await rm(restartMarkerPath, { force: true });
      updateState((current) => reduceDesktopUpdateStateOnInstallFailure(current, message(error)));
      console.error(`[native-updater] install failed: ${message(error)}`);
      finish("install");
      return { accepted: true, completed: false, state: getState() };
    }
  };

  const setChannel = async (channel: DesktopUpdateChannel): Promise<DesktopUpdateState> => {
    if (activeAction !== null) {
      throw new Error(
        `Cannot change the desktop update channel to ${channel} while an update ${activeAction} action is in progress.`,
      );
    }
    activeAction = "channel";
    try {
      if (channel === getState().channel) return getState();
      try {
        await options.persistChannel(channel);
      } catch (cause) {
        throw new Error(`Failed to persist the ${channel} desktop update channel.`, { cause });
      }
      availableInfo = null;
      downloaded = null;
      const enabled = disabledReason === null;
      setState(baseState(channel, enabled));
      if (enabled && configured) await checkForUpdates("channel-change", "held", true);
      return getState();
    } finally {
      finish("channel");
    }
  };

  const configure = async () => {
    const mockUpdates = envFlag("T3CODE_DESKTOP_MOCK_UPDATES");
    const appUpdateYmlPath =
      bundlePath === null ? null : Path.join(bundlePath, "Contents", "Resources", "app-update.yml");
    const fileConfig =
      appUpdateYmlPath === null
        ? null
        : resolveUpdateFeedConfig(await readFile(appUpdateYmlPath, "utf8").catch(() => ""));
    feedConfig = mockUpdates
      ? {
          provider: "generic",
          url: `http://localhost:${process.env.T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT?.trim() || "3000"}`,
        }
      : fileConfig;
    disabledReason = getAutoUpdateDisabledReason({
      isDevelopment: false,
      isPackaged: bundlePath !== null,
      platform: process.platform,
      appImage: undefined,
      isDebPackage: false,
      disabledByEnv: envFlag("T3CODE_DISABLE_AUTO_UPDATE"),
      hasUpdateFeedConfig: feedConfig !== null,
    });
    const enabled = disabledReason === null;
    setState(baseState(getState().channel, enabled));
    if (!enabled) {
      console.info(`[native-updater] ${disabledReason}`);
      return;
    }
    configured = true;
    const startup = setTimeout(() => void checkForUpdates("startup"), STARTUP_CHECK_DELAY_MS);
    const poll = setInterval(() => void checkForUpdates("poll"), POLL_INTERVAL_MS);
    startup.unref();
    poll.unref();
  };

  void configure().catch((error: unknown) => {
    console.error(`[native-updater] configuration failed: ${message(error)}`);
  });

  return {
    stateAtom,
    quitForInstallRevisionAtom,
    setChannel,
    check: async (reason) => {
      if (!configured) return { checked: false, state: getState() };
      const checked = await checkForUpdates(reason);
      return { checked, state: getState() };
    },
    download,
    install,
  };
}
