import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import {
  ArchiveIcon,
  BlocksIcon,
  BotIcon,
  createLucideIcon,
  GitBranchIcon,
  HardDriveIcon,
  PanelsTopLeftIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  SearchIcon,
  ServerIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarInput,
} from "../ui/sidebar";
import { SidebarUtilityMenu } from "../sidebar/SidebarChrome";
import { scrollToSettingsTarget } from "./settingsLayout";
import type { SettingsPath } from "./settingsSearch";
import { isElectron } from "~/env";
import { useAvailableSettingsSearchItems } from "./useAvailableSettingsSearchItems";
import { validateSettingsScopeSearch } from "./settingsScope";
import {
  buildSettingsNavModel,
  buildSettingsSearchResults,
  clampSettingsSearchResultIndex,
  isSettingsSearchShortcut,
  resolveSettingsSearchKeyIntent,
  resolveSettingsSearchResultSelection,
  settingsSearchResultElementId,
  type SettingsSearchResultRow,
  type SettingsSectionIconKey,
} from "./SettingsSidebarNav.logic";

const SnapShotIcon = createLucideIcon("snap-shot", [
  [
    "path",
    {
      d: "M8 3H6a3 3 0 0 0-3 3v2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2",
      key: "capture-frame",
    },
  ],
  ["rect", { width: "10", height: "8", x: "7", y: "8", rx: "2", key: "window" }],
  ["circle", { cx: "12", cy: "12", r: "1.5", key: "lens" }],
]);

const T3ConnectSidebarSignIn = lazy(() =>
  import("../clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarSignIn,
  })),
);
const T3ConnectSidebarAvatar = lazy(() =>
  import("../clerk/T3ConnectSidebarSignIn").then((module) => ({
    default: module.T3ConnectSidebarAvatar,
  })),
);

const SETTINGS_SECTION_ICONS: Readonly<
  Record<SettingsSectionIconKey, ComponentType<{ className?: string }>>
> = {
  "settings-2": Settings2Icon,
  palette: PaletteIcon,
  "panels-top-left": PanelsTopLeftIcon,
  keyboard: KeyboardIcon,
  "snap-shot": SnapShotIcon,
  bot: BotIcon,
  blocks: BlocksIcon,
  "git-branch": GitBranchIcon,
  "hard-drive": HardDriveIcon,
  server: ServerIcon,
  "link-2": Link2Icon,
  archive: ArchiveIcon,
};

function SettingsSectionIcon({ icon }: { icon: SettingsSectionIconKey }) {
  const Icon = SETTINGS_SECTION_ICONS[icon];
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-sidebar-muted-foreground/60" />;
}

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const currentHash = useLocation({ select: (location) => location.hash });
  const currentSearch = useLocation({ select: (location) => location.search });
  const scopeSearch = useMemo(() => validateSettingsScopeSearch(currentSearch), [currentSearch]);
  const { isMobile, setOpenMobile, open, setOpen } = useSidebar();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchableItems = useAvailableSettingsSearchItems(scopeSearch);
  const results = useMemo(
    () =>
      buildSettingsSearchResults({
        query,
        items: searchableItems,
        platform: { isElectron, platform: navigator.platform },
      }),
    [query, searchableItems],
  );
  const model = useMemo(
    () => buildSettingsNavModel({ pathname, scopeSearch, query, results, activeResultIndex }),
    [activeResultIndex, pathname, query, results, scopeSearch],
  );
  const { search } = model;

  useEffect(() => {
    setActiveResultIndex((index) => clampSettingsSearchResultIndex(index, results.length));
  }, [results.length]);

  useEffect(() => {
    const result = results[activeResultIndex];
    if (!result) return;
    document
      .getElementById(settingsSearchResultElementId(result.id))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, results]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isSettingsSearchShortcut(event)) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          // Keep focus inside open dialogs and popups instead of escaping
          // their focus trap into the sidebar search.
          target.closest('[role="dialog"], [aria-modal="true"], [data-slot$="popup"]') !== null)
      ) {
        return;
      }

      event.preventDefault();
      if (isMobile) {
        setOpenMobile(true);
      } else if (!open) {
        setOpen(true);
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, open, setOpen, setOpenMobile]);

  const handleSectionClick = useCallback(
    (to: SettingsPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to,
        hash: "",
        replace: true,
        hashScrollIntoView: false,
      });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveResultIndex(0);
  }, []);
  const handleSearchResultClick = useCallback(
    (result: Pick<SettingsSearchResultRow, "to" | "targetId">) => {
      clearSearch();
      if (isMobile) {
        setOpenMobile(false);
      }
      const intent = resolveSettingsSearchResultSelection({
        to: result.to,
        targetId: result.targetId,
        pathname,
        currentHash,
      });
      if (intent.kind === "scroll") {
        scrollToSettingsTarget(intent.targetId);
        return;
      }
      void navigate({
        to: intent.to,
        hash: intent.hash,
        replace: true,
        hashScrollIntoView: false,
        state: { settingsTargetHighlight: true },
      });
    },
    [clearSearch, currentHash, isMobile, navigate, pathname, setOpenMobile],
  );
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      const intent = resolveSettingsSearchKeyIntent({
        key: event.key,
        isSearching: search.isSearching,
        resultCount: search.results.length,
        activeResultIndex,
      });
      switch (intent.kind) {
        case "none":
          return;
        case "clear":
          event.preventDefault();
          event.stopPropagation();
          clearSearch();
          return;
        case "move":
          event.preventDefault();
          setActiveResultIndex(intent.index);
          return;
        case "select": {
          event.preventDefault();
          const result = search.results[intent.index];
          if (result) handleSearchResultClick(result);
        }
      }
    },
    [activeResultIndex, clearSearch, handleSearchResultClick, search],
  );
  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <div className="flex flex-col gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
              <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
              <SidebarInput
                ref={searchInputRef}
                nativeInput
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveResultIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder={search.placeholder}
                aria-label={search.ariaLabel}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={search.expanded}
                aria-controls={search.expanded ? "settings-search-results" : undefined}
                aria-activedescendant={search.activeDescendantId ?? undefined}
                className="min-w-0 flex-1"
              />
              {search.isSearching ? (
                <Button
                  type="button"
                  size="icon-micro"
                  variant="ghost-muted"
                  className="shrink-0"
                  aria-label={search.clearLabel}
                  onClick={() => {
                    clearSearch();
                    searchInputRef.current?.focus();
                  }}
                >
                  <XIcon className="size-3" />
                </Button>
              ) : (
                <Kbd>{search.shortcutHint}</Kbd>
              )}
            </div>
            {search.emptyMessage !== null ? (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                {search.emptyMessage}
              </p>
            ) : null}
            {search.isSearching ? (
              <SidebarMenu
                id={search.hasResults ? "settings-search-results" : undefined}
                role={search.hasResults ? "listbox" : undefined}
                aria-label={search.hasResults ? search.resultsLabel : undefined}
              >
                {search.results.map((item, index) => (
                  <SidebarMenuItem key={item.id} role="presentation">
                    <SidebarMenuButton
                      id={item.elementId}
                      role="option"
                      aria-selected={item.active}
                      tabIndex={-1}
                      size="sm"
                      isActive={item.active}
                      className="h-auto min-h-10 items-start"
                      onMouseMove={() => setActiveResultIndex(index)}
                      onClick={() => handleSearchResultClick(item)}
                    >
                      <SettingsSectionIcon icon={item.icon} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-sidebar-foreground">
                          {item.title}
                        </span>
                        <span className="block truncate text-2xs text-sidebar-muted-foreground/75">
                          {item.sectionLabel}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <SidebarMenu>
                {model.sections.map((section) => {
                  const Icon = SETTINGS_SECTION_ICONS[section.icon];
                  return (
                    <SidebarMenuItem key={section.id}>
                      <SidebarMenuButton
                        isActive={section.active}
                        onClick={() => handleSectionClick(section.id)}
                      >
                        <Icon />
                        <span className="truncate">{section.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Suspense fallback={null}>
          <T3ConnectSidebarSignIn />
        </Suspense>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SidebarUtilityMenu />
          </div>
          <Suspense fallback={null}>
            <T3ConnectSidebarAvatar />
          </Suspense>
        </div>
      </SidebarFooter>
    </>
  );
}
