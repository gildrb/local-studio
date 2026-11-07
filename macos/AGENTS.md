# macOS Local Studio Application

- Build with `macos/build.nu`: Rust kit, UniFFI bindings into `macos/Generated`, `swift build`, `.app` assembly, ad-hoc signing.
  - Build: `env -u DEVELOPER_DIR nu macos/build.nu [--configuration Debug|Release] [--action build|run|smoke|smoke-shell]`
  - Output: `macos/build/<configuration>/LocalStudio.app`; bundles `eukhe-daemon` (`EUKHE_DAEMON` or `../eukhe/target/{release,debug}`) and `controller/`.
  - Toolchain: Xcode when its license is accepted, else CommandLineTools; an explicit `DEVELOPER_DIR` wins. The script stamps the real SDK version (minimum macOS 26) so the window gets the current system chrome.
  - Honors `CARGO_TARGET_DIR`.
- Lint with SwiftLint (`macos/.swiftlint.yml`), zero violations:
  - `env TOOLCHAIN_DIR=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain nix run nixpkgs#swiftlint -- lint --strict` from `macos/`.
- Verify end to end in an isolated environment (see root `AGENTS.md`):
  - `LocalStudio +smoke`, `+smoke-shell`, `+smoke-conversation`, `+smoke-panels [png]`: each drives the real core and daemon and exits non-zero on failure.
  - `LocalStudio +snapshot <dir> [name-filter]`: renders every `SnapshotCatalog` entry offscreen in dark and light from `Update` fixtures. Look at the PNGs.
- Structure: `App/` (scenes, commands, smokes), `Design/` (Theme tokens, shared controls), `Features/<Area>/`, `Generated/` (build output, ignored). `StudioStore` routes every core `Update` to one feature store.
- UI rules: native controls (grouped `Form`, `Picker(.menu)`, `Menu`, `Toggle`); `Theme` tokens only (dashboards palette); simple light-weight SF Symbols; no animation on repeatable actions and no looping animations; window chrome never moves.
- Builds stay warning-free under strict concurrency checking.
- Never stop processes this app did not spawn.
