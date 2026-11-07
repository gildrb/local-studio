import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "local-studio-e2e-"));
const key = randomBytes(24).toString("hex");
const children = [];
const servers = [];
const received = [];
const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", timeout: 10_000 });
const listen = async (server) => {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const waitFor = async (fn, label, ms = 35_000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out: ${label}`, { cause: last });
};
const call = (port, path, body, headers = auth) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    headers,
    ...(body === undefined
      ? {}
      : { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
const snapshot = async (port) => (await call(port, "/api/snapshot")).json();

try {
  mkdirSync(join(root, "dist"));
  const captured = {
    model: "preserved",
    card: "unknown",
    engine: "vllm",
    weights: "baked-into-image",
    launch: { kind: "host", port: 8000, ctx: 4096 },
    proof: [{ captured: true }],
  };
  writeFileSync(
    join(root, "dist/catalog.json"),
    JSON.stringify({ cards: {}, recipes: { captured } }),
  );
  git("init", "-q");
  git("add", "-f", "dist/catalog.json");
  git("-c", "user.name=Local E2E", "-c", "user.email=e2e@localhost", "commit", "-qm", "fixture");
  const commit = git("rev-parse", "HEAD").toString().trim();
  const stream =
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\\"x\\\":1}"}}]}}]}\n\ndata: [DONE]\n\n';
  const born = Date.now();
  const metrics = (model) => {
    const ms = Date.now() - born;
    const requests = Math.floor(ms / 1000);
    const labels = `{model_name="${model}",engine="0"}`;
    return [
      "# TYPE vllm:generation_tokens_total counter",
      `vllm:generation_tokens_total${labels} ${Math.floor(ms * 0.4)}`,
      `vllm:prompt_tokens_total${labels} ${ms * 2}`,
      `vllm:num_requests_running${labels} 4`,
      `vllm:num_requests_waiting${labels} 1`,
      `vllm:kv_cache_usage_perc${labels} 0.04`,
      `vllm:time_to_first_token_seconds_bucket{le="0.5",model_name="${model}"} ${requests}`,
      `vllm:time_to_first_token_seconds_sum${labels} ${requests * 0.346}`,
      `vllm:time_to_first_token_seconds_count${labels} ${requests}`,
      "",
    ].join("\n");
  };
  const engine = async (models) =>
    listen(
      createServer(async (req, res) => {
        if (req.url === "/v1/models") {
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
        }
        if (req.url === "/metrics") {
          res.setHeader("content-type", "text/plain; version=0.0.4");
          return res.end(metrics(models[0]));
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        received.push({ raw, headers: req.headers, path: req.url });
        const body = JSON.parse(raw);
        if (body.fixtureResponse) {
          res.writeHead(200, {
            "content-type": body.stream ? "text/event-stream" : "application/json",
          });
          const bytes = Buffer.from(body.fixtureResponse);
          for (let offset = 0; offset < bytes.length; offset += 7)
            res.write(bytes.subarray(offset, offset + 7));
          return res.end();
        }
        if (req.url === "/v1/messages") {
          res.writeHead(422, { "content-type": "application/json", "x-engine-error": "native" });
          return res.end('{"error":{"type":"native_fixture_error"}}');
        }
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream", "x-engine-stream": "native" });
          res.write(stream.slice(0, 21));
          return setTimeout(() => res.end(stream.slice(21)), 15);
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ model: body.model, fixture: true, path: req.url }));
      }),
    );
  const engineA = await engine(["alpha", "shared"]);
  const engineB = await engine(["beta", "shared"]);
  const ports = [];
  for (let i = 0; i < 3; i++) {
    const s = createServer();
    ports.push(await listen(s));
    await new Promise((resolve) => s.close(resolve));
  }
  const fakeBin = join(root, "bin");
  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, "nvidia-smi"),
    [
      "#!/bin/sh",
      'case "$1" in --query-gpu=*)',
      "printf '0, GPU-e2e-0, NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 95000, 97887, 275.40, 275.00, 65, 100\\n'",
      "printf '1, GPU-e2e-1, NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 96000, 97887, 276.00, 275.00, 48, 100\\n' ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  for (const [i, port] of ports.entries()) {
    const home = join(root, `controller-${i}`);
    mkdirSync(home);
    writeFileSync(
      join(home, "usage.json"),
      JSON.stringify({ legacy: { requests: 7, lastAt: "2025-01-01T00:00:00Z" } }),
    );
    const excludePorts = [
      ...ports,
      ...(i === 0 ? [engineB] : i === 1 ? [engineA] : [engineA, engineB]),
    ];
    const peers = [`http://127.0.0.1:${ports[(i + 1) % ports.length]}`];
    const config = {
      id: `fixture-${i}`,
      name: `Fixture ${i}`,
      url: `http://127.0.0.1:${port}`,
      fleetKey: key,
      peers,
      excludePorts,
    };
    const registry = { url: root, dir: root, ref: commit };
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        ...config,
        engineKeys: { [engineA]: "fixture-engine-secret" },
        registry,
        modelsDir: join(home, "models"),
      }),
      { mode: 0o600 },
    );
    const env = {
      ...process.env,
      LOCAL_STUDIO_CONTROLLER_HOME: home,
      LOCAL_STUDIO_CONTROLLER_PORT: String(port),
      LOCAL_STUDIO_CONTROLLER_HOST: "127.0.0.1",
      ...(i === 0 ? { PATH: `${fakeBin}:${process.env.PATH}` } : {}),
    };
    const child = spawn("bun", [new URL("../src/main.ts", import.meta.url).pathname], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => (log += chunk));
    children.push(child);
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(log);
      return (await call(port, "/api/health", undefined, {})).ok;
    }, `controller ${i} health`);
  }
  const [a, b, c] = ports;
  assert.equal((await call(a, "/api/snapshot", undefined, {})).status, 401);
  await waitFor(async () => {
    const s = await snapshot(a);
    return (
      ["alpha", "beta"].every((id) => s.models.some((m) => m.id === id && m.live)) &&
      s.controllers.length === 3
    );
  }, "discovery and cyclic controller graph");
  const s = await snapshot(a);
  assert.equal(s.controllers.filter((x) => x.reachable).length, 3);
  assert.equal(s.endpoints.filter((x) => x.models.includes("shared")).length, 2);
  let telemetry;
  await waitFor(async () => {
    telemetry = await (await call(a, "/api/telemetry?history=1")).json();
    return telemetry.live.decodeTps > 0 && telemetry.history.days.some((d) => d.generation > 0);
  }, "telemetry from engine metrics and nvidia-smi");
  assert(Math.abs(telemetry.live.decodeTps - 400) < 60, `decode ${telemetry.live.decodeTps}`);
  assert.equal(telemetry.live.running, 4);
  assert.equal(telemetry.live.waiting, 1);
  assert.equal(telemetry.live.kvPercent, 4);
  assert(Math.abs(telemetry.live.ttftMs - 346) < 1, `ttft ${telemetry.live.ttftMs}`);
  assert.equal(telemetry.peaks.running, 4);
  assert.equal(telemetry.engines.find((e) => e.models.includes("alpha")).kind, "vllm");
  assert.deepEqual(
    telemetry.gpus.map((g) => [g.index, g.powerW, g.powerLimitW, g.temperatureC]),
    [[0, 275.4, 275, 65], [1, 276, 275, 48]],
  );
  assert.equal(telemetry.history.decode.values.length, 288);
  assert(telemetry.history.days.at(-1).prompt > telemetry.history.days.at(-1).generation);
  assert.equal((await (await call(c, "/api/telemetry")).json()).live.decodeTps, null);
  assert.equal((await call(a, "/api/recipes/captured/run", {})).status, 409);
  assert.equal((await call(a, "/api/peers", "{")).status, 400);
  assert.equal((await call(a, "/api/peers", { url: `http://127.0.0.1:${a}` })).status, 400);
  assert.equal((await call(a, "/v1/completions", { model: "not-live" })).status, 404);
  const raw =
    '{ "model": "alpha", "stream": true, "messages": [{"role":"user","content":"native"}], "extra_body": {"nested":[1,2,3]} }';
  const streamed = await call(a, "/v1/chat/completions", raw, {
    ...auth,
    "x-api-key": "client-secret",
    cookie: "private=value",
    "anthropic-version": "2023-06-01",
  });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers.get("x-engine-stream"), "native");
  assert.equal(await streamed.text(), stream);
  assert.equal(received.at(-1).raw, raw);
  assert.equal(received.at(-1).headers.authorization, "Bearer fixture-engine-secret");
  assert.equal(received.at(-1).headers["x-api-key"], undefined);
  assert.equal(received.at(-1).headers.cookie, undefined);
  assert.equal(received.at(-1).headers["anthropic-version"], "2023-06-01");
  const nativeError = await call(c, "/v1/messages", { model: "beta", messages: [] });
  assert.equal(nativeError.status, 422);
  assert.equal(nativeError.headers.get("x-engine-error"), "native");
  assert.equal(await nativeError.text(), '{"error":{"type":"native_fixture_error"}}');
  for (const path of ["/v1/responses", "/v1/completions", "/v1/chat/completions"]) {
    const r = await call(c, path, { model: "beta", input: "native" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { model: "beta", fixture: true, path });
  }
  await waitFor(
    async () => (await snapshot(a)).auto === "beta",
    "auto follows most-used live model",
  );
  const auto = await call(a, "/v1/responses", { model: "auto", input: "route" });
  assert.equal((await auto.json()).model, "beta");
  await waitFor(
    async () => (await snapshot(a)).models.find((m) => m.id === "beta")?.requests === 4,
    "usage counts once across graph",
  );
  assert.equal((await snapshot(b)).usage.find((u) => u.model === "beta").requests, 4);
  const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const cases = [
    [
      "completions",
      false,
      JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } }),
      16,
    ],
    [
      "chat/completions",
      true,
      event({ choices: [{ delta: { content: "π" } }], usage: null }) +
        event({ usage: { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 } }) +
        "data: [DONE]\r\n\r\n",
      20,
    ],
    [
      "responses",
      true,
      event({
        type: "response.completed",
        response: { usage: { input_tokens: 19, output_tokens: 7, total_tokens: 26 } },
      }),
      26,
    ],
    [
      "messages",
      false,
      JSON.stringify({
        usage: {
          input_tokens: 2,
          output_tokens: 3,
          cache_read_input_tokens: 31,
          cache_creation_input_tokens: 7,
        },
      }),
      43,
    ],
    [
      "messages",
      true,
      event({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 5,
            output_tokens: 1,
            cache_read_input_tokens: 37,
            cache_creation_input_tokens: 11,
          },
        },
      }) +
        event({ type: "message_delta", usage: { output_tokens: 3 } }) +
        event({
          type: "message_delta",
          usage: { output_tokens: 13, cache_read_input_tokens: 37 },
        }) +
        event({ type: "message_stop" }),
      66,
    ],
    [
      "responses",
      false,
      JSON.stringify({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }),
      0,
    ],
    ["chat/completions", true, event({ usage: { prompt_tokens: 3, completion_tokens: 4 } }), null],
    [
      "messages",
      true,
      event({ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } }) +
        event({ type: "error", error: { type: "overloaded_error" } }) +
        event({ type: "message_stop" }),
      null,
    ],
  ];
  for (const [path, stream, fixtureResponse, expected] of cases) {
    const before = (await (await call(b, "/api/node")).json()).usage.find(
      (u) => u.model === "beta",
    );
    const response = await call(c, `/v1/${path}`, { model: "beta", stream, fixtureResponse });
    assert.equal(await response.text(), fixtureResponse);
    const after = (await (await call(b, "/api/node")).json()).usage.find((u) => u.model === "beta");
    const sum = (row) => Object.values(row.tokens ?? {}).reduce((a, b) => a + b, 0);
    assert.equal(sum(after) - sum(before), expected ?? 0, path);
    assert.equal(
      after.measuredRequests - (before.measuredRequests ?? 0),
      Number(expected !== null),
      path,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "controller-1/usage.json"))).beta.tokens,
      after.tokens,
    );
  }
  await waitFor(
    async () => (await snapshot(a)).usage.find((u) => u.model === "beta")?.measuredRequests === 6,
    "federated measured usage",
  );
  const tracked = (await snapshot(a)).usage;
  assert.equal(
    Object.values(tracked.find((u) => u.model === "beta").tokens).reduce((a, b) => a + b, 0),
    171,
  );
  assert.equal(tracked.find((u) => u.model === "legacy").requests, 21);
  assert.equal(tracked.find((u) => u.model === "legacy").measuredRequests, 0);
  await new Promise((resolve) =>
    servers.find((server) => server.address()?.port === engineB).close(resolve),
  );
  await waitFor(
    async () => (await snapshot(a)).auto === "alpha",
    "auto excludes offline most-used model",
  );
  const models = await (await call(a, "/v1/models")).json();
  assert(models.data.some((m) => m.id === "auto"));
  assert(!models.data.some((m) => m.id === "beta"));
  console.log(
    "PASS E2E: authentication, discovery, multi-API models, cyclic federation, native streams/errors, credential isolation, registry launch guard, auto, usage and engine/GPU telemetry.",
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) => (child.exitCode === null ? once(child, "exit") : undefined)),
  );
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  rmSync(root, { recursive: true, force: true });
}
