# Release channels

Every product in the Local Studio family ships on three channels: **stable**, **nightly** and **dev**. This file is the one scheme for all of them: Local Studio (desktop and iPhone), Silas, Polycarp, Tychicus, Fonsviva, Gantrel, UntoCaesar and Corunis. A product's own RELEASES.md may add detail; where it disagrees with this file, this file wins.

`scripts/check-channels.sh` enforces the parts a machine can check: no workflow starts on a pushed tag, the `stable` environment runs only from `workflow_call` or `workflow_dispatch`, the version examples sort as stated, and docs/remote.md carries the protocol window. CI runs it on every pull request, and `scripts/tests/check-channels-test.sh` proves it fails on bad workflows.

## The three channels

| Channel | For | Built from | When | Gate |
| --- | --- | --- | --- | --- |
| stable | Everyone. The default install. | `stable` branch, tag `vX.Y.Z` | When a nightly is promoted (rule below) | Promotion rule |
| nightly | Daily drivers who want new work first, Donovan included | `main` | Once a day at 07:00 UTC, skipped when `main` has not changed | CI green on Windows, macOS and Linux, plus the product's end-to-end checks from its AGENTS.md |
| dev | Developers and agents testing a change | `main` | Every merge to `main` | CI green |

A channel never ships half a build: CI uploads every platform into a draft release and swaps it in only when all of them succeeded (Silas's `nightly.yml` does this today; copy it). Publishing on a channel is serialized with a workflow `concurrency` group per channel (dev cancels the older run in progress), and a build refuses to publish when the feed already holds a version equal to or newer than its own.

## Branches and tags

- `main`: all work lands here by pull request. It feeds dev and nightly.
- `stable`: moves only through the promotion workflow (below), which fast-forwards it to a promoted nightly commit, or by a hotfix pull request merged with a merge commit. Protected by a ruleset: no force pushes, and no direct pushes except by GitHub Actions running the promotion workflow.
- `vX.Y.Z`: immutable tag on `stable` for each stable release. A tag is never reused or moved. A tag ruleset lets only the promotion workflow create tags matching `v*`.
- `nightly`: rolling tag and pre-release, moved to each new nightly. Each nightly also keeps an immutable pre-release tagged `nightly-YYYYMMDDHHMMSS` for 14 days, so any recent nightly can be reinstalled and promoted.
- `dev`: rolling tag and pre-release, moved to each dev build. No immutable dev tags.
- Feature branches: anything else. They never publish to a channel.
- No workflow triggers on a pushed `v*` tag. Stable builds start only from the promotion workflow, so no pre-release tag and no hand-made tag can start one.

Local Studio is a fork of gildrb/local-studio. Upstream changes come in by a pull request that merges `upstream/main` into `main`, like any other change.

## Version strings

One base version per product, `X.Y.Z`, in one file (Local Studio: the workspace `Cargo.toml`; Tauri apps: `tauri.conf.json`; Tychicus: its manifest). After stable `X.Y.Z` ships, `main` bumps the base to the next minor, `X.(Y+1).0`. Patch numbers on a released minor belong to hotfixes from `stable`, so `main` and a hotfix never claim the same version.

| Channel | Version | Example |
| --- | --- | --- |
| stable | `X.Y.Z` | `0.2.0`, hotfix `0.2.1` |
| nightly | `X.Y.Z-nightly.YYYYMMDDHHMMSS+<sha7>`, base = `main`'s unreleased minor | `0.3.0-nightly.20261118070000+1a2b3c4` |
| dev | `X.Y.Z-dev.YYYYMMDDHHMMSS+<sha7>` | `0.3.0-dev.20261117131042+9f8e7d6` |
| local build | `X.Y.Z-dev.0+local.<sha7>` | `0.3.0-dev.0+local.9f8e7d6` |

Timestamps are UTC build start. These are SemVer 2.0 strings, so for one base version dev sorts below nightly and nightly below stable (checked with the `semver` package: `0.3.0-dev.20261118090500 < 0.3.0-nightly.20261117070000 < 0.3.0`). A dev build made after a nightly still sorts below it. So:

- An updater compares versions **within its own channel** only. It offers an update when the feed's version on its channel is newer than the installed one.
- Switching channel is an explicit choice, never an "upgrade", and it may install a lower version. The in-app channel setting opens the other channel's download and the user installs it; no updater crosses channels, because each build trusts only its own channel's signing key (see Update feeds).
- Local builds never update themselves.

Where a platform needs numbers only:

- Apple: `CFBundleShortVersionString` = `X.Y.Z`; `CFBundleVersion` = the build timestamp as `YYYYMMDD.HHMMSS` (always rising, which TestFlight also needs).
- Browser extensions: `version` = `X.Y.Z.B` (the Windows `B` rule below), because Chrome allows only up to four integers; `version_name` = the full SemVer string.
- Windows file and product version: `X.Y.Z.B`, where `B` is 0 for stable and the CI run number modulo 65536 otherwise. Installers decide updates from the SemVer string, not this.
- Windows installers: nightly and dev ship NSIS only. An MSI rejects a pre-release identifier above 65535, so a stable MSI, where a product ships one, sets its WiX version explicitly (Tauri: `bundle.windows.wix.version`) from the `X.Y.Z.B` rule.

## Install identity

Each product picks one mode, recorded in the table below.

- **Side by side**: each channel is its own app with its own id, name and URL scheme, so stable and nightly can both be installed. This is T3 Code's model ("T3 Code" and "T3 Code (Nightly)").
- **Replace**: one app id for all channels; switching channel replaces the install. Use it for apps that hold macOS privacy grants (Accessibility, Microphone, Screen Recording), because a new id makes the user grant them again. Silas and Polycarp work this way today and keep one signing requirement across channels (Silas `docs/signing.md`).

Local Studio is side by side:

| | stable | nightly | dev |
| --- | --- | --- | --- |
| Name | Local Studio | Local Studio Nightly | Local Studio Dev |
| macOS bundle id | `org.local.studio.macos` | `org.local.studio.macos.nightly` | `org.local.studio.macos.dev` |
| Linux and Windows app id | `dev.localstudio.LocalStudio` | `dev.localstudio.LocalStudio.Nightly` | `dev.localstudio.LocalStudio.Dev` |
| iOS bundle id | `org.local.studio.ios` | `org.local.studio.ios.nightly` | `org.local.studio.ios.dev` |
| URL scheme | `localstudio` | `localstudio-nightly` | `localstudio-dev` |
| Data | shared with nightly | shared with stable | its own data dir |

The stable ids are the ones upstream already uses, so existing installs keep their data.

**Shared data.** Stable and nightly use the same Local Studio data dir and Eukhe sessions, so moving between them costs nothing while the data stays readable by both. Four rules keep it that way:

1. One owner at a time per data dir (`studio.lock`, see docs/remote.md). The second app to start attaches to the owner as a client, or says which app owns the data and offers to take over.
2. Between stable and nightly, data changes are additive: a build ignores fields it does not know and keeps them when it writes. Every write records the schema version.
3. A change an older build cannot read is a breaking migration. Nightly snapshots the data dir before running it. A build that finds a newer schema than it knows opens read-only, names the channel that wrote it, and offers to open the snapshot. The cost is stated in the release notes: stable then sees work only up to the snapshot until the migration reaches stable. At most one breaking migration and one client protocol bump land per stable release, so stable is never more than one protocol version behind nightly.
4. The newer Eukhe release wins the daemon. An older app offers the newer channel instead of restarting the daemon onto an older Eukhe.

Dev keeps its own data dir (`Local Studio Dev`) so tests never touch real threads, matching AGENTS.md.

## Update feeds

Each product publishes one JSON feed per channel as a release asset named `latest.json`:

| Channel | URL |
| --- | --- |
| stable | `https://github.com/baney75/<repo>/releases/latest/download/latest.json` |
| nightly | `https://github.com/baney75/<repo>/releases/download/nightly/latest.json` |
| dev | `https://github.com/baney75/<repo>/releases/download/dev/latest.json` |

The format is Tauri v2's updater manifest (Silas already serves it), with extra fields that Tauri ignores:

```json
{
  "product": "local-studio",
  "channel": "nightly",
  "version": "0.2.1-nightly.202611180700+1a2b3c4",
  "commit": "1a2b3c4d5e6f...",
  "pub_date": "2026-11-18T07:24:10Z",
  "notes": "Plain-words summary of what changed.",
  "protocol": 1,
  "platforms": {
    "darwin-aarch64": { "url": "...", "signature": "...", "sha256": "..." },
    "linux-x86_64": { "url": "...", "signature": "...", "sha256": "..." },
    "windows-x86_64": { "url": "...", "signature": "...", "sha256": "..." }
  }
}
```

- `signature` is a minisign signature of the artifact, as Tauri checks it. The Local Studio core checks the same feed and signature for all three desktop apps, so the native apps need no second updater format.
- `protocol` is the client protocol version the build speaks (docs/remote.md). Both sides speak their own protocol and the one before it: a server accepts both, and a client falls back to the older one when the server is older. So a nightly app or phone can attach to a stable owner and the other way round. Mixing builds two or more protocol versions apart is unsupported, and the one-bump-per-release rule keeps stable and nightly within one.
- Stable is signed with a key that only the `stable` GitHub Environment can read, and that environment only runs on the `stable` branch. Nightly and dev share a second key held by CI. Each build carries only its own channel's public key, so nothing built from `main` can install over a stable app through the updater.
- iPhone: dev builds install from Xcode; nightly goes to a TestFlight internal group; stable goes to TestFlight external testing and later the App Store, under the Apple team that signs Silas.
- Plugins and skill packs that ship as git trees (Gantrel, UntoCaesar, Corunis, Fonsviva) need no binary feed: their channel is a git ref. stable = the newest `vX.Y.Z` tag, nightly = the `nightly` tag, dev = `main`. A Local Studio install on channel C installs plugins from channel C by default. How the plugin catalog records this belongs to the plugin system lead.

## Promotion rule

**Dev** publishes on every merge to `main` with CI green.

**Nightly** publishes at 07:00 UTC when `main` changed since the last nightly and all of these pass:

1. CI green on Windows, macOS and Linux.
2. The product's end-to-end checks from its AGENTS.md (Local Studio: the core smoke examples on a real model).
3. No open issue labeled `regression` and `blocks-nightly`.

**Stable** promotes one nightly build when all of these hold:

1. That nightly was published at least 72 hours ago, and no later nightly found a regression in it.
2. Its commit has `stable`'s head as an ancestor, so it carries every hotfix merged back.
3. No open `regression` issue against any build since the last stable.
4. The product's TESTING.md checklist passes on that commit, and for anything with a screen, its steps were tried live on the Mac (the `live-checker` agent), not only in CI.
5. Release notes in plain words are written, in a pull request against `main` that passes the gates `baney-review` sets.

Then the product lead runs the promotion workflow on the `stable` ref: `gh workflow run promote.yml --ref stable -f nightly=nightly-YYYYMMDDHHMMSS`. It checks conditions 1 to 3 itself and stops if any fails, fast-forwards `stable` to that commit with `git push origin <sha>:refs/heads/stable`, tags it `vX.Y.Z`, checks the tag's commit equals `stable`'s head, and calls the stable build, which signs and publishes. Then `main` bumps its base version. The `stable` GitHub Environment, which holds the stable signing key, allows only runs on the `stable` branch.

**Hotfix**: a pull request into `stable`, merged with a merge commit, with a check that fails before the fix and passes after. It skips the 72 hours: `gh workflow run promote.yml --ref stable -f hotfix=true` tags `stable`'s head `vX.Y.(Z+1)` and builds it. `stable` then merges back into `main` with a merge commit (never a squash) the same day, so later nightlies carry it.

**Rollback**: re-publish the previous release's `latest.json` on that channel. That stops new installs from taking the bad build, but updaters never offer a lower version, so machines that already took it are repaired by rolling forward: a hotfix with a higher version that carries the good code. Never delete a release.

**Renaming a feed**: an installed build has its feed URL built in, so a channel or tag rename (Polycarp's `preview` to `nightly`) first ships one last build on the old feed that points at the new feed, and the old `latest.json` keeps being served until that bridge build has reached every install. Only then is the old tag retired. The first version on the new feed must sort above the bridge build's version; bump `main`'s base version at the rename, because `nightly` sorts below `preview`.

## Products

| Product | Mode | Today | Changes to adopt this scheme |
| --- | --- | --- | --- |
| Local Studio desktop (`baney75/local-studio`) | side by side | No releases; bundle version 0.0.0 | Add `stable` branch, nightly and dev workflows, version stamping, the core update check |
| Local Studio iPhone (`ios/` in this repo) | side by side | In progress (PR #4) | Same version and tags as the desktop app, so the protocol always matches |
| Silas | replace | `vX.Y.Z` tags from the Mac, rolling `nightly` (`-nightly.YYYYMMDDHHMM`) | Add `stable` branch and `dev`; add `+<sha7>` to nightly versions |
| Polycarp | replace | Rolling `preview` pre-release | Move `preview` to `nightly` through a bridge build (Renaming a feed); add `stable` and `dev` |
| Tychicus | side by side (extension ids per channel) | `v*` tag release workflow | Replace the `v*` tag trigger with the promotion workflow; add `stable` branch, nightly and dev; extension `version` per the numbers-only rule; Chrome Web Store gets stable only |
| Fonsviva | git ref | `main` and `stable` branches | Add `nightly` tag and `vX.Y.Z` tags |
| Gantrel | git ref | `main` and `stable` (RELEASES.md says no nightly) | Add the `nightly` tag; update RELEASES.md to this scheme |
| UntoCaesar | git ref | `main` and `stable` | Add `nightly` tag and `vX.Y.Z` tags |
| Corunis | git ref | `main` and `stable` | Add `nightly` tag and `vX.Y.Z` tags |
| Eukhe (upstream, pinned) | n/a | Pinned release tag | Every channel pins a released Eukhe tag; `EUKHE_BIN` overrides stay local |

Local Studio's stable channel opens with its first public release (target February 1, 2027). Until then nightly is the daily driver, as T3 Code nightly is today.
