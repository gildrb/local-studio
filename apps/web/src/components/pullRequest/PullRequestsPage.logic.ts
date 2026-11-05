import type {
  EnvironmentId,
  EnvironmentMachineKind,
  ProjectId,
  PullRequestChecksState,
  PullRequestInvolvement,
  PullRequestListCursors,
  PullRequestListFilters,
  PullRequestListState,
  PullRequestProviderSummary,
  PullRequestStackMembership,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import {
  resolveChangeRequestPresentation,
  type ChangeRequestPresentation,
} from "@t3tools/shared/sourceControl";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  parsePullRequestQuery,
  pullRequestEntryKey,
  pullRequestLabelColor,
  scorePullRequestMatch,
  type EnvironmentPullRequestEntry,
  type PullRequestAuthorFacet,
  type PullRequestGroup,
  type PullRequestLabelFacet,
  type PullRequestStatsPolicy,
} from "./pullRequestList.logic";
import {
  pullRequestListPreferences,
  type PullRequestListPreferencePatch,
  type PullRequestListPreferences,
  type PullRequestListSort,
} from "./pullRequestListPreferences";
import {
  buildPullRequestActorModel,
  formatPullRequestDiffStat,
  openOnHostLabel,
  pullRequestChecksStateModel,
  pullRequestReviewDecisionModel,
  resolvePullRequestConflictModel,
  resolvePullRequestStateModel,
  type PullRequestActorModel,
  type PullRequestChecksStateModel,
  type PullRequestConflictModel,
  type PullRequestDiffStatModel,
  type PullRequestGlyphId,
  type PullRequestSignalModel,
  type PullRequestStateModel,
} from "./pullRequestPresentation.logic";

export const PULL_REQUESTS_PAGE_TITLE = "Pull Requests";
export const PULL_REQUESTS_SEARCH_DEBOUNCE_MS = 250;
export const PULL_REQUESTS_MATCHED_ELSEWHERE_SCORE = 10;
export const PULL_REQUESTS_PAGE_SIZE = 99;
export const PULL_REQUESTS_MAX_PAGE_SIZE = 500;
export const PULL_REQUESTS_GHOST_ROWS = 7;
export const PULL_REQUESTS_SEARCHING_GHOST_ROWS = 5;
export const PULL_REQUESTS_PANEL_UNAVAILABLE_LABEL = "Select a pull request first";

const QUERY_PREVIEW_LENGTH = 48;
const FILTER_UNSET_VALUE = "all";
const ALL_PROJECTS_VALUE = "all";
const ALL_HOSTS_VALUE = "";
const ALL_SERVERS_VALUE = "";
const MAX_FILTER_LABELS = 10;
const AUTHOR_FILTER_LIMIT = 10;

export type PullRequestFilterLucideId =
  | "layers"
  | "eye"
  | "eye-off"
  | "pen-line"
  | "users"
  | "list-checks"
  | "user-lock"
  | "clock"
  | "calendar-arrow-down"
  | "calendar-arrow-up"
  | "maximize"
  | "minimize"
  | "plug"
  | "circle-check"
  | "circle-x"
  | "circle-dashed"
  | "circle-slash"
  | "folder-git"
  | "arrow-down-up"
  | "list-filter"
  | "user-round"
  | "tag"
  | "search";

export type PullRequestFilterIcon =
  | { readonly kind: "lucide"; readonly id: PullRequestFilterLucideId }
  | { readonly kind: "glyph"; readonly id: PullRequestGlyphId }
  | { readonly kind: "provider"; readonly id: ChangeRequestPresentation["icon"] }
  | { readonly kind: "machine"; readonly id: EnvironmentMachineKind }
  | { readonly kind: "project"; readonly projectKey: string };

export type PullRequestFilterOptionModel<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly icon: PullRequestFilterIcon;
  readonly unavailable: string | null;
};

export type PullRequestSelectableOptionModel<Value extends string> =
  PullRequestFilterOptionModel<Value> & { readonly selected: boolean };

export const PULL_REQUEST_INVOLVEMENT_OPTIONS = [
  { value: "all", label: "All", icon: { kind: "lucide", id: "layers" }, unavailable: null },
  {
    value: "reviewing",
    label: "Reviewing",
    icon: { kind: "lucide", id: "eye" },
    unavailable: null,
  },
  {
    value: "authored",
    label: "Authored",
    icon: { kind: "lucide", id: "pen-line" },
    unavailable: null,
  },
] as const satisfies ReadonlyArray<PullRequestFilterOptionModel<PullRequestInvolvement>>;

export const PULL_REQUEST_STATE_OPTIONS = [
  { value: "all", label: "All", icon: { kind: "lucide", id: "layers" }, unavailable: null },
  { value: "open", label: "Open", icon: { kind: "glyph", id: "pullRequest" }, unavailable: null },
  { value: "closed", label: "Closed", icon: { kind: "glyph", id: "closed" }, unavailable: null },
  { value: "merged", label: "Merged", icon: { kind: "glyph", id: "merged" }, unavailable: null },
] as const satisfies ReadonlyArray<PullRequestFilterOptionModel<PullRequestListState>>;

export const PULL_REQUEST_SORT_OPTIONS = [
  {
    value: "ready",
    label: "Merge readiness",
    icon: { kind: "lucide", id: "list-checks" },
    unavailable: null,
  },
  {
    value: "blocked",
    label: "Blocked on me",
    icon: { kind: "lucide", id: "user-lock" },
    unavailable: null,
  },
  {
    value: "updated",
    label: "Recently updated",
    icon: { kind: "lucide", id: "clock" },
    unavailable: null,
  },
  {
    value: "newest",
    label: "Newest shown",
    icon: { kind: "lucide", id: "calendar-arrow-down" },
    unavailable: null,
  },
  {
    value: "oldest",
    label: "Oldest shown",
    icon: { kind: "lucide", id: "calendar-arrow-up" },
    unavailable: null,
  },
  {
    value: "largest",
    label: "Largest shown",
    icon: { kind: "lucide", id: "maximize" },
    unavailable: null,
  },
  {
    value: "smallest",
    label: "Smallest shown",
    icon: { kind: "lucide", id: "minimize" },
    unavailable: null,
  },
] as const satisfies ReadonlyArray<PullRequestFilterOptionModel<PullRequestListSort>>;

export const PULL_REQUEST_DRAFT_FILTER_OPTIONS = [
  { value: "all", label: "All", icon: { kind: "lucide", id: "layers" }, unavailable: null },
  { value: "only", label: "Drafts only", icon: { kind: "glyph", id: "draft" }, unavailable: null },
  {
    value: "hide",
    label: "Hide drafts",
    icon: { kind: "lucide", id: "eye-off" },
    unavailable: null,
  },
] as const satisfies ReadonlyArray<PullRequestFilterOptionModel<string>>;

export const PULL_REQUEST_REVIEW_FILTER_OPTIONS = [
  { value: "all", label: "All", icon: { kind: "lucide", id: "layers" }, unavailable: null },
  {
    value: "approved",
    label: "Approved",
    icon: { kind: "lucide", id: "circle-check" },
    unavailable: null,
  },
  {
    value: "changes-requested",
    label: "Changes requested",
    icon: { kind: "lucide", id: "circle-x" },
    unavailable: null,
  },
  {
    value: "review-required",
    label: "Review required",
    icon: { kind: "lucide", id: "circle-dashed" },
    unavailable: null,
  },
  {
    value: "none",
    label: "No reviews",
    icon: { kind: "lucide", id: "circle-slash" },
    unavailable: null,
  },
] as const satisfies ReadonlyArray<PullRequestFilterOptionModel<string>>;

export const PULL_REQUEST_CHECKS_FILTER_OPTIONS = [
  { value: "all", label: "All", icon: { kind: "lucide", id: "layers" }, unavailable: null },
  {
    value: "passing",
    label: "Passing",
    icon: { kind: "lucide", id: "circle-check" },
    unavailable: null,
  },
  {
    value: "failing",
    label: "Failing",
    icon: { kind: "lucide", id: "circle-x" },
    unavailable: null,
  },
] as const satisfies ReadonlyArray<PullRequestFilterOptionModel<string>>;

export const PULL_REQUEST_FILTERS_MENU_LABELS = {
  trigger: "Filters",
  state: "State",
  involvement: "Involvement",
  draft: "Draft",
  review: "Review",
  checks: "Checks",
  host: "Host",
  server: "Server",
  project: "Project",
} as const;

export type PullRequestGroupIconId = "pen-line" | "eye" | "users" | "layers";

const GROUP_ICONS: Partial<Record<string, PullRequestGroupIconId>> = {
  authored: "pen-line",
  reviewRequested: "eye",
  others: "users",
};

export type PullRequestsSearch = PullRequestListPreferences & {
  readonly repository?: string;
  readonly number?: number;
  readonly selectedProjectId?: ProjectId;
  readonly selectedHost?: string;
  readonly selectedEnvironmentId?: EnvironmentId;
};

export type PullRequestsSearchPatch = {
  [Key in keyof PullRequestsSearch]?: PullRequestsSearch[Key] | undefined;
};

export const PULL_REQUESTS_CLEARED_SELECTION = {
  repository: undefined,
  number: undefined,
  selectedProjectId: undefined,
  selectedEnvironmentId: undefined,
  selectedHost: undefined,
} as const satisfies PullRequestsSearchPatch;

export function pullRequestCurrentFilterOption<Option extends { readonly value: string }>(
  options: ReadonlyArray<Option>,
  value: string,
): Option | undefined {
  return options.find((option) => option.value === value) ?? options[0];
}

export function parsePullRequestListSort(value: unknown): PullRequestListSort | undefined {
  return PULL_REQUEST_SORT_OPTIONS.find((option) => option.value === value)?.value;
}

export function buildPullRequestsSearch(
  previous: PullRequestsSearch,
  patch: PullRequestsSearchPatch,
): PullRequestsSearch {
  const next = { ...previous, ...patch };
  return {
    involvement: next.involvement ?? previous.involvement,
    state: next.state ?? previous.state,
    ...(next.sort && next.sort !== "ready" ? { sort: next.sort } : {}),
    ...(next.repository ? { repository: next.repository } : {}),
    ...(next.number ? { number: next.number } : {}),
    ...(next.projectId ? { projectId: next.projectId } : {}),
    ...(next.environmentId ? { environmentId: next.environmentId } : {}),
    ...(next.host ? { host: next.host } : {}),
    ...(next.selectedHost ? { selectedHost: next.selectedHost } : {}),
    ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
    ...(next.selectedEnvironmentId ? { selectedEnvironmentId: next.selectedEnvironmentId } : {}),
    ...(next.q ? { q: next.q } : {}),
    ...(next.draft ? { draft: next.draft } : {}),
    ...(next.review ? { review: next.review } : {}),
    ...(next.checks ? { checks: next.checks } : {}),
    ...(next.author ? { author: next.author } : {}),
    ...(next.labels && next.labels.length > 0 ? { labels: next.labels } : {}),
  };
}

export type PullRequestListScopeChange = {
  readonly kind: "update-list-scope";
  readonly preferences: PullRequestListPreferences;
  readonly patch: PullRequestListPreferencePatch;
};

export function resolvePullRequestListScopeChange(
  search: PullRequestsSearch,
  patch: PullRequestListPreferencePatch,
): PullRequestListScopeChange {
  return {
    kind: "update-list-scope",
    preferences: pullRequestListPreferences({
      ...search,
      ...patch,
      involvement: patch.involvement ?? search.involvement,
      state: patch.state ?? search.state,
    }),
    patch,
  };
}

export type PullRequestMenuFilterFields = {
  readonly [Key in "draft" | "review" | "checks" | "author" | "labels"]?:
    | PullRequestListPreferences[Key]
    | undefined;
};

export function pullRequestMenuFilters(
  search: PullRequestMenuFilterFields,
): PullRequestListFilters {
  return {
    ...(search.draft ? { draft: search.draft } : {}),
    ...(search.review ? { review: search.review } : {}),
    ...(search.checks ? { checks: search.checks } : {}),
    ...(search.author ? { author: search.author } : {}),
    ...(search.labels ? { labels: search.labels.map((label) => [label]) } : {}),
  };
}

export function pullRequestFiltersSearchPatch(
  filters: PullRequestListFilters,
): PullRequestListPreferencePatch {
  return {
    draft: filters.draft,
    review: filters.review,
    checks: filters.checks,
    author: filters.author,
    labels: filters.labels?.flatMap((group) => group),
  };
}

export type PullRequestListFiltersPatch = {
  readonly [Key in keyof PullRequestListFilters]?: PullRequestListFilters[Key] | undefined;
};

export function applyPullRequestListFiltersPatch(
  filters: PullRequestListFilters,
  patch: PullRequestListFiltersPatch,
): PullRequestListFilters {
  const draft = "draft" in patch ? patch.draft : filters.draft;
  const review = "review" in patch ? patch.review : filters.review;
  const checks = "checks" in patch ? patch.checks : filters.checks;
  const labels = "labels" in patch ? patch.labels : filters.labels;
  const excludedLabels = "excludedLabels" in patch ? patch.excludedLabels : filters.excludedLabels;
  const author = "author" in patch ? patch.author : filters.author;
  return {
    ...(draft === undefined ? {} : { draft }),
    ...(review === undefined ? {} : { review }),
    ...(checks === undefined ? {} : { checks }),
    ...(labels === undefined ? {} : { labels }),
    ...(excludedLabels === undefined ? {} : { excludedLabels }),
    ...(author === undefined ? {} : { author }),
  };
}

export type PullRequestFilterGroup = "draft" | "review" | "checks";

function pickFilterValue<Value extends string>(
  values: ReadonlyArray<Value>,
  value: string,
): Value | undefined {
  return values.find((candidate) => candidate === value);
}

export function resolvePullRequestFilterGroupChange(
  filters: PullRequestListFilters,
  group: PullRequestFilterGroup,
  value: string,
): PullRequestListFilters {
  switch (group) {
    case "draft":
      return applyPullRequestListFiltersPatch(filters, {
        draft: pickFilterValue(["only", "hide"], value),
      });
    case "review":
      return applyPullRequestListFiltersPatch(filters, {
        review: pickFilterValue(
          ["approved", "changes-requested", "review-required", "none"],
          value,
        ),
      });
    case "checks":
      return applyPullRequestListFiltersPatch(filters, {
        checks: pickFilterValue(["passing", "failing"], value),
      });
  }
}

export function pullRequestFilterGroupValue(
  filters: PullRequestListFilters,
  group: PullRequestFilterGroup,
): string {
  return filters[group] ?? FILTER_UNSET_VALUE;
}

export function resolvePullRequestLabelFilterChange(
  filters: PullRequestListFilters,
  labels: ReadonlyArray<string>,
): PullRequestListFilters {
  return applyPullRequestListFiltersPatch(filters, {
    labels:
      labels.length === 0 ? undefined : labels.slice(0, MAX_FILTER_LABELS).map((label) => [label]),
  });
}

export function resolvePullRequestLabelToggle(
  selected: ReadonlyArray<string>,
  name: string,
  checked: boolean,
): ReadonlyArray<string> {
  return checked
    ? [...selected, name]
    : selected.filter((candidate) => candidate.toLowerCase() !== name.toLowerCase());
}

export function resolvePullRequestHostFilter(value: string): string | undefined {
  return value === ALL_HOSTS_VALUE ? undefined : value;
}

export function resolvePullRequestServerFilter(
  value: string,
  serverIds: ReadonlyArray<EnvironmentId>,
): EnvironmentId | undefined {
  if (value === ALL_SERVERS_VALUE) return undefined;
  return serverIds.find((environmentId) => environmentId === value);
}

export function pullRequestProjectKey(project: {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
}): string {
  return JSON.stringify([project.environmentId, project.id]);
}

export type PullRequestFilterProject = {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
};

export function pullRequestProjectFilterValue(
  projectId: ProjectId | undefined,
  projectEnvironmentId: EnvironmentId | undefined,
): string {
  return projectId === undefined || projectEnvironmentId === undefined
    ? ALL_PROJECTS_VALUE
    : pullRequestProjectKey({ id: projectId, environmentId: projectEnvironmentId });
}

export function buildPullRequestProjectFilterOptions<Project extends PullRequestFilterProject>(
  projects: ReadonlyArray<Project>,
  unavailable: ReadonlyMap<string, string>,
): ReadonlyArray<PullRequestFilterOptionModel<string> & { readonly project: Project | null }> {
  return [
    {
      value: ALL_PROJECTS_VALUE,
      label: "All projects",
      icon: { kind: "lucide", id: "layers" },
      unavailable: null,
      project: null,
    },
    ...projects
      .toSorted(
        (left, right) =>
          Number(unavailable.has(pullRequestProjectKey(left))) -
          Number(unavailable.has(pullRequestProjectKey(right))),
      )
      .map((project) => {
        const projectKey = pullRequestProjectKey(project);
        return {
          value: projectKey,
          label: project.title,
          icon: { kind: "project", projectKey } satisfies PullRequestFilterIcon,
          unavailable: unavailable.get(projectKey) ?? null,
          project,
        };
      }),
  ];
}

export type PullRequestProjectSelection =
  | {
      readonly kind: "select";
      readonly projectId: ProjectId;
      readonly environmentId: EnvironmentId;
    }
  | { readonly kind: "clear" }
  | { readonly kind: "none" };

export function resolvePullRequestProjectSelection(
  projects: ReadonlyArray<PullRequestFilterProject>,
  projectId: ProjectId | undefined,
  value: string,
): PullRequestProjectSelection {
  const project = projects.find((candidate) => pullRequestProjectKey(candidate) === value);
  if (project) {
    return { kind: "select", projectId: project.id, environmentId: project.environmentId };
  }
  return projectId === undefined ? { kind: "none" } : { kind: "clear" };
}

export function countPullRequestFilters(input: {
  readonly state: PullRequestListState;
  readonly involvement: PullRequestInvolvement;
  readonly host: string | undefined;
  readonly server: EnvironmentId | undefined;
  readonly projectId: ProjectId | undefined;
  readonly filters: PullRequestListFilters;
}): number {
  const selectedLabels = (input.filters.labels ?? []).flatMap((group) => group);
  return [
    input.state !== "open",
    input.involvement !== "all",
    input.host,
    input.server,
    input.projectId,
    input.filters.draft,
    input.filters.review,
    input.filters.checks,
    input.filters.author,
    ...selectedLabels,
  ].filter(Boolean).length;
}

export type PullRequestAuthorFilterRowModel = {
  readonly key: string;
  readonly login: string;
  readonly actor: PullRequestActorModel;
  readonly mergedLabel: string;
};

export type PullRequestAuthorFilterModel = {
  readonly label: string;
  readonly summary: string;
  readonly searchPlaceholder: string;
  readonly anyoneLabel: string;
  readonly value: string;
  readonly rows: ReadonlyArray<PullRequestAuthorFilterRowModel>;
  readonly emptyLabel: string | null;
};

export function buildPullRequestAuthorFilterModel(input: {
  readonly value: string | undefined;
  readonly options: ReadonlyArray<PullRequestAuthorFacet>;
  readonly query: string;
}): PullRequestAuthorFilterModel {
  const needle = input.query.trim().toLowerCase();
  const login = input.value?.toLowerCase() ?? "";
  const selected = input.options.find((option) => option.actor.login.toLowerCase() === login);
  const visible = [
    ...(selected ? [selected] : []),
    ...input.options.filter(
      (option) =>
        option !== selected &&
        (needle.length === 0 ||
          option.actor.login.toLowerCase().includes(needle) ||
          option.actor.name?.toLowerCase().includes(needle)),
    ),
  ].slice(0, AUTHOR_FILTER_LIMIT);
  return {
    label: "Author",
    summary: input.value ?? "Anyone",
    searchPlaceholder: "Search authors",
    anyoneLabel: "Anyone",
    value: selected?.actor.login ?? input.value ?? "",
    rows: visible.map((option) => ({
      key: option.actor.login.toLowerCase(),
      login: option.actor.login,
      actor: buildPullRequestActorModel(option.actor),
      mergedLabel: `${option.mergedCount} merges loaded`,
    })),
    emptyLabel: visible.length === 0 ? "No authors found" : null,
  };
}

export type PullRequestAuthorSelection =
  | { readonly kind: "none" }
  | { readonly kind: "set"; readonly author: string | undefined };

export function resolvePullRequestAuthorSelection(
  current: string | undefined,
  next: string,
): PullRequestAuthorSelection {
  if (next.toLowerCase() === (current?.toLowerCase() ?? "")) return { kind: "none" };
  return { kind: "set", author: next || undefined };
}

export type PullRequestLabelFilterRowModel = {
  readonly key: string;
  readonly name: string;
  readonly color: string | null;
  readonly countLabel: string;
  readonly checked: boolean;
};

export type PullRequestLabelFilterModel = {
  readonly label: string;
  readonly summary: string;
  readonly rows: ReadonlyArray<PullRequestLabelFilterRowModel>;
  readonly emptyLabel: string | null;
};

export function buildPullRequestLabelFilterModel(input: {
  readonly value: ReadonlyArray<string>;
  readonly options: ReadonlyArray<PullRequestLabelFacet>;
}): PullRequestLabelFilterModel {
  const selected = new Set(input.value.map((name) => name.toLowerCase()));
  const visible = [
    ...input.value
      .filter(
        (name) => !input.options.some((option) => option.name.toLowerCase() === name.toLowerCase()),
      )
      .map((name) => ({ name, color: null, count: 0 })),
    ...input.options,
  ];
  return {
    label: "Labels",
    summary: input.value.length === 0 ? "Any" : `${input.value.length} selected`,
    rows: visible.map((option) => {
      const key = option.name.toLowerCase();
      return {
        key,
        name: option.name,
        color: pullRequestLabelColor(option.color),
        countLabel: String(option.count),
        checked: selected.has(key),
      };
    }),
    emptyLabel: visible.length === 0 ? "No labels in this view" : null,
  };
}

export type PullRequestExpectedHost = {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
};

export function pullRequestProviderPresentation(
  kind: SourceControlProviderKind,
): ChangeRequestPresentation {
  return resolveChangeRequestPresentation({ kind, name: "", baseUrl: "" });
}

export function pullRequestHostLabel(
  entries: ReadonlyArray<{ readonly host: string; readonly kind: SourceControlProviderKind }>,
  entry: { readonly host: string; readonly kind: SourceControlProviderKind },
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1 ? entry.host : pullRequestProviderPresentation(entry.kind).providerName;
}

export function buildPullRequestHostOptions(input: {
  readonly hosts: ReadonlyArray<PullRequestProviderSummary>;
  readonly expectedHosts: ReadonlyArray<PullRequestExpectedHost>;
}): ReadonlyArray<PullRequestFilterOptionModel<string>> {
  const hostEntries = input.hosts.length > 0 ? input.hosts : input.expectedHosts;
  return [
    {
      value: ALL_HOSTS_VALUE,
      label: "All",
      icon: { kind: "lucide", id: "plug" },
      unavailable: null,
    },
    ...hostEntries.map((entry) => {
      const summary = input.hosts.find((host) => host.host === entry.host);
      return {
        value: entry.host,
        label: pullRequestHostLabel(hostEntries, entry),
        icon: {
          kind: "provider",
          id: pullRequestProviderPresentation(entry.kind).icon,
        } satisfies PullRequestFilterIcon,
        unavailable:
          summary === undefined || summary.configured
            ? null
            : (summary.detail ?? "This host could not be read."),
      };
    }),
  ];
}

export type PullRequestsEnvironmentOption = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machineKind: EnvironmentMachineKind;
};

export function buildPullRequestServerOptions(
  environments: ReadonlyArray<PullRequestsEnvironmentOption>,
): ReadonlyArray<PullRequestFilterOptionModel<string>> {
  return [
    {
      value: ALL_SERVERS_VALUE,
      label: "All servers",
      icon: { kind: "lucide", id: "layers" },
      unavailable: null,
    },
    ...environments.map((environment) => ({
      value: environment.environmentId,
      label: environment.label,
      icon: { kind: "machine", id: environment.machineKind } satisfies PullRequestFilterIcon,
      unavailable: null,
    })),
  ];
}

export type PullRequestFilterSubmenuModel = {
  readonly label: string;
  readonly value: string;
  readonly current: PullRequestFilterOptionModel<string> | null;
  readonly options: ReadonlyArray<PullRequestSelectableOptionModel<string>>;
};

function buildFilterSubmenu<Value extends string>(
  label: string,
  value: Value,
  options: ReadonlyArray<PullRequestFilterOptionModel<Value>>,
): PullRequestFilterSubmenuModel {
  return {
    label,
    value,
    current: pullRequestCurrentFilterOption(options, value) ?? null,
    options: options.map((option) => ({ ...option, selected: option.value === value })),
  };
}

export type PullRequestFiltersMenuInput = {
  readonly state: PullRequestListState;
  readonly involvement: PullRequestInvolvement;
  readonly filters: PullRequestListFilters;
  readonly authorOptions: ReadonlyArray<PullRequestAuthorFacet>;
  readonly authorQuery: string;
  readonly labelOptions: ReadonlyArray<PullRequestLabelFacet>;
  readonly host: string | undefined;
  readonly hostOptions: ReadonlyArray<PullRequestFilterOptionModel<string>>;
  readonly server: EnvironmentId | undefined;
  readonly serverOptions: ReadonlyArray<PullRequestFilterOptionModel<string>>;
  readonly projects: ReadonlyArray<PullRequestFilterProject>;
  readonly projectId: ProjectId | undefined;
  readonly projectEnvironmentId: EnvironmentId | undefined;
  readonly unavailable: ReadonlyMap<string, string>;
};

export type PullRequestFiltersMenuModel = {
  readonly triggerLabel: string;
  readonly triggerIcon: PullRequestFilterIcon;
  readonly count: number;
  readonly countLabel: string | null;
  readonly state: PullRequestFilterSubmenuModel;
  readonly involvement: PullRequestFilterSubmenuModel;
  readonly author: PullRequestAuthorFilterModel;
  readonly labels: PullRequestLabelFilterModel;
  readonly draft: PullRequestFilterSubmenuModel;
  readonly review: PullRequestFilterSubmenuModel;
  readonly checks: PullRequestFilterSubmenuModel;
  readonly host: PullRequestFilterSubmenuModel | null;
  readonly server: PullRequestFilterSubmenuModel | null;
  readonly project: PullRequestFilterSubmenuModel;
};

export function buildPullRequestFiltersMenuModel(
  input: PullRequestFiltersMenuInput,
): PullRequestFiltersMenuModel {
  const count = countPullRequestFilters({
    state: input.state,
    involvement: input.involvement,
    host: input.host,
    server: input.server,
    projectId: input.projectId,
    filters: input.filters,
  });
  const projectOptions = buildPullRequestProjectFilterOptions(
    input.projects,
    input.unavailable,
  ).map(({ value, label, icon, unavailable }) => ({ value, label, icon, unavailable }));
  return {
    triggerLabel: PULL_REQUEST_FILTERS_MENU_LABELS.trigger,
    triggerIcon: { kind: "lucide", id: "list-filter" },
    count,
    countLabel: count > 0 ? String(count) : null,
    state: buildFilterSubmenu(
      PULL_REQUEST_FILTERS_MENU_LABELS.state,
      input.state,
      PULL_REQUEST_STATE_OPTIONS,
    ),
    involvement: buildFilterSubmenu(
      PULL_REQUEST_FILTERS_MENU_LABELS.involvement,
      input.involvement,
      PULL_REQUEST_INVOLVEMENT_OPTIONS,
    ),
    author: buildPullRequestAuthorFilterModel({
      value: input.filters.author,
      options: input.authorOptions,
      query: input.authorQuery,
    }),
    labels: buildPullRequestLabelFilterModel({
      value: (input.filters.labels ?? []).flatMap((group) => group),
      options: input.labelOptions,
    }),
    draft: buildFilterSubmenu(
      PULL_REQUEST_FILTERS_MENU_LABELS.draft,
      pullRequestFilterGroupValue(input.filters, "draft"),
      PULL_REQUEST_DRAFT_FILTER_OPTIONS,
    ),
    review: buildFilterSubmenu(
      PULL_REQUEST_FILTERS_MENU_LABELS.review,
      pullRequestFilterGroupValue(input.filters, "review"),
      PULL_REQUEST_REVIEW_FILTER_OPTIONS,
    ),
    checks: buildFilterSubmenu(
      PULL_REQUEST_FILTERS_MENU_LABELS.checks,
      pullRequestFilterGroupValue(input.filters, "checks"),
      PULL_REQUEST_CHECKS_FILTER_OPTIONS,
    ),
    host:
      input.hostOptions.length > 2
        ? buildFilterSubmenu(
            PULL_REQUEST_FILTERS_MENU_LABELS.host,
            input.host ?? ALL_HOSTS_VALUE,
            input.hostOptions,
          )
        : null,
    server:
      input.serverOptions.length > 2
        ? buildFilterSubmenu(
            PULL_REQUEST_FILTERS_MENU_LABELS.server,
            input.server ?? ALL_SERVERS_VALUE,
            input.serverOptions,
          )
        : null,
    project: buildFilterSubmenu(
      PULL_REQUEST_FILTERS_MENU_LABELS.project,
      pullRequestProjectFilterValue(input.projectId, input.projectEnvironmentId),
      projectOptions,
    ),
  };
}

export type PullRequestCompactMenuPresentation = "icon" | "trigger-label" | "current-label";

export type PullRequestCompactMenuModel<Value extends string> = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly title: string | null;
  readonly presentation: PullRequestCompactMenuPresentation;
  readonly triggerLabel: string | null;
  readonly triggerIcon: PullRequestFilterIcon | null;
  readonly outlined: boolean;
  readonly value: Value;
  readonly current: PullRequestFilterOptionModel<Value>;
  readonly options: ReadonlyArray<PullRequestSelectableOptionModel<Value>>;
};

export function buildPullRequestCompactMenuModel<Value extends string>(input: {
  readonly label: string;
  readonly value: Value;
  readonly options: ReadonlyArray<PullRequestFilterOptionModel<Value>>;
  readonly triggerLabel?: string;
  readonly triggerIcon?: PullRequestFilterIcon;
  readonly outlined?: boolean;
  readonly iconOnly?: boolean;
}): PullRequestCompactMenuModel<Value> | null {
  const current = pullRequestCurrentFilterOption(input.options, input.value);
  if (!current) return null;
  const iconOnly = input.iconOnly ?? false;
  const triggerLabel = input.triggerLabel ?? null;
  const namedLabel = `${input.label}: ${current.label}`;
  return {
    label: input.label,
    ariaLabel: triggerLabel || iconOnly ? namedLabel : input.label,
    title: iconOnly ? namedLabel : null,
    presentation: iconOnly ? "icon" : triggerLabel ? "trigger-label" : "current-label",
    triggerLabel,
    triggerIcon: input.triggerIcon ?? null,
    outlined: input.outlined ?? false,
    value: input.value,
    current,
    options: input.options.map((option) => ({ ...option, selected: option.value === input.value })),
  };
}

export function resolvePullRequestCompactMenuChange<Value extends string>(
  menu: PullRequestCompactMenuModel<Value>,
  next: unknown,
): Value | undefined {
  return menu.options.find((option) => option.value === next)?.value;
}

export type PullRequestRowLabelModel = {
  readonly name: string;
  readonly color: string | null;
  readonly overflowLabel: string | null;
};

export type PullRequestRowSelection = {
  readonly environmentId: string | undefined;
  readonly repository: string;
  readonly number: number;
  readonly host?: string | undefined;
};

export type PullRequestRowInput = {
  readonly entry: EnvironmentPullRequestEntry;
  readonly selected: boolean;
  readonly showProjectTitle: boolean;
  readonly showProvider: boolean;
  readonly environmentLabel?: string | undefined;
  readonly matchedElsewhere?: boolean | undefined;
  readonly nowMs: number;
  readonly locale?: string | undefined;
};

export type PullRequestRowModel = {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly numberLabel: string;
  readonly title: string;
  readonly url: string;
  readonly openOnHostLabel: string;
  readonly selected: boolean;
  readonly state: PullRequestStateModel;
  readonly conflict: PullRequestConflictModel | null;
  readonly checks:
    | (PullRequestChecksStateModel & { readonly state: PullRequestChecksState })
    | null;
  readonly reviewDecision: PullRequestSignalModel | null;
  readonly stack: PullRequestStackMembership | null;
  readonly diffStat: PullRequestDiffStatModel | null;
  readonly matchedElsewhere: { readonly label: string; readonly tooltip: string } | null;
  readonly provider: {
    readonly name: string;
    readonly icon: ChangeRequestPresentation["icon"];
  } | null;
  readonly author: PullRequestActorModel;
  readonly repositoryLabel: string | null;
  readonly environmentLabel: string | null;
  readonly labels: ReadonlyArray<PullRequestRowLabelModel>;
  readonly updatedLabel: string | null;
};

const ROW_LABEL_SLOTS = 3;

export function buildPullRequestRowModel(input: PullRequestRowInput): PullRequestRowModel {
  const { entry } = input;
  const provider = pullRequestProviderPresentation(entry.provider);
  return {
    key: pullRequestEntryKey(entry),
    environmentId: entry.environmentId,
    projectId: entry.projectId,
    host: entry.host,
    repository: entry.repository,
    number: entry.number,
    numberLabel: `#${entry.number}`,
    title: entry.title,
    url: entry.url,
    openOnHostLabel: openOnHostLabel(entry.provider),
    selected: input.selected,
    state: resolvePullRequestStateModel(entry),
    conflict: resolvePullRequestConflictModel({
      state: entry.state,
      isDraft: entry.isDraft,
      mergeability: entry.mergeability,
      baseBranch: entry.baseBranch,
    }),
    checks:
      entry.checksState === undefined
        ? null
        : { state: entry.checksState, ...pullRequestChecksStateModel(entry.checksState) },
    reviewDecision:
      entry.reviewDecision === undefined
        ? null
        : pullRequestReviewDecisionModel(entry.reviewDecision),
    stack: entry.stack ?? null,
    diffStat: formatPullRequestDiffStat(entry.additions, entry.deletions, input.locale),
    matchedElsewhere: input.matchedElsewhere
      ? { label: "matched in the description", tooltip: "Matched in the description" }
      : null,
    provider: input.showProvider ? { name: provider.providerName, icon: provider.icon } : null,
    author: buildPullRequestActorModel(entry.author),
    repositoryLabel: input.showProjectTitle ? entry.repository : null,
    environmentLabel: input.environmentLabel ? input.environmentLabel : null,
    labels: entry.labels.slice(0, ROW_LABEL_SLOTS).map((label, index) => {
      const remaining = entry.labels.length - index - 1;
      return {
        name: label.name,
        color: pullRequestLabelColor(label.color),
        overflowLabel: remaining > 0 ? `+${remaining}` : null,
      };
    }),
    updatedLabel: entry.updatedAt ? formatRelativeTimeLabel(entry.updatedAt, input.nowMs) : null,
  };
}

export function isPullRequestRowSelected(
  selected: PullRequestRowSelection | null,
  entry: Pick<EnvironmentPullRequestEntry, "environmentId" | "repository" | "host" | "number">,
): boolean {
  return (
    selected?.environmentId === entry.environmentId &&
    selected.repository === entry.repository &&
    selected.host?.toLowerCase() === entry.host.toLowerCase() &&
    selected.number === entry.number
  );
}

export function isPullRequestMatchedElsewhere(
  entry: EnvironmentPullRequestEntry,
  queryText: string,
): boolean {
  return (
    queryText.length > 0 &&
    scorePullRequestMatch(entry, queryText) <= PULL_REQUESTS_MATCHED_ELSEWHERE_SCORE
  );
}

export type PullRequestGroupModel = {
  readonly key: string;
  readonly label: string;
  readonly showHeader: boolean;
  readonly icon: PullRequestGroupIconId;
  readonly count: number;
  readonly countLabel: string;
  readonly rows: ReadonlyArray<PullRequestRowModel>;
};

export function buildPullRequestGroupModel(input: {
  readonly group: PullRequestGroup<EnvironmentPullRequestEntry>;
  readonly row: (entry: EnvironmentPullRequestEntry) => PullRequestRowInput;
}): PullRequestGroupModel {
  const { group } = input;
  return {
    key: group.key,
    label: group.label,
    showHeader: group.label.length > 0,
    icon: GROUP_ICONS[group.key] ?? "layers",
    count: group.entries.length,
    countLabel: String(group.entries.length),
    rows: group.entries.map((entry) => buildPullRequestRowModel(input.row(entry))),
  };
}

export type PullRequestListGhostModel = {
  readonly rows: number;
  readonly caption: string | null;
  readonly label: string;
};

export function buildPullRequestListGhostModel(
  rows: number = PULL_REQUESTS_GHOST_ROWS,
  caption: string | null = null,
): PullRequestListGhostModel {
  return { rows, caption, label: caption ?? "Loading pull requests" };
}

export type PullRequestsRetryModel = {
  readonly label: string;
  readonly refreshing: boolean;
  readonly disabled: boolean;
};

export type PullRequestsUnavailableModel = {
  readonly title: string;
  readonly description: string;
  readonly retry: PullRequestsRetryModel | null;
};

export type PullRequestListEmptyInput = {
  readonly query: string;
  readonly filtered: boolean;
  readonly searching: boolean;
  readonly hasProjects: boolean;
  readonly canLoadMore: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
};

export type PullRequestsActionButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
};

export type PullRequestListEmptyModel =
  | {
      readonly kind: "no-projects";
      readonly title: string;
      readonly description: string;
      readonly addProject: PullRequestsActionButtonModel;
    }
  | { readonly kind: "searching"; readonly ghost: PullRequestListGhostModel }
  | {
      readonly kind: "no-matches";
      readonly title: string;
      readonly description: string;
      readonly clearSearch: PullRequestsActionButtonModel;
      readonly refresh: PullRequestsActionButtonModel;
    }
  | {
      readonly kind: "empty";
      readonly title: string;
      readonly description: string;
      readonly loadMore: PullRequestsActionButtonModel | null;
      readonly refresh: PullRequestsActionButtonModel;
    };

function previewQuery(query: string): string {
  return query.length > QUERY_PREVIEW_LENGTH ? `${query.slice(0, QUERY_PREVIEW_LENGTH)}…` : query;
}

function checkAgainButton(refreshing: boolean): PullRequestsActionButtonModel {
  return {
    label: refreshing ? "Checking..." : "Check again",
    disabled: refreshing,
    busy: refreshing,
  };
}

export function buildPullRequestListEmptyModel(
  input: PullRequestListEmptyInput,
): PullRequestListEmptyModel {
  if (!input.hasProjects) {
    return {
      kind: "no-projects",
      title: "No projects in this workspace",
      description: "Add a project, and the pull requests from its repository appear here.",
      addProject: { label: "Add project", disabled: false, busy: false },
    };
  }
  if (input.searching) {
    return {
      kind: "searching",
      ghost: buildPullRequestListGhostModel(
        PULL_REQUESTS_SEARCHING_GHOST_ROWS,
        `Searching every host for “${previewQuery(input.query)}”`,
      ),
    };
  }
  if (input.query.length > 0) {
    return {
      kind: "no-matches",
      title: `Nothing matches “${previewQuery(input.query)}”`,
      description:
        "The hosts were searched for it. Try fewer words, or search by number, author or branch.",
      clearSearch: { label: "Clear search", disabled: false, busy: false },
      refresh: checkAgainButton(input.refreshing),
    };
  }
  return {
    kind: "empty",
    title: input.filtered ? "Nothing under these filters" : "No pull requests",
    description: input.filtered
      ? "Widen the state, involvement or project filter to see more."
      : "Pull requests from every project in this workspace appear here.",
    loadMore: input.canLoadMore
      ? {
          label: input.loadingMore ? "Loading..." : "Load more pull requests",
          disabled: input.loadingMore,
          busy: input.loadingMore,
        }
      : null,
    refresh: checkAgainButton(input.refreshing),
  };
}

export type PullRequestsBodyModel =
  | { readonly kind: "ghost"; readonly ghost: PullRequestListGhostModel }
  | { readonly kind: "unavailable"; readonly unavailable: PullRequestsUnavailableModel }
  | { readonly kind: "empty"; readonly empty: PullRequestListEmptyModel }
  | { readonly kind: "list"; readonly groups: ReadonlyArray<PullRequestGroupModel> };

export type PullRequestsFooterModel =
  | { readonly kind: "loading"; readonly label: string }
  | { readonly kind: "load-more"; readonly label: string; readonly disabled: boolean }
  | { readonly kind: "exhausted"; readonly label: string };

export type PullRequestsErrorBannerModel = {
  readonly message: string;
  readonly retryLabel: string;
};

export type PullRequestsSearchFieldModel = {
  readonly value: string;
  readonly busy: boolean;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly expandLabel: string;
};

export type PullRequestsRefreshModel = {
  readonly label: string;
  readonly refreshing: boolean;
  readonly disabled: boolean;
};

export type PullRequestsPageInput = {
  readonly search: PullRequestsSearch;
  readonly capabilityKnown: boolean;
  readonly pullRequestsSupported: boolean;
  readonly projectsKnown: boolean;
  readonly projectCount: number;
  readonly projectScoped: boolean;
  readonly querySettled: boolean;
  readonly showingCarried: boolean;
  readonly listPending: boolean;
  readonly hasListData: boolean;
  readonly listError: string | null;
  readonly invalidating: boolean;
  readonly groups: ReadonlyArray<PullRequestGroup<EnvironmentPullRequestEntry>>;
  readonly loadedEntryCount: number;
  readonly truncated: boolean;
  readonly canContinue: boolean;
  readonly continuing: boolean;
  readonly pageSize: number;
  readonly hosts: ReadonlyArray<PullRequestProviderSummary>;
  readonly expectedHosts: ReadonlyArray<PullRequestExpectedHost>;
  readonly environments: ReadonlyArray<PullRequestsEnvironmentOption>;
  readonly environmentLabels: ReadonlyMap<string, string>;
  readonly scopedEnvironmentId: EnvironmentId | undefined;
  readonly filtersMenu: Omit<
    PullRequestFiltersMenuInput,
    "state" | "involvement" | "filters" | "host" | "hostOptions" | "server" | "serverOptions"
  >;
  readonly selected: PullRequestRowSelection | null;
  readonly nowMs: number;
  readonly locale?: string | undefined;
};

export type PullRequestsPageModel = {
  readonly title: string;
  readonly breadcrumbLabel: string;
  readonly condensedBreadcrumbLabel: string;
  readonly panelUnavailableLabel: string;
  readonly search: PullRequestsSearchFieldModel;
  readonly sortMenu: PullRequestCompactMenuModel<PullRequestListSort> | null;
  readonly providerMenu: PullRequestCompactMenuModel<string> | null;
  readonly condensed: {
    readonly stateMenu: PullRequestCompactMenuModel<PullRequestListState> | null;
    readonly involvementMenu: PullRequestCompactMenuModel<PullRequestInvolvement> | null;
    readonly hostMenu: PullRequestCompactMenuModel<string> | null;
  };
  readonly filtersMenu: PullRequestFiltersMenuModel;
  readonly hostOptions: ReadonlyArray<PullRequestFilterOptionModel<string>>;
  readonly serverOptions: ReadonlyArray<PullRequestFilterOptionModel<string>>;
  readonly refresh: PullRequestsRefreshModel;
  readonly showProvider: boolean;
  readonly shownCount: number;
  readonly body: PullRequestsBodyModel;
  readonly errorBanner: PullRequestsErrorBannerModel | null;
  readonly footer: PullRequestsFooterModel | null;
};

export function buildPullRequestsPageModel(input: PullRequestsPageInput): PullRequestsPageModel {
  const { search } = input;
  const sort = search.sort ?? "ready";
  const typedQuery = (search.q ?? "").trim();
  const queryText = parsePullRequestQuery(typedQuery).text;
  const searchBusy = typedQuery.length > 0 && (!input.querySettled || input.showingCarried);
  const refreshing = input.invalidating || input.listPending;
  const firstLoad = input.listPending && !input.hasListData;
  const loadingMore = input.listPending && input.hasListData;
  const shownCount = input.groups.reduce((count, group) => count + group.entries.length, 0);
  const carriedToNothing =
    input.showingCarried && input.listPending && shownCount === 0 && typedQuery.length === 0;
  const canGrow = input.canContinue || input.pageSize < PULL_REQUESTS_MAX_PAGE_SIZE;
  const showProvider = input.hosts.length > 1;
  const showEnvironmentLabels = input.environments.length > 1;
  const hostOptions = buildPullRequestHostOptions({
    hosts: input.hosts,
    expectedHosts: input.expectedHosts,
  });
  const serverOptions = buildPullRequestServerOptions(input.environments);
  const filters = pullRequestMenuFilters(search);

  const rowInput = (entry: EnvironmentPullRequestEntry): PullRequestRowInput => ({
    entry,
    selected: isPullRequestRowSelected(input.selected, entry),
    showProjectTitle: true,
    showProvider,
    environmentLabel: showEnvironmentLabels
      ? input.environmentLabels.get(entry.environmentId)
      : undefined,
    matchedElsewhere: isPullRequestMatchedElsewhere(entry, queryText),
    nowMs: input.nowMs,
    locale: input.locale,
  });

  const body: PullRequestsBodyModel = !input.capabilityKnown
    ? { kind: "ghost", ghost: buildPullRequestListGhostModel() }
    : !input.pullRequestsSupported
      ? {
          kind: "unavailable",
          unavailable: {
            title: "Pull requests unavailable",
            description: "Update your T3 Code servers to browse pull requests.",
            retry: null,
          },
        }
      : firstLoad
        ? { kind: "ghost", ghost: buildPullRequestListGhostModel() }
        : input.listError !== null && shownCount === 0
          ? {
              kind: "unavailable",
              unavailable: {
                title: "Could not load pull requests",
                description: input.listError,
                retry: {
                  label: "Retry",
                  refreshing: input.listPending,
                  disabled: input.listPending,
                },
              },
            }
          : carriedToNothing
            ? { kind: "ghost", ghost: buildPullRequestListGhostModel() }
            : shownCount === 0
              ? {
                  kind: "empty",
                  empty: buildPullRequestListEmptyModel({
                    query: typedQuery,
                    hasProjects: !input.projectsKnown || input.projectCount > 0,
                    refreshing,
                    filtered:
                      Object.keys(filters).length > 0 ||
                      search.state !== "open" ||
                      search.involvement !== "all" ||
                      input.projectScoped ||
                      search.host !== undefined,
                    searching: searchBusy,
                    canLoadMore: input.truncated && canGrow,
                    loadingMore,
                  }),
                }
              : {
                  kind: "list",
                  groups: input.groups.map((group) =>
                    buildPullRequestGroupModel({ group, row: rowInput }),
                  ),
                };

  const footer: PullRequestsFooterModel | null =
    input.truncated && input.loadedEntryCount > 0
      ? loadingMore
        ? {
            kind: "loading",
            label: input.continuing ? "Loading more" : "Updating pull requests",
          }
        : canGrow
          ? {
              kind: "load-more",
              label: "Load more pull requests",
              disabled: input.listPending || input.showingCarried,
            }
          : { kind: "exhausted", label: "Narrow your search to find more pull requests." }
      : null;

  return {
    title: PULL_REQUESTS_PAGE_TITLE,
    breadcrumbLabel: "Pull requests breadcrumb",
    condensedBreadcrumbLabel: "Pull request scope",
    panelUnavailableLabel: PULL_REQUESTS_PANEL_UNAVAILABLE_LABEL,
    search: {
      value: search.q ?? "",
      busy: searchBusy,
      placeholder: "Search pull requests, or label:bug",
      ariaLabel: "Search pull requests",
      expandLabel: "Search pull requests",
    },
    sortMenu: buildPullRequestCompactMenuModel({
      label: "Sort pull requests",
      triggerLabel: "Sort",
      triggerIcon: { kind: "lucide", id: "arrow-down-up" },
      outlined: true,
      value: sort,
      options: PULL_REQUEST_SORT_OPTIONS,
    }),
    providerMenu: buildPullRequestCompactMenuModel({
      label: "Filter by provider",
      outlined: true,
      iconOnly: search.host !== undefined,
      triggerIcon: { kind: "lucide", id: "plug" },
      triggerLabel: "All",
      value: search.host ?? ALL_HOSTS_VALUE,
      options: hostOptions,
    }),
    condensed: {
      stateMenu: buildPullRequestCompactMenuModel({
        label: "Filter by state",
        value: search.state,
        options: PULL_REQUEST_STATE_OPTIONS,
      }),
      involvementMenu: buildPullRequestCompactMenuModel({
        label: "Filter by involvement",
        value: search.involvement,
        options: PULL_REQUEST_INVOLVEMENT_OPTIONS,
      }),
      hostMenu:
        hostOptions.length > 2
          ? buildPullRequestCompactMenuModel({
              label: "Filter by host",
              value: search.host ?? ALL_HOSTS_VALUE,
              options: hostOptions,
            })
          : null,
    },
    filtersMenu: buildPullRequestFiltersMenuModel({
      ...input.filtersMenu,
      state: search.state,
      involvement: search.involvement,
      filters,
      host: search.host,
      hostOptions,
      server: input.scopedEnvironmentId,
      serverOptions,
    }),
    hostOptions,
    serverOptions,
    refresh: { label: "Refresh pull requests", refreshing, disabled: refreshing },
    showProvider,
    shownCount,
    body,
    errorBanner:
      input.listError !== null && shownCount > 0
        ? {
            message: `${input.listError} Showing the last pull requests loaded.`,
            retryLabel: "Retry",
          }
        : null,
    footer,
  };
}

export type PullRequestsPagination = {
  readonly key: string;
  readonly size: number;
  readonly cursors: Readonly<Record<string, PullRequestListCursors>> | null;
  readonly regrown: ReadonlyArray<string>;
};

export function initialPullRequestsPagination(key: string): PullRequestsPagination {
  return { key, size: PULL_REQUESTS_PAGE_SIZE, cursors: null, regrown: [] };
}

export function resolvePullRequestsLoadMore(input: {
  readonly filterKey: string;
  readonly pageSize: number;
  readonly canContinue: boolean;
  readonly nextCursors: Readonly<Record<string, PullRequestListCursors>>;
  readonly regrown: ReadonlyArray<string>;
}): PullRequestsPagination {
  const grown = Math.min(input.pageSize + PULL_REQUESTS_PAGE_SIZE, PULL_REQUESTS_MAX_PAGE_SIZE);
  if (input.canContinue) {
    return {
      key: input.filterKey,
      size: input.regrown.length === 0 ? input.pageSize : grown,
      cursors: input.nextCursors,
      regrown: input.regrown,
    };
  }
  return { key: input.filterKey, size: grown, cursors: null, regrown: [] };
}

export type PullRequestsListRefresh =
  | { readonly kind: "refresh-targets" }
  | { readonly kind: "regrow"; readonly page: PullRequestsPagination };

export function resolvePullRequestsListRefresh(input: {
  readonly continuing: boolean;
  readonly filterKey: string;
  readonly pageSize: number;
  readonly loadedCount: number;
}): PullRequestsListRefresh {
  if (!input.continuing) return { kind: "refresh-targets" };
  return {
    kind: "regrow",
    page: {
      key: input.filterKey,
      regrown: [],
      size: Math.min(
        Math.max(
          input.pageSize,
          Math.ceil(input.loadedCount / PULL_REQUESTS_PAGE_SIZE) * PULL_REQUESTS_PAGE_SIZE,
        ),
        PULL_REQUESTS_MAX_PAGE_SIZE,
      ),
      cursors: null,
    },
  };
}

export type PullRequestRowTarget = Pick<
  EnvironmentPullRequestEntry,
  "environmentId" | "projectId" | "host" | "repository" | "number"
>;

export type PullRequestRowSelectionIntent = {
  readonly kind: "open-pull-request";
  readonly surface: PullRequestRowTarget & { readonly url?: string };
  readonly searchPatch: PullRequestsSearchPatch;
};

export function resolvePullRequestRowSelection(
  target: PullRequestRowTarget & { readonly url?: string | undefined },
): PullRequestRowSelectionIntent {
  return {
    kind: "open-pull-request",
    surface: {
      environmentId: target.environmentId,
      projectId: target.projectId,
      host: target.host,
      repository: target.repository,
      number: target.number,
      ...(target.url === undefined ? {} : { url: target.url }),
    },
    searchPatch: {
      repository: target.repository,
      number: target.number,
      selectedProjectId: target.projectId,
      selectedEnvironmentId: target.environmentId,
      selectedHost: target.host,
    },
  };
}

export type PullRequestOpenOnHostIntent = {
  readonly kind: "open-external";
  readonly url: string;
  readonly label: string;
};

export function resolvePullRequestOpenOnHost(
  entry: Pick<EnvironmentPullRequestEntry, "url" | "provider">,
): PullRequestOpenOnHostIntent {
  return { kind: "open-external", url: entry.url, label: openOnHostLabel(entry.provider) };
}

export type PullRequestListNavigationDirection = "next" | "previous";

export function resolvePullRequestListNavigation(
  rowKeys: ReadonlyArray<string>,
  currentKey: string | null,
  direction: PullRequestListNavigationDirection,
): string | null {
  if (rowKeys.length === 0) return null;
  const index = currentKey === null ? -1 : rowKeys.indexOf(currentKey);
  if (index === -1) return direction === "next" ? (rowKeys[0] ?? null) : (rowKeys.at(-1) ?? null);
  const nextIndex = direction === "next" ? index + 1 : index - 1;
  return rowKeys[Math.min(Math.max(nextIndex, 0), rowKeys.length - 1)] ?? null;
}

export type PullRequestsFindShortcut =
  | { readonly kind: "none" }
  | { readonly kind: "expand-condensed-search" }
  | { readonly kind: "focus-inline-search" };

export function resolvePullRequestsFindShortcut(input: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly defaultPrevented: boolean;
  readonly condensed: boolean;
}): PullRequestsFindShortcut {
  if (input.defaultPrevented) return { kind: "none" };
  if (input.key.toLowerCase() !== "f" || !(input.metaKey || input.ctrlKey)) return { kind: "none" };
  if (input.altKey || input.shiftKey) return { kind: "none" };
  return input.condensed ? { kind: "expand-condensed-search" } : { kind: "focus-inline-search" };
}

export function resolvePullRequestsStatsPolicy(sort: PullRequestListSort): PullRequestStatsPolicy {
  return sort === "ready" || sort === "largest" || sort === "smallest" ? "eager" : "visible";
}
