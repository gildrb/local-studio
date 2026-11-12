import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { LOCAL_STUDIO_CONTROLLER_HEADER, type LocalEndpoint } from "./contracts.ts";
import { exec, fetchJson, now } from "./core.ts";

export interface Endpoint extends LocalEndpoint {
  base: string;
}

interface Listener {
  host: string;
  port: number;
  pid: number | null;
}

type Outcome =
  | { kind: "models"; models: string[]; ms: number }
  | { kind: "empty"; ms: number }
  | { kind: "failed"; error: string }
  | { kind: "foreign" };

const decodeModels = Schema.decodeUnknownOption(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }));
const NEGATIVE_MS = 5 * 60_000;
const FORGET_MS = 10 * 60_000;
const NEW_PROBE_MS = 1_500;
const KNOWN_PROBE_MS = 10_000;
export const MISSES = 3;

const listener = (addr: string, pid: number | null): Listener[] => {
  const i = addr.lastIndexOf(":");
  const a = addr.slice(0, i).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const host = ["*", "0.0.0.0", "::", "::1"].includes(a) ? "127.0.0.1" : /^\d+\.\d+\.\d+\.\d+$/.test(a) ? a : null;
  const port = Number(addr.slice(i + 1));
  return host && Number.isInteger(port) && port > 0 ? [{ host, port, pid }] : [];
};

const parseSs = (out: string): Listener[] =>
  out.split("\n").flatMap((line) => {
    const local = line.trim().split(/\s+/)[3];
    const pid = /pid=(\d+)/.exec(line)?.[1];
    return local ? listener(local, pid ? Number(pid) : null) : [];
  });

const parseLsof = (out: string): Listener[] => {
  let pid: number | null = null;
  return out.split("\n").flatMap((line) => {
    if (line[0] === "p") pid = Number(line.slice(1));
    return line[0] === "n" ? listener(line.slice(1), pid) : [];
  });
};

export const listeners: Effect.Effect<Listener[] | null> = Effect.gen(function* () {
  const linux = process.platform === "linux";
  const r = linux ? yield* exec(["ss", "-H", "-ltnp"], 5_000) : yield* exec(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], 8_000);
  const raw = linux ? parseSs(r.stdout) : parseLsof(r.stdout);
  if (r.code !== 0 || !raw.length) return null;
  const seen = new Map<number, Listener>();
  for (const l of raw) {
    const prev = seen.get(l.port);
    if (!prev || (prev.host !== "127.0.0.1" && l.host === "127.0.0.1")) seen.set(l.port, l);
  }
  return [...seen.values()].sort((a, b) => a.port - b.port).slice(0, 512);
});

export const makeScanner = (controllerId: string, jobPort: (port: number) => string | null) => {
  const negative = new Map<string, number>();
  const known = new Map<number, Endpoint>();
  const current = () => [...known.values()].sort((a, b) => a.port - b.port);

  const ask = (l: Listener, key: string | undefined, timeout: number): Effect.Effect<Outcome> =>
    Effect.gen(function* () {
      const started = Date.now();
      const r = yield* Effect.result(fetchJson(`http://${l.host}:${l.port}/v1/models`, timeout, key ? { authorization: `Bearer ${key}` } : {}));
      if (r._tag === "Failure") {
        const timedOut = /abort|timeout|timed out/i.test(r.failure);
        return { kind: "failed", error: timedOut ? `no answer to /v1/models within ${timeout / 1000} s` : r.failure };
      }
      const got = r.success;
      const ms = Date.now() - started;
      if (got.headers.get(LOCAL_STUDIO_CONTROLLER_HEADER)) return { kind: "foreign" };
      if (got.status === 401 || got.status === 403) return { kind: "failed", error: `HTTP ${got.status}: set this port's key in engineKeys` };
      if (got.status === 408 || got.status === 429 || got.status >= 500) return { kind: "failed", error: `HTTP ${got.status} from /v1/models` };
      const list = got.status === 200 ? decodeModels(got.body) : null;
      if (!list || list._tag === "None") return { kind: "foreign" };
      const models = [...new Set(list.value.data.map((m) => m.id))].sort();
      return models.length ? { kind: "models", models, ms } : { kind: "empty", ms };
    });

  const probe = (l: Listener, keys: Record<string, string>) =>
    Effect.gen(function* () {
      const prev = known.get(l.port);
      const tag = `${l.port}:${l.pid ?? ""}`;
      if (!prev && (negative.get(tag) ?? 0) > Date.now()) return;
      const outcome = yield* ask(l, keys[String(l.port)], prev ? KNOWN_PROBE_MS : NEW_PROBE_MS);
      const at = now();
      const base = { id: `${controllerId}:${l.port}`, controllerId, port: l.port, pid: l.pid, jobId: jobPort(l.port), base: `http://${l.host}:${l.port}`, checkedAt: at };
      if (outcome.kind === "models") {
        known.set(l.port, { ...base, models: outcome.models, live: true, state: "loaded", lastSeenAt: at, failures: 0, error: null, latencyMs: outcome.ms });
        return;
      }
      if (outcome.kind === "empty") {
        known.set(l.port, { ...base, models: [], live: false, state: "empty", lastSeenAt: at, failures: 0, error: null, latencyMs: outcome.ms });
        return;
      }
      if (!prev) {
        if (outcome.kind === "foreign" && !jobPort(l.port)) negative.set(tag, Date.now() + NEGATIVE_MS);
        return;
      }
      const error = outcome.kind === "failed" ? outcome.error : "answers, but not as an OpenAI-compatible server";
      const failures = (prev.failures ?? 0) + 1;
      const loaded = prev.state !== "unreachable" && prev.state !== "empty" && prev.models.length > 0 && failures < MISSES;
      known.set(l.port, { ...prev, ...base, live: loaded, state: loaded ? "loaded" : "unreachable", failures, error, latencyMs: prev.latencyMs ?? null });
    });

  return {
    current,
    scan: (exclude: Set<number>, keys: Record<string, string>) =>
      Effect.gen(function* () {
        const all = yield* listeners;
        if (!all) return;
        const ls = all.filter((l) => !exclude.has(l.port));
        const listening = new Set(ls.map((l) => l.port));
        yield* Effect.forEach(ls, (l) => probe(l, keys), { concurrency: 24, discard: true });
        for (const [p, ep] of known) {
          if (!listening.has(p)) known.delete(p);
          else if (ep.state === "unreachable" && Date.now() - Date.parse(ep.lastSeenAt ?? "0") > FORGET_MS) known.delete(p);
        }
      }),
  };
};
