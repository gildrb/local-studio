import { useCallback, useEffect, useState } from "react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChevronRightIcon, ExternalLinkIcon, PencilIcon, ServerIcon } from "lucide-react";
import {
  LocalSnapshot,
  LocalRecipes,
  LocalTailnet,
  type LocalControllerLink,
} from "@t3tools/contracts/local-studio";
import { primaryEnvironmentHttpLayer } from "../../environments/primary/httpLayer";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Metric } from "../usage/UsagePage";
import { UsageProviderChart } from "../usage/UsageProviderChart";
import { RegistrySection, SharePanel } from "./RegistrySection";
import {
  LOCAL_USAGE_CHART_STYLE,
  buildLocalMachineModel,
  buildLocalPageModel,
  resolveLocalJobStop,
  resolveLocalLoad,
  resolveLocalReachableTargets,
  resolveLocalRename,
  resolveLocalTailnetDevice,
  resolveLocalTarget,
  resolveLocalUnload,
  type LocalActRequest,
  type LocalArmDecision,
  type LocalDotModel,
} from "./LocalPage.logic";

const localChartPresentation = { codex: { ...LOCAL_USAGE_CHART_STYLE, mark: ServerIcon } };

class LocalRequestError extends Data.TaggedError("LocalRequestError")<{ message: string }> {}

const request = (path: string, controller: string, body?: unknown) =>
  Effect.gen(function* () {
    const [route, query] = path.split("?");
    const url = new URL(resolvePrimaryEnvironmentHttpUrl(`/api/local/${route}`));
    url.search = query ?? "";
    if (controller) url.searchParams.set("controller", controller);
    const response = yield* (yield* HttpClient.HttpClient).execute(
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body)),
    );
    if (response.status < 400) return yield* response.json;
    const message = (yield* response.text) || `HTTP ${response.status}`;
    return yield* new LocalRequestError({ message });
  }).pipe(Effect.scoped, Effect.timeout("3 minutes"), Effect.provide(primaryEnvironmentHttpLayer));

const fetchEach = <A,>(path: string, schema: Schema.Codec<A, unknown>, controllers: string[]) =>
  Effect.forEach(
    controllers,
    (controller) =>
      request(path, controller).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.map((value) => [controller, value] as const),
        Effect.option,
      ),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => Object.fromEntries(entries.flatMap(Option.toArray))));

const dotClass: Record<LocalDotModel["tone"], string> = {
  destructive: "bg-destructive",
  success: "bg-success",
  muted: "bg-muted-foreground/60",
  warning: "bg-warning",
};
const dot = (model: LocalDotModel) => (
  <ConnectionStatusDot dotClassName={dotClass[model.tone]} tooltipText={model.tooltip} />
);
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

function Machine({
  device,
  snapshot,
  recipes,
  busy,
  act,
}: {
  device: LocalControllerLink;
  snapshot: LocalSnapshot | undefined;
  recipes: LocalRecipes | undefined;
  busy: string | null;
  act: (request: LocalActRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [sharing, setSharing] = useState<number | null>(null);
  const input = {
    device,
    snapshot,
    recipes,
    busy,
    ui: { open, reveal, editing, choice, armed, sharing },
  };
  const model = buildLocalMachineModel(input);
  const apply = (decision: LocalArmDecision) => {
    if (decision.kind === "none") return;
    setArmed(decision.armed);
    if (decision.kind === "act") act(decision.request);
  };
  const details = model.details;
  return (
    <div className="group border-t border-border/60 first:border-t-0">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) =>
          event.key === "Enter" && event.target === event.currentTarget && setOpen(!open)
        }
        className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-accent/40 sm:px-4"
      >
        <ChevronRightIcon
          aria-hidden
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        {dot(model.dot)}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {editing === null ? (
              <>
                <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
                {model.canRename && (
                  <button
                    type="button"
                    aria-label={model.renameLabel}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                    onClick={(event) => {
                      stop(event);
                      setEditing(model.name);
                    }}
                  >
                    <PencilIcon className="size-3" />
                  </button>
                )}
              </>
            ) : (
              <form
                onClick={stop}
                onSubmit={(event) => {
                  event.preventDefault();
                  const decision = resolveLocalRename(device, editing);
                  if (decision.kind === "rename") act(decision.request);
                  setEditing(null);
                }}
              >
                <Input
                  autoFocus
                  size="sm"
                  aria-label="Machine name"
                  className="w-48"
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
                />
              </form>
            )}
            <button
              type="button"
              aria-label={model.addressToggleLabel}
              title={model.addressToggleLabel}
              onClick={(event) => {
                stop(event);
                setReveal(!reveal);
              }}
              className={`hidden truncate text-xs text-muted-foreground tabular-nums transition-[filter] sm:inline ${reveal ? "" : "blur-sm select-none"}`}
            >
              {model.host}
            </button>
          </div>
          <span className="truncate text-xs text-muted-foreground">{model.subtitle}</span>
        </div>
        {model.memory && (
          <div className="hidden w-48 shrink-0 flex-col gap-1 sm:flex">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${model.memory.percent}%` }}
              />
            </div>
            <span className="text-right text-xs text-muted-foreground tabular-nums">
              {model.memory.label}
            </span>
          </div>
        )}
      </div>
      {details && (
        <div className="flex flex-col gap-4 px-3 pb-4 sm:px-4 sm:ps-12">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {details.metrics.map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
          {details.endpoints.map((endpoint) => (
            <div key={endpoint.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                {dot(endpoint.dot)}
                <span className="min-w-0 flex-1 truncate">{endpoint.models}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {endpoint.portLabel}
                </span>
                <Button
                  size="xs"
                  variant={endpoint.unloadVariant}
                  disabled={endpoint.unloadDisabled}
                  onClick={() => apply(resolveLocalUnload(input, endpoint.id))}
                >
                  {endpoint.unloadLabel}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setSharing(endpoint.sharing ? null : endpoint.port)}
                >
                  Share
                </Button>
              </div>
              {endpoint.sharing && (
                <SharePanel
                  port={endpoint.port}
                  controller={model.controller}
                  call={request}
                  onClose={() => setSharing(null)}
                />
              )}
            </div>
          ))}
          {details.jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-sm">
              {dot(job.dot)}
              <span className="min-w-0 flex-1 truncate">
                {job.recipeId}
                <span className="ms-2 text-xs text-muted-foreground">{job.detail}</span>
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={job.buttonDisabled}
                onClick={() => act(resolveLocalJobStop(device, job.id))}
              >
                {job.buttonLabel}
              </Button>
            </div>
          ))}
          {details.picker ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  items={details.picker.items}
                  value={details.picker.value}
                  onValueChange={setChoice}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-auto sm:min-w-64 sm:flex-1"
                    aria-label="Model to load"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup align="start" alignItemWithTrigger={false}>
                    {details.picker.groups.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectGroupLabel>{group.label}</SelectGroupLabel>
                        {group.recipes.map((recipe) => (
                          <SelectItem key={recipe.id} value={recipe.id} disabled={recipe.disabled}>
                            <span className="flex flex-col">
                              {recipe.model}
                              <span className="text-xs text-muted-foreground">{recipe.detail}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectPopup>
                </Select>
                <Button
                  size="sm"
                  variant={details.picker.loadVariant}
                  disabled={details.picker.loadDisabled}
                  onClick={() => apply(resolveLocalLoad(input))}
                >
                  {details.picker.loadLabel}
                </Button>
              </div>
              <p className="text-xs break-all text-muted-foreground">{details.picker.note}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{details.emptyRecipesMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function LocalSettingsPanel() {
  const [root, setRoot] = useState<LocalSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, LocalSnapshot | undefined>>({});
  const [recipes, setRecipes] = useState<Record<string, LocalRecipes>>({});
  const [tailnet, setTailnet] = useState<LocalTailnet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const devices = root?.controllers ?? [];
  const reachable = resolveLocalReachableTargets(root).join(" ");

  const perform = useCallback(
    <A,>(key: string, effect: Effect.Effect<A, Error>, then: (value: A) => void) => {
      setBusy(key);
      setError(null);
      void Effect.runPromise(effect)
        .then(then)
        .catch((cause: unknown) => setError(String(cause)))
        .finally(() => setBusy(null));
    },
    [],
  );
  const act = (action: LocalActRequest) =>
    perform(action.key, request(action.path, action.controller, action.body), () =>
      setRevision((value) => value + 1),
    );
  const scan = useCallback(
    () =>
      perform(
        "scan",
        request("tailnet", "").pipe(Effect.flatMap(Schema.decodeUnknownEffect(LocalTailnet))),
        setTailnet,
      ),
    [perform],
  );
  useEffect(scan, [scan]);

  useEffect(() => {
    const abort = new AbortController();
    const poll = Effect.gen(function* () {
      const state = yield* request("snapshot", "").pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LocalSnapshot)),
      );
      const reachableUrls = state.controllers
        .filter((device) => device.reachable)
        .map(resolveLocalTarget);
      const each = yield* fetchEach("snapshot", LocalSnapshot, reachableUrls);
      setRoot(state);
      setSnapshots(
        Object.fromEntries(
          state.controllers.map((device) => [device.url, each[resolveLocalTarget(device)]]),
        ),
      );
    }).pipe(
      Effect.catch((cause) => Effect.sync(() => setError(String(cause)))),
      Effect.repeat(Schedule.spaced("5 seconds")),
    );
    void Effect.runPromise(poll, { signal: abort.signal }).catch(() => undefined);
    return () => abort.abort();
  }, [revision]);

  useEffect(() => {
    void Effect.runPromise(
      fetchEach("recipes?archived=1", LocalRecipes, reachable.split(" ")),
    ).then(setRecipes);
  }, [reachable, revision]);

  const model = buildLocalPageModel({
    root,
    snapshots,
    recipes,
    tailnet,
    error,
    busy,
    machineUi: {},
    nowMs: Date.now(),
  });
  const usage = model.usage;
  const cell = "py-2 text-right text-muted-foreground tabular-nums";

  return (
    <SettingsPageContainer width="expanded" className="gap-6">
      {model.error && (
        <p role="alert" className="text-sm break-all text-destructive">
          {model.error}
        </p>
      )}

      <SettingsSection
        title={model.machines.title}
        headerAction={
          <Button variant="ghost" size="sm" disabled={model.machines.scanDisabled} onClick={scan}>
            {model.machines.scanLabel}
          </Button>
        }
      >
        {devices.map((device) => (
          <Machine
            key={device.url}
            device={device}
            snapshot={snapshots[device.url]}
            recipes={recipes[resolveLocalTarget(device)]}
            busy={busy}
            act={act}
          />
        ))}
        {model.machines.tailnet.map((device) => (
          <SettingsRow
            key={device.ip}
            title={device.title}
            description={device.description}
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={device.buttonDisabled}
                onClick={() => {
                  const action = resolveLocalTailnetDevice(tailnet, device.ip);
                  if (action) act(action);
                }}
              >
                {device.buttonLabel}
              </Button>
            }
          />
        ))}
        {model.machines.loadingMessage && (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            {model.machines.loadingMessage}
          </p>
        )}
      </SettingsSection>

      <RegistrySection devices={model.registryDevices} call={request} />

      <SettingsSection title="Usage">
        <div className="flex flex-col gap-5 px-3 py-4 sm:px-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {usage.metrics.map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-foreground">{usage.chartTitle}</h3>
            <UsageProviderChart model={usage.chart} presentation={localChartPresentation} />
          </div>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="w-1/2 py-2 font-normal">Model</th>
                {usage.columns.map((label) => (
                  <th key={label} className="py-2 text-right font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.rows.map((row) => (
                <tr key={row.model} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="truncate py-2 text-foreground">{row.model}</td>
                  <td className={cell}>{row.requests}</td>
                  <td className={cell}>{row.share}</td>
                  <td className={cell}>{row.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">{usage.footnote}</p>
        </div>
      </SettingsSection>

      <SettingsSection title={model.about.title}>
        <div className="flex flex-col gap-3 px-3 py-4 text-sm text-muted-foreground sm:px-4">
          {model.about.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <a
            href={model.about.link.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            {model.about.link.label}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
