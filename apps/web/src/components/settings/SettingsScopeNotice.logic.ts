import type { EnvironmentId } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { EnvironmentPresentation } from "../../state/environments";
import type { SettingsScopeNoticeTarget } from "./SettingsRouteLayout.logic";
import type { SettingsScopeSearch } from "./settingsScope";

export type SettingsScopeNoticeChoice = {
  readonly id: string;
  readonly label: string;
  readonly search: SettingsScopeSearch;
};

export type SettingsScopeNoticeModel = {
  readonly message: string;
  readonly role: "status";
  readonly choices: readonly SettingsScopeNoticeChoice[];
};

export type SettingsScopeNoticeEnvironment = Pick<
  EnvironmentPresentation,
  "environmentId" | "label" | "displayUrl"
>;

export type SettingsScopeNoticeModelInput = {
  readonly message: string;
  readonly target: SettingsScopeNoticeTarget;
  readonly eligibleEnvironmentIds: readonly EnvironmentId[] | null;
  readonly search: SettingsScopeSearch;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly environments: readonly SettingsScopeNoticeEnvironment[];
};

export type SettingsScopeNoticeSelectionInput = {
  readonly search: SettingsScopeSearch;
  readonly targetId: string | null;
  readonly pathname: string;
};

export type SettingsScopeNoticeSelection =
  | {
      readonly kind: "navigate";
      readonly to: string;
      readonly search: SettingsScopeSearch;
      readonly hash: string;
    }
  | { readonly kind: "select-scope"; readonly search: SettingsScopeSearch };

function noticeChoices(input: SettingsScopeNoticeModelInput): readonly {
  readonly label: string;
  readonly search: SettingsScopeSearch;
}[] {
  const { target, search, groups, environments, eligibleEnvironmentIds } = input;
  if (target === "checkout") {
    return groups
      .filter((group) => !search.project || group.projectKey === search.project)
      .flatMap((group) =>
        group.memberProjects.map((member) => ({
          label: `${group.displayName} · ${member.environmentLabel ?? "Environment"} · ${member.workspaceRoot}`,
          search: {
            project: group.projectKey,
            machine: member.environmentId,
            checkout: member.physicalProjectKey,
          },
        })),
      );
  }
  if (target === "project") {
    return groups.map((group) => ({
      label: group.displayName,
      search: { project: group.projectKey },
    }));
  }
  if (target === "environment") {
    return environments
      .filter(
        (entry) =>
          eligibleEnvironmentIds === null || eligibleEnvironmentIds.includes(entry.environmentId),
      )
      .map((entry) => ({
        label: environments.some(
          (other) => other.environmentId !== entry.environmentId && other.label === entry.label,
        )
          ? `${entry.label} · ${entry.displayUrl || entry.environmentId}`
          : entry.label,
        search: { machine: entry.environmentId },
      }));
  }
  return [{ label: "Open all environments", search: {} }];
}

export function buildSettingsScopeNoticeModel(
  input: SettingsScopeNoticeModelInput,
): SettingsScopeNoticeModel {
  return {
    message: input.message,
    role: "status",
    choices: noticeChoices(input).map((choice) => ({
      id: JSON.stringify(choice.search),
      label: choice.label,
      search: choice.search,
    })),
  };
}

export function resolveSettingsScopeNoticeSelection(
  input: SettingsScopeNoticeSelectionInput,
): SettingsScopeNoticeSelection {
  return input.targetId
    ? { kind: "navigate", to: input.pathname, search: input.search, hash: input.targetId }
    : { kind: "select-scope", search: input.search };
}
