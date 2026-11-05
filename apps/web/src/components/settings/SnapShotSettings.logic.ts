import {
  isModifierPairShortcut,
  type ClientSettings,
  type ClientSettingsPatch,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotShortcutAvailability,
  type DesktopSnapShotState,
  type KeybindingCommand,
  type KeybindingShortcut,
  type SnapShotShortcut,
  type SnapShotSound,
} from "@t3tools/contracts";

import { sameSnapShotShortcut, snapShotKeybindingConflict } from "../../lib/snapShotShortcut";
import { commandLabel } from "./KeybindingsSettings.logic";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupInitialStep,
  captureSetupMacPermissionsReady,
  captureSetupShouldDisableOnClose,
  type CaptureSetupStep,
} from "./SnapShotSetupDialog.logic";
import {
  buildSnapShotShortcutRecorderModel,
  SNAP_SHOT_SHORTCUT_RECORDING_STATUS,
  type SnapShotShortcutRecorderModel,
} from "./useSnapShotShortcutRecorder.logic";

export function snapShotStatus(state: DesktopSnapShotState | null, enabled: boolean): string {
  if (!state) return "Checking snapshots…";
  if (state.mode === "unavailable") return state.message ?? "Not supported on this platform.";
  if (!enabled) return "Turn this on to set up snapshots.";
  return snapShotSetupSummary(state, enabled);
}

export function snapShotSetupSummary(state: DesktopSnapShotState, enabled: boolean): string {
  if (state.message) return "Capture needs attention";
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error"
      ? "Check capture access in setup"
      : "Install the capture helper to continue";
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return "Set up active-window snapshots";
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error"
      ? "Check capture access in setup"
      : "Install the capture helper to continue";
  if (captureSetupBackend(state) === "picker")
    return "Manual capture only — you'll choose a window each time";
  if (!enabled) return "Enable capture to continue";
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? "Connecting your shortcut…"
      : "Waiting for shortcut permission";
  if (state.shortcutVerified) return "Ready to capture";
  if (state.linuxBackend === "niri" && state.shortcutBinding)
    return "Use your shortcut from another app";
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return "Use your shortcut from another app";
  if (state.shortcutRegistered) return state.shortcutLabel ? "Ready to capture" : "Shortcut saved";
  return "Finish shortcut setup";
}

export function snapShotShortcutStatus(state: DesktopSnapShotState | null): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland") return state.shortcutMessage;
  if (state.shortcutPending) return "Approve the shortcut permission prompt to continue.";
  if (state.shortcutRegistered) return state.mode === "portal" ? null : "Shortcut saved.";
  return state.shortcutMessage;
}

export function snapShotSetupButtonLabel(state: DesktopSnapShotState | null): string {
  if (!state) return "Continue setup";
  if (captureSetupAccessReady(state)) return "Manage capture";
  const desktop = captureSetupDesktopName(state);
  return desktop ? `Set up ${desktop} capture` : "Continue setup";
}

// Windows needs no permissions or setup: turning capture on is enough. macOS setup
// has nothing left to manage once permissions and the shortcut are in place; the
// shortcut row stays editable inline. Revoking a permission brings the button back
// as "Continue setup" through the state message.
export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? "Capture effects aren't available on this desktop."
      : "Install or update the capture helper to enable effects.";
  if (state.linuxBackend === "niri") return "Capture effects aren't available on Niri.";
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? "Capture effects aren't available on this desktop."
      : "Install or update the capture helper to enable effects.";
  return state.linuxBackend === "gnome-extension"
    ? "Update the GNOME extension, then sign out and back in to enable effects."
    : captureSetupBackend(state) === "gnome"
      ? "Finish extension setup to enable effects."
      : "Capture effects aren't available on this desktop.";
}

export function snapShotDescription(state: DesktopSnapShotState | null): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? "Automatic capture isn't available here. Choose a window instead."
    : "Capture a window and attach it to your current draft.";
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return "This desktop only provides a screenshot.";
  return undefined;
}

export function snapShotUnavailableMessage(
  hasBridge: boolean,
  hasDesktopBridge = false,
): string | undefined {
  if (hasBridge) return undefined;
  return hasDesktopBridge
    ? "Update the desktop app to use snapshots."
    : "Only available in the desktop app.";
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}

export type SnapShotSettingsError = {
  readonly title: string;
  readonly message: string;
};

export function snapShotSettingsError(title: string, error: unknown): SnapShotSettingsError {
  return { title, message: error instanceof Error ? error.message : "Try again." };
}

export type SnapShotShortcutCheck =
  | { readonly status: "idle"; readonly availability: null }
  | { readonly status: "checking"; readonly availability: null }
  | {
      readonly status: "checked";
      readonly availability: DesktopSnapShotShortcutAvailability;
    };

export function snapShotShortcutUnavailable(message: string): SnapShotShortcutCheck {
  return { status: "checked", availability: { available: false, message } };
}

export function snapShotShortcutCheckFailed(error: unknown): SnapShotShortcutCheck {
  return snapShotShortcutUnavailable(
    error instanceof Error ? error.message : "Could not check this shortcut.",
  );
}

export type SnapShotKeybinding = {
  readonly command: KeybindingCommand;
  readonly shortcut: KeybindingShortcut;
};

export type SnapShotClientSettings = Pick<
  ClientSettings,
  | "snapShotEnabled"
  | "snapShotIncludeAccessibility"
  | "snapShotShortcut"
  | "snapShotPlaySound"
  | "snapShotSound"
  | "snapShotFlash"
  | "snapShotAnimations"
>;

export type SnapShotShortcutDraftInput = {
  readonly state: DesktopSnapShotState | null;
  readonly savedShortcut: SnapShotShortcut;
  readonly candidate: SnapShotShortcut;
  readonly platform: string;
};

export type SnapShotShortcutDraft = {
  readonly managed: boolean;
  readonly changed: boolean;
  readonly displayShortcut: SnapShotShortcut;
  readonly shortcutLabel: string | null;
  readonly allowModifierPairs: boolean;
};

export function resolveSnapShotShortcutDraft(
  input: SnapShotShortcutDraftInput,
): SnapShotShortcutDraft {
  const { state } = input;
  const managed = state?.linuxBackend === "niri" || state?.linuxBackend === "hyprland";
  const changed =
    !managed && !sameSnapShotShortcut(input.candidate, input.savedShortcut, input.platform);
  return {
    managed,
    changed,
    displayShortcut: changed ? input.candidate : (state?.shortcut ?? input.savedShortcut),
    shortcutLabel: !changed ? (state?.shortcutLabel ?? null) : null,
    allowModifierPairs: state?.mode !== "portal",
  };
}

export type SnapShotSettingsButton = {
  readonly label: string;
  readonly disabled: boolean;
};

export type SnapShotSettingsSwitchRow = {
  readonly id: string;
  readonly description: string;
  readonly status: string | null;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly ariaLabel: string;
};

export type SnapShotEnabledRow = SnapShotSettingsSwitchRow & {
  readonly setupButton: SnapShotSettingsButton | null;
};

export type SnapShotShortcutRow = {
  readonly id: string;
  readonly description: string;
  readonly status: string | null;
  readonly managed: boolean;
  readonly changeButton: SnapShotSettingsButton | null;
  readonly recorder: SnapShotShortcutRecorderModel;
  readonly saveButton: SnapShotSettingsButton | null;
  readonly cancelButton: SnapShotSettingsButton | null;
  readonly permissionsButton: SnapShotSettingsButton | null;
};

export type SnapShotSoundOption = {
  readonly value: SnapShotSoundSelection;
  readonly label: string;
  readonly badge: string | null;
  readonly preview: { readonly sound: SnapShotSound; readonly ariaLabel: string } | null;
};

export type SnapShotSoundRow = {
  readonly id: string;
  readonly description: string;
  readonly value: SnapShotSoundSelection;
  readonly selectedOption: SnapShotSoundOption;
  readonly valueLabel: string;
  readonly triggerAriaLabel: string;
  readonly disabled: boolean;
  readonly options: readonly SnapShotSoundOption[];
};

export type SnapShotSettingsModelInput = {
  readonly hasSnapShotBridge: boolean;
  readonly hasDesktopBridge: boolean;
  readonly state: DesktopSnapShotState | null;
  readonly settings: SnapShotClientSettings;
  readonly keybindings: readonly SnapShotKeybinding[];
  readonly platform: string;
  readonly candidateShortcut: SnapShotShortcut;
  readonly shortcutCheck: SnapShotShortcutCheck;
  readonly recording: boolean;
  readonly setupBusy: boolean;
  readonly wizardOpen: boolean;
};

export type SnapShotSettingsModel = {
  readonly sectionId: string;
  readonly title: string;
  readonly unavailableMessage: string | null;
  readonly captureAvailable: boolean;
  readonly shortcutChanged: boolean;
  readonly canSaveShortcut: boolean;
  readonly shortcutStatus: string | null;
  readonly enabled: SnapShotEnabledRow;
  readonly showCaptureOptions: boolean;
  readonly accessibility: SnapShotSettingsSwitchRow;
  readonly shortcut: SnapShotShortcutRow;
  readonly sound: SnapShotSoundRow;
  readonly flash: SnapShotSettingsSwitchRow;
  readonly animations: SnapShotSettingsSwitchRow;
};

const SNAP_SHOT_SOUND_OFF: SnapShotSoundOption = {
  value: "off",
  label: "Off",
  badge: null,
  preview: null,
};

const SNAP_SHOT_SOUND_OPTIONS: readonly SnapShotSoundOption[] = [
  SNAP_SHOT_SOUND_OFF,
  {
    value: "soft-pop",
    label: "Whoosh",
    badge: "(Default)",
    preview: { sound: "soft-pop", ariaLabel: "Play Whoosh" },
  },
  {
    value: "camera-shutter",
    label: "Click",
    badge: null,
    preview: { sound: "camera-shutter", ariaLabel: "Play Click" },
  },
];

function snapShotSoundOptionLabel(option: SnapShotSoundOption): string {
  return option.badge ? `${option.label} ${option.badge}` : option.label;
}

export function buildSnapShotSettingsModel(
  input: SnapShotSettingsModelInput,
): SnapShotSettingsModel {
  const { state, settings, setupBusy } = input;
  const captureAvailable =
    input.hasSnapShotBridge && state !== null && state.mode !== "unavailable";
  const feedbackUnavailable = snapShotFeedbackUnavailableMessage(state) ?? null;
  const accessibilityUnavailable = snapShotAccessibilityUnavailableMessage(state) ?? null;
  const savedShortcut = settings.snapShotShortcut;
  const draft = resolveSnapShotShortcutDraft({
    state,
    savedShortcut,
    candidate: input.candidateShortcut,
    platform: input.platform,
  });
  const candidateConflict = draft.changed
    ? snapShotKeybindingConflict(input.candidateShortcut, input.keybindings, input.platform)
    : null;
  const { shortcutCheck } = input;
  const canSaveShortcut =
    draft.changed && candidateConflict === null && shortcutCheck.availability?.available === true;
  const shortcutStatus = input.recording
    ? SNAP_SHOT_SHORTCUT_RECORDING_STATUS
    : candidateConflict
      ? `T3 Code already uses this for "${commandLabel(candidateConflict)}".`
      : shortcutCheck.status === "checking"
        ? "Checking shortcut…"
        : shortcutCheck.availability
          ? shortcutCheck.availability.available
            ? "Ready to save."
            : shortcutCheck.availability.message
          : state?.mode === "portal" &&
              !state.shortcutLabel &&
              isModifierPairShortcut(draft.displayShortcut)
            ? "Try a shortcut such as Ctrl+Shift+2."
            : snapShotShortcutStatus(state);
  const soundSelection: SnapShotSoundSelection = settings.snapShotPlaySound
    ? settings.snapShotSound
    : "off";
  const soundOption =
    SNAP_SHOT_SOUND_OPTIONS.find((option) => option.value === soundSelection) ??
    SNAP_SHOT_SOUND_OFF;
  const soundLabel = snapShotSoundOptionLabel(soundOption);

  return {
    sectionId: "snap-shot",
    title: "SnapShots",
    unavailableMessage:
      snapShotUnavailableMessage(input.hasSnapShotBridge, input.hasDesktopBridge) ?? null,
    captureAvailable,
    shortcutChanged: draft.changed,
    canSaveShortcut,
    shortcutStatus,
    enabled: {
      id: "snap-shot-enabled",
      description: snapShotDescription(state),
      status: input.hasSnapShotBridge
        ? setupBusy && !input.wizardOpen
          ? "Updating capture settings…"
          : snapShotStatus(state, settings.snapShotEnabled)
        : null,
      checked: settings.snapShotEnabled || input.wizardOpen,
      disabled: !captureAvailable || setupBusy,
      ariaLabel: "Enable snapshots",
      setupButton:
        settings.snapShotEnabled &&
        !snapShotSetupComplete(state, settings.snapShotIncludeAccessibility)
          ? { label: snapShotSetupButtonLabel(state), disabled: setupBusy }
          : null,
    },
    showCaptureOptions: settings.snapShotEnabled && captureAvailable,
    accessibility: {
      id: "snap-shot-accessibility",
      description: "Include text and controls when the app makes them available.",
      status: accessibilityUnavailable,
      checked: !accessibilityUnavailable && settings.snapShotIncludeAccessibility,
      disabled: !captureAvailable || Boolean(accessibilityUnavailable),
      ariaLabel: "Include app text in snapshots",
    },
    shortcut: {
      id: "snap-shot-shortcut",
      description:
        state?.linuxBackend === "picker"
          ? "Choose a window to capture from any app."
          : "Capture the window you're using without switching apps.",
      status: shortcutStatus,
      managed: draft.managed,
      changeButton: draft.managed ? { label: "Change shortcut", disabled: setupBusy } : null,
      recorder: buildSnapShotShortcutRecorderModel({
        shortcut: draft.displayShortcut,
        shortcutLabel: draft.shortcutLabel,
        recording: input.recording,
        disabled: setupBusy,
        allowModifierPairs: draft.allowModifierPairs,
        platform: input.platform,
      }),
      saveButton:
        !draft.managed && draft.changed
          ? { label: setupBusy ? "Saving…" : "Save", disabled: !canSaveShortcut || setupBusy }
          : null,
      cancelButton:
        !draft.managed && draft.changed ? { label: "Cancel", disabled: setupBusy } : null,
      permissionsButton:
        !draft.managed &&
        !draft.changed &&
        state?.mode === "portal" &&
        state.shortcutCanRetry !== false &&
        !isModifierPairShortcut(savedShortcut)
          ? {
              label: "Shortcut permissions",
              disabled: setupBusy || Boolean(state.shortcutPending),
            }
          : null,
    },
    sound: {
      id: "snap-shot-sound",
      description: "Choose the sound played when capture starts.",
      value: soundSelection,
      selectedOption: soundOption,
      valueLabel: soundLabel,
      triggerAriaLabel: "Snapshot sound: " + soundLabel,
      disabled: !captureAvailable,
      options: SNAP_SHOT_SOUND_OPTIONS,
    },
    flash: {
      id: "snap-shot-flash",
      description: "Show a gentle cue on the captured window.",
      status: feedbackUnavailable,
      checked: !feedbackUnavailable && settings.snapShotFlash,
      disabled: !captureAvailable || Boolean(feedbackUnavailable),
      ariaLabel: "Flash captured window",
    },
    animations: {
      id: "snap-shot-animations",
      description: "Animate captured windows into your draft.",
      status: feedbackUnavailable,
      checked: !feedbackUnavailable && settings.snapShotAnimations,
      disabled: !captureAvailable || Boolean(feedbackUnavailable),
      ariaLabel: "Animate snapshots",
    },
  };
}

export type SnapShotEnabledIntent =
  | { readonly kind: "save"; readonly patch: ClientSettingsPatch }
  | { readonly kind: "open-setup" };

export function resolveSnapShotEnabledChange(
  checked: boolean,
  state: DesktopSnapShotState | null,
): SnapShotEnabledIntent {
  if (!checked) return { kind: "save", patch: { snapShotEnabled: false } };
  if (state?.windows) return { kind: "save", patch: { snapShotEnabled: true } };
  return { kind: "open-setup" };
}

export function resolveSnapShotSoundChange(value: unknown): ClientSettingsPatch | null {
  const option = SNAP_SHOT_SOUND_OPTIONS.find((candidate) => candidate.value === value);
  return option ? snapShotSoundPatch(option.value) : null;
}

export type SnapShotIncludeAccessibilityChange = {
  readonly requestPermissions: boolean;
  readonly patch: ClientSettingsPatch;
};

export function resolveSnapShotIncludeAccessibilityChange(
  includeAccessibility: boolean,
  enabled: boolean,
): SnapShotIncludeAccessibilityChange {
  return {
    requestPermissions: includeAccessibility && enabled,
    patch: { snapShotIncludeAccessibility: includeAccessibility },
  };
}

export type SnapShotSetupActionPlan = {
  readonly saveResume: boolean;
  readonly errorTitle: string;
};

export function resolveSnapShotSetupAction(input: {
  readonly action: DesktopSnapShotSetupAction;
  readonly state: DesktopSnapShotState | null;
  readonly wizardOpen: boolean;
}): SnapShotSetupActionPlan {
  const { action } = input;
  return {
    saveResume:
      Boolean(input.state?.macPermissions) &&
      input.wizardOpen &&
      (action === "allow-screen-recording" || action === "allow-accessibility"),
    errorTitle:
      action === "retry-shortcut"
        ? "Couldn't open shortcut permissions"
        : "Couldn't complete capture setup",
  };
}

export type SnapShotWizard = {
  readonly initialStep: CaptureSetupStep;
  readonly wasEnabled: boolean;
};

export function resolveSnapShotSetupResume(
  state: DesktopSnapShotState | undefined,
  resume: { readonly wasEnabled: boolean } | null,
): SnapShotWizard | null {
  return state?.macPermissions && resume
    ? { initialStep: "access", wasEnabled: resume.wasEnabled }
    : null;
}

export type SnapShotSetupRequest = CaptureSetupStep | "resume";

export type SnapShotOpenSetupPlan = {
  readonly requested: SnapShotSetupRequest;
  readonly enableFirst: boolean;
};

export function resolveSnapShotOpenSetup(input: {
  readonly state: DesktopSnapShotState;
  readonly requested: SnapShotSetupRequest;
  readonly enabled: boolean;
}): SnapShotOpenSetupPlan {
  const requested = input.state.macPermissions ? "access" : input.requested;
  return {
    requested,
    enableFirst: !input.enabled && captureSetupInitialStep(input.state, requested) !== "access",
  };
}

export type SnapShotEnableForSetupPlan = {
  readonly macCaptureTest: { readonly resumeWasEnabled: boolean } | null;
  readonly requestPermissions: { readonly includeAccessibility: boolean } | null;
  readonly finish:
    | { readonly kind: "refresh" }
    | { readonly kind: "save"; readonly patch: ClientSettingsPatch };
};

export function resolveSnapShotEnableForSetup(input: {
  readonly state: DesktopSnapShotState | null;
  readonly enabled: boolean;
  readonly includeAccessibility: boolean;
  readonly wizardWasEnabled: boolean | null;
}): SnapShotEnableForSetupPlan {
  const { state } = input;
  return {
    macCaptureTest: state?.macPermissions
      ? { resumeWasEnabled: input.wizardWasEnabled ?? input.enabled }
      : null,
    requestPermissions:
      state?.mode === "direct" ? { includeAccessibility: input.includeAccessibility } : null,
    finish:
      input.enabled && !state?.message
        ? { kind: "refresh" }
        : { kind: "save", patch: { snapShotEnabled: true } },
  };
}

export function snapShotSetupReady(state: DesktopSnapShotState | undefined): boolean {
  return state !== undefined && captureSetupAccessReady(state);
}

export function resolveSnapShotCloseSetup(input: {
  readonly enabled: boolean;
  readonly wasEnabled: boolean;
  readonly completed: boolean;
}): { readonly disableCapture: boolean } {
  return {
    disableCapture:
      input.enabled && captureSetupShouldDisableOnClose(input.wasEnabled, input.completed),
  };
}

export function snapShotShortcutSaved(state: DesktopSnapShotState | undefined): boolean {
  return Boolean(state?.shortcutRegistered || state?.shortcutPending);
}
