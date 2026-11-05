import type { EnvironmentId, T3ProjectFile } from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  resolveScopedSettingsTargets,
  selectScopedSettingsEnvironments,
  type ScopedSettingsEnvironment,
  type ScopedSettingsEnvironmentSelection,
  type ScopedSettingsTarget,
} from "./scopedSettings";
import {
  resolveSettingsScope,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "./settingsScope";
import { selectSingleEnvironmentScope } from "./settingsScopeAxis";

export type SettingsScopeSearchInput = {
  readonly rawSearch: SettingsScopeSearch;
  readonly singleEnvironment: boolean;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly environments: readonly ScopedSettingsEnvironment[];
  readonly primaryEnvironmentId: EnvironmentId | null;
};

export type SettingsScopeSelectionInput<T extends ScopedSettingsEnvironment> = {
  readonly scope: ResolvedSettingsScope;
  readonly environments: readonly T[];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly projectFiles: ReadonlyMap<string, T3ProjectFile | null>;
};

export type SettingsScopeSelection<T extends ScopedSettingsEnvironment> =
  ScopedSettingsEnvironmentSelection<T> & {
    readonly targets: readonly ScopedSettingsTarget[];
    readonly target: ScopedSettingsTarget | null;
  };

export type SettingsScopeProjectFileData = {
  readonly contents: string;
  readonly truncated: boolean;
};

export function resolveSettingsScopeSearch(input: SettingsScopeSearchInput): SettingsScopeSearch {
  if (!input.singleEnvironment) return input.rawSearch;
  return selectSingleEnvironmentScope(
    input.rawSearch,
    resolveSettingsScope(input.rawSearch, input.groups, input.environments),
    input.environments,
    input.primaryEnvironmentId,
  );
}

export function settingsScopeProjectFile(
  data: SettingsScopeProjectFileData | null,
): T3ProjectFile | null {
  return data === null || data.truncated ? null : parseT3ProjectFile(data.contents);
}

export function resolveSettingsScopeSelection<T extends ScopedSettingsEnvironment>(
  input: SettingsScopeSelectionInput<T>,
): SettingsScopeSelection<T> {
  const selected = selectScopedSettingsEnvironments(
    input.scope,
    input.environments,
    input.primaryEnvironmentId,
  );
  const targets = resolveScopedSettingsTargets(
    input.scope,
    selected.connectedEnvironments,
    input.projectFiles,
  );
  const target =
    targets.find((candidate) => candidate.environmentId === selected.environment?.environmentId) ??
    targets[0] ??
    null;
  return { ...selected, targets, target };
}
