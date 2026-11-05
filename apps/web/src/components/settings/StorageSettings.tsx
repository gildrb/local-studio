import { useMemo, useState } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  buildStorageSettingsModel,
  resolveRetentionCommit,
  resolveRetentionInputSize,
  resolveRetentionToggle,
  resolveStorageSettingsAction,
  type StorageRetentionControlModel,
  type StorageSettingsIntent,
} from "./StorageSettings.logic";
import {
  useClearScopedSettings,
  useScopedSettings,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function RetentionControl({
  control,
  onChange,
}: {
  control: StorageRetentionControlModel;
  onChange: (value: number | null) => void;
}) {
  const { value } = control;
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={control.min}
          max={control.max}
          step={control.step}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            const decision = resolveRetentionCommit(next, value);
            if (decision.kind === "reset") setDraft(decision.draft);
            else {
              setDraft(decision.days);
              onChange(decision.days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={control.decrementLabel} />
            <NumberFieldInput
              aria-label={control.inputLabel}
              size={resolveRetentionInputSize(draft, value)}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              {control.unitLabel}
            </span>
            <NumberFieldIncrement aria-label={control.incrementLabel} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">{control.offLabel}</span>
      )}
      <Switch
        aria-label={control.label}
        checked={control.enabled}
        onCheckedChange={(enabled) => onChange(resolveRetentionToggle(enabled))}
      />
    </div>
  );
}

export function StorageSettingsPanel() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const model = useMemo(
    () =>
      buildStorageSettingsModel({
        scopeKind: scope.kind,
        settings: scopedSettings,
        target,
        targets,
        connectedEnvironments,
      }),
    [connectedEnvironments, scope.kind, scopedSettings, target, targets],
  );
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const dispatch = (intent: StorageSettingsIntent) => {
    const action = resolveStorageSettingsAction({ scopeKind: scope.kind, intent });
    if (action.kind === "clear") clearSettings(action.keys);
    else if (action.kind === "update") updateSettings(action.patch);
  };

  if (model.kind === "notice") {
    const { notice } = model;
    return notice.target === "all" ? (
      <SettingsScopeNotice target="all">{notice.message}</SettingsScopeNotice>
    ) : (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={notice.eligibleEnvironmentIds}
      >
        {notice.message}
      </SettingsScopeNotice>
    );
  }

  return (
    <SettingsPageContainer>
      {model.sections.map((section) => (
        <SettingsSection key={section.id} id={section.id} title={section.title}>
          {section.modeRow && (
            <SettingsRow
              title={section.modeRow.title}
              description={section.modeRow.description}
              serverScoped
              settingKeys={section.modeRow.settingKeys}
              mixed={section.modeRow.mixed}
              control={
                <Select
                  value={section.modeRow.value}
                  onValueChange={(mode) => dispatch({ kind: "select-worktree-mode", mode })}
                >
                  <SelectTrigger size="sm" aria-label={section.modeRow.ariaLabel}>
                    <SelectValue>{section.modeRow.valueLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {section.modeRow.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
          )}
          {section.rows.map((row) => (
            <SettingsRow
              key={row.id}
              title={row.title}
              status={row.status ?? undefined}
              description={row.description}
              serverScoped={row.serverScoped}
              control={
                row.control === "switch" ? (
                  <Switch
                    aria-label={row.ariaLabel}
                    checked={row.checked}
                    onCheckedChange={(checked) =>
                      dispatch({ kind: "toggle-rule", key: row.id, checked })
                    }
                  />
                ) : (
                  <RetentionControl
                    control={row.retention}
                    onChange={(days) => dispatch({ kind: "set-retention", key: row.id, days })}
                  />
                )
              }
            />
          ))}
        </SettingsSection>
      ))}
    </SettingsPageContainer>
  );
}
