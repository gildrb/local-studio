import type { DesktopBridge } from "@t3tools/contracts";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  applyThemePalette,
  CUSTOM_THEMES_STORAGE_KEY,
  invalidateCustomThemes,
  getThemePreferenceMode,
  resolveDesktopTheme,
  resolveThemeAppearance,
  resolveThemeHalf,
  THEME_PREVIEW_ID,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  ThemePreference,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreferenceMode,
} from "../themePalette";
import {
  changeStoredAppearanceMode,
  changeStoredThemeHalf,
  changeStoredThemePreference,
  clearStoredThemeHalves,
  DEFAULT_THEME_PREFERENCE,
  isThemeStorageError,
  readStoredAppearanceMode,
  readStoredThemeHalves as readThemeHalvesFrom,
  readStoredThemeHalvesRaw as readThemeHalvesRawFrom,
  readStoredThemePreference,
  resolveFollowSystemAppearanceMode,
  THEME_PREFERENCE_STORAGE_KEY as STORAGE_KEY,
  ThemeStorageError,
  writeStoredThemePreference,
} from "../themePreferenceStorage.logic";

type Theme = ThemePreference;
type ThemeSnapshot = {
  theme: Theme;
  resolvedTheme: ThemeAppearance;
  systemDark: boolean;
  followSystem: boolean;
  appearanceMode: ThemePreferenceMode;
  themeHalves: ThemeHalves | null;
};

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;

const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: DEFAULT_THEME_PREFERENCE,
  resolvedTheme: "light",
  systemDark: false,
  followSystem: true,
  appearanceMode: "system",
  themeHalves: null,
};

/** Live read of the stored appearance mix, for callers that must not rely on
 * a render-time snapshot (for example rollback after an async dialog). */
export function readThemeHalves(): ThemeHalves | null {
  return readStoredThemeHalves();
}

/**
 * The stored mix as written, without resolvability pruning. Flows that
 * rebuild the whole mix must capture this before a `setTheme` clears it: a
 * published id resolves only once its set has streamed in, and treating "not
 * resolvable yet" as "absent" silently rewrites that half.
 */
export function readThemeHalvesRaw(): { light?: string; dark?: string } {
  if (typeof window === "undefined") return {};
  return readThemeHalvesRawFrom(window.localStorage);
}

function readStoredThemeHalves(): ThemeHalves | null {
  if (typeof window === "undefined") return null;
  return readThemeHalvesFrom(window.localStorage);
}

function themeHalvesSignature(halves: ThemeHalves | null): string {
  return `${halves?.light ?? ""}|${halves?.dark ?? ""}`;
}

const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

export class DesktopThemeSyncError extends Schema.TaggedError<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: ThemePreference,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let snapshotStale = true;
let lastDesktopTheme: "light" | "dark" | "system" | null = null;
let lastAppliedTheme: Omit<ThemeSnapshot, "resolvedTheme"> | null = null;
let themeStorageReadFailure: ThemeStorageError | null = null;

function emitChange() {
  snapshotStale = true;
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

export function readAppearanceModePreference(theme: Theme): ThemePreferenceMode {
  if (typeof window === "undefined") {
    return theme === "system" ? "system" : (getThemePreferenceMode(theme) ?? "light");
  }
  return readStoredAppearanceMode(window.localStorage, theme);
}

export function readThemePreference(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT.theme;
  return readStoredThemePreference(window.localStorage);
}

export function writeThemePreference(theme: Theme): void {
  if (typeof window === "undefined") return;
  writeStoredThemePreference(window.localStorage, theme);
  themeStorageReadFailure = null;
}

function getStored(): Theme {
  if (themeStorageReadFailure !== null) {
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
  try {
    return readThemePreference();
  } catch (cause) {
    const error = isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "read",
          storageKey: STORAGE_KEY,
          cause,
        });
    themeStorageReadFailure = error;
    console.error(error.message, {
      operation: error.operation,
      storageKey: error.storageKey,
      ...safeErrorLogAttributes(error),
    });
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) {
    return element;
  }

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const rootStyles = getComputedStyle(document.documentElement);
  const themeChromeColor = document.documentElement.dataset.themeId
    ? normalizeThemeColor(rootStyles.getPropertyValue("--app-chrome-background"))
    : null;
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = themeChromeColor ?? surfaceColor ?? fallbackColor;
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  // Update every theme-color meta so any element another layer added (for
  // example a media-scoped one) carries the resolved color too.
  const themeColorMetas = document.querySelectorAll<HTMLMetaElement>(
    `meta[name="${THEME_COLOR_META_NAME}"]`,
  );
  if (themeColorMetas.length === 0) {
    ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
    return;
  }
  for (const element of themeColorMetas) {
    element.setAttribute("content", backgroundColor);
  }
}

function applyTheme(theme: Theme, { suppressTransitions = false, preservePreview = true } = {}) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  // Keep the editor's draft visible until an explicit refresh restores the selection.
  if (preservePreview && document.documentElement.dataset?.themeId === THEME_PREVIEW_ID) {
    return;
  }
  const appearanceMode = readAppearanceModePreference(theme);
  const followSystem = appearanceMode === "system";
  const systemDark = followSystem ? getSystemDark() : false;
  const themeHalves = readStoredThemeHalves();
  if (
    lastAppliedTheme?.theme === theme &&
    lastAppliedTheme.systemDark === systemDark &&
    lastAppliedTheme.followSystem === followSystem &&
    lastAppliedTheme.appearanceMode === appearanceMode &&
    themeHalvesSignature(lastAppliedTheme.themeHalves) === themeHalvesSignature(themeHalves)
  ) {
    syncDesktopTheme(theme, followSystem, appearanceMode);
    return;
  }

  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const resolvedAppearance = resolveThemeAppearance(
    theme,
    systemDark,
    followSystem,
    appearanceMode,
    themeHalves,
  );
  applyThemePalette(resolveThemeHalf(theme, themeHalves, resolvedAppearance), resolvedAppearance);
  document.documentElement.classList.toggle("dark", resolvedAppearance === "dark");
  lastAppliedTheme = { theme, systemDark, followSystem, appearanceMode, themeHalves };
  syncBrowserChromeTheme();
  syncDesktopTheme(theme, followSystem, appearanceMode);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  theme: Theme,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
  halves: ThemeHalves | null = readStoredThemeHalves(),
): Promise<void> {
  try {
    await bridge.setTheme(resolveDesktopTheme(theme, followSystem, appearanceMode, halves));
  } catch (cause) {
    throw new DesktopThemeSyncError({ theme, cause });
  }
}

export function syncDesktopTheme(
  theme: Theme,
  followSystem?: boolean,
  appearanceMode?: ThemePreferenceMode,
) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  const halves = readStoredThemeHalves();
  const desktopTheme = resolveDesktopTheme(theme, followSystem, appearanceMode, halves);
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopTheme === desktopTheme) {
    return;
  }

  lastDesktopTheme = desktopTheme;
  void syncDesktopThemePreference(bridge, theme, followSystem, appearanceMode, halves).catch(
    (cause: unknown) => {
      const error = isDesktopThemeSyncError(cause)
        ? cause
        : new DesktopThemeSyncError({ theme, cause });
      console.error(error.message, {
        theme: error.theme,
        ...safeErrorLogAttributes(error),
      });
      if (lastDesktopTheme === desktopTheme) {
        lastDesktopTheme = null;
      }
    },
  );
}

// Apply immediately on module load to prevent flash
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  // Reading the preference hits localStorage, so only recompute after a
  // change was signalled; useTheme consumers call this on every render.
  if (!snapshotStale && lastSnapshot) return lastSnapshot;
  snapshotStale = false;
  const theme = getStored();
  const appearanceMode = readAppearanceModePreference(theme);
  const followSystem = appearanceMode === "system";
  const systemDark = followSystem ? getSystemDark() : false;
  const themeHalves = readStoredThemeHalves();

  const resolvedTheme = resolveThemeAppearance(
    theme,
    systemDark,
    followSystem,
    appearanceMode,
    themeHalves,
  );
  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.resolvedTheme === resolvedTheme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.followSystem === followSystem &&
    lastSnapshot.appearanceMode === appearanceMode &&
    themeHalvesSignature(lastSnapshot.themeHalves) === themeHalvesSignature(themeHalves)
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, resolvedTheme, systemDark, followSystem, appearanceMode, themeHalves };
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function handleSystemAppearanceChange() {
  const storedTheme = getStored();
  if (readAppearanceModePreference(storedTheme) === "system") {
    applyTheme(storedTheme, { suppressTransitions: true });
  }
  emitChange();
}

function handleStorageChange(e: StorageEvent) {
  if (e.key === STORAGE_KEY) {
    themeStorageReadFailure = null;
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else if (e.key === THEME_FOLLOW_SYSTEM_STORAGE_KEY) {
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else if (e.key === THEME_APPEARANCE_MODE_STORAGE_KEY || e.key === THEME_HALVES_STORAGE_KEY) {
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  } else if (e.key === CUSTOM_THEMES_STORAGE_KEY || e.key === null) {
    if (e.key === null) themeStorageReadFailure = null;
    invalidateCustomThemes();
    lastAppliedTheme = null;
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
  }
}

let removeWindowListeners: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  // The system-preference and cross-tab listeners are shared by all
  // subscribers; each event applies the theme once and notifies everyone.
  if (!removeWindowListeners) {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
    mq?.addEventListener("change", handleSystemAppearanceChange);
    window.addEventListener("storage", handleStorageChange);
    removeWindowListeners = () => {
      mq?.removeEventListener("change", handleSystemAppearanceChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    if (listeners.length === 0) {
      removeWindowListeners?.();
      removeWindowListeners = null;
    }
  };
}

function logThemeStorageError(error: ThemeStorageError, theme?: Theme): void {
  console.error(error.message, {
    operation: error.operation,
    storageKey: error.storageKey,
    ...(theme === undefined ? {} : { theme }),
    ...safeErrorLogAttributes(error),
  });
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { theme, resolvedTheme } = snapshot;

  const setTheme = useCallback((next: Theme): boolean => {
    if (typeof window === "undefined") return false;
    const error = changeStoredThemePreference(window.localStorage, next, getStored());
    if (error !== null) {
      logThemeStorageError(error, next);
      return false;
    }
    themeStorageReadFailure = null;
    applyTheme(next, { suppressTransitions: true });
    emitChange();
    return true;
  }, []);

  const setAppearanceMode = useCallback((nextAppearanceMode: ThemePreferenceMode): boolean => {
    if (typeof window === "undefined") return false;
    const error = changeStoredAppearanceMode(window.localStorage, nextAppearanceMode);
    if (error !== null) {
      logThemeStorageError(error);
      return false;
    }
    themeStorageReadFailure = null;
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
    return true;
  }, []);

  const setFollowSystem = useCallback(
    (nextFollowSystem: boolean): boolean =>
      setAppearanceMode(
        resolveFollowSystemAppearanceMode(
          readAppearanceModePreference(theme),
          theme,
          nextFollowSystem,
        ),
      ),
    [setAppearanceMode, theme],
  );

  const setThemeHalf = useCallback(
    (appearance: ThemeAppearance, themeId: string | null): boolean => {
      if (typeof window === "undefined") return false;
      const error = changeStoredThemeHalf(window.localStorage, appearance, themeId);
      if (error !== null) {
        logThemeStorageError(error);
        return false;
      }
      applyTheme(getStored(), { suppressTransitions: true });
      emitChange();
      return true;
    },
    [],
  );

  const clearThemeHalves = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    const error = clearStoredThemeHalves(window.localStorage);
    if (error !== null) {
      logThemeStorageError(error);
      return false;
    }
    applyTheme(getStored(), { suppressTransitions: true });
    emitChange();
    return true;
  }, []);

  const refreshTheme = useCallback(({ preservePreview = false } = {}) => {
    if (typeof window === "undefined") return;
    lastAppliedTheme = null;
    applyTheme(getStored(), { suppressTransitions: true, preservePreview });
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [snapshot.appearanceMode, theme]);

  return {
    theme,
    setTheme,
    setAppearanceMode,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    refreshTheme,
    followSystem: snapshot.followSystem,
    appearanceMode: snapshot.appearanceMode,
    resolvedTheme,
    themeHalves: snapshot.themeHalves,
  } as const;
}
