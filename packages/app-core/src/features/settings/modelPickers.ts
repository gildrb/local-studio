import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  ServerProviderModel,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  buildModelPickerModel,
  resolveInitialModelPickerExpandedLegacyInstanceIds,
  resolveInitialModelPickerRailSelection,
  resolveModelPickerSelection,
  toggleModelPickerFavorite,
  toggleModelPickerLegacySection,
  type ModelPickerContextInput,
  type ModelPickerRailItem,
  type ModelPickerRailSelection,
  type ModelPickerRow,
  type ModelPickerSelectionResult,
  type ModelPickerSetupItem,
} from "@t3tools/web/src/components/chat/modelPicker.logic.ts";
import { resolveModelPickerTrigger } from "@t3tools/web/src/components/chat/modelPickerTrigger.logic.ts";
import {
  buildTraitsMenuModel,
  buildTraitsTriggerDisplay,
  getTraitsSectionVisibility,
  resolveTraitsSelection,
  type ProviderOptions,
  type TraitsMenuModel,
} from "@t3tools/web/src/components/chat/TraitsPicker.logic.ts";
import { shouldShowInstanceBadge } from "@t3tools/web/src/providerInstances.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

export type SettingsModelPickerTraitsSource = {
  readonly provider: ProviderDriverKind;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly model: string;
  readonly modelOptions: ProviderOptions | null | undefined;
  readonly planModeEnabled: boolean;
};

export type SettingsModelPickerSource = {
  readonly contextInput: ModelPickerContextInput;
  readonly triggerLabel: string | null;
  readonly disabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  readonly traits: SettingsModelPickerTraitsSource | null;
};

export type SettingsModelPickerTriggerView = {
  readonly label: string;
  readonly tooltip: string;
  readonly driverKind: ProviderDriverKind | null;
  readonly initials: string;
  readonly accentColor: string | null;
  readonly showInstanceBadge: boolean;
  readonly unavailable: boolean;
};

export type SettingsTraitsView = {
  readonly label: string;
  readonly speedIcon: "fast" | "ultrafast" | null;
  readonly menu: TraitsMenuModel;
};

export type SettingsModelPickerControlView = {
  readonly trigger: SettingsModelPickerTriggerView;
  readonly traits: SettingsTraitsView | null;
};

export type SettingsModelPickerPopupView = {
  readonly picker: string;
  readonly showRail: boolean;
  readonly rail: ReadonlyArray<ModelPickerRailItem>;
  readonly searchPlaceholder: string;
  readonly rows: ReadonlyArray<ModelPickerRow>;
  readonly emptyStateText: string;
  readonly setupItems: ReadonlyArray<ModelPickerSetupItem>;
};

export type PickerState = {
  readonly open: string | null;
  readonly searchQuery: string;
  readonly railSelection: ModelPickerRailSelection | null;
  readonly expandedLegacyInstanceIds: ReadonlySet<ProviderInstanceId>;
};

const CLOSED: PickerState = {
  open: null,
  searchQuery: "",
  railSelection: null,
  expandedLegacyInstanceIds: new Set(),
};

function traitsVisibility(source: SettingsModelPickerTraitsSource) {
  return getTraitsSectionVisibility({
    provider: source.provider,
    models: source.models,
    model: source.model,
    prompt: "",
    modelOptions: source.modelOptions,
    allowPromptInjectedEffort: false,
    planModeEnabled: source.planModeEnabled,
  });
}

export function settingsModelPickerControl(
  source: SettingsModelPickerSource,
): SettingsModelPickerControlView {
  const input = source.contextInput;
  const activeEntry =
    input.instanceEntries.find((entry) => entry.instanceId === input.activeInstanceId) ?? null;
  const trigger = resolveModelPickerTrigger({
    driverKind: activeEntry?.driverKind,
    model: input.model,
    options: input.modelOptionsByInstance.get(input.activeInstanceId) ?? [],
  });
  const labelled = source.triggerLabel !== null;
  let traits: SettingsTraitsView | null = null;
  if (source.traits !== null) {
    const visibility = traitsVisibility(source.traits);
    const menu = buildTraitsMenuModel(visibility);
    if (menu !== null) {
      const display = buildTraitsTriggerDisplay({
        provider: source.traits.provider,
        descriptors: visibility.descriptors,
        primarySelectDescriptorId: visibility.primarySelectDescriptor?.id ?? null,
        ultrathinkPromptControlled: visibility.ultrathinkPromptControlled,
      });
      traits = { label: display.label, speedIcon: display.speedIcon, menu };
    }
  }
  return {
    trigger: {
      label: source.triggerLabel ?? trigger.title,
      tooltip: source.triggerLabel ?? trigger.label,
      driverKind: !labelled && activeEntry !== null ? activeEntry.driverKind : null,
      initials: activeEntry === null ? "" : providerInstanceInitials(activeEntry.displayName),
      accentColor: activeEntry?.accentColor ?? null,
      showInstanceBadge:
        !labelled &&
        activeEntry !== null &&
        shouldShowInstanceBadge(activeEntry, input.instanceEntries),
      unavailable: !labelled && trigger.selectedModel?.isUnavailable === true,
    },
    traits,
  };
}

export function resolveSettingsTraitsSelection(
  source: SettingsModelPickerTraitsSource,
  descriptorId: string,
  value: string,
): { readonly next: ProviderOptions | undefined } | null {
  return resolveTraitsSelection({
    visibility: traitsVisibility(source),
    prompt: "",
    descriptorId,
    value,
  }).modelOptions;
}

export type SettingsModelPickers = {
  readonly stateAtom: Atom.Atom<PickerState>;
  readonly popup: (
    state: PickerState,
    picker: string,
    source: SettingsModelPickerSource,
    keybindings: ResolvedKeybindingsConfig,
  ) => SettingsModelPickerPopupView | null;
  readonly open: (picker: string, source: SettingsModelPickerSource) => void;
  readonly close: () => void;
  readonly openPicker: () => string | null;
  readonly setSearch: (searchQuery: string) => void;
  readonly setRail: (railSelection: ModelPickerRailSelection) => void;
  readonly toggleLegacy: (instanceId: ProviderInstanceId) => void;
  readonly resolveSelection: (
    source: SettingsModelPickerSource,
    instanceId: ProviderInstanceId,
    slug: string,
  ) => ModelPickerSelectionResult | null;
  readonly toggleFavorite: (instanceId: ProviderInstanceId, slug: string) => Promise<void>;
};

export function createSettingsModelPickers(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly platform: string;
  readonly updateClientSettings: (
    update: (current: ClientSettings) => ClientSettings,
  ) => Promise<void>;
}): SettingsModelPickers {
  const { registry } = options;
  const stateAtom = Atom.make<PickerState>(CLOSED).pipe(Atom.keepAlive);

  const popup = (
    state: PickerState,
    picker: string,
    source: SettingsModelPickerSource,
    keybindings: ResolvedKeybindingsConfig,
  ): SettingsModelPickerPopupView | null => {
    if (state.open !== picker) return null;
    const model = buildModelPickerModel({
      ...source.contextInput,
      selectedModels: undefined,
      multiSelect: false,
      lockedContinuationGroupKey: null,
      getModelDisabledReason: source.disabledReason,
      searchQuery: state.searchQuery,
      railSelection:
        state.railSelection ?? resolveInitialModelPickerRailSelection(source.contextInput),
      expandedLegacyInstanceIds: state.expandedLegacyInstanceIds,
      keybindings: mergeWithDefaultKeybindings(keybindings),
      shortcutPlatform: options.platform,
      terminalOpen: false,
    });
    return {
      picker,
      showRail: model.showRail,
      rail: model.rail,
      searchPlaceholder: model.searchPlaceholder,
      rows: model.rows,
      emptyStateText: model.emptyStateText,
      setupItems: model.setupItems,
    };
  };

  const update = (change: (state: PickerState) => PickerState) =>
    registry.set(stateAtom, change(registry.get(stateAtom)));

  return {
    stateAtom,
    popup,
    open: (picker: string, source: SettingsModelPickerSource) =>
      registry.set(stateAtom, {
        open: picker,
        searchQuery: "",
        railSelection: resolveInitialModelPickerRailSelection(source.contextInput),
        expandedLegacyInstanceIds: resolveInitialModelPickerExpandedLegacyInstanceIds(
          source.contextInput,
        ),
      }),
    close: () => registry.set(stateAtom, CLOSED),
    openPicker: () => registry.get(stateAtom).open,
    setSearch: (searchQuery: string) => update((state) => ({ ...state, searchQuery })),
    setRail: (railSelection: ModelPickerRailSelection) =>
      update((state) => ({ ...state, railSelection })),
    toggleLegacy: (instanceId: ProviderInstanceId) =>
      update((state) => ({
        ...state,
        expandedLegacyInstanceIds: toggleModelPickerLegacySection(
          state.expandedLegacyInstanceIds,
          instanceId,
        ),
      })),
    resolveSelection: (source, instanceId, slug) =>
      resolveModelPickerSelection({
        instanceId,
        slug,
        additive: false,
        multiSelect: false,
        instanceEntries: source.contextInput.instanceEntries,
        modelOptionsByInstance: source.contextInput.modelOptionsByInstance,
        getModelDisabledReason: source.disabledReason,
      }),
    toggleFavorite: (instanceId, slug) =>
      options.updateClientSettings((current) => ({
        ...current,
        favorites: toggleModelPickerFavorite(current.favorites, instanceId, slug),
      })),
  };
}
