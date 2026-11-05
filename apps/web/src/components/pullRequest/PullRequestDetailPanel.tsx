import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { useAtomValue } from "@effect/atom-react";
import { usePullRequestStack } from "~/state/usePullRequestStack";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopedThreadKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  DEFAULT_SERVER_SETTINGS,
  type PullRequestAction,
  type PullRequestMergeMethod,
  type PullRequestListEntry,
  type PullRequestUpdateMethod,
  type PullRequestRef,
  resolveEnvironmentMachineKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  ArrowDownUpIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  CircleDotIcon,
  CopyIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  HammerIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  PlayIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  type ShortcutMatchContext,
} from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useClientSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { changeRequestRepositoryUrl, gitHubPullRequestBrowserUrl } from "~/lib/openPullRequestLink";
import { usePreparePullRequestThreadAction } from "~/lib/sourceControlActions";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { useProjects, useServerConfigs } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import {
  pullRequestEnvironment,
  usePullRequestTurnRefresh,
  useSharedPullRequestSummary,
} from "~/state/pullRequests";
import {
  newestPullRequestSummary,
  pullRequestListEntryToSummary,
} from "~/state/pullRequestSummaries";
import { useAtomCommand } from "~/state/use-atom-command";
import { PullRequestStackMenu } from "./PullRequestStackMenu";
import { PullRequestThreadLinks } from "./PullRequestThreadLinks";
import { vcsEnvironment } from "~/state/vcs";
import { useUiStateStore } from "~/uiStateStore";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { PullRequestEditButton } from "./PullRequestEditButton";
import { Input } from "../ui/input";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";
import { PullRequestDetailGhost, PullRequestTimelineGhost } from "./PullRequestGhosts";
import { PullRequestCopyableCode } from "./PullRequestCopyableCode";
import { PullRequestActivityUnavailableState } from "./PullRequestActivityUnavailableState";
import { DiffPanelLoadingState } from "../DiffPanelShell";
import { PullRequestsUnavailableState } from "./PullRequestsUnavailableState";
import type { PullRequestAgentSelectionInput } from "./PullRequestCodeTab";
import { showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";
import { PullRequestMarkdownContext } from "./PullRequestMarkdown";
import { PullRequestComposer } from "./PullRequestComposer";
import { PullRequestSummaryTab } from "./PullRequestSummaryTab";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab";
import {
  buildAddSelectionToAgentHandoff,
  buildAskAboutPullRequestHandoff,
  buildExplainPullRequestHandoff,
  buildFixFindingHandoff,
  buildFixFindingsHandoff,
  buildResolveConflictsPrompt,
  handoffPrompt,
  handoffReviewComments,
  loadingPullRequestCheckoutCommand,
  isStackedPullRequestBase,
  pullRequestCheckoutCommand,
  pullRequestFindingKey,
  readPullRequestDetailSnapshot,
  resolvePullRequestReferenceHost,
  resolveDisplayedPullRequestDetail,
  allowsSinglePullRequestMerge,
  type PullRequestFinding,
  shouldRefreshPullRequestActivity,
  stripPullRequestHandoffReferences,
  writePullRequestDetailSnapshot,
} from "./pullRequestDetail.logic";
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
  resolvePullRequestChromeCondensed,
  resolvePullRequestConfirmedAction,
  resolvePullRequestDetailTabChange,
  resolvePullRequestDetailTabFallback,
  resolvePullRequestHandoffRoute,
  resolvePullRequestTitleKey,
  resolvePullRequestTitleSave,
  type PullRequestDetailButtonModel,
  type PullRequestDetailTab as DetailTab,
  type PullRequestEnvironmentPickerModel,
  type PullRequestFreshnessModel,
} from "./PullRequestDetailPanel.logic";
import { resolvePickableEnvironments } from "./pullRequestProjectAssignment.logic";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import {
  PullRequestActorLabel,
  PullRequestDiffStat,
  PullRequestMetaLine,
  PullRequestReviewOutcomeIcon,
} from "./pullRequestPresentation";
import { openOnHostLabel, pullRequestChecksState } from "./pullRequestPresentation.logic";
import { PullRequestGlyph } from "./pullRequestIcons";

// The diff viewer pulls in its worker pool, so load it only when the reader approaches Code.
// Start the download on tab hover or focus, before the click, without loading it for every PR.
const loadCodeTab = () => import("./PullRequestCodeTab");
const PullRequestCodeTab = lazy(loadCodeTab);

/**
 * What the last hand-off wrote into each draft, kept outside React because the panel that wrote it
 * is closed by the time the next one opens. It is how a prompt the reader has since edited is told
 * apart from the one they were handed: only the sentence still exactly as written may be replaced.
 */
const lastHandoffPromptByDraft = new Map<string, string>();

const composerTargetKey = (target: ScopedThreadRef | DraftId): string =>
  typeof target === "string" ? target : scopedThreadKey(target);

/**
 * Which server the checkout and the hand-offs land on, where more than one of them holds this
 * repository. The list picked one of them to show the pull request under, so that everything on
 * it is read from somewhere; where the reader wants to work is a separate answer, and this is
 * where they give it.
 */
function ActOnEnvironmentPicker({
  picker,
  onChange,
}: {
  picker: PullRequestEnvironmentPickerModel;
  onChange: (environmentId: EnvironmentId) => void;
}) {
  if (!picker.visible) return null;
  return (
    <>
      <MenuSeparator />
      <MenuRadioGroup
        value={picker.value}
        onValueChange={(environmentId) => {
          const next = picker.options.find((option) => option.environmentId === environmentId);
          if (next) onChange(next.environmentId);
        }}
      >
        {picker.options.map((environment) => (
          <MenuRadioItem
            key={environment.environmentId}
            value={environment.environmentId}
            disabled={picker.disabled}
          >
            {/* The radio item lays its children out as one block, so the icon and the label
                need their own row to share a line. */}
            <span className="flex min-w-0 items-center gap-2">
              <EnvironmentMachineIcon kind={environment.machine} className="size-3.5 shrink-0" />
              <span className="truncate">{environment.label}</span>
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  );
}

/** The number is a link in every place the host writes it, so the right-click that copies one
    has to answer here too — otherwise the platform's own cut/paste menu opens over it. */
const openNumberContextMenu = (
  event: ReactMouseEvent,
  detail: { readonly url: string; readonly provider: string },
): void => {
  event.preventDefault();
  event.stopPropagation();
  void showPullRequestLinkContextMenu({
    url: detail.url,
    openLabel: openOnHostLabel(detail.provider),
    position: { x: event.clientX, y: event.clientY },
  });
};

/**
 * The stale-branch warning, said beside the branch it is about rather than as a bar of its own.
 * The banner this replaces held a row of chrome open across the top of every pull request that
 * had fallen behind, pushing the reading down to say something that is true of the base branch
 * and nothing else; as a mark on the base branch it is where a reader would look for it, and the
 * sentence and the way out of it arrive together the moment the mark is pointed at.
 *
 * A popover rather than a tooltip because what it holds can be pressed: a tooltip's layer takes
 * no pointer, and a control nobody can reach is worse than no control.
 */
function PullRequestBaseFreshnessWarning({
  freshness,
  onUpdate,
  iconClassName,
  className,
  children,
}: {
  readonly freshness: PullRequestFreshnessModel;
  readonly onUpdate: (method: PullRequestUpdateMethod) => void;
  readonly iconClassName?: string;
  readonly className?: string;
  /** What the warning is about, drawn in the same amber before the mark: the base branch. */
  readonly children?: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={120}
        render={
          <button
            type="button"
            aria-label={freshness.summary}
            className={cn(
              "inline-flex min-w-0 shrink-0 cursor-help items-center gap-1 rounded-sm text-warning-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        {children}
        <TriangleAlertIcon aria-hidden className={cn("size-3.5 shrink-0", iconClassName)} />
      </PopoverTrigger>
      <PopoverPopup align="start" side="bottom" className="max-w-80" padding="compact">
        <p className="text-xs text-foreground">{freshness.summary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{freshness.note}</p>
        {/* Each way the host offers and this reader may take, as its own button: a split button
            would need a menu inside a popover, and two buttons say the same thing in one layer. */}
        {freshness.methods.length > 0 ? (
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {freshness.methods.map((entry) => (
              <Button
                key={entry.method}
                size="xs"
                variant="outline"
                disabled={freshness.disabled}
                onClick={() => onUpdate(entry.method)}
              >
                <PullRequestGlyph.merged aria-hidden className="size-3" />
                {entry.label}
              </Button>
            ))}
          </span>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

function HeaderActionButton({
  model,
  variant,
  icon,
  hideBelow,
  onClick,
}: {
  readonly model: PullRequestDetailButtonModel;
  readonly variant: "default" | "destructive-outline" | "warning-outline";
  readonly icon: ReactNode;
  readonly hideBelow: "30rem" | null;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0">
            <Button
              size="xs"
              variant={variant}
              disabled={model.disabled}
              onClick={onClick}
              aria-label={model.ariaLabel}
            >
              {icon}
              <span className={hideBelow === null ? undefined : "@max-[30rem]/pr-header:hidden"}>
                {model.label}
              </span>
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">{model.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

export function PullRequestDetailPanel({
  environmentId,
  shortcutsEnabled,
  getShortcutContext,
  threadRef = null,
  reference: requestedReference,
  listEntry = null,
  refreshToken: forcedRefreshToken = 0,
  onActed,
  onClose,
  context = "page",
  composerDraftTarget,
  onBack,
  onSelectPullRequest,
}: {
  environmentId: EnvironmentId;
  shortcutsEnabled: boolean;
  getShortcutContext: () => ShortcutMatchContext;
  onSelectPullRequest?: ((reference: PullRequestRef) => void) | undefined;
  /**
   * The thread this panel sits beside, if any. Links that are not the pull
   * request itself (check details, host permalinks) can open in that thread's
   * in-app browser when the user has asked for it; the page has no thread, so
   * there they always go to the system browser.
   */
  threadRef?: ScopedThreadRef | null;
  reference: PullRequestRef;
  /** Row fields already loaded by the pull-request list, used while richer detail arrives. */
  listEntry?: PullRequestListEntry | null;
  /**
   * Bumped by whatever holds the panel when a reader asks for everything on screen to be read
   * again. The panel owns its own reads, so the page cannot refresh them for it — it says when,
   * and this says it.
   */
  refreshToken?: number;
  /**
   * An action changed this pull request on the host, so a list showing it is now out of date.
   * Told rather than assumed: only the page knows whether it is showing one.
   */
  /**
   * Each host action as it goes: "sent" the moment it leaves, so a list can answer before the
   * host does; "done" or "failed" when the host has spoken. Undefined for one the caller cannot
   * name, which is only ever "done".
   */
  onActed?: (action?: PullRequestAction, phase?: "sent" | "done" | "failed") => void;
  /** Page-owned detail columns use this to clear the selected pull request. */
  onClose?: () => void;
  /**
   * Beside a thread, the checkout affordance disappears: the panel is showing that thread's
   * own pull request, so the branch is already under the reader's feet — and checking it out
   * again is at best a no-op and at worst git refusing a branch two checkouts.
   */
  context?: "page" | "thread";
  /** The open thread's composer. */
  composerDraftTarget?: ScopedThreadRef | DraftId;
  /**
   * Beside a thread, the way back to that thread's list of pull requests. The tab strip can
   * close this surface, but closing is not going back: the reader came from the list and
   * expects to land on it, with this one still open behind.
   */
  onBack?: (() => void) | undefined;
}) {
  const environmentConfigs = useServerConfigs();
  const projects = useProjects();
  const project = projects.find(
    (project) =>
      project.id === requestedReference.projectId && project.environmentId === environmentId,
  );
  const repositoryIdentity = project?.repositoryIdentity;
  const supportsThreadPullRequests =
    environmentConfigs.get(environmentId)?.environment.capabilities.threadPullRequests === true;
  const reference = useMemo(
    () =>
      supportsThreadPullRequests
        ? resolvePullRequestReferenceHost(requestedReference, repositoryIdentity)
        : {
            projectId: requestedReference.projectId,
            repository: requestedReference.repository,
            number: requestedReference.number,
          },
    [requestedReference, repositoryIdentity, supportsThreadPullRequests],
  );
  const pullRequestKey = pullRequestDetailKey(reference);
  const matchingListEntry = matchPullRequestListEntry(listEntry, reference);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("summary");
  const [timelineOrder, setTimelineOrder] = useState<"newest" | "oldest">("newest");
  const [codeCommitScope, setCodeCommitScope] = useState<{
    readonly pullRequestKey: string;
    readonly oid: string | null;
  }>(() => ({ pullRequestKey, oid: null }));
  const selectedCodeCommitOid =
    codeCommitScope.pullRequestKey === pullRequestKey ? codeCommitScope.oid : null;
  const selectCodeCommit = (oid: string | null) => {
    setCodeCommitScope({ pullRequestKey, oid });
  };
  const openCommit = (oid: string) => {
    selectCodeCommit(oid);
    setTab("code");
  };
  // Every tab the reader has opened stays mounted behind the active one. The diff viewer
  // always needed this (it virtualizes against its own scroll position); the trace showed the
  // summary needs it too — a large description re-parses its whole markdown on every return
  // to the tab. `visibility` keeps boxes, sizes and scroll offsets, and takes hidden content
  // out of the tab order and the accessibility tree.
  const tabScopeKey = `${environmentId}:${pullRequestKey}`;
  const [tabMountState, setTabMountState] = useState(() => ({
    key: tabScopeKey,
    tabs: new Set<DetailTab>(["summary"]),
  }));
  // A previously visited Code tab must not fetch diffs for every later PR while hidden.
  const mountedTabs =
    tabMountState.key === tabScopeKey ? tabMountState.tabs : new Set<DetailTab>([tab]);
  useEffect(() => {
    setTabMountState((previous) => {
      if (previous.key !== tabScopeKey) return { key: tabScopeKey, tabs: new Set([tab]) };
      if (previous.tabs.has(tab)) return previous;
      return { key: tabScopeKey, tabs: new Set(previous.tabs).add(tab) };
    });
  }, [tab, tabScopeKey]);
  const [chromeCondensed, setChromeCondensed] = useState(false);
  // Each mounted tab remembers its own scroll chrome; short tabs cannot scroll to reopen it.
  const chromeStateByTab = useRef<Partial<Record<DetailTab, boolean>>>({});
  useEffect(() => {
    setChromeCondensed(chromeStateByTab.current[tab] ?? false);
  }, [tab]);
  const condensed = chromeCondensed;
  const scrollerRef = useRef<HTMLElement | null>(null);
  const foldRef = useRef<HTMLDivElement | null>(null);
  const condensedRowRef = useRef<HTMLDivElement | null>(null);
  // Refund after the fold commits so the content under the reader does not jump with its height.
  const compensationRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (compensationRef.current === null) return;
    const scroller = scrollerRef.current;
    const delta = compensationRef.current;
    compensationRef.current = null;
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
  }, [condensed]);
  const lastSelectedMergeMethod = useUiStateStore((state) => state.pullRequestMergeMethod);
  const setLastSelectedMergeMethod = useUiStateStore((state) => state.setPullRequestMergeMethod);
  // Server-side and per project, like every other project setting. The
  // client-local per-project map from before still answers when the server
  // has no value, so a choice made on an older release keeps applying until
  // it is set (or reset) in Settings.
  const legacyMergeMethodOverrides = useClientSettings(
    (settings) => settings.pullRequestMergeMethodOverrides,
  );
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectDefaultMergeMethod =
    resolveProjectSettings(
      environmentConfigs.get(environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS,
      reference.projectId,
    ).settings.pullRequestMergeMethod ?? undefined;
  const [mergeMethodSelection, setMergeMethodSelection] = useState<{
    readonly pullRequestKey: string;
    readonly method: PullRequestMergeMethod;
  } | null>(null);
  const setMergeMethod = (method: PullRequestMergeMethod) => {
    setMergeMethodSelection({ pullRequestKey, method });
  };
  const [confirmation, setConfirmation] = useState<{
    readonly open: boolean;
    readonly action: "merge" | "close" | "enable-auto-merge" | "revert" | "approve-workflows";
  }>({ open: false, action: "merge" });
  const confirmAction = confirmation.action;
  // Which handoff is preparing, keyed so a per-finding button can say "Preparing..." on itself
  // alone. One at a time whatever the key: they all check the same pull request out.
  const [handoff, setHandoff] = useState<string | null>(null);
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  const activityQuery = useEnvironmentQuery(
    pullRequestEnvironment.activity({ environmentId, input: reference }),
  );
  const turnRefresh = usePullRequestTurnRefresh(environmentId);
  const [cachedDetail, setCachedDetail] = useState(() =>
    readPullRequestDetailSnapshot(
      typeof window === "undefined" ? undefined : window.localStorage,
      environmentId,
      reference,
    ),
  );
  useEffect(() => {
    setCachedDetail(
      readPullRequestDetailSnapshot(
        typeof window === "undefined" ? undefined : window.localStorage,
        environmentId,
        reference,
      ),
    );
  }, [environmentId, pullRequestKey, reference.projectId, reference.repository, reference.number]);
  useEffect(() => {
    if (detailQuery.data === null) return;
    writePullRequestDetailSnapshot(
      typeof window === "undefined" ? undefined : window.localStorage,
      environmentId,
      reference,
      detailQuery.data,
    );
    setCachedDetail(detailQuery.data);
  }, [
    detailQuery.data,
    environmentId,
    pullRequestKey,
    reference.projectId,
    reference.repository,
    reference.number,
  ]);
  const resolvedCoreDetail = resolveDisplayedPullRequestDetail({
    live: detailQuery.data,
    cached: cachedDetail,
    reference,
  });
  const listSummary = useMemo(
    () => (matchingListEntry === null ? null : pullRequestListEntryToSummary(matchingListEntry)),
    [matchingListEntry],
  );
  const detailSummary = useMemo(
    () =>
      detailQuery.data === null
        ? null
        : {
            ...detailQuery.data,
            checksState: pullRequestChecksState(detailQuery.data.checks),
          },
    [detailQuery.data],
  );
  const observedSummary = useSharedPullRequestSummary(
    environmentId,
    reference,
    detailSummary,
    detailQuery.dataUpdatedAt,
  );
  // The list row is also published to the shared cache, but only after this commit's layout
  // effects run, so it is compared directly rather than trusted to be there already.
  const sharedSummary = useMemo(
    () =>
      newestPullRequestSummary(
        resolvedCoreDetail,
        newestPullRequestSummary(observedSummary, listSummary),
      ),
    [resolvedCoreDetail, observedSummary, listSummary],
  );
  const coreDetail = useMemo(
    () => mergePullRequestDetailSummary(resolvedCoreDetail, sharedSummary),
    [resolvedCoreDetail, sharedSummary],
  );
  const activity = activityQuery.data;
  const detail = useMemo(
    () => applyPullRequestActivity(coreDetail, activity),
    [activity, coreDetail],
  );
  const handoffSummary = detail ?? sharedSummary;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { copyToClipboard: copyReference } = useCopyToClipboard<string>({
    target: "pull request reference",
    onCopy: (label) => toastManager.add({ type: "success", title: `${label} copied` }),
    onError: (error, label) =>
      toastManager.add({
        type: "error",
        title: `Failed to copy ${label}`,
        description: error.message,
      }),
  });
  const copyFromShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!shortcutsEnabled || event.defaultPrevented || isCommandPaletteOpen()) return;
    const command = resolveShortcutCommand(event, keybindings, {
      context: getShortcutContext(),
    });
    if (command !== "pullRequest.copyNumber") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) copyReference(`#${reference.number}`, "PR number");
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => copyFromShortcut(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  useEffect(() => {
    if (detail?.autoMergeMethod !== undefined) setMergeMethod(detail.autoMergeMethod);
  }, [detail?.autoMergeMethod, pullRequestKey]);
  const repositoryUrl = detail === null ? null : changeRequestRepositoryUrl(detail.url);
  const markdownContext = useMemo(
    () => ({ repositoryUrl: detail?.provider === "github" ? repositoryUrl : null, threadRef }),
    [detail?.provider, repositoryUrl, threadRef],
  );
  const checkoutCommand = handoffSummary
    ? pullRequestCheckoutCommand(
        handoffSummary.provider,
        handoffSummary.number,
        handoffSummary.headBranch,
        detail?.headRepositoryNameWithOwner,
        changeRequestRepositoryUrl(handoffSummary.url),
      )
    : loadingPullRequestCheckoutCommand(reference, repositoryIdentity);
  const onCheckoutCommandError = useCallback((error: Error) => {
    toastManager.add({
      type: "error",
      title: PULL_REQUEST_CHECKOUT_COMMAND_COPY_FAILURE_TITLE,
      description: error.message,
    });
  }, []);
  const branchRefsQuery = useEnvironmentQuery(
    detail === null
      ? null
      : vcsEnvironment.listRefs({
          environmentId,
          input: {
            cwd: detail.workspaceRoot,
            includeMatchingRemoteRefs: true,
            // listRefs keeps the current ref first and a known default second.
            limit: 2,
          },
        }),
  );
  const isStackedPullRequest =
    detail !== null &&
    isStackedPullRequestBase(detail.baseBranch, branchRefsQuery.data?.refs ?? []);
  // The host's own stack, where it keeps one. Only asked for once the detail has landed so a
  // pull request nobody can read costs one request rather than two.
  const stackReference = useMemo(
    () =>
      detail === null || detail.capabilities.stacks !== true || !supportsThreadPullRequests
        ? null
        : { ...reference, host: reference.host ?? parseChangeRequestUrl(detail.url)?.host },
    [detail, reference, supportsThreadPullRequests],
  );
  const nativeStackQuery = usePullRequestStack(environmentId, stackReference);
  const nativeStack = nativeStackQuery.data;
  const supportsStackActions =
    supportsThreadPullRequests &&
    detail?.capabilities.stacks === true &&
    detail.capabilities.stackActions === true &&
    environmentConfigs.get(environmentId)?.environment.capabilities.pullRequestStackActions ===
      true;
  const canMergeSinglePullRequest = allowsSinglePullRequestMerge({
    supportsStackActions,
    hasStack: nativeStack !== null,
    stackPending: !nativeStackQuery.isSuccess || nativeStackQuery.isPending,
    stackError: nativeStackQuery.error,
  });
  const activityPending = activityQuery.isPending && activity === null;
  const activityError = activity === null ? activityQuery.error : null;
  const refreshDetail = useCallback(() => {
    detailQuery.refresh();
    activityQuery.refresh();
    nativeStackQuery.refresh();
  }, [activityQuery.refresh, detailQuery.refresh, nativeStackQuery.refresh]);
  const [refreshToken, setRefreshToken] = useState(0);
  const codeRefreshToken = refreshToken + (turnRefresh ?? 0);
  const activityRevision = useRef<{ readonly key: string; readonly updatedAt: string } | null>(
    null,
  );
  useEffect(() => {
    if (!coreDetail) return;
    const next = { key: tabScopeKey, updatedAt: coreDetail.updatedAt };
    if (shouldRefreshPullRequestActivity(activityRevision.current, next)) {
      // Let an existing read settle before revalidating the new revision. Interrupting a
      // mutation's activity refresh can leave SWR displaying its previous value.
      if (activityQuery.isPending) return;
      activityQuery.refresh();
      setRefreshToken((token) => token + 1);
    }
    activityRevision.current = next;
  }, [activityQuery.isPending, activityQuery.refresh, coreDetail, tabScopeKey]);
  // Reuse activity and diff until core detail reports a changed revision. Keyed by
  // the pull request rather than by the panel, because this one panel shows a different pull
  // request every time it is opened.
  useLiveRefresh(
    () => {
      detailQuery.refresh();
    },
    { key: `pull-request:${environmentId}:${pullRequestKey}` },
  );
  // The button, on the other hand, goes around the server's cache rather than through it: it is
  // the answer for a reader who can see that what they are looking at is behind. The
  // invalidation goes first so the re-reads miss that cache; if it fails, the reads still run
  // and at worst answer from it.
  const invalidate = useAtomCommand(pullRequestEnvironment.invalidate, { reportFailure: false });
  const [isInvalidating, setIsInvalidating] = useState(false);
  // One word for "the host is being asked again", whichever of the two halves is in flight:
  // the invalidation round trip, then the detail read it kicks off.
  const refreshing = isInvalidating || detailQuery.isPending;
  const refreshFromHost = useCallback(async () => {
    setIsInvalidating(true);
    try {
      await invalidate({ environmentId, input: { reference } });
      refreshDetail();
      setRefreshToken((token) => token + 1);
    } finally {
      setIsInvalidating(false);
    }
  }, [environmentId, invalidate, reference, refreshDetail]);
  // A refresh asked for by the page: the detail, and through the token below, the diff with it.
  const appliedForcedToken = useRef(forcedRefreshToken);
  useEffect(() => {
    if (appliedForcedToken.current === forcedRefreshToken) return;
    appliedForcedToken.current = forcedRefreshToken;
    void refreshFromHost();
  }, [forcedRefreshToken, refreshFromHost]);
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const postComment = useAtomCommand(pullRequestEnvironment.comment, { reportFailure: false });
  // Which action is in flight, not merely that one is: every control here is disabled while any
  // of them runs, but only the button that was pressed may say what it is doing.
  const [pendingAction, setPendingAction] = useState<PullRequestAction | null>(null);
  const actionPending = pendingAction !== null;
  const update = useAtomCommand(pullRequestEnvironment.update, { reportFailure: false });
  // Scoped to the pull request it was typed against, since this one panel shows a different one
  // every time it is opened and a half-written title must not follow it there.
  const [titleScope, setTitleScope] = useState<{
    readonly pullRequestKey: string;
    readonly text: string;
  } | null>(null);
  const titleDraft = titleScope?.pullRequestKey === pullRequestKey ? titleScope.text : null;
  const [titleSaving, setTitleSaving] = useState(false);
  const newThread = useNewThreadHandler();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const unavailableGitHubUrl = useMemo(() => {
    const identity = projects.find(
      (project) => project.id === reference.projectId && project.environmentId === environmentId,
    )?.repositoryIdentity;
    return gitHubPullRequestBrowserUrl(identity, reference.repository, reference.number);
  }, [environmentId, projects, reference.number, reference.projectId, reference.repository]);
  // Project settings stored the override under the sidebar group's key, which a duplicate row
  // borrows from its siblings, so the project alone does not always name the same key.
  const legacyProjectDefaultMergeMethod = useMemo(() => {
    if (projectDefaultMergeMethod !== undefined) return undefined;
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === environmentId && candidate.id === reference.projectId,
    );
    if (!project) return undefined;
    const projectKey =
      buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
      }).get(derivePhysicalProjectKey(project)) ??
      deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings);
    return legacyMergeMethodOverrides[projectKey];
  }, [
    environmentId,
    legacyMergeMethodOverrides,
    primaryEnvironmentId,
    projectDefaultMergeMethod,
    projectGroupingSettings,
    projects,
    reference.projectId,
  ]);
  // Beside a thread there is nothing to pick: the hand-offs land in that thread's composer, and
  // the thread is already on one server's copy of the branch.
  const pickableEnvironments = useMemo(
    () =>
      context === "page"
        ? resolvePickableEnvironments(
            { environmentId, projectId: reference.projectId },
            projects,
            environments.map((environment) => ({
              environmentId: environment.environmentId,
              label: environment.label,
              machine: resolveEnvironmentMachineKind(environment.serverConfig),
            })),
          )
        : [],
    [context, environmentId, environments, projects, reference.projectId],
  );
  // Which server the reader chose, and only for the pull request they chose it on: this one panel
  // shows a different pull request every time it is opened, and the choice does not follow.
  const [actingScope, setActingScope] = useState<{
    readonly pullRequestKey: string;
    readonly environmentId: EnvironmentId;
  } | null>(null);
  const chosenEnvironmentId =
    actingScope?.pullRequestKey === pullRequestKey ? actingScope.environmentId : environmentId;
  // Null wherever there is no choice on offer — one server, or a chosen one that has since gone —
  // and then the panel's own server and its own checkout are the answer, as they always were.
  const acting =
    pickableEnvironments.find((entry) => entry.environmentId === chosenEnvironmentId) ?? null;
  const actingEnvironmentId = acting?.environmentId ?? environmentId;
  const checkoutRoot =
    acting?.workspaceRoot ?? detail?.workspaceRoot ?? project?.workspaceRoot ?? null;
  const prepareThread = usePreparePullRequestThreadAction({
    environmentId: actingEnvironmentId,
    cwd: checkoutRoot,
  });

  const finishAction = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    onActed?.(action, "sent");
    const result = await runAction({
      environmentId,
      input: {
        ...reference,
        action,
        ...(method ? { mergeMethod: method } : {}),
        ...(updateMethod ? { updateMethod } : {}),
      },
    });
    setPendingAction(null);
    const outcome = resolvePullRequestActionOutcome({
      action,
      updateMethod,
      failed: result._tag === "Failure",
      failure: result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
    });
    toastManager.add(outcome.toast);
    if (!outcome.succeeded) {
      onActed?.(action, "failed");
      return false;
    }
    if (outcome.refresh === "host") {
      void refreshFromHost();
    } else {
      refreshDetail();
    }
    onActed?.(action, "done");
    return true;
  };

  const perform = async (
    action: PullRequestAction,
    method?: PullRequestMergeMethod,
    updateMethod?: PullRequestUpdateMethod,
  ) => {
    if (pendingAction !== null) return false;
    setPendingAction(action);
    return finishAction(action, method, updateMethod);
  };

  const performCommentAction = async (body: string, action: "close" | "reopen") => {
    if (pendingAction !== null) return { commentPosted: false };
    setPendingAction(action);
    const commentResult = await postComment({
      environmentId,
      input: { ...reference, body },
    });
    if (commentResult._tag === "Failure") {
      setPendingAction(null);
      toastManager.add({ type: "error", title: PULL_REQUEST_COMMENT_POST_FAILURE_TITLE });
      return { commentPosted: false };
    }
    const actionSucceeded = await finishAction(action);
    // The comment is durable even if the state change was refused, so make it visible while the
    // shared action failure explains why the pull request stayed where it was.
    if (!actionSucceeded) refreshDetail();
    return { commentPosted: true };
  };

  const saveTitle = async (next: string) => {
    const decision = resolvePullRequestTitleSave({
      draft: next,
      currentTitle: detail?.title ?? null,
      saving: titleSaving,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "discard") {
      setTitleScope(null);
      return;
    }
    setTitleSaving(true);
    const result = await update({ environmentId, input: { ...reference, title: decision.title } });
    setTitleSaving(false);
    if (result._tag === "Failure") {
      // The draft stays open with the words still in it: retyping a title somebody has just
      // rewritten is the one thing a failed save must not cost them.
      toastManager.add(pullRequestTitleSaveFailureToast(squashAtomCommandFailure(result)));
      return;
    }
    setTitleScope(null);
    refreshDetail();
  };

  type ThreadTask = {
    prompt: string;
    reviewComments?: ReadonlyArray<ReviewCommentContext>;
  };

  const attachTarget = composerDraftTarget ?? null;
  const hasComposer = attachTarget !== null;

  const writeTaskToComposer = (target: ScopedThreadRef | DraftId, task: ThreadTask) => {
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

  /**
   * Opens a thread on this project and leaves the task in its composer for the reader to send.
   *
   * Nothing is checked out: asking a question is not a reason to move somebody's working tree or
   * to make a worktree they did not ask for. The two hand-offs that do need the code call this
   * after preparing it, so there is one path from "a task" to "a thread holding it".
   */
  const openThreadWithTask = async (
    projectRef: ReturnType<typeof scopeProjectRef>,
    task: ThreadTask | null,
    opened?: { draftId: DraftId },
  ): Promise<{ draftId: DraftId } | null> => {
    const session =
      opened ??
      (await newThread(projectRef).then(
        (result) => result,
        () => null,
      ));
    if (session === null) return null;
    if (task === null) return session;
    // The latest press is the ask: it takes over what an earlier hand-off left, prompt and chips
    // both, rather than stacking a second one under the first. What the reader typed themselves
    // survives — the composer they are handed is not always a fresh one, and a prompt they have
    // since edited is theirs rather than the hand-off's.
    writeTaskToComposer(session.draftId, task);
    return session;
  };

  /** A question about the change, which needs a thread and nothing else. */
  const startAsk = async (kind: string, task: ThreadTask) => {
    const route = resolvePullRequestAskRoute({
      hasDetail: detail !== null,
      handoff,
      hasComposer,
      promptLength: task.prompt.length,
    });
    if (route.kind === "ignore" || detail === null) return;
    if (route.kind === "composer" && attachTarget !== null) {
      writeTaskToComposer(attachTarget, task);
      toastManager.add(route.toast);
      return;
    }
    setHandoff(kind);
    const projectRef = scopeProjectRef(actingEnvironmentId, acting?.projectId ?? detail.projectId);
    const opened = await openThreadWithTask(projectRef, task);
    setHandoff(null);
    if (opened === null) {
      toastManager.add(PULL_REQUEST_THREAD_OPEN_FAILURE_TOAST);
      return;
    }
    // "Ask" leaves the composer empty on purpose, so saying the question is in it would send
    // the reader looking for something that is not there. The chips are what landed.
    toastManager.add(pullRequestAskedToast(task.prompt.length));
  };

  // Every handoff works the same way: check the pull request out into its own worktree, open a
  // thread there, and — when it carries a task — put that in the composer for the user to read
  // before sending. Checking out is the whole point of the ones that carry nothing.
  const startHandoff = async (
    kind: string,
    task: { prompt: string; reviewComments?: ReadonlyArray<ReviewCommentContext> } | null,
    // A worktree leaves whatever is open alone, which is why it is the default. Checking out in
    // the repository itself is what you want when the point is to run the thing where you
    // already work — and it moves the branch under everything else that is open there.
    mode: "worktree" | "local" = "worktree",
  ) => {
    const route = resolvePullRequestHandoffRoute({
      hasSummary: handoffSummary !== null,
      handoff,
      hasComposer,
      hasTask: task !== null,
      hasCheckoutRoot: checkoutRoot !== null,
    });
    if (route.kind === "ignore" || handoffSummary === null) return;
    if (route.kind === "composer" && attachTarget !== null && task !== null) {
      writeTaskToComposer(attachTarget, task);
      toastManager.add(route.toast);
      return;
    }
    setHandoff(kind);
    // The menu closes on the press and takes its "Preparing..." label with it, so this is the
    // only thing answering for the checkout. It carries no timeout of its own: a loading toast
    // never expires, and an explicit one would survive the update and pin the result on screen.
    const toastId = toastManager.add(PULL_REQUEST_CHECKOUT_TOASTS.preparing);
    // Wherever the reader chose to act: the thread, the checkout it is pointed at and the composer
    // the task lands in are all one server's, and picking another one moves all three.
    const projectRef = scopeProjectRef(
      actingEnvironmentId,
      acting?.projectId ?? handoffSummary.projectId,
    );
    // The thread is opened before the checkout rather than after it, because the project's setup
    // script only runs for a checkout that knows which thread it is for — and a worktree with no
    // dependencies installed is not something anyone can test.
    const opened = await newThread(projectRef).then(
      (session) => session,
      () => null,
    );
    if (opened === null) {
      setHandoff(null);
      // Without a thread there is nowhere for the checkout to belong: its setup script would not
      // run and its task would have no composer to land in. Better to stop before touching the
      // working tree than to prepare a worktree nobody asked for.
      toastManager.update(toastId, PULL_REQUEST_CHECKOUT_TOASTS.threadFailed);
      return;
    }
    const prepared = await prepareThread.run({
      reference: handoffSummary.url,
      mode,
      threadId: opened.threadId,
    });
    if (prepared._tag === "Failure") {
      setHandoff(null);
      // The server says what to do about it — that the branch is already checked out in the main
      // repository, say — and that sentence is the only way out of the failure.
      const detailMessage =
        prepareThread.error instanceof Error ? prepareThread.error.message : null;
      toastManager.update(toastId, pullRequestCheckoutFailureToast(detailMessage));
      return;
    }
    // The same thread again, now that there is somewhere to point it at. A local checkout has
    // no worktree of its own, so the thread runs where the repository already is.
    const pointed = await newThread(projectRef, {
      branch: prepared.value.branch,
      worktreePath: prepared.value.worktreePath,
      envMode: prepared.value.worktreePath === null ? "local" : "worktree",
    }).then(
      (session) => session !== null,
      () => false,
    );
    if (!pointed) {
      setHandoff(null);
      // The checkout is on disk; only the thread failed to move onto it. Writing the task now
      // would send the agent at whatever the thread was already open on — which is the one
      // outcome worth stopping for, since it reads as success and is not.
      toastManager.update(toastId, pullRequestCheckoutUnpointedToast(prepared.value.branch));
      return;
    }
    // Released here whatever happened next: a loading toast never expires on its own, so leaving
    // this set would spin forever and lock every handoff behind it until a reload.
    setHandoff(null);
    // A worktree that was already there and had been worked in keeps whatever it holds, so the
    // thread opens on older code than the pull request carries. Said once, in place of the
    // success, because everything else about the handoff did happen.
    if (task !== null) await openThreadWithTask(projectRef, task, opened);
    toastManager.update(
      toastId,
      pullRequestCheckoutResultToast({
        mode,
        isOnPullRequestHead: prepared.value.isOnPullRequestHead,
        hasTask: task !== null,
      }),
    );
  };

  const askAboutPullRequest = () => {
    if (!detail) return;
    void startAsk("ask", {
      ...buildAskAboutPullRequestHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
      }),
    });
  };

  const explainPullRequest = () => {
    if (!detail) return;
    void startAsk("explain", {
      ...buildExplainPullRequestHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
      }),
    });
  };

  const addSelectionToAgent = (selection: PullRequestAgentSelectionInput) => {
    if (!detail) return;
    void startAsk(
      `selection:${selection.comment.id}`,
      buildAddSelectionToAgentHandoff({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        state: detail.state,
        isDraft: detail.isDraft,
        comment: selection.comment,
        request: selection.request,
      }),
    );
  };

  const startCheckout = (mode: "worktree" | "local") => {
    if (!handoffSummary) return;
    void startHandoff(`checkout:${mode}`, null, mode);
  };

  /** One finding, handed over on its own — the surfaces that show findings call this. */
  const startFixFinding = (finding: PullRequestFinding) => {
    if (!detail) return;
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

  const startFixFindings = () => {
    if (!detail) return;
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
        checks: model.checks.stale ? [] : detail.checks,
        commentsTruncated: detail.commentsTruncated,
      }),
    );
  };

  const startResolveConflicts = () => {
    if (!handoffSummary) return;
    void startHandoff("conflicts", {
      prompt: buildResolveConflictsPrompt({
        number: handoffSummary.number,
        url: handoffSummary.url,
        headBranch: handoffSummary.headBranch,
        baseBranch: handoffSummary.baseBranch,
      }),
    });
  };

  const model = buildPullRequestDetailModel({
    referenceNumber: reference.number,
    detail,
    detailPending: detailQuery.isPending,
    detailError: detailQuery.error,
    handoffSummary,
    context,
    hasBack: onBack !== undefined,
    hasClose: onClose !== undefined,
    hasComposer,
    handoff,
    checkoutRootAvailable: checkoutRoot !== null,
    pendingAction,
    refreshing,
    canMergeSinglePullRequest,
    mergeMethod: {
      current:
        mergeMethodSelection?.pullRequestKey === pullRequestKey
          ? mergeMethodSelection.method
          : null,
      projectDefault: projectDefaultMergeMethod ?? legacyProjectDefaultMergeMethod,
      lastSelected: lastSelectedMergeMethod,
    },
    sharedChecksState: sharedSummary?.checksState,
    isStackedPullRequest,
    stack: {
      hasStack: nativeStack !== null,
      supportsActions: supportsStackActions,
      failed: nativeStackQuery.error !== null,
      fresh: nativeStackQuery.isFresh,
    },
    tab,
    timelineOrder,
    activityPending,
    activityError,
    titleDraft,
    titleSaving,
    checkoutCommand,
    shortcuts: {
      copyLink: shortcutLabelForCommand(keybindings, "thread.copyReference"),
      copyNumber: shortcutLabelForCommand(keybindings, "pullRequest.copyNumber"),
    },
    confirmation: confirmAction,
    pickableEnvironments,
    actingEnvironmentId,
    nowMs: Date.now(),
  });
  const visibleTabs = model.tabs.items;
  // The Code tab can be opened while the detail is still on its way, and the detail may then say
  // this host has no patch to show. The tab goes, so whoever was standing on it is moved back to
  // the summary rather than left looking at a panel that is no longer reachable.
  useEffect(() => {
    const fallback = resolvePullRequestDetailTabFallback(tab, visibleTabs);
    if (fallback !== null) setTab(fallback);
  }, [tab, visibleTabs]);
  const selectedMergeMethod = model.selectedMergeMethod;
  const checksState = model.checks.state;
  const checksStale = model.checks.stale;

  const checkoutControl = model.actions.checkout.visible ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              disabled={model.actions.checkout.disabled}
              render={
                <Button size="xs" variant="outline" aria-label={model.actions.checkout.ariaLabel}>
                  <GitBranchIcon aria-hidden className="size-3.5" />
                  <span className="@max-[35rem]/pr-header:hidden">
                    {model.actions.checkout.label}
                  </span>
                  <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup>{model.actions.checkout.tooltip}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom">
        {model.actions.checkout.options.map((option) => (
          <MenuItem key={option.mode} onClick={() => startCheckout(option.mode)}>
            {option.icon === "git-branch" ? (
              <GitBranchIcon className="mt-1 size-3.5 shrink-0 self-start" />
            ) : (
              <FolderGit2Icon className="mt-1 size-3.5 shrink-0 self-start" />
            )}
            <span className="flex min-w-0 flex-col">
              <span>{option.title}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </span>
          </MenuItem>
        ))}
        <ActOnEnvironmentPicker
          picker={model.actions.checkout.environments}
          onChange={(next) => setActingScope({ pullRequestKey, environmentId: next })}
        />
      </MenuPopup>
    </Menu>
  ) : null;

  const resolveConflictsControl = (
    <HeaderActionButton
      model={model.resolveConflicts}
      variant="destructive-outline"
      icon={<PullRequestGlyph.conflicting aria-hidden className="size-3.5" />}
      hideBelow="30rem"
      onClick={startResolveConflicts}
    />
  );

  // The list already has the pull request's identity and summary. Keep them on screen
  // and let the richer detail read replace the remaining placeholders in place.
  if (model.loading) {
    return (
      <PullRequestDetailGhost
        seed={matchingListEntry}
        summary={sharedSummary}
        checkoutCommand={checkoutCommand}
        onCheckoutError={onCheckoutCommandError}
        number={reference.number}
        tabs={visibleTabs}
        activeTab={tab}
        {...(onBack ? { onBack } : {})}
        {...(onClose ? { onClose } : {})}
        actions={
          model.ghostActions.visible ? (
            <TooltipProvider delay={150} closeDelay={150} timeout={400}>
              {checkoutControl}
              {model.ghostActions.resolveConflicts ? resolveConflictsControl : null}
            </TooltipProvider>
          ) : undefined
        }
      />
    );
  }

  const header = model.header;
  const menu = model.menu;
  const primary = model.actions.primary;
  const StateIcon = primary?.kind === "state" ? PullRequestGlyph[primary.state.icon] : null;

  const backButton = (condensedRow: boolean) =>
    model.chrome.back.visible && onBack ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              {...(condensedRow ? { tabIndex: condensed ? 0 : -1 } : {})}
              onClick={onBack}
              className="-ml-1.5"
              aria-label={model.chrome.back.ariaLabel}
            >
              <ArrowLeftIcon aria-hidden className="size-3.5" />
            </Button>
          }
        />
        <TooltipPopup side="top">{model.chrome.back.tooltip}</TooltipPopup>
      </Tooltip>
    ) : null;

  const numberLink = (condensedRow: boolean) =>
    detail && header ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              {...(condensedRow ? { tabIndex: condensed ? 0 : -1 } : {})}
              onClick={() => void readLocalApi()?.shell.openExternal(header.number.url)}
              onContextMenu={(event) => openNumberContextMenu(event, detail)}
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-medium underline-offset-2 hover:underline",
                header.state.toneClassName,
              )}
              aria-label={header.number.ariaLabel}
            >
              {header.number.label}
              <ExternalLinkIcon aria-hidden className="size-2.5" />
            </button>
          }
        />
        <TooltipPopup side="top">{header.number.tooltip}</TooltipPopup>
      </Tooltip>
    ) : null;

  const baseBranch = (iconClassName: string | undefined) =>
    header ? (
      header.freshness ? (
        <PullRequestBaseFreshnessWarning
          freshness={header.freshness}
          onUpdate={(method) => void perform("update-branch", undefined, method)}
          {...(iconClassName ? { iconClassName } : {})}
          className="max-w-[40%]"
        >
          {header.branches.stacked ? (
            <PullRequestGlyph.stack
              aria-label={header.branches.stackedAriaLabel}
              className="size-3 shrink-0"
            />
          ) : null}
          <code className="flex min-w-0">
            <MiddleTruncate value={header.branches.base} showTitle={false} />
          </code>
        </PullRequestBaseFreshnessWarning>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex min-w-0 max-w-[40%] shrink-0 items-center gap-1">
                {header.branches.stacked ? (
                  <PullRequestGlyph.stack
                    aria-label={header.branches.stackedAriaLabel}
                    className="size-3 shrink-0"
                  />
                ) : null}
                <code className="flex min-w-0">
                  <MiddleTruncate value={header.branches.base} showTitle={false} />
                </code>
              </span>
            }
          />
          <TooltipPopup side="top">{header.branches.baseTooltip}</TooltipPopup>
        </Tooltip>
      )
    ) : null;

  const lifecycle = menu?.lifecycle ?? null;
  const runLifecycle = () => {
    if (lifecycle === null) return;
    if (lifecycle.action === "reopen") void perform("reopen");
    else setConfirmation({ open: true, action: lifecycle.action });
  };
  const lifecycleContent =
    lifecycle === null ? null : (
      <>
        {lifecycle.icon === "closed" ? (
          <PullRequestGlyph.closed className="size-3.5" />
        ) : lifecycle.icon === "reopen" ? (
          <PullRequestGlyph.reopen className="size-3.5" />
        ) : (
          <RotateCcwIcon className="size-3.5" />
        )}
        {lifecycle.label}
      </>
    );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      {threadPickerOpen && detail ? (
        <PullRequestThreadLinks
          key={`${environmentId}:${detail.url}`}
          display="picker"
          environmentId={environmentId}
          reference={reference}
          url={detail.url}
          threadRef={null}
          onPickerOpenChange={setThreadPickerOpen}
        />
      ) : null}
      <div
        className={cn(
          "@container/pr-header grid min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2",
          model.chrome.bordered && "border-b border-border/60",
          !model.chrome.visible && "hidden",
        )}
      >
        <div className="pl-4 grid h-7 min-w-0 items-center overflow-hidden">
          <div
            aria-hidden={condensed}
            inert={condensed}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-[opacity,transform] ease-out motion-reduce:transform-none motion-reduce:transition-none sm:text-xs",
              condensed
                ? "pointer-events-none -translate-y-1 opacity-0 duration-100"
                : "translate-y-0 opacity-100 delay-50 duration-150",
            )}
          >
            {header ? (
              <>
                {backButton(false)}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      header.repository.url ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (header.repository.url) {
                              void readLocalApi()?.shell.openExternal(header.repository.url);
                            }
                          }}
                          className="min-w-0 cursor-pointer truncate text-left font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {header.repository.label}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate font-medium text-muted-foreground">
                          {header.repository.label}
                        </span>
                      )
                    }
                  />
                  <TooltipPopup side="top">{header.repository.tooltip}</TooltipPopup>
                </Tooltip>
                {numberLink(false)}
              </>
            ) : null}
          </div>
          <div
            aria-hidden={!condensed}
            inert={!condensed}
            className={cn(
              "col-start-1 row-start-1 flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-[opacity,transform] ease-out motion-reduce:transform-none motion-reduce:transition-none sm:text-xs",
              condensed
                ? "translate-y-0 opacity-100 delay-50 duration-150"
                : "pointer-events-none translate-y-1 opacity-0 duration-100",
            )}
          >
            {header ? (
              <>
                {backButton(true)}
                {numberLink(true)}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {header.title}
                      </span>
                    }
                  />
                  <TooltipPopup side="top">{header.title}</TooltipPopup>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        <div className="mr-4 flex h-7 shrink-0 items-center justify-end gap-1">
          {detail && menu ? (
            <TooltipProvider delay={150} closeDelay={150} timeout={400}>
              {model.actions.retryStack.visible ? (
                <Button variant="ghost" size="xs" onClick={nativeStackQuery.refresh}>
                  {model.actions.retryStack.label}
                </Button>
              ) : null}
              {nativeStack && model.actions.stackMenu.visible ? (
                <PullRequestStackMenu
                  stack={nativeStack}
                  notice={nativeStackQuery.notice}
                  onRetry={nativeStackQuery.error ? nativeStackQuery.refresh : undefined}
                  reference={reference}
                  environmentId={environmentId}
                  onSelect={onSelectPullRequest}
                  mergeMethod={model.actions.stackMenu.mergeMethod}
                  canMerge={model.actions.stackMenu.canMerge}
                  canRebase={model.actions.stackMenu.canRebase}
                  onActed={() => {
                    refreshDetail();
                    onActed?.();
                  }}
                />
              ) : null}
              {model.actions.threadLinksCountVisible ? (
                <PullRequestThreadLinks
                  display="count"
                  environmentId={environmentId}
                  reference={reference}
                  url={detail.url}
                  threadRef={null}
                />
              ) : null}
              {checkoutControl}
              {/* Said where the Merge button is, because it is the answer to why nobody has
                  pressed it: the merge is already asked for, and the host is holding it. */}
              {model.actions.armedBadge ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge
                        size="control"
                        variant="info"
                        role="img"
                        aria-label={model.actions.armedBadge.label}
                      >
                        <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                        <span className="@max-[30rem]/pr-header:hidden">
                          {model.actions.armedBadge.label}
                        </span>
                      </Badge>
                    }
                  />
                  <TooltipPopup side="top">{model.actions.armedBadge.tooltip}</TooltipPopup>
                </Tooltip>
              ) : null}
              {primary?.kind === "resolve" ? (
                resolveConflictsControl
              ) : primary?.kind === "ready" ? (
                <HeaderActionButton
                  model={primary.button}
                  variant="default"
                  icon={<PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />}
                  hideBelow="30rem"
                  onClick={() => void perform("ready")}
                />
              ) : primary?.kind === "enable-auto-merge" ? (
                <HeaderActionButton
                  model={primary.button}
                  variant="default"
                  icon={<PullRequestGlyph.merged aria-hidden className="size-3.5" />}
                  hideBelow="30rem"
                  onClick={() => setConfirmation({ open: true, action: "enable-auto-merge" })}
                />
              ) : primary?.kind === "auto-merge-armed" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge size="control" variant="info" role="img" aria-label={primary.label}>
                        <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                        <span className="@max-[30rem]/pr-header:hidden">{primary.label}</span>
                      </Badge>
                    }
                  />
                  <TooltipPopup side="top">{primary.tooltip}</TooltipPopup>
                </Tooltip>
              ) : primary?.kind === "merge" ? (
                <HeaderActionButton
                  model={primary.button}
                  variant="default"
                  icon={<PullRequestGlyph.merged aria-hidden className="size-3.5" />}
                  hideBelow="30rem"
                  onClick={() => setConfirmation({ open: true, action: "merge" })}
                />
              ) : primary?.kind === "state" && StateIcon ? (
                <Badge size="control" variant="outline">
                  <span className={cn("flex items-center gap-1", primary.state.toneClassName)}>
                    <StateIcon className="size-3.5" />
                    {primary.state.label}
                  </span>
                </Badge>
              ) : null}
              <Menu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <MenuTrigger
                        render={
                          <Button
                            aria-label={menu.trigger.ariaLabel}
                            size="icon-xs"
                            variant="ghost-muted"
                          />
                        }
                      >
                        {/* The refresh lives in this menu, so while one runs the trigger wears
                            the spinning glyph in place of the dots: the reader sees the panel
                            is fetching without a control appearing or the row shifting. */}
                        {menu.trigger.refreshing ? (
                          <RefreshIcon refreshing size="md" />
                        ) : (
                          <MoreHorizontalIcon className="size-4" />
                        )}
                      </MenuTrigger>
                    }
                  />
                  <TooltipPopup>{menu.trigger.ariaLabel}</TooltipPopup>
                </Tooltip>
                <MenuPopup align="end" side="bottom">
                  <PullRequestThreadLinks
                    display="menu-item"
                    environmentId={environmentId}
                    reference={reference}
                    url={detail.url}
                    threadRef={
                      threadRef ??
                      (typeof composerDraftTarget === "object" ? composerDraftTarget : null)
                    }
                    onPickerOpenChange={setThreadPickerOpen}
                  />
                  <MenuItem disabled={menu.refresh.disabled} onClick={() => void refreshFromHost()}>
                    <RefreshIcon size="sm" refreshing={menu.trigger.refreshing} />
                    {menu.refresh.label}
                  </MenuItem>
                  <MenuItem disabled={menu.ask.disabled} onClick={askAboutPullRequest}>
                    <MessageCircleQuestionIcon className="mt-1 size-3.5 shrink-0 self-start" />
                    <span className="flex min-w-0 flex-col">
                      <span>{menu.ask.label}</span>
                      <span className="text-xs text-muted-foreground">{menu.ask.description}</span>
                    </span>
                  </MenuItem>
                  <MenuItem disabled={menu.explain.disabled} onClick={explainPullRequest}>
                    <BookOpenIcon className="mt-1 size-3.5 shrink-0 self-start" />
                    <span className="flex min-w-0 flex-col">
                      <span>{menu.explain.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {menu.explain.description}
                      </span>
                    </span>
                  </MenuItem>
                  <MenuItem disabled={menu.fixFindings.disabled} onClick={startFixFindings}>
                    <HammerIcon className="size-3.5" />
                    {menu.fixFindings.label}
                  </MenuItem>
                  <ActOnEnvironmentPicker
                    picker={menu.environments}
                    onChange={(next) => setActingScope({ pullRequestKey, environmentId: next })}
                  />
                  <MenuSeparator />
                  {menu.actionGroup.visible ? (
                    <>
                      {/* Only where the button row could not take it: "Ready for review" on a
                          draft is the primary header button, so offering it here as well would
                          show the same action twice. */}
                      {menu.actionGroup.draftToggle.visible ? (
                        <MenuItem
                          disabled={menu.actionGroup.draftToggle.disabled}
                          onClick={() => void perform(menu.actionGroup.draftToggle.action)}
                        >
                          {menu.actionGroup.draftToggle.icon === "pullRequest" ? (
                            <PullRequestGlyph.pullRequest className="size-3.5" />
                          ) : (
                            <PullRequestGlyph.draft className="size-3.5" />
                          )}
                          {menu.actionGroup.draftToggle.label}
                        </MenuItem>
                      ) : null}
                      {menu.actionGroup.mergeNow.visible ? (
                        <MenuItem
                          disabled={menu.actionGroup.mergeNow.disabled}
                          onClick={() => setConfirmation({ open: true, action: "merge" })}
                        >
                          <PullRequestGlyph.merged className="size-3.5" />
                          {menu.actionGroup.mergeNow.label}
                        </MenuItem>
                      ) : null}
                      {/* The same merge, left with the host to carry out once its requirements
                          pass. A conflicting branch cannot be armed because nothing the host
                          waits for will clear the conflict. */}
                      {menu.actionGroup.autoMerge.visible ? (
                        <MenuItem
                          disabled={menu.actionGroup.autoMerge.disabled}
                          onClick={() => {
                            if (menu.actionGroup.autoMerge.action === "disable-auto-merge") {
                              void perform("disable-auto-merge");
                            } else {
                              setConfirmation({ open: true, action: "enable-auto-merge" });
                            }
                          }}
                        >
                          <PullRequestGlyph.merged className="size-3.5" />
                          {menu.actionGroup.autoMerge.label}
                        </MenuItem>
                      ) : null}
                      {/* A preference for the merge action rather than a second action, so it
                          is a radio group here instead of a chevron welded to the Merge pill.
                          Hidden while conflicting: every method would fail. */}
                      {/* Only where merging is on offer at all: a strategy to merge with is not
                          a choice for someone who may not merge. */}
                      {menu.actionGroup.mergeMethods.visible ? (
                        <>
                          {/* Only below the draft control. A host with no draft of its own, or
                              a draft whose control is already the header button, would leave
                              this against the separator that opened the group. */}
                          {menu.actionGroup.mergeMethods.separatorBefore ? <MenuSeparator /> : null}
                          <MenuRadioGroup
                            value={menu.actionGroup.mergeMethods.value}
                            onValueChange={(method) => {
                              const selected = menu.actionGroup.mergeMethods.options.find(
                                (option) => option.method === method,
                              );
                              if (!selected) return;
                              setMergeMethod(selected.method);
                              setLastSelectedMergeMethod(selected.method);
                            }}
                          >
                            {menu.actionGroup.mergeMethods.options.map((option) => (
                              <MenuRadioItem
                                key={option.method}
                                value={option.method}
                                disabled={menu.actionGroup.mergeMethods.disabled}
                                closeOnClick
                              >
                                {/* The radio item lays its children out as one block, so the
                                    icon and the label need their own row to share a line. */}
                                <span className="flex min-w-0 items-center gap-2">
                                  <PullRequestGlyph.merged className="size-3.5" />
                                  <span>{option.label}</span>
                                </span>
                              </MenuRadioItem>
                            ))}
                          </MenuRadioGroup>
                        </>
                      ) : null}
                      {menu.actionGroup.separatorAfter ? <MenuSeparator /> : null}
                    </>
                  ) : null}
                  <MenuItem
                    onClick={() => void readLocalApi()?.shell.openExternal(menu.openOnHost.url)}
                  >
                    <ArrowUpRightIcon className="size-3.5" />
                    {menu.openOnHost.label}
                  </MenuItem>
                  <MenuItem onClick={() => copyReference(menu.copyLink.value, "PR link")}>
                    <LinkIcon className="size-3.5" />
                    {menu.copyLink.label}
                    <MenuShortcut>{menu.copyLink.shortcut}</MenuShortcut>
                  </MenuItem>
                  <MenuItem onClick={() => copyReference(menu.copyNumber.value, "PR number")}>
                    <CopyIcon className="size-3.5" />
                    {menu.copyNumber.label}
                    <MenuShortcut>{menu.copyNumber.shortcut}</MenuShortcut>
                  </MenuItem>
                  {lifecycle ? (
                    <>
                      <MenuSeparator />
                      {lifecycle.destructive ? (
                        <MenuItem
                          variant="destructive"
                          disabled={lifecycle.disabled}
                          onClick={runLifecycle}
                        >
                          {lifecycleContent}
                        </MenuItem>
                      ) : (
                        <MenuItem disabled={lifecycle.disabled} onClick={runLifecycle}>
                          {lifecycleContent}
                        </MenuItem>
                      )}
                    </>
                  ) : null}
                </MenuPopup>
              </Menu>
            </TooltipProvider>
          ) : null}
          {model.chrome.close.visible && onClose ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={model.chrome.close.ariaLabel}
              onClick={onClose}
            >
              <PanelRightIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            condensed
              ? "grid-rows-[1fr]"
              : "grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={condensedRowRef}
            className={cn(
              "min-h-0 overflow-hidden transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
              condensed
                ? "translate-y-0 opacity-100 delay-50"
                : "translate-y-1 opacity-0 duration-100",
            )}
            inert={!condensed}
          >
            {detail && header ? (
              <div className="col-span-2 min-w-0 px-4 pb-2 pt-1">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex min-w-0 shrink items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
                    <PullRequestActorLabel
                      actor={detail.author}
                      profileUrl={header.authorProfileUrl}
                      variant="avatar"
                      className="shrink-0"
                    />
                    <span className="shrink-0">{header.updatedRelative}</span>
                  </span>
                  <span aria-hidden className="h-3 w-px shrink-0 bg-border/70" />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-2xs text-muted-foreground/65">
                    {/* An out-of-date base wears the warning on the branch name itself, so the
                        name is amber and pointing at either the name or the mark opens the way
                        out. Up to date, the name keeps its plain tooltip. */}
                    {baseBranch("size-3")}
                    <ArrowLeftIcon
                      aria-label={header.branches.arrowAriaLabel}
                      className="size-3 shrink-0 opacity-60"
                    />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <code className="flex min-w-0 flex-1">
                            <MiddleTruncate value={header.branches.head} showTitle={false} />
                          </code>
                        }
                      />
                      <TooltipPopup side="top">{header.branches.head}</TooltipPopup>
                    </Tooltip>
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center justify-end gap-2 text-2xs">
                    <span
                      className="inline-flex items-center gap-1 tabular-nums"
                      aria-label={header.changedFiles.ariaLabel}
                    >
                      <FileDiffIcon aria-hidden className="size-3" />
                      {header.changedFiles.count}
                    </span>
                    <PullRequestDiffStat
                      additions={header.additions}
                      deletions={header.deletions}
                      className="shrink-0 font-mono text-2xs"
                    />
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            "col-span-2 grid",
            // Collapse before the scroll refund paints; only reopening eases back in. Animating
            // both directions makes the shrinking track fight the scrollTop correction.
            condensed
              ? "grid-rows-[0fr]"
              : "grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <div
            ref={foldRef}
            className={cn(
              "min-h-0 overflow-hidden transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
              condensed
                ? "-translate-y-1 opacity-0 duration-100"
                : "translate-y-0 opacity-100 delay-50",
            )}
            inert={condensed}
          >
            {detail && header ? (
              <div className="col-span-2 mt-1 min-w-0 px-4 pb-4">
                {!header.titleEditor.editing ? (
                  <div className="group flex min-h-7 min-w-0 items-center gap-1 sm:min-h-6">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <h1 className="min-w-0 flex-1 truncate text-base font-semibold leading-snug">
                            {header.title}
                          </h1>
                        }
                      />
                      <TooltipPopup side="top">{header.title}</TooltipPopup>
                    </Tooltip>
                    {header.titleEditor.canEdit ? (
                      <PullRequestEditButton
                        aria-label={header.titleEditor.editAriaLabel}
                        onClick={() => setTitleScope({ pullRequestKey, text: detail.title })}
                      />
                    ) : null}
                  </div>
                ) : (
                  // A title is one line of text, not markdown, so it takes an input rather than
                  // the editor the description and the remarks share.
                  <div className="space-y-2">
                    <Input
                      autoFocus
                      size="sm"
                      disabled={header.titleEditor.inputDisabled}
                      value={header.titleEditor.draft}
                      aria-label={header.titleEditor.inputAriaLabel}
                      onChange={(event) =>
                        setTitleScope({ pullRequestKey, text: event.target.value })
                      }
                      onKeyDown={(event) => {
                        const key = resolvePullRequestTitleKey(event.key);
                        if (key === "save") {
                          event.preventDefault();
                          void saveTitle(header.titleEditor.draft);
                        } else if (key === "cancel") {
                          event.preventDefault();
                          setTitleScope(null);
                        }
                      }}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={header.titleEditor.cancelDisabled}
                        onClick={() => setTitleScope(null)}
                      >
                        {header.titleEditor.cancelLabel}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={header.titleEditor.saveDisabled}
                        onClick={() => void saveTitle(header.titleEditor.draft)}
                      >
                        {header.titleEditor.saveLabel}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mt-2 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <PullRequestMetaLine className="min-w-0 whitespace-nowrap">
                    <PullRequestActorLabel
                      actor={detail.author}
                      profileUrl={header.authorProfileUrl}
                    />
                    <span>{header.updatedLabel}</span>
                  </PullRequestMetaLine>
                  {header.checkoutCommand ? (
                    <PullRequestCopyableCode
                      key={header.checkoutCommand}
                      value={header.checkoutCommand}
                      target="pull request checkout command"
                      copyLabel="Copy checkout command"
                      copiedLabel="Checkout command copied"
                      className="ml-auto font-mono"
                      tooltipSide="bottom"
                      onError={onCheckoutCommandError}
                    />
                  ) : null}
                </div>

                <div className="mt-4 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs text-muted-foreground/70">
                    {/* An out-of-date base wears the warning on the branch name itself, so the
                        name is amber and pointing at either the name or the mark opens the way
                        out. Up to date, the name keeps its plain tooltip. */}
                    {baseBranch(undefined)}
                    <ArrowLeftIcon
                      aria-label={header.branches.arrowAriaLabel}
                      className="size-3.5 shrink-0 opacity-60"
                    />
                    <PullRequestCopyableCode
                      key={header.branches.head}
                      value={header.branches.head}
                      target="branch name"
                      copyLabel={header.branches.headCopyLabel}
                      copiedLabel={header.branches.headCopiedLabel}
                    />
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center justify-end gap-2">
                    <span className="inline-flex min-w-16 items-center justify-end gap-1.5 tabular-nums">
                      <FileDiffIcon className="size-3.5" />
                      {header.changedFiles.label}
                    </span>
                    <PullRequestDiffStat
                      additions={header.additions}
                      deletions={header.deletions}
                      className="shrink-0 font-mono text-xs"
                    />
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {detail && model.nav ? (
          <nav
            className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2"
            aria-label="Pull request tabs"
          >
            <ToggleGroup
              className="shrink-0"
              size="segmented"
              variant="segmented"
              value={[tab]}
              onValueChange={(next) => {
                const nextTab = resolvePullRequestDetailTabChange(next[0], visibleTabs);
                if (nextTab) setTab(nextTab);
              }}
            >
              {visibleTabs.map((item) => (
                <Toggle
                  key={item.value}
                  value={item.value}
                  onPointerEnter={item.value === "code" ? () => void loadCodeTab() : undefined}
                  onFocus={item.value === "code" ? () => void loadCodeTab() : undefined}
                >
                  {item.label}
                </Toggle>
              ))}
            </ToggleGroup>
            {model.nav.kind === "summary" ? (
              <span
                className={cn(
                  "ml-auto flex items-center justify-end",
                  model.nav.approveWorkflows ? "shrink-0" : "min-w-0 flex-1",
                )}
              >
                {model.nav.approveWorkflows ? (
                  <HeaderActionButton
                    model={model.nav.approveWorkflows}
                    variant="warning-outline"
                    icon={<PlayIcon aria-hidden className="size-3.5" />}
                    hideBelow={null}
                    onClick={() => setConfirmation({ open: true, action: "approve-workflows" })}
                  />
                ) : (
                  <span
                    className="flex h-4 min-w-0 flex-wrap content-start items-center justify-end gap-x-1.5 overflow-hidden text-xs text-muted-foreground"
                    aria-label={model.nav.checks.ariaLabel}
                  >
                    {checksState !== null ? (
                      <PullRequestChecksPopover
                        checks={detail.checks}
                        stale={checksStale}
                        checksState={checksState}
                        threadRef={threadRef}
                      />
                    ) : (
                      <CircleDotIcon aria-hidden className="size-3.5" />
                    )}
                    <span className="whitespace-nowrap">{model.nav.checks.summary}</span>
                  </span>
                )}
              </span>
            ) : model.nav.kind === "timeline" ? (
              <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <PullRequestMetaLine
                  className={cn(
                    "whitespace-nowrap text-2xs transition-opacity",
                    model.nav.dimmed && "opacity-35",
                  )}
                >
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={model.nav.comments.ariaLabel}
                  >
                    <MessageSquareIcon aria-hidden className="size-3" />
                    {model.nav.comments.label}
                  </span>
                  <span
                    className="inline-flex items-center gap-1"
                    aria-label={model.nav.commits.ariaLabel}
                  >
                    <GitCommitHorizontalIcon aria-hidden className="size-3" />
                    {model.nav.commits.label}
                  </span>
                  {model.nav.approvals ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        model.nav.approvals.toneClassName,
                      )}
                    >
                      <PullRequestReviewOutcomeIcon outcome="approved" className="size-3" />
                      {model.nav.approvals.label}
                      <span className="sr-only">{model.nav.approvals.srLabel}</span>
                    </span>
                  ) : null}
                </PullRequestMetaLine>
                <Button
                  size="xs"
                  variant="ghost-muted"
                  aria-label={model.nav.order.ariaLabel}
                  onClick={() =>
                    setTimelineOrder((value) => (value === "newest" ? "oldest" : "newest"))
                  }
                >
                  <ArrowDownUpIcon aria-hidden className="size-3" />
                  {model.nav.order.label}
                </Button>
              </div>
            ) : null}
          </nav>
        ) : null}
      </div>

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        onScrollCapture={(event) => {
          const scroller = event.target;
          if (!(scroller instanceof HTMLElement)) return;
          scrollerRef.current = scroller;
          const top = scroller.scrollTop;
          setChromeCondensed((previous) => {
            const next = resolvePullRequestChromeCondensed({
              previous,
              scrollTop: top,
              foldHeight: foldRef.current?.scrollHeight ?? 0,
              condensedRowHeight: condensedRowRef.current?.scrollHeight ?? 0,
            });
            if (next.compensation !== null) compensationRef.current = next.compensation;
            chromeStateByTab.current[tab] = next.condensed;
            return next.condensed;
          });
        }}
      >
        {model.body.kind === "unavailable" ? (
          <PullRequestsUnavailableState
            error={model.body.error}
            refreshing={detailQuery.isPending}
            onRetry={refreshDetail}
            {...(unavailableGitHubUrl ? { gitHubUrl: unavailableGitHubUrl } : {})}
          />
        ) : detail && model.body.kind === "detail" ? (
          <PullRequestMarkdownContext value={markdownContext}>
            {mountedTabs.has("summary") ? (
              <div className={cn("absolute inset-0", tab !== "summary" && "invisible")}>
                <PullRequestSummaryTab
                  environmentId={environmentId}
                  threadRef={threadRef}
                  reference={reference}
                  detail={detail}
                  activityPending={activityPending}
                  checksStale={checksStale}
                  activityError={activityError}
                  pendingFinding={handoff}
                  fixFindingLabel={model.handoffLabels.fixFinding}
                  fixCheckLabel={model.handoffLabels.fixCheck}
                  onFixFinding={startFixFinding}
                  onRefresh={refreshDetail}
                  onRefreshChecks={refreshFromHost}
                />
              </div>
            ) : null}
            {mountedTabs.has("timeline") ? (
              <div className={cn("absolute inset-0", tab !== "timeline" && "invisible")}>
                {model.body.timeline === "loading" ? (
                  <PullRequestTimelineGhost />
                ) : model.body.timeline === "error" && activityError ? (
                  <PullRequestActivityUnavailableState
                    error={activityError}
                    onRetry={activityQuery.refresh}
                  />
                ) : (
                  <PullRequestTimelineTab
                    detail={detail}
                    environmentId={environmentId}
                    threadRef={threadRef}
                    reference={reference}
                    order={timelineOrder}
                    onOpenCommit={openCommit}
                    onRefresh={refreshDetail}
                  />
                )}
              </div>
            ) : null}
            {mountedTabs.has("code") ? (
              <div className={cn("absolute inset-0", tab !== "code" && "invisible")}>
                <Suspense fallback={<DiffPanelLoadingState label="Loading pull request diff..." />}>
                  <PullRequestCodeTab
                    onAddToAgentSelection={addSelectionToAgent}
                    environmentId={environmentId}
                    reference={reference}
                    detail={detail}
                    selectedCommitOid={selectedCodeCommitOid}
                    onSelectedCommitChange={selectCodeCommit}
                    pendingFinding={handoff}
                    fixFindingLabel={model.handoffLabels.fixFinding}
                    onFixFinding={startFixFinding}
                    onRefresh={refreshDetail}
                    refreshToken={codeRefreshToken}
                  />
                </Suspense>
              </div>
            ) : null}
          </PullRequestMarkdownContext>
        ) : null}
      </div>

      {/* Float over the content; do not reserve a footer or padding in the PR tabs. */}
      {detail && model.composerVisible ? (
        <div className="absolute right-4 bottom-3 z-20">
          <PullRequestComposer
            key={JSON.stringify([
              environmentId,
              reference.projectId,
              reference.host,
              reference.repository,
              reference.number,
            ])}
            environmentId={environmentId}
            reference={reference}
            detail={detail}
            actionPending={actionPending}
            onCommentAction={performCommentAction}
            onCommented={refreshDetail}
            onReviewSubmitted={refreshDetail}
          />
        </div>
      ) : null}

      <AlertDialog
        open={confirmation.open}
        onOpenChange={(open) => setConfirmation((current) => ({ ...current, open }))}
        onOpenChangeComplete={(open) => {
          if (!open) setConfirmation({ open: false, action: "merge" });
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{model.confirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{model.confirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {model.confirmation.cancelLabel}
            </AlertDialogClose>
            <Button
              size="sm"
              variant={model.confirmation.destructive ? "destructive" : "default"}
              disabled={model.confirmation.confirmDisabled}
              onClick={() => {
                const request = resolvePullRequestConfirmedAction(
                  confirmAction,
                  selectedMergeMethod,
                );
                setConfirmation((current) => ({ ...current, open: false }));
                void perform(request.action, request.mergeMethod);
              }}
            >
              {model.confirmation.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
