import type {
  GitActionProgressEvent,
  GitRunStackedActionResult,
  GitStackedAction,
  VcsPullResult,
  VcsStatusResult,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import {
  DEFAULT_CHANGE_REQUEST_TERMINOLOGY,
  getChangeRequestTerminology,
  resolveChangeRequestPresentation,
  type ChangeRequestPresentation,
  type ChangeRequestTerminology,
} from "@t3tools/shared/sourceControl";

export type GitActionIconName = "commit" | "push" | "pr";

export type GitDialogAction = "commit" | "push" | "create_pr";

export interface GitActionMenuItem {
  id: "commit" | "push" | "pr";
  label: string;
  disabled: boolean;
  icon: GitActionIconName;
  kind: "open_dialog" | "open_pr";
  dialogAction?: GitDialogAction;
}

export interface GitQuickAction {
  label: string;
  disabled: boolean;
  kind: "run_action" | "run_pull" | "open_pr" | "open_publish" | "show_hint";
  action?: GitStackedAction;
  hint?: string;
}

export interface DefaultBranchActionDialogCopy {
  title: string;
  description: string;
  continueLabel: string;
}

export type DefaultBranchConfirmableAction =
  | "push"
  | "create_pr"
  | "commit_push"
  | "commit_push_pr";

export function resolveChangeRequestTerminology(
  gitStatus: VcsStatusResult | null,
): ChangeRequestTerminology {
  return gitStatus?.sourceControlProvider
    ? getChangeRequestTerminology(gitStatus.sourceControlProvider)
    : DEFAULT_CHANGE_REQUEST_TERMINOLOGY;
}

export function buildGitActionProgressStages(input: {
  action: GitStackedAction;
  hasCustomCommitMessage: boolean;
  hasWorkingTreeChanges: boolean;
  pushTarget?: string;
  featureBranch?: boolean;
  shouldPushBeforePr?: boolean;
  terminology?: ChangeRequestTerminology;
}): string[] {
  const terminology = input.terminology ?? DEFAULT_CHANGE_REQUEST_TERMINOLOGY;
  const branchStages = input.featureBranch ? ["Preparing feature ref..."] : [];
  const pushStage = input.pushTarget ? `Pushing to ${input.pushTarget}...` : "Pushing...";
  const prStages = [
    `Preparing ${terminology.shortLabel}...`,
    `Generating ${terminology.shortLabel} content...`,
    `Creating ${terminology.singular}...`,
  ];

  if (input.action === "push") {
    return [pushStage];
  }
  if (input.action === "create_pr") {
    return input.shouldPushBeforePr ? [pushStage, ...prStages] : prStages;
  }

  const shouldIncludeCommitStages = input.action === "commit" || input.hasWorkingTreeChanges;
  const commitStages = !shouldIncludeCommitStages
    ? []
    : input.hasCustomCommitMessage
      ? ["Committing..."]
      : ["Generating commit message...", "Committing..."];
  if (input.action === "commit") {
    return [...branchStages, ...commitStages];
  }
  if (input.action === "commit_push") {
    return [...branchStages, ...commitStages, pushStage];
  }
  return [...branchStages, ...commitStages, pushStage, ...prStages];
}

export function buildMenuItems(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  hasPrimaryRemote = true,
): GitActionMenuItem[] {
  if (!gitStatus) return [];
  const terminology = resolveChangeRequestTerminology(gitStatus);

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isBehind = gitStatus.behindCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const canPushWithoutUpstream = hasPrimaryRemote && !gitStatus.hasUpstream;
  const canCommit = !isBusy && hasChanges;
  const canPush =
    !isBusy &&
    hasBranch &&
    !isBehind &&
    gitStatus.aheadCount > 0 &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canCreatePr =
    !isBusy &&
    hasBranch &&
    !hasChanges &&
    !hasOpenPr &&
    hasDefaultBranchDelta &&
    !isBehind &&
    (gitStatus.hasUpstream || canPushWithoutUpstream);
  const canOpenPr = !isBusy && hasOpenPr;

  const commitItem: GitActionMenuItem = {
    id: "commit",
    label: "Commit",
    disabled: !canCommit,
    icon: "commit",
    kind: "open_dialog",
    dialogAction: "commit",
  };

  if (!hasPrimaryRemote) {
    return [commitItem];
  }

  return [
    commitItem,
    {
      id: "push",
      label: "Push",
      disabled: !canPush,
      icon: "push",
      kind: "open_dialog",
      dialogAction: "push",
    },
    hasOpenPr
      ? {
          id: "pr",
          label: `View ${terminology.shortLabel}`,
          disabled: !canOpenPr,
          icon: "pr",
          kind: "open_pr",
        }
      : {
          id: "pr",
          label: `Create ${terminology.shortLabel}`,
          disabled: !canCreatePr,
          icon: "pr",
          kind: "open_dialog",
          dialogAction: "create_pr",
        },
  ];
}

export function resolveQuickAction(
  gitStatus: VcsStatusResult | null,
  isBusy: boolean,
  isDefaultRef = false,
  hasPrimaryRemote = true,
): GitQuickAction {
  if (isBusy) {
    return { label: "Commit", disabled: true, kind: "show_hint", hint: "Git action in progress." };
  }

  if (!gitStatus) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: "Git status is unavailable.",
    };
  }

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const hasDefaultBranchDelta = (gitStatus.aheadOfDefaultCount ?? gitStatus.aheadCount) > 0;
  const isBehind = gitStatus.behindCount > 0;
  const isDiverged = isAhead && isBehind;
  const terminology = resolveChangeRequestTerminology(gitStatus);

  if (!hasBranch) {
    return {
      label: "Commit",
      disabled: true,
      kind: "show_hint",
      hint: `Create and checkout a ref before pushing or opening a ${terminology.singular}.`,
    };
  }

  if (hasChanges) {
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
      return { label: "Commit", disabled: false, kind: "run_action", action: "commit" };
    }
    if (hasOpenPr || isDefaultRef) {
      return { label: "Commit & push", disabled: false, kind: "run_action", action: "commit_push" };
    }
    return {
      label: `Commit, push & ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "commit_push_pr",
    };
  }

  if (!gitStatus.hasUpstream) {
    if (!hasPrimaryRemote) {
      if (hasOpenPr && !isAhead) {
        return { label: `View ${terminology.shortLabel}`, disabled: false, kind: "open_pr" };
      }
      return {
        label: "Publish repository",
        disabled: false,
        kind: "open_publish",
      };
    }
    if (!isAhead) {
      if (hasOpenPr) {
        return { label: `View ${terminology.shortLabel}`, disabled: false, kind: "open_pr" };
      }
      return {
        label: "Push",
        disabled: true,
        kind: "show_hint",
        hint: "No local commits to push.",
      };
    }
    if (hasOpenPr || isDefaultRef) {
      return {
        label: "Push",
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: `Push & create ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (isDiverged) {
    return {
      label: "Sync ref",
      disabled: true,
      kind: "show_hint",
      hint: "Branch has diverged from upstream. Rebase/merge first.",
    };
  }

  if (isBehind) {
    return {
      label: "Pull",
      disabled: false,
      kind: "run_pull",
    };
  }

  if (isAhead) {
    if (hasOpenPr || isDefaultRef) {
      return {
        label: "Push",
        disabled: false,
        kind: "run_action",
        action: isDefaultRef ? "commit_push" : "push",
      };
    }
    return {
      label: `Push & create ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  if (hasOpenPr && gitStatus.hasUpstream) {
    return { label: `View ${terminology.shortLabel}`, disabled: false, kind: "open_pr" };
  }

  if (hasDefaultBranchDelta && !isDefaultRef) {
    return {
      label: `Create ${terminology.shortLabel}`,
      disabled: false,
      kind: "run_action",
      action: "create_pr",
    };
  }

  return {
    label: "Commit",
    disabled: true,
    kind: "show_hint",
    hint: "Branch is up to date. No action needed.",
  };
}

export function requiresDefaultBranchConfirmation(
  action: GitStackedAction,
  isDefaultRef: boolean,
): boolean {
  if (!isDefaultRef) return false;
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveDefaultBranchActionDialogCopy(input: {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  terminology?: ChangeRequestTerminology;
}): DefaultBranchActionDialogCopy {
  const branchLabel = input.branchName;
  const suffix = ` on "${branchLabel}". You can continue on this ref or create a feature ref and run the same action there.`;
  const terminology = input.terminology ?? DEFAULT_CHANGE_REQUEST_TERMINOLOGY;

  if (input.action === "push" || input.action === "commit_push") {
    if (input.includesCommit) {
      return {
        title: "Commit & push to default ref?",
        description: `This action will commit and push changes${suffix}`,
        continueLabel: `Commit & push to ${branchLabel}`,
      };
    }
    return {
      title: "Push to default ref?",
      description: `This action will push local commits${suffix}`,
      continueLabel: `Push to ${branchLabel}`,
    };
  }

  if (input.includesCommit) {
    return {
      title: `Commit, push & create ${terminology.shortLabel} from default ref?`,
      description: `This action will commit, push, and create a ${terminology.singular}${suffix}`,
      continueLabel: `Commit, push & create ${terminology.shortLabel}`,
    };
  }
  return {
    title: `Push & create ${terminology.shortLabel} from default ref?`,
    description: `This action will push local commits and create a ${terminology.singular}${suffix}`,
    continueLabel: `Push & create ${terminology.shortLabel}`,
  };
}

export function resolveThreadBranchUpdate(
  result: GitRunStackedActionResult,
): { branch: string } | null {
  if (result.branch.status !== "created" || !result.branch.name) {
    return null;
  }

  return {
    branch: result.branch.name,
  };
}

export function resolveThreadBranchMetadataPatch(
  branch: string | null,
  expectedBranch: string | null,
): {
  branch: string | null;
  expectedBranch: string | null;
} {
  return { branch, expectedBranch };
}

export function resolveLiveThreadBranchUpdate(input: {
  threadBranch: string | null;
  gitStatus: VcsStatusResult | null;
}): { branch: string | null } | null {
  if (!input.gitStatus) {
    return null;
  }

  if (input.gitStatus.refName === null && input.threadBranch !== null) {
    return null;
  }

  if (input.threadBranch === input.gitStatus.refName) {
    return null;
  }

  if (
    input.threadBranch !== null &&
    input.gitStatus.refName !== null &&
    !isTemporaryWorktreeBranch(input.threadBranch) &&
    isTemporaryWorktreeBranch(input.gitStatus.refName)
  ) {
    return null;
  }

  return {
    branch: input.gitStatus.refName,
  };
}

export type GitToolbarIconId =
  | "git-commit"
  | "cloud-upload"
  | "cloud-download"
  | "info"
  | "git-branch-plus"
  | "source-control";

export type SourceControlIconId = ChangeRequestPresentation["icon"];

export const GIT_ACTION_COPY = {
  genericError: "An error occurred.",
  runningFallback: "Running git action...",
  waitingForGit: "Waiting for Git...",
  actionFailed: "Action failed",
  pulling: "Pulling...",
  pullFailed: "Pull failed",
  initFailed: "Git initialization failed",
  noOpenPr: "No open pull request found.",
  openPrLinkFailed: "Unable to open pull request link",
  editorUnavailable: "Editor opening is unavailable.",
  openFileFailed: "Unable to open file",
};

export function resolveGitMenuItemIcon(icon: GitActionIconName): GitToolbarIconId {
  if (icon === "commit") return "git-commit";
  if (icon === "push") return "cloud-upload";
  return "source-control";
}

export function resolveGitQuickActionIcon(quickAction: GitQuickAction): GitToolbarIconId {
  if (quickAction.kind === "open_pr") return "source-control";
  if (quickAction.kind === "open_publish") return "cloud-upload";
  if (quickAction.kind === "run_pull") return "cloud-download";
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return "git-commit";
    if (quickAction.action === "push" || quickAction.action === "commit_push") {
      return "cloud-upload";
    }
    return "source-control";
  }
  if (quickAction.label === "Commit") return "git-commit";
  if (quickAction.label === "Push") return "cloud-upload";
  return "info";
}

export function resolveGitMenuItemDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasPrimaryRemote,
}: {
  item: GitActionMenuItem;
  gitStatus: VcsStatusResult | null;
  isBusy: boolean;
  hasPrimaryRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";

  const hasBranch = gitStatus.refName !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;
  const terminology = resolveChangeRequestTerminology(gitStatus);

  if (item.id === "commit") {
    if (!hasChanges) {
      return "Worktree is clean. Make changes before committing.";
    }
    return "Commit is currently unavailable.";
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return "Detached HEAD: check out a branch before pushing.";
    }
    if (hasChanges) {
      return "Commit or stash local changes before pushing.";
    }
    if (isBehind) {
      return "Branch is behind upstream. Pull/rebase before pushing.";
    }
    if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
      return 'Add an "origin" remote before pushing.';
    }
    if (!isAhead) {
      return "No local commits to push.";
    }
    return "Push is currently unavailable.";
  }

  if (hasOpenPr) {
    return `View ${terminology.singular} is currently unavailable.`;
  }
  if (!hasBranch) {
    return `Detached HEAD: check out a branch before creating a ${terminology.singular}.`;
  }
  if (hasChanges) {
    return `Commit local changes before creating a ${terminology.singular}.`;
  }
  if (!gitStatus.hasUpstream && !hasPrimaryRemote) {
    return `Add an "origin" remote before creating a ${terminology.singular}.`;
  }
  if (!isAhead) {
    return `No local commits to include in a ${terminology.singular}.`;
  }
  if (isBehind) {
    return `Branch is behind upstream. Pull/rebase before creating a ${terminology.singular}.`;
  }
  return `Create ${terminology.singular} is currently unavailable.`;
}

export interface GitActionMenuItemModel extends GitActionMenuItem {
  readonly key: string;
  readonly iconId: GitToolbarIconId;
  readonly disabledReason: string | null;
}

export interface GitMenuNotice {
  readonly id: "detached-head" | "behind-upstream" | "status-error";
  readonly tone: "warning" | "destructive";
  readonly text: string;
}

export interface GitActionsToolbarInput {
  readonly gitCwd: string | null;
  readonly gitStatus: VcsStatusResult | null;
  readonly gitStatusError: string | null;
  readonly isGitActionRunning: boolean;
  readonly isInitPending: boolean;
}

export type GitActionsToolbarModel =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "init";
      readonly label: string;
      readonly icon: GitToolbarIconId;
      readonly disabled: boolean;
    }
  | {
      readonly kind: "repo";
      readonly sourceControlIcon: SourceControlIconId;
      readonly terminology: ChangeRequestTerminology;
      readonly isDefaultRef: boolean;
      readonly hasPrimaryRemote: boolean;
      readonly quickAction: GitQuickAction;
      readonly quickActionIcon: GitToolbarIconId;
      readonly quickActionDisabledReason: string | null;
      readonly quickActionButtonDisabled: boolean;
      readonly quickActionMenuItemDisabled: boolean;
      readonly groupAriaLabel: string;
      readonly menuTriggerAriaLabel: string;
      readonly menuTriggerDisabled: boolean;
      readonly submenuLabel: string;
      readonly menuItems: ReadonlyArray<GitActionMenuItemModel>;
      readonly publishItem: {
        readonly label: string;
        readonly icon: GitToolbarIconId;
        readonly disabled: boolean;
      } | null;
      readonly notices: ReadonlyArray<GitMenuNotice>;
    };

export function buildGitActionsToolbarModel(input: GitActionsToolbarInput): GitActionsToolbarModel {
  if (!input.gitCwd) return { kind: "hidden" };
  const { gitStatus, isGitActionRunning } = input;
  // Default to true while loading so we don't flash init controls.
  const isRepo = gitStatus?.isRepo ?? true;
  if (!isRepo) {
    return {
      kind: "init",
      label: input.isInitPending ? "Initializing..." : "Initialize Git",
      icon: "git-branch-plus",
      disabled: input.isInitPending,
    };
  }
  const hasPrimaryRemote = gitStatus?.hasPrimaryRemote ?? false;
  const isDefaultRef = gitStatus?.isDefaultRef ?? false;
  const quickAction = resolveQuickAction(
    gitStatus,
    isGitActionRunning,
    isDefaultRef,
    hasPrimaryRemote,
  );
  const quickActionDisabledReason = quickAction.disabled
    ? (quickAction.hint ?? "This action is currently unavailable.")
    : null;
  const notices: GitMenuNotice[] = [];
  if (gitStatus?.refName === null) {
    notices.push({
      id: "detached-head",
      tone: "warning",
      text: "Detached HEAD: create and check out a branch to enable push and pull request actions.",
    });
  }
  if (
    gitStatus &&
    gitStatus.refName !== null &&
    !gitStatus.hasWorkingTreeChanges &&
    gitStatus.behindCount > 0 &&
    gitStatus.aheadCount === 0
  ) {
    notices.push({
      id: "behind-upstream",
      tone: "warning",
      text: "Behind upstream. Pull/rebase first.",
    });
  }
  if (input.gitStatusError) {
    notices.push({ id: "status-error", tone: "destructive", text: input.gitStatusError });
  }
  return {
    kind: "repo",
    sourceControlIcon: resolveChangeRequestPresentation(gitStatus?.sourceControlProvider).icon,
    terminology: resolveChangeRequestTerminology(gitStatus),
    isDefaultRef,
    hasPrimaryRemote,
    quickAction,
    quickActionIcon: resolveGitQuickActionIcon(quickAction),
    quickActionDisabledReason,
    quickActionButtonDisabled: isGitActionRunning || quickAction.disabled,
    quickActionMenuItemDisabled:
      isGitActionRunning || quickAction.disabled || !!quickActionDisabledReason,
    groupAriaLabel: "Git actions",
    menuTriggerAriaLabel: "Git action options",
    menuTriggerDisabled: isGitActionRunning,
    submenuLabel: "Git actions",
    menuItems: buildMenuItems(gitStatus, isGitActionRunning, hasPrimaryRemote).map((item) => ({
      ...item,
      key: `${item.id}-${item.label}`,
      iconId: resolveGitMenuItemIcon(item.icon),
      disabledReason: resolveGitMenuItemDisabledReason({
        item,
        gitStatus,
        isBusy: isGitActionRunning,
        hasPrimaryRemote,
      }),
    })),
    publishItem:
      gitStatus !== null && !hasPrimaryRemote
        ? { label: "Publish repository...", icon: "cloud-upload", disabled: isGitActionRunning }
        : null,
    notices,
  };
}

export type GitQuickActionIntent =
  | { readonly kind: "none" }
  | { readonly kind: "open_pr" }
  | { readonly kind: "open_publish" }
  | { readonly kind: "run_pull" }
  | { readonly kind: "show_hint"; readonly title: string; readonly description: string | undefined }
  | { readonly kind: "run_action"; readonly action: GitStackedAction };

export function resolveGitQuickActionIntent(quickAction: GitQuickAction): GitQuickActionIntent {
  if (quickAction.kind === "open_pr") return { kind: "open_pr" };
  if (quickAction.kind === "open_publish") return { kind: "open_publish" };
  if (quickAction.kind === "run_pull") return { kind: "run_pull" };
  if (quickAction.kind === "show_hint") {
    return { kind: "show_hint", title: quickAction.label, description: quickAction.hint };
  }
  return quickAction.action ? { kind: "run_action", action: quickAction.action } : { kind: "none" };
}

export type GitMenuItemIntent =
  | { readonly kind: "none" }
  | { readonly kind: "open_pr" }
  | { readonly kind: "run_action"; readonly action: "push" | "create_pr" }
  | { readonly kind: "open_commit_dialog" };

export function resolveGitMenuItemIntent(item: GitActionMenuItem): GitMenuItemIntent {
  if (item.disabled) return { kind: "none" };
  if (item.kind === "open_pr") return { kind: "open_pr" };
  if (item.dialogAction === "push") return { kind: "run_action", action: "push" };
  if (item.dialogAction === "create_pr") return { kind: "run_action", action: "create_pr" };
  return { kind: "open_commit_dialog" };
}

export type OpenExistingPrIntent =
  | { readonly kind: "open_in_app"; readonly number: number }
  | { readonly kind: "open_url"; readonly url: string }
  | { readonly kind: "missing" };

export function resolveOpenExistingPrIntent(input: {
  readonly gitStatus: VcsStatusResult | null;
  readonly canOpenInApp: boolean;
}): OpenExistingPrIntent {
  const openPr = input.gitStatus?.pr?.state === "open" ? input.gitStatus.pr : null;
  // Beside the thread where it was made, the way the browser opens beside it. Checked before
  // the shell, which opening in the app does not need.
  if (openPr && input.canOpenInApp) return { kind: "open_in_app", number: openPr.number };
  const prUrl = openPr?.url ?? null;
  return prUrl ? { kind: "open_url", url: prUrl } : { kind: "missing" };
}

export interface GitActionRunRequest {
  readonly action: GitStackedAction;
  readonly commitMessage?: string;
  readonly filePaths?: string[];
  readonly featureBranch?: boolean;
  readonly skipDefaultBranchPrompt?: boolean;
}

export interface PendingDefaultBranchAction {
  readonly action: DefaultBranchConfirmableAction;
  readonly branchName: string;
  readonly includesCommit: boolean;
  readonly commitMessage?: string;
  readonly filePaths?: string[];
}

export interface GitStackedActionCommandInput {
  readonly action: GitStackedAction;
  readonly commitMessage?: string;
  readonly featureBranch?: boolean;
  readonly filePaths?: string[];
}

export type GitActionRunPlan =
  | { readonly kind: "confirm_default_branch"; readonly pending: PendingDefaultBranchAction }
  | {
      readonly kind: "run";
      readonly progressStages: ReadonlyArray<string>;
      readonly initialTitle: string;
      readonly command: GitStackedActionCommandInput;
    };

function isDefaultBranchConfirmableAction(
  action: GitStackedAction,
): action is DefaultBranchConfirmableAction {
  return (
    action === "push" ||
    action === "create_pr" ||
    action === "commit_push" ||
    action === "commit_push_pr"
  );
}

export function resolveGitActionRunPlan(input: {
  readonly request: GitActionRunRequest;
  readonly gitStatus: VcsStatusResult | null;
  readonly isDefaultRef: boolean;
  readonly terminology: ChangeRequestTerminology;
}): GitActionRunPlan {
  const { action, commitMessage, filePaths } = input.request;
  const featureBranch = input.request.featureBranch ?? false;
  const actionStatus = input.gitStatus;
  const actionBranch = actionStatus?.refName ?? null;
  const actionIsDefaultBranch = featureBranch ? false : input.isDefaultRef;
  const actionCanCommit =
    action === "commit" || action === "commit_push" || action === "commit_push_pr";
  const includesCommit =
    actionCanCommit &&
    (action === "commit" || !!actionStatus?.hasWorkingTreeChanges || featureBranch);
  if (
    !input.request.skipDefaultBranchPrompt &&
    requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
    actionBranch &&
    isDefaultBranchConfirmableAction(action)
  ) {
    return {
      kind: "confirm_default_branch",
      pending: {
        action,
        branchName: actionBranch,
        includesCommit,
        ...(commitMessage ? { commitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
      },
    };
  }
  const progressStages = buildGitActionProgressStages({
    action,
    hasCustomCommitMessage: !!commitMessage?.trim(),
    hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
    featureBranch,
    terminology: input.terminology,
    shouldPushBeforePr:
      action === "create_pr" && (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0),
  });
  return {
    kind: "run",
    progressStages,
    initialTitle: progressStages[0] ?? GIT_ACTION_COPY.runningFallback,
    command: {
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(featureBranch ? { featureBranch } : {}),
      ...(filePaths ? { filePaths } : {}),
    },
  };
}

export function resolveDefaultBranchContinuation(
  pending: PendingDefaultBranchAction,
  mode: "continue" | "feature_branch",
): GitActionRunRequest {
  return {
    action: pending.action,
    ...(pending.commitMessage ? { commitMessage: pending.commitMessage } : {}),
    ...(pending.filePaths ? { filePaths: pending.filePaths } : {}),
    ...(mode === "feature_branch" ? { featureBranch: true } : {}),
    skipDefaultBranchPrompt: true,
  };
}

export interface DefaultBranchConfirmationModel {
  readonly title: string;
  readonly description: string | undefined;
  readonly continueLabel: string;
  readonly abortLabel: string;
  readonly featureBranchLabel: string;
}

export function buildDefaultBranchConfirmationModel(
  pending: PendingDefaultBranchAction | null,
  terminology: ChangeRequestTerminology,
): DefaultBranchConfirmationModel {
  const copy = pending
    ? resolveDefaultBranchActionDialogCopy({
        action: pending.action,
        branchName: pending.branchName,
        includesCommit: pending.includesCommit,
        terminology,
      })
    : null;
  return {
    title: copy?.title ?? "Run action on default branch?",
    description: copy?.description,
    continueLabel: copy?.continueLabel ?? "Continue",
    abortLabel: "Abort",
    featureBranchLabel: "Check out feature branch & continue",
  };
}

export interface GitCommitDialogFileModel {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly excluded: boolean;
}

export interface GitCommitDialogModel {
  readonly title: string;
  readonly description: string;
  readonly branchLabel: string;
  readonly branchCaption: string;
  readonly isDefaultRef: boolean;
  readonly defaultBranchLabel: string;
  readonly filesLabel: string;
  readonly files: ReadonlyArray<GitCommitDialogFileModel>;
  readonly selectedFilePaths: ReadonlyArray<string>;
  readonly allSelected: boolean;
  readonly noneSelected: boolean;
  readonly selectionSummary: string | null;
  readonly showEmpty: boolean;
  readonly emptyLabel: string;
  readonly excludedLabel: string;
  readonly totals: { readonly insertions: number; readonly deletions: number };
  readonly editFilesLabel: string;
  readonly messageLabel: string;
  readonly messagePlaceholder: string;
  readonly cancelLabel: string;
  readonly commitOnNewBranchLabel: string;
  readonly commitLabel: string;
}

export function buildGitCommitDialogModel(input: {
  readonly gitStatus: VcsStatusResult | null;
  readonly excludedFiles: ReadonlySet<string>;
  readonly isEditingFiles: boolean;
}): GitCommitDialogModel {
  const allFiles = input.gitStatus?.workingTree.files ?? [];
  const selectedFiles = allFiles.filter((file) => !input.excludedFiles.has(file.path));
  const allSelected = input.excludedFiles.size === 0;
  return {
    title: "Commit changes",
    description: "Review and confirm your commit. Leave the message blank to auto-generate one.",
    branchLabel: "Branch",
    branchCaption: input.gitStatus?.refName ?? "(detached HEAD)",
    isDefaultRef: input.gitStatus?.isDefaultRef ?? false,
    defaultBranchLabel: "Default branch",
    filesLabel: "Files",
    files: allFiles.map((file) => ({
      path: file.path,
      insertions: file.insertions,
      deletions: file.deletions,
      excluded: input.excludedFiles.has(file.path),
    })),
    selectedFilePaths: selectedFiles.map((file) => file.path),
    allSelected,
    noneSelected: selectedFiles.length === 0,
    selectionSummary:
      !allSelected && !input.isEditingFiles
        ? `(${selectedFiles.length} of ${allFiles.length})`
        : null,
    showEmpty: !input.gitStatus || allFiles.length === 0,
    emptyLabel: "none",
    excludedLabel: "Excluded",
    totals: {
      insertions: selectedFiles.reduce((sum, file) => sum + file.insertions, 0),
      deletions: selectedFiles.reduce((sum, file) => sum + file.deletions, 0),
    },
    editFilesLabel: input.isEditingFiles ? "Done" : "Edit",
    messageLabel: "Commit message (optional)",
    messagePlaceholder: "Leave empty to auto-generate",
    cancelLabel: "Cancel",
    commitOnNewBranchLabel: "Commit on new branch",
    commitLabel: "Commit",
  };
}

export function toggleCommitDialogFileExclusion(
  excludedFiles: ReadonlySet<string>,
  path: string,
): ReadonlySet<string> {
  const next = new Set(excludedFiles);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

export function toggleCommitDialogSelectAll(
  model: Pick<GitCommitDialogModel, "allSelected" | "files">,
): ReadonlySet<string> {
  return model.allSelected ? new Set(model.files.map((file) => file.path)) : new Set();
}

export function resolveCommitDialogRunRequest(input: {
  readonly commitMessage: string;
  readonly model: Pick<GitCommitDialogModel, "allSelected" | "selectedFilePaths">;
  readonly onNewBranch: boolean;
}): GitActionRunRequest {
  const commitMessage = input.commitMessage.trim();
  return {
    action: "commit",
    ...(commitMessage ? { commitMessage } : {}),
    ...(!input.model.allSelected ? { filePaths: [...input.model.selectedFilePaths] } : {}),
    ...(input.onNewBranch ? { featureBranch: true, skipDefaultBranchPrompt: true } : {}),
  };
}

export interface GitActionProgressState {
  readonly actionId: string;
  readonly title: string;
  readonly phaseStartedAtMs: number | null;
  readonly hookStartedAtMs: number | null;
  readonly hookName: string | null;
  readonly lastOutputLine: string | null;
  readonly currentPhaseLabel: string | null;
}

export function initialGitActionProgressState(
  actionId: string,
  title: string,
): GitActionProgressState {
  return {
    actionId,
    title,
    phaseStartedAtMs: null,
    hookStartedAtMs: null,
    hookName: null,
    lastOutputLine: null,
    currentPhaseLabel: title,
  };
}

export function applyGitActionProgressEvent<P extends GitActionProgressState>(input: {
  readonly progress: P;
  readonly event: GitActionProgressEvent;
  readonly gitCwd: string | null;
  readonly nowMs: number;
}): P | null {
  const { progress, event, nowMs } = input;
  if (input.gitCwd && event.cwd !== input.gitCwd) return null;
  if (progress.actionId !== event.actionId) return null;
  switch (event.kind) {
    case "action_started":
      return {
        ...progress,
        phaseStartedAtMs: nowMs,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
      };
    case "phase_started":
      return {
        ...progress,
        title: event.label,
        currentPhaseLabel: event.label,
        phaseStartedAtMs: nowMs,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
      };
    case "hook_started":
      return {
        ...progress,
        title: `Running ${event.hookName}...`,
        hookName: event.hookName,
        hookStartedAtMs: nowMs,
        lastOutputLine: null,
      };
    case "hook_output":
      return { ...progress, lastOutputLine: event.text };
    case "hook_finished":
      return {
        ...progress,
        title: progress.currentPhaseLabel ?? "Committing...",
        hookName: null,
        hookStartedAtMs: null,
        lastOutputLine: null,
      };
    case "action_finished":
    case "action_failed":
      // The settled mutation publishes the final toast, so the elapsed
      // description stays until the success or error state renders.
      return null;
  }
}

export function formatGitActionElapsed(
  startedAtMs: number | null,
  nowMs: number,
): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `Running for ${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `Running for ${minutes}m ${seconds}s`;
}

export function resolveGitActionProgressDescription(
  progress: GitActionProgressState,
  nowMs: number,
): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatGitActionElapsed(progress.hookStartedAtMs ?? progress.phaseStartedAtMs, nowMs);
}

export function resolveGitPullSuccessToast(pullResult: VcsPullResult): {
  readonly title: string;
  readonly description: string;
} {
  return pullResult.status === "pulled"
    ? {
        title: "Pulled",
        description: `Updated ${pullResult.refName} from ${pullResult.upstreamRef ?? "upstream"}`,
      }
    : {
        title: "Already up to date",
        description: `${pullResult.refName} is already synchronized.`,
      };
}

// Re-export from shared for backwards compatibility in this module's exports
export { resolveAutoFeatureBranchName } from "@t3tools/shared/git";
