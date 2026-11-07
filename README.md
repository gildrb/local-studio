# Local Studio

Native Mac and Linux app for running many coding-agent threads at once on local and cloud models, built on [Eukhe](https://github.com/gildrb/eukhe).

## Install

```sh
nu macos/build.nu --configuration Release
```

Needs Xcode 26+, Rust 1.98, Nushell, and a sibling `eukhe` checkout. Linux: see [linux/AGENTS.md](linux/AGENTS.md).

## Use

- Open `macos/build/Release/LocalStudio.app`, add a project folder, start a thread.
- ⌘N new thread, ⌘T new thread in the current project, ⌘W close the thread, ⌃Tab recent threads, ⌘K command palette, ⌘J terminal, ⌥⌘B right panel, ⌘, settings.
- On macOS everything works from the keyboard: F6 or ⌘⌥←/→ move between sidebar, timeline, composer, right panel and terminal; arrows, Return, Space and Delete work in the lists; ⌘L focuses the composer. Settings → General → Keyboard turns on vim keys (j/k, gg/G, h/l, / and a modal composer).

## Many threads, one inbox

- Every thread across every project in one sidebar, with live status (working, needs approval, done).
- Threads keep running in the Eukhe daemon when the window closes; the Eukhe TUI sees the same sessions.

## Local models

- Settings → Local and the Local page manage machines, loaded models and the Local AI Registry through the controller.

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
- Provider sign-in happens in Eukhe (`eukhe`, then `/login`).

## Credits

- [Eukhe](https://github.com/gildrb/eukhe), the agent core, and this native rework: Gil Rodrigues ([gildrb.com](https://gildrb.com)).
- Local Studio: Sherif Cherfa ([0xSero](https://github.com/0xSero)) and [contributors](https://github.com/sybil-solutions/local-studio/graphs/contributors).
- [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools: the original app and layout Local Studio grew from.

## License

MIT. See [LICENSE](LICENSE).
