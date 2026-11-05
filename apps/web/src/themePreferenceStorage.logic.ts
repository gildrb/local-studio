import * as Schema from "effect/Schema";

import {
  canonicalThemePreference,
  getThemePreferenceMode,
  isKnownThemePreference,
  parseThemeHalves,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  ThemePreference,
  type ThemeAppearance,
  type ThemeHalves,
  type ThemePreferenceMode,
} from "./themePalette";

export const THEME_PREFERENCE_STORAGE_KEY = "t3code:theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export class ThemeStorageError extends Schema.TaggedError<ThemeStorageError>()(
  "ThemeStorageError",
  {
    operation: Schema.Literals(["read", "write"]),
    storageKey: Schema.String,
    theme: Schema.optional(ThemePreference),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} theme preference for ${this.storageKey}.`;
  }
}

export const isThemeStorageError = Schema.is(ThemeStorageError);

export function readStoredThemeHalves(storage: Storage): ThemeHalves | null {
  try {
    return parseThemeHalves(storage.getItem(THEME_HALVES_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * The stored mix as written, without resolvability pruning. An environment
 * published id resolves only once its set has streamed in, so a write that
 * merged over the pruned parse would silently erase that half whenever the
 * other one changed before the set arrived.
 */
export function readStoredThemeHalvesRaw(storage: Storage): { light?: string; dark?: string } {
  try {
    const value: unknown = JSON.parse(storage.getItem(THEME_HALVES_STORAGE_KEY) ?? "null");
    if (value === null || typeof value !== "object") return {};
    const halves: { light?: string; dark?: string } = {};
    for (const appearance of ["light", "dark"] as const) {
      const themeId: unknown = Reflect.get(value, appearance);
      if (typeof themeId === "string") halves[appearance] = themeId;
    }
    return halves;
  } catch {
    return {};
  }
}

export function readStoredFollowSystem(storage: Storage, theme: ThemePreference): boolean {
  try {
    const raw = storage.getItem(THEME_FOLLOW_SYSTEM_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Fall back to the legacy theme value when the separate preference is unavailable.
  }
  return theme === "system";
}

function isThemePreferenceMode(value: string | null): value is ThemePreferenceMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredAppearanceMode(
  storage: Storage,
  theme: ThemePreference,
): ThemePreferenceMode {
  try {
    const raw = storage.getItem(THEME_APPEARANCE_MODE_STORAGE_KEY);
    if (isThemePreferenceMode(raw)) return raw;
  } catch {
    // Fall back to the legacy preference below when storage is unavailable.
  }
  if (readStoredFollowSystem(storage, theme)) return "system";
  return getThemePreferenceMode(theme) ?? "light";
}

export function writeStoredAppearanceMode(
  storage: Storage,
  appearanceMode: ThemePreferenceMode,
): void {
  try {
    // The legacy follow-system flag is read-only migration input now; the
    // mode key is the single source of truth.
    storage.setItem(THEME_APPEARANCE_MODE_STORAGE_KEY, appearanceMode);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
      cause,
    });
  }
}

export function readStoredThemePreference(storage: Storage): ThemePreference {
  let raw: string | null;
  try {
    raw = storage.getItem(THEME_PREFERENCE_STORAGE_KEY);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "read",
      storageKey: THEME_PREFERENCE_STORAGE_KEY,
      cause,
    });
  }
  if (raw !== null && isKnownThemePreference(raw)) {
    return canonicalThemePreference(raw);
  }
  return DEFAULT_THEME_PREFERENCE;
}

export function writeStoredThemePreference(storage: Storage, theme: ThemePreference): void {
  try {
    storage.setItem(THEME_PREFERENCE_STORAGE_KEY, theme);
  } catch (cause) {
    throw new ThemeStorageError({
      operation: "write",
      storageKey: THEME_PREFERENCE_STORAGE_KEY,
      theme,
      cause,
    });
  }
}

/**
 * Replace the whole-theme preference. The current mode is preserved first so a
 * fresh System preference is not re-inferred from the new theme's base
 * appearance, and the automatic-mode mix is dropped (restored if the write fails).
 */
export function changeStoredThemePreference(
  storage: Storage,
  next: ThemePreference,
  currentTheme: ThemePreference,
): ThemeStorageError | null {
  try {
    writeStoredAppearanceMode(storage, readStoredAppearanceMode(storage, currentTheme));
    const previousHalvesRaw = storage.getItem(THEME_HALVES_STORAGE_KEY);
    storage.removeItem(THEME_HALVES_STORAGE_KEY);
    try {
      writeStoredThemePreference(storage, next);
    } catch (cause) {
      if (previousHalvesRaw !== null) {
        try {
          storage.setItem(THEME_HALVES_STORAGE_KEY, previousHalvesRaw);
        } catch {
          // Storage is failing wholesale; the outer handler reports it.
        }
      }
      throw cause;
    }
  } catch (cause) {
    return isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "write",
          storageKey: THEME_PREFERENCE_STORAGE_KEY,
          theme: next,
          cause,
        });
  }
  return null;
}

export function changeStoredAppearanceMode(
  storage: Storage,
  appearanceMode: ThemePreferenceMode,
): ThemeStorageError | null {
  try {
    writeStoredAppearanceMode(storage, appearanceMode);
  } catch (cause) {
    return isThemeStorageError(cause)
      ? cause
      : new ThemeStorageError({
          operation: "write",
          storageKey: THEME_APPEARANCE_MODE_STORAGE_KEY,
          cause,
        });
  }
  return null;
}

export function resolveFollowSystemAppearanceMode(
  currentMode: ThemePreferenceMode,
  theme: ThemePreference,
  nextFollowSystem: boolean,
): ThemePreferenceMode {
  return nextFollowSystem
    ? "system"
    : currentMode === "system"
      ? (getThemePreferenceMode(theme) ?? "light")
      : currentMode;
}

export function changeStoredThemeHalf(
  storage: Storage,
  appearance: ThemeAppearance,
  themeId: string | null,
): ThemeStorageError | null {
  try {
    const next: { light?: string; dark?: string } = { ...readStoredThemeHalvesRaw(storage) };
    if (themeId === null) delete next[appearance];
    else next[appearance] = themeId;
    if (next.light === undefined && next.dark === undefined) {
      storage.removeItem(THEME_HALVES_STORAGE_KEY);
    } else {
      storage.setItem(THEME_HALVES_STORAGE_KEY, JSON.stringify(next));
    }
  } catch (cause) {
    return new ThemeStorageError({
      operation: "write",
      storageKey: THEME_HALVES_STORAGE_KEY,
      cause,
    });
  }
  return null;
}

export function clearStoredThemeHalves(storage: Storage): ThemeStorageError | null {
  try {
    storage.removeItem(THEME_HALVES_STORAGE_KEY);
  } catch (cause) {
    return new ThemeStorageError({
      operation: "write",
      storageKey: THEME_HALVES_STORAGE_KEY,
      cause,
    });
  }
  return null;
}
