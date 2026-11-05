import type {
  EnvironmentId,
  EnvironmentMachineKind,
  VcsRef,
  ProjectId,
  WorktreeSubmodules,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { deriveLocalBranchNameFromRemoteRef, sanitizeNewRefName } from "@t3tools/shared/git";
import { toSortableTimestamp } from "../lib/threadSort";
export {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  sanitizeNewRefName,
} from "@t3tools/shared/git";

export interface EnvironmentOption {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  label: string;
  isPrimary: boolean;
  machine: EnvironmentMachineKind;
}

export const EnvMode = Schema.Literals(["local", "worktree"]);
export type EnvMode = typeof EnvMode.Type;

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

function normalizeDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveEnvironmentOptionLabel(input: {
  isPrimary: boolean;
  environmentId: EnvironmentId;
  runtimeLabel?: string | null;
  savedLabel?: string | null;
}): string {
  const runtimeLabel = normalizeDisplayLabel(input.runtimeLabel);
  const savedLabel = normalizeDisplayLabel(input.savedLabel);

  if (input.isPrimary) {
    const preferredLocalLabel = [runtimeLabel, savedLabel].find((label) => {
      if (!label) return false;
      return !GENERIC_LOCAL_ENVIRONMENT_LABELS.has(label.toLowerCase());
    });
    return preferredLocalLabel ?? "This device";
  }

  return runtimeLabel ?? savedLabel ?? input.environmentId;
}

// A remote (non-primary) environment is always surfaced, even when it is the
// only environment available: with a single connected machine there is nothing
// to pick, but the user still needs to see where the project runs.
export function shouldShowEnvironmentIndicator(input: {
  activeEnvironment: Pick<EnvironmentOption, "isPrimary"> | null;
  canPickEnvironment: boolean;
}): boolean {
  if (input.canPickEnvironment) return true;
  return input.activeEnvironment !== null && !input.activeEnvironment.isPrimary;
}

export function shouldShowComposerContextStrip(input: {
  hasActiveProject: boolean;
  isGitRepo: boolean;
  showEnvironmentIndicator: boolean;
  /** A collapsed composer's controls currently fit in their measured strip host. */
  hostsRestingComposerControls: boolean;
}): boolean {
  return (
    input.hasActiveProject &&
    (input.isGitRepo || input.showEnvironmentIndicator || input.hostsRestingComposerControls)
  );
}

// Labels collapse to icons when the strip's content no longer fits. A small
// hysteresis on the way back out keeps the boundary from flapping.
const CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX = 16;

export function resolveContextStripLabelsCompact(input: {
  compact: boolean;
  neededWidth: number;
  availableWidth: number;
}): boolean {
  return input.compact
    ? input.neededWidth > input.availableWidth - CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX
    : input.neededWidth > input.availableWidth;
}

export function resolveEnvModeLabel(mode: EnvMode): string {
  return mode === "worktree" ? "New worktree" : "Current checkout";
}

export const WORKTREE_SUBMODULES_LABELS: Record<WorktreeSubmodules, string> = {
  recursive: "Recursive",
  "top-level": "Top level only",
  none: "Skip",
};

export function resolveCurrentWorkspaceLabel(activeWorktreePath: string | null): string {
  return activeWorktreePath ? "Current worktree" : resolveEnvModeLabel("local");
}

// A locked thread in worktree mode with no path is still creating its
// worktree, so it reads as a new worktree rather than the project checkout.
export function resolveLockedWorkspaceLabel(
  activeWorktreePath: string | null,
  effectiveEnvMode: EnvMode,
): string {
  if (activeWorktreePath) return "Worktree";
  return effectiveEnvMode === "worktree" ? resolveEnvModeLabel("worktree") : "Local checkout";
}

export type WorkspaceIconKind = "folder" | "folder-git" | "folder-git-2";

export function resolveWorkspaceIconKind(input: {
  locked: boolean;
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): WorkspaceIconKind {
  if (input.locked) {
    if (input.activeWorktreePath) return "folder-git";
    return input.effectiveEnvMode === "worktree" ? "folder-git-2" : "folder";
  }
  if (input.effectiveEnvMode === "worktree") return "folder-git-2";
  return input.activeWorktreePath ? "folder-git" : "folder";
}

export interface PreviousWorktreeSeed {
  branch: string | null;
  worktreePath: string;
}

// The most recently touched worktree in the project that the composer isn't
// already pointing at. Backs the "Previous worktree" entry in the workspace
// selector so a follow-up thread can hop back into the worktree you just
// worked in without hunting for its branch. Archived threads don't compete —
// the rest of the UI hides them, so their worktrees shouldn't resurface here.
export function resolvePreviousWorktreeSeed(input: {
  threads: ReadonlyArray<{
    branch: string | null;
    worktreePath: string | null;
    updatedAt: string;
    archivedAt?: string | null;
  }>;
  currentWorktreePath: string | null;
}): PreviousWorktreeSeed | null {
  let latest: { branch: string | null; worktreePath: string; updatedAt: number } | null = null;
  for (const thread of input.threads) {
    if (
      !thread.worktreePath ||
      thread.worktreePath === input.currentWorktreePath ||
      (thread.archivedAt ?? null) !== null
    ) {
      continue;
    }
    const updatedAt = toSortableTimestamp(thread.updatedAt);
    if (updatedAt === null) {
      continue;
    }
    if (latest === null || updatedAt > latest.updatedAt) {
      latest = {
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        updatedAt,
      };
    }
  }
  return latest === null ? null : { branch: latest.branch, worktreePath: latest.worktreePath };
}

export function resolvePreviousWorktreeLabel(seed: PreviousWorktreeSeed): string {
  return seed.branch ? `Previous worktree (${seed.branch})` : "Previous worktree";
}

export function resolveEffectiveEnvMode(input: {
  activeWorktreePath: string | null;
  hasServerThread: boolean;
  draftThreadEnvMode: EnvMode | undefined;
  /**
   * The server is still creating this thread's worktree. The thread exists
   * from the start of that setup but gets its worktree path only at the end.
   */
  preparingWorktree?: boolean;
}): EnvMode {
  const { activeWorktreePath, hasServerThread, draftThreadEnvMode, preparingWorktree } = input;
  if (!hasServerThread) {
    if (activeWorktreePath) {
      return "local";
    }
    return draftThreadEnvMode === "worktree" ? "worktree" : "local";
  }
  return activeWorktreePath || preparingWorktree ? "worktree" : "local";
}

export function resolveDraftEnvModeAfterBranchChange(input: {
  nextWorktreePath: string | null;
  currentWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): EnvMode {
  const { nextWorktreePath, currentWorktreePath, effectiveEnvMode } = input;
  if (nextWorktreePath) {
    return "worktree";
  }
  if (effectiveEnvMode === "worktree" && !currentWorktreePath) {
    return "worktree";
  }
  return "local";
}

export function resolveBranchToolbarValue(input: {
  envMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): string | null {
  const { envMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (envMode === "worktree" && !activeWorktreePath) {
    return activeThreadBranch ?? currentGitBranch;
  }
  return currentGitBranch ?? activeThreadBranch;
}

export function resolveBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
  resolvedActiveBranchIsRemote: boolean | null;
  startFromOrigin: boolean;
}): string {
  const {
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote,
    startFromOrigin,
  } = input;
  if (!resolvedActiveBranch) {
    return "Select ref";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    const baseRef =
      startFromOrigin && resolvedActiveBranchIsRemote === false
        ? `origin/${resolvedActiveBranch}`
        : resolvedActiveBranch;
    return `From ${baseRef}`;
  }
  return resolvedActiveBranch;
}

export function resolveBranchToolbarPrBranch(input: {
  activeThreadBranch: string | null;
  resolvedActiveBranch: string | null;
}): string | null {
  return input.activeThreadBranch === input.resolvedActiveBranch ? input.activeThreadBranch : null;
}

export function resolveLocalCheckoutBranchMismatch(input: {
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): { threadBranch: string; currentBranch: string } | null {
  const { effectiveEnvMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (effectiveEnvMode !== "local" || activeWorktreePath !== null) {
    return null;
  }
  if (!activeThreadBranch || !currentGitBranch || activeThreadBranch === currentGitBranch) {
    return null;
  }
  return { threadBranch: activeThreadBranch, currentBranch: currentGitBranch };
}

export function resolveBranchSelectionTarget(input: {
  activeProjectCwd: string;
  activeWorktreePath: string | null;
  refName: Pick<VcsRef, "isDefault" | "worktreePath">;
}): {
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
} {
  const { activeProjectCwd, activeWorktreePath, refName } = input;

  if (refName.worktreePath) {
    return {
      checkoutCwd: refName.worktreePath,
      nextWorktreePath: refName.worktreePath === activeProjectCwd ? null : refName.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  const nextWorktreePath =
    activeWorktreePath !== null && refName.isDefault ? null : activeWorktreePath;

  return {
    checkoutCwd: nextWorktreePath ?? activeProjectCwd,
    nextWorktreePath,
    reuseExistingWorktree: false,
  };
}

export function shouldIncludeBranchPickerItem(input: {
  itemValue: string;
  normalizedQuery: string;
  createBranchItemValue: string | null;
  checkoutPullRequestItemValue: string | null;
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue, checkoutPullRequestItemValue } = input;

  if (normalizedQuery.length === 0) {
    return true;
  }

  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return true;
  }

  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return true;
  }

  const lowerItemValue = itemValue.toLowerCase();
  if (lowerItemValue.includes(normalizedQuery)) {
    return true;
  }

  // A query containing whitespace can only ever match a ref under its sanitized
  // name, because that is the name such a ref would have been created with.
  // Without this, typing "new branch" hides an existing "new-branch".
  const sanitizedQuery = sanitizeNewRefName(normalizedQuery);
  return (
    sanitizedQuery.length > 0 &&
    sanitizedQuery !== normalizedQuery &&
    lowerItemValue.includes(sanitizedQuery)
  );
}

export const CHECKOUT_PULL_REQUEST_ITEM_PREFIX = "__checkout_pull_request__:";
export const CREATE_BRANCH_ITEM_PREFIX = "__create_new_branch__:";

export interface BranchPickerItems {
  readonly items: ReadonlyArray<string>;
  readonly filteredItems: ReadonlyArray<string>;
  readonly createBranchItemValue: string | null;
  readonly checkoutPullRequestItemValue: string | null;
  readonly newRefName: string;
}

export function resolveBranchPickerItems(input: {
  refNames: ReadonlyArray<string>;
  trimmedQuery: string;
  deferredTrimmedQuery: string;
  isSelectingWorktreeBase: boolean;
  prReference: string | null;
  canCheckoutPullRequest: boolean;
}): BranchPickerItems {
  const checkoutPullRequestItemValue =
    input.prReference && input.canCheckoutPullRequest
      ? `${CHECKOUT_PULL_REQUEST_ITEM_PREFIX}${input.prReference}`
      : null;
  const canCreateBranch = !input.isSelectingWorktreeBase && input.trimmedQuery.length > 0;
  const newRefName = sanitizeNewRefName(input.trimmedQuery);
  const hasExactBranchMatch = input.refNames.includes(newRefName);
  const createBranchItemValue = canCreateBranch
    ? `${CREATE_BRANCH_ITEM_PREFIX}${input.trimmedQuery}`
    : null;
  const items = [...input.refNames];
  if (createBranchItemValue && !hasExactBranchMatch) {
    items.push(createBranchItemValue);
  }
  if (checkoutPullRequestItemValue) {
    items.unshift(checkoutPullRequestItemValue);
  }
  const normalizedQuery = input.deferredTrimmedQuery.toLowerCase();
  const filteredItems =
    normalizedQuery.length === 0
      ? items
      : items.filter((itemValue) =>
          shouldIncludeBranchPickerItem({
            itemValue,
            normalizedQuery,
            createBranchItemValue,
            checkoutPullRequestItemValue,
          }),
        );
  return { items, filteredItems, createBranchItemValue, checkoutPullRequestItemValue, newRefName };
}

export type BranchPickerBadge = "current" | "worktree" | "remote" | "default";

export function resolveBranchPickerBadge(
  refName: Pick<VcsRef, "current" | "worktreePath" | "isRemote" | "isDefault">,
  activeProjectCwd: string | null,
): BranchPickerBadge | null {
  const hasSecondaryWorktree =
    refName.worktreePath && activeProjectCwd && refName.worktreePath !== activeProjectCwd;
  if (refName.current) return "current";
  if (hasSecondaryWorktree) return "worktree";
  if (refName.isRemote) return "remote";
  if (refName.isDefault) return "default";
  return null;
}

export function resolveBranchStatusText(input: {
  isInitialBranchesLoadPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  loadedCount: number;
  totalCount: number;
}): string | null {
  if (input.isInitialBranchesLoadPending) return "Loading refs...";
  if (input.isFetchingNextPage) return "Loading more refs...";
  if (input.hasNextPage) return `Showing ${input.loadedCount} of ${input.totalCount} refs`;
  return null;
}

export function resolveActiveBranchIsRemote(input: {
  listedActiveBranch: Pick<VcsRef, "isRemote"> | null;
  queriedActiveBranch: Pick<VcsRef, "isRemote"> | undefined;
}): boolean | null {
  if (input.listedActiveBranch !== null) return input.listedActiveBranch.isRemote === true;
  if (input.queriedActiveBranch) return input.queriedActiveBranch.isRemote === true;
  return null;
}

// Default the worktree base to the repo default branch (origin/HEAD), only
// falling back to the checked-out branch when no default is known.
export function resolveWorktreeBaseBranchCandidate(input: {
  isInitialBranchesLoadPending: boolean;
  refs: ReadonlyArray<Pick<VcsRef, "name" | "isDefault">>;
  currentGitBranch: string | null;
}): string | null {
  if (input.isInitialBranchesLoadPending) return null;
  return input.refs.find((refName) => refName.isDefault)?.name ?? input.currentGitBranch;
}

export function shouldAutoSelectWorktreeBaseBranch(input: {
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  worktreeBaseBranchCandidate: string | null;
}): boolean {
  return (
    input.effectiveEnvMode === "worktree" &&
    !input.activeWorktreePath &&
    !input.activeThreadBranch &&
    input.worktreeBaseBranchCandidate !== null &&
    input.worktreeBaseBranchCandidate.length > 0
  );
}

export interface ThreadBranchChangePlan {
  readonly stopSession: boolean;
  readonly updateServerMetadata: boolean;
  readonly draftContext: {
    readonly envMode: EnvMode;
    readonly environmentSelection: "auto" | "manual";
  } | null;
}

export function resolveThreadBranchChangePlan(input: {
  hasServerThread: boolean;
  hasServerSession: boolean;
  worktreePath: string | null;
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  automatic: boolean;
  draftEnvironmentSelection: "auto" | "manual" | undefined;
}): ThreadBranchChangePlan {
  const stopSession = input.hasServerSession && input.worktreePath !== input.activeWorktreePath;
  if (input.hasServerThread) {
    return { stopSession, updateServerMetadata: true, draftContext: null };
  }
  return {
    stopSession,
    updateServerMetadata: false,
    draftContext: {
      envMode: resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: input.worktreePath,
        currentWorktreePath: input.activeWorktreePath,
        effectiveEnvMode: input.effectiveEnvMode,
      }),
      environmentSelection: input.automatic
        ? (input.draftEnvironmentSelection ?? "auto")
        : "manual",
    },
  };
}

export type BranchSelectionPlan =
  | { readonly kind: "set-worktree-base" }
  | { readonly kind: "reuse-worktree"; readonly nextWorktreePath: string | null }
  | {
      readonly kind: "checkout";
      readonly checkoutCwd: string;
      readonly nextWorktreePath: string | null;
      readonly selectedBranchName: string;
    };

export function resolveBranchSelectionPlan(input: {
  isSelectingWorktreeBase: boolean;
  activeProjectCwd: string;
  activeWorktreePath: string | null;
  refName: Pick<VcsRef, "name" | "isDefault" | "isRemote" | "worktreePath">;
}): BranchSelectionPlan {
  if (input.isSelectingWorktreeBase) return { kind: "set-worktree-base" };
  const selectionTarget = resolveBranchSelectionTarget({
    activeProjectCwd: input.activeProjectCwd,
    activeWorktreePath: input.activeWorktreePath,
    refName: input.refName,
  });
  if (selectionTarget.reuseExistingWorktree) {
    return { kind: "reuse-worktree", nextWorktreePath: selectionTarget.nextWorktreePath };
  }
  return {
    kind: "checkout",
    checkoutCwd: selectionTarget.checkoutCwd,
    nextWorktreePath: selectionTarget.nextWorktreePath,
    selectedBranchName: input.refName.isRemote
      ? deriveLocalBranchNameFromRemoteRef(input.refName.name)
      : input.refName.name,
  };
}

export function resolveSwitchedBranchName(input: {
  refName: Pick<VcsRef, "isRemote">;
  selectedBranchName: string;
  switchedRefName: string | null | undefined;
}): string {
  return input.refName.isRemote
    ? (input.switchedRefName ?? input.selectedBranchName)
    : input.selectedBranchName;
}

export interface BranchToolbarControls {
  readonly activeWorktreePath: string | null;
  readonly effectiveEnvMode: EnvMode;
  readonly envModeLocked: boolean;
  readonly canUsePreviousWorktree: boolean;
  readonly showEnvironmentPicker: boolean;
  readonly activeEnvironmentOption: EnvironmentOption | null;
  readonly showEnvironmentIndicator: boolean;
}

export function resolveBranchToolbarControls(input: {
  forceNewWorktree: boolean;
  envMode: EnvMode;
  envLocked: boolean;
  hasServerThread: boolean;
  hasDraftThread: boolean;
  threadWorktreePath: string | null;
  environmentId: EnvironmentId;
  availableEnvironments: ReadonlyArray<EnvironmentOption> | undefined;
  canChangeEnvironment: boolean;
}): BranchToolbarControls {
  const activeWorktreePath = input.forceNewWorktree ? null : input.threadWorktreePath;
  const envModeLocked = input.envLocked || (input.hasServerThread && activeWorktreePath !== null);
  // "Previous worktree" hops a draft into the most recently active worktree
  // of this project — the "keep going where I just was" follow-up flow. Only
  // drafts can hop; started server threads have their workspace pinned.
  const canUsePreviousWorktree =
    input.hasDraftThread && !input.hasServerThread && !envModeLocked && !input.forceNewWorktree;
  const showEnvironmentPicker = Boolean(
    input.availableEnvironments &&
    input.availableEnvironments.length > 1 &&
    input.canChangeEnvironment,
  );
  const activeEnvironmentOption =
    input.availableEnvironments?.find((env) => env.environmentId === input.environmentId) ?? null;
  return {
    activeWorktreePath,
    effectiveEnvMode: input.forceNewWorktree ? "worktree" : input.envMode,
    envModeLocked,
    canUsePreviousWorktree,
    showEnvironmentPicker,
    activeEnvironmentOption,
    showEnvironmentIndicator: shouldShowEnvironmentIndicator({
      activeEnvironment: activeEnvironmentOption,
      canPickEnvironment: showEnvironmentPicker,
    }),
  };
}

export const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";

export function resolveEnvModeSelectItems(input: {
  activeWorktreePath: string | null;
  previousWorktreeLabel: string | null;
}): Array<{ value: string; label: string }> {
  return [
    { value: "local", label: resolveCurrentWorkspaceLabel(input.activeWorktreePath) },
    { value: "worktree", label: resolveEnvModeLabel("worktree") },
    ...(input.previousWorktreeLabel
      ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: input.previousWorktreeLabel }]
      : []),
  ];
}

export function resolveEnvModeTooltip(input: {
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
}): string {
  return input.effectiveEnvMode === "worktree"
    ? resolveEnvModeLabel("worktree")
    : resolveCurrentWorkspaceLabel(input.activeWorktreePath);
}

export function resolveLockedWorkspaceTooltip(input: {
  forceNewWorktree: boolean;
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): string {
  return input.forceNewWorktree
    ? "Each model starts in its own worktree."
    : resolveLockedWorkspaceLabel(input.activeWorktreePath, input.effectiveEnvMode);
}

export function resolveEnvironmentSelectItems(input: {
  availableEnvironments: ReadonlyArray<EnvironmentOption>;
  autoEnvironmentLabel: string | undefined;
  canAutoEnvironment: boolean;
}): Array<{ value: string; label: string }> {
  return [
    ...(input.canAutoEnvironment
      ? [{ value: "auto", label: input.autoEnvironmentLabel ?? "Auto balance" }]
      : []),
    ...input.availableEnvironments.map((env) => ({
      value: env.environmentId,
      label: env.label,
    })),
  ];
}
