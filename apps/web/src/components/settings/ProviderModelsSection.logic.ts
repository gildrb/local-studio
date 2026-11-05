import { ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";
import { type CustomModelDefinition, normalizeCustomModelSlug } from "@t3tools/shared/model";

import { sortModelsForProviderInstance } from "../../modelOrdering";
import { MAX_CUSTOM_MODEL_LENGTH } from "../../modelSelection";

export const CUSTOM_MODEL_PLACEHOLDER_BY_KIND: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("codex")]: "gpt-6.7-codex-ultra-preview",
  [ProviderDriverKind.make("claudeAgent")]: "claude-sonnet-5",
  [ProviderDriverKind.make("cursor")]: "claude-sonnet-4-6",
  [ProviderDriverKind.make("opencode")]: "openai/gpt-5",
};

export const PROVIDER_MODELS_FILTER_THRESHOLD = 8;

export type ProviderModelGroup = "favorite" | "visible" | "hidden";

export type ProviderModelsState = {
  readonly driverKind: ProviderDriverKind | null;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly customModels: ReadonlyArray<CustomModelDefinition>;
  readonly hiddenModels: ReadonlyArray<string>;
  readonly favoriteModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
};

export type ProviderModelsSectionModelInput = ProviderModelsState & {
  readonly instanceId: string;
  readonly filter: string;
  readonly isAdding: boolean;
  readonly error: string | null;
  readonly editingSlug: string | null;
};

export type ProviderModelFavoriteToggle = {
  readonly icon: "star";
  readonly active: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type ProviderModelRowAction = {
  readonly icon: "arrow-up" | "arrow-down" | "pencil" | "x";
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly disabled: boolean;
};

export type ProviderModelPickerSwitch = {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type ProviderModelRow = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly showSlug: boolean;
  readonly isCustom: boolean;
  readonly customBadge: string | null;
  readonly group: ProviderModelGroup;
  readonly groupLabel: string | null;
  readonly groupLabelIsFirst: boolean;
  readonly isFavorite: boolean;
  readonly isHidden: boolean;
  readonly capabilityLabels: ReadonlyArray<string>;
  readonly capabilitySummary: string | null;
  readonly favorite: ProviderModelFavoriteToggle;
  readonly moveUp: ProviderModelRowAction | null;
  readonly moveDown: ProviderModelRowAction | null;
  readonly edit: ProviderModelRowAction | null;
  readonly remove: ProviderModelRowAction | null;
  readonly pickerSwitch: ProviderModelPickerSwitch;
  readonly editingEntry: CustomModelDefinition | null;
};

export type ProviderModelsFilterModel = {
  readonly visible: boolean;
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly isFiltering: boolean;
};

export type ProviderModelsBulkToggleModel = {
  readonly allBuiltInModelsHidden: boolean;
  readonly label: string;
};

export type ProviderModelsAddCustomModel = {
  readonly available: boolean;
  readonly showAddButton: boolean;
  readonly addButtonLabel: string;
  readonly addButtonIcon: "plus";
  readonly showForm: boolean;
  readonly inputId: string;
  readonly placeholder: string | null;
  readonly submitLabel: string;
  readonly cancelLabel: string;
  readonly error: string | null;
};

export type ProviderModelsSectionModel = {
  readonly filter: ProviderModelsFilterModel;
  readonly bulkToggle: ProviderModelsBulkToggleModel | null;
  readonly modelCount: number;
  readonly favoriteCount: number;
  readonly hiddenCount: number;
  readonly summary: string;
  readonly addCustomModel: ProviderModelsAddCustomModel;
  readonly emptyMessage: string | null;
  readonly rows: ReadonlyArray<ProviderModelRow>;
};

export type ProviderModelsIntent =
  | { readonly kind: "set-hidden"; readonly slug: string; readonly hidden: boolean }
  | { readonly kind: "toggle-favorite"; readonly slug: string }
  | { readonly kind: "move"; readonly slug: string; readonly direction: -1 | 1 }
  | { readonly kind: "bulk-toggle-hidden" }
  | { readonly kind: "add-custom-model"; readonly input: string }
  | { readonly kind: "remove-custom-model"; readonly slug: string }
  | { readonly kind: "save-custom-model"; readonly definition: CustomModelDefinition };

export type ProviderModelsSettingsPatch = {
  readonly customModels?: ReadonlyArray<CustomModelDefinition>;
  readonly modelOrder?: ReadonlyArray<string>;
  readonly favoriteModels?: ReadonlyArray<string>;
  readonly hiddenModels?: ReadonlyArray<string>;
};

export type ProviderModelsDecision =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly error: string }
  | {
      readonly kind: "apply";
      readonly patch: ProviderModelsSettingsPatch;
      readonly addedSlug: string | null;
    };

export function describeModelCapabilities(model: ServerProviderModel): string[] {
  const descriptors = model.capabilities?.optionDescriptors ?? [];
  const labels: string[] = [];
  const hasFastMode = descriptors.some(
    (descriptor) =>
      descriptor.id === "fastMode" ||
      (descriptor.id === "serviceTier" &&
        descriptor.type === "select" &&
        descriptor.options.some((option) => option.id === "fast" || option.label === "Fast")),
  );
  if (hasFastMode) labels.push("Fast mode");
  if (descriptors.some((descriptor) => descriptor.id === "thinking")) labels.push("Thinking");
  if (
    descriptors.some(
      (descriptor) =>
        descriptor.type === "select" &&
        (descriptor.id === "reasoningEffort" ||
          descriptor.id === "effort" ||
          descriptor.id === "reasoning" ||
          descriptor.id === "variant"),
    )
  ) {
    labels.push("Reasoning");
  }
  return labels;
}

export function groupModelsForDisplay<
  T extends { readonly slug: string; readonly isCustom: boolean },
>(
  models: ReadonlyArray<T>,
  options: {
    readonly favoriteModels: ReadonlySet<string>;
    readonly hiddenModels: ReadonlySet<string>;
    readonly modelOrder: ReadonlyArray<string>;
  },
): T[] {
  const ordered = sortModelsForProviderInstance(models, {
    favoriteModels: options.favoriteModels,
    groupFavorites: true,
    modelOrder: options.modelOrder,
  });
  const isHidden = (model: T) => !model.isCustom && options.hiddenModels.has(model.slug);
  return [
    ...ordered.filter((model) => options.favoriteModels.has(model.slug)),
    ...ordered.filter((model) => !options.favoriteModels.has(model.slug) && !isHidden(model)),
    ...ordered.filter((model) => !options.favoriteModels.has(model.slug) && isHidden(model)),
  ];
}

export function nextHiddenModelsForBulkToggle(
  models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "isCustom">>,
  hiddenModels: ReadonlyArray<string>,
): string[] {
  const builtInSlugs = models.filter((model) => !model.isCustom).map((model) => model.slug);
  const builtInSlugSet = new Set(builtInSlugs);
  const allBuiltInModelsHidden = builtInSlugs.every((slug) => hiddenModels.includes(slug));

  if (allBuiltInModelsHidden) {
    return hiddenModels.filter((slug) => !builtInSlugSet.has(slug));
  }

  return [...new Set([...hiddenModels, ...builtInSlugs])];
}

function modelGroup(
  model: Pick<ServerProviderModel, "slug" | "isCustom">,
  favoriteModels: ReadonlySet<string>,
  hiddenModels: ReadonlySet<string>,
): ProviderModelGroup {
  if (favoriteModels.has(model.slug)) return "favorite";
  return !model.isCustom && hiddenModels.has(model.slug) ? "hidden" : "visible";
}

function rowGroupLabel(group: ProviderModelGroup, favoriteCount: number): string | null {
  if (group === "hidden") return "Hidden from picker";
  if (favoriteCount === 0) return null;
  return group === "favorite" ? "Favorites" : "All";
}

function pickerTooltip(isCustom: boolean, isHidden: boolean): string {
  if (isCustom) return "Custom models are always shown in the picker";
  return isHidden ? "Hidden from picker" : "Shown in picker";
}

export function buildProviderModelsSectionModel(
  input: ProviderModelsSectionModelInput,
): ProviderModelsSectionModel {
  const hiddenModelSet = new Set(input.hiddenModels);
  const favoriteModelSet = new Set(input.favoriteModels);
  const displayModels = groupModelsForDisplay(input.models, {
    favoriteModels: favoriteModelSet,
    hiddenModels: hiddenModelSet,
    modelOrder: input.modelOrder,
  });
  const groupOf = (model: ServerProviderModel) =>
    modelGroup(model, favoriteModelSet, hiddenModelSet);
  const favoriteCount = displayModels.filter((model) => favoriteModelSet.has(model.slug)).length;
  const hiddenCount = displayModels.filter(
    (model) => !model.isCustom && hiddenModelSet.has(model.slug),
  ).length;
  const builtInModels = input.models.filter((model) => !model.isCustom);
  const allBuiltInModelsHidden =
    builtInModels.length > 0 && builtInModels.every((model) => hiddenModelSet.has(model.slug));
  const showFilter = input.models.length > PROVIDER_MODELS_FILTER_THRESHOLD;
  const normalizedFilter = input.filter.trim().toLowerCase();
  const isFiltering = showFilter && normalizedFilter.length > 0;
  const visibleModels = isFiltering
    ? displayModels.filter(
        (model) =>
          model.name.toLowerCase().includes(normalizedFilter) ||
          model.slug.toLowerCase().includes(normalizedFilter),
      )
    : displayModels;
  const canAddCustomModels = input.driverKind !== "antigravity";

  const rows = visibleModels.map((model, visibleIndex): ProviderModelRow => {
    const group = groupOf(model);
    const isHidden = !model.isCustom && hiddenModelSet.has(model.slug);
    const isFavorite = group === "favorite";
    const index = displayModels.indexOf(model);
    const previousModel = displayModels[index - 1];
    const nextModel = displayModels[index + 1];
    const canMoveUp =
      !isFiltering && previousModel !== undefined && groupOf(previousModel) === group;
    const canMoveDown = !isFiltering && nextModel !== undefined && groupOf(nextModel) === group;
    const previousVisible = visibleModels[visibleIndex - 1];
    const startsGroup = previousVisible === undefined || groupOf(previousVisible) !== group;
    const showReorder = !isHidden && !isFiltering;
    const capabilityLabels = describeModelCapabilities(model);
    const editingEntry =
      model.isCustom && input.editingSlug === model.slug
        ? (input.customModels.find((entry) => entry.slug === model.slug) ?? null)
        : null;
    return {
      id: model.slug,
      slug: model.slug,
      name: model.name,
      showSlug: model.name !== model.slug,
      isCustom: model.isCustom,
      customBadge: model.isCustom ? "custom" : null,
      group,
      groupLabel: startsGroup ? rowGroupLabel(group, favoriteCount) : null,
      groupLabelIsFirst: visibleIndex === 0,
      isFavorite,
      isHidden,
      capabilityLabels,
      capabilitySummary: capabilityLabels.length > 0 ? capabilityLabels.join(" · ") : null,
      favorite: {
        icon: "star",
        active: isFavorite,
        ariaLabel: `${isFavorite ? "Remove" : "Add"} ${model.name} ${
          isFavorite ? "from" : "to"
        } favorites`,
        tooltip: isFavorite ? "Remove from favorites" : "Add to favorites",
      },
      moveUp: showReorder
        ? {
            icon: "arrow-up",
            ariaLabel: `Move ${model.name} up`,
            tooltip: "Move up",
            disabled: !canMoveUp,
          }
        : null,
      moveDown: showReorder
        ? {
            icon: "arrow-down",
            ariaLabel: `Move ${model.name} down`,
            tooltip: "Move down",
            disabled: !canMoveDown,
          }
        : null,
      edit: model.isCustom
        ? {
            icon: "pencil",
            ariaLabel: `Edit ${model.slug}`,
            tooltip: "Edit name and options",
            disabled: false,
          }
        : null,
      remove: model.isCustom
        ? {
            icon: "x",
            ariaLabel: `Remove ${model.slug}`,
            tooltip: "Remove custom model",
            disabled: false,
          }
        : null,
      pickerSwitch: {
        checked: !isHidden,
        disabled: model.isCustom,
        ariaLabel: `Show ${model.name} in the model picker`,
        tooltip: pickerTooltip(model.isCustom, isHidden),
      },
      editingEntry,
    };
  });

  return {
    filter: {
      visible: showFilter,
      value: input.filter,
      placeholder: "Filter models",
      ariaLabel: "Filter models",
      isFiltering,
    },
    bulkToggle:
      builtInModels.length > 0
        ? { allBuiltInModelsHidden, label: allBuiltInModelsHidden ? "Enable all" : "Disable all" }
        : null,
    modelCount: input.models.length,
    favoriteCount,
    hiddenCount,
    summary: `${input.models.length} model${input.models.length === 1 ? "" : "s"}${
      favoriteCount > 0 ? ` · ${favoriteCount} favorite${favoriteCount === 1 ? "" : "s"}` : ""
    }${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}`,
    addCustomModel: {
      available: canAddCustomModels,
      showAddButton: canAddCustomModels && !input.isAdding,
      addButtonLabel: "Add custom model",
      addButtonIcon: "plus",
      showForm: canAddCustomModels && input.isAdding,
      inputId: `provider-instance-${input.instanceId}-custom-model`,
      placeholder: input.driverKind
        ? (CUSTOM_MODEL_PLACEHOLDER_BY_KIND[input.driverKind] ?? null)
        : "model-slug",
      submitLabel: "Add",
      cancelLabel: "Cancel",
      error: canAddCustomModels ? input.error : null,
    },
    emptyMessage:
      visibleModels.length === 0
        ? isFiltering
          ? "No models match."
          : "No models reported for this provider yet."
        : null,
    rows,
  };
}

function resolveAddCustomModel(state: ProviderModelsState, input: string): ProviderModelsDecision {
  if (state.driverKind === "antigravity") return { kind: "none" };
  const normalized = normalizeCustomModelSlug(input);
  if (!normalized) return { kind: "invalid", error: "Enter a model slug." };
  if (state.models.some((model) => !model.isCustom && model.slug === normalized)) {
    return { kind: "invalid", error: "That model is already built in." };
  }
  if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
    return {
      kind: "invalid",
      error: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
    };
  }
  if (state.customModels.some((entry) => entry.slug === normalized)) {
    return { kind: "invalid", error: "That custom model is already saved." };
  }
  return {
    kind: "apply",
    patch: {
      customModels: [
        ...state.customModels,
        { slug: normalized, name: normalized, capabilities: null },
      ],
    },
    addedSlug: normalized,
  };
}

function resolveMove(
  state: ProviderModelsState,
  slug: string,
  direction: -1 | 1,
): ProviderModelsDecision {
  const favoriteModelSet = new Set(state.favoriteModels);
  const hiddenModelSet = new Set(state.hiddenModels);
  const displayModels = groupModelsForDisplay(state.models, {
    favoriteModels: favoriteModelSet,
    hiddenModels: hiddenModelSet,
    modelOrder: state.modelOrder,
  });
  const index = displayModels.findIndex((model) => model.slug === slug);
  const current = displayModels[index];
  const neighbour = displayModels[index + direction];
  if (index < 0 || current === undefined || neighbour === undefined) return { kind: "none" };
  if (
    modelGroup(current, favoriteModelSet, hiddenModelSet) !==
    modelGroup(neighbour, favoriteModelSet, hiddenModelSet)
  ) {
    return { kind: "none" };
  }
  const next = displayModels.map((model) => model.slug);
  next[index] = neighbour.slug;
  next[index + direction] = current.slug;
  return { kind: "apply", patch: { modelOrder: next }, addedSlug: null };
}

export function resolveProviderModelsChange(
  state: ProviderModelsState,
  intent: ProviderModelsIntent,
): ProviderModelsDecision {
  switch (intent.kind) {
    case "set-hidden": {
      if (intent.hidden === state.hiddenModels.includes(intent.slug)) return { kind: "none" };
      return {
        kind: "apply",
        patch: {
          hiddenModels: intent.hidden
            ? [...state.hiddenModels, intent.slug]
            : state.hiddenModels.filter((model) => model !== intent.slug),
        },
        addedSlug: null,
      };
    }
    case "toggle-favorite":
      return {
        kind: "apply",
        patch: {
          favoriteModels: state.favoriteModels.includes(intent.slug)
            ? state.favoriteModels.filter((model) => model !== intent.slug)
            : [...state.favoriteModels, intent.slug],
        },
        addedSlug: null,
      };
    case "move":
      return resolveMove(state, intent.slug, intent.direction);
    case "bulk-toggle-hidden":
      return {
        kind: "apply",
        patch: { hiddenModels: nextHiddenModelsForBulkToggle(state.models, state.hiddenModels) },
        addedSlug: null,
      };
    case "add-custom-model":
      return resolveAddCustomModel(state, intent.input);
    case "remove-custom-model":
      return {
        kind: "apply",
        patch: {
          customModels: state.customModels.filter((entry) => entry.slug !== intent.slug),
          modelOrder: state.modelOrder.filter((model) => model !== intent.slug),
          favoriteModels: state.favoriteModels.filter((model) => model !== intent.slug),
        },
        addedSlug: null,
      };
    case "save-custom-model":
      return {
        kind: "apply",
        patch: {
          customModels: state.customModels.map((entry) =>
            entry.slug === intent.definition.slug ? intent.definition : entry,
          ),
        },
        addedSlug: null,
      };
  }
}
