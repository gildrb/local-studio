import type {
  KeybindingCommand,
  KeybindingRule,
  ProjectId,
  ProjectScript,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";

import { decodeProjectScriptKeybindingRule } from "../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "../projectScripts";
import type { LastInvokedScriptByProject } from "./ChatView.logic";
import type { NewProjectScriptInput } from "./projectScriptEditor.logic";

export const PROJECT_SCRIPT_NOT_FOUND_MESSAGE = "Script not found.";
export const PROJECT_SCRIPT_DELETE_FAILED_TITLE = "Could not delete action";
export const PROJECT_SCRIPT_DELETE_FAILED_DESCRIPTION = "An unexpected error occurred.";

export function projectScriptRunFailedMessage(name: string): string {
  return `Failed to run script "${name}".`;
}

export interface ProjectScriptsPersistRequest {
  readonly nextScripts: ReadonlyArray<ProjectScript>;
  readonly keybinding: string | null;
  readonly keybindingCommand: KeybindingCommand | null;
}

export interface ProjectScriptsDeleteRequest extends ProjectScriptsPersistRequest {
  readonly deletedTitle: string;
}

export function resolveAddedProjectScripts(
  scripts: ReadonlyArray<ProjectScript>,
  input: NewProjectScriptInput,
): ProjectScriptsPersistRequest {
  const nextId = nextProjectScriptId(
    input.name,
    scripts.map((script) => script.id),
  );
  const nextScript = buildProjectScript(nextId, input);
  return {
    nextScripts: input.runOnWorktreeCreate
      ? [
          ...scripts.map((script) =>
            script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
          ),
          nextScript,
        ]
      : [...scripts, nextScript],
    keybinding: input.keybinding,
    keybindingCommand: commandForProjectScript(nextId),
  };
}

export function resolveUpdatedProjectScripts(
  scripts: ReadonlyArray<ProjectScript>,
  scriptId: string,
  input: NewProjectScriptInput,
): ProjectScriptsPersistRequest | null {
  const existingScript = scripts.find((script) => script.id === scriptId);
  if (!existingScript) return null;
  const updatedScript = buildProjectScript(existingScript.id, input);
  return {
    nextScripts: scripts.map((script) =>
      script.id === scriptId
        ? updatedScript
        : input.runOnWorktreeCreate
          ? { ...script, runOnWorktreeCreate: false }
          : script,
    ),
    keybinding: input.keybinding,
    keybindingCommand: commandForProjectScript(scriptId),
  };
}

export function resolveDeletedProjectScripts(
  scripts: ReadonlyArray<ProjectScript>,
  scriptId: string,
): ProjectScriptsDeleteRequest {
  const deletedName = scripts.find((script) => script.id === scriptId)?.name;
  return {
    nextScripts: scripts.filter((script) => script.id !== scriptId),
    keybinding: null,
    keybindingCommand: commandForProjectScript(scriptId),
    deletedTitle: `Deleted action "${deletedName ?? "Unknown"}"`,
  };
}

export function buildProjectScriptsSettingsPatch(input: {
  readonly projectId: ProjectId;
  readonly nextScripts: ReadonlyArray<ProjectScript>;
  readonly supportsProjectSettingsOverrides: boolean;
  readonly projectSettingsOverrides: ServerSettings["projectSettingsOverrides"];
}): ServerSettingsPatch {
  return input.supportsProjectSettingsOverrides
    ? {
        projectSettingsOverrides: {
          [input.projectId]: {
            ...input.projectSettingsOverrides[input.projectId],
            defaultProjectScripts: input.nextScripts,
          },
        },
      }
    : {
        projectScriptOverrides: {
          [input.projectId]: input.nextScripts,
        },
      };
}

export function resolveProjectScriptKeybindingUpsert(input: {
  readonly keybinding: string | null | undefined;
  readonly keybindingCommand: KeybindingCommand | null;
  readonly isDesktop: boolean;
}): KeybindingRule | null {
  const rule = decodeProjectScriptKeybindingRule({
    keybinding: input.keybinding,
    command: input.keybindingCommand,
  });
  return input.isDesktop ? rule : null;
}

export function rememberLastInvokedScript(
  current: LastInvokedScriptByProject,
  projectId: ProjectId,
  scriptId: string,
): LastInvokedScriptByProject {
  if (current[projectId] === scriptId) return current;
  return { ...current, [projectId]: scriptId };
}
