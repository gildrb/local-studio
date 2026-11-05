import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import { resolveSelectableModel } from "@t3tools/shared/model";
import {
  modelPickerJumpCommandForIndex,
  shortcutLabelForCommand,
  type ShortcutMatchContext,
} from "../../keybindings";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { getDisplayModelName, type ModelEsque } from "./modelDisplayName";
import {
  modelPickerLegacySectionKey,
  modelPickerModelKey,
  parseModelPickerLegacySectionKey,
  parseModelPickerModelKey,
} from "./modelPickerKeys";
import { buildModelPickerSearchText, scoreModelPickerSearch } from "./modelPickerSearch";
import { resolveModelPickerSelectedModel } from "./modelPickerTrigger.logic";
import { getProviderStatusMessage, hasProviderSetup } from "./ProviderStatusBanner.logic";

export type ModelPickerRailSelection = ProviderInstanceId | "favorites";

export type ModelPickerFavorites = ClientSettings["favorites"];

export interface ModelPickerModelSelection {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
}

export type ModelPickerDisabledReasonResolver = (
  instanceId: ProviderInstanceId,
  model: string,
) => string | null;

export interface ModelPickerContextInput {
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly canOpenProviderSetup: boolean;
  readonly favorites: ModelPickerFavorites;
}

export interface ModelPickerModelInput extends ModelPickerContextInput {
  readonly selectedModels: ReadonlyArray<ModelPickerModelSelection> | undefined;
  readonly multiSelect: boolean;
  readonly lockedContinuationGroupKey: string | null;
  readonly getModelDisabledReason: ModelPickerDisabledReasonResolver | undefined;
  readonly searchQuery: string;
  readonly railSelection: ModelPickerRailSelection;
  readonly expandedLegacyInstanceIds: ReadonlySet<ProviderInstanceId>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly shortcutPlatform: string;
  readonly terminalOpen: boolean;
}

export interface ModelPickerFavoritesRailItem {
  readonly kind: "favorites";
  readonly id: "favorites";
  readonly label: string;
  readonly active: boolean;
}

export interface ModelPickerInstanceRailItem {
  readonly kind: "instance";
  readonly id: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly initials: string;
  readonly accentColor: string | undefined;
  readonly showInstanceBadge: boolean;
  readonly active: boolean;
  readonly unavailable: boolean;
  readonly contextDisabled: boolean;
  readonly disabled: boolean;
  readonly needsSetup: boolean;
  readonly tooltip: string;
  readonly ariaLabel: string;
}

export type ModelPickerRailItem = ModelPickerFavoritesRailItem | ModelPickerInstanceRailItem;

export interface ModelPickerRailNavigation {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly disabledInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  readonly selectableUnavailableInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
}

export interface ModelPickerNewBadge {
  readonly label: string;
  readonly ariaLabel: string;
}

export interface ModelPickerModelRow {
  readonly kind: "model";
  readonly key: string;
  readonly instanceId: ProviderInstanceId;
  readonly slug: string;
  readonly driverKind: ProviderDriverKind;
  readonly label: string;
  readonly providerDisplayName: string;
  readonly providerLabel: string;
  readonly accentColor: string | undefined;
  readonly selected: boolean;
  readonly showSelection: boolean;
  readonly favorite: boolean;
  readonly favoriteActionLabel: string;
  readonly newBadge: ModelPickerNewBadge | null;
  readonly unavailableLabel: string | null;
  readonly jumpLabel: string | null;
  readonly disabledReason: string | null;
}

export interface ModelPickerLegacySectionRow {
  readonly kind: "legacy-section";
  readonly key: string;
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
  readonly countLabel: string;
  readonly expanded: boolean;
}

export type ModelPickerRow = ModelPickerModelRow | ModelPickerLegacySectionRow;

export interface ModelPickerSetupItem {
  readonly instanceId: ProviderInstanceId;
  readonly message: string;
  readonly actionLabel: string;
}

export interface ModelPickerModel {
  readonly railLabel: string;
  readonly showRail: boolean;
  readonly railSelection: ModelPickerRailSelection;
  readonly rail: ReadonlyArray<ModelPickerRailItem>;
  readonly railNavigation: ModelPickerRailNavigation;
  readonly searchPlaceholder: string;
  readonly isSearching: boolean;
  readonly multiSelect: boolean;
  readonly activeModelKey: string | null;
  readonly selectedModelKeys: ReadonlyArray<string>;
  readonly allItemKeys: ReadonlyArray<string>;
  readonly rowKeys: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ModelPickerRow>;
  readonly jumpModelKeys: ReadonlyArray<string>;
  readonly setupItems: ReadonlyArray<ModelPickerSetupItem>;
  readonly emptyStateText: string;
}

export type ModelPickerKeyAction =
  | { readonly kind: "toggle-legacy-section"; readonly instanceId: ProviderInstanceId }
  | {
      readonly kind: "select-model";
      readonly instanceId: ProviderInstanceId;
      readonly slug: string;
    };

export interface ModelPickerSelectionResult {
  readonly kind: "toggle" | "change";
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
}

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  badge?: "new";
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  continuationGroupKey?: string | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

type RankedModelPickerItem = {
  model: ModelPickerItem;
  score: number;
  isFavorite: boolean;
  tieBreaker: string;
};

export function shouldIncludeModelPickerOption(input: {
  readonly entry: ProviderInstanceEntry;
  readonly option: ModelEsque;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
}): boolean {
  if (input.entry.driverKind === "antigravity" && input.option.slug === ANTIGRAVITY_DEFAULT_MODEL) {
    return false;
  }
  if (isProviderInstancePickerReady(input.entry)) return true;
  return (
    input.entry.enabled &&
    (input.entry.driverKind === "opencode" || input.entry.driverKind === "antigravity") &&
    input.entry.instanceId === input.activeInstanceId &&
    input.option.slug === input.activeModel &&
    input.option.isUnavailable === true
  );
}

export function shouldOfferModelPickerSetup(
  entry: ProviderInstanceEntry,
  options: ReadonlyArray<ModelEsque>,
): boolean {
  return (
    entry.enabled &&
    entry.status !== "disabled" &&
    hasProviderSetup(entry.snapshot) &&
    (!isProviderInstancePickerReady(entry) ||
      !entry.installed ||
      entry.snapshot.auth.status === "unauthenticated" ||
      !options.some((option) => !option.isUnavailable))
  );
}

export function adjacentModelPickerProvider(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  selectedInstanceId: ModelPickerRailSelection;
  direction: 1 | -1;
  disabledInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  selectableUnavailableInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
}) {
  const providers: Array<ModelPickerRailSelection> = [
    "favorites",
    ...input.entries
      .filter(
        (entry) =>
          !input.disabledInstanceIds?.has(entry.instanceId) &&
          (isProviderInstancePickerReady(entry) ||
            input.selectableUnavailableInstanceIds?.has(entry.instanceId)),
      )
      .map((entry) => entry.instanceId),
  ];
  const index = providers.indexOf(input.selectedInstanceId);
  return providers[
    index < 0
      ? input.direction === 1
        ? 0
        : providers.length - 1
      : (index + input.direction + providers.length) % providers.length
  ]!;
}

function resolveModelPickerActiveState(input: ModelPickerContextInput) {
  const activeEntry = input.instanceEntries.find(
    (entry) => entry.instanceId === input.activeInstanceId,
  );
  const activeOptions = input.modelOptionsByInstance.get(input.activeInstanceId) ?? [];
  const activeModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: input.model,
    options: activeOptions,
  });
  const activeModelSlug =
    activeModel?.slug ?? (input.model === ANTIGRAVITY_DEFAULT_MODEL ? "" : input.model);
  const hasSelectableUnavailableModel =
    activeEntry !== undefined &&
    activeOptions.some((option) =>
      shouldIncludeModelPickerOption({
        entry: activeEntry,
        option,
        activeInstanceId: input.activeInstanceId,
        activeModel: activeModelSlug,
      }),
    ) &&
    !isProviderInstancePickerReady(activeEntry);
  const needsSetup =
    input.canOpenProviderSetup &&
    activeEntry !== undefined &&
    shouldOfferModelPickerSetup(activeEntry, activeOptions);
  return { activeModelSlug, hasSelectableUnavailableModel, needsSetup };
}

export function resolveInitialModelPickerRailSelection(
  input: ModelPickerContextInput,
): ModelPickerRailSelection {
  const active = resolveModelPickerActiveState(input);
  if (input.lockedProvider !== null || active.hasSelectableUnavailableModel || active.needsSetup) {
    return input.activeInstanceId;
  }
  return input.favorites.length > 0 ? "favorites" : input.activeInstanceId;
}

export function resolveInitialModelPickerExpandedLegacyInstanceIds(
  input: ModelPickerContextInput,
): ReadonlySet<ProviderInstanceId> {
  const { activeModelSlug } = resolveModelPickerActiveState(input);
  return new Set<ProviderInstanceId>(
    input.modelOptionsByInstance
      .get(input.activeInstanceId)
      ?.some((model) => model.slug === activeModelSlug && model.isLegacy)
      ? [input.activeInstanceId]
      : [],
  );
}

export function buildModelPickerShortcutContext(
  terminalOpen: boolean,
): Partial<ShortcutMatchContext> {
  return { terminalFocus: false, terminalOpen, modelPickerOpen: true };
}

function describeUnavailableInstance(entry: ProviderInstanceEntry): string {
  const label = entry.displayName;
  if (!entry.enabled || entry.status === "disabled") {
    return `${label} — Disabled in settings.`;
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const kind =
    entry.status === "error" ? "Unavailable" : entry.status === "warning" ? "Limited" : "Not ready";
  const msg = entry.snapshot.message?.trim();
  return msg ? `${label} — ${kind}. ${msg}` : `${label} — ${kind}.`;
}

function compareRankedModelPickerItems(a: RankedModelPickerItem, b: RankedModelPickerItem) {
  const scoreDelta = a.score - b.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (a.isFavorite !== b.isFavorite) {
    return a.isFavorite ? -1 : 1;
  }
  return a.tieBreaker.localeCompare(b.tieBreaker);
}

export function buildModelPickerModel(input: ModelPickerModelInput): ModelPickerModel {
  const active = resolveModelPickerActiveState(input);
  const activeModelSlug = active.activeModelSlug;
  const activeModelKey = activeModelSlug
    ? modelPickerModelKey(input.activeInstanceId, activeModelSlug)
    : null;
  const selectedModelKeyList = input.selectedModels?.map((selection) => {
    const entry = input.instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: input.modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return modelPickerModelKey(selection.instanceId, model?.slug ?? selection.model);
  });
  const selectedModelKeySet = new Set(
    selectedModelKeyList ?? (activeModelKey ? [activeModelKey] : []),
  );
  const favoritesSet = new Set(
    input.favorites.map((fav) => providerModelKey(fav.provider, fav.model)),
  );
  const entryByInstanceId = new Map(
    input.instanceEntries.map((entry) => [entry.instanceId, entry]),
  );
  const matchesLockedProvider = (
    entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">,
  ): boolean => {
    if (input.lockedProvider === null) return true;
    if (entry.driverKind !== input.lockedProvider) return false;
    if (!input.lockedContinuationGroupKey) return true;
    return entry.continuationGroupKey === input.lockedContinuationGroupKey;
  };

  const setupInstanceIds = new Set<ProviderInstanceId>();
  if (input.canOpenProviderSetup) {
    for (const entry of input.instanceEntries) {
      if (
        shouldOfferModelPickerSetup(entry, input.modelOptionsByInstance.get(entry.instanceId) ?? [])
      ) {
        setupInstanceIds.add(entry.instanceId);
      }
    }
  }
  const selectableUnavailable = new Set<ProviderInstanceId>();
  if (active.hasSelectableUnavailableModel) {
    selectableUnavailable.add(input.activeInstanceId);
  }
  for (const instanceId of setupInstanceIds) {
    selectableUnavailable.add(instanceId);
  }
  const selectableUnavailableInstanceIds =
    selectableUnavailable.size > 0 ? selectableUnavailable : undefined;

  const flatModels: ModelPickerItem[] = [];
  for (const [instanceId, models] of input.modelOptionsByInstance) {
    const entry = entryByInstanceId.get(instanceId);
    if (!entry) {
      continue;
    }
    for (const model of models) {
      if (
        !shouldIncludeModelPickerOption({
          entry,
          option: model,
          activeInstanceId: input.activeInstanceId,
          activeModel: activeModelSlug,
        })
      ) {
        continue;
      }
      flatModels.push({
        slug: model.slug,
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        ...(model.badge ? { badge: model.badge } : {}),
        ...(model.isLegacy ? { isLegacy: true } : {}),
        ...(model.isUnavailable ? { isUnavailable: true } : {}),
        instanceId,
        driverKind: entry.driverKind,
        instanceDisplayName: entry.displayName,
        ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
        ...(entry.continuationGroupKey ? { continuationGroupKey: entry.continuationGroupKey } : {}),
      });
    }
  }

  const isLocked = input.lockedProvider !== null;
  const isSearching = input.searchQuery.trim().length > 0;
  const railSelection = input.railSelection;
  let lockedDisabledInstanceIds: Set<ProviderInstanceId> | undefined;
  if (isLocked) {
    lockedDisabledInstanceIds = new Set<ProviderInstanceId>();
    for (const entry of input.instanceEntries) {
      if (!matchesLockedProvider(entry)) {
        lockedDisabledInstanceIds.add(entry.instanceId);
      }
    }
  }
  const visibleEntries = input.instanceEntries.filter(isProviderInstancePickerVisible);
  const railEntries = isLocked
    ? [
        ...visibleEntries.filter((entry) => matchesLockedProvider(entry)),
        ...visibleEntries.filter((entry) => !matchesLockedProvider(entry)),
      ]
    : visibleEntries;
  const showRail = !isSearching && railEntries.length > 0;
  const instanceOrder = input.instanceEntries.map((entry) => entry.instanceId);

  let filteredModels: ModelPickerItem[];
  if (isSearching) {
    const rankedMatches: RankedModelPickerItem[] = [];
    for (const model of flatModels) {
      const isFavorite = favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      const score = scoreModelPickerSearch(
        {
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          driverKind: model.driverKind,
          providerDisplayName: model.instanceDisplayName,
          isFavorite,
        },
        input.searchQuery,
      );
      if (score === null) {
        continue;
      }
      rankedMatches.push({
        model,
        score,
        isFavorite,
        tieBreaker: buildModelPickerSearchText({
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          driverKind: model.driverKind,
          providerDisplayName: model.instanceDisplayName,
        }),
      });
    }
    filteredModels = (
      isLocked
        ? rankedMatches.filter((rankedModel) => matchesLockedProvider(rankedModel.model))
        : rankedMatches
    )
      .toSorted(compareRankedModelPickerItems)
      .map((rankedModel) => rankedModel.model);
  } else {
    const lockedModels = isLocked ? flatModels.filter((m) => matchesLockedProvider(m)) : flatModels;
    filteredModels = sortProviderModelItems(
      railSelection === "favorites"
        ? lockedModels.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)))
        : lockedModels.filter((m) => m.instanceId === railSelection),
      {
        favoriteModelKeys: favoritesSet,
        groupFavorites: railSelection !== "favorites",
        instanceOrder: railSelection === "favorites" ? instanceOrder : [],
      },
    );
  }

  const legacyModels =
    isSearching || railSelection === "favorites"
      ? []
      : filteredModels.filter((model) => model.isLegacy);
  const legacySection =
    railSelection !== "favorites" && legacyModels.length > 0
      ? {
          key: modelPickerLegacySectionKey(railSelection),
          instanceId: railSelection,
          currentModels: filteredModels.filter((model) => !model.isLegacy),
          legacyModels,
          isExpanded: input.expandedLegacyInstanceIds.has(railSelection),
        }
      : null;
  const visibleModels = legacySection
    ? [
        ...legacySection.currentModels,
        ...(legacySection.isExpanded ? legacySection.legacyModels : []),
      ]
    : filteredModels;

  const selectedEntry =
    railSelection === "favorites" ? undefined : entryByInstanceId.get(railSelection);
  const setupEntries = isSearching
    ? []
    : input.instanceEntries.filter(
        (entry) =>
          setupInstanceIds.has(entry.instanceId) &&
          matchesLockedProvider(entry) &&
          (selectedEntry
            ? entry.instanceId === selectedEntry.instanceId
            : filteredModels.length === 0),
      );
  const setupItems = setupEntries.map((entry): ModelPickerSetupItem => ({
    instanceId: entry.instanceId,
    message: getProviderStatusMessage(entry.snapshot),
    actionLabel: setupEntries.length > 1 ? `Set up ${entry.displayName}` : "Open provider setup",
  }));

  const shortcutLabelOptions = {
    platform: input.shortcutPlatform,
    context: buildModelPickerShortcutContext(input.terminalOpen),
  };
  const jumpModelKeys: string[] = [];
  const jumpLabelByKey = new Map<string, string>();
  for (const model of visibleModels) {
    if (input.getModelDisabledReason?.(model.instanceId, model.slug)) {
      continue;
    }
    const jumpCommand = modelPickerJumpCommandForIndex(jumpModelKeys.length);
    if (!jumpCommand) {
      break;
    }
    const modelKey = modelPickerModelKey(model.instanceId, model.slug);
    jumpModelKeys.push(modelKey);
    const label = shortcutLabelForCommand(input.keybindings, jumpCommand, shortcutLabelOptions);
    if (label) {
      jumpLabelByKey.set(modelKey, label);
    }
  }

  const allItemKeys = [
    ...flatModels.map((model) => modelPickerModelKey(model.instanceId, model.slug)),
    ...new Set(
      flatModels
        .filter((model) => model.isLegacy)
        .map((model) => modelPickerLegacySectionKey(model.instanceId)),
    ),
  ];

  const modelRows = visibleModels.map((model): ModelPickerRow => {
    const key = modelPickerModelKey(model.instanceId, model.slug);
    const favorite = favoritesSet.has(providerModelKey(model.instanceId, model.slug));
    return {
      kind: "model",
      key,
      instanceId: model.instanceId,
      slug: model.slug,
      driverKind: model.driverKind,
      label: getDisplayModelName(model, isLocked ? undefined : { preferShortName: true }),
      providerDisplayName: model.instanceDisplayName,
      providerLabel: model.subProvider
        ? `${model.instanceDisplayName} · ${model.subProvider}`
        : model.instanceDisplayName,
      accentColor: model.instanceAccentColor,
      selected:
        selectedModelKeyList !== undefined ? selectedModelKeySet.has(key) : key === activeModelKey,
      showSelection: selectedModelKeyList !== undefined,
      favorite,
      favoriteActionLabel: favorite ? "Remove from favorites" : "Add to favorites",
      newBadge: model.badge === "new" ? { label: "New", ariaLabel: "New model" } : null,
      unavailableLabel: model.isUnavailable === true ? "Unavailable" : null,
      jumpLabel: jumpLabelByKey.get(key) ?? null,
      disabledReason: input.getModelDisabledReason?.(model.instanceId, model.slug) ?? null,
    };
  });
  const rows: ModelPickerRow[] = legacySection
    ? [
        ...modelRows.slice(0, legacySection.currentModels.length),
        {
          kind: "legacy-section",
          key: legacySection.key,
          instanceId: legacySection.instanceId,
          label: "Legacy models",
          countLabel: `${legacySection.legacyModels.length} models`,
          expanded: legacySection.isExpanded,
        },
        ...modelRows.slice(legacySection.currentModels.length),
      ]
    : modelRows;

  const instanceRailItems = railEntries.map((entry): ModelPickerInstanceRailItem => {
    const unavailable = !isProviderInstancePickerReady(entry);
    const contextDisabled = lockedDisabledInstanceIds?.has(entry.instanceId) ?? false;
    const reachable = selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
    const tooltip = unavailable
      ? describeUnavailableInstance(entry)
      : contextDisabled
        ? `${entry.displayName} is unavailable in this thread. Start a new thread to switch providers.`
        : entry.displayName;
    return {
      kind: "instance",
      id: entry.instanceId,
      driverKind: entry.driverKind,
      displayName: entry.displayName,
      initials: providerInstanceInitials(entry.displayName),
      accentColor: entry.accentColor,
      showInstanceBadge: shouldShowInstanceBadge(entry, railEntries),
      active: railSelection === entry.instanceId,
      unavailable,
      contextDisabled,
      disabled: (unavailable && !reachable) || contextDisabled,
      needsSetup: setupInstanceIds.has(entry.instanceId),
      tooltip,
      ariaLabel: unavailable || contextDisabled ? tooltip : entry.displayName,
    };
  });

  return {
    railLabel: "Providers",
    showRail,
    railSelection,
    rail: [
      {
        kind: "favorites",
        id: "favorites",
        label: "Favorites",
        active: railSelection === "favorites",
      },
      ...instanceRailItems,
    ],
    railNavigation: {
      entries: railEntries,
      disabledInstanceIds: lockedDisabledInstanceIds,
      selectableUnavailableInstanceIds,
    },
    searchPlaceholder: "Search models...",
    isSearching,
    multiSelect: input.multiSelect,
    activeModelKey,
    selectedModelKeys: [...selectedModelKeySet],
    allItemKeys,
    rowKeys: rows.map((row) => row.key),
    rows,
    jumpModelKeys,
    setupItems,
    emptyStateText: "No models found",
  };
}

export function resolveAdjacentModelPickerRailSelection(
  model: Pick<ModelPickerModel, "railNavigation" | "railSelection">,
  direction: 1 | -1,
): ModelPickerRailSelection {
  return adjacentModelPickerProvider({
    entries: model.railNavigation.entries,
    selectedInstanceId: model.railSelection,
    direction,
    disabledInstanceIds: model.railNavigation.disabledInstanceIds,
    selectableUnavailableInstanceIds: model.railNavigation.selectableUnavailableInstanceIds,
  });
}

export function resolveModelPickerJumpTarget(
  model: Pick<ModelPickerModel, "jumpModelKeys">,
  jumpIndex: number,
): { instanceId: ProviderInstanceId; slug: string } | null {
  const targetModelKey = model.jumpModelKeys[jumpIndex];
  if (!targetModelKey) {
    return null;
  }
  return parseModelPickerModelKey(targetModelKey);
}

export function resolveModelPickerKeyAction(key: string): ModelPickerKeyAction | null {
  const legacyInstanceId = parseModelPickerLegacySectionKey(key);
  if (legacyInstanceId) {
    return { kind: "toggle-legacy-section", instanceId: legacyInstanceId };
  }
  const model = parseModelPickerModelKey(key);
  return model ? { kind: "select-model", instanceId: model.instanceId, slug: model.slug } : null;
}

export function resolveModelPickerValueChangeKey(
  value: string | ReadonlyArray<string> | null,
  selectedModelKeys: ReadonlyArray<string>,
): string | null {
  if (value === null || typeof value === "string") {
    return value;
  }
  return (
    value.find((key) => !selectedModelKeys.includes(key)) ??
    selectedModelKeys.find((key) => !value.includes(key)) ??
    null
  );
}

export function resolveModelPickerSelection(input: {
  readonly instanceId: ProviderInstanceId;
  readonly slug: string;
  readonly additive: boolean;
  readonly multiSelect: boolean;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly getModelDisabledReason: ModelPickerDisabledReasonResolver | undefined;
}): ModelPickerSelectionResult | null {
  if (input.getModelDisabledReason?.(input.instanceId, input.slug)) {
    return null;
  }
  const options = input.modelOptionsByInstance.get(input.instanceId);
  if (!options) {
    return null;
  }
  const entry = input.instanceEntries.find((entry) => entry.instanceId === input.instanceId);
  if (!entry) {
    return null;
  }
  const resolvedModel = resolveSelectableModel(entry.driverKind, input.slug, options);
  if (!resolvedModel) {
    return null;
  }
  return {
    kind: input.additive && input.multiSelect ? "toggle" : "change",
    instanceId: input.instanceId,
    model: resolvedModel,
  };
}

export function toggleModelPickerFavorite(
  favorites: ModelPickerFavorites,
  instanceId: ProviderInstanceId,
  model: string,
): ModelPickerFavorites {
  const index = favorites.findIndex((f) => f.provider === instanceId && f.model === model);
  return index >= 0
    ? favorites.filter((_, favoriteIndex) => favoriteIndex !== index)
    : [...favorites, { provider: instanceId, model }];
}

export function toggleModelPickerLegacySection(
  expanded: ReadonlySet<ProviderInstanceId>,
  instanceId: ProviderInstanceId,
): ReadonlySet<ProviderInstanceId> {
  const next = new Set(expanded);
  if (next.has(instanceId)) {
    next.delete(instanceId);
  } else {
    next.add(instanceId);
  }
  return next;
}
