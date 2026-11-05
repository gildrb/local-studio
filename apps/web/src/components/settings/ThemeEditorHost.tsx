import { lazy, Suspense, useCallback, useSyncExternalStore } from "react";

import { useTheme } from "../../hooks/useTheme";
import {
  getThemeDefinition,
  subscribeToCustomThemes,
  type ThemeAppearance,
  type ThemeDefinition,
} from "../../themePalette";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { resolveThemeEditorSaved } from "./ThemeEditorHost.logic";
import { useThemeEditorStore } from "./themeEditorStore";

// The host mounts above the router on every page, but the editor body only
// renders once a session opens; lazy-loading it keeps the editor UI out of
// the startup chunk.
const ThemeEditorPanel = lazy(() =>
  import("./ThemeEditorPanel").then((module) => ({ default: module.ThemeEditorPanel })),
);

function useThemeDefinition(id: string | null | undefined) {
  return useSyncExternalStore(
    subscribeToCustomThemes,
    () => (id ? (getThemeDefinition(id) ?? null) : null),
    () => null,
  );
}

/**
 * Renders the theme editor above the router. The editor paints its draft on
 * the live app, so it has to outlive the settings route: the point is to walk
 * through threads, panels, and pages while the colors are being tuned.
 */
export function ThemeEditorHost() {
  const session = useThemeEditorStore((store) => store.session);
  const closeThemeEditor = useThemeEditorStore((store) => store.closeThemeEditor);
  const { theme, setTheme, themeHalves, refreshTheme } = useTheme();
  // A saved definition can change without its id changing between sessions.
  const editingTheme = useThemeDefinition(session?.editingThemeId);
  const seedTheme = useThemeDefinition(session?.seedThemeId);

  // The panel reports which path it actually took: a theme removed while its
  // editor is open resolves to null there, so the save becomes a create even
  // though the session still names it.
  const handleSaved = useCallback(
    (
      savedTheme: ThemeDefinition,
      { created, mergedAppearance }: { created: boolean; mergedAppearance?: ThemeAppearance },
    ) => {
      const decision = resolveThemeEditorSaved({
        savedTheme,
        created,
        mergedAppearance,
        baseThemeId: getThemeDefinition(theme)?.id ?? null,
        themeHalves,
      });
      if (decision.kind === "saved") {
        if (decision.refresh) refreshTheme();
        toastManager.add(stackedThreadToast(decision.toast));
        return true;
      }
      if (!setTheme(decision.themeId)) {
        toastManager.add(stackedThreadToast(decision.failureToast));
        return false;
      }
      toastManager.add(stackedThreadToast(decision.successToast));
      return true;
    },
    [refreshTheme, setTheme, theme, themeHalves],
  );

  if (!session) return null;

  return (
    <Suspense fallback={null}>
      <ThemeEditorPanel
        editingTheme={editingTheme}
        initialAppearance={session.initialAppearance}
        key={session.id}
        onOpenChange={(open) => {
          if (!open) closeThemeEditor();
        }}
        onSaved={handleSaved}
        open
        restoreTheme={refreshTheme}
        seedName={session.seedName ?? undefined}
        seedTheme={seedTheme}
      />
    </Suspense>
  );
}
