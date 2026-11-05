import type {
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@t3tools/contracts";

import { shortcutLabelForCommand } from "../keybindings";
import { commandForProjectScript, primaryProjectScript } from "../projectScripts";
import { resolveImportableFileScripts } from "./projectScriptEditor.logic";

export interface ProjectScriptsToolbarInput {
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly fileScripts: ReadonlyArray<T3ProjectFileScript>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly preferredScriptId: string | null;
  readonly platform: string;
}

export interface ProjectScriptPrimaryModel {
  readonly script: ProjectScript;
  readonly name: string;
  readonly icon: ProjectScriptIcon;
  readonly runLabel: string;
  readonly shortcutLabel: string | null;
}

export interface ProjectScriptMenuItemModel {
  readonly script: ProjectScript;
  readonly scriptId: string;
  readonly label: string;
  readonly icon: ProjectScriptIcon;
  readonly shortcutLabel: string | null;
  readonly editAriaLabel: string;
}

export interface ProjectScriptImportItemModel {
  readonly key: string;
  readonly fileScript: T3ProjectFileScript;
  readonly label: string;
  readonly icon: ProjectScriptIcon;
  readonly importAriaLabel: string;
}

export type ProjectScriptsToolbarLayout =
  | { readonly kind: "split"; readonly primary: ProjectScriptPrimaryModel }
  | { readonly kind: "import-menu" }
  | { readonly kind: "add-button" };

export interface ProjectScriptsToolbarModel {
  readonly toolbar: ProjectScriptsToolbarLayout;
  readonly menuKind: "submenu" | "add-item";
  readonly primary: ProjectScriptPrimaryModel | null;
  readonly scriptItems: ReadonlyArray<ProjectScriptMenuItemModel>;
  readonly importItems: ReadonlyArray<ProjectScriptImportItemModel>;
  readonly showImportSeparator: boolean;
  readonly importGroupLabel: string;
  readonly addActionLabel: string;
  readonly addProjectActionLabel: string;
  readonly submenuLabel: string;
  readonly submenuIcon: ProjectScriptIcon;
  readonly groupAriaLabel: string;
  readonly menuTriggerAriaLabel: string;
  readonly importMenuTriggerAriaLabel: string;
}

export function resolvePreferredProjectScript(
  scripts: ReadonlyArray<ProjectScript>,
  preferredScriptId: string | null,
): ProjectScript | null {
  if (preferredScriptId) {
    const preferred = scripts.find((script) => script.id === preferredScriptId);
    if (preferred) return preferred;
  }
  return primaryProjectScript(scripts);
}

export function buildProjectScriptsToolbarModel(
  input: ProjectScriptsToolbarInput,
): ProjectScriptsToolbarModel {
  const shortcutFor = (scriptId: string) =>
    shortcutLabelForCommand(input.keybindings, commandForProjectScript(scriptId), input.platform);
  const primaryScript = resolvePreferredProjectScript(input.scripts, input.preferredScriptId);
  const importable = resolveImportableFileScripts(input.scripts, input.fileScripts);
  const primary: ProjectScriptPrimaryModel | null = primaryScript
    ? {
        script: primaryScript,
        name: primaryScript.name,
        icon: primaryScript.icon,
        runLabel: `Run ${primaryScript.name}`,
        shortcutLabel: shortcutFor(primaryScript.id),
      }
    : null;
  return {
    toolbar: primary
      ? { kind: "split", primary }
      : importable.length > 0
        ? { kind: "import-menu" }
        : { kind: "add-button" },
    menuKind: primary || importable.length > 0 ? "submenu" : "add-item",
    primary,
    scriptItems: input.scripts.map((script) => ({
      script,
      scriptId: script.id,
      label: script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name,
      icon: script.icon,
      shortcutLabel: shortcutFor(script.id),
      editAriaLabel: `Edit ${script.name}`,
    })),
    importItems: importable.map((fileScript) => ({
      key: `${fileScript.name} ${fileScript.command}`,
      fileScript,
      label: fileScript.name,
      icon: fileScript.icon ?? "play",
      importAriaLabel: "Import",
    })),
    showImportSeparator: primary !== null,
    importGroupLabel: "From t3.json",
    addActionLabel: "Add action",
    addProjectActionLabel: "Add project action…",
    submenuLabel: "Project actions",
    submenuIcon: "play",
    groupAriaLabel: "Project scripts",
    menuTriggerAriaLabel: "Script actions",
    importMenuTriggerAriaLabel: "Project actions",
  };
}
