import { parseThemeFile, THEME_FILE_VERSION, type ThemeDefinition } from "../../themePalette";
import {
  humanizeThemeName,
  isVsCodeThemeFile,
  parseVsCodeThemeFile,
} from "../../vscodeThemeImport";

export const MAX_THEME_FILE_BYTES = 256 * 1024;

export const MAX_HIGHLIGHTED_JSON_LENGTH = 20_000;

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export function describeOversizedThemeFile(bytes: number): string | null {
  if (bytes <= MAX_THEME_FILE_BYTES) return null;
  return `That file is ${formatByteSize(bytes)}. Theme files are only a few KB, so this one was not read (limit ${formatByteSize(MAX_THEME_FILE_BYTES)}).`;
}

function escapeJsonHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

export function highlightJson(value: string): string {
  const tokenPattern =
    /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;
  let highlighted = "";
  let cursor = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    highlighted += escapeJsonHtml(value.slice(cursor, index));

    let tokenClass = "text-[var(--app-theme-secondary-foreground,var(--color-amber-600))]";
    if (token.startsWith('"')) {
      tokenClass = /^\s*:/.test(value.slice(index + token.length))
        ? "text-[var(--app-theme-accent,var(--color-blue-600))]"
        : "text-[var(--app-theme-message-action,var(--color-emerald-600))]";
    } else if (token === "true" || token === "false" || token === "null") {
      tokenClass = "text-[var(--app-theme-accent-surface-foreground,var(--color-violet-600))]";
    }
    highlighted += `<span class="${tokenClass}">${escapeJsonHtml(token)}</span>`;
    cursor = index + token.length;
  }

  return highlighted + escapeJsonHtml(value.slice(cursor));
}

export function parseThemeImportValue(value: unknown): ThemeDefinition {
  return isVsCodeThemeFile(value) ? parseVsCodeThemeFile(value) : parseThemeFile(value);
}

export function isThemeInstalled(
  theme: ThemeDefinition,
  customThemes: ReadonlyArray<ThemeDefinition>,
): boolean {
  return customThemes.some((existing) => existing.id === theme.id);
}

export function themeImportFailure(name: string, cause: unknown, fallback: string): string {
  return `${name}: ${cause instanceof Error ? cause.message : fallback}`;
}

export const THEME_IMPORT_READ_FAILURE_MESSAGE =
  "Could not read that file. Paste the JSON below instead.";
export const THEME_IMPORT_ACTIVATION_FAILURE_MESSAGE =
  "Theme added, but it could not be selected. Try again.";

export type ThemeImportSubmitInput = {
  readonly json: string;
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
};

export type ThemeImportSubmitDecision =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "conflict"; readonly theme: ThemeDefinition }
  | { readonly kind: "install"; readonly theme: ThemeDefinition };

export function themeImportErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "That theme file is invalid.";
}

export function resolveThemeImportSubmit(input: ThemeImportSubmitInput): ThemeImportSubmitDecision {
  const oversized = describeOversizedThemeFile(input.json.length);
  if (oversized) return { kind: "error", message: oversized };
  try {
    const parsed: unknown = JSON.parse(input.json);
    const theme = parseThemeImportValue(parsed);
    if (isThemeInstalled(theme, input.customThemes)) return { kind: "conflict", theme };
    return { kind: "install", theme };
  } catch (cause) {
    return { kind: "error", message: themeImportErrorMessage(cause) };
  }
}

export type ThemeImportBatchOutcomeInput = {
  readonly installedCount: number;
  readonly failures: ReadonlyArray<string>;
  readonly conflicting: ReadonlyArray<ThemeDefinition>;
};

export type ThemeImportBatchOutcome =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "conflicts"; readonly themes: ReadonlyArray<ThemeDefinition> }
  | { readonly kind: "close" }
  | { readonly kind: "none" };

export function resolveThemeImportBatchOutcome(
  input: ThemeImportBatchOutcomeInput,
): ThemeImportBatchOutcome {
  if (input.failures.length > 0) return { kind: "error", message: input.failures.join(" — ") };
  if (input.conflicting.length > 0) return { kind: "conflicts", themes: input.conflicting };
  if (input.installedCount > 0) return { kind: "close" };
  return { kind: "none" };
}

export type ThemeImportConflictMode = "update" | "copy";

export function resolveThemeImportPreferredName(
  conflicts: ReadonlyArray<ThemeDefinition>,
  fileName: string | null,
): string | null {
  return conflicts.length === 1 && fileName
    ? humanizeThemeName(fileName.replace(/\.[^.]+$/, ""))
    : null;
}

export function resolveThemeImportUpdate(
  theme: ThemeDefinition,
  customThemes: ReadonlyArray<ThemeDefinition>,
): ThemeDefinition {
  const existingTheme = customThemes.find((candidate) => candidate.id === theme.id);
  return existingTheme?.collection ? { ...theme, collection: existingTheme.collection } : theme;
}

function themeCopyCandidate(theme: ThemeDefinition, name: string): ThemeDefinition {
  return parseThemeFile({
    version: THEME_FILE_VERSION,
    name,
    appearance: theme.appearance,
    colors: theme.colors,
    ...(theme.variants ? { variants: theme.variants } : {}),
    ...(theme.managed ? { managed: true } : {}),
  });
}

export function resolveThemeImportCopy(
  theme: ThemeDefinition,
  preferredName: string | null,
  customThemes: ReadonlyArray<ThemeDefinition>,
): ThemeDefinition {
  if (preferredName && preferredName.toLowerCase() !== theme.label.toLowerCase()) {
    const candidate = themeCopyCandidate(theme, preferredName.slice(0, 48));
    if (!isThemeInstalled(candidate, customThemes)) return candidate;
  }
  for (let copy = 1; copy < 100; copy += 1) {
    const candidate = themeCopyCandidate(
      theme,
      `${theme.label.slice(0, 48 - ` (${copy})`.length)} (${copy})`,
    );
    if (isThemeInstalled(candidate, customThemes)) continue;
    return candidate;
  }
  throw new Error(`Too many copies of "${theme.label}".`);
}

export type ThemeImportModelInput = {
  readonly json: string;
  readonly fileName: string | null;
  readonly error: string | null;
  readonly isReading: boolean;
  readonly isDropTarget: boolean;
  readonly conflicts: ReadonlyArray<ThemeDefinition> | null;
};

export type ThemeImportView =
  | {
      readonly kind: "conflicts";
      readonly title: string;
      readonly themeLabels: string;
      readonly updateLabel: string;
      readonly copyLabel: string;
      readonly backLabel: string;
      readonly cancelLabel: string;
    }
  | {
      readonly kind: "editor";
      readonly fileTitle: string;
      readonly fileSubtitle: string;
      readonly dropActive: boolean;
      readonly chooseLabel: string;
      readonly chooseDisabled: boolean;
      readonly chooseIcon: "download";
      readonly editorLabel: string;
      readonly editorAriaLabel: string;
      readonly editorPlaceholder: string;
      readonly editorValue: string;
      readonly editorPlainText: boolean;
      readonly cancelLabel: string;
      readonly submitLabel: string;
      readonly submitIcon: "plus";
      readonly submitDisabled: boolean;
    };

export type ThemeImportModel = {
  readonly title: string;
  readonly dividerLabel: string;
  readonly view: ThemeImportView;
  readonly error: string | null;
};

export function buildThemeImportModel(input: ThemeImportModelInput): ThemeImportModel {
  const view: ThemeImportView = input.conflicts
    ? {
        kind: "conflicts",
        title: "Already installed",
        themeLabels: input.conflicts.map((theme) => theme.label).join(", "),
        updateLabel: "Update existing",
        copyLabel: "Keep both",
        backLabel: "Back",
        cancelLabel: "Cancel",
      }
    : {
        kind: "editor",
        fileTitle: "Theme file",
        fileSubtitle: input.fileName ?? "Drop T3 Code or VS Code .json files",
        dropActive: input.isDropTarget,
        chooseLabel: input.isReading ? "Reading…" : "Choose files",
        chooseDisabled: input.isReading,
        chooseIcon: "download",
        editorLabel: "Theme JSON",
        editorAriaLabel: "Theme JSON",
        editorPlaceholder:
          '{\n  "version": 1,\n  "name": "Aurora",\n  "appearance": "light",\n  "colors": { ... }\n}',
        editorValue: input.json,
        editorPlainText: input.json.length > MAX_HIGHLIGHTED_JSON_LENGTH,
        cancelLabel: "Cancel",
        submitLabel: "Add theme",
        submitIcon: "plus",
        submitDisabled: !input.json.trim() || input.isReading,
      };
  return {
    title: "Add a theme",
    dividerLabel: "or import a file",
    view,
    error: input.error,
  };
}
