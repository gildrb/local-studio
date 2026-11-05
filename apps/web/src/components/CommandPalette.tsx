"use client";

import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  canCreateProjectInEnvironment,
  getCloneDirectoryName,
  getNewProjectGitHubTarget,
  type AddProjectCloneFlow,
  type AddProjectRemoteSource,
} from "@t3tools/client-runtime/operations/projects";
import { resolveThreadReferenceCopyTarget } from "@t3tools/shared/threadReference";
import { submitAddProjectClone } from "./addProjectClone.logic";
import {
  canPreloadBrowsePath,
  createBrowseNavigationCoordinator,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type DesktopWslState,
  type EnvironmentId,
  type FilesystemBrowseResult,
  type ProjectId,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  CheckIcon,
  ChevronRightIcon,
  CornerLeftUpIcon,
  FileSearchIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareDashedIcon,
  LinkIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RotateCcwIcon,
  SettingsIcon,
  SquarePenIcon,
  SunIcon,
  TextSearchIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";

import { isElectron } from "../env";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useDesktopLocalBootstraps } from "../connection/useDesktopLocalBootstraps";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { useClientSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { useCustomThemes } from "../hooks/useCustomThemes";
import { useEnvironmentThemeDefinitions } from "../hooks/useEnvironmentTheme";
import { ThemePreviewCircle } from "./settings/ThemePreviewCircles";
import { readLocalApi } from "../localApi";
import { desktopLocalBackendId } from "../connection/desktopLocal";
import { filesystemEnvironment } from "../state/filesystem";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { useScratchProject } from "../hooks/useScratchProject";
import { useNewProject } from "../hooks/useNewProject";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useServerConfigs, useThreadShells, waitForProject } from "../state/entities";
import { useThreadSearch } from "../state/queries";
import { resolveThreadActionProjectRef, startNewThreadFromContext } from "../lib/chatThreadActions";
import {
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { onOpenCommandPalette } from "../commandPaletteBus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanel,
  useRightPanelStore,
} from "../rightPanelStore";
import { addProjectFromPath } from "./addProject.logic";
import {
  cn,
  getLocalFileManagerName,
  isMacPlatform,
  isWindowsPlatform,
  newProjectId,
} from "../lib/utils";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { useAvailableSettingsSearchItems } from "./settings/useAvailableSettingsSearchItems";
import {
  applyWslEnvironmentConfiguration,
  parseWslUncPath,
  resolveProjectPickerTarget,
  resolveWslProjectSelection,
} from "../wslPaths";
import {
  appearanceModeLabel,
  buildActionEntries,
  buildAddProjectEnvironmentGroups,
  buildAddProjectEnvironmentOptions,
  buildAddProjectRemoteSourceReadiness,
  buildAddProjectSourceGroups,
  buildChangeThemeView,
  buildCommandPaletteModel,
  buildNewThreadInEntries,
  buildNewThreadInView,
  buildProjectSearchEntries,
  buildThemeCards,
  buildThemeGroups,
  buildThreadContentMatchByKey,
  buildThreadEntries,
  filterPinnedBrowseEntries,
  nextAppearanceMode,
  getEnvironmentBrowsePlatform,
  reduceCommandPaletteUiState,
  remoteProjectSourceGlyph,
  resolveCommandPaletteItem,
  type CommandPaletteAccessory,
  type CommandPaletteActionItem,
  type CommandPaletteCommand,
  type CommandPaletteGlyph,
  type CommandPaletteGroup,
  type CommandPaletteIcon,
  type CommandPaletteOpenIntent,
  type CommandPaletteResolveContext,
  type CommandPaletteRow,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  type SearchOverlayMode,
} from "./CommandPalette.logic";
import { orderItemsByPreferredIds, sortLogicalProjectsForSidebar } from "./Sidebar.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { AzureDevOpsIcon, BitbucketIcon, GitHubIcon, GitLabIcon, ForgejoIcon } from "./Icons";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { Checkbox } from "./ui/checkbox";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProjectFilePicker } from "./files/ProjectFilePicker";
import { openLinkPullRequestDialog } from "./pullRequest/LinkPullRequestDialog";
import { ProjectContentSearchDialog } from "./search/ProjectContentSearchDialog";
import { toggleThemeEditorForTheme } from "./settings/themeEditorStore";
import {
  COMMAND_PALETTE_META_ICON_CLASS,
  CommandPaletteMetaDot,
  ThreadCommandSubtitle,
} from "./ThreadCommandSubtitle";
import { ThreadRowLeadingStatus, ThreadRowTrailingStatus } from "./ThreadStatusIndicators";
import { primaryServerKeybindingsAtom, primaryServerProvidersAtom } from "../state/server";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings";
import { CommandDialog, CommandDialogPopup, CommandFooterAction } from "./ui/command";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import { legacyProjectCwdPreferenceKey } from "../uiState.logic";
import { useUiStateStore } from "../uiStateStore";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "../sidebarProjectGrouping";
import type { SidebarThreadSummary } from "../types";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "~/components/pullRequest/pullRequestListPreferences";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];
const ITEM_ICON_CLASS = "size-4 text-icon-muted";

function notifyThemeSaveFailure(): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Couldn't save theme selection",
      description: "Try again.",
    }),
  );
}

function renderGlyph(glyph: CommandPaletteGlyph, className: string): ReactNode {
  switch (glyph) {
    case "square-pen":
      return <SquarePenIcon className={className} />;
    case "message-square":
      return <MessageSquareIcon className={className} />;
    case "message-square-dashed":
      return <MessageSquareDashedIcon className={className} />;
    case "link":
      return <LinkIcon className={className} />;
    case "pull-request":
      return <PullRequestGlyph.pullRequest className={className} />;
    case "pull-request-link":
      return <PullRequestGlyph.link className={className} />;
    case "rotate-ccw":
      return <RotateCcwIcon className={className} />;
    case "file-search":
      return <FileSearchIcon className={className} />;
    case "text-search":
      return <TextSearchIcon className={className} />;
    case "folder-git":
      return <FolderGit2Icon className={className} />;
    case "folder-plus":
      return <FolderPlusIcon className={className} />;
    case "folder":
      return <FolderIcon className={className} />;
    case "palette":
      return <PaletteIcon className={className} />;
    case "monitor":
      return <MonitorIcon className={className} />;
    case "sun":
      return <SunIcon className={className} />;
    case "moon":
      return <MoonIcon className={className} />;
    case "chart":
      return <ChartNoAxesColumnIcon className={className} />;
    case "settings":
      return <SettingsIcon className={className} />;
    case "corner-left-up":
      return <CornerLeftUpIcon className={className} />;
    case "github":
      return <GitHubIcon className={className} />;
    case "forgejo":
      return <ForgejoIcon className={className} />;
    case "gitlab":
      return <GitLabIcon className={className} />;
    case "bitbucket":
      return <BitbucketIcon className={className} />;
    case "azure-devops":
      return <AzureDevOpsIcon className={className} />;
  }
}

function renderPaletteIcon(icon: CommandPaletteIcon): ReactNode {
  switch (icon.kind) {
    case "glyph":
      return renderGlyph(icon.glyph, ITEM_ICON_CLASS);
    case "project":
      return <ProjectFavicon project={icon.project} className="size-4" />;
    case "machine":
      return <EnvironmentMachineIcon kind={icon.machine} className={ITEM_ICON_CLASS} />;
  }
}

function renderPaletteDescription(row: CommandPaletteRow): ReactNode {
  const subtitle = row.subtitle;
  if (subtitle === undefined) return row.description;
  switch (subtitle.kind) {
    case "thread":
      return (
        <ThreadCommandSubtitle
          project={subtitle.project}
          projectTitle={subtitle.projectTitle}
          environmentLabel={subtitle.environmentLabel}
          branch={subtitle.branch}
          worktreePath={subtitle.worktreePath}
          isCurrent={subtitle.isCurrent}
          driverKind={subtitle.driverKind}
          providerDisplayName={subtitle.providerDisplayName}
        />
      );
    case "location":
      return (
        <span className="flex min-w-0 items-center gap-1">
          <span className="inline-flex min-w-0 items-center gap-1">
            {subtitle.location.kind === "remote" ? (
              <EnvironmentMachineIcon
                aria-hidden
                kind={subtitle.location.machine}
                className={COMMAND_PALETTE_META_ICON_CLASS}
              />
            ) : null}
            <span className="truncate">{subtitle.location.label}</span>
          </span>
          <CommandPaletteMetaDot />
          <span className="truncate">{subtitle.workspaceRoot}</span>
        </span>
      );
    case "environment-labels":
      return <span className="truncate">{subtitle.labels.join(" · ")}</span>;
  }
}

function browseInputEndPaddingClass(input: {
  readonly willCreateProjectPath: boolean;
  readonly hasHighlightedBrowseItem: boolean;
}): string {
  if (input.willCreateProjectPath) {
    return "*:data-[slot=autocomplete-input]:pe-38!";
  }
  if (input.hasHighlightedBrowseItem) {
    return "*:data-[slot=autocomplete-input]:pe-30!";
  }
  return "*:data-[slot=autocomplete-input]:pe-24!";
}

const OVERLAY_MODE_BY_COMMAND = {
  "commandPalette.toggle": "command",
  "filePicker.toggle": "files",
  "projectSearch.toggle": "content",
} as const satisfies Partial<Record<string, SearchOverlayMode>>;

function overlayModeForCommand(command: string | null): SearchOverlayMode | null {
  if (command === null) return null;
  return command in OVERLAY_MODE_BY_COMMAND
    ? OVERLAY_MODE_BY_COMMAND[command as keyof typeof OVERLAY_MODE_BY_COMMAND]
    : null;
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reduceCommandPaletteUiState, {
    open: false,
    mode: "command",
    openIntent: null,
  });
  const setOpen = useCallback((open: boolean) => dispatch({ _tag: "SetOpen", open }), []);
  const toggleMode = useCallback(
    (mode: SearchOverlayMode) => dispatch({ _tag: "ToggleMode", mode }),
    [],
  );
  const openAddProject = useCallback(() => dispatch({ _tag: "OpenAddProject" }), []);
  const openNewThreadIn = useCallback(() => dispatch({ _tag: "OpenNewThreadIn" }), []);
  const clearOpenIntent = useCallback(() => dispatch({ _tag: "ClearOpenIntent" }), []);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { theme, themeHalves, resolvedTheme, appearanceMode, setAppearanceMode } = useTheme();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );

  useEffect(() => {
    if (!state.open || state.mode === "command") return;
    const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      toggleMode("command");
    };
    window.addEventListener("keydown", onEscapeKeyDown, true);
    return () => window.removeEventListener("keydown", onEscapeKeyDown, true);
  }, [state.mode, state.open, toggleMode]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Resolve with the complete shortcut context so customized bindings
      // using any documented `when` condition (e.g. previewFocus) work.
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          modelPickerOpen: composerHandleRef.current?.isModelPickerOpen() ?? false,
        },
      });
      if (command === "appearance.cycle") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const nextMode = nextAppearanceMode(appearanceMode);
        if (!setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
        } else {
          toastManager.add({
            id: "appearance-cycle",
            title: `Appearance: ${appearanceModeLabel(nextMode)}`,
            timeout: 1500,
          });
        }
        return;
      }
      if (command === "theme.select") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        dispatch({ _tag: "OpenChangeTheme" });
        return;
      }
      if (command === "themeEditor.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleThemeEditorForTheme({
          theme,
          themeHalves,
          initialAppearance: resolvedTheme,
        });
        return;
      }
      if (command === "usage.open") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        void navigate({ to: "/usage" });
        return;
      }
      const mode = overlayModeForCommand(command);
      if (mode === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appearanceMode,
    keybindings,
    navigate,
    previewOpen,
    resolvedTheme,
    setAppearanceMode,
    setOpen,
    terminalOpen,
    theme,
    themeHalves,
    toggleMode,
  ]);

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        if (detail.open === "new-thread-in") {
          openNewThreadIn();
        } else if (detail.open === "add-project") {
          openAddProject();
        } else if (detail.query !== undefined) {
          dispatch({
            _tag: "OpenSearch",
            query: detail.query,
            ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
          });
        } else {
          setOpen(true);
        }
      }),
    [openAddProject, openNewThreadIn, setOpen],
  );

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <CommandDialog
        open={state.open}
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "escape-key" && state.mode !== "command") {
            eventDetails.cancel();
            toggleMode("command");
            return;
          }
          setOpen(open);
        }}
      >
        {/* Block background focus calls for the entire time the palette is open. */}
        <div className="contents" inert={state.open}>
          {children}
        </div>
        <CommandPaletteDialog
          mode={state.mode}
          openIntent={state.openIntent}
          setOpen={setOpen}
          openOverlayMode={toggleMode}
          clearOpenIntent={clearOpenIntent}
        />
      </CommandDialog>
    </ComposerHandleContext>
  );
}

function CommandPaletteDialog(props: {
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
}) {
  const composerHandleRef = useComposerHandleContext();

  return (
    <CommandDialogPopup
      aria-label={
        props.mode === "files"
          ? "File picker"
          : props.mode === "content"
            ? "Search project contents"
            : "Command palette"
      }
      className={cn("overflow-hidden", props.mode === "content" && "h-105")}
      data-command-palette="true"
      data-palette-mode={props.mode}
      data-testid="command-palette"
      finalFocus={() => {
        composerHandleRef?.current?.focusAtEnd();
        return false;
      }}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      {props.mode === "files" ? (
        <ProjectFilePicker setOpen={props.setOpen} />
      ) : props.mode === "content" ? (
        <ProjectContentSearchDialog onOpenChange={props.setOpen} />
      ) : (
        <OpenCommandPaletteDialog
          openIntent={props.openIntent}
          setOpen={props.setOpen}
          openOverlayMode={props.openOverlayMode}
          clearOpenIntent={props.clearOpenIntent}
        />
      )}
    </CommandDialogPopup>
  );
}

function OpenCommandPaletteDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openOverlayMode: (mode: SearchOverlayMode) => void;
  readonly clearOpenIntent: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { clearOpenIntent, openIntent, openOverlayMode, setOpen } = props;
  const [query, setQuery] = useState(openIntent?.kind === "search" ? openIntent.query : "");
  const [linkedThreadSearch, setLinkedThreadSearch] = useState(
    openIntent?.kind === "search" ? openIntent : null,
  );
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const clientSettings = useClientSettings();
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const { scratchEnvironmentId, scratchWorkspaceRootFor, startScratchThread } = useScratchProject();
  const lookupRepository = useAtomQueryRunner(sourceControlEnvironment.repository, {
    reportFailure: false,
  });
  const loadBrowsePath = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const cloneRepository = useAtomCommand(sourceControlEnvironment.cloneRepository, {
    reportFailure: false,
  });
  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const desktopLocalBootstraps = useDesktopLocalBootstraps();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const availableSettingsSearchItems = useAvailableSettingsSearchItems();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projects = useProjects();
  const referenceThreadRef =
    pathname === "/pull-requests"
      ? environments.some(
          (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
        )
        ? PULL_REQUESTS_PANEL_REF
        : null
      : activeThread
        ? scopeThreadRef(activeThread.environmentId, activeThread.id)
        : null;
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(referenceThreadRef);
  const activeThreadServerConfig = useServerConfigs().get(
    activeThread?.environmentId ?? ("" as EnvironmentId),
  );
  const activeThreadReferenceCopyTarget =
    referenceThreadRef === null || (pathname === "/pull-requests" && !openPanelPullRequestUrl)
      ? null
      : resolveThreadReferenceCopyTarget({
          threadId: referenceThreadRef.threadId,
          openPanelPullRequestUrl,
          pullRequests: activeThread?.pullRequests,
          linkedPullRequestUrl:
            activeThread?.linkedPullRequest?.url ?? activeThread?.branchPullRequest?.url ?? null,
        });
  const copyActiveThreadReference = useCallback(async () => {
    const target = activeThreadReferenceCopyTarget;
    if (target === null) return;
    try {
      const didCopy = await writeTextToClipboard(target.value, target.clipboardTarget);
      if (!didCopy) return;
      toastManager.add({
        type: "success",
        title: target.successTitle,
        description: target.value,
      });
    } catch (error) {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: target.failureTitle,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [activeThreadReferenceCopyTarget]);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threads = useThreadShells();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const {
    theme,
    themeHalves,
    resolvedTheme,
    appearanceMode,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
  } = useTheme();
  const customThemes = useCustomThemes();
  const environmentThemes = useEnvironmentThemeDefinitions();
  const themeCards = useMemo(
    () => buildThemeCards({ customThemes, environmentThemes }),
    [customThemes, environmentThemes],
  );
  const providers = useAtomValue(primaryServerProvidersAtom);
  const providerEntryByEnvironmentAndInstanceId = useMemo(() => {
    const map = new Map<string, ProviderInstanceEntry>();
    for (const environment of environments) {
      const environmentProviders =
        environment.serverConfig?.providers ??
        (environment.environmentId === primaryEnvironmentId ? providers : []);
      for (const entry of deriveProviderInstanceEntries(environmentProviders)) {
        map.set(`${environment.environmentId}:${entry.instanceId}`, entry);
      }
    }
    return map;
  }, [environments, primaryEnvironmentId, providers]);
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const threadSearchQuery = currentView === null && !isActionsOnly ? deferredQuery : "";
  const threadSearch = useThreadSearch(environmentIds, threadSearchQuery);
  const threadContentMatchByKey = useMemo(
    () => buildThreadContentMatchByKey(threadSearch.matches, threadSearchQuery),
    [threadSearch.matches, threadSearchQuery],
  );
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const browseNavigationRef = useRef<ReturnType<typeof createBrowseNavigationCoordinator> | null>(
    null,
  );
  if (browseNavigationRef.current === null) {
    browseNavigationRef.current = createBrowseNavigationCoordinator();
  }
  const browseNavigation = browseNavigationRef.current;
  const [addProjectEnvironmentId, setAddProjectEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const [addProjectCloneFlow, setAddProjectCloneFlow] = useState<AddProjectCloneFlow | null>(null);
  // The name step of New project: while set, the palette input is the name.
  const [newProjectFlow, setNewProjectFlow] = useState<{
    readonly environmentId: EnvironmentId;
    /** Machine of the Add project sources view under this step; null from the palette root. */
    readonly sourcesEnvironmentId: EnvironmentId | null;
  } | null>(null);
  const [newProjectPublishesToGitHub, setNewProjectPublishesToGitHub] = useState(false);
  const [isCreatingNewProject, setIsCreatingNewProject] = useState(false);
  // State lags a render behind, so a repeated Enter could start a second create.
  const newProjectSubmittingRef = useRef(false);
  const createNewProject = useNewProject();
  const cloneLookupGeneration = useRef(0);
  const [isRemoteProjectLookingUp, setIsRemoteProjectLookingUp] = useState(false);
  const [isRemoteProjectCloning, setIsRemoteProjectCloning] = useState(false);
  const projectGroupingSettings = useMemo(
    () => selectProjectGroupingSettings(clientSettings),
    [clientSettings],
  );

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectEnvironmentLocationById = useMemo(
    () =>
      new Map(
        environments.map((environment) => {
          const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
          const isLocal = isPrimary || isDesktopLocalConnectionTarget(environment.entry.target);
          return [
            environment.environmentId,
            {
              kind: isLocal ? "local" : "remote",
              label: isPrimary
                ? "Local"
                : isLocal
                  ? `${environment.label} (Local)`
                  : environment.label,
              machine: resolveEnvironmentMachineKind(environment.serverConfig),
            },
          ] as const;
        }),
      ),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: clientSettings.sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      clientSettings.sidebarProjectSortOrder,
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
    ],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        unsortedProjectGroups,
        threads,
        clientSettings.sidebarProjectSortOrder,
      ),
    [clientSettings.sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const contextualProjectRef = useMemo(
    () =>
      resolveThreadActionProjectRef({
        activeDraftThread,
        activeThread: activeThread ?? undefined,
        defaultProjectRef,
      }),
    [activeDraftThread, activeThread, defaultProjectRef],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: contextualProjectRef,
      }),
    [contextualProjectRef, projectGroups],
  );
  const projectGroupByTargetKey = useMemo(
    () =>
      new Map(
        projectPickerEntries.map(({ group, targetProject }) => [
          `${targetProject.environmentId}:${targetProject.id}`,
          group,
        ]),
      ),
    [projectPickerEntries],
  );

  const addProjectEnvironmentOptions = useMemo(
    () =>
      buildAddProjectEnvironmentOptions(
        environments.map((environment) => ({
          environmentId: environment.environmentId,
          runtimeLabel: environment.label,
          isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
          machine: resolveEnvironmentMachineKind(environment.serverConfig),
          connection: environment.connection,
        })),
      ),
    [environments],
  );
  const defaultAddProjectEnvironmentId =
    addProjectEnvironmentOptions.find((option) => option.isConnected)?.environmentId ?? null;
  const wslAddProjectEnvironmentOption = useMemo(
    () =>
      addProjectEnvironmentOptions.find((option) => {
        if (!option.isConnected) {
          return false;
        }
        const environment = environments.find(
          (candidate) => candidate.environmentId === option.environmentId,
        );
        return environment
          ? desktopLocalBackendId(environment.entry.target)?.startsWith("wsl:") === true
          : false;
      }) ?? null,
    [addProjectEnvironmentOptions, environments],
  );
  const browseEnvironmentId = addProjectEnvironmentId ?? defaultAddProjectEnvironmentId;
  const browseEnvironment =
    environments.find((environment) => environment.environmentId === browseEnvironmentId) ?? null;
  // A desktop-local secondary backend (today: the WSL backend). The picker is
  // available against these too — the desktop dispatches pickFolder into the
  // backend's filesystem when routed by its instance id.
  const browseEnvironmentIsDesktopLocal =
    browseEnvironment !== null && isDesktopLocalConnectionTarget(browseEnvironment.entry.target);
  // Map the browsed desktop-local env to its desktop pool instance id (e.g.
  // "wsl:ubuntu"). The catalog environmentId is descriptor-derived and won't
  // route on the desktop side; pickFolder only recognizes the pool id, which
  // the bootstrap list exposes. Match on backend URL, exactly as Sidebar's
  // LocalSecondaryStatus does (environment.displayUrl === bootstrap.httpBaseUrl).
  const browseDesktopInstanceId = useMemo(() => {
    if (!browseEnvironmentIsDesktopLocal || browseEnvironment === null) {
      return null;
    }
    const displayUrl = browseEnvironment.displayUrl;
    if (displayUrl === null) {
      return null;
    }
    return (
      desktopLocalBootstraps.find((bootstrap) => bootstrap.httpBaseUrl === displayUrl)?.id ?? null
    );
  }, [browseEnvironment, browseEnvironmentIsDesktopLocal, desktopLocalBootstraps]);
  const sourceControlDiscovery = useEnvironmentQuery(
    browseEnvironmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: browseEnvironmentId,
          input: {},
        }),
  );
  const browseEnvironmentPlatform = getEnvironmentBrowsePlatform(
    browseEnvironment?.serverConfig?.environment.platform.os,
  );
  const isRemoteProjectRepositoryStep = addProjectCloneFlow?.step === "repository";
  // The destination step pins the repository folder onto the browsed path, so
  // the proposed clone target is "<chosen folder>/<repo>" instead of the bare
  // folder. A lookup reports "owner/repo"; a pasted clone URL falls back to its
  // own last segment, minus ".git".
  const pinnedCloneDirectoryName =
    addProjectCloneFlow?.step === "confirm"
      ? getCloneDirectoryName(
          addProjectCloneFlow.repository?.nameWithOwner ?? addProjectCloneFlow.remoteUrl,
        )
      : "";
  const browsePath = useMemo(
    () =>
      getFilesystemBrowsePath(
        query,
        browseEnvironmentPlatform,
        browseEnvironmentId !== null && !isRemoteProjectRepositoryStep && newProjectFlow === null,
      ),
    [
      browseEnvironmentId,
      browseEnvironmentPlatform,
      isRemoteProjectRepositoryStep,
      newProjectFlow,
      query,
    ],
  );
  const isBrowsing = browsePath.isBrowsing;
  const browseDirectoryPath = browsePath.directoryPath;
  const getAddProjectInitialQueryForEnvironment = useCallback(
    (environmentId: EnvironmentId | null): string => {
      const environment = environments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      const environmentSettings = environment?.serverConfig?.settings ?? null;
      const baseDirectory = environmentSettings?.addProjectBaseDirectory?.trim() ?? "";
      if (baseDirectory.length === 0) {
        return "~/";
      }
      return ensureBrowseDirectoryPath(baseDirectory);
    },
    [environments],
  );

  const projectCwdById = useMemo(
    () =>
      new Map<ProjectId, string>(projects.map((project) => [project.id, project.workspaceRoot])),
    [projects],
  );
  const projectByKey = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.title])),
    [projects],
  );

  const activeThreadId = activeThread?.id;
  const currentProjectEnvironmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  // Where "without a project" threads start: the current environment when it
  // offers them, otherwise the first connected one that does.
  const scratchTargetEnvironmentId = scratchEnvironmentId(
    currentProjectEnvironmentId ?? primaryEnvironmentId,
  );
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;
  const currentProjectCwdForBrowse =
    browseEnvironmentId && currentProjectEnvironmentId === browseEnvironmentId
      ? currentProjectCwd
      : null;
  const getBrowseCwdForEnvironment = useCallback(
    (environmentId: EnvironmentId | null): string | null =>
      environmentId && currentProjectEnvironmentId === environmentId ? currentProjectCwd : null,
    [currentProjectCwd, currentProjectEnvironmentId],
  );
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
  const browseQuery = useEnvironmentQuery(
    isBrowsing &&
      browsePath.directoryPath.length > 0 &&
      browseEnvironmentId !== null &&
      !relativePathNeedsActiveProject
      ? filesystemEnvironment.browse({
          environmentId: browseEnvironmentId,
          input: {
            partialPath: browsePath.directoryPath,
            ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
          },
        })
      : null,
  );
  const browseResult = browseQuery.data;
  const isBrowsePending = browseQuery.isPending;
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const { visibleEntries: visibleBrowseEntries, exactEntry: exactBrowseEntry } = useMemo(
    () =>
      pinnedCloneDirectoryName
        ? filterPinnedBrowseEntries({
            browseEntries,
            filterQuery: browsePath.filterQuery,
            pinnedDirectoryName: pinnedCloneDirectoryName,
            caseSensitive: !isWindowsPlatform(browseEnvironmentPlatform),
          })
        : filterFilesystemBrowseEntries(browseEntries, browsePath.filterQuery),
    [browseEntries, browseEnvironmentPlatform, browsePath.filterQuery, pinnedCloneDirectoryName],
  );

  const prefetchBrowsePath = useCallback(
    async (
      partialPath: string,
      environmentId: EnvironmentId | null = browseEnvironmentId,
      cwd: string | null = currentProjectCwdForBrowse,
    ): Promise<void> => {
      if (!environmentId) {
        return;
      }
      const environment = environments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      if (!canPreloadBrowsePath(environment?.connection.phase)) {
        return;
      }

      await loadBrowsePath({
        environmentId,
        input: {
          partialPath,
          ...(cwd ? { cwd } : {}),
        },
      });
    },
    [browseEnvironmentId, currentProjectCwdForBrowse, environments, loadBrowsePath],
  );

  useEffect(
    () => () => {
      browseNavigation.invalidate();
    },
    [browseNavigation],
  );

  const projectSearchEntries = useMemo(
    () =>
      buildProjectSearchEntries({
        pickerEntries: projectPickerEntries,
        locationByEnvironmentId: projectEnvironmentLocationById,
      }),
    [projectEnvironmentLocationById, projectPickerEntries],
  );

  const newThreadInEntries = useMemo(
    () =>
      buildNewThreadInEntries({
        pickerEntries: projectPickerEntries,
        locationByEnvironmentId: projectEnvironmentLocationById,
        scratchWorkspaceRootByEnvironmentId: new Map(
          environments.map((environment) => [
            environment.environmentId,
            scratchWorkspaceRootFor(environment.environmentId),
          ]),
        ),
        scratchTargetEnvironmentId,
      }),
    [
      environments,
      projectEnvironmentLocationById,
      projectPickerEntries,
      scratchTargetEnvironmentId,
      scratchWorkspaceRootFor,
    ],
  );

  const threadEntries = useMemo(
    () =>
      buildThreadEntries({
        threads,
        ...(activeThreadId ? { activeThreadId } : {}),
        projectTitleById,
        sortOrder: clientSettings.sidebarThreadSortOrder,
        projectByKey,
        locationByEnvironmentId: projectEnvironmentLocationById,
        providerByKey: providerEntryByEnvironmentAndInstanceId,
        contentMatchByKey: threadContentMatchByKey,
      }),
    [
      activeThreadId,
      clientSettings.sidebarThreadSortOrder,
      projectByKey,
      projectEnvironmentLocationById,
      projectTitleById,
      providerEntryByEnvironmentAndInstanceId,
      threadContentMatchByKey,
      threads,
    ],
  );
  const threadByKey = useMemo(
    () =>
      new Map<string, SidebarThreadSummary>(
        threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread]),
      ),
    [threads],
  );

  const pushPaletteView = useCallback(
    (view: CommandPaletteView): void => {
      browseNavigation.invalidate();
      setViewStack((previousViews) => [...previousViews, view]);
      setHighlightedItemValue(null);
      setQuery(view.initialQuery ?? "");
    },
    [browseNavigation],
  );

  function popView(): void {
    browseNavigation.invalidate();
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    if (viewStack.length <= 1) {
      setAddProjectEnvironmentId(null);
    } else if (newProjectFlow?.sourcesEnvironmentId) {
      // The machine switcher may have moved off the sources view's machine.
      setAddProjectEnvironmentId(newProjectFlow.sourcesEnvironmentId);
    }
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }

  function handleQueryChange(nextQuery: string): void {
    browseNavigation.invalidate();
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = useCallback(
    async (environmentId: EnvironmentId): Promise<void> => {
      const initialQuery = getAddProjectInitialQueryForEnvironment(environmentId);
      const initialBrowsePath = getBrowseDirectoryPath(initialQuery);
      const browseCwd = getBrowseCwdForEnvironment(environmentId);
      const view: CommandPaletteView = {
        addonIcon: { kind: "glyph", glyph: "folder-plus" },
        groups: [],
        initialQuery,
      };

      await browseNavigation.run(
        () =>
          initialBrowsePath.length > 0
            ? prefetchBrowsePath(initialBrowsePath, environmentId, browseCwd)
            : Promise.resolve(),
        () => {
          setAddProjectEnvironmentId(environmentId);
          setAddProjectCloneFlow(null);
          pushPaletteView(view);
        },
      );
    },
    [
      browseNavigation,
      getAddProjectInitialQueryForEnvironment,
      getBrowseCwdForEnvironment,
      prefetchBrowsePath,
      pushPaletteView,
    ],
  );

  const startAddProjectClone = useCallback(
    (environmentId: EnvironmentId, source: AddProjectRemoteSource): void => {
      setAddProjectEnvironmentId(environmentId);
      setAddProjectCloneFlow({ step: "repository", environmentId, source });
      pushPaletteView({
        addonIcon: { kind: "glyph", glyph: remoteProjectSourceGlyph(source) },
        groups: [],
        initialQuery: null,
      });
    },
    [pushPaletteView],
  );

  /** Folder that holds an environment's name-only projects, or null when it has none. */
  const newProjectsRootFor = useCallback(
    (environmentId: EnvironmentId | null): string | null =>
      environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
        ?.newProjectsRoot ?? null,
    [environments],
  );

  const startNewProject = useCallback(
    (environmentId: EnvironmentId, sourcesEnvironmentId: EnvironmentId | null): void => {
      setAddProjectEnvironmentId(environmentId);
      setAddProjectCloneFlow(null);
      setNewProjectFlow({ environmentId, sourcesEnvironmentId });
      setNewProjectPublishesToGitHub(false);
      pushPaletteView({
        addonIcon: { kind: "glyph", glyph: "folder-git" },
        groups: [],
        initialQuery: null,
      });
    },
    [pushPaletteView],
  );

  const openSourceControlSettings = useCallback(() => {
    setOpen(false);
    void navigate({ to: "/settings/source-control" });
  }, [navigate, setOpen]);

  const startAddProjectSourceSelection = useCallback(
    (environmentId: EnvironmentId): void => {
      const environment = environments.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      if (!canCreateProjectInEnvironment(environment?.connection.phase)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Environment unavailable",
            description: `${environment?.label ?? "The selected environment"} is not connected.`,
          }),
        );
        return;
      }
      setAddProjectEnvironmentId(environmentId);
      setAddProjectCloneFlow(null);
      pushPaletteView({
        addonIcon: { kind: "glyph", glyph: "folder-plus" },
        groups: buildAddProjectSourceGroups({
          environmentId,
          readiness: buildAddProjectRemoteSourceReadiness(
            browseEnvironmentId === environmentId ? sourceControlDiscovery.data : null,
          ),
          canCreateNewProject: newProjectsRootFor(environmentId) !== null,
        }),
        initialQuery: null,
      });
    },
    [
      browseEnvironmentId,
      environments,
      newProjectsRootFor,
      pushPaletteView,
      sourceControlDiscovery.data,
    ],
  );

  const newProjectEnvironmentOptions = addProjectEnvironmentOptions.filter(
    (option) => option.isConnected && newProjectsRootFor(option.environmentId) !== null,
  );

  const addProjectEnvironmentGroups = useMemo(
    () => buildAddProjectEnvironmentGroups(addProjectEnvironmentOptions),
    [addProjectEnvironmentOptions],
  );

  const openAddProjectFlow = useCallback(() => {
    // With no connected environment there is nothing to browse, so the only
    // useful next step is connecting one.
    if (addProjectEnvironmentOptions.length === 0) {
      setOpen(false);
      void navigate({ to: "/settings/connections" });
      return;
    }

    if (addProjectEnvironmentOptions.length > 1 || defaultAddProjectEnvironmentId === null) {
      pushPaletteView({
        addonIcon: { kind: "glyph", glyph: "folder-plus" },
        groups: addProjectEnvironmentGroups,
        initialQuery: null,
      });
      return;
    }

    void startAddProjectSourceSelection(defaultAddProjectEnvironmentId);
  }, [
    addProjectEnvironmentGroups,
    addProjectEnvironmentOptions.length,
    defaultAddProjectEnvironmentId,
    navigate,
    pushPaletteView,
    setOpen,
    startAddProjectSourceSelection,
  ]);

  // New project starts on this device (options list it first); the name step
  // lists the other machines when there is a choice.
  const openNewProjectFlow = () => {
    const firstOption = newProjectEnvironmentOptions[0];
    if (firstOption) startNewProject(firstOption.environmentId, null);
  };

  useLayoutEffect(() => {
    if (openIntent?.kind !== "search") return;
    browseNavigation.invalidate();
    cloneLookupGeneration.current += 1;
    setIsRemoteProjectLookingUp(false);
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    setViewStack([]);
    setLinkedThreadSearch(openIntent);
    setQuery(openIntent.query);
    clearOpenIntent();
  }, [browseNavigation, clearOpenIntent, openIntent]);

  useLayoutEffect(() => {
    if (openIntent?.kind !== "add-project") {
      return;
    }
    clearOpenIntent();
    openAddProjectFlow();
  }, [clearOpenIntent, openAddProjectFlow, openIntent]);

  useLayoutEffect(() => {
    if (openIntent?.kind !== "new-thread-in" || newThreadInEntries.length === 0) {
      return;
    }
    clearOpenIntent();
    browseNavigation.invalidate();
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    setViewStack([]);
    setQuery("");
    pushPaletteView(
      buildNewThreadInView({
        entries: newThreadInEntries,
        currentProjectRef:
          currentProjectEnvironmentId && currentProjectId
            ? scopeProjectRef(currentProjectEnvironmentId, currentProjectId)
            : null,
      }),
    );
  }, [
    clearOpenIntent,
    browseNavigation,
    currentProjectEnvironmentId,
    currentProjectId,
    openIntent,
    newThreadInEntries,
    pushPaletteView,
  ]);

  useLayoutEffect(() => {
    if (openIntent?.kind !== "change-theme") return;
    clearOpenIntent();
    browseNavigation.invalidate();
    cloneLookupGeneration.current += 1;
    setIsRemoteProjectLookingUp(false);
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    setViewStack([]);
    pushPaletteView(buildChangeThemeView());
  }, [browseNavigation, clearOpenIntent, openIntent, pushPaletteView]);

  // Target the active thread or draft's project, falling back to the first sidebar group.
  const contextualProjectGroup =
    (contextualProjectRef
      ? projectGroupByTargetKey.get(
          `${contextualProjectRef.environmentId}:${contextualProjectRef.projectId}`,
        )
      : null) ??
    projectGroups[0] ??
    null;

  const actionEntries = buildActionEntries({
    hasProjects: projects.length > 0,
    activeProjectTitle:
      projectPickerEntries.find((entry) => entry.isPreferred)?.group.displayName ??
      (currentProjectId ? (projectTitleById.get(currentProjectId) ?? null) : null),
    newThreadInEntries,
    scratchTargetEnvironmentId,
    copyThreadReferenceTarget: activeThreadReferenceCopyTarget,
    activeThread:
      activeThread === null
        ? null
        : {
            environmentId: activeThread.environmentId,
            id: activeThread.id,
            pullRequests: activeThread.pullRequests,
            capabilities: activeThreadServerConfig?.environment.capabilities ?? null,
          },
    canCreateNewProject: newProjectEnvironmentOptions.length > 0,
    wslFolderEnvironment: wslAddProjectEnvironmentOption,
    themeGroups: buildThemeGroups({ cards: themeCards, theme, themeHalves, resolvedTheme }),
    appearanceMode,
    pullRequestsAvailable: environments.some(
      (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
    ),
    projectSettingsTarget: contextualProjectGroup
      ? {
          projectKey: contextualProjectGroup.projectKey,
          displayName: contextualProjectGroup.displayName,
        }
      : null,
  });

  const newProjectGitHubTarget =
    newProjectFlow === null ? null : getNewProjectGitHubTarget(sourceControlDiscovery.data ?? null);
  const newProjectsRoot = newProjectFlow ? newProjectsRootFor(newProjectFlow.environmentId) : null;
  const environmentConnected = canCreateProjectInEnvironment(browseEnvironment?.connection.phase);
  const isRemoteProjectPending = isRemoteProjectLookingUp || isRemoteProjectCloning;
  const useMetaForMod = isMacPlatform(navigator.platform);

  const model = buildCommandPaletteModel({
    query,
    deferredQuery,
    platform: navigator.platform,
    keybindings,
    currentView,
    highlightedItemValue,
    actionEntries,
    threadEntries,
    linkedThreadSearch,
    projectSearchEntries,
    availableSettingsSearchItems,
    settingsSearchPlatform: { isElectron, platform: navigator.platform },
    addProjectSources:
      addProjectEnvironmentId === null
        ? null
        : {
            environmentId: addProjectEnvironmentId,
            readiness: buildAddProjectRemoteSourceReadiness(sourceControlDiscovery.data),
            canCreateNewProject: newProjectsRootFor(addProjectEnvironmentId) !== null,
          },
    threadSearchPending: threadSearch.isPending,
    environmentConnected,
    browse: {
      isBrowsing,
      entries: visibleBrowseEntries,
      canBrowseUp: browsePath.canBrowseUp,
      relativePathNeedsActiveProject,
      isPending: isBrowsePending,
      hasResult: Boolean(browseResult),
      hasExactEntry: exactBrowseEntry !== null,
    },
    cloneFlow: addProjectCloneFlow,
    remoteProjectPending: isRemoteProjectPending,
    newProject:
      newProjectFlow === null
        ? null
        : {
            environmentId: newProjectFlow.environmentId,
            root: newProjectsRoot,
            githubTarget: newProjectGitHubTarget,
            publishesToGitHub: newProjectPublishesToGitHub,
            isCreating: isCreatingNewProject,
            machineOptions: newProjectEnvironmentOptions,
            environmentLabelFallback:
              environmentLabelById.get(newProjectFlow.environmentId) ?? null,
          },
  });

  const resolveContext: CommandPaletteResolveContext = {
    threads,
    sidebarThreadSortOrder: clientSettings.sidebarThreadSortOrder,
    contextualProjectRef,
    appearanceMode,
    pathname,
    browse: {
      query,
      directoryPath: browsePath.directoryPath,
      parentPath: browsePath.parentPath,
      pinnedCloneDirectoryName,
      platform: browseEnvironmentPlatform,
    },
  };

  const handleAddProjectForEnvironment = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly rawCwd: string;
      readonly platform: string;
      readonly currentProjectCwd: string | null;
    }) => {
      const added = await addProjectFromPath(
        {
          environments,
          projects,
          threads,
          threadSortOrder: clientSettings.sidebarThreadSortOrder,
          createProject,
          navigateToThread: async (threadRef) => {
            await navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(threadRef),
            });
          },
          openNewThread: handleNewThread,
          showError: ({ title, description }) => {
            toastManager.add(stackedThreadToast({ type: "error", title, description }));
          },
        },
        input,
      );
      if (added) setOpen(false);
    },
    [
      handleNewThread,
      createProject,
      environments,
      navigate,
      primaryEnvironmentId,
      projects,
      providers,
      setOpen,
      clientSettings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      if (!browseEnvironmentId) return;
      await handleAddProjectForEnvironment({
        environmentId: browseEnvironmentId,
        rawCwd,
        platform: browseEnvironmentPlatform,
        currentProjectCwd: currentProjectCwdForBrowse,
      });
    },
    [
      browseEnvironmentId,
      browseEnvironmentPlatform,
      currentProjectCwdForBrowse,
      handleAddProjectForEnvironment,
    ],
  );

  async function submitNewProject(): Promise<void> {
    if (newProjectFlow === null || !model.canSubmitNewProject || newProjectSubmittingRef.current) {
      return;
    }
    newProjectSubmittingRef.current = true;
    setIsCreatingNewProject(true);
    try {
      const created = await createNewProject({
        environmentId: newProjectFlow.environmentId,
        name: model.newProjectName,
        github: newProjectPublishesToGitHub ? newProjectGitHubTarget : null,
      });
      if (created) setOpen(false);
    } finally {
      newProjectSubmittingRef.current = false;
      setIsCreatingNewProject(false);
    }
  }

  function getDefaultCloneParentPath(environmentId: EnvironmentId): string {
    return getAddProjectInitialQueryForEnvironment(environmentId);
  }

  async function submitAddProjectCloneFlow(destinationPathInput?: string): Promise<void> {
    if (!addProjectCloneFlow) {
      return;
    }
    const next = await submitAddProjectClone(
      {
        lookupRepository,
        cloneRepository,
        startProjectClone,
        addProject: handleAddProject,
        waitForProject: (projectRef) => waitForProject(projectRef, 3_000),
        openNewThread: handleNewThread,
        newProjectId,
        showError: ({ title, description }) => {
          toastManager.add(stackedThreadToast({ type: "error", title, description }));
        },
        close: () => setOpen(false),
        startLookup: () => {
          setIsRemoteProjectLookingUp(true);
          cloneLookupGeneration.current += 1;
          return cloneLookupGeneration.current;
        },
        isCurrentLookup: (generation) => generation === cloneLookupGeneration.current,
        finishLookup: () => setIsRemoteProjectLookingUp(false),
        setCloning: setIsRemoteProjectCloning,
      },
      {
        flow: addProjectCloneFlow,
        query,
        destinationPathInput,
        environment: {
          connected: canCreateProjectInEnvironment(browseEnvironment?.connection.phase),
          label: browseEnvironment?.label ?? null,
        },
        isLookingUp: isRemoteProjectLookingUp,
        isCloning: isRemoteProjectCloning,
        defaultCloneParentPath: getDefaultCloneParentPath(addProjectCloneFlow.environmentId),
        platform: browseEnvironmentPlatform,
        currentProjectCwd: currentProjectCwdForBrowse,
        cloneTracking:
          browseEnvironment?.serverConfig?.environment.capabilities.projectCloneTracking === true,
      },
    );
    if (next === null) return;
    setAddProjectCloneFlow(next.flow);
    setHighlightedItemValue(null);
    setQuery(next.query);
    setBrowseGeneration((generation) => generation + 1);
  }

  // Resolve the add-project path from browse data when available. When the
  // query has a trailing separator (e.g. "~/projects/foo/"), parentPath is the
  // directory itself. Otherwise the user typed a partial leaf name, so we need
  // the exact browse entry's fullPath or fall back to the raw query.
  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  // The name step's way out to folders and clones, for the selected machine.
  // It replaces the name step (and a sources view for another machine under
  // it), so Back returns to wherever New project was opened from.
  const showExistingProjectSources = (environmentId: EnvironmentId) => {
    const sourcesEnvironmentId = newProjectFlow?.sourcesEnvironmentId ?? null;
    if (sourcesEnvironmentId === environmentId) {
      popView();
      return;
    }
    if (sourcesEnvironmentId !== null) {
      setViewStack((previousViews) => previousViews.slice(0, -1));
    }
    popView();
    startAddProjectSourceSelection(environmentId);
  };
  // Switching machines keeps the typed name; the GitHub option follows the
  // machine because source control discovery reads addProjectEnvironmentId.
  const switchNewProjectEnvironment = (environmentId: EnvironmentId) => {
    setNewProjectFlow((flow) => (flow === null ? flow : { ...flow, environmentId }));
    setAddProjectEnvironmentId(environmentId);
  };

  const fileManagerName = getLocalFileManagerName(navigator.platform);
  const canOpenProjectFromFileManager =
    isBrowsing &&
    browseEnvironmentId !== null &&
    // For a desktop-local (WSL) env, only offer the picker once we have resolved
    // its desktop pool instance id. Without it pickFolder can't be routed to the
    // WSL filesystem and would open the primary (Windows) picker, then add the
    // chosen Windows path against the WSL env -- a wrong-path footgun. Stay
    // hidden until the bootstrap mapping is available rather than mis-routing.
    (browseEnvironmentId === primaryEnvironmentId ||
      (browseEnvironmentIsDesktopLocal && browseDesktopInstanceId !== null)) &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;
  const fileManagerInitialPath = useMemo(() => {
    if (!canOpenProjectFromFileManager) {
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return undefined;
    }

    const initialPath = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? trimmedQuery)
      : browseDirectoryPath || trimmedQuery;

    const resolvedPath = resolveProjectPathForDispatch(initialPath, currentProjectCwdForBrowse);
    return resolvedPath.length > 0 ? resolvedPath : undefined;
  }, [
    browseDirectoryPath,
    browseResult?.parentPath,
    canOpenProjectFromFileManager,
    currentProjectCwdForBrowse,
    query,
  ]);

  async function restartAgentSession(environmentId: EnvironmentId, threadId: string) {
    const thread = activeThread;
    if (thread === null || thread.environmentId !== environmentId || thread.id !== threadId) {
      return;
    }
    // Stopping the provider process keeps the conversation: the next message
    // spawns a fresh one that resumes it and reloads skills, plugins, and MCP
    // servers. The fresh workspace scan updates the composer's slash menu.
    // Failures throw into executeRow's error toast.
    if (thread.session && thread.session.status !== "stopped") {
      const stopped = await stopThreadSession({
        environmentId,
        input: { threadId: thread.id },
      });
      if (stopped._tag === "Failure") throw squashAtomCommandFailure(stopped);
    }
    // The server stops the process after accepting the command. A failed
    // stop shows in the thread.
    toastManager.add({
      type: "success",
      title: "Agent session will restart",
      description: "Your next message starts a fresh session.",
    });
    const project = projectByKey.get(`${environmentId}:${thread.projectId}`);
    if (!project) return;
    const refreshed = await refreshProviders({
      environmentId,
      input: {
        instanceId: thread.session?.providerInstanceId ?? thread.modelSelection.instanceId,
        cwd: thread.worktreePath ?? project.workspaceRoot,
        fresh: true,
      },
    });
    if (refreshed._tag === "Failure") throw squashAtomCommandFailure(refreshed);
  }

  async function runPaletteCommand(command: CommandPaletteCommand): Promise<void> {
    switch (command.kind) {
      case "navigate-thread":
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(command.environmentId, command.threadId)),
        });
        return;
      case "new-thread":
        await handleNewThread(command.projectRef);
        return;
      case "new-thread-without-project":
        await startScratchThread(command.environmentId);
        return;
      case "new-thread-from-context":
        await startNewThreadFromContext({
          activeDraftThread,
          activeThread: activeThread ?? undefined,
          defaultProjectRef,
          handleNewThread,
        });
        return;
      case "copy-thread-reference":
        await copyActiveThreadReference();
        return;
      case "link-pull-request":
        openLinkPullRequestDialog(scopeThreadRef(command.environmentId, command.threadId));
        return;
      case "open-thread-pull-requests":
        useRightPanelStore
          .getState()
          .open(scopeThreadRef(command.environmentId, command.threadId), "pull-requests");
        return;
      case "restart-agent-session":
        await restartAgentSession(command.environmentId, command.threadId);
        return;
      case "open-overlay":
        openOverlayMode(command.mode);
        return;
      case "start-new-project":
        openNewProjectFlow();
        return;
      case "start-add-project":
        openAddProjectFlow();
        return;
      case "browse-add-project":
        await startAddProjectBrowse(command.environmentId);
        return;
      case "set-theme":
        if (!setTheme(command.theme)) notifyThemeSaveFailure();
        return;
      case "set-theme-half":
        if (!setThemeHalf(command.mode, command.themeId)) notifyThemeSaveFailure();
        return;
      case "set-appearance":
        if (!setAppearanceMode(command.mode)) notifyThemeSaveFailure();
        return;
      case "toggle-theme-editor":
        toggleThemeEditorForTheme({
          theme,
          themeHalves,
          initialAppearance: resolvedTheme,
        });
        return;
      case "open-pull-requests":
        await navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
        return;
      case "open-usage":
        await navigate({ to: "/usage" });
        return;
      case "open-settings":
        await navigate({ to: "/settings" });
        return;
      case "open-project-settings":
        await navigate({
          to: "/projects/$projectKey",
          params: { projectKey: command.projectKey },
        });
        return;
      case "open-setting":
        await navigate({
          to: command.to,
          hash: command.hash,
          replace: command.replace,
          hashScrollIntoView: false,
        });
        return;
      case "open-source-control-settings":
        openSourceControlSettings();
        return;
      case "browse":
        await browseNavigation.run(
          () => prefetchBrowsePath(command.prefetchPath),
          () => {
            setHighlightedItemValue(null);
            setQuery(command.nextQuery);
            setBrowseGeneration((generation) => generation + 1);
          },
        );
        return;
      case "select-add-project-environment":
        startAddProjectSourceSelection(command.environmentId);
        return;
      case "start-new-project-in":
        startNewProject(command.environmentId, command.sourcesEnvironmentId);
        return;
      case "start-clone":
        startAddProjectClone(command.environmentId, command.source);
        return;
      case "switch-new-project-environment":
        switchNewProjectEnvironment(command.environmentId);
        return;
      case "show-existing-project-sources":
        showExistingProjectSources(command.environmentId);
        return;
      case "toggle-new-project-github":
        setNewProjectPublishesToGitHub((publishes) => !publishes);
        return;
    }
  }

  function executeRow(row: CommandPaletteRow): void {
    const resolution = resolveCommandPaletteItem(row, resolveContext);
    if (resolution.kind === "ignore") {
      return;
    }

    if (resolution.kind === "open-view") {
      pushPaletteView(resolution.view);
      return;
    }

    if (!resolution.keepOpen) {
      setOpen(false);
    }

    void runPaletteCommand(resolution.command).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to run command",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    });
  }

  function renderAccessory(accessory: CommandPaletteAccessory): ReactNode {
    switch (accessory.kind) {
      case "current":
        return <span className="text-xs text-muted-foreground/70">Current</span>;
      case "theme-previews":
        return (
          <span className="flex shrink-0 items-center gap-2">
            {accessory.current ? (
              <span className="text-xs text-muted-foreground/70">Current</span>
            ) : null}
            <span className="flex items-center gap-1" aria-hidden>
              {accessory.previews.map((preview) => (
                <ThemePreviewCircle
                  key={preview.mode}
                  colors={preview.colors}
                  mode={preview.mode}
                  className="size-3 border-0"
                />
              ))}
            </span>
          </span>
        );
      case "setup-required":
        return (
          <span className="ml-auto">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="warning-outline"
                    size="micro"
                    onClick={() => {
                      openSourceControlSettings();
                    }}
                  >
                    Setup Required
                  </Button>
                }
              />
              <TooltipPopup align="end" side="left">
                {accessory.hint}
              </TooltipPopup>
            </Tooltip>
          </span>
        );
      case "selected":
        return <CheckIcon className="ms-auto size-4 shrink-0 text-muted-foreground/70" />;
      case "chevron":
        return (
          <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
        );
      case "checkbox":
        return (
          <span className="pointer-events-none ms-auto flex">
            <Checkbox checked={accessory.checked} tabIndex={-1} aria-hidden />
          </span>
        );
    }
  }

  function toPaletteItem(
    row: CommandPaletteRow,
  ): CommandPaletteActionItem | CommandPaletteSubmenuItem {
    const thread = row.thread
      ? threadByKey.get(`${row.thread.environmentId}:${row.thread.threadId}`)
      : undefined;
    const description = renderPaletteDescription(row);
    const titleTrailingContent = thread ? (
      <ThreadRowTrailingStatus thread={thread} />
    ) : row.accessory ? (
      renderAccessory(row.accessory)
    ) : undefined;
    const item = {
      value: row.value,
      searchTerms: row.searchTerms,
      title:
        row.titleEmphasis === undefined ? (
          row.title
        ) : (
          <>
            {row.title}
            <span className="font-semibold">{row.titleEmphasis}</span>
          </>
        ),
      icon: renderPaletteIcon(row.icon),
      ...(description !== undefined ? { description } : {}),
      ...(row.threadContentMatch ? { threadContentMatch: row.threadContentMatch } : {}),
      ...(row.timestamp !== undefined ? { timestamp: row.timestamp } : {}),
      ...(row.searchRecency !== undefined ? { searchRecency: row.searchRecency } : {}),
      ...(row.disabled !== undefined ? { disabled: row.disabled } : {}),
      ...(thread ? { titleLeadingContent: <ThreadRowLeadingStatus thread={thread} /> } : {}),
      ...(titleTrailingContent !== undefined ? { titleTrailingContent } : {}),
      ...(row.shortcutCommand ? { shortcutCommand: row.shortcutCommand } : {}),
      ...(row.secondary ? { secondary: row.secondary } : {}),
    };
    if (row.kind === "submenu") {
      return { ...item, kind: "submenu" };
    }
    return {
      ...item,
      kind: "action",
      ...(row.keepOpen ? { keepOpen: row.keepOpen } : {}),
      run: async () => {
        executeRow(row);
      },
    };
  }

  const rows = model.groups.flatMap((group) => group.items);
  const rowByValue = new Map(rows.map((row) => [row.value, row]));
  const displayedGroups: CommandPaletteGroup[] = model.groups.map((group) => ({
    value: group.value,
    label: group.label,
    items: group.items.map(toPaletteItem),
  }));

  function isPrimaryModifierPressed(event: KeyboardEvent<HTMLInputElement>): boolean {
    return useMetaForMod ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  function submitBrowsePath(): void {
    if (model.isCloneDestinationStep) {
      void submitAddProjectCloneFlow(resolvedAddProjectPath);
    } else {
      void handleAddProject(resolvedAddProjectPath);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: { modelPickerOpen: false },
    });
    if (threadJumpIndexFromCommand(command ?? "") !== null) {
      event.preventDefault();
      event.stopPropagation();
      const matchingRow = rows.find((row) => row.shortcutCommand === command);
      if (matchingRow) {
        executeRow(matchingRow);
      }
      return;
    }
    if (command === "thread.copyReference") {
      event.preventDefault();
      event.stopPropagation();
      if (activeThreadReferenceCopyTarget === null) return;
      setOpen(false);
      void copyActiveThreadReference();
      return;
    }

    if (addProjectCloneFlow?.step === "repository" && event.key === "Enter") {
      event.preventDefault();
      void submitAddProjectCloneFlow();
      return;
    }

    // Enter creates the project unless an item below the name is
    // highlighted, in which case it runs that item.
    if (
      newProjectFlow !== null &&
      event.key === "Enter" &&
      highlightedItemValue === null &&
      // Enter that confirms an IME composition is part of typing the name.
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      void submitNewProject();
      return;
    }

    const shouldSubmitBrowsePath =
      model.canSubmitBrowsePath &&
      event.key === "Enter" &&
      (!model.hasHighlightedBrowseItem || isPrimaryModifierPressed(event));

    if (shouldSubmitBrowsePath) {
      event.preventDefault();
      submitBrowsePath();
      return;
    }

    if (event.key === "Backspace" && query === "" && model.isSubmenu) {
      event.preventDefault();
      popView();
    }
  }

  const handleOpenProjectFromFileManager = useCallback(async () => {
    if (!canOpenProjectFromFileManager || isPickingProjectFolder) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      return;
    }

    setIsPickingProjectFolder(true);
    let pickedPath: string | null = null;
    let desktopWslState: DesktopWslState | null = null;
    try {
      desktopWslState =
        browseEnvironmentId === primaryEnvironmentId && browseEnvironmentPlatform === "Linux"
          ? ((await window.desktopBridge?.getWslState().catch(() => null)) ?? null)
          : null;
      // Route the picker to the browsed env's backend filesystem. The desktop
      // only resolves a "wsl:*" pool instance id, so for a desktop-local env we
      // pass the bootstrap-mapped instance id (not the catalog environmentId).
      // A WSL-only primary has no secondary bootstrap, so resolve its instance
      // id from desktop settings. Windows and combo-mode primaries still omit
      // the target to preserve the native primary picker. The desktop converts
      // a WSL UNC selection back to a Linux path before returning.
      const pickerTargetEnvironmentId = resolveProjectPickerTarget({
        browseEnvironmentId,
        primaryEnvironmentId,
        desktopInstanceId: browseDesktopInstanceId,
        wslConfiguration: desktopWslState,
      });
      const pickerOptions = {
        ...(fileManagerInitialPath ? { initialPath: fileManagerInitialPath } : {}),
        ...(pickerTargetEnvironmentId ? { targetEnvironmentId: pickerTargetEnvironmentId } : {}),
      };
      pickedPath = await api.dialogs.pickFolder(
        Object.keys(pickerOptions).length > 0 ? pickerOptions : undefined,
      );
    } catch {
      // Ignore picker failures and leave the palette open.
      setIsPickingProjectFolder(false);
      return;
    }
    setIsPickingProjectFolder(false);
    if (!pickedPath) {
      return;
    }
    if (parseWslUncPath(pickedPath)) {
      desktopWslState ??= (await window.desktopBridge?.getWslState().catch(() => null)) ?? null;
      let primaryRunningDistro: string | null = null;
      try {
        primaryRunningDistro =
          window.desktopBridge
            ?.getLocalEnvironmentBootstraps()
            .find((bootstrap) => bootstrap.id === PRIMARY_LOCAL_ENVIRONMENT_ID)?.runningDistro ??
          null;
      } catch {
        // Keep UNC routing strict when the live primary identity cannot be read.
      }
      const selection = resolveWslProjectSelection(
        pickedPath,
        applyWslEnvironmentConfiguration(
          environments.flatMap((environment) => {
            const backendId = desktopLocalBackendId(environment.entry.target);
            if (!backendId) {
              return [];
            }

            const bootstrap = desktopLocalBootstraps.find(
              (candidate) => candidate.httpBaseUrl === environment.displayUrl,
            );
            const runningDistro = bootstrap?.runningDistro ?? null;
            return [{ environmentId: environment.environmentId, backendId, runningDistro }];
          }),
          primaryEnvironmentId,
          desktopWslState ?? null,
          primaryRunningDistro,
        ),
      );
      if (!selection) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not add WSL project",
            description: "Start the matching WSL backend, then choose the folder again.",
          }),
        );
        return;
      }
      await handleAddProjectForEnvironment({
        environmentId: selection.environmentId,
        rawCwd: selection.linuxPath,
        platform: "Linux",
        currentProjectCwd: null,
      });
      return;
    }
    await handleAddProject(pickedPath);
  }, [
    browseDesktopInstanceId,
    browseEnvironmentId,
    browseEnvironmentPlatform,
    canOpenProjectFromFileManager,
    desktopLocalBootstraps,
    environments,
    fileManagerInitialPath,
    handleAddProject,
    handleAddProjectForEnvironment,
    isPickingProjectFolder,
    primaryEnvironmentId,
  ]);

  const submit = model.submit;
  const inputAccessory =
    submit === null ? null : (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className="absolute inset-e-2.5 top-1/2 -translate-y-1/2"
              aria-label={submit.ariaLabel}
              disabled={submit.disabled}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                switch (submit.action) {
                  case "create-project":
                    void submitNewProject();
                    return;
                  case "lookup-repository":
                    void submitAddProjectCloneFlow();
                    return;
                  case "add-path":
                    if (relativePathNeedsActiveProject) {
                      return;
                    }
                    submitBrowsePath();
                    return;
                }
              }}
            />
          }
        >
          <span>{submit.label}</span>
          <KbdGroup className="pointer-events-none -me-0.5">
            <Kbd>{submit.shortcutLabel}</Kbd>
          </KbdGroup>
        </TooltipTrigger>
        <TooltipPopup side="top">{submit.tooltip}</TooltipPopup>
      </Tooltip>
    );

  const footerTrailing = canOpenProjectFromFileManager ? (
    <CommandFooterAction
      disabled={isPickingProjectFolder}
      onClick={() => {
        void handleOpenProjectFromFileManager();
      }}
    >
      {`Open in ${fileManagerName}`}
    </CommandFooterAction>
  ) : null;

  return (
    <CommandPaletteContent
      key={`${viewStack.length}-${browseGeneration}-${isBrowsing}-${newProjectFlow ? "new-project" : (addProjectCloneFlow?.step ?? "none")}`}
      aria-label="Command palette"
      autoHighlight={model.autoHighlight ? "always" : false}
      footerActionLabel={model.footerActionLabel ?? undefined}
      footerTrailing={footerTrailing}
      inputAccessory={inputAccessory}
      inputProps={{
        // The submit button is absolutely positioned over the field, so the
        // inner input must reserve enough room for the full action label.
        className:
          addProjectCloneFlow?.step === "repository" || newProjectFlow !== null
            ? "*:data-[slot=autocomplete-input]:pe-32!"
            : isBrowsing
              ? browseInputEndPaddingClass({
                  willCreateProjectPath: model.willCreateProjectPath,
                  hasHighlightedBrowseItem: model.hasHighlightedBrowseItem,
                })
              : undefined,
        placeholder: model.inputPlaceholder,
        ...(model.isSubmenu
          ? {
              startAddon: (
                <button
                  type="button"
                  className="flex cursor-pointer items-center"
                  aria-label="Back"
                  onClick={popView}
                >
                  <ArrowLeftIcon />
                </button>
              ),
            }
          : isBrowsing
            ? { startAddon: <FolderPlusIcon /> }
            : {}),
        onKeyDown: handleKeyDown,
      }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={handleQueryChange}
      showBackHint={model.isSubmenu}
      value={query}
    >
      {model.newProjectHeader !== null ? (
        <div className="p-2 pb-0">
          <div className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1.5">
            <FolderGit2Icon className={ITEM_ICON_CLASS} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground text-sm">
                {model.newProjectHeader.title}
              </span>
              <span className="truncate text-muted-foreground/85 text-xs">
                {model.newProjectHeader.detail}
              </span>
            </span>
          </div>
        </div>
      ) : null}
      {model.repositoryHeader !== null ? (
        <div className="p-2 pb-0">
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Repository</div>
          <div className="flex min-h-8 items-center gap-2 rounded-sm px-2 py-1.5">
            {renderPaletteIcon(model.repositoryHeader.icon)}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground text-sm">
                {model.repositoryHeader.title}
              </span>
              <span className="truncate text-muted-foreground/85 text-xs">
                {model.repositoryHeader.description}
              </span>
            </span>
          </div>
        </div>
      ) : null}
      <CommandPaletteResults
        groups={displayedGroups}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={model.isActionsOnly}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          const row = rowByValue.get(item.value);
          if (row) executeRow(row);
        }}
        emptyStateMessage={model.emptyStateMessage}
      />
    </CommandPaletteContent>
  );
}
