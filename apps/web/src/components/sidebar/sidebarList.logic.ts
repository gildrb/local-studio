import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveSettledThreadTimestamp,
  sortSettledThreads,
} from "@t3tools/client-runtime/state/thread-sort";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ResolvedKeybindingsConfig,
  type ServerConfig,
} from "@t3tools/contracts";
import type { SidebarProjectSortOrder } from "@t3tools/contracts/settings";

import { shortcutLabelForCommand, threadJumpCommandForIndex } from "../../keybindings";
import { getProjectOrderKey, type ProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { formatRelativeTimeLabel, parseTimestampDate } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import { legacyProjectCwdPreferenceKey } from "../../uiState.logic";
import {
  applySidebarThreadDrop,
  firstValidTimestampMs,
  hasUnseenCompletion,
  isSidebarThreadWorking,
  orderItemsByPreferredIds,
  resolveSidebarThreadStatus,
  shouldRecedeSidebarThread,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  type SidebarListItem,
  type SidebarSection,
  type SidebarThreadStatus,
} from "../Sidebar.logic";

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more.
export const SETTLED_TAIL_INITIAL_COUNT = 10;
export const SETTLED_TAIL_PAGE_COUNT = 25;
// Fresh keys deliberately reset both shelves to collapsed for existing users.
export const SETTLED_SHELF_EXPANDED_KEY = "t3code:sidebar:settled-expanded";
export const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar:snoozed-expanded";
export const WORKING_SHELF_EXPANDED_KEY = "t3code:sidebar:working-expanded";

// Working beta: when this client saw each thread leave the Working shelf.
// Module scope keeps the inbox order across routes that unmount the sidebar.
let lastWorkingThreadKeys: ReadonlySet<string> | null = null;
const observedInboxReturns = new Map<string, number>();

/** Stamps threads that stopped working since the last call. The first call
    only takes a baseline, so mounting never reshuffles the inbox. Pass null
    to reset when the beta is off. */
function observeInboxReturns(threads: readonly EnvironmentThreadShell[] | null): void {
  if (threads === null) {
    lastWorkingThreadKeys = null;
    observedInboxReturns.clear();
    return;
  }
  const working = new Set<string>();
  const present = new Set<string>();
  for (const thread of threads) {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    present.add(key);
    if (isSidebarThreadWorking(thread)) working.add(key);
  }
  // Drop deleted threads so the map stays bounded by the live thread list.
  for (const key of observedInboxReturns.keys()) {
    if (!present.has(key)) observedInboxReturns.delete(key);
  }
  const now = Date.now();
  for (const key of lastWorkingThreadKeys ?? []) {
    if (present.has(key) && !working.has(key)) observedInboxReturns.set(key, now);
  }
  lastWorkingThreadKeys = working;
}

export function observedInboxReturnAt(threadKey: string): number | undefined {
  return observedInboxReturns.get(threadKey);
}

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

export function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Settled rows read "how long ago did this wrap up", matching their sort
// key: both go through resolveSettledThreadTimestamp so label and order can't
// disagree.
export function settledTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = resolveSettledThreadTimestamp(thread);
  return timestamp === null ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

export function terminalProcessLabel(count: number): string {
  return `${count} terminal ${count === 1 ? "process" : "processes"} running`;
}

export interface SidebarEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: ServerConfig | null;
}

export function buildSidebarEnvironmentMaps(environments: ReadonlyArray<SidebarEnvironmentInput>): {
  readonly labelById: ReadonlyMap<EnvironmentId, string>;
  readonly machineById: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
} {
  return {
    labelById: new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    ),
    machineById: new Map(
      environments.map(
        (environment) =>
          [
            environment.environmentId,
            resolveEnvironmentMachineKind(environment.serverConfig),
          ] as const,
      ),
    ),
  };
}

export function orderSidebarProjects(
  projects: readonly EnvironmentProject[],
  projectOrder: readonly string[],
): EnvironmentProject[] {
  return orderItemsByPreferredIds({
    items: projects,
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
}

export function buildUnsortedSidebarProjectGroups(input: {
  readonly projects: readonly EnvironmentProject[];
  readonly orderedProjects: readonly EnvironmentProject[];
  readonly sortOrder: SidebarProjectSortOrder;
  readonly settings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environmentLabelById: ReadonlyMap<EnvironmentId, string>;
}): SidebarProjectSnapshot[] {
  return buildSidebarProjectSnapshots({
    projects: input.sortOrder === "manual" ? input.orderedProjects : input.projects,
    settings: input.settings,
    primaryEnvironmentId: input.primaryEnvironmentId,
    resolveEnvironmentLabel: (environmentId) =>
      input.environmentLabelById.get(environmentId) ?? null,
  });
}

// Rows read the project record for its icon and cwd. Group labels can include
// a repository owner or a different title, so they travel separately.
export function buildSidebarProjectByKey(
  projects: readonly EnvironmentProject[],
): ReadonlyMap<string, EnvironmentProject> {
  return new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project]));
}

export function buildSidebarProjectDisplayNameByKey(
  projectGroups: readonly SidebarProjectSnapshot[],
): ReadonlyMap<string, string> {
  return new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
}

export function resolveScopedSidebarProjectGroup(
  projectGroups: readonly SidebarProjectSnapshot[],
  projectScopeKey: string | null,
): SidebarProjectSnapshot | null {
  return projectScopeKey === null
    ? null
    : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null);
}

export function scopedSidebarProjectKeys(
  scopedProjectGroup: SidebarProjectSnapshot | null,
): ReadonlySet<string> | null {
  return scopedProjectGroup === null
    ? null
    : new Set(
        scopedProjectGroup.memberProjectRefs.map(
          (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
        ),
      );
}

/** Keeps a dropped row at its destination while its server applies the
    lifecycle command and any order-key writes. */
export interface SidebarOptimisticDrop {
  readonly key: string;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  /** Full destination order for pinned and active drops. */
  readonly order: readonly string[] | null;
  /** Destination order keys before the drop, to recognize concurrent writes. */
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  /** The keys this drop writes (one per planned assignment). The
      override holds until all of them appear in canonical state. */
  readonly assignedKeys: ReadonlyMap<string, string>;
}

export interface SidebarThreadPartition {
  readonly pinnedThreads: EnvironmentThreadShell[];
  readonly draggableThreadKeys: Set<string>;
  readonly activeReorderableThreadKeys: Set<string>;
  readonly activeThreads: EnvironmentThreadShell[];
  readonly workingThreads: EnvironmentThreadShell[];
  readonly snoozedThreads: EnvironmentThreadShell[];
  readonly settledThreads: EnvironmentThreadShell[];
  readonly snoozeNow: string;
}

export function partitionSidebarThreads(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly workingShelfEnabled: boolean;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
}): SidebarThreadPartition {
  const { threads, scopedProjectKeys, serverConfigs, workingShelfEnabled, optimisticDrop } = input;
  // Snooze classification uses a REAL clock, not the quantized minute:
  // wake times are second-precise and a woken thread must not linger on
  // the shelf for the rest of the minute.
  const preciseNow = new Date().toISOString();
  const visible = threads.filter(
    (thread) =>
      thread.archivedAt === null &&
      (scopedProjectKeys === null ||
        scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
  );
  observeInboxReturns(workingShelfEnabled ? threads : null);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  // Working beta: only inbox threads fold away. Pins stay where the user
  // put them, and snoozed or settled threads keep their shelves.
  const inbox = (thread: EnvironmentThreadShell) =>
    workingShelfEnabled && isSidebarThreadWorking(thread) ? working : active;
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  const draggable = new Set<string>();
  const activeReorderable = new Set<string>();
  for (const thread of visible) {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    // Threads on servers without the settlement capability (old server,
    // or descriptor not loaded yet) never classify as settled: the user
    // could neither un-settle nor pin them, so auto-settling them would
    // strand rows in a tail with no working affordances.
    const supportsSettlement = capabilities?.threadSettlement === true;
    const supportsSnooze = capabilities?.threadSnooze === true;
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (capabilities?.threadActiveReorder === true) activeReorderable.add(threadKey);
    // Older servers retain their existing drag actions. Active placement
    // additionally requires its own ordering capability at the drop target.
    if (capabilities?.threadPinning === true && capabilities.threadPinReorder === true) {
      draggable.add(threadKey);
    }
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      (optimisticDrop.section === "pinned"
        ? pinned
        : optimisticDrop.section === "settled"
          ? settled
          : inbox(projected)
      ).push(
        optimisticDrop.clearsSnooze
          ? projected
          : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil },
      );
    } else if (supportsSnooze && effectiveSnoozed(thread, { now: preciseNow })) {
      // Snooze outranks settlement and pinning until the thread wakes.
      snoozed.push(thread);
    } else if (supportsSettlement && thread.settledOverride === "settled") {
      settled.push(thread);
    } else if (thread.pinnedAt != null) {
      pinned.push(thread);
    } else {
      inbox(thread).push(thread);
    }
  }
  // One shared rule on every platform (see sortPinnedThreadsByOrderKey):
  // user-arranged keys first, keyless threads in creation order below.
  // Server capability only gates DRAGGING — it must not influence the
  // sort, or mixed-version fleets would render different pinned orders on
  // web and mobile from the same data.
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  const sortedActive = workingShelfEnabled
    ? sortInboxThreadsByReturn(active, (thread) =>
        observedInboxReturns.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      )
    : sortThreadsForSidebar(active);
  return {
    pinnedThreads:
      optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
        ? sortedPinned
        : orderItemsByPreferredIds({
            items: sortedPinned,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    draggableThreadKeys: draggable,
    activeReorderableThreadKeys: activeReorderable,
    activeThreads:
      optimisticDrop?.section !== "active" || optimisticDrop.order === null
        ? sortedActive
        : orderItemsByPreferredIds({
            items: sortedActive,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    // Newest work first, by the same clock as the inbox.
    workingThreads: sortInboxThreadsByReturn(working),
    // Soonest wake first: "what comes back next" is the shelf's question.
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    settledThreads: sortSettledThreads(settled),
    snoozeNow: preciseNow,
  };
}

// Collapsed shelves share one empty list so a route change alone does not
// give the sidebar list a new identity.
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

function findRouteThread(
  threads: readonly EnvironmentThreadShell[],
  routeThreadKey: string,
): EnvironmentThreadShell | undefined {
  return threads.find(
    (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
  );
}

/** The settled tail renders in pages. The open thread must never hide under
    "Show more": navigating into a deep settled thread (search, deep link)
    pulls its row into the visible tail so the highlight and the un-settle
    affordance stay reachable. */
export function resolveVisibleSettledThreads(
  settledThreads: readonly EnvironmentThreadShell[],
  settledVisibleCount: number,
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (settledThreads.length <= settledVisibleCount) return settledThreads;
  const visible = settledThreads.slice(0, settledVisibleCount);
  if (routeThreadKey !== null) {
    const routeThread = findRouteThread(settledThreads.slice(settledVisibleCount), routeThreadKey);
    if (routeThread !== undefined) visible.push(routeThread);
  }
  return visible;
}

/** A collapsed shelf renders nothing except the open thread: a thread reached
    by route keeps its row, with highlight and affordances, on every shelf. */
export function resolveShelfThreads(
  threads: readonly EnvironmentThreadShell[],
  expanded: boolean,
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (expanded) return threads;
  if (routeThreadKey === null) return EMPTY_THREADS;
  const routeThread = findRouteThread(threads, routeThreadKey);
  return routeThread === undefined ? EMPTY_THREADS : [routeThread];
}

export function sidebarShowMoreSettledCount(hiddenSettledCount: number): number {
  return Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT);
}

// Include every visible row in the measured order. Older servers disable
// pickup on their rows without changing where those rows render.
export function buildSidebarListItems(input: {
  readonly pinnedThreads: readonly EnvironmentThreadShell[];
  readonly activeThreads: readonly EnvironmentThreadShell[];
  readonly workingThreadCount: number;
  readonly visibleWorkingThreads: readonly EnvironmentThreadShell[];
  readonly snoozedThreadCount: number;
  readonly visibleSnoozedThreads: readonly EnvironmentThreadShell[];
  readonly settledThreadCount: number;
  readonly renderedSettledThreads: readonly EnvironmentThreadShell[];
}): readonly SidebarListItem[] {
  const rowsOf = (
    list: readonly EnvironmentThreadShell[],
    section: SidebarSection,
  ): SidebarListItem[] =>
    list.map((thread) => {
      const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      return { kind: "thread", key, section };
    });
  if (
    input.pinnedThreads.length +
      input.activeThreads.length +
      input.workingThreadCount +
      input.snoozedThreadCount +
      input.settledThreadCount ===
    0
  ) {
    return [];
  }
  const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
  const pinnedRows = rowsOf(input.pinnedThreads, "pinned");
  items.push(...pinnedRows);
  items.push({ kind: "marker", marker: "pinned-divider" });
  const activeRows = rowsOf(input.activeThreads, "active");
  items.push({ kind: "marker", marker: "active-placeholder" });
  items.push(...activeRows);
  if (input.workingThreadCount > 0) {
    items.push({ kind: "marker", marker: "working-header" });
    items.push(...rowsOf(input.visibleWorkingThreads, "working"));
  }
  if (input.snoozedThreadCount > 0) {
    items.push({ kind: "marker", marker: "snoozed-header" });
    items.push(...rowsOf(input.visibleSnoozedThreads, "snoozed"));
  }
  items.push({ kind: "marker", marker: "settled-header" });
  const settledRows = rowsOf(input.renderedSettledThreads, "settled");
  items.push({ kind: "marker", marker: "settled-placeholder" });
  items.push(...settledRows);
  return items;
}

const SHELF_TITLES = { working: "Working", snoozed: "Snoozed", settled: "Settled" } as const;

export function sidebarShelfHeaderLabel(
  shelf: keyof typeof SHELF_TITLES,
  expanded: boolean,
  count: number,
): string {
  return expanded ? SHELF_TITLES[shelf] : `${SHELF_TITLES[shelf]} (${count})`;
}

// Settled and snoozed are the ONLY things that collapse a row: every other
// thread is a full card. Density comes from users (or the auto rules)
// actually parking work, not from the sidebar second-guessing what still
// matters. Working rows stay cards so their live status shows.
export function sidebarRowVariant(section: SidebarSection): "card" | "slim" {
  return section === "active" || section === "pinned" || section === "working" ? "card" : "slim";
}

// Snoozed rows wake, settled rows un-settle, and cards settle.
export function sidebarRowAction(section: SidebarSection): "settle" | "unsettle" | "unsnooze" {
  return section === "snoozed" ? "unsnooze" : section === "settled" ? "unsettle" : "settle";
}

export type SidebarTopStatusIcon =
  | "working"
  | "monitoring"
  | "approval"
  | "input"
  | "failed"
  | "woke"
  | "done";

export interface SidebarTopStatus {
  readonly label: string;
  readonly icon: SidebarTopStatusIcon;
}

export interface SidebarThreadRowState {
  readonly status: SidebarThreadStatus;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  readonly shouldRecede: boolean;
  readonly topStatus: SidebarTopStatus | null;
}

export function resolveSidebarThreadRowState(input: {
  readonly thread: SidebarThreadSummary;
  readonly lastVisitedAt: string | undefined;
  readonly wokeAt: string | null;
  readonly isActive: boolean;
  readonly isSelected: boolean;
}): SidebarThreadRowState {
  const { thread, lastVisitedAt } = input;
  // Same semantics as the legacy sidebar (never-visited counts as read):
  // switching sidebars must not light up every historical thread as unread.
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarThreadStatus(thread);
  // A woken thread reappears at its original position (the sort is
  // deliberately static), so the pill has to carry the weight. Snoozing is
  // an explicit act, so the pill clears only when the user re-engages:
  // reading a completion-triggered wake, clicking the pill, sending a
  // message, settling, archiving, or a change request state that settles the
  // thread. Timer wakes survive a mere visit. An unparseable visit timestamp
  // counts as never-visited, so corrupt local data cannot eat the wake signal.
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = input.wokeAt === null ? null : parseTimestampDate(input.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    thread.settledOverride !== "settled";
  // Background work always recedes when it is not selected: an unread parent
  // completion must not pull a still-working thread back into the foreground.
  // Ready and action-required rows keep their unread and wake prominence.
  const shouldRecede = shouldRecedeSidebarThread({
    status,
    isUnread,
    isWoke,
    isActive: input.isActive,
    isSelected: input.isSelected,
  });
  const topStatus: SidebarTopStatus | null =
    status === "working"
      ? { label: "Working", icon: "working" }
      : status === "monitoring"
        ? { label: "Monitoring", icon: "monitoring" }
        : status === "approval"
          ? { label: "Approval", icon: "approval" }
          : status === "input"
            ? { label: "Input", icon: "input" }
            : status === "failed"
              ? { label: "Failed", icon: "failed" }
              : isWoke
                ? { label: "Woke", icon: "woke" }
                : isUnread
                  ? { label: "Done", icon: "done" }
                  : null;
  return { status, isUnread, isWoke, shouldRecede, topStatus };
}

export type SidebarRowSurface = "active" | "selected" | "draft" | "recede" | "default";

// All sidebar rows share one surface model. Status lives in the row content;
// surface is reserved for interaction (hover, multi-select, route).
export function resolveSidebarRowSurface(input: {
  readonly isActive: boolean;
  readonly isSelected: boolean;
  readonly hasUnsentDraft: boolean;
  readonly shouldRecede: boolean;
}): SidebarRowSurface {
  return input.isActive
    ? "active"
    : input.isSelected
      ? "selected"
      : input.hasUnsentDraft
        ? "draft"
        : input.shouldRecede
          ? "recede"
          : "default";
}

// Background work fades as a whole row, status label included, so it takes
// less attention than rows that need a human (input, approval).
export function shouldFadeSidebarRow(input: {
  readonly shouldRecede: boolean;
  readonly status: SidebarThreadStatus;
}): boolean {
  return input.shouldRecede && (input.status === "working" || input.status === "monitoring");
}

export type SidebarTitleTone =
  | "foreground"
  | "foreground-95"
  | "foreground-90"
  | "secondary"
  | "secondary-70"
  | "muted";

export function resolveSidebarThreadTitleTone(input: {
  readonly variant: "card" | "slim";
  readonly shouldRecede: boolean;
  readonly isUnread: boolean;
  readonly isWoke: boolean;
  readonly isActive: boolean;
  readonly status: SidebarThreadStatus;
}): SidebarTitleTone {
  if (input.variant === "card") {
    return input.shouldRecede
      ? "secondary"
      : input.isUnread || input.isWoke || input.status === "input"
        ? "foreground"
        : input.status === "failed"
          ? "foreground-95"
          : "foreground-90";
  }
  return input.shouldRecede
    ? "secondary-70"
    : input.isActive || input.isWoke || input.status === "input"
      ? "foreground"
      : input.isUnread
        ? "muted"
        : "secondary-70";
}

export function buildSidebarThreadJumpLabels(
  orderedThreadKeys: readonly string[],
  keybindings: ResolvedKeybindingsConfig,
  platform?: string,
): ReadonlyMap<string, string> {
  const mapping = new Map<string, string>();
  for (const [index, threadKey] of orderedThreadKeys.entries()) {
    const jumpCommand = threadJumpCommandForIndex(index);
    if (!jumpCommand) break;
    const label = shortcutLabelForCommand(keybindings, jumpCommand, platform);
    if (label) mapping.set(threadKey, label);
  }
  return mapping;
}

// The button mirrors chat.new: in multi-project setups both route through
// the command palette's "New thread in..." picker, and in single-project
// setups both create immediately. In multi-project setups the label is only
// the picker's shortcut: falling back to chat.newLocal would advertise the
// same shortcut for both the picker and direct create. In single-project
// setups both commands create directly, so chat.newLocal is a valid
// fallback. The second tooltip line (multi-project only) advertises
// shift+click and its keyboard twin chat.newLocal for direct create.
export function resolveSidebarNewThreadShortcutLabels(
  keybindings: ResolvedKeybindingsConfig,
  projectGroupCount: number,
  platform?: string,
): {
  readonly newThreadShortcutLabel: string | null | undefined;
  readonly newThreadInProjectShortcutLabel: string | null;
} {
  return {
    newThreadShortcutLabel:
      shortcutLabelForCommand(keybindings, "chat.new", platform) ??
      (projectGroupCount <= 1
        ? shortcutLabelForCommand(keybindings, "chat.newLocal", platform)
        : undefined),
    newThreadInProjectShortcutLabel: shortcutLabelForCommand(
      keybindings,
      "chat.newLocal",
      platform,
    ),
  };
}

export function resolveSidebarNewThreadTooltip(input: {
  readonly newThreadShortcutLabel: string | null | undefined;
  readonly newThreadInProjectShortcutLabel: string | null | undefined;
  readonly showNewThreadInProjectHint: boolean;
}): { readonly label: string; readonly inProjectHint: string | null } {
  return {
    label: input.newThreadShortcutLabel
      ? `New thread (${input.newThreadShortcutLabel})`
      : "New thread",
    inProjectHint: input.showNewThreadInProjectHint
      ? `New thread in current project: Shift+click${
          input.newThreadInProjectShortcutLabel ? ` (${input.newThreadInProjectShortcutLabel})` : ""
        }`
      : null,
  };
}

export type SidebarEmptyState =
  | { readonly kind: "no-projects" }
  | { readonly kind: "no-threads"; readonly label: string };

export function resolveSidebarEmptyState(input: {
  readonly isSearching: boolean;
  readonly visibleDraftSessionCount: number;
  readonly threadCount: number;
  readonly projectCount: number;
  readonly scopedProjectGroup: Pick<SidebarProjectSnapshot, "displayName"> | null;
}): SidebarEmptyState | null {
  if (input.isSearching || input.visibleDraftSessionCount !== 0 || input.threadCount !== 0) {
    return null;
  }
  if (input.projectCount === 0) return { kind: "no-projects" };
  return {
    kind: "no-threads",
    label: input.scopedProjectGroup
      ? `No threads in ${input.scopedProjectGroup.displayName} yet`
      : "No threads yet",
  };
}
