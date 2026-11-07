# Local Studio

Native desktop clients for local LLM work. The agent core is [Eukhe](https://github.com/gildrb/eukhe); Local Studio adds native GUIs and the local-LLM fleet.

## Architecture

- Eukhe is the core, like libghostty is Ghostty's: sessions, durable storage, the harness, memory, tools and inference live there. Local Studio never reimplements them.
- The engine runs out of process as `eukhe-daemon` (supervisor + one worker per session). GUIs reach it through the `eukhe-client` crate over the versioned `eukhe.daemon` protocol. A crash in the engine never takes a window down, and every Eukhe frontend can attach to the same session.
- Shared GUI logic lives once, in Rust (`core/`, on `eukhe-client`). Each GUI does only native chrome:
  - `macos/`: Swift + AppKit, links the core through a C ABI (`LocalStudioKit`), like Ghostty links `GhosttyKit`.
  - `linux/`: Rust + GTK4 + libadwaita, links the core as a crate.
- `controller/`: the local-LLM controller (Bun, port 18091): engine discovery, fleet gateway, registry launches. GUIs talk to it over HTTP.

## Rules

- Logic needed by both GUIs goes in `core/`; platform behavior (windows, menus, toolbars, notifications) stays in the GUI. Never port core logic into Swift or GTK code.
- Eukhe changes land in the eukhe repo, not as copies or patches here.
- Verify end to end: build and run the real binaries. No new unit tests.
- Add no code comments.
- Never stop processes, controllers, engines, or GPU jobs this work did not start. Kill only PIDs you spawned.
- Controller: keep native inference requests as passthrough. Never disable CUDA graphs, enforce eager, or set output caps on vLLM/SGLang. New controllers use port 18091 and a separate data root.
- `macos/AGENTS.md` holds the macOS build and lint rules.

## Commands

- Controller: `cd controller && bun install && bun run typecheck && bun run test`
