import { pullRequestHostOf, type SourceControlProviderKind } from "@t3tools/contracts";
import { useProjects, useServerConfigs, useThreadShells } from "~/state/entities";
import type {
  EnvironmentId,
  PreviewSessionSnapshot,
  ProjectId,
  PullRequestState,
} from "@t3tools/contracts";
import {
  Bot,
  Smartphone,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDiff,
  Files,
  Globe2,
  type LucideIcon,
  Plus,
  TerminalSquare,
  Volume2,
  VolumeOff,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewState.logic";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Button } from "~/components/ui/button";
import { AndroidIcon, AppleIcon } from "~/components/Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useBrowserDefaults } from "~/browser/browserDefaults";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { useDeviceState } from "~/state/device";
import { pullRequestEnvironment, useSharedPullRequestSummary } from "~/state/pullRequests";
import { newestPullRequestSummary } from "~/state/pullRequestSummaries";
import { useEnvironmentQuery } from "~/state/query";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { previewBridge } from "./preview/previewBridge";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  buildDeviceTabTooltipModel,
  buildRightPanelTabsModel,
  buildTabContextMenuItems,
  LAUNCHER_SHORTCUT_BLOCKING_LAYERS,
  resolveLauncherHighlightIndex,
  resolvePullRequestTabLink,
  resolveRightPanelPullRequestTabStatus,
  resolveSurfaceLauncherKey,
  resolveTabActivate,
  resolveTabAuxClick,
  resolveTabContextMenuAction,
  resolveTabDoubleClick,
  resolveTabRenameKey,
  resolveTabScrollState,
  resolveTabScrollStep,
  resolveTabWheelDelta,
  shouldOpenDefaultBrowserProfileFromMenuClick,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
  type RightPanelLauncherModel,
  type RightPanelSurfaceActionKey,
  type RightPanelTabIntent,
  type RightPanelTabModel,
  type RightPanelTabContextMenuInput,
} from "./RightPanelTabs.logic";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  open?: boolean;
  /** Forwarded to PreviewPanelShell so this surface persists its own width. */
  widthStorageKey?: string;
  /** Forwarded to PreviewPanelShell as the initial width before a user resize. */
  defaultWidth?: number;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  /** Fallback environment for surfaces that do not carry their own. */
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  /**
   * Maps a server session tab id to the desktop runtime tab id the Electron
   * preview manager is keyed by. Session ids are only unique within one server
   * process, so desktop operations must not be addressed with them.
   */
  previewRuntimeTabId?: ((tabId: string) => string) | undefined;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onRenameDevice?: (surfaceId: string, title: string) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  /**
   * Separate from `onAddBrowser` on purpose: that one is passed directly as a
   * DOM click handler, and a `(profileId?: string)` signature would silently
   * accept the MouseEvent as a profile id.
   */
  onAddBrowserInProfile: (profileId: string) => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddPullRequests: () => void;
  onAddAgents: () => void;
  onAddDevice: () => void;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  pullRequestsAvailable: boolean;
  agentsAvailable: boolean;
  deviceAvailable: boolean;
  pullRequestStatusSeeds?: Readonly<Record<string, PullRequestTabStatusSeed>>;
  /** Running + waiting subagents; badges the Agents card in the empty state. */
  liveAgentCount: number;
  children: ReactNode;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

export type PullRequestTabStatusSeed = Pick<PullRequestTabStatus, "state" | "isDraft">;

type SurfaceActionHandlers = Readonly<Record<RightPanelSurfaceActionKey, () => void>>;

const SURFACE_ACTION_ICONS: Readonly<Record<RightPanelSurfaceActionKey, LucideIcon>> = {
  browser: Globe2,
  terminal: TerminalSquare,
  files: Files,
  diff: FileDiff,
  pullRequest: PullRequestGlyph.pullRequest,
  pullRequests: PullRequestGlyph.link,
  agents: Bot,
  device: Smartphone,
};

function tabScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
  return root?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
      aria-keyshortcuts={props.shortcut}
    >
      {props.children}
      <MenuShortcut>{props.shortcut}</MenuShortcut>
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

/**
 * List launcher shown when the right panel has no surfaces. Keyboard-first
 * without palette chrome: a surface's letter opens it directly from anywhere
 * outside a typing context, and arrows plus Enter work while the launcher is
 * focused. The highlight only appears on hover or arrow use. Unavailable
 * surfaces stay visible with a one-line reason.
 */
function RightPanelEmptyState(props: {
  launcher: RightPanelLauncherModel;
  handlers: SurfaceActionHandlers;
  onAddBrowserInProfile: (profileId: string) => void;
}) {
  // -1 means no highlight: it only appears on hover or arrow use.
  const [highlight, setHighlight] = useState(-1);
  const { launcher, handlers } = props;

  const availableActions = launcher.actions.filter((action) => action.available);
  const highlightIndex = resolveLauncherHighlightIndex(highlight, availableActions.length);
  const availableIndexOf = (key: RightPanelSurfaceActionKey) =>
    availableActions.findIndex((action) => action.key === key);

  // Letter shortcuts work while the launcher is visible, not only while it
  // is focused; focus moves around too easily (stray clicks) to carry them.
  // Capture phase so app-level key handlers cannot swallow the event first;
  // typing contexts and already-handled events are left alone.
  const shortcutStateRef = useRef({ actions: availableActions, handlers });
  useEffect(() => {
    shortcutStateRef.current = { actions: availableActions, handlers };
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const { actions, handlers: currentHandlers } = shortcutStateRef.current;
      const action = surfaceShortcutActionForKey(actions, event);
      if (!action) return;
      if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
      const target = event.target;
      if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
      event.preventDefault();
      event.stopPropagation();
      currentHandlers[action.key]();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const intent = resolveSurfaceLauncherKey({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      highlightIndex,
      availableCount: availableActions.length,
      // Only activate the highlight when the launcher itself has focus.
      targetIsLauncher: event.target === event.currentTarget,
    });
    if (intent.kind === "none") return;
    event.preventDefault();
    if (intent.kind === "highlight") {
      setHighlight(intent.index);
      return;
    }
    const action = availableActions[intent.index];
    if (action) handlers[action.key]();
  };

  // Stable identity so React only runs this callback ref on mount/unmount;
  // an inline arrow would re-attach and re-focus on every render.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);

  const isHighlighted = (key: RightPanelSurfaceActionKey) =>
    highlightIndex !== -1 && availableActions[highlightIndex]?.key === key;

  const actionIcon = (
    action: RightPanelLauncherModel["actions"][number],
    iconClassName = "size-4",
  ) => {
    const Icon = SURFACE_ACTION_ICONS[action.key];
    return (
      <span className="relative inline-flex shrink-0">
        <Icon className={iconClassName} />
        {action.badgeCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-3xs font-semibold tabular-nums text-white"
          >
            {action.badgeCount}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={launcher.ariaLabel}
      data-surface-launcher-keys={launcher.shortcutKeys}
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 outline-none",
        // The panel topbar sits above this container; matching bottom padding
        // keeps the list centered against the full panel, not the leftover.
        "pb-(--workspace-topbar-height)",
      )}
    >
      <div className="w-full max-w-xs py-6">
        <h3 className="mb-3 text-center font-medium text-foreground text-sm">{launcher.title}</h3>
        <div className="flex flex-col gap-0.5">
          {launcher.actions.map((action) =>
            action.available ? (
              // The row is itself a button, so the profile chooser sits beside
              // it in a wrapper rather than inside it. Hover lives on the
              // wrapper: the chooser overlays the row, and a pointer moving
              // onto it must not read as leaving the row.
              <div
                key={action.label}
                className="group relative"
                onMouseEnter={() => setHighlight(availableIndexOf(action.key))}
                onMouseLeave={() =>
                  setHighlight((current) =>
                    current === availableIndexOf(action.key) ? -1 : current,
                  )
                }
              >
                <button
                  type="button"
                  onClick={handlers[action.key]}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm transition-colors group-hover:bg-accent/60",
                    isHighlighted(action.key) && "bg-accent/60",
                  )}
                >
                  {actionIcon(action, "size-4")}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      action.key === "browser" && launcher.showBrowserProfileChooser && "pr-7",
                    )}
                  >
                    {action.label}
                  </span>
                  <Kbd>{action.shortcut}</Kbd>
                </button>
                {/*
                  Same choice the tab bar's "+" menu offers: the row opens the
                  default profile, the chevron picks another. Only worth showing
                  once there is something to choose between.
                */}
                {action.key === "browser" && launcher.showBrowserProfileChooser ? (
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          aria-label="Open browser in a profile"
                          className="absolute top-1/2 right-8 -translate-y-1/2"
                          size="icon-xs"
                          variant="ghost-muted"
                        />
                      }
                    >
                      <ChevronDown className="size-3.5" />
                    </MenuTrigger>
                    <MenuPopup align="end" side="bottom" sideOffset={6} className="max-w-56">
                      {launcher.browserProfiles.map((profile) => (
                        <MenuItem
                          key={profile.id}
                          onClick={() => props.onAddBrowserInProfile(profile.id)}
                        >
                          <span className="min-w-0 truncate">{profile.name}</span>
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                ) : null}
              </div>
            ) : (
              <DisabledReasonTooltip
                key={action.label}
                reason={action.disabledReason}
                trigger={
                  <div
                    tabIndex={0}
                    aria-disabled="true"
                    className="flex h-8 w-full cursor-default items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm opacity-50"
                  >
                    {actionIcon(action, "size-4")}
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    <Kbd>{action.shortcut}</Kbd>
                  </div>
                }
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3 shrink-0" />}
      className="size-3 shrink-0 rounded-sm object-contain"
    />
  );
}

function SurfaceIcon({
  tab,
  surface,
  theme,
  environmentId,
  pullRequestStatusSeeds,
}: {
  tab: RightPanelTabModel;
  surface: RightPanelSurface;
  theme: "light" | "dark";
  environmentId: EnvironmentId | null;
  pullRequestStatusSeeds: Readonly<Record<string, PullRequestTabStatusSeed>> | undefined;
}) {
  const icon = tab.icon;
  switch (icon.kind) {
    case "preview":
      return <PreviewFavicon capturedUrl={icon.capturedFaviconUrl} url={icon.url} />;
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return <PierreEntryIcon pathValue={icon.path} kind="file" theme={theme} className="size-3" />;
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request":
      return surface.kind === "pull-request" ? (
        <PullRequestSurfaceIcon
          surface={surface}
          environmentId={environmentId}
          seed={pullRequestStatusSeeds?.[surface.id]}
        />
      ) : null;
    case "pull-requests":
      return <PullRequestGlyph.link className="size-3 shrink-0" />;
    case "agents":
      return <Bot className="size-3 shrink-0" />;
    case "device":
      return icon.platform === "ios" ? (
        <AppleIcon className="size-3 shrink-0" />
      ) : icon.platform === "android" ? (
        <AndroidIcon className="size-3 shrink-0" />
      ) : (
        <Smartphone className="size-3 shrink-0" />
      );
  }
}

function PullRequestSurfaceIcon({
  surface,
  environmentId,
  seed,
}: {
  surface: Extract<RightPanelSurface, { kind: "pull-request" }>;
  environmentId: EnvironmentId | null;
  seed: PullRequestTabStatusSeed | undefined;
}) {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const projects = useProjects();
  const threads = useThreadShells();
  const project = projects.find(
    (entry) => entry.environmentId === resolvedEnvironmentId && entry.id === surface.projectId,
  );
  const identity = project?.repositoryIdentity;
  const host =
    surface.host ??
    (identity?.provider
      ? pullRequestHostOf(identity, identity.provider as SourceControlProviderKind)
      : null);
  const configs = useServerConfigs();
  const capabilities =
    resolvedEnvironmentId === null
      ? undefined
      : configs.get(resolvedEnvironmentId)?.environment.capabilities;
  const linkedSnapshot =
    capabilities?.threadPullRequests === true
      ? (resolvePullRequestTabLink(threads, resolvedEnvironmentId, host, surface)?.snapshot ?? null)
      : null;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null || capabilities?.pullRequests !== true || linkedSnapshot !== null
      ? null
      : pullRequestEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            ...(capabilities?.threadPullRequests === true && surface.host !== undefined
              ? { host: surface.host }
              : {}),
            repository: surface.repository,
            number: surface.number,
          },
        }),
  ).data;
  const reference = useMemo(
    () => ({
      projectId: surface.projectId as ProjectId,
      repository: surface.repository,
      number: surface.number,
    }),
    [surface.projectId, surface.repository, surface.number],
  );
  const sharedSummary = useSharedPullRequestSummary(resolvedEnvironmentId, reference, null);
  // The compact tab intentionally shows lifecycle and draft state only. Conflict warnings have
  // their own presentation on surfaces that have mergeability, while this tab stays stable as
  // detail data arrives.
  const status = resolveRightPanelPullRequestTabStatus({
    linkedSnapshot,
    summary: newestPullRequestSummary(detail, sharedSummary),
    seed,
    detailIsDraft: detail?.isDraft,
  });
  if (status === null) {
    return <PullRequestGlyph.pullRequest className="size-3 shrink-0 text-muted-foreground" />;
  }
  const presentation = resolvePullRequestState(status);
  return <presentation.Icon className={cn("size-3 shrink-0", presentation.toneClassName)} />;
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const browserProfiles = useBrowserDefaults().profiles;
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [renamingDevice, setRenamingDevice] = useState<string | null>(null);
  const [addSurfaceMenuOpen, setAddSurfaceMenuOpen] = useState(false);
  const [tabScrollState, setTabScrollState] = useState(() =>
    resolveTabScrollState({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0 }),
  );

  const updateTabScrollState = useCallback(() => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;

    const next = resolveTabScrollState(viewport);
    setTabScrollState((current) => {
      if (
        current.hasOverflow === next.hasOverflow &&
        current.canScrollLeft === next.canScrollLeft &&
        current.canScrollRight === next.canScrollRight
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const scrollTabs = useCallback((direction: -1 | 1) => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({
      left: resolveTabScrollStep(direction, viewport.clientWidth),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const model = buildRightPanelTabsModel({
    surfaces: props.surfaces,
    activeSurfaceId: props.activeSurfaceId,
    pendingSurfaceIds: props.pendingSurfaceIds,
    previewSessions: props.previewSessions,
    desktopByTabId: props.desktopByTabId,
    previewRuntimeTabId: props.previewRuntimeTabId ?? null,
    terminalLabelsById: props.terminalLabelsById,
    canRenameDevice: props.onRenameDevice !== undefined,
    browserProfiles,
    liveAgentCount: props.liveAgentCount,
    pullRequestStatusBySurfaceId: props.pullRequestStatusSeeds ?? {},
    browserAvailable: props.browserAvailable,
    terminalAvailable: props.terminalAvailable,
    diffAvailable: props.diffAvailable,
    filesAvailable: props.filesAvailable,
    pullRequestAvailable: props.pullRequestAvailable,
    pullRequestsAvailable: props.pullRequestsAvailable,
    agentsAvailable: props.agentsAvailable,
    deviceAvailable: props.deviceAvailable,
  });

  const surfaceActionHandlers: SurfaceActionHandlers = {
    browser: props.onAddBrowser,
    terminal: props.onAddTerminal,
    files: props.onAddFiles,
    diff: props.onAddDiff,
    pullRequest: props.onAddPullRequest,
    pullRequests: props.onAddPullRequests,
    agents: props.onAddAgents,
    device: props.onAddDevice,
  };

  const handleAddSurfaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = surfaceShortcutActionForKey(model.addSurfaceActions, event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    setAddSurfaceMenuOpen(false);
    surfaceActionHandlers[action.key]();
  };

  const runTabIntent = useCallback(
    (intent: RightPanelTabIntent) => {
      switch (intent.kind) {
        case "none":
          return;
        case "activate":
          props.onActivate(intent.surface);
          return;
        case "rename":
          setRenamingDevice(intent.surfaceId);
          return;
        case "copy-path":
          props.onCopyFilePath(intent.relativePath);
          return;
        case "set-audio-muted":
          void previewBridge
            ?.setAudioMuted(intent.runtimeTabId, intent.muted)
            .catch(() => undefined);
          return;
        case "close":
          props.onCloseSurface(intent.surface);
          return;
        case "close-others":
          props.onCloseOtherSurfaces(intent.surface);
          return;
        case "close-to-right":
          props.onCloseSurfacesToRight(intent.surface);
          return;
        case "close-all":
          props.onCloseAllSurfaces();
          return;
      }
    },
    [props],
  );

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const menuInput: RightPanelTabContextMenuInput = {
        surface,
        surfaces: props.surfaces,
        previewSessions: props.previewSessions,
        desktopByTabId: props.desktopByTabId,
        previewRuntimeTabId: props.previewRuntimeTabId ?? null,
        canRenameDevice: props.onRenameDevice !== undefined,
      };
      const items = buildTabContextMenuItems(menuInput);
      if (items === null) return;

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      runTabIntent(resolveTabContextMenuAction(action, menuInput));
    },
    [props, runTabIntent],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      const intent = resolveTabAuxClick(event.button, surface);
      if (intent.kind === "none") return;
      event.preventDefault();
      event.stopPropagation();
      runTabIntent(intent);
    },
    [runTabIntent],
  );

  useEffect(() => {
    if (!props.activeSurfaceId || !tabScrollState.hasOverflow) return;
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId, tabScrollState.hasOverflow]);

  useEffect(() => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;

    const content = viewport.firstElementChild;
    const resizeObserver = new ResizeObserver(updateTabScrollState);
    resizeObserver.observe(viewport);
    if (content) resizeObserver.observe(content);
    viewport.addEventListener("scroll", updateTabScrollState, { passive: true });
    updateTabScrollState();

    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener("scroll", updateTabScrollState);
    };
  }, [updateTabScrollState]);

  useEffect(() => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      const delta = resolveTabWheelDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode:
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? "line"
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? "page"
              : "pixel",
        ctrlKey: event.ctrlKey,
        clientWidth: viewport.clientWidth,
      });
      if (delta === 0) return;

      const previousScrollLeft = viewport.scrollLeft;
      viewport.scrollLeft += delta;
      if (viewport.scrollLeft === previousScrollLeft) return;
      event.preventDefault();
      updateTabScrollState();
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [updateTabScrollState]);

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
          // The sheet overlays from the viewport top, so its tab bar keeps
          // the titlebar's height: a compact row re-centers the layout
          // controls a few pixels higher and the cluster jumps on open.
          props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "drag-region",
          ownsDesktopTitleBar && "wco:pr-(--workspace-native-controls-inset)",
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          radius="none"
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className="min-w-0 flex-1"
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            {props.surfaces.map((surface, index) => {
              const tab = model.tabs[index];
              if (!tab) return null;
              const { title, audio } = tab;
              return (
                <div
                  key={surface.id}
                  data-active-tab={tab.active}
                  onMouseDown={handleTabMouseDown}
                  onAuxClick={(event) => handleTabAuxClick(event, surface)}
                  onContextMenu={(event) => void handleTabContextMenu(event, surface)}
                  className={cn(
                    "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                    ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
                    tab.active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <PanelTabCloseButton
                    label={tab.closeLabel}
                    onClick={() => runTabIntent({ kind: "close", surface })}
                  >
                    <SurfaceIcon
                      tab={tab}
                      surface={surface}
                      theme={resolvedTheme}
                      environmentId={props.environmentId}
                      pullRequestStatusSeeds={props.pullRequestStatusSeeds}
                    />
                    {tab.pending ? (
                      <span
                        className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                        aria-hidden
                      />
                    ) : null}
                  </PanelTabCloseButton>
                  {audio === null ? null : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="cursor-pointer flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                            aria-label={audio.toggleLabel}
                            onClick={(event) => {
                              // Sibling of the close button, inside a tab that
                              // activates on click: keep this to the toggle.
                              event.stopPropagation();
                              runTabIntent({
                                kind: "set-audio-muted",
                                runtimeTabId: audio.runtimeTabId,
                                muted: audio.nextMuted,
                              });
                            }}
                          >
                            {audio.state === "muted" ? (
                              <VolumeOff className="size-3" />
                            ) : (
                              <Volume2 className="size-3" />
                            )}
                          </button>
                        }
                      />
                      <TooltipPopup>{audio.tooltip}</TooltipPopup>
                    </Tooltip>
                  )}
                  {renamingDevice === surface.id ? (
                    <input
                      aria-label="Device tab name"
                      className="w-24 min-w-0 rounded-sm bg-background px-1 outline-none ring-1 ring-ring"
                      defaultValue={title}
                      ref={(element) => {
                        element?.focus();
                        element?.select();
                      }}
                      onBlur={(event) => {
                        props.onRenameDevice?.(surface.id, event.currentTarget.value);
                        setRenamingDevice(null);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        const renameIntent = resolveTabRenameKey(event.key);
                        if (renameIntent === "commit") event.currentTarget.blur();
                        if (renameIntent === "revert") {
                          event.currentTarget.value = title;
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            onDoubleClick={() =>
                              runTabIntent(
                                resolveTabDoubleClick(surface, props.onRenameDevice !== undefined),
                              )
                            }
                            className="cursor-pointer flex min-w-0 items-center"
                            onClick={() => runTabIntent(resolveTabActivate(surface))}
                          >
                            <span className="truncate">{title}</span>
                          </button>
                        }
                      />
                      <TooltipPopup>
                        {surface.kind === "device" ? (
                          <DeviceTabTooltip
                            surface={surface}
                            environmentId={props.environmentId}
                            title={title}
                          />
                        ) : (
                          tab.tooltip
                        )}
                      </TooltipPopup>
                    </Tooltip>
                  )}
                </div>
              );
            })}
            {model.showAddSurfaceMenu ? (
              <Menu open={addSurfaceMenuOpen} onOpenChange={setAddSurfaceMenuOpen}>
                <MenuTrigger
                  render={
                    <Button
                      aria-label="Add panel surface"
                      className="shrink-0"
                      size="icon-xs"
                      variant="ghost-muted"
                    />
                  }
                >
                  <Plus className="size-3.5" />
                </MenuTrigger>
                <MenuPopup
                  align="start"
                  side="bottom"
                  sideOffset={6}
                  onKeyDownCapture={handleAddSurfaceMenuKeyDown}
                >
                  {model.addSurfaceActions.map((action) => {
                    const Icon = SURFACE_ACTION_ICONS[action.key];
                    // Browser collapses into one row: clicking the trigger opens
                    // the default profile (the common case stays one click),
                    // while hover or arrow reveals the profiles. The choice
                    // lives at open time because a tab's profile is fixed then —
                    // Electron only honours a partition before attach.
                    if (action.key === "browser" && action.available) {
                      return (
                        <MenuSub key={action.label}>
                          <MenuSubTrigger
                            className="[&>svg:last-child]:ms-0"
                            aria-keyshortcuts={action.shortcut}
                            onClick={(event) => {
                              const pointerType =
                                "pointerType" in event.nativeEvent &&
                                typeof event.nativeEvent.pointerType === "string"
                                  ? event.nativeEvent.pointerType
                                  : undefined;
                              // Touch has no hover path to the profile choices:
                              // its first tap opens the submenu, then a profile
                              // is selected there. Mouse click keeps the common
                              // default-profile action at one click.
                              if (!shouldOpenDefaultBrowserProfileFromMenuClick(pointerType))
                                return;
                              setAddSurfaceMenuOpen(false);
                              surfaceActionHandlers[action.key]();
                            }}
                          >
                            <Icon />
                            {action.label}
                            <MenuShortcut>{action.shortcut}</MenuShortcut>
                          </MenuSubTrigger>
                          {/*
                            Capped and truncated: profile names are user-supplied
                            and run to 48 characters, which would otherwise widen
                            the popup to fit-content and wrap.
                          */}
                          <MenuSubPopup className="max-w-56">
                            {browserProfiles.map((profile) => (
                              <MenuItem
                                key={profile.id}
                                onClick={() => props.onAddBrowserInProfile(profile.id)}
                              >
                                <span className="min-w-0 truncate">{profile.name}</span>
                              </MenuItem>
                            ))}
                          </MenuSubPopup>
                        </MenuSub>
                      );
                    }
                    return (
                      <SurfaceMenuItem
                        key={action.label}
                        available={action.available}
                        disabledReason={action.disabledReason}
                        shortcut={action.shortcut}
                        onClick={surfaceActionHandlers[action.key]}
                      >
                        <Icon />
                        {action.label}
                      </SurfaceMenuItem>
                    );
                  })}
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
        </ScrollArea>
        {tabScrollState.hasOverflow ? (
          <div
            className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
            role="group"
            aria-label="Scroll panel tabs"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label="Scroll tabs left"
                      disabled={!tabScrollState.canScrollLeft}
                      onClick={() => scrollTabs(-1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronLeft />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>Scroll tabs left</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label="Scroll tabs right"
                      disabled={!tabScrollState.canScrollRight}
                      onClick={() => scrollTabs(1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronRight />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>Scroll tabs right</TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
        {props.layoutControls}
        {ownsDesktopTitleBar && !props.layoutControls ? (
          // Keeps the tabs clear of the window controls when the layout toggles live elsewhere.
          <span aria-hidden className="hidden w-24 shrink-0 wco:block" />
        ) : null}
        {ownsDesktopTitleBar ? (
          <span
            aria-hidden
            className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {model.launcher === null ? (
          props.children
        ) : (
          <RightPanelEmptyState
            launcher={model.launcher}
            handlers={surfaceActionHandlers}
            onAddBrowserInProfile={props.onAddBrowserInProfile}
          />
        )}
      </div>
    </PreviewPanelShell>
  );
}

function DeviceTabTooltip(props: {
  surface: Extract<RightPanelSurface, { kind: "device" }>;
  environmentId: EnvironmentId | null;
  title: string;
}) {
  const target = props.surface.target;
  const { state } = useDeviceState(target ? props.environmentId : null);
  const device = target
    ? state.devices.find((entry) => entry.hostId === target.hostId && entry.id === target.deviceId)
    : undefined;
  const host = target ? state.hosts.find((entry) => entry.id === target.hostId) : undefined;
  const tooltip = buildDeviceTabTooltipModel({
    title: props.title,
    target,
    hostLabel: host?.label,
    deviceVersion: device?.version,
  });
  return (
    <div className="flex flex-col gap-0.5">
      <span>{tooltip.title}</span>
      {tooltip.subtitle === null ? null : (
        <span className="text-muted-foreground">{tooltip.subtitle}</span>
      )}
    </div>
  );
}
