import { searchableSetting } from "./settingsSearch";

export type LocalEnvironmentSettingModelInput = {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly confirmOpen: boolean;
  readonly isUpdating: boolean;
  readonly error: string | null;
};

export type LocalEnvironmentSettingConfirmButton = {
  readonly label: string;
  readonly variant: "destructive" | "default";
  readonly disabled: boolean;
  readonly busy: boolean;
};

export type LocalEnvironmentSettingDialog = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly error: string | null;
  readonly cancelLabel: string;
  readonly cancelDisabled: boolean;
  readonly confirm: LocalEnvironmentSettingConfirmButton;
};

export type LocalEnvironmentSettingModel = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly switch: {
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly ariaLabel: string;
  };
  readonly dialog: LocalEnvironmentSettingDialog;
};

export function buildLocalEnvironmentSettingModel(
  input: LocalEnvironmentSettingModelInput,
): LocalEnvironmentSettingModel | null {
  if (!input.available) return null;
  const { id, title } = searchableSetting("local-environment");
  return {
    id,
    title,
    description: input.enabled
      ? "Run agents on this computer. Turn off to use T3 Code only with remote environments."
      : "Turned off. Agents only run in remote environments.",
    switch: {
      checked: input.enabled,
      disabled: input.isUpdating,
      ariaLabel: "Local environment",
    },
    dialog: {
      open: input.confirmOpen,
      title: input.enabled ? "Turn off local environment?" : "Turn on local environment?",
      description: input.enabled
        ? "T3 Code will restart without running a server on this computer. Any agents and terminals running here will stop, and other devices will no longer be able to connect to this computer. Your projects, history, and remote environments are unaffected."
        : "T3 Code will restart and start running a server on this computer again.",
      error: input.error ? input.error : null,
      cancelLabel: "Cancel",
      cancelDisabled: input.isUpdating,
      confirm: {
        label: input.isUpdating
          ? "Restarting…"
          : input.enabled
            ? "Restart and turn off"
            : "Restart and turn on",
        variant: input.enabled ? "destructive" : "default",
        disabled: input.isUpdating,
        busy: input.isUpdating,
      },
    },
  };
}

export type LocalEnvironmentSettingIntent =
  | { readonly kind: "toggle" }
  | { readonly kind: "dialog-open-change"; readonly open: boolean }
  | { readonly kind: "confirm" };

export type LocalEnvironmentSettingChange =
  | { readonly kind: "none" }
  | { readonly kind: "set-dialog"; readonly open: boolean; readonly clearError: boolean }
  | { readonly kind: "apply"; readonly enabled: boolean };

export function resolveLocalEnvironmentSettingChange(input: {
  readonly enabled: boolean;
  readonly isUpdating: boolean;
  readonly intent: LocalEnvironmentSettingIntent;
}): LocalEnvironmentSettingChange {
  switch (input.intent.kind) {
    case "toggle":
      return { kind: "set-dialog", open: true, clearError: false };
    case "dialog-open-change":
      if (input.isUpdating) return { kind: "none" };
      return { kind: "set-dialog", open: input.intent.open, clearError: !input.intent.open };
    case "confirm":
      return { kind: "apply", enabled: !input.enabled };
  }
}

export function describeLocalEnvironmentSettingFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Couldn't change this setting.";
}
