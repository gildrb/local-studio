"use client";

import { Spinner } from "~/components/ui/spinner";

import {
  AlertTriangleIcon,
  ArrowUpCircleIcon,
  CopyIcon,
  DownloadIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type {
  ProviderInstanceConfig,
  ProviderInstanceEnvironmentVariable,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { DriverOption } from "./providerDriverMeta";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import { ProviderModelsSection } from "./ProviderModelsSection";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import {
  buildProviderEnvironmentModel,
  buildProviderInstanceCardModel,
  makeProviderEnvironmentDraftRow,
  resolveProviderEnvironmentChange,
  resolveProviderInstanceCardAction,
  shouldResetProviderEnvironmentDrafts,
  type ProviderEnvironmentChange,
  type ProviderEnvironmentDraftRow,
  type ProviderInstanceCardAction,
  type ProviderUpdateCommandCopyToast,
} from "./ProviderInstanceCard.logic";
import { PROVIDER_STATUS_STYLES } from "./providerStatus";

function ProviderStatusDiagnostic({
  detail,
  children,
}: {
  detail: string | null;
  children: ReactElement;
}) {
  if (!detail) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="top">{detail}</TooltipPopup>
    </Tooltip>
  );
}

let environmentVariableDraftId = 0;
const nextEnvironmentVariableDraftId = () => `provider-env-${environmentVariableDraftId++}`;

function ProviderEnvironmentSection(props: {
  readonly environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly onChange: (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => void;
}) {
  const [rows, setRows] = useState<ReadonlyArray<ProviderEnvironmentDraftRow>>(() =>
    props.environment.map(makeProviderEnvironmentDraftRow),
  );
  const previousEnvironmentRef = useRef(props.environment);
  const lastPublishedEnvironmentRef = useRef<
    ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined
  >(undefined);

  useEffect(() => {
    const previousEnvironment = previousEnvironmentRef.current;
    const lastPublishedEnvironment = lastPublishedEnvironmentRef.current;
    previousEnvironmentRef.current = props.environment;
    lastPublishedEnvironmentRef.current = undefined;
    if (
      !shouldResetProviderEnvironmentDrafts({
        previous: previousEnvironment,
        next: props.environment,
        lastPublished: lastPublishedEnvironment,
      })
    ) {
      return;
    }
    setRows(props.environment.map(makeProviderEnvironmentDraftRow));
  }, [props.environment]);

  const applyChange = (change: ProviderEnvironmentChange) => {
    const result = resolveProviderEnvironmentChange(rows, change);
    setRows(result.rows);
    if (result.published === null) return;
    lastPublishedEnvironmentRef.current = result.published;
    props.onChange(result.published);
  };

  const model = buildProviderEnvironmentModel(rows);

  return (
    <SettingsRow
      title={model.title}
      description={model.description}
      control={
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => applyChange({ kind: "add", id: nextEnvironmentVariableDraftId() })}
        >
          <PlusIcon className="size-3" />
          {model.addLabel}
        </Button>
      }
    >
      {model.rows.length > 0 ? (
        <div className="mt-3 min-w-0 space-y-2 pb-2">
          {model.rows.map((variable) => (
            <div key={variable.id} className="flex min-w-0 flex-wrap items-center gap-1.5">
              <DraftInput
                size="sm"
                font="mono"
                className="w-full min-w-0 sm:w-44 sm:shrink-0"
                value={variable.name}
                onCommit={(name) => applyChange({ kind: "setName", id: variable.id, name })}
                placeholder={variable.namePlaceholder}
                spellCheck={false}
                aria-label={variable.nameAriaLabel}
              />
              <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden>
                =
              </span>
              <DraftInput
                size="sm"
                font="mono"
                className="min-w-0 flex-1"
                value={variable.value}
                onCommit={(value) => applyChange({ kind: "setValue", id: variable.id, value })}
                type={variable.valueInputType ?? undefined}
                autoComplete="off"
                placeholder={variable.valuePlaceholder}
                spellCheck={false}
                aria-label={variable.valueAriaLabel}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-micro"
                      variant="ghost-muted"
                      onClick={() => applyChange({ kind: "toggleSensitive", id: variable.id })}
                      aria-pressed={variable.sensitive}
                      aria-label={variable.sensitivityAriaLabel}
                    >
                      {variable.sensitivityIcon === "lock" ? (
                        <LockIcon className="size-3" />
                      ) : (
                        <LockOpenIcon className="size-3" />
                      )}
                    </Button>
                  }
                />
                <TooltipPopup side="top">{variable.sensitivityTooltip}</TooltipPopup>
              </Tooltip>
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-destructive"
                onClick={() => applyChange({ kind: "remove", id: variable.id })}
                aria-label={variable.removeAriaLabel}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{model.footnote}</p>
        </div>
      ) : null}
    </SettingsRow>
  );
}

interface ProviderInstanceCardProps {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driverOption: DriverOption | undefined;
  readonly liveProvider: ServerProvider | undefined;
  readonly mode: "list" | "editor";
  readonly selected?: boolean | undefined;
  readonly onSelect?: (() => void) | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onUpdate: (nextInstance: ProviderInstanceConfig) => void;
  /**
   * Pass `undefined` to hide the delete footer entirely. Built-in default
   * instance slots use `undefined` — they can't be deleted without losing
   * the slot, and their "reset to defaults" affordance lives on an outer
   * reset button instead. Explicit `| undefined` in the type accommodates
   * `exactOptionalPropertyTypes: true`, where an absent key and
   * `{ onDelete: undefined }` are treated as distinct shapes.
   */
  readonly onDelete?: (() => void) | undefined;
  /**
   * Optional outer reset button rendered next to the driver icon. Built-in
   * default slots supply a reset-to-factory control here; custom instances
   * omit it.
   */
  readonly headerAction?: ReactNode | undefined;
  readonly setup?: ReactNode;
  readonly runtime?: ReactNode;
  readonly hiddenModels: ReadonlyArray<string>;
  readonly favoriteModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
  readonly onHiddenModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onFavoriteModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onModelOrderChange: (next: ReadonlyArray<string>) => void;
  readonly onRunUpdate?: (() => void) | undefined;
  readonly onInstallRecommended?: (() => void) | undefined;
  readonly isUpdating?: boolean | undefined;
}

/**
 * Renders one provider instance as either a compact selectable list row or
 * the full editor shown beside that list. Both modes use the same enabled
 * state and provider metadata.
 *
 * Behavior notes:
 *   - `liveProvider` is matched by the caller via `instanceId`; when no
 *     match is available (e.g. the server hasn't probed yet, or the
 *     driver is not shipped by the current build) the card still renders
 *     with a neutral "checking" summary.
 *   - Unknown drivers (`driverOption === undefined`) get a read-only
 *     notice instead of editable fields, so fork instances round-trip
 *     without accidentally destroying their config.
 *   - The enabled Switch writes to the envelope's `instance.enabled`
 *     field, which is the single enabled flag: the server folds any legacy
 *     driver-specific `config.enabled` into the envelope on load and both
 *     sides resolve through `resolveProviderInstanceEnabled` (an explicit
 *     false wins, then envelope, then config, then the driver default).
 */
export function ProviderInstanceCard({
  instanceId,
  instance,
  driverOption,
  liveProvider,
  mode,
  selected = false,
  onSelect,
  readOnly = false,
  onUpdate,
  onDelete,
  headerAction,
  setup,
  runtime,
  hiddenModels,
  favoriteModels,
  modelOrder,
  onHiddenModelsChange,
  onFavoriteModelsChange,
  onModelOrderChange,
  onRunUpdate,
  onInstallRecommended,
  isUpdating = false,
}: ProviderInstanceCardProps) {
  const canDelete = onDelete !== undefined;
  const canRunUpdate = onRunUpdate !== undefined;
  const canInstallRecommended = onInstallRecommended !== undefined;
  const model = useMemo(
    () =>
      buildProviderInstanceCardModel({
        instanceId,
        instance,
        driverOption,
        liveProvider,
        readOnly,
        isUpdating,
        canDelete,
        canRunUpdate,
        canInstallRecommended,
      }),
    [
      instanceId,
      instance,
      driverOption,
      liveProvider,
      readOnly,
      isUpdating,
      canDelete,
      canRunUpdate,
      canInstallRecommended,
    ],
  );
  const { displayName, enabled, status, versionLabel, versionAdvisory } = model;
  const updateCommand = versionAdvisory?.updateCommand ?? null;
  const hasCompatibilityWarning = versionAdvisory?.compatibilityWarning ?? false;
  const VersionAdvisoryIcon =
    versionAdvisory?.icon === "alert-triangle" ? AlertTriangleIcon : ArrowUpCircleIcon;
  const onRunVersionAction =
    versionAdvisory?.action?.kind === "installRecommended"
      ? onInstallRecommended
      : versionAdvisory?.action?.kind === "runUpdate"
        ? onRunUpdate
        : undefined;
  const FallbackIconComponent = driverOption?.icon;
  const { copyToClipboard } = useCopyToClipboard<ProviderUpdateCommandCopyToast>({
    onCopy: (toast) => {
      toastManager.add({
        type: "success",
        title: toast.successTitle,
        description: toast.successDescription,
      });
    },
    onError: (error, toast) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: toast.errorTitle,
          description: error.message,
        }),
      );
    },
  });

  const update = (action: ProviderInstanceCardAction) =>
    onUpdate(resolveProviderInstanceCardAction(instance, action));

  const icon = model.icon;
  const titleIconNode =
    icon.kind === "driver" ? (
      <ProviderInstanceIcon
        driverKind={icon.driverKind}
        displayName={displayName}
        accentColor={icon.accentColor ?? undefined}
        showBadge={icon.showBadge}
        className="size-5"
        iconClassName="size-4 text-foreground/80"
        badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
      />
    ) : icon.kind === "driverOption" && FallbackIconComponent ? (
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        <FallbackIconComponent className="size-4 text-foreground/80" aria-hidden />
      </span>
    ) : (
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center text-3xs font-semibold leading-none text-foreground/80"
        aria-hidden
      >
        {icon.kind === "initials" ? icon.initials : null}
      </span>
    );

  const titleTailNode = headerAction ? (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{headerAction}</span>
  ) : null;

  const versionCodeNode = versionLabel ? (
    <code className="text-xs text-muted-foreground">{versionLabel}</code>
  ) : null;

  // Healthy and disabled rows read fine from their text; only trouble gets a dot.
  const statusDotNode = status.needsAttention ? (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_STYLES[status.key].dot)}
      aria-hidden
    />
  ) : null;
  const editorStatusNode = status.authenticatedAs ? (
    <>
      {status.needsAttention ? statusDotNode : null}
      <span>Authenticated as</span>
      <RedactedSensitiveText
        value={status.authenticatedAs.email}
        ariaLabel={status.authenticatedAs.emailAriaLabel}
        revealTooltip={status.authenticatedAs.emailRevealTooltip}
        hideTooltip={status.authenticatedAs.emailHideTooltip}
        className="max-w-full truncate"
      />
      {status.authenticatedAs.authLabel ? <span>· {status.authenticatedAs.authLabel}</span> : null}
      {status.inlineDetail ? (
        <span className="min-w-0 [overflow-wrap:anywhere]">· {status.inlineDetail}</span>
      ) : null}
    </>
  ) : (
    <>
      {statusDotNode}
      <span>{status.headline}</span>
      {status.inlineDetail ? (
        <span className="min-w-0 [overflow-wrap:anywhere]">· {status.inlineDetail}</span>
      ) : null}
    </>
  );
  if (mode === "list") {
    return (
      <div
        data-slot="settings-row"
        className={cn(
          "group flex min-h-18 items-center gap-3 px-3 py-3 transition-colors sm:px-4",
          selected ? "bg-muted/45" : "hover:bg-muted/25",
        )}
      >
        <div
          className={cn(
            "pointer-events-none relative flex min-w-0 flex-1 items-start gap-3 rounded-md text-left transition-opacity",
            !enabled && !selected && "opacity-60 group-hover:opacity-100",
          )}
        >
          <button
            type="button"
            className="pointer-events-auto absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onSelect}
            aria-label={model.selectAriaLabel}
            aria-pressed={selected}
          />
          {titleIconNode}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
              {versionLabel ? (
                <code className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                  {versionLabel}
                </code>
              ) : null}
              {versionAdvisory ? (
                versionAdvisory.listIndicator === "compatibility" ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          role="img"
                          aria-label={versionAdvisory.title}
                          className="pointer-events-auto relative inline-flex shrink-0 text-warning"
                        >
                          <VersionAdvisoryIcon className="size-3.5" />
                        </span>
                      }
                    />
                    <TooltipPopup side="top">{versionAdvisory.detail}</TooltipPopup>
                  </Tooltip>
                ) : versionAdvisory.listIndicator === "copyCommand" && updateCommand ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-micro"
                          variant="ghost-muted"
                          className="pointer-events-auto relative shrink-0"
                          aria-label={versionAdvisory.listCopyCommandAriaLabel}
                          onClick={() =>
                            copyToClipboard(updateCommand, model.updateCommandCopyToast)
                          }
                        >
                          <ArrowUpCircleIcon className="size-3.5" />
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">{versionAdvisory.listCopyCommandTooltip}</TooltipPopup>
                  </Tooltip>
                ) : (
                  <span
                    role="img"
                    aria-label={versionAdvisory.updateAvailableAriaLabel}
                    className="inline-flex shrink-0"
                  >
                    <ArrowUpCircleIcon className="size-3.5 text-muted-foreground" />
                  </span>
                )
              ) : null}
            </span>
            <span className="mt-0.5 flex items-start gap-1.5 text-xs leading-normal text-muted-foreground/80">
              {statusDotNode ? (
                <span className="flex h-[1.45em] shrink-0 items-center">{statusDotNode}</span>
              ) : null}
              <ProviderStatusDiagnostic detail={status.diagnostic}>
                <span
                  tabIndex={status.diagnostic ? 0 : undefined}
                  className="pointer-events-auto line-clamp-2 [overflow-wrap:anywhere]"
                >
                  {status.headline}
                  {status.listDetail ? ` · ${status.listDetail}` : null}
                </span>
              </ProviderStatusDiagnostic>
            </span>
          </span>
        </div>
        <span className="flex h-5 shrink-0 items-center">
          <Switch
            checked={model.enableSwitch.checked}
            disabled={model.enableSwitch.disabled}
            onCheckedChange={(checked) => update({ kind: "setEnabled", value: Boolean(checked) })}
            aria-label={model.enableSwitch.ariaLabel}
          />
        </span>
      </div>
    );
  }

  const editorHeaderAction = (
    <div className="flex shrink-0 items-center gap-1.5">
      {model.badgeLabel ? (
        <Badge variant="warning" size="sm" className="shrink-0">
          {model.badgeLabel}
        </Badge>
      ) : null}
      {versionCodeNode}
      <span
        inert={readOnly}
        aria-disabled={readOnly || undefined}
        className={cn("inline-flex items-center gap-1", readOnly && "opacity-50")}
      >
        {versionAdvisory ? (
          <Popover>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={versionAdvisory.detailsAriaLabel}
                      >
                        <VersionAdvisoryIcon
                          className={cn(hasCompatibilityWarning && "text-warning")}
                        />
                      </Button>
                    }
                  />
                }
              />
              <TooltipPopup side="top">{versionAdvisory.title}</TooltipPopup>
            </Tooltip>
            <PopoverPopup side="bottom" align="end" width="md">
              <div className="grid min-w-0 gap-3">
                <div className="grid gap-0.5">
                  <p className="text-sm font-semibold leading-tight text-foreground">
                    {versionAdvisory.title}
                  </p>
                  <p
                    className={cn(
                      "text-xs leading-snug",
                      versionAdvisory.emphasis === "strong"
                        ? "text-warning"
                        : "text-muted-foreground",
                    )}
                  >
                    {versionAdvisory.detail}
                  </p>
                </div>
                {versionAdvisory.action && onRunVersionAction ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="w-full"
                    disabled={versionAdvisory.action.disabled}
                    onClick={onRunVersionAction}
                  >
                    {versionAdvisory.action.busy ? <Spinner /> : <DownloadIcon />}
                    {versionAdvisory.action.label}
                  </Button>
                ) : null}
                {versionAdvisory.manualUpdateDividerLabel ? (
                  <div className="flex items-center gap-2 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
                    <span aria-hidden className="h-px flex-1 bg-border" />
                    {versionAdvisory.manualUpdateDividerLabel}
                    <span aria-hidden className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                {updateCommand ? (
                  <div className="flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 py-0.5 pr-0.5 pl-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground">
                      {updateCommand}
                    </code>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost-muted"
                            className="shrink-0"
                            onClick={() =>
                              copyToClipboard(updateCommand, model.updateCommandCopyToast)
                            }
                            aria-label={versionAdvisory.copyCommandAriaLabel}
                          >
                            <CopyIcon className="size-3" />
                          </Button>
                        }
                      />
                      <TooltipPopup side="top">{versionAdvisory.copyCommandTooltip}</TooltipPopup>
                    </Tooltip>
                  </div>
                ) : null}
              </div>
            </PopoverPopup>
          </Popover>
        ) : null}
        {titleTailNode}
        {model.deleteAction ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-destructive"
            disabled={model.deleteAction.disabled}
            onClick={onDelete}
            aria-label={model.deleteAction.ariaLabel}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </span>
    </div>
  );

  const runtimeFields =
    model.runtime.kind === "form" && driverOption ? (
      <ProviderSettingsForm
        definition={driverOption}
        value={instance.config}
        idPrefix={model.runtime.idPrefix}
        variant="settings"
        onChange={(config) => update({ kind: "setConfig", config })}
      />
    ) : model.runtime.kind === "unknownDriver" ? (
      <SettingsRow
        title={model.runtime.title}
        description={
          <span>
            {model.runtime.descriptionPrefix}
            <code className="text-foreground">{model.runtime.driver}</code>
            {model.runtime.descriptionSuffix}
          </span>
        }
      />
    ) : null;

  return (
    <>
      <SettingsSection title={displayName} icon={titleIconNode} headerAction={editorHeaderAction}>
        <SettingsRow
          title={model.displayNameRow.title}
          status={
            <ProviderStatusDiagnostic detail={status.diagnostic}>
              <div
                tabIndex={status.diagnostic ? 0 : undefined}
                className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"
              >
                {editorStatusNode}
              </div>
            </ProviderStatusDiagnostic>
          }
          control={
            <div
              inert={readOnly}
              aria-disabled={readOnly || undefined}
              className={cn(
                "flex w-full min-w-0 items-center justify-end gap-2 @min-[32rem]/settings-row:w-auto",
                readOnly && "opacity-50 select-none",
              )}
            >
              <ProviderAccentColorPicker
                layout="inline"
                displayName={displayName}
                value={model.accentColor ?? undefined}
                onCommit={(value) => update({ kind: "setAccentColor", value })}
                commitDelayMs={120}
              />
              <DraftInput
                id={model.displayNameRow.inputId}
                size="sm"
                className="min-w-0 flex-1 @min-[32rem]/settings-row:w-56"
                value={model.displayNameRow.value}
                onCommit={(value) => update({ kind: "setDisplayName", value })}
                placeholder={model.displayNameRow.placeholder}
                spellCheck={false}
              />
            </div>
          }
        />
      </SettingsSection>

      {setup ? <SettingsSection title={model.setupSectionTitle}>{setup}</SettingsSection> : null}

      {model.runtimeSection.layout === "folded" ? (
        <div
          inert={readOnly}
          aria-disabled={readOnly || undefined}
          className={readOnly ? "opacity-50 select-none" : undefined}
        >
          <FoldedSettingsSection
            key={instanceId}
            id={model.runtimeSection.foldedId}
            title={model.runtimeSection.title}
            headerPlacement="outside"
          >
            {runtime ?? runtimeFields}
          </FoldedSettingsSection>
        </div>
      ) : (
        <SettingsSection
          title={model.runtimeSection.title}
          inert={readOnly}
          aria-disabled={readOnly || undefined}
          className={readOnly ? "opacity-50 select-none" : undefined}
        >
          {runtimeFields}
        </SettingsSection>
      )}

      <SettingsSection
        title={model.environmentSectionTitle}
        inert={readOnly}
        aria-disabled={readOnly || undefined}
        className={readOnly ? "opacity-50 select-none" : undefined}
      >
        <ProviderEnvironmentSection
          environment={model.environment}
          onChange={(environment) => update({ kind: "setEnvironment", environment })}
        />
      </SettingsSection>

      {model.modelsSection ? (
        <SettingsSection
          title={model.modelsSection.title}
          inert={readOnly}
          aria-disabled={readOnly || undefined}
          className={readOnly ? "opacity-50 select-none" : undefined}
        >
          <div className="px-3 py-3 sm:px-4">
            <p className="mb-3 text-xs text-muted-foreground">{model.modelsSection.description}</p>
            <ProviderModelsSection
              instanceId={instanceId}
              driverKind={model.driverKind}
              models={model.modelsSection.models}
              customModels={model.modelsSection.customModels}
              hiddenModels={hiddenModels}
              favoriteModels={favoriteModels}
              modelOrder={modelOrder}
              onChange={(customModels) => update({ kind: "setCustomModels", customModels })}
              onHiddenModelsChange={onHiddenModelsChange}
              onFavoriteModelsChange={onFavoriteModelsChange}
              onModelOrderChange={onModelOrderChange}
            />
          </div>
        </SettingsSection>
      ) : null}
    </>
  );
}
