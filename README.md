# Local Studio

Native Mac and Linux app for running many coding-agent threads at once on local and cloud models, built on [Eukhe](https://github.com/gildrb/eukhe).

## Install

```sh
nu macos/build.nu --configuration Release
```

Needs Xcode 26+, Rust 1.98, and Nushell; the build fetches the pinned Eukhe release (v0.10.70). Linux: see [linux/AGENTS.md](linux/AGENTS.md).

## Use

- Open `macos/build/Release/LocalStudio.app`, add a project folder, start a thread.
- ⌘N new thread, ⌘T new thread in the current project, ⌘W close the thread, ⌃Tab recent threads, ⌘K command palette, ⌘J terminal, ⌥⌘B right panel, ⌘, settings.
- On macOS everything works from the keyboard: F6 or ⌘⌥←/→ move between sidebar, timeline, composer, right panel and terminal; arrows, Return, Space and Delete work in the lists; ⌘L focuses the composer. Settings → General → Keyboard turns on vim keys (j/k, gg/G, h/l, / and a modal composer).

## Many threads, one inbox

- Every thread across every project in one sidebar, with live status (working, needs approval, done).
- Threads keep running in the Eukhe daemon when the window closes; the Eukhe TUI sees the same sessions.
- Working follows the daemon: a thread whose session worker stopped, passivated or crashed leaves Working, Stop escalates to stopping the worker when a run does not end within seconds, and a running thread offers Stop and Delete. When the daemon on the socket runs another Eukhe version than the app bundles, a banner offers Restart Daemon.

## Providers

- Settings → Providers: paste API keys for built-in providers, add any OpenAI-compatible, OpenAI Responses or Anthropic endpoint (Test Connection lists its models), and use engines running on the Local fleet with one click.
- Keys go to Eukhe's `auth.json` (mode 0600) and endpoints to its `models.json`; new models show up in the model picker right away.

## Local models

- Settings → Local manages machines, loaded models and the Local AI Registry through the controller. The Local page is a per-machine dashboard: decode speed, first-token time, requests in flight, KV cache, GPUs, memory and power, a 24-hour decode chart and a year of daily tokens, with Switch model… and Stop model….

## Native

- AppKit/SwiftUI on macOS, GTK4 + libadwaita on Linux, one Rust core.
- Terminals and syntax highlighting live in the core: [libghostty-vt](https://lib.ghostty.org) emulation and grammar-based highlighting, drawn natively by each app.

## Components

- `core/`: shared Rust logic both apps link.
- `kit/`: the core as a static library with Swift bindings.
- `macos/`: macOS app.
- `linux/`: Linux app.
- `controller/`: local-LLM controller: discovers inference engines, links machines into a fleet, launches registry recipes. See [docs/controller.md](docs/controller.md).

## Limitations

- macOS 26+ (Apple Silicon) and Linux only.
- Not sandboxed: agents run code with your user permissions.
- Subscription sign-in (ChatGPT, Claude, GitHub Copilot) happens in Eukhe (`eukhe`, then `/login`).

## Credits

- [Eukhe](https://github.com/gildrb/eukhe), the agent core, and this native rework: Gil Rodrigues ([gildrb.com](https://gildrb.com)).
- Local Studio: Sherif Cherfa ([0xSero](https://github.com/0xSero)) and [contributors](https://github.com/sybil-solutions/local-studio/graphs/contributors).
- [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools: the original app and layout Local Studio grew from.

## License

MIT. See [LICENSE](LICENSE).
