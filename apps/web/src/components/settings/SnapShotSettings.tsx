import { useAtomValue } from "@effect/atom-react";
import type {
  ClientSettingsPatch,
  DesktopSnapShotState,
  DesktopSnapShotSetupAction,
  SnapShotShortcut,
} from "@t3tools/contracts";
import { PlayIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import {
  readSnapShotSetupResume,
  saveSnapShotSetupResume,
  clearSnapShotSetupResume,
} from "../../lib/snapShotSetupResume";
import { snapShotKeybindingConflict } from "../../lib/snapShotShortcut";
import { playSnapShotSound } from "../../lib/snapShotSound";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  buildSnapShotSettingsModel,
  resolveSnapShotCloseSetup,
  resolveSnapShotEnabledChange,
  resolveSnapShotEnableForSetup,
  resolveSnapShotIncludeAccessibilityChange,
  resolveSnapShotOpenSetup,
  resolveSnapShotSetupAction,
  resolveSnapShotSetupResume,
  resolveSnapShotShortcutDraft,
  resolveSnapShotSoundChange,
  snapShotSettingsError,
  snapShotSetupReady,
  snapShotShortcutCheckFailed,
  snapShotShortcutSaved,
  snapShotShortcutUnavailable,
  type SnapShotSettingsError,
  type SnapShotSetupRequest,
  type SnapShotShortcutCheck,
  type SnapShotSoundOption,
  type SnapShotWizard,
} from "./SnapShotSettings.logic";
import {
  SettingsUnavailableGroup,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SelectButton } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SnapShotSetupDialog } from "./SnapShotSetupDialog";
import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";
import { captureSetupInitialStep } from "./SnapShotSetupDialog.logic";

const soundOptionRowClassName = "grid grid-cols-[1fr_auto]";

function soundOptionLabel(option: SnapShotSoundOption) {
  return option.badge ? (
    <>
      {`${option.label} `}
      <span className="text-muted-foreground">{option.badge}</span>
    </>
  ) : (
    option.label
  );
}

export function SnapShotSettings() {
  const settings = useClientSettings();
  const updateSettings = useUpdateClientSettings();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const bridge = getDesktopSnapShotBridge();
  const platform = navigator.platform;
  const [state, setState] = useState<DesktopSnapShotState | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<SnapShotSettingsError | null>(null);
  const [wizard, setWizard] = useState<SnapShotWizard | null>(null);
  const [candidate, setCandidate] = useState<SnapShotShortcut>(settings.snapShotShortcut);
  const [shortcutCheck, setShortcutCheck] = useState<SnapShotShortcutCheck>({
    status: "idle",
    availability: null,
  });
  const shortcutCheckIdRef = useRef(0);
  const stateRequestIdRef = useRef(0);
  const savedShortcut = settings.snapShotShortcut;
  const draft = resolveSnapShotShortcutDraft({ state, savedShortcut, candidate, platform });

  const refreshState = useCallback(async () => {
    const requestId = ++stateRequestIdRef.current;
    try {
      if (bridge) {
        const nextState = await bridge.getSnapShotState();
        if (requestId === stateRequestIdRef.current) setState(nextState);
        return nextState;
      }
    } catch (error) {
      if (requestId === stateRequestIdRef.current)
        setSetupError(snapShotSettingsError("Couldn't check capture setup", error));
    }
  }, [bridge]);

  const setup = useCallback(
    async (action: DesktopSnapShotSetupAction) => {
      if (!bridge?.setupSnapShot || setupBusy) return;
      setSetupBusy(true);
      setSetupError(null);
      const plan = resolveSnapShotSetupAction({ action, state, wizardOpen: wizard !== null });
      try {
        if (plan.saveResume && wizard) {
          // macOS can quit the app from its permission prompt.
          saveSnapShotSetupResume(wizard.wasEnabled);
        }
        await bridge.setupSnapShot(action);
        await refreshState();
      } catch (error) {
        setSetupError(snapShotSettingsError(plan.errorTitle, error));
      } finally {
        setSetupBusy(false);
      }
    },
    [bridge, refreshState, setupBusy, state, wizard],
  );

  useEffect(() => {
    if (!setupError || wizard) return;
    toastManager.add({
      type: "error",
      title: setupError.title,
      description: setupError.message,
    });
    setSetupError(null);
  }, [setupError, wizard]);

  useEffect(() => {
    let cancelled = false;
    void refreshState().then((current) => {
      const resumed = resolveSnapShotSetupResume(current, readSnapShotSetupResume());
      if (!cancelled && resumed) setWizard(resumed);
    });
    window.addEventListener("focus", refreshState);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshState);
    };
  }, [refreshState]);

  useEffect(
    () =>
      bridge?.onSnapShotEvent((event) => {
        if (event.type === "shortcut-changed") void refreshState();
      }),
    [bridge, refreshState],
  );

  useEffect(() => {
    shortcutCheckIdRef.current++;
    setCandidate(savedShortcut);
    setShortcutCheck({ status: "idle", availability: null });
  }, [savedShortcut]);

  const save = useCallback(
    async (patch: ClientSettingsPatch) => {
      setSetupError(null);
      try {
        await updateSettings(patch);
        return await refreshState();
      } catch (error) {
        setSetupError(snapShotSettingsError("Couldn't save capture settings", error));
      }
    },
    [refreshState, updateSettings],
  );

  const saveIncludeAccessibility = useCallback(
    async (includeAccessibility: boolean) => {
      const change = resolveSnapShotIncludeAccessibilityChange(
        includeAccessibility,
        settings.snapShotEnabled,
      );
      try {
        if (change.requestPermissions) await bridge?.requestSnapShotPermissions(true);
        await save(change.patch);
      } catch (error) {
        setSetupError(snapShotSettingsError("Couldn't allow app text capture", error));
      }
    },
    [bridge, save, settings.snapShotEnabled],
  );

  const checkShortcut = useCallback(
    async (shortcut: SnapShotShortcut) => {
      const checkId = ++shortcutCheckIdRef.current;
      setCandidate(shortcut);
      const conflict = snapShotKeybindingConflict(shortcut, keybindings, platform);
      if (conflict || !bridge) return;
      setShortcutCheck({ status: "checking", availability: null });
      try {
        const availability = await bridge.checkSnapShotShortcut(shortcut);
        if (checkId === shortcutCheckIdRef.current) {
          setShortcutCheck({ status: "checked", availability });
        }
      } catch (error) {
        if (checkId !== shortcutCheckIdRef.current) return;
        setShortcutCheck(snapShotShortcutCheckFailed(error));
      }
    },
    [bridge, keybindings, platform],
  );

  const {
    recording,
    stopRecording,
    input: shortcutInput,
  } = useSnapShotShortcutRecorder({
    shortcut: draft.displayShortcut,
    shortcutLabel: draft.shortcutLabel ?? undefined,
    disabled: setupBusy,
    allowModifierPairs: draft.allowModifierPairs,
    onRecord: (shortcut) => void checkShortcut(shortcut),
    onStart: () => {
      shortcutCheckIdRef.current++;
      setShortcutCheck({ status: "idle", availability: null });
    },
    onError: (message) => setShortcutCheck(snapShotShortcutUnavailable(message)),
  });

  const model = buildSnapShotSettingsModel({
    hasSnapShotBridge: Boolean(bridge),
    hasDesktopBridge: typeof window !== "undefined" && Boolean(window.desktopBridge),
    state,
    settings,
    keybindings,
    platform,
    candidateShortcut: candidate,
    shortcutCheck,
    recording,
    setupBusy,
    wizardOpen: wizard !== null,
  });
  const { canSaveShortcut, shortcutChanged, shortcutStatus } = model;

  const openSetup = async (requested: SnapShotSetupRequest = "resume") => {
    if (!state || setupBusy) return;
    stopRecording();
    shortcutCheckIdRef.current++;
    setCandidate(savedShortcut);
    setShortcutCheck({ status: "idle", availability: null });
    setSetupError(null);
    setSetupBusy(true);
    try {
      let current = await refreshState();
      if (!current) return;
      const plan = resolveSnapShotOpenSetup({
        state: current,
        requested,
        enabled: settings.snapShotEnabled,
      });
      if (plan.enableFirst) {
        // Opening setup is the opt-in. Restore registration before resuming a
        // later step, just as Continue does on the access step.
        current = await save({ snapShotEnabled: true });
        if (!current) {
          // A settings write can succeed even if the following status check
          // fails. Keep Finish later available to turn capture back off.
          setWizard({ initialStep: "access", wasEnabled: false });
          return;
        }
      }
      setWizard({
        initialStep: captureSetupInitialStep(current, plan.requested),
        wasEnabled: settings.snapShotEnabled,
      });
    } finally {
      setSetupBusy(false);
    }
  };

  const enableForSetup = async () => {
    if (setupBusy) return false;
    setSetupBusy(true);
    setSetupError(null);
    const plan = resolveSnapShotEnableForSetup({
      state,
      enabled: settings.snapShotEnabled,
      includeAccessibility: settings.snapShotIncludeAccessibility,
      wizardWasEnabled: wizard?.wasEnabled ?? null,
    });
    try {
      if (plan.macCaptureTest) {
        saveSnapShotSetupResume(plan.macCaptureTest.resumeWasEnabled);
        if (!bridge?.setupSnapShot) throw new Error("Restart T3 Code to finish capture setup.");
        await bridge.setupSnapShot("test-mac-capture");
      }
      if (plan.requestPermissions)
        await bridge?.requestSnapShotPermissions(plan.requestPermissions.includeAccessibility);
      const nextState =
        plan.finish.kind === "refresh" ? await refreshState() : await save(plan.finish.patch);
      return snapShotSetupReady(nextState);
    } catch (error) {
      setSetupError(snapShotSettingsError("Couldn't verify capture access", error));
      return false;
    } finally {
      setSetupBusy(false);
    }
  };

  const closeSetup = async (completed: boolean) => {
    if (!wizard || setupBusy) return;
    setSetupBusy(true);
    try {
      const plan = resolveSnapShotCloseSetup({
        enabled: settings.snapShotEnabled,
        wasEnabled: wizard.wasEnabled,
        completed,
      });
      if (plan.disableCapture) {
        if (!(await save({ snapShotEnabled: false }))) return;
      }
      stopRecording();
      setSetupError(null);
      clearSnapShotSetupResume();
      setWizard(null);
    } catch (error) {
      setSetupError(snapShotSettingsError("Couldn't close capture setup", error));
    } finally {
      setSetupBusy(false);
    }
  };

  const saveShortcut = async () => {
    if (!canSaveShortcut || setupBusy) return false;
    setSetupBusy(true);
    try {
      return snapShotShortcutSaved(await save({ snapShotShortcut: candidate }));
    } finally {
      setSetupBusy(false);
    }
  };

  const enabledRow = model.enabled;
  const shortcutRow = model.shortcut;
  const soundRow = model.sound;

  return (
    <SettingsPageContainer>
      <SettingsSection id={model.sectionId} title={model.title}>
        <SettingsUnavailableGroup message={model.unavailableMessage ?? undefined}>
          <SettingsRow
            {...searchableSetting("snap-shot-enabled")}
            description={enabledRow.description}
            status={enabledRow.status ?? undefined}
            control={
              <>
                {enabledRow.setupButton ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={enabledRow.setupButton.disabled}
                    onClick={() => void openSetup()}
                  >
                    {enabledRow.setupButton.label}
                  </Button>
                ) : null}
                <Switch
                  checked={enabledRow.checked}
                  disabled={enabledRow.disabled}
                  aria-label={enabledRow.ariaLabel}
                  onCheckedChange={(checked) => {
                    const intent = resolveSnapShotEnabledChange(checked, state);
                    if (intent.kind === "save") void save(intent.patch);
                    else void openSetup();
                  }}
                />
              </>
            }
          />
          {model.showCaptureOptions ? (
            <>
              <SettingsRow
                {...searchableSetting("snap-shot-accessibility")}
                description={model.accessibility.description}
                status={model.accessibility.status ?? undefined}
                control={
                  <Switch
                    checked={model.accessibility.checked}
                    disabled={model.accessibility.disabled}
                    aria-label={model.accessibility.ariaLabel}
                    onCheckedChange={(checked) => void saveIncludeAccessibility(checked)}
                  />
                }
              />
              <SettingsRow
                {...searchableSetting("snap-shot-shortcut")}
                description={shortcutRow.description}
                status={shortcutRow.managed ? undefined : shortcutStatus}
                control={
                  shortcutRow.changeButton ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={shortcutRow.changeButton.disabled}
                      onClick={() => void openSetup("shortcut")}
                    >
                      {shortcutRow.changeButton.label}
                    </Button>
                  ) : (
                    <>
                      {shortcutInput}
                      {shortcutRow.saveButton && shortcutRow.cancelButton ? (
                        <>
                          <Button
                            size="xs"
                            disabled={shortcutRow.saveButton.disabled}
                            onClick={() => void saveShortcut()}
                          >
                            {shortcutRow.saveButton.label}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={shortcutRow.cancelButton.disabled}
                            onClick={() => {
                              stopRecording();
                              shortcutCheckIdRef.current++;
                              setCandidate(savedShortcut);
                              setShortcutCheck({ status: "idle", availability: null });
                            }}
                          >
                            {shortcutRow.cancelButton.label}
                          </Button>
                        </>
                      ) : shortcutRow.permissionsButton ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={shortcutRow.permissionsButton.disabled}
                          onClick={() => void setup("retry-shortcut")}
                        >
                          {shortcutRow.permissionsButton.label}
                        </Button>
                      ) : null}
                    </>
                  )
                }
              />
              <SettingsRow
                {...searchableSetting("snap-shot-sound")}
                description={soundRow.description}
                control={
                  <Menu>
                    <MenuTrigger
                      aria-label={soundRow.triggerAriaLabel}
                      render={<SelectButton size="sm" />}
                      className="w-auto min-w-0"
                      disabled={soundRow.disabled}
                    >
                      {soundOptionLabel(soundRow.selectedOption)}
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuRadioGroup
                        onValueChange={(value) => {
                          const patch = resolveSnapShotSoundChange(value);
                          if (patch) void save(patch);
                        }}
                        value={soundRow.value}
                      >
                        {soundRow.options.map((option) => {
                          const preview = option.preview;
                          return preview ? (
                            <div key={option.value} className={soundOptionRowClassName}>
                              <MenuRadioItem closeOnClick value={option.value}>
                                {soundOptionLabel(option)}
                              </MenuRadioItem>
                              <MenuItem
                                aria-label={preview.ariaLabel}
                                closeOnClick={false}
                                onClick={() => playSnapShotSound(preview.sound)}
                              >
                                <PlayIcon />
                              </MenuItem>
                            </div>
                          ) : (
                            <MenuRadioItem key={option.value} closeOnClick value={option.value}>
                              {soundOptionLabel(option)}
                            </MenuRadioItem>
                          );
                        })}
                      </MenuRadioGroup>
                    </MenuPopup>
                  </Menu>
                }
              />
              <SettingsRow
                {...searchableSetting("snap-shot-flash")}
                description={model.flash.description}
                status={model.flash.status ?? undefined}
                control={
                  <Switch
                    checked={model.flash.checked}
                    disabled={model.flash.disabled}
                    aria-label={model.flash.ariaLabel}
                    onCheckedChange={(checked) => void save({ snapShotFlash: checked })}
                  />
                }
              />
              <SettingsRow
                {...searchableSetting("snap-shot-animations")}
                description={model.animations.description}
                status={model.animations.status ?? undefined}
                control={
                  <Switch
                    checked={model.animations.checked}
                    disabled={model.animations.disabled}
                    aria-label={model.animations.ariaLabel}
                    onCheckedChange={(checked) => void save({ snapShotAnimations: checked })}
                  />
                }
              />
            </>
          ) : null}
        </SettingsUnavailableGroup>
      </SettingsSection>
      {wizard && state ? (
        <SnapShotSetupDialog
          state={state}
          initialStep={wizard.initialStep}
          wasEnabled={wizard.wasEnabled}
          includeAccessibility={settings.snapShotIncludeAccessibility}
          busy={setupBusy}
          error={setupError?.message ?? null}
          shortcutInput={shortcutInput}
          shortcutStatus={shortcutStatus}
          shortcutChanged={shortcutChanged}
          canSaveShortcut={canSaveShortcut}
          onSaveShortcut={saveShortcut}
          onEnable={enableForSetup}
          onAction={setup}
          onRefresh={refreshState}
          onClose={closeSetup}
          onLeaveStep={stopRecording}
        />
      ) : null}
    </SettingsPageContainer>
  );
}
