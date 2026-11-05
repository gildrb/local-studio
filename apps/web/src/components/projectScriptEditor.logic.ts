import type {
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../lib/projectScriptKeybindings";
import { keybindingFromKeyboardEvent } from "./settings/KeybindingsSettings.logic";
import { commandForProjectScript, nextProjectScriptId } from "../projectScripts";

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  waitForSetup: boolean;
  keybinding: string | null;
  previewUrl: string | null;
  autoOpenPreview: boolean;
}

export type ProjectScriptActionResult = AtomCommandResult<void, unknown>;

export const EMPTY_PROJECT_SCRIPT_INPUT: NewProjectScriptInput = {
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  waitForSetup: false,
  keybinding: null,
  previewUrl: null,
  autoOpenPreview: false,
};

export interface ProjectScriptEditorRequest {
  scriptId: string | null;
  initial: NewProjectScriptInput;
  error?: string;
}

export const PROJECT_SCRIPT_ICON_OPTIONS: ReadonlyArray<{
  readonly id: ProjectScriptIcon;
  readonly label: string;
}> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

export const PROJECT_SCRIPT_SAVE_FAILED_MESSAGE = "Failed to save action.";
export const PROJECT_SCRIPT_IMPORT_FAILED_MESSAGE = "Failed to import action.";

export function editorRequestForScript(
  script: ProjectScript,
  keybindings: ResolvedKeybindingsConfig,
): ProjectScriptEditorRequest {
  return {
    scriptId: script.id,
    initial: {
      name: script.name,
      command: script.command,
      icon: script.icon,
      runOnWorktreeCreate: script.runOnWorktreeCreate,
      waitForSetup: script.runOnWorktreeCreate && script.async === false,
      keybinding: keybindingValueForCommand(keybindings, commandForProjectScript(script.id)),
      previewUrl: script.previewUrl ?? null,
      autoOpenPreview: script.autoOpenPreview ?? false,
    },
  };
}

export function resolveImportableFileScripts(
  scripts: ReadonlyArray<ProjectScript>,
  fileScripts: ReadonlyArray<T3ProjectFileScript>,
): ReadonlyArray<T3ProjectFileScript> {
  return fileScripts.filter(
    (fileScript) =>
      !scripts.some(
        (script) =>
          script.command === fileScript.command ||
          script.name.toLowerCase() === fileScript.name.toLowerCase(),
      ),
  );
}

export function projectScriptInputFromFileScript(
  fileScript: T3ProjectFileScript,
): NewProjectScriptInput {
  return {
    name: fileScript.name,
    command: fileScript.command,
    icon: fileScript.icon ?? "play",
    runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
    waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
    keybinding: null,
    previewUrl: fileScript.previewUrl ?? null,
    autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
  };
}

export function errorMessageOr(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function resolveFileScriptImportFailure(
  payload: NewProjectScriptInput,
  result: ProjectScriptActionResult,
): ProjectScriptEditorRequest | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  return {
    scriptId: null,
    initial: payload,
    error: errorMessageOr(squashAtomCommandFailure(result), PROJECT_SCRIPT_IMPORT_FAILED_MESSAGE),
  };
}

export interface ProjectScriptEditorForm {
  readonly name: string;
  readonly command: string;
  readonly icon: ProjectScriptIcon;
  readonly runOnWorktreeCreate: boolean;
  readonly waitForSetup: boolean;
  readonly keybinding: string;
  readonly previewUrl: string;
  readonly autoOpenPreview: boolean;
}

export function projectScriptEditorFormFromInput(
  input: NewProjectScriptInput,
): ProjectScriptEditorForm {
  return {
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    waitForSetup: input.waitForSetup,
    keybinding: input.keybinding ?? "",
    previewUrl: input.previewUrl ?? "",
    autoOpenPreview: input.autoOpenPreview,
  };
}

export type ProjectScriptSubmission =
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "submit"; readonly payload: NewProjectScriptInput };

export function resolveProjectScriptSubmission(input: {
  readonly scriptId: string | null;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly form: ProjectScriptEditorForm;
}): ProjectScriptSubmission {
  const { form } = input;
  const trimmedName = form.name.trim();
  const trimmedCommand = form.command.trim();
  if (trimmedName.length === 0) {
    return { kind: "invalid", error: "Name is required." };
  }
  if (trimmedCommand.length === 0) {
    return { kind: "invalid", error: "Command is required." };
  }
  try {
    const scriptIdForValidation =
      input.scriptId ??
      nextProjectScriptId(
        trimmedName,
        input.scripts.map((script) => script.id),
      );
    const keybindingRule = decodeProjectScriptKeybindingRule({
      keybinding: form.keybinding,
      command: commandForProjectScript(scriptIdForValidation),
    });
    const trimmedPreviewUrl = form.previewUrl.trim();
    return {
      kind: "submit",
      payload: {
        name: trimmedName,
        command: trimmedCommand,
        icon: form.icon,
        runOnWorktreeCreate: form.runOnWorktreeCreate,
        waitForSetup: form.runOnWorktreeCreate && form.waitForSetup,
        keybinding: keybindingRule?.key ?? null,
        previewUrl: trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview: trimmedPreviewUrl.length > 0 ? form.autoOpenPreview : false,
      },
    };
  } catch (error) {
    return { kind: "invalid", error: errorMessageOr(error, PROJECT_SCRIPT_SAVE_FAILED_MESSAGE) };
  }
}

export type ProjectScriptSaveOutcome =
  | { readonly kind: "close" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "error"; readonly message: string };

export function resolveProjectScriptSaveOutcome(
  result: ProjectScriptActionResult,
): ProjectScriptSaveOutcome {
  if (result._tag !== "Failure") return { kind: "close" };
  if (isAtomCommandInterrupted(result)) return { kind: "interrupted" };
  return {
    kind: "error",
    message: errorMessageOr(squashAtomCommandFailure(result), PROJECT_SCRIPT_SAVE_FAILED_MESSAGE),
  };
}

export interface ProjectScriptEditorDialogCopy {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly cancelLabel: string;
  readonly deleteLabel: string;
  readonly deleteConfirmTitle: string;
  readonly deleteConfirmDescription: string;
  readonly deleteConfirmLabel: string;
}

export function buildProjectScriptEditorDialogCopy(input: {
  readonly isEditing: boolean;
  readonly isSaving: boolean;
  readonly name: string;
}): ProjectScriptEditorDialogCopy {
  return {
    title: input.isEditing ? "Edit Action" : "Add Action",
    description: "Actions are project-scoped commands you can run from the top bar or keybindings.",
    submitLabel: input.isSaving ? "Saving…" : input.isEditing ? "Save changes" : "Save action",
    cancelLabel: "Cancel",
    deleteLabel: "Delete",
    deleteConfirmTitle: `Delete action "${input.name}"?`,
    deleteConfirmDescription: "This action cannot be undone.",
    deleteConfirmLabel: "Delete action",
  };
}

export interface ProjectScriptEditorToggles {
  readonly waitForSetupDisabled: boolean;
  readonly autoOpenPreviewDisabled: boolean;
}

export function resolveProjectScriptEditorToggles(
  form: Pick<ProjectScriptEditorForm, "runOnWorktreeCreate" | "previewUrl">,
): ProjectScriptEditorToggles {
  return {
    waitForSetupDisabled: !form.runOnWorktreeCreate,
    autoOpenPreviewDisabled: form.previewUrl.trim().length === 0,
  };
}

export interface ProjectScriptKeybindingKeyEvent {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export type ProjectScriptKeybindingCapture =
  | { readonly kind: "pass-through" }
  | { readonly kind: "ignore" }
  | { readonly kind: "set"; readonly keybinding: string };

export function resolveProjectScriptKeybindingCapture(
  event: ProjectScriptKeybindingKeyEvent,
  platform: string,
): ProjectScriptKeybindingCapture {
  if (event.key === "Tab") return { kind: "pass-through" };
  if (event.key === "Backspace" || event.key === "Delete") return { kind: "set", keybinding: "" };
  const next = keybindingFromKeyboardEvent(event, platform);
  return next === null ? { kind: "ignore" } : { kind: "set", keybinding: next };
}
