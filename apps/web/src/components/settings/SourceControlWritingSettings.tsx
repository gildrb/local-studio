import { useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import type { ProviderInstanceId, SourceControlWritingStyleMode } from "@t3tools/contracts";

import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Button } from "../ui/button";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import {
  buildSourceControlWritingSettingsModel,
  deriveSourceControlWriterModelState,
  resolveFollowChangeRequestTemplatesChange,
  resolveFollowChangeRequestTemplatesReset,
  resolveSourceControlBulkInstructionsApply,
  resolveSourceControlCustomInstructionsCommit,
  resolveSourceControlWriterModelChange,
  resolveSourceControlWriterModelToggle,
  resolveSourceControlWritingModeChange,
  resolveSourceControlWritingModeLabel,
  resolveSourceControlWritingStyleReset,
} from "./SourceControlWritingSettings.logic";

export function SourceControlWritingSettingsSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, targets } = useSettingsScope();
  // The representative supplies the provider list; a model choice is checked
  // against every target before it fans out.
  const environmentId = environment?.environmentId ?? null;
  const serverProviders = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const mixedWriterModel = useScopedSettingsMixed(["sourceControlWriterModelSelection"]);
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const [editingAllInstructions, setEditingAllInstructions] = useState(false);
  const [allInstructions, setAllInstructions] = useState<string | null>(null);
  const writerModelState = useMemo(
    () => deriveSourceControlWriterModelState(settings, serverProviders),
    [settings, serverProviders],
  );
  const writerModelDisabledReason = useScopedModelDisabledReason(
    settings,
    writerModelState.instanceEntries,
  );
  const model = buildSourceControlWritingSettingsModel({
    settings,
    // The writing style is one object; each control only cares about its own field.
    targetWritingStyles: targets.map((target) => target.settings.sourceControlWritingStyle),
    writerModelMixed: mixedWriterModel,
    hasServerTargets: connectedEnvironments.length > 0,
    environmentId,
    writerModel: writerModelState,
    bulkInstructions: { editing: editingAllInstructions, draft: allInstructions },
  });
  const { writingStyle, templates, writerModel } = model;
  const editor = writingStyle.editor;
  const writerControl = writerModel.control;

  return (
    <SettingsSection id={model.sectionId} title={model.title}>
      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        mixed={writingStyle.mixed}
        id={writingStyle.id}
        title={writingStyle.title}
        description={writingStyle.description}
        resetAction={
          writingStyle.canReset ? (
            <SettingResetButton
              label={writingStyle.resetLabel}
              onClick={() => updateSettings(resolveSourceControlWritingStyleReset())}
            />
          ) : null
        }
        control={
          <Select
            value={writingStyle.value}
            onValueChange={(value) => {
              const patch = resolveSourceControlWritingModeChange({
                value,
                customInstructionsDraft: customInstructionsRef.current?.value,
              });
              if (patch !== null) updateSettings(patch);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-56"
              aria-label={writingStyle.triggerAriaLabel}
            >
              <SelectValue>
                {(value: SourceControlWritingStyleMode | null) =>
                  resolveSourceControlWritingModeLabel(value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {writingStyle.options.map((option) => (
                <SelectItem key={option.value} hideIndicator value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {editor.kind === "bulk-editing" || editor.kind === "bulk-closed" ? (
          <div className="mt-3 max-w-2xl space-y-2 pb-3.5">
            {editor.kind === "bulk-editing" ? (
              <>
                <Textarea
                  value={editor.draft}
                  onChange={(event) => setAllInstructions(event.target.value)}
                  rows={4}
                  aria-label={editor.ariaLabel}
                  placeholder={editor.placeholder}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={editor.applyDisabled}
                  onClick={() => {
                    const patch = resolveSourceControlBulkInstructionsApply(allInstructions);
                    if (patch === null) return;
                    updateSettings(patch);
                    setEditingAllInstructions(false);
                  }}
                >
                  {editor.applyLabel}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAllInstructions(null);
                  setEditingAllInstructions(true);
                }}
              >
                {editor.openLabel}
              </Button>
            )}
          </div>
        ) : editor.kind === "custom" ? (
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={editor.value}
              ref={customInstructionsRef}
              defaultValue={editor.value}
              onBlur={(event) => {
                const patch = resolveSourceControlCustomInstructionsCommit({
                  value: event.target.value,
                  current: editor.value,
                });
                if (patch !== null) updateSettings(patch);
              }}
              rows={4}
              placeholder={editor.placeholder}
              aria-label={editor.ariaLabel}
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWritingStyle"]}
        mixed={templates.mixed}
        id={templates.id}
        title={templates.title}
        description={templates.description}
        resetAction={
          templates.canReset ? (
            <SettingResetButton
              label={templates.resetLabel}
              onClick={() => updateSettings(resolveFollowChangeRequestTemplatesReset())}
            />
          ) : null
        }
        control={
          <Switch
            mixed={templates.mixed}
            checked={templates.checked}
            onCheckedChange={(checked) =>
              updateSettings(resolveFollowChangeRequestTemplatesChange(Boolean(checked)))
            }
            aria-label={templates.ariaLabel}
          />
        }
      />

      <SettingsRow
        serverScoped
        settingKeys={["sourceControlWriterModelSelection"]}
        id={writerModel.id}
        title={writerModel.title}
        description={writerModel.description}
        control={
          writerControl.kind === "disconnected" ? (
            <span className="text-sm text-muted-foreground">{writerControl.message}</span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {writerControl.unavailableMessage !== null ? (
                <span className="text-sm text-muted-foreground">
                  {writerControl.unavailableMessage}
                </span>
              ) : null}
              {writerControl.showPicker ? (
                <ProviderModelPicker
                  activeInstanceId={writerControl.activeInstanceId}
                  model={writerControl.model}
                  lockedProvider={null}
                  instanceEntries={writerModelState.instanceEntries}
                  modelOptionsByInstance={writerModelState.modelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  triggerAriaLabel={writerControl.pickerAriaLabel}
                  {...(writerControl.pickerTriggerLabel !== null
                    ? { triggerLabel: writerControl.pickerTriggerLabel }
                    : {})}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  getModelDisabledReason={writerModelDisabledReason}
                  onInstanceModelChange={(instanceId, model) => {
                    const decision = resolveSourceControlWriterModelChange({
                      instanceId,
                      model,
                      disabledReason: writerModelDisabledReason(instanceId, model),
                    });
                    if (decision.kind === "reject") {
                      toastManager.add(decision.toast);
                      return;
                    }
                    updateSettings(decision.patch);
                  }}
                />
              ) : null}
              <Switch
                checked={writerControl.switchChecked}
                disabled={writerControl.switchDisabled}
                onCheckedChange={(checked) =>
                  updateSettings(
                    resolveSourceControlWriterModelToggle({
                      checked,
                      defaultModelSelection: writerModelState.defaultModelSelection,
                    }),
                  )
                }
                aria-label={writerControl.switchAriaLabel}
              />
            </div>
          )
        }
      />
    </SettingsSection>
  );
}
