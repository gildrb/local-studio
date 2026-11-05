import type {
  ProviderInstanceId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  resolveModelDisabledReason,
  resolveProviderModelSelection,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  buildModelPickerModel,
  resolveInitialModelPickerExpandedLegacyInstanceIds,
  resolveInitialModelPickerRailSelection,
  resolveModelPickerSelection,
  toggleModelPickerFavorite,
  toggleModelPickerLegacySection,
  type ModelPickerContextInput,
  type ModelPickerModel,
  type ModelPickerRailSelection,
} from "@t3tools/web/src/components/chat/modelPicker.logic.ts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import type { Thread } from "@t3tools/web/src/types.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  deriveComposerModelContext,
  type ComposerModelContext,
  type ComposerModelInput,
} from "./composerView.ts";

export type ModelPickerState = {
  readonly open: boolean;
  readonly searchQuery: string;
  readonly railSelection: ModelPickerRailSelection | null;
  readonly expandedLegacyInstanceIds: ReadonlySet<ProviderInstanceId>;
};

const CLOSED: ModelPickerState = {
  open: false,
  searchQuery: "",
  railSelection: null,
  expandedLegacyInstanceIds: new Set(),
};

type PickerInput = ComposerModelInput & {
  readonly route: ScopedThreadRef;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly shortcutPlatform: string;
};

function pickerContext(input: PickerInput): {
  readonly context: ComposerModelContext;
  readonly contextInput: ModelPickerContextInput;
  readonly disabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
} | null {
  const context = deriveComposerModelContext(input);
  if (context.selection === null) return null;
  const disabledReason = (instanceId: ProviderInstanceId, model: string) =>
    resolveModelDisabledReason({
      thread: input.thread,
      providers: context.providers,
      instanceId,
      model,
    });
  return {
    context,
    disabledReason,
    contextInput: {
      activeInstanceId: context.selection.instanceId,
      model: context.selection.modelForPicker,
      instanceEntries: context.entries,
      modelOptionsByInstance: context.modelOptionsByInstance,
      lockedProvider: context.lockedProvider,
      canOpenProviderSetup: false,
      favorites: input.clientSettings.favorites,
    },
  };
}

export function createModelPicker(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly updateClientSettings: (
    update: (current: ClientSettings) => ClientSettings,
  ) => Promise<void>;
  readonly warn: (title: string, description: string) => void;
}) {
  const { registry } = options;
  const stateAtom = Atom.make<ModelPickerState>(CLOSED).pipe(Atom.keepAlive);

  const buildView = (
    state: ModelPickerState,
    input: PickerInput | null,
  ): ModelPickerModel | null => {
    if (!state.open || input === null) return null;
    const picker = pickerContext(input);
    if (picker === null) return null;
    return buildModelPickerModel({
      ...picker.contextInput,
      selectedModels: undefined,
      multiSelect: false,
      lockedContinuationGroupKey: picker.context.lockedContinuationGroupKey,
      getModelDisabledReason: picker.disabledReason,
      searchQuery: state.searchQuery,
      railSelection:
        state.railSelection ?? resolveInitialModelPickerRailSelection(picker.contextInput),
      expandedLegacyInstanceIds: state.expandedLegacyInstanceIds,
      keybindings: mergeWithDefaultKeybindings(input.keybindings),
      shortcutPlatform: input.shortcutPlatform,
      terminalOpen: false,
    });
  };

  const update = (change: (state: ModelPickerState) => ModelPickerState) =>
    registry.set(stateAtom, change(registry.get(stateAtom)));

  const open = (input: PickerInput) => {
    const picker = pickerContext(input);
    if (picker === null) return;
    registry.set(stateAtom, {
      open: true,
      searchQuery: "",
      railSelection: resolveInitialModelPickerRailSelection(picker.contextInput),
      expandedLegacyInstanceIds: resolveInitialModelPickerExpandedLegacyInstanceIds(
        picker.contextInput,
      ),
    });
  };

  const close = () => registry.set(stateAtom, CLOSED);

  const select = (input: PickerInput, instanceId: ProviderInstanceId, slug: string) => {
    const picker = pickerContext(input);
    if (picker === null) return;
    const selection = resolveModelPickerSelection({
      instanceId,
      slug,
      additive: false,
      multiSelect: false,
      instanceEntries: picker.contextInput.instanceEntries,
      modelOptionsByInstance: picker.contextInput.modelOptionsByInstance,
      getModelDisabledReason: picker.disabledReason,
    });
    if (selection === null) return;
    const thread: Thread = input.thread;
    const result = resolveProviderModelSelection({
      thread,
      providers: picker.context.providers,
      lockedProvider: picker.context.lockedProvider,
      settings: picker.context.settings,
      instanceId: selection.instanceId,
      model: selection.model,
    });
    if (result.kind === "blocked") {
      options.warn(result.title, result.description);
    }
    if (result.kind === "select") {
      const store = useComposerDraftStore.getState();
      store.setModelSelection(input.route, result.modelSelection, { explicit: true });
      store.setStickyModelSelection(result.modelSelection);
    }
    close();
  };

  const toggleFavorite = (instanceId: ProviderInstanceId, slug: string) =>
    options.updateClientSettings((current) => ({
      ...current,
      favorites: toggleModelPickerFavorite(current.favorites, instanceId, slug),
    }));

  return {
    stateAtom,
    buildView,
    open,
    close,
    select,
    toggleFavorite,
    setSearch: (searchQuery: string) => update((state) => ({ ...state, searchQuery })),
    setRail: (railSelection: ModelPickerRailSelection) =>
      update((state) => ({ ...state, railSelection, searchQuery: state.searchQuery })),
    toggleLegacy: (instanceId: ProviderInstanceId) =>
      update((state) => ({
        ...state,
        expandedLegacyInstanceIds: toggleModelPickerLegacySection(
          state.expandedLegacyInstanceIds,
          instanceId,
        ),
      })),
  };
}
