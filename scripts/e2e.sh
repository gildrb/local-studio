#!/usr/bin/env bash
set -euo pipefail
# e2e builds into its own target dir in this checkout, never a CARGO_TARGET_DIR shared with other
# worktrees, so another build can't swap the examples between this build and the runs.
target=$(git rev-parse --show-toplevel)/target/e2e
[ "${1:-}" = --target ] && { echo "$target"; exit 0; }
: "${LOCAL_STUDIO_SMOKE_AGENT:?set LOCAL_STUDIO_SMOKE_AGENT to the agent credentials dir (AGENTS.md)}"
command -v "${NU:-nu}" > /dev/null || { echo "nu is not on PATH; set NU to its path" >&2; exit 2; }
command -v bun > /dev/null || { echo "bun is not on PATH; local_smoke needs it" >&2; exit 2; }
context=local-studio/e2e
repo=${REPO:-baney75/local-studio}
examples=(smoke workspace_smoke working_smoke durable_smoke order_smoke stuck_smoke providers_smoke local_smoke plugin_smoke)
helpers=(provider_stub)
post=
[ "${1:-}" = --post ] && post=1 && shift
commit=${1:-$(git rev-parse HEAD)}
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$commit^{commit}")" ] || { echo "check out $commit first" >&2; exit 2; }
commit=$(git rev-parse HEAD)
git diff --quiet HEAD || { echo "the checkout has uncommitted changes" >&2; exit 2; }
root=$(pwd)

for file in core/examples/*.rs; do
  name=$(basename "$file" .rs)
  [[ " ${examples[*]} ${helpers[*]} " == *" $name "* ]] || { echo "core/examples/$name.rs is not run by scripts/e2e.sh; add it" >&2; exit 2; }
done

status() {
  [ -n "$post" ] || return 0
  gh api "repos/$repo/statuses/$commit" -f state="$1" -f context="$context" -f description="$2" > /dev/null
}

scratch=$(mktemp -d)
bin=
cleanup() {
  for socket in "$scratch"/*/d.sock; do
    [ -S "$socket" ] && [ -n "$bin" ] && "$bin/smoke" --stop "$socket" || true
  done
  rm -rf "$scratch"
}
trap cleanup EXIT
eukhe=$(realpath "$("${NU:-nu}" -c 'use eukhe.nu; eukhe binary . target/eukhe')")
# Always build from the checked commit, so a status never rests on examples from another commit,
# then run copies from scratch.
CARGO_TARGET_DIR=$target cargo build -j3 -p local-studio-core --examples
bin=$scratch/bin
mkdir -p "$bin"
for example in "${examples[@]}" "${helpers[@]}"; do
  [ -x "$target/debug/examples/$example" ] || { echo "$target/debug/examples/$example is missing after the build" >&2; exit 2; }
  cp "$target/debug/examples/$example" "$bin/"
done
status pending "core e2e running on $(hostname -s)"
for example in "${examples[@]}"; do
  echo "== $example"
  dir="$scratch/$example"
  case $example in
    local_smoke) args=("$eukhe" "$dir" 127.0.0.1 localhost) ;;
    plugin_smoke) args=("$eukhe" "$dir" "$LOCAL_STUDIO_SMOKE_AGENT/models.json" "$root/examples/plugins/smoothstone") ;;
    *) args=("$eukhe" "$dir") ;;
  esac
  if ! (cd "$bin" && "./$example" "${args[@]}"); then
    status failure "$example failed on $(hostname -s)"
    exit 1
  fi
done
status success "all ${#examples[@]} core e2e checks passed on $(hostname -s)"
echo "e2e ok for $commit"
