import { execFile } from "node:child_process";
import * as NodeFS from "node:fs/promises";
import * as Path from "node:path";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_SERVER_SETTINGS,
  type DesktopPreviewColorScheme,
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveDesktopStateDir } from "@t3tools/desktop/src/app/DesktopStatePaths.ts";
import {
  artifactSiteSlug,
  DEFAULT_ZOOM_FACTOR,
  nextZoomLevel,
} from "@t3tools/desktop/src/preview/PreviewZoom.ts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { PREVIEW_VIEWPORT_PRESETS, resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import {
  BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT,
  isValidHistoryTimestamp,
  recordVisitForThreadOnHost,
  removeUrlForThread,
  selectThreadRecentHistory,
  setTitleForThreadUrl,
  useBrowserHistoryStore,
} from "@t3tools/web/src/browserHistoryStore.ts";
import {
  responsiveViewportForToggle,
  toBrowserDefaults,
} from "@t3tools/web/src/browser/browserDefaults.logic.ts";
import { resolveDiscoveredServerUrlWith } from "@t3tools/web/src/browser/browserTargetResolver.logic.ts";
import { resizeFreeformViewport } from "@t3tools/web/src/browser/browserViewportLayout.ts";
import { agentControlledBrowserCloseConfirmation } from "@t3tools/web/src/components/ChatView.logic.ts";
import { mergeServers } from "@t3tools/web/src/components/preview/discoveredLocalServers.logic.ts";
import { describePreviewError } from "@t3tools/web/src/components/preview/errorCodeMessages.ts";
import { revealInFileExplorerLabel } from "@t3tools/web/src/components/preview/fileExplorerLabel.ts";
import { getConfiguredPreviewUrls } from "@t3tools/web/src/components/preview/previewEmptyStateLogic.ts";
import { shouldShowPreviewEmptyState } from "@t3tools/web/src/components/preview/previewEmptyStateLogic.ts";
import { resolveStorage } from "@t3tools/web/src/lib/storage.ts";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "@t3tools/web/src/logicalProject.ts";
import { boundConfiguredLocalServerUrls } from "@t3tools/web/src/portDiscovery.logic.ts";
import {
  browserMiniPlayerSource,
  selectThreadPreviewMiniPlayerTabId,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore.ts";
import { type RightPanelSurface, useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import { buildPhysicalToLogicalProjectKeyMap } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import { formatRelativeTimeLabel } from "@t3tools/web/src/timestampFormat.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { createJSONStorage } from "zustand/middleware";
import { previewRuntimeTabId } from "@t3tools/web/src/browser/previewRuntimeTabId.ts";

import {
  browserPreviewService,
  type BrowserHostCommand,
  type BrowserPreviewService,
} from "../browserPreview.ts";
import { zoomIndicatorScript } from "../browserPageScripts.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import { makeRouteRightPanelStateAtom } from "../rightPanelState.ts";
import { panelRouteAtom } from "../pullRequestShared.ts";

const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const RecordParams = Schema.decodeUnknownSync(Schema.Struct({ record: Schema.Boolean }));
const PositionParams = Schema.decodeUnknownSync(
  Schema.Struct({ x: Schema.Number, y: Schema.Number }),
);
const DimensionParams = Schema.decodeUnknownSync(
  Schema.Struct({ axis: Schema.Literals(["width", "height"]), value: Schema.String }),
);

const COLOR_SCHEME_OPTIONS: ReadonlyArray<{
  readonly value: DesktopPreviewColorScheme;
  readonly label: string;
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const RESPONSIVE_VALUE = "responsive";
const MINUTE_MS = 60_000;
const COPIED_RESET_MS = 2_000;

export type BrowserChromeView = {
  readonly url: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly refreshDisabled: boolean;
  readonly refreshLabel: string;
  readonly refreshTooltip: string;
  readonly profileBadge: string | null;
  readonly openInBrowser: boolean;
  readonly capture: {
    readonly disabled: boolean;
    readonly recording: boolean;
    readonly label: string;
    readonly tooltip: string;
  } | null;
  readonly pictureInPicture: {
    readonly active: boolean;
    readonly disabled: boolean;
    readonly label: string;
  } | null;
  readonly pick: {
    readonly active: boolean;
    readonly disabled: boolean;
    readonly label: string;
    readonly tooltip: string;
  } | null;
  readonly moreMenu: boolean;
};

export type BrowserRecentView = {
  readonly url: string;
  readonly title: string;
  readonly subtitle: string;
  readonly removeLabel: string;
  readonly faviconDataUrl: string | null;
};

export type BrowserServerView = {
  readonly key: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  readonly faviconDataUrl: string | null;
};

export type BrowserContentView =
  | { readonly kind: "none" }
  | { readonly kind: "webview" }
  | { readonly kind: "empty-hint" }
  | {
      readonly kind: "empty-list";
      readonly recents: ReadonlyArray<BrowserRecentView>;
      readonly servers: ReadonlyArray<BrowserServerView>;
    }
  | {
      readonly kind: "unreachable";
      readonly host: string;
      readonly friendly: string;
      readonly errorLabel: string;
    };

export type BrowserDeviceToolbarView = {
  readonly presetLabel: string;
  readonly width: string;
  readonly height: string;
  readonly customValid: boolean;
  readonly aspectLocked: boolean;
  readonly aspectLabel: string;
  readonly aspectTooltip: string;
};

export type BrowserSurfaceView = {
  readonly threadKey: string;
  readonly tabId: string | null;
  readonly runtimeTabId: string | null;
  readonly chrome: BrowserChromeView;
  readonly content: BrowserContentView;
  readonly webview: boolean;
  readonly deviceToolbar: BrowserDeviceToolbarView | null;
  readonly focusUrlNonce: number;
};

type ScreenshotToastState = {
  readonly id: string;
  readonly path: string;
  readonly imageCopied: boolean;
};

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function run(command: string, args: ReadonlyArray<string>): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  execFile(command, [...args], (error) => (error ? reject(error) : resolve()));
  return promise;
}

function revealPath(path: string): Promise<void> {
  if (process.platform === "darwin") return run("open", ["-R", path]);
  return openExternal(Path.dirname(path));
}

function copyImageFile(path: string): Promise<void> {
  if (process.platform === "darwin") {
    return run("/usr/bin/osascript", [
      "-e",
      `set the clipboard to (read (POSIX file ${JSON.stringify(path)}) as «class PNGf»)`,
    ]);
  }
  return run("sh", [
    "-c",
    'if command -v wl-copy >/dev/null; then wl-copy --type image/png < "$0"; else xclip -selection clipboard -t image/png -i "$0"; fi',
    path,
  ]);
}

export function browserArtifactsDirectory(t3Home: string): string {
  return Path.join(
    resolveDesktopStateDir({
      baseDir: t3Home,
      isDevelopment: false,
      joinPath: Path.join,
      t3Home: Option.some(t3Home),
    }),
    "browser-artifacts",
  );
}

export async function openBrowserSession(
  context: FeatureContext,
  preview: BrowserPreviewService,
  input: {
    readonly threadRef: ScopedThreadRef;
    readonly url?: string;
    readonly viewport?: PreviewViewportSetting;
    readonly profileId?: string;
  },
): Promise<PreviewSessionSnapshot | null> {
  const defaults = toBrowserDefaults(context.registry.get(context.clientSettingsAtom));
  const result = await runAtomCommand(
    context.registry,
    context.state.previewEnvironment.open,
    {
      environmentId: input.threadRef.environmentId,
      input: {
        threadId: input.threadRef.threadId,
        ...(input.url === undefined ? {} : { url: input.url }),
        viewport: input.viewport ?? defaults.viewport,
        profileId: input.profileId ?? defaults.profileId,
      },
    },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      context.addToast({
        layout: "stacked",
        type: "error",
        title: "Unable to open browser",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
    return null;
  }
  const snapshot = result.value;
  preview.applySnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    preview.rememberUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return snapshot;
}

export async function closeBrowserSession(
  context: FeatureContext,
  preview: BrowserPreviewService,
  threadRef: ScopedThreadRef,
  tabId: string,
): Promise<void> {
  const snapshot = preview.read(threadRef).sessions[tabId] ?? null;
  preview.beginClose(threadRef, tabId);
  const result = await runAtomCommand(
    context.registry,
    context.state.previewEnvironment.close,
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tabId },
    },
    { reportFailure: false },
  );
  if (result._tag === "Failure") preview.cancelClose(threadRef, snapshot, tabId);
}

export function createBrowserFeature(context: FeatureContext): CoreFeature {
  const { registry, state, storage } = context;
  const preview = browserPreviewService(context);
  useBrowserHistoryStore.persist.setOptions({
    storage: createJSONStorage(() => resolveStorage(storage)),
  });
  void useBrowserHistoryStore.persist.rehydrate();

  const routePanelAtom = makeRouteRightPanelStateAtom(panelRouteAtom(context));
  const focusUrlNonceAtom = Atom.make(0).pipe(Atom.keepAlive);
  const aspectLocksAtom = Atom.make<ReadonlyMap<string, number>>(new Map()).pipe(Atom.keepAlive);
  const customSizeAtom = Atom.make<{
    readonly runtimeTabId: string;
    readonly width: string;
    readonly height: string;
  } | null>(null).pipe(Atom.keepAlive);
  const historyAtom = Atom.make((get) => {
    get.addFinalizer(useBrowserHistoryStore.subscribe((value) => get.setSelf(value)));
    return useBrowserHistoryStore.getState();
  });
  const miniPlayerStoreAtom = Atom.make((get) => {
    get.addFinalizer(usePreviewMiniPlayerStore.subscribe((value) => get.setSelf(value)));
    return usePreviewMiniPlayerStore.getState();
  });
  const minuteAtom = Atom.make((get) => {
    const timer = setInterval(() => get.setSelf(Date.now()), MINUTE_MS);
    get.addFinalizer(() => clearInterval(timer));
    return Date.now();
  });

  const environmentUrlReader = (environmentId: ScopedThreadRef["environmentId"]) => (): URL => {
    const prepared = Option.getOrNull(
      registry.get(state.environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    if (prepared === null) throw new Error(`Environment ${environmentId} is not connected.`);
    return new URL(prepared.httpBaseUrl);
  };

  const environmentHostname = (environmentId: ScopedThreadRef["environmentId"]): string | null => {
    const prepared = Option.getOrNull(
      registry.get(state.environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    return prepared === null ? null : new URL(prepared.httpBaseUrl).hostname;
  };

  registry.subscribe(
    Atom.make((get) => {
      const input = get(context.threadInputAtom);
      if (input === null || input.project === undefined) return null;
      const settings = selectProjectGroupingSettings(get(context.clientSettingsAtom));
      const projects = get(state.environmentProjects.projectsAtom);
      const key =
        buildPhysicalToLogicalProjectKeyMap({
          projects,
          settings,
          primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
        }).get(derivePhysicalProjectKey(input.project)) ??
        deriveLogicalProjectKeyFromSettings(input.project, settings);
      return { route: input.route, key };
    }),
    (value) => {
      if (value === null) return;
      useBrowserHistoryStore.getState().registerThreadProject(value.route, value.key);
    },
    { immediate: true },
  );

  const faviconByOriginAtom = Atom.make((get): ReadonlyMap<string, string> => {
    const byOrigin = new Map<string, string>();
    for (const threadKey of get(preview.activeThreadKeysAtom)) {
      const current = get(preview.previewStateAtom(threadKey));
      for (const overlay of Object.values(current.desktopByTabId)) {
        const origin = overlay.favicon ? originOf(overlay.favicon.pageUrl) : null;
        if (overlay.favicon && origin) byOrigin.set(origin, overlay.favicon.dataUrl);
      }
    }
    return byOrigin;
  });

  const targetAtom = Atom.make((get) => {
    const panel = get(routePanelAtom);
    if (panel === null) return null;
    const previewState = get(preview.previewStateAtom(scopedThreadKey(panel.route)));
    const requested =
      panel.activeSurface?.kind === "preview" ? panel.activeSurface.resourceId : undefined;
    const tabId = requested ?? previewState.activeTabId;
    return { route: panel.route, previewState, tabId };
  });

  const configuredUrlsAtom = Atom.make((get): ReadonlyArray<string> => {
    const input = get(context.threadInputAtom);
    if (input === null || input.project === undefined) return [];
    const settings = mergeEnvironmentSettings(
      input.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      input.clientSettings,
    );
    return getConfiguredPreviewUrls(resolveProjectScripts(settings, input.project));
  });

  const serversAtom = Atom.make((get) => {
    const target = get(targetAtom);
    if (target === null) return [];
    const configuredUrls = get(configuredUrlsAtom);
    const bounded = boundConfiguredLocalServerUrls(configuredUrls);
    const result = get(
      state.previewEnvironment.discoveredServers({
        environmentId: target.route.environmentId,
        input: bounded.length ? { configuredUrls: bounded } : {},
      }),
    );
    const data = Option.getOrNull(AsyncResult.value(result));
    const readUrl = environmentUrlReader(target.route.environmentId);
    return mergeServers({
      scanner: (data?.servers ?? []).map((server) => ({
        ...server,
        url: resolveDiscoveredServerUrlWith(target.route.environmentId, server.url, readUrl),
        requestedUrl: server.url,
      })),
      configuredUrls,
      configuredUrlProbing: data?.configuredUrlProbing === true,
    });
  });

  const viewAtom = Atom.make((get): BrowserSurfaceView | null => {
    const target = get(targetAtom);
    if (target === null) return null;
    const { route, previewState, tabId } = target;
    const defaults = toBrowserDefaults(get(context.clientSettingsAtom));
    const runtimeTabId = tabId ? previewRuntimeTabId(route, previewState.serverEpoch, tabId) : null;
    const snapshot = tabId ? (previewState.sessions[tabId] ?? null) : null;
    const overlay = tabId ? (previewState.desktopByTabId[tabId] ?? null) : null;
    const navStatus = snapshot?.navStatus ?? { _tag: "Idle" as const };
    const url = navStatus._tag === "Idle" ? "" : navStatus.url;
    const loading = overlay?.loading ?? navStatus._tag === "Loading";
    const isUnreachable = navStatus._tag === "LoadFailed";
    const showEmptyState = shouldShowPreviewEmptyState(snapshot);
    const miniPlayerTabId = selectThreadPreviewMiniPlayerTabId(
      get(miniPlayerStoreAtom).byThreadKey,
      route,
    );
    const activeProfileId = snapshot?.profileId ?? DEFAULT_BROWSER_PROFILE_ID;
    const activeProfileName =
      defaults.profiles.find((profile) => profile.id === activeProfileId)?.name ??
      "Removed profile";
    const viewport = snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT;
    const favicons = get(faviconByOriginAtom);
    const faviconFor = (candidate: string) => {
      const origin = originOf(candidate);
      return origin === null ? null : (favicons.get(origin) ?? null);
    };

    const content = ((): BrowserContentView => {
      if (isUnreachable) {
        const description = navStatus.description;
        return {
          kind: "unreachable",
          host: safeHost(navStatus.url) ?? navStatus.url,
          friendly: describePreviewError(description),
          errorLabel:
            description.length > 0 ? description : `ERR_${Math.abs(navStatus.code) || "FAILED"}`,
        };
      }
      if (!showEmptyState) return runtimeTabId && snapshot ? { kind: "webview" } : { kind: "none" };
      get(minuteAtom);
      const servers = get(serversAtom);
      const recents = selectThreadRecentHistory(
        get(historyAtom),
        route,
        BROWSER_HISTORY_MAX_ENTRIES_PER_PROJECT,
      )
        .filter((entry) => URL.canParse(entry.url))
        .slice(0, 8);
      if (servers.length === 0 && recents.length === 0) return { kind: "empty-hint" };
      return {
        kind: "empty-list",
        recents: recents.map((entry) => {
          const parsed = new URL(entry.url);
          const path = parsed.pathname === "/" ? "" : parsed.pathname;
          const label = `${parsed.host}${path}${parsed.search}${parsed.hash}`;
          const visitedAt = isValidHistoryTimestamp(entry.lastVisitedAt)
            ? formatRelativeTimeLabel(new Date(entry.lastVisitedAt).toISOString())
            : "";
          return {
            url: entry.url,
            title: entry.title ?? label,
            subtitle: `${entry.title ? `${label} · ` : ""}${visitedAt}`,
            removeLabel: `Remove ${label} from history`,
            faviconDataUrl: faviconFor(entry.url),
          };
        }),
        servers: servers.map((server) => ({
          key: `${server.host}:${server.port}`,
          url: server.requestedUrl,
          title: server.processName ? server.processName : "Listening",
          description: `${server.host}:${server.port}`,
          faviconDataUrl: faviconFor(server.requestedUrl),
        })),
      };
    })();

    const customSize = get(customSizeAtom);
    const aspect = runtimeTabId ? (get(aspectLocksAtom).get(runtimeTabId) ?? null) : null;
    const deviceToolbar = ((): BrowserDeviceToolbarView | null => {
      if (viewport._tag === "fill" || runtimeTabId === null || content.kind !== "webview") {
        return null;
      }
      const presented =
        customSize !== null && customSize.runtimeTabId === runtimeTabId
          ? customSize
          : { width: String(viewport.width), height: String(viewport.height) };
      const customWidth = Number(presented.width);
      const customHeight = Number(presented.height);
      const selectedPreset =
        viewport._tag === "preset"
          ? PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === viewport.presetId)
          : undefined;
      return {
        presetLabel: selectedPreset?.label ?? "Responsive",
        width: presented.width,
        height: presented.height,
        customValid:
          Number.isInteger(customWidth) &&
          Number.isInteger(customHeight) &&
          customWidth >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
          customWidth <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
          customHeight >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
          customHeight <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
          customWidth * customHeight <= PREVIEW_VIEWPORT_MAX_AREA,
        aspectLocked: aspect !== null,
        aspectLabel:
          aspect === null ? "Lock viewport aspect ratio" : "Unlock viewport aspect ratio",
        aspectTooltip: aspect === null ? "Lock aspect ratio" : "Unlock aspect ratio",
      };
    })();

    return {
      threadKey: scopedThreadKey(route),
      tabId,
      runtimeTabId,
      chrome: {
        url,
        loading,
        canGoBack: overlay?.canGoBack ?? snapshot?.canGoBack ?? false,
        canGoForward: overlay?.canGoForward ?? snapshot?.canGoForward ?? false,
        refreshDisabled: navStatus._tag === "Idle",
        refreshLabel: loading ? "Stop" : "Refresh",
        refreshTooltip: loading ? "Loading…" : "Refresh",
        profileBadge: activeProfileId !== defaults.profileId ? activeProfileName : null,
        openInBrowser: tabId !== null,
        capture:
          tabId === null
            ? null
            : {
                disabled: overlay === null || isUnreachable,
                recording: false,
                label: "Capture screenshot",
                tooltip: "Screenshot",
              },
        pictureInPicture:
          tabId === null
            ? null
            : {
                active: miniPlayerTabId === tabId,
                disabled: !(overlay?.hasWebContents ?? false) || isUnreachable,
                label:
                  miniPlayerTabId === tabId ? "Close floating preview" : "Float preview over chat",
              },
        pick:
          tabId === null
            ? null
            : {
                active: false,
                disabled: isUnreachable,
                label: "Annotate preview",
                tooltip: isUnreachable
                  ? "Page didn't load — pick unavailable until the page renders"
                  : "Annotate elements, regions, and drawings",
              },
        moreMenu: true,
      },
      content,
      webview: content.kind === "webview",
      deviceToolbar,
      focusUrlNonce: get(focusUrlNonceAtom),
    };
  });

  const currentTarget = () => {
    const target = registry.get(targetAtom);
    if (target === null) throw new Error("The browser needs an open thread.");
    return target;
  };

  const currentRuntimeTab = () => {
    const { route, tabId } = currentTarget();
    return tabId === null
      ? null
      : { route, tabId, runtimeTabId: preview.runtimeTabId(route, tabId) };
  };

  const sendToCurrent = (command: BrowserHostCommand) => {
    const current = currentRuntimeTab();
    if (current === null) return;
    void preview.send(current.runtimeTabId, command).catch(() => undefined);
  };

  const navigateToResolvedUrl = async (route: ScopedThreadRef, resolvedUrl: string) => {
    const tabId = registry.get(targetAtom)?.tabId ?? null;
    if (tabId !== null) {
      await preview.send(preview.runtimeTabId(route, tabId), {
        kind: "navigate",
        url: resolvedUrl,
      });
      preview.rememberUrl(route, resolvedUrl);
      return true;
    }
    const snapshot = await openBrowserSession(context, preview, {
      threadRef: route,
      url: resolvedUrl,
    });
    if (snapshot !== null) useRightPanelStore.getState().openBrowser(route, snapshot.tabId);
    return snapshot !== null;
  };

  const recordVisit = (route: ScopedThreadRef, url: string) => {
    recordVisitForThreadOnHost(route, url, environmentHostname(route.environmentId));
  };

  registry.subscribe(
    Atom.make((get) => {
      const target = get(targetAtom);
      if (target === null || target.tabId === null) return null;
      const snapshot = target.previewState.sessions[target.tabId];
      if (snapshot?.navStatus._tag !== "Success") return null;
      const history = selectThreadRecentHistory(get(historyAtom), target.route, 1);
      if (history.length === 0) return null;
      return {
        route: target.route,
        url: snapshot.navStatus.url,
        title: snapshot.navStatus.title,
      };
    }),
    (value) => {
      if (value === null || value.title.length === 0) return;
      setTitleForThreadUrl(
        value.route,
        value.url,
        value.title,
        environmentHostname(value.route.environmentId),
      );
    },
  );

  const applyZoom = (direction: "in" | "out" | "reset") => {
    const current = currentRuntimeTab();
    if (current === null) return;
    const options = preview.tabOptions(current.runtimeTabId);
    const next =
      direction === "reset" ? DEFAULT_ZOOM_FACTOR : nextZoomLevel(options.zoomFactor, direction);
    if (Math.abs(next - options.zoomFactor) < 0.001) return;
    preview.setTabOptions(current.runtimeTabId, (value) => ({ ...value, zoomFactor: next }));
    void preview.evaluate(current.runtimeTabId, zoomIndicatorScript(next)).catch(() => undefined);
  };

  const resizeViewport = async (viewport: PreviewViewportSetting): Promise<void> => {
    const current = currentRuntimeTab();
    if (current === null) return;
    const result = await runAtomCommand(
      registry,
      state.previewEnvironment.resize,
      {
        environmentId: current.route.environmentId,
        input: { threadId: current.route.threadId, tabId: current.tabId, viewport },
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      context.addToast({
        layout: "stacked",
        type: "error",
        title: "Unable to resize browser viewport",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
      return;
    }
    preview.mergeSnapshot(current.route, result.value);
    registry.set(customSizeAtom, null);
  };

  const currentViewport = (): PreviewViewportSetting => {
    const target = currentTarget();
    const snapshot = target.tabId ? target.previewState.sessions[target.tabId] : undefined;
    return snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT;
  };

  const applyViewport = async (next: PreviewViewportSetting, aspectRatio: number | null) => {
    const current = currentRuntimeTab();
    if (current === null) return;
    await resizeViewport(next);
    const locks = new Map(registry.get(aspectLocksAtom));
    if (aspectRatio === null) locks.delete(current.runtimeTabId);
    else locks.set(current.runtimeTabId, aspectRatio);
    registry.set(aspectLocksAtom, locks);
  };

  const toggleDeviceToolbar = () => {
    const current = currentRuntimeTab();
    if (current === null) return;
    const viewport = currentViewport();
    if (viewport._tag !== "fill") {
      void applyViewport(FILL_PREVIEW_VIEWPORT, null);
      return;
    }
    const slot = registry.get(preview.slotAtom).get(current.runtimeTabId) ?? null;
    void resizeViewport(
      responsiveViewportForToggle({
        defaults: toBrowserDefaults(registry.get(context.clientSettingsAtom)),
        panelRect: slot,
        zoomFactor: preview.tabOptions(current.runtimeTabId).zoomFactor,
      }),
    );
  };

  const showScreenshotToast = (toast: ScreenshotToastState, failure?: string) => {
    context.closeToast(toast.id);
    context.addToast({
      id: toast.id,
      layout: "stacked",
      type: failure === undefined ? "success" : "error",
      title: failure === undefined ? "Screenshot saved" : "Unable to copy screenshot",
      ...(failure === undefined ? {} : { description: failure }),
      action: {
        label: toast.imageCopied ? "Copied!" : "Copy image",
        onClick: () => {
          if (toast.imageCopied) return;
          void copyImageFile(toast.path).then(
            () => {
              const copied = { ...toast, imageCopied: true };
              showScreenshotToast(copied);
              setTimeout(
                () => showScreenshotToast({ ...copied, imageCopied: false }),
                COPIED_RESET_MS,
              );
            },
            (error: unknown) =>
              showScreenshotToast(
                toast,
                error instanceof Error ? error.message : "An error occurred.",
              ),
          );
        },
      },
      secondaryAction: {
        label: revealInFileExplorerLabel(context.platform),
        onClick: () => void revealPath(toast.path).catch(() => undefined),
      },
    });
  };

  const captureScreenshot = async () => {
    const current = currentRuntimeTab();
    if (current === null) return;
    const directory = browserArtifactsDirectory(context.t3Home);
    try {
      await NodeFS.mkdir(directory, { recursive: true });
      const report = preview.hostReport(current.runtimeTabId);
      const pageUrl = report && report.navStatus.kind !== "Idle" ? report.navStatus.url : "";
      const id = `browser-screenshot-${artifactSiteSlug(pageUrl)}-${Date.now().toString(36)}`;
      const path = Path.join(directory, `${id}.png`);
      await preview.send(current.runtimeTabId, { kind: "screenshot", path });
      showScreenshotToast({ id: `browser-screenshot:${id}`, path, imageCopied: false });
    } catch (error) {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: "Unable to capture screenshot",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  const openMoreMenu = async (position: { readonly x: number; readonly y: number }) => {
    const current = currentRuntimeTab();
    const target = currentTarget();
    const snapshot = target.tabId ? target.previewState.sessions[target.tabId] : undefined;
    const overlay = target.tabId ? target.previewState.desktopByTabId[target.tabId] : undefined;
    const tabDisabled = current === null || !(overlay?.hasWebContents ?? false);
    const options = current ? preview.tabOptions(current.runtimeTabId) : null;
    const defaults = toBrowserDefaults(registry.get(context.clientSettingsAtom));
    const profileId = snapshot?.profileId ?? DEFAULT_BROWSER_PROFILE_ID;
    const profileName =
      defaults.profiles.find((profile) => profile.id === profileId)?.name ?? "Removed profile";
    const viewport = snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT;
    const zoomLabel = `${Math.round((options?.zoomFactor ?? 1) * 100)}%`;
    const picked = await contextMenuService(context).show(
      [
        { id: "hard-reload", label: "Hard reload", disabled: tabDisabled },
        { id: "devtools", label: "Open DevTools", disabled: tabDisabled },
        {
          id: "native-pip",
          label: "Open separate preview window",
          disabled: true,
        },
        {
          id: "device-toolbar",
          label: viewport._tag !== "fill" ? "Hide device toolbar" : "Show device toolbar",
          disabled: tabDisabled,
        },
        {
          id: "appearance",
          label: "Appearance",
          disabled: tabDisabled,
          children: COLOR_SCHEME_OPTIONS.map((option) => ({
            id: `color-scheme:${option.value}`,
            label: option.label,
            checked: options?.colorScheme === option.value,
          })),
        },
        {
          id: "zoom-out",
          label: `Zoom out (${zoomLabel})`,
          disabled: tabDisabled,
          separatorBefore: true,
        },
        { id: "zoom-in", label: "Zoom in", disabled: tabDisabled },
        { id: "zoom-reset", label: "Reset zoom", disabled: tabDisabled },
        {
          id: "profile",
          label: `Profile: ${profileName}`,
          disabled: true,
          separatorBefore: true,
        },
        { id: "clear-cookies", label: "Clear cookies" },
        { id: "clear-cache", label: "Clear cache" },
      ],
      position,
    );
    if (picked === null) return;
    if (picked.startsWith("color-scheme:")) {
      const value = COLOR_SCHEME_OPTIONS.find(
        (option) => `color-scheme:${option.value}` === picked,
      );
      if (value && current) {
        preview.setTabOptions(current.runtimeTabId, (existing) => ({
          ...existing,
          colorScheme: value.value,
        }));
      }
      return;
    }
    switch (picked) {
      case "hard-reload":
        sendToCurrent({ kind: "hardReload" });
        return;
      case "devtools":
        sendToCurrent({ kind: "openDevTools" });
        return;
      case "device-toolbar":
        toggleDeviceToolbar();
        return;
      case "zoom-in":
        applyZoom("in");
        return;
      case "zoom-out":
        applyZoom("out");
        return;
      case "zoom-reset":
        applyZoom("reset");
        return;
      case "clear-cookies":
        void preview
          .clearCookies(target.route.environmentId, snapshot?.profileId)
          .catch(() => undefined);
        return;
      case "clear-cache":
        void preview
          .clearCache(target.route.environmentId, snapshot?.profileId)
          .catch(() => undefined);
        return;
    }
  };

  const openPresetMenu = async (position: { readonly x: number; readonly y: number }) => {
    const viewport = currentViewport();
    if (viewport._tag === "fill") return;
    const current = currentRuntimeTab();
    const aspect = current
      ? (registry.get(aspectLocksAtom).get(current.runtimeTabId) ?? null)
      : null;
    const selected =
      viewport._tag === "preset" &&
      PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === viewport.presetId)
        ? viewport.presetId
        : RESPONSIVE_VALUE;
    const picked = await contextMenuService(context).show(
      [
        { id: RESPONSIVE_VALUE, label: "Responsive", checked: selected === RESPONSIVE_VALUE },
        { id: "standard", label: "Standard", disabled: true, separatorBefore: true },
        ...PREVIEW_VIEWPORT_PRESETS.map((preset) => ({
          id: preset.id,
          label: `${preset.label}  ${preset.detail}`,
          checked: selected === preset.id,
        })),
      ],
      position,
    );
    if (picked === null) return;
    if (picked === RESPONSIVE_VALUE) {
      if (viewport._tag === "freeform") return;
      await applyViewport(
        { _tag: "freeform", width: viewport.width, height: viewport.height },
        aspect,
      );
      return;
    }
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === picked);
    if (!preset) return;
    await applyViewport(
      resolvePreviewViewport({ mode: "preset", preset: preset.id }),
      aspect === null ? null : preset.width / preset.height,
    );
  };

  return {
    views: { browserSurface: viewAtom },
    actions: {
      browserSubmitUrl: async (params) => {
        const { url } = UrlParams(params);
        const next = url.trim();
        if (next.length === 0) return null;
        const { route } = currentTarget();
        try {
          const normalized = normalizePreviewUrl(next);
          if (await navigateToResolvedUrl(route, normalized)) recordVisit(route, normalized);
        } catch {
          return null;
        }
        return null;
      },
      browserOpenUrl: async (params) => {
        const { url } = UrlParams(params);
        const { route } = currentTarget();
        try {
          const resolved = resolveDiscoveredServerUrlWith(
            route.environmentId,
            url,
            environmentUrlReader(route.environmentId),
          );
          if (await navigateToResolvedUrl(route, resolved)) recordVisit(route, url);
        } catch {
          return null;
        }
        return null;
      },
      browserRemoveRecent: async (params) => {
        const { url } = UrlParams(params);
        removeUrlForThread(currentTarget().route, url);
        return null;
      },
      browserBack: async () => {
        sendToCurrent({ kind: "back" });
        return null;
      },
      browserForward: async () => {
        sendToCurrent({ kind: "forward" });
        return null;
      },
      browserRefresh: async () => {
        sendToCurrent({ kind: "reload" });
        return null;
      },
      browserOpenExternal: async () => {
        const target = currentTarget();
        const snapshot = target.tabId ? target.previewState.sessions[target.tabId] : undefined;
        const url = snapshot && snapshot.navStatus._tag !== "Idle" ? snapshot.navStatus.url : "";
        if (url.length > 0) await openExternal(url).catch(() => undefined);
        return null;
      },
      browserCapture: async (params) => {
        const { record } = RecordParams(params);
        if (record) throw new Error("Browser recording is not available in the native app yet.");
        await captureScreenshot();
        return null;
      },
      browserTogglePictureInPicture: async () => {
        const { route, tabId } = currentTarget();
        if (tabId === null) return null;
        const miniPlayerTabId = selectThreadPreviewMiniPlayerTabId(
          usePreviewMiniPlayerStore.getState().byThreadKey,
          route,
        );
        if (miniPlayerTabId === tabId) {
          usePreviewMiniPlayerStore.getState().close(route);
          return null;
        }
        usePreviewMiniPlayerStore.getState().open(route, browserMiniPlayerSource(tabId));
        useRightPanelStore.getState().close(route);
        return null;
      },
      browserPickElement: async () => {
        throw new Error("Browser annotations are not available in the native app yet.");
      },
      browserMoreMenu: async (params) => {
        await openMoreMenu(PositionParams(params));
        return null;
      },
      browserFocusUrl: async () => {
        registry.set(focusUrlNonceAtom, registry.get(focusUrlNonceAtom) + 1);
        return null;
      },
      browserZoomIn: async () => {
        applyZoom("in");
        return null;
      },
      browserZoomOut: async () => {
        applyZoom("out");
        return null;
      },
      browserResetZoom: async () => {
        applyZoom("reset");
        return null;
      },
      browserViewportPresetMenu: async (params) => {
        await openPresetMenu(PositionParams(params));
        return null;
      },
      browserViewportDimension: async (params) => {
        const { axis, value } = DimensionParams(params);
        const current = currentRuntimeTab();
        const viewport = currentViewport();
        if (current === null || viewport._tag === "fill") return null;
        const existing = registry.get(customSizeAtom);
        const base =
          existing !== null && existing.runtimeTabId === current.runtimeTabId
            ? existing
            : {
                runtimeTabId: current.runtimeTabId,
                width: String(viewport.width),
                height: String(viewport.height),
              };
        const next = {
          ...base,
          width: axis === "width" ? value : base.width,
          height: axis === "height" ? value : base.height,
        };
        const aspect = registry.get(aspectLocksAtom).get(current.runtimeTabId) ?? null;
        const numeric = Number(value);
        if (
          aspect === null ||
          !Number.isInteger(numeric) ||
          numeric < PREVIEW_VIEWPORT_MIN_DIMENSION ||
          numeric > PREVIEW_VIEWPORT_MAX_DIMENSION
        ) {
          registry.set(customSizeAtom, next);
          return null;
        }
        const resized = resizeFreeformViewport(
          viewport,
          axis === "width"
            ? { x: numeric - viewport.width, y: 0 }
            : { x: 0, y: numeric - viewport.height },
          1,
          axis === "width" ? "east" : "south",
          aspect,
        );
        registry.set(customSizeAtom, {
          runtimeTabId: current.runtimeTabId,
          width: String(resized.width),
          height: String(resized.height),
        });
        return null;
      },
      browserViewportApplyDimensions: async () => {
        const current = currentRuntimeTab();
        const viewport = currentViewport();
        const custom = registry.get(customSizeAtom);
        if (current === null || viewport._tag === "fill" || custom === null) return null;
        if (custom.runtimeTabId !== current.runtimeTabId) return null;
        const width = Number(custom.width);
        const height = Number(custom.height);
        const valid =
          Number.isInteger(width) &&
          Number.isInteger(height) &&
          width >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
          width <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
          height >= PREVIEW_VIEWPORT_MIN_DIMENSION &&
          height <= PREVIEW_VIEWPORT_MAX_DIMENSION &&
          width * height <= PREVIEW_VIEWPORT_MAX_AREA;
        if (!valid || (width === viewport.width && height === viewport.height)) {
          registry.set(customSizeAtom, null);
          return null;
        }
        await applyViewport(
          { _tag: "freeform", width, height },
          registry.get(aspectLocksAtom).get(current.runtimeTabId) ?? null,
        );
        return null;
      },
      browserViewportRotate: async () => {
        const current = currentRuntimeTab();
        const viewport = currentViewport();
        if (current === null || viewport._tag === "fill") return null;
        const aspect = registry.get(aspectLocksAtom).get(current.runtimeTabId) ?? null;
        const custom = registry.get(customSizeAtom);
        const width = Number(custom?.width);
        const height = Number(custom?.height);
        const source =
          custom !== null &&
          custom.runtimeTabId === current.runtimeTabId &&
          Number.isInteger(width) &&
          Number.isInteger(height) &&
          (width !== viewport.width || height !== viewport.height)
            ? { _tag: "freeform" as const, width, height }
            : viewport;
        await applyViewport(
          { ...source, width: source.height, height: source.width },
          aspect === null ? null : 1 / aspect,
        );
        return null;
      },
      browserViewportToggleAspect: async () => {
        const current = currentRuntimeTab();
        const viewport = currentViewport();
        if (current === null || viewport._tag === "fill") return null;
        const locks = new Map(registry.get(aspectLocksAtom));
        if (locks.has(current.runtimeTabId)) locks.delete(current.runtimeTabId);
        else {
          const custom = registry.get(customSizeAtom);
          const width =
            custom?.runtimeTabId === current.runtimeTabId ? Number(custom.width) : viewport.width;
          const height =
            custom?.runtimeTabId === current.runtimeTabId ? Number(custom.height) : viewport.height;
          locks.set(current.runtimeTabId, width / height);
        }
        registry.set(aspectLocksAtom, locks);
        return null;
      },
      browserViewportClose: async () => {
        await applyViewport(FILL_PREVIEW_VIEWPORT, null);
        return null;
      },
      browserToggleDeviceToolbar: async () => {
        toggleDeviceToolbar();
        return null;
      },
    },
  };
}

export function agentBrowserCloseMessage(
  context: FeatureContext,
  route: ScopedThreadRef,
  surfaces: ReadonlyArray<RightPanelSurface>,
): string | null {
  const preview = browserPreviewService(context);
  return agentControlledBrowserCloseConfirmation(surfaces, preview.read(route).desktopByTabId);
}
