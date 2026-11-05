import {
  ENVIRONMENT_MACHINE_KINDS,
  isEnvironmentMachineKind,
  resolveEnvironmentMachineKind,
  type AuthSessionState,
  type EnvironmentMachineKind,
  type ServerConfig,
} from "@t3tools/contracts";

import {
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
  type ProviderOperateAccess,
} from "./ProviderSettingsPanel.logic";

export const ENVIRONMENT_MACHINE_KIND_LABELS: Record<EnvironmentMachineKind, string> = {
  server: "Server",
  cloud: "Cloud VM",
  linux: "Linux/WSL",
  desktop: "Desktop",
  laptop: "Laptop",
  "mac-mini": "Mini PC",
  "mac-studio": "Workstation",
};

export function resolveEnvironmentIconPickerLock(input: {
  readonly serverConfig: ServerConfig | null;
  readonly operateAccess: ProviderOperateAccess;
}): string | null {
  if (input.serverConfig === null) {
    return "Connect to this environment to change its icon.";
  }
  if (input.serverConfig.environment.capabilities.environmentIcon !== true) {
    return "This environment's server is too old to keep an icon. Update it to choose one.";
  }
  if (input.operateAccess === "denied") {
    return "Your session on this environment cannot change its settings.";
  }
  return null;
}

export type EnvironmentSessionAccessInput = {
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
};

export type EnvironmentOperateAccessInput = {
  readonly isPrimary: boolean;
  readonly isElectron: boolean;
  readonly primarySession: EnvironmentSessionAccessInput;
  readonly remoteSession: EnvironmentSessionAccessInput;
};

export function resolveEnvironmentOperateAccess(
  input: EnvironmentOperateAccessInput,
): ProviderOperateAccess {
  if (input.isPrimary) {
    return input.isElectron
      ? "granted"
      : resolvePrimaryOperateAccess({
          isPrimary: true,
          hasDesktopBridge: false,
          ...input.primarySession,
        });
  }
  return resolveRemoteOperateAccess(input.remoteSession);
}

export type EnvironmentIconOption = {
  readonly value: EnvironmentMachineKind;
  readonly label: string;
  readonly icon: EnvironmentMachineKind;
  readonly badge: string | null;
  readonly disabled: boolean;
};

export type EnvironmentIconMenuModelInput = {
  readonly serverConfig: ServerConfig | null;
  readonly operateAccess: ProviderOperateAccess;
};

export type EnvironmentIconMenuModel = {
  readonly label: string;
  readonly icon: EnvironmentMachineKind;
  readonly value: EnvironmentMachineKind;
  readonly detected: EnvironmentMachineKind;
  readonly lock: string | null;
  readonly options: ReadonlyArray<EnvironmentIconOption>;
};

export function buildEnvironmentIconMenuModel(
  input: EnvironmentIconMenuModelInput,
): EnvironmentIconMenuModel {
  const lock = resolveEnvironmentIconPickerLock(input);
  const detected = input.serverConfig?.environment.platform.machine ?? "server";
  const resolved = resolveEnvironmentMachineKind(input.serverConfig);
  const detectedBadge = input.serverConfig?.environment.platform.machine ? "detected" : "default";
  return {
    label: "Icon",
    icon: resolved,
    value: resolved,
    detected,
    lock,
    options: ENVIRONMENT_MACHINE_KINDS.map((kind) => ({
      value: kind,
      label: ENVIRONMENT_MACHINE_KIND_LABELS[kind],
      icon: kind,
      badge: kind === detected ? detectedBadge : null,
      disabled: lock !== null,
    })),
  };
}

export type EnvironmentIconSelection =
  | { readonly kind: "none" }
  | {
      readonly kind: "update";
      readonly patch: { readonly environmentIcon: EnvironmentMachineKind | null };
    };

export function resolveEnvironmentIconSelection(input: {
  readonly lock: string | null;
  readonly detected: EnvironmentMachineKind;
  readonly next: unknown;
}): EnvironmentIconSelection {
  if (input.lock !== null || !isEnvironmentMachineKind(input.next)) return { kind: "none" };
  return {
    kind: "update",
    patch: { environmentIcon: input.next === input.detected ? null : input.next },
  };
}
