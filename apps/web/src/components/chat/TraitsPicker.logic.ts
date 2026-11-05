import type {
  ModelCapabilities,
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
} from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../../providerModels";

export type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

export const ULTRATHINK_PROMPT_PREFIX = "Ultrathink:\n";

const SAVED_OPTION_LABELS: Readonly<Record<string, string>> = {
  agent: "Agent",
  effort: "Effort",
  reasoningEffort: "Reasoning effort",
  variant: "Reasoning",
};

function savedOptionLabel(id: string): string {
  return (
    SAVED_OPTION_LABELS[id] ??
    id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase())
  );
}

/** Read-only descriptors for saved values whose OpenCode model metadata is unavailable. */
export function buildUnavailableModelOptionDescriptors(
  selections: ProviderOptions | null | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return (selections ?? []).map((selection) =>
    typeof selection.value === "boolean"
      ? {
          id: selection.id,
          label: savedOptionLabel(selection.id),
          type: "boolean" as const,
          currentValue: selection.value,
        }
      : {
          id: selection.id,
          label: savedOptionLabel(selection.id),
          type: "select" as const,
          options: [{ id: selection.value, label: selection.value }],
          currentValue: selection.value,
        },
  );
}

export function replaceDescriptorCurrentValue(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  descriptorId: string,
  currentValue: string | boolean | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) =>
    descriptor.id !== descriptorId
      ? descriptor
      : descriptor.type === "boolean"
        ? {
            ...descriptor,
            ...(typeof currentValue === "boolean" ? { currentValue } : {}),
          }
        : {
            ...descriptor,
            ...(typeof currentValue === "string" ? { currentValue } : {}),
          },
  );
}

export function getDescriptorStringValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }> | null,
): string | null {
  if (!descriptor) {
    return null;
  }
  const value = getProviderOptionCurrentValue(descriptor);
  return typeof value === "string" ? value : null;
}

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

export interface SelectedTraits {
  readonly caps: ModelCapabilities;
  readonly descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly selectDescriptors: ReadonlyArray<SelectDescriptor>;
  readonly booleanDescriptors: ReadonlyArray<BooleanDescriptor>;
  readonly primarySelectDescriptor: SelectDescriptor | null;
  readonly contextWindowDescriptor: SelectDescriptor | null;
  readonly agentDescriptor: SelectDescriptor | null;
  readonly fastModeDescriptor: BooleanDescriptor | null;
  readonly thinkingDescriptor: BooleanDescriptor | null;
  readonly effort: string | null;
  readonly thinkingEnabled: boolean | null;
  readonly contextWindow: string | null;
  readonly ultrathinkPromptControlled: boolean;
  readonly ultrathinkInBodyText: boolean;
  readonly selectedAgent: string | null;
  readonly selectedAgentLabel: string | null | undefined;
  readonly modelIsUnavailable: boolean;
}

export interface TraitsSectionVisibility extends SelectedTraits {
  readonly showEffort: boolean;
  readonly showThinking: boolean;
  readonly showFastMode: boolean;
  readonly showContextWindow: boolean;
  readonly showAgent: boolean;
  readonly hasAnyControls: boolean;
}

export function getSelectedTraits(
  provider: ProviderDriverKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean,
  planModeEnabled: boolean,
): SelectedTraits {
  const caps = getProviderModelCapabilities(models, model, provider, planModeEnabled);
  const modelIsUnavailable =
    provider === "opencode" &&
    !models.some((candidate) => candidate.slug === normalizeModelSlug(model, provider));
  const descriptors = modelIsUnavailable
    ? buildUnavailableModelOptionDescriptors(
        planModeEnabled
          ? modelOptions
          : modelOptions?.filter((option) => option.id !== "agent" || option.value !== "plan"),
      )
    : getProviderOptionDescriptors({
        caps,
        selections: modelOptions,
      });
  const selectDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );
  const booleanDescriptors = descriptors.filter(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean",
  );
  const primarySelectDescriptor = selectDescriptors[0] ?? null;
  const contextWindowDescriptor =
    selectDescriptors.find((descriptor) => descriptor.id === "contextWindow") ?? null;
  const agentDescriptor = selectDescriptors.find((descriptor) => descriptor.id === "agent") ?? null;
  const fastModeDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const thinkingDescriptor =
    booleanDescriptors.find((descriptor) => descriptor.id === "thinking") ?? null;

  // Prompt-controlled effort (e.g. ultrathink in prompt text)
  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    (primarySelectDescriptor?.promptInjectedValues?.length ?? 0) > 0 &&
    isClaudeUltrathinkPrompt(prompt);

  // Check if "ultrathink" appears in the body text (not just our prefix)
  const ultrathinkInBodyText =
    ultrathinkPromptControlled && isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, ""));
  const effort =
    (ultrathinkPromptControlled
      ? "ultrathink"
      : getDescriptorStringValue(primarySelectDescriptor)) ?? null;
  const thinkingEnabled =
    typeof thinkingDescriptor?.currentValue === "boolean" ? thinkingDescriptor.currentValue : null;
  const contextWindow = getDescriptorStringValue(contextWindowDescriptor);
  const selectedAgent = getDescriptorStringValue(agentDescriptor);
  const selectedAgentLabel = agentDescriptor
    ? getProviderOptionCurrentLabel(agentDescriptor)
    : null;

  return {
    caps,
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    contextWindowDescriptor,
    agentDescriptor,
    fastModeDescriptor,
    thinkingDescriptor,
    effort,
    thinkingEnabled,
    contextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    selectedAgent,
    selectedAgentLabel,
    modelIsUnavailable,
  };
}

export function getTraitsSectionVisibility(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  planModeEnabled: boolean;
}): TraitsSectionVisibility {
  const selected = getSelectedTraits(
    input.provider,
    input.models,
    input.model,
    input.prompt,
    input.modelOptions,
    input.allowPromptInjectedEffort ?? true,
    input.planModeEnabled,
  );

  const showEffort = selected.primarySelectDescriptor !== null;
  const showThinking = selected.thinkingDescriptor !== null;
  const showFastMode = selected.fastModeDescriptor !== null;
  const showContextWindow = selected.contextWindowDescriptor !== null;
  const showAgent = selected.agentDescriptor !== null;

  return {
    ...selected,
    showEffort,
    showThinking,
    showFastMode,
    showContextWindow,
    showAgent,
    hasAnyControls:
      showEffort ||
      showThinking ||
      showFastMode ||
      showContextWindow ||
      showAgent ||
      (selected.modelIsUnavailable && selected.descriptors.length > 0),
  };
}

export function shouldRenderTraitsControls(input: {
  provider: ProviderDriverKind;
  models: ReadonlyArray<ServerProviderModel>;
  model: string | null | undefined;
  prompt: string;
  modelOptions: ProviderOptions | null | undefined;
  allowPromptInjectedEffort?: boolean;
  planModeEnabled: boolean;
}): boolean {
  return getTraitsSectionVisibility(input).hasAnyControls;
}

/**
 * Fast mode uses one bolt; Codex Ultrafast uses two. Keep a text label when
 * speed is the only trait so the trigger remains readable.
 */
export function buildTraitsTriggerDisplay(input: {
  provider: ProviderDriverKind;
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  primarySelectDescriptorId: string | null;
  ultrathinkPromptControlled: boolean;
}): { label: string; speedIcon: "fast" | "ultrafast" | null } {
  let fastModeFallbackLabel: string | null = null;
  let speedIcon: "fast" | "ultrafast" | null = null;
  const labels: Array<string> = [];
  for (const descriptor of input.descriptors) {
    if (descriptor.id === "fastMode" && descriptor.type === "boolean") {
      speedIcon = descriptor.currentValue === true ? "fast" : null;
      fastModeFallbackLabel = speedIcon ? "Fast" : "Normal";
      continue;
    }
    if (
      input.provider === "codex" &&
      descriptor.id === "serviceTier" &&
      descriptor.type === "select"
    ) {
      const currentValue = getProviderOptionCurrentValue(descriptor);
      const fastTier = descriptor.options.find(({ label }) => label === "Fast");
      const ultrafastTier = descriptor.options.find(({ label }) => label === "Ultrafast");
      if (
        ((fastTier || ultrafastTier) && currentValue === "default") ||
        (fastTier && currentValue === fastTier.id) ||
        (ultrafastTier && currentValue === ultrafastTier.id)
      ) {
        speedIcon =
          ultrafastTier && currentValue === ultrafastTier.id
            ? "ultrafast"
            : fastTier && currentValue === fastTier.id
              ? "fast"
              : null;
        fastModeFallbackLabel =
          descriptor.options.find(({ id }) => id === currentValue)?.label ?? "Normal";
        continue;
      }
    }
    const label =
      input.ultrathinkPromptControlled && descriptor.id === input.primarySelectDescriptorId
        ? "Ultrathink"
        : descriptor.type === "boolean"
          ? `${descriptor.label} ${descriptor.currentValue === true ? "On" : "Off"}`
          : getProviderOptionCurrentLabel(descriptor);
    if (typeof label === "string" && label.length > 0) {
      labels.push(label);
    }
  }

  // Only fall back to text when fast mode is genuinely the sole trait. Keying
  // off an empty label list alone would also catch descriptors that resolved to
  // no label at all, printing a bogus "Normal" for a model without fast mode.
  if (labels.length === 0 && fastModeFallbackLabel !== null) {
    return { label: fastModeFallbackLabel, speedIcon: null };
  }
  return { label: labels.join(" · "), speedIcon };
}

export type TraitsMenuModel =
  | {
      readonly kind: "unavailable";
      readonly items: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly value: string;
      }>;
    }
  | {
      readonly kind: "controls";
      readonly selects: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly notice: string | null;
        readonly selectedValue: string;
        readonly disabled: boolean;
        readonly options: ReadonlyArray<{
          readonly id: string;
          readonly label: string;
          readonly isDefault: boolean;
          readonly description: string | null;
        }>;
      }>;
      readonly booleans: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly selectedValue: "on" | "off";
        readonly options: ReadonlyArray<{ readonly id: "on" | "off"; readonly label: string }>;
      }>;
    };

export function buildTraitsMenuModel(visibility: TraitsSectionVisibility): TraitsMenuModel | null {
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    primarySelectDescriptor,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
    hasAnyControls,
    modelIsUnavailable,
  } = visibility;
  if (!hasAnyControls) {
    return null;
  }
  if (modelIsUnavailable) {
    return {
      kind: "unavailable",
      items: descriptors.flatMap((descriptor) => {
        const value = getProviderOptionCurrentLabel(descriptor);
        return value ? [{ id: descriptor.id, label: descriptor.label, value }] : [];
      }),
    };
  }
  return {
    kind: "controls",
    selects: selectDescriptors.map((descriptor) => {
      const isPrimary = descriptor.id === primarySelectDescriptor?.id;
      const locked = ultrathinkInBodyText && isPrimary;
      return {
        id: descriptor.id,
        label: descriptor.label,
        notice: locked
          ? 'Your prompt contains "ultrathink" in the text. Remove it to change this option.'
          : null,
        selectedValue:
          ultrathinkPromptControlled && isPrimary
            ? "ultrathink"
            : (getDescriptorStringValue(descriptor) ?? ""),
        disabled: locked,
        options: descriptor.options.map((option) => ({
          id: option.id,
          label: option.label,
          isDefault: option.isDefault === true,
          description: option.description ?? null,
        })),
      };
    }),
    booleans: booleanDescriptors.map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      selectedValue: descriptor.currentValue === true ? "on" : "off",
      options: [
        { id: "on", label: "On" },
        { id: "off", label: "Off" },
      ],
    })),
  };
}

export type TraitsSelectionResult = {
  readonly prompt: string | null;
  readonly modelOptions: { readonly next: ProviderOptions | undefined } | null;
};

export function resolveTraitsSelection(input: {
  readonly visibility: TraitsSectionVisibility;
  readonly prompt: string;
  readonly descriptorId: string;
  readonly value: string;
}): TraitsSelectionResult {
  const { descriptors, primarySelectDescriptor, ultrathinkPromptControlled, ultrathinkInBodyText } =
    input.visibility;
  const descriptor = descriptors.find((candidate) => candidate.id === input.descriptorId);
  if (descriptor === undefined) {
    return { prompt: null, modelOptions: null };
  }
  if (descriptor.type === "boolean") {
    return {
      prompt: null,
      modelOptions: {
        next: buildProviderOptionSelectionsFromDescriptors(
          replaceDescriptorCurrentValue(descriptors, descriptor.id, input.value === "on"),
        ),
      },
    };
  }
  const value = input.value;
  if (!value) {
    return { prompt: null, modelOptions: null };
  }
  if (descriptor.promptInjectedValues?.includes(value)) {
    return {
      prompt:
        input.prompt.trim().length === 0
          ? ULTRATHINK_PROMPT_PREFIX
          : applyClaudePromptEffortPrefix(input.prompt, "ultrathink"),
      modelOptions: null,
    };
  }
  const isPrimary = descriptor.id === primarySelectDescriptor?.id;
  if (ultrathinkInBodyText && isPrimary) {
    return { prompt: null, modelOptions: null };
  }
  return {
    prompt:
      ultrathinkPromptControlled && isPrimary ? input.prompt.replace(/^Ultrathink:\s*/i, "") : null,
    modelOptions: {
      next: buildProviderOptionSelectionsFromDescriptors(
        replaceDescriptorCurrentValue(descriptors, descriptor.id, value),
      ),
    },
  };
}
