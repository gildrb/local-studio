import {
  isModifierPairShortcut,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotState,
} from "@t3tools/contracts";

export type CaptureSetupStep = "access" | "shortcut";

export function captureSetupDesktopName(state: DesktopSnapShotState): string | undefined {
  if (state.mode !== "portal") return undefined;
  const desktop = state.linuxDesktop ?? captureSetupBackend(state);
  switch (desktop) {
    case "gnome":
      return "GNOME";
    case "kde":
      return "KDE Plasma";
    case "niri":
      return "Niri";
    case "hyprland":
      return "Hyprland";
    default:
      return undefined;
  }
}

export function captureSetupBackend(state: DesktopSnapShotState) {
  if (state.mode !== "portal") return "direct";
  if (state.linuxBackend === "niri") return "niri";
  if (state.linuxBackend === "kde") return "kde";
  if (state.linuxBackend === "hyprland") return "hyprland";
  if (state.linuxBackend === "screenshot-portal") return "portal";
  if (state.linuxBackend === "picker" && state.gnomeExtension?.status === "unsupported")
    return "picker";
  if (state.linuxBackend === "gnome-extension" || state.gnomeExtension) return "gnome";
  return "picker";
}

export function captureSetupAccessReady(state: DesktopSnapShotState): boolean {
  if (state.mode === "unavailable" || state.message) return false;
  if (captureSetupBackend(state) === "gnome")
    return state.gnomeExtension?.status === "enabled" && state.linuxBackend === "gnome-extension";
  if (captureSetupBackend(state) === "kde") return state.kdeHelper?.status === "ready";
  if (captureSetupBackend(state) === "hyprland") return state.hyprlandHelper?.status === "ready";
  return true;
}

export function captureSetupMacPermissionsReady(
  state: DesktopSnapShotState,
  includeAccessibility: boolean,
): boolean {
  const permissions = state.macPermissions;
  if (!permissions) return true;
  return permissions.screenRecording && (!includeAccessibility || permissions.accessibility);
}

export function captureSetupCheckMessage(state: DesktopSnapShotState): string {
  const backend = captureSetupBackend(state);
  const gnome = backend === "gnome";
  if (
    state.message ||
    (gnome && state.gnomeExtension?.status === "error") ||
    (backend === "kde" && state.kdeHelper?.status === "error") ||
    (backend === "hyprland" && state.hyprlandHelper?.status === "error")
  )
    return "Still unable to check access. See Advanced for help.";
  if (captureSetupBackend(state) === "picker") return "Ready. You'll choose a window each time.";
  if (gnome && state.gnomeExtension?.status === "restart-required")
    return "Still waiting for you to sign out and back in.";
  return captureSetupAccessReady(state)
    ? "Ready. Continue to choose your shortcut."
    : "Not ready yet. Finish the step above.";
}

export function captureSetupShortcutReady(state: DesktopSnapShotState, unsaved: boolean): boolean {
  if (unsaved || !captureSetupAccessReady(state)) return false;
  if (state.linuxBackend === "hyprland") return Boolean(state.shortcutActionRegistered);
  return state.linuxBackend === "niri"
    ? Boolean(state.shortcutBinding)
    : state.shortcutRegistered || Boolean(state.shortcutPending);
}

export function captureSetupInitialStep(
  state: DesktopSnapShotState,
  requested: CaptureSetupStep | "resume" = "resume",
): CaptureSetupStep {
  if (!captureSetupAccessReady(state)) return "access";
  if (requested === "resume") {
    // A disabled native backend hasn't checked system permissions yet. A picker
    // still needs its explanation; neither is proof of active-window access.
    if (
      (state.mode === "direct" && !state.shortcutRegistered) ||
      captureSetupBackend(state) === "picker"
    )
      return "access";
    return "shortcut";
  }
  return requested;
}

export function captureSetupShouldDisableOnClose(wasEnabled: boolean, completed: boolean): boolean {
  return !wasEnabled && !completed;
}

export const CAPTURE_SETUP_STEPS: readonly {
  readonly id: CaptureSetupStep;
  readonly label: string;
}[] = [
  { id: "access", label: "Access" },
  { id: "shortcut", label: "Shortcut" },
];

type CaptureSetupCopy = { readonly title: string; readonly description: string };

type GnomeExtensionStatus = NonNullable<DesktopSnapShotState["gnomeExtension"]>["status"];

const GNOME_ACCESS_COPY: Readonly<Record<GnomeExtensionStatus, CaptureSetupCopy>> = {
  "not-installed": {
    title: "Install the extension",
    description:
      "The T3 Code GNOME extension lets you capture other windows and bring them into your draft. Sign out once after installing.",
  },
  "restart-required": {
    title: "Extension installed",
    description: "Save your work, then sign out and back in. Your setup will be waiting here.",
  },
  "update-required": {
    title: "Update the extension",
    description: "Install the update, then sign out and back in.",
  },
  "extensions-disabled": {
    title: "Allow GNOME extensions",
    description: "Open GNOME Extensions and turn on extensions, then check again.",
  },
  disabled: {
    title: "Enable the extension",
    description: "Enable T3 Code SnapShots to start capturing windows.",
  },
  enabled: {
    title: "Capture is ready",
    description: "Next, choose your shortcut.",
  },
  unsupported: {
    title: "Automatic capture isn't available",
    description: "Use Take snapshot from the command palette to choose a window.",
  },
  error: {
    title: "Couldn't set up the extension",
    description: "Check T3 Code SnapShots in GNOME Extensions, then try again.",
  },
};

export type CaptureSetupMacPermissions = NonNullable<DesktopSnapShotState["macPermissions"]>;

export type CaptureSetupMacPermissionId = keyof CaptureSetupMacPermissions;

export function captureSetupInitialMacPermissions(
  state: DesktopSnapShotState,
): CaptureSetupMacPermissions {
  return state.macPermissions ?? { screenRecording: false, accessibility: false };
}

export function captureSetupPollsMacPermissions(
  state: DesktopSnapShotState,
  step: CaptureSetupStep,
  busy: boolean,
): boolean {
  return Boolean(state.macPermissions) && step === "access" && !busy;
}

export function resolveCaptureSetupStepChange(
  index: number,
  step: CaptureSetupStep,
): CaptureSetupStep | null {
  const next = CAPTURE_SETUP_STEPS[index];
  return next && next.id !== step ? next.id : null;
}

export type SnapShotSetupDialogIntent =
  | { readonly kind: "action"; readonly action: DesktopSnapShotSetupAction }
  | { readonly kind: "check-again" }
  | { readonly kind: "enable-and-continue" }
  | { readonly kind: "finish"; readonly saveShortcut: boolean };

export type SnapShotSetupDialogButton = {
  readonly label: string;
  readonly disabled: boolean;
};

export type SnapShotSetupDialogActionButton = SnapShotSetupDialogButton & {
  readonly action: DesktopSnapShotSetupAction;
};

export type SnapShotSetupDialogPrimaryButton =
  | (SnapShotSetupDialogButton & {
      readonly kind: "button";
      readonly ariaBusy: boolean | null;
      readonly intent: SnapShotSetupDialogIntent;
    })
  | (SnapShotSetupDialogButton & {
      readonly kind: "permission-continue";
      readonly ready: boolean;
      readonly busy: boolean;
      readonly intent: SnapShotSetupDialogIntent;
    });

export type SnapShotSetupDialogPermission = {
  readonly id: CaptureSetupMacPermissionId;
  readonly icon: "mac-screen-recording" | "mac-accessibility";
  readonly title: string;
  readonly description: string;
  readonly granted: boolean;
  readonly action: DesktopSnapShotSetupAction;
};

export type SnapShotSetupDialogAccessModel = {
  readonly checkMessage: string | null;
  readonly permissions: readonly SnapShotSetupDialogPermission[] | null;
  readonly permissionError: string | null;
  readonly reinstallHelperButton: SnapShotSetupDialogActionButton | null;
};

export type SnapShotSetupDialogShortcutModel =
  | { readonly kind: "config"; readonly disabled: boolean }
  | {
      readonly kind: "inline";
      readonly status: string | null;
      readonly retryButton: SnapShotSetupDialogActionButton | null;
    };

export type SnapShotSetupDialogAdvancedModel = {
  readonly summary: string;
  readonly details: readonly string[];
  readonly includedNote: string | null;
  readonly disableExtensionButton: SnapShotSetupDialogActionButton | null;
  readonly removeHelperButton: SnapShotSetupDialogActionButton | null;
};

export type SnapShotSetupDialogStep = {
  readonly id: CaptureSetupStep;
  readonly label: string;
  readonly disabled: boolean;
};

export type SnapShotSetupDialogModelInput = {
  readonly state: DesktopSnapShotState;
  readonly step: CaptureSetupStep;
  readonly wasEnabled: boolean;
  readonly includeAccessibility: boolean;
  readonly actionBusy: boolean;
  readonly checking: boolean;
  readonly checked: boolean;
  readonly configBusy: boolean;
  readonly error: string | null;
  readonly permissionStatus: CaptureSetupMacPermissions;
  readonly permissionError: string | null;
  readonly shortcutStatus: string | null;
  readonly shortcutChanged: boolean;
  readonly canSaveShortcut: boolean;
};

export type SnapShotSetupDialogModel = {
  readonly title: string;
  readonly busy: boolean;
  readonly dismissible: boolean;
  readonly steps: readonly SnapShotSetupDialogStep[];
  readonly currentStepIndex: number;
  readonly heading: CaptureSetupCopy;
  readonly access: SnapShotSetupDialogAccessModel | null;
  readonly shortcut: SnapShotSetupDialogShortcutModel | null;
  readonly accessAlert: string | null;
  readonly errorAlert: string | null;
  readonly advanced: SnapShotSetupDialogAdvancedModel | null;
  readonly backButton: SnapShotSetupDialogButton | null;
  readonly closeButton: SnapShotSetupDialogButton;
  readonly primaryButton: SnapShotSetupDialogPrimaryButton | null;
};

export function buildSnapShotSetupDialogModel(
  input: SnapShotSetupDialogModelInput,
): SnapShotSetupDialogModel {
  const { state, step, error, includeAccessibility, checking } = input;
  const busy = input.actionBusy || checking || input.configBusy;
  const backend = captureSetupBackend(state);
  const configShortcut = backend === "niri" || backend === "hyprland";
  const desktop = captureSetupDesktopName(state);
  const extension = state.gnomeExtension;
  const helper = backend === "hyprland" ? state.hyprlandHelper : state.kdeHelper;
  const helperBackend = backend === "kde" || backend === "hyprland";
  const installHelper = backend === "hyprland" ? "install-hyprland-helper" : "install-kde-helper";
  const removeHelper = backend === "hyprland" ? "remove-hyprland-helper" : "remove-kde-helper";
  const accessReady = captureSetupAccessReady(state);
  const macPermissions = state.macPermissions ? input.permissionStatus : null;
  const requiredPermissions: readonly CaptureSetupMacPermissionId[] = includeAccessibility
    ? ["screenRecording", "accessibility"]
    : ["screenRecording"];
  const macPermissionsReady =
    !macPermissions ||
    (input.permissionError === null && requiredPermissions.every((id) => macPermissions[id]));
  const shortcutReady = captureSetupShortcutReady(state, input.shortcutChanged);
  const install = extension?.status === "not-installed" || extension?.status === "update-required";
  const enable = extension?.status === "disabled";
  const accessCopy: CaptureSetupCopy =
    state.message && !macPermissions
      ? {
          title: "Let's try that again",
          description: "Couldn't check snapshots. Try again to continue.",
        }
      : backend === "gnome" && extension
        ? extension.status === "enabled" && !accessReady
          ? {
              title: "Check capture access",
              description: "The extension isn't ready yet. Try again in a moment.",
            }
          : GNOME_ACCESS_COPY[extension.status]
        : helperBackend
          ? helper?.status === "ready"
            ? {
                title: "Capture is ready",
                description: "Next, choose your shortcut.",
              }
            : helper?.status === "error"
              ? {
                  title: "Let's fix capture access",
                  description: "Try reinstalling the capture helper, then check again.",
                }
              : {
                  title:
                    helper?.status === "update-required"
                      ? "Update the capture helper"
                      : "Allow snapshots",
                  description:
                    "T3 Code's capture helper lets you capture other apps and return to your draft. It's included with T3 Code.",
                }
          : backend === "niri"
            ? {
                title: "Capture is ready",
                description: "Next, choose your shortcut.",
              }
            : backend === "picker"
              ? {
                  title: "Choose a window each time",
                  description:
                    "Your desktop doesn't support automatic capture. You'll choose the window to capture instead.",
                }
              : {
                  title: "Allow snapshots",
                  description:
                    backend === "portal"
                      ? "Your desktop may ask for permission when you first capture."
                      : macPermissions
                        ? macPermissionsReady
                          ? "Test a snapshot of the current window. If macOS asks to bypass its window picker, choose Allow. The test image is discarded."
                          : "Allow each permission, then continue."
                        : "Allow access when prompted to start capturing windows.",
                };
  const heading: CaptureSetupCopy =
    step === "access"
      ? accessCopy
      : {
          title: "Choose your shortcut",
          description: configShortcut
            ? "Click the shortcut, then press the keys you want."
            : state.mode === "portal"
              ? "Choose your keys, then approve the permission prompt if asked."
              : "Use both Shift keys, or record a different shortcut.",
        };
  const stepIndex = CAPTURE_SETUP_STEPS.findIndex(({ id }) => id === step);
  const details = [
    ...new Set(
      [
        error,
        ...(step === "access"
          ? [
              state.message,
              backend === "gnome" &&
              (extension?.status === "error" || extension?.status === "unsupported")
                ? extension.message
                : null,
              helperBackend && helper?.status === "error" ? helper.message : null,
            ]
          : []),
      ].filter((detail) => detail !== null),
    ),
  ];
  const helperSetup = step === "access" && (backend === "gnome" || helperBackend);

  return {
    title: desktop ? `Set up snapshots for ${desktop}` : "Set up snapshots",
    busy,
    dismissible: !busy,
    steps: CAPTURE_SETUP_STEPS.map((item, index) => ({
      id: item.id,
      label: item.label,
      disabled: busy || index > stepIndex,
    })),
    currentStepIndex: stepIndex,
    heading,
    access:
      step === "access"
        ? {
            checkMessage: input.checked && !busy && !error ? captureSetupCheckMessage(state) : null,
            permissions: macPermissions
              ? [
                  {
                    id: "screenRecording",
                    icon: "mac-screen-recording",
                    title: "Screen Recording",
                    description: "Capture the window you're using.",
                    granted: macPermissions.screenRecording,
                    action: "allow-screen-recording",
                  },
                  {
                    id: "accessibility",
                    icon: "mac-accessibility",
                    title: "Accessibility",
                    description: includeAccessibility
                      ? "Include text and controls from the captured app."
                      : "Optional. Include text and controls from the captured app.",
                    granted: macPermissions.accessibility,
                    action: "allow-accessibility",
                  },
                ]
              : null,
            permissionError: macPermissions ? input.permissionError : null,
            reinstallHelperButton:
              helperBackend && helper?.status === "error"
                ? { label: "Reinstall helper", disabled: busy, action: installHelper }
                : null,
          }
        : null,
    shortcut:
      step === "access"
        ? null
        : configShortcut
          ? { kind: "config", disabled: input.actionBusy || checking || !accessReady }
          : {
              kind: "inline",
              status: input.shortcutStatus,
              retryButton:
                !input.shortcutChanged &&
                !state.shortcutRegistered &&
                !state.shortcutPending &&
                state.shortcutCanRetry !== false &&
                !isModifierPairShortcut(state.shortcut)
                  ? {
                      label: state.mode === "portal" ? "Shortcut permissions" : "Try again",
                      disabled: busy,
                      action: "retry-shortcut",
                    }
                  : null,
            },
    accessAlert:
      step === "shortcut" && !accessReady
        ? "Capture needs attention. Go back to check access."
        : null,
    errorAlert: error ? "Couldn't finish this step. Try again or check Advanced for help." : null,
    advanced:
      details.length > 0 || helperSetup
        ? {
            summary: "Advanced",
            details,
            includedNote: helperSetup ? "Included with T3 Code. No download needed." : null,
            disableExtensionButton:
              step === "access" && backend === "gnome" && extension?.status === "enabled"
                ? { label: "Disable extension", disabled: busy, action: "disable-extension" }
                : null,
            removeHelperButton:
              step === "access" && helperBackend && helper?.status !== "not-installed"
                ? { label: "Remove capture helper", disabled: busy, action: removeHelper }
                : null,
          }
        : null,
    backButton: step !== "access" ? { label: "Back", disabled: busy } : null,
    closeButton: { label: input.wasEnabled ? "Close" : "Finish later", disabled: busy },
    primaryButton:
      step === "access"
        ? helperBackend && !accessReady && helper?.status !== "ready"
          ? {
              kind: "button",
              label: checking
                ? "Checking…"
                : busy
                  ? "Installing…"
                  : helper?.status === "error"
                    ? "Check again"
                    : helper?.status === "update-required"
                      ? "Update helper"
                      : "Install helper",
              disabled: busy,
              ariaBusy: busy,
              intent:
                helper?.status === "error"
                  ? { kind: "check-again" }
                  : { kind: "action", action: installHelper },
            }
          : backend === "gnome" && !accessReady && extension?.status !== "enabled"
            ? {
                kind: "button",
                label: checking
                  ? "Checking…"
                  : busy
                    ? install
                      ? "Installing…"
                      : enable
                        ? "Enabling…"
                        : "Working…"
                    : install
                      ? extension?.status === "update-required"
                        ? "Update extension"
                        : "Install extension"
                      : enable
                        ? "Enable extension"
                        : "Check again",
                disabled: busy,
                ariaBusy: checking,
                intent: install
                  ? { kind: "action", action: "install-extension" }
                  : enable
                    ? { kind: "action", action: "enable-extension" }
                    : { kind: "check-again" },
              }
            : {
                kind: "permission-continue",
                label: busy
                  ? "Working…"
                  : macPermissions
                    ? "Test capture and continue"
                    : backend === "direct"
                      ? "Allow capture"
                      : !accessReady && !macPermissions
                        ? "Try again"
                        : "Continue",
                ready: macPermissionsReady,
                busy,
                disabled: !macPermissionsReady || busy,
                intent: { kind: "enable-and-continue" },
              }
        : !configShortcut
          ? {
              kind: "button",
              label: busy ? "Saving…" : input.shortcutChanged ? "Save and finish" : "Done",
              disabled:
                busy ||
                !accessReady ||
                (input.shortcutChanged ? !input.canSaveShortcut : !shortcutReady),
              ariaBusy: null,
              intent: { kind: "finish", saveShortcut: input.shortcutChanged },
            }
          : null,
  };
}
