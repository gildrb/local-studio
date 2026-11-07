import { freemem, totalmem } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { LocalJob, LocalTelemetry } from "./contracts.ts";
import { exec, home, now, readJson, writeJson } from "./core.ts";
import type { Endpoint } from "./discovery.ts";
import type { RawGpu } from "./hardware.ts";

const MINUTE = 60_000;
const DAY_LIMIT = 800;
const BUCKET_MINUTES = 5;
const BUCKETS = (24 * 60) / BUCKET_MINUTES;
const RATE_WINDOW_MS = 16_000;
const TTFT_WINDOW = 60;
const storePath = join(home, "telemetry.json");

type Kind = "vllm" | "sglang" | "llamacpp";

const NAMES = {
  generation: ["vllm:generation_tokens_total", "sglang:generation_tokens_total", "llamacpp:tokens_predicted_total"],
  prompt: ["vllm:prompt_tokens_total", "sglang:prompt_tokens_total", "llamacpp:prompt_tokens_total"],
  ttftSum: ["vllm:time_to_first_token_seconds_sum", "sglang:time_to_first_token_seconds_sum"],
  ttftCount: ["vllm:time_to_first_token_seconds_count", "sglang:time_to_first_token_seconds_count"],
  running: ["vllm:num_requests_running", "sglang:num_running_reqs", "llamacpp:requests_processing"],
  waiting: ["vllm:num_requests_waiting", "sglang:num_queue_reqs", "llamacpp:requests_deferred"],
  kv: ["vllm:kv_cache_usage_perc", "vllm:gpu_cache_usage_perc", "sglang:token_usage", "llamacpp:kv_cache_usage_ratio"],
} as const;

const Counters = Schema.Struct({ generation: Schema.Number, prompt: Schema.Number, ttftSum: Schema.Number, ttftCount: Schema.Number });
type Counters = typeof Counters.Type;
const Minute = Schema.Struct({ ...Counters.fields, t: Schema.Number, running: Schema.Number, kv: Schema.Number });
type Minute = { -readonly [K in keyof typeof Minute.Type]: (typeof Minute.Type)[K] };
const Store = Schema.Struct({
  minutes: Schema.Array(Minute),
  days: Schema.Record(Schema.String, Schema.Tuple([Schema.Number, Schema.Number])),
  counters: Schema.Record(Schema.String, Counters),
});

interface Reading {
  kind: Kind | null;
  counters: Counters | null;
  running: number | null;
  waiting: number | null;
  kv: number | null;
}

export const parseMetrics = (text: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_:][\w:]*)(?:\{.*\})?\s+(\S+)/.exec(line);
    const value = m ? Number(m[2]) : Number.NaN;
    if (m?.[1] && Number.isFinite(value)) out.set(m[1], (out.get(m[1]) ?? 0) + value);
  }
  return out;
};

const pick = (m: Map<string, number>, names: readonly string[]): number | null => {
  for (const n of names) {
    const v = m.get(n);
    if (v !== undefined) return v;
  }
  return null;
};

const reading = (m: Map<string, number>): Reading => {
  const generation = pick(m, NAMES.generation);
  const name = NAMES.generation.find((n) => m.has(n));
  const kv = pick(m, NAMES.kv);
  return {
    kind: name ? (name.split(":")[0] as Kind) : null,
    counters: generation === null ? null : { generation, prompt: pick(m, NAMES.prompt) ?? 0, ttftSum: pick(m, NAMES.ttftSum) ?? 0, ttftCount: pick(m, NAMES.ttftCount) ?? 0 },
    running: pick(m, NAMES.running),
    waiting: pick(m, NAMES.waiting),
    kv: kv === null ? null : kv * 100,
  };
};

const delta = (cur: number, prev: number): number => (cur >= prev ? cur - prev : cur);

const elapsedSeconds = (s: string): number | null => {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  return m ? ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4]) : null;
};

const scrape = (ep: Endpoint, key: string | undefined) =>
  Effect.tryPromise({
    try: async () => {
      const r = await fetch(`${ep.base}/metrics`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(2_500), redirect: "manual" });
      return r.ok ? reading(parseMetrics(await r.text())) : null;
    },
    catch: () => null,
  }).pipe(Effect.orElseSucceed(() => null));

export const makeTelemetry = () => {
  const stored = readJson(storePath, Store, { minutes: [], days: {}, counters: {} });
  const minutes: Minute[] = stored.minutes.map((m) => ({ ...m }));
  const days = new Map<string, [number, number]>(Object.entries(stored.days).map(([d, v]) => [d, [v[0], v[1]]]));
  const counters = new Map<string, Counters>(Object.entries(stored.counters));
  const recent = new Map<string, { at: number; generation: number }[]>();
  const loaded = new Map<string, string | null>();
  let current: Minute | null = null;
  let live: { engines: { ep: Endpoint; reading: Reading | null }[]; decode: number | null } = { engines: [], decode: null };

  const persist = () => {
    try {
      const sorted = [...days].sort(([a], [b]) => a.localeCompare(b)).slice(-DAY_LIMIT);
      writeJson(storePath, { minutes, days: Object.fromEntries(sorted), counters: Object.fromEntries(counters) });
    } catch (error) {
      console.error("Telemetry persistence failed", String(error));
    }
  };

  const roll = (at: number) => {
    const t = Math.floor(at / MINUTE) * MINUTE;
    if (current && current.t === t) return current;
    if (current) {
      minutes.push(current);
      while (minutes.length && (minutes[0]?.t ?? 0) <= t - 24 * 60 * MINUTE) minutes.shift();
      persist();
    }
    current = { t, generation: 0, prompt: 0, ttftSum: 0, ttftCount: 0, running: 0, kv: 0 };
    return current;
  };

  const loadedAt = (ep: Endpoint, jobs: readonly LocalJob[]) =>
    Effect.gen(function* () {
      const key = `${ep.port}:${ep.pid ?? ""}`;
      const job = jobs.find((j) => j.id === ep.jobId);
      if (job) return job.startedAt;
      if (loaded.has(key)) return loaded.get(key) ?? null;
      const seconds = ep.pid ? elapsedSeconds((yield* exec(["ps", "-o", "etime=", "-p", String(ep.pid)], 3_000)).stdout) : null;
      const at = seconds === null ? null : new Date(Date.now() - seconds * 1000).toISOString();
      loaded.set(key, at);
      return at;
    });

  const sample = (endpoints: readonly Endpoint[], keys: Record<string, string>) =>
    Effect.gen(function* () {
      const eps = endpoints.filter((e) => e.live);
      const readings = yield* Effect.forEach(eps, (ep) => scrape(ep, keys[String(ep.port)]), { concurrency: 8 });
      const at = Date.now();
      const minute = roll(at);
      const day = new Date(at).toISOString().slice(0, 10);
      let decode: number | null = null;
      const seen = new Set<string>();
      for (const [i, ep] of eps.entries()) {
        const r = readings[i];
        if (!r) continue;
        if (r.kv !== null) minute.kv = Math.max(minute.kv, r.kv);
        if (!r.counters) continue;
        const key = `${ep.port}:${ep.pid ?? ""}`;
        seen.add(key);
        const prev = counters.get(key);
        counters.set(key, r.counters);
        if (prev) {
          const d = {
            generation: delta(r.counters.generation, prev.generation),
            prompt: delta(r.counters.prompt, prev.prompt),
            ttftSum: delta(r.counters.ttftSum, prev.ttftSum),
            ttftCount: delta(r.counters.ttftCount, prev.ttftCount),
          };
          minute.generation += d.generation;
          minute.prompt += d.prompt;
          minute.ttftSum += d.ttftSum;
          minute.ttftCount += d.ttftCount;
          const today = days.get(day) ?? [0, 0];
          days.set(day, [today[0] + d.prompt, today[1] + d.generation]);
        }
        const history = [...(recent.get(key) ?? []), { at, generation: r.counters.generation }].filter((s) => at - s.at <= RATE_WINDOW_MS);
        recent.set(key, history);
        const first = history[0];
        decode = (decode ?? 0) + (first && at > first.at && r.counters.generation >= first.generation ? ((r.counters.generation - first.generation) * 1000) / (at - first.at) : 0);
      }
      const running = readings.reduce<number | null>((sum, r) => (r?.running == null ? sum : (sum ?? 0) + r.running), null);
      if (running !== null) minute.running = Math.max(minute.running, running);
      for (const key of counters.keys()) if (!seen.has(key) && !eps.some((e) => key.startsWith(`${e.port}:`))) counters.delete(key);
      for (const key of recent.keys()) if (!seen.has(key)) recent.delete(key);
      live = { engines: eps.map((ep, i) => ({ ep, reading: readings[i] ?? null })), decode };
    });

  const view = (gpus: readonly RawGpu[], jobs: readonly LocalJob[], history: boolean) =>
    Effect.gen(function* () {
      const at = Date.now();
      const window = [...minutes.filter((m) => m.t > at - 24 * 60 * MINUTE), ...(current ? [current] : [])];
      const readings = live.engines.map((e) => e.reading).filter((r): r is Reading => r !== null);
      const sum = (f: (r: Reading) => number | null) => readings.reduce<number | null>((s, r) => (f(r) === null ? s : (s ?? 0) + (f(r) ?? 0)), null);
      const kvNow = readings.reduce<number | null>((s, r) => (r.kv === null ? s : Math.max(s ?? 0, r.kv)), null);
      const ttft = (ms: Minute[]) => {
        const count = ms.reduce((s, m) => s + m.ttftCount, 0);
        return count > 0 ? (ms.reduce((s, m) => s + m.ttftSum, 0) / count) * 1000 : null;
      };
      const best = window.filter((m) => m.ttftCount > 0).map((m) => (m.ttftSum / m.ttftCount) * 1000);
      const metrics = readings.length > 0;
      const engines = yield* Effect.forEach(live.engines, ({ ep, reading: r }) =>
        Effect.map(loadedAt(ep, jobs), (loadedAt) => ({ port: ep.port, models: [...ep.models], kind: r?.kind ?? null, loadedAt })),
      );
      const out: LocalTelemetry = {
        generatedAt: now(),
        engines,
        live: {
          decodeTps: live.decode,
          running: sum((r) => r.running),
          waiting: sum((r) => r.waiting),
          kvPercent: kvNow,
          ttftMs: ttft(window.filter((m) => m.t > at - TTFT_WINDOW * MINUTE)) ?? ttft(window),
        },
        peaks: {
          running: metrics ? Math.max(0, ...window.map((m) => m.running)) : null,
          kvPercent: metrics ? Math.max(0, ...window.map((m) => m.kv)) : null,
          ttftBestMs: best.length ? Math.min(...best) : null,
        },
        gpus: gpus.map(({ uuid: _uuid, busy: _busy, ...g }) => g),
        memory: { totalBytes: totalmem(), freeBytes: freemem() },
      };
      if (!history) return out;
      const step = BUCKET_MINUTES * MINUTE;
      const end = Math.floor(at / step) * step + step;
      const start = end - BUCKETS * step;
      const values = Array.from({ length: BUCKETS }, () => 0);
      for (const m of window) {
        const i = Math.floor((m.t - start) / step);
        if (i >= 0 && i < BUCKETS) values[i] = (values[i] ?? 0) + m.generation / (step / 1000);
      }
      return {
        ...out,
        history: {
          decode: { start: new Date(start).toISOString(), stepSeconds: step / 1000, values },
          days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, [prompt, generation]]) => ({ day, prompt, generation })),
        },
      };
    });

  return { sample, view };
};
