# macOS Local Studio Application

- Use `swiftlint` for formatting and linting Swift code (`macos/.swiftlint.yml`).
  - Lint: `nix run nixpkgs#swiftlint -- lint --strict` from `macos/`.
  - Fix: `nix run nixpkgs#swiftlint -- --fix` from `macos/`.
- Use `macos/build.nu` to build the macOS app.
  - Build: `macos/build.nu [--configuration Debug|Release] [--action build|run|smoke]`
  - Output: `macos/build/<configuration>/LocalStudio.app` (e.g. `macos/build/Debug/LocalStudio.app`)
  - The script uses `/Library/Developer/CommandLineTools` when the Xcode license is not accepted; an explicit `DEVELOPER_DIR` wins.
- Verify end to end with `macos/build.nu --action smoke`; it exits non-zero on failure.
- Builds stay warning-free under strict concurrency checking.
- Never stop processes this app did not spawn.
