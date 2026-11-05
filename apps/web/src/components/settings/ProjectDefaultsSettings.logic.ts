import {
  DEFAULT_SERVER_SETTINGS,
  RuntimeMode,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerConfig,
  type ServerProvider,
  type ServerSettings,
  type UnifiedSettings,
  type WorktreeSubmodules,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Schema from "effect/Schema";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import type { ModelEsque } from "../chat/modelDisplayName";
import { runtimeModeLabels } from "../chat/runtimeModeLabels";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import {
  scopedSettingsAreMixed,
  scopedSettingsSource,
  type ScopedSettingsPatch,
  type ScopedSettingsTarget,
} from "./scopedSettings";
import type { ResolvedSettingsScope } from "./settingsScope";
import { searchableSetting } from "./settingsSearch";

/** `project` is the Projects page shortcut: the new-thread defaults people change most. */
export type ProjectSettingsCategory = "general" | "integrations" | "source-control" | "project";

export type ProjectDefaultsRowKey =
  | "model"
  | "permissions"
  | "workspace"
  | "submodules"
  | "auto-pull"
  | "merge-method"
  | "browser-access";

export type ProjectDefaultsSelectRowKey =
  | "permissions"
  | "workspace"
  | "submodules"
  | "merge-method";

export type ProjectDefaultsSwitchRowKey = "auto-pull" | "browser-access";

export type ProjectDefaultsResetAction = {
  readonly label: string;
  readonly tooltip: string | null;
};

export type ProjectDefaultsOption<Value extends string = string> = {
  readonly value: Value;
  readonly label: string;
  readonly description: string | null;
  readonly icon: string | null;
};

type ProjectDefaultsRowBase = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly settingKeys: readonly (keyof ServerSettings)[];
  readonly mixed: boolean;
  readonly reset: ProjectDefaultsResetAction | null;
};

export type ProjectDefaultsModelRow = ProjectDefaultsRowBase & {
  readonly kind: "model";
  readonly key: "model";
  readonly status: string | null;
  readonly available: boolean;
  readonly selection: ModelSelection | null;
  readonly triggerLabel: string | null;
  readonly showTraits: boolean;
  readonly emptyLabel: string;
};

export type ProjectDefaultsSelectRow<
  Key extends ProjectDefaultsSelectRowKey = ProjectDefaultsSelectRowKey,
  Value extends string = string,
> = ProjectDefaultsRowBase & {
  readonly kind: "select";
  readonly key: Key;
  readonly ariaLabel: string;
  readonly value: Value | null;
  readonly valueLabel: string;
  readonly fallbackLabel: string;
  readonly triggerIcon: string | null;
  readonly options: readonly ProjectDefaultsOption<Value>[];
};

export type ProjectDefaultsPermissionsRow = ProjectDefaultsSelectRow<"permissions", RuntimeMode>;

export type ProjectDefaultsSwitchRow = ProjectDefaultsRowBase & {
  readonly kind: "switch";
  readonly key: ProjectDefaultsSwitchRowKey;
  readonly ariaLabel: string;
  readonly checked: boolean;
};

export type ProjectDefaultsRow =
  | ProjectDefaultsModelRow
  | ProjectDefaultsPermissionsRow
  | ProjectDefaultsSelectRow<Exclude<ProjectDefaultsSelectRowKey, "permissions">>
  | ProjectDefaultsSwitchRow;

export type ProjectDefaultsModelPickerState = {
  readonly selection: ModelSelection | null;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptions: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly activeEntry: ProviderInstanceEntry | null;
};

export type ProjectDefaultsModelPickerInput = {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
};

export type ProjectDefaultsModelTarget = {
  readonly label: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: ServerSettings;
};

export type ProjectDefaultsEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: Pick<ServerConfig, "providers"> | null;
};

export type ProjectDefaultsModelInput = {
  readonly category: ProjectSettingsCategory;
  readonly scopeKind: ResolvedSettingsScope["kind"];
  readonly connectedEnvironmentCount: number;
  readonly settings: UnifiedSettings;
  readonly targetSettings: ServerSettings | null;
  readonly targets: ReadonlyArray<Pick<ScopedSettingsTarget, "settings" | "sources">>;
  readonly modelPicker: Pick<ProjectDefaultsModelPickerState, "selection" | "activeEntry">;
};

export type ProjectDefaultsModel = {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly rows: readonly ProjectDefaultsRow[];
};

export type ProjectDefaultsIntent =
  | { readonly kind: "reset"; readonly key: ProjectDefaultsRowKey }
  | { readonly kind: "select"; readonly key: ProjectDefaultsSelectRowKey; readonly value: unknown }
  | {
      readonly kind: "toggle";
      readonly key: ProjectDefaultsSwitchRowKey;
      readonly checked: boolean;
    }
  | { readonly kind: "model"; readonly selection: ModelSelection | null };

export type ProjectDefaultsChangeContext = {
  readonly settings: UnifiedSettings;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelTargets: ReadonlyArray<ProjectDefaultsModelTarget>;
};

export type ProjectDefaultsChange =
  | { readonly kind: "none" }
  | { readonly kind: "patch"; readonly patch: ScopedSettingsPatch }
  | {
      readonly kind: "rejected";
      readonly toast: {
        readonly type: "error";
        readonly title: string;
        readonly description: string;
      };
    };

const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;
function isWorktreeSubmodules(value: unknown): value is WorktreeSubmodules {
  return WORKTREE_SUBMODULES_OPTIONS.some((option) => option === value);
}
const isRuntimeMode = Schema.is(RuntimeMode);

const RUNTIME_MODE_ICONS: Record<RuntimeMode, string> = {
  "approval-required": "lock",
  "auto-accept-edits": "pen-line",
  auto: "sparkles",
  "full-access": "lock-open",
};

function option(value: string, label: string): ProjectDefaultsOption {
  return { value, label, description: null, icon: null };
}

function optionLabel(
  options: readonly ProjectDefaultsOption[],
  value: unknown,
  fallbackLabel: string,
): string {
  return options.find((candidate) => candidate.value === value)?.label ?? fallbackLabel;
}

function selectRow<Key extends ProjectDefaultsSelectRowKey, Value extends string>(
  row: Omit<ProjectDefaultsSelectRow<Key, Value>, "kind" | "valueLabel">,
): ProjectDefaultsSelectRow<Key, Value> {
  return {
    ...row,
    kind: "select",
    valueLabel: optionLabel(row.options, row.value, row.fallbackLabel),
  };
}

export function resolveProjectDefaultsSelectLabel(
  row: Pick<ProjectDefaultsSelectRow, "options" | "fallbackLabel">,
  value: unknown,
): string {
  return optionLabel(row.options, value, row.fallbackLabel);
}

export function resolveProjectDefaultsModelPicker(
  input: ProjectDefaultsModelPickerInput,
): ProjectDefaultsModelPickerState {
  const selection = resolveDefaultProviderModelSelection(
    input.providers,
    input.settings.defaultModelSelection,
  );
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(input.providers), input.settings),
  );
  return {
    selection,
    entries,
    modelOptions: getCustomModelOptionsByInstance(
      input.settings,
      input.providers,
      selection?.instanceId,
      selection?.model,
    ),
    activeEntry: entries.find((entry) => entry.instanceId === selection?.instanceId) ?? null,
  };
}

export function resolveProjectDefaultsModelTargets(input: {
  readonly targets: ReadonlyArray<Pick<ScopedSettingsTarget, "environmentId" | "settings">>;
  readonly environments: ReadonlyArray<ProjectDefaultsEnvironment>;
}): readonly ProjectDefaultsModelTarget[] {
  return input.targets.flatMap((candidate) => {
    const environment = input.environments.find(
      (entry) => entry.environmentId === candidate.environmentId,
    );
    const config = environment?.serverConfig;
    if (!environment || !config) return [];
    return [
      { label: environment.label, providers: config.providers, settings: candidate.settings },
    ];
  });
}

export function resolveDefaultModelDisabledReason(
  context: ProjectDefaultsChangeContext,
  instanceId: ProviderInstanceId,
  model: string,
): string | null {
  const sourceEntry = context.entries.find((entry) => entry.instanceId === instanceId);
  for (const target of context.modelTargets) {
    const entry = applyProviderInstanceSettings(
      deriveProviderInstanceEntries(target.providers),
      target.settings,
    ).find((candidate) => candidate.instanceId === instanceId);
    const options = getCustomModelOptionsByInstance(
      { ...context.settings, ...target.settings },
      target.providers,
    ).get(instanceId);
    if (
      !entry?.enabled ||
      !entry.isAvailable ||
      entry.driverKind !== sourceEntry?.driverKind ||
      !options?.some((candidate) => candidate.slug === model && !candidate.isUnavailable)
    ) {
      return `This model is unavailable on ${target.label}. Select that environment to choose its model separately.`;
    }
  }
  return null;
}

function buildRows(
  input: ProjectDefaultsModelInput,
): Record<ProjectDefaultsRowKey, ProjectDefaultsRow> {
  const { settings, targets } = input;
  const isProjectScope = input.scopeKind === "project" || input.scopeKind === "checkout";
  const unavailable = input.connectedEnvironmentCount === 0;
  const effective = input.targetSettings
    ? resolveProjectSettings(input.targetSettings, null, null, null).settings
    : null;
  const mixedModel = scopedSettingsAreMixed(targets, ["defaultModelSelection"]);
  const mixedPermissions = scopedSettingsAreMixed(targets, ["defaultRuntimeMode"]);
  const mixedWorkspace = scopedSettingsAreMixed(targets, ["defaultThreadEnvMode"]);
  const mixedSubmodules = scopedSettingsAreMixed(targets, ["worktreeSubmodules"]);
  const mixedBrowser = scopedSettingsAreMixed(targets, ["enableAgentBrowserAccess"]);
  const mixedAutoPull = scopedSettingsAreMixed(targets, ["defaultAutoPull"]);
  const mixedMergeMethod = scopedSettingsAreMixed(targets, ["pullRequestMergeMethod"]);
  const modelSource = scopedSettingsSource(targets, ["defaultModelSelection"]);
  const unavailableOrMixed = unavailable ? "Unavailable" : "Mixed";
  const permissions = searchableSetting("default-permissions");
  const submodules = searchableSetting("worktree-submodules");
  const mergeMethod = searchableSetting("pull-request-merge-method");

  return {
    model: {
      kind: "model",
      key: "model",
      id: "default-model",
      title: "Model",
      description: isProjectScope
        ? "Model for new threads in this project."
        : "Default model for new threads. Projects can override it.",
      settingKeys: ["defaultModelSelection"],
      mixed: mixedModel,
      status:
        unavailable || mixedModel || modelSource === "project"
          ? null
          : settings.defaultModelSelection === null
            ? "Automatic"
            : null,
      reset:
        settings.defaultModelSelection !== null ? { label: "default model", tooltip: null } : null,
      available: input.modelPicker.selection !== null && input.modelPicker.activeEntry !== null,
      selection: input.modelPicker.selection,
      triggerLabel: mixedModel ? "Mixed" : null,
      showTraits: !mixedModel,
      emptyLabel: "No providers available",
    },
    workspace: selectRow({
      key: "workspace",
      id: searchableSetting("new-threads").id,
      title: "Workspace",
      description: isProjectScope
        ? "Where new threads in this project start."
        : "Where new threads start. Projects and their t3.json can override it.",
      settingKeys: ["defaultThreadEnvMode"],
      mixed: mixedWorkspace,
      reset:
        !isProjectScope && settings.defaultThreadEnvMode !== null
          ? { label: "default workspace", tooltip: null }
          : null,
      ariaLabel: "Default workspace",
      value: mixedWorkspace ? null : (effective?.defaultThreadEnvMode ?? null),
      fallbackLabel: unavailableOrMixed,
      triggerIcon: null,
      options: [
        option("local", resolveEnvModeLabel("local")),
        option("worktree", resolveEnvModeLabel("worktree")),
      ],
    }),
    permissions: selectRow({
      key: "permissions",
      id: permissions.id,
      title: permissions.title,
      description: isProjectScope
        ? "Permissions for new threads in this project."
        : "Default permissions for new threads. Projects can override them.",
      settingKeys: ["defaultRuntimeMode"],
      mixed: mixedPermissions,
      reset:
        settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode
          ? { label: "default permissions", tooltip: null }
          : null,
      ariaLabel: "Default permissions",
      value: mixedPermissions ? null : settings.defaultRuntimeMode,
      fallbackLabel: "Mixed",
      triggerIcon: mixedPermissions ? null : RUNTIME_MODE_ICONS[settings.defaultRuntimeMode],
      options: RuntimeMode.literals.map((mode) => ({
        value: mode,
        label: runtimeModeLabels[mode].label,
        description: runtimeModeLabels[mode].description,
        icon: RUNTIME_MODE_ICONS[mode],
      })),
    }),
    submodules: selectRow({
      key: "submodules",
      id: submodules.id,
      title: submodules.title,
      description: isProjectScope
        ? "How new worktrees in this project populate git submodules."
        : "How new worktrees populate git submodules. Projects and their t3.json can override it.",
      settingKeys: ["worktreeSubmodules"],
      mixed: mixedSubmodules,
      reset:
        !isProjectScope && settings.worktreeSubmodules !== null
          ? { label: "worktree submodules", tooltip: null }
          : null,
      ariaLabel: "Worktree submodules",
      value: mixedSubmodules ? null : (effective?.worktreeSubmodules ?? null),
      fallbackLabel: unavailableOrMixed,
      triggerIcon: null,
      options: WORKTREE_SUBMODULES_OPTIONS.map((value) =>
        option(value, WORKTREE_SUBMODULES_LABELS[value]),
      ),
    }),
    "auto-pull": {
      kind: "switch",
      key: "auto-pull",
      id: "automatic-pull",
      title: "Automatically pull",
      description: isProjectScope
        ? "Keeps this project's default branch current when the checkout has no local changes or commits."
        : "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it.",
      settingKeys: ["defaultAutoPull"],
      mixed: mixedAutoPull,
      reset: settings.defaultAutoPull
        ? { label: "default automatic pull", tooltip: "Reset automatic pull to off" }
        : null,
      ariaLabel: "Default automatic pull",
      checked: mixedAutoPull ? false : settings.defaultAutoPull,
    },
    "merge-method": selectRow({
      key: "merge-method",
      id: mergeMethod.id,
      title: mergeMethod.title,
      description: isProjectScope
        ? "Pull requests in this project start with this method."
        : "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device.",
      settingKeys: ["pullRequestMergeMethod"],
      mixed: mixedMergeMethod,
      reset:
        settings.pullRequestMergeMethod !== null
          ? { label: "default merge method", tooltip: "Reset to last selected" }
          : null,
      ariaLabel: "Default pull request merge method",
      value: mixedMergeMethod ? null : (settings.pullRequestMergeMethod ?? "last"),
      fallbackLabel: "Mixed",
      triggerIcon: null,
      options: [
        option("last", "Last selected"),
        option("merge", PULL_REQUEST_MERGE_METHOD_LABELS.merge),
        option("squash", PULL_REQUEST_MERGE_METHOD_LABELS.squash),
        option("rebase", PULL_REQUEST_MERGE_METHOD_LABELS.rebase),
      ],
    }),
    "browser-access": {
      kind: "switch",
      key: "browser-access",
      id: searchableSetting("agent-browser-access").id,
      title: "Agent browser access",
      description: isProjectScope
        ? "Allow agents in this project to use the shared browser. Applies when the agent session next starts."
        : "Allow agents to use the shared browser. Projects can override it.",
      settingKeys: ["enableAgentBrowserAccess"],
      mixed: mixedBrowser,
      reset:
        settings.enableAgentBrowserAccess !== DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess
          ? { label: "default browser access", tooltip: null }
          : null,
      ariaLabel: "Agent browser access",
      checked: mixedBrowser ? false : settings.enableAgentBrowserAccess,
    },
  };
}

const CATEGORY_ROWS: Record<ProjectSettingsCategory, readonly ProjectDefaultsRowKey[]> = {
  project: ["model", "workspace"],
  general: ["model", "permissions", "workspace", "submodules"],
  "source-control": ["auto-pull", "merge-method"],
  integrations: ["browser-access"],
};

export function buildProjectDefaultsModel(input: ProjectDefaultsModelInput): ProjectDefaultsModel {
  const rows = buildRows(input);
  const newThreads = input.category === "general" || input.category === "project";
  return {
    sectionId: newThreads
      ? "project-defaults"
      : input.category === "integrations"
        ? "browser-access"
        : "source-control-defaults",
    sectionTitle: newThreads
      ? "New threads"
      : input.category === "integrations"
        ? "Browser"
        : "Repositories",
    rows: CATEGORY_ROWS[input.category].map((key) => rows[key]),
  };
}

function resolveModelChange(
  selection: ModelSelection | null,
  context: ProjectDefaultsChangeContext,
): ProjectDefaultsChange {
  const reason = selection
    ? resolveDefaultModelDisabledReason(context, selection.instanceId, selection.model)
    : null;
  if (reason) {
    return {
      kind: "rejected",
      toast: { type: "error", title: "Default model not saved", description: reason },
    };
  }
  return { kind: "patch", patch: { defaultModelSelection: selection } };
}

function resetPatch(key: Exclude<ProjectDefaultsRowKey, "model">): ScopedSettingsPatch {
  switch (key) {
    case "permissions":
      return { defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode };
    case "workspace":
      return { defaultThreadEnvMode: null };
    case "submodules":
      return { worktreeSubmodules: null };
    case "auto-pull":
      return { defaultAutoPull: false };
    case "merge-method":
      return { pullRequestMergeMethod: null };
    case "browser-access":
      return { enableAgentBrowserAccess: DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess };
  }
}

function selectPatch(key: ProjectDefaultsSelectRowKey, value: unknown): ScopedSettingsPatch | null {
  switch (key) {
    case "permissions":
      return isRuntimeMode(value) ? { defaultRuntimeMode: value } : null;
    case "workspace":
      return value === "local" || value === "worktree" ? { defaultThreadEnvMode: value } : null;
    case "submodules":
      return isWorktreeSubmodules(value) ? { worktreeSubmodules: value } : null;
    case "merge-method":
      return value === "last"
        ? { pullRequestMergeMethod: null }
        : value === "merge" || value === "squash" || value === "rebase"
          ? { pullRequestMergeMethod: value }
          : null;
  }
}

export function resolveProjectDefaultsChange(
  intent: ProjectDefaultsIntent,
  context: ProjectDefaultsChangeContext,
): ProjectDefaultsChange {
  if (intent.kind === "model") return resolveModelChange(intent.selection, context);
  if (intent.kind === "toggle") {
    return {
      kind: "patch",
      patch:
        intent.key === "auto-pull"
          ? { defaultAutoPull: intent.checked }
          : { enableAgentBrowserAccess: intent.checked },
    };
  }
  if (intent.kind === "reset") {
    return intent.key === "model"
      ? resolveModelChange(null, context)
      : { kind: "patch", patch: resetPatch(intent.key) };
  }
  const patch = selectPatch(intent.key, intent.value);
  return patch ? { kind: "patch", patch } : { kind: "none" };
}
