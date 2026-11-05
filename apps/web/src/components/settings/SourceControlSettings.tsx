import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

import {
  AzureDevOpsIcon,
  BitbucketIcon,
  GitHubIcon,
  GitIcon,
  GitLabIcon,
  ForgejoIcon,
  JujutsuIcon,
  type Icon,
} from "../Icons";
import { BitbucketCredentialsSettings } from "./BitbucketCredentialsSettings";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SourceControlWritingSettingsSection } from "./SourceControlWritingSettings";
import {
  buildGitFetchIntervalModel,
  buildSourceControlSettingsModel,
  resolveGitFetchIntervalChange,
  resolveGitFetchIntervalReset,
  resolveSourceControlDiscoveryEnvironmentId,
  shouldExpandSourceControlRowForSearchTarget,
  SOURCE_CONTROL_ACCOUNT_REDACTION,
  type SourceControlDiscoveryRowModel,
  type SourceControlItemIcon,
  type SourceControlItemSummary,
  type SourceControlEmptyDiscoveryModel,
  type SourceControlSkeletonSectionModel,
  type SourceControlStatusTone,
} from "./SourceControlSettings.logic";
import {
  PolicyTooltip,
  SettingResetButton,
  SettingsPageContainer,
  SettingsSearchTarget,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

const SOURCE_CONTROL_ICONS: Record<SourceControlItemIcon, Icon> = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  forgejo: ForgejoIcon,
  "azure-devops": AzureDevOpsIcon,
  bitbucket: BitbucketIcon,
  git: GitIcon,
  jj: JujutsuIcon,
};

const STATUS_DOT_CLASS_NAMES: Record<SourceControlStatusTone, string> = {
  muted: "bg-muted-foreground/35",
  warning: "bg-warning",
  success: "bg-success",
};

function RedactedAccount(props: { readonly account: string | null }) {
  return (
    <RedactedSensitiveText
      value={props.account}
      ariaLabel={SOURCE_CONTROL_ACCOUNT_REDACTION.ariaLabel}
      revealTooltip={SOURCE_CONTROL_ACCOUNT_REDACTION.revealTooltip}
      hideTooltip={SOURCE_CONTROL_ACCOUNT_REDACTION.hideTooltip}
    />
  );
}

function SourceControlItemMark({ row }: { readonly row: SourceControlDiscoveryRowModel }) {
  const dotClassName = STATUS_DOT_CLASS_NAMES[row.statusTone];
  const Icon = row.icon === null ? undefined : SOURCE_CONTROL_ICONS[row.icon];

  if (!Icon) {
    return <span className={cn("size-2 shrink-0 rounded-full", dotClassName)} aria-hidden />;
  }

  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
      <Icon className="size-4.5 text-foreground/80" aria-hidden />
      <span
        className={cn(
          "pointer-events-none absolute -left-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
          dotClassName,
        )}
        aria-hidden
      />
    </span>
  );
}

function ItemSummary({ summary }: { readonly summary: SourceControlItemSummary }) {
  if (summary.kind === "authenticated") {
    return (
      <>
        <span>{summary.text}</span>
        {summary.account ? (
          <>
            <span aria-hidden>{summary.accountPrefix}</span>
            <RedactedAccount account={summary.account} />
          </>
        ) : null}
      </>
    );
  }

  if (summary.kind === "cli-sign-in") {
    return (
      <span>
        {summary.before}
        <code className="rounded bg-muted px-1 py-px text-2xs">{summary.executable}</code>
        {summary.after}
      </span>
    );
  }

  return <span>{summary.text}</span>;
}

function DiscoveryItemRow({
  row,
  children,
}: {
  readonly row: SourceControlDiscoveryRowModel;
  readonly children?: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = children !== undefined;
  const searchTargetId = useSettingsSearchTargetId();
  const expandForSearchTarget = shouldExpandSourceControlRowForSearchTarget(row, searchTargetId);

  useEffect(() => {
    if (expandForSearchTarget) {
      setIsExpanded(true);
    }
  }, [expandForSearchTarget]);

  return (
    <div
      className={cn(
        "first:rounded-t-xl last:rounded-b-xl transition-colors hover:bg-muted/20",
        row.comingSoon && "opacity-80",
      )}
    >
      <div className="px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SourceControlItemMark row={row} />
              <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
              {row.version ? (
                <code className="text-xs text-muted-foreground">{row.version}</code>
              ) : null}
              {row.badges.map((badge) => (
                <Badge key={badge.label} variant={badge.variant} size="sm">
                  {badge.label}
                </Badge>
              ))}
            </div>
            <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-normal text-muted-foreground/80">
              <ItemSummary summary={row.summary} />
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {hasDetails ? (
              <Button
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => setIsExpanded((open) => !open)}
                aria-expanded={isExpanded}
                aria-label={row.toggleDetailsAriaLabel}
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
                />
              </Button>
            ) : null}
            {row.showAvailabilitySwitch ? (
              <Switch checked={row.enabled} disabled aria-label={row.availabilityAriaLabel} />
            ) : null}
          </div>
        </div>
      </div>

      {hasDetails ? (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent>
            <div className="px-3 pb-4 pt-1 sm:px-4">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function GitFetchIntervalSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const model = buildGitFetchIntervalModel({ settings });

  return (
    <SettingsSearchTarget id={model.id} className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="text-xs font-medium text-foreground">{model.title}</span>
            <PolicyTooltip>{model.policyTooltip}</PolicyTooltip>
            <span
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center transition-opacity",
                model.canReset ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              aria-hidden={!model.canReset}
            >
              {model.canReset ? (
                <SettingResetButton
                  label={model.resetLabel}
                  onClick={() =>
                    updateSettings(resolveGitFetchIntervalReset(settings.backgroundActivity))
                  }
                />
              ) : null}
            </span>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {model.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NumberField
            value={model.valueSeconds}
            min={model.minSeconds}
            step={model.stepSeconds}
            size="sm"
            className="w-32"
            onValueChange={(value) =>
              updateSettings(resolveGitFetchIntervalChange(settings.backgroundActivity, value))
            }
          >
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label={model.decrementAriaLabel} />
              <NumberFieldInput aria-label={model.inputAriaLabel} />
              <NumberFieldIncrement aria-label={model.incrementAriaLabel} />
            </NumberFieldGroup>
          </NumberField>
          <span className="text-xs text-muted-foreground">{model.unitLabel}</span>
        </div>
      </div>
    </SettingsSearchTarget>
  );
}

function SourceControlSectionSkeleton({
  section,
  headerAction,
}: {
  readonly section: SourceControlSkeletonSectionModel;
  readonly headerAction?: ReactNode;
}) {
  return (
    <SettingsSection title={section.title} headerAction={headerAction}>
      {section.rowKeys.map((row) => (
        <div key={row} className="first:rounded-t-xl last:rounded-b-xl px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                  <Skeleton className="size-4.5" />
                  <Skeleton
                    shape="pill"
                    className="pointer-events-none absolute -left-0.5 -top-0.5 size-2"
                    aria-hidden
                  />
                </span>
                <Skeleton shape="pill" className="h-4 w-28" />
                <Skeleton shape="pill" className="h-5 w-14" />
              </div>
              <Skeleton shape="pill" className="h-3 w-full max-w-xs" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="size-7" />
              <Skeleton shape="pill" className="h-5 w-9" />
            </div>
          </div>
        </div>
      ))}
    </SettingsSection>
  );
}

function EmptySourceControlDiscovery({
  view,
  onScan,
}: {
  readonly view: SourceControlEmptyDiscoveryModel;
  readonly onScan: () => void;
}) {
  return (
    <SettingsSection id={view.sectionId} title={view.title}>
      <Empty>
        <EmptyMedia variant="icon">
          <PullRequestGlyph.pullRequest />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>{view.emptyTitle}</EmptyTitle>
          <EmptyDescription>{view.emptyDescription}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onScan} disabled={view.scanDisabled}>
            <RefreshIcon size="sm" refreshing={view.scanning} />
            {view.scanLabel}
          </Button>
        </EmptyContent>
      </Empty>
    </SettingsSection>
  );
}

export function SourceControlSettingsPanel() {
  const { scope, environment, connectedEnvironments } = useSettingsScope();
  // Discovery scans one machine's tools, so it shows the representative
  // environment (named in the section title when several are selected);
  // the settings rows above it fan out like everywhere else.
  const discoveryEnvironmentId = resolveSourceControlDiscoveryEnvironmentId(environment);
  const discovery = useEnvironmentQuery(
    discoveryEnvironmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: discoveryEnvironmentId,
          input: {},
        }),
  );
  const model = useMemo(
    () =>
      buildSourceControlSettingsModel({
        environment,
        scopeEnvironmentCount: scope.environmentIds.length,
        connectedEnvironmentCount: connectedEnvironments.length,
        discovery: {
          data: discovery.data,
          isPending: discovery.isPending,
          error: discovery.error,
        },
      }),
    [
      environment,
      scope.environmentIds.length,
      connectedEnvironments.length,
      discovery.data,
      discovery.isPending,
      discovery.error,
    ],
  );
  const { environmentId, view } = model;
  const handleScan = () => {
    discovery.refresh();
  };
  const scanButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            onClick={handleScan}
            disabled={model.scanButton.disabled}
            aria-label={model.scanButton.ariaLabel}
          >
            <RefreshIcon refreshing={model.scanButton.refreshing} />
          </Button>
        }
      />
      <TooltipPopup side="top">{model.scanButton.tooltip}</TooltipPopup>
    </Tooltip>
  );

  return (
    <SettingsPageContainer>
      <ProjectDefaultsSettings category="source-control" />
      {view.kind === "disconnected" ? (
        <SettingsSection id={view.sectionId} title={view.title}>
          <p className="px-4 py-3 text-sm text-muted-foreground">{view.message}</p>
        </SettingsSection>
      ) : view.kind === "scanning" ? (
        <>
          {view.sections.map((section) => (
            <SourceControlSectionSkeleton
              key={section.key}
              section={section}
              headerAction={section.showScanButton ? scanButton : undefined}
            />
          ))}
        </>
      ) : view.kind === "discovered" ? (
        <>
          {view.sections.map((section) => (
            <SettingsSection
              key={section.key}
              id={section.id ?? undefined}
              title={section.title}
              headerAction={section.showScanButton ? scanButton : null}
            >
              {section.rows.map((row) => (
                <DiscoveryItemRow key={row.id} row={row}>
                  {row.details?.kind === "git-fetch-interval" ? (
                    <GitFetchIntervalSettings />
                  ) : row.details?.kind === "bitbucket-credentials" && environmentId !== null ? (
                    <SettingsSearchTarget id={row.details.searchTargetId}>
                      <BitbucketCredentialsSettings
                        // Drafts belong to one environment; switching must not carry them over.
                        key={environmentId}
                        environmentId={environmentId}
                        onSaved={handleScan}
                      />
                    </SettingsSearchTarget>
                  ) : undefined}
                </DiscoveryItemRow>
              ))}
            </SettingsSection>
          ))}
        </>
      ) : (
        <EmptySourceControlDiscovery view={view} onScan={handleScan} />
      )}

      <SourceControlWritingSettingsSection />
    </SettingsPageContainer>
  );
}
