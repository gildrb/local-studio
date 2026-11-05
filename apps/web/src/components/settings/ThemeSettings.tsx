import {
  CheckIcon,
  CopyIcon,
  MoonIcon,
  PaintbrushIcon,
  PenLineIcon,
  PlusIcon,
  SunIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useEnvironmentThemeDefinitions } from "../../hooks/useEnvironmentTheme";
import { readThemeHalvesRaw } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import {
  getThemeDefinition,
  removeCustomThemes,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemeHalves,
} from "../../themePalette";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { ThemeImportDialog } from "./ThemeImportDialog";
import { useThemeEditorStore, type ThemeEditorSessionInput } from "./themeEditorStore";
import { ThemePreviewCircles, ThemePreviewCircle } from "./ThemePreviewCircles";
import type { ThemeMode } from "./ThemePreviewCircles.logic";
import {
  buildThemeCollectionCardModel,
  buildThemeLibraryModel,
  buildThemeRemovalDialogModel,
  buildThemesImportedToast,
  resolveThemeCollectionSafeIndex,
  resolveThemeExport,
  resolveThemeHalfAssignment,
  resolveThemeImportedActivation,
  resolveThemeOwners,
  resolveThemeRemovalConfirm,
  resolveThemeRemovalSelection,
  resolveThemeRemovalStart,
  THEME_REMOVAL_FAILURE_TOAST,
  THEME_SELECTION_SAVE_FAILURE_TOAST,
  type ThemeLibraryCardModel,
  type ThemeLibraryUseIntent,
  type ThemeOwners,
  type ThemeRemovalTarget,
} from "./ThemeSettings.logic";
import { ThemeWireframe } from "./ThemeWireframe";

function downloadThemeFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in some browsers; give the
  // browser time to open the stream first.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function ThemeVariantTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function ThemeLibraryCard({
  card,
  onUse,
  onOpenEditor,
  onDownload,
  onRemove,
}: {
  card: ThemeLibraryCardModel;
  onUse: (intent: ThemeLibraryUseIntent) => void;
  onOpenEditor: (session: ThemeEditorSessionInput) => void;
  onDownload?: () => void;
  onRemove?: () => void;
}) {
  const [radialModeOpen, setRadialModeOpen] = useState<ThemeAppearance | null>(null);
  const variantNavigation = card.variantNavigation;
  const duplicateAction = card.duplicate;
  const editAction = card.edit;
  const exportAction = onDownload ? card.export : null;
  const removeAction = onRemove ? card.remove : null;
  return (
    // The card surface stays a plain div (buttons cannot nest inside a button
    // role); the title button and mode circles carry the accessible actions,
    // while the card click is a pointer-only convenience.
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              "cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-card/60 transition-colors hover:bg-accent/10",
            )}
            data-theme-library-card={card.cardId}
            onClick={() => onUse(card.use)}
          >
            <div className="relative">
              {variantNavigation ? (
                <div
                  aria-label={variantNavigation.ariaLabel}
                  className="relative h-20"
                  role="group"
                  onBlurCapture={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      !(nextTarget instanceof Node) ||
                      !event.currentTarget.contains(nextTarget)
                    ) {
                      setRadialModeOpen(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setRadialModeOpen(null);
                  }}
                  onMouseLeave={() => setRadialModeOpen(null)}
                >
                  {variantNavigation.groups.map((group) => {
                    const { mode, selected, options } = group;
                    const rootOffsetX = mode === "light" ? -52 : 52;
                    const isOpen = radialModeOpen === mode;
                    return (
                      <div className="contents" key={mode}>
                        <ThemeVariantTooltip label={group.tooltip}>
                          <button
                            aria-label={group.ariaLabel}
                            aria-pressed={group.active}
                            className="absolute left-1/2 top-2 z-20 flex size-14 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            style={{
                              transform: `translateX(calc(-50% + ${rootOffsetX}px))`,
                            }}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUse(selected.select);
                            }}
                            onFocus={() => setRadialModeOpen(mode)}
                            onMouseEnter={() => setRadialModeOpen(mode)}
                          >
                            <ThemePreviewCircle colors={selected.colors} mode={selected.mode} />
                            {group.active ? (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-ring"
                              />
                            ) : null}
                            {group.active ? (
                              <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm">
                                {group.badgeIcon === "sun" ? (
                                  <SunIcon className="size-2.5" />
                                ) : (
                                  <MoonIcon className="size-2.5" />
                                )}
                              </span>
                            ) : null}
                          </button>
                        </ThemeVariantTooltip>
                        <span
                          className="pointer-events-none absolute bottom-0 left-1/2 inline-flex max-w-24 -translate-x-1/2 items-center gap-1 text-2xs font-medium text-foreground"
                          style={{ marginLeft: rootOffsetX }}
                        >
                          <span className="truncate">{selected.label}</span>
                          {group.extraCountLabel === null ? null : (
                            <span className="shrink-0 rounded-full bg-muted px-1 text-3xs text-muted-foreground">
                              {group.extraCountLabel}
                            </span>
                          )}
                        </span>
                        {options.map((option, optionIndex) => {
                          const progress = optionIndex / (options.length - 1) - 0.5;
                          const childOffsetX = rootOffsetX + progress * 68;
                          const childOffsetY = Math.abs(progress) * 10;
                          return (
                            <ThemeVariantTooltip key={option.label} label={option.tooltip}>
                              <button
                                aria-label={option.ariaLabel}
                                aria-pressed={option.active}
                                className={cn(
                                  "absolute left-1/2 top-1 z-30 flex size-7 items-center justify-center rounded-full bg-background shadow-sm outline-none transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring",
                                  option.active ? "ring-2 ring-ring" : "ring-1 ring-border/70",
                                )}
                                style={{
                                  opacity: isOpen ? 1 : 0,
                                  pointerEvents: isOpen ? "auto" : "none",
                                  transform: `translate(calc(-50% + ${isOpen ? childOffsetX : rootOffsetX}px), ${isOpen ? childOffsetY : 28}px) scale(${isOpen ? 1 : 0.55})`,
                                  transitionDelay: isOpen ? `${optionIndex * 35}ms` : "0ms",
                                }}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onUse(option.select);
                                }}
                                onFocus={() => setRadialModeOpen(mode)}
                                onMouseEnter={() => setRadialModeOpen(mode)}
                              >
                                <span className="pointer-events-none scale-[0.43]">
                                  <ThemePreviewCircle colors={option.colors} mode={option.mode} />
                                </span>
                              </button>
                            </ThemeVariantTooltip>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ThemePreviewCircles
                  label={card.label}
                  activeModes={card.activeModes}
                  onSelectMode={(mode: ThemeMode) => {
                    const preview = card.previews.find((candidate) => candidate.mode === mode);
                    if (preview) onUse({ steps: [preview.pick], variantIndex: null });
                  }}
                  previews={card.previews}
                />
              )}
            </div>
            <div className="flex items-center gap-2 px-3 pb-3 pt-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <button
                    aria-label={card.titleAriaLabel}
                    aria-pressed={false}
                    className="min-w-0 cursor-pointer truncate rounded-sm text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUse(card.use);
                    }}
                  >
                    {card.title}
                  </button>
                </div>
              </div>
              {editAction || duplicateAction || exportAction || removeAction ? (
                <div className="flex shrink-0 items-center gap-1">
                  {duplicateAction ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            aria-label={duplicateAction.ariaLabel}
                            size="icon-xs"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenEditor(duplicateAction.session);
                            }}
                          >
                            <CopyIcon />
                          </Button>
                        }
                      />
                      <TooltipPopup>{duplicateAction.tooltip}</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {editAction ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            aria-label={editAction.ariaLabel}
                            size="icon-xs"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenEditor(editAction.session);
                            }}
                          >
                            <PenLineIcon />
                          </Button>
                        }
                      />
                      <TooltipPopup>{editAction.tooltip}</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {exportAction && onDownload ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            aria-label={exportAction.ariaLabel}
                            size="icon-xs"
                            variant="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDownload();
                            }}
                          >
                            <UploadIcon />
                          </Button>
                        }
                      />
                      <TooltipPopup>{exportAction.tooltip}</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  {removeAction && onRemove ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            aria-label={removeAction.ariaLabel}
                            size="icon-xs"
                            variant="ghost-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRemove();
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                        }
                      />
                      <TooltipPopup>{removeAction.tooltip}</TooltipPopup>
                    </Tooltip>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        }
      />
      <TooltipPopup>{card.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function CustomThemeCollectionCard({
  collectionId,
  themes,
  owners,
  initialAppearance,
  initialVariantIndex,
  onUse,
  onOpenEditor,
  onDownload,
  onRemove,
}: {
  collectionId: string;
  themes: ReadonlyArray<ThemeDefinition>;
  owners: ThemeOwners;
  initialAppearance: ThemeAppearance;
  initialVariantIndex: number;
  onUse: (intent: ThemeLibraryUseIntent) => void;
  onOpenEditor: (session: ThemeEditorSessionInput) => void;
  onDownload: (theme: ThemeDefinition) => void;
  onRemove: (theme: ThemeDefinition) => void;
}) {
  const [variantIndex, setVariantIndex] = useState(initialVariantIndex);
  const safeIndex = resolveThemeCollectionSafeIndex(themes, variantIndex);
  const theme = themes[safeIndex];

  useEffect(() => {
    if (variantIndex !== safeIndex) setVariantIndex(safeIndex);
  }, [safeIndex, variantIndex]);

  const card = buildThemeCollectionCardModel({
    collectionId,
    themes,
    variantIndex,
    owners,
    initialAppearance,
  });
  if (!theme || !card) return null;

  return (
    <ThemeLibraryCard
      card={card}
      onDownload={() => onDownload(theme)}
      onOpenEditor={onOpenEditor}
      onRemove={() => onRemove(theme)}
      onUse={(intent) => {
        onUse(intent);
        if (intent.variantIndex !== null) setVariantIndex(intent.variantIndex);
      }}
    />
  );
}

export function ThemeLibrary({
  theme,
  setTheme,
  appearanceMode,
  setAppearanceMode,
  customThemes,
  initialAppearance,
  refreshTheme,
  isImportOpen,
  onImportOpenChange,
  themeHalves,
  setThemeHalf,
}: {
  theme: string;
  setTheme: (theme: string) => boolean;
  appearanceMode: ThemeMode;
  setAppearanceMode: (mode: ThemeMode) => boolean;
  customThemes: ReadonlyArray<ThemeDefinition>;
  initialAppearance: ThemeAppearance;
  refreshTheme: () => void;
  isImportOpen: boolean;
  onImportOpenChange: (open: boolean) => void;
  themeHalves: ThemeHalves | null;
  setThemeHalf: (appearance: ThemeAppearance, themeId: string | null) => boolean;
}) {
  const openThemeEditor = useThemeEditorStore((store) => store.openThemeEditor);
  const environmentThemes = useEnvironmentThemeDefinitions();
  const [themeRemovalTarget, setThemeRemovalTarget] = useState<ThemeRemovalTarget | null>(null);
  // Keep the target after closing so the dialog text remains populated during
  // its exit animation. The next trash action replaces it before reopening.
  const [isThemeRemovalOpen, setIsThemeRemovalOpen] = useState(false);
  const [themeIdsToRemove, setThemeIdsToRemove] = useState<ReadonlyArray<string>>([]);
  const removalDialog = buildThemeRemovalDialogModel({
    target: themeRemovalTarget,
    selectedIds: themeIdsToRemove,
  });

  const notifyThemeSaveFailure = useCallback(() => {
    toastManager.add(stackedThreadToast(THEME_SELECTION_SAVE_FAILURE_TOAST));
  }, []);

  const notifyThemeRemovalFailure = useCallback(() => {
    toastManager.add(stackedThreadToast(THEME_REMOVAL_FAILURE_TOAST));
  }, []);

  const persistTheme = useCallback(
    (nextTheme: string) => {
      const didSave = setTheme(nextTheme);
      if (!didSave) notifyThemeSaveFailure();
      return didSave;
    },
    [notifyThemeSaveFailure, setTheme],
  );

  const handleRemoveTheme = useCallback(
    (customTheme: ThemeDefinition, collectionThemes: ReadonlyArray<ThemeDefinition>) => {
      const start = resolveThemeRemovalStart({ theme: customTheme, collectionThemes });
      setThemeRemovalTarget(start.target);
      setThemeIdsToRemove(start.selectedIds);
      setIsThemeRemovalOpen(true);
    },
    [],
  );

  // ----- Automatic-mode mixing -------------------------------------------
  // The pair model: one theme owns light, one owns dark, and the global
  // appearance mode (light / dark / auto) decides which is showing.
  const baseCardId = getThemeDefinition(theme)?.id ?? null;
  const owners = resolveThemeOwners(baseCardId, themeHalves);

  const handleConfirmRemoveTheme = useCallback(() => {
    if (!themeRemovalTarget) return;
    // Captured raw before persistTheme clears the mix: a half naming a
    // published theme whose set has not streamed in yet is pruned from the
    // `themeHalves` prop, and rebuilding from that would drop it.
    const plan = resolveThemeRemovalConfirm({
      selectedIds: themeIdsToRemove,
      baseThemeId: baseCardId,
      appearanceMode,
      storedHalves: readThemeHalvesRaw(),
    });
    if (plan.kind === "none") return;
    // Keep the themes installed if we cannot move the selection off one of
    // them; the dialog stays open so the user can retry or cancel.
    if (plan.basePreference !== null && !persistTheme(plan.basePreference)) {
      return;
    }
    for (const write of plan.halfWrites) {
      if (!setThemeHalf(write.appearance, write.themeId)) {
        notifyThemeRemovalFailure();
        return;
      }
    }
    try {
      removeCustomThemes(plan.removedIds);
    } catch {
      notifyThemeRemovalFailure();
      return;
    }
    setIsThemeRemovalOpen(false);
  }, [
    appearanceMode,
    baseCardId,
    notifyThemeRemovalFailure,
    persistTheme,
    setThemeHalf,
    themeIdsToRemove,
    themeRemovalTarget,
  ]);

  const assignHalf = useCallback(
    (appearance: ThemeAppearance, cardId: string | null) => {
      const plan = resolveThemeHalfAssignment({
        appearance,
        themeId: cardId,
        baseThemeId: baseCardId,
        appearanceMode,
        storedHalves: readThemeHalvesRaw(),
      });
      // Picking the default over a themed base cannot be stored as a half:
      // the base would still own that appearance. Convert the base into an
      // explicit half on the other side so this side falls back to default.
      if (plan.kind === "convert-base") {
        if (!persistTheme(plan.basePreference)) return;
        if (!setThemeHalf(plan.otherAppearance, plan.otherThemeId)) {
          // Best-effort rollback: restore the whole-theme selection rather
          // than leaving the user with no theme at all.
          setTheme(theme);
          notifyThemeSaveFailure();
        }
        return;
      }
      if (!setThemeHalf(plan.appearance, plan.themeId)) {
        notifyThemeSaveFailure();
      }
    },
    [
      appearanceMode,
      baseCardId,
      notifyThemeSaveFailure,
      persistTheme,
      setTheme,
      setThemeHalf,
      theme,
    ],
  );

  const runUseIntent = (intent: ThemeLibraryUseIntent) => {
    for (const step of intent.steps) {
      if (step.kind === "persist-theme") persistTheme(step.theme);
      else assignHalf(step.appearance, step.themeId);
    }
  };

  const setMode = (mode: ThemeMode) => {
    if (!setAppearanceMode(mode)) notifyThemeSaveFailure();
  };

  const model = buildThemeLibraryModel({
    baseThemeId: baseCardId,
    appearanceMode,
    themeHalves,
    initialAppearance,
    customThemes,
    environmentThemes,
  });

  const renderModeTiles = () => (
    <div
      aria-label={model.modeGroupAriaLabel}
      className="grid w-full grid-cols-3 gap-3"
      role="group"
    >
      {model.modeTiles.map((tile) => (
        <button
          aria-label={tile.ariaLabel}
          aria-pressed={tile.active}
          className={cn(
            "flex cursor-pointer flex-col items-stretch gap-1.5 rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            tile.active
              ? "border-transparent bg-accent/30"
              : "border-border/70 bg-card/60 hover:bg-accent/10",
          )}
          key={tile.mode}
          style={tile.active ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
          onClick={() => setMode(tile.mode)}
          type="button"
        >
          <ThemeWireframe className="h-[8.75rem]" panes={tile.panes} />
          <span
            className={cn(
              "flex items-center justify-center text-xs font-medium",
              tile.active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {tile.label}
          </span>
        </button>
      ))}
    </div>
  );

  const renderPairGrid = () => (
    // One shared provider so every tooltip in the grid hands off instantly to
    // the next hovered trigger instead of stacking on top of it. The card
    // tooltip briefly showing while crossing between a card's two circles is
    // accepted — scoping the group tighter makes the handoffs feel sluggish.
    <TooltipProvider>
      <div
        className="grid w-full gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))" }}
      >
        {model.cards.map((card) => (
          <ThemeLibraryCard
            card={card}
            key={card.id}
            onOpenEditor={openThemeEditor}
            onUse={runUseIntent}
          />
        ))}
        {model.collections.map((collection) => (
          <CustomThemeCollectionCard
            collectionId={collection.id}
            initialAppearance={initialAppearance}
            initialVariantIndex={collection.initialVariantIndex}
            key={collection.id}
            onDownload={(customTheme) => {
              const file = resolveThemeExport(customTheme);
              downloadThemeFile(file.filename, file.contents);
            }}
            onOpenEditor={openThemeEditor}
            onRemove={(customTheme) => handleRemoveTheme(customTheme, collection.themes)}
            onUse={runUseIntent}
            owners={owners}
            themes={collection.themes}
          />
        ))}
      </div>
    </TooltipProvider>
  );

  return (
    <div className="space-y-3">
      <h3 className="px-3 text-sm font-normal text-foreground/70 sm:px-4">
        {model.colorSchemeTitle}
      </h3>
      {renderModeTiles()}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-3 px-3 pt-2 sm:px-4">
        <h3 className="text-sm font-normal text-foreground/70">{model.themeTitle}</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => openThemeEditor(model.createTheme.session)}
          >
            <PaintbrushIcon />
            {model.createTheme.label}
          </Button>
          <Button size="xs" variant="outline" onClick={() => onImportOpenChange(true)}>
            <PlusIcon />
            {model.addTheme.label}
          </Button>
        </div>
      </div>
      {renderPairGrid()}
      <ThemeImportDialog
        onImportedMany={(importedThemes, { updated }) => {
          // Re-apply after collection updates. The update may remove the
          // selected variant, in which case the theme hook falls back safely.
          if (updated) refreshTheme();
          toastManager.add(stackedThreadToast(buildThemesImportedToast(importedThemes, updated)));
        }}
        onImported={(importedTheme) => {
          // Same rule as clicking the card: a one-appearance theme takes its
          // side of the mix instead of becoming the base for both.
          const activation = resolveThemeImportedActivation(importedTheme);
          if (activation.kind === "assign-half") {
            assignHalf(activation.appearance, activation.themeId);
            toastManager.add(stackedThreadToast(activation.toast));
            return true;
          }
          if (!persistTheme(activation.themeId)) return false;
          toastManager.add(stackedThreadToast(activation.toast));
          return true;
        }}
        onOpenChange={onImportOpenChange}
        open={isImportOpen}
      />
      <AlertDialog open={isThemeRemovalOpen} onOpenChange={setIsThemeRemovalOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{removalDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{removalDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {removalDialog.canRemoveCollection ? (
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto px-6 pb-6 sm:grid-cols-2">
              {removalDialog.options.map((option) => (
                <label
                  className="group relative flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-border/70 bg-muted/25 p-3 has-checked:border-ring has-checked:bg-accent/20 hover:bg-muted/40"
                  htmlFor={option.checkboxId}
                  key={option.themeId}
                >
                  <span className="absolute right-2 top-2 inline-grid size-5 grid-cols-1 sm:size-4">
                    <input
                      checked={option.checked}
                      className="col-start-1 row-start-1 size-full appearance-none rounded-sm border border-input bg-background outline-none checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:not-checked:bg-input/32 forced-colors:appearance-auto"
                      id={option.checkboxId}
                      name="themes-to-remove"
                      type="checkbox"
                      onChange={(event) => {
                        const shouldRemove = event.currentTarget.checked;
                        setThemeIdsToRemove((current) =>
                          resolveThemeRemovalSelection(current, option.themeId, shouldRemove),
                        );
                      }}
                    />
                    <CheckIcon className="pointer-events-none col-start-1 row-start-1 size-3.5 shrink-0 self-center justify-self-center stroke-primary-foreground opacity-0 group-has-checked:opacity-100 sm:size-3" />
                  </span>
                  <span className="flex min-h-12 items-center justify-center gap-1">
                    {option.previews.map((preview) => (
                      <span
                        className="flex size-11 shrink-0 items-center justify-center"
                        key={preview.mode}
                      >
                        <span className="flex scale-75">
                          <ThemePreviewCircle colors={preview.colors} mode={preview.mode} />
                        </span>
                      </span>
                    ))}
                  </span>
                  <p className="max-w-full truncate text-center text-base font-medium text-foreground sm:text-sm">
                    {option.label}
                  </p>
                </label>
              ))}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {removalDialog.cancelLabel}
            </AlertDialogClose>
            <Button
              disabled={removalDialog.confirmDisabled}
              variant="destructive"
              onClick={handleConfirmRemoveTheme}
            >
              {removalDialog.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
