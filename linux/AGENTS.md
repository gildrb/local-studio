# Linux Local Studio Application

- Rust + GTK4 + libadwaita. Links `core/` (`local-studio-core`) as a plain crate: no UniFFI, no C ABI.
- `linux/` is its own Cargo workspace (own `Cargo.lock`), outside the root one, so `cargo clippy --workspace` on macOS never needs GTK. The core's `../eukhe` path dependencies still resolve from the root.
- Dev shell (Rust 1.98.1, GTK 4.22, libadwaita 1.9, VTE, WebKitGTK 6, GStreamer for notification sounds, clang, xvfb-run, dbus, fonts, icons): `nix develop ./linux` in a git checkout, `nix develop path:linux` in a plain copy. Run the commands below from `linux/` inside it.
- Build: `cargo build` → `target/debug/local-studio`.
- Lint: `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`. Same bar as the rest: no `unsafe`, `unwrap`, `expect` or code comments.
- Daemon: the app starts `$EUKHE_DAEMON`, else `eukhe-daemon` beside the binary, else the one on `PATH`, on `$EUKHE_DAEMON_SOCKET` (default `/tmp/eukhe-<uid>/daemon.sock`). Build one with `cargo build -p eukhe-daemon` in `../eukhe`.
- Keybindings come from the core (`Update::Keybindings`, mapped in `src/bindings.rs`); `cmd` maps to Ctrl. Terminals live in the bottom drawer (`src/drawer.rs`); while one has focus, app accelerators are suspended and the drawer takes Ctrl+Shift+T/D/E/W/C/V/A instead of the `terminalFocus` bindings.
- Client-only preferences (favorite editor, composer stash, sidebar width) live in `$XDG_CONFIG_HOME/local-studio/linux.ini` (`src/prefs.rs`); everything shared goes through core `Settings`, including custom themes (`Settings.custom_themes`, JSON).
- Colors come from `src/colors.rs`: the default palette (dashboards) and the built-in `gildrb` theme (dark and light, follows the color scheme). CSS, code highlighting (`src/highlight.rs`), diff tags and the VTE palette all read the current `Colors`; add new colored surfaces there, not as literals.
- Headless runs use isolated state and the faux model:
  ```sh
  env HOME=/tmp/X/home LOCAL_STUDIO_DATA_DIR=/tmp/X/data EUKHE_CODING_AGENT_DIR=/tmp/X/agent \
    EUKHE_DAEMON_SOCKET=/tmp/X/d.sock EUKHE_DAEMON=<eukhe-daemon> EUKHE_OFFLINE=1 EUKHE_FAUX_SCRIPT=<script.json> \
    GDK_BACKEND=x11 GSK_RENDERER=cairo xvfb-run -a -s '-screen 0 1600x1000x24' dbus-run-session -- target/debug/local-studio --smoke
  ```
  - `--smoke`: adds a project, starts a thread through the composer, waits for the streamed reply in the timeline, then resolves an `@` mention, lists the project in the Files surface and runs a thread content search through the core; prints `PASS linux smoke` and exits 0.
  - `--snapshot <dir> [name-filter]`: renders every fixture scene (`src/fixtures.rs`, `src/scenes.rs`) offscreen to `<dir>/<scene>.png`; needs no daemon. Look at the PNGs after UI changes.
  - Stop the daemon afterwards from the repo root: `cargo run --example smoke -p local-studio-core -- --stop /tmp/X/d.sock`.
- Never stop processes this app did not spawn.
