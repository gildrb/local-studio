# Native (GPUI) app packaging

The native app lives in `apps/native` (crate `local-studio-gpui`). It renders with GPUI and runs
two Node processes: the server (`apps/server`) and the headless core (`packages/app-core`).

## Running from source

`cargo run` in `apps/native` finds the repository by walking up from the binary or the working
directory to `apps/server/src/bin.ts`, and runs the TypeScript sources with `node` from `PATH`
(override with `LOCAL_STUDIO_NODE`). Data lives in `~/.local-studio-t3` (override with
`LOCAL_STUDIO_T3_HOME`). Updates are disabled in this mode: Settings → General shows
"Check for Updates" disabled, as an unpackaged desktop build does.

## macOS app bundle

```sh
pnpm run dist:native:mac        # or: node apps/native/scripts/build-macos-bundle.ts
```

Flags: `--skip-cargo` reuses `apps/native/target/release` and the resource monitor build;
`--skip-server-build` reuses `apps/server/dist`.

The command:

1. Builds `apps/native` and `native/resource-monitor` in release mode.
2. Runs `vp run --filter t3 build`, the server's official bundle with the web client in
   `dist/client`.
3. Bundles the core with Rolldown in preserve-modules mode, so every module keeps its
   repository-relative path and the core's `import.meta.url` lookups (app version, licenses,
   snap shot sounds, `@pierre/diffs`) resolve inside the bundle as they do in the repository.
4. Copies the runtime-external packages (the server's native packages from
   `scripts/lib/cli-external-packages.ts`, `@napi-rs/keyring` and `playwright-core` for the core,
   the local controller's dependencies) with their dependency closure.
5. Assembles `apps/native/dist/macos/Local Studio Native.app`:
   - `Contents/MacOS/local-studio-gpui` and `Contents/MacOS/node`, a copy of the Node binary that
     ran the script. The bundle never relies on `PATH` to find Node.
   - `Contents/Resources/app/`, the staged runtime (`apps/server/dist/bin.mjs`,
     `packages/app-core/src/main.mjs`, `node_modules/`).
   - `Contents/Resources/AppIcon.icns` from the desktop icon (`assets/prod/black-macos-1024.png`,
     or the nightly icon for nightly versions).
   - `Contents/Resources/app-update.yml`, the same GitHub feed the desktop build publishes to
     (`T3CODE_DESKTOP_UPDATE_REPOSITORY`, else `GITHUB_REPOSITORY`, else
     `sybil-solutions/local-studio`).
   - `Contents/Info.plist` from `apps/native/assets/Info.plist`.
6. Signs every Mach-O file, then the bundle, ad hoc (`codesign -s -`) with
   `apps/native/assets/entitlements.mac.plist`, verifies the signature, and registers the bundle
   with Launch Services so `open 'local-studio://…'` reaches it.
7. Zips the bundle as `apps/native/dist/macos/Local-Studio-Native-<version>-<arch>.zip` and prints
   the update-feed entry for it.

The bundle id is `org.local.studio.t3.native`, distinct from the desktop app's
`org.local.studio.t3`, so the two never share notification permissions, Launch Services
registration, or preferences. The bundle registers the `local-studio` and `t3code` URL schemes.
The binary detects the bundle from its own path (`<App>.app/Contents/MacOS`) and then runs the
staged runtime; any other location falls back to the source layout above.

Notifications use `UNUserNotificationCenter`, which needs a bundle id and a signature; neither
exists under `cargo run`, so notifications only work in the bundle. A non-sandboxed app needs no
entitlement for local notifications. The first notification asks for permission under the
bundle's name.

## Linux desktop entry

The app has no Linux package yet. To install a source build:

```sh
cargo build --release --manifest-path apps/native/Cargo.toml
install -Dm755 apps/native/target/release/local-studio-gpui ~/.local/bin/local-studio-gpui
install -Dm644 apps/native/assets/linux/dev.sybil.LocalStudio.desktop \
  ~/.local/share/applications/dev.sybil.LocalStudio.desktop
install -Dm644 apps/native/assets/linux/dev.sybil.LocalStudio.png \
  ~/.local/share/icons/hicolor/512x512/apps/dev.sybil.LocalStudio.png
update-desktop-database ~/.local/share/applications
xdg-mime default dev.sybil.LocalStudio.desktop x-scheme-handler/local-studio
xdg-mime default dev.sybil.LocalStudio.desktop x-scheme-handler/t3code
```

The installed binary still runs the repository sources, so keep the checkout in place, or set
`LOCAL_STUDIO_NODE` when `node` is not on the desktop session's `PATH`. The entry is named after
the window's app id (`dev.sybil.LocalStudio`) so Wayland compositors match the window to it.
A `local-studio://` or `t3code://` link passed on the command line is delivered at startup.
Opening a link while the app runs starts a second instance; the app has no single-instance
handoff on Linux yet.

## Updates

Settings → General → Version and Update track follow the desktop updater:

- Channels: `latest` (Stable) and `nightly`, persisted in `desktop-settings.json` like the
  desktop app. Stable reads `stable-mac.yml` from the latest GitHub release; Nightly reads
  `nightly-mac.yml` from the newest `-nightly.` prerelease, allows downgrades, and collects the
  full changelog.
- States: `disabled`, `idle`, `checking`, `up-to-date`, `available`, `downloading`, `downloaded`,
  `error`, with the desktop reducers from `apps/desktop/src/updates/updateMachine.ts`. Checks run
  15 seconds after launch and every 4 minutes. A channel change checks at once.
- Disabled reasons match the desktop: no feed configured, not packaged, or
  `T3CODE_DISABLE_AUTO_UPDATE`. `T3CODE_DESKTOP_MOCK_UPDATES=1` (with
  `T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT`) points the feed at `pnpm start:mock-update-server`.
- Download takes the `Local-Studio-Native-<version>-<arch>.zip` entry from the feed, verifies its
  sha512, unpacks it, and checks its signature and bundle id.
- Install asks for confirmation, then hands off to a detached helper that waits for the app to
  quit, swaps the bundle (keeping the old one until the move succeeds), and reopens it.

Releases do not publish the native artifact yet. Until `.github/workflows/release.yml` uploads
`Local-Studio-Native-<version>-arm64.zip` and `Local-Studio-Native-<version>-x64.zip` and lists
them (url, sha512, size) in `stable-mac.yml` and `nightly-mac.yml`, Download reports that the
release has no native app build.
