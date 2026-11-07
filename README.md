# Local Studio

Native desktop clients for running coding agents on local LLMs, built on [Eukhe](https://github.com/gildrb/eukhe).

## Components

- `macos/`: native macOS app (Swift, AppKit).
- `linux/`: native Linux app (GTK4, libadwaita).
- `core/`: shared Rust logic both apps link.
- `controller/`: local-LLM controller: discovers inference engines, links machines into a fleet, launches registry recipes. See [docs/controller.md](docs/controller.md).

## Limitations

- macOS (Apple Silicon) and Linux only.
- Not sandboxed: agents run code with your user permissions.

## License

MIT. See [LICENSE](LICENSE).
