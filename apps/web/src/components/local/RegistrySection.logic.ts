import type {
  LocalRegistry,
  LocalRegistryRecord,
  LocalRegistryVariant,
  LocalSharePreview,
} from "@t3tools/contracts/local-studio";

export type RegistryJsonModel = { label: string; json: string };

export type RegistryVariantRowModel = {
  id: string;
  summary: string;
  fits: boolean;
  inspectLabel: string;
  inspecting: boolean;
};

export type RegistryModelRowModel = {
  repo: string;
  expanded: boolean;
  summary: string;
  variantCount: string;
  variants: ReadonlyArray<RegistryVariantRowModel>;
};

export type RegistrySectionInput = {
  devices: ReadonlyArray<{ label: string; controller: string }>;
  controller: string;
  all: boolean;
  query: string;
  data: LocalRegistry | null;
  error: string | null;
  open: string | null;
  inspect: string | null;
  limit: number;
};

export type RegistrySectionModel = {
  title: string;
  showMachinePicker: boolean;
  machines: ReadonlyArray<{ value: string; label: string }>;
  controller: string;
  allHardware: boolean;
  allHardwareLabel: string;
  filterPlaceholder: string;
  filterLabel: string;
  status: string;
  emptyMessage: string | null;
  models: ReadonlyArray<RegistryModelRowModel>;
  showMore: { label: string } | null;
};

export type RegistryInspectInput = {
  record: LocalRegistryRecord | null;
  error: string | null;
  downloadState: string | null;
  isCopied: boolean;
};

export type RegistryInspectModel =
  | { kind: "error"; message: string }
  | { kind: "loading"; message: string }
  | {
      kind: "ready";
      command: string | null;
      copyLabel: string;
      copyDisabled: boolean;
      downloadLabel: string;
      downloadDisabled: boolean;
      weights: { href: string; label: string } | null;
      sections: ReadonlyArray<RegistryJsonModel>;
    };

export type SharePanelStep = "preview" | "confirm" | "creating";

export type SharePanelInput = {
  preview: LocalSharePreview | null;
  step: SharePanelStep;
  url: string | null;
  error: string | null;
};

export type SharePanelModel = {
  preparingMessage: string | null;
  error: string | null;
  preview: {
    title: string;
    issues: ReadonlyArray<string>;
    scrubbed: string;
    files: ReadonlyArray<RegistryJsonModel>;
  } | null;
  pullRequest: { href: string; label: string } | null;
  confirmMessage: string | null;
  primaryLabel: string;
  primaryDisabled: boolean;
  declineLabel: string;
  declineDisabled: boolean;
};

export type SharePrimaryDecision =
  | { kind: "confirm"; step: "confirm" }
  | { kind: "create"; step: "creating"; path: string; body: { port: number; confirm: true } };

export type RegistryRequest = { path: string; body?: unknown };

const jsonSection = (label: string, value: unknown): RegistryJsonModel | null =>
  value ? { label, json: JSON.stringify(value, null, 2) } : null;

export const summarizeRegistryVariant = (v: LocalRegistryVariant) =>
  [
    v.engine,
    v.precision ?? v.format,
    v.sizeGb != null ? `${v.sizeGb.toFixed(1)} GB` : null,
    `${v.hardwareCount > 1 ? `${v.hardwareCount}× ` : ""}${v.hardwareId}`,
    v.status,
    v.recommended ? "recommended" : null,
  ]
    .filter(Boolean)
    .join(" · ");

export const REGISTRY_PAGE_SIZE = 40;

export function resolveRegistryListRequest(all: boolean): RegistryRequest {
  return { path: `registry${all ? "?all=1" : ""}` };
}

export function resolveRegistryRecordRequest(id: string): RegistryRequest {
  return { path: `registry/records/${encodeURIComponent(id)}` };
}

export function resolveRegistryDownload(id: string): RegistryRequest {
  return { path: "registry/download", body: { recipeId: id } };
}

export function resolveSharePreviewRequest(port: number): RegistryRequest {
  return { path: `registry/share?port=${port}` };
}

export function buildRegistrySectionModel(input: RegistrySectionInput): RegistrySectionModel {
  const { data, error, all, limit } = input;
  const q = input.query.trim().toLowerCase();
  const models = (data?.models ?? []).filter(
    (m) =>
      !q ||
      m.repo.toLowerCase().includes(q) ||
      m.variants.some((v) =>
        `${v.engine} ${v.hardwareId} ${v.precision}`.toLowerCase().includes(q),
      ),
  );
  const matched = (data?.matches ?? []).filter((m) => m.hardwareId);
  return {
    title: "Registry",
    showMachinePicker: input.devices.length > 1,
    machines: input.devices.map((d) => ({ value: d.controller, label: d.label })),
    controller: input.controller,
    allHardware: all,
    allHardwareLabel: "All hardware",
    filterPlaceholder: "Filter models, engines, hardware",
    filterLabel: "Filter registry",
    status: error
      ? error
      : !data
        ? "Reading the registry…"
        : `${matched.length ? `Matched ${matched.map((m) => `${m.count > 1 ? `${m.count}× ` : ""}${m.hardwareName}`).join(", ")}` : `No registry hardware matches ${data.matches.map((m) => m.name).join(", ") || "this machine"}`} · ${models.length} of ${data.total} models${data.commit ? ` · ${data.commit.slice(0, 8)}` : ""}`,
    emptyMessage:
      data && models.length === 0
        ? all
          ? "Nothing matches the filter."
          : "No registry configurations for this hardware yet. Turn on All hardware to browse everything."
        : null,
    models: models.slice(0, limit).map((m) => {
      const best = m.variants[0];
      const expanded = input.open === m.repo;
      return {
        repo: m.repo,
        expanded,
        summary: `${best ? summarizeRegistryVariant(best) : ""}${data?.downloads[m.repo] ? ` · ${data.downloads[m.repo]}` : ""}`,
        variantCount: `${m.variants.length} variant${m.variants.length === 1 ? "" : "s"}`,
        variants: expanded
          ? m.variants.map((v) => ({
              id: v.id,
              summary: summarizeRegistryVariant(v),
              fits: v.fits,
              inspectLabel: input.inspect === v.id ? "Close" : "Inspect",
              inspecting: input.inspect === v.id,
            }))
          : [],
      };
    }),
    showMore: models.length > limit ? { label: `Show more (${models.length - limit} left)` } : null,
  };
}

export function buildRegistryInspectModel(input: RegistryInspectInput): RegistryInspectModel {
  const { record } = input;
  if (input.error) return { kind: "error", message: input.error };
  if (!record) return { kind: "loading", message: "Reading the record…" };
  const weights = record.weights;
  return {
    kind: "ready",
    command: record.command || null,
    copyLabel: input.isCopied ? "Copied" : "Use config",
    copyDisabled: !record.command,
    downloadLabel: input.downloadState === "downloading" ? "Downloading…" : "Download weights",
    downloadDisabled: !weights || input.downloadState === "downloading",
    weights: weights
      ? {
          href: `https://huggingface.co/${weights.repo}${weights.revision ? `/tree/${weights.revision}` : ""}`,
          label: `${weights.repo}${weights.revision ? `@${weights.revision.slice(0, 8)}` : ""}`,
        }
      : null,
    sections: [
      jsonSection("Recipe", record.recipe),
      jsonSection("Model instance", record.modelInstance),
      jsonSection("Model", record.model),
      jsonSection("Hardware", record.hardware),
    ].filter((section) => section !== null),
  };
}

export function buildSharePanelModel(input: SharePanelInput): SharePanelModel {
  const { preview, step, url, error } = input;
  const blocked = !preview || preview.blockers.length > 0 || preview.issues.length > 0;
  return {
    preparingMessage:
      !preview && !error
        ? "Preparing registry records. A short validation request is sent to this server."
        : null,
    error,
    preview: preview
      ? {
          title: preview.title,
          issues: [...preview.blockers, ...preview.issues],
          scrubbed: `Scrubbed: ${preview.redactions.join(", ") || "nothing needed"}${preview.reused.length ? ` · Reuses ${preview.reused.join(", ")}` : ""}`,
          files: preview.files.flatMap((file) => {
            const section = jsonSection(file.path, file.record);
            return section ? [section] : [];
          }),
        }
      : null,
    pullRequest: url ? { href: url, label: "Pull request opened" } : null,
    confirmMessage:
      step !== "preview" && preview ? `This will create a PR to ${preview.target}` : null,
    primaryLabel: step === "preview" ? "Share" : step === "creating" ? "Creating PR…" : "Create PR",
    primaryDisabled: blocked || step === "creating",
    declineLabel: "Decline",
    declineDisabled: step === "creating",
  };
}

export function resolveSharePrimary(step: SharePanelStep, port: number): SharePrimaryDecision {
  return step === "preview"
    ? { kind: "confirm", step: "confirm" }
    : { kind: "create", step: "creating", path: "registry/share", body: { port, confirm: true } };
}
