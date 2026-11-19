#!/usr/bin/env bash
# e2e.sh must build into this checkout's own target dir even when CARGO_TARGET_DIR points at a shared one.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
got=$(CARGO_TARGET_DIR=/tmp/ls-cargo-target "$here/../e2e.sh" --target 2>&1)
[ "$got" = "$root/target/e2e" ] || { echo "e2e.sh target is '$got', want '$root/target/e2e'"; exit 1; }
grep -q 'CARGO_TARGET_DIR=\$target cargo build' "$here/../e2e.sh" || { echo "e2e.sh does not build into its own target"; exit 1; }
echo ok
