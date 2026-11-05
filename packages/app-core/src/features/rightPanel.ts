import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { deriveThreadAgentPanelModel } from "@t3tools/web/src/components/AgentsPanel.logic.ts";
import {
  buildRightPanelMaximizeModel,
  isRightPanelMaximized,
  resolveCanMaximizeRightPanel,
  resolveRightPanelCloseFloat,
  resolveRightPanelToggleIntent,
  toggleMaximizedRightPanelThreadKey,
  type RightPanelMaximizeModel,
} from "@t3tools/web/src/components/chat/PanelLayoutControls.logic.ts";
import {
  getPreviewPanelMaxWidth,
  PREVIEW_PANEL_DEFAULT_WIDTH,
  PREVIEW_PANEL_MIN_WIDTH,
  PREVIEW_PANEL_WIDTH_STORAGE_KEY,
} from "@t3tools/web/src/components/preview/PreviewPanelShell.logic.ts";
import {
  buildRightPanelTabsModel,
  buildTabContextMenuItems,
  resolveLauncherHighlightIndex,
  resolvePullRequestTabLink,
  resolveRightPanelPullRequestTabStatus,
  resolveSurfaceLauncherKey,
  resolveTabContextMenuAction,
  surfaceShortcutActionForKey,
  type RightPanelPullRequestTabStatus,
  type RightPanelSurfaceActionKey,
  type RightPanelSurfaceActionModel,
  type RightPanelSurfaceIconModel,
  type RightPanelTabContextMenuInput,
  type RightPanelTabIntent,
  type RightPanelTabsModel,
} from "@t3tools/web/src/components/RightPanelTabs.logic.ts";
import { useDiffPanelStore } from "@t3tools/web/src/diffPanelStore.ts";
import {
  browserMiniPlayerSource,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore.ts";
import { clampResizableWidth } from "@t3tools/web/src/hooks/useResizableWidth.logic.ts";
import {
  PULL_REQUESTS_PANEL_REF,
  pullRequestSurface,
  selectActiveRightPanelSurface,
  useRightPanelStore,
  type RightPanelSurface,
} from "@t3tools/web/src/rightPanelStore.ts";
import {
  observedPullRequestSummaryAtom,
  newestPullRequestSummary,
  pullRequestSummaryKey,
} from "@t3tools/web/src/state/pullRequestSummaries.ts";
import { derivePhase, isLatestTurnSettled } from "@t3tools/web/src/session-logic.ts";
import {
  buildProactivePullRequestsKey,
  resolveProactivePanelStep,
  type ObservedThreadPullRequest,
  type ProactivePanelObservation,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import { resolveThreadTurnState } from "@t3tools/web/src/components/chat/threadRunState.logic.ts";
import {
  EnvironmentId,
  ProjectId,
  pullRequestHostOf,
  SourceControlProviderKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import { panelRouteAtom, pullRequestPageBridge, readQuery } from "../pullRequestShared.ts";
import { contextMenuService } from "../contextMenu.ts";
import { browserPreviewService, parseRuntimeTabId } from "../browserPreview.ts";
import { closeBrowserSession, openBrowserSession } from "./browser.ts";
import { addDeviceSurface } from "./device.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { resolvePierreFileIcon, type PierreIconView } from "../pierreIcon.ts";
import {
  makeRouteRightPanelStateAtom,
  pendingFileSurfaceIdsAtom,
  persistRightPanelStore,
  type RouteRightPanelState,
} from "../rightPanelState.ts";
import {
  closePanelTerminalSessions,
  closePanelTerminalSurface,
  createTerminalLabelsAtom,
  openPanelTerminal,
} from "../terminalSessions.ts";

const SURFACE_ACTION_KEYS = [
  "browser",
  "terminal",
  "files",
  "diff",
  "pullRequest",
  "pullRequests",
  "agents",
  "device",
] as const;

const SurfaceIdParams = Schema.decodeUnknownSync(Schema.Struct({ surfaceId: Schema.String }));
const OpenSurfaceParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.Literals(SURFACE_ACTION_KEYS) }),
);
const LauncherKeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const LauncherHighlightParams = Schema.decodeUnknownSync(Schema.Struct({ index: Schema.Number }));
const SetWidthParams = Schema.decodeUnknownSync(Schema.Struct({ width: Schema.Number }));
const LayoutBoundsParams = Schema.decodeUnknownSync(
  Schema.Struct({ viewportWidth: Schema.Number, containerWidth: Schema.Number }),
);
const TabContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ surfaceId: Schema.String, x: Schema.Number, y: Schema.Number }),
);
const WidthJson = Schema.fromJsonString(Schema.Finite);
const decodeWidth = Schema.decodeUnknownSync(WidthJson);
const encodeWidth = Schema.encodeSync(WidthJson);

export type RightPanelActionRef = {
  readonly action: string;
  readonly params: Readonly<Record<string, string>>;
};

export type RightPanelTabView = {
  readonly id: string;
  readonly kind: RightPanelSurface["kind"];
  readonly title: string;
  readonly closeLabel: string;
  readonly tooltip: string;
  readonly active: boolean;
  readonly pending: boolean;
  readonly icon: RightPanelSurfaceIconModel;
  readonly fileIcon: PierreIconView | null;
  readonly select: RightPanelActionRef;
  readonly close: RightPanelActionRef;
};

export type RightPanelSurfaceActionView = RightPanelSurfaceActionModel & {
  readonly action: RightPanelActionRef;
};

export type RightPanelLauncherView = {
  readonly title: string;
  readonly actions: ReadonlyArray<RightPanelSurfaceActionView>;
  readonly highlightedKey: RightPanelSurfaceActionKey | null;
};

export type RightPanelWidthView = {
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
};

export type RightPanelView = {
  readonly threadKey: string;
  readonly open: boolean;
  readonly animationDurationMs: number;
  readonly maximized: boolean;
  readonly maximize: RightPanelMaximizeModel;
  readonly width: RightPanelWidthView;
  readonly tabs: ReadonlyArray<RightPanelTabView>;
  readonly showAddSurfaceMenu: boolean;
  readonly addSurfaceActions: ReadonlyArray<RightPanelSurfaceActionView>;
  readonly launcher: RightPanelLauncherView | null;
  readonly activeSurface: { readonly id: string; readonly kind: RightPanelSurface["kind"] } | null;
};

type LayoutBounds = { readonly viewportWidth: number; readonly containerWidth: number };

const FALLBACK_VIEWPORT_WIDTH = 1280;

function panelMaxWidth(bounds: LayoutBounds | null): number {
  return bounds === null
    ? getPreviewPanelMaxWidth(FALLBACK_VIEWPORT_WIDTH)
    : getPreviewPanelMaxWidth(bounds.viewportWidth, bounds.containerWidth);
}

const PULL_REQUESTS_PANEL_WIDTH_STORAGE_KEY = "t3code:pull-request-panel-width";

const isProviderKind = Schema.is(SourceControlProviderKind);

function isPullRequestsPanel(route: ScopedThreadRef): boolean {
  return scopedThreadKey(route) === scopedThreadKey(PULL_REQUESTS_PANEL_REF);
}

function widthStorageKey(route: ScopedThreadRef): string {
  return isPullRequestsPanel(route)
    ? PULL_REQUESTS_PANEL_WIDTH_STORAGE_KEY
    : `${PREVIEW_PANEL_WIDTH_STORAGE_KEY}:${scopedThreadKey(route)}`;
}

function readStoredWidth(storage: Storage, route: ScopedThreadRef): number | null {
  const raw = storage.getItem(widthStorageKey(route));
  if (raw === null) return null;
  try {
    return decodeWidth(raw);
  } catch {
    return null;
  }
}

function surfaceAction(key: RightPanelSurfaceActionKey): RightPanelActionRef {
  return key === "terminal"
    ? { action: "terminalPanelNew", params: {} }
    : { action: "rightPanelOpenSurface", params: { key } };
}

function withAction(
  actions: ReadonlyArray<RightPanelSurfaceActionModel>,
): ReadonlyArray<RightPanelSurfaceActionView> {
  return actions.map((action) => ({ ...action, action: surfaceAction(action.key) }));
}

function closeAction(surface: RightPanelSurface): RightPanelActionRef {
  return surface.kind === "terminal"
    ? { action: "terminalPanelCloseSurface", params: { surfaceId: surface.id } }
    : { action: "rightPanelCloseTab", params: { surfaceId: surface.id } };
}

function tabMenuInput(
  surface: RightPanelSurface,
  surfaces: ReadonlyArray<RightPanelSurface>,
  preview: Pick<
    RightPanelTabContextMenuInput,
    "previewSessions" | "desktopByTabId" | "previewRuntimeTabId"
  >,
): RightPanelTabContextMenuInput {
  return {
    surface,
    surfaces,
    ...preview,
    canRenameDevice: false,
  };
}

export function createRightPanelFeature(context: FeatureContext): CoreFeature {
  const { registry, storage } = context;
  void persistRightPanelStore(storage);

  const bridge = pullRequestPageBridge(context);
  const routePanelAtom = makeRouteRightPanelStateAtom(panelRouteAtom(context));
  const browser = browserPreviewService(context);
  const previewInputFor = (get: Atom.AtomContext | null, route: ScopedThreadRef) => {
    const atom = browser.previewStateAtom(scopedThreadKey(route));
    const preview = get === null ? registry.get(atom) : get(atom);
    return {
      previewSessions: preview.sessions,
      desktopByTabId: preview.desktopByTabId,
      previewRuntimeTabId: (tabId: string) => browser.runtimeTabId(route, tabId),
    };
  };
  registry.subscribe(
    Atom.make((get) => {
      const route = get(context.routeAtom);
      if (route === null) return null;
      const preview = get(browser.previewStateAtom(scopedThreadKey(route)));
      return { route, tabIds: Object.keys(preview.sessions) };
    }),
    (value) => {
      if (value === null) return;
      useRightPanelStore.getState().reconcileBrowserSurfaces(value.route, value.tabIds);
    },
    { immediate: true },
  );
  const terminalLabelsAtom = createTerminalLabelsAtom(context);
  const maximizedThreadKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const layoutBoundsAtom = Atom.make<LayoutBounds | null>(null).pipe(Atom.keepAlive);
  const widthRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);
  const launcherHighlightAtom = Atom.make(-1).pipe(Atom.keepAlive);

  const availabilityAtom = Atom.make((get) => {
    const panel = get(routePanelAtom);
    if (panel !== null && isPullRequestsPanel(panel.route)) {
      return {
        browserAvailable: false,
        terminalAvailable: false,
        diffAvailable: false,
        filesAvailable: false,
        pullRequestAvailable: false,
        pullRequestsAvailable: false,
        agentsAvailable: false,
        deviceAvailable: false,
        liveAgentCount: 0,
      };
    }
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const { route, thread, project, serverConfig } = input;
    const shell = get(context.state.environmentThreadShells.threadShellAtom(route)) ?? thread;
    const capabilities = serverConfig?.environment.capabilities;
    const isGitRepo = get(context.gitStatusAtom)?.status?.isRepo ?? true;
    const projectAvailable = project !== undefined;
    return {
      browserAvailable: true,
      terminalAvailable: projectAvailable,
      diffAvailable: input.isServerThread && isGitRepo,
      filesAvailable: projectAvailable,
      pullRequestAvailable:
        capabilities?.pullRequests === true &&
        (shell.linkedPullRequest ?? shell.branchPullRequest ?? null) !== null,
      pullRequestsAvailable:
        input.isServerThread &&
        capabilities?.threadPullRequests === true &&
        visibleThreadPullRequests(shell.pullRequests ?? []).length > 0,
      agentsAvailable: true,
      deviceAvailable: true,
      liveAgentCount: deriveThreadAgentPanelModel({
        activities: thread.activities,
        sessionPhase: derivePhase(thread.session ?? null),
      }).liveCount,
    };
  });

  const pullRequestStatusesAtom = Atom.make(
    (get): Readonly<Record<string, RightPanelPullRequestTabStatus>> => {
      const panel = get(routePanelAtom);
      if (panel === null) return {};
      const pullRequestSurfaces = panel.state.surfaces.filter(
        (surface) => surface.kind === "pull-request",
      );
      if (pullRequestSurfaces.length === 0) return {};
      const onPage = isPullRequestsPanel(panel.route);
      const seeds = onPage ? get(bridge.tabStatusSeedsAtom) : {};
      const projects = get(context.state.environmentProjects.projectsAtom);
      const threads = get(context.state.environmentThreadShells.threadShellsAtom).map((thread) => ({
        environmentId: thread.environmentId,
        pullRequests: thread.pullRequests ?? [],
      }));
      const statuses: Record<string, RightPanelPullRequestTabStatus> = {};
      for (const surface of pullRequestSurfaces) {
        const environmentId =
          surface.environmentId === undefined
            ? onPage
              ? null
              : panel.route.environmentId
            : EnvironmentId.make(surface.environmentId);
        const identity = projects.find(
          (entry) => entry.environmentId === environmentId && entry.id === surface.projectId,
        )?.repositoryIdentity;
        const host =
          surface.host ??
          (identity?.provider && isProviderKind(identity.provider)
            ? pullRequestHostOf(identity, identity.provider)
            : null);
        const capabilities =
          environmentId === null
            ? undefined
            : get(context.state.serverEnvironment.configValueAtom(environmentId))?.environment
                .capabilities;
        const linkedSnapshot =
          capabilities?.threadPullRequests === true
            ? (resolvePullRequestTabLink(threads, environmentId, host, surface)?.snapshot ?? null)
            : null;
        const reference = {
          projectId: ProjectId.make(surface.projectId),
          repository: surface.repository,
          number: surface.number,
        };
        const detail =
          environmentId === null || capabilities?.pullRequests !== true || linkedSnapshot !== null
            ? null
            : readQuery(
                get,
                context.state.pullRequestEnvironment.detail({
                  environmentId,
                  input: {
                    ...reference,
                    ...(capabilities.threadPullRequests === true && surface.host !== undefined
                      ? { host: surface.host }
                      : {}),
                  },
                }),
              ).data;
        const shared =
          environmentId === null
            ? null
            : (get(observedPullRequestSummaryAtom(pullRequestSummaryKey(environmentId, reference)))
                ?.summary ?? null);
        const status = resolveRightPanelPullRequestTabStatus({
          linkedSnapshot,
          summary: newestPullRequestSummary(detail, shared),
          seed: seeds[surface.id],
          detailIsDraft: detail?.isDraft,
        });
        if (status !== null) statuses[surface.id] = status;
      }
      return statuses;
    },
  );

  const tabsModelAtom = Atom.make((get): RightPanelTabsModel | null => {
    const panel = get(routePanelAtom);
    const availability = get(availabilityAtom);
    if (panel === null || availability === null) return null;
    const project = isPullRequestsPanel(panel.route)
      ? undefined
      : get(context.threadInputAtom)?.project;
    return buildRightPanelTabsModel({
      ...availability,
      surfaces: panel.state.surfaces,
      activeSurfaceId: panel.activeSurface?.id ?? null,
      pendingSurfaceIds:
        project === undefined
          ? new Set()
          : (get(pendingFileSurfaceIdsAtom).get(
              `${project.environmentId}:${project.workspaceRoot}`,
            ) ?? new Set()),
      ...previewInputFor(get, panel.route),
      terminalLabelsById: panel.state.surfaces.some((surface) => surface.kind === "terminal")
        ? get(terminalLabelsAtom)
        : new Map(),
      canRenameDevice: false,
      browserProfiles: [],
      pullRequestStatusBySurfaceId: get(pullRequestStatusesAtom),
    });
  });

  const maximizedAtom = Atom.make((get) => {
    const panel = get(routePanelAtom);
    if (panel === null) return false;
    return isRightPanelMaximized({
      canMaximize: resolveCanMaximizeRightPanel({
        rightPanelOpen: panel.state.isOpen,
        usesRightPanelSheet: false,
      }),
      maximizedThreadKey: get(maximizedThreadKeyAtom),
      routeThreadKey: scopedThreadKey(panel.route),
    });
  });

  const viewAtom = Atom.make((get): RightPanelView | null => {
    const panel = get(routePanelAtom);
    const model = get(tabsModelAtom);
    if (panel === null || model === null) return null;
    get(widthRevisionAtom);
    const threadKey = scopedThreadKey(panel.route);
    const bounds = get(layoutBoundsAtom);
    const maxWidth = panelMaxWidth(bounds);
    const defaultWidth = isPullRequestsPanel(panel.route)
      ? Math.floor((bounds?.viewportWidth ?? FALLBACK_VIEWPORT_WIDTH) / 2)
      : PREVIEW_PANEL_DEFAULT_WIDTH;
    const widthBounds = {
      defaultWidth,
      minWidth: PREVIEW_PANEL_MIN_WIDTH,
      maxWidth,
    };
    const maximized = get(maximizedAtom);
    const surfaces = panel.state.surfaces;
    const launcher = model.launcher;
    const available =
      launcher === null ? [] : launcher.actions.filter((action) => action.available);
    const highlight = resolveLauncherHighlightIndex(get(launcherHighlightAtom), available.length);
    return {
      threadKey,
      open: panel.state.isOpen,
      animationDurationMs: get(context.clientSettingsAtom).panelAnimationDurationMs,
      maximized,
      maximize: buildRightPanelMaximizeModel(maximized),
      width: {
        width: clampResizableWidth(
          readStoredWidth(storage, panel.route) ?? defaultWidth,
          widthBounds,
        ),
        minWidth: PREVIEW_PANEL_MIN_WIDTH,
        maxWidth,
      },
      tabs: model.tabs.flatMap((tab) => {
        const surface = surfaces.find((entry) => entry.id === tab.id);
        if (surface === undefined) return [];
        return [
          {
            id: tab.id,
            kind: tab.kind,
            title: tab.title,
            closeLabel: tab.closeLabel,
            tooltip: tab.tooltip,
            active: tab.active,
            pending: tab.pending,
            icon: tab.icon,
            fileIcon: tab.icon.kind === "file" ? resolvePierreFileIcon(tab.icon.path) : null,
            select: { action: "rightPanelSelectTab", params: { surfaceId: tab.id } },
            close: closeAction(surface),
          },
        ];
      }),
      showAddSurfaceMenu: model.showAddSurfaceMenu,
      addSurfaceActions: withAction(model.addSurfaceActions),
      launcher:
        launcher === null
          ? null
          : {
              title: launcher.title,
              actions: withAction(launcher.actions),
              highlightedKey: highlight === -1 ? null : (available[highlight]?.key ?? null),
            },
      activeSurface:
        panel.activeSurface === null
          ? null
          : { id: panel.activeSurface.id, kind: panel.activeSurface.kind },
    };
  });

  const proactiveInputAtom = Atom.make((get) => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const { route, thread, serverConfig } = input;
    const shell = get(context.state.environmentThreadShells.threadShellAtom(route)) ?? thread;
    const capabilities = serverConfig?.environment.capabilities;
    const supportsPullRequests = capabilities?.pullRequests === true;
    const visiblePullRequests = visibleThreadPullRequests(shell.pullRequests ?? []);
    const pullRequestsSurfaceAvailable =
      capabilities?.threadPullRequests === true && visiblePullRequests.length > 0;
    const linkedThreadPullRequest = shell.linkedPullRequest ?? shell.branchPullRequest ?? null;
    const { activeLatestTurn, activeRunningTurnId } = resolveThreadTurnState(thread);
    const environmentShell = Option.getOrNull(
      AsyncResult.value(get(context.state.environmentShell.stateAtom(route.environmentId))),
    );
    return {
      route,
      projectAvailable: input.project !== undefined,
      bootstrapComplete: environmentShell !== null && Option.isSome(environmentShell.snapshot),
      step: !input.isServerThread
        ? null
        : {
            threadKey: scopedThreadKey(route),
            runningTurnId: activeRunningTurnId,
            linkedThreadPullRequest,
            clientSettingsHydrated: true,
            proactivePanelsEnabled: input.clientSettings.proactivePanelsEnabled,
            proactivePullRequestsKey: buildProactivePullRequestsKey({
              pullRequestsSurfaceAvailable,
              visiblePullRequests,
              linkedThreadPullRequest,
            }),
            pullRequestsCapabilityKnown: serverConfig !== null,
            pullRequestsSurfaceAvailable,
            visiblePullRequestCount: visiblePullRequests.length,
            hasLinkedPullRequestDetail: shell.linkedPullRequest != null,
            supportsPullRequests,
            threadDetailLoading:
              get(context.state.environmentThreadDetails.detailAtom(route)) === null,
            latestTurnSettled: isLatestTurnSettled(activeLatestTurn, thread.session ?? null),
            latestTurn: activeLatestTurn,
            checkpoints: thread.checkpoints,
            isGitRepo: get(context.gitStatusAtom)?.status?.isRepo,
          },
    };
  });

  let proactiveObservation: ProactivePanelObservation | null = null;
  let observedPullRequest: ObservedThreadPullRequest | null = null;
  registry.subscribe(
    proactiveInputAtom,
    (input) => {
      if (input === null) {
        proactiveObservation = null;
        observedPullRequest = null;
        return;
      }
      const { route } = input;
      const panels = useRightPanelStore.getState();
      if (input.bootstrapComplete) {
        panels.reconcileFileSurfaces(route, input.projectAvailable);
      }
      if (input.step === null) {
        proactiveObservation = null;
        observedPullRequest = null;
        return;
      }
      const step = resolveProactivePanelStep({
        ...input.step,
        observation: proactiveObservation,
        observedPullRequest,
        userActionRevision: panels.getUserActionRevision(route),
        openSurface: selectActiveRightPanelSurface(panels.byThreadKey, route),
      });
      proactiveObservation = step.observation;
      observedPullRequest = step.observedPullRequest;
      for (const open of step.opens) {
        if (open.kind === "pull-request") {
          panels.openProactive(route, pullRequestSurface(open.reference), step.userActionRevision);
        } else if (open.kind === "pull-requests") {
          panels.openProactive(
            route,
            { id: "pull-requests", kind: "pull-requests" },
            step.userActionRevision,
          );
        } else if (
          panels.openProactive(route, { id: "diff", kind: "diff" }, step.userActionRevision)
        ) {
          useDiffPanelStore.getState().selectGitScope(route, "unstaged");
        }
      }
    },
    { immediate: true },
  );

  const currentPanel = (): RouteRightPanelState => {
    const panel = registry.get(routePanelAtom);
    if (panel === null) throw new Error("The right panel needs an open thread.");
    return panel;
  };

  const notAvailable = (feature: string): never => {
    throw new Error(`${feature} is not available in the native app yet.`);
  };

  const closeSurfaces = async (
    route: ScopedThreadRef,
    surfaces: ReadonlyArray<RightPanelSurface>,
  ): Promise<void> => {
    for (const surface of surfaces) {
      if (surface.kind === "preview" && surface.resourceId) {
        await closeBrowserSession(context, browser, route, surface.resourceId);
      }
    }
    for (const surface of surfaces) {
      if (surface.kind === "terminal") {
        await closePanelTerminalSessions(context, route, surface.terminalIds);
      }
    }
    const store = useRightPanelStore.getState();
    for (const surface of surfaces) store.closeSurface(route, surface.id);
  };

  const openSurface = async (key: RightPanelSurfaceActionKey): Promise<null> => {
    const { route } = currentPanel();
    const availability = registry.get(availabilityAtom);
    if (availability === null) return null;
    registry.set(launcherHighlightAtom, -1);
    const store = useRightPanelStore.getState();
    switch (key) {
      case "browser": {
        const activeTabId = browser.read(route).activeTabId;
        if (activeTabId !== null) {
          store.openBrowser(route, activeTabId);
          return null;
        }
        const snapshot = await openBrowserSession(context, browser, { threadRef: route });
        if (snapshot !== null) useRightPanelStore.getState().openBrowser(route, snapshot.tabId);
        return null;
      }
      case "terminal":
        if (!availability.terminalAvailable) return null;
        await openPanelTerminal(context);
        return null;
      case "files":
        if (availability.filesAvailable) store.open(route, "files");
        return null;
      case "diff":
        if (!availability.diffAvailable) return null;
        useDiffPanelStore.getState().selectGitScope(route, "unstaged");
        store.open(route, "diff");
        return null;
      case "agents":
        store.open(route, "agents");
        return null;
      case "pullRequest": {
        const input = registry.get(context.threadInputAtom);
        if (input === null || !availability.pullRequestAvailable) return null;
        const shell =
          registry.get(context.state.environmentThreadShells.threadShellAtom(input.route)) ??
          input.thread;
        const linked = shell.linkedPullRequest ?? shell.branchPullRequest ?? null;
        if (linked !== null) store.openPullRequest(route, linked);
        return null;
      }
      case "pullRequests":
        if (availability.pullRequestsAvailable) store.open(route, "pull-requests");
        return null;
      case "device":
        if (availability.deviceAvailable) addDeviceSurface(context, route);
        return null;
    }
  };

  const runTabIntent = async (route: ScopedThreadRef, intent: RightPanelTabIntent) => {
    const surfaces =
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(route)]?.surfaces ?? [];
    switch (intent.kind) {
      case "none":
        return;
      case "activate":
        useRightPanelStore.getState().activateSurface(route, intent.surface.id);
        if (intent.surface.kind === "preview" && intent.surface.resourceId) {
          browser.setActiveTab(route, intent.surface.resourceId);
        }
        return;
      case "rename":
        return notAvailable("Renaming a device tab");
      case "copy-path":
        try {
          await clipboardService(context).writeText(intent.relativePath);
          context.addToast({
            layout: "plain",
            type: "success",
            title: "Path copied",
            description: intent.relativePath,
          });
        } catch (error) {
          context.addToast({
            layout: "stacked",
            type: "error",
            title: "Failed to copy path",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      case "set-audio-muted": {
        if (parseRuntimeTabId(intent.runtimeTabId) === null) return;
        browser.setTabOptions(intent.runtimeTabId, (current) => ({
          ...current,
          audioMuted: intent.muted,
        }));
        return;
      }
      case "close":
        if (intent.surface.kind === "terminal") {
          await closePanelTerminalSurface(context, intent.surface.id);
          return;
        }
        await closeSurfaces(route, [intent.surface]);
        return;
      case "close-others":
        await closeSurfaces(
          route,
          surfaces.filter((entry) => entry.id !== intent.surface.id),
        );
        return;
      case "close-to-right": {
        const index = surfaces.findIndex((entry) => entry.id === intent.surface.id);
        if (index < 0) return;
        await closeSurfaces(route, surfaces.slice(index + 1));
        return;
      }
      case "close-all":
        await closeSurfaces(route, surfaces);
        return;
    }
  };

  const findSurface = (panel: RouteRightPanelState, surfaceId: string) => {
    const surface = panel.state.surfaces.find((entry) => entry.id === surfaceId);
    if (surface === undefined) throw new Error(`Unknown right panel surface: ${surfaceId}`);
    return surface;
  };

  return {
    views: { rightPanel: viewAtom },
    actions: {
      rightPanelToggle: async () => {
        const route = registry.get(context.routeAtom);
        const intent = resolveRightPanelToggleIntent({
          hasThread: route !== null,
          rightPanelOpen: registry.get(routePanelAtom)?.state.isOpen ?? false,
        });
        if (route === null || intent.kind === "none") return null;
        if (intent.kind === "close") {
          const float = resolveRightPanelCloseFloat(
            selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, route),
          );
          if (float?.kind === "browser") {
            usePreviewMiniPlayerStore
              .getState()
              .open(route, browserMiniPlayerSource(float.resourceId));
          } else if (float?.kind === "device") {
            usePreviewMiniPlayerStore.getState().open(route, { kind: "device", ...float.target });
          }
          registry.set(maximizedThreadKeyAtom, null);
          useRightPanelStore.getState().close(route);
          return null;
        }
        useRightPanelStore.getState().toggleVisibility(route);
        return null;
      },
      rightPanelToggleMaximized: async () => {
        const panel = currentPanel();
        const canMaximize = resolveCanMaximizeRightPanel({
          rightPanelOpen: panel.state.isOpen,
          usesRightPanelSheet: false,
        });
        if (!canMaximize) return null;
        registry.set(
          maximizedThreadKeyAtom,
          toggleMaximizedRightPanelThreadKey(
            registry.get(maximizedThreadKeyAtom),
            scopedThreadKey(panel.route),
          ),
        );
        return null;
      },
      rightPanelSelectTab: async (params) => {
        const panel = currentPanel();
        const surface = findSurface(panel, SurfaceIdParams(params).surfaceId);
        await runTabIntent(panel.route, { kind: "activate", surface });
        return null;
      },
      rightPanelCloseTab: async (params) => {
        const panel = currentPanel();
        const surface = findSurface(panel, SurfaceIdParams(params).surfaceId);
        await runTabIntent(panel.route, { kind: "close", surface });
        return null;
      },
      rightPanelTabContextMenu: async (params) => {
        const { surfaceId, x, y } = TabContextMenuParams(params);
        const panel = currentPanel();
        const surface = findSurface(panel, surfaceId);
        const input = tabMenuInput(
          surface,
          panel.state.surfaces,
          previewInputFor(null, panel.route),
        );
        const items = buildTabContextMenuItems(input);
        if (items === null) return null;
        const action = await contextMenuService(context).show(items, { x, y });
        await runTabIntent(panel.route, resolveTabContextMenuAction(action, input));
        return null;
      },
      rightPanelOpenSurface: async (params) => openSurface(OpenSurfaceParams(params).key),
      rightPanelLauncherKey: async (params) => {
        const { key } = LauncherKeyParams(params);
        const launcher = registry.get(tabsModelAtom)?.launcher ?? null;
        if (launcher === null) return null;
        const available = launcher.actions.filter((action) => action.available);
        const shortcut = surfaceShortcutActionForKey(available, {
          key,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          defaultPrevented: false,
          isComposing: false,
        });
        if (shortcut !== null) return openSurface(shortcut.key);
        const intent = resolveSurfaceLauncherKey({
          key,
          defaultPrevented: false,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          highlightIndex: resolveLauncherHighlightIndex(
            registry.get(launcherHighlightAtom),
            available.length,
          ),
          availableCount: available.length,
          targetIsLauncher: true,
        });
        if (intent.kind === "highlight") {
          registry.set(launcherHighlightAtom, intent.index);
          return null;
        }
        if (intent.kind === "activate") {
          const action = available[intent.index];
          if (action !== undefined) return openSurface(action.key);
        }
        return null;
      },
      rightPanelLauncherHighlight: async (params) => {
        const { index } = LauncherHighlightParams(params);
        registry.set(launcherHighlightAtom, index);
        return null;
      },
      rightPanelSetWidth: async (params) => {
        const panel = currentPanel();
        const { width } = SetWidthParams(params);
        const bounds = registry.get(layoutBoundsAtom);
        const next = clampResizableWidth(width, {
          defaultWidth: PREVIEW_PANEL_DEFAULT_WIDTH,
          minWidth: PREVIEW_PANEL_MIN_WIDTH,
          maxWidth: panelMaxWidth(bounds),
        });
        storage.setItem(widthStorageKey(panel.route), encodeWidth(next));
        registry.set(widthRevisionAtom, registry.get(widthRevisionAtom) + 1);
        return null;
      },
      rightPanelSetLayoutBounds: async (params) => {
        const next = LayoutBoundsParams(params);
        const current = registry.get(layoutBoundsAtom);
        if (
          current !== null &&
          current.viewportWidth === next.viewportWidth &&
          current.containerWidth === next.containerWidth
        ) {
          return null;
        }
        registry.set(layoutBoundsAtom, next);
        return null;
      },
    },
  };
}
