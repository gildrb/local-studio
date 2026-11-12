# macOS Local Studio Application

- Build with `macos/build.nu`: Rust kit, UniFFI bindings into `macos/Generated`, `swift build`, `.app` assembly, ad-hoc signing.
  - Build: `env -u DEVELOPER_DIR nu macos/build.nu [--configuration Debug|Release] [--action build|run|smoke|smoke-shell]`
  - Output: `macos/build/<configuration>/LocalStudio.app`; bundles the `eukhe` binary of the pinned Eukhe release (root `eukhe.nu`: fetched once into `<target>/eukhe/<tag>/` and checked against the release's `SHA256SUMS`, or `EUKHE_BIN`), which the core runs as the daemon (`--mode daemon`) and for the Python kernel, and `controller/`. The release's sidecars (`eukhe-runtime/`, `skills/`, `models.bundled.json`, `mcp-services.bundled.json`) go with the release's exclusions into `Contents/Resources/eukhe/`, linked from `Contents/MacOS/` so `eukhe` finds them beside itself (data files directly in `Contents/MacOS` break code signing).
  - Toolchain: Xcode when its license is accepted, else CommandLineTools; an explicit `DEVELOPER_DIR` wins. The script stamps the real SDK version (minimum macOS 26) so the window gets the current system chrome.
  - Honors `CARGO_TARGET_DIR`.
  - The core embeds libghostty-vt (crate `libghostty-vt` 0.2.2), built from source by Zig 0.15.2. `build.nu` provides it through `macos/zig.nu` (a `zig` on PATH if 0.15.x, else `nix build nixpkgs#zig_0_15`), wrapped so Zig links against its bundled macOS libc instead of the macOS 27 SDK it cannot parse. For plain cargo runs: `PATH="$(nu macos/zig.nu):$PATH" cargo …`.
  - App icon: `macos/AppIcon.icon` (Icon Composer document) compiled by `actool`; needs Xcode 26+ after `sudo xcodebuild -runFirstLaunch`. Edit it in Icon Composer, check renditions with its `ictool`.
- Python kernel: Eukhe runs it on one pinned CPython that it fetches itself (with its own uv) into `~/.eukhe/kernel/` the first time a kernel starts. The core runs the bundled `eukhe kernel install --check` at launch and, when it answers `not fetched`, `eukhe kernel install` in the background (needs network) so the first `python` call does not wait for the download. A notice under the toolbar shows progress or the error with Retry; Settings → General → Diagnostics → Python kernel shows the state and Install/Retry. A session whose kernel cannot start reports `kernelUnavailable`; the core shows it once as a warning notice, as Eukhe's own client does.
- Lint with SwiftLint (`macos/.swiftlint.yml`), zero violations:
  - `env TOOLCHAIN_DIR=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain nix run nixpkgs#swiftlint -- lint --strict` from `macos/`.
- Verify end to end in an isolated environment on the real model (see root `AGENTS.md`): `HOME`, `EUKHE_DAEMON_SOCKET`, `LOCAL_STUDIO_DATA_DIR` and `EUKHE_CODING_AGENT_DIR` under a scratch dir, `auth.json` linked (never copied) into that agent dir, `models.json` and `settings.json` copied with mode 0600 (the agent `settings.json`'s `defaultProvider`/`defaultModel`/`defaultThinkingLevel` set to the real model: `+smoke` checks a fresh composer shows the daemon's default), and only the link removed after the run.
  - `LocalStudio +smoke`, `+smoke-shell`, `+smoke-conversation`, `+smoke-panels [png]`, `+smoke-providers`, `+smoke-kernel [install|installed]`: each drives the real core and daemon and exits non-zero on failure. The model-driven ones select `anthropic/claude-haiku-5-5` thinking `low` (`App/SmokeModel.swift`) and assert behavior: a real bash call succeeds and writes its file, the reply arrives, a supervised write asks for approval while queued and steered follow-ups land after their prompt, fan-out threads answer. `+smoke-conversation` also copies a rendered reply (whole and mid-word across a list and a code block) to a private pasteboard and requires exactly the visible text (markers as shown, no fences or Markdown markers) plus RTF and HTML that keep bold and monospaced code. `+smoke-kernel install` needs a fresh `HOME` (no `~/.eukhe/kernel/`): the launch must fetch the kernel, then a real `python` call must succeed with no "not installed" error; `+smoke-kernel installed` on the same `HOME` must not fetch again and runs the same request. `+smoke-providers` saves keys, so it runs on a scratch agent dir with its own empty `auth.json` (`{}`) and `models.json` (`{"providers":{}}`), never a linked one; it needs no model login. Before the core starts it refuses (`FAIL`, exit 1) when `EUKHE_CODING_AGENT_DIR` is unset, its `auth.json` is a symlink, a hard link or holds keys, or the dir resolves into a real agent dir (`.pi`, `.eukhe`); it fails if any key is left in `auth.json` at the end.
  - `LocalStudio +snapshot <dir> [name-filter]`: renders every `SnapshotCatalog` entry offscreen in dark and light from `Update` fixtures. Look at the PNGs.
  - `LOCAL_STUDIO_SNAPSHOT_LIVE=1` adds `pages-local-live` (the first reachable Local controller) and the `pages-usage-live*` entries: they start the core against the daemon on `$EUKHE_DAEMON_SOCKET`, load the real usage report from its saved sessions and render the Usage page (30 days tokens and cost, 24 hours, 7 days, gildrb). Point the daemon's agent dir at a scratch copy of the sessions.
- Structure: `App/` (scenes, commands, smokes), `Design/` (Theme tokens, shared controls), `Features/<Area>/`, `Generated/` (build output, ignored). `StudioStore` routes every core `Update` to one feature store.
- UI rules: native controls (grouped `Form`, `Picker(.menu)`, `Menu`, `Toggle`); `Theme` tokens only (dashboards palette); no animation on repeatable actions and no looping animations; window chrome never moves.
- Icons: style every SF Symbol with `.icon(_:_:)` from `Design/Icon.swift`, never `.font(.system(size:weight:))`. The scale matches first-party macOS 26 apps (Finder, Mail, Notes, Music, System Settings: regular-weight glyphs, 15-16 pt boxes in 36-38 pt toolbar buttons, 32 pt sidebar rows, 13 pt labels):

  | Size | Points | Weight | Use |
  |---|---|---|---|
  | `.toolbar` | 15 | regular | window and sidebar chrome |
  | `.control` | 14 | regular | icon buttons in rows and bars |
  | `.inline` | 12.5 | regular | row glyphs, chevrons, labels (`IconLabel` for label + icon) |
  | `.tile` | fitted to 65 % of the tile | semibold | white glyph in `SettingsTile` |
  | `.display` | 26 | regular | empty states |

  Every icon in one row or toolbar uses the same size and weight. Tone `.primary` for interactive icons, `.secondary` only for decoration; monochrome. Increase Contrast or Bold Text step the weight up one step and turn secondary icons primary. Plain or `.fill` symbols with the fewest strokes, no `.circle`/`.square` frames, badges or slashes; one meaning, one symbol. Icon-only buttons get `.help` and an accessibility label and a hit target of at least 24×24 pt; state never shows by colour alone (`accessibilityDifferentiateWithoutColor`).
- Settings window follows System Settings:

  | Element | Metric |
  |---|---|
  | Sidebar | native `List(.sidebar)` + `.searchable(placement: .sidebar)`, 220 pt fixed, 32 pt rows, 13 pt system label, system accent selection; `themeRoot()` applies to the detail column only |
  | Sidebar icon | `SettingsTile` 20 pt, continuous radius 25 %, white filled glyph fitted to a 13 pt box, aspect kept (System Settings glyphs measure 12-15 pt) |
  | Groups | `SettingsPane.groups`, separated by the list's section gap, no titles |
  | Tile colour | grey by default, black for Appearance, a system colour only where the meaning is familiar (blue accounts and network, orange source control, purple local models); colour is decoration, symbol and label carry the meaning |
  | Detail | grouped `Form` (`SettingsForm`) opening with `SettingsHeader`: 48 pt tile, 22 pt bold title, 13 pt secondary summary, centred; hidden while searching |
- Builds stay warning-free under strict concurrency checking.
- Never stop processes this app did not spawn.
