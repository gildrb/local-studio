import type { OpenVsxThemeExtension, OpenVsxThemeSort } from "../../openVsxThemes";
import type { ThemeDefinition } from "../../themePalette";

const DOWNLOAD_FORMAT = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const THEME_SEARCH_SUGGESTIONS: ReadonlyArray<string> = [
  "Dracula",
  "Catppuccin",
  "Nord",
  "Tokyo Night",
];

export type ThemeSearchSortOption = {
  readonly value: OpenVsxThemeSort;
  readonly label: string;
};

export const THEME_SEARCH_SORT_OPTIONS: ReadonlyArray<ThemeSearchSortOption> = [
  { value: "downloadCount", label: "Most downloaded" },
  { value: "rating", label: "Best rated" },
  { value: "timestamp", label: "Newest" },
  { value: "relevance", label: "Most relevant" },
];

export const THEME_SEARCH_DEBOUNCE_MS = 350;

export const THEME_SEARCH_DEFAULT_SORT: OpenVsxThemeSort = "downloadCount";

export type ThemeSourceLinkIcon = "github" | "gitlab" | "external-link";

export function resolveThemeSourceLinkIcon(url: string): ThemeSourceLinkIcon {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
  } catch {
    return "external-link";
  }
  return "external-link";
}

export function resolveThemeSearchSort(value: string | null): OpenVsxThemeSort | null {
  return THEME_SEARCH_SORT_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

export type ThemeSearchSuggestionIntent =
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "set-query"; readonly query: string };

export function resolveThemeSearchSuggestion(
  query: string,
  suggestion: string,
): ThemeSearchSuggestionIntent {
  return query.trim() === suggestion
    ? { kind: "search", query: suggestion }
    : { kind: "set-query", query: suggestion };
}

export function themeSearchErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export const THEME_SEARCH_FAILURE_FALLBACK = "Open VSX search failed.";
export const THEME_SEARCH_READ_INSTALLED_FALLBACK = "Installed themes could not be read.";
export const THEME_SEARCH_INSTALL_FAILURE_FALLBACK = "That theme could not be added.";

export type ThemeInstallStartDecision =
  | { readonly kind: "confirm-update" }
  | { readonly kind: "install"; readonly updated: boolean };

export function resolveThemeInstallStart(input: {
  readonly installedCollection: ReadonlyArray<ThemeDefinition>;
  readonly allowUpdate: boolean;
}): ThemeInstallStartDecision {
  const updated = input.installedCollection.length > 0;
  if (updated && !input.allowUpdate) return { kind: "confirm-update" };
  return { kind: "install", updated };
}

export type ThemeSearchModelInput = {
  readonly query: string;
  readonly sortBy: OpenVsxThemeSort;
  readonly results: ReadonlyArray<OpenVsxThemeExtension> | null;
  readonly error: string | null;
  readonly isSearching: boolean;
  readonly installingId: string | null;
  readonly pendingUpdate: OpenVsxThemeExtension | null;
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
};

export type ThemeSearchResultModel = {
  readonly id: string;
  readonly name: string;
  readonly meta: string;
  readonly description: string;
  readonly iconUrl: string | null;
  readonly sourceUrl: string | null;
  readonly sourceAriaLabel: string;
  readonly sourceIcon: ThemeSourceLinkIcon | null;
  readonly installed: boolean;
  readonly installing: boolean;
  readonly actionLabel: string;
  readonly actionAriaLabel: string;
  readonly actionIcon: "spinner" | "refresh" | "package-plus";
  readonly actionDisabled: boolean;
};

export type ThemeSearchModel = {
  readonly headingId: string;
  readonly title: string;
  readonly description: string;
  readonly input: {
    readonly ariaLabel: string;
    readonly placeholder: string;
    readonly value: string;
    readonly icon: "spinner" | "search";
  };
  readonly toolbar: {
    readonly suggestionsLabel: string;
    readonly suggestions: ReadonlyArray<{ readonly label: string; readonly disabled: boolean }>;
    readonly sort: {
      readonly label: string;
      readonly ariaLabel: string;
      readonly value: OpenVsxThemeSort;
      readonly valueLabel: string | null;
      readonly disabled: boolean;
      readonly options: ReadonlyArray<ThemeSearchSortOption>;
    } | null;
  } | null;
  readonly statusText: string;
  readonly error: string | null;
  readonly loadingText: string | null;
  readonly empty: { readonly title: string; readonly description: string } | null;
  readonly results: ReadonlyArray<ThemeSearchResultModel> | null;
  readonly updateDialog: {
    readonly open: boolean;
    readonly title: string;
    readonly description: string;
    readonly cancelLabel: string;
    readonly confirmLabel: string;
  };
};

function buildThemeSearchResultModel(
  extension: OpenVsxThemeExtension,
  input: ThemeSearchModelInput,
): ThemeSearchResultModel {
  const installing = input.installingId === extension.id;
  const installed = input.customThemes.some(
    (theme) => theme.collection?.id === extension.collectionId,
  );
  const action = installed ? "Update" : "Install";
  const progressAction = installed ? "Updating" : "Installing";
  return {
    id: extension.id,
    name: extension.name,
    meta: `${extension.publisher} · ${DOWNLOAD_FORMAT.format(extension.downloadCount)} downloads`,
    description: extension.description || "A community color theme for your editor.",
    iconUrl: extension.iconUrl || null,
    sourceUrl: extension.sourceUrl || null,
    sourceAriaLabel: `View source for ${extension.name}`,
    sourceIcon: extension.sourceUrl ? resolveThemeSourceLinkIcon(extension.sourceUrl) : null,
    installed,
    installing,
    actionLabel: installing ? `${progressAction}...` : action,
    actionAriaLabel: `${installing ? progressAction : action} ${extension.name}`,
    actionIcon: installing ? "spinner" : installed ? "refresh" : "package-plus",
    actionDisabled: input.installingId !== null,
  };
}

export function buildThemeSearchModel(input: ThemeSearchModelInput): ThemeSearchModel {
  const { results, isSearching } = input;
  const busy = input.installingId !== null;
  return {
    headingId: "theme-search-heading",
    title: "Search community themes",
    description: "Find open-source themes from Open VSX.",
    input: {
      ariaLabel: "Search Open VSX themes",
      placeholder: "Search themes...",
      value: input.query,
      icon: isSearching ? "spinner" : "search",
    },
    toolbar:
      !isSearching || results !== null
        ? {
            suggestionsLabel: "Popular",
            suggestions: THEME_SEARCH_SUGGESTIONS.map((label) => ({ label, disabled: busy })),
            sort:
              results && results.length > 0
                ? {
                    label: "Sort",
                    ariaLabel: "Sort themes",
                    value: input.sortBy,
                    valueLabel:
                      THEME_SEARCH_SORT_OPTIONS.find((option) => option.value === input.sortBy)
                        ?.label ?? null,
                    disabled: busy,
                    options: THEME_SEARCH_SORT_OPTIONS,
                  }
                : null,
          }
        : null,
    statusText: isSearching
      ? "Searching themes..."
      : results
        ? `${results.length} supported ${results.length === 1 ? "theme" : "themes"} found.`
        : "",
    error: input.error,
    loadingText: isSearching && results === null ? "Searching themes..." : null,
    empty:
      results && results.length === 0
        ? {
            title: "No supported open-source themes found",
            description: "Try a broader search.",
          }
        : null,
    results:
      results && results.length > 0
        ? results.map((extension) => buildThemeSearchResultModel(extension, input))
        : null,
    updateDialog: {
      open: input.pendingUpdate !== null,
      title: `Update “${input.pendingUpdate?.name ?? ""}”?`,
      description:
        "This replaces its installed variants, including any local edits. Variants no longer in the extension will be removed.",
      cancelLabel: "Cancel",
      confirmLabel: "Update theme",
    },
  };
}

export function themeSearchKey(query: string, sortBy: OpenVsxThemeSort): string {
  return `${query}\u0000${sortBy}`;
}
