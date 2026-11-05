import { useEffect, useState } from "react";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import {
  LocalRegistry,
  LocalRegistryRecord,
  LocalSharePreview,
  LocalShareResult,
} from "@t3tools/contracts/local-studio";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsSection } from "../settings/settingsLayout";
import {
  REGISTRY_PAGE_SIZE,
  buildRegistryInspectModel,
  buildRegistrySectionModel,
  buildSharePanelModel,
  resolveRegistryDownload,
  resolveRegistryListRequest,
  resolveRegistryRecordRequest,
  resolveSharePreviewRequest,
  resolveSharePrimary,
  type RegistryJsonModel,
  type SharePanelStep,
} from "./RegistrySection.logic";

type Call = (path: string, controller: string, body?: unknown) => Effect.Effect<unknown, Error>;

const load = <A,>(
  effect: Effect.Effect<unknown, Error>,
  schema: Schema.Codec<A, unknown>,
  done: (value: A) => void,
  failed: (message: string) => void,
) =>
  void Effect.runPromise(effect.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema))))
    .then(done)
    .catch((cause: unknown) => failed(String(cause)));

const Json = ({ section }: { section: RegistryJsonModel }) => (
  <details className="text-xs">
    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
      {section.label}
    </summary>
    <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted/50 p-2 text-2xs">
      {section.json}
    </pre>
  </details>
);

function Inspect({ id, controller, call }: { id: string; controller: string; call: Call }) {
  const [record, setRecord] = useState<LocalRegistryRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "launch command" });
  useEffect(
    () =>
      load(
        call(resolveRegistryRecordRequest(id).path, controller),
        LocalRegistryRecord,
        setRecord,
        setError,
      ),
    [id, controller, call],
  );
  const model = buildRegistryInspectModel({ record, error, downloadState: state, isCopied });
  if (model.kind === "error")
    return <p className="text-xs break-all text-destructive">{model.message}</p>;
  if (model.kind === "loading")
    return <p className="text-xs text-muted-foreground">{model.message}</p>;
  const command = model.command;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
      {command && (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-2xs">{command}</pre>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={model.copyDisabled}
          onClick={() => command && copyToClipboard(command, undefined)}
        >
          {model.copyLabel}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={model.downloadDisabled}
          onClick={() => {
            const download = resolveRegistryDownload(id);
            load(
              call(download.path, controller, download.body),
              Schema.Struct({ state: Schema.String }),
              (r) => setState(r.state),
              setError,
            );
          }}
        >
          {model.downloadLabel}
        </Button>
        {model.weights && (
          <a
            href={model.weights.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {model.weights.label}
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
      {model.sections.map((section) => (
        <Json key={section.label} section={section} />
      ))}
    </div>
  );
}

export function RegistrySection({
  devices,
  call,
}: {
  devices: ReadonlyArray<{ label: string; controller: string }>;
  call: Call;
}) {
  const [controller, setController] = useState("");
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<LocalRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [limit, setLimit] = useState(REGISTRY_PAGE_SIZE);
  useEffect(
    () =>
      load(
        call(resolveRegistryListRequest(all).path, controller),
        LocalRegistry,
        (value) => {
          setData(value);
          setError(null);
        },
        setError,
      ),
    [all, controller, call],
  );
  const model = buildRegistrySectionModel({
    devices,
    controller,
    all,
    query,
    data,
    error,
    open,
    inspect,
    limit,
  });
  return (
    <SettingsSection
      title={model.title}
      headerAction={
        <div className="flex items-center gap-2">
          {model.showMachinePicker && (
            <Select
              items={model.machines}
              value={controller}
              onValueChange={(value) => setController(value ?? "")}
            >
              <SelectTrigger size="sm" className="w-36" aria-label="Machine">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {model.machines.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch size="sm" checked={model.allHardware} onCheckedChange={setAll} />
            {model.allHardwareLabel}
          </label>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            className="w-full sm:w-64"
            placeholder={model.filterPlaceholder}
            aria-label={model.filterLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">{model.status}</span>
        </div>
        {model.emptyMessage && (
          <p className="text-xs text-muted-foreground">{model.emptyMessage}</p>
        )}
        <div className="flex flex-col">
          {model.models.map((m) => (
            <div key={m.repo} className="border-t border-border/60 first:border-t-0">
              <button
                type="button"
                aria-expanded={m.expanded}
                onClick={() => setOpen(m.expanded ? null : m.repo)}
                className="flex w-full items-center gap-2 py-2 text-left hover:bg-accent/40"
              >
                <ChevronRightIcon
                  aria-hidden
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${m.expanded ? "rotate-90" : ""}`}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground">{m.repo}</span>
                  <span className="truncate text-xs text-muted-foreground">{m.summary}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {m.variantCount}
                </span>
              </button>
              {m.expanded && (
                <div className="flex flex-col gap-2 pb-3 ps-6">
                  {m.variants.map((v) => (
                    <div key={v.id} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          <span className={v.fits ? "text-foreground" : "text-muted-foreground"}>
                            {v.summary}
                          </span>
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setInspect(v.inspecting ? null : v.id)}
                        >
                          {v.inspectLabel}
                        </Button>
                      </div>
                      {v.inspecting && <Inspect id={v.id} controller={controller} call={call} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {model.showMore && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setLimit(limit + REGISTRY_PAGE_SIZE)}
          >
            {model.showMore.label}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

export function SharePanel({
  port,
  controller,
  call,
  onClose,
}: {
  port: number;
  controller: string;
  call: Call;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<LocalSharePreview | null>(null);
  const [step, setStep] = useState<SharePanelStep>("preview");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      load(
        call(resolveSharePreviewRequest(port).path, controller),
        LocalSharePreview,
        setPreview,
        setError,
      ),
    [port, controller, call],
  );
  const model = buildSharePanelModel({ preview, step, url, error });
  const primary = () => {
    const decision = resolveSharePrimary(step, port);
    setStep(decision.step);
    if (decision.kind === "create")
      load(
        call(decision.path, controller, decision.body),
        LocalShareResult,
        (r) => setUrl(r.url),
        (message) => {
          setError(message);
          setStep("confirm");
        },
      );
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3 text-xs">
      {model.preparingMessage && <p className="text-muted-foreground">{model.preparingMessage}</p>}
      {model.error && <p className="break-all text-destructive">{model.error}</p>}
      {model.preview && (
        <>
          <p className="text-foreground">{model.preview.title}</p>
          {model.preview.issues.map((issue) => (
            <p key={issue} className="text-destructive">
              {issue}
            </p>
          ))}
          <p className="text-muted-foreground">{model.preview.scrubbed}</p>
          {model.preview.files.map((file) => (
            <Json key={file.label} section={file} />
          ))}
        </>
      )}
      {model.pullRequest ? (
        <a
          href={model.pullRequest.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          {model.pullRequest.label}
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : (
        <>
          {model.confirmMessage && <p className="text-foreground">{model.confirmMessage}</p>}
          <div className="flex gap-2">
            <Button size="xs" disabled={model.primaryDisabled} onClick={primary}>
              {model.primaryLabel}
            </Button>
            <Button size="xs" variant="outline" disabled={model.declineDisabled} onClick={onClose}>
              {model.declineLabel}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
