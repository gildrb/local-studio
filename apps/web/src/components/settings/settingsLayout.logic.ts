import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProjectScopedServerSettingKey,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";

import {
  isProjectScopedSettingKey,
  scopedSettingsAreMixed,
  scopedSettingsSource,
  type ScopedSettingSource,
  type ScopedSettingsTarget,
} from "./scopedSettings";
import type { ResolvedSettingsScope } from "./settingsScope";
import {
  resolveSettingInheritanceStatus,
  type SettingInheritanceStatus,
} from "./SettingInheritance.logic";

export const PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE =
  "This setting is saved on a server, and the hosted app is not anchored to one. Change it from the desktop app or from the server's own address.";

export type SettingsRowScopeContextInput = {
  readonly scopeKind: ResolvedSettingsScope["kind"];
  readonly scopeEnvironmentIds: readonly EnvironmentId[];
  readonly targets: readonly Pick<ScopedSettingsTarget, "environmentId" | "settings" | "sources">[];
  readonly connectedEnvironments: readonly {
    readonly environmentId: EnvironmentId;
    readonly serverConfig: { readonly settings: ServerSettings } | null;
  }[];
  readonly environments: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }[];
};

export type SettingsRowScopeInput = {
  readonly serverScoped: boolean;
  readonly settingKeys: readonly (keyof ServerSettings)[];
  readonly mixed: boolean | undefined;
  readonly primarySettingsAvailable: boolean;
  readonly context: SettingsRowScopeContextInput | null;
};

export type SettingsRowReset =
  | { readonly kind: "row-action" }
  | { readonly kind: "none" }
  | { readonly kind: "clear-overrides"; readonly tooltip: string };

export type SettingsRowScopeModel = {
  readonly isProjectScope: boolean;
  readonly scopedKeys: readonly ProjectScopedServerSettingKey[];
  readonly environmentWide: boolean;
  readonly mixed: boolean;
  readonly source: ScopedSettingSource | null;
  readonly unavailable: boolean;
  readonly inertMessage: string | null;
  readonly reset: SettingsRowReset;
  readonly inheritance: SettingInheritanceStatus | null;
};

function isSettingCustomized(
  context: SettingsRowScopeContextInput,
  settingKeys: readonly (keyof ServerSettings)[],
): boolean {
  const environmentSettingsById = new Map(
    context.connectedEnvironments.flatMap((environment) =>
      environment.serverConfig
        ? [[environment.environmentId, environment.serverConfig.settings] as const]
        : [],
    ),
  );
  return settingKeys.some((key) =>
    context.targets.some((candidate) => {
      const environmentSettings = environmentSettingsById.get(candidate.environmentId);
      return (
        environmentSettings !== undefined &&
        !Equal.equals(environmentSettings[key], DEFAULT_SERVER_SETTINGS[key])
      );
    }),
  );
}

export function buildSettingsRowScopeModel(input: SettingsRowScopeInput): SettingsRowScopeModel {
  const { context, serverScoped, settingKeys } = input;
  const isProjectScope =
    context !== null && (context.scopeKind === "project" || context.scopeKind === "checkout");
  const scopedKeys = settingKeys.filter(isProjectScopedSettingKey);
  const environmentWide = isProjectScope && serverScoped && scopedKeys.length === 0;
  const mixed =
    input.mixed ?? (context !== null && scopedSettingsAreMixed(context.targets, settingKeys));
  const source =
    context && isProjectScope ? scopedSettingsSource(context.targets, scopedKeys) : null;
  const unavailable =
    serverScoped &&
    !(context ? context.connectedEnvironments.length > 0 : input.primarySettingsAvailable);
  const inheritedFrom =
    source === "environment" && context?.scopeEnvironmentIds.length === 1
      ? (context.environments.find(
          (environment) => environment.environmentId === context.scopeEnvironmentIds[0],
        )?.label ?? "environment")
      : "environment";
  const inertMessage = unavailable
    ? context
      ? "Reconnect the selected environment to change this setting."
      : PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE
    : environmentWide
      ? "Environment-wide setting. Select an environment to change it."
      : null;
  const reset: SettingsRowReset = unavailable
    ? { kind: "none" }
    : isProjectScope && scopedKeys.length > 0
      ? source === "project" || source === "mixed"
        ? { kind: "clear-overrides", tooltip: "Reset to inherited value" }
        : { kind: "none" }
      : { kind: "row-action" };
  return {
    isProjectScope,
    scopedKeys,
    environmentWide,
    mixed,
    source,
    unavailable,
    inertMessage,
    reset,
    inheritance:
      context && serverScoped && settingKeys.length > 0
        ? resolveSettingInheritanceStatus({
            mixed,
            source,
            scopedKeyCount: scopedKeys.length,
            inheritedFrom,
            customized: isSettingCustomized(context, settingKeys),
          })
        : null,
  };
}

export function resolveSettingsSearchTargetId(hash: string): string | null {
  return hash.replace(/^#/, "") || null;
}
