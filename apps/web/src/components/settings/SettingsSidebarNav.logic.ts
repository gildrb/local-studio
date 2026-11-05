import {
  isSettingsOverviewVisible,
  searchSettings,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
  type SettingsSearchItem,
  type SettingsSearchPlatform,
} from "./settingsSearch";
import type { SettingsScopeSearch } from "./settingsScope";

export type SettingsSectionIconKey =
  | "settings-2"
  | "palette"
  | "panels-top-left"
  | "keyboard"
  | "snap-shot"
  | "bot"
  | "blocks"
  | "git-branch"
  | "hard-drive"
  | "server"
  | "link-2"
  | "archive";

export const SETTINGS_SECTION_ICON_KEYS: Readonly<Record<SettingsPath, SettingsSectionIconKey>> = {
  "/settings/general": "settings-2",
  "/settings/appearance": "palette",
  "/settings/projects": "panels-top-left",
  "/settings/keybindings": "keyboard",
  "/settings/snap-shot": "snap-shot",
  "/settings/providers": "bot",
  "/settings/integrations": "blocks",
  "/settings/source-control": "git-branch",
  "/settings/storage": "hard-drive",
  "/settings/local": "server",
  "/settings/connections": "link-2",
  "/settings/archived": "archive",
};

const SETTINGS_SECTION_PATHS: ReadonlyArray<SettingsPath> = [
  "/settings/projects",
  "/settings/general",
  "/settings/appearance",
  "/settings/keybindings",
  "/settings/snap-shot",
  "/settings/providers",
  "/settings/integrations",
  "/settings/source-control",
  "/settings/storage",
  "/settings/local",
  "/settings/connections",
  "/settings/archived",
];

export type SettingsNavSection = {
  readonly id: SettingsPath;
  readonly label: string;
  readonly icon: SettingsSectionIconKey;
  readonly active: boolean;
};

export type SettingsSearchResultRow = {
  readonly id: string;
  readonly elementId: string;
  readonly title: string;
  readonly sectionLabel: string;
  readonly icon: SettingsSectionIconKey;
  readonly to: SettingsPath;
  readonly targetId: string;
  readonly active: boolean;
};

export type SettingsSearchResultsInput = {
  readonly query: string;
  readonly items: ReadonlyArray<SettingsSearchItem>;
  readonly platform: SettingsSearchPlatform;
};

export type SettingsNavModelInput = {
  readonly pathname: string;
  readonly scopeSearch: SettingsScopeSearch;
  readonly query: string;
  readonly results: ReadonlyArray<SettingsSearchItem>;
  readonly activeResultIndex: number;
};

export type SettingsNavSearchModel = {
  readonly query: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly clearLabel: string;
  readonly shortcutHint: string;
  readonly resultsLabel: string;
  readonly isSearching: boolean;
  readonly hasResults: boolean;
  readonly expanded: boolean;
  readonly activeResultIndex: number;
  readonly activeDescendantId: string | null;
  readonly emptyMessage: string | null;
  readonly results: ReadonlyArray<SettingsSearchResultRow>;
};

export type SettingsNavModel = {
  readonly activeSection: SettingsPath | null;
  readonly sections: ReadonlyArray<SettingsNavSection>;
  readonly search: SettingsNavSearchModel;
};

export function settingsSearchResultElementId(id: string): string {
  return `settings-search-result-${id}`;
}

export function isSettingsSectionActive(section: SettingsPath, pathname: string): boolean {
  const isGeneralDetailPage =
    section === "/settings/general" && pathname === "/settings/open-source-licenses";
  return isGeneralDetailPage || pathname === section || pathname.startsWith(`${section}/`);
}

export function resolveSettingsActiveSection(pathname: string): SettingsPath | null {
  return (
    SETTINGS_SECTION_PATHS.find((section) => isSettingsSectionActive(section, pathname)) ?? null
  );
}

export function buildSettingsSearchResults(
  input: SettingsSearchResultsInput,
): ReadonlyArray<SettingsSearchItem> {
  return searchSettings(input.query, input.items, input.platform);
}

export function clampSettingsSearchResultIndex(index: number, resultCount: number): number {
  return Math.min(index, Math.max(resultCount - 1, 0));
}

export function buildSettingsNavModel(input: SettingsNavModelInput): SettingsNavModel {
  const isSearching = input.query.trim().length > 0;
  const hasResults = input.results.length > 0;
  const activeResult = input.results[input.activeResultIndex];
  const sections = SETTINGS_SECTION_PATHS.filter(
    (section) => section !== "/settings/projects" || isSettingsOverviewVisible(input.scopeSearch),
  ).map((section) => ({
    id: section,
    label: SETTINGS_SECTION_LABELS[section],
    icon: SETTINGS_SECTION_ICON_KEYS[section],
    active: isSettingsSectionActive(section, input.pathname),
  }));
  return {
    activeSection: resolveSettingsActiveSection(input.pathname),
    sections,
    search: {
      query: input.query,
      placeholder: "Search",
      ariaLabel: "Search settings",
      clearLabel: "Clear settings search",
      shortcutHint: "/",
      resultsLabel: "Settings search results",
      isSearching,
      hasResults,
      expanded: isSearching && hasResults,
      activeResultIndex: input.activeResultIndex,
      activeDescendantId:
        isSearching && activeResult ? settingsSearchResultElementId(activeResult.id) : null,
      emptyMessage: isSearching && !hasResults ? "No settings found" : null,
      results: isSearching
        ? input.results.map((item, index) => ({
            id: item.id,
            elementId: settingsSearchResultElementId(item.id),
            title: item.title,
            sectionLabel: SETTINGS_SECTION_LABELS[item.to],
            icon: SETTINGS_SECTION_ICON_KEYS[item.to],
            to: item.to,
            targetId: item.targetId ?? item.id,
            active: index === input.activeResultIndex,
          }))
        : [],
    },
  };
}

export type SettingsSearchShortcutInput = {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
};

export function isSettingsSearchShortcut(input: SettingsSearchShortcutInput): boolean {
  return input.key === "/" && !input.metaKey && !input.ctrlKey && !input.altKey;
}

export type SettingsSearchKeyIntent =
  | { readonly kind: "none" }
  | { readonly kind: "clear" }
  | { readonly kind: "move"; readonly index: number }
  | { readonly kind: "select"; readonly index: number };

export function resolveSettingsSearchKeyIntent(input: {
  readonly key: string;
  readonly isSearching: boolean;
  readonly resultCount: number;
  readonly activeResultIndex: number;
}): SettingsSearchKeyIntent {
  if (input.key === "Escape" && input.isSearching) return { kind: "clear" };
  if (input.resultCount === 0) return { kind: "none" };
  if (input.key === "ArrowDown") {
    return { kind: "move", index: (input.activeResultIndex + 1) % input.resultCount };
  }
  if (input.key === "ArrowUp") {
    return {
      kind: "move",
      index: (input.activeResultIndex - 1 + input.resultCount) % input.resultCount,
    };
  }
  if (input.key === "Enter") return { kind: "select", index: input.activeResultIndex };
  return { kind: "none" };
}

export type SettingsSearchSelectionIntent =
  | { readonly kind: "scroll"; readonly targetId: string }
  | { readonly kind: "navigate"; readonly to: SettingsPath; readonly hash: string };

export function resolveSettingsSearchResultSelection(input: {
  readonly to: SettingsPath;
  readonly targetId: string;
  readonly pathname: string;
  readonly currentHash: string;
}): SettingsSearchSelectionIntent {
  if (input.pathname === input.to && input.currentHash.replace(/^#/, "") === input.targetId) {
    return { kind: "scroll", targetId: input.targetId };
  }
  return { kind: "navigate", to: input.to, hash: input.targetId };
}
