import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { memo, useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { ChevronRightIcon } from "lucide-react";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxListVirtualized,
} from "../ui/combobox";
import type { ModelEsque } from "./modelDisplayName";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { modelPickerJumpIndexFromCommand, resolveShortcutCommand } from "../../keybindings";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { getVirtualizedScrollFadeClassName } from "../ui/scroll-area";
import { TooltipProvider } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  buildModelPickerModel,
  buildModelPickerShortcutContext,
  resolveAdjacentModelPickerRailSelection,
  resolveInitialModelPickerExpandedLegacyInstanceIds,
  resolveInitialModelPickerRailSelection,
  resolveModelPickerJumpTarget,
  resolveModelPickerKeyAction,
  resolveModelPickerSelection,
  resolveModelPickerValueChangeKey,
  toggleModelPickerFavorite,
  toggleModelPickerLegacySection,
  type ModelPickerContextInput,
  type ModelPickerRailSelection,
  type ModelPickerRow,
} from "./modelPicker.logic";

function ModelListSeparator() {
  return <div className="h-0.5" />;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  /** The instance currently selected in the composer (combobox "value"). */
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  /**
   * When set, the picker is locked to the given driver kind — typically
   * because the user is editing a previously-sent message and can't change
   * which driver served the turn. Multiple instances of the same kind
   * remain selectable (e.g. locked to `codex` still lets the user switch
   * between the default Codex and a custom Codex Personal).
   */
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /**
   * All configured provider instances in display order. Used to render
   * the sidebar (one button per instance) and to resolve display names
   * for the locked-mode header.
   */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  /**
   * Model options per instance. Keyed by `ProviderInstanceId` so the
   * default Codex instance and any custom Codex instances each have their
   * own list (custom instances typically start with the same built-in
   * model set but are free to diverge via customModels).
   */
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const {
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
    onToggleModel,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<LegendListRef | null>(null);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const favorites = useClientSettings((s) => s.favorites ?? []);
  const contextInput: ModelPickerContextInput = {
    activeInstanceId: props.activeInstanceId,
    model: props.model,
    instanceEntries,
    modelOptionsByInstance,
    lockedProvider: props.lockedProvider,
    canOpenProviderSetup: props.onOpenProviderSetup !== undefined,
    favorites,
  };
  const [railSelection, setRailSelection] = useState<ModelPickerRailSelection>(() =>
    resolveInitialModelPickerRailSelection(contextInput),
  );
  const [expandedLegacyInstances, setExpandedLegacyInstances] = useState(() =>
    resolveInitialModelPickerExpandedLegacyInstanceIds(contextInput),
  );
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = providedKeybindings ?? serverKeybindings;
  const updateSettings = useUpdateClientSettings();
  const canOpenProviderSetup = props.onOpenProviderSetup !== undefined;

  const model = useMemo(
    () =>
      buildModelPickerModel({
        activeInstanceId: props.activeInstanceId,
        model: props.model,
        instanceEntries,
        modelOptionsByInstance,
        lockedProvider: props.lockedProvider,
        canOpenProviderSetup,
        favorites,
        selectedModels: props.selectedModels,
        multiSelect: onToggleModel !== undefined,
        lockedContinuationGroupKey: props.lockedContinuationGroupKey ?? null,
        getModelDisabledReason,
        searchQuery,
        railSelection,
        expandedLegacyInstanceIds: expandedLegacyInstances,
        keybindings,
        shortcutPlatform: navigator.platform,
        terminalOpen: props.terminalOpen,
      }),
    [
      canOpenProviderSetup,
      expandedLegacyInstances,
      favorites,
      getModelDisabledReason,
      instanceEntries,
      keybindings,
      modelOptionsByInstance,
      onToggleModel,
      props.activeInstanceId,
      props.lockedContinuationGroupKey,
      props.lockedProvider,
      props.model,
      props.selectedModels,
      props.terminalOpen,
      railSelection,
      searchQuery,
    ],
  );
  const rowByKey = useMemo(
    (): ReadonlyMap<string, ModelPickerRow> => new Map(model.rows.map((row) => [row.key, row])),
    [model.rows],
  );

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSelectInstance = useCallback(
    (instanceId: ModelPickerRailSelection) => {
      setRailSelection(instanceId);
      window.requestAnimationFrame(() => {
        focusSearchInput();
      });
    },
    [focusSearchInput],
  );

  useLayoutEffect(() => {
    focusSearchInput();
    const frame = window.requestAnimationFrame(() => {
      focusSearchInput();
    });
    const timeout = window.setTimeout(() => {
      focusSearchInput();
    }, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSearchInput]);

  const toggleLegacySection = useCallback((instanceId: ProviderInstanceId) => {
    setExpandedLegacyInstances((expanded) => toggleModelPickerLegacySection(expanded, instanceId));
  }, []);

  const handleModelSelect = useCallback(
    (modelSlug: string, instanceId: ProviderInstanceId, additive = false) => {
      const selection = resolveModelPickerSelection({
        instanceId,
        slug: modelSlug,
        additive,
        multiSelect: onToggleModel !== undefined,
        instanceEntries,
        modelOptionsByInstance,
        getModelDisabledReason,
      });
      if (!selection) {
        return;
      }
      if (selection.kind === "toggle" && onToggleModel) {
        onToggleModel(selection.instanceId, selection.model);
      } else {
        onInstanceModelChange(selection.instanceId, selection.model);
      }
    },
    [
      getModelDisabledReason,
      instanceEntries,
      modelOptionsByInstance,
      onInstanceModelChange,
      onToggleModel,
    ],
  );

  const activateItemKey = useCallback(
    (key: string, additive: boolean) => {
      const action = resolveModelPickerKeyAction(key);
      if (!action) {
        return;
      }
      if (action.kind === "toggle-legacy-section") {
        toggleLegacySection(action.instanceId);
        return;
      }
      handleModelSelect(action.slug, action.instanceId, additive);
    },
    [handleModelSelect, toggleLegacySection],
  );

  const toggleFavorite = useCallback(
    (instanceId: ProviderInstanceId, modelSlug: string) => {
      updateSettings({ favorites: toggleModelPickerFavorite(favorites, instanceId, modelSlug) });
    },
    [favorites, updateSettings],
  );

  const updateModelListScrollFades = useCallback(() => {
    const scrollElement = modelListRef.current?.getScrollableNode();
    if (!(scrollElement instanceof HTMLElement)) {
      return;
    }
    const maxScrollOffset = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    setShowTopScrollFade(scrollElement.scrollTop > 1);
    setShowBottomScrollFade(maxScrollOffset - scrollElement.scrollTop > 1);
  }, []);
  const modelJumpShortcutContext = useMemo(
    () => buildModelPickerShortcutContext(props.terminalOpen),
    [props.terminalOpen],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen()) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: modelJumpShortcutContext,
      });
      if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
        event.preventDefault();
        event.stopPropagation();
        const next = resolveAdjacentModelPickerRailSelection(
          model,
          command === "modelPicker.nextProvider" ? 1 : -1,
        );
        setSearchQuery("");
        handleSelectInstance(next);
        return;
      }
      const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const target = resolveModelPickerJumpTarget(model, jumpIndex);
      if (!target) {
        return;
      }
      handleModelSelect(target.slug, target.instanceId);
    };

    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
    };
  }, [handleModelSelect, handleSelectInstance, keybindings, model, modelJumpShortcutContext]);

  useLayoutEffect(() => {
    setShowTopScrollFade(false);
    setShowBottomScrollFade(model.rowKeys.length > 5);
    let nestedFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      updateModelListScrollFades();
      nestedFrame = window.requestAnimationFrame(updateModelListScrollFades);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(nestedFrame);
    };
  }, [model.rowKeys, updateModelListScrollFades]);

  return (
    <TooltipProvider delay={0}>
      <div
        className="relative flex h-screen max-h-86.5 w-screen max-w-90 flex-row overflow-hidden"
        data-model-picker-content="true"
      >
        {/* Sidebar */}
        {model.showRail && (
          <ModelPickerSidebar
            label={model.railLabel}
            selection={model.railSelection}
            items={model.rail}
            onSelectInstance={handleSelectInstance}
            onFocusSearch={focusSearchInput}
          />
        )}

        {/* Main content area */}
        <Combobox<string, boolean>
          inline
          items={model.allItemKeys}
          filteredItems={model.rowKeys}
          filter={null}
          autoHighlight
          open
          virtualized
          multiple={model.multiSelect}
          value={model.multiSelect ? [...model.selectedModelKeys] : model.activeModelKey}
          onItemHighlighted={(modelKey, eventDetails) => {
            highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
            if (eventDetails.reason === "keyboard" && eventDetails.index >= 0) {
              void modelListRef.current?.scrollIndexIntoView?.({
                index: eventDetails.index,
                animated: false,
              });
            }
          }}
          onValueChange={(value, details) => {
            const modelKey = resolveModelPickerValueChangeKey(value, model.selectedModelKeys);
            if (modelKey === null) {
              return;
            }
            activateItemKey(
              modelKey,
              "shiftKey" in details.event && details.event.shiftKey === true,
            );
          }}
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/40",
              model.showRail && "border-l border-border/70",
            )}
          >
            <ComboboxSearchInput
              ref={searchInputRef}
              placeholder={model.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (
                  model.showRail &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  ((e.key === "ArrowLeft" && !e.shiftKey && searchQuery.length === 0) ||
                    (e.key === "Tab" && e.shiftKey))
                ) {
                  const sidebar = e.currentTarget
                    .closest("[data-model-picker-content]")
                    ?.querySelector("[data-model-picker-sidebar]");
                  const button =
                    sidebar?.querySelector<HTMLButtonElement>(
                      'button[aria-pressed="true"]:not(:disabled)',
                    ) ?? sidebar?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                  if (button) {
                    e.preventDefault();
                    e.stopPropagation();
                    button.focus();
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onRequestClose?.();
                  return;
                }
                if (e.key === "Enter" && highlightedModelKeyRef.current) {
                  (e as typeof e & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
                  e.preventDefault();
                  e.stopPropagation();
                  activateItemKey(highlightedModelKeyRef.current, e.shiftKey);
                  return;
                }
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            />

            {/* Model list */}
            <div className="relative min-h-0 flex-1 overflow-hidden pr-px">
              <ComboboxListVirtualized>
                <LegendList<string>
                  ref={modelListRef}
                  data={model.rowKeys}
                  extraData={rowByKey}
                  keyExtractor={(modelKey) => modelKey}
                  renderItem={({ item: modelKey, index }) => {
                    const row = rowByKey.get(modelKey);
                    if (!row) {
                      return null;
                    }
                    if (row.kind === "legacy-section") {
                      return (
                        <ComboboxItem
                          hideIndicator
                          index={index}
                          value={modelKey}
                          aria-expanded={row.expanded}
                          className="group w-full cursor-pointer"
                        >
                          <div className="min-w-0 flex-1 text-left">
                            <div className="text-xs font-medium leading-snug">{row.label}</div>
                            <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground/70">
                              {row.countLabel}
                            </div>
                          </div>
                          <ChevronRightIcon
                            className={cn(
                              "size-4 transition-transform",
                              row.expanded && "rotate-90",
                            )}
                          />
                        </ComboboxItem>
                      );
                    }
                    return (
                      <ModelListRow
                        key={modelKey}
                        index={index}
                        row={row}
                        onToggleFavorite={() => toggleFavorite(row.instanceId, row.slug)}
                      />
                    );
                  }}
                  estimatedItemSize={52}
                  drawDistance={480}
                  recycleItems
                  contentContainerClassName="pl-2 pr-px"
                  ItemSeparatorComponent={ModelListSeparator}
                  onLayout={updateModelListScrollFades}
                  onScroll={updateModelListScrollFades}
                  className={cn(
                    "scrollbar-gutter-stable h-full overflow-x-hidden overscroll-y-contain py-1.5 [&::-webkit-scrollbar-track]:my-2",
                    getVirtualizedScrollFadeClassName({
                      top: showTopScrollFade,
                      bottom: showBottomScrollFade,
                    }),
                  )}
                />
              </ComboboxListVirtualized>
            </div>
            {model.setupItems.length > 0 ? (
              <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border/70 p-2">
                {model.setupItems.map((item) => (
                  <div key={item.instanceId} className="px-1 py-1.5 text-xs leading-snug">
                    <p className="line-clamp-3 text-muted-foreground">{item.message}</p>
                    <InlineButton
                      className="mt-1"
                      onClick={() => {
                        props.onRequestClose?.();
                        props.onOpenProviderSetup?.(item.instanceId);
                      }}
                    >
                      {item.actionLabel}
                    </InlineButton>
                  </div>
                ))}
              </div>
            ) : (
              <ComboboxEmpty className="empty:h-0">{model.emptyStateText}</ComboboxEmpty>
            )}
          </div>
        </Combobox>
      </div>
    </TooltipProvider>
  );
});
