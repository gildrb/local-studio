import {
  EnvironmentId,
  ProjectId,
  pullRequestHostOf,
  resolveEnvironmentMachineKind,
  SourceControlProviderKind,
  type PullRequestAction,
  type PullRequestInvolvement,
  type PullRequestListFilters,
  type PullRequestListInput,
  type PullRequestListResult,
  type PullRequestListStatsInput,
  type PullRequestListStatsResult,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { gitHubPullRequestBrowserUrl } from "@t3tools/shared/changeRequestUrl";
import { buildPanelLayoutControlsModel } from "@t3tools/web/src/components/chat/PanelLayoutControls.logic.ts";
import {
  readPullRequestDetailSnapshot,
  resolveDisplayedPullRequestDetail,
  resolvePullRequestReferenceHost,
} from "@t3tools/web/src/components/pullRequest/pullRequestDetail.logic.ts";
import {
  applyPullRequestOverrides,
  collectPullRequestListFacets,
  filterPullRequestsByInvolvement,
  findScopedProject,
  groupPullRequestsByInvolvement,
  matchesPullRequestFilters,
  matchesPullRequestQuery,
  mergePullRequestDiffStats,
  mergePullRequestLists,
  narrowPullRequestsToFilters,
  parsePullRequestQuery,
  partitionPullRequestsWithPriority,
  pullRequestDiffStatKey,
  pullRequestEntryKey,
  pullRequestEntryViewer,
  pullRequestEnvironmentSetKey,
  pullRequestOverrideAfterAction,
  pullRequestStatsRefreshBatches,
  pullRequestStatsRequestBatches,
  rankPullRequestMatches,
  readPullRequestListSnapshot,
  resolveProjectScope,
  resolveQueryEnvironmentIds,
  resolveSelectedEnvironmentId,
  retainVisiblePullRequestStatsBatches,
  reusePullRequestEntries,
  settlePullRequestOverrides,
  sortPullRequestGroups,
  withDiffStat,
  writePullRequestListSnapshot,
  type EnvironmentPullRequestEntry,
  type EnvironmentPullRequestStat,
  type MergedPullRequestList,
  type PullRequestDiffStats,
  type PullRequestGroup,
  type PullRequestListOverride,
  type PullRequestPartitionsSnapshot,
  type PullRequestStatsBatch,
  type PullRequestStatsScope,
} from "@t3tools/web/src/components/pullRequest/pullRequestList.logic.ts";
import {
  readPullRequestListPreferences,
  writePullRequestListPreferences,
  type PullRequestListPreferencePatch,
} from "@t3tools/web/src/components/pullRequest/pullRequestListPreferences.ts";
import { assignProjectsToEnvironments } from "@t3tools/web/src/components/pullRequest/pullRequestProjectAssignment.logic.ts";
import { pullRequestFilterProjects } from "@t3tools/web/src/components/pullRequest/pullRequestProjectFilter.logic.ts";
import { buildPullRequestActorModel } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import { buildPullRequestStackPopoverModel } from "@t3tools/web/src/components/pullRequest/PullRequestStackMenu.logic.ts";
import {
  PULL_REQUEST_INVOLVEMENT_OPTIONS,
  PULL_REQUEST_SORT_OPTIONS,
  PULL_REQUEST_STATE_OPTIONS,
  PULL_REQUESTS_CLEARED_SELECTION,
  PULL_REQUESTS_PAGE_SIZE,
  PULL_REQUESTS_SEARCH_DEBOUNCE_MS,
  applyPullRequestListFiltersPatch,
  buildPullRequestsPageModel,
  buildPullRequestsSearch,
  initialPullRequestsPagination,
  pullRequestFiltersSearchPatch,
  pullRequestMenuFilters,
  pullRequestProjectKey,
  resolvePullRequestAuthorSelection,
  resolvePullRequestFilterGroupChange,
  resolvePullRequestHostFilter,
  resolvePullRequestLabelFilterChange,
  resolvePullRequestLabelToggle,
  resolvePullRequestListScopeChange,
  resolvePullRequestProjectSelection,
  resolvePullRequestRowSelection,
  resolvePullRequestServerFilter,
  resolvePullRequestsFindShortcut,
  resolvePullRequestsListRefresh,
  resolvePullRequestsLoadMore,
  resolvePullRequestsStatsPolicy,
  type PullRequestExpectedHost,
  type PullRequestRowTarget,
  type PullRequestsPagination,
  type PullRequestsSearch,
  type PullRequestsSearchPatch,
} from "@t3tools/web/src/components/pullRequest/PullRequestsPage.logic.ts";
import { resolveShortcutCommand, shortcutLabelForCommand } from "@t3tools/web/src/keybindings.ts";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  selectThreadRightPanelState,
  pullRequestSurfaceId,
  useRightPanelStore,
  type PullRequestSurface,
} from "@t3tools/web/src/rightPanelStore.ts";
import { createMergedEnvironmentQueryAtoms } from "@t3tools/web/src/state/mergedEnvironmentQuery.ts";
import {
  observePullRequestSummary,
  pullRequestListEntryToSummary,
} from "@t3tools/web/src/state/pullRequestSummaries.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import { createAllEnvironmentShellsBootstrappedAtom } from "@t3tools/web/src/state/shellBootstrap.logic.ts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { addProjectService } from "../addProject.ts";
import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import { CHAT_PAGE } from "../page.ts";
import { corePullRequestQueries } from "../pullRequests.ts";
import {
  createEffectRunner,
  createLiveRefresh,
  pullRequestListEntryId,
  pullRequestPageBridge,
  readQuery,
  type PullRequestActedPhase,
  type PullRequestTabStatusSeeds,
  type QueryRead,
} from "../pullRequestShared.ts";
import { rightPanelStoreAtom } from "../rightPanelState.ts";
import { projectIconView } from "../sidebarView.ts";
import type { PullRequestsPageView } from "../views/pullRequests.ts";
import type { ProjectIconView } from "../views/sidebar.ts";
import { pullRequestPopoverService } from "./pullRequestPopover.ts";

const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const KeysParams = Schema.decodeUnknownSync(Schema.Struct({ keys: Schema.Array(Schema.String) }));
const LabelToggleParams = Schema.decodeUnknownSync(
  Schema.Struct({ name: Schema.String, checked: Schema.Boolean }),
);
const FilterGroupParams = Schema.decodeUnknownSync(
  Schema.Struct({ group: Schema.Literals(["draft", "review", "checks"]), value: Schema.String }),
);
const RowContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, x: Schema.Number, y: Schema.Number }),
);
const KeyDownParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    shiftKey: Schema.Boolean,
    altKey: Schema.Boolean,
    repeat: Schema.Boolean,
    condensed: Schema.Boolean,
  }),
);

const isProviderKind = Schema.is(SourceControlProviderKind);

type Loaded = {
  readonly environmentKey: string;
  readonly scope: string;
  readonly query: string;
  readonly data: MergedPullRequestList;
  readonly partitions?: PullRequestPartitionsSnapshot | undefined;
};

type Ordered = {
  readonly key: string;
  readonly entries: ReadonlyArray<EnvironmentPullRequestEntry>;
};

type StatsTargetState = {
  readonly key: string;
  readonly batches: ReadonlyArray<PullRequestStatsBatch>;
};

type PageState = {
  readonly search: PullRequestsSearch | null;
  readonly sentQuery: string | null;
  readonly filtersOpen: boolean;
  readonly authorQuery: string;
  readonly page: PullRequestsPagination | null;
  readonly invalidating: boolean;
  readonly loaded: Loaded | null;
  readonly ordered: Ordered | null;
  readonly overrides: ReadonlyMap<string, PullRequestListOverride>;
  readonly hosts: PullRequestListResult["providers"];
  readonly statsByRow: PullRequestDiffStats;
  readonly statsTarget: StatsTargetState | null;
  readonly searchRevision: number;
  readonly searchFocus: PullRequestsPageView["searchFocus"];
};

const INITIAL_STATE: PageState = {
  search: null,
  sentQuery: null,
  filtersOpen: false,
  authorQuery: "",
  page: null,
  invalidating: false,
  loaded: null,
  ordered: null,
  overrides: new Map(),
  hosts: [],
  statsByRow: new Map(),
  statsTarget: null,
  searchRevision: 0,
  searchFocus: null,
};

type ListQuery = {
  readonly data: MergedPullRequestList | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly observations: ReadonlyArray<readonly [EnvironmentId, PullRequestListResult, number]>;
};

type ListTarget = { readonly environmentId: EnvironmentId; readonly input: PullRequestListInput };

type Frame = {
  readonly view: PullRequestsPageView;
  readonly search: PullRequestsSearch;
  readonly sentQuery: string;
  readonly typedQuery: string;
  readonly filterKey: string;
  readonly scopeKey: string;
  readonly environmentKey: string;
  readonly statsPolicy: PullRequestStatsScope["policy"];
  readonly pageSize: number;
  readonly sentCursors: PullRequestsPagination["cursors"];
  readonly sentParsedText: string;
  readonly pullRequestsSupported: boolean;
  readonly queryEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly listTargets: ReadonlyArray<ListTarget>;
  readonly relatedTargets: ReadonlyArray<ListTarget>;
  readonly listQuery: ListQuery;
  readonly baselineQuery: ListQuery;
  readonly authoredQuery: ListQuery;
  readonly reviewingQuery: ListQuery;
  readonly facetQuery: ListQuery;
  readonly partitionsWanted: boolean;
  readonly answered: MergedPullRequestList | null;
  readonly canContinue: boolean;
  readonly nextCursors: MergedPullRequestList["nextCursors"];
  readonly regrown: ReadonlyArray<string>;
  readonly orderedCount: number;
  readonly turnRefreshToken: string;
  readonly linkedSelection: {
    readonly environmentId: EnvironmentId;
    readonly repository: string;
    readonly number: number;
    readonly projectId: ProjectId;
    readonly host?: string;
  } | null;
  readonly rightPanelRef: ScopedThreadRef | null;
  readonly rightPanelOpen: boolean;
  readonly selectedPullRequestSurface: PullRequestSurface | null;
  readonly activePullRequestSurface: PullRequestSurface | null;
  readonly groups: ReadonlyArray<PullRequestGroup<EnvironmentPullRequestEntry>>;
  readonly entriesByStatsKey: ReadonlyMap<string, EnvironmentPullRequestEntry>;
  readonly statsQueryPending: boolean;
  readonly stats: ReadonlyArray<EnvironmentPullRequestStat> | null;
  readonly heldBySurface: ReadonlyMap<string, EnvironmentPullRequestEntry>;
  readonly listedBySurface: ReadonlyMap<string, EnvironmentPullRequestEntry>;
  readonly rowsByKey: ReadonlyMap<string, EnvironmentPullRequestEntry>;
  readonly tabStatusSeeds: PullRequestTabStatusSeeds;
  readonly tabStatusSeedsKey: string;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly scopedProjects: ReadonlyArray<EnvironmentProject>;
  readonly scopedProjectId: ProjectId | undefined;
  readonly capableEnvironmentIds: ReadonlyArray<EnvironmentId>;
};

export function createPullRequestsPageFeature(context: FeatureContext): CoreFeature {
  const { registry, state, storage } = context;
  const bridge = pullRequestPageBridge(context);
  const popovers = pullRequestPopoverService(context);
  const listQueries = corePullRequestQueries(state).listQuery;
  const statsQueries = createMergedEnvironmentQueryAtoms<
    PullRequestListStatsInput,
    PullRequestListStatsResult
  >("gpui-pull-requests:list-stats", (target) => state.pullRequestEnvironment.listStats(target));
  const turnQueries = createMergedEnvironmentQueryAtoms<Readonly<Record<string, never>>, number>(
    "gpui-pull-requests:turn-refreshes",
    ({ environmentId }) => state.pullRequestEnvironment.refreshes({ environmentId, input: {} }),
  );
  const stateAtom = Atom.make<PageState>(INITIAL_STATE).pipe(Atom.keepAlive);
  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(state.primaryServerConfigAtom)?.keybindings ?? []),
  );
  const environmentsAtom = Atom.make((get) =>
    [...get(state.environmentPresentations.presentationsAtom).entries()].map(([id, presentation]) =>
      projectEnvironmentPresentation(id, presentation),
    ),
  );
  const bootstrappedAtom = createAllEnvironmentShellsBootstrappedAtom({
    catalogAtom: state.environmentCatalog.catalogAtom,
    connectionStateAtom: state.environmentCatalog.stateAtom,
    shellStateValueAtom: state.environmentShell.stateValueAtom,
  });

  const mergedCache = new WeakMap<object, MergedPullRequestList | null>();
  const readList = (get: QueryRead, targets: ReadonlyArray<ListTarget>): ListQuery => {
    const view = get(listQueries.atom(targets));
    let data = mergedCache.get(view.values);
    if (data === undefined) {
      data = mergePullRequestLists(view.values);
      mergedCache.set(view.values, data);
    }
    return { data, error: view.error, isPending: view.isPending, observations: view.observations };
  };
  const statsCache = new WeakMap<object, ReadonlyArray<EnvironmentPullRequestStat> | null>();

  const updateState = (update: (current: PageState) => PageState) => {
    const current = registry.get(stateAtom);
    const next = update(current);
    if (next !== current) registry.set(stateAtom, next);
  };

  const frameAtom = Atom.make((get): Frame | null => {
    if (get(context.pageAtom).kind !== "pull-requests") return null;
    const pageState = get(stateAtom);
    const search: PullRequestsSearch = pageState.search ?? readPullRequestListPreferences(storage);
    const sort = search.sort ?? "ready";
    const statsPolicy = resolvePullRequestsStatsPolicy(sort);
    const keybindings = get(keybindingsAtom);
    const environments = get(environmentsAtom);
    const capableEnvironments = environments
      .filter(
        (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
      )
      .toSorted((left, right) => left.environmentId.localeCompare(right.environmentId));
    const scopedEnvironmentId =
      capableEnvironments.find((environment) => environment.environmentId === search.environmentId)
        ?.environmentId ?? null;
    const knownEnvironmentIds = new Set(
      environments.map((environment) => environment.environmentId),
    );
    const environmentIds = capableEnvironments
      .filter(
        (environment) =>
          scopedEnvironmentId === null || environment.environmentId === scopedEnvironmentId,
      )
      .map((environment) => environment.environmentId);
    const environmentKey = pullRequestEnvironmentSetKey(environmentIds);
    const capabilityKnown = environments.some((environment) => environment.serverConfig !== null);
    const pullRequestsSupported = environmentIds.length > 0;
    const allProjects = get(state.environmentProjects.projectsAtom);
    const projectsKnown = get(bootstrappedAtom);
    const projects = allProjects.filter((project) =>
      environmentIds.includes(project.environmentId),
    );
    const environmentLabels = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    const scopedProjectId = resolveProjectScope(search.projectId, projects, projectsKnown);
    const scopedProject = findScopedProject(projects, scopedEnvironmentId, scopedProjectId);
    const scopedProjects = pullRequestFilterProjects(projects, environmentLabels, scopedProject);
    const selectedHost = search.selectedHost ?? search.host;
    const repository = search.repository?.toLowerCase();
    const projectIdForRepository =
      repository === undefined
        ? undefined
        : projects.find((project) => {
            const identity = project.repositoryIdentity;
            if (!identity?.owner || !identity.name) return false;
            if (`${identity.owner}/${identity.name}`.toLowerCase() !== repository) return false;
            if (selectedHost === undefined) return true;
            return (
              isProviderKind(identity.provider) &&
              pullRequestHostOf(identity, identity.provider) === selectedHost.toLowerCase()
            );
          })?.id;
    const linkedProjectId = resolveProjectScope(search.selectedProjectId, projects, projectsKnown);
    const selectedProjectId = linkedProjectId ?? projectIdForRepository ?? scopedProjectId;
    const selectedEnvironmentId = resolveSelectedEnvironmentId(
      search.selectedEnvironmentId,
      knownEnvironmentIds,
      scopedEnvironmentId,
    );
    const selectedProject = findScopedProject(projects, selectedEnvironmentId, selectedProjectId);
    const rightPanelRef = capableEnvironments.length === 0 ? null : PULL_REQUESTS_PANEL_REF;
    const { byThreadKey } = get(rightPanelStoreAtom);
    const rightPanelState = selectThreadRightPanelState(byThreadKey, rightPanelRef);
    const selectedRightPanelSurface = selectSelectedRightPanelSurface(byThreadKey, rightPanelRef);
    const selectedPullRequestSurface =
      selectedRightPanelSurface?.kind === "pull-request" ? selectedRightPanelSurface : null;
    const activePullRequestSurface = rightPanelState.isOpen ? selectedPullRequestSurface : null;

    const typedQuery = (search.q ?? "").trim();
    const sentQuery = pageState.sentQuery ?? typedQuery;
    const querySettled = typedQuery === sentQuery;
    const typedParsed = parsePullRequestQuery(typedQuery);
    const sentParsed = parsePullRequestQuery(sentQuery);
    const { author, checks, draft, labels, review } = search;
    const menuFilters: PullRequestListFilters = pullRequestMenuFilters({
      author,
      checks,
      draft,
      labels,
      review,
    });
    const menuFiltered = Object.keys(menuFilters).length > 0;
    const filters: PullRequestListFilters = { ...menuFilters, ...sentParsed.filters };
    const hasFilters = Object.keys(filters).length > 0;
    const localFilters: PullRequestListFilters = { ...menuFilters, ...typedParsed.filters };
    const hasLocalFilters = Object.keys(localFilters).length > 0;
    const queryEnvironmentIds = resolveQueryEnvironmentIds(
      environmentIds,
      projects,
      scopedProject,
      scopedProjectId,
      projectsKnown,
    );
    const environmentQueries = ((): ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly projectIds?: ReadonlyArray<ProjectId>;
    }> => {
      const plain = queryEnvironmentIds.map((environmentId) => ({ environmentId }));
      if (!projectsKnown || scopedProjectId !== undefined) return plain;
      const assignment = assignProjectsToEnvironments(
        projects,
        queryEnvironmentIds,
        queryEnvironmentIds[0],
      );
      const totals = new Map<EnvironmentId, number>();
      for (const project of projects) {
        totals.set(project.environmentId, (totals.get(project.environmentId) ?? 0) + 1);
      }
      return queryEnvironmentIds.flatMap((environmentId) => {
        const projectIds = assignment.get(environmentId);
        if (projectIds === undefined) return [];
        if (projectIds.length === (totals.get(environmentId) ?? 0)) return [{ environmentId }];
        return [{ environmentId, projectIds }];
      });
    })();
    const assignmentKey = environmentQueries
      .map(({ environmentId, projectIds }) => `${environmentId}#${projectIds?.join("+") ?? "*"}`)
      .join("|");
    const turnRefreshToken = get(
      turnQueries.atom(
        environmentQueries.map(({ environmentId }) => ({ environmentId, input: {} })),
      ),
    )
      .values.map(([environmentId, revision]) => `${environmentId}:${revision}`)
      .join("|");
    const scopeKey = `${environmentKey}:${assignmentKey}:${search.state}:${search.involvement}:${scopedProjectId ?? ""}:${search.host ?? ""}:${search.draft ?? ""}:${search.review ?? ""}:${search.checks ?? ""}:${search.author ?? ""}:${search.labels?.join("\u0000") ?? ""}`;
    const filterKey = `${scopeKey}:${sentQuery}`;
    const page =
      pageState.page !== null && pageState.page.key === filterKey
        ? pageState.page
        : initialPullRequestsPagination(filterKey);
    const pageSize = page.key === filterKey ? page.size : PULL_REQUESTS_PAGE_SIZE;
    const sentCursors = page.key === filterKey ? page.cursors : null;
    const sentRegrown = page.key === filterKey ? page.regrown : [];

    const listTargets = environmentQueries.flatMap(
      ({ environmentId, projectIds }): ListTarget[] => {
        const cursors = sentCursors?.[environmentId];
        if (sentCursors !== null && cursors === undefined && !sentRegrown.includes(environmentId)) {
          return [];
        }
        return [
          {
            environmentId,
            input: {
              state: search.state,
              involvement: search.involvement,
              limit: pageSize,
              ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
              ...(projectIds ? { projectIds } : {}),
              ...(search.host ? { host: search.host } : {}),
              ...(hasFilters ? { filters } : {}),
              ...(sentParsed.text ? { query: sentParsed.text } : {}),
              ...(cursors === undefined ? {} : { cursors }),
            },
          },
        ];
      },
    );
    const listQuery = readList(get, listTargets);
    const baselineTargets = environmentQueries.map(({ environmentId, projectIds }): ListTarget => ({
      environmentId,
      input: {
        state: search.state,
        involvement: search.involvement,
        limit: PULL_REQUESTS_PAGE_SIZE,
        ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
        ...(projectIds ? { projectIds } : {}),
        ...(search.host ? { host: search.host } : {}),
        ...(menuFiltered ? { filters: menuFilters } : {}),
      },
    }));
    const baselineQuery = readList(get, baselineTargets);
    const facetTargets = pageState.filtersOpen
      ? environmentQueries.map(({ environmentId, projectIds }): ListTarget => ({
          environmentId,
          input: {
            state: "all",
            involvement: search.involvement,
            limit: PULL_REQUESTS_PAGE_SIZE,
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
            ...(projectIds ? { projectIds } : {}),
            ...(search.host ? { host: search.host } : {}),
          },
        }))
      : [];
    const facetQuery = readList(get, facetTargets);
    const partitionsWanted = search.involvement === "all" && typedQuery.length === 0;
    const partitionTargetsFor = (involvement: PullRequestInvolvement): ReadonlyArray<ListTarget> =>
      !partitionsWanted || baselineQuery.data === null || baselineQuery.data.entries.length === 0
        ? []
        : environmentQueries.map(({ environmentId, projectIds }) => ({
            environmentId,
            input: {
              state: search.state,
              involvement,
              limit: PULL_REQUESTS_PAGE_SIZE,
              ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
              ...(projectIds ? { projectIds } : {}),
              ...(search.host ? { host: search.host } : {}),
              ...(menuFiltered ? { filters: menuFilters } : {}),
            },
          }));
    const authoredTargets = partitionTargetsFor("authored");
    const reviewingTargets = partitionTargetsFor("reviewing");
    const authoredQuery = readList(get, authoredTargets);
    const reviewingQuery = readList(get, reviewingTargets);

    const loaded = pageState.loaded;
    const ordered = pageState.ordered;
    const narrowed = (() => {
      if (
        loaded === null ||
        loaded.environmentKey !== environmentKey ||
        loaded.scope === scopeKey
      ) {
        return null;
      }
      const entries = narrowPullRequestsToFilters(loaded.data.entries, {
        state: search.state,
        projectId: scopedProjectId,
        host: search.host,
      });
      return entries.length === 0 ? null : { ...loaded.data, entries };
    })();
    const answered =
      (sentQuery.length === 0 && sentCursors === null && pageSize === PULL_REQUESTS_PAGE_SIZE
        ? baselineQuery.data
        : listQuery.data) ??
      (loaded?.scope === scopeKey && loaded.query === sentQuery ? loaded.data : null);
    const carried =
      (sentQuery.length === 0 ? baselineQuery.data : null) ??
      (loaded?.scope === scopeKey ? loaded.data : null) ??
      narrowed;
    const listData = answered ?? carried;
    const showingCarried = answered === null && carried !== null;
    const nextCursors = answered?.nextCursors ?? {};
    const regrown = (answered?.truncatedEnvironments ?? []).filter(
      (environmentId) => nextCursors[environmentId] === undefined,
    );
    const canContinue = !showingCarried && Object.keys(nextCursors).length > 0;

    const viewers = baselineQuery.data?.viewers ?? listData?.viewers ?? {};
    const listErrors = baselineQuery.data?.errors ?? listData?.errors ?? [];
    const facets = collectPullRequestListFacets(
      [
        ...(facetQuery.data?.entries ?? []),
        ...(baselineQuery.data?.entries ?? listData?.entries ?? []),
      ],
      search.state,
    );
    const searchingHosts = new Set(
      (baselineQuery.data?.providers ?? listData?.providers ?? []).flatMap((provider) =>
        provider.searchesOnHost ? [provider.host] : [],
      ),
    );
    const entries = (() => {
      const known = ordered?.key === filterKey ? ordered.entries : (listData?.entries ?? []);
      const involvementEntries = filterPullRequestsByInvolvement(
        known,
        viewers,
        search.involvement,
      );
      const narrowedEntries = hasLocalFilters
        ? involvementEntries.filter((entry) =>
            matchesPullRequestFilters(entry, localFilters, pullRequestEntryViewer(entry, viewers)),
          )
        : involvementEntries;
      if (typedParsed.text.length === 0) {
        return narrowedEntries.toSorted((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        );
      }
      const answeredLocally = querySettled && !showingCarried;
      return narrowedEntries.filter(
        (entry) =>
          (answeredLocally && searchingHosts.has(entry.host)) ||
          matchesPullRequestQuery(entry, typedParsed.text),
      );
    })();
    const groups = ((): ReadonlyArray<PullRequestGroup<EnvironmentPullRequestEntry>> => {
      if (search.involvement !== "all") return [{ key: "others", label: "", entries }];
      const held =
        loaded !== null && loaded.environmentKey === environmentKey && loaded.scope === scopeKey
          ? loaded.partitions
          : undefined;
      const narrow = (rows: ReadonlyArray<EnvironmentPullRequestEntry> | undefined) =>
        rows === undefined || !hasLocalFilters
          ? rows
          : rows.filter((entry) =>
              matchesPullRequestFilters(
                entry,
                localFilters,
                pullRequestEntryViewer(entry, viewers),
              ),
            );
      const authored = narrow(
        partitionsWanted ? (authoredQuery.data?.entries ?? held?.authored) : undefined,
      );
      const reviewing = narrow(
        partitionsWanted ? (reviewingQuery.data?.entries ?? held?.reviewing) : undefined,
      );
      if (authored === undefined || reviewing === undefined) {
        return groupPullRequestsByInvolvement(entries, viewers);
      }
      return partitionPullRequestsWithPriority(entries, authored, reviewing);
    })();
    const entriesByStatsKey = new Map(
      groups.flatMap((group) =>
        group.entries.map((entry) => [pullRequestEntryKey(entry), entry] as const),
      ),
    );
    const statsTarget = pageState.statsTarget;
    const statsBatches =
      statsTarget !== null && statsTarget.key === filterKey ? statsTarget.batches : [];
    const statsView = get(
      statsQueries.atom(statsBatches.map(({ environmentId, input }) => ({ environmentId, input }))),
    );
    let stats = statsCache.get(statsView.values);
    if (stats === undefined) {
      stats =
        statsView.values.length === 0
          ? null
          : statsView.values.flatMap(([environmentId, result]) =>
              result.stats.map((stat) => ({ ...stat, environmentId })),
            );
      statsCache.set(statsView.values, stats);
    }
    const statsByRow = pageState.statsByRow;
    const overrides = pageState.overrides;
    const displayGroups = sortPullRequestGroups(
      groups.map((group) => {
        const withOverrides = applyPullRequestOverrides(
          group.entries.map((entry) => withDiffStat(entry, statsByRow)),
          overrides,
          pullRequestEntryKey,
          search.state,
        );
        return {
          ...group,
          entries:
            hasLocalFilters && overrides.size > 0
              ? withOverrides.filter(
                  (entry) =>
                    !overrides.has(pullRequestEntryKey(entry)) ||
                    matchesPullRequestFilters(
                      entry,
                      localFilters,
                      pullRequestEntryViewer(entry, viewers),
                    ),
                )
              : withOverrides,
        };
      }),
      sort,
      typedParsed.text,
      (entry) =>
        entry.additions + entry.deletions > 0 || statsByRow.has(pullRequestDiffStatKey(entry)),
      search.involvement,
    );
    const heldBySurface = new Map(
      groups.flatMap((group) =>
        group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
      ),
    );
    const listedBySurface = new Map(
      displayGroups.flatMap((group) =>
        group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
      ),
    );
    const tabStatusSeeds: PullRequestTabStatusSeeds = Object.fromEntries(
      entries.map((entry) => [
        pullRequestSurfaceId(entry),
        { state: entry.state, isDraft: entry.isDraft },
      ]),
    );
    const rowsByKey = new Map(
      displayGroups.flatMap((group) =>
        group.entries.map((entry) => [pullRequestEntryKey(entry), entry] as const),
      ),
    );
    const linkedSelection =
      search.repository && search.number && selectedProject
        ? {
            environmentId: selectedProject.environmentId,
            repository: search.repository,
            number: search.number,
            projectId: selectedProject.id,
            ...(selectedHost ? { host: selectedHost } : {}),
          }
        : null;
    const selectedProjectIdentity = selectedProject?.repositoryIdentity;
    const selected =
      rightPanelState.isOpen && activePullRequestSurface !== null
        ? {
            environmentId: activePullRequestSurface.environmentId,
            repository: activePullRequestSurface.repository,
            number: activePullRequestSurface.number,
            host:
              activePullRequestSurface.host ??
              (selectedProjectIdentity && isProviderKind(selectedProjectIdentity.provider)
                ? pullRequestHostOf(selectedProjectIdentity, selectedProjectIdentity.provider)
                : undefined),
          }
        : null;
    const expectedHosts = (() => {
      const byHost = new Map<string, PullRequestExpectedHost>();
      for (const project of projects) {
        const kind = project.repositoryIdentity?.provider;
        if (kind === undefined || !isProviderKind(kind)) continue;
        const host = pullRequestHostOf(project.repositoryIdentity, kind);
        if (!byHost.has(host)) byHost.set(host, { host, kind });
      }
      return [...byHost.values()];
    })();
    const unavailableProjects = new Map(
      listErrors.map(
        (error) =>
          [
            pullRequestProjectKey({ id: error.projectId, environmentId: error.environmentId }),
            error.message,
          ] as const,
      ),
    );
    const model = buildPullRequestsPageModel({
      search,
      capabilityKnown,
      pullRequestsSupported,
      projectsKnown,
      projectCount: projects.length,
      projectScoped: scopedProjectId !== undefined,
      querySettled,
      showingCarried,
      listPending: listQuery.isPending,
      hasListData: listData !== null,
      listError: listQuery.error,
      invalidating: pageState.invalidating,
      groups: displayGroups,
      loadedEntryCount: entries.length,
      truncated: listData?.truncated === true,
      canContinue,
      continuing: sentCursors !== null,
      pageSize,
      hosts: pageState.hosts,
      expectedHosts,
      environments: capableEnvironments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        machineKind: resolveEnvironmentMachineKind(environment.serverConfig),
      })),
      environmentLabels,
      scopedEnvironmentId: scopedEnvironmentId ?? undefined,
      filtersMenu: {
        authorOptions: facets.authors,
        authorQuery: pageState.authorQuery,
        labelOptions: facets.labels,
        projects: scopedProjects,
        projectId: scopedProjectId,
        projectEnvironmentId: scopedProject?.environmentId,
        unavailable: unavailableProjects,
      },
      selected,
      nowMs: Date.now(),
    });
    const authorActors = Object.fromEntries(
      facets.authors.map((facet) => [
        facet.actor.login.toLowerCase(),
        buildPullRequestActorModel(facet.actor),
      ]),
    );
    const projectIcons: Record<string, ProjectIconView> = Object.fromEntries(
      scopedProjects.map((project) => [pullRequestProjectKey(project), projectIconView(project)]),
    );
    const stackTriggers = Object.fromEntries(
      displayGroups.flatMap((group) =>
        group.entries.flatMap((entry) =>
          entry.stack === undefined
            ? []
            : [
                [
                  pullRequestEntryKey(entry),
                  buildPullRequestStackPopoverModel(entry.stack),
                ] as const,
              ],
        ),
      ),
    );
    const rightPanelAvailable = selectedPullRequestSurface !== null;
    const panels = buildPanelLayoutControlsModel({
      showTerminalControl: false,
      terminalAvailable: false,
      terminalOpen: false,
      terminalShortcutLabel: null,
      rightPanelAvailable,
      rightPanelOpen: rightPanelState.isOpen,
      rightPanelShortcutLabel: shortcutLabelForCommand(
        keybindings,
        "rightPanel.toggle",
        context.platform,
      ),
      rightPanelUnavailableLabel: model.panelUnavailableLabel,
      liveAgentCount: 0,
    });
    return {
      view: {
        model,
        filtersOpen: pageState.filtersOpen,
        authorQuery: pageState.authorQuery,
        authorActors,
        projectIcons,
        stackTriggers,
        rightPanel: { ...panels.rightPanel, visible: pullRequestsSupported },
        rightPanelOpen: rightPanelState.isOpen,
        searchRevision: pageState.searchRevision,
        searchFocus: pageState.searchFocus,
      },
      search,
      sentQuery,
      typedQuery,
      filterKey,
      scopeKey,
      environmentKey,
      statsPolicy,
      pageSize,
      sentCursors,
      sentParsedText: sentParsed.text,
      pullRequestsSupported,
      queryEnvironmentIds,
      listTargets,
      relatedTargets: [
        ...baselineTargets,
        ...facetTargets,
        ...authoredTargets,
        ...reviewingTargets,
      ],
      listQuery,
      baselineQuery,
      authoredQuery,
      reviewingQuery,
      facetQuery,
      partitionsWanted,
      answered,
      canContinue,
      nextCursors,
      regrown,
      orderedCount: ordered?.key === filterKey ? ordered.entries.length : pageSize,
      turnRefreshToken,
      linkedSelection,
      rightPanelRef,
      rightPanelOpen: rightPanelState.isOpen,
      selectedPullRequestSurface,
      activePullRequestSurface,
      groups,
      entriesByStatsKey,
      statsQueryPending: statsView.isPending,
      stats,
      heldBySurface,
      listedBySurface,
      rowsByKey,
      tabStatusSeeds,
      tabStatusSeedsKey: JSON.stringify(tabStatusSeeds),
      keybindings,
      projects,
      scopedProjects,
      scopedProjectId,
      capableEnvironmentIds: capableEnvironments.map((environment) => environment.environmentId),
    };
  });

  const viewAtom = Atom.make((get): PullRequestsPageView | null => get(frameAtom)?.view ?? null);

  const effects = createEffectRunner();
  let latest: Frame | null = null;
  let visible: { key: string; values: ReadonlySet<string> } = { key: "", values: new Set() };
  let reportedVisible: ReadonlySet<string> = new Set();
  let appliedTurnRefreshToken = "";
  let panelSelectionPrimed = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let overrideToken = 0;
  const detailOverrideTokens = new Map<string, number | null>();

  const refreshTargets = (targets: ReadonlyArray<ListTarget>) => {
    for (const atom of new Set(targets.map(listQueries.atomFor))) registry.refresh(atom);
  };

  const setPage = (page: PullRequestsPagination) =>
    updateState((current) => ({ ...current, page }));

  const refreshList = (includeRelated = false, actedEnvironmentId?: EnvironmentId) => {
    const frame = latest;
    if (frame === null) return;
    const related = (includeRelated ? frame.relatedTargets : []).filter(
      ({ environmentId }) =>
        actedEnvironmentId === undefined || environmentId === actedEnvironmentId,
    );
    const refresh = resolvePullRequestsListRefresh({
      continuing: frame.sentCursors !== null,
      filterKey: frame.filterKey,
      pageSize: frame.pageSize,
      loadedCount: frame.orderedCount,
    });
    if (refresh.kind === "refresh-targets") {
      refreshTargets([
        ...frame.listTargets.filter(
          ({ environmentId }) =>
            actedEnvironmentId === undefined || environmentId === actedEnvironmentId,
        ),
        ...related,
      ]);
      return;
    }
    if (related.length > 0) refreshTargets(related);
    setPage(refresh.page);
  };

  const statsScope = (): PullRequestStatsScope | null =>
    latest === null ? null : { key: latest.filterKey, policy: latest.statsPolicy };

  const refreshListAndStats = (
    requestedStatsScope = statsScope(),
    actedEnvironmentId?: EnvironmentId,
  ) => {
    refreshList(true, actedEnvironmentId);
    const frame = latest;
    const current = statsScope();
    if (frame === null || current === null || requestedStatsScope === null) return;
    const batches = pullRequestStatsRefreshBatches({
      requestedScope: requestedStatsScope,
      currentScope: current,
      entriesByKey: frame.entriesByStatsKey,
      candidateKeys: visible.key === requestedStatsScope.key ? visible.values : new Set(),
      statsByRow: registry.get(stateAtom).statsByRow,
    });
    if (batches === null) return;
    updateState((state) => ({
      ...state,
      statsTarget: { key: requestedStatsScope.key, batches },
    }));
    for (const { environmentId, input } of batches) {
      if (actedEnvironmentId !== undefined && environmentId !== actedEnvironmentId) continue;
      registry.refresh(state.pullRequestEnvironment.listStats({ environmentId, input }));
    }
  };

  const refreshFromHost = async () => {
    const frame = latest;
    if (frame === null) return;
    const requestedStatsScope = statsScope();
    updateState((current) => ({ ...current, invalidating: true }));
    try {
      await Promise.all(
        frame.queryEnvironmentIds.map((environmentId) =>
          runAtomCommand(
            registry,
            state.pullRequestEnvironment.invalidate,
            { environmentId, input: {} },
            { reportFailure: false },
          ),
        ),
      );
    } finally {
      updateState((current) => ({ ...current, invalidating: false }));
    }
    refreshListAndStats(requestedStatsScope);
    registry.set(bridge.detailRefreshTokenAtom, registry.get(bridge.detailRefreshTokenAtom) + 1);
  };

  const liveRefresh = createLiveRefresh(
    context,
    () => "pull-requests-page",
    () => refreshList(true),
  );

  const currentSearch = (): PullRequestsSearch =>
    latest?.search ?? registry.get(stateAtom).search ?? readPullRequestListPreferences(storage);

  const updateSearch = (patch: PullRequestsSearchPatch) => {
    const next = buildPullRequestsSearch(currentSearch(), patch);
    updateState((current) => ({ ...current, search: next }));
  };

  const scheduleSentQuery = (search: PullRequestsSearch) => {
    clearTimeout(debounce);
    const typed = (search.q ?? "").trim();
    debounce = setTimeout(() => {
      updateState((current) =>
        current.sentQuery === typed ? current : { ...current, sentQuery: typed },
      );
    }, PULL_REQUESTS_SEARCH_DEBOUNCE_MS);
  };

  const updateListScope = (patch: PullRequestListPreferencePatch) => {
    const search = currentSearch();
    const change = resolvePullRequestListScopeChange(search, patch);
    writePullRequestListPreferences(change.preferences, storage);
    const next = buildPullRequestsSearch(search, change.patch);
    updateState((current) => ({ ...current, search: next }));
    if ((next.q ?? "").trim() !== (search.q ?? "").trim()) scheduleSentQuery(next);
  };

  const overrideEntry = (
    entry: EnvironmentPullRequestEntry,
    action: PullRequestAction,
  ): number | null => {
    const token = ++overrideToken;
    const override = pullRequestOverrideAfterAction(entry, action, new Date(), token);
    if (override === null) return null;
    updateState((current) => ({
      ...current,
      overrides: new Map(current.overrides).set(pullRequestEntryKey(entry), override),
    }));
    return token;
  };

  const revertOverride = (key: string, token: number | null) => {
    if (token === null) return;
    updateState((current) => {
      if (current.overrides.get(key)?.token !== token) return current;
      const next = new Map(current.overrides);
      next.delete(key);
      return { ...current, overrides: next };
    });
  };

  const onActed = (action: PullRequestAction | undefined, phase: PullRequestActedPhase) => {
    const frame = latest;
    const surface = frame?.selectedPullRequestSurface ?? null;
    if (frame === null || surface === null) return;
    const panelEnvironmentId = surface.environmentId;
    const acted = frame.heldBySurface.get(pullRequestListEntryId(surface));
    const actedEnvironmentId = frame.capableEnvironmentIds.find(
      (environmentId) => environmentId === panelEnvironmentId,
    );
    const stateOnly =
      action !== undefined &&
      acted !== undefined &&
      pullRequestOverrideAfterAction(acted, action, new Date(), 0) !== null;
    if (stateOnly) {
      const key = pullRequestEntryKey(acted);
      if (phase === "sent" && action !== "merge") {
        detailOverrideTokens.set(key, overrideEntry(acted, action));
      }
      if (phase === "failed" && action !== "merge") {
        revertOverride(key, detailOverrideTokens.get(key) ?? null);
      }
      if (phase !== "sent") detailOverrideTokens.delete(key);
      if (phase === "done" && action === "merge") {
        overrideEntry(acted, action);
        refreshListAndStats(undefined, actedEnvironmentId);
      }
      return;
    }
    if (phase === "done") refreshListAndStats(undefined, actedEnvironmentId);
  };

  const applyVisibleRows = (keys: ReadonlySet<string>) => {
    const frame = latest;
    if (frame === null || frame.statsPolicy !== "visible") return;
    if (visible.key !== frame.filterKey) return;
    const entered = new Set<string>();
    const next = new Set<string>();
    for (const key of keys) {
      if (!frame.entriesByStatsKey.has(key)) continue;
      next.add(key);
      if (!visible.values.has(key)) entered.add(key);
    }
    const changed =
      next.size !== visible.values.size || [...next].some((key) => !visible.values.has(key));
    visible = { key: visible.key, values: next };
    if (!changed) return;
    updateState((current) => {
      const batches =
        current.statsTarget !== null && current.statsTarget.key === frame.filterKey
          ? current.statsTarget.batches
          : [];
      const retained = frame.statsQueryPending
        ? batches
        : retainVisiblePullRequestStatsBatches(batches, next);
      const added = pullRequestStatsRequestBatches({
        entriesByKey: frame.entriesByStatsKey,
        candidateKeys: entered,
        policy: frame.statsPolicy,
        activeBatches: batches,
        statsByRow: current.statsByRow,
      });
      if (added.length === 0 && retained.length === batches.length) return current;
      return {
        ...current,
        statsTarget: { key: frame.filterKey, batches: [...retained, ...added] },
      };
    });
  };

  const runEffects = (frame: Frame) => {
    latest = frame;
    const pageState = registry.get(stateAtom);
    if (pageState.search === null) {
      updateState((current) => ({ ...current, search: frame.search, sentQuery: frame.sentQuery }));
    }
    effects.run("filter-key", [frame.filterKey], () => {
      const page = registry.get(stateAtom).page;
      if (page === null || page.key !== frame.filterKey) {
        setPage(initialPullRequestsPagination(frame.filterKey));
      }
    });
    for (const [name, query] of [
      ["observe-list", frame.listQuery],
      ["observe-baseline", frame.baselineQuery],
      ["observe-facets", frame.facetQuery],
      ["observe-authored", frame.authoredQuery],
      ["observe-reviewing", frame.reviewingQuery],
    ] as const) {
      effects.run(name, [query.observations], () => {
        for (const [environmentId, answer, observedAt] of query.observations) {
          for (const entry of answer.entries) {
            observePullRequestSummary(
              registry,
              environmentId,
              {
                projectId: entry.projectId,
                host: entry.host,
                repository: entry.repository,
                number: entry.number,
              },
              pullRequestListEntryToSummary(entry),
              observedAt,
            );
          }
        }
      });
    }
    effects.run("hydrate", [frame.environmentKey], () => {
      if (frame.environmentKey.length === 0) return;
      updateState((current) => {
        if (current.loaded !== null && current.loaded.environmentKey === frame.environmentKey) {
          return current;
        }
        const snapshot = readPullRequestListSnapshot(storage, frame.environmentKey);
        if (snapshot === null) {
          return current.loaded === null ? current : { ...current, loaded: null };
        }
        return {
          ...current,
          loaded: {
            environmentKey: frame.environmentKey,
            scope: snapshot.scope,
            query: "",
            data: snapshot.data,
            ...(snapshot.partitions === undefined ? {} : { partitions: snapshot.partitions }),
          },
        };
      });
    });
    const ordered = registry.get(stateAtom).ordered;
    effects.run(
      "loaded",
      [
        frame.environmentKey,
        frame.scopeKey,
        frame.sentQuery,
        frame.listQuery.data,
        frame.listQuery.isPending,
        frame.partitionsWanted,
        frame.authoredQuery.data,
        frame.reviewingQuery.data,
        ordered,
        frame.filterKey,
        frame.baselineQuery.data,
      ],
      () => {
        const data = frame.listQuery.data;
        if (!data || frame.listQuery.isPending) return;
        updateState((current) => {
          const partitions =
            frame.partitionsWanted &&
            frame.authoredQuery.data !== null &&
            frame.reviewingQuery.data !== null
              ? {
                  authored: frame.authoredQuery.data.entries,
                  reviewing: frame.reviewingQuery.data.entries,
                }
              : current.loaded !== null &&
                  current.loaded.environmentKey === frame.environmentKey &&
                  current.loaded.scope === frame.scopeKey
                ? current.loaded.partitions
                : undefined;
          const accumulated =
            current.ordered?.key === frame.filterKey ? current.ordered.entries : data.entries;
          if (frame.environmentKey.length > 0 && frame.sentQuery.length === 0) {
            writePullRequestListSnapshot(storage, frame.environmentKey, {
              scope: frame.scopeKey,
              data: {
                ...data,
                entries: accumulated,
                viewers: frame.baselineQuery.data?.viewers ?? data.viewers,
                providers: frame.baselineQuery.data?.providers ?? data.providers,
              },
              ...(partitions === undefined ? {} : { partitions }),
            });
          }
          return {
            ...current,
            loaded: {
              environmentKey: frame.environmentKey,
              scope: frame.scopeKey,
              query: frame.sentQuery,
              data: { ...data, entries: accumulated },
              ...(partitions === undefined ? {} : { partitions }),
            },
          };
        });
      },
    );
    effects.run(
      "ordered",
      [
        frame.answered,
        frame.filterKey,
        frame.sentCursors,
        frame.sentParsedText,
        frame.listQuery.isPending,
        frame.listQuery.error,
        frame.listQuery.data,
      ],
      () => {
        const answered = frame.answered;
        if (
          !answered ||
          frame.listQuery.isPending ||
          (frame.listQuery.error && frame.listQuery.data === null)
        ) {
          return;
        }
        updateState((current) => {
          const previous = current.ordered;
          let nextOrdered: Ordered;
          if (previous === null || previous.key !== frame.filterKey) {
            nextOrdered = {
              key: frame.filterKey,
              entries: rankPullRequestMatches(answered.entries, frame.sentParsedText),
            };
          } else if (frame.sentCursors !== null) {
            const held = new Set(previous.entries.map(pullRequestEntryKey));
            const arrived = answered.entries.filter(
              (entry) => !held.has(pullRequestEntryKey(entry)),
            );
            const appended = rankPullRequestMatches(
              arrived.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
              frame.sentParsedText,
            );
            nextOrdered = { key: frame.filterKey, entries: [...previous.entries, ...appended] };
          } else {
            nextOrdered = {
              key: frame.filterKey,
              entries: reusePullRequestEntries(
                previous.entries,
                rankPullRequestMatches(answered.entries, frame.sentParsedText),
                pullRequestEntryKey,
              ),
            };
          }
          return {
            ...current,
            ordered: nextOrdered,
            overrides: settlePullRequestOverrides(
              current.overrides,
              answered.entries,
              pullRequestEntryKey,
              Date.now(),
            ),
          };
        });
      },
    );
    effects.run("turn-refresh", [frame.turnRefreshToken], () => {
      if (
        frame.turnRefreshToken.length === 0 ||
        appliedTurnRefreshToken === frame.turnRefreshToken
      ) {
        return;
      }
      appliedTurnRefreshToken = frame.turnRefreshToken;
      if (frame.sentCursors !== null) refreshList();
    });
    effects.run("hosts", [frame.answered, frame.search.host], () => {
      const answered = frame.answered;
      if (answered === null) return;
      updateState((current) => {
        const hosts =
          frame.search.host === undefined || current.hosts.length === 0
            ? answered.providers
            : current.hosts;
        return hosts === current.hosts ? current : { ...current, hosts };
      });
    });
    effects.run(
      "linked-selection",
      [
        frame.linkedSelection?.environmentId,
        frame.linkedSelection?.repository,
        frame.linkedSelection?.number,
        frame.linkedSelection?.projectId,
        frame.linkedSelection?.host,
        frame.pullRequestsSupported,
        frame.rightPanelRef,
      ],
      () => {
        if (!frame.pullRequestsSupported || frame.rightPanelRef === null) return;
        if (frame.linkedSelection === null) return;
        useRightPanelStore.getState().openPullRequest(frame.rightPanelRef, frame.linkedSelection);
      },
    );
    effects.run(
      "panel-selection",
      [frame.rightPanelOpen, frame.selectedPullRequestSurface?.id ?? null],
      () => {
        if (!panelSelectionPrimed) {
          panelSelectionPrimed = true;
          return;
        }
        const surface = frame.rightPanelOpen ? frame.selectedPullRequestSurface : null;
        const search = registry.get(stateAtom).search;
        if (search === null) return;
        const matches =
          surface === null
            ? search.repository === undefined && search.number === undefined
            : search.repository === surface.repository &&
              search.number === surface.number &&
              search.selectedProjectId === surface.projectId &&
              search.selectedHost === surface.host &&
              (surface.environmentId === undefined ||
                search.selectedEnvironmentId === surface.environmentId);
        if (matches) return;
        updateSearch(
          surface === null
            ? PULL_REQUESTS_CLEARED_SELECTION
            : {
                repository: surface.repository,
                number: surface.number,
                selectedProjectId: ProjectId.make(surface.projectId),
                selectedHost: surface.host,
                ...(surface.environmentId === undefined
                  ? {}
                  : { selectedEnvironmentId: EnvironmentId.make(surface.environmentId) }),
              },
        );
      },
    );
    effects.run("stats-eager", [frame.filterKey, frame.groups, frame.statsPolicy], () => {
      if (frame.statsPolicy !== "eager") return;
      updateState((current) => {
        const batches =
          current.statsTarget !== null && current.statsTarget.key === frame.filterKey
            ? current.statsTarget.batches
            : [];
        const added = pullRequestStatsRequestBatches({
          entriesByKey: frame.entriesByStatsKey,
          candidateKeys: visible.values,
          policy: frame.statsPolicy,
          activeBatches: batches,
          statsByRow: current.statsByRow,
        });
        if (added.length === 0 && current.statsTarget?.key === frame.filterKey) return current;
        return {
          ...current,
          statsTarget: { key: frame.filterKey, batches: [...batches, ...added] },
        };
      });
    });
    effects.run("stats-visible-reset", [frame.filterKey, frame.statsPolicy], () => {
      if (frame.statsPolicy !== "visible") return;
      visible = { key: frame.filterKey, values: new Set() };
      applyVisibleRows(reportedVisible);
    });
    effects.run(
      "stats-retain",
      [frame.filterKey, frame.statsPolicy, frame.statsQueryPending],
      () => {
        if (frame.statsPolicy !== "visible" || frame.statsQueryPending) return;
        updateState((current) => {
          if (
            current.statsTarget === null ||
            current.statsTarget.key !== frame.filterKey ||
            visible.key !== frame.filterKey
          ) {
            return current;
          }
          const batches = retainVisiblePullRequestStatsBatches(
            current.statsTarget.batches,
            visible.values,
          );
          return batches.length === current.statsTarget.batches.length
            ? current
            : { ...current, statsTarget: { key: current.statsTarget.key, batches } };
        });
      },
    );
    effects.run("stats-merge", [frame.stats], () => {
      const stats = frame.stats;
      if (stats === null) return;
      updateState((current) => ({
        ...current,
        statsByRow: mergePullRequestDiffStats(current.statsByRow, stats),
      }));
    });
    effects.run("publish", [frame.listedBySurface], () => {
      const current = registry.get(bridge.listedEntriesAtom);
      const same =
        current.size === frame.listedBySurface.size &&
        [...frame.listedBySurface].every(([id, entry]) => current.get(id) === entry);
      if (!same) registry.set(bridge.listedEntriesAtom, frame.listedBySurface);
    });
    effects.run("publish-tab-status", [frame.tabStatusSeedsKey], () => {
      registry.set(bridge.tabStatusSeedsAtom, frame.tabStatusSeeds);
    });
    effects.run("live-refresh", [frame.pullRequestsSupported], () => {
      if (frame.pullRequestsSupported) liveRefresh.mount();
      else liveRefresh.unmount();
    });
  };

  let running = false;
  let dirty = false;
  let mounted = false;
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
          if (frame === null) {
            if (mounted) {
              mounted = false;
              latest = null;
              effects.reset();
              liveRefresh.unmount();
              bridge.setActedListener(null);
              popovers.close();
              clearTimeout(debounce);
              visible = { key: "", values: new Set() };
              reportedVisible = new Set();
              appliedTurnRefreshToken = "";
              panelSelectionPrimed = false;
              detailOverrideTokens.clear();
              registry.set(stateAtom, INITIAL_STATE);
              registry.set(bridge.listedEntriesAtom, new Map());
              registry.set(bridge.tabStatusSeedsAtom, {});
            }
            continue;
          }
          if (!mounted) {
            mounted = true;
            bridge.setActedListener(onActed);
          }
          runEffects(frame);
        } while (dirty);
      } finally {
        running = false;
      }
    },
    { immediate: true },
  );

  const rowEntry = (key: string) => latest?.rowsByKey.get(key) ?? null;

  const selectEntry = (entry: PullRequestRowTarget & { readonly url?: string }) => {
    const ref = latest?.rightPanelRef ?? null;
    if (ref === null) return;
    const intent = resolvePullRequestRowSelection(entry);
    useRightPanelStore.getState().openPullRequest(ref, intent.surface);
    updateSearch(intent.searchPatch);
  };

  const toggleRightPanel = () => {
    const frame = latest;
    if (frame === null || frame.rightPanelRef === null) return;
    if (frame.rightPanelOpen) {
      useRightPanelStore.getState().close(frame.rightPanelRef);
      updateSearch(PULL_REQUESTS_CLEARED_SELECTION);
      return;
    }
    if (frame.selectedPullRequestSurface === null) return;
    useRightPanelStore.getState().show(frame.rightPanelRef);
  };

  const activeSurfaceUrl = (): string | null => {
    const frame = latest;
    if (frame === null || frame.rightPanelRef === null) return null;
    const surface = selectActiveRightPanelSurface(
      registry.get(rightPanelStoreAtom).byThreadKey,
      frame.rightPanelRef,
    );
    if (surface?.kind !== "pull-request" || surface.environmentId === undefined) return null;
    const environmentId = frame.capableEnvironmentIds.find(
      (candidate) => candidate === surface.environmentId,
    );
    if (environmentId === undefined) return surface.url ?? null;
    const project = frame.projects.find(
      (candidate) =>
        candidate.environmentId === environmentId && candidate.id === surface.projectId,
    );
    const supportsMultiple =
      registry.get(state.serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
        .threadPullRequests === true;
    const input = {
      projectId: project?.id ?? frame.projects[0]?.id,
      repository: surface.repository,
      number: surface.number,
    };
    if (input.projectId === undefined) return surface.url ?? null;
    const base = { projectId: input.projectId, repository: input.repository, number: input.number };
    const reference = supportsMultiple
      ? resolvePullRequestReferenceHost(
          { ...base, ...(surface.host === undefined ? {} : { host: surface.host }) },
          project?.repositoryIdentity,
        )
      : base;
    const detail = readQuery(
      (atom) => registry.get(atom),
      state.pullRequestEnvironment.detail({ environmentId, input: reference }),
    ).data;
    const cached = readPullRequestDetailSnapshot(storage, environmentId, reference);
    return (
      resolveDisplayedPullRequestDetail({ live: detail, cached, reference })?.url ??
      surface.url ??
      gitHubPullRequestBrowserUrl(
        project?.repositoryIdentity,
        reference.repository,
        reference.number,
      ) ??
      null
    );
  };

  const copyPullRequestUrl = () => {
    const url = activeSurfaceUrl();
    if (url === null) return false;
    clipboardService(context)
      .writeText(url)
      .then(
        () =>
          context.addToast({
            layout: "plain",
            type: "success",
            title: "PR link copied",
            description: url,
          }),
        (error: unknown) =>
          context.addToast({
            layout: "plain",
            type: "error",
            title: "Failed to copy PR link",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
      );
    return true;
  };

  const pickValue = <Value extends string>(
    options: ReadonlyArray<{ readonly value: Value }>,
    value: string,
  ): Value | undefined => options.find((option) => option.value === value)?.value;

  const menuFilters = (): PullRequestListFilters => {
    const { author, checks, draft, labels, review } = currentSearch();
    return pullRequestMenuFilters({ author, checks, draft, labels, review });
  };

  return {
    pages: ["pull-requests"],
    views: { pullRequestsPage: viewAtom },
    actions: {
      pullRequestsSetQuery: async (params) => {
        const { query } = QueryParams(params);
        updateListScope({ q: query || undefined });
        return null;
      },
      pullRequestsClearQuery: async () => {
        updateListScope({ q: undefined });
        updateState((current) => ({ ...current, searchRevision: current.searchRevision + 1 }));
        return null;
      },
      pullRequestsSetState: async (params) => {
        const value = pickValue(PULL_REQUEST_STATE_OPTIONS, ValueParams(params).value);
        if (value !== undefined) updateListScope({ state: value });
        return null;
      },
      pullRequestsSetInvolvement: async (params) => {
        const value = pickValue(PULL_REQUEST_INVOLVEMENT_OPTIONS, ValueParams(params).value);
        if (value !== undefined) updateListScope({ involvement: value });
        return null;
      },
      pullRequestsSetSort: async (params) => {
        const value = pickValue(PULL_REQUEST_SORT_OPTIONS, ValueParams(params).value);
        if (value !== undefined) updateListScope({ sort: value });
        return null;
      },
      pullRequestsSetHost: async (params) => {
        updateListScope({ host: resolvePullRequestHostFilter(ValueParams(params).value) });
        return null;
      },
      pullRequestsSetServer: async (params) => {
        updateListScope({
          environmentId: resolvePullRequestServerFilter(
            ValueParams(params).value,
            latest?.capableEnvironmentIds ?? [],
          ),
          projectId: undefined,
        });
        return null;
      },
      pullRequestsSetProject: async (params) => {
        const frame = latest;
        if (frame === null) return null;
        const selection = resolvePullRequestProjectSelection(
          frame.scopedProjects,
          frame.scopedProjectId,
          ValueParams(params).value,
        );
        if (selection.kind === "select") {
          updateListScope(
            selection.environmentId === undefined
              ? { projectId: selection.projectId }
              : { projectId: selection.projectId, environmentId: selection.environmentId },
          );
        } else if (selection.kind === "clear") {
          updateListScope({ projectId: undefined });
        }
        return null;
      },
      pullRequestsSetFilterGroup: async (params) => {
        const { group, value } = FilterGroupParams(params);
        updateListScope(
          pullRequestFiltersSearchPatch(
            resolvePullRequestFilterGroupChange(menuFilters(), group, value),
          ),
        );
        return null;
      },
      pullRequestsSetAuthor: async (params) => {
        const filters = menuFilters();
        const selection = resolvePullRequestAuthorSelection(
          filters.author,
          ValueParams(params).value,
        );
        if (selection.kind === "set") {
          updateListScope(
            pullRequestFiltersSearchPatch(
              applyPullRequestListFiltersPatch(filters, { author: selection.author }),
            ),
          );
        }
        return null;
      },
      pullRequestsSetAuthorQuery: async (params) => {
        const { query } = QueryParams(params);
        updateState((current) =>
          current.authorQuery === query ? current : { ...current, authorQuery: query },
        );
        return null;
      },
      pullRequestsToggleLabel: async (params) => {
        const { name, checked } = LabelToggleParams(params);
        const filters = menuFilters();
        const selected = (filters.labels ?? []).flatMap((group) => group);
        updateListScope(
          pullRequestFiltersSearchPatch(
            resolvePullRequestLabelFilterChange(
              filters,
              resolvePullRequestLabelToggle(selected, name, checked),
            ),
          ),
        );
        return null;
      },
      pullRequestsFiltersOpen: async (params) => {
        const { open } = OpenParams(params);
        updateState((current) =>
          current.filtersOpen === open
            ? current
            : { ...current, filtersOpen: open, authorQuery: open ? current.authorQuery : "" },
        );
        return null;
      },
      pullRequestsSelect: async (params) => {
        const entry = rowEntry(KeyParams(params).key);
        if (entry !== null) selectEntry(entry);
        return null;
      },
      pullRequestsRowContextMenu: async (params) => {
        const { key, x, y } = RowContextMenuParams(params);
        const entry = rowEntry(key);
        if (entry === null) return null;
        const openLabel =
          latest?.view.model.body.kind === "list"
            ? (latest.view.model.body.groups
                .flatMap((group) => group.rows)
                .find((row) => row.key === key)?.openOnHostLabel ?? null)
            : null;
        if (openLabel === null) return null;
        const action = await contextMenuService(context)
          .show(
            [
              { id: "copy-link", label: "Copy link", icon: "copy" },
              { id: "open-external", label: openLabel },
            ],
            { x, y },
          )
          .catch(() => null);
        try {
          if (action === "copy-link") await clipboardService(context).writeText(entry.url);
          else if (action === "open-external") await openExternal(entry.url);
        } catch {
          context.addToast({
            layout: "plain",
            type: "error",
            title: action === "copy-link" ? "Could not copy the link" : "Could not open the link",
          });
        }
        return null;
      },
      pullRequestsChecksOpen: async (params) => {
        const { key } = KeyParams(params);
        const entry = rowEntry(key);
        if (entry === null || entry.checksState === undefined) return null;
        popovers.openChecks(`row:${key}`, {
          environmentId: entry.environmentId,
          reference: {
            projectId: entry.projectId,
            repository: entry.repository,
            number: entry.number,
          },
          checksState: entry.checksState,
          checks: null,
          stale: false,
        });
        return null;
      },
      pullRequestsStackOpen: async (params) => {
        const { key } = KeyParams(params);
        const entry = rowEntry(key);
        if (entry === null || entry.stack === undefined) return null;
        popovers.openStack(`row:${key}`, {
          environmentId: entry.environmentId,
          reference: {
            projectId: entry.projectId,
            host: entry.host,
            repository: entry.repository,
            number: entry.number,
          },
          stackNumber: entry.stack.number,
          pending: false,
          onSelect: (target) =>
            selectEntry({
              projectId: target.projectId,
              repository: target.repository,
              number: target.number,
              host: entry.host,
              environmentId: entry.environmentId,
            }),
        });
        return null;
      },
      pullRequestsLoadMore: async () => {
        const frame = latest;
        if (frame === null) return null;
        setPage(
          resolvePullRequestsLoadMore({
            filterKey: frame.filterKey,
            pageSize: frame.pageSize,
            canContinue: frame.canContinue,
            nextCursors: frame.nextCursors,
            regrown: frame.regrown,
          }),
        );
        return null;
      },
      pullRequestsRefresh: async () => {
        await refreshFromHost();
        return null;
      },
      pullRequestsRetry: async () => {
        if (latest !== null) refreshTargets(latest.listTargets);
        return null;
      },
      pullRequestsAddProject: async () => {
        addProjectService(context).browse();
        return null;
      },
      pullRequestsTogglePanel: async () => {
        toggleRightPanel();
        return null;
      },
      pullRequestsVisibleRows: async (params) => {
        reportedVisible = new Set(KeysParams(params).keys);
        applyVisibleRows(reportedVisible);
        return null;
      },
      pullRequestsKeyDown: async (params) => {
        const event = KeyDownParams(params);
        const frame = latest;
        if (frame === null) return false;
        const shortcut = resolvePullRequestsFindShortcut({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          defaultPrevented: false,
          condensed: event.condensed,
        });
        if (shortcut.kind !== "none") {
          updateState((current) => ({
            ...current,
            searchFocus: {
              revision: (current.searchFocus?.revision ?? 0) + 1,
              target: shortcut.kind === "expand-condensed-search" ? "condensed" : "inline",
            },
          }));
          return true;
        }
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
        if (event.repeat) return command !== null;
        if (command === "rightPanel.close") {
          const surface = frame.activePullRequestSurface;
          if (surface === null || frame.rightPanelRef === null) return false;
          useRightPanelStore.getState().closeSurface(frame.rightPanelRef, surface.id);
          return true;
        }
        if (command === "rightPanel.toggle") {
          if (frame.selectedPullRequestSurface === null) return false;
          toggleRightPanel();
          return true;
        }
        if (command === "thread.copyReference") return copyPullRequestUrl();
        return false;
      },
      pullRequestsEscape: async () => {
        if (latest !== null) context.navigate(CHAT_PAGE);
        return null;
      },
    },
  };
}
