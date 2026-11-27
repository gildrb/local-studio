#!/usr/bin/env bash
# E2E for the phone bridge: isolated T3 home + isolated EUKHE home, real server,
# real sidecar, real iroh dial from the sidecar client bin.
# Usage: scripts/phone-bridge-e2e.sh
set -euo pipefail

CHECKOUT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/phone-e2e.XXXXXX)"
T3_HOME="$TEST_ROOT/t3-home"
EUKHE_HOME="$TEST_ROOT/eukhe-home"

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$T3_HOME/userdata/secrets/phone"
head -c 32 /dev/urandom > "$T3_HOME/userdata/secrets/phone/pair-token.bin"
TOKEN="$(xxd -p -c64 "$T3_HOME/userdata/secrets/phone/pair-token.bin")"
mkdir -p "$EUKHE_HOME"
export EUKHE_HOME="$EUKHE_HOME"

cat > "$T3_HOME/userdata/settings.json" <<EOF
{
  "providerInstances": {
    "eukhe": { "driver": "eukhe", "displayName": "Eukhe", "enabled": true, "config": {} }
  }
}
EOF

echo "== starting server (home: $T3_HOME)"
node "$CHECKOUT/apps/server/src/bin.ts" serve --base-dir "$T3_HOME" --port 18990 \
  > "$TEST_ROOT/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 120); do
  if grep -q "nodeId" "$TEST_ROOT/server.log" 2>/dev/null; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server died early:"; tail -40 "$TEST_ROOT/server.log"; exit 1
  fi
  sleep 1
done

NODE_ID="$(grep -o "nodeId: '[0-9a-f]*'" "$TEST_ROOT/server.log" | head -1 | cut -d"'" -f2)"
if [ -z "$NODE_ID" ]; then
  echo "no node_id found in server log:"; tail -40 "$TEST_ROOT/server.log"; exit 1
fi
echo "== sidecar node id: $NODE_ID"

CLIENT="$CHECKOUT/native/alleycat-host/target/release/alleycat-host"
echo "== list_agents"
"$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" list-agents

echo "== connect + initialize + thread/start + turn/start"
"$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" \
  run-turn --agent eukhe --text "Reply with exactly: BRIDGE_OK" --expect-fragment "BRIDGE_OK"

echo "== interrupt a turn in flight"
"$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" \
  run-turn --agent eukhe --text "Write a very long essay about rivers." --interrupt

echo "== resume with cursor"
"$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" \
  run-turn --agent eukhe --text "Reply with exactly: BRIDGE_OK2" --resume --expect-fragment "BRIDGE_OK2"

echo "== thread pages with cursor"
"$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" threads --limit 2

echo "== fuzzy file search + one-off exec"
mkdir -p "$TEST_ROOT/search-root/docs"
echo "bridge sentinel" > "$TEST_ROOT/search-root/docs/bridge-sentinel.txt"
(
  cd "$TEST_ROOT/search-root" && "$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" \
    search-exec --query sentinel --expect-hit bridge-sentinel \
    --exec-shell 'printf BRIDGE_EXEC_OK' --exec-stdout BRIDGE_EXEC_OK
)

echo "== image input frame over turns hydration"
PNG_DATA_URL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
"$CLIENT" client --node-id "$NODE_ID" --token "$TOKEN" \
  run-turn --agent eukhe --text "Reply with exactly: BRIDGE_IMG" \
  --image-data-url "$PNG_DATA_URL" --verify-image-input --expect-fragment "BRIDGE_IMG"

echo "== e2e passed"
