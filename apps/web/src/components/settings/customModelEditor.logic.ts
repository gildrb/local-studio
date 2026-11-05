import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { type CustomModelDefinition, createModelCapabilities } from "@t3tools/shared/model";

/** Editable mirror of a `ProviderOptionChoice`. `key` is only a React key. */
export interface EditorChoice {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
  readonly description?: string;
}

/** Editable mirror of a `ProviderOptionDescriptor`. `key` is only a React key. */
export interface EditorDescriptor {
  readonly key: string;
  readonly type: "select" | "boolean";
  readonly id: string;
  readonly label: string;
  readonly choices: ReadonlyArray<EditorChoice>;
  readonly currentBooleanValue?: boolean | undefined;
  readonly description?: string | undefined;
}

export interface CustomModelDraft {
  readonly slug: string;
  readonly name: string;
  readonly descriptors: ReadonlyArray<EditorDescriptor>;
}

export interface DescriptorPreset {
  readonly id: string;
  readonly label: string;
  readonly type: "select" | "boolean";
  readonly choices?: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>;
}

const EFFORT_CHOICES = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium", isDefault: true },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
] as const;

/**
 * Option ids each adapter actually reads off a turn's model selection, with
 * the usual choices pre-filled. Anything else the user types is stored
 * verbatim but will be ignored by the driver.
 */
export const DESCRIPTOR_PRESETS_BY_KIND: Partial<
  Record<ProviderDriverKind, ReadonlyArray<DescriptorPreset>>
> = {
  [ProviderDriverKind.make("codex")]: [
    { id: "reasoningEffort", label: "Reasoning", type: "select", choices: EFFORT_CHOICES },
    {
      id: "serviceTier",
      label: "Speed",
      type: "select",
      choices: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "fast", label: "Fast" },
      ],
    },
  ],
  [ProviderDriverKind.make("claudeAgent")]: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      choices: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "xhigh", label: "Extra High" },
        { id: "max", label: "Max" },
      ],
    },
    { id: "fastMode", label: "Fast Mode", type: "boolean" },
    { id: "thinking", label: "Thinking", type: "boolean" },
  ],
  [ProviderDriverKind.make("cursor")]: [
    { id: "reasoning", label: "Reasoning", type: "select", choices: EFFORT_CHOICES },
    { id: "fastMode", label: "Fast Mode", type: "boolean" },
    { id: "thinking", label: "Thinking", type: "boolean" },
  ],
  [ProviderDriverKind.make("grok")]: [
    { id: "reasoningEffort", label: "Reasoning", type: "select", choices: EFFORT_CHOICES },
  ],
  [ProviderDriverKind.make("piAgent")]: [
    { id: "reasoningEffort", label: "Reasoning", type: "select", choices: EFFORT_CHOICES },
  ],
  [ProviderDriverKind.make("omp")]: [
    { id: "reasoningEffort", label: "Reasoning", type: "select", choices: EFFORT_CHOICES },
  ],
  [ProviderDriverKind.make("opencode")]: [
    { id: "variant", label: "Reasoning", type: "select", choices: EFFORT_CHOICES },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      choices: [
        { id: "build", label: "Build", isDefault: true },
        { id: "plan", label: "Plan" },
      ],
    },
  ],
};

let nextKey = 0;
function newEditorKey(): string {
  nextKey += 1;
  return `k${nextKey}`;
}

export function choiceFromPreset(choice: {
  id: string;
  label: string;
  isDefault?: boolean;
}): EditorChoice {
  return { key: newEditorKey(), id: choice.id, label: choice.label, isDefault: !!choice.isDefault };
}

export function descriptorFromPreset(preset: DescriptorPreset): EditorDescriptor {
  return {
    key: newEditorKey(),
    type: preset.type,
    id: preset.id,
    label: preset.label,
    choices: (preset.choices ?? []).map(choiceFromPreset),
  };
}

export function emptyEditorDescriptor(): EditorDescriptor {
  return { key: newEditorKey(), type: "select", id: "", label: "", choices: [] };
}

export function emptyEditorChoice(): EditorChoice {
  return { key: newEditorKey(), id: "", label: "", isDefault: false };
}

/**
 * Prompt-injected choices (Claude's `ultrathink`) are delivered as prompt text
 * by built-in runtime profiles a custom entry does not have, so they are
 * dropped rather than stored as a plain option value.
 */
function descriptorToEditor(descriptor: ProviderOptionDescriptor): EditorDescriptor {
  const promptInjected = new Set(
    descriptor.type === "select" ? (descriptor.promptInjectedValues ?? []) : [],
  );
  const choices =
    descriptor.type === "select"
      ? descriptor.options.filter((option) => !promptInjected.has(option.id))
      : [];
  const defaultChoice =
    choices.find((option) => option.id === descriptor.currentValue) ??
    choices.find((option) => option.isDefault);
  return {
    key: newEditorKey(),
    type: descriptor.type,
    id: descriptor.id,
    label: descriptor.label,
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
    ...(descriptor.type === "boolean" && descriptor.currentValue !== undefined
      ? { currentBooleanValue: descriptor.currentValue }
      : {}),
    choices: choices.map((option) => ({
      key: newEditorKey(),
      id: option.id,
      label: option.label,
      ...(option.description !== undefined ? { description: option.description } : {}),
      isDefault: option === defaultChoice,
    })),
  };
}

export function draftFromDefinition(entry: CustomModelDefinition): CustomModelDraft {
  return {
    slug: entry.slug,
    name: entry.name === entry.slug ? "" : entry.name,
    descriptors: (entry.capabilities?.optionDescriptors ?? []).map(descriptorToEditor),
  };
}

/** Claude context choices require runtime suffix mappings that custom entries do not carry. */
export function descriptorsFromCapabilities(
  capabilities: ModelCapabilities | null | undefined,
  driverKind: ProviderDriverKind | null,
): EditorDescriptor[] {
  return (capabilities?.optionDescriptors ?? [])
    .filter((descriptor) => driverKind !== "claudeAgent" || descriptor.id !== "contextWindow")
    .map(descriptorToEditor);
}

/**
 * Validate the draft before saving. Returns the first problem in reading
 * order so the message is actionable, or `null` when the draft is sound.
 */
export function validateDraft(draft: CustomModelDraft): string | null {
  const seenIds = new Set<string>();
  for (const [index, descriptor] of draft.descriptors.entries()) {
    const position = `Option ${index + 1}`;
    const id = descriptor.id.trim();
    if (!id) return `${position} needs an id.`;
    if (seenIds.has(id)) return `${position}: id "${id}" is used twice.`;
    seenIds.add(id);
    if (!descriptor.label.trim()) return `${position} needs a label.`;
    if (descriptor.type !== "select") continue;
    if (descriptor.choices.length === 0) return `${position} needs at least one choice.`;
    const seenChoices = new Set<string>();
    for (const choice of descriptor.choices) {
      const choiceId = choice.id.trim();
      if (!choiceId) return `${position} has a choice without a value.`;
      if (seenChoices.has(choiceId)) {
        return `${position}: choice "${choiceId}" is used twice.`;
      }
      seenChoices.add(choiceId);
    }
  }
  return null;
}

/** Convert a validated draft back into a definition. Blank name → slug. */
export function definitionFromDraft(draft: CustomModelDraft): CustomModelDefinition {
  const descriptors: ProviderOptionDescriptor[] = draft.descriptors.map((descriptor) => {
    const id = descriptor.id.trim();
    const label = descriptor.label.trim();
    if (descriptor.type === "boolean") {
      return {
        id,
        label,
        type: "boolean",
        ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
        ...(descriptor.currentBooleanValue !== undefined
          ? { currentValue: descriptor.currentBooleanValue }
          : {}),
      };
    }
    const options = descriptor.choices.map((choice) => ({
      id: choice.id.trim(),
      label: choice.label.trim() || choice.id.trim(),
      ...(choice.description !== undefined ? { description: choice.description } : {}),
      ...(choice.isDefault ? { isDefault: true } : {}),
    }));
    const currentValue = options.find((option) => option.isDefault)?.id;
    return {
      id,
      label,
      type: "select",
      ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
      options,
      ...(currentValue ? { currentValue } : {}),
    };
  });
  const name = draft.name.trim();
  return {
    slug: draft.slug,
    name: name || draft.slug,
    capabilities:
      descriptors.length > 0 ? createModelCapabilities({ optionDescriptors: descriptors }) : null,
  };
}

export const CUSTOM_ID_VALUE = "__custom__";
export const START_FROM_NONE = "__none__";

export type CustomModelEditorOption = {
  readonly value: string;
  readonly label: string;
};

export type CustomModelEditorChoiceRow = {
  readonly key: string;
  readonly value: string;
  readonly valuePlaceholder: string;
  readonly valueAriaLabel: string;
  readonly label: string;
  readonly labelPlaceholder: string;
  readonly labelAriaLabel: string;
  readonly isDefault: boolean;
  readonly defaultLabel: string;
  readonly defaultAriaLabel: string;
  readonly removeAriaLabel: string;
};

export type CustomModelEditorDescriptorRow = {
  readonly key: string;
  readonly positionLabel: string;
  readonly idSelect: {
    readonly visible: boolean;
    readonly value: string;
    readonly displayLabel: string;
    readonly ariaLabel: string;
    readonly presetOptions: ReadonlyArray<CustomModelEditorOption>;
    readonly customOption: CustomModelEditorOption;
  };
  readonly idInput: {
    readonly visible: boolean;
    readonly value: string;
    readonly placeholder: string;
    readonly ariaLabel: string;
  };
  readonly label: {
    readonly value: string;
    readonly placeholder: string;
    readonly ariaLabel: string;
  };
  readonly type: {
    readonly value: "select" | "boolean";
    readonly displayLabel: string;
    readonly ariaLabel: string;
    readonly options: ReadonlyArray<CustomModelEditorOption>;
  };
  readonly removeAriaLabel: string;
  readonly choices: ReadonlyArray<CustomModelEditorChoiceRow> | null;
  readonly addChoiceLabel: string;
};

export type CustomModelEditorModelInput = {
  readonly instanceId: string;
  readonly driverKind: ProviderDriverKind | null;
  readonly builtInModels: ReadonlyArray<ServerProviderModel>;
  readonly draft: CustomModelDraft;
  readonly error: string | null;
};

export type CustomModelEditorModel = {
  readonly name: {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly placeholder: string;
  };
  readonly optionsHeading: string;
  readonly copyFrom: {
    readonly value: string;
    readonly placeholder: string;
    readonly ariaLabel: string;
    readonly options: ReadonlyArray<CustomModelEditorOption>;
  } | null;
  readonly emptyMessage: string | null;
  readonly descriptors: ReadonlyArray<CustomModelEditorDescriptorRow>;
  readonly presetButtons: ReadonlyArray<CustomModelEditorOption>;
  readonly customOptionLabel: string;
  readonly error: string | null;
  readonly saveLabel: string;
  readonly cancelLabel: string;
};

export type CustomModelEditorIntent =
  | { readonly kind: "set-name"; readonly name: string }
  | { readonly kind: "set-descriptor-id"; readonly descriptorKey: string; readonly id: string }
  | {
      readonly kind: "set-descriptor-label";
      readonly descriptorKey: string;
      readonly label: string;
    }
  | {
      readonly kind: "set-descriptor-type";
      readonly descriptorKey: string;
      readonly value: string | null;
    }
  | {
      readonly kind: "select-descriptor-preset";
      readonly descriptorKey: string;
      readonly value: string | null;
    }
  | { readonly kind: "remove-descriptor"; readonly descriptorKey: string }
  | { readonly kind: "add-preset-descriptor"; readonly presetId: string }
  | { readonly kind: "add-custom-descriptor" }
  | {
      readonly kind: "set-choice-id";
      readonly descriptorKey: string;
      readonly choiceKey: string;
      readonly id: string;
    }
  | {
      readonly kind: "set-choice-label";
      readonly descriptorKey: string;
      readonly choiceKey: string;
      readonly label: string;
    }
  | {
      readonly kind: "set-choice-default";
      readonly descriptorKey: string;
      readonly choiceKey: string;
      readonly isDefault: boolean;
    }
  | { readonly kind: "add-choice"; readonly descriptorKey: string }
  | { readonly kind: "remove-choice"; readonly descriptorKey: string; readonly choiceKey: string }
  | { readonly kind: "copy-from-model"; readonly slug: string | null };

export type CustomModelEditorChangeInput = {
  readonly driverKind: ProviderDriverKind | null;
  readonly builtInModels: ReadonlyArray<ServerProviderModel>;
  readonly draft: CustomModelDraft;
};

export type CustomModelEditorChange =
  | { readonly kind: "none" }
  | { readonly kind: "update"; readonly draft: CustomModelDraft; readonly clearError: boolean };

export type CustomModelEditorSubmit =
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "save"; readonly definition: CustomModelDefinition };

function copyFromCandidates(
  builtInModels: ReadonlyArray<ServerProviderModel>,
): ServerProviderModel[] {
  return builtInModels.filter((model) => (model.capabilities?.optionDescriptors?.length ?? 0) > 0);
}

function presetsForKind(driverKind: ProviderDriverKind | null): ReadonlyArray<DescriptorPreset> {
  return driverKind ? (DESCRIPTOR_PRESETS_BY_KIND[driverKind] ?? []) : [];
}

export function buildCustomModelEditorModel(
  input: CustomModelEditorModelInput,
): CustomModelEditorModel {
  const presets = presetsForKind(input.driverKind);
  const candidates = copyFromCandidates(input.builtInModels);
  const presetOptions = presets.map((preset) => ({ value: preset.id, label: preset.label }));
  return {
    name: {
      id: `provider-instance-${input.instanceId}-custom-model-name`,
      label: "Display name",
      value: input.draft.name,
      placeholder: input.draft.slug,
    },
    optionsHeading: "Options shown in the composer",
    copyFrom:
      candidates.length > 0
        ? {
            value: START_FROM_NONE,
            placeholder: "Copy from…",
            ariaLabel: "Copy options from a built-in model",
            options: candidates.map((model) => ({ value: model.slug, label: model.name })),
          }
        : null,
    emptyMessage:
      input.draft.descriptors.length === 0
        ? "No custom options. The composer uses the provider's default options."
        : null,
    descriptors: input.draft.descriptors.map((descriptor, index) => {
      const idSelectValue = presets.some((preset) => preset.id === descriptor.id)
        ? descriptor.id
        : CUSTOM_ID_VALUE;
      return {
        key: descriptor.key,
        positionLabel: `Option ${index + 1}`,
        idSelect: {
          visible: presets.length > 0,
          value: idSelectValue,
          displayLabel: idSelectValue === CUSTOM_ID_VALUE ? "Custom…" : descriptor.id,
          ariaLabel: "Option id",
          presetOptions,
          customOption: { value: CUSTOM_ID_VALUE, label: "Custom…" },
        },
        idInput: {
          visible: idSelectValue === CUSTOM_ID_VALUE,
          value: descriptor.id,
          placeholder: "optionId",
          ariaLabel: "Option id",
        },
        label: { value: descriptor.label, placeholder: "Label", ariaLabel: "Option label" },
        type: {
          value: descriptor.type,
          displayLabel: descriptor.type === "boolean" ? "Toggle" : "Choices",
          ariaLabel: "Option type",
          options: [
            { value: "select", label: "Choices" },
            { value: "boolean", label: "Toggle" },
          ],
        },
        removeAriaLabel: `Remove option ${index + 1}`,
        choices:
          descriptor.type === "select"
            ? descriptor.choices.map((choice) => ({
                key: choice.key,
                value: choice.id,
                valuePlaceholder: "value",
                valueAriaLabel: "Choice value",
                label: choice.label,
                labelPlaceholder: "Label",
                labelAriaLabel: "Choice label",
                isDefault: choice.isDefault,
                defaultLabel: "Default",
                defaultAriaLabel: "Default choice",
                removeAriaLabel: "Remove choice",
              }))
            : null,
        addChoiceLabel: "Add choice",
      };
    }),
    presetButtons: presets
      .filter(
        (preset) => !input.draft.descriptors.some((descriptor) => descriptor.id === preset.id),
      )
      .map((preset) => ({ value: preset.id, label: preset.label })),
    customOptionLabel: "Custom option",
    error: input.error,
    saveLabel: "Save",
    cancelLabel: "Cancel",
  };
}

function patchDescriptor(
  draft: CustomModelDraft,
  key: string,
  patch: Partial<EditorDescriptor>,
): CustomModelDraft {
  return {
    ...draft,
    descriptors: draft.descriptors.map((descriptor) =>
      descriptor.key === key ? { ...descriptor, ...patch } : descriptor,
    ),
  };
}

function patchChoice(
  draft: CustomModelDraft,
  descriptorKey: string,
  choiceKey: string,
  patch: Partial<EditorChoice>,
): CustomModelDraft {
  return {
    ...draft,
    descriptors: draft.descriptors.map((descriptor) => {
      if (descriptor.key !== descriptorKey) return descriptor;
      return {
        ...descriptor,
        choices: descriptor.choices.map((choice) => {
          if (choice.key === choiceKey) return { ...choice, ...patch };
          return patch.isDefault ? { ...choice, isDefault: false } : choice;
        }),
      };
    }),
  };
}

export function resolveCustomModelEditorChange(
  input: CustomModelEditorChangeInput,
  intent: CustomModelEditorIntent,
): CustomModelEditorChange {
  const { draft } = input;
  const update = (next: CustomModelDraft): CustomModelEditorChange => ({
    kind: "update",
    draft: next,
    clearError: true,
  });
  switch (intent.kind) {
    case "set-name":
      return { kind: "update", draft: { ...draft, name: intent.name }, clearError: false };
    case "set-descriptor-id":
      return update(patchDescriptor(draft, intent.descriptorKey, { id: intent.id }));
    case "set-descriptor-label":
      return update(patchDescriptor(draft, intent.descriptorKey, { label: intent.label }));
    case "set-descriptor-type":
      return update(
        patchDescriptor(draft, intent.descriptorKey, {
          type: intent.value === "boolean" ? "boolean" : "select",
        }),
      );
    case "select-descriptor-preset": {
      if (intent.value === null) return { kind: "none" };
      if (intent.value === CUSTOM_ID_VALUE) {
        return update(patchDescriptor(draft, intent.descriptorKey, { id: "" }));
      }
      const preset = presetsForKind(input.driverKind).find(
        (candidate) => candidate.id === intent.value,
      );
      if (!preset) return { kind: "none" };
      return update(
        patchDescriptor(draft, intent.descriptorKey, {
          id: preset.id,
          label: preset.label,
          type: preset.type,
          choices: (preset.choices ?? []).map(choiceFromPreset),
          currentBooleanValue: undefined,
          description: undefined,
        }),
      );
    }
    case "remove-descriptor":
      return update({
        ...draft,
        descriptors: draft.descriptors.filter(
          (descriptor) => descriptor.key !== intent.descriptorKey,
        ),
      });
    case "add-preset-descriptor": {
      const preset = presetsForKind(input.driverKind).find(
        (candidate) => candidate.id === intent.presetId,
      );
      if (!preset) return { kind: "none" };
      return update({
        ...draft,
        descriptors: [...draft.descriptors, descriptorFromPreset(preset)],
      });
    }
    case "add-custom-descriptor":
      return update({ ...draft, descriptors: [...draft.descriptors, emptyEditorDescriptor()] });
    case "set-choice-id":
      return update(patchChoice(draft, intent.descriptorKey, intent.choiceKey, { id: intent.id }));
    case "set-choice-label":
      return update(
        patchChoice(draft, intent.descriptorKey, intent.choiceKey, { label: intent.label }),
      );
    case "set-choice-default":
      return update(
        patchChoice(draft, intent.descriptorKey, intent.choiceKey, {
          isDefault: intent.isDefault,
        }),
      );
    case "add-choice": {
      const descriptor = draft.descriptors.find(
        (candidate) => candidate.key === intent.descriptorKey,
      );
      if (!descriptor) return { kind: "none" };
      return update(
        patchDescriptor(draft, intent.descriptorKey, {
          choices: [...descriptor.choices, emptyEditorChoice()],
        }),
      );
    }
    case "remove-choice": {
      const descriptor = draft.descriptors.find(
        (candidate) => candidate.key === intent.descriptorKey,
      );
      if (!descriptor) return { kind: "none" };
      return update(
        patchDescriptor(draft, intent.descriptorKey, {
          choices: descriptor.choices.filter((choice) => choice.key !== intent.choiceKey),
        }),
      );
    }
    case "copy-from-model": {
      if (intent.slug === null || intent.slug === START_FROM_NONE) return { kind: "none" };
      const model = copyFromCandidates(input.builtInModels).find(
        (candidate) => candidate.slug === intent.slug,
      );
      if (!model) return { kind: "none" };
      return update({
        ...draft,
        descriptors: descriptorsFromCapabilities(model.capabilities, input.driverKind),
      });
    }
  }
}

export function resolveCustomModelEditorSubmit(draft: CustomModelDraft): CustomModelEditorSubmit {
  const problem = validateDraft(draft);
  if (problem) return { kind: "invalid", error: problem };
  return { kind: "save", definition: definitionFromDraft(draft) };
}
