import {
  EnvironmentId,
  type KeybindingRule,
  type ProjectId,
  type ProjectScript,
  type ProjectScriptIcon,
  type ResolvedKeybindingsConfig,
  type ServerConfig,
  type ServerSettings,
  type ServerSettingsPatch,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { clearProjectSettingsOverrides } from "@t3tools/shared/projectSettings";

import { shortcutLabelForCommand } from "../../keybindings";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "../../projectScripts";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  projectScriptInputFromFileScript,
  resolveImportableFileScripts,
  type NewProjectScriptInput,
  type ProjectScriptEditorRequest,
} from "../projectScriptEditor.logic";
import type { ScopedSettingsTarget } from "./scopedSettings";
import type { ResolvedSettingsScope } from "./settingsScope";

export type ProjectScriptSettingsTarget = {
  readonly environmentId: EnvironmentId;
  readonly settings: ServerSettings;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly project?: { readonly id: ProjectId; readonly scripts: readonly ProjectScript[] };
};

export type ProjectActionsEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly serverConfig: Pick<ServerConfig, "settings" | "keybindings" | "environment"> | null;
};

export type ProjectActionsSourceInput = {
  readonly scopeKind: ResolvedSettingsScope["kind"];
  readonly members: ReadonlyArray<SidebarProjectGroupMember>;
  readonly target: Pick<ScopedSettingsTarget, "environmentId" | "projectId" | "settings"> | null;
  readonly targets: ReadonlyArray<
    Pick<ScopedSettingsTarget, "environmentId" | "projectId" | "settings">
  >;
  readonly environments: ReadonlyArray<ProjectActionsEnvironment>;
};

export type ProjectActionsFileSource = {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | null;
};

export type ProjectActionsSource = {
  readonly scripts: readonly ProjectScript[];
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly mixed: boolean;
  readonly canAdd: boolean;
  readonly scriptTargets: readonly ProjectScriptSettingsTarget[];
  readonly fileSource: ProjectActionsFileSource;
};

export type ProjectActionBadge = {
  readonly id: "setup" | "preview";
  readonly label: string;
  readonly hideOnSmallScreens: boolean;
};

export type ProjectActionRow = {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly icon: ProjectScriptIcon;
  readonly shortcutLabel: string | null;
  readonly badges: readonly ProjectActionBadge[];
  readonly editAriaLabel: string;
  readonly editDisabled: boolean;
};

export type ProjectActionImportItem = {
  readonly key: string;
  readonly name: string;
  readonly command: string;
  readonly icon: ProjectScriptIcon;
};

export type ProjectActionsModelInput = {
  readonly source: Pick<ProjectActionsSource, "scripts" | "keybindings" | "mixed" | "canAdd">;
  readonly saving: boolean;
  readonly platform: string;
  readonly fileScripts: ReadonlyArray<T3ProjectFileScript>;
  readonly fileStatus: "loading" | "missing" | "invalid" | "valid";
};

export type ProjectActionsModel = {
  readonly sectionId: string;
  readonly title: string;
  readonly header: {
    readonly title: string;
    readonly description: string;
    readonly settingKeys: readonly (keyof ServerSettings)[];
    readonly mixed: boolean;
  };
  readonly importMenu: {
    readonly buttonId: string;
    readonly label: string;
    readonly disabled: boolean;
    readonly groupLabel: string;
    readonly description: string;
    readonly items: readonly ProjectActionImportItem[];
  } | null;
  readonly addAction: { readonly label: string; readonly icon: string; readonly disabled: boolean };
  readonly mixedNotice: { readonly title: string; readonly description: string } | null;
  readonly rows: readonly ProjectActionRow[];
  readonly emptyLabel: string | null;
  readonly invalidFileNotice: { readonly title: string; readonly description: string } | null;
};

export type ProjectActionsIntent =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly scriptId: string }
  | { readonly kind: "import"; readonly key: string }
  | { readonly kind: "remove"; readonly scriptId: string }
  | { readonly kind: "reset-override" };

export type ProjectScriptsTransform =
  | { readonly kind: "clear-override" }
  | { readonly kind: "remove"; readonly scriptId: string }
  | {
      readonly kind: "upsert";
      readonly script: ProjectScript;
      readonly isNew: boolean;
      readonly clearOtherSetup: boolean;
    };

export type ProjectScriptsChange = {
  readonly transform: ProjectScriptsTransform;
  readonly scriptId: string | null;
  readonly keybinding: string | null;
};

export type ProjectActionsDecision =
  | { readonly kind: "none" }
  | { readonly kind: "open-editor"; readonly request: ProjectScriptEditorRequest }
  | { readonly kind: "import"; readonly payload: NewProjectScriptInput }
  | { readonly kind: "persist"; readonly change: ProjectScriptsChange };

export type ProjectScriptsPersistStep = {
  readonly current: readonly ProjectScript[];
  readonly nextScripts: readonly ProjectScript[] | null;
  readonly patch: ServerSettingsPatch;
};

export type ProjectScriptKeybindingStep =
  | {
      readonly kind: "upsert";
      readonly rule: KeybindingRule & { readonly replace?: KeybindingRule };
    }
  | { readonly kind: "remove"; readonly rule: KeybindingRule };

export const PROJECT_ACTIONS_NOT_SAVED_TITLE = "Actions not saved";
export const PROJECT_ACTIONS_BUSY_MESSAGE =
  "No available machine, or another action change is saving.";
export const PROJECT_ACTIONS_SAVE_FAILED_TITLE = "Failed to save project actions";

function importKey(fileScript: T3ProjectFileScript): string {
  return `${fileScript.name} ${fileScript.command}`;
}

function actionBadges(script: ProjectScript): ProjectActionBadge[] {
  const badges: ProjectActionBadge[] = [];
  if (script.runOnWorktreeCreate) {
    badges.push({ id: "setup", label: "setup", hideOnSmallScreens: false });
  }
  if (script.previewUrl) {
    badges.push({ id: "preview", label: "preview · desktop only", hideOnSmallScreens: true });
  }
  return badges;
}

export function resolveProjectActionsSource(
  input: ProjectActionsSourceInput,
): ProjectActionsSource {
  const isProjectScope = input.scopeKind === "project" || input.scopeKind === "checkout";
  const memberById = new Map(
    isProjectScope ? input.members.map((member) => [member.id, member]) : [],
  );
  const { target } = input;
  const representativeConfig = target
    ? input.environments.find((environment) => environment.environmentId === target.environmentId)
        ?.serverConfig
    : undefined;
  const scripts = target?.settings.defaultProjectScripts ?? [];
  const representativeMember = target?.projectId ? memberById.get(target.projectId) : undefined;
  return {
    scripts,
    keybindings: representativeConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS,
    mixed: input.targets.some(
      (candidate) =>
        JSON.stringify(candidate.settings.defaultProjectScripts) !== JSON.stringify(scripts),
    ),
    canAdd: input.targets.length > 0,
    scriptTargets: input.targets.flatMap((candidate) => {
      const environment = input.environments.find(
        (entry) => entry.environmentId === candidate.environmentId,
      );
      if (!environment?.serverConfig) return [];
      const member = candidate.projectId ? memberById.get(candidate.projectId) : undefined;
      // An older server ignores the override record, so a project edit there
      // would report success and vanish; such environments are left out and
      // the legacy per-project map keeps serving them.
      if (
        member &&
        environment.serverConfig.environment?.capabilities.projectSettingsOverrides !== true
      ) {
        return [];
      }
      return [
        {
          environmentId: candidate.environmentId,
          // Writes read the raw environment settings so an override entry is
          // extended, not derived from already-resolved values.
          settings: environment.serverConfig.settings,
          keybindings: environment.serverConfig.keybindings,
          ...(member ? { project: member } : {}),
        },
      ];
    }),
    fileSource: {
      environmentId: representativeMember?.environmentId ?? EnvironmentId.make("none"),
      workspaceRoot: representativeMember?.workspaceRoot ?? null,
    },
  };
}

export function buildProjectActionsModel(input: ProjectActionsModelInput): ProjectActionsModel {
  const { scripts, keybindings, mixed, canAdd } = input.source;
  const importable = resolveImportableFileScripts(scripts, input.fileScripts);
  return {
    sectionId: "project-actions",
    title: "Actions",
    header: {
      title: "Actions",
      description:
        "Commands that run in this project's checkout or its worktree, with optional shortcuts.",
      settingKeys: ["defaultProjectScripts"],
      mixed,
    },
    importMenu:
      importable.length > 0
        ? {
            buttonId: "import-scripts",
            label: "Import scripts",
            disabled: input.saving,
            groupLabel: "Import from t3.json",
            description: "Add actions declared by this checkout without editing them first.",
            items: importable.map((fileScript) => ({
              key: importKey(fileScript),
              name: fileScript.name,
              command: fileScript.command,
              icon: fileScript.icon ?? "play",
            })),
          }
        : null,
    addAction: { label: "Add action", icon: "plus", disabled: input.saving || !canAdd },
    mixedNotice: mixed
      ? {
          title: "Different actions across environments",
          description:
            "Choose one environment to edit its list. Adding an action here adds it on every selected environment.",
        }
      : null,
    rows: mixed
      ? []
      : scripts.map((script) => ({
          id: script.id,
          name: script.name,
          command: script.command,
          icon: script.icon,
          shortcutLabel: shortcutLabelForCommand(
            keybindings,
            commandForProjectScript(script.id),
            input.platform,
          ),
          badges: actionBadges(script),
          editAriaLabel: `Edit ${script.name}`,
          editDisabled: input.saving,
        })),
    emptyLabel: !mixed && scripts.length === 0 ? "No actions configured." : null,
    invalidFileNotice:
      input.fileStatus === "invalid"
        ? {
            title: "t3.json is invalid",
            description:
              "A t3.json exists in this checkout but fails to parse, so every action and icon it declares is ignored. Check the JSON syntax and icon values.",
          }
        : null,
  };
}

export function resolveProjectActionsIntent(
  intent: ProjectActionsIntent,
  context: {
    readonly scripts: readonly ProjectScript[];
    readonly keybindings: ResolvedKeybindingsConfig;
    readonly fileScripts: ReadonlyArray<T3ProjectFileScript>;
  },
): ProjectActionsDecision {
  switch (intent.kind) {
    case "add":
      return {
        kind: "open-editor",
        request: { scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT },
      };
    case "edit": {
      const script = context.scripts.find((candidate) => candidate.id === intent.scriptId);
      return script
        ? { kind: "open-editor", request: editorRequestForScript(script, context.keybindings) }
        : { kind: "none" };
    }
    case "import": {
      const fileScript = resolveImportableFileScripts(context.scripts, context.fileScripts).find(
        (candidate) => importKey(candidate) === intent.key,
      );
      return fileScript
        ? { kind: "import", payload: projectScriptInputFromFileScript(fileScript) }
        : { kind: "none" };
    }
    case "remove":
      return {
        kind: "persist",
        change: {
          transform: { kind: "remove", scriptId: intent.scriptId },
          scriptId: intent.scriptId,
          keybinding: null,
        },
      };
    case "reset-override":
      return {
        kind: "persist",
        change: { transform: { kind: "clear-override" }, scriptId: null, keybinding: null },
      };
  }
}

export function collectProjectScriptIds(input: {
  readonly projects: ReadonlyArray<Pick<Project, "scripts">>;
  readonly targets: ReadonlyArray<ProjectScriptSettingsTarget>;
}): string[] {
  return [
    ...input.projects.flatMap((project) => project.scripts.map((script) => script.id)),
    ...input.targets.flatMap(({ settings, project }) =>
      [
        ...settings.defaultProjectScripts,
        ...Object.values(settings.projectSettingsOverrides).flatMap(
          (entry) => entry.defaultProjectScripts ?? [],
        ),
        ...(project?.scripts ?? []),
      ].map((script) => script.id),
    ),
  ];
}

export function resolveProjectScriptSubmit(input: {
  readonly scriptId: string | null;
  readonly script: NewProjectScriptInput;
  readonly existingIds: Iterable<string>;
}): ProjectScriptsChange {
  const id = input.scriptId ?? nextProjectScriptId(input.script.name, input.existingIds);
  return {
    transform: {
      kind: "upsert",
      script: buildProjectScript(id, input.script),
      isNew: input.scriptId === null,
      clearOtherSetup: input.script.runOnWorktreeCreate,
    },
    scriptId: id,
    keybinding: input.script.keybinding,
  };
}

export function applyProjectScriptsTransform(
  current: readonly ProjectScript[],
  transform: ProjectScriptsTransform,
): readonly ProjectScript[] | null {
  switch (transform.kind) {
    case "clear-override":
      return null;
    case "remove":
      return current.filter((script) => script.id !== transform.scriptId);
    case "upsert": {
      const next = transform.script;
      const updated = current.map((script) =>
        script.id === next.id
          ? next
          : transform.clearOtherSetup
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );
      return transform.isNew ? [...updated, next] : updated;
    }
  }
}

export function resolveProjectScriptsPersistStep(
  target: ProjectScriptSettingsTarget,
  transform: ProjectScriptsTransform,
): ProjectScriptsPersistStep {
  const { settings, project } = target;
  const current = project
    ? resolveProjectScripts(settings, project)
    : settings.defaultProjectScripts;
  const nextScripts = applyProjectScriptsTransform(current, transform);
  return {
    current,
    nextScripts,
    patch: project
      ? {
          projectSettingsOverrides: {
            [project.id]:
              nextScripts === null
                ? clearProjectSettingsOverrides(settings, project.id, ["defaultProjectScripts"])
                : {
                    ...settings.projectSettingsOverrides[project.id],
                    defaultProjectScripts: nextScripts,
                  },
          },
        }
      : { defaultProjectScripts: nextScripts ?? [] },
  };
}

export function resolveProjectScriptKeybindingSteps(input: {
  readonly target: ProjectScriptSettingsTarget;
  readonly step: Pick<ProjectScriptsPersistStep, "current" | "nextScripts">;
  readonly change: Pick<ProjectScriptsChange, "scriptId" | "keybinding">;
  readonly projects: ReadonlyArray<Pick<Project, "environmentId" | "id" | "scripts">>;
}): ProjectScriptKeybindingStep[] {
  const { environmentId, settings, keybindings, project } = input.target;
  const { current, nextScripts } = input.step;
  const effectiveScripts = nextScripts ?? settings.defaultProjectScripts;
  const changedIds = input.change.scriptId
    ? [input.change.scriptId]
    : current
        .filter((script) => !effectiveScripts.some((next) => next.id === script.id))
        .map((script) => script.id);
  return changedIds.flatMap((id): ProjectScriptKeybindingStep[] => {
    const command = commandForProjectScript(id);
    const previousValue = keybindingValueForCommand(keybindings, command);
    const previous = previousValue
      ? decodeProjectScriptKeybindingRule({ keybinding: previousValue, command })
      : null;
    const next = decodeProjectScriptKeybindingRule({
      keybinding: input.change.keybinding,
      command,
    });
    if (next) {
      return [
        {
          kind: "upsert",
          rule: previous && previous.key !== next.key ? { ...next, replace: previous } : next,
        },
      ];
    }
    const retainedElsewhere =
      !nextScripts?.some((script) => script.id === id) &&
      ((project && settings.defaultProjectScripts.some((script) => script.id === id)) ||
        Object.entries(settings.projectSettingsOverrides).some(
          ([projectId, entry]) =>
            projectId !== project?.id &&
            entry.defaultProjectScripts?.some((script) => script.id === id),
        ) ||
        input.projects.some(
          (other) =>
            other.environmentId === environmentId &&
            other.id !== project?.id &&
            (project ? resolveProjectScripts(settings, other) : other.scripts).some(
              (script) => script.id === id,
            ),
        ));
    return previous && !retainedElsewhere ? [{ kind: "remove", rule: previous }] : [];
  });
}
