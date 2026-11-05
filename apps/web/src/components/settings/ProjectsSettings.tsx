import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { buildProjectsSettingsModel } from "./ProjectsSettings.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsPageContainer } from "./settingsLayout";

/** Project identity and checkout management for the selected project. */
export function ProjectsSettings() {
  const { search, scope } = useSettingsScope();
  // The panel follows remembered members when grouping replaces a project key.
  const model = buildProjectsSettingsModel({ search, scope });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {model.kind === "project" ? (
        <ProjectSettingsPanel
          projectKey={model.projectKey}
          environmentId={model.environmentId}
          checkoutKey={model.checkoutKey}
        />
      ) : model.kind === "unavailable" ? (
        <SettingsPageContainer>
          <p className="text-sm text-muted-foreground">{model.message}</p>
        </SettingsPageContainer>
      ) : (
        <SettingsScopeNotice target={model.target}>{model.message}</SettingsScopeNotice>
      )}
    </div>
  );
}
