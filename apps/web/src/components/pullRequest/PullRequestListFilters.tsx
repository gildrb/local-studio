import { Spinner } from "~/components/ui/spinner";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
} from "@t3tools/contracts";
import {
  ArrowDownUpIcon,
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  FolderGit2Icon,
  LayersIcon,
  ListChecksIcon,
  ListFilterIcon,
  Maximize2Icon,
  Minimize2Icon,
  PenLineIcon,
  Plug2Icon,
  SearchIcon,
  TagIcon,
  UserLockIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { type ElementType, useState } from "react";

import { environmentMachineIcon } from "../EnvironmentMachineIcon";
import { AzureDevOpsIcon, BitbucketIcon, ForgejoIcon, GitHubIcon, GitLabIcon } from "../Icons";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Button } from "../ui/button";

import {
  Menu,
  MenuCheckboxItem,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { PullRequestAuthorFacet, PullRequestLabelFacet } from "./pullRequestList.logic";
import { PullRequestActorAvatar } from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";
import {
  PULL_REQUEST_CHECKS_FILTER_OPTIONS,
  PULL_REQUEST_DRAFT_FILTER_OPTIONS,
  PULL_REQUEST_FILTERS_MENU_LABELS,
  PULL_REQUEST_REVIEW_FILTER_OPTIONS,
  applyPullRequestListFiltersPatch,
  buildPullRequestAuthorFilterModel,
  buildPullRequestLabelFilterModel,
  buildPullRequestProjectFilterOptions,
  countPullRequestFilters,
  pullRequestCurrentFilterOption,
  pullRequestFilterGroupValue,
  pullRequestProjectFilterValue,
  resolvePullRequestAuthorSelection,
  resolvePullRequestFilterGroupChange,
  resolvePullRequestHostFilter,
  resolvePullRequestLabelFilterChange,
  resolvePullRequestLabelToggle,
  resolvePullRequestProjectSelection,
  type PullRequestFilterIcon,
  type PullRequestFilterLucideId,
  type PullRequestFilterOptionModel,
} from "./PullRequestsPage.logic";

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /** Uses the option's native icon tone. */
  readonly Icon: ElementType<{ className?: string }>;
  readonly project?: ProjectFaviconProject;
  /** Why it cannot be chosen, carried onto the item as its title. */
  readonly unavailable?: string | undefined;
}

const LUCIDE_FILTER_ICONS = {
  layers: LayersIcon,
  eye: EyeIcon,
  "eye-off": EyeOffIcon,
  "pen-line": PenLineIcon,
  users: UsersIcon,
  "list-checks": ListChecksIcon,
  "user-lock": UserLockIcon,
  clock: ClockIcon,
  "calendar-arrow-down": CalendarArrowDownIcon,
  "calendar-arrow-up": CalendarArrowUpIcon,
  maximize: Maximize2Icon,
  minimize: Minimize2Icon,
  plug: Plug2Icon,
  "circle-check": CircleCheckIcon,
  "circle-x": CircleXIcon,
  "circle-dashed": CircleDashedIcon,
  "circle-slash": CircleSlashIcon,
  "folder-git": FolderGit2Icon,
  "arrow-down-up": ArrowDownUpIcon,
  "list-filter": ListFilterIcon,
  "user-round": UserRoundIcon,
  tag: TagIcon,
  search: SearchIcon,
} as const satisfies Record<PullRequestFilterLucideId, ElementType<{ className?: string }>>;

const PROVIDER_FILTER_ICONS = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  forgejo: ForgejoIcon,
  "azure-devops": AzureDevOpsIcon,
  bitbucket: BitbucketIcon,
  "change-request": PullRequestGlyph.pullRequest,
} as const;

export function pullRequestFilterIconComponent(
  icon: PullRequestFilterIcon,
): ElementType<{ className?: string }> {
  switch (icon.kind) {
    case "lucide":
      return LUCIDE_FILTER_ICONS[icon.id];
    case "glyph":
      return PullRequestGlyph[icon.id];
    case "provider":
      return PROVIDER_FILTER_ICONS[icon.id];
    case "machine":
      return environmentMachineIcon(icon.id);
    case "project":
      return FolderGit2Icon;
  }
}

export function withPullRequestFilterIcons<Value extends string>(
  options: ReadonlyArray<PullRequestFilterOptionModel<Value>>,
): ReadonlyArray<PullRequestFilterOption<Value>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    Icon: pullRequestFilterIconComponent(option.icon),
    ...(option.unavailable === null ? {} : { unavailable: option.unavailable }),
  }));
}

const DRAFT_OPTIONS = withPullRequestFilterIcons(PULL_REQUEST_DRAFT_FILTER_OPTIONS);
const REVIEW_OPTIONS = withPullRequestFilterIcons(PULL_REQUEST_REVIEW_FILTER_OPTIONS);
const CHECKS_OPTIONS = withPullRequestFilterIcons(PULL_REQUEST_CHECKS_FILTER_OPTIONS);

export function PullRequestFilterOptionIcon<Value extends string>({
  option,
}: {
  option: PullRequestFilterOption<Value>;
}) {
  return option.project ? (
    <ProjectFavicon project={option.project} className="size-3.5" />
  ) : (
    <option.Icon aria-hidden className="size-3.5" />
  );
}

export function PullRequestSearchInput({
  value,
  busy,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string;
  /** A search is on its way to the hosts, said where the typing is rather than over the list. */
  busy?: boolean;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
      <InputGroupAddon>
        {busy ? <Spinner aria-hidden /> : <SearchIcon aria-hidden />}
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </InputGroup>
  );
}

function PullRequestFilterRadioGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  return (
    <MenuRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next === value) return;
        const option = options.find((candidate) => candidate.value === next);
        if (option) onChange(option.value);
      }}
    >
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {options.map((option) => {
        // A host the server has already said it cannot read is not a choice here: offering
        // it would answer the press by replacing a working list with that failure.
        const item = (
          <MenuRadioItem
            key={option.value}
            value={option.value}
            className={option.unavailable ? "data-disabled:pointer-events-auto" : undefined}
            disabled={option.unavailable !== undefined}
          >
            <span className="flex min-w-0 items-center gap-2">
              <PullRequestFilterOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailable ? <span className="shrink-0">· Unavailable</span> : null}
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        );
        if (!option.unavailable) return item;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={item} />
            <TooltipPopup side="top">{option.unavailable}</TooltipPopup>
          </Tooltip>
        );
      })}
    </MenuRadioGroup>
  );
}

function PullRequestFilterRadioSubmenu<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  const current = pullRequestCurrentFilterOption(options, value);
  if (!current) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        <PullRequestFilterOptionIcon option={current} />
        <span className="flex-1">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <PullRequestFilterRadioGroup
          label={label}
          value={value}
          options={options}
          onChange={onChange}
        />
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestAuthorFilter({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: ReadonlyArray<PullRequestAuthorFacet>;
  onChange: (author: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const model = buildPullRequestAuthorFilterModel({ value, options, query });
  const select = (next: string) => {
    const selection = resolvePullRequestAuthorSelection(value, next);
    if (selection.kind === "set") onChange(selection.author);
  };
  return (
    <MenuSub>
      <MenuSubTrigger>
        <UserRoundIcon aria-hidden className="size-3.5" />
        <span className="flex-1">{model.label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {model.summary}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <div className="p-1 pb-2">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              size="compact"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" && event.key !== "Escape") event.stopPropagation();
              }}
              placeholder={model.searchPlaceholder}
              aria-label={model.searchPlaceholder}
            />
          </InputGroup>
        </div>
        <MenuRadioGroup value={model.value} onValueChange={select}>
          <MenuRadioItem value="">
            <span className="flex min-w-0 items-center gap-2">
              <LayersIcon aria-hidden className="size-3.5" />
              {model.anyoneLabel}
            </span>
          </MenuRadioItem>
          {model.rows.map((row) => (
            <MenuRadioItem key={row.key} value={row.login}>
              <span className="flex min-w-0 items-center gap-2">
                <PullRequestActorAvatar
                  actor={
                    options.find((option) => option.actor.login.toLowerCase() === row.key)?.actor ??
                    null
                  }
                />
                <span className="min-w-0 flex-1 truncate">{row.login}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.mergedLabel}
                </span>
              </span>
            </MenuRadioItem>
          ))}
          {model.emptyLabel === null ? null : <MenuItem disabled>{model.emptyLabel}</MenuItem>}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}

function PullRequestLabelFilter({
  value,
  options,
  onChange,
}: {
  value: ReadonlyArray<string>;
  options: ReadonlyArray<PullRequestLabelFacet>;
  onChange: (labels: ReadonlyArray<string>) => void;
}) {
  const model = buildPullRequestLabelFilterModel({ value, options });
  return (
    <MenuSub>
      <MenuSubTrigger>
        <TagIcon aria-hidden className="size-3.5" />
        <span className="flex-1">{model.label}</span>
        <span className="text-xs text-muted-foreground">{model.summary}</span>
      </MenuSubTrigger>
      <MenuSubPopup>
        {model.emptyLabel !== null ? (
          <MenuItem disabled>{model.emptyLabel}</MenuItem>
        ) : (
          model.rows.map((row) => (
            <MenuCheckboxItem
              key={row.key}
              checked={row.checked}
              onCheckedChange={(next) =>
                onChange(resolvePullRequestLabelToggle(value, row.name, next))
              }
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
                  {...(row.color ? { style: { backgroundColor: row.color } } : {})}
                />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.countLabel}
                </span>
              </span>
            </MenuCheckboxItem>
          ))
        )}
      </MenuSubPopup>
    </MenuSub>
  );
}

/**
 * List narrowings live behind one filter control, separate from sorting. The trigger carries a
 * count whenever any filter is off its default, so a narrowed list is never a mystery.
 */
export function PullRequestFiltersMenu({
  onOpenChange,
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
  authorOptions = [],
  labelOptions = [],
  host,
  hostOptions,
  onHost,
  server,
  serverOptions,
  onServer,
  projects,
  projectId,
  projectEnvironmentId,
  unavailable,
  onProject,
}: {
  onOpenChange?: (open: boolean) => void;
  state: PullRequestListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;
  onState: (state: PullRequestListState) => void;
  involvement: PullRequestInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  /** The narrowings beyond state and involvement; an absent field is that group unfiltered. */
  filters: PullRequestListFilters;
  onFilters: (filters: PullRequestListFilters) => void;
  authorOptions?: ReadonlyArray<PullRequestAuthorFacet>;
  labelOptions?: ReadonlyArray<PullRequestLabelFacet>;
  host: string | undefined;
  /**
   * Includes the "all hosts" entry, whose value is the empty string. With fewer than two real
   * hosts there is nothing to switch between, so the whole group stays out of the menu.
   */
  hostOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  /**
   * Includes the "all servers" entry, whose value is the empty string. With one server there is
   * nothing to switch between, so the whole group stays out of the menu.
   */
  serverOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onServer: (server: string) => void;
  /** The projects of every connected environment, each carrying the one its favicon is read from. */
  projects: ReadonlyArray<ProjectFaviconProject & { readonly id: ProjectId }>;
  projectId: ProjectId | undefined;
  /**
   * The server the selected project belongs to. A project id is only unique within its own
   * server, so without this two rows sharing an id would both read as checked here.
   */
  projectEnvironmentId: EnvironmentId | undefined;
  /**
   * Projects whose repository could not be read this time round. They are named here, where
   * the reader is already choosing between projects, rather than as a count above the list
   * that says something is missing without saying which.
   */
  unavailable: ReadonlyMap<string, string>;
  /** The environment comes with the project id, since picking a row picks a specific server's copy of it. */
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  const selectedLabels = (filters.labels ?? []).flatMap((group) => group);
  const filterCount = countPullRequestFilters({
    state,
    involvement,
    host,
    server,
    projectId,
    filters,
  });
  const projectOptions: ReadonlyArray<PullRequestFilterOption<string>> =
    buildPullRequestProjectFilterOptions(projects, unavailable).map((option) => ({
      value: option.value,
      label: option.label,
      Icon: pullRequestFilterIconComponent(option.icon),
      ...(option.project === null ? {} : { project: option.project }),
      ...(option.unavailable === null ? {} : { unavailable: option.unavailable }),
    }));
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger render={<Button variant="outline" />}>
        <ListFilterIcon className="size-4" />
        <span>{PULL_REQUEST_FILTERS_MENU_LABELS.trigger}</span>
        {filterCount > 0 ? (
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
            {filterCount}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom">
        <PullRequestFilterRadioSubmenu
          label={PULL_REQUEST_FILTERS_MENU_LABELS.state}
          value={state}
          options={stateOptions}
          onChange={onState}
        />
        <PullRequestFilterRadioSubmenu
          label={PULL_REQUEST_FILTERS_MENU_LABELS.involvement}
          value={involvement}
          options={involvementOptions}
          onChange={onInvolvement}
        />
        <MenuSeparator />
        <PullRequestAuthorFilter
          value={filters.author}
          options={authorOptions}
          onChange={(author) => onFilters(applyPullRequestListFiltersPatch(filters, { author }))}
        />
        <PullRequestLabelFilter
          value={selectedLabels}
          options={labelOptions}
          onChange={(labels) => onFilters(resolvePullRequestLabelFilterChange(filters, labels))}
        />
        <PullRequestFilterRadioSubmenu
          label={PULL_REQUEST_FILTERS_MENU_LABELS.draft}
          value={pullRequestFilterGroupValue(filters, "draft")}
          options={DRAFT_OPTIONS}
          onChange={(draft) =>
            onFilters(resolvePullRequestFilterGroupChange(filters, "draft", draft))
          }
        />
        <PullRequestFilterRadioSubmenu
          label={PULL_REQUEST_FILTERS_MENU_LABELS.review}
          value={pullRequestFilterGroupValue(filters, "review")}
          options={REVIEW_OPTIONS}
          onChange={(review) =>
            onFilters(resolvePullRequestFilterGroupChange(filters, "review", review))
          }
        />
        <PullRequestFilterRadioSubmenu
          label={PULL_REQUEST_FILTERS_MENU_LABELS.checks}
          value={pullRequestFilterGroupValue(filters, "checks")}
          options={CHECKS_OPTIONS}
          onChange={(checks) =>
            onFilters(resolvePullRequestFilterGroupChange(filters, "checks", checks))
          }
        />
        {hostOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label={PULL_REQUEST_FILTERS_MENU_LABELS.host}
              value={host ?? ""}
              options={hostOptions}
              onChange={(next) => onHost(resolvePullRequestHostFilter(next))}
            />
          </>
        ) : null}
        {serverOptions.length > 2 ? (
          <>
            <MenuSeparator />
            <PullRequestFilterRadioSubmenu
              label={PULL_REQUEST_FILTERS_MENU_LABELS.server}
              value={server ?? ""}
              options={serverOptions}
              onChange={onServer}
            />
          </>
        ) : null}
        <MenuSeparator />
        <PullRequestFilterRadioSubmenu
          label={PULL_REQUEST_FILTERS_MENU_LABELS.project}
          value={pullRequestProjectFilterValue(projectId, projectEnvironmentId)}
          options={projectOptions}
          onChange={(next) => {
            const selection = resolvePullRequestProjectSelection(projects, projectId, next);
            if (selection.kind === "select")
              onProject(selection.projectId, selection.environmentId);
            else if (selection.kind === "clear") onProject(undefined, undefined);
          }}
        />
      </MenuPopup>
    </Menu>
  );
}
