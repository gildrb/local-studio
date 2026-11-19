#!/usr/bin/env bash
set -uo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <eukhe binary> [scratch dir]"; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
root=$here/../..
eukhe=$1
scratch=${2:-$(mktemp -d)}
target=${CARGO_TARGET_DIR:-/tmp/ls-cargo-target}
CARGO_TARGET_DIR=$target cargo build --manifest-path "$root/Cargo.toml" -p local-studio-remote --bins --examples || exit 1
out=$(cd "$target/debug/examples" && ./remote_smoke "$eukhe" "$scratch" 2>&1)
status=$?
printf '%s\n' "$out"
[ $status -eq 0 ] || { echo "remote_smoke failed ($status)"; exit 1; }
for want in \
  "a device whose key changes under an unchanged ledger stamp closes with 4401" \
  "the replay buffer holds a byte budget" \
  "revoke ends a socket whose writer is blocked on unread blobs" \
  "that would grow the core queue past its cap was refused with 1013" \
  "sockets rotating inside one IPv6 /64 share one pending cap and one failure count" \
  "an approval raised on an unwatched thread during a disconnect shows on Home after a delta resume"; do
  grep -qF "$want" <<<"$out" || { echo "remote_smoke did not report: $want"; exit 1; }
done
