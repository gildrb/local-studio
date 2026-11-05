import {
  isModifierPairShortcut,
  type DesktopCaptureConfigApplied,
  type DesktopCaptureConfigPreview,
  type DesktopCaptureConfigRequest,
  type DesktopSnapShotState,
  type KeybindingShortcut,
  type SnapShotShortcut,
} from "@t3tools/contracts";
import { parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";

import { shortcutToKeybindingInput } from "./KeybindingsSettings.logic";
import { SNAP_SHOT_SHORTCUT_RECORDING_STATUS } from "./useSnapShotShortcutRecorder.logic";

const DEFAULT_CAPTURE_SHORTCUT: KeybindingShortcut = {
  key: "2",
  metaKey: false,
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  modKey: false,
};

export type CaptureShortcutConfigWorking = "reading" | "writing";
export type CaptureShortcutConfigOperation = DesktopCaptureConfigPreview["operation"];

export type CaptureShortcutConfigError = {
  readonly message: string;
  readonly detail?: string;
};

export type CaptureShortcutConfigButton = {
  readonly label: string;
  readonly disabled: boolean;
};

export type CaptureShortcutConfigBusyButton = CaptureShortcutConfigButton & {
  readonly ariaBusy: boolean;
};

export type CaptureShortcutConfigPreviewModel = {
  readonly message: string;
  readonly changed: boolean;
  readonly diffAriaLabel: string;
  readonly note: string | null;
  readonly primaryButton: CaptureShortcutConfigBusyButton | null;
  readonly cancelButton: CaptureShortcutConfigButton;
};

export type CaptureShortcutConfigReviewModel = {
  readonly intro: string;
  readonly button: CaptureShortcutConfigBusyButton;
  readonly unsupportedNote: string | null;
};

export type CaptureShortcutConfigAdvancedModel = {
  readonly summary: string;
  readonly troubleshootingTitle: string;
  readonly troubleshooting: string | null;
  readonly settingsFileTitle: string;
  readonly settingsFilePath: string;
  readonly includeNote: string | null;
  readonly linkNote: string | null;
  readonly chooseFileButton: CaptureShortcutConfigButton;
  readonly removeButton: CaptureShortcutConfigButton;
  readonly reviewButton: CaptureShortcutConfigButton | null;
  readonly settingsFileHelp: string;
  readonly configLocationNote: string;
  readonly backupLabel: string | null;
  readonly manualSetupTitle: string;
  readonly manualSetupInstructions: string;
  readonly binding: string | null;
  readonly copyButton: CaptureShortcutConfigButton;
  readonly turnOffNote: string;
  readonly registrationStatus: { readonly message: string | null } | null;
  readonly completeButton: CaptureShortcutConfigButton | null;
};

export type CaptureShortcutConfigModelInput = {
  readonly state: DesktopSnapShotState;
  readonly supported: boolean;
  readonly disabled: boolean;
  readonly recording: boolean;
  readonly working: CaptureShortcutConfigWorking | null;
  readonly preview: DesktopCaptureConfigPreview | null;
  readonly result: DesktopCaptureConfigApplied | null;
  readonly error: CaptureShortcutConfigError | null;
  readonly copied: boolean;
  readonly canComplete: boolean;
};

export type CaptureShortcutConfigModel = {
  readonly shortcutLabel: string | null;
  readonly recordingStatus: string | null;
  readonly resultMessage: string | null;
  readonly preview: CaptureShortcutConfigPreviewModel | null;
  readonly review: CaptureShortcutConfigReviewModel | null;
  readonly errorMessage: string | null;
  readonly connectionStatus: string | null;
  readonly advanced: CaptureShortcutConfigAdvancedModel;
};

export type CaptureShortcutRecorderInput = {
  readonly disabled: boolean;
  readonly working: CaptureShortcutConfigWorking | null;
  readonly keys: string | null;
  readonly preview: DesktopCaptureConfigPreview | null;
};

export type CaptureShortcutRecorderSetup = {
  readonly shortcut: KeybindingShortcut;
  readonly disabled: boolean;
};

export function resolveCaptureShortcutRecorder(
  input: CaptureShortcutRecorderInput,
): CaptureShortcutRecorderSetup {
  const shortcutKeys = (input.keys ?? input.preview?.shortcut)?.trim();
  return {
    shortcut: shortcutKeys
      ? (parseKeybindingShortcut(shortcutKeys.replace(/super/gi, "meta")) ??
        DEFAULT_CAPTURE_SHORTCUT)
      : DEFAULT_CAPTURE_SHORTCUT,
    disabled: input.disabled || input.working !== null,
  };
}

export function resolveCaptureShortcutRecordedKeys(shortcut: SnapShotShortcut): string | null {
  if (isModifierPairShortcut(shortcut)) return null;
  return shortcutToKeybindingInput({
    ...shortcut,
    ctrlKey: shortcut.ctrlKey || shortcut.modKey,
    modKey: false,
  });
}

export function resolveCaptureConfigPreviewRequest(input: {
  readonly operation: CaptureShortcutConfigOperation;
  readonly chooseFile: boolean;
  readonly keys: string | null;
}): DesktopCaptureConfigRequest {
  const shortcut = input.keys?.trim();
  return {
    operation: input.operation,
    chooseFile: input.chooseFile,
    ...(shortcut ? { shortcut } : {}),
  };
}

/** The reviewed change to the desktop settings file, or null when nothing changes. */
export function captureConfigPreviewDiff(
  preview: DesktopCaptureConfigPreview | null,
): FileDiffMetadata | null {
  if (!preview || preview.before === preview.after) return null;
  return parseDiffFromFile(
    { name: preview.path, contents: preview.before },
    { name: preview.path, contents: preview.after },
  );
}

function captureConfigError(message: string, cause: unknown): CaptureShortcutConfigError {
  return { message, ...(cause instanceof Error ? { detail: cause.message } : {}) };
}

export function captureConfigPreviewError(cause: unknown): CaptureShortcutConfigError {
  return captureConfigError("Couldn't prepare the changes. Check Advanced for help.", cause);
}

export function captureConfigApplyError(cause: unknown): CaptureShortcutConfigError {
  return captureConfigError(
    "Couldn't save your shortcut. Review the changes and try again.",
    cause,
  );
}

export type CaptureConfigAppliedOutcome =
  | { readonly kind: "stay" }
  | {
      readonly kind: "complete";
      readonly toast: { readonly title: string; readonly description: string };
    };

export function resolveCaptureConfigApplied(input: {
  readonly preview: DesktopCaptureConfigPreview;
  readonly applied: DesktopCaptureConfigApplied;
  readonly canComplete: boolean;
}): CaptureConfigAppliedOutcome {
  if (input.applied.warning || input.preview.operation !== "install" || !input.canComplete)
    return { kind: "stay" };
  return {
    kind: "complete",
    toast: {
      title: "Shortcut saved",
      description: `Use ${input.preview.shortcut} from another app.`,
    },
  };
}

export function buildCaptureShortcutConfigModel(
  input: CaptureShortcutConfigModelInput,
): CaptureShortcutConfigModel {
  const { state, preview, result, error, working } = input;
  const busy = input.disabled || working !== null;
  const actionBusy = busy || input.recording;
  const changed = preview !== null && preview.before !== preview.after;
  const niri = state.linuxBackend === "niri";
  const desktop = niri ? "Niri" : "Hyprland";
  const advancedButtonDisabled = actionBusy || !input.supported;

  return {
    shortcutLabel: !result ? "Shortcut" : null,
    recordingStatus: input.recording ? SNAP_SHOT_SHORTCUT_RECORDING_STATUS : null,
    resultMessage: result
      ? result.warning
        ? "Saved, but the shortcut needs attention. Check Advanced for help."
        : preview?.operation === "remove"
          ? "Shortcut removed."
          : `Use ${preview?.shortcut} from another app to capture a window.`
      : null,
    preview:
      !result && preview
        ? {
            message: changed
              ? preview.operation === "remove"
                ? "Review the change below to remove your shortcut."
                : "Review the change below, then save your shortcut."
              : preview.operation === "remove"
                ? "There's no capture shortcut to remove."
                : "This shortcut is already set up.",
            changed,
            diffAriaLabel: "Shortcut changes",
            note: changed ? "Only these changes will be saved. We'll keep a backup." : null,
            primaryButton:
              changed || preview.operation === "install"
                ? {
                    label:
                      working === "writing"
                        ? "Saving…"
                        : changed
                          ? preview.operation === "install"
                            ? "Save shortcut"
                            : "Remove shortcut"
                          : "Done",
                    disabled:
                      actionBusy ||
                      (preview.operation === "install" && state.shortcutActionRegistered === false),
                    ariaBusy: working === "writing",
                  }
                : null,
            cancelButton: { label: "Cancel", disabled: actionBusy },
          }
        : null,
    review:
      !result && !preview
        ? {
            intro:
              "Allow T3 Code to read your desktop settings. You'll review any changes here before saving.",
            button: {
              label: working === "reading" ? "Preparing changes…" : "Review changes",
              disabled: actionBusy || !input.supported,
              ariaBusy: working === "reading",
            },
            unsupportedNote: !input.supported
              ? "Update T3 Code to finish setting up your shortcut."
              : null,
          }
        : null,
    errorMessage: error ? error.message : null,
    connectionStatus:
      state.shortcutActionRegistered === false && state.shortcutMessage
        ? state.shortcutPending
          ? "Connecting to your desktop…"
          : "Restart T3 Code to finish connecting your shortcut."
        : null,
    advanced: {
      summary: "Advanced",
      troubleshootingTitle: "Troubleshooting",
      troubleshooting:
        error?.detail || result?.warning ? (error?.detail ?? result?.warning ?? null) : null,
      settingsFileTitle: "Settings file",
      settingsFilePath:
        preview?.path ??
        state.shortcutConfigPath ??
        (niri ? "~/.config/niri/config.kdl" : "~/.config/hypr/hyprland.conf"),
      includeNote: niri ? "T3 Code also reads any files included by this file." : null,
      linkNote:
        preview && preview.resolvedPath !== preview.path
          ? `Linked to ${preview.resolvedPath}. The link will be kept.`
          : null,
      chooseFileButton: { label: "Choose a different file…", disabled: advancedButtonDisabled },
      removeButton: { label: "Remove shortcut…", disabled: advancedButtonDisabled },
      reviewButton: result ? { label: "Review changes", disabled: advancedButtonDisabled } : null,
      settingsFileHelp: "Use your desktop's shortcut settings file.",
      configLocationNote: niri
        ? "A custom --config or NIRI_CONFIG can change its location."
        : "On Omarchy, use your own bindings file, not its defaults.",
      backupLabel: result?.backupPath ? `Backup: ${result.backupPath}` : null,
      manualSetupTitle: "Manual setup",
      manualSetupInstructions: `${
        niri
          ? "Paste this inside binds { … } in your Niri config, then save."
          : "Add this binding to your Hyprland config, then save."
      } Change the keys if needed.`,
      binding: state.shortcutBinding ?? null,
      copyButton: {
        label: input.copied ? "Copied" : "Copy shortcut",
        disabled: actionBusy || !state.shortcutBinding,
      },
      turnOffNote: `Turn capture off in T3 Code to stop it. Remove the shortcut from ${desktop} to free up the keys.`,
      registrationStatus:
        state.shortcutActionRegistered === false ? { message: state.shortcutMessage } : null,
      completeButton: input.canComplete
        ? {
            label: "I've added the shortcut",
            disabled: actionBusy || state.shortcutActionRegistered === false,
          }
        : null,
    },
  };
}
