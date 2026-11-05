import {
  DEFAULT_SERVER_SETTINGS,
  PROJECT_FILE_BACKED_SETTINGS,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ProjectFileBackedSettingKey,
  type ProjectId,
  resolveEnvironmentMachineKind,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";

import type { EnvironmentPresentation } from "../../state/environments";
import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import {
  isProjectScopedSettingKey,
  type ProjectOverrideEntry,
  type ScopedSettingSource,
  type ScopedSettingsTarget,
} from "./scopedSettings";

export type SettingInheritanceState =
  | "default"
  | "environment"
  | "inherited"
  | "overridden"
  | "mixed";

export type SettingInheritanceLayerKey = "project" | "environment" | "t3.json" | "built-in";

export type SettingInheritanceLayer = {
  readonly key: SettingInheritanceLayerKey;
  readonly label: string;
  readonly value: string;
  readonly effective: boolean;
  readonly set: boolean;
};

export type SettingInheritanceStatusInput = {
  readonly mixed: boolean;
  readonly source: ScopedSettingSource | null;
  readonly scopedKeyCount: number;
  readonly inheritedFrom: string;
  readonly customized: boolean;
};

export type SettingInheritanceStatus = {
  readonly state: SettingInheritanceState;
  readonly summary: string;
};

export type SettingInheritanceEnvironment = Pick<
  EnvironmentPresentation,
  "environmentId" | "serverConfig"
>;

export type SettingInheritanceOverridingProject = ProjectOverrideEntry & {
  readonly label: string;
};

export type SettingInheritanceModelInput = {
  readonly state: SettingInheritanceState;
  readonly summary: string;
  readonly targets: readonly ScopedSettingsTarget[];
  readonly environments: readonly SettingInheritanceEnvironment[];
  readonly keys: readonly (keyof ServerSettings)[];
  readonly overridingProjects: readonly SettingInheritanceOverridingProject[];
  readonly canClearOverrides: boolean;
};

export type SettingInheritanceTone = "muted" | "primary" | "warning";

export type SettingInheritanceOverrideRow = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly label: string;
  readonly value: string | null;
};

export type SettingInheritanceOverrides = {
  readonly heading: string;
  readonly resetLabel: string | null;
  readonly projects: readonly SettingInheritanceOverrideRow[];
};

export type SettingInheritanceChain = {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly title: string;
  readonly machine: EnvironmentMachineKind;
  readonly layers: readonly SettingInheritanceLayer[];
  readonly overrides: SettingInheritanceOverrides | null;
};

export type SettingInheritanceModel = {
  readonly visible: boolean;
  readonly state: SettingInheritanceState;
  readonly tone: SettingInheritanceTone;
  readonly summary: string;
  readonly triggerAriaLabel: string;
  readonly chains: readonly SettingInheritanceChain[];
};

export type SettingInheritanceResetInput = {
  readonly environmentId: EnvironmentId;
  readonly overridingProjects: readonly ProjectOverrideEntry[];
};

export type SettingInheritanceReset =
  | { readonly kind: "clear-project-overrides"; readonly entries: readonly ProjectOverrideEntry[] }
  | { readonly kind: "none" };

const WRITING_STYLE_LABELS: Readonly<Record<string, string>> = {
  repo_conventions: "Repository conventions",
  conventional_commits: "Conventional Commits",
  custom: "Custom instructions",
};

function ownLabel(labels: Readonly<Record<string, string>>, value: string): string | undefined {
  return Object.hasOwn(labels, value) ? labels[value] : undefined;
}

export function formatSettingInheritanceValue(key: keyof ServerSettings, value: unknown): string {
  if (value === null || value === undefined) {
    return key === "pullRequestMergeMethod"
      ? "Last selected"
      : key === "sidebarAutoSettleAfterDays"
        ? "Never"
        : key === "defaultModelSelection"
          ? "Automatic"
          : key === "sourceControlWriterModelSelection"
            ? "Text generation model"
            : key === "defaultThreadEnvMode" || key === "worktreeSubmodules"
              ? "Inherit"
              : "Not set";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    return key === "sidebarAutoSettleAfterDays"
      ? `${value} ${value === 1 ? "day" : "days"}`
      : String(value);
  }
  if (typeof value === "string") {
    if (key === "defaultThreadEnvMode" && (value === "local" || value === "worktree")) {
      return resolveEnvModeLabel(value);
    }
    if (key === "worktreeSubmodules") {
      const label = ownLabel(WORKTREE_SUBMODULES_LABELS, value);
      if (label !== undefined) return label;
    }
    if (key === "pullRequestMergeMethod") {
      const label = ownLabel(PULL_REQUEST_MERGE_METHOD_LABELS, value);
      if (label !== undefined) return label;
    }
    return value === "" ? "Empty" : value;
  }
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    if ("model" in value && typeof value.model === "string") return value.model;
    if ("mode" in value && typeof value.mode === "string") {
      return WRITING_STYLE_LABELS[value.mode] ?? value.mode;
    }
  }
  return "Custom";
}

function isProjectFileBackedSettingKey(
  key: keyof ServerSettings,
): key is ProjectFileBackedSettingKey {
  return Object.hasOwn(PROJECT_FILE_BACKED_SETTINGS, key);
}

export function settingInheritanceLayers(
  target: ScopedSettingsTarget,
  environmentSettings: ServerSettings,
  key: keyof ServerSettings,
): readonly SettingInheritanceLayer[] {
  const environmentValue = environmentSettings[key];
  const source = isProjectScopedSettingKey(key) ? target.sources[key] : "environment";
  const environmentSet = !Equal.equals(environmentValue, DEFAULT_SERVER_SETTINGS[key]);
  const fileBacked = isProjectFileBackedSettingKey(key);
  const layers: SettingInheritanceLayer[] = [];
  if (target.projectId !== null && isProjectScopedSettingKey(key)) {
    layers.push({
      key: "project",
      label: "Project",
      value:
        source === "project"
          ? formatSettingInheritanceValue(key, target.settings[key])
          : "Inherits",
      effective: source === "project",
      set: source === "project",
    });
  }
  layers.push({
    key: "environment",
    label: target.label,
    value: environmentSet ? formatSettingInheritanceValue(key, environmentValue) : "Inherits",
    effective: source === "environment" && environmentSet,
    set: environmentSet,
  });
  if (fileBacked && target.projectId !== null) {
    layers.push({
      key: "t3.json",
      label: "t3.json",
      value:
        source === "t3.json"
          ? formatSettingInheritanceValue(key, target.settings[key])
          : "Inherits",
      effective: source === "t3.json",
      set: source === "t3.json",
    });
  }
  const builtIn = fileBacked
    ? PROJECT_FILE_BACKED_SETTINGS[key].builtIn
    : DEFAULT_SERVER_SETTINGS[key];
  layers.push({
    key: "built-in",
    label: "Default",
    value: formatSettingInheritanceValue(key, builtIn),
    effective: source === "environment" && !environmentSet,
    set: true,
  });
  return layers;
}

export function resolveSettingInheritanceStatus(
  input: SettingInheritanceStatusInput,
): SettingInheritanceStatus {
  return input.mixed
    ? { state: "mixed", summary: "Mixed across selected environments" }
    : input.source === "project"
      ? { state: "overridden", summary: "Overridden for this project" }
      : input.source === "t3.json"
        ? { state: "inherited", summary: "Inherited from the repository's t3.json" }
        : input.source === "environment" && input.scopedKeyCount > 0
          ? { state: "inherited", summary: `Inherited from ${input.inheritedFrom}` }
          : input.customized
            ? { state: "environment", summary: "Set on the environment" }
            : { state: "default", summary: "Built-in default" };
}

function chainOverrides(
  input: SettingInheritanceModelInput,
  key: keyof ServerSettings,
  environmentId: EnvironmentId,
  settings: ServerSettings,
): SettingInheritanceOverrides | null {
  const overriding = input.overridingProjects.filter(
    (project) => project.environmentId === environmentId,
  );
  if (overriding.length === 0) return null;
  const overrides = settings.projectSettingsOverrides;
  return {
    heading: "Overridden by",
    resetLabel: input.canClearOverrides ? `Reset ${overriding.length === 1 ? "it" : "all"}` : null,
    projects: overriding.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.projectId,
      label: project.label,
      value: isProjectScopedSettingKey(key)
        ? formatSettingInheritanceValue(key, overrides[project.projectId]?.[key])
        : null,
    })),
  };
}

export function buildSettingInheritanceModel(
  input: SettingInheritanceModelInput,
): SettingInheritanceModel {
  const key = input.keys[0];
  const count = input.overridingProjects.length;
  const summary =
    count > 0
      ? `${input.summary} · ${count} project ${count === 1 ? "override" : "overrides"}`
      : input.summary;
  const chains: readonly SettingInheritanceChain[] =
    key === undefined
      ? []
      : input.targets.flatMap((target) => {
          const serverConfig = input.environments.find(
            (candidate) => candidate.environmentId === target.environmentId,
          )?.serverConfig;
          if (!serverConfig) return [];
          return [
            {
              id: `${target.environmentId}:${target.projectId ?? ""}`,
              environmentId: target.environmentId,
              projectId: target.projectId,
              title: target.label,
              machine: resolveEnvironmentMachineKind(serverConfig),
              layers: settingInheritanceLayers(target, serverConfig.settings, key).map((layer) => ({
                ...layer,
                label: layer.key === "environment" ? "Environment" : layer.label,
              })),
              overrides: chainOverrides(input, key, target.environmentId, serverConfig.settings),
            },
          ];
        });
  return {
    visible: key !== undefined && input.targets.length > 0,
    state: input.state,
    tone: input.state === "overridden" ? "primary" : input.state === "mixed" ? "warning" : "muted",
    summary,
    triggerAriaLabel: `${summary}. Show where this value comes from`,
    chains,
  };
}

export function resolveSettingInheritanceReset(
  input: SettingInheritanceResetInput,
): SettingInheritanceReset {
  const entries = input.overridingProjects
    .filter((project) => project.environmentId === input.environmentId)
    .map((project) => ({ environmentId: project.environmentId, projectId: project.projectId }));
  return entries.length === 0 ? { kind: "none" } : { kind: "clear-project-overrides", entries };
}
