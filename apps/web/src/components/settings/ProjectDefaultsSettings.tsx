import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";

import { useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import {
  buildProjectDefaultsModel,
  resolveDefaultModelDisabledReason,
  resolveProjectDefaultsChange,
  resolveProjectDefaultsModelPicker,
  resolveProjectDefaultsModelTargets,
  resolveProjectDefaultsSelectLabel,
  type ProjectDefaultsChangeContext,
  type ProjectDefaultsIntent,
  type ProjectDefaultsRow,
  type ProjectSettingsCategory,
} from "./ProjectDefaultsSettings.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/**
 * Rows for the settings a project may override. The same rows edit
 * environment defaults at an environment scope and project overrides at a
 * project or checkout scope; the scoped hooks route the write.
 */
export function ProjectDefaultsSettings({ category }: { category: ProjectSettingsCategory }) {
  const { scope, target, targets, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers = representative?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const picker = resolveProjectDefaultsModelPicker({ providers, settings });
  const { selection, activeEntry } = picker;
  // File-backed keys show their effective value; the target already carries
  // the checkout's t3.json, and a null file here only fills the built-in.
  // The reset arrow beside the title clears the tier (SettingsRow handles a
  // project override, the environment value is cleared here), so the picker
  // has no "inherit" item.
  const model = buildProjectDefaultsModel({
    category,
    scopeKind: scope.kind,
    connectedEnvironmentCount: connectedEnvironments.length,
    settings,
    targetSettings: target?.settings ?? null,
    targets,
    modelPicker: picker,
  });
  const changeContext: ProjectDefaultsChangeContext = {
    settings,
    entries: picker.entries,
    modelTargets: resolveProjectDefaultsModelTargets({ targets, environments }),
  };

  const apply = (intent: ProjectDefaultsIntent) => {
    const change = resolveProjectDefaultsChange(intent, changeContext);
    if (change.kind === "rejected") {
      toastManager.add(change.toast);
      return;
    }
    if (change.kind === "patch") updateSettings(change.patch);
  };

  const resetAction = (row: ProjectDefaultsRow) =>
    row.reset ? (
      <SettingResetButton
        label={row.reset.label}
        {...(row.reset.tooltip ? { tooltip: row.reset.tooltip } : {})}
        onClick={() => apply({ kind: "reset", key: row.key })}
      />
    ) : null;

  const renderRow = (row: ProjectDefaultsRow) => {
    switch (row.key) {
      case "model":
        return (
          <SettingsRow
            key={row.key}
            serverScoped
            settingKeys={row.settingKeys}
            mixed={row.mixed}
            id={row.id}
            title={row.title}
            description={row.description}
            status={row.status ?? undefined}
            resetAction={resetAction(row)}
            control={
              selection && activeEntry ? (
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  <ProviderModelPicker
                    activeInstanceId={selection.instanceId}
                    model={selection.model}
                    lockedProvider={null}
                    instanceEntries={picker.entries}
                    modelOptionsByInstance={picker.modelOptions}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    {...(row.triggerLabel ? { triggerLabel: row.triggerLabel } : {})}
                    getModelDisabledReason={(instanceId, modelSlug) =>
                      resolveDefaultModelDisabledReason(changeContext, instanceId, modelSlug)
                    }
                    onOpenProviderSetup={(instanceId) => {
                      if (representative)
                        void navigate({
                          to: "/settings/providers",
                          search: { environmentId: representative.environmentId, instanceId },
                        });
                    }}
                    onInstanceModelChange={(instanceId, modelSlug) =>
                      apply({
                        kind: "model",
                        selection: createModelSelection(instanceId, modelSlug),
                      })
                    }
                  />
                  {row.showTraits ? (
                    <TraitsPicker
                      provider={activeEntry.driverKind}
                      models={activeEntry.models}
                      model={selection.model}
                      prompt=""
                      onPromptChange={() => {}}
                      modelOptions={selection.options ?? []}
                      allowPromptInjectedEffort={false}
                      planModeEnabled={settings.planModeEnabled}
                      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                      onModelOptionsChange={(options) =>
                        apply({
                          kind: "model",
                          selection: createModelSelection(
                            selection.instanceId,
                            selection.model,
                            options,
                          ),
                        })
                      }
                    />
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{row.emptyLabel}</span>
              )
            }
          />
        );
      case "permissions": {
        const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
        return (
          <SettingsRow
            key={row.key}
            serverScoped
            settingKeys={row.settingKeys}
            mixed={row.mixed}
            id={row.id}
            title={row.title}
            description={row.description}
            resetAction={resetAction(row)}
            control={
              <Select
                value={row.value}
                onValueChange={(value) => apply({ kind: "select", key: row.key, value })}
              >
                <SelectTrigger size="sm" aria-label={row.ariaLabel}>
                  {!row.mixed && (
                    <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <SelectValue>{row.valueLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {row.options.map((option) => {
                    const Icon = runtimeModeConfig[option.value].icon;
                    return (
                      <SelectItem key={option.value} value={option.value} className="min-w-64">
                        <div className="grid gap-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            {option.label}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            }
          />
        );
      }
      case "workspace":
      case "submodules":
      case "merge-method":
        return (
          <SettingsRow
            key={row.key}
            serverScoped
            settingKeys={row.settingKeys}
            mixed={row.mixed}
            id={row.id}
            title={row.title}
            description={row.description}
            resetAction={resetAction(row)}
            control={
              <Select
                value={row.value}
                onValueChange={(value) => apply({ kind: "select", key: row.key, value })}
              >
                <SelectTrigger size="sm" aria-label={row.ariaLabel}>
                  <SelectValue>
                    {(value: string | null) => resolveProjectDefaultsSelectLabel(row, value)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {row.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        );
      case "auto-pull":
      case "browser-access":
        return (
          <SettingsRow
            key={row.key}
            serverScoped
            settingKeys={row.settingKeys}
            mixed={row.mixed}
            id={row.id}
            title={row.title}
            description={row.description}
            resetAction={resetAction(row)}
            control={
              <Switch
                aria-label={row.ariaLabel}
                mixed={row.mixed}
                checked={row.checked}
                onCheckedChange={(checked) => apply({ kind: "toggle", key: row.key, checked })}
              />
            }
          />
        );
    }
  };

  return (
    <SettingsSection id={model.sectionId} title={model.sectionTitle}>
      {model.rows.map(renderRow)}
    </SettingsSection>
  );
}
