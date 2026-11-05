import type { NotificationMode } from "@t3tools/contracts/settings";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
} from "../../threadNotifications.logic";
import { searchableSetting } from "./settingsSearch";

export type NotificationModeOption = {
  readonly value: NotificationMode;
  readonly label: string;
};

export type NotificationSettingsModelInput = {
  readonly mode: NotificationMode;
  readonly permissionMessage: string | null;
  readonly requesting: boolean;
};

export type NotificationSettingsModel = {
  readonly anchorId: string;
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly value: NotificationMode;
  readonly valueLabel: string;
  readonly options: readonly NotificationModeOption[];
  readonly disabled: boolean;
};

const NOTIFICATION_SETTINGS_DESCRIPTION =
  "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open.";

const NOTIFICATION_MODES: readonly NotificationMode[] = [
  "off",
  "notifications",
  "sound",
  "notifications-and-sound",
];

export function buildNotificationSettingsModel(
  input: NotificationSettingsModelInput,
): NotificationSettingsModel {
  const anchor = searchableSetting("thread-notifications");
  return {
    anchorId: anchor.id,
    title: anchor.title,
    description: input.permissionMessage ?? NOTIFICATION_SETTINGS_DESCRIPTION,
    ariaLabel: "Thread notifications",
    value: input.mode,
    valueLabel: NOTIFICATION_MODE_LABELS[input.mode],
    options: NOTIFICATION_MODES.map((mode) => ({
      value: mode,
      label: NOTIFICATION_MODE_LABELS[mode],
    })),
    disabled: input.requesting,
  };
}

export type NotificationModeChangeInput = {
  readonly value: string | null;
  readonly notificationApiAvailable: boolean;
  readonly isSecureContext: boolean;
};

export type NotificationModeChange =
  | { readonly kind: "ignore" }
  | { readonly kind: "unsupported"; readonly unlockAudio: boolean; readonly message: string }
  | {
      readonly kind: "request-permission";
      readonly unlockAudio: boolean;
      readonly mode: NotificationMode;
    }
  | {
      readonly kind: "apply";
      readonly unlockAudio: boolean;
      readonly patch: { readonly notificationMode: NotificationMode };
    };

function isNotificationMode(value: string | null): value is NotificationMode {
  return (
    value === "off" ||
    value === "notifications" ||
    value === "sound" ||
    value === "notifications-and-sound"
  );
}

export function resolveNotificationModeChange(
  input: NotificationModeChangeInput,
): NotificationModeChange {
  const value = input.value;
  if (!isNotificationMode(value)) return { kind: "ignore" };
  const unlockAudio = hasNotificationSound(value);
  if (!hasDesktopNotifications(value)) {
    return { kind: "apply", unlockAudio, patch: { notificationMode: value } };
  }
  if (!input.notificationApiAvailable || !input.isSecureContext) {
    return {
      kind: "unsupported",
      unlockAudio,
      message:
        "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
    };
  }
  return { kind: "request-permission", unlockAudio, mode: value };
}

export type NotificationPermissionOutcome = "granted" | "denied" | "default" | "error";

export type NotificationPermissionDecision =
  | { readonly kind: "apply"; readonly patch: { readonly notificationMode: NotificationMode } }
  | { readonly kind: "message"; readonly message: string };

export function resolveNotificationPermissionResult(input: {
  readonly mode: NotificationMode;
  readonly outcome: NotificationPermissionOutcome;
}): NotificationPermissionDecision {
  if (input.outcome === "error") {
    return {
      kind: "message",
      message: "Notifications are unavailable in this browser. Sound only is still available.",
    };
  }
  if (input.outcome !== "granted") {
    return {
      kind: "message",
      message:
        "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
    };
  }
  return { kind: "apply", patch: { notificationMode: input.mode } };
}
