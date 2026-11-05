import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import { useEnvironments } from "../../state/environments";
import { ProjectScriptEditorDialog, ScriptIcon } from "../projectScriptEditor";
import {
  resolveFileScriptImportFailure,
  type ProjectScriptEditorRequest,
} from "../projectScriptEditor.logic";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ProjectActionsList } from "./ProjectActionsList";
import {
  buildProjectActionsModel,
  resolveProjectActionsIntent,
  resolveProjectActionsSource,
  type ProjectActionsIntent,
} from "./ProjectActionsSettings.logic";
import { useProjectScriptSettings } from "./useProjectScriptSettings";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

/**
 * A project's actions on each selected environment. Actions belong to a
 * project, so this only renders at a project scope; the environment's
 * `defaultProjectScripts` is the layer a project without its own list
 * inherits. Shortcuts are environment-wide, so the same action id shares its
 * binding on an environment.
 */
export function ProjectActionsSettings() {
  const { scope, targets, target } = useSettingsScope();
  const { environments } = useEnvironments();
  const source = resolveProjectActionsSource({
    scopeKind: scope.kind,
    members: scope.members,
    target,
    targets,
    environments,
  });
  const { scripts, keybindings } = source;
  const [request, setRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const { saving, persist, submit } = useProjectScriptSettings(source.scriptTargets);

  // A project's t3.json can declare actions to import. Read it from the
  // representative checkout; the imported action still fans out.
  const t3File = useT3ProjectFileState(
    source.fileSource.environmentId,
    source.fileSource.workspaceRoot,
  );
  const model = buildProjectActionsModel({
    source,
    saving,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    fileScripts: t3File.scripts,
    fileStatus: t3File.status,
  });

  const runIntent = async (intent: ProjectActionsIntent) => {
    const decision = resolveProjectActionsIntent(intent, {
      scripts,
      keybindings,
      fileScripts: t3File.scripts,
    });
    switch (decision.kind) {
      case "open-editor":
        setRequest(decision.request);
        return;
      case "import": {
        const result = await submit(null, decision.payload);
        const failedRequest = resolveFileScriptImportFailure(decision.payload, result);
        if (failedRequest) setRequest(failedRequest);
        return;
      }
      case "persist":
        await persist(decision.change);
        return;
      case "none":
        return;
    }
  };

  return (
    <SettingsSection id={model.sectionId} title={model.title}>
      <SettingsRow
        serverScoped
        settingKeys={model.header.settingKeys}
        mixed={model.header.mixed}
        title={model.header.title}
        description={model.header.description}
        onResetOverride={() => void runIntent({ kind: "reset-override" })}
        control={
          <div className="flex flex-wrap items-center gap-1.5">
            {model.importMenu ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      id={model.importMenu.buttonId}
                      size="xs"
                      variant="ghost"
                      disabled={model.importMenu.disabled}
                      type="button"
                    />
                  }
                >
                  {model.importMenu.label}
                  <ChevronDownIcon className="size-3.5" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuGroupLabel>{model.importMenu.groupLabel}</MenuGroupLabel>
                    <p className="px-2 pb-2 text-pretty text-sm text-muted-foreground">
                      {model.importMenu.description}
                    </p>
                  </MenuGroup>
                  <MenuSeparator />
                  {model.importMenu.items.map((item) => (
                    <MenuItem
                      key={item.key}
                      onClick={() => void runIntent({ kind: "import", key: item.key })}
                    >
                      <ScriptIcon icon={item.icon} className="size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="truncate font-mono text-muted-foreground">
                          {item.command}
                        </div>
                      </div>
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              disabled={model.addAction.disabled}
              onClick={() => void runIntent({ kind: "add" })}
            >
              <PlusIcon className="size-3.5" />
              {model.addAction.label}
            </Button>
          </div>
        }
      />
      {model.mixedNotice ? (
        <SettingsRow title={model.mixedNotice.title} description={model.mixedNotice.description} />
      ) : (
        <ProjectActionsList
          rows={model.rows}
          emptyLabel={model.emptyLabel}
          onEdit={(scriptId) => void runIntent({ kind: "edit", scriptId })}
        />
      )}
      {model.invalidFileNotice ? (
        <SettingsRow
          title={model.invalidFileNotice.title}
          description={model.invalidFileNotice.description}
          className="text-warning"
        />
      ) : null}
      <ProjectScriptEditorDialog
        request={request}
        scripts={scripts}
        onSubmit={submit}
        onDelete={(scriptId) => void runIntent({ kind: "remove", scriptId })}
        onClose={() => setRequest(null)}
      />
    </SettingsSection>
  );
}
