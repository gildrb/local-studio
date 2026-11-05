#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import * as Path from "node:path";
import { parseArgs } from "node:util";

import { resolveDefaultDesktopUpdateChannel } from "../../desktop/src/updates/updateChannels.ts";
import { nativeUpdateArtifactName } from "../../../packages/app-core/src/nativeUpdateFeed.ts";
import { BRAND_ASSET_PATHS } from "../../../scripts/lib/brand-assets.ts";
import { selectCliRuntimeExternalDependencies } from "../../../scripts/lib/cli-external-packages.ts";
import { Rolldown } from "vite-plus/pack";

const BUNDLE_ID = "org.local.studio.t3.native";
const APP_NAME = "Local Studio Native.app";
const EXECUTABLE = "local-studio-gpui";
const DEFAULT_UPDATE_REPOSITORY = "sybil-solutions/local-studio";
const CORE_UNINSTALLED_EXTERNALS = new Set(["electron", "x11"]);
const CORE_RUNTIME_PACKAGES: ReadonlyArray<readonly [string, string]> = [
  ["playwright-core", "apps/desktop/src/preview/PlaywrightInjectedRuntime.ts"],
];
const SNAP_SHOT_SOUNDS = ["snap-shot-click.mp3", "snap-shot-whoosh.mp3"];
const LICENSE_MANIFESTS = [
  "apps/web/package.json",
  "apps/server/package.json",
  "apps/desktop/package.json",
  "third-party-licenses.config.json",
];
const MACH_O_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]);

const repoRoot = Path.resolve(import.meta.dirname, "../../..");
const nativeDir = Path.join(repoRoot, "apps/native");

const { values: flags } = parseArgs({
  options: {
    "skip-cargo": { type: "boolean", default: false },
    "skip-server-build": { type: "boolean", default: false },
  },
});

type PackageManifest = {
  readonly version: string | undefined;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly peerDependencies: Record<string, string>;
};

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readJson(path: string): PackageManifest {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${path} is not an object`);
  const version =
    "version" in parsed && typeof parsed.version === "string" ? parsed.version : undefined;
  return {
    version,
    dependencies: "dependencies" in parsed ? stringRecord(parsed.dependencies) : {},
    optionalDependencies:
      "optionalDependencies" in parsed ? stringRecord(parsed.optionalDependencies) : {},
    peerDependencies: "peerDependencies" in parsed ? stringRecord(parsed.peerDependencies) : {},
  };
}

function step(message: string) {
  process.stdout.write(`\n[native-bundle] ${message}\n`);
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  execFileSync(command, [...args], {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
}

function capture(command: string, args: ReadonlyArray<string>): string {
  return execFileSync(command, [...args], { encoding: "utf8" }).trim();
}

function cargoEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CC: "/usr/bin/cc",
    CXX: "/usr/bin/c++",
    SDKROOT: capture("/usr/bin/xcrun", ["--show-sdk-path"]),
    PATH: `/usr/bin:${process.env.PATH ?? ""}`,
  };
}

function resolvePackageDir(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = Path.dirname(dir)) {
    const candidate = Path.join(dir, "node_modules", name);
    if (existsSync(Path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (Path.dirname(dir) === dir) return null;
  }
}

function createPackageInstaller(rootNodeModules: string) {
  const hoisted = new Map<string, string>();
  const placed = new Set<string>();
  const install = (name: string, fromDir: string, nestedNodeModules: string, optional: boolean) => {
    const source = resolvePackageDir(name, fromDir);
    if (source === null) {
      if (optional) return;
      throw new Error(`cannot resolve ${name} from ${fromDir}`);
    }
    const hoistedSource = hoisted.get(name);
    if (hoistedSource === source) return;
    const destination =
      hoistedSource === undefined
        ? Path.join(rootNodeModules, name)
        : Path.join(nestedNodeModules, name);
    if (hoistedSource === undefined) hoisted.set(name, source);
    if (placed.has(destination)) return;
    placed.add(destination);
    cpSync(source, destination, { recursive: true, dereference: true });
    const manifest = readJson(Path.join(source, "package.json"));
    const childNodeModules = Path.join(destination, "node_modules");
    for (const dependency of Object.keys(manifest.dependencies)) {
      install(dependency, source, childNodeModules, false);
    }
    for (const dependency of Object.keys(manifest.optionalDependencies)) {
      install(dependency, source, childNodeModules, true);
    }
    for (const dependency of Object.keys(manifest.peerDependencies)) {
      install(dependency, source, childNodeModules, true);
    }
  };
  return (name: string, fromDir: string, conflictNodeModules = rootNodeModules) =>
    install(name, fromDir, conflictNodeModules, false);
}

function isMachO(path: string): boolean {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    if (readSync(descriptor, header, 0, 4, 0) < 4) return false;
    return MACH_O_MAGICS.has(header.readUInt32BE(0));
  } finally {
    closeSync(descriptor);
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => Path.join(entry.parentPath, entry.name));
}

function workspacePackageNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(Path.join(repoRoot, group))) {
      const manifest = Path.join(repoRoot, group, entry, "package.json");
      if (!existsSync(manifest)) continue;
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "name" in parsed &&
        typeof parsed.name === "string"
      ) {
        names.add(parsed.name);
      }
    }
  }
  return names;
}

function workspaceDirOf(file: string): string {
  for (
    let dir = Path.dirname(file);
    dir.startsWith(repoRoot) && dir !== repoRoot;
    dir = Path.dirname(dir)
  ) {
    if (existsSync(Path.join(dir, "package.json"))) return Path.relative(repoRoot, dir);
  }
  return "";
}

function packageName(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier);
}

async function bundleCore(appRoot: string): Promise<ReadonlyArray<[string, string]>> {
  const workspaceNames = workspacePackageNames();
  const imports = new Map<string, [string, string]>();
  await Rolldown.build({
    input: Path.join(repoRoot, "packages/app-core/src/main.ts"),
    platform: "node",
    external: (id, importer) => {
      if (id.startsWith("node:") || isBuiltin(id)) return true;
      if (id.startsWith(".") || id.startsWith("~") || Path.isAbsolute(id) || id.startsWith("\0")) {
        return false;
      }
      const name = packageName(id);
      if (workspaceNames.has(name)) return false;
      if (!CORE_UNINSTALLED_EXTERNALS.has(name) && importer !== undefined) {
        imports.set(`${name}\0${workspaceDirOf(importer)}`, [name, importer]);
      }
      return true;
    },
    resolve: {
      alias: { "~": Path.join(repoRoot, "apps/web/src") },
      extensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
    },
    output: {
      dir: appRoot,
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: repoRoot,
      entryFileNames: "[name].mjs",
    },
    logLevel: "silent",
  });
  return [...imports.values()];
}

function makeIcns(sourcePng: string, targetIcns: string, workDir: string) {
  const iconset = Path.join(workDir, "AppIcon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`;
      execFileSync(
        "/usr/bin/sips",
        ["-z", pixels, pixels, sourcePng, "--out", Path.join(iconset, name)],
        {
          stdio: "ignore",
        },
      );
    }
  }
  run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", targetIcns]);
}

function updateRepository(): { readonly owner: string; readonly repo: string } {
  const raw =
    process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_UPDATE_REPOSITORY;
  const [owner, repo, ...rest] = raw.split("/");
  if (!owner || !repo || rest.length > 0) throw new Error(`invalid update repository ${raw}`);
  return { owner, repo };
}

function plistSet(plist: string, key: string, value: string) {
  run("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
}

async function main() {
  if (process.platform !== "darwin") throw new Error("The app bundle is built on macOS.");
  const version = readJson(Path.join(repoRoot, "apps/web/package.json")).version;
  if (version === undefined) throw new Error("apps/web/package.json has no version");
  const channel = resolveDefaultDesktopUpdateChannel(version);
  const arch = process.arch;
  const outputDir = Path.join(nativeDir, "dist", "macos");
  const appPath = Path.join(outputDir, APP_NAME);

  if (!flags["skip-cargo"]) {
    step("cargo build --release (native app)");
    run("cargo", ["build", "--release"], { cwd: nativeDir, env: cargoEnv() });
    step("cargo build --release (resource monitor)");
    run(
      "cargo",
      ["build", "--release", "--locked", "--manifest-path", "native/resource-monitor/Cargo.toml"],
      {
        env: cargoEnv(),
      },
    );
  }
  if (!flags["skip-server-build"]) {
    step("building the server bundle and web client (vp run --filter t3 build)");
    run(Path.join(repoRoot, "node_modules/.bin/vp"), ["run", "--filter", "t3", "build"]);
  }

  const stage = mkdtempSync(Path.join(tmpdir(), "local-studio-native-bundle-"));
  try {
    const appRoot = Path.join(stage, "app");
    const nodeModules = Path.join(appRoot, "node_modules");
    mkdirSync(nodeModules, { recursive: true });
    const install = createPackageInstaller(nodeModules);

    step("staging the server");
    const serverDist = Path.join(repoRoot, "apps/server/dist");
    if (!existsSync(Path.join(serverDist, "bin.mjs")))
      throw new Error(`${serverDist}/bin.mjs is missing`);
    cpSync(serverDist, Path.join(appRoot, "apps/server/dist"), { recursive: true });
    const monitor = Path.join(
      repoRoot,
      "native/resource-monitor/target/release/t3-resource-monitor",
    );
    if (existsSync(monitor)) {
      const target = Path.join(appRoot, "apps/server/dist/resource-monitor/t3-resource-monitor");
      mkdirSync(Path.dirname(target), { recursive: true });
      copyFileSync(monitor, target);
      chmodSync(target, 0o755);
    }
    const serverManifest = readJson(Path.join(repoRoot, "apps/server/package.json"));
    for (const name of Object.keys(
      selectCliRuntimeExternalDependencies(serverManifest.dependencies),
    )) {
      install(name, Path.join(repoRoot, "apps/server"));
    }

    step("bundling the core");
    const coreImports = [
      ...(await bundleCore(appRoot)),
      ...CORE_RUNTIME_PACKAGES.map(([name, importer]): [string, string] => [
        name,
        Path.join(repoRoot, importer),
      ]),
    ];
    for (const [name, importer] of coreImports) {
      install(
        name,
        Path.dirname(importer),
        Path.join(appRoot, workspaceDirOf(importer), "node_modules"),
      );
    }
    const pierreDiffs = resolvePackageDir("@pierre/diffs", Path.join(repoRoot, "apps/web"));
    if (pierreDiffs === null) throw new Error("cannot resolve @pierre/diffs from apps/web");
    mkdirSync(Path.join(nodeModules, "@pierre/diffs"), { recursive: true });
    copyFileSync(
      Path.join(pierreDiffs, "package.json"),
      Path.join(nodeModules, "@pierre/diffs/package.json"),
    );
    install("diff", pierreDiffs);

    step("staging core resources");
    for (const relative of LICENSE_MANIFESTS) {
      mkdirSync(Path.dirname(Path.join(appRoot, relative)), { recursive: true });
      copyFileSync(Path.join(repoRoot, relative), Path.join(appRoot, relative));
    }
    for (const sound of SNAP_SHOT_SOUNDS) {
      const relative = Path.join("apps/web/src/assets", sound);
      mkdirSync(Path.dirname(Path.join(appRoot, relative)), { recursive: true });
      copyFileSync(Path.join(repoRoot, relative), Path.join(appRoot, relative));
    }
    const controllerDir = Path.join(repoRoot, "apps/local-controller");
    const stagedController = Path.join(appRoot, "apps/local-controller");
    cpSync(Path.join(controllerDir, "src"), Path.join(stagedController, "src"), {
      recursive: true,
    });
    copyFileSync(
      Path.join(controllerDir, "package.json"),
      Path.join(stagedController, "package.json"),
    );
    const installController = createPackageInstaller(Path.join(stagedController, "node_modules"));
    for (const name of Object.keys(
      readJson(Path.join(controllerDir, "package.json")).dependencies,
    )) {
      installController(name, controllerDir);
    }

    step(`assembling ${appPath}`);
    rmSync(appPath, { recursive: true, force: true });
    const contents = Path.join(appPath, "Contents");
    const macos = Path.join(contents, "MacOS");
    const resources = Path.join(contents, "Resources");
    mkdirSync(macos, { recursive: true });
    mkdirSync(resources, { recursive: true });
    copyFileSync(Path.join(nativeDir, "target/release", EXECUTABLE), Path.join(macos, EXECUTABLE));
    chmodSync(Path.join(macos, EXECUTABLE), 0o755);
    copyFileSync(realpathSync(process.execPath), Path.join(macos, "node"));
    chmodSync(Path.join(macos, "node"), 0o755);
    renameSync(appRoot, Path.join(resources, "app"));
    const iconSource = Path.join(
      repoRoot,
      channel === "nightly"
        ? BRAND_ASSET_PATHS.nightlyMacIconPng
        : BRAND_ASSET_PATHS.productionMacIconPng,
    );
    makeIcns(iconSource, Path.join(resources, "AppIcon.icns"), stage);
    const { owner, repo } = updateRepository();
    writeFileSync(
      Path.join(resources, "app-update.yml"),
      `owner: ${owner}\nrepo: ${repo}\nprovider: github\nreleaseType: ${channel === "nightly" ? "prerelease" : "release"}\n${channel === "nightly" ? "channel: nightly\n" : ""}`,
    );
    const plist = Path.join(contents, "Info.plist");
    copyFileSync(Path.join(nativeDir, "assets/Info.plist"), plist);
    plistSet(plist, "CFBundleIdentifier", BUNDLE_ID);
    plistSet(plist, "CFBundleShortVersionString", version);
    plistSet(plist, "CFBundleVersion", version);
    writeFileSync(Path.join(contents, "PkgInfo"), "APPL????");

    step("ad-hoc signing");
    const entitlements = Path.join(nativeDir, "assets/entitlements.mac.plist");
    const mainExecutable = Path.join(macos, EXECUTABLE);
    for (const file of listFiles(contents)) {
      if (file === mainExecutable || !isMachO(file)) continue;
      run("/usr/bin/codesign", ["--force", "--sign", "-", "--entitlements", entitlements, file]);
    }
    run("/usr/bin/codesign", [
      "--force",
      "--sign",
      "-",
      "--identifier",
      BUNDLE_ID,
      "--entitlements",
      entitlements,
      appPath,
    ]);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
    run(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", appPath],
    );

    step("packaging the update artifact");
    const artifact = Path.join(outputDir, nativeUpdateArtifactName(version, arch));
    rmSync(artifact, { force: true });
    run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, artifact]);
    const sha512 = createHash("sha512").update(readFileSync(artifact)).digest("base64");
    process.stdout.write(
      [
        "",
        `[native-bundle] app: ${appPath}`,
        `[native-bundle] update artifact: ${artifact}`,
        `[native-bundle] update feed entry for ${channel === "nightly" ? "nightly" : "stable"}-mac.yml:`,
        `  - url: ${Path.basename(artifact)}`,
        `    sha512: ${sha512}`,
        `    size: ${statSync(artifact).size}`,
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

await main();
