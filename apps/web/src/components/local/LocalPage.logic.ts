import type {
  LocalControllerLink,
  LocalHardware,
  LocalJob,
  LocalRecipe,
  LocalRecipes,
  LocalSnapshot,
  LocalTailnet,
  LocalUsage,
} from "@t3tools/contracts/local-studio";
import { formatTokens } from "@t3tools/shared/usageFormat";
import {
  buildUsageProviderChartModel,
  type UsageProviderChartModel,
} from "../usage/UsageProviderChart.logic";
import type { UsageProviderStyle } from "../usage/usageProviders.logic";

export type LocalDotTone = "destructive" | "success" | "muted" | "warning";

export type LocalDotModel = { tone: LocalDotTone; tooltip: string };

export type LocalActRequest = {
  key: string;
  path: string;
  body: unknown;
  controller: string;
};

export type LocalMachineUiState = {
  open: boolean;
  reveal: boolean;
  editing: string | null;
  choice: string | null;
  armed: string | null;
  sharing: number | null;
};

export type LocalMachineInput = {
  device: LocalControllerLink;
  snapshot: LocalSnapshot | undefined;
  recipes: LocalRecipes | undefined;
  busy: string | null;
  ui: LocalMachineUiState;
};

export type LocalMetricModel = { label: string; value: string };

export type LocalMemoryModel = {
  percent: number;
  label: string;
};

export type LocalEndpointRowModel = {
  id: string;
  port: number;
  portLabel: string;
  models: string;
  dot: LocalDotModel;
  unloadLabel: string;
  unloadVariant: "destructive" | "outline";
  unloadDisabled: boolean;
  sharing: boolean;
};

export type LocalJobRowModel = {
  id: string;
  recipeId: string;
  detail: string;
  dot: LocalDotModel;
  buttonLabel: string;
  buttonDisabled: boolean;
};

export type LocalRecipeOptionModel = {
  id: string;
  model: string;
  detail: string;
  disabled: boolean;
};

export type LocalRecipeGroupModel = {
  label: string;
  recipes: ReadonlyArray<LocalRecipeOptionModel>;
};

export type LocalRecipePickerModel = {
  items: ReadonlyArray<{ value: string; label: string }>;
  value: string | null;
  groups: ReadonlyArray<LocalRecipeGroupModel>;
  loadLabel: string;
  loadVariant: "destructive" | "default";
  loadDisabled: boolean;
  note: string;
};

export type LocalMachineModel = {
  url: string;
  name: string;
  host: string;
  controller: string;
  open: boolean;
  reachable: boolean;
  dot: LocalDotModel;
  canRename: boolean;
  renameLabel: string;
  editing: string | null;
  revealAddress: boolean;
  addressToggleLabel: string;
  subtitle: string;
  memory: LocalMemoryModel | null;
  details: {
    metrics: ReadonlyArray<LocalMetricModel>;
    endpoints: ReadonlyArray<LocalEndpointRowModel>;
    jobs: ReadonlyArray<LocalJobRowModel>;
    picker: LocalRecipePickerModel | null;
    emptyRecipesMessage: string | null;
  } | null;
};

export type LocalTailnetRowModel = {
  ip: string;
  title: string;
  description: string;
  buttonLabel: string;
  buttonDisabled: boolean;
};

export type LocalRegistryDeviceModel = { label: string; controller: string };

export type LocalUsageRowModel = {
  model: string;
  requests: string;
  share: string;
  tokens: string;
};

export const LOCAL_USAGE_CHART_STYLE: UsageProviderStyle = {
  label: "Local models",
  color: "var(--contrast-foreground)",
};

export type LocalUsageModel = {
  metrics: ReadonlyArray<LocalMetricModel>;
  chartTitle: string;
  chart: UsageProviderChartModel;
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<LocalUsageRowModel>;
  footnote: string;
};

export type LocalPageInput = {
  root: LocalSnapshot | null;
  snapshots: Readonly<Record<string, LocalSnapshot | undefined>>;
  recipes: Readonly<Record<string, LocalRecipes | undefined>>;
  tailnet: LocalTailnet | null;
  error: string | null;
  busy: string | null;
  machineUi: Readonly<Record<string, LocalMachineUiState | undefined>>;
  nowMs: number;
};

export type LocalPageModel = {
  error: string | null;
  machines: {
    title: string;
    scanLabel: string;
    scanDisabled: boolean;
    rows: ReadonlyArray<LocalMachineModel>;
    tailnet: ReadonlyArray<LocalTailnetRowModel>;
    loadingMessage: string | null;
  };
  registryDevices: ReadonlyArray<LocalRegistryDeviceModel>;
  usage: LocalUsageModel;
  about: {
    title: string;
    paragraphs: ReadonlyArray<string>;
    link: { label: string; href: string };
  };
};

export type LocalArmDecision =
  | { kind: "arm"; armed: string | null }
  | { kind: "act"; armed: null; request: LocalActRequest }
  | { kind: "none" };

export type LocalRenameDecision = { kind: "rename"; request: LocalActRequest } | { kind: "cancel" };

export const LOCAL_MACHINE_UI_DEFAULT: LocalMachineUiState = {
  open: false,
  reveal: false,
  editing: null,
  choice: null,
  armed: null,
  sharing: null,
};

const sum = <T>(rows: ReadonlyArray<T>, value: (row: T) => number) =>
  rows.reduce((total, row) => total + value(row), 0);

export const formatGib = (bytes: number) => `${(bytes / 2 ** 30).toFixed(0)} GiB`;

export const localMemoryUse = (hardware: LocalHardware) => {
  const vram = sum(hardware.gpus, (gpu) => gpu.memoryTotalMiB) * 2 ** 20;
  return vram
    ? { used: sum(hardware.gpus, (gpu) => gpu.memoryUsedMiB) * 2 ** 20, total: vram, label: "VRAM" }
    : {
        used: hardware.memTotalBytes - hardware.memFreeBytes,
        total: hardware.memTotalBytes,
        label: "Memory",
      };
};

export const localGpuSummary = (hardware: LocalHardware) => {
  const names = new Set(
    hardware.gpus.map((gpu) =>
      gpu.name.replace(/^NVIDIA (GeForce )?/, "").replace(/ (Blackwell )?Workstation Edition/, ""),
    ),
  );
  return names.size
    ? `${hardware.gpus.length}× ${[...names].join(" / ")}`
    : `${hardware.cpus} CPUs`;
};

export const localTokensOf = (usage: ReadonlyArray<LocalUsage> = [], since = "", until = "9999") =>
  sum(usage, (row) =>
    sum(Object.entries(row.tokens ?? {}), ([day, count]) =>
      day >= since && day <= until ? count : 0,
    ),
  );

export const resolveLocalTarget = (device: LocalControllerLink) => (device.self ? "" : device.url);

export const localDeviceHost = (device: LocalControllerLink) =>
  URL.parse(device.url)?.hostname ?? device.url;

const machineFacts = (input: LocalMachineInput) => {
  const { device, snapshot, recipes, ui } = input;
  const hardware = snapshot?.hardware;
  const running = (snapshot?.endpoints ?? []).filter(
    (endpoint) => endpoint.live && endpoint.controllerId === device.id,
  );
  const loaded = running.flatMap((endpoint) => endpoint.models).join(", ");
  const jobs = (snapshot?.jobs ?? []).filter((job) => !["ready", "stopped"].includes(job.phase));
  const rig = hardware?.gpus.length ?? 0;
  const all = (recipes?.recipes ?? []).toSorted(
    (a, b) => b.cards - a.cards || (b.tps ?? 0) - (a.tps ?? 0) || a.model.localeCompare(b.model),
  );
  const options = all.filter((recipe) => recipe.fits);
  const reference = [
    ...new Map(
      all
        .filter((recipe) => !recipe.fits)
        .map((recipe) => [`${recipe.model} ${recipe.cards} ${recipe.engine}`, recipe] as const),
    ).values(),
  ];
  const picked = options.find((recipe) => recipe.id === ui.choice) ?? options[0];
  const host = localDeviceHost(device);
  return {
    hardware,
    running,
    loaded,
    jobs,
    rig,
    all,
    options,
    reference,
    picked,
    host,
    name: device.name ?? host,
    controller: resolveLocalTarget(device),
    loadKey: `load ${device.url}`,
  };
};

const gpusLabel = (recipe: LocalRecipe, rig: number) =>
  `${recipe.cards} of ${rig} GPU${rig === 1 ? "" : "s"}${recipe.cards === rig && rig > 1 ? " · full rig" : ""}`;

const describeRecipe = (recipe: LocalRecipe, rig: number) =>
  [
    gpusLabel(recipe, rig),
    recipe.engine,
    recipe.ctx ? `${Math.round(recipe.ctx / 1000)}k context` : null,
    recipe.tps != null ? `${recipe.tps.toFixed(0)} tok/s` : null,
  ]
    .filter(Boolean)
    .join(" · ");

const describeReference = (recipe: LocalRecipe, rig: number) =>
  `${gpusLabel(recipe, rig)} · ${recipe.engine} · ${(recipe.blocked ?? "")
    .split(/[:;]/)[0]
    ?.replace(/captured (\w+) record from/, "$1 report from")}`;

const buildJobRow = (job: LocalJob, busy: string | null): LocalJobRowModel => ({
  id: job.id,
  recipeId: job.recipeId,
  detail: `${job.phase}${job.progress !== null ? ` ${Math.round(job.progress * 100)}%` : ""}${job.message ? ` · ${job.message}` : ""}`,
  dot:
    job.phase === "failed"
      ? { tone: "destructive", tooltip: "Failed" }
      : { tone: "warning", tooltip: "Loading" },
  buttonLabel: job.phase === "failed" ? "Dismiss" : "Cancel",
  buttonDisabled: busy !== null,
});

export function buildLocalMachineModel(input: LocalMachineInput): LocalMachineModel {
  const { device, busy, ui } = input;
  const f = machineFacts(input);
  const use = f.hardware ? localMemoryUse(f.hardware) : null;
  const armedLoad = ui.armed === f.loadKey;
  const picker: LocalRecipePickerModel | null =
    f.all.length > 0
      ? {
          items: f.all.map((recipe) => ({
            value: recipe.id,
            label: `${recipe.model} · ${recipe.cards}× GPU`,
          })),
          value: f.picked?.id ?? null,
          groups: [
            {
              label: "Ready to load",
              recipes: f.options.map((recipe) => ({
                id: recipe.id,
                model: recipe.model,
                detail: describeRecipe(recipe, f.rig),
                disabled: !recipe.fits,
              })),
            },
            {
              label: "In the registry, not one-click yet",
              recipes: f.reference.map((recipe) => ({
                id: recipe.id,
                model: recipe.model,
                detail: describeReference(recipe, f.rig),
                disabled: !recipe.fits,
              })),
            },
          ].filter((group) => group.recipes.length > 0),
          loadLabel:
            busy === f.loadKey
              ? "Loading…"
              : armedLoad
                ? `Unload ${f.running.length} and load`
                : "Load",
          loadVariant: armedLoad ? "destructive" : "default",
          loadDisabled: busy !== null || !f.picked,
          note: `${
            f.picked
              ? `Recipe ${f.picked.id} · ${describeRecipe(f.picked, f.rig)}`
              : `None of the ${f.reference.length} registry recipes for this hardware can load automatically yet. See the supported hardware below.`
          }${armedLoad ? ` Loading ${f.picked?.model} unloads ${f.loaded} first.` : ""}`,
        }
      : null;
  return {
    url: device.url,
    name: f.name,
    host: f.host,
    controller: f.controller,
    open: ui.open,
    reachable: device.reachable,
    dot: !device.reachable
      ? { tone: "destructive", tooltip: "Offline" }
      : f.running.length
        ? { tone: "success", tooltip: "Serving" }
        : { tone: "muted", tooltip: "Idle" },
    canRename: device.reachable,
    renameLabel: `Rename ${f.name}`,
    editing: ui.editing,
    revealAddress: ui.reveal,
    addressToggleLabel: ui.reveal ? "Hide address" : "Show address",
    subtitle: !device.reachable
      ? (device.error ?? "Offline")
      : f.loaded || (f.jobs[0] ? `Loading ${f.jobs[0].recipeId}` : "No model loaded"),
    memory: use
      ? {
          percent: Math.min(100, (use.used / use.total) * 100),
          label: `${formatGib(use.used)} / ${formatGib(use.total)} ${use.label}`,
        }
      : null,
    details:
      ui.open && device.reachable
        ? {
            metrics: [
              {
                label: "Tokens served",
                value: device.usage?.some((row) => row.measuredRequests)
                  ? formatTokens(localTokensOf(device.usage))
                  : "—",
              },
              {
                label: "Requests",
                value: sum(device.usage ?? [], (row) => row.requests).toLocaleString(),
              },
              { label: "Hardware", value: f.hardware ? localGpuSummary(f.hardware) : "—" },
              { label: "Models loaded", value: String(f.running.length) },
            ],
            endpoints: f.running.map((endpoint) => ({
              id: endpoint.id,
              port: endpoint.port,
              portLabel: `:${endpoint.port}`,
              models: endpoint.models.join(", "),
              dot: { tone: "success", tooltip: "Serving" },
              unloadLabel:
                busy === endpoint.id
                  ? "Unloading…"
                  : ui.armed === endpoint.id
                    ? "Confirm unload"
                    : "Unload",
              unloadVariant: ui.armed === endpoint.id ? "destructive" : "outline",
              unloadDisabled: busy !== null,
              sharing: ui.sharing === endpoint.port,
            })),
            jobs: f.jobs.map((job) => buildJobRow(job, busy)),
            picker,
            emptyRecipesMessage: picker
              ? null
              : input.recipes
                ? "The registry has no recipes for this hardware yet."
                : "Reading the registry…",
          }
        : null,
  };
}

const confirmArm = (
  armed: string | null,
  key: string,
  request: LocalActRequest,
): LocalArmDecision =>
  armed === key ? { kind: "act", armed: null, request } : { kind: "arm", armed: key };

export function resolveLocalLoad(input: LocalMachineInput): LocalArmDecision {
  const f = machineFacts(input);
  if (!f.picked)
    return input.ui.armed === f.loadKey ? { kind: "arm", armed: null } : { kind: "none" };
  const request: LocalActRequest = {
    key: f.loadKey,
    path: `recipes/${encodeURIComponent(f.picked.id)}/run`,
    body: { replace: f.running.length > 0 },
    controller: f.controller,
  };
  return f.running.length
    ? confirmArm(input.ui.armed, f.loadKey, request)
    : { kind: "act", armed: null, request };
}

export function resolveLocalUnload(input: LocalMachineInput, endpointId: string): LocalArmDecision {
  const endpoint = input.snapshot?.endpoints.find((row) => row.id === endpointId);
  if (!endpoint) return { kind: "none" };
  return confirmArm(input.ui.armed, endpoint.id, {
    key: endpoint.id,
    path: `ports/${endpoint.port}/stop`,
    body: {},
    controller: resolveLocalTarget(input.device),
  });
}

export function resolveLocalJobStop(device: LocalControllerLink, jobId: string): LocalActRequest {
  return {
    key: jobId,
    path: `runs/${jobId}/stop`,
    body: {},
    controller: resolveLocalTarget(device),
  };
}

export function resolveLocalRename(
  device: LocalControllerLink,
  editing: string,
): LocalRenameDecision {
  const name = device.name ?? localDeviceHost(device);
  return editing.trim() && editing !== name
    ? {
        kind: "rename",
        request: {
          key: `name ${device.url}`,
          path: "name",
          body: { name: editing.trim() },
          controller: resolveLocalTarget(device),
        },
      }
    : { kind: "cancel" };
}

export function resolveLocalTailnetDevice(
  tailnet: LocalTailnet | null,
  ip: string,
): LocalActRequest | null {
  const device = tailnet?.devices.find((row) => row.ip === ip);
  if (!device) return null;
  return device.controller
    ? { key: device.ip, path: "peers", body: { url: device.controller.url }, controller: "" }
    : {
        key: device.ip,
        path: "tailnet/deploy",
        body: { ip: device.ip, name: device.name },
        controller: "",
      };
}

export function resolveLocalReachableTargets(root: LocalSnapshot | null): ReadonlyArray<string> {
  const reachable = (root?.controllers ?? [])
    .filter((device) => device.reachable)
    .map(resolveLocalTarget)
    .join(" ");
  return reachable ? reachable.split(" ") : [""];
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function buildLocalUsageModel(root: LocalSnapshot | null, nowMs: number): LocalUsageModel {
  const usage = root?.usage ?? [];
  const now = root ? new Date(root.generatedAt).getTime() : nowMs;
  const today = dayKey(now);
  const monday = now - ((new Date(now).getUTCDay() + 6) % 7) * 86_400_000;
  const days = Array.from({ length: 30 }, (_, index) => dayKey(now - (29 - index) * 86_400_000));
  const measured = sum(usage, (row) => row.measuredRequests ?? 0);
  const requests = sum(usage, (row) => row.requests);
  const shown = (value: number) => (measured ? formatTokens(value) : "—");
  const models = usage.toSorted(
    (a, b) => localTokensOf([b]) - localTokensOf([a]) || b.requests - a.requests,
  );
  return {
    metrics: [
      { label: "Today", value: shown(localTokensOf(usage, today)) },
      { label: "This week", value: shown(localTokensOf(usage, dayKey(monday))) },
      { label: "All time", value: shown(localTokensOf(usage)) },
      { label: "Requests", value: requests.toLocaleString() },
    ],
    chartTitle: "Daily processed tokens",
    chart: buildUsageProviderChartModel({
      providers: ["codex"],
      days,
      daily: days.map((day) => {
        const totalTokens = localTokensOf(usage, day, day);
        return {
          day,
          costUsd: 0,
          totalTokens,
          byProvider: new Map([["codex", { costUsd: 0, totalTokens }]]),
        };
      }),
      hours: [],
      hourly: [],
      metric: "tokens",
      referenceTime: root?.generatedAt,
      resolution: "day",
      timeZone: "UTC",
      styleOverrides: { codex: LOCAL_USAGE_CHART_STYLE },
    }),
    columns: ["Requests", "Share", "Tokens"],
    rows: models.map((row) => ({
      model: row.model,
      requests: row.requests.toLocaleString(),
      share: `${((row.requests / requests) * 100).toFixed(0)}%`,
      tokens: row.measuredRequests ? formatTokens(localTokensOf([row])) : "—",
    })),
    footnote: `${models.length === 0 ? "No requests yet. " : ""}Input + output tokens, including cached input, counted in UTC with weeks starting Monday. Tokens are known for ${measured.toLocaleString()} of ${requests.toLocaleString()} requests; traffic sent straight to an engine is not seen.`,
  };
}

export function buildLocalPageModel(input: LocalPageInput): LocalPageModel {
  const { root, busy, error } = input;
  const devices = root?.controllers ?? [];
  return {
    error,
    machines: {
      title: "Machines",
      scanLabel: busy === "scan" ? "Scanning…" : "Scan tailnet",
      scanDisabled: busy === "scan",
      rows: devices.map((device) =>
        buildLocalMachineModel({
          device,
          snapshot: input.snapshots[device.url],
          recipes: input.recipes[resolveLocalTarget(device)],
          busy,
          ui: input.machineUi[device.url] ?? LOCAL_MACHINE_UI_DEFAULT,
        }),
      ),
      tailnet: (input.tailnet?.devices ?? [])
        .filter(
          (device) => !device.linked && (device.controller || /^(linux|macOS)$/.test(device.os)),
        )
        .map((device) => ({
          ip: device.ip,
          title: device.name,
          description: device.controller
            ? "Controller found on your tailnet"
            : `${device.os} · no controller yet`,
          buttonLabel:
            busy === device.ip ? "Installing…" : device.controller ? "Connect" : "Install",
          buttonDisabled: busy !== null,
        })),
      loadingMessage: !root && !error ? "Contacting controller…" : null,
    },
    registryDevices: devices
      .filter((device) => device.reachable)
      .map((device) => ({
        label: device.name ?? localDeviceHost(device),
        controller: resolveLocalTarget(device),
      })),
    usage: buildLocalUsageModel(root, input.nowMs),
    about: {
      title: "About Local",
      paragraphs: [
        "Local runs open models on machines you own. Each machine runs a small Local Studio controller; connected machines share their models, so any model loaded anywhere is available to every chat here. Machines on your Tailscale network are found automatically.",
        "Models load from the Local AI Registry: recipes tested on specific hardware, pinned to an exact image and weights. Loading works on Linux machines with NVIDIA GPUs and Docker, including RTX 3090, 4090, 5090, RTX PRO 6000 and DGX Spark. Macs can connect and serve models they already run.",
      ],
      link: {
        label: "See supported hardware and models",
        href: "https://local-ai-registry.vercel.app/?topic=hardware",
      },
    },
  };
}
