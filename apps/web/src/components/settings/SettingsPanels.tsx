import { SettingsGroup } from "./SettingsGroup";
import { Spinner } from "~/components/ui/spinner";
import { NotificationSettings } from "./NotificationSettings";
import { ArchiveIcon, ArchiveX, CheckIcon, ChevronRightIcon, SettingsIcon } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProviderInstanceId,
  ScopedThreadRef,
  SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ResponseStreamingMode } from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL } from "../../branding";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { useEnvironmentStageLabel } from "../SidebarStageBackdrop";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl } from "../../hostedPairing";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { scopedSettingsAreMixed } from "./scopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import {
  buildArchivedThreadsSettingsModel,
  resolveArchivedThreadAction,
  resolveArchivedThreadActionOutcome,
  type ArchivedThreadActionEffect,
} from "./ArchivedThreads.logic";
import { buildSettingsRestoreModel, resolveSettingsRestorePatch } from "./SettingsRestore.logic";
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
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import {
  DEFAULT_CODE_FONT_STACK,
  DEFAULT_SANS_FONT_STACK,
  isFontFamilyAvailable,
  isMonospaceFamily,
  resolveDefaultFamilyLabel,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import { CodeFontPreview, PromptFontPreview, TerminalFontPreview } from "./SettingsFontPreviews";
import { discoverInstalledFonts, FontFamilyPicker, useFontEnumeration } from "./FontFamilyPicker";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThemeLibrary } from "./ThemeSettings";
import {
  type AboutUpdateTrackModel,
  type BackgroundActivityAdvancedIntent,
  type BackgroundActivityAdvancedModel,
  type BackgroundActivityIntervalKey,
  type BackgroundActivityProfileOption,
  backgroundActivityProfileOptionLabel,
  buildAboutVersionModel,
  buildGeneralSettingsModel,
  type DesktopUpdateFailure,
  describeDesktopUpdateFailure,
  describeUpdateCheckResult,
  type GeneralSettingsIntent,
  type GeneralSettingsMixedState,
  type GeneralSettingsNumberInputControl,
  type GeneralSettingsResetKey,
  type GeneralSettingsRow,
  type GeneralSettingsSection,
  type GeneralSettingsSelectKey,
  type GeneralSettingsSelectRow,
  type GeneralSettingsSwitchKey,
  type GeneralSettingsSwitchRow,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  resolveAutoSettleDaysDraft,
  resolveBackgroundActivityAdvancedChange,
  resolveDesktopUpdateButtonIntent,
  resolveGeneralSettingsChange,
  resolveLegacyFeaturesSearchJump,
  resolveTextGenerationModelChange,
  resolveTextGenerationModelOptionsChange,
  resolveTextGenerationModelState,
  resolveUpdateTrackChange,
  responseStreamingModeLabel,
  type TokenStreamingWarningModel,
} from "./GeneralSettings.logic";
import {
  type AppearanceFontPreview,
  type AppearanceFontRow,
  type AppearanceSettingsIntent,
  type AppearanceSwitchRow,
  type AppearanceTypographySection,
  buildAppearanceSettingsModel,
  FONT_FAMILY_DRAFT_COMMIT_DELAY_MS,
  isFontFamilyDraftPending,
  resolveAppearanceSettingsChange,
  resolveTypographySearchExpansion,
  shouldCommitFontFamilyDraft,
} from "./AppearanceSettings.logic";
import {
  PolicyTooltip,
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTarget,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";

function AboutVersionTitle({ title, version }: { title: string; version: string }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>{title}</span>
      <code className="text-2xs font-medium text-muted-foreground">{version}</code>
    </span>
  );
}

function showDesktopUpdateFailureToast(failure: DesktopUpdateFailure, error: unknown) {
  toastManager.add(
    stackedThreadToast({ type: "error", ...describeDesktopUpdateFailure(failure, error) }),
  );
}

function AboutVersionSection() {
  const updateState = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const model = buildAboutVersionModel({
    appVersion: APP_VERSION,
    isElectron,
    hasDesktopBridge,
    hostedAppChannel: HOSTED_APP_CHANNEL,
    updateState,
    isChangingUpdateChannel,
    isUpdateActionPending,
  });

  const handleUpdateTrackChange = (track: AboutUpdateTrackModel, value: string | null) => {
    const bridge = window.desktopBridge;
    const change = resolveUpdateTrackChange({
      source: track.source,
      value,
      selected: track.value,
      canSetDesktopChannel: typeof bridge?.setUpdateChannel === "function",
    });
    if (change.kind === "open-hosted-channel") {
      window.location.assign(buildHostedChannelSelectionUrl({ channel: change.channel }));
      return;
    }
    if (change.kind !== "set-desktop-channel" || !bridge) return;

    setIsChangingUpdateChannel(true);
    void bridge
      .setUpdateChannel(change.channel)
      .catch((error: unknown) => {
        showDesktopUpdateFailureToast("change-channel", error);
      })
      .finally(() => {
        setIsChangingUpdateChannel(false);
      });
  };

  const handleButtonClick = useCallback(async () => {
    const bridge = window.desktopBridge;
    const intent = resolveDesktopUpdateButtonIntent({
      hasDesktopBridge: Boolean(bridge),
      canCheckForUpdate: typeof bridge?.checkForUpdate === "function",
      updateState,
      isUpdateActionPending,
    });
    if (!bridge || intent.kind === "none") return;

    if (intent.kind === "download") {
      void bridge.downloadUpdate().catch((error: unknown) => {
        showDesktopUpdateFailureToast("download", error);
      });
      return;
    }

    if (intent.kind === "install") {
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(intent.confirmationMessage);
      } catch (error) {
        setIsUpdateActionPending(false);
        showDesktopUpdateFailureToast("confirm-install", error);
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .catch((error: unknown) => {
          showDesktopUpdateFailureToast("install", error);
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    void bridge
      .checkForUpdate()
      .then((result) => {
        const toast = describeUpdateCheckResult(result);
        if (toast) {
          toastManager.add(stackedThreadToast({ type: "error", ...toast }));
        }
      })
      .catch((error: unknown) => {
        showDesktopUpdateFailureToast("check", error);
      });
  }, [isUpdateActionPending, updateState]);

  const { version, updateTrack } = model;
  const button = version.button;

  return (
    <>
      <SettingsRow
        title={<AboutVersionTitle title={version.title} version={version.version} />}
        description={version.description}
        control={
          button ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={button.disabled}
                    onClick={handleButtonClick}
                  >
                    {button.label}
                  </Button>
                }
              />
              {button.tooltip ? <TooltipPopup>{button.tooltip}</TooltipPopup> : null}
            </Tooltip>
          ) : undefined
        }
      />
      {updateTrack ? (
        <SettingsRow
          title={updateTrack.title}
          description={updateTrack.description}
          control={
            <Select
              value={updateTrack.value}
              onValueChange={(value) => {
                handleUpdateTrackChange(updateTrack, value);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={updateTrack.ariaLabel}
                disabled={updateTrack.disabled}
              >
                <SelectValue>{updateTrack.valueLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {updateTrack.options.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const restoreModel = useMemo(
    () => buildSettingsRestoreModel({ theme, followSystem, themeHalves, settings }),
    [followSystem, settings, theme, themeHalves],
  );
  const { changedSettingLabels, confirmDialog } = restoreModel;

  const restoreDefaults = useCallback(async () => {
    if (confirmDialog === null) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(confirmDialog.message, {
      variant: confirmDialog.variant,
    });
    if (!confirmed) return;

    // Only touch the theme keys that are actually dirty, so a theme-storage
    // failure cannot block restoring unrelated settings. Preferences are
    // re-read after the confirmation dialog: they may have changed (another
    // tab, an OS flip) while it was open, and rollback must restore the live
    // values rather than the ones captured at render time.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {
      // Storage is unreadable; the render-time value is the best rollback.
    }
    const previousHalves = readThemeHalves();
    const plan = resolveSettingsRestorePatch({
      liveTheme: previousTheme,
      liveThemeHalves: previousHalves,
      liveAppearanceMode: readAppearanceModePreference(previousTheme),
    });
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: plan.themeFailureToast.title,
          description: plan.themeFailureToast.description,
        }),
      );
    };
    // Rollback restores the base preference first (which clears any mix) and
    // then re-applies the captured mix on top, so no failure path can leave
    // the pair of keys half-restored.
    const rollbackThemeState = () => {
      if (plan.resetTheme) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (plan.resetTheme && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (plan.clearThemeMix && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (plan.resetFollowSystem && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings(plan.settingsPatch);
    onRestored?.();
  }, [
    clearThemeHalves,
    confirmDialog,
    onRestored,
    setFollowSystem,
    setTheme,
    setThemeHalf,
    theme,
    updateSettings,
  ]);

  return {
    model: restoreModel,
    changedSettingLabels,
    restoreDefaults,
  };
}

/**
 * Gate in front of the legacy token-by-token mode. The primary action steers
 * the user to paragraph streaming; the legacy path is the quiet option.
 */
function TokenStreamingWarningDialog({
  model,
  open,
  onOpenChange,
  onConfirm,
  onUseParagraphs,
}: {
  model: TokenStreamingWarningModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onUseParagraphs: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{model.title}</AlertDialogTitle>
          <AlertDialogDescription>{model.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="ghost-muted" className="sm:mr-auto" onClick={onConfirm}>
            {model.confirmLabel}
          </Button>
          <AlertDialogClose render={<Button variant="outline" />}>
            {model.cancelLabel}
          </AlertDialogClose>
          <Button onClick={onUseParagraphs}>{model.useParagraphsLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

const BACKGROUND_ACTIVITY_INTERVAL_ROW_CLASSNAME: Record<BackgroundActivityIntervalKey, string> = {
  automaticGitFetchInterval:
    "flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
  providerHealthRefreshInterval:
    "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
  hostPowerMonitorActiveInterval:
    "flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
  hostPowerMonitorIdleInterval:
    "flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
};

function BackgroundActivityAdvancedDialog({
  model,
  open,
  onOpenChange,
}: {
  readonly model: BackgroundActivityAdvancedModel;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const applyChange = (intent: BackgroundActivityAdvancedIntent) => {
    const patch = resolveBackgroundActivityAdvancedChange({ settings, intent });
    if (patch) updateSettings(patch);
  };
  const { sharedPolicy } = model;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">{sharedPolicy.title}</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {sharedPolicy.description}
                </p>
              </div>
              <Select
                value={sharedPolicy.value}
                onValueChange={(value) => applyChange({ kind: "set-shared-policy", value })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={sharedPolicy.ariaLabel}
                >
                  <SelectValue>{sharedPolicy.valueLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {sharedPolicy.options.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            {model.intervals.map((interval) => (
              <div
                key={interval.key}
                className={BACKGROUND_ACTIVITY_INTERVAL_ROW_CLASSNAME[interval.key]}
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium">{interval.title}</div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {interval.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <NumberField
                    value={interval.valueSeconds}
                    min={interval.min}
                    step={interval.step}
                    size="sm"
                    className="w-32"
                    onValueChange={(value) =>
                      applyChange({ kind: "set-interval", key: interval.key, value })
                    }
                  >
                    <NumberFieldGroup>
                      <NumberFieldDecrement aria-label={interval.decrementAriaLabel} />
                      <NumberFieldInput aria-label={interval.inputAriaLabel} />
                      <NumberFieldIncrement aria-label={interval.incrementAriaLabel} />
                    </NumberFieldGroup>
                  </NumberField>
                  <span className="text-xs text-muted-foreground">{interval.unitLabel}</span>
                </div>
              </div>
            ))}

            <div className="grid gap-0 border-t sm:grid-cols-2">
              {model.pauseToggles.map(({ key, label, checked }) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 sm:border-r sm:even:border-r-0"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <Switch
                    checked={checked}
                    onCheckedChange={(nextChecked) =>
                      applyChange({ kind: "set-pause", key, checked: Boolean(nextChecked) })
                    }
                    aria-label={label}
                  />
                </label>
              ))}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => applyChange({ kind: "reset-all" })}>
            {model.resetLabel}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{model.doneLabel}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function settingsSliderStyle(progressRatio: number): CSSProperties {
  return {
    "--settings-slider-progress": `${progressRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - progressRatio}rem`,
  } as CSSProperties;
}

export function AppearanceSettingsPanel() {
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const [typographyAdvanced, setTypographyAdvanced] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const isMac = isMacPlatform(navigator.platform);
  const defaultFamilyProbe = useMemo(
    () => ({
      sans: resolveDefaultFamilyLabel(DEFAULT_SANS_FONT_STACK),
      code: resolveDefaultFamilyLabel(DEFAULT_CODE_FONT_STACK),
    }),
    [],
  );
  const model = useMemo(
    () =>
      buildAppearanceSettingsModel({
        settings,
        appearanceMode,
        theme,
        resolvedTheme,
        themeHalves,
        environmentStageLabel,
        isMac,
        typographyAdvanced,
        defaultFamilyProbe,
      }),
    [
      settings,
      appearanceMode,
      theme,
      resolvedTheme,
      themeHalves,
      environmentStageLabel,
      isMac,
      typographyAdvanced,
      defaultFamilyProbe,
    ],
  );
  const applyChange = useCallback(
    (intent: AppearanceSettingsIntent) => {
      const patch = resolveAppearanceSettingsChange(intent);
      if (patch !== null) updateSettings(patch);
    },
    [updateSettings],
  );
  const { contrast, glassOpacity, environmentIdentification, diffColors, chatWidth } =
    model.interface;
  const { panelAnimations } = model.motion;

  return (
    <SettingsPageContainer>
      <SettingsSection
        id={model.themes.sectionId}
        title={model.themes.sectionTitle}
        variant="plain"
        hideTitle
      >
        <div id={model.themes.anchorId}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <SettingsSection id={model.interface.sectionId} title={model.interface.title}>
        <SettingsRow
          id={contrast.id}
          title={contrast.title}
          description={contrast.description}
          resetAction={
            contrast.changed ? (
              <SettingResetButton
                label={contrast.resetLabel}
                onClick={() => applyChange({ kind: "reset", setting: contrast.setting })}
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor={contrast.inputId}
              >
                {contrast.valueLabel}
              </output>
              <input
                aria-label={contrast.ariaLabel}
                className="settings-slider min-w-0 flex-1"
                id={contrast.inputId}
                max={contrast.max}
                min={contrast.min}
                onChange={(event) =>
                  applyChange({
                    kind: "slider",
                    setting: contrast.setting,
                    value: Number(event.currentTarget.value),
                  })
                }
                step={contrast.step}
                style={settingsSliderStyle(contrast.progressRatio)}
                type="range"
                value={contrast.value}
              />
            </div>
          }
        />

        <SettingsRow
          id={glassOpacity.id}
          title={glassOpacity.title}
          description={glassOpacity.description}
          resetAction={
            glassOpacity.changed ? (
              <SettingResetButton
                label={glassOpacity.resetLabel}
                onClick={() => applyChange({ kind: "reset", setting: glassOpacity.setting })}
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor={glassOpacity.inputId}
              >
                {glassOpacity.valueLabel}
              </output>
              <input
                aria-label={glassOpacity.ariaLabel}
                className="settings-slider min-w-0 flex-1"
                id={glassOpacity.inputId}
                max={glassOpacity.max}
                min={glassOpacity.min}
                onChange={(event) =>
                  applyChange({
                    kind: "slider",
                    setting: glassOpacity.setting,
                    value: Number(event.currentTarget.value),
                  })
                }
                step={glassOpacity.step}
                style={settingsSliderStyle(glassOpacity.progressRatio)}
                type="range"
                value={glassOpacity.value}
              />
            </div>
          }
        />

        {environmentIdentification ? (
          <SettingsRow
            id={environmentIdentification.id}
            title={environmentIdentification.title}
            description={environmentIdentification.description}
            resetAction={
              environmentIdentification.changed ? (
                <SettingResetButton
                  label={environmentIdentification.resetLabel}
                  onClick={() =>
                    applyChange({ kind: "reset", setting: environmentIdentification.setting })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={environmentIdentification.value}
                onValueChange={(value) =>
                  applyChange({
                    kind: "select",
                    setting: environmentIdentification.setting,
                    value,
                  })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={environmentIdentification.ariaLabel}
                >
                  <SelectValue>{environmentIdentification.valueLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {environmentIdentification.options.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
        <SettingsRow
          id={diffColors.id}
          title={diffColors.title}
          description={diffColors.description}
          resetAction={
            diffColors.changed ? (
              <SettingResetButton
                label={diffColors.resetLabel}
                onClick={() => applyChange({ kind: "reset", setting: diffColors.setting })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={diffColors.value}
                onValueChange={(value) =>
                  applyChange({ kind: "select", setting: diffColors.setting, value })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={diffColors.ariaLabel}
                >
                  <span
                    aria-hidden="true"
                    className={
                      diffColors.swatchesReversed
                        ? "flex shrink-0 flex-row-reverse gap-1"
                        : "flex shrink-0 gap-1"
                    }
                  >
                    <span className="size-2 rounded-full bg-diff-deletion" />
                    <span className="size-2 rounded-full bg-diff-addition" />
                  </span>
                  <SelectValue>{diffColors.valueLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {diffColors.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          id={chatWidth.id}
          title={chatWidth.title}
          description={chatWidth.description}
          resetAction={
            chatWidth.changed ? (
              <SettingResetButton
                label={chatWidth.resetLabel}
                onClick={() => applyChange({ kind: "reset", setting: chatWidth.setting })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={chatWidth.value}
                onValueChange={(value) =>
                  applyChange({ kind: "select", setting: chatWidth.setting, value })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-full min-w-0"
                  aria-label={chatWidth.ariaLabel}
                >
                  <SelectValue>{chatWidth.valueLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {chatWidth.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection id={model.motion.sectionId} title={model.motion.title}>
        <SettingsRow
          id={panelAnimations.id}
          title={panelAnimations.title}
          description={panelAnimations.description}
          control={
            <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
              <PanelAnimationsPreview durationMs={panelAnimations.value} />
              <div className="flex w-full items-center gap-3">
                <output
                  className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  htmlFor={panelAnimations.inputId}
                >
                  {panelAnimations.valueLabel}
                </output>
                <input
                  aria-label={panelAnimations.ariaLabel}
                  className="settings-slider min-w-0 flex-1"
                  id={panelAnimations.inputId}
                  max={panelAnimations.max}
                  min={panelAnimations.min}
                  onChange={(event) =>
                    applyChange({
                      kind: "slider",
                      setting: panelAnimations.setting,
                      value: Number(event.currentTarget.value),
                    })
                  }
                  step={panelAnimations.step}
                  style={settingsSliderStyle(panelAnimations.progressRatio)}
                  type="range"
                  value={panelAnimations.value}
                />
              </div>
            </div>
          }
          resetAction={
            panelAnimations.changed ? (
              <SettingResetButton
                label={panelAnimations.resetLabel}
                onClick={() => applyChange({ kind: "reset", setting: panelAnimations.setting })}
              />
            ) : null
          }
        />
      </SettingsSection>

      <TypographySection
        typography={model.typography}
        isMac={isMac}
        onAdvancedChange={setTypographyAdvanced}
        onChange={applyChange}
      />
    </SettingsPageContainer>
  );
}

function AppearanceSwitchSettingsRow({
  row,
  onChange,
}: {
  row: AppearanceSwitchRow;
  onChange: (intent: AppearanceSettingsIntent) => void;
}) {
  return (
    <SettingsRow
      id={row.id}
      title={row.title}
      description={row.description}
      resetAction={
        row.changed ? (
          <SettingResetButton
            label={row.resetLabel}
            onClick={() => onChange({ kind: "reset", setting: row.setting })}
          />
        ) : null
      }
      control={
        <Switch
          checked={row.checked}
          onCheckedChange={(checked) =>
            onChange({ kind: "toggle", setting: row.setting, checked: Boolean(checked) })
          }
          aria-label={row.ariaLabel}
        />
      }
    />
  );
}

function renderFontPreview(preview: AppearanceFontPreview) {
  switch (preview.kind) {
    case "prompt":
      return <PromptFontPreview key="prompt" />;
    case "code":
      return <CodeFontPreview key="code" />;
    case "terminal":
      return <TerminalFontPreview key="terminal" family={preview.family} size={preview.size} />;
  }
}

/**
 * The two-font view by default - one sans, one monospace, each cascading to
 * every surface it reaches - with an Advanced switch in the section header
 * that reveals the per-surface override rows. The choice persists locally,
 * and a settings-search jump to an override row flips Advanced on so the
 * target exists to scroll to.
 */
function TypographySection({
  typography,
  isMac,
  onAdvancedChange,
  onChange,
}: {
  typography: AppearanceTypographySection;
  isMac: boolean;
  onAdvancedChange: (advanced: boolean) => void;
  onChange: (intent: AppearanceSettingsIntent) => void;
}) {
  const searchTargetId = useSettingsSearchTargetId();
  // Flip Advanced on once per search jump so the hidden target can mount and
  // scroll; tracking the handled id lets the user turn it back off without
  // the still-set target immediately re-expanding the section.
  const lastExpandedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const expansion = resolveTypographySearchExpansion({
      searchTargetId,
      lastExpandedTargetId: lastExpandedTargetRef.current,
      isMac,
    });
    if (expansion.kind === "none") return;
    lastExpandedTargetRef.current = expansion.targetId;
    onAdvancedChange(true);
  }, [searchTargetId, onAdvancedChange, isMac]);
  return (
    <SettingsSection
      id={typography.sectionId}
      title={typography.title}
      headerAction={
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          {typography.advancedLabel}
          <Switch
            checked={typography.advanced}
            onCheckedChange={(checked) => onAdvancedChange(Boolean(checked))}
            aria-label={typography.advancedAriaLabel}
          />
        </label>
      }
    >
      <Fragment key={typography.advanced ? "advanced" : "simple"}>
        {typography.fontRows.map((row) => (
          <FontFamilySettingsRow key={row.id} row={row} onChange={onChange} />
        ))}
        {typography.fontSmoothing ? (
          <AppearanceSwitchSettingsRow row={typography.fontSmoothing} onChange={onChange} />
        ) : null}
      </Fragment>
      <AppearanceSwitchSettingsRow row={typography.wordWrap} onChange={onChange} />
    </SettingsSection>
  );
}

function FontFamilySettingsRow({
  row,
  onChange,
}: {
  row: AppearanceFontRow;
  onChange: (intent: AppearanceSettingsIntent) => void;
}) {
  const { font, value, defaultValue, defaultFamily, requireMonospace, size } = row;
  const onValueChange = (family: string) => onChange({ kind: "fontFamily", font, family });
  // The fallback input edits a draft; the preference only commits once typing
  // pauses and the text probes as an available font (or is an explicit
  // clear), so the current font holds and nothing reflows mid-word.
  const [draft, setDraft] = useState(value);
  const [draftSettled, setDraftSettled] = useState(true);
  const commitTimerRef = useRef<number | null>(null);
  const lastValueRef = useRef(value);
  if (lastValueRef.current !== value) {
    // The committed value changed externally (hydration, reset, picker
    // selection); adopt it and drop any pending commit of a stale draft.
    lastValueRef.current = value;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setDraft(value);
    setDraftSettled(true);
  }
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );
  const commitDraft = (next: string) => {
    setDraftSettled(true);
    // A rejected name stays in the field, flagged: the terminal would silently
    // fall back to its default, so the row must not claim it took the value.
    if (
      shouldCommitFontFamilyDraft({
        draft: next,
        isAvailable: isFontFamilyAvailable(next),
        isMonospace: requireMonospace && isMonospaceFamily(next),
        requireMonospace,
      })
    ) {
      onValueChange(next);
    }
  };
  const flushDraft = () => {
    if (commitTimerRef.current === null) return;
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    commitDraft(draft);
  };
  const draftPending = isFontFamilyDraftPending({ draft, value, settled: draftSettled });
  const resetToDefault = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setDraft(defaultValue);
    setDraftSettled(true);
    onChange({ kind: "resetFont", font });
  };
  const resetAction = row.changed ? (
    <SettingResetButton label={row.resetLabel} onClick={resetToDefault} />
  ) : null;
  const fontEnumeration = useFontEnumeration();
  // Everyone starts on the plain input; focusing it is the user gesture that
  // runs font discovery. Where the engine can enumerate, the control then
  // upgrades to the picker - popped open when the swap happens under focus,
  // so the interaction continues without a second click.
  const inputFocusedRef = useRef(false);
  const familyControl =
    fontEnumeration.status === "granted" ? (
      <FontFamilyPicker
        ariaLabel={row.familyAriaLabel}
        defaultFamily={defaultFamily}
        selectedFamily={row.trimmedValue}
        requireMonospace={requireMonospace}
        initialOpen={inputFocusedRef.current}
        onSelect={onValueChange}
      />
    ) : (
      <Input
        size="sm"
        aria-label={row.familyAriaLabel}
        aria-invalid={draftPending || undefined}
        autoCapitalize="off"
        autoComplete="off"
        className="min-w-0 flex-1"
        maxLength={row.familyMaxLength}
        onFocus={() => {
          inputFocusedRef.current = true;
          discoverInstalledFonts();
        }}
        onBlur={() => {
          inputFocusedRef.current = false;
          flushDraft();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          setDraftSettled(false);
          if (commitTimerRef.current !== null) {
            window.clearTimeout(commitTimerRef.current);
          }
          commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            commitDraft(next);
          }, FONT_FAMILY_DRAFT_COMMIT_DELAY_MS);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") flushDraft();
          if (event.key === "Escape") {
            // Discard uncommitted typing without closing the settings page,
            // which is what an unhandled Escape does.
            event.preventDefault();
            event.stopPropagation();
            if (commitTimerRef.current !== null) {
              window.clearTimeout(commitTimerRef.current);
              commitTimerRef.current = null;
            }
            setDraft(value);
            setDraftSettled(true);
          }
        }}
        placeholder={defaultFamily}
        spellCheck={false}
        value={draft}
      />
    );
  const control = (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">{familyControl}</div>
      <Select
        value={size.selectedValue}
        onValueChange={(next) => onChange({ kind: "fontSize", font, value: next })}
      >
        <SelectTrigger size="sm" className="w-22 shrink-0" aria-label={size.ariaLabel}>
          <SelectValue>{size.valueLabel}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {size.options.map((option) => (
            <SelectItem hideIndicator key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
  return (
    <SettingsRow
      id={row.id}
      title={row.title}
      description={row.description}
      resetAction={resetAction}
      control={control}
    >
      {row.previews.length > 0 ? row.previews.map(renderFontPreview) : undefined}
    </SettingsRow>
  );
}

function AutoSettleDaysInput({
  control,
  onCommit,
}: {
  control: GeneralSettingsNumberInputControl;
  onCommit: (days: number) => void;
}) {
  const { value } = control;
  // Local draft so the field can be emptied mid-edit; the setting only moves
  // on valid input and snaps back to the persisted value on blur.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      size="sm"
      type="number"
      min={control.min}
      max={control.max}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const days = resolveAutoSettleDaysDraft(event.target.value);
        if (days !== null) onCommit(days);
      }}
      onBlur={() => setDraft(String(value))}
      aria-label={control.ariaLabel}
    />
  );
}

/**
 * Retired features kept only for users who still depend on them. Collapsed by
 * default so they stay out of the everyday settings path; a settings-search
 * jump to one of the rows unfolds the section.
 */
function LegacyFeaturesSection({
  section,
  children,
}: {
  section: GeneralSettingsSection;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const searchTargetId = useSettingsSearchTargetId();
  const anchorId = section.anchorId ?? undefined;
  const targetRef = useSettingsSearchTarget<HTMLElement>(anchorId);
  // Unfold once per search jump; tracking the handled id lets the user fold
  // the section back up without the still-set target immediately reopening it.
  const lastExpandedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const jump = resolveLegacyFeaturesSearchJump({
      searchTargetId,
      lastExpandedTargetId: lastExpandedTargetRef.current,
    });
    lastExpandedTargetRef.current = jump.lastExpandedTargetId;
    if (jump.expand) setOpen(true);
  }, [searchTargetId]);

  return (
    <section id={anchorId} ref={targetRef} tabIndex={-1} className="space-y-2.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex min-h-8 w-full items-center gap-2 px-3 sm:px-4">
          <h2 className="text-sm font-normal text-foreground/70 transition-colors group-hover:text-foreground">
            {section.title}
          </h2>
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SettingsGroup>{children}</SettingsGroup>
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}

export function GeneralSettingsPanel() {
  const isMac = isMacPlatform(navigator.platform);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { scope, environment, connectedEnvironments, targets } = useSettingsScope();
  // The representative environment supplies the provider list for pickers;
  // a fanned-out model choice is validated against every target before it
  // is written. Per-machine tuning (background activity overrides) still
  // needs exactly one environment.
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const [backgroundActivityDialogOpen, setBackgroundActivityDialogOpen] = useState(false);
  const [tokenStreamingWarningOpen, setTokenStreamingWarningOpen] = useState(false);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(localStorage),
  );
  const serverProviders = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoSettlement =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    );
  const supportsRestartContinuation =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (target) => target.serverConfig?.environment.capabilities.threadRestartContinuation === true,
    );
  const mixed = useMemo<GeneralSettingsMixedState>(
    () => ({
      responseStreamingMode: scopedSettingsAreMixed(targets, ["responseStreamingMode"]),
      backgroundActivity: scopedSettingsAreMixed(targets, ["backgroundActivity"]),
      addProjectBaseDirectory: scopedSettingsAreMixed(targets, ["addProjectBaseDirectory"]),
      textGenerationModelSelection: scopedSettingsAreMixed(targets, [
        "textGenerationModelSelection",
      ]),
      sidebarAutoSettleOnMerge: scopedSettingsAreMixed(targets, ["sidebarAutoSettleOnMerge"]),
      sidebarAutoSettleAfterDays: scopedSettingsAreMixed(targets, ["sidebarAutoSettleAfterDays"]),
      enableProviderUpdateChecks: scopedSettingsAreMixed(targets, ["enableProviderUpdateChecks"]),
      continueThreadsAfterServerUpdate: scopedSettingsAreMixed(targets, [
        "continueThreadsAfterServerUpdate",
      ]),
      newWorktreesStartFromOrigin: scopedSettingsAreMixed(targets, ["newWorktreesStartFromOrigin"]),
    }),
    [targets],
  );
  const textGeneration = useMemo(
    () => resolveTextGenerationModelState({ settings, serverProviders }),
    [settings, serverProviders],
  );
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGeneration.providers,
    textGeneration.selection.instanceId,
    textGeneration.selection.model,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGeneration.instanceEntries,
  );
  const model = useMemo(
    () =>
      buildGeneralSettingsModel({
        settings,
        isMac,
        isElectron,
        environmentId,
        isEnvironmentScope,
        hasServerTargets,
        supportsAutoSettlement,
        supportsRestartContinuation,
        mixed,
        textGeneration,
      }),
    [
      settings,
      isMac,
      environmentId,
      isEnvironmentScope,
      hasServerTargets,
      supportsAutoSettlement,
      supportsRestartContinuation,
      mixed,
      textGeneration,
    ],
  );
  const { rows, sections } = model;

  const apply = (intent: GeneralSettingsIntent) => {
    const decision = resolveGeneralSettingsChange({
      settings,
      isMac,
      isEnvironmentScope,
      lastEnabledProjectGroupingMode: lastEnabledProjectGroupingMode.current,
      intent,
    });
    switch (decision.kind) {
      case "none":
        return;
      case "patch":
        updateSettings(decision.patch);
        return;
      case "set-project-grouping":
        if (decision.rememberMode !== null) {
          lastEnabledProjectGroupingMode.current = decision.rememberMode;
          rememberEnabledProjectGroupingMode(localStorage, decision.rememberMode);
        }
        updateSettings(decision.patch);
        return;
      case "open-token-streaming-warning":
        setTokenStreamingWarningOpen(true);
        return;
      case "patch-and-close-token-streaming-warning":
        updateSettings(decision.patch);
        setTokenStreamingWarningOpen(false);
        return;
      case "open-background-activity-dialog":
        setBackgroundActivityDialogOpen(true);
        return;
    }
  };

  const renderResetAction = (key: GeneralSettingsResetKey, row: GeneralSettingsRow) =>
    row.resetLabel ? (
      <SettingResetButton label={row.resetLabel} onClick={() => apply({ kind: "reset", key })} />
    ) : null;

  const renderSwitchRow = (key: GeneralSettingsSwitchKey, row: GeneralSettingsSwitchRow) => {
    const { control } = row;
    const onCheckedChange = (checked: boolean) =>
      apply({ kind: "toggle", key, checked: Boolean(checked) });
    return (
      <SettingsRow
        {...(row.serverScoped ? { serverScoped: true, settingKeys: row.settingKeys } : {})}
        id={row.anchorId ?? undefined}
        title={row.title}
        description={row.description}
        status={row.status ?? undefined}
        resetAction={renderResetAction(key, row)}
        control={
          row.serverScoped ? (
            <ScopedSwitch
              settingKeys={row.settingKeys}
              checked={control.checked}
              disabled={control.disabled}
              onCheckedChange={onCheckedChange}
              aria-label={control.ariaLabel}
            />
          ) : (
            <Switch
              checked={control.checked}
              onCheckedChange={onCheckedChange}
              aria-label={control.ariaLabel}
            />
          )
        }
      />
    );
  };

  const renderSelectRow = <V extends string>(
    key: GeneralSettingsSelectKey,
    row: GeneralSettingsSelectRow<V>,
  ) => (
    <SettingsRow
      id={row.anchorId ?? undefined}
      title={row.title}
      description={row.description}
      resetAction={renderResetAction(key, row)}
      control={
        <Select
          value={row.control.value}
          onValueChange={(value) => apply({ kind: "select", key, value })}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={row.control.ariaLabel}>
            <SelectValue>{row.control.valueLabel}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {row.control.options.map((option) => (
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );

  const responseStreaming = rows.responseStreaming;
  const sendShortcut = rows.sendShortcut;
  const followUpBehavior = rows.followUpBehavior;
  const backgroundActivity = rows.backgroundActivity;
  const backgroundActivityAccessory = backgroundActivity.control.accessory;
  const addProjectBaseDirectory = rows.addProjectBaseDirectory;
  const autoSettleDays = rows.autoSettleDays;
  const textGenerationRow = rows.textGenerationModel;
  const picker = textGenerationRow.control;
  const textGenInstanceEntry = textGeneration.instanceEntry;

  return (
    <SettingsPageContainer>
      <ProjectDefaultsSettings category="general" />
      <SettingsSection
        id={sections.organization.anchorId ?? undefined}
        title={sections.organization.title}
      >
        {renderSwitchRow("projectGrouping", rows.projectGrouping)}

        {renderSwitchRow("workingShelf", rows.workingShelf)}

        {rows.autoSettleMerged ? renderSwitchRow("autoSettleMerged", rows.autoSettleMerged) : null}
        {rows.autoSettleInactive
          ? renderSwitchRow("autoSettleInactive", rows.autoSettleInactive)
          : null}
        {autoSettleDays ? (
          <SettingsRow
            serverScoped
            settingKeys={autoSettleDays.settingKeys}
            title={autoSettleDays.title}
            description={autoSettleDays.description}
            control={
              <AutoSettleDaysInput
                control={autoSettleDays.control}
                onCommit={(days) => apply({ kind: "commit-auto-settle-days", days })}
              />
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection id={sections.behavior.anchorId ?? undefined} title={sections.behavior.title}>
        <NotificationSettings />
        {renderSwitchRow("inAppNotifications", rows.inAppNotifications)}
        {renderSelectRow("timeFormat", rows.timeFormat)}
        <SettingsRow
          serverScoped
          settingKeys={responseStreaming.settingKeys}
          id={responseStreaming.anchorId ?? undefined}
          title={responseStreaming.title}
          description={responseStreaming.description}
          resetAction={renderResetAction("responseStreaming", responseStreaming)}
          control={
            <>
              <Select
                value={responseStreaming.control.value}
                onValueChange={(value) =>
                  apply({ kind: "select", key: "responseStreaming", value })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-56"
                  aria-label={responseStreaming.control.ariaLabel}
                >
                  <SelectValue>
                    {(value: ResponseStreamingMode | null) => responseStreamingModeLabel(value)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {responseStreaming.control.options.map((option) => (
                    <SelectItem hideIndicator key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <TokenStreamingWarningDialog
                model={model.tokenStreamingWarning}
                open={tokenStreamingWarningOpen}
                onOpenChange={setTokenStreamingWarningOpen}
                onConfirm={() => apply({ kind: "confirm-token-streaming" })}
                onUseParagraphs={() => apply({ kind: "use-paragraph-streaming" })}
              />
            </>
          }
        />
        {renderSwitchRow("hideWhitespaceChanges", rows.hideWhitespaceChanges)}
        {renderSelectRow("defaultDiffFileState", rows.defaultDiffFileState)}
        {renderSelectRow("diffLayout", rows.diffLayout)}

        {renderSwitchRow("proactivePanels", rows.proactivePanels)}

        {renderSwitchRow("skillsInSlashMenu", rows.skillsInSlashMenu)}

        {renderSwitchRow("composerRichText", rows.composerRichText)}

        {renderSwitchRow("composerCollapse", rows.composerCollapse)}

        <SettingsRow
          id={sendShortcut.anchorId ?? undefined}
          title={sendShortcut.title}
          description={sendShortcut.description}
          resetAction={renderResetAction("sendShortcut", sendShortcut)}
          control={
            <Select
              value={sendShortcut.control.value}
              onValueChange={(value) => apply({ kind: "select", key: "sendShortcut", value })}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label={sendShortcut.control.ariaLabel}
              >
                <SelectValue>{sendShortcut.control.valueLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcut.control.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {sendShortcut.control.showSelectedIndicator &&
                        sendShortcut.control.value === option.value && (
                          <CheckIcon aria-hidden="true" />
                        )}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          id={followUpBehavior.anchorId ?? undefined}
          title={followUpBehavior.title}
          description={followUpBehavior.description}
          resetAction={renderResetAction("followUpBehavior", followUpBehavior)}
          control={
            <Select
              value={followUpBehavior.control.value}
              onValueChange={(value) => apply({ kind: "select", key: "followUpBehavior", value })}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={followUpBehavior.control.ariaLabel}
              >
                <SelectValue>{followUpBehavior.control.valueLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {followUpBehavior.control.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        {renderSwitchRow("providerUpdateChecks", rows.providerUpdateChecks)}

        {renderSwitchRow("continueThreadsAfterRestart", rows.continueThreadsAfterRestart)}

        <SettingsRow
          serverScoped
          settingKeys={backgroundActivity.settingKeys}
          id={backgroundActivity.anchorId ?? undefined}
          title={
            <span className="inline-flex items-center gap-1.5">
              {backgroundActivity.title}
              {backgroundActivity.titleTooltip !== null ? (
                <PolicyTooltip>{backgroundActivity.titleTooltip}</PolicyTooltip>
              ) : null}
            </span>
          }
          description={backgroundActivity.description}
          resetAction={renderResetAction("backgroundActivity", backgroundActivity)}
          control={
            <>
              <Select
                value={backgroundActivity.control.value}
                onValueChange={(value) =>
                  apply({ kind: "select", key: "backgroundActivity", value })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={backgroundActivity.control.ariaLabel}
                >
                  <SelectValue>
                    {(value: BackgroundActivityProfileOption | null) =>
                      backgroundActivityProfileOptionLabel(value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {backgroundActivity.control.options.map((option) => (
                    <SelectItem
                      hideIndicator
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {backgroundActivityAccessory ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={backgroundActivityAccessory.ariaLabel}
                        onClick={() => apply({ kind: "configure-background-activity" })}
                      >
                        <SettingsIcon className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">{backgroundActivityAccessory.tooltip}</TooltipPopup>
                </Tooltip>
              ) : null}
              <BackgroundActivityAdvancedDialog
                model={model.backgroundActivityAdvanced}
                open={backgroundActivityDialogOpen && isEnvironmentScope}
                onOpenChange={setBackgroundActivityDialogOpen}
              />
            </>
          }
        />
      </SettingsSection>

      <SettingsSection
        id={sections["projects-and-threads"].anchorId ?? undefined}
        title={sections["projects-and-threads"].title}
      >
        {renderSwitchRow("startFromOrigin", rows.startFromOrigin)}
        <SettingsRow
          serverScoped
          settingKeys={addProjectBaseDirectory.settingKeys}
          id={addProjectBaseDirectory.anchorId ?? undefined}
          title={addProjectBaseDirectory.title}
          description={addProjectBaseDirectory.description}
          resetAction={renderResetAction("addProjectBaseDirectory", addProjectBaseDirectory)}
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={addProjectBaseDirectory.control.value}
              onCommit={(next) => apply({ kind: "commit-add-project-base-directory", value: next })}
              placeholder={addProjectBaseDirectory.control.placeholder}
              spellCheck={false}
              aria-label={addProjectBaseDirectory.control.ariaLabel}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id={sections.confirmations.anchorId ?? undefined}
        title={sections.confirmations.title}
      >
        {renderSwitchRow("unpinConfirmation", rows.unpinConfirmation)}

        {renderSwitchRow("archiveConfirmation", rows.archiveConfirmation)}

        {renderSwitchRow("deleteConfirmation", rows.deleteConfirmation)}

        {rows.quitConfirmation ? renderSelectRow("quitConfirmation", rows.quitConfirmation) : null}
      </SettingsSection>

      <SettingsSection
        id={sections["text-generation"].anchorId ?? undefined}
        title={sections["text-generation"].title}
      >
        <SettingsRow
          serverScoped
          settingKeys={textGenerationRow.settingKeys}
          id={textGenerationRow.anchorId ?? undefined}
          title={textGenerationRow.title}
          description={textGenerationRow.description}
          resetAction={renderResetAction("textGenerationModel", textGenerationRow)}
          control={
            picker.unavailableMessage !== null ? (
              <span className="text-sm text-muted-foreground">{picker.unavailableMessage}</span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  activeInstanceId={picker.activeInstanceId}
                  model={picker.model}
                  lockedProvider={null}
                  instanceEntries={textGeneration.instanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(picker.triggerLabel !== null ? { triggerLabel: picker.triggerLabel } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(picker.canOpenProviderSetup && environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, nextModel) => {
                    const change = resolveTextGenerationModelChange({
                      settings,
                      providers: textGeneration.providers,
                      instanceId,
                      model: nextModel,
                      disabledReason: textGenerationModelDisabledReason(instanceId, nextModel),
                    });
                    if (change.kind === "reject") {
                      toastManager.add({ type: "error", ...change.toast });
                      return;
                    }
                    updateSettings(change.patch);
                  }}
                />
                {picker.showTraitsPicker && textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={picker.driverKind}
                    models={
                      // Use the exact instance's models (rather than the
                      // first-kind-match) so a custom text-gen instance like
                      // `codex_personal` gets its own model list, not the
                      // default Codex one.
                      textGenInstanceEntry.models
                    }
                    model={picker.model}
                    prompt=""
                    onPromptChange={() => {}}
                    modelOptions={textGeneration.selection.options}
                    allowPromptInjectedEffort={false}
                    planModeEnabled={settings.planModeEnabled}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings(
                        resolveTextGenerationModelOptionsChange({
                          settings,
                          providers: textGeneration.providers,
                          instanceId: picker.activeInstanceId,
                          model: picker.model,
                          options: nextOptions,
                        }),
                      );
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
      </SettingsSection>

      <SettingsSection id={sections.about.anchorId ?? undefined} title={sections.about.title}>
        <AboutVersionSection />
      </SettingsSection>
      <SettingsSection
        id={sections.diagnostics.anchorId ?? undefined}
        title={sections.diagnostics.title}
      >
        <SettingsRow
          id={rows.diagnostics.anchorId ?? undefined}
          title={rows.diagnostics.title}
          description={rows.diagnostics.description}
          control={
            <Button
              render={
                <Link
                  to="/settings/diagnostics"
                  search={{ machine: rows.diagnostics.control.machine ?? undefined }}
                />
              }
              size="sm"
              variant="outline"
            >
              {rows.diagnostics.control.label}
            </Button>
          }
        />
        <SettingsRow
          id={rows.openSourceLicenses.anchorId ?? undefined}
          title={rows.openSourceLicenses.title}
          description={rows.openSourceLicenses.description}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              {rows.openSourceLicenses.control.label}
            </Button>
          }
        />
      </SettingsSection>

      <LegacyFeaturesSection section={sections["legacy-features"]}>
        {renderSwitchRow("legacyPlanMode", rows.legacyPlanMode)}
        {renderSwitchRow("legacyContextWindowIndicator", rows.legacyContextWindowIndicator)}
        {renderSwitchRow("legacySidebar", rows.legacySidebar)}
      </LegacyFeaturesSection>
    </SettingsPageContainer>
  );
}

function applyArchivedThreadActionEffect(effect: ArchivedThreadActionEffect, refresh: () => void) {
  if (effect.kind === "refresh") {
    refresh();
    return;
  }
  if (effect.kind === "toast") {
    toastManager.add(
      stackedThreadToast({ type: "error", title: effect.title, description: effect.description }),
    );
  }
}

export function ArchivedThreadsPanel() {
  const { scope } = useSettingsScope();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(scope.environmentIds);

  const archivedModel = useMemo(
    () =>
      buildArchivedThreadsSettingsModel({
        snapshots: archivedSnapshots,
        scope,
        isLoading: isLoadingArchive,
        error: archiveError,
        now: Date.now(),
      }),
    [archiveError, archivedSnapshots, isLoadingArchive, scope],
  );
  const { emptyState, groups: archivedGroups, contextMenuItems } = archivedModel;

  const runArchivedThreadAction = useCallback(
    async (action: "unarchive" | "delete", threadRef: ScopedThreadRef) => {
      const result =
        action === "unarchive"
          ? await unarchiveThread(threadRef)
          : await confirmAndDeleteThread(threadRef);
      applyArchivedThreadActionEffect(
        resolveArchivedThreadActionOutcome({
          action,
          outcome:
            result._tag === "Success"
              ? { kind: "success" }
              : isAtomCommandInterrupted(result)
                ? { kind: "interrupted" }
                : { kind: "failure", error: squashAtomCommandFailure(result) },
        }),
        refreshArchivedThreads,
      );
    },
    [confirmAndDeleteThread, refreshArchivedThreads, unarchiveThread],
  );

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(contextMenuItems, position);
      const intent = resolveArchivedThreadAction({ source: "context-menu", clicked });
      if (intent.kind === "none") return;
      await runArchivedThreadAction(intent.kind, threadRef);
    },
    [contextMenuItems, runArchivedThreadAction],
  );

  return (
    <SettingsPageContainer>
      {emptyState ? (
        <SettingsSection id={emptyState.sectionId ?? undefined} title={emptyState.sectionTitle}>
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {emptyState.icon === "spinner" ? (
                  <Spinner size="sm" tone="muted" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {emptyState.title}
              </span>
            }
            description={emptyState.description}
          />
        </SettingsSection>
      ) : (
        archivedGroups.map((group) => (
          <SettingsSection
            key={group.id}
            id={group.sectionId ?? undefined}
            title={group.title}
            icon={<ProjectFavicon project={group.project} />}
          >
            {group.threads.map((row) => (
              <SettingsRow
                key={row.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void (async () => {
                    const result = await settlePromise(() =>
                      handleArchivedThreadContextMenu(scopeThreadRef(row.environmentId, row.id), {
                        x: event.clientX,
                        y: event.clientY,
                      }),
                    );
                    if (result._tag === "Failure") {
                      applyArchivedThreadActionEffect(
                        resolveArchivedThreadActionOutcome({
                          action: "menu",
                          outcome: { kind: "failure", error: squashAtomCommandFailure(result) },
                        }),
                        refreshArchivedThreads,
                      );
                    }
                  })();
                }}
                title={row.title}
                description={row.description}
                control={
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="shrink-0"
                    onClick={() => {
                      const intent = resolveArchivedThreadAction({ source: "button" });
                      if (intent.kind === "none") return;
                      void runArchivedThreadAction(
                        intent.kind,
                        scopeThreadRef(row.environmentId, row.id),
                      );
                    }}
                  >
                    <ArchiveX className="size-3.5" />
                    <span>{row.primaryAction.label}</span>
                  </Button>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
