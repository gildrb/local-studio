import type { ServerWebSocket } from "bun";

type Json = Record<string, unknown>;

function flag(name: string, fallback?: string): string | undefined {
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : fallback;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const port = Number(flag("port", "18094"));
const pairId = flag("pair-id", Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex"))!;
const pairSecret = flag("pair-secret", base64url(crypto.getRandomValues(new Uint8Array(32))))!;
const machineName = flag("name", "fake-studio")!;
const streamMs = Number(flag("stream-ms", "400"));
const newest = Number(flag("protocol", "2"));
const oldest = Number(flag("min-protocol", String(newest)));
const windowLimit = 200;
const pageLimit = 500;
const pendingLimit = 64;
const busyOnceAfter = Number(flag("busy-once-after", "-1"));
const smokeHooks = Bun.argv.includes("--smoke-hooks");
let lastResume = "";
let hellos = 0;
const bufferLimit = 2000;
const bufferMs = 10 * 60 * 1000;
const maxChunk = 65_535 - 16 - 1;
const maxFrame = 8 * 1024 * 1024;
const prologue = "local-studio-remote/1\n";

const socketURL = `ws://127.0.0.1:${port}/v1/ws`;
const epoch = Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString("hex");
const machineKey = crypto.getRandomValues(new Uint8Array(32));
const machine = { id: "fake-machine", name: machineName, os: "macos", version: "0.0.0-fake", channel: "dev", urls: [socketURL] };
const base = 1_763_000_000_000;
const pairingExpires = Date.now() + 10 * 60 * 1000;

type Phase = "header" | "pair" | "known" | "session";

type Device = {
  id: string;
  name: string;
  publicKey: string;
  seq: number;
  buffer: { seq: number; at: number; body: Json }[];
  watched: Set<string>;
  ws?: ServerWebSocket<Conn>;
};

type Conn = {
  phase: Phase;
  ready: boolean;
  prologue: string;
  protocol: number;
  device?: Device;
  chunks: Buffer[];
};

type Item = { id: number; turn: number; createdAt: number | null; kind: Json };

const devices = new Map<string, Device>();
let secretBurned = false;
const accepted = new Set<string>();
let sendCount = 0;
const approvalWaiters = new Map<string, (answer: string) => void>();
const busy = new Set<string>();
let nextItem = 1;
let nextApproval = 1;
let nextQueued = 1;
let nextThread = 4;
let clock = 0;

function now(): number {
  clock += 1000;
  return base + 10_000_000 + clock;
}

const projects = [{ id: "p1", name: "demo", path: "/tmp/fake-studio/demo", icon: null, isGit: true }];

function row(id: string, title: string, shelf: string, status: string, updatedAt: number): Json {
  return {
    id,
    project: "p1",
    title,
    shelf,
    status,
    statusSince: updatedAt,
    updatedAt,
    snoozedUntil: null,
    pinned: false,
    unread: false,
    branch: "main",
    worktree: null,
    provider: "anthropic",
    model: "claude-haiku-5-5",
    additions: 0,
    deletions: 0,
    note: null,
    archived: false,
    autoSettle: true,
    liveAgents: 0,
    fanOut: null,
    pullRequest: null,
  };
}

function info(id: string): Json {
  const thread = threads.get(id)!;
  return {
    thread: id,
    project: thread.project,
    title: thread.title,
    cwd: "/tmp/fake-studio/demo",
    model: { provider: "anthropic", id: "claude-haiku-5-5", name: "Claude Haiku 5.5", reasoning: true },
    thinkingLevel: "low",
    thinkingLevels: ["off", "low", "medium", "high"],
    access: "supervised",
    busy: busy.has(id),
    runStartedAt: busy.has(id) ? thread.statusSince : null,
    compacting: false,
    retryAttempt: 0,
    queued: (queues.get(id) ?? []).length,
    context: { tokens: 1200, window: 200000 },
    branch: "main",
    worktree: null,
    serviceTier: null,
    serviceTiers: [],
    goal: null,
  };
}

function user(text: string, turn: number): Item {
  return { id: nextItem++, turn, createdAt: now(), kind: { type: "user", text, images: 0, entry: `e${nextItem}`, thumbnails: [] } };
}

function assistant(text: string, turn: number, streaming = false): Item {
  return {
    id: nextItem++,
    turn,
    createdAt: now(),
    kind: { type: "assistant", blocks: [{ type: "text", text }], streaming, error: null, changedFiles: [] },
  };
}

function summary(turn: number, toolCount: number): Item {
  return { id: nextItem++, turn, createdAt: now(), kind: { type: "turn_summary", turn, durationMs: 1200, toolCount } };
}

const threads = new Map<string, Json & { title: string; project: string; statusSince: number }>();
const transcripts = new Map<string, Item[]>();
const approvals = new Map<string, Json[]>();
const queues = new Map<string, { id: string; text: string; steering: boolean; sending: boolean; request: string }[]>();

const filler = "This line pads the long thread so one reset spans several records. ".repeat(6).trim();

function seed(): void {
  threads.set("t1", row("t1", "Welcome to the fake studio", "active", "idle", base + 3_000_000) as never);
  transcripts.set("t1", [user("Hello there", 1), assistant("Hi. This is the fake studio talking.", 1), summary(1, 0)]);
  const long: Item[] = [];
  for (let turn = 1; turn <= 130; turn++) {
    long.push(user(`Message ${turn}`, turn));
    long.push(assistant(`Answer ${turn}. ${filler}`, turn));
  }
  threads.set("t2", row("t2", "Long transcript", "active", "done", base + 2_000_000) as never);
  transcripts.set("t2", long);
  threads.set("t3", row("t3", "Settled work", "settled", "done", base + 1_000_000) as never);
  transcripts.set("t3", [user("Old task", 1), assistant("Finished long ago.", 1)]);
}

seed();

function threadList(): Json[] {
  return [...threads.values()].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

function models(): Json {
  return {
    type: "models",
    models: [
      {
        provider: "anthropic",
        id: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        reasoning: true,
        thinkingLevels: ["off", "low", "medium", "high"],
        contextWindow: 200000,
        configured: true,
        serviceTiers: [],
      },
    ],
    favorites: [{ provider: "anthropic", model: "claude-haiku-5-5" }],
    hidden: [],
  };
}

function send(ws: ServerWebSocket<Conn>, frame: Json): void {
  const json = Buffer.from(JSON.stringify(frame));
  for (let offset = 0; offset < json.length || offset === 0; offset += maxChunk) {
    const chunk = json.subarray(offset, offset + maxChunk);
    const final = offset + maxChunk >= json.length;
    ws.sendBinary(Buffer.concat([Buffer.from([final ? 0x01 : 0x02]), chunk]));
    if (final) break;
  }
}

function update(device: Device, body: Json): void {
  device.seq += 1;
  const at = Date.now();
  device.buffer.push({ seq: device.seq, at, body });
  while (device.buffer.length > bufferLimit || (device.buffer.length > 0 && at - device.buffer[0].at > bufferMs)) {
    device.buffer.shift();
  }
  if (device.ws?.data.ready) {
    send(device.ws, { op: "update", seq: device.seq, update: body });
  }
}

function broadcast(body: Json): void {
  for (const device of devices.values()) {
    update(device, body);
  }
}

function toWatchers(thread: string, body: (device: Device) => Json): void {
  for (const device of devices.values()) {
    if (device.watched.has(thread)) {
      update(device, body(device));
    }
  }
}

function reset(device: Device, thread: string): Json {
  const items = transcripts.get(thread) ?? [];
  const start = Math.max(0, items.length - windowLimit);
  return { type: "transcript", thread, op: { type: "reset", items: items.slice(start), earlier: start } };
}

function pushThread(device: Device, thread: string): void {
  update(device, { type: "thread", thread, info: info(thread) });
  update(device, reset(device, thread));
  update(device, { type: "approvals", thread, approvals: approvals.get(thread) ?? [] });
  update(device, { type: "queue", thread, queued: publicQueue(thread) });
}

function publicQueue(thread: string): Json[] {
  return (queues.get(thread) ?? []).map(({ id, text, steering, sending }) => ({ id, text, steering, sending }));
}

function insert(thread: string, item: Item): number {
  const items = transcripts.get(thread)!;
  items.push(item);
  const index = items.length - 1;
  toWatchers(thread, () => ({ type: "transcript", thread, op: { type: "insert", index, item } }));
  return index;
}

function replace(thread: string, index: number, item: Item): void {
  transcripts.get(thread)![index] = item;
  toWatchers(thread, () => ({ type: "transcript", thread, op: { type: "update", index, item } }));
}

function setStatus(thread: string, status: string, unread = false): void {
  const current = threads.get(thread)!;
  const stamp = now();
  threads.set(thread, { ...current, status, statusSince: stamp, updatedAt: stamp, unread });
  broadcast({ type: "threads", threads: threadList() });
  toWatchers(thread, () => ({ type: "thread", thread, info: info(thread) }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stream(thread: string, text: string, turn: number): Promise<void> {
  const item = assistant("", turn, true);
  const index = insert(thread, item);
  const steps = 8;
  for (let step = 1; step <= steps; step++) {
    await sleep(streamMs / steps);
    const done = step === steps;
    const partial = text.slice(0, Math.ceil((text.length * step) / steps));
    replace(thread, index, { ...item, kind: { ...item.kind, blocks: [{ type: "text", text: partial }], streaming: !done } });
  }
}

async function runTurn(thread: string, text: string, request: string): Promise<void> {
  busy.add(thread);
  const turn = (transcripts.get(thread)!.at(-1)?.turn ?? 0) + 1;
  insert(thread, user(text, turn));
  setStatus(thread, "working");
  await stream(thread, `Streaming reply to: ${text}`, turn);

  const callId = `call${turn}`;
  const startedAt = now();
  const tool: Item = {
    id: nextItem++,
    turn,
    createdAt: startedAt,
    kind: {
      type: "tool",
      callId,
      name: "bash",
      kind: "command",
      summary: "echo smoke",
      arguments: JSON.stringify({ command: "echo smoke" }),
      state: "pending",
      output: "",
      fileChange: null,
      startedAt,
      endedAt: null,
    },
  };
  const toolIndex = insert(thread, tool);
  const requestId = `a${nextApproval++}`;
  approvals.set(thread, [{ requestId, step: turn, command: "echo smoke", effects: ["runs a shell command"], agent: null }]);
  toWatchers(thread, () => ({ type: "approvals", thread, approvals: approvals.get(thread)! }));
  setStatus(thread, "approval");
  const title = String(threads.get(thread)!.title);
  broadcast({ type: "notification", thread, kind: "needs_approval", title, body: "echo smoke" });

  const answer = await new Promise<string>((resolve) => approvalWaiters.set(requestId, resolve));
  approvals.set(thread, []);
  toWatchers(thread, () => ({ type: "approvals", thread, approvals: [] }));
  setStatus(thread, "working");
  const approved = answer !== "deny";
  broadcast({ type: "notification", thread, kind: "needs_answer", title, body: "a question for the phone" });
  if (approved) {
    replace(thread, toolIndex, { ...tool, kind: { ...tool.kind, state: "running" } });
    await sleep(100);
    replace(thread, toolIndex, { ...tool, kind: { ...tool.kind, state: "succeeded", output: "smoke\n", endedAt: now() } });
    await stream(thread, "Command finished. All done.", turn);
  } else {
    replace(thread, toolIndex, { ...tool, kind: { ...tool.kind, state: "failed", output: "denied by user", endedAt: now() } });
    await stream(thread, "The command was denied.", turn);
  }
  insert(thread, summary(turn, 1));
  busy.delete(thread);
  setStatus(thread, approved ? "done" : "failed", true);
  broadcast({ type: "notification", thread, kind: approved ? "turn_done" : "failed", title, body: approved ? "Turn finished" : "Command denied" });
  broadcast({ type: "request_done", request, message: "done" });

  const next = queues.get(thread)?.shift();
  if (next) {
    toWatchers(thread, () => ({ type: "queue", thread, queued: publicQueue(thread) }));
    void runTurn(thread, next.text, next.request);
  }
}

function enqueue(thread: string, text: string, request: string, steering: boolean): void {
  const list = queues.get(thread) ?? [];
  list.push({ id: `q${nextQueued++}`, text, steering, sending: false, request });
  queues.set(thread, list);
  toWatchers(thread, () => ({ type: "queue", thread, queued: publicQueue(thread) }));
  toWatchers(thread, () => ({ type: "thread", thread, info: info(thread) }));
}

type Failure = { code: string; message: string };
type Answer = { result: Json };
type Duplicate = { duplicate: true };
type Handler = (device: Device, args: Json) => Failure | Answer | Duplicate | string | undefined;

function pendingPrompts(): number {
  let total = 0;
  for (const list of queues.values()) total += list.length;
  return total;
}

function busyFailure(): Failure | undefined {
  if (pendingPrompts() >= pendingLimit) {
    return { code: "busy", message: `the machine holds ${pendingLimit} prompts it hasn't taken` };
  }
  return undefined;
}

const handlers: Record<string, Handler> = {
  ping() {
    return undefined;
  },
  watch(device, args) {
    const thread = String(args.thread);
    if (!threads.has(thread)) return "unknown thread";
    device.watched.add(thread);
    queueMicrotask(() => pushThread(device, thread));
    return undefined;
  },
  unwatch(device, args) {
    device.watched.delete(String(args.thread));
    return undefined;
  },
  send(_ws, args) {
    const thread = String(args.thread);
    const request = String(args.request);
    const prompt = args.prompt as { text?: string } | undefined;
    if (!threads.has(thread)) return "unknown thread";
    if (typeof prompt?.text !== "string") return "missing prompt";
    if (accepted.has(request)) return { duplicate: true };
    sendCount += 1;
    if (sendCount === busyOnceAfter + 1) {
      console.log(`answered busy once to ${request}`);
      return { code: "busy", message: "the fake answers busy once (--busy-once-after)" };
    }
    const full = busyFailure();
    if (full) return full;
    accepted.add(request);
    if (busy.has(thread)) {
      enqueue(thread, prompt.text, request, args.delivery === "steer");
    } else {
      queueMicrotask(() => void runTurn(thread, String(prompt.text), request));
    }
    return undefined;
  },
  answer_approval(_ws, args) {
    const waiter = approvalWaiters.get(String(args.request));
    if (!waiter) return "no such approval";
    approvalWaiters.delete(String(args.request));
    waiter(String(args.answer));
    return undefined;
  },
  load_earlier(_device, args) {
    const thread = String(args.thread);
    const items = transcripts.get(thread);
    if (!items) return "unknown thread";
    const before = Math.min(Number(args.before), items.length);
    const limit = Math.min(Number(args.limit ?? 100), pageLimit);
    const start = Math.max(0, before - limit);
    return { result: { thread, start, items: items.slice(start, before) } };
  },
  send_queued_now(_ws, args) {
    const thread = String(args.thread);
    const list = queues.get(thread) ?? [];
    const index = list.findIndex((entry) => entry.id === args.queued);
    if (index < 0) return "no such queued message";
    const [entry] = list.splice(index, 1);
    if (busy.has(thread)) {
      list.unshift(entry);
    } else {
      queueMicrotask(() => void runTurn(thread, entry.text, entry.request));
    }
    toWatchers(thread, () => ({ type: "queue", thread, queued: publicQueue(thread) }));
    return undefined;
  },
  remove_queued(_ws, args) {
    const thread = String(args.thread);
    queues.set(thread, (queues.get(thread) ?? []).filter((entry) => entry.id !== args.queued));
    toWatchers(thread, () => ({ type: "queue", thread, queued: publicQueue(thread) }));
    return undefined;
  },
  abort(_ws, args) {
    const pending = approvals.get(String(args.thread)) ?? [];
    for (const approval of pending) {
      const id = String(approval.requestId);
      approvalWaiters.get(id)?.("deny");
      approvalWaiters.delete(id);
    }
    return undefined;
  },
  start_thread(_ws, args) {
    const full = busyFailure();
    if (full) return full;
    const prompt = args.prompt as { text?: string } | undefined;
    const text = prompt?.text ?? "";
    const id = `t${nextThread++}`;
    threads.set(id, row(id, text.slice(0, 40) || "New thread", "active", "idle", now()) as never);
    transcripts.set(id, []);
    queueMicrotask(() => {
      broadcast({ type: "thread_started", draft: String(args.draft), thread: id });
      broadcast({ type: "threads", threads: threadList() });
      void runTurn(id, text, String(args.draft));
    });
    return undefined;
  },
};

function fail(ws: ServerWebSocket<Conn>, code: number, reason: string): void {
  console.log(`refused: ${reason}`);
  ws.close(code, reason);
}

function header(ws: ServerWebSocket<Conn>, raw: string | Buffer): void {
  if (typeof raw !== "string") return fail(ws, 1002, "the opening header must be text");
  let frame: Json;
  try {
    frame = JSON.parse(raw);
  } catch {
    return fail(ws, 1002, "bad opening header");
  }
  const clientNewest = Number(frame.protocol);
  const clientOldest = Number(frame.min_protocol ?? frame.protocol);
  if (frame.v !== 1 || !(clientOldest <= newest && oldest <= clientNewest)) {
    ws.sendText(JSON.stringify({ op: "incompatible", protocol: newest, min_protocol: oldest }));
    ws.close(1002, "incompatible protocol");
    return;
  }
  ws.data.prologue = prologue + raw;
  ws.data.protocol = Math.min(newest, clientNewest);
  if (frame.pattern === "XXpsk3") {
    if (secretBurned || frame.pair !== pairId || Date.now() > pairingExpires) return fail(ws, 4401, "unknown or used pairing id");
    ws.data.phase = "pair";
    return;
  }
  if (frame.pattern === "KK") {
    const device = devices.get(String(frame.device));
    if (!device) return fail(ws, 4401, "unknown device");
    ws.data.device = device;
    ws.data.phase = "known";
    return;
  }
  fail(ws, 1002, "unknown pattern");
}

function handshake(ws: ServerWebSocket<Conn>, raw: string | Buffer): void {
  if (typeof raw === "string") return fail(ws, 1002, "text during the handshake");
  if (ws.data.phase === "pair") {
    if (raw.length === 32) {
      ws.sendBinary(Buffer.concat([Buffer.from(crypto.getRandomValues(new Uint8Array(32))), Buffer.from(machineKey)]));
      return;
    }
    if (raw.length < 33) return fail(ws, 1002, "short pairing message");
    let record: Json;
    try {
      record = JSON.parse(raw.subarray(32).toString("utf8"));
    } catch {
      return fail(ws, 1002, "bad device record");
    }
    const id = String(record.id ?? "");
    if (!id) return fail(ws, 1002, "device record without id");
    if (devices.has(id)) return fail(ws, 4401, "a device with this id is already paired");
    secretBurned = true;
    const device: Device = {
      id,
      name: String(record.name ?? "phone"),
      publicKey: raw.subarray(0, 32).toString("hex"),
      seq: 0,
      buffer: [],
      watched: new Set(),
    };
    devices.set(id, device);
    ws.data.device = device;
    ws.data.phase = "session";
    console.log(`paired ${device.name} (${id})`);
    return;
  }
  if (raw.length !== 32) return fail(ws, 1002, "bad KK message");
  ws.sendBinary(Buffer.from(crypto.getRandomValues(new Uint8Array(32))));
  ws.data.phase = "session";
}

function hello(ws: ServerWebSocket<Conn>, device: Device, frame: Json): void {
  const resume = (frame.resume as { seq?: number; epoch?: string; watch?: string[] } | undefined) ?? {};
  const watch = (resume.watch ?? []).filter((thread) => threads.has(thread));
  const oldestBuffered = device.buffer[0]?.seq ?? device.seq + 1;
  const delta =
    resume.epoch === epoch &&
    typeof resume.seq === "number" &&
    resume.seq <= device.seq &&
    resume.seq >= oldestBuffered - 1;
  lastResume = delta ? "delta" : "snapshot";
  console.log(`hello ${device.name} ${lastResume}`);
  hellos += 1;
  device.ws?.close(4409, "replaced by a newer socket");
  device.ws = ws;
  ws.data.ready = true;
  const before = new Set(device.watched);
  device.watched = new Set(watch);
  if (delta) {
    send(ws, { op: "hello", protocol: ws.data.protocol, epoch, machine, resume: "delta", seq: Number(resume.seq), snapshot: [] });
    for (const entry of device.buffer) {
      if (entry.seq > Number(resume.seq)) {
        send(ws, { op: "update", seq: entry.seq, update: entry.body });
      }
    }
    for (const thread of watch) {
      if (!before.has(thread)) pushThread(device, thread);
    }
    return;
  }
  send(ws, {
    op: "hello",
    protocol: ws.data.protocol,
    epoch,
    machine,
    resume: "snapshot",
    seq: device.seq,
    snapshot: [
      { type: "connection", state: { type: "ready" } },
      { type: "projects", projects },
      { type: "threads", threads: threadList() },
      models(),
    ],
  });
  for (const thread of watch) {
    pushThread(device, thread);
  }
}

function frame(ws: ServerWebSocket<Conn>, raw: string | Buffer): void {
  if (typeof raw === "string" || raw.length === 0) return fail(ws, 1002, "records are binary");
  const kind = raw[0];
  if (kind === 0x03) return;
  if (kind !== 0x01 && kind !== 0x02) return fail(ws, 1002, `unknown record ${kind}`);
  ws.data.chunks.push(raw.subarray(1));
  const size = ws.data.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (size > maxFrame) return fail(ws, 1002, "frame over 8 MiB");
  if (kind === 0x02) return;
  const joined = Buffer.concat(ws.data.chunks);
  ws.data.chunks = [];
  let request: Json;
  try {
    request = JSON.parse(joined.toString("utf8"));
  } catch {
    return fail(ws, 1002, "bad frame");
  }
  const device = ws.data.device!;
  if (request.op === "hello") return hello(ws, device, request);
  if (!ws.data.ready) return fail(ws, 1002, "hello first");
  const handler = handlers[String(request.op)];
  const result: Failure | Answer | Duplicate | string | undefined = handler
    ? handler(device, (request.args as Json) ?? {})
    : { code: "not_remote", message: `${String(request.op)} is not a remote op` };
  if (result === undefined) {
    send(ws, { re: request.id, ok: true });
  } else if (typeof result === "object" && "duplicate" in result) {
    send(ws, { re: request.id, ok: true, duplicate: true });
  } else if (typeof result === "object" && "result" in result) {
    send(ws, { re: request.id, ok: true, result: result.result });
  } else {
    send(ws, { re: request.id, error: typeof result === "string" ? { code: "failed", message: result } : result });
  }
}

function message(ws: ServerWebSocket<Conn>, raw: string | Buffer): void {
  switch (ws.data.phase) {
    case "header":
      return header(ws, raw);
    case "pair":
    case "known":
      return handshake(ws, raw);
    case "session":
      return frame(ws, raw);
  }
}

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const server = Bun.serve<Conn>({
  hostname: "127.0.0.1",
  port,
  fetch(request, server) {
    if (!allowedHosts.has(request.headers.get("host") ?? "")) {
      return new Response("host not allowed", { status: 403 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/v1/health") {
      return Response.json({ ok: true, protocol: newest, min_protocol: oldest });
    }
    if (smokeHooks && url.pathname === "/v1/smoke/away" && request.method === "POST") {
      const thread = url.searchParams.get("thread") ?? "t3";
      if (!threads.has(thread)) return new Response("unknown thread", { status: 404 });
      for (const device of devices.values()) {
        const socket = device.ws;
        device.ws = undefined;
        socket?.close(1001, "the fake drops the socket (--smoke-hooks)");
      }
      broadcast({ type: "notification", thread, kind: "needs_approval", title: String(threads.get(thread)!.title), body: "raised while the phone was away" });
      console.log(`raised needs_approval on ${thread} with no socket`);
      return Response.json({ ok: true });
    }
    if (smokeHooks && url.pathname === "/v1/smoke/last-resume") {
      return Response.json({ resume: lastResume });
    }
    if (smokeHooks && url.pathname === "/v1/smoke/hellos") {
      return Response.json({ hellos });
    }
    if (url.pathname !== "/v1/ws") {
      return new Response("not found", { status: 404 });
    }
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) {
      return new Response("origin not allowed", { status: 403 });
    }
    const data: Conn = { phase: "header", ready: false, prologue: "", protocol: newest, chunks: [] };
    return server.upgrade(request, { data }) ? undefined : new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    idleTimeout: 60,
    perMessageDeflate: false,
    message,
    close(ws) {
      if (ws.data.device?.ws === ws) {
        ws.data.device.ws = undefined;
      }
    },
  },
});

const link = `${flag("scheme", "localstudio-dev")}://pair?url=${encodeURIComponent(socketURL)}&name=${encodeURIComponent(machineName)}&id=${pairId}#${pairSecret}`;
console.log(`fake-studio listening on ${socketURL} as ${machineName}, protocol ${oldest} to ${newest}, epoch ${epoch}`);
console.log(`pairing link: ${link}`);
