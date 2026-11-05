import type {
  ProjectScript,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@t3tools/contracts";
import { ChevronDownIcon, DownloadIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { buildProjectScriptsToolbarModel } from "./ProjectScriptsControl.logic";
import { ProjectScriptEditorDialog, ScriptIcon } from "./projectScriptEditor";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  projectScriptInputFromFileScript,
  resolveFileScriptImportFailure,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor.logic";
import { Button } from "./ui/button";
import { Group, GroupSeparator } from "./ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type { NewProjectScriptInput, ProjectScriptActionResult };

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

interface ProjectScriptsControlProps {
  presentation?: "toolbar" | "menu";
  onRequestMenuClose?: () => void;
  scripts: ReadonlyArray<ProjectScript>;
  /** Scripts declared in the project's checked-in t3.json, offered for import. */
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export default function ProjectScriptsControl({
  presentation = "toolbar",
  onRequestMenuClose,
  scripts,
  fileScripts = NO_FILE_SCRIPTS,
  keybindings,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const [actionsMenuOpen, setActionsMenuOpen] = useState({
    presentation,
    scripts: false,
    imports: false,
  });
  if (actionsMenuOpen.presentation !== presentation) {
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
  }
  const [editorRequest, setEditorRequest] = useState<ProjectScriptEditorRequest | null>(null);

  const model = useMemo(
    () =>
      buildProjectScriptsToolbarModel({
        scripts,
        fileScripts,
        keybindings,
        preferredScriptId,
        platform: navigator.platform,
      }),
    [fileScripts, keybindings, preferredScriptId, scripts],
  );
  const primary = model.primary;

  const openAddDialog = () => {
    setEditorRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });
  };

  const openEditDialog = (script: ProjectScript) => {
    onRequestMenuClose?.();
    setActionsMenuOpen({ presentation, scripts: false, imports: false });
    setEditorRequest(editorRequestForScript(script, keybindings));
  };

  const submitScript = useCallback(
    (scriptId: string | null, input: NewProjectScriptInput) =>
      scriptId === null ? onAddScript(input) : onUpdateScript(scriptId, input),
    [onAddScript, onUpdateScript],
  );

  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const payload = projectScriptInputFromFileScript(fileScript);
    const result = await onAddScript(payload);
    // Surface the failure through the regular add dialog, prefilled so the
    // user can adjust and retry.
    const failedRequest = resolveFileScriptImportFailure(payload, result);
    if (failedRequest) setEditorRequest(failedRequest);
  };

  const importMenuItems = model.importItems.length > 0 && (
    <>
      {model.showImportSeparator && <MenuSeparator />}
      <MenuGroup>
        <MenuGroupLabel>{model.importGroupLabel}</MenuGroupLabel>
        {model.importItems.map((item) => (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={item.key}
            onClick={() => void importFileScript(item.fileScript)}
          >
            <ScriptIcon icon={item.icon} className="size-4" />
            <MenuItemLabel>{item.label}</MenuItemLabel>
            <MenuShortcut>
              <DownloadIcon className="size-3.5" aria-label={item.importAriaLabel} />
            </MenuShortcut>
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );

  const scriptItems = (
    <>
      {model.scriptItems.map((item) => {
        const shortcutLabel = item.shortcutLabel;
        return (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            key={item.scriptId}
            className="group"
            onClick={() => onRunScript(item.script)}
          >
            <ScriptIcon icon={item.icon} className="size-4" />
            <MenuItemLabel>{item.label}</MenuItemLabel>
            <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
              {shortcutLabel &&
                (presentation === "menu" ? (
                  <MenuShortcut className="ms-0 mr-7">{shortcutLabel}</MenuShortcut>
                ) : (
                  // The shortcut yields its slot to the edit button on hover.
                  <span className="transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                    <MenuShortcut className="ms-0">{shortcutLabel}</MenuShortcut>
                  </span>
                ))}
              <span
                className={`absolute right-0 top-1/2 flex -translate-y-1/2 ${presentation === "menu" ? "" : "opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-6"
                  aria-label={item.editAriaLabel}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openEditDialog(item.script);
                  }}
                >
                  <SettingsIcon className="size-3.5" />
                </Button>
              </span>
            </span>
          </MenuItem>
        );
      })}
      {importMenuItems}
      <MenuItem density={presentation === "menu" ? "touch" : "default"} onClick={openAddDialog}>
        <PlusIcon className="size-4" />
        <MenuItemLabel>{model.addActionLabel}</MenuItemLabel>
      </MenuItem>
    </>
  );

  const toolbar = model.toolbar;
  return (
    <>
      {presentation === "menu" ? (
        <>
          {primary && (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              onClick={() => onRunScript(primary.script)}
            >
              <ScriptIcon icon={primary.icon} className="size-4" />
              <MenuItemLabel>{primary.runLabel}</MenuItemLabel>
              <MenuShortcut>{primary.shortcutLabel}</MenuShortcut>
            </MenuItem>
          )}
          {model.menuKind === "submenu" ? (
            <MenuSub
              open={actionsMenuOpen.scripts}
              onOpenChange={(open) =>
                setActionsMenuOpen({ presentation, scripts: open, imports: false })
              }
            >
              <MenuSubTrigger density="touch">
                <ScriptIcon icon={model.submenuIcon} className="size-4" />
                <MenuItemLabel>{model.submenuLabel}</MenuItemLabel>
              </MenuSubTrigger>
              <MenuSubPopup>{scriptItems}</MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              onClick={openAddDialog}
            >
              <PlusIcon className="size-4" />
              <MenuItemLabel>{model.addProjectActionLabel}</MenuItemLabel>
            </MenuItem>
          )}
        </>
      ) : toolbar.kind === "split" ? (
        <Group aria-label={model.groupAriaLabel}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  className="w-7 sm:w-6 @3xl/header-actions:w-auto!"
                  aria-label={toolbar.primary.runLabel}
                  // The tooltip wrapper replaces data-slot="button", so themed
                  // toolbar styling needs its own hook.
                  data-toolbar-control=""
                  onClick={() => onRunScript(toolbar.primary.script)}
                />
              }
            >
              <ScriptIcon icon={toolbar.primary.icon} />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                {toolbar.primary.name}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">{toolbar.primary.runLabel}</TooltipPopup>
          </Tooltip>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            open={actionsMenuOpen.scripts}
            onOpenChange={(open) =>
              setActionsMenuOpen({ presentation, scripts: open, imports: false })
            }
          >
            <MenuTrigger
              render={
                <Button size="icon-xs" variant="outline" aria-label={model.menuTriggerAriaLabel} />
              }
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">{scriptItems}</MenuPopup>
          </Menu>
        </Group>
      ) : toolbar.kind === "import-menu" ? (
        <Menu
          open={actionsMenuOpen.imports}
          onOpenChange={(open) =>
            setActionsMenuOpen({ presentation, scripts: false, imports: open })
          }
        >
          <MenuTrigger
            render={
              <Button size="xs" variant="outline" aria-label={model.importMenuTriggerAriaLabel} />
            }
          >
            <PlusIcon className="size-3.5" />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {model.addActionLabel}
            </span>
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            {importMenuItems}
            <MenuItem onClick={openAddDialog}>
              <PlusIcon className="size-4" />
              {model.addActionLabel}
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="outline"
                className="w-7 sm:w-6 @3xl/header-actions:w-auto!"
                aria-label={model.addActionLabel}
                // The tooltip wrapper replaces data-slot="button", so themed
                // toolbar styling needs its own hook.
                data-toolbar-control=""
                onClick={openAddDialog}
              />
            }
          >
            <PlusIcon className="size-3.5" />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {model.addActionLabel}
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">{model.addActionLabel}</TooltipPopup>
        </Tooltip>
      )}

      <ProjectScriptEditorDialog
        request={editorRequest}
        scripts={scripts}
        onSubmit={submitScript}
        onDelete={(scriptId) => void onDeleteScript(scriptId)}
        onClose={() => setEditorRequest(null)}
      />
    </>
  );
}
