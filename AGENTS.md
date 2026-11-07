# Local Studio

Native desktop clients for local LLM work. The agent core is [Eukhe](https://github.com/gildrb/eukhe); Local Studio adds native GUIs and the local-LLM fleet.

## Architecture

- Eukhe is the core, like libghostty is Ghostty's: sessions, durable storage, the harness, memory, tools and inference live there. Local Studio never reimplements them.
- The engine runs out of process as `eukhe-daemon` (supervisor + one worker per session). GUIs reach it through the `eukhe-client` crate over the versioned `eukhe.daemon` protocol. A crash in the engine never takes a window down, and every Eukhe frontend can attach to the same session.
- Shared GUI logic lives once, in Rust (`core/`, crate `local-studio-core`): inbox across projects, transcripts, Local Studio state, git, files, terminals, usage, the Local fleet client, settings. Each GUI does only native chrome:
  - `macos/`: Swift + AppKit/SwiftUI, links the core through UniFFI (`kit/` → `LocalStudioKit`), like Ghostty links `GhosttyKit`.
  - `linux/`: Rust + GTK4 + libadwaita, links the core as a crate (own workspace, see `linux/AGENTS.md`).
- Core → GUI: `Studio` methods are fire-and-forget; the core calls `Waker.wake()` and the GUI drains `Studio.tick()` on its main thread into `Update`s.
- `controller/`: the local-LLM controller (Bun, port 18091): engine discovery, fleet gateway, registry launches. The core talks to it over HTTP and can start a bundled copy with its own data root.

## Rules

- Logic needed by both GUIs goes in `core/`; platform behavior (windows, menus, toolbars, notifications) stays in the GUI. Never port core logic into Swift or GTK code.
- Eukhe changes land in the eukhe repo, not as copies or patches here. `core/` depends on `../eukhe` by path.
- Verify end to end: build and run the real binaries. No new unit tests.
- Add no code comments.
- Never stop processes, controllers, engines, or GPU jobs this work did not start. Kill only PIDs you spawned.
- Controller: keep native inference requests as passthrough. Never disable CUDA graphs, enforce eager, or set output caps on vLLM/SGLang. New controllers use port 18091 and a separate data root.
- Never run against real user state in checks: isolate with `HOME`, `EUKHE_DAEMON_SOCKET`, `EUKHE_CODING_AGENT_DIR`, `LOCAL_STUDIO_DATA_DIR` under a scratch dir and `EUKHE_OFFLINE=1 EUKHE_FAUX_SCRIPT=<script.json>`; stop the daemon after (`core` smoke example `--stop <socket>`).
- `macos/AGENTS.md` and `linux/AGENTS.md` hold the per-platform build and lint rules.

## Commands

- Core: `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings`
- Core end to end: `cargo run -p local-studio-core --example smoke -- <eukhe-daemon> <scratch>` and `--example workspace_smoke -- <eukhe-daemon> <scratch>`
- Providers end to end: `cargo build -p local-studio-core --examples`, then `providers_smoke <eukhe-daemon> <scratch>` from the examples dir; it starts the `provider_stub` example on a random 127.0.0.1 port, round-trips a custom endpoint through Eukhe without real keys, and stops the stub by PID
- Stop a scratch daemon: `cargo run -p local-studio-core --example smoke -- --stop <socket>`
- Controller: `cd controller && bun install && bun run typecheck && bun run test`
- Share one cargo target across worktrees: `CARGO_TARGET_DIR=/tmp/ls-cargo-target`
