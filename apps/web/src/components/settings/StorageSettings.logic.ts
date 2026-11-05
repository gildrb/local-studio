import type {
  EnvironmentId,
  ProjectScopedServerSettingKey,
  ServerSettings,
  StorageCleanupSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import type { ProjectSettingSource } from "@t3tools/shared/projectSettings";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";

import type { ScopedSettingsPatch } from "./scopedSettings";
import type { ResolvedSettingsScope } from "./settingsScope";

export type StorageWorktreeCleanupMode = "inherit" | "off" | "custom";

export type StorageSettingsTargetInput = {
  readonly settings: ServerSettings;
  readonly sources: Readonly<Record<ProjectScopedServerSettingKey, ProjectSettingSource>>;
};

export type StorageSettingsEnvironmentInput = {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: {
        readonly storageCleanup?: boolean | undefined;
        readonly projectWorktreeCleanup?: boolean | undefined;
      };
    };
  } | null;
};

export type StorageSettingsModelInput = {
  readonly scopeKind: ResolvedSettingsScope["kind"];
  readonly settings: ServerSettings;
  readonly target: StorageSettingsTargetInput | null;
  readonly targets: readonly StorageSettingsTargetInput[];
  readonly connectedEnvironments: readonly StorageSettingsEnvironmentInput[];
};

export type StorageSwitchRuleKey = "worktreeOnDelete" | "worktreeOnMerge" | "worktreeUnchanged";

export type StorageRetentionRuleKey =
  | "worktreeAfterDays"
  | "browserArtifactsAfterDays"
  | "logsAfterDays";

export type StorageSwitchRuleRow = {
  readonly control: "switch";
  readonly id: StorageSwitchRuleKey;
  readonly title: string;
  readonly description: string;
  readonly status: string | null;
  readonly serverScoped: boolean;
  readonly ariaLabel: string;
  readonly checked: boolean;
};

export type StorageRetentionRuleRow = {
  readonly control: "retention";
  readonly id: StorageRetentionRuleKey;
  readonly title: string;
  readonly description: string;
  readonly status: string | null;
  readonly serverScoped: boolean;
  readonly retention: StorageRetentionControlModel;
};

export type StorageRuleRow = StorageSwitchRuleRow | StorageRetentionRuleRow;

export type StorageRetentionControlModel = {
  readonly label: string;
  readonly value: number | null;
  readonly enabled: boolean;
  readonly offLabel: string;
  readonly unitLabel: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decrementLabel: string;
  readonly incrementLabel: string;
  readonly inputLabel: string;
};

export type StorageWorktreeModeOption = {
  readonly value: StorageWorktreeCleanupMode;
  readonly label: string;
};

export type StorageWorktreeModeRow = {
  readonly id: "worktreeCleanup";
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly settingKeys: readonly ["worktreeCleanup"];
  readonly mixed: boolean;
  readonly value: StorageWorktreeCleanupMode | null;
  readonly valueLabel: string;
  readonly options: readonly StorageWorktreeModeOption[];
};

export type StorageSettingsSection = {
  readonly id: "storage-worktrees" | "storage-artifacts";
  readonly title: string;
  readonly modeRow: StorageWorktreeModeRow | null;
  readonly rows: readonly StorageRuleRow[];
};

export type StorageSettingsNotice =
  | { readonly target: "all"; readonly message: string }
  | {
      readonly target: "environment";
      readonly eligibleEnvironmentIds: readonly EnvironmentId[];
      readonly message: string;
    };

export type StorageSettingsModel =
  | { readonly kind: "notice"; readonly notice: StorageSettingsNotice }
  | { readonly kind: "settings"; readonly sections: readonly StorageSettingsSection[] };

export type StorageSettingsIntent =
  | { readonly kind: "select-worktree-mode"; readonly mode: StorageWorktreeCleanupMode | null }
  | { readonly kind: "toggle-rule"; readonly key: StorageSwitchRuleKey; readonly checked: boolean }
  | {
      readonly kind: "set-retention";
      readonly key: StorageRetentionRuleKey;
      readonly days: number | null;
    };

export type StorageSettingsActionInput = {
  readonly scopeKind: ResolvedSettingsScope["kind"];
  readonly intent: StorageSettingsIntent;
};

export type StorageSettingsAction =
  | { readonly kind: "none" }
  | { readonly kind: "clear"; readonly keys: readonly ProjectScopedServerSettingKey[] }
  | { readonly kind: "update"; readonly patch: ScopedSettingsPatch };

export type RetentionCommitDecision =
  | { readonly kind: "reset"; readonly draft: number }
  | { readonly kind: "commit"; readonly days: number };

const RETENTION_MIN_DAYS = 1;
const RETENTION_MAX_DAYS = 3650;
const RETENTION_DEFAULT_DAYS = 8;
const MIXED_STATUS = "Mixed across selected machines";

const WORKTREE_MODE_OPTIONS: readonly StorageWorktreeModeOption[] = [
  { value: "inherit", label: "Inherit" },
  { value: "off", label: "Off" },
  { value: "custom", label: "Custom" },
];

const WORKTREE_MODE_DESCRIPTIONS: Readonly<Record<StorageWorktreeCleanupMode, string>> = {
  off: "Keep this project's worktrees until you delete them manually.",
  custom: "Use these rules for this project.",
  inherit: "Use each machine's worktree cleanup settings.",
};

type RuleDefinition =
  | {
      readonly control: "switch";
      readonly id: StorageSwitchRuleKey;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly control: "retention";
      readonly id: StorageRetentionRuleKey;
      readonly title: string;
      readonly description: string;
    };

const WORKTREE_RULES: readonly RuleDefinition[] = [
  {
    control: "switch",
    id: "worktreeOnDelete",
    title: "Delete worktrees with deleted threads",
    description:
      "Remove unused worktrees when active or archived threads are deleted. Worktrees with local changes are kept.",
  },
  {
    control: "retention",
    id: "worktreeAfterDays",
    title: "Delete inactive worktrees",
    description:
      "Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept.",
  },
  {
    control: "switch",
    id: "worktreeOnMerge",
    title: "Delete merged worktrees",
    description:
      "Remove worktrees whose pull request is merged and whose commits are included in the default branch.",
  },
  {
    control: "switch",
    id: "worktreeUnchanged",
    title: "Delete unchanged worktrees",
    description: "Remove worktrees with no commits beyond the default branch.",
  },
];

const ARTIFACT_RULES: readonly RuleDefinition[] = [
  {
    control: "retention",
    id: "browserArtifactsAfterDays",
    title: "Delete old browser artifacts",
    description:
      "Delete saved browser captures after this many days. Older capture links will no longer open.",
  },
  {
    control: "retention",
    id: "logsAfterDays",
    title: "Delete old rotated logs",
    description: "Delete inactive rotated log files after this many days. Current logs are kept.",
  },
];

function effectiveStorageCleanup(settings: ServerSettings): StorageCleanupSettings {
  return { ...settings.storageCleanup, ...resolveWorktreeCleanup(settings, null) };
}

function projectWorktreeMode(entry: StorageSettingsTargetInput | null): StorageWorktreeCleanupMode {
  return entry?.sources.worktreeCleanup === "project"
    ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
    : "inherit";
}

export function buildStorageRetentionControlModel(
  label: string,
  value: number | null,
): StorageRetentionControlModel {
  return {
    label,
    value,
    enabled: value !== null,
    offLabel: "Off",
    unitLabel: "days",
    min: RETENTION_MIN_DAYS,
    max: RETENTION_MAX_DAYS,
    step: 1,
    decrementLabel: `Decrease ${label}`,
    incrementLabel: `Increase ${label}`,
    inputLabel: `${label} in days`,
  };
}

export function resolveRetentionInputSize(draft: number | null, value: number): number {
  return new Intl.NumberFormat().format(draft ?? value).length;
}

export function resolveRetentionCommit(
  next: number | null,
  value: number,
): RetentionCommitDecision {
  if (next === null) return { kind: "reset", draft: value };
  return {
    kind: "commit",
    days: Math.min(RETENTION_MAX_DAYS, Math.max(RETENTION_MIN_DAYS, Math.round(next))),
  };
}

export function resolveRetentionToggle(enabled: boolean): number | null {
  return enabled ? RETENTION_DEFAULT_DAYS : null;
}

function buildRuleRow(
  definition: RuleDefinition,
  settings: StorageCleanupSettings,
  targets: readonly StorageSettingsTargetInput[],
  serverScoped: boolean,
): StorageRuleRow {
  const status = targets.some(
    (target) => effectiveStorageCleanup(target.settings)[definition.id] !== settings[definition.id],
  )
    ? MIXED_STATUS
    : null;
  if (definition.control === "switch") {
    return {
      control: "switch",
      id: definition.id,
      title: definition.title,
      description: definition.description,
      status,
      serverScoped,
      ariaLabel: definition.title,
      checked: settings[definition.id],
    };
  }
  return {
    control: "retention",
    id: definition.id,
    title: definition.title,
    description: definition.description,
    status,
    serverScoped,
    retention: buildStorageRetentionControlModel(definition.title, settings[definition.id]),
  };
}

export function buildStorageSettingsModel(input: StorageSettingsModelInput): StorageSettingsModel {
  const isProjectScope = input.scopeKind === "project" || input.scopeKind === "checkout";
  if (
    isProjectScope &&
    input.connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return {
      kind: "notice",
      notice: {
        target: "all",
        message: "Update the selected machines to configure project worktree cleanup.",
      },
    };
  }
  if (
    input.connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return {
      kind: "notice",
      notice: {
        target: "environment",
        eligibleEnvironmentIds: input.connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId),
        message:
          "Update the selected environments to use storage cleanup, or choose a machine that supports it.",
      },
    };
  }

  const settings = effectiveStorageCleanup(input.settings);
  const mode = projectWorktreeMode(input.target);
  const mixedModes = input.targets.some((entry) => projectWorktreeMode(entry) !== mode);
  const modeRow: StorageWorktreeModeRow | null = isProjectScope
    ? {
        id: "worktreeCleanup",
        title: "Automatic worktree cleanup",
        description: WORKTREE_MODE_DESCRIPTIONS[mode],
        ariaLabel: "Automatic worktree cleanup",
        settingKeys: ["worktreeCleanup"],
        mixed: mixedModes,
        value: mixedModes ? null : mode,
        valueLabel: mixedModes
          ? "Mixed"
          : (WORKTREE_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Custom"),
        options: WORKTREE_MODE_OPTIONS,
      }
    : null;
  const showWorktreeRules = !isProjectScope || (!mixedModes && mode === "custom");
  const sections: StorageSettingsSection[] = [
    {
      id: "storage-worktrees",
      title: "Worktrees",
      modeRow,
      rows: showWorktreeRules
        ? WORKTREE_RULES.map((definition) =>
            buildRuleRow(definition, settings, input.targets, !isProjectScope),
          )
        : [],
    },
  ];
  if (!isProjectScope) {
    sections.push({
      id: "storage-artifacts",
      title: "Artifacts and logs",
      modeRow: null,
      rows: ARTIFACT_RULES.map((definition) =>
        buildRuleRow(definition, settings, input.targets, true),
      ),
    });
  }
  return { kind: "settings", sections };
}

function worktreeRulePatch(
  isProjectScope: boolean,
  patch: Partial<WorktreeCleanupRules>,
): ScopedSettingsPatch {
  return isProjectScope
    ? { worktreeCleanup: { mode: "custom", rules: patch } }
    : { storageCleanup: patch };
}

export function resolveStorageSettingsAction(
  input: StorageSettingsActionInput,
): StorageSettingsAction {
  const isProjectScope = input.scopeKind === "project" || input.scopeKind === "checkout";
  const { intent } = input;
  switch (intent.kind) {
    case "select-worktree-mode":
      if (intent.mode === "inherit") return { kind: "clear", keys: ["worktreeCleanup"] };
      if (intent.mode === "off")
        return { kind: "update", patch: { worktreeCleanup: { mode: "off" } } };
      if (intent.mode === "custom")
        return { kind: "update", patch: { worktreeCleanup: { mode: "custom", rules: {} } } };
      return { kind: "none" };
    case "toggle-rule":
      return {
        kind: "update",
        patch: worktreeRulePatch(isProjectScope, { [intent.key]: intent.checked }),
      };
    case "set-retention":
      if (intent.key === "worktreeAfterDays")
        return {
          kind: "update",
          patch: worktreeRulePatch(isProjectScope, { worktreeAfterDays: intent.days }),
        };
      return { kind: "update", patch: { storageCleanup: { [intent.key]: intent.days } } };
  }
}
