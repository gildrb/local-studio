#!/usr/bin/env bash
set -euo pipefail

ios="$(cd "$(dirname "$0")/.." && pwd)"
scheme="${SMOKE_SCHEME:-LocalStudio Dev}"
destination="${SMOKE_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5}"
bun="${BUN:-$HOME/.bun/bin/bun}"
work="$(mktemp -d "${TMPDIR:-/tmp}/ls-ios-smoke.XXXXXX")"
timings="$work/smoke-timings.json"
fake_pid=""
future_pid=""

cleanup() {
  for pid in $fake_pid $future_pid; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

wait_health() {
  for _ in $(seq 50); do
    curl -fsS "http://127.0.0.1:$1/v1/health" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  curl -fsS "http://127.0.0.1:$1/v1/health" >/dev/null
}

if [[ -n "${LOCAL_STUDIO_PAIR_LINK:-}${LOCAL_STUDIO_REMOTE_URL:-}" ]]; then
  if [[ -z "${LOCAL_STUDIO_PAIR_LINK:-}" ]]; then
    : "${LOCAL_STUDIO_PAIR_ID:?set LOCAL_STUDIO_PAIR_ID with LOCAL_STUDIO_REMOTE_URL}"
    : "${LOCAL_STUDIO_PAIR_SECRET:?set LOCAL_STUDIO_PAIR_SECRET with LOCAL_STUDIO_REMOTE_URL}"
  fi
  fake=0
  incompatible=""
else
  port="${SMOKE_PORT:-18094}"
  LOCAL_STUDIO_REMOTE_URL="ws://127.0.0.1:$port/v1/ws"
  LOCAL_STUDIO_PAIR_ID="$(openssl rand -hex 8)"
  LOCAL_STUDIO_PAIR_SECRET="$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')"
  "$bun" "$ios/tools/fake-studio.ts" --port "$port" --pair-id "$LOCAL_STUDIO_PAIR_ID" --pair-secret "$LOCAL_STUDIO_PAIR_SECRET" --busy-once-after 1 --smoke-hooks >"$work/fake-studio.log" 2>&1 &
  fake_pid=$!
  "$bun" "$ios/tools/fake-studio.ts" --port "$((port + 1))" --name future-studio --protocol 4 --min-protocol 3 >"$work/future-studio.log" 2>&1 &
  future_pid=$!
  wait_health "$port"
  wait_health "$((port + 1))"
  incompatible="ws://127.0.0.1:$((port + 1))/v1/ws"
  fake=1
fi

status=0
TEST_RUNNER_LOCAL_STUDIO_PAIR_LINK="${LOCAL_STUDIO_PAIR_LINK:-}" \
TEST_RUNNER_LOCAL_STUDIO_REMOTE_URL="${LOCAL_STUDIO_REMOTE_URL:-}" \
TEST_RUNNER_LOCAL_STUDIO_PAIR_ID="${LOCAL_STUDIO_PAIR_ID:-}" \
TEST_RUNNER_LOCAL_STUDIO_PAIR_SECRET="${LOCAL_STUDIO_PAIR_SECRET:-}" \
TEST_RUNNER_LOCAL_STUDIO_FAKE="$fake" \
TEST_RUNNER_LOCAL_STUDIO_INCOMPATIBLE_URL="${incompatible:-}" \
TEST_RUNNER_LOCAL_STUDIO_SMOKE_TIMINGS="$timings" \
${SMOKE_GATE:-} xcodebuild test \
  -project "$ios/LocalStudio.xcodeproj" \
  -scheme "$scheme" \
  -destination "$destination" \
  -resultBundlePath "$work/LocalStudioSmoke.xcresult" \
  ${SMOKE_JOBS:+-jobs "$SMOKE_JOBS"} \
  ${SMOKE_DERIVED_DATA:+-derivedDataPath "$SMOKE_DERIVED_DATA"} \
  >"$work/xcodebuild.log" 2>&1 || status=$?

grep -E "Test (Case|Suite)|error:|failed|\*\* TEST" "$work/xcodebuild.log" | tail -20 || true
[[ -f "$work/fake-studio.log" ]] && grep -E "^(paired|answered busy|raised|hello)" "$work/fake-studio.log" || true
echo "log: $work/xcodebuild.log"
echo "result bundle: $work/LocalStudioSmoke.xcresult"
if [[ -f "$timings" ]]; then
  echo "timings: $timings"
  cat "$timings"
else
  grep -o "SMOKE_TIMINGS .*" "$work/xcodebuild.log" | tail -1 || true
fi
exit "$status"
