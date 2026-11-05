import { buildPullRequestChecksPopoverModel } from "@t3tools/web/src/components/pullRequest/PullRequestChecksPopover.logic.ts";
import { buildPullRequestActivityUnavailableModel } from "@t3tools/web/src/components/pullRequest/PullRequestDetailPanel.logic.ts";
import { splitForMiddleTruncate } from "@t3tools/web/src/components/ui/middleTruncate.logic.ts";
import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  PullRequestMergeMethod,
  PullRequestUpdateMethod,
  resolveEnvironmentMachineKind,
  ThreadId,
  type PullRequestAction,
  type PullRequestActivity,
  type PullRequestDetail,
  type PullRequestDetailView,
  type PullRequestListEntry,
  type PullRequestRef,
  type PullRequestSummary,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  changeRequestRepositoryUrl,
  gitHubPullRequestBrowserUrl,
  parseChangeRequestUrl,
} from "@t3tools/shared/changeRequestUrl";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  normalizeThreadPullRequestKey,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import {
  buildAddSelectionToAgentHandoff,
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
  buildFixFindingHandoff,
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  allowsSinglePullRequestMerge,
  handoffPrompt,
  handoffReviewComments,
  isStackedPullRequestBase,
  loadingPullRequestCheckoutCommand,
  pullRequestCheckoutCommand,
  pullRequestFindingKey,
  pullRequestPanelContext,
  readPullRequestDetailSnapshot,
  resolveDisplayedPullRequestDetail,
  resolvePullRequestReferenceHost,
  shouldRefreshPullRequestActivity,
  stripPullRequestHandoffReferences,
  writePullRequestDetailSnapshot,
  type PullRequestFinding,
} from "@t3tools/web/src/components/pullRequest/pullRequestDetail.logic.ts";
import {
  applyPullRequestActivity,
  buildPullRequestDetailModel,
  matchPullRequestListEntry,
  mergePullRequestDetailSummary,
  PULL_REQUEST_CHECKOUT_COMMAND_COPY_FAILURE_TITLE,
  PULL_REQUEST_CHECKOUT_TOASTS,
  PULL_REQUEST_COMMENT_POST_FAILURE_TITLE,
  PULL_REQUEST_THREAD_OPEN_FAILURE_TOAST,
  pullRequestAskedToast,
  pullRequestCheckoutFailureToast,
  pullRequestCheckoutResultToast,
  pullRequestCheckoutUnpointedToast,
  pullRequestDetailKey,
  pullRequestTitleSaveFailureToast,
  resolvePullRequestActionOutcome,
  resolvePullRequestAskRoute,
  resolvePullRequestConfirmedAction,
  resolvePullRequestDetailTabChange,
  resolvePullRequestDetailTabFallback,
  resolvePullRequestHandoffRoute,
  resolvePullRequestTitleSave,
  type PullRequestConfirmableAction,
  type PullRequestDetailModel,
  type PullRequestDetailTab,
  type PullRequestToastModel,
} from "@t3tools/web/src/components/pullRequest/PullRequestDetailPanel.logic.ts";
import { buildPullRequestDetailGhostModel } from "@t3tools/web/src/components/pullRequest/PullRequestGhosts.logic.ts";
import { resolvePickableEnvironments } from "@t3tools/web/src/components/pullRequest/pullRequestProjectAssignment.logic.ts";
import {
  openOnHostLabel,
  pullRequestChecksState,
} from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import {
  buildPullRequestStackMenuModel,
  pullRequestStackActionToast,
  resolvePullRequestStackAction,
  type PullRequestStackConfirmation,
} from "@t3tools/web/src/components/pullRequest/PullRequestStackMenu.logic.ts";
import {
  buildPullRequestThreadLinksModel,
  buildPullRequestThreadPickerModel,
  pullRequestThreadLinkFailureToast,
  resolvePullRequestThreadLinkMenuAction,
} from "@t3tools/web/src/components/pullRequest/PullRequestThreadLinks.logic.ts";
import { useComposerDraftStore, type DraftId } from "@t3tools/web/src/composerDraftStore.ts";
import { createPullRequestLinkingRules } from "@t3tools/web/src/hooks/pullRequestLinking.logic.ts";
import { resolveShortcutCommand, shortcutLabelForCommand } from "@t3tools/web/src/keybindings.ts";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "@t3tools/web/src/logicalProject.ts";
import type { ReviewCommentContext } from "@t3tools/web/src/reviewCommentContext.ts";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type PullRequestSurface,
} from "@t3tools/web/src/rightPanelStore.ts";
import { buildPhysicalToLogicalProjectKeyMap } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import {
  newestPullRequestObservation,
  newestPullRequestSummary,
  observedPullRequestSummaryAtom,
  observePullRequestSummary,
  pullRequestListEntryToSummary,
  pullRequestSummaryKey,
} from "@t3tools/web/src/state/pullRequestSummaries.ts";
import {
  resolveSourceControlActionScope,
  SOURCE_CONTROL_ACTION_LABEL,
  SOURCE_CONTROL_ACTION_OPERATION,
} from "@t3tools/web/src/state/sourceControlActions.logic.ts";
import { setPullRequestMergeMethod } from "@t3tools/web/src/uiState.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import {
  createEffectRunner,
  createLiveRefresh,
  panelRouteAtom,
  pullRequestListEntryId,
  pullRequestPageBridge,
  readQuery,
  type QueryRead,
  type QueryView,
} from "../pullRequestShared.ts";
import { rightPanelStoreAtom } from "../rightPanelState.ts";
import type {
  PullRequestDetailShellView,
  PullRequestStackLayerView,
} from "../views/pullRequests.ts";
import { commandPaletteService } from "./commandPalette.ts";
import {
  pullRequestPopoverService,
  pullRequestStackLayerViews,
  type PullRequestStackQuery,
} from "./pullRequestPopover.ts";

const TabParams = Schema.decodeUnknownSync(Schema.Struct({ tab: Schema.String }));
const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const PositionParams = Schema.decodeUnknownSync(
  Schema.Struct({ x: Schema.Number, y: Schema.Number }),
);
const CopyParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.Literals(["link", "number", "checkout", "branch"]) }),
);
const PerformParams = Schema.decodeUnknownSync(
  Schema.Struct({
    action: Schema.Literals(["ready", "draft", "reopen", "disable-auto-merge"]),
  }),
);
const UpdateBranchParams = Schema.decodeUnknownSync(
  Schema.Struct({ method: PullRequestUpdateMethod }),
);
const ConfirmParams = Schema.decodeUnknownSync(
  Schema.Struct({
    action: Schema.Literals(["merge", "close", "enable-auto-merge", "revert", "approve-workflows"]),
  }),
);
const MergeMethodParams = Schema.decodeUnknownSync(
  Schema.Struct({ method: PullRequestMergeMethod }),
);
const CheckoutParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["worktree", "local"]) }),
);
const EnvironmentParams = Schema.decodeUnknownSync(Schema.Struct({ environmentId: Schema.String }));
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const ThreadParams = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.String }));
const NumberParams = Schema.decodeUnknownSync(Schema.Struct({ number: Schema.Number }));
const StackConfirmParams = Schema.decodeUnknownSync(
  Schema.Struct({ action: Schema.Literals(["merge", "update-branch"]) }),
);
const KeyDownParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    shiftKey: Schema.Boolean,
    altKey: Schema.Boolean,
    repeat: Schema.Boolean,
  }),
);

export type PullRequestDetailContext = "page" | "thread";

export type PullRequestDetailTarget = {
  readonly surfaceId: string;
  readonly mountKey: string;
  readonly context: PullRequestDetailContext;
  readonly environmentId: EnvironmentId;
  readonly requested: PullRequestRef;
  readonly panelRef: ScopedThreadRef;
  readonly threadRef: ScopedThreadRef | null;
  readonly composerDraftTarget: ScopedThreadRef | DraftId | null;
  readonly hasBack: boolean;
  readonly shortcutsEnabled: boolean;
  readonly listEntry: PullRequestListEntry | null;
  readonly gate: "ghost" | "unavailable" | null;
};

export type PullRequestThreadTask = {
  readonly prompt: string;
  readonly reviewComments?: ReadonlyArray<ReviewCommentContext>;
};

type CodeCommitScope = { readonly pullRequestKey: string; readonly oid: string | null };

type DetailUi = {
  readonly mountKey: string;
  readonly tab: PullRequestDetailTab;
  readonly visited: ReadonlyArray<PullRequestDetailTab>;
  readonly visitedKey: string;
  readonly timelineOrder: "newest" | "oldest";
  readonly codeCommit: CodeCommitScope | null;
  readonly mergeMethodSelection: {
    readonly pullRequestKey: string;
    readonly method: PullRequestMergeMethod;
  } | null;
  readonly confirmation: { readonly open: boolean; readonly action: PullRequestConfirmableAction };
  readonly handoff: string | null;
  readonly cached: { readonly key: string; readonly detail: PullRequestDetail | null } | null;
  readonly refreshToken: number;
  readonly invalidating: boolean;
  readonly pendingAction: PullRequestAction | null;
  readonly titleScope: { readonly pullRequestKey: string; readonly text: string } | null;
  readonly titleSaving: boolean;
  readonly titleRevision: number;
  readonly actingScope: {
    readonly pullRequestKey: string;
    readonly environmentId: EnvironmentId;
  } | null;
  readonly threadPickerOpen: boolean;
  readonly threadPickerQuery: string;
  readonly threadLinkPending: boolean;
  readonly stackConfirmation: PullRequestStackConfirmation | null;
  readonly stackPending: boolean;
};

function initialUi(mountKey: string, pullRequestKey: string, tabScopeKey: string): DetailUi {
  return {
    mountKey,
    tab: "summary",
    visited: ["summary"],
    visitedKey: tabScopeKey,
    timelineOrder: "newest",
    codeCommit: { pullRequestKey, oid: null },
    mergeMethodSelection: null,
    confirmation: { open: false, action: "merge" },
    handoff: null,
    cached: null,
    refreshToken: 0,
    invalidating: false,
    pendingAction: null,
    titleScope: null,
    titleSaving: false,
    titleRevision: 0,
    actingScope: null,
    threadPickerOpen: false,
    threadPickerQuery: "",
    threadLinkPending: false,
    stackConfirmation: null,
    stackPending: false,
  };
}

export type PullRequestDetailFrame = {
  readonly target: PullRequestDetailTarget;
  readonly ui: DetailUi;
  readonly reference: PullRequestRef;
  readonly pullRequestKey: string;
  readonly tabScopeKey: string;
  readonly supportsThreadPullRequests: boolean;
  readonly detailQuery: QueryView<PullRequestDetail>;
  readonly activityQuery: QueryView<PullRequestActivity>;
  readonly coreDetail: PullRequestDetail | null;
  readonly detail: PullRequestDetailView | null;
  readonly detailSummary: PullRequestSummary | null;
  readonly sharedSummary: PullRequestSummary | null;
  readonly handoffSummary: PullRequestSummary | PullRequestDetailView | null;
  readonly matchingListEntry: PullRequestListEntry | null;
  readonly activityPending: boolean;
  readonly activityError: string | null;
  readonly turnRefresh: number | null;
  readonly codeRefreshToken: number;
  readonly stackReference: PullRequestRef | null;
  readonly nativeStack: PullRequestStackQuery;
  readonly checkoutCommand: string | null;
  readonly checkoutRoot: string | null;
  readonly actingEnvironmentId: EnvironmentId;
  readonly actingProjectId: PullRequestRef["projectId"] | null;
  readonly markdownRepositoryUrl: string | null;
  readonly model: PullRequestDetailModel | null;
  readonly view: PullRequestDetailShellView;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly linkedThreadsUrl: string | null;
};

export interface PullRequestDetailSession {
  readonly frameAtom: Atom.Atom<PullRequestDetailFrame | null>;
  readonly current: () => PullRequestDetailFrame | null;
  readonly refreshDetail: () => void;
  readonly refreshFromHost: () => Promise<void>;
  readonly performCommentAction: (
    body: string,
    action: "close" | "reopen",
  ) => Promise<{ readonly commentPosted: boolean }>;
  readonly startFixFinding: (finding: PullRequestFinding) => void;
  readonly addSelectionToAgent: (selection: {
    readonly comment: ReviewCommentContext;
    readonly request: string;
  }) => void;
  readonly openCommit: (oid: string) => void;
  readonly selectCodeCommit: (oid: string | null) => void;
  readonly selectPullRequest: (reference: PullRequestRef) => void;
  readonly feature: CoreFeature;
}

function toastFor(model: PullRequestToastModel): {
  readonly layout: "plain";
  readonly type: PullRequestToastModel["type"];
  readonly title: string;
  readonly description?: string;
} {
  return {
    layout: "plain",
    type: model.type,
    title: model.title,
    ...(model.description === undefined ? {} : { description: model.description }),
  };
}

const sessions = new WeakMap<FeatureContext, PullRequestDetailSession>();

export function pullRequestDetailSession(context: FeatureContext): PullRequestDetailSession {
  const existing = sessions.get(context);
  if (existing !== undefined) return existing;
  const session = createSession(context);
  sessions.set(context, session);
  return session;
}

export function createPullRequestDetailFeature(context: FeatureContext): CoreFeature {
  return pullRequestDetailSession(context).feature;
}

function createSession(context: FeatureContext): PullRequestDetailSession {
  const { registry, state, storage } = context;
  const bridge = pullRequestPageBridge(context);
  const popovers = pullRequestPopoverService(context);
  const routeAtom = panelRouteAtom(context);
  const lingerAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const uiAtom = Atom.make<DetailUi | null>(null).pipe(Atom.keepAlive);
  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(state.primaryServerConfigAtom)?.keybindings ?? []),
  );

  const targetAtom = Atom.make((get): PullRequestDetailTarget | null => {
    const route = get(routeAtom);
    if (route === null) return null;
    const { byThreadKey } = get(rightPanelStoreAtom);
    const panel = selectThreadRightPanelState(byThreadKey, route);
    const surface = selectSelectedRightPanelSurface(byThreadKey, route);
    if (surface?.kind !== "pull-request") return null;
    if (!panel.isOpen && get(lingerAtom) !== surface.id) return null;
    const requested: PullRequestRef = {
      projectId: ProjectId.make(surface.projectId),
      ...(surface.host ? { host: surface.host } : {}),
      repository: surface.repository,
      number: surface.number,
    };
    const active = selectActiveRightPanelSurface(byThreadKey, route);
    const onPage = scopedThreadKey(route) === scopedThreadKey(PULL_REQUESTS_PANEL_REF);
    if (onPage) {
      if (surface.environmentId === undefined) return null;
      return {
        surfaceId: surface.id,
        mountKey: `page:${surface.id}`,
        context: "page",
        environmentId: EnvironmentId.make(surface.environmentId),
        requested,
        panelRef: route,
        threadRef: null,
        composerDraftTarget: null,
        hasBack: false,
        shortcutsEnabled: panel.isOpen && active?.id === surface.id,
        listEntry: get(bridge.listedEntriesAtom).get(pullRequestListEntryId(surface)) ?? null,
        gate: null,
      };
    }
    const input = get(context.threadInputAtom);
    if (input === null || scopedThreadKey(input.route) !== scopedThreadKey(route)) return null;
    const shell = get(state.environmentThreadShells.threadShellAtom(route)) ?? input.thread;
    const capabilities = input.serverConfig?.environment.capabilities;
    const visibleCount = visibleThreadPullRequests(shell.pullRequests ?? []).length;
    return {
      surfaceId: surface.id,
      mountKey: `thread:${scopedThreadKey(route)}:${surface.host ?? ""}:${surface.repository}#${surface.number}`,
      context: pullRequestPanelContext(
        {
          projectId: shell.projectId ?? null,
          pullRequests: shell.pullRequests,
          linkedPullRequest: shell.linkedPullRequest,
          branchPullRequest: shell.branchPullRequest,
        },
        surface,
      ),
      environmentId: route.environmentId,
      requested,
      panelRef: route,
      threadRef: route,
      composerDraftTarget: input.isServerThread ? route : (input.draftId ?? route),
      hasBack:
        input.isServerThread && capabilities?.threadPullRequests === true && visibleCount > 1,
      shortcutsEnabled: panel.isOpen && active?.id === surface.id,
      listEntry: null,
      gate:
        input.serverConfig === null
          ? "ghost"
          : capabilities?.pullRequests !== true
            ? "unavailable"
            : null,
    };
  });

  const linkedThreadsAtomFor = (frame: {
    readonly environmentId: EnvironmentId;
    readonly reference: PullRequestRef;
    readonly url: string;
  }) => {
    const parsed = parseChangeRequestUrl(frame.url);
    return state.pullRequestEnvironment.linkedThreads({
      environmentId: frame.environmentId,
      input:
        parsed === null
          ? frame.reference
          : { ...frame.reference, ...normalizeThreadPullRequestKey(parsed) },
    });
  };
  let lastRelations: { readonly key: string; readonly threads: ReadonlyArray<unknown> } | null =
    null;

  const frameAtom = Atom.make((get): PullRequestDetailFrame | null => {
    const target = get(targetAtom);
    if (target === null) return null;
    const { environmentId } = target;
    const serverConfig = get(state.serverEnvironment.configValueAtom(environmentId));
    const projects = get(state.environmentProjects.projectsAtom);
    const project = projects.find(
      (candidate) =>
        candidate.id === target.requested.projectId && candidate.environmentId === environmentId,
    );
    const repositoryIdentity = project?.repositoryIdentity;
    const supportsThreadPullRequests =
      serverConfig?.environment.capabilities.threadPullRequests === true;
    const reference: PullRequestRef = supportsThreadPullRequests
      ? resolvePullRequestReferenceHost(target.requested, repositoryIdentity)
      : {
          projectId: target.requested.projectId,
          repository: target.requested.repository,
          number: target.requested.number,
        };
    const pullRequestKey = pullRequestDetailKey(reference);
    const tabScopeKey = `${environmentId}:${pullRequestKey}`;
    const stored = get(uiAtom);
    const ui =
      stored !== null && stored.mountKey === target.mountKey
        ? stored
        : initialUi(target.mountKey, pullRequestKey, tabScopeKey);
    const matchingListEntry = matchPullRequestListEntry(target.listEntry, reference);
    const keybindings = get(keybindingsAtom);
    const gateGhost = buildPullRequestDetailGhostModel({
      seed: null,
      summary: null,
      checkoutCommand: null,
      tabs: [
        { value: "summary", label: "Summary" },
        { value: "timeline", label: "Timeline" },
        { value: "code", label: "Code" },
      ],
      activeTab: undefined,
      number: undefined,
      nowMs: Date.now(),
    });
    const detailQuery = readQuery(
      get,
      target.gate === null
        ? state.pullRequestEnvironment.detail({ environmentId, input: reference })
        : null,
    );
    const activityQuery = readQuery(
      get,
      target.gate === null
        ? state.pullRequestEnvironment.activity({ environmentId, input: reference })
        : null,
    );
    const turnRefresh =
      target.gate === null
        ? readQuery(get, state.pullRequestEnvironment.refreshes({ environmentId, input: {} })).data
        : null;
    const snapshotKey = `${environmentId}:${pullRequestKey}`;
    const cachedDetail =
      ui.cached !== null && ui.cached.key === snapshotKey
        ? ui.cached.detail
        : readPullRequestDetailSnapshot(storage, environmentId, reference);
    const resolvedCoreDetail = resolveDisplayedPullRequestDetail({
      live: detailQuery.data,
      cached: cachedDetail,
      reference,
    });
    const listSummary =
      matchingListEntry === null ? null : pullRequestListEntryToSummary(matchingListEntry);
    const detailSummary: PullRequestSummary | null =
      detailQuery.data === null
        ? null
        : { ...detailQuery.data, checksState: pullRequestChecksState(detailQuery.data.checks) };
    const observed = get(
      observedPullRequestSummaryAtom(pullRequestSummaryKey(environmentId, reference)),
    );
    const observedSummary =
      newestPullRequestObservation(
        observed,
        detailSummary === null || detailQuery.dataUpdatedAt === null
          ? null
          : { summary: detailSummary, observedAt: detailQuery.dataUpdatedAt },
      )?.summary ?? detailSummary;
    const sharedSummary = newestPullRequestSummary(
      resolvedCoreDetail,
      newestPullRequestSummary(observedSummary, listSummary),
    );
    const coreDetail = mergePullRequestDetailSummary(resolvedCoreDetail, sharedSummary);
    const activity = activityQuery.data;
    const detail = applyPullRequestActivity(coreDetail, activity);
    const handoffSummary = detail ?? sharedSummary;
    const repositoryUrl = detail === null ? null : changeRequestRepositoryUrl(detail.url);
    const checkoutCommand = handoffSummary
      ? pullRequestCheckoutCommand(
          handoffSummary.provider,
          handoffSummary.number,
          handoffSummary.headBranch,
          detail?.headRepositoryNameWithOwner,
          changeRequestRepositoryUrl(handoffSummary.url),
        )
      : loadingPullRequestCheckoutCommand(reference, repositoryIdentity);
    const branchRefs = readQuery(
      get,
      detail === null
        ? null
        : state.vcsEnvironment.listRefs({
            environmentId,
            input: { cwd: detail.workspaceRoot, includeMatchingRemoteRefs: true, limit: 2 },
          }),
    );
    const isStackedPullRequest =
      detail !== null && isStackedPullRequestBase(detail.baseBranch, branchRefs.data?.refs ?? []);
    const stackReference =
      detail === null || detail.capabilities.stacks !== true || !supportsThreadPullRequests
        ? null
        : { ...reference, host: reference.host ?? parseChangeRequestUrl(detail.url)?.host };
    const nativeStack = popovers.readStack(get, environmentId, stackReference);
    const supportsStackActions =
      supportsThreadPullRequests &&
      detail?.capabilities.stacks === true &&
      detail.capabilities.stackActions === true &&
      serverConfig?.environment.capabilities.pullRequestStackActions === true;
    const canMergeSinglePullRequest = allowsSinglePullRequestMerge({
      supportsStackActions,
      hasStack: nativeStack.data !== null,
      stackPending: !nativeStack.isSuccess || nativeStack.isPending,
      stackError: nativeStack.error,
    });
    const activityPending = activityQuery.isPending && activity === null;
    const activityError = activity === null ? activityQuery.error : null;
    const codeRefreshToken = ui.refreshToken + (turnRefresh ?? 0);
    const refreshing = ui.invalidating || detailQuery.isPending;
    const projectDefaultMergeMethod =
      resolveProjectSettings(serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS, reference.projectId)
        .settings.pullRequestMergeMethod ?? undefined;
    const clientSettings = get(context.clientSettingsAtom);
    const legacyProjectDefaultMergeMethod = (() => {
      if (projectDefaultMergeMethod !== undefined || project === undefined) return undefined;
      const groupingSettings = selectProjectGroupingSettings(clientSettings);
      const projectKey =
        buildPhysicalToLogicalProjectKeyMap({
          projects,
          settings: groupingSettings,
          primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
        }).get(derivePhysicalProjectKey(project)) ??
        deriveLogicalProjectKeyFromSettings(project, groupingSettings);
      return clientSettings.pullRequestMergeMethodOverrides[projectKey];
    })();
    const environments = [...get(state.environmentPresentations.presentationsAtom).entries()].map(
      ([id, presentation]) => projectEnvironmentPresentation(id, presentation),
    );
    const pickableEnvironments =
      target.context === "page"
        ? resolvePickableEnvironments(
            { environmentId, projectId: reference.projectId },
            projects,
            environments.map((environment) => ({
              environmentId: environment.environmentId,
              label: environment.label,
              machine: resolveEnvironmentMachineKind(environment.serverConfig),
            })),
          )
        : [];
    const chosenEnvironmentId =
      ui.actingScope?.pullRequestKey === pullRequestKey
        ? ui.actingScope.environmentId
        : environmentId;
    const acting =
      pickableEnvironments.find((entry) => entry.environmentId === chosenEnvironmentId) ?? null;
    const actingEnvironmentId = acting?.environmentId ?? environmentId;
    const checkoutRoot =
      acting?.workspaceRoot ?? detail?.workspaceRoot ?? project?.workspaceRoot ?? null;
    const titleDraft = ui.titleScope?.pullRequestKey === pullRequestKey ? ui.titleScope.text : null;
    const model =
      target.gate === null
        ? buildPullRequestDetailModel({
            referenceNumber: reference.number,
            detail,
            detailPending: detailQuery.isPending,
            detailError: detailQuery.error,
            handoffSummary,
            context: target.context,
            hasBack: target.hasBack,
            hasClose: false,
            hasComposer: target.composerDraftTarget !== null,
            handoff: ui.handoff,
            checkoutRootAvailable: checkoutRoot !== null,
            pendingAction: ui.pendingAction,
            refreshing,
            canMergeSinglePullRequest,
            mergeMethod: {
              current:
                ui.mergeMethodSelection?.pullRequestKey === pullRequestKey
                  ? ui.mergeMethodSelection.method
                  : null,
              projectDefault: projectDefaultMergeMethod ?? legacyProjectDefaultMergeMethod,
              lastSelected: get(context.uiStateAtom).pullRequestMergeMethod,
            },
            sharedChecksState: sharedSummary?.checksState,
            isStackedPullRequest,
            stack: {
              hasStack: nativeStack.data !== null,
              supportsActions: supportsStackActions,
              failed: nativeStack.error !== null,
              fresh: nativeStack.isSuccess && !nativeStack.isPending,
            },
            tab: ui.tab,
            timelineOrder: ui.timelineOrder,
            activityPending,
            activityError,
            titleDraft,
            titleSaving: ui.titleSaving,
            checkoutCommand,
            shortcuts: {
              copyLink: shortcutLabelForCommand(
                keybindings,
                "thread.copyReference",
                context.platform,
              ),
              copyNumber: shortcutLabelForCommand(
                keybindings,
                "pullRequest.copyNumber",
                context.platform,
              ),
            },
            confirmation: ui.confirmation.action,
            pickableEnvironments,
            actingEnvironmentId,
            nowMs: Date.now(),
          })
        : null;

    const stack = nativeStack.data;
    const stackMenu =
      model !== null && stack !== null && model.actions.stackMenu.visible && detail !== null
        ? (() => {
            const menuModel = buildPullRequestStackMenuModel({
              stack,
              referenceNumber: reference.number,
              canMerge: model.actions.stackMenu.canMerge,
              canRebase: model.actions.stackMenu.canRebase,
              mergeMethod: model.actions.stackMenu.mergeMethod,
              pending: ui.stackPending,
              notice: nativeStack.notice,
              stale: nativeStack.error !== null,
              confirmation: ui.stackConfirmation,
            });
            return {
              model: menuModel,
              notice: nativeStack.notice,
              stale: nativeStack.error !== null,
              layers: pullRequestStackLayerViews(stack.layers.toReversed(), reference, {
                selectable: !ui.stackPending,
                compact: false,
              }),
              dialogLayers: pullRequestStackLayerViews(
                menuModel.dialog.layerNumbers.flatMap(
                  (number) => stack.layers.find((entry) => entry.number === number) ?? [],
                ),
                reference,
                { selectable: false, compact: true },
              ),
              base: stack.base,
            };
          })()
        : null;

    const linkMode = threadPullRequestLinkMode(serverConfig?.environment.capabilities);
    const threadLinks = (() => {
      if (detail === null || linkMode === "unsupported") return null;
      const parsed = parseChangeRequestUrl(detail.url);
      if (parsed === null) return null;
      const rules = createPullRequestLinkingRules({
        environmentId,
        capabilities: serverConfig?.environment.capabilities,
        projects,
      });
      const linkThreadRef =
        target.threadRef ??
        (typeof target.composerDraftTarget === "object" ? target.composerDraftTarget : null);
      const currentThreadRef =
        linkThreadRef?.environmentId === environmentId ? linkThreadRef : null;
      const currentThread =
        currentThreadRef === null
          ? null
          : get(state.environmentThreadShells.threadShellAtom(currentThreadRef));
      const linkedHere = rules.isLinked(currentThread, detail.url);
      if (!linkedHere && !rules.canLink(detail.url)) return null;
      const relations =
        rules.mode === "multiple"
          ? readQuery(get, linkedThreadsAtomFor({ environmentId, reference, url: detail.url }))
          : null;
      const relationKey = `${environmentId}:${detail.url}`;
      if (relations?.data != null)
        lastRelations = { key: relationKey, threads: relations.data.threads };
      const linkedThreads =
        rules.mode === "multiple"
          ? (relations?.data?.threads ??
            (lastRelations?.key === relationKey ? lastRelations.threads : []))
          : [];
      const linksModel = buildPullRequestThreadLinksModel({
        linkedHere,
        hasCurrentThread: currentThreadRef !== null,
        linkedThreadCount: linkedThreads.length,
        relationsError: relations?.error != null,
        pending: ui.threadLinkPending,
      });
      const picker = ui.threadPickerOpen
        ? buildPullRequestThreadPickerModel({
            environmentId,
            threads: get(state.environmentThreadShells.threadShellsAtom),
            projects,
            query: ui.threadPickerQuery,
            pending: ui.threadLinkPending,
            isLinked: (thread) => rules.isLinked(thread, detail.url),
          })
        : null;
      return {
        model: linksModel,
        countVisible: model?.actions.threadLinksCountVisible === true && linksModel.count.visible,
        picker,
        pickerQuery: ui.threadPickerQuery,
      };
    })();

    const view: PullRequestDetailShellView = {
      surfaceId: target.surfaceId,
      context: target.context,
      gate:
        target.gate === "ghost"
          ? { kind: "ghost", ghost: gateGhost }
          : target.gate === "unavailable"
            ? {
                kind: "unavailable",
                title: "Pull requests unavailable",
                description: "Update this environment's T3 Code server to browse pull requests.",
              }
            : null,
      ghost:
        model !== null && model.loading
          ? buildPullRequestDetailGhostModel({
              seed: matchingListEntry,
              summary: sharedSummary,
              checkoutCommand,
              tabs: model.tabs.items,
              activeTab: ui.tab,
              number: reference.number,
              nowMs: Date.now(),
            })
          : null,
      model,
      confirmationOpen: ui.confirmation.open,
      mountedTabs: ui.visitedKey === tabScopeKey ? ui.visited : [ui.tab],
      unavailable: {
        refreshing: detailQuery.isPending,
        gitHubUrl:
          gitHubPullRequestBrowserUrl(repositoryIdentity, reference.repository, reference.number) ??
          null,
      },
      stackMenu,
      threadLinks,
      titleRevision: ui.titleRevision,
      checksTrigger:
        model === null || model.checks.state === null || detail === null
          ? null
          : buildPullRequestChecksPopoverModel({
              checksState: model.checks.state,
              checks: detail.checks,
              stale: model.checks.stale,
              canReadLazily: false,
            }).trigger,
      activityUnavailable:
        activityError === null
          ? null
          : buildPullRequestActivityUnavailableModel({ error: activityError, compact: false }),
      branchSplits: (() => {
        const base = model?.header?.branches.base ?? handoffSummary?.baseBranch ?? null;
        const head = model?.header?.branches.head ?? handoffSummary?.headBranch ?? null;
        return {
          base: base === null ? null : splitForMiddleTruncate(base),
          head: head === null ? null : splitForMiddleTruncate(head),
        };
      })(),
    };

    return {
      target,
      ui,
      reference,
      pullRequestKey,
      tabScopeKey,
      supportsThreadPullRequests,
      detailQuery,
      activityQuery,
      coreDetail,
      detail,
      detailSummary,
      sharedSummary,
      handoffSummary,
      matchingListEntry,
      activityPending,
      activityError,
      turnRefresh,
      codeRefreshToken,
      stackReference,
      nativeStack,
      checkoutCommand,
      checkoutRoot,
      actingEnvironmentId,
      actingProjectId: acting?.projectId ?? null,
      markdownRepositoryUrl: detail?.provider === "github" ? repositoryUrl : null,
      model,
      view,
      keybindings,
      linkedThreadsUrl: detail?.url ?? null,
    };
  });

  const viewAtom = Atom.make((get) => get(frameAtom)?.view ?? null);

  let latest: PullRequestDetailFrame | null = null;
  const current = () => latest;
  const updateUi = (update: (ui: DetailUi) => DetailUi) => {
    const frame = latest;
    if (frame === null) return;
    const base = registry.get(uiAtom);
    const ui = base !== null && base.mountKey === frame.ui.mountKey ? base : frame.ui;
    const next = update(ui);
    if (next !== base) registry.set(uiAtom, next);
  };
  const toast = (model: PullRequestToastModel, id?: string) =>
    context.addToast({ ...toastFor(model), ...(id === undefined ? {} : { id }) });

  const refreshDetail = () => {
    const frame = latest;
    if (frame === null) return;
    const { environmentId } = frame.target;
    registry.refresh(
      state.pullRequestEnvironment.detail({ environmentId, input: frame.reference }),
    );
    registry.refresh(
      state.pullRequestEnvironment.activity({ environmentId, input: frame.reference }),
    );
    if (frame.stackReference !== null) popovers.refreshStack(environmentId, frame.stackReference);
  };

  const refreshFromHost = async () => {
    const frame = latest;
    if (frame === null) return;
    updateUi((ui) => ({ ...ui, invalidating: true }));
    try {
      await runAtomCommand(
        registry,
        state.pullRequestEnvironment.invalidate,
        { environmentId: frame.target.environmentId, input: { reference: frame.reference } },
        { reportFailure: false },
      );
      refreshDetail();
      updateUi((ui) => ({ ...ui, refreshToken: ui.refreshToken + 1 }));
    } finally {
      updateUi((ui) => ({ ...ui, invalidating: false }));
    }
  };

  const finishAction = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    const frame = latest;
    if (frame === null) return false;
    const onPage =
      scopedThreadKey(frame.target.panelRef) === scopedThreadKey(PULL_REQUESTS_PANEL_REF);
    if (onPage) bridge.notifyActed(action, "sent");
    const result = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.runAction,
      {
        environmentId: frame.target.environmentId,
        input: {
          ...frame.reference,
          action,
          ...(method ? { mergeMethod: method } : {}),
          ...(updateMethod ? { updateMethod } : {}),
        },
      },
      { reportFailure: false },
    );
    updateUi((ui) => ({ ...ui, pendingAction: null }));
    const outcome = resolvePullRequestActionOutcome({
      action,
      updateMethod,
      failed: result._tag === "Failure",
      failure: result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
    });
    toast(outcome.toast);
    if (!outcome.succeeded) {
      if (onPage) bridge.notifyActed(action, "failed");
      return false;
    }
    if (outcome.refresh === "host") void refreshFromHost();
    else refreshDetail();
    if (onPage) bridge.notifyActed(action, "done");
    return true;
  };

  const perform = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    if (latest === null || latest.ui.pendingAction !== null) return false;
    updateUi((ui) => ({ ...ui, pendingAction: action }));
    return finishAction(action, method, updateMethod);
  };

  const performCommentAction: PullRequestDetailSession["performCommentAction"] = async (
    body,
    action,
  ) => {
    const frame = latest;
    if (frame === null || frame.ui.pendingAction !== null) return { commentPosted: false };
    updateUi((ui) => ({ ...ui, pendingAction: action }));
    const commentResult = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.comment,
      { environmentId: frame.target.environmentId, input: { ...frame.reference, body } },
      { reportFailure: false },
    );
    if (commentResult._tag === "Failure") {
      updateUi((ui) => ({ ...ui, pendingAction: null }));
      context.addToast({
        layout: "plain",
        type: "error",
        title: PULL_REQUEST_COMMENT_POST_FAILURE_TITLE,
      });
      return { commentPosted: false };
    }
    const actionSucceeded = await finishAction(action);
    if (!actionSucceeded) refreshDetail();
    return { commentPosted: true };
  };

  const lastHandoffPromptByDraft = new Map<string, string>();
  const composerTargetKey = (target: ScopedThreadRef | DraftId): string =>
    typeof target === "string" ? target : scopedThreadKey(target);

  const writeTaskToComposer = (target: ScopedThreadRef | DraftId, task: PullRequestThreadTask) => {
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(target);
    const key = composerTargetKey(target);
    const previousCommentIds = new Set((draft?.reviewComments ?? []).map((comment) => comment.id));
    const repeatedCommentIds = new Set(
      (task.reviewComments ?? [])
        .filter((comment) => previousCommentIds.has(comment.id))
        .map((comment) => comment.id),
    );
    const promptWithoutPreviousHandoff = stripPullRequestHandoffReferences(
      draft?.prompt ?? "",
      draft?.reviewComments ?? [],
      repeatedCommentIds,
    );
    const prompt = handoffPrompt(
      {
        prompt: promptWithoutPreviousHandoff,
        lastHandoffPrompt: lastHandoffPromptByDraft.get(key),
      },
      task.prompt,
    );
    lastHandoffPromptByDraft.set(key, task.prompt);
    store.setPrompt(target, prompt);
    store.setReviewComments(
      target,
      handoffReviewComments(draft?.reviewComments ?? [], task.reviewComments ?? []),
    );
    for (const comment of task.reviewComments ?? []) {
      if (!repeatedCommentIds.has(comment.id)) continue;
      store.addReviewComment(target, comment, {
        allowDuplicateReference: true,
        insertAtCaret: false,
      });
    }
  };

  const openThreadWithTask = async (
    environmentId: EnvironmentId,
    projectId: PullRequestRef["projectId"],
    task: PullRequestThreadTask | null,
    opened?: { readonly draftId: DraftId },
  ): Promise<{ readonly draftId: DraftId } | null> => {
    const session =
      opened ??
      (await context.openNewThread(scopeProjectRef(environmentId, projectId)).then(
        (result) => result,
        () => null,
      ));
    if (session === null) return null;
    if (task === null) return session;
    writeTaskToComposer(session.draftId, task);
    return session;
  };

  const startAsk = async (kind: string, task: PullRequestThreadTask) => {
    const frame = latest;
    if (frame === null) return;
    const route = resolvePullRequestAskRoute({
      hasDetail: frame.detail !== null,
      handoff: frame.ui.handoff,
      hasComposer: frame.target.composerDraftTarget !== null,
      promptLength: task.prompt.length,
    });
    if (route.kind === "ignore" || frame.detail === null) return;
    if (route.kind === "composer" && frame.target.composerDraftTarget !== null) {
      writeTaskToComposer(frame.target.composerDraftTarget, task);
      toast(route.toast);
      return;
    }
    updateUi((ui) => ({ ...ui, handoff: kind }));
    const opened = await openThreadWithTask(
      frame.actingEnvironmentId,
      frame.actingProjectId ?? frame.detail.projectId,
      task,
    );
    updateUi((ui) => ({ ...ui, handoff: null }));
    if (opened === null) {
      toast(PULL_REQUEST_THREAD_OPEN_FAILURE_TOAST);
      return;
    }
    toast(pullRequestAskedToast(task.prompt.length));
  };

  const startHandoff = async (
    kind: string,
    task: PullRequestThreadTask | null,
    mode: "worktree" | "local" = "worktree",
  ) => {
    const frame = latest;
    if (frame === null) return;
    const handoffSummary = frame.handoffSummary;
    const route = resolvePullRequestHandoffRoute({
      hasSummary: handoffSummary !== null,
      handoff: frame.ui.handoff,
      hasComposer: frame.target.composerDraftTarget !== null,
      hasTask: task !== null,
      hasCheckoutRoot: frame.checkoutRoot !== null,
    });
    if (route.kind === "ignore" || handoffSummary === null) return;
    if (route.kind === "composer" && frame.target.composerDraftTarget !== null && task !== null) {
      writeTaskToComposer(frame.target.composerDraftTarget, task);
      toast(route.toast);
      return;
    }
    updateUi((ui) => ({ ...ui, handoff: kind }));
    const toastId = toast(PULL_REQUEST_CHECKOUT_TOASTS.preparing);
    const projectId = frame.actingProjectId ?? handoffSummary.projectId;
    const projectRef = scopeProjectRef(frame.actingEnvironmentId, projectId);
    const opened = await context.openNewThread(projectRef).then(
      (result) => result,
      () => null,
    );
    if (opened === null) {
      updateUi((ui) => ({ ...ui, handoff: null }));
      toast(PULL_REQUEST_CHECKOUT_TOASTS.threadFailed, toastId);
      return;
    }
    const scope = resolveSourceControlActionScope({
      environmentId: frame.actingEnvironmentId,
      cwd: frame.checkoutRoot,
    });
    const prepared =
      scope === null
        ? null
        : await state.vcsActionManager.track(
            registry,
            { environmentId: scope.environmentId, cwd: scope.cwd },
            {
              operation: SOURCE_CONTROL_ACTION_OPERATION.preparePullRequestThread,
              label: SOURCE_CONTROL_ACTION_LABEL.preparePullRequestThread,
            },
            () =>
              runAtomCommand(
                registry,
                state.gitEnvironment.preparePullRequestThread,
                {
                  environmentId: scope.environmentId,
                  input: {
                    cwd: scope.cwd,
                    reference: handoffSummary.url,
                    mode,
                    threadId: opened.threadId,
                  },
                },
                { reportFailure: false },
              ),
          );
    if (prepared === null || prepared._tag === "Failure") {
      updateUi((ui) => ({ ...ui, handoff: null }));
      const failure = prepared === null ? null : squashAtomCommandFailure(prepared);
      toast(
        pullRequestCheckoutFailureToast(failure instanceof Error ? failure.message : null),
        toastId,
      );
      return;
    }
    const pointed = await context
      .openNewThread(projectRef, {
        branch: prepared.value.branch,
        worktreePath: prepared.value.worktreePath,
        envMode: prepared.value.worktreePath === null ? "local" : "worktree",
      })
      .then(
        (result) => result !== null,
        () => false,
      );
    if (!pointed) {
      updateUi((ui) => ({ ...ui, handoff: null }));
      toast(pullRequestCheckoutUnpointedToast(prepared.value.branch), toastId);
      return;
    }
    updateUi((ui) => ({ ...ui, handoff: null }));
    if (task !== null) await openThreadWithTask(frame.actingEnvironmentId, projectId, task, opened);
    toast(
      pullRequestCheckoutResultToast({
        mode,
        isOnPullRequestHead: prepared.value.isOnPullRequestHead,
        hasTask: task !== null,
      }),
      toastId,
    );
  };

  const detailFacts = (detail: PullRequestDetailView) => ({
    number: detail.number,
    title: detail.title,
    url: detail.url,
    headBranch: detail.headBranch,
    baseBranch: detail.baseBranch,
    state: detail.state,
    isDraft: detail.isDraft,
  });

  const startFixFinding = (finding: PullRequestFinding) => {
    const detail = latest?.detail ?? null;
    if (detail === null) return;
    void startHandoff(
      pullRequestFindingKey(finding),
      buildFixFindingHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        finding,
      }),
    );
  };

  const addSelectionToAgent: PullRequestDetailSession["addSelectionToAgent"] = (selection) => {
    const detail = latest?.detail ?? null;
    if (detail === null) return;
    void startAsk(
      `selection:${selection.comment.id}`,
      buildAddSelectionToAgentHandoff({
        ...detailFacts(detail),
        comment: selection.comment,
        request: selection.request,
      }),
    );
  };

  const selectCodeCommit = (oid: string | null) => {
    const frame = latest;
    if (frame === null) return;
    updateUi((ui) => ({ ...ui, codeCommit: { pullRequestKey: frame.pullRequestKey, oid } }));
  };

  const setTab = (tab: PullRequestDetailTab) =>
    updateUi((ui) => (ui.tab === tab ? ui : { ...ui, tab }));

  const selectPullRequest = (reference: PullRequestRef) => {
    const frame = latest;
    if (frame === null) return;
    useRightPanelStore.getState().openPullRequest(frame.target.panelRef, {
      projectId: reference.projectId,
      repository: reference.repository,
      number: reference.number,
      ...(reference.host ? { host: reference.host } : {}),
      ...(scopedThreadKey(frame.target.panelRef) === scopedThreadKey(PULL_REQUESTS_PANEL_REF)
        ? { environmentId: frame.target.environmentId }
        : {}),
    });
  };

  const copy = async (value: string, label: string) => {
    await clipboardService(context)
      .writeText(value)
      .then(
        () => context.addToast({ layout: "plain", type: "success", title: `${label} copied` }),
        (error: unknown) =>
          context.addToast({
            layout: "plain",
            type: "error",
            title: `Failed to copy ${label}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
      );
  };

  const changeLink = async (threadId: string, remove: boolean) => {
    const frame = latest;
    const url = frame?.linkedThreadsUrl ?? null;
    if (frame === null || url === null || frame.ui.threadLinkPending) return;
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null) return;
    const environmentId = frame.target.environmentId;
    updateUi((ui) => ({ ...ui, threadLinkPending: true }));
    const threadRef = scopeThreadRef(environmentId, ThreadId.make(threadId));
    try {
      const rules = createPullRequestLinkingRules({
        environmentId,
        capabilities: registry.get(state.serverEnvironment.configValueAtom(environmentId))
          ?.environment.capabilities,
        projects: registry.get(state.environmentProjects.projectsAtom),
      });
      const mutation = rules.planChange(threadRef, url, !remove);
      const result =
        mutation.type === "thread.meta.update"
          ? await runAtomCommand(
              registry,
              state.threadEnvironment.updateMetadata,
              { environmentId, input: mutation.input },
              { reportFailure: false },
            )
          : mutation.type === "thread.pull-request.link"
            ? await runAtomCommand(
                registry,
                state.threadEnvironment.linkPullRequest,
                { environmentId, input: mutation.input },
                { reportFailure: false },
              )
            : await runAtomCommand(
                registry,
                state.threadEnvironment.unlinkPullRequest,
                { environmentId, input: mutation.input },
                { reportFailure: false },
              );
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
        throw squashAtomCommandFailure(result);
      }
    } catch (error) {
      updateUi((ui) => ({ ...ui, threadLinkPending: false }));
      const model = pullRequestThreadLinkFailureToast({ remove, error });
      context.addToast({ layout: "plain", ...model });
      return;
    }
    updateUi((ui) => ({ ...ui, threadLinkPending: false }));
    if (
      threadPullRequestLinkMode(
        registry.get(state.serverEnvironment.configValueAtom(environmentId))?.environment
          .capabilities,
      ) === "multiple"
    ) {
      registry.refresh(linkedThreadsAtomFor({ environmentId, reference: frame.reference, url }));
    }
    updateUi((ui) => ({ ...ui, threadPickerOpen: false, threadPickerQuery: "" }));
  };

  const effects = createEffectRunner();
  let activityRevision: { readonly key: string; readonly updatedAt: string } | null = null;
  let appliedForcedToken: number | null = null;
  let liveKey = "";
  let wasOpen: { readonly surfaceId: string; readonly open: boolean } | null = null;
  let lingerTimer: ReturnType<typeof setTimeout> | undefined;
  const liveRefresh = createLiveRefresh(
    context,
    () => liveKey,
    () => {
      const frame = latest;
      if (frame === null) return;
      registry.refresh(
        state.pullRequestEnvironment.detail({
          environmentId: frame.target.environmentId,
          input: frame.reference,
        }),
      );
    },
  );

  registry.subscribe(
    rightPanelStoreAtom,
    () => {
      const route = registry.get(routeAtom);
      if (route === null) return;
      const { byThreadKey } = registry.get(rightPanelStoreAtom);
      const panel = selectThreadRightPanelState(byThreadKey, route);
      const surface = selectSelectedRightPanelSurface(byThreadKey, route);
      const next =
        surface?.kind === "pull-request" ? { surfaceId: surface.id, open: panel.isOpen } : null;
      if (
        wasOpen !== null &&
        wasOpen.open &&
        next !== null &&
        !next.open &&
        next.surfaceId === wasOpen.surfaceId
      ) {
        const duration = registry.get(context.clientSettingsAtom).panelAnimationDurationMs;
        if (duration > 0) {
          clearTimeout(lingerTimer);
          registry.set(lingerAtom, next.surfaceId);
          lingerTimer = setTimeout(() => registry.set(lingerAtom, null), duration);
        }
      }
      if (next?.open) {
        clearTimeout(lingerTimer);
        if (registry.get(lingerAtom) !== null) registry.set(lingerAtom, null);
      }
      wasOpen = next;
    },
    { immediate: true },
  );

  let running = false;
  let dirty = false;
  let mountedKey: string | null = null;
  registry.subscribe(
    frameAtom,
    () => {
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      try {
        do {
          dirty = false;
          const frame = registry.get(frameAtom);
          latest = frame;
          if (frame === null) {
            if (mountedKey !== null) {
              mountedKey = null;
              effects.reset();
              liveRefresh.unmount();
              activityRevision = null;
              appliedForcedToken = null;
              registry.set(uiAtom, null);
            }
            continue;
          }
          if (mountedKey !== frame.ui.mountKey) {
            if (mountedKey !== null) {
              effects.reset();
              liveRefresh.unmount();
              activityRevision = null;
              appliedForcedToken = null;
            }
            mountedKey = frame.ui.mountKey;
          }
          runEffects(frame);
        } while (dirty);
      } finally {
        running = false;
      }
    },
    { immediate: true },
  );

  function runEffects(frame: PullRequestDetailFrame) {
    if (registry.get(uiAtom) !== frame.ui) registry.set(uiAtom, frame.ui);
    const { environmentId } = frame.target;
    const snapshotKey = `${environmentId}:${frame.pullRequestKey}`;
    effects.run("snapshot-read", [snapshotKey], () => {
      updateUi((ui) =>
        ui.cached?.key === snapshotKey
          ? ui
          : {
              ...ui,
              cached: {
                key: snapshotKey,
                detail: readPullRequestDetailSnapshot(storage, environmentId, frame.reference),
              },
            },
      );
    });
    effects.run("snapshot-write", [frame.detailQuery.data, snapshotKey], () => {
      const data = frame.detailQuery.data;
      if (data === null) return;
      writePullRequestDetailSnapshot(storage, environmentId, frame.reference, data);
      updateUi((ui) => ({ ...ui, cached: { key: snapshotKey, detail: data } }));
    });
    effects.run(
      "observe-summary",
      [frame.detailSummary, frame.detailQuery.dataUpdatedAt, snapshotKey],
      () => {
        if (frame.detailSummary === null || frame.detailQuery.dataUpdatedAt === null) return;
        observePullRequestSummary(
          registry,
          environmentId,
          frame.reference,
          frame.detailSummary,
          frame.detailQuery.dataUpdatedAt,
        );
      },
    );
    effects.run("auto-merge-method", [frame.detail?.autoMergeMethod, frame.pullRequestKey], () => {
      const method = frame.detail?.autoMergeMethod;
      if (method === undefined) return;
      updateUi((ui) => ({
        ...ui,
        mergeMethodSelection: { pullRequestKey: frame.pullRequestKey, method },
      }));
    });
    effects.run(
      "activity-revision",
      [frame.activityQuery.isPending, frame.coreDetail, frame.tabScopeKey],
      () => {
        if (!frame.coreDetail) return;
        const next = { key: frame.tabScopeKey, updatedAt: frame.coreDetail.updatedAt };
        if (shouldRefreshPullRequestActivity(activityRevision, next)) {
          if (frame.activityQuery.isPending) return;
          registry.refresh(
            state.pullRequestEnvironment.activity({ environmentId, input: frame.reference }),
          );
          updateUi((ui) => ({ ...ui, refreshToken: ui.refreshToken + 1 }));
        }
        activityRevision = next;
      },
    );
    effects.run("live-refresh", [environmentId, frame.pullRequestKey, frame.target.gate], () => {
      liveRefresh.unmount();
      if (frame.target.gate !== null) return;
      liveKey = `pull-request:${environmentId}:${frame.pullRequestKey}`;
      liveRefresh.mount();
    });
    if (scopedThreadKey(frame.target.panelRef) === scopedThreadKey(PULL_REQUESTS_PANEL_REF)) {
      const token = registry.get(bridge.detailRefreshTokenAtom);
      if (appliedForcedToken === null) appliedForcedToken = token;
      else if (appliedForcedToken !== token) {
        appliedForcedToken = token;
        void refreshFromHost();
      }
    }
    const visibleTabs = frame.model?.tabs.items ?? [];
    effects.run(
      "tab-fallback",
      [frame.ui.tab, visibleTabs.map((tab) => tab.value).join(",")],
      () => {
        if (frame.model === null) return;
        const fallback = resolvePullRequestDetailTabFallback(frame.ui.tab, visibleTabs);
        if (fallback !== null) setTab(fallback);
      },
    );
    effects.run("visited-tabs", [frame.ui.tab, frame.tabScopeKey], () => {
      updateUi((ui) => {
        if (ui.visitedKey !== frame.tabScopeKey) {
          return { ...ui, visitedKey: frame.tabScopeKey, visited: [ui.tab] };
        }
        return ui.visited.includes(ui.tab) ? ui : { ...ui, visited: [...ui.visited, ui.tab] };
      });
    });
  }

  registry.subscribe(bridge.detailRefreshTokenAtom, () => {
    const frame = latest;
    if (frame !== null) runEffects(frame);
  });

  const requireModel = () => {
    const frame = latest;
    if (frame === null || frame.model === null) return null;
    return { frame, model: frame.model };
  };

  const runStack = async () => {
    const frame = latest;
    const stack = frame?.nativeStack.data ?? null;
    const model = frame?.model ?? null;
    if (frame === null || stack === null || model === null) return;
    const decision = resolvePullRequestStackAction({
      stack,
      referenceNumber: frame.reference.number,
      canMerge: model.actions.stackMenu.canMerge,
      canRebase: model.actions.stackMenu.canRebase,
      mergeMethod: model.actions.stackMenu.mergeMethod,
      pending: frame.ui.stackPending,
      confirmation: frame.ui.stackConfirmation,
    });
    if (decision.kind === "ignore") return;
    updateUi((ui) => ({ ...ui, stackPending: true }));
    const result = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.runAction,
      {
        environmentId: frame.target.environmentId,
        input: {
          ...frame.reference,
          number: decision.number,
          stackNumber: decision.stackNumber,
          expectedStackHeads: decision.expectedStackHeads,
          action: decision.action,
          ...(decision.mergeMethod !== null
            ? { mergeMethod: decision.mergeMethod }
            : { updateMethod: "rebase" as const }),
        },
      },
      { reportFailure: false },
    );
    updateUi((ui) => ({ ...ui, stackPending: false, stackConfirmation: null }));
    refreshDetail();
    if (scopedThreadKey(frame.target.panelRef) === scopedThreadKey(PULL_REQUESTS_PANEL_REF)) {
      bridge.notifyActed(undefined, "done");
    }
    const stackToast = pullRequestStackActionToast({
      action: decision.action,
      failure: result._tag === "Failure" ? String(squashAtomCommandFailure(result)) : null,
    });
    context.addToast({
      layout: "plain",
      type: stackToast.type,
      title: stackToast.title,
      ...(stackToast.description === undefined ? {} : { description: stackToast.description }),
    });
  };

  const feature: CoreFeature = {
    views: { pullRequestDetail: viewAtom },
    actions: {
      pullRequestDetailSetTab: async (params) => {
        const frame = latest;
        if (frame === null || frame.model === null) return null;
        const next = resolvePullRequestDetailTabChange(
          TabParams(params).tab,
          frame.model.tabs.items,
        );
        if (next !== null) setTab(next);
        return null;
      },
      pullRequestDetailToggleTimelineOrder: async () => {
        updateUi((ui) => ({
          ...ui,
          timelineOrder: ui.timelineOrder === "newest" ? "oldest" : "newest",
        }));
        return null;
      },
      pullRequestDetailRefresh: async () => {
        await refreshFromHost();
        return null;
      },
      pullRequestDetailRetry: async () => {
        refreshDetail();
        return null;
      },
      pullRequestDetailRetryStack: async () => {
        const frame = latest;
        if (frame !== null && frame.stackReference !== null) {
          popovers.refreshStack(frame.target.environmentId, frame.stackReference);
        }
        return null;
      },
      pullRequestDetailRetryActivity: async () => {
        const frame = latest;
        if (frame !== null) {
          registry.refresh(
            state.pullRequestEnvironment.activity({
              environmentId: frame.target.environmentId,
              input: frame.reference,
            }),
          );
        }
        return null;
      },
      pullRequestDetailOpenUrl: async (params) => {
        await openExternal(UrlParams(params).url).catch(() => undefined);
        return null;
      },
      pullRequestDetailNumberContextMenu: async (params) => {
        const { x, y } = PositionParams(params);
        const detail = latest?.detail ?? null;
        if (detail === null) return null;
        const action = await contextMenuService(context)
          .show(
            [
              { id: "copy-link", label: "Copy link", icon: "copy" },
              { id: "open-external", label: openOnHostLabel(detail.provider) },
            ],
            { x, y },
          )
          .catch(() => null);
        try {
          if (action === "copy-link") await clipboardService(context).writeText(detail.url);
          else if (action === "open-external") await openExternal(detail.url);
        } catch {
          context.addToast({
            layout: "plain",
            type: "error",
            title: action === "copy-link" ? "Could not copy the link" : "Could not open the link",
          });
        }
        return null;
      },
      pullRequestDetailCopy: async (params) => {
        const { target } = CopyParams(params);
        const required = requireModel();
        const frame = latest;
        if (frame === null) return null;
        if (target === "checkout") {
          const value = frame.checkoutCommand;
          if (value === null) return null;
          await clipboardService(context)
            .writeText(value)
            .catch((error: unknown) =>
              context.addToast({
                layout: "plain",
                type: "error",
                title: PULL_REQUEST_CHECKOUT_COMMAND_COPY_FAILURE_TITLE,
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          return null;
        }
        if (target === "branch") {
          const branch = frame.handoffSummary?.headBranch ?? null;
          if (branch !== null)
            await clipboardService(context)
              .writeText(branch)
              .catch(() => undefined);
          return null;
        }
        if (required === null || required.model.menu === null) return null;
        const menu = required.model.menu;
        if (target === "link") await copy(menu.copyLink.value, "PR link");
        else await copy(menu.copyNumber.value, "PR number");
        return null;
      },
      pullRequestDetailPerform: async (params) => {
        await perform(PerformParams(params).action);
        return null;
      },
      pullRequestDetailUpdateBranch: async (params) => {
        await perform("update-branch", undefined, UpdateBranchParams(params).method);
        return null;
      },
      pullRequestDetailConfirm: async (params) => {
        const { action } = ConfirmParams(params);
        updateUi((ui) => ({ ...ui, confirmation: { open: true, action } }));
        return null;
      },
      pullRequestDetailConfirmCancel: async () => {
        updateUi((ui) => ({ ...ui, confirmation: { open: false, action: "merge" } }));
        return null;
      },
      pullRequestDetailConfirmAccept: async () => {
        const required = requireModel();
        if (required === null) return null;
        const request = resolvePullRequestConfirmedAction(
          required.frame.ui.confirmation.action,
          required.model.selectedMergeMethod,
        );
        updateUi((ui) => ({ ...ui, confirmation: { ...ui.confirmation, open: false } }));
        await perform(request.action, request.mergeMethod);
        updateUi((ui) =>
          ui.confirmation.open ? ui : { ...ui, confirmation: { open: false, action: "merge" } },
        );
        return null;
      },
      pullRequestDetailLifecycle: async () => {
        const lifecycle = latest?.model?.menu?.lifecycle ?? null;
        if (lifecycle === null) return null;
        if (lifecycle.action === "reopen") {
          await perform("reopen");
          return null;
        }
        const action = lifecycle.action;
        updateUi((ui) => ({ ...ui, confirmation: { open: true, action } }));
        return null;
      },
      pullRequestDetailSetMergeMethod: async (params) => {
        const { method } = MergeMethodParams(params);
        const options = latest?.model?.menu?.actionGroup.mergeMethods.options ?? [];
        if (!options.some((option) => option.method === method)) return null;
        const frame = latest;
        if (frame === null) return null;
        updateUi((ui) => ({
          ...ui,
          mergeMethodSelection: { pullRequestKey: frame.pullRequestKey, method },
        }));
        context.updateUiState((ui) => setPullRequestMergeMethod(ui, method));
        return null;
      },
      pullRequestDetailCheckout: async (params) => {
        if (latest?.handoffSummary == null) return null;
        const { mode } = CheckoutParams(params);
        void startHandoff(`checkout:${mode}`, null, mode);
        return null;
      },
      pullRequestDetailSetActingEnvironment: async (params) => {
        const frame = latest;
        if (frame === null) return null;
        const environmentId = EnvironmentId.make(EnvironmentParams(params).environmentId);
        updateUi((ui) => ({
          ...ui,
          actingScope: { pullRequestKey: frame.pullRequestKey, environmentId },
        }));
        return null;
      },
      pullRequestDetailAsk: async () => {
        const detail = latest?.detail ?? null;
        if (detail !== null)
          void startAsk("ask", buildAskAboutPullRequestHandoff(detailFacts(detail)));
        return null;
      },
      pullRequestDetailExplain: async () => {
        const detail = latest?.detail ?? null;
        if (detail !== null) {
          void startAsk("explain", buildExplainPullRequestHandoff(detailFacts(detail)));
        }
        return null;
      },
      pullRequestDetailFixFindings: async () => {
        const frame = latest;
        const detail = frame?.detail ?? null;
        if (frame === null || detail === null) return null;
        void startHandoff(
          "findings",
          buildFixFindingsHandoff({
            number: detail.number,
            title: detail.title,
            url: detail.url,
            headBranch: detail.headBranch,
            baseBranch: detail.baseBranch,
            reviewThreads: detail.reviewThreads,
            comments: detail.comments,
            checks: frame.model?.checks.stale ? [] : detail.checks,
            commentsTruncated: detail.commentsTruncated,
          }),
        );
        return null;
      },
      pullRequestDetailResolveConflicts: async () => {
        const summary = latest?.handoffSummary ?? null;
        if (summary === null) return null;
        void startHandoff("conflicts", {
          prompt: buildResolveConflictsPrompt({
            number: summary.number,
            url: summary.url,
            headBranch: summary.headBranch,
            baseBranch: summary.baseBranch,
          }),
        });
        return null;
      },
      pullRequestDetailTitleEdit: async () => {
        const frame = latest;
        const detail = frame?.detail ?? null;
        if (frame === null || detail === null) return null;
        updateUi((ui) => ({
          ...ui,
          titleScope: { pullRequestKey: frame.pullRequestKey, text: detail.title },
          titleRevision: ui.titleRevision + 1,
        }));
        return null;
      },
      pullRequestDetailTitleDraft: async (params) => {
        const frame = latest;
        if (frame === null) return null;
        const { text } = TextParams(params);
        updateUi((ui) => ({ ...ui, titleScope: { pullRequestKey: frame.pullRequestKey, text } }));
        return null;
      },
      pullRequestDetailTitleCancel: async () => {
        updateUi((ui) => ({ ...ui, titleScope: null }));
        return null;
      },
      pullRequestDetailTitleSave: async (params) => {
        const frame = latest;
        if (frame === null) return null;
        const { text } = TextParams(params);
        const decision = resolvePullRequestTitleSave({
          draft: text,
          currentTitle: frame.detail?.title ?? null,
          saving: frame.ui.titleSaving,
        });
        if (decision.kind === "ignore") return null;
        if (decision.kind === "discard") {
          updateUi((ui) => ({ ...ui, titleScope: null }));
          return null;
        }
        updateUi((ui) => ({ ...ui, titleSaving: true }));
        const result = await runAtomCommand(
          registry,
          state.pullRequestEnvironment.update,
          {
            environmentId: frame.target.environmentId,
            input: { ...frame.reference, title: decision.title },
          },
          { reportFailure: false },
        );
        updateUi((ui) => ({ ...ui, titleSaving: false }));
        if (result._tag === "Failure") {
          toast(pullRequestTitleSaveFailureToast(squashAtomCommandFailure(result)));
          return null;
        }
        updateUi((ui) => ({ ...ui, titleScope: null }));
        refreshDetail();
        return null;
      },
      pullRequestDetailBack: async () => {
        const frame = latest;
        if (frame === null || !frame.target.hasBack || frame.target.threadRef === null) return null;
        useRightPanelStore.getState().open(frame.target.threadRef, "pull-requests");
        return null;
      },
      pullRequestDetailChecksOpen: async () => {
        const frame = latest;
        const detail = frame?.detail ?? null;
        const checks = frame?.model?.checks ?? null;
        if (frame === null || detail === null || checks === null || checks.state === null) {
          return null;
        }
        popovers.openChecks("detail:checks", {
          environmentId: frame.target.environmentId,
          reference: frame.reference,
          checksState: checks.state,
          checks: detail.checks,
          stale: checks.stale,
        });
        return null;
      },
      pullRequestDetailStackSelect: async (params) => {
        const frame = latest;
        if (frame === null || frame.ui.stackPending) return null;
        selectPullRequest({ ...frame.reference, number: NumberParams(params).number });
        return null;
      },
      pullRequestDetailStackConfirm: async (params) => {
        const { action } = StackConfirmParams(params);
        updateUi((ui) => ({ ...ui, stackConfirmation: action }));
        return null;
      },
      pullRequestDetailStackCancel: async () => {
        updateUi((ui) => (ui.stackPending ? ui : { ...ui, stackConfirmation: null }));
        return null;
      },
      pullRequestDetailStackRun: async () => {
        await runStack();
        return null;
      },
      pullRequestDetailThreadLinkMenu: async () => {
        const frame = latest;
        const links = frame?.view.threadLinks ?? null;
        if (frame === null || links === null) return null;
        const linkThreadRef =
          frame.target.threadRef ??
          (typeof frame.target.composerDraftTarget === "object"
            ? frame.target.composerDraftTarget
            : null);
        const currentThreadId =
          linkThreadRef?.environmentId === frame.target.environmentId
            ? linkThreadRef.threadId
            : null;
        const action = resolvePullRequestThreadLinkMenuAction({
          currentThreadId,
          linkedHere: links.model.menuItem.icon === "unlink",
        });
        if (action.kind === "change") await changeLink(action.threadId, action.remove);
        else updateUi((ui) => ({ ...ui, threadPickerOpen: true, threadPickerQuery: "" }));
        return null;
      },
      pullRequestDetailThreadLinksCount: async () => {
        const url = latest?.linkedThreadsUrl ?? null;
        if (url !== null) commandPaletteService(context).open({ query: url });
        return null;
      },
      pullRequestDetailThreadPickerQuery: async (params) => {
        const { query } = QueryParams(params);
        updateUi((ui) => ({ ...ui, threadPickerQuery: query }));
        return null;
      },
      pullRequestDetailThreadPickerSelect: async (params) => {
        await changeLink(ThreadParams(params).threadId, false);
        return null;
      },
      pullRequestDetailThreadPickerClose: async () => {
        updateUi((ui) => ({ ...ui, threadPickerOpen: false, threadPickerQuery: "" }));
        return null;
      },
      pullRequestDetailKeyDown: async (params) => {
        const frame = latest;
        if (frame === null || !frame.target.shortcutsEnabled) return false;
        const event = KeyDownParams(params);
        const command = resolveShortcutCommand(event, frame.keybindings, {
          platform: context.platform,
          context: {
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            modelPickerOpen: false,
            isWeb: false,
            isDesktop: true,
          },
        });
        if (command !== "pullRequest.copyNumber") return false;
        if (!event.repeat) await copy(`#${frame.reference.number}`, "PR number");
        return true;
      },
    },
  };

  return {
    frameAtom,
    current,
    refreshDetail,
    refreshFromHost,
    performCommentAction,
    startFixFinding,
    addSelectionToAgent,
    openCommit: (oid) => {
      selectCodeCommit(oid);
      setTab("code");
    },
    selectCodeCommit,
    selectPullRequest,
    feature,
  };
}
