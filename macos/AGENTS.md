# macOS Local Studio Application

- Build with `macos/build.nu`: Rust kit, UniFFI bindings into `macos/Generated`, `swift build`, `.app` assembly, ad-hoc signing.
  - Build: `env -u DEVELOPER_DIR nu macos/build.nu [--configuration Debug|Release] [--action build|run|smoke|smoke-shell]`
  - Output: `macos/build/<configuration>/LocalStudio.app`; bundles `eukhe-daemon` (`EUKHE_DAEMON` or `../eukhe/target/{release,debug}`) and `controller/`.
  - Toolchain: Xcode when its license is accepted, else CommandLineTools; an explicit `DEVELOPER_DIR` wins. The script stamps the real SDK version (minimum macOS 26) so the window gets the current system chrome.
  - Honors `CARGO_TARGET_DIR`.
  - The core embeds libghostty-vt (crate `libghostty-vt` 0.2.2), built from source by Zig 0.15.2. `build.nu` provides it through `macos/zig.nu` (a `zig` on PATH if 0.15.x, else `nix build nixpkgs#zig_0_15`), wrapped so Zig links against its bundled macOS libc instead of the macOS 27 SDK it cannot parse. For plain cargo runs: `PATH="$(nu macos/zig.nu):$PATH" cargo …`.
  - App icon: `macos/AppIcon.icon` (Icon Composer document) compiled by `actool`; needs Xcode 26+ after `sudo xcodebuild -runFirstLaunch`. Edit it in Icon Composer, check renditions with its `ictool`.
- Lint with SwiftLint (`macos/.swiftlint.yml`), zero violations:
  - `env TOOLCHAIN_DIR=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain nix run nixpkgs#swiftlint -- lint --strict` from `macos/`.
- Verify end to end in an isolated environment (see root `AGENTS.md`):
  - `LocalStudio +smoke`, `+smoke-shell`, `+smoke-conversation`, `+smoke-panels [png]`: each drives the real core and daemon and exits non-zero on failure.
  - `LocalStudio +snapshot <dir> [name-filter]`: renders every `SnapshotCatalog` entry offscreen in dark and light from `Update` fixtures. Look at the PNGs.
  - `LOCAL_STUDIO_SNAPSHOT_LIVE=1` adds `pages-local-live` (the first reachable Local controller) and the `pages-usage-live*` entries: they start the core against the daemon on `$EUKHE_DAEMON_SOCKET`, load the real usage report from its saved sessions and render the Usage page (30 days tokens and cost, 24 hours, 7 days, gildrb). Point the daemon's agent dir at a scratch copy of the sessions.
- Structure: `App/` (scenes, commands, smokes), `Design/` (Theme tokens, shared controls), `Features/<Area>/`, `Generated/` (build output, ignored). `StudioStore` routes every core `Update` to one feature store.
- UI rules: native controls (grouped `Form`, `Picker(.menu)`, `Menu`, `Toggle`); `Theme` tokens only (dashboards palette); simple light-weight SF Symbols; no animation on repeatable actions and no looping animations; window chrome never moves.
- Builds stay warning-free under strict concurrency checking.
- Never stop processes this app did not spawn.
