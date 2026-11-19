# Local Studio for iPhone

The native iPhone client for Local Studio Remote (`docs/remote.md`). `Packages/LocalStudioRemote` is the wire client and data layer; the app target is a plain debug shell until the design lands.

## Signing (once)

1. Open `ios/LocalStudio.xcodeproj` in Xcode.
2. Pick your team under Signing & Capabilities for the `LocalStudio` target and the `LocalStudioSmoke` target; if Apple says a bundle id is taken, change `LS_BUNDLE_PREFIX` in `project.yml` and run `xcodegen generate`.
3. Plug in your iPhone and select it as the run destination.
4. Choose the `LocalStudio Dev`, `LocalStudio Nightly` or `LocalStudio` scheme.
5. Press Run.

## Channels

Each channel is its own install with its own data and Keychain items (`docs/channels.md`).

| Scheme | Configuration | Bundle id | Name | Pairing code scheme |
| --- | --- | --- | --- | --- |
| `LocalStudio Dev` | Dev | `org.local.studio.ios.dev` | Local Studio Dev | `localstudio-dev` |
| `LocalStudio Nightly` | Nightly | `org.local.studio.ios.nightly` | Local Studio Nightly | `localstudio-nightly` |
| `LocalStudio` | Release | `org.local.studio.ios` | Local Studio | `localstudio` |

`MARKETING_VERSION` is the workspace `Cargo.toml` base version. `CURRENT_PROJECT_VERSION` is `0` for local builds; release builds pass `CURRENT_PROJECT_VERSION=YYYYMMDD.HHMMSS` (UTC) and `LS_VERSION=<full SemVer channel string>` on the `xcodebuild` command line. Without `LS_VERSION`, the build stamps `X.Y.Z-dev.0+local.<sha7>` into the `LSVersion` Info.plist key, which the app sends as `app` in the pairing device record and in `hello`.

## Commands

From the repository root:

```sh
cd ios && xcodegen generate
xcodebuild -project ios/LocalStudio.xcodeproj -scheme "LocalStudio Dev" -destination 'generic/platform=iOS Simulator' build
ios/tools/smoke.sh
cd ios && swiftlint lint --strict
```

`project.yml` is the source of the Xcode project; edit it and run `xcodegen generate`, and commit both.

## Transport

`MachineConnection` keeps four layers apart. The socket moves opaque messages: one text opening header, then binary only. `SecureChannel` takes the header as the Noise prologue, runs the handshake (`XXpsk3` to pair, `KK` after) and seals and opens each message. `RecordReader` and `RecordWriter` carry the `0x01`, `0x02` and `0x03` records and join chunked JSON. `FrameCodec` turns JSON into frames. `NoiseChannel` is the real `SecureChannel`: `Noise.swift` is the Noise state machine written to the spec on CryptoKit (`Noise_XXpsk3_25519_ChaChaPoly_SHA256` and `Noise_KK_25519_ChaChaPoly_SHA256`). `PassThroughChannel` sends the handshake messages with the right shapes and no cryptography; the app uses it only with `-LSPassThrough YES`, which the smoke passes for `fake-studio`.

Pairing follows `docs/remote.md`. The app makes a new static key and a new device id for each pairing, and it saves the machine credential only after the server's `hello` decrypts, since that is the first message proving the server holds the pairing secret. A close with 4401 (unknown, revoked or failed) shows "pair again"; 4409 (a newer socket of this phone took over), 4429 (address refused for a while, so the app waits at least 60 s) and 1013 (too many sockets opening) are ordinary drops with a reason. A send that went out in an earlier server epoch and was never acknowledged is not retried on its own: it shows Resend, because the snapshot's transcript shows whether it landed.

The app pairs only from its own Pair sheet: the camera scans the QR code (VisionKit), or a pasted link works on the Simulator. It registers no URL scheme and has no `onOpenURL`, because iOS doesn't make a custom scheme exclusive and a pairing link carries its secret. Each channel accepts only its own pairing scheme from the table above.

Each paired machine is one Keychain item (`AfterFirstUnlockThisDeviceOnly`, not synced) holding this phone's X25519 static key for that machine, the per machine device id, the machine's static public key, its id and its URLs with their last success times.

## Fake server and smoke

`bun ios/tools/fake-studio.ts --port 18094` speaks `docs/remote.md` deterministically over the pass through channel and prints its pairing link (`--scheme`, default `localstudio-dev`): the opening header, `XXpsk3` and `KK` handshake shapes, records with chunking, `hello` with `delta` or `snapshot` resume by `seq` and `epoch` (a snapshot carries the `seq` baseline), `watch`, a streamed reply, a tool call that waits for an approval, the queue, `load_earlier` answered inline over a 260 item thread, `{"re":id,"ok":true,"duplicate":true}` for a repeated `send`, a refused pairing that reuses a device id, 4409 for a replaced socket, 1002 for a broken record, `busy` once 64 prompts wait, notifications, `ping`, `not_remote` and `/v1/health`, as `remote-serve` answers them. `--pair-id` and `--pair-secret` fix the pairing link; `--protocol N --min-protocol M` sets its protocol window; `--busy-once-after N` answers `busy` to send N + 1 once. `--smoke-hooks` adds three test routes: `POST /v1/smoke/away?thread=<id>` drops every phone's socket and, while none is connected, raises `needs_approval` on that thread; `GET /v1/smoke/last-resume` answers the last `hello`'s resume kind; `GET /v1/smoke/hellos` counts the `hello`s so far.

`SMOKE_GATE` (a command prefix, such as a build gate), `SMOKE_JOBS` and `SMOKE_DERIVED_DATA` pass through to `xcodebuild`. `ios/tools/smoke.sh` starts two fake servers (one speaking protocol 2, one speaking 3 to 4), then runs `LocalStudioSmoke` with `xcodebuild test` on an iPhone 17 Pro simulator. The test pairs, opens a thread, sends, sees the streamed reply, queues a message (the fake answers it `busy` once, so it goes through the Outbox retry), approves the tool call, pages back a long thread, has the fake drop its socket and raise an approval on a thread the app never watched (the reconnect must be a `delta` resume and Home must show that `needs_approval`), kills and relaunches the app to see the cached list before it reconnects through `KK`, checks the incompatible machine, and prints the signpost timings JSON (also attached to the result bundle).

Against a real `local-studio-serve`, set `LOCAL_STUDIO_PAIR_LINK` to a fresh link from `local-studio-serve pair`, or `LOCAL_STUDIO_REMOTE_URL`, `LOCAL_STUDIO_PAIR_ID` and `LOCAL_STUDIO_PAIR_SECRET`, before `ios/tools/smoke.sh`. The real run sends one short prompt to the first thread and approves any approval it asks for. Calling `xcodebuild test` directly needs the same values with a `TEST_RUNNER_` prefix.

`cd ios/Packages/LocalStudioRemote && swift test` runs the Noise tests. With `LOCAL_STUDIO_PAIR_LINK` set to a fresh `local-studio-serve pair` link, `ServeInteropTests` also pairs with that real serve through `XXpsk3` and reconnects through `KK`, using the app's own Noise code, records and codec against `snow`. It then replays its own recorded `KK` first message on a new socket (the live socket must keep answering `ping`, and the replay must close with 1002), holds 6 pending sockets under three `Tailscale-User-Login` names (a seventh gets 1013, and the plain loopback client still reconnects), and reads every close code through `MachineConnection.closeCode(of:)`, since URLSession reports 1013, 4401, 4409 and 4429 as 1005 with the code in the close reason.

App launch arguments for testing: `-LSReset YES` wipes machines, cache and credentials; `-LSPairLink <link>` pairs on launch (the channel's own scheme only); `-LSPassThrough YES` uses the pass through channel for `fake-studio`; `-LSConnectDelay <seconds>` holds the first connection; `-LSSmoke YES` shows timings and skips the notification permission prompt.
