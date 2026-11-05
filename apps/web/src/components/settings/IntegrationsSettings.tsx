import { DeviceHostUpdates } from "../device/DeviceHostUpdates";
import { DeviceToolVersions } from "../device/DeviceToolVersions";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { ScopedSwitch } from "./ScopedSwitch";
import { DeviceHostsSettings } from "./DeviceHostsSettings";
/**
 * Integrations settings - preferences for surfaces T3 Code embeds rather than
 * owns. Browser is the first section: the defaults a preview tab opens at,
 * applied to both hand-opened tabs and agent `preview_open` calls that don't
 * state their own size.
 *
 * @module IntegrationsSettings
 */
import type { BrowserImportSource, EnvironmentId } from "@t3tools/contracts";
import { MoreVertical, Plus as PlusIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ScreenRotationIcon } from "~/browser/ScreenRotationIcon";
import { AnimatedHeight } from "~/components/AnimatedHeight";
import { resolveEnvironmentOptionLabel } from "~/components/BranchToolbar.logic";
import { previewBridge } from "~/components/preview/previewBridge";
import { cn, randomUUID } from "~/lib/utils";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { deviceEnvironment, useDeviceState } from "~/state/device";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  AgentDeviceSetupStatus,
  DeviceHubSetupStatus,
  PlatformStatus,
} from "~/components/device/DeviceSetup";
import {
  agentDeviceDescription,
  deviceHubDescription,
  platformSetupStatus,
} from "~/components/device/DeviceSetup.logic";
import { isElectron } from "../../env";

import { Badge } from "../ui/badge";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getClientSettings,
  persistClientSettingsUpdate,
  useClientSettings,
  useClientSettingsHydrated,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";

import {
  SettingsUnavailableGroup,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { BrowserImportWizard, type WizardTarget } from "./BrowserImportWizard";
import type { ImportOutcome } from "./browserImportWizard.logic";
import {
  BROWSER_PROFILE_REMOVAL_FAILED_MESSAGE,
  DEVICE_TOOL_UPDATE_FAILED_MESSAGE,
  browserProfileRemovalPatch,
  buildBrowserAppearanceRowModel,
  buildBrowserAutoShowFloatingPreviewRowModel,
  buildBrowserLinkTargetRowModel,
  buildBrowserProfilesModel,
  buildBrowserRecordingFrameRateRowModel,
  buildBrowserRecordingInputRowModels,
  buildBrowserViewportRowModel,
  buildBrowserZoomRowModel,
  buildDeviceIntegrationModel,
  buildIntegrationsPageModel,
  clearBrowserProfileData,
  deviceConfigureRequest,
  deviceSettingsFailureToast,
  importFailureMessage,
  importFailureReason,
  resolveClearBrowserProfileData,
  resolveCreateBrowserProfile,
  resolveDeviceIntegrationToggle,
  resolveDeviceListRequest,
  resolveDevicePlatformsRevealed,
  resolveImportedProfileRegistration,
  resolveIntegrationsSettingsChange,
  resolveRemoveBrowserProfile,
  resolveRenameBrowserProfile,
  resolveSetDefaultBrowserProfile,
  resolveWizardImportBlock,
  wizardImportTargetMissing,
  type DeviceConfigureInput,
  type DeviceIntegrationPending,
  type DeviceListAction,
  type DeviceTool,
  type DeviceToolUpdateError,
  type IntegrationsPageModel,
  type IntegrationsResettableSetting,
  type IntegrationsSelectRowModel,
  type IntegrationsSettingsChange,
  type IntegrationsSwitchRowModel,
} from "./IntegrationsSettings.logic";

const NO_GROUPING: Intl.NumberFormatOptions = { useGrouping: false };

/** Thrown from the post-import settings updater when the cap was hit meanwhile. */
class ProfileLimitReachedError extends Error {
  constructor() {
    super("Browser profile limit reached.");
    this.name = "ProfileLimitReachedError";
  }
}

function useApplyIntegrationsChange() {
  const updateSettings = useUpdatePrimarySettings();
  return (change: IntegrationsSettingsChange) => {
    const patch = resolveIntegrationsSettingsChange(change);
    if (patch !== null) updateSettings(patch);
  };
}

function BrowserViewportSetting({ disabled }: { readonly disabled: boolean }) {
  const viewport = useClientSettings((settings) => settings.browserDefaultViewport);
  const applyChange = useApplyIntegrationsChange();
  const model = buildBrowserViewportRowModel({ viewport, disabled });

  return (
    <SettingsRow
      id={model.id}
      title={model.title}
      description={model.description}
      resetAction={
        model.reset ? (
          <SettingResetButton
            label={model.reset.label}
            onClick={() => applyChange({ kind: "reset", setting: "browserDefaultViewport" })}
          />
        ) : null
      }
      control={
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <Select
            value={model.value}
            onValueChange={(value) =>
              applyChange({ kind: "viewportSelect", current: viewport, value })
            }
            disabled={model.disabled}
          >
            <SelectTrigger
              size="sm"
              className="w-full min-w-0 sm:w-44"
              aria-label={model.ariaLabel}
            >
              <SelectValue>{model.valueLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {model.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
              <SelectGroup>
                <SelectGroupLabel>{model.presetGroup.label}</SelectGroupLabel>
                {model.presetGroup.options.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    <span className="flex w-full items-center justify-between gap-5">
                      <span>{preset.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {preset.description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>

          {model.size ? (
            <div className="flex min-w-0 items-center gap-1">
              <NumberField
                value={model.size.width}
                min={model.size.min}
                max={model.size.max}
                disabled={model.disabled}
                // Pixel counts read as raw numbers; grouping would show "1,024".
                format={NO_GROUPING}
                size="sm"
                className="w-20"
                onValueCommitted={(value) =>
                  applyChange({
                    kind: "viewportDimension",
                    current: viewport,
                    axis: "width",
                    value,
                  })
                }
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label={model.size.widthAriaLabel} />
                </NumberFieldGroup>
              </NumberField>
              <span className="text-xs text-muted-foreground">{model.size.separator}</span>
              <NumberField
                value={model.size.height}
                min={model.size.min}
                max={model.size.max}
                disabled={model.disabled}
                format={NO_GROUPING}
                size="sm"
                className="w-20"
                onValueCommitted={(value) =>
                  applyChange({
                    kind: "viewportDimension",
                    current: viewport,
                    axis: "height",
                    value,
                  })
                }
              >
                <NumberFieldGroup>
                  <NumberFieldInput aria-label={model.size.heightAriaLabel} />
                </NumberFieldGroup>
              </NumberField>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      disabled={model.disabled}
                      aria-label={model.size.rotate.ariaLabel}
                      onClick={() => applyChange({ kind: "viewportRotate", current: viewport })}
                    >
                      <ScreenRotationIcon />
                    </Button>
                  }
                />
                <TooltipPopup side="top">{model.size.rotate.tooltip}</TooltipPopup>
              </Tooltip>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

function BrowserSelectRow({
  model,
  resetSetting,
  toChange,
}: {
  readonly model: IntegrationsSelectRowModel;
  readonly resetSetting: IntegrationsResettableSetting;
  readonly toChange: (value: string | null) => IntegrationsSettingsChange;
}) {
  const applyChange = useApplyIntegrationsChange();

  return (
    <SettingsRow
      id={model.id}
      title={model.title}
      description={model.description}
      resetAction={
        model.reset ? (
          <SettingResetButton
            label={model.reset.label}
            onClick={() => applyChange({ kind: "reset", setting: resetSetting })}
          />
        ) : null
      }
      control={
        <Select
          disabled={model.disabled}
          value={model.value}
          onValueChange={(value) => applyChange(toChange(value))}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={model.ariaLabel}>
            <SelectValue>{model.valueLabel}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {model.options.map((option) => (
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function BrowserSwitchRow({
  model,
  resetSetting,
  toChange,
}: {
  readonly model: IntegrationsSwitchRowModel;
  readonly resetSetting?: IntegrationsResettableSetting;
  readonly toChange: (checked: boolean) => IntegrationsSettingsChange;
}) {
  const applyChange = useApplyIntegrationsChange();

  return (
    <SettingsRow
      id={model.id}
      title={model.title}
      description={model.description}
      {...(resetSetting === undefined
        ? {}
        : {
            resetAction: model.reset ? (
              <SettingResetButton
                label={model.reset.label}
                onClick={() => applyChange({ kind: "reset", setting: resetSetting })}
              />
            ) : null,
          })}
      control={
        <Switch
          disabled={model.disabled}
          checked={model.checked}
          aria-label={model.ariaLabel}
          onCheckedChange={(checked) => applyChange(toChange(Boolean(checked)))}
        />
      }
    />
  );
}

function BrowserZoomSetting({ disabled }: { readonly disabled: boolean }) {
  const zoomFactor = useClientSettings((settings) => settings.browserDefaultZoomFactor);
  return (
    <BrowserSelectRow
      model={buildBrowserZoomRowModel({ zoomFactor, disabled })}
      resetSetting="browserDefaultZoomFactor"
      toChange={(value) => ({ kind: "zoomSelect", value })}
    />
  );
}

function BrowserAppearanceSetting({ disabled }: { readonly disabled: boolean }) {
  const appearance = useClientSettings((settings) => settings.browserDefaultAppearance);
  return (
    <BrowserSelectRow
      model={buildBrowserAppearanceRowModel({ appearance, disabled })}
      resetSetting="browserDefaultAppearance"
      toChange={(value) => ({ kind: "appearanceSelect", value })}
    />
  );
}

function BrowserRecordingInputSettings({ disabled }: { readonly disabled: boolean }) {
  const showKeyPresses = useClientSettings((settings) => settings.browserRecordingShowKeyPresses);
  const showMousePresses = useClientSettings(
    (settings) => settings.browserRecordingShowMousePresses,
  );
  const [keyPresses, mousePresses] = buildBrowserRecordingInputRowModels({
    showKeyPresses,
    showMousePresses,
    disabled,
  });
  return (
    <>
      <BrowserSwitchRow
        model={keyPresses}
        toChange={(checked) => ({ kind: "recordingKeyPressesToggle", checked })}
      />
      <BrowserSwitchRow
        model={mousePresses}
        toChange={(checked) => ({ kind: "recordingMousePressesToggle", checked })}
      />
    </>
  );
}

function BrowserRecordingFrameRateSetting({ disabled }: { readonly disabled: boolean }) {
  const frameRate = useClientSettings((settings) => settings.browserRecordingFrameRate);
  return (
    <BrowserSelectRow
      model={buildBrowserRecordingFrameRateRowModel({ frameRate, disabled })}
      resetSetting="browserRecordingFrameRate"
      toChange={(value) => ({ kind: "frameRateSelect", value })}
    />
  );
}

function BrowserLinkTargetSetting({ disabled }: { readonly disabled: boolean }) {
  const linkTarget = useClientSettings((settings) => settings.browserLinkTarget);
  return (
    <BrowserSelectRow
      model={buildBrowserLinkTargetRowModel({ linkTarget, disabled })}
      resetSetting="browserLinkTarget"
      toChange={(value) => ({ kind: "linkTargetSelect", value })}
    />
  );
}

function DeviceIntegrationSettings({
  section,
}: {
  readonly section: IntegrationsPageModel["devices"];
}) {
  const { search, environment: selected } = useSettingsScope();
  const settings = useScopedSettings();
  const connected = selected?.connection.phase === "connected" && selected.serverConfig !== null;
  const environmentId = connected ? selected.environmentId : null;

  return (
    <SettingsSection id={section.id} title={section.title}>
      <DeviceIntegrationControls
        key={`${environmentId}:${JSON.stringify(search)}`}
        environmentId={environmentId}
        enabled={settings.enableDeviceSupport}
        agentAccessEnabled={settings.enableAgentDeviceAccess}
      />
    </SettingsSection>
  );
}

function DeviceIntegrationControls({
  environmentId,
  enabled,
  agentAccessEnabled,
}: {
  environmentId: EnvironmentId | null;
  enabled: boolean;
  agentAccessEnabled: boolean;
}) {
  const { state, loaded } = useDeviceState(environmentId);
  const { scope, environments, connectedEnvironments } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const anyHubEnabled = connectedEnvironments.some(
    (environment) => environment.serverConfig?.settings.enableDeviceSupport,
  );
  const configure = useAtomCommand(deviceEnvironment.configure, { reportFailure: false });
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const [pending, setPending] = useState<DeviceIntegrationPending | null>(null);
  const [platformsRevealed, setPlatformsRevealed] = useState(false);
  const nextPlatformsRevealed = resolveDevicePlatformsRevealed({
    platformsRevealed,
    enabled,
    hostStatus: state.hostStatus,
    pending,
  });
  if (nextPlatformsRevealed !== platformsRevealed) setPlatformsRevealed(nextPlatformsRevealed);
  const [updateError, setUpdateError] = useState<DeviceToolUpdateError | null>(null);
  const model = buildDeviceIntegrationModel({
    environmentId,
    enabled,
    agentAccessEnabled,
    loaded,
    state,
    projectScope,
    connectedEnvironments,
    anyHubEnabled,
    pending,
    updateError,
    platformsRevealed: nextPlatformsRevealed,
  });

  const update = async (kind: "hub" | "agent", input: DeviceConfigureInput) => {
    if (!environmentId) return;
    setPending(kind);
    try {
      const results = await Promise.allSettled(
        environments.map(async (environment) => {
          if (environment.connection.phase !== "connected" || !environment.serverConfig) {
            throw new Error("Environment disconnected");
          }
          return configure({
            environmentId: environment.environmentId,
            input: deviceConfigureRequest(input),
          });
        }),
      );
      const failed = environments.filter((_, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value._tag === "Failure";
      });
      if (failed.length > 0) {
        toastManager.add(
          deviceSettingsFailureToast(failed.map((environment) => environment.label)),
        );
      }
    } finally {
      setPending(null);
    }
  };

  const toggle = (target: DeviceTool, checked: boolean) => {
    const decision = resolveDeviceIntegrationToggle({ target, checked, projectScope });
    if (decision.kind === "scopedPatch") updateSettings(decision.patch);
    else void update(decision.pending, decision.input);
  };

  const runList = (action: DeviceListAction) => {
    if (!environmentId) return;
    const request = resolveDeviceListRequest(action);
    if (action.kind === "update") setUpdateError(null);
    setPending(request.pending);
    void list({ environmentId, input: request.input })
      .then((result) => {
        if (action.kind === "update" && result._tag === "Failure") {
          setUpdateError({ tool: action.tool, message: DEVICE_TOOL_UPDATE_FAILED_MESSAGE });
        }
      })
      .finally(() => setPending(null));
  };

  const versionActions = (tool: DeviceTool) => {
    const actions = tool === "hub" ? model.hub.toolActions : model.agent.toolActions;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {actions.update ? (
            <Button
              size="sm"
              disabled={actions.update.disabled}
              onClick={() => runList({ kind: "update", tool })}
            >
              {actions.update.label}
            </Button>
          ) : null}
          {actions.check ? (
            <Button
              size="sm"
              variant="outline"
              disabled={actions.check.disabled}
              onClick={() => runList({ kind: "inspect" })}
            >
              {actions.check.label}
            </Button>
          ) : null}
        </div>
        {actions.error !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {actions.error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <SettingsRow
        id={model.hub.id}
        title={model.hub.title}
        serverScoped
        settingKeys={model.hub.settingKeys}
        description={deviceHubDescription}
        control={
          <>
            <DeviceToolVersions
              action={versionActions("hub")}
              kind="hub"
              tools={model.localTools ?? undefined}
            />
            {model.hub.showSetupStatus ? (
              <DeviceHubSetupStatus state={state} pending compact />
            ) : null}
            <ScopedSwitch
              settingKeys={model.hub.settingKeys}
              checked={model.hub.checked}
              disabled={model.hub.disabled}
              aria-label={model.hub.ariaLabel}
              onCheckedChange={(checked) => toggle("hub", Boolean(checked))}
            />
          </>
        }
      />
      <AnimatedHeight>
        {model.platforms.visible ? (
          <SettingsRow
            id={model.platforms.id}
            title={model.platforms.title}
            description={model.platforms.description ?? undefined}
            status={
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <PlatformStatus compact platform="iOS" status={platformSetupStatus(state, "ios")} />
                <PlatformStatus
                  compact
                  platform="Android"
                  status={platformSetupStatus(state, "android")}
                />
              </div>
            }
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={model.platforms.refresh.disabled}
                onClick={() => runList({ kind: "refresh" })}
              >
                {model.platforms.refresh.label}
              </Button>
            }
          />
        ) : null}
      </AnimatedHeight>
      <SettingsRow
        id={model.agent.id}
        title={model.agent.title}
        serverScoped
        settingKeys={model.agent.settingKeys}
        description={agentDeviceDescription}
        control={
          <>
            <DeviceToolVersions
              action={versionActions("agent")}
              kind="agent"
              tools={model.localTools ?? undefined}
            />
            {model.agent.showSetupStatus ? (
              <AgentDeviceSetupStatus state={state} pending compact />
            ) : null}
            <ScopedSwitch
              settingKeys={model.agent.settingKeys}
              checked={model.agent.checked}
              disabled={model.agent.disabled}
              aria-label={model.agent.ariaLabel}
              onCheckedChange={(checked) => toggle("agent", Boolean(checked))}
            />
          </>
        }
      />
      {model.showHostUpdates && environmentId ? (
        <DeviceHostUpdates
          state={{ ...state, hosts: state.hosts.filter((host) => host.kind === "local") }}
          environmentId={environmentId}
        />
      ) : null}
      <DeviceHostsSettings environmentId={environmentId} />
    </>
  );
}

function BrowserAutoShowFloatingPreviewSetting({ disabled }: { readonly disabled: boolean }) {
  const autoShow = useClientSettings((settings) => settings.browserAutoShowFloatingPreview);
  return (
    <BrowserSwitchRow
      model={buildBrowserAutoShowFloatingPreviewRowModel({ autoShow, disabled })}
      resetSetting="browserAutoShowFloatingPreview"
      toChange={(checked) => ({ kind: "autoShowFloatingPreviewToggle", checked })}
    />
  );
}

/**
 * Profile list, its header menu, and the import flow.
 *
 * One menu creates profiles and imports into them, because the two are the
 * same decision from the user's side: "I want a profile that has my Helium
 * logins in it". Import targets include "New profile" so that case does not
 * require creating one first and then finding a second control.
 *
 * Built-ins render without a rename field: they are synthesized rather than
 * stored, so there is nothing to rename and removing them would strand every
 * tab that opened under them.
 *
 * Sources are listed lazily on open: detection touches the other browser's
 * files, and the answer changes while the app is running (quitting the browser
 * clears `browserRunning`), so a value cached at mount would go stale.
 */
function BrowserProfilesSetting({ disabled }: { readonly disabled: boolean }) {
  const userProfiles = useClientSettings((settings) => settings.browserProfiles);
  const defaultProfileId = useClientSettings((settings) => settings.browserDefaultProfileId);
  const settingsHydrated = useClientSettingsHydrated();
  const updateSettings = useUpdatePrimarySettings();
  const { environments, isReady: environmentsReady } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const [sources, setSources] = useState<ReadonlyArray<BrowserImportSource> | null>(null);
  const [importSession, setImportSession] = useState<{
    readonly source: BrowserImportSource;
    readonly environmentId: EnvironmentId;
    readonly environmentName: string;
  } | null>(null);
  const [profilePendingRemoval, setProfilePendingRemoval] = useState<{
    readonly id: string;
    readonly name: string;
  } | null>(null);
  const [profileRemovalError, setProfileRemovalError] = useState<string | null>(null);
  const [profileRemovalInFlight, setProfileRemovalInFlight] = useState(false);
  const importInFlightRef = useRef(false);
  const [importInFlight, setImportInFlight] = useState(false);
  const model = buildBrowserProfilesModel({
    userProfiles,
    defaultProfileId,
    settingsHydrated,
    disabled,
    bridgeAvailable: previewBridge !== null,
    environmentsReady,
    environmentCount: environments.length,
    primaryEnvironmentAvailable: primaryEnvironment != null,
    importInFlight,
    sources,
    pendingRemoval: profilePendingRemoval,
    removalError: profileRemovalError,
    removalInFlight: profileRemovalInFlight,
  });
  const { removalAvailable } = model;

  const createProfile = (baseName: string) => {
    const creation = resolveCreateBrowserProfile({
      settingsHydrated,
      importInFlight: importInFlightRef.current,
      currentProfiles: getClientSettings().browserProfiles,
      baseName,
      profileId: `profile-${randomUUID()}`,
    });
    if (creation !== null) updateSettings(creation.patch);
  };

  const renameProfile = (id: string, next: string) => {
    const patch = resolveRenameBrowserProfile({
      settingsHydrated,
      importInFlight: importInFlightRef.current,
      currentProfiles: getClientSettings().browserProfiles,
      profileId: id,
      next,
    });
    if (patch !== null) updateSettings(patch);
  };

  const clearProfileData = (id: string, name: string) => {
    const decision = resolveClearBrowserProfileData({
      settingsHydrated,
      importInFlight: importInFlightRef.current,
      bridgeAvailable: previewBridge !== null,
      environmentsReady,
      environmentCount: environments.length,
      name,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "unavailable") {
      toastManager.add(decision.toast);
      return;
    }
    void clearBrowserProfileData(
      previewBridge,
      environments.map((environment) => environment.environmentId),
      id,
    )
      .then(() => {
        toastManager.add(decision.successToast);
      })
      .catch(() => {
        toastManager.add(decision.failureToast);
      });
  };

  const removeProfile = async (id: string) => {
    const decision = resolveRemoveBrowserProfile({
      settingsHydrated,
      importInFlight: importInFlightRef.current,
      removalAvailable,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "unavailable") {
      setProfileRemovalError(decision.error);
      return;
    }
    setProfileRemovalError(null);
    setProfileRemovalInFlight(true);
    // Drop the partition's data too, otherwise a removed profile's cookies
    // stay on disk with nothing in the UI pointing at them.
    try {
      await clearBrowserProfileData(
        previewBridge,
        environmentsReady ? environments.map((environment) => environment.environmentId) : [],
        id,
      );
    } catch {
      setProfileRemovalError(BROWSER_PROFILE_REMOVAL_FAILED_MESSAGE);
      setProfileRemovalInFlight(false);
      return;
    }
    updateSettings(browserProfileRemovalPatch(getClientSettings(), id));
    setProfileRemovalInFlight(false);
    setProfilePendingRemoval(null);
  };

  // Refreshed without blanking the last result: the menu shows the cached list
  // straight away so it doesn't reflow on open, and the source list is stable
  // (names only) since choosing what to import happens in the wizard, not here.
  const loadSources = useCallback(() => {
    if (!previewBridge) return;
    void previewBridge
      .listBrowserImportSources()
      .then(setSources)
      .catch(() => setSources((previous) => previous ?? []));
  }, []);

  // Runs one import for the wizard. A new profile is registered only once the
  // import succeeds — the cookies land in its partition first — so a blocked
  // attempt never leaves an empty profile behind.
  const runWizardImport = async (
    source: BrowserImportSource,
    environmentId: EnvironmentId,
    input: { readonly sourceProfileDirectory: string; readonly target: WizardTarget },
  ): Promise<ImportOutcome> => {
    const blocked = resolveWizardImportBlock({
      bridgeAvailable: previewBridge !== null,
      settingsHydrated,
      importInFlight: importInFlightRef.current,
      target: input.target,
      currentProfiles: getClientSettings().browserProfiles,
    });
    if (blocked !== null || previewBridge === null) {
      return blocked ?? { kind: "blocked", reason: "sessionUnavailable" };
    }
    importInFlightRef.current = true;
    setImportInFlight(true);
    try {
      const result = await previewBridge.importBrowserCookies({
        environmentId,
        sourceId: source.id,
        sourceProfileDirectory: input.sourceProfileDirectory,
        targetProfileId: input.target.profileId,
      });
      if (wizardImportTargetMissing(input.target, getClientSettings().browserProfiles)) {
        return { kind: "blocked", reason: "readFailed" };
      }
      let targetName: string;
      if (input.target.kind === "new") {
        // Registered only when something actually came over: an import that
        // found no cookies should not leave a new, empty profile behind.
        if (result.imported > 0) {
          try {
            const persisted = await persistClientSettingsUpdate((current) => {
              const registration = resolveImportedProfileRegistration(
                current.browserProfiles,
                input.target.profileId,
                source.name,
              );
              if (registration.kind === "existing") return current;
              if (registration.kind === "limitReached") throw new ProfileLimitReachedError();
              return { ...current, browserProfiles: registration.browserProfiles };
            });
            targetName =
              persisted.browserProfiles.find((profile) => profile.id === input.target.profileId)
                ?.name ?? source.name;
          } catch (cause) {
            // This target id belongs only to the attempted new profile. Clear
            // its partition so a failed registration cannot strand imported
            // cookies behind a profile that disappears on restart.
            await clearBrowserProfileData(
              previewBridge,
              [environmentId],
              input.target.profileId,
            ).catch(() => undefined);
            // Not a read failure: the cookies came over and were cleared again
            // because the profile could not be kept. Name that, in the same
            // token form `importFailureReason` recovers from a bridge error.
            const reason =
              cause instanceof ProfileLimitReachedError ? "profileLimitReached" : "profileNotSaved";
            throw new Error(importFailureMessage(source.id, reason), { cause });
          }
        } else {
          targetName = source.name;
        }
      } else {
        targetName = input.target.name;
      }
      return {
        kind: "imported",
        imported: result.imported,
        skipped: result.skipped,
        skippedDomains: result.skippedDomains,
        targetName,
      };
    } catch (cause) {
      return { kind: "blocked", reason: importFailureReason(cause) };
    } finally {
      importInFlightRef.current = false;
      setImportInFlight(false);
    }
  };

  // Re-checks a source's availability after the user quits the browser, and
  // keeps the cached list in step so the menu reflects it too.
  const refreshImportSource = async (
    sourceId: BrowserImportSource["id"],
  ): Promise<BrowserImportSource | undefined> => {
    if (!previewBridge) return undefined;
    try {
      const latest = await previewBridge.listBrowserImportSources();
      setSources(latest);
      return latest.find((source) => source.id === sourceId);
    } catch {
      return undefined;
    }
  };

  return (
    <SettingsRow
      id={model.id}
      title={model.title}
      description={model.description}
      control={
        <Menu onOpenChange={(open) => open && loadSources()}>
          <MenuTrigger
            render={<Button size="sm" variant="outline" disabled={model.addMenu.disabled} />}
          >
            <PlusIcon />
            {model.addMenu.label}
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              disabled={model.addMenu.blankProfile.disabled}
              onClick={() => createProfile("New profile")}
            >
              {model.addMenu.blankProfile.label}
            </MenuItem>
            {model.addMenu.limitNotice !== null ? (
              <MenuItem disabled>{model.addMenu.limitNotice}</MenuItem>
            ) : null}
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>{model.addMenu.importGroupLabel}</MenuGroupLabel>
              {model.addMenu.importPlaceholder !== null ? (
                <MenuItem disabled>{model.addMenu.importPlaceholder}</MenuItem>
              ) : (
                // Every source is a plain row — running, needs-permission and
                // ready all look the same here. The wizard picks up whatever
                // state the source is in and walks the user forward from there.
                <>
                  {model.addMenu.importSources.map((item) => (
                    <MenuItem
                      key={item.id}
                      disabled={item.disabled}
                      onClick={() => {
                        const source = sources?.find((candidate) => candidate.id === item.id);
                        if (item.disabled || primaryEnvironment == null || !source) return;
                        setImportSession({
                          source,
                          environmentId: primaryEnvironment.environmentId,
                          environmentName: resolveEnvironmentOptionLabel({
                            isPrimary: true,
                            environmentId: primaryEnvironment.environmentId,
                            runtimeLabel: primaryEnvironment.label,
                          }),
                        });
                      }}
                    >
                      {item.label}
                    </MenuItem>
                  ))}
                  {model.addMenu.importNotice !== null ? (
                    <MenuItem disabled>{model.addMenu.importNotice}</MenuItem>
                  ) : null}
                </>
              )}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      }
    >
      {/*
        The bordered container groups rows unambiguously at any width, and
        carries the bottom spacing `SettingsRow` leaves to its children
        (`pt-3 pb-1`).
      */}
      <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
        {model.profiles.map((profile, index) => (
          <div
            key={profile.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              index > 0 && "border-t border-border/60",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {profile.rename === null ? (
                // Dimmed here rather than on the table: a wrapper-level dim
                // stacks with the rename field's and the row menu button's
                // own, landing them near 0.41 while every other disabled
                // control in the block sits at 0.64.
                <span
                  className={cn("truncate text-sm text-foreground", profile.dimmed && "opacity-64")}
                >
                  {profile.name}
                </span>
              ) : (
                <DraftInput
                  nativeInput
                  size="sm"
                  className="w-full max-w-56"
                  aria-label={profile.rename.ariaLabel}
                  disabled={profile.rename.disabled}
                  maxLength={profile.rename.maxLength}
                  value={profile.name}
                  onCommit={(next) => renameProfile(profile.id, next)}
                />
              )}
              {/* Dimmed with the rest of the row, whose controls are all disabled. */}
              {profile.defaultBadge !== null ? (
                <span className={cn("flex", profile.dimmed && "opacity-64")}>
                  <Badge>{profile.defaultBadge}</Badge>
                </span>
              ) : null}
            </span>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={profile.menu.disabled}
                    aria-label={profile.menu.ariaLabel}
                  />
                }
              >
                <MoreVertical />
              </MenuTrigger>
              <MenuPopup align="end">
                {profile.menu.items.map((item) => (
                  <MenuItem
                    key={item.action}
                    {...(item.destructive ? { variant: "destructive" as const } : {})}
                    disabled={item.disabled}
                    onClick={() => {
                      if (item.action === "setDefault") {
                        const patch = resolveSetDefaultBrowserProfile({
                          settingsHydrated,
                          profileId: profile.id,
                        });
                        if (patch !== null) updateSettings(patch);
                      } else if (item.action === "clearData") {
                        clearProfileData(profile.id, profile.name);
                      } else if (settingsHydrated) {
                        setProfilePendingRemoval({ id: profile.id, name: profile.name });
                      }
                    }}
                  >
                    {item.label}
                  </MenuItem>
                ))}
                {profile.menu.notice !== null ? (
                  <>
                    <MenuSeparator />
                    <MenuItem disabled>{profile.menu.notice}</MenuItem>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          </div>
        ))}
      </div>
      <AlertDialog
        open={model.removalDialog.open}
        onOpenChange={(open) => {
          if (!open && !profileRemovalInFlight) {
            setProfilePendingRemoval(null);
            setProfileRemovalError(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{model.removalDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{model.removalDialog.description}</AlertDialogDescription>
            {model.removalDialog.error ? (
              <p aria-live="polite" className="text-sm text-destructive">
                {model.removalDialog.error}
              </p>
            ) : null}
            {model.removalDialog.unavailableNotice !== null ? (
              <p className="text-sm text-muted-foreground">
                {model.removalDialog.unavailableNotice}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={model.removalDialog.cancel.disabled}
              render={<Button variant="outline" disabled={model.removalDialog.cancel.disabled} />}
            >
              {model.removalDialog.cancel.label}
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={model.removalDialog.confirm.disabled}
              onClick={() => {
                if (profilePendingRemoval && settingsHydrated && removalAvailable) {
                  void removeProfile(profilePendingRemoval.id);
                }
              }}
            >
              {model.removalDialog.confirm.label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      {importSession ? (
        <BrowserImportWizard
          source={importSession.source}
          destinationEnvironmentName={importSession.environmentName}
          targetProfiles={model.wizardTargetProfiles}
          canCreateProfile={model.canCreateProfile}
          onImport={(input) =>
            runWizardImport(importSession.source, importSession.environmentId, input)
          }
          onRefreshSource={() => refreshImportSource(importSession.source.id)}
          onCheckFullDiskAccess={
            window.desktopBridge?.checkSystemPermission
              ? () => window.desktopBridge!.checkSystemPermission!("full-disk-access")
              : undefined
          }
          onOpenFullDiskAccessSettings={async () => {
            // Rejects outside the desktop shell (and on shells that predate the
            // method), so the one toast covers every way the link can fail.
            await readLocalApi()
              ?.shell.openSystemSettings("full-disk-access")
              .catch(() => {
                toastManager.add({
                  type: "error",
                  title: "Could not open System Settings",
                  description: "Open Privacy & Security → Full Disk Access manually.",
                });
              });
          }}
          onClose={() => setImportSession(null)}
        />
      ) : null}
    </SettingsRow>
  );
}

export function IntegrationsSettingsPanel() {
  const page = buildIntegrationsPageModel({ isElectron });
  const previewDefaultsDisabled = page.previewDefaultsDisabled;
  const previewDefaults = (
    <>
      <BrowserProfilesSetting disabled={previewDefaultsDisabled} />
      <BrowserViewportSetting disabled={previewDefaultsDisabled} />
      <BrowserZoomSetting disabled={previewDefaultsDisabled} />
      <BrowserAppearanceSetting disabled={previewDefaultsDisabled} />
      <BrowserRecordingFrameRateSetting disabled={previewDefaultsDisabled} />
      <BrowserRecordingInputSettings disabled={previewDefaultsDisabled} />
      <BrowserLinkTargetSetting disabled={previewDefaultsDisabled} />
      <BrowserAutoShowFloatingPreviewSetting disabled={previewDefaultsDisabled} />
    </>
  );

  return (
    <SettingsPageContainer>
      {/* Server-authoritative agent access is scoped by the header selection;
          the preview defaults below are device-local and ignore it. */}
      <ProjectDefaultsSettings category={page.projectDefaultsCategory} />
      <SettingsSection id={page.browser.id} title={page.browser.title}>
        {page.browser.unavailableMessage !== null ? (
          <SettingsUnavailableGroup message={page.browser.unavailableMessage}>
            {previewDefaults}
          </SettingsUnavailableGroup>
        ) : (
          previewDefaults
        )}
      </SettingsSection>
      <DeviceIntegrationSettings section={page.devices} />
    </SettingsPageContainer>
  );
}
