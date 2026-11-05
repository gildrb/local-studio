import { EnvironmentId } from "@t3tools/contracts";

import type { ProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import type { ResolvedSettingsScope, SettingsScopeSearch } from "./settingsScope";

export type SettingsProjectGroupsInput = {
  readonly projects: ReadonlyArray<Project>;
  readonly settings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
};

export type ProjectsSettingsModelInput = {
  readonly search: SettingsScopeSearch;
  readonly scope: ResolvedSettingsScope;
};

export type ProjectsSettingsModel =
  | {
      readonly kind: "project";
      readonly projectKey: string;
      readonly environmentId: EnvironmentId | null;
      readonly checkoutKey: string | null;
    }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "choose-project"; readonly target: "project"; readonly message: string };

export function buildSettingsProjectGroups(
  input: SettingsProjectGroupsInput,
): SidebarProjectSnapshot[] {
  const labels = new Map(input.environments.map((entry) => [entry.environmentId, entry.label]));
  return buildSidebarProjectSnapshots({
    projects: input.projects,
    settings: input.settings,
    primaryEnvironmentId: input.primaryEnvironmentId,
    resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function buildProjectsSettingsModel(
  input: ProjectsSettingsModelInput,
): ProjectsSettingsModel {
  const { search, scope } = input;
  const projectScope =
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    (scope.kind === "unavailable" &&
      (scope.reason === "project-missing" || scope.reason === "checkout-missing"));
  if (search.project && projectScope) {
    return {
      kind: "project",
      projectKey: search.project,
      environmentId: search.machine ? EnvironmentId.make(search.machine) : null,
      checkoutKey: search.checkout ?? null,
    };
  }
  if (scope.kind === "unavailable") return { kind: "unavailable", message: scope.message };
  return {
    kind: "choose-project",
    target: "project",
    message: "Choose a project to manage its name, icon, checkouts and actions.",
  };
}
