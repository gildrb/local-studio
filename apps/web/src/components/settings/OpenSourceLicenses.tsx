import { ChevronRightIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  decodeThirdPartyLicenseManifest,
  type ThirdPartyLicenseManifest,
} from "@t3tools/shared/thirdPartyLicenses";

import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildOpenSourceLicensesModel,
  licenseManifestErrorMessage,
  licenseManifestRequestFailedMessage,
  resolveOpenSourceLicensesAction,
  type OpenSourceLicenseRow,
  type OpenSourceLicensesHeaderModel,
  type OpenSourceLicensesManifestState,
} from "./OpenSourceLicenses.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

async function loadLicenseManifest(signal: AbortSignal): Promise<ThirdPartyLicenseManifest> {
  const response = await fetch(
    `${import.meta.env.BASE_URL.replace(/\/$/, "")}/third-party-licenses.json`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(licenseManifestRequestFailedMessage(response.status));
  }
  return decodeThirdPartyLicenseManifest((await response.json()) as unknown);
}

function LicenseNoticeRow({
  row,
  onOpenChange,
}: {
  readonly row: OpenSourceLicenseRow;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Collapsible open={row.open} onOpenChange={onOpenChange}>
      <article>
        <div className="flex min-h-10 items-center hover:bg-muted/35 sm:min-h-9">
          <CollapsibleTrigger className="group flex min-h-10 min-w-0 flex-1 items-center gap-2.5 px-3 text-left sm:min-h-9 sm:px-4">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90"
            />
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate font-medium text-foreground">{row.name}</span>
              {row.version ? (
                <code className="shrink-0 text-xs text-muted-foreground">{row.version}</code>
              ) : null}
            </span>
            <span className="max-w-[42%] shrink-0 truncate text-xs text-muted-foreground">
              {row.summary}
            </span>
          </CollapsibleTrigger>
          {row.sourceUrl ? (
            <Button
              aria-label={row.sourceLabel}
              className="me-3 shrink-0 sm:me-4"
              render={<a href={row.sourceUrl} rel="noreferrer noopener" target="_blank" />}
              size="icon-micro"
              title={row.sourceTitle}
              variant="ghost-muted"
            >
              <ExternalLinkIcon aria-hidden className="size-3" />
            </Button>
          ) : null}
        </div>
        <CollapsiblePanel>
          {row.noticeText !== null ? (
            <div className="px-9 pt-1 pb-4 sm:px-10">
              <pre className="max-w-[76ch] whitespace-pre-wrap break-words font-mono text-xs/5 text-foreground/80">
                {row.noticeText}
              </pre>
            </div>
          ) : null}
        </CollapsiblePanel>
      </article>
    </Collapsible>
  );
}

function LicenseCount({ label }: { label: string }) {
  return (
    <p className="whitespace-nowrap text-xs font-normal text-muted-foreground tabular-nums">
      {label}
    </p>
  );
}

function LicenseHeaderAction({
  header,
  onQueryChange,
  onSearchOpenChange,
}: {
  header: OpenSourceLicensesHeaderModel;
  onQueryChange: (value: string) => void;
  onSearchOpenChange: (open: boolean) => void;
}) {
  if (!header.searchOpen) {
    return (
      <div className="flex items-center gap-1.5">
        <LicenseCount label={header.countLabel} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={header.searchLabel}
                onClick={() => onSearchOpenChange(true)}
                size="icon-micro"
                type="button"
                variant="ghost-muted"
              >
                <SearchIcon className="size-3" />
              </Button>
            }
          />
          <TooltipPopup side="top">{header.searchTooltip}</TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:block">
        <LicenseCount label={header.countLabel} />
      </div>
      <InputGroup className="w-36 sm:w-44">
        <InputGroupAddon>
          <SearchIcon aria-hidden className="size-3" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={header.searchLabel}
          autoFocus
          onBlur={() => {
            const decision = resolveOpenSourceLicensesAction({
              kind: "search-blur",
              query: header.query,
            });
            if (decision.kind === "close-search") onSearchOpenChange(false);
          }}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            const decision = resolveOpenSourceLicensesAction({
              kind: "search-key",
              key: event.key,
            });
            if (decision.kind !== "close-search") return;
            event.preventDefault();
            if (decision.clearQuery) onQueryChange("");
            onSearchOpenChange(false);
          }}
          placeholder={header.searchPlaceholder}
          size="sm"
          type="search"
          value={header.query}
        />
      </InputGroup>
    </div>
  );
}

function LicenseManifestError({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-3 py-5 sm:px-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="max-w-[70ch] text-pretty text-xs leading-normal text-muted-foreground/80">
          {message}
        </p>
      </div>
      <Button type="button" size="xs" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

export function OpenSourceLicensesPanel() {
  const [state, setState] = useState<OpenSourceLicensesManifestState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [openEntryKey, setOpenEntryKey] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void loadLicenseManifest(controller.signal).then(
      (manifest) => setState({ status: "ready", entries: manifest.entries }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: licenseManifestErrorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [requestVersion]);

  const model = useMemo(
    () => buildOpenSourceLicensesModel({ manifest: state, query, searchOpen, openEntryKey }),
    [openEntryKey, query, searchOpen, state],
  );
  const retry = useCallback(() => setRequestVersion((value) => value + 1), []);
  const { body } = model;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title={model.title}
        headerAction={
          model.header ? (
            <LicenseHeaderAction
              header={model.header}
              onQueryChange={setQuery}
              onSearchOpenChange={setSearchOpen}
            />
          ) : null
        }
      >
        {body.kind === "ready" ? (
          <div className="text-base sm:text-sm">
            {body.emptyMessage === null ? (
              body.rows.map((row) => (
                <LicenseNoticeRow
                  key={row.id}
                  row={row}
                  onOpenChange={(open) => {
                    const decision = resolveOpenSourceLicensesAction({
                      kind: "toggle-entry",
                      entryKey: row.id,
                      open,
                    });
                    if (decision.kind === "set-open-entry") setOpenEntryKey(decision.entryKey);
                  }}
                />
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm/6 text-muted-foreground sm:px-4">
                {body.emptyMessage}
              </p>
            )}
          </div>
        ) : body.kind === "error" ? (
          <LicenseManifestError
            title={body.title}
            message={body.message}
            retryLabel={body.retryLabel}
            onRetry={retry}
          />
        ) : (
          <p className="px-3 py-5 text-sm/6 text-muted-foreground sm:px-4">{body.message}</p>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
