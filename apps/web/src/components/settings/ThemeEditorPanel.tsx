import {
  ChevronDownIcon,
  ChevronUpIcon,
  MousePointer2Icon,
  PaintbrushIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  applyThemeColorPreview,
  getCustomThemes,
  installCustomTheme,
  removeCustomTheme,
  updateCustomTheme,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeDefinition,
} from "../../themePalette";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThemeColorField } from "./ThemeColorPicker";
import {
  clearThemeInspectorHover,
  clearThemeInspectorHighlights,
  highlightThemeRoleUsage,
  inspectThemeRoleAtElement,
  inspectThemeRoleFromUtilitiesAtElement,
  refreshThemeInspectorSpotlight,
  showThemeInspectorHover,
  type ThemeElementInspection,
} from "./themeInspector";
import {
  applyThemeEditorColorChange,
  buildThemeEditorModel,
  getThemeEditorColorsByAppearance,
  markThemeEditorAppearancesDirty,
  regenerateThemeEditorColors,
  resolveThemeEditorAdvancedToggle,
  resolveThemeEditorAutoAppearance,
  resolveThemeEditorColorChangeEffects,
  resolveThemeEditorRoleSelection,
  resolveThemeEditorRoleToggle,
  resolveThemeEditorSave,
  resolveThemeEditorSeed,
  themeEditorRoleDisplayLabel,
  themeEditorSaveErrorMessage,
  THEME_EDITOR_ACTIVATION_FAILURE_MESSAGE,
  type ThemeEditorAppearanceOption,
  type ThemeEditorColorsByAppearance,
} from "./ThemeEditorPanel.logic";
import type { ThemeColorFieldModel } from "./ThemeColorPicker.logic";

export function ThemeEditorPanel({
  open,
  onOpenChange,
  onSaved,
  editingTheme,
  initialAppearance,
  seedTheme,
  seedName,
  restoreTheme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (
    theme: ThemeDefinition,
    context: {
      created: boolean;
      /** Set when a create merged its palette into an existing theme. */
      mergedAppearance?: ThemeAppearance;
    },
  ) => boolean;
  editingTheme: ThemeDefinition | null;
  initialAppearance: ThemeAppearance;
  /** The theme a new theme starts from, so tuning what you already use is a
   *  matter of editing rather than rebuilding. Null starts from the defaults. */
  seedTheme?: ThemeDefinition | null;
  /** Prefilled name for an explicit duplicate; a plain create stays unnamed. */
  seedName?: string | undefined;
  /** Reapplies the stored theme once the draft stops being previewed. */
  restoreTheme: () => void;
}) {
  const isEditing = editingTheme !== null;
  const [name, setName] = useState("");
  const [activeAppearance, setActiveAppearance] = useState<ThemeAppearance>(initialAppearance);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [colorsByAppearance, setColorsByAppearance] = useState<ThemeEditorColorsByAppearance>(() =>
    getThemeEditorColorsByAppearance(),
  );
  const [simpleColorsDirtyByAppearance, setSimpleColorsDirtyByAppearance] = useState<
    Record<ThemeAppearance, boolean>
  >({ light: false, dark: false });
  const [shouldRegenerateGuidedColors, setShouldRegenerateGuidedColors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [isInspecting, setIsInspecting] = useState(false);
  const [selectedRole, setSelectedRole] = useState<ThemeColorRole | null>(null);
  const [usageCount, setUsageCount] = useState<number | null>(null);
  // Null parks the panel at its default corner; a value is a dragged spot,
  // kept clamped so the header can always be grabbed again.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  // Null keeps the responsive default size; a value is a corner-grip resize.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    // Where the panel's top-left sits: the grip only moves the opposite
    // corner, so the room to grow is measured from here.
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!open) return;
    // A panel sized wider than the window can no longer be clamped back into
    // view by position alone -- its right edge (close, minimize, the grip)
    // stays off screen. So the size shrinks to fit first, then the position
    // is re-clamped against the new size.
    const clamp = () => {
      const margin = 8;
      let clampedWidth: number | undefined;
      let clampedHeight: number | undefined;
      setSize((current) => {
        if (!current) return current;
        clampedWidth = Math.max(280, Math.min(current.width, window.innerWidth - margin * 2));
        clampedHeight = Math.max(220, Math.min(current.height, window.innerHeight - margin * 2));
        return { width: clampedWidth, height: clampedHeight };
      });
      setPosition((current) => {
        if (!current) return current;
        const clamped = clampPosition(current.x, current.y, clampedWidth);
        // Dragging may park the panel with only its header showing, but a
        // window resize should pull the whole thing back into view when it
        // fits -- otherwise the grip ends up below the fold. Minimized, the
        // stored height is not applied (the panel hugs its header), so the
        // rendered height is what has to fit.
        const height = isMinimized
          ? (panelRef.current?.offsetHeight ?? 0)
          : (clampedHeight ?? panelRef.current?.offsetHeight ?? 0);
        const maxY = Math.max(margin, window.innerHeight - height - margin);
        return { x: clamped.x, y: Math.min(clamped.y, maxY) };
      });
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [isMinimized, open]);

  // The draft only reaches the live app once this open has been seeded;
  // previewing in the seeding commit would paint the previous session's
  // colors for a frame.
  const [isDraftSeeded, setIsDraftSeeded] = useState(false);
  const previousOpenRef = useRef(false);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      const seed = resolveThemeEditorSeed({
        editingTheme,
        seedTheme: seedTheme ?? null,
        seedName: seedName ?? null,
        initialAppearance,
      });
      setName(seed.name);
      setActiveAppearance(seed.activeAppearance);
      setIsAdvanced(seed.isAdvanced);
      setSimpleColorsDirtyByAppearance({ light: false, dark: false });
      setShouldRegenerateGuidedColors(seed.shouldRegenerateGuidedColors);
      setColorsByAppearance(seed.colorsByAppearance);
      setSelectedRole(null);
      setUsageCount(null);
      setIsInspecting(false);
      setError(null);
      setIsDraftSeeded(true);
    }
    if (!open && isDraftSeeded) setIsDraftSeeded(false);
    previousOpenRef.current = open;
  }, [editingTheme, initialAppearance, isDraftSeeded, open, seedName, seedTheme]);

  const model = buildThemeEditorModel({
    editingTheme,
    customThemes: getCustomThemes(),
    name,
    activeAppearance,
    isAdvanced,
    colorsByAppearance,
    roleQuery,
    selectedRole,
    usageCount,
    isInspecting,
    isMinimized,
    error,
  });

  const mergeTargetId = model.mergeTarget?.id ?? null;
  const takenAppearancesKey = model.mergeTarget?.takenAppearances.join(",") ?? "";
  useEffect(() => {
    if (isEditing || mergeTargetId === null) return;
    const taken = takenAppearancesKey
      .split(",")
      .filter((value): value is ThemeAppearance => value === "light" || value === "dark");
    setActiveAppearance((current) => resolveThemeEditorAutoAppearance(current, taken));
  }, [isEditing, mergeTargetId, takenAppearancesKey]);

  // The whole app wears the draft while the editor is open, so a role change
  // is judged on the real interface rather than a miniature. The stored theme
  // comes back when the editor closes, including on cancel.
  useEffect(() => {
    if (!open || !isDraftSeeded) return;
    applyThemeColorPreview(colorsByAppearance[activeAppearance], activeAppearance);
  }, [activeAppearance, colorsByAppearance, isDraftSeeded, open]);

  useEffect(() => {
    if (!open) return;
    return () => {
      restoreTheme();
    };
  }, [open, restoreTheme]);

  const updateColor = useCallback(
    (role: ThemeColorRole, value: string) => {
      const change = { activeAppearance, isAdvanced, role, value };
      setColorsByAppearance((current) => applyThemeEditorColorChange(current, change));
      const effects = resolveThemeEditorColorChangeEffects(change);
      if (effects.markGuidedDirty) {
        setSimpleColorsDirtyByAppearance((current) =>
          markThemeEditorAppearancesDirty(current, [activeAppearance]),
        );
      }
      if (effects.markRegenerateGuided) setShouldRegenerateGuidedColors(true);
    },
    [activeAppearance, isAdvanced],
  );

  const selectThemeRole = useCallback((role: ThemeColorRole, reveal = false) => {
    const selection = resolveThemeEditorRoleSelection(role);
    setSelectedRole(selection.selectedRole);
    if (selection.revealAdvanced) {
      setIsAdvanced(true);
      setRoleQuery("");
    }
    if (!reveal) return;

    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector(`[data-theme-color-role="${selection.selectedRole}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  const toggleThemeRole = useCallback((role: ThemeColorRole) => {
    setSelectedRole((current) => resolveThemeEditorRoleToggle(current, role));
  }, []);

  const clearInspectorSelection = useCallback(() => {
    setSelectedRole(null);
    setUsageCount(null);
    setIsInspecting(false);
  }, []);

  const selectedHighlightRolesKey = model.highlightRoles.join(",");

  useEffect(() => {
    clearThemeInspectorHighlights();
    if (!open || selectedRole === null) {
      setUsageCount(null);
      return;
    }
    // Picking a new element needs the unobscured app, so suspend the existing
    // spotlight while the picker is armed.
    if (isInspecting) return;

    const highlightedRoles = selectedHighlightRolesKey.split(",") as Array<ThemeColorRole>;
    const refreshHighlights = () => setUsageCount(highlightThemeRoleUsage(highlightedRoles));
    refreshHighlights();
    // A refresh snapshots computed styles for the whole tree twice, so it is
    // throttled rather than run per frame: a streaming reply or a virtualized
    // list mutates the DOM continuously and would otherwise stall the main
    // thread for as long as the inspector is open.
    const MIN_REFRESH_INTERVAL_MS = 500;
    let refreshFrame: number | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt = performance.now();
    const scheduleRefresh = () => {
      if (refreshFrame !== null || refreshTimer !== null) return;
      const wait = Math.max(0, MIN_REFRESH_INTERVAL_MS - (performance.now() - lastRefreshAt));
      const run = () => {
        refreshFrame = null;
        refreshTimer = null;
        lastRefreshAt = performance.now();
        refreshHighlights();
      };
      if (wait === 0) refreshFrame = requestAnimationFrame(run);
      else refreshTimer = setTimeout(run, wait);
    };
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.every(
          (mutation) =>
            mutation.target instanceof Element &&
            (mutation.target.closest("#theme-inspector-spotlight") ||
              mutation.target.closest("[data-theme-editor-panel]")),
        )
      ) {
        return;
      }
      scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    let spotlightFrame: number | null = null;
    const scheduleSpotlightRefresh = () => {
      spotlightFrame ??= requestAnimationFrame(() => {
        spotlightFrame = null;
        refreshThemeInspectorSpotlight();
      });
    };
    window.addEventListener("resize", scheduleSpotlightRefresh);
    window.addEventListener("scroll", scheduleSpotlightRefresh, true);
    return () => {
      observer.disconnect();
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame);
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      if (spotlightFrame !== null) cancelAnimationFrame(spotlightFrame);
      window.removeEventListener("resize", scheduleSpotlightRefresh);
      window.removeEventListener("scroll", scheduleSpotlightRefresh, true);
      clearThemeInspectorHighlights();
    };
  }, [isInspecting, open, selectedHighlightRolesKey, selectedRole]);

  useEffect(() => {
    if (!open || !isInspecting) {
      clearThemeInspectorHover();
      return;
    }

    let shouldDisarmAfterClick = false;
    let hoverTarget: Element | null = null;
    let hoverInspection: ThemeElementInspection | null = null;
    let hoverTimer: number | null = null;
    let hoverFrame: number | null = null;
    const clearHoverTimer = () => {
      if (hoverTimer === null) return;
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    };
    const clearHover = () => {
      clearHoverTimer();
      hoverTarget = null;
      hoverInspection = null;
      clearThemeInspectorHover();
    };
    const showInspection = (inspection: ThemeElementInspection) => {
      hoverInspection = inspection;
      showThemeInspectorHover(inspection, themeEditorRoleDisplayLabel(inspection.role));
    };
    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-theme-editor-panel]")) {
        clearHover();
        return;
      }

      clearHoverTimer();
      hoverTarget = target;
      hoverInspection = null;
      const utilityInspection = inspectThemeRoleFromUtilitiesAtElement(target);
      if (utilityInspection) {
        showInspection(utilityInspection);
        return;
      }

      clearThemeInspectorHover();
      hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        if (hoverTarget !== target || !target.isConnected) return;
        const inspection = inspectThemeRoleAtElement(target);
        if (inspection) showInspection(inspection);
      }, 140);
    };
    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) clearHover();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-theme-editor-panel]")) return;
      event.preventDefault();
      event.stopPropagation();
      clearHoverTimer();
      const inspection =
        hoverTarget === target && hoverInspection
          ? hoverInspection
          : inspectThemeRoleAtElement(target);
      if (!inspection) return;
      clearHover();
      selectThemeRole(inspection.role, true);
      shouldDisarmAfterClick = true;
    };
    const blockInspectedClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-theme-editor-panel]")) return;
      event.preventDefault();
      event.stopPropagation();
      if (shouldDisarmAfterClick) setIsInspecting(false);
      shouldDisarmAfterClick = false;
    };
    const cancelInspection = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      clearHover();
      clearInspectorSelection();
    };
    const refreshHover = () => {
      if (!hoverInspection) return;
      hoverFrame ??= requestAnimationFrame(() => {
        hoverFrame = null;
        if (hoverInspection) {
          showThemeInspectorHover(
            hoverInspection,
            themeEditorRoleDisplayLabel(hoverInspection.role),
          );
        }
      });
    };
    const clearHoverOnScroll = () => clearHover();

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", blockInspectedClick, true);
    document.addEventListener("keydown", cancelInspection, true);
    window.addEventListener("resize", refreshHover);
    window.addEventListener("scroll", clearHoverOnScroll, true);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", blockInspectedClick, true);
      document.removeEventListener("keydown", cancelInspection, true);
      window.removeEventListener("resize", refreshHover);
      window.removeEventListener("scroll", clearHoverOnScroll, true);
      clearHoverTimer();
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      clearThemeInspectorHover();
    };
  }, [clearInspectorSelection, isInspecting, open, selectThemeRole]);

  const handleAdvancedChange = useCallback(
    (checked: boolean) => {
      const decision = resolveThemeEditorAdvancedToggle({
        checked,
        selectedRole,
        shouldRegenerateGuidedColors,
        editingTheme,
        activeAppearance,
      });
      setIsAdvanced(decision.isAdvanced);
      if (decision.clearSelectedRole) setSelectedRole(null);
      const appearances = decision.regenerateAppearances;
      if (appearances === null) return;
      setSimpleColorsDirtyByAppearance((current) =>
        markThemeEditorAppearancesDirty(current, appearances),
      );
      setColorsByAppearance((current) => regenerateThemeEditorColors(current, appearances));
      setShouldRegenerateGuidedColors(false);
    },
    [activeAppearance, editingTheme, selectedRole, shouldRegenerateGuidedColors],
  );

  const handleSubmit = () => {
    try {
      const plan = resolveThemeEditorSave({
        name,
        editingTheme,
        customThemes: getCustomThemes(),
        activeAppearance,
        isAdvanced,
        colorsByAppearance,
        guidedDirtyByAppearance: simpleColorsDirtyByAppearance,
      });
      if (plan.kind === "error") {
        setError(plan.message);
        return;
      }
      const savedTheme =
        plan.kind === "install" ? installCustomTheme(plan.theme) : updateCustomTheme(plan.theme);
      if (plan.kind === "merge-edited") {
        try {
          removeCustomTheme(plan.retiredTheme.id);
        } catch (cause) {
          // The merge already persisted. Leaving it while the edited theme
          // survives would collide on every retry, so the target goes back to
          // its pre-merge palettes before the failure surfaces.
          try {
            updateCustomTheme(plan.mergeTarget);
          } catch {
            // Storage is failing wholesale; the rethrow below reports it.
          }
          throw cause;
        }
      }
      if (!onSaved(savedTheme, plan.context)) {
        const rollback = plan.rollback;
        if (rollback.kind === "remove-saved") {
          try {
            removeCustomTheme(savedTheme.id);
          } catch {
            // Storage is failing wholesale; the error below covers it.
          }
        } else if (rollback.kind === "restore-merge") {
          try {
            updateCustomTheme(rollback.mergeTarget);
            if (rollback.retiredTheme) installCustomTheme(rollback.retiredTheme);
          } catch {
            // Storage is failing wholesale; the error below covers it.
          }
        }
        setError(THEME_EDITOR_ACTIVATION_FAILURE_MESSAGE);
        return;
      }
      onOpenChange(false);
    } catch (cause) {
      setError(themeEditorSaveErrorMessage(cause, isEditing));
    }
  };

  const renderNameField = () => (
    <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-3">
      <span className="text-sm font-medium">{model.nameField.label}</span>
      <Input
        autoFocus
        size="sm"
        onChange={(event) => {
          setName(event.currentTarget.value);
          // Most save failures are name collisions; retyping is the fix, so
          // the stale message goes with the old name.
          setError(null);
        }}
        placeholder={model.nameField.placeholder}
        value={model.nameField.value}
      />
    </label>
  );

  const renderAppearanceButton = (option: ThemeEditorAppearanceOption) => {
    // A locked mode stays hoverable so the tooltip can say why it is off;
    // a real disabled attribute would swallow the pointer events.
    const button = (
      <Toggle aria-disabled={option.locked} key={option.value} value={option.value}>
        {option.label}
      </Toggle>
    );
    if (option.lockReason === null) return button;
    return (
      <Tooltip key={option.value}>
        <TooltipTrigger render={button} />
        <TooltipPopup>{option.lockReason}</TooltipPopup>
      </Tooltip>
    );
  };

  const renderAppearanceButtons = () => (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-3">
      <span className="text-sm font-medium">{model.appearance.label}</span>
      <ToggleGroup
        aria-label={model.appearance.ariaLabel}
        variant="segmented"
        value={[model.appearance.value]}
        onValueChange={(next) => {
          const option = model.appearance.options.find((candidate) => candidate.value === next[0]);
          if (option && !option.locked) setActiveAppearance(option.value);
        }}
      >
        {model.appearance.options.map(renderAppearanceButton)}
      </ToggleGroup>
    </div>
  );

  const renderColorsHeader = () => (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3">
      <div>
        <h3 className="text-sm font-medium">{model.colors.title}</h3>
        {model.colors.subtitle === null ? null : (
          <p className="text-xs text-muted-foreground">{model.colors.subtitle}</p>
        )}
      </div>
      <div className="flex min-w-0 items-start gap-3">
        {model.colors.filter ? (
          <Input
            aria-label={model.colors.filter.ariaLabel}
            className="min-w-0 flex-1"
            onChange={(event) => setRoleQuery(event.currentTarget.value)}
            placeholder={model.colors.filter.placeholder}
            size="sm"
            value={model.colors.filter.value}
          />
        ) : null}
        <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 pt-0.5 text-sm font-medium">
          <span>{model.colors.advancedLabel}</span>
          <Switch
            aria-label={model.colors.advancedAriaLabel}
            checked={model.colors.advanced}
            onCheckedChange={(checked) => handleAdvancedChange(Boolean(checked))}
          />
        </label>
      </div>
    </div>
  );

  const renderColorField = (field: ThemeColorFieldModel) => (
    <ThemeColorField
      key={field.id}
      label={field.label}
      onChange={updateColor}
      onSelect={selectThemeRole}
      onToggleSelected={toggleThemeRole}
      role={field.role}
      selected={field.selected}
      value={field.value}
    />
  );

  const renderColorFields = () =>
    model.colors.advanced ? (
      <div className="space-y-5">
        {model.colors.groups.map((group) => (
          <section className="space-y-2" key={group.id}>
            <h4 className="text-sm font-medium text-foreground">{group.title}</h4>
            <div className="grid gap-1">{group.fields.map(renderColorField)}</div>
          </section>
        ))}
        {model.colors.emptyMessage === null ? null : (
          <p className="text-xs text-muted-foreground">{model.colors.emptyMessage}</p>
        )}
      </div>
    ) : (
      <div className="grid gap-1">{model.colors.guidedFields.map(renderColorField)}</div>
    );

  const clampPosition = (x: number, y: number, widthOverride?: number) => {
    const panel = panelRef.current;
    const margin = 8;
    // The caller passes a width when it has just shrunk the panel: the DOM
    // still reports the old one until React commits.
    const width = widthOverride ?? panel?.offsetWidth ?? 0;
    return {
      x: Math.min(Math.max(x, margin), Math.max(margin, window.innerWidth - width - margin)),
      // Keep at least the header on screen even when dragged far down.
      y: Math.min(Math.max(y, margin), Math.max(margin, window.innerHeight - 48)),
    };
  };

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Buttons in the header keep their own behavior.
    if ((event.target as HTMLElement).closest("button, input, a")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = { dx: event.clientX - rect.x, dy: event.clientY - rect.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffsetRef.current;
    if (!offset) return;
    setPosition(clampPosition(event.clientX - offset.dx, event.clientY - offset.dy));
  };

  const endDrag = () => {
    dragOffsetRef.current = null;
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    // The grip drags the bottom-right corner, so the top-left must hold
    // still; the default parking spot is anchored bottom-right and would
    // slide, so it converts to an explicit position first.
    if (position === null) setPosition(clampPosition(rect.x, rect.y));
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    const margin = 8;
    const MIN_WIDTH = 280;
    const MIN_HEIGHT = 220;
    // Grow only into the space right of and below the panel's own corner,
    // otherwise a panel parked away from the top-left pushes its far edges
    // (and this grip) off screen.
    const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - margin - start.left);
    const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - margin - start.top);
    setSize({
      width: Math.min(Math.max(start.width + event.clientX - start.pointerX, MIN_WIDTH), maxWidth),
      height: Math.min(
        Math.max(start.height + event.clientY - start.pointerY, MIN_HEIGHT),
        maxHeight,
      ),
    });
  };

  const endResize = () => {
    resizeStartRef.current = null;
  };

  return (
    <div
      aria-label={model.title}
      className={cn(
        "dialog-glass fixed z-[110] flex max-h-[min(42rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border text-popover-foreground",
        position === null && "bottom-4 right-4",
        isMinimized && "max-h-none",
      )}
      data-theme-editor-panel
      ref={panelRef}
      role="dialog"
      style={{
        ...(position ? { left: position.x, top: position.y } : {}),
        ...(size ? { width: size.width } : {}),
        // A chosen height only applies expanded; minimized keeps hugging the
        // header. The viewport stays the ceiling either way.
        ...(size && !isMinimized ? { height: size.height, maxHeight: "calc(100dvh - 1rem)" } : {}),
      }}
    >
      <div
        className="flex cursor-grab touch-none select-none items-center gap-1 border-b border-border/70 px-3 py-2 active:cursor-grabbing"
        onPointerCancel={endDrag}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={endDrag}
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="shrink-0 truncate text-sm font-medium">{model.title}</h2>
          {model.statusText === null ? null : (
            <p className="truncate text-xs text-muted-foreground">{model.statusText}</p>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={model.inspect.ariaLabel}
                aria-pressed={model.inspect.active}
                size="xs"
                variant={model.inspect.active ? "secondary" : "ghost"}
                onClick={() => {
                  if (isInspecting) {
                    clearInspectorSelection();
                    return;
                  }
                  setIsInspecting(true);
                }}
              >
                <MousePointer2Icon />
                {model.inspect.label}
              </Button>
            }
          />
          <TooltipPopup data-theme-editor-panel="">{model.inspect.tooltip}</TooltipPopup>
        </Tooltip>
        <Button
          aria-label={model.minimize.ariaLabel}
          size="icon-xs"
          variant="ghost"
          onClick={() => setIsMinimized(!isMinimized)}
        >
          {isMinimized ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
        <Button
          aria-label={model.close.ariaLabel}
          size="icon-xs"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
        </Button>
      </div>

      {isMinimized ? null : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3 pl-3 pr-1.5">
            {renderNameField()}
            {/* Inline and above the color list: the panel scrolls, and an
                error parked below every role would go unseen. */}
            {model.error ? (
              <p aria-live="polite" className="text-sm text-destructive">
                {model.error}
              </p>
            ) : null}
            {renderAppearanceButtons()}
            <div className="space-y-3">
              {renderColorsHeader()}
              {renderColorFields()}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border/70 px-3 py-2">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {model.footer.cancelLabel}
            </Button>
            <Button disabled={model.footer.submitDisabled} size="sm" onClick={handleSubmit}>
              {model.footer.submitIcon === "plus" ? (
                <PlusIcon />
              ) : model.footer.submitIcon === "paintbrush" ? (
                <PaintbrushIcon />
              ) : null}
              {model.footer.submitLabel}
            </Button>
          </div>
          <div
            aria-hidden
            className="absolute bottom-0 right-0 z-10 flex size-5 cursor-se-resize touch-none select-none items-end justify-end p-1 text-muted-foreground/70"
            onPointerCancel={endResize}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={endResize}
          >
            <svg
              className="size-2.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
              viewBox="0 0 8 8"
            >
              <path d="M7 1 1 7M7 4.5 4.5 7" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
