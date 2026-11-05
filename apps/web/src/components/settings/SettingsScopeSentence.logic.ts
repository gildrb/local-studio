import { resolveEnvironmentMachineKind, type EnvironmentMachineKind } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { EnvironmentPresentation } from "../../state/environments";
import { resolveSettingsScope, type SettingsScopeSearch } from "./settingsScope";
import {
  ALL_ENVIRONMENTS_VALUE,
  ALL_PROJECTS_VALUE,
  environmentAxisValue,
  projectAxisValue,
  selectEnvironmentAxis,
  selectProjectAxis,
  settingsScopeEnvironmentLabel,
} from "./settingsScopeAxis";

export const SETTINGS_DEVICE_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/settings/appearance",
  "/settings/snap-shot",
  "/settings/connections",
]);

export type SettingsScopeAxis = "environment" | "project";

export type SettingsScopeIcon =
  | { readonly kind: "layers" }
  | { readonly kind: "environment-machine"; readonly machine: EnvironmentMachineKind }
  | { readonly kind: "project-favicon"; readonly projectKey: string };

export type SettingsScopeMenuOption = {
  readonly value: string;
  readonly label: string;
  readonly icon: SettingsScopeIcon | null;
  readonly badge: string | null;
  readonly separatorAfter: boolean;
};

export type SettingsScopeMenuModel = {
  readonly axis: SettingsScopeAxis;
  readonly ariaLabel: string;
  readonly label: string;
  readonly icon: SettingsScopeIcon | null;
  readonly value: string;
  readonly options: readonly SettingsScopeMenuOption[];
};

export type SettingsScopeSentenceModel = {
  readonly visible: boolean;
  readonly lead: string;
  readonly connective: "on" | "across";
  readonly project: SettingsScopeMenuModel;
  readonly environment: SettingsScopeMenuModel;
};

export type SettingsScopeSentenceEnvironment = Pick<
  EnvironmentPresentation,
  "environmentId" | "label" | "displayUrl" | "serverConfig"
> & {
  readonly connection: Pick<EnvironmentPresentation["connection"], "phase">;
};

export type SettingsScopeSentenceModelInput = {
  readonly pathname: string;
  readonly search: SettingsScopeSearch;
  readonly singleEnvironment: boolean;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly environments: readonly SettingsScopeSentenceEnvironment[];
};

export type SettingsScopeChangeIntent = {
  readonly axis: SettingsScopeAxis;
  readonly search: SettingsScopeSearch;
  readonly value: unknown;
};

export type SettingsScopeChange =
  | { readonly kind: "select"; readonly search: SettingsScopeSearch }
  | { readonly kind: "ignore" };

function buildProjectScopeMenu(
  search: SettingsScopeSearch,
  groups: readonly SidebarProjectSnapshot[],
): SettingsScopeMenuModel {
  const selected = groups.find((group) => group.projectKey === search.project);
  const label = selected?.displayName ?? (search.project ? "Unavailable project" : "All projects");
  return {
    axis: "project",
    ariaLabel: `Project scope: ${label}`,
    label,
    icon: selected ? { kind: "project-favicon", projectKey: selected.projectKey } : null,
    value: projectAxisValue(search),
    options: [
      {
        value: ALL_PROJECTS_VALUE,
        label: "All projects",
        icon: null,
        badge: null,
        separatorAfter: true,
      },
      ...groups.map((group) => ({
        value: group.projectKey,
        label: group.displayName,
        icon: { kind: "project-favicon" as const, projectKey: group.projectKey },
        badge: null,
        separatorAfter: false,
      })),
    ],
  };
}

function buildEnvironmentScopeMenu(input: SettingsScopeSentenceModelInput): SettingsScopeMenuModel {
  const { search, groups, environments, singleEnvironment } = input;
  const resolved = resolveSettingsScope(search, groups, environments);
  const value = environmentAxisValue(
    search,
    resolved.kind === "checkout" ? resolved.environmentId : null,
  );
  const selected = environments.find((environment) => environment.environmentId === value);
  const label = selected
    ? settingsScopeEnvironmentLabel(selected, environments)
    : value !== ALL_ENVIRONMENTS_VALUE
      ? "Unavailable environment"
      : singleEnvironment
        ? "No environments"
        : "All environments";
  const allOption: readonly SettingsScopeMenuOption[] = singleEnvironment
    ? []
    : [
        {
          value: ALL_ENVIRONMENTS_VALUE,
          label: "All environments",
          icon: { kind: "layers" },
          badge: null,
          separatorAfter: true,
        },
      ];
  return {
    axis: "environment",
    ariaLabel: `Environment scope: ${label}`,
    label,
    icon: selected
      ? {
          kind: "environment-machine",
          machine: resolveEnvironmentMachineKind(selected.serverConfig),
        }
      : null,
    value,
    options: [
      ...allOption,
      ...environments.map((environment) => ({
        value: environment.environmentId,
        label: settingsScopeEnvironmentLabel(environment, environments),
        icon: {
          kind: "environment-machine" as const,
          machine: resolveEnvironmentMachineKind(environment.serverConfig),
        },
        badge: environment.connection.phase === "connected" ? null : "Offline",
        separatorAfter: false,
      })),
    ],
  };
}

export function buildSettingsScopeSentenceModel(
  input: SettingsScopeSentenceModelInput,
): SettingsScopeSentenceModel {
  const resolved = resolveSettingsScope(input.search, input.groups, input.environments);
  return {
    visible: !SETTINGS_DEVICE_ONLY_PATHS.has(input.pathname),
    lead: "Applying settings for",
    connective: input.search.machine || resolved.kind === "checkout" ? "on" : "across",
    project: buildProjectScopeMenu(input.search, input.groups),
    environment: buildEnvironmentScopeMenu(input),
  };
}

export function resolveSettingsScopeChange(intent: SettingsScopeChangeIntent): SettingsScopeChange {
  if (typeof intent.value !== "string") return { kind: "ignore" };
  return {
    kind: "select",
    search:
      intent.axis === "environment"
        ? selectEnvironmentAxis(intent.search, intent.value)
        : selectProjectAxis(intent.search, intent.value),
  };
}
