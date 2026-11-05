import type {
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
  ServerSettings,
  SourceControlWritingStyleMode,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";

import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import type { ModelEsque } from "../chat/modelDisplayName";
import type { ScopedSettingsPatch } from "./scopedSettings";
import { searchableSetting } from "./settingsSearch";

export type SourceControlWritingStyle = ServerSettings["sourceControlWritingStyle"];

export type SourceControlWritingModeOption = {
  readonly value: SourceControlWritingStyleMode;
  readonly label: string;
  readonly description: string;
};

export type SourceControlInstructionsEditorModel =
  | { readonly kind: "none" }
  | { readonly kind: "bulk-closed"; readonly openLabel: string }
  | {
      readonly kind: "bulk-editing";
      readonly draft: string;
      readonly ariaLabel: string;
      readonly placeholder: string;
      readonly applyLabel: string;
      readonly applyDisabled: boolean;
    }
  | {
      readonly kind: "custom";
      readonly value: string;
      readonly ariaLabel: string;
      readonly placeholder: string;
    };

export type SourceControlWritingStyleRowModel = {
  readonly id: string;
  readonly title: string;
  readonly mixed: boolean;
  readonly description: string;
  readonly canReset: boolean;
  readonly resetLabel: string;
  readonly value: SourceControlWritingStyleMode | null;
  readonly valueLabel: string;
  readonly options: ReadonlyArray<SourceControlWritingModeOption>;
  readonly triggerAriaLabel: string;
  readonly editor: SourceControlInstructionsEditorModel;
};

export type SourceControlTemplatesRowModel = {
  readonly id: string;
  readonly title: string;
  readonly mixed: boolean;
  readonly description: string;
  readonly canReset: boolean;
  readonly resetLabel: string;
  readonly checked: boolean;
  readonly ariaLabel: string;
};

export type SourceControlWriterModelControlModel =
  | { readonly kind: "disconnected"; readonly message: string }
  | {
      readonly kind: "connected";
      readonly usesDedicatedModel: boolean;
      readonly unavailableMessage: string | null;
      readonly showPicker: boolean;
      readonly activeInstanceId: ProviderInstanceId;
      readonly model: string;
      readonly pickerAriaLabel: string;
      readonly pickerTriggerLabel: string | null;
      readonly canOpenProviderSetup: boolean;
      readonly switchChecked: boolean;
      readonly switchDisabled: boolean;
      readonly switchAriaLabel: string;
    };

export type SourceControlWriterModelRowModel = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly control: SourceControlWriterModelControlModel;
};

export type SourceControlWritingSettingsModel = {
  readonly sectionId: string;
  readonly title: string;
  readonly writingStyle: SourceControlWritingStyleRowModel;
  readonly templates: SourceControlTemplatesRowModel;
  readonly writerModel: SourceControlWriterModelRowModel;
};

export type SourceControlWriterModelState = {
  readonly defaultModelSelection: ModelSelection;
  readonly activeSelection: ModelSelection;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly usesDedicatedModel: boolean;
  readonly canEnableDedicatedModel: boolean;
};

export type SourceControlBulkInstructionsState = {
  readonly editing: boolean;
  readonly draft: string | null;
};

export type SourceControlWritingSettingsModelInput = {
  readonly settings: UnifiedSettings;
  readonly targetWritingStyles: ReadonlyArray<SourceControlWritingStyle>;
  readonly writerModelMixed: boolean;
  readonly hasServerTargets: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly writerModel: SourceControlWriterModelState;
  readonly bulkInstructions: SourceControlBulkInstructionsState;
};

export type SourceControlWritingModeChangeInput = {
  readonly value: string | null;
  readonly customInstructionsDraft: string | undefined;
};

export type SourceControlCustomInstructionsCommitInput = {
  readonly value: string;
  readonly current: string;
};

export type SourceControlWriterModelToggleInput = {
  readonly checked: boolean;
  readonly defaultModelSelection: ModelSelection;
};

export type SourceControlWriterModelChangeInput = {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly disabledReason: string | null;
};

export type SourceControlWriterModelChangeDecision =
  | {
      readonly kind: "reject";
      readonly toast: {
        readonly type: "error";
        readonly title: string;
        readonly description: string;
      };
    }
  | { readonly kind: "update"; readonly patch: ScopedSettingsPatch };

const MODE_OPTIONS_BY_MODE: Record<SourceControlWritingStyleMode, SourceControlWritingModeOption> =
  {
    repo_conventions: {
      value: "repo_conventions",
      label: "Repository conventions",
      description: "In each project, matches recent change descriptions and change request titles.",
    },
    conventional_commits: {
      value: "conventional_commits",
      label: "Conventional Commits",
      description: "Use Conventional Commit prefixes and keep change request text concise.",
    },
    custom: {
      value: "custom",
      label: "Custom instructions",
      description:
        "Use your instructions for change descriptions and change requests in every project.",
    },
  };

const MODE_OPTIONS: ReadonlyArray<SourceControlWritingModeOption> = [
  MODE_OPTIONS_BY_MODE.repo_conventions,
  MODE_OPTIONS_BY_MODE.conventional_commits,
  MODE_OPTIONS_BY_MODE.custom,
];

const WRITING_STYLE_DEFAULTS = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;

function writingStyleFieldMixed(
  styles: ReadonlyArray<SourceControlWritingStyle>,
  field: keyof SourceControlWritingStyle,
): boolean {
  const first = styles[0];
  return first !== undefined && styles.some((candidate) => candidate[field] !== first[field]);
}

export function resolveSourceControlWritingModeLabel(
  mode: SourceControlWritingStyleMode | null,
): string {
  return mode === null ? "Mixed" : MODE_OPTIONS_BY_MODE[mode].label;
}

export function deriveSourceControlWriterModelState(
  settings: UnifiedSettings,
  serverProviders: ReadonlyArray<ServerProvider>,
): SourceControlWriterModelState {
  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const defaultModelSelection = resolveAppModelSelectionState(settings, textGenerationProviders);
  const activeSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveSourceControlWriterModelSelection(
        settings,
        textGenerationProviders,
      ),
    },
    textGenerationProviders,
  );
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(textGenerationProviders), settings),
  );
  return {
    defaultModelSelection,
    activeSelection,
    instanceEntries,
    modelOptionsByInstance: getCustomModelOptionsByInstance(
      settings,
      textGenerationProviders,
      activeSelection.instanceId,
      activeSelection.model,
    ),
    usesDedicatedModel: settings.sourceControlWriterModelSelection !== null,
    canEnableDedicatedModel: instanceEntries.some(
      (entry) =>
        entry.instanceId === defaultModelSelection.instanceId && entry.enabled && entry.isAvailable,
    ),
  };
}

function buildInstructionsEditor(
  style: SourceControlWritingStyle,
  writingStyleMixed: boolean,
  bulkInstructions: SourceControlBulkInstructionsState,
): SourceControlInstructionsEditorModel {
  if (writingStyleMixed) {
    return bulkInstructions.editing
      ? {
          kind: "bulk-editing",
          draft: bulkInstructions.draft ?? "",
          ariaLabel: "Custom source control instructions for all selected environments",
          placeholder: "Write the instructions each selected environment should use.",
          applyLabel: "Apply instructions to all",
          applyDisabled: bulkInstructions.draft === null,
        }
      : { kind: "bulk-closed", openLabel: "Write custom instructions for all" };
  }
  if (style.mode === "custom") {
    return {
      kind: "custom",
      value: style.customInstructions,
      ariaLabel: "Custom source control writing instructions",
      placeholder: "Keep titles concise. Use short bullet points in descriptions.",
    };
  }
  return { kind: "none" };
}

function buildWriterModelControl(
  input: SourceControlWritingSettingsModelInput,
): SourceControlWriterModelControlModel {
  if (!input.hasServerTargets) {
    return {
      kind: "disconnected",
      message: "Connect an environment to choose its source control writer model.",
    };
  }
  const { usesDedicatedModel, canEnableDedicatedModel, activeSelection } = input.writerModel;
  return {
    kind: "connected",
    usesDedicatedModel,
    unavailableMessage:
      usesDedicatedModel && !canEnableDedicatedModel
        ? "No text generation providers available."
        : null,
    showPicker: usesDedicatedModel && canEnableDedicatedModel,
    activeInstanceId: activeSelection.instanceId,
    model: activeSelection.model,
    pickerAriaLabel: "Source control writer model",
    pickerTriggerLabel: input.writerModelMixed ? "Mixed" : null,
    canOpenProviderSetup: input.environmentId !== null,
    switchChecked: usesDedicatedModel,
    switchDisabled: !usesDedicatedModel && !canEnableDedicatedModel,
    switchAriaLabel: "Use a separate source control writer model",
  };
}

export function buildSourceControlWritingSettingsModel(
  input: SourceControlWritingSettingsModelInput,
): SourceControlWritingSettingsModel {
  const style = input.settings.sourceControlWritingStyle;
  const styles = input.targetWritingStyles;
  const modeMixed = writingStyleFieldMixed(styles, "mode");
  const instructionsMixed = writingStyleFieldMixed(styles, "customInstructions");
  const templatesMixed = writingStyleFieldMixed(styles, "followChangeRequestTemplates");
  const writingStyleMixed = modeMixed || instructionsMixed;
  const value = modeMixed ? null : style.mode;
  const writingStyleSetting = searchableSetting("source-control-writing-style");
  const templatesSetting = searchableSetting("follow-change-request-templates");
  const writerModelSetting = searchableSetting("source-control-writer-model");

  return {
    sectionId: "source-control-text-generation",
    title: "Text generation",
    writingStyle: {
      id: writingStyleSetting.id,
      title: writingStyleSetting.title,
      mixed: writingStyleMixed,
      description: MODE_OPTIONS_BY_MODE[style.mode].description,
      canReset:
        writingStyleMixed ||
        style.mode !== WRITING_STYLE_DEFAULTS.mode ||
        style.customInstructions !== WRITING_STYLE_DEFAULTS.customInstructions,
      resetLabel: "source control writing style",
      value,
      valueLabel: resolveSourceControlWritingModeLabel(value),
      options: MODE_OPTIONS,
      triggerAriaLabel: "Source control writing style",
      editor: buildInstructionsEditor(style, writingStyleMixed, input.bulkInstructions),
    },
    templates: {
      id: templatesSetting.id,
      title: templatesSetting.title,
      mixed: templatesMixed,
      description: "Use the repository's template for change request descriptions when available.",
      canReset:
        templatesMixed ||
        style.followChangeRequestTemplates !== WRITING_STYLE_DEFAULTS.followChangeRequestTemplates,
      resetLabel: "change request templates",
      checked: templatesMixed ? false : style.followChangeRequestTemplates,
      ariaLabel: "Follow change request templates",
    },
    writerModel: {
      id: writerModelSetting.id,
      title: writerModelSetting.title,
      description:
        "Model for source control text and branch or bookmark names. Off uses the environment's text generation model.",
      control: buildWriterModelControl(input),
    },
  };
}

export function resolveSourceControlWritingStyleReset(): ScopedSettingsPatch {
  return {
    sourceControlWritingStyle: {
      mode: WRITING_STYLE_DEFAULTS.mode,
      customInstructions: WRITING_STYLE_DEFAULTS.customInstructions,
    },
  };
}

export function resolveSourceControlWritingModeChange(
  input: SourceControlWritingModeChangeInput,
): ScopedSettingsPatch | null {
  const option = MODE_OPTIONS.find((candidate) => candidate.value === input.value);
  if (option === undefined) return null;
  const customInstructions = input.customInstructionsDraft?.trim();
  return {
    sourceControlWritingStyle: {
      mode: option.value,
      ...(customInstructions !== undefined ? { customInstructions } : {}),
    },
  };
}

export function resolveSourceControlCustomInstructionsCommit(
  input: SourceControlCustomInstructionsCommitInput,
): ScopedSettingsPatch | null {
  const customInstructions = input.value.trim();
  return customInstructions !== input.current
    ? { sourceControlWritingStyle: { customInstructions } }
    : null;
}

export function resolveSourceControlBulkInstructionsApply(
  draft: string | null,
): ScopedSettingsPatch | null {
  if (draft === null) return null;
  return {
    sourceControlWritingStyle: {
      mode: "custom",
      customInstructions: draft.trim(),
    },
  };
}

export function resolveFollowChangeRequestTemplatesChange(checked: boolean): ScopedSettingsPatch {
  return { sourceControlWritingStyle: { followChangeRequestTemplates: checked } };
}

export function resolveFollowChangeRequestTemplatesReset(): ScopedSettingsPatch {
  return {
    sourceControlWritingStyle: {
      followChangeRequestTemplates: WRITING_STYLE_DEFAULTS.followChangeRequestTemplates,
    },
  };
}

export function resolveSourceControlWriterModelToggle(
  input: SourceControlWriterModelToggleInput,
): ScopedSettingsPatch {
  const { defaultModelSelection } = input;
  return {
    sourceControlWriterModelSelection: input.checked
      ? createModelSelection(
          defaultModelSelection.instanceId,
          defaultModelSelection.model,
          defaultModelSelection.options,
        )
      : null,
  };
}

export function resolveSourceControlWriterModelChange(
  input: SourceControlWriterModelChangeInput,
): SourceControlWriterModelChangeDecision {
  if (input.disabledReason) {
    return {
      kind: "reject",
      toast: {
        type: "error",
        title: "Source control writer model not saved",
        description: input.disabledReason,
      },
    };
  }
  return {
    kind: "update",
    patch: {
      sourceControlWriterModelSelection: createModelSelection(input.instanceId, input.model),
    },
  };
}
