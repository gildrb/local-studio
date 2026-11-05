import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
  type ModelEsque,
} from "./modelDisplayName";

export function resolveModelPickerSelectedModel(input: {
  driverKind: ProviderDriverKind | undefined;
  model: string;
  options: ReadonlyArray<ModelEsque>;
}) {
  if (input.driverKind === "antigravity" && input.model === ANTIGRAVITY_DEFAULT_MODEL) {
    const availableModels = input.options.filter(
      (option) => option.slug !== ANTIGRAVITY_DEFAULT_MODEL && !option.isUnavailable,
    );
    return (
      availableModels.find((option) => option.aliases?.includes(ANTIGRAVITY_DEFAULT_MODEL)) ??
      availableModels.find((option) => option.isDefault)
    );
  }
  return input.options.find((option) => option.slug === input.model);
}

export function resolveModelPickerTrigger(input: {
  driverKind: ProviderDriverKind | undefined;
  model: string;
  options: ReadonlyArray<ModelEsque>;
}): { selectedModel: ModelEsque | undefined; title: string; label: string } {
  // Account-specific catalogs must keep the selected model label while unavailable.
  const selectedModel =
    resolveModelPickerSelectedModel(input) ??
    (input.driverKind === "opencode" || input.driverKind === "antigravity"
      ? undefined
      : input.options[0]);
  const title = selectedModel
    ? getTriggerDisplayModelName(selectedModel)
    : input.model === ANTIGRAVITY_DEFAULT_MODEL
      ? "Choose model"
      : input.model || "Choose model";
  const label = selectedModel
    ? `${getTriggerDisplayModelLabel(selectedModel)}${selectedModel.isUnavailable ? " (Unavailable)" : ""}`
    : title;
  return { selectedModel, title, label };
}

export interface ModelPickerSelectionsTriggerEntry {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly entry: ProviderInstanceEntry | undefined;
  readonly label: string;
}

export function resolveModelPickerSelectionsTrigger(input: {
  selectedModels: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
}): {
  entries: ReadonlyArray<ModelPickerSelectionsTriggerEntry>;
  label: string;
  title: string;
} {
  const entries = input.selectedModels.map((selection): ModelPickerSelectionsTriggerEntry => {
    const entry = input.instanceEntries.find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: input.modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return {
      instanceId: selection.instanceId,
      model: selection.model,
      entry,
      label: model
        ? `${getTriggerDisplayModelName(model)}${model.isUnavailable ? " (Unavailable)" : ""}`
        : selection.model,
    };
  });
  const label =
    entries.length === 0
      ? "Choose models"
      : `${entries
          .slice(0, 2)
          .map((selection) => selection.label)
          .join(", ")}${entries.length > 2 ? `, ${entries.length - 2} more` : ""}`;
  const title = entries.map((selection) => selection.label).join(", ") || "Choose models";
  return { entries, label, title };
}

export function formatModelPickerTriggerTooltip(label: string, shortcutLabel: string | null) {
  return shortcutLabel ? `${label} · ${shortcutLabel}` : label;
}
