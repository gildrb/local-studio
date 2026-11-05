import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import type { EnvironmentTheme } from "@t3tools/contracts";
import type { EnvironmentIdentificationMode } from "@t3tools/contracts/settings";
import { resolveEnvironmentIdentificationMode } from "@t3tools/web/src/components/SidebarStageBackdrop.logic.ts";
import { publishedThemeDefinitions } from "@t3tools/web/src/hooks/useEnvironmentTheme.logic.ts";
import {
  getThemeColorsForMode,
  getThemeDefinition,
  isThemeColor,
  resolveThemeAppearance,
  resolveThemeHalf,
  setEnvironmentThemes,
  subscribeToCustomThemes,
  THEME_COLOR_ROLES,
  THEME_PREVIEW_ID,
  themeAllowsSidebarArtwork,
  themeColorToHex,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeHalves,
  type ThemePreference,
  type ThemePreferenceMode,
} from "@t3tools/web/src/themePalette.ts";
import {
  changeStoredAppearanceMode,
  changeStoredThemeHalf,
  changeStoredThemePreference,
  clearStoredThemeHalves,
  DEFAULT_THEME_PREFERENCE,
  readStoredAppearanceMode,
  readStoredThemeHalves,
  readStoredThemeHalvesRaw,
  readStoredThemePreference,
  resolveFollowSystemAppearanceMode,
  type ThemeStorageError,
} from "@t3tools/web/src/themePreferenceStorage.logic.ts";
import * as Equal from "effect/Equal";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { FeatureContext } from "./feature.ts";

export type ThemePreferenceSnapshot = {
  readonly theme: ThemePreference;
  readonly appearanceMode: ThemePreferenceMode;
  readonly followSystem: boolean;
  readonly themeHalves: ThemeHalves | null;
  readonly resolvedTheme: ThemeAppearance;
  readonly libraryRevision: number;
};

export type AppThemePaletteView = {
  readonly themeId: string;
  readonly colors: Readonly<Partial<Record<ThemeColorRole, string>>>;
};

export type AppThemeView = {
  readonly appearance: ThemeAppearance;
  readonly palette: AppThemePaletteView | null;
};

export type ThemeColorPreview = {
  readonly appearance: ThemeAppearance;
  readonly colors: Readonly<Partial<Record<ThemeColorRole, string>>>;
};

export type ThemePreferenceStore = {
  readonly snapshotAtom: Atom.Atom<ThemePreferenceSnapshot>;
  readonly appThemeAtom: Atom.Atom<AppThemeView>;
  readonly readTheme: () => ThemePreference;
  readonly readThemeHalves: () => ThemeHalves | null;
  readonly readThemeHalvesRaw: () => { light?: string; dark?: string };
  readonly readAppearanceMode: (theme: ThemePreference) => ThemePreferenceMode;
  readonly setTheme: (next: ThemePreference) => boolean;
  readonly setAppearanceMode: (next: ThemePreferenceMode) => boolean;
  readonly setFollowSystem: (next: boolean) => boolean;
  readonly setThemeHalf: (appearance: ThemeAppearance, themeId: string | null) => boolean;
  readonly clearThemeHalves: () => boolean;
  readonly setSystemAppearance: (appearance: ThemeAppearance) => void;
  readonly refreshLibrary: () => void;
  readonly previewAtom: Atom.Atom<ThemeColorPreview | null>;
  readonly setPreview: (appearance: ThemeAppearance, colors: ThemeColors) => void;
  readonly clearPreview: () => void;
  readonly identificationModeAtom: Atom.Atom<EnvironmentIdentificationMode>;
};

function logThemeStorageError(error: ThemeStorageError, theme?: ThemePreference): void {
  console.error(error.message, {
    operation: error.operation,
    storageKey: error.storageKey,
    ...(theme === undefined ? {} : { theme }),
    ...safeErrorLogAttributes(error),
  });
}

function hexColors(
  colors: Readonly<Partial<Record<ThemeColorRole, string>>>,
): Readonly<Partial<Record<ThemeColorRole, string>>> {
  const result: Partial<Record<ThemeColorRole, string>> = {};
  for (const role of THEME_COLOR_ROLES) {
    const value = colors[role];
    const hex = value === undefined ? null : themeColorToHex(value);
    if (hex !== null) result[role] = hex;
  }
  return result;
}

const stores = new WeakMap<AtomRegistry.AtomRegistry, ThemePreferenceStore>();

function createThemePreferenceStore(context: FeatureContext): ThemePreferenceStore {
  const { registry, storage, state } = context;
  const revisionAtom = Atom.make(0).pipe(Atom.keepAlive);
  const libraryRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);
  const systemAppearanceAtom = Atom.make<ThemeAppearance>("dark").pipe(Atom.keepAlive);
  const previewAtom = Atom.make<ThemeColorPreview | null>(null).pipe(Atom.keepAlive);
  const bumpLibrary = () =>
    registry.set(libraryRevisionAtom, registry.get(libraryRevisionAtom) + 1);
  subscribeToCustomThemes(bumpLibrary);
  let lastPublished: ReadonlyArray<EnvironmentTheme> | null = null;
  registry.subscribe(
    state.primaryServerConfigAtom,
    (config) => {
      const published = config?.environmentThemes ?? [];
      if (lastPublished !== null && Equal.equals(lastPublished, published)) return;
      lastPublished = published;
      if (setEnvironmentThemes(publishedThemeDefinitions(published))) bumpLibrary();
    },
    { immediate: true },
  );
  const readTheme = (): ThemePreference => {
    try {
      return readStoredThemePreference(storage);
    } catch {
      return DEFAULT_THEME_PREFERENCE;
    }
  };
  const snapshotAtom = Atom.make((get): ThemePreferenceSnapshot => {
    get(revisionAtom);
    const libraryRevision = get(libraryRevisionAtom);
    const theme = readTheme();
    const appearanceMode = readStoredAppearanceMode(storage, theme);
    const followSystem = appearanceMode === "system";
    const themeHalves = readStoredThemeHalves(storage);
    const systemDark = followSystem ? get(systemAppearanceAtom) === "dark" : false;
    return {
      theme,
      appearanceMode,
      followSystem,
      themeHalves,
      resolvedTheme: resolveThemeAppearance(
        theme,
        systemDark,
        followSystem,
        appearanceMode,
        themeHalves,
      ),
      libraryRevision,
    };
  }).pipe(Atom.keepAlive);
  const appThemeAtom = Atom.make((get): AppThemeView => {
    const snapshot = get(snapshotAtom);
    const preview = get(previewAtom);
    const half = resolveThemeHalf(snapshot.theme, snapshot.themeHalves, snapshot.resolvedTheme);
    const palette = getThemeDefinition(half);
    if (preview !== null) {
      const base =
        palette === null
          ? {}
          : (getThemeColorsForMode(palette, preview.appearance) ?? palette.colors);
      return {
        appearance: preview.appearance,
        palette: { themeId: THEME_PREVIEW_ID, colors: hexColors({ ...base, ...preview.colors }) },
      };
    }
    if (palette === null) return { appearance: snapshot.resolvedTheme, palette: null };
    const colors = getThemeColorsForMode(palette, snapshot.resolvedTheme) ?? palette.colors;
    return {
      appearance: snapshot.resolvedTheme,
      palette: { themeId: palette.id, colors: hexColors(colors) },
    };
  }).pipe(Atom.keepAlive);
  const identificationModeAtom = Atom.make((get): EnvironmentIdentificationMode => {
    const snapshot = get(snapshotAtom);
    const previewing = get(previewAtom) !== null;
    const activeTheme = resolveThemeHalf(
      snapshot.theme,
      snapshot.themeHalves,
      snapshot.resolvedTheme,
    );
    return resolveEnvironmentIdentificationMode({
      mode: get(context.clientSettingsAtom).environmentIdentificationMode,
      settingsHydrated: true,
      paletteThemeActive: previewing || getThemeDefinition(activeTheme) !== null,
      paletteThemeAllowsArtwork: previewing ? false : themeAllowsSidebarArtwork(activeTheme),
    });
  });
  const changed = (error: ThemeStorageError | null, theme?: ThemePreference): boolean => {
    if (error !== null) {
      logThemeStorageError(error, theme);
      return false;
    }
    registry.set(revisionAtom, registry.get(revisionAtom) + 1);
    return true;
  };
  const setAppearanceMode = (next: ThemePreferenceMode) =>
    changed(changeStoredAppearanceMode(storage, next));
  return {
    snapshotAtom,
    appThemeAtom,
    readTheme,
    readThemeHalves: () => readStoredThemeHalves(storage),
    readThemeHalvesRaw: () => readStoredThemeHalvesRaw(storage),
    readAppearanceMode: (theme) => readStoredAppearanceMode(storage, theme),
    setTheme: (next) => changed(changeStoredThemePreference(storage, next, readTheme()), next),
    setAppearanceMode,
    setFollowSystem: (next) => {
      const theme = registry.get(snapshotAtom).theme;
      return setAppearanceMode(
        resolveFollowSystemAppearanceMode(readStoredAppearanceMode(storage, theme), theme, next),
      );
    },
    setThemeHalf: (appearance, themeId) =>
      changed(changeStoredThemeHalf(storage, appearance, themeId)),
    clearThemeHalves: () => changed(clearStoredThemeHalves(storage)),
    setSystemAppearance: (appearance) => {
      if (registry.get(systemAppearanceAtom) !== appearance) {
        registry.set(systemAppearanceAtom, appearance);
      }
    },
    refreshLibrary: bumpLibrary,
    previewAtom,
    setPreview: (appearance, colors) => {
      const current = registry.get(previewAtom);
      const kept: Partial<Record<ThemeColorRole, string>> =
        current === null ? {} : { ...current.colors };
      for (const role of THEME_COLOR_ROLES) {
        const value = colors[role];
        if (isThemeColor(value)) kept[role] = value;
      }
      registry.set(previewAtom, { appearance, colors: kept });
    },
    clearPreview: () => {
      if (registry.get(previewAtom) !== null) registry.set(previewAtom, null);
    },
    identificationModeAtom,
  };
}

export function themePreferenceStore(context: FeatureContext): ThemePreferenceStore {
  const existing = stores.get(context.registry);
  if (existing !== undefined) return existing;
  const store = createThemePreferenceStore(context);
  stores.set(context.registry, store);
  return store;
}
