# Local Studio

Native desktop clients for local LLM work. The agent core is [Eukhe](https://github.com/gildrb/eukhe); Local Studio adds native GUIs and the local-LLM fleet.

## Architecture

- Eukhe is the core, like libghostty is Ghostty's: sessions, durable storage, the harness, memory, tools and inference live there. Local Studio never reimplements them.
- The engine runs out of process as the Eukhe daemon (`eukhe --mode daemon`: supervisor + one worker per session), started through `eukhe-client`'s `ProcessLauncher` on Eukhe's socket path. GUIs reach it through the `eukhe-client` crate over the versioned `eukhe.daemon` protocol. A crash in the engine never takes a window down, and every Eukhe frontend can attach to the same session.
- Shared GUI logic lives once, in Rust (`core/`, crate `local-studio-core`): inbox across projects, transcripts, Local Studio state, git, files, terminals, usage, the Local fleet client, settings. Each GUI does only native chrome:
  - `macos/`: Swift + AppKit/SwiftUI, links the core through UniFFI (`kit/` → `LocalStudioKit`), like Ghostty links `GhosttyKit`.
  - `linux/`: Rust + GTK4 + libadwaita, links the core as a crate (own workspace, see `linux/AGENTS.md`).
- Core → GUI: `Studio` methods are fire-and-forget; the core calls `Waker.wake()` and the GUI drains `Studio.tick()` on its main thread into `Update`s.
- `controller/`: the local-LLM controller (Bun, port 18091): engine discovery, fleet gateway, registry launches. The core talks to it over HTTP and can start a bundled copy with its own data root.

## Rules

- Logic needed by both GUIs goes in `core/`; platform behavior (windows, menus, toolbars, notifications) stays in the GUI. Never port core logic into Swift or GTK code.
- Eukhe changes land in the eukhe repo, not as copies or patches here. Both workspaces pin `eukhe-client` and `eukhe-types` to one Eukhe release tag (git dependencies, root `Cargo.toml`); the apps bundle the `eukhe` binary of that same release (`eukhe.nu`: downloaded from the GitHub release and checked against its `SHA256SUMS` into `<target>/eukhe/<tag>/`, or `EUKHE_BIN=<eukhe built from the tag>`). Move both together.
- Verify end to end: build and run the real binaries. No new unit tests.
- Add no code comments.
- Never stop processes, controllers, engines, or GPU jobs this work did not start. Kill only PIDs you spawned.
- Controller: keep native inference requests as passthrough. Never disable CUDA graphs, enforce eager, or set output caps on vLLM/SGLang. New controllers use port 18091 and a separate data root.
- Never run against real user state in checks: isolate with `HOME`, `EUKHE_DAEMON_SOCKET`, `EUKHE_CODING_AGENT_DIR`, `LOCAL_STUDIO_DATA_DIR` under a scratch dir; stop the daemon after (`core` smoke example `--stop <socket>`).
- Checks drive a real model, never a faux one: `anthropic/claude-haiku-5-5`, thinking `low`, a handful of short prompts per run, one run at a time. Link, never copy, `auth.json`: `ln -s "$(realpath <creds>/auth.json)" <scratch>/agent/auth.json`; Eukhe writes refreshed OAuth tokens back through the link, while a copy that refreshes rotates the token and logs the real account out. Copy `models.json` and `settings.json` with mode 0600; remove only the link after the run. The core examples do this themselves from `LOCAL_STUDIO_SMOKE_AGENT=<creds dir>`. Assert behavior a correct app always shows (a real tool call and its file, the reply arriving, transcript order, usage with real tokens and cost), never model wording.
- `macos/AGENTS.md` and `linux/AGENTS.md` hold the per-platform build and lint rules.

## Commands

- Core: `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings`
- Core end to end (each takes the release `eukhe` binary, e.g. `target/eukhe/<tag>/eukhe` after an app build, needs `LOCAL_STUDIO_SMOKE_AGENT`, ends with a usage report that must count real tokens and cost, and removes its credential link): `cargo run -p local-studio-core --example smoke -- <eukhe> <scratch>`, `--example workspace_smoke -- <eukhe> <scratch>`, `--example working_smoke -- <eukhe> <scratch>` (a tool step keeps the thread busy with one start time)
- Providers end to end: `cargo build -p local-studio-core --examples`, then `providers_smoke <eukhe> <scratch>` from the examples dir; it round-trips the built-in `anthropic` provider on the real model, starts the `provider_stub` example (the custom endpoint under test) on a random 127.0.0.1 port, round-trips a custom endpoint through Eukhe on its own scratch `auth.json` (`{}`) — refusing to start (`local_studio_core::check_scratch_agent`) if that file is a symlink, a hard link or holds keys, or the dir resolves into a real agent dir (`.pi`, `.eukhe`) — checks models.json and auth.json return to the providers they started with, and stops the stub by PID
- Durability end to end: `--example durable_smoke -- <eukhe> <scratch>` quits the core mid-turn (a real `sleep 8` bash call), checks the Eukhe daemon survives, and requires the reopened core to show the turn's tool output and reply
- Stop a scratch daemon: `cargo run -p local-studio-core --example smoke -- --stop <socket>`
- Controller: `cd controller && bun install && bun run typecheck && bun run test`
- Share one cargo target across worktrees: `CARGO_TARGET_DIR=/tmp/ls-cargo-target`
