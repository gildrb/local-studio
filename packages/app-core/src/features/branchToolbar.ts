import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, VcsListRefsResult, VcsRef, VcsStatusResult } from "@t3tools/contracts";
import {
  getChangeRequestTerminology,
  resolveChangeRequestPresentation,
} from "@t3tools/shared/sourceControl";
import {
  CHECKOUT_PULL_REQUEST_ITEM_PREFIX,
  CREATE_BRANCH_ITEM_PREFIX,
  EnvMode,
  PREVIOUS_WORKTREE_SELECT_VALUE,
  resolveActiveBranchIsRemote,
  resolveBranchPickerBadge,
  resolveBranchPickerItems,
  resolveBranchSelectionPlan,
  resolveBranchStatusText,
  resolveBranchToolbarControls,
  resolveBranchToolbarValue,
  resolveBranchTriggerLabel,
  resolveEnvironmentSelectItems,
  resolveEnvModeSelectItems,
  resolveEnvModeTooltip,
  resolveLockedWorkspaceLabel,
  resolveLockedWorkspaceTooltip,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
  resolveSwitchedBranchName,
  resolveThreadBranchChangePlan,
  resolveWorkspaceIconKind,
  resolveWorktreeBaseBranchCandidate,
  sanitizeNewRefName,
  shouldAutoSelectWorktreeBaseBranch,
  shouldShowComposerContextStrip,
  type EnvironmentOption,
  type PreviousWorktreeSeed,
  type WorkspaceIconKind,
} from "@t3tools/web/src/components/BranchToolbar.logic.ts";
import {
  AUTO_ENVIRONMENT_CONTEXT,
  LOAD_BALANCING_ATTACHMENTS_WARNING,
  resolveEnvironmentChangeContext,
  resolveEnvModeChangePlan,
  resolveLoadBalancedDraftContext,
} from "@t3tools/web/src/components/chat/composerEnvironment.logic.ts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import { parsePullRequestReference } from "@t3tools/web/src/pullRequestReference.ts";
import {
  type MiddleTruncateSplit,
  splitForMiddleTruncate,
} from "@t3tools/web/src/components/ui/middleTruncate.logic.ts";
import {
  appendBranchPageCursor,
  mergePaginatedBranchPages,
  shouldLoadNextBranchPageAfterScroll,
} from "@t3tools/web/src/state/paginatedBranches.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import { type ComposerEnvironment, composerEnvironmentRuntime } from "../composerEnvironment.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext, ThreadInput } from "../feature.ts";

const VCS_REF_LIST_LIMIT = 100;
const ACTIVE_BRANCH_QUERY_LIMIT = 10;
const INITIAL_BRANCH_CURSORS: ReadonlyArray<number | undefined> = [undefined];
const NO_REFS_TEXT = "No refs found.";

type ToolbarIcon = WorkspaceIconKind | "history" | "scale" | EnvironmentOption["machine"];

export type BranchToolbarSelectItem = {
  readonly value: string;
  readonly label: string;
  readonly icon: ToolbarIcon;
  readonly detail: string | null;
  readonly detailTruncation: MiddleTruncateSplit | null;
};

export type BranchToolbarSelect = {
  readonly interactive: boolean;
  readonly icon: ToolbarIcon;
  readonly label: string;
  readonly tooltip: string;
  readonly value: string;
  readonly groupLabel: string;
  readonly wide: boolean;
  readonly items: ReadonlyArray<BranchToolbarSelectItem>;
};

export type BranchMenuItem = {
  readonly value: string;
  readonly kind: "checkout-pull-request" | "create" | "ref";
  readonly label: string;
  readonly truncation: MiddleTruncateSplit | null;
  readonly detail: string | null;
  readonly badge: string | null;
  readonly icon: string | null;
};

export type BranchMenuView = {
  readonly query: string;
  readonly items: ReadonlyArray<BranchMenuItem>;
  readonly highlighted: string | null;
  readonly emptyText: string | null;
  readonly statusText: string | null;
  readonly startFromOrigin: { readonly checked: boolean } | null;
};

export type BranchToolbarView = {
  readonly threadKey: string;
  readonly environment: BranchToolbarSelect | null;
  readonly separator: boolean;
  readonly workspace: BranchToolbarSelect | null;
  readonly branch: {
    readonly label: string;
    readonly truncation: MiddleTruncateSplit | null;
    readonly disabled: boolean;
    readonly activeBranch: string | null;
    readonly menu: BranchMenuView | null;
  } | null;
};

type BranchMenuState = {
  readonly threadKey: string | null;
  readonly open: boolean;
  readonly query: string;
  readonly highlighted: string | null;
  readonly targetKey: string | null;
  readonly cursors: ReadonlyArray<number | undefined>;
  readonly previousScrollTop: number | null;
};

const CLOSED_MENU: BranchMenuState = {
  threadKey: null,
  open: false,
  query: "",
  highlighted: null,
  targetKey: null,
  cursors: INITIAL_BRANCH_CURSORS,
  previousScrollTop: null,
};

type QueryState<A> = {
  readonly data: A | null;
  readonly isPending: boolean;
};

function queryState<A, E>(result: AsyncResult.AsyncResult<A, E> | null): QueryState<A> {
  if (result === null) return { data: null, isPending: false };
  return { data: Option.getOrNull(AsyncResult.value(result)), isPending: result.waiting };
}

const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const MoveParams = Schema.decodeUnknownSync(Schema.Struct({ delta: Schema.Number }));
const PickParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.NullOr(Schema.String) }));
const CheckedParams = Schema.decodeUnknownSync(Schema.Struct({ checked: Schema.Boolean }));
const ScrollParams = Schema.decodeUnknownSync(
  Schema.Struct({
    scrollTop: Schema.Number,
    scrollHeight: Schema.Number,
    clientHeight: Schema.Number,
  }),
);
const ContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ branch: Schema.NullOr(Schema.String), x: Schema.Number, y: Schema.Number }),
);

type BranchModel = {
  readonly input: ThreadInput;
  readonly env: ComposerEnvironment;
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  readonly activeProjectCwd: string | null;
  readonly activeWorktreePath: string | null;
  readonly effectiveEnvMode: EnvMode;
  readonly envModeLocked: boolean;
  readonly showGitControls: boolean;
  readonly showEnvironmentIndicator: boolean;
  readonly showEnvironmentPicker: boolean;
  readonly activeEnvironmentOption: EnvironmentOption | null;
  readonly previousWorktreeSeed: PreviousWorktreeSeed | null;
  readonly branchCwd: string | null;
  readonly statusAtom: Atom.Atom<AsyncResult.AsyncResult<VcsStatusResult, unknown>> | null;
  readonly status: VcsStatusResult | null;
  readonly refPageAtoms: ReadonlyArray<
    Atom.Atom<AsyncResult.AsyncResult<VcsListRefsResult, unknown>>
  >;
  readonly refs: ReadonlyArray<VcsRef>;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isInitialBranchesLoadPending: boolean;
  readonly totalCount: number;
  readonly nextCursor: number | null;
  readonly currentGitBranch: string | null;
  readonly activeThreadBranch: string | null;
  readonly resolvedActiveBranch: string | null;
  readonly resolvedActiveBranchIsRemote: boolean | null;
  readonly isSelectingWorktreeBase: boolean;
  readonly worktreeBaseBranchCandidate: string | null;
  readonly menu: BranchMenuState;
  readonly trimmedQuery: string;
  readonly prReference: string | null;
  readonly canCheckoutPullRequest: boolean;
};

export function createBranchToolbarFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const environment = composerEnvironmentRuntime(registry, state);
  const clipboard = clipboardService(context);
  const contextMenu = contextMenuService(context);
  const menuAtom = Atom.make<BranchMenuState>(CLOSED_MENU).pipe(Atom.keepAlive);
  const actionPendingAtom = Atom.make(false).pipe(Atom.keepAlive);
  const optimisticBranchAtom = Atom.make<{
    readonly threadKey: string;
    readonly branch: string | null;
  } | null>(null).pipe(Atom.keepAlive);

  const modelAtom = Atom.make((get): BranchModel | null => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const env = environment.derive(get, input);
    const { thread, project, draftThread } = input;
    const threadKey = env.threadKey;
    const environmentId = thread.environmentId;
    const controls = resolveBranchToolbarControls({
      forceNewWorktree: false,
      envMode: env.envMode,
      envLocked: env.envLocked,
      hasServerThread: input.isServerThread,
      hasDraftThread: draftThread !== null,
      threadWorktreePath: thread.worktreePath ?? null,
      environmentId,
      availableEnvironments: env.logicalProjectEnvironments,
      canChangeEnvironment: env.hasMultipleEnvironments,
    });
    const activeProjectCwd = project?.workspaceRoot ?? null;
    const branchCwd = controls.activeWorktreePath ?? activeProjectCwd;
    const previousWorktreeSeed =
      controls.canUsePreviousWorktree && project !== undefined
        ? resolvePreviousWorktreeSeed({
            threads: get(state.environmentThreadShells.threadShellsAtom).filter(
              (shell) =>
                shell.environmentId === project.environmentId && shell.projectId === project.id,
            ),
            currentWorktreePath: controls.activeWorktreePath,
          })
        : null;
    const statusAtom =
      branchCwd === null
        ? null
        : state.vcsEnvironment.status({ environmentId, input: { cwd: branchCwd } });
    const status = queryState(statusAtom === null ? null : get(statusAtom)).data;
    const storedMenu = get(menuAtom);
    const menu = storedMenu.threadKey === threadKey ? storedMenu : CLOSED_MENU;
    const trimmedQuery = menu.query.trim();
    const refQuery = sanitizeNewRefName(trimmedQuery);
    const targetKey =
      branchCwd === null ? null : JSON.stringify([environmentId, branchCwd, refQuery]);
    const cursors = menu.targetKey === targetKey ? menu.cursors : INITIAL_BRANCH_CURSORS;
    const refPageAtoms =
      branchCwd === null
        ? []
        : cursors.map((cursor) =>
            state.vcsEnvironment.listRefs({
              environmentId,
              input: {
                cwd: branchCwd,
                ...(refQuery.length > 0 ? { query: refQuery } : {}),
                ...(cursor === undefined ? {} : { cursor }),
                limit: VCS_REF_LIST_LIMIT,
              },
            }),
          );
    const pages = mergePaginatedBranchPages(refPageAtoms.map((atom) => get(atom)));
    const refs = pages.data?.refs ?? [];
    const nextCursor = pages.data?.nextCursor ?? null;
    const isInitialBranchesLoadPending = pages.isPending && pages.data === null;
    const currentGitBranch =
      status?.refName ?? refs.find((refName) => refName.current)?.name ?? null;
    const activeThreadBranch = env.activeThreadBranch;
    const canonicalActiveBranch = resolveBranchToolbarValue({
      envMode: controls.effectiveEnvMode,
      activeWorktreePath: controls.activeWorktreePath,
      activeThreadBranch,
      currentGitBranch,
    });
    const optimistic = get(optimisticBranchAtom);
    const resolvedActiveBranch =
      optimistic !== null && optimistic.threadKey === threadKey
        ? optimistic.branch
        : canonicalActiveBranch;
    const listedActiveBranch =
      resolvedActiveBranch === null
        ? null
        : (refs.find((refName) => refName.name === resolvedActiveBranch) ?? null);
    const queriedActiveBranch =
      branchCwd !== null && resolvedActiveBranch !== null
        ? queryState(
            get(
              state.vcsEnvironment.listRefs({
                environmentId,
                input: {
                  cwd: branchCwd,
                  query: resolvedActiveBranch,
                  limit: ACTIVE_BRANCH_QUERY_LIMIT,
                },
              }),
            ),
          ).data?.refs.find((refName) => refName.name === resolvedActiveBranch)
        : undefined;
    return {
      input,
      env,
      threadKey,
      environmentId,
      activeProjectCwd,
      activeWorktreePath: controls.activeWorktreePath,
      effectiveEnvMode: controls.effectiveEnvMode,
      envModeLocked: controls.envModeLocked,
      showGitControls: status?.isRepo ?? true,
      showEnvironmentIndicator: controls.showEnvironmentIndicator,
      showEnvironmentPicker: controls.showEnvironmentPicker,
      activeEnvironmentOption: controls.activeEnvironmentOption,
      previousWorktreeSeed,
      branchCwd,
      statusAtom,
      status,
      refPageAtoms,
      refs,
      hasNextPage: nextCursor !== null,
      isFetchingNextPage: pages.isFetchingNextPage,
      isInitialBranchesLoadPending,
      totalCount: pages.data?.totalCount ?? 0,
      nextCursor,
      currentGitBranch,
      activeThreadBranch,
      resolvedActiveBranch,
      resolvedActiveBranchIsRemote: resolveActiveBranchIsRemote({
        listedActiveBranch,
        queriedActiveBranch,
      }),
      isSelectingWorktreeBase:
        controls.effectiveEnvMode === "worktree" && !env.envLocked && !controls.activeWorktreePath,
      worktreeBaseBranchCandidate: resolveWorktreeBaseBranchCandidate({
        isInitialBranchesLoadPending,
        refs,
        currentGitBranch,
      }),
      menu,
      trimmedQuery,
      prReference: parsePullRequestReference(trimmedQuery),
      canCheckoutPullRequest: env.isLocalDraftThread,
    };
  });

  const pickerItems = (model: BranchModel) =>
    resolveBranchPickerItems({
      refNames: model.refs.map((refName) => refName.name),
      trimmedQuery: model.trimmedQuery,
      deferredTrimmedQuery: model.trimmedQuery,
      isSelectingWorktreeBase: model.isSelectingWorktreeBase,
      prReference: model.prReference,
      canCheckoutPullRequest: model.canCheckoutPullRequest,
    });

  const highlightedValue = (model: BranchModel, filtered: ReadonlyArray<string>) =>
    model.menu.highlighted !== null && filtered.includes(model.menu.highlighted)
      ? model.menu.highlighted
      : (filtered[0] ?? null);

  const environmentSelect = (model: BranchModel): BranchToolbarSelect | null => {
    if (!model.showEnvironmentIndicator) return null;
    const { env } = model;
    const active = model.activeEnvironmentOption;
    const interactive = !env.envLocked && model.showEnvironmentPicker;
    const autoLabel = env.autoEnvironmentLabel;
    if (!interactive) {
      const label = active?.label ?? "Run on";
      return {
        interactive: false,
        icon: active?.machine ?? "server",
        label,
        tooltip: label,
        value: model.environmentId,
        groupLabel: "Run on",
        wide: false,
        items: [],
      };
    }
    const machineById = new Map<string, EnvironmentOption["machine"]>(
      env.logicalProjectEnvironments.map((option) => [option.environmentId, option.machine]),
    );
    const items = resolveEnvironmentSelectItems({
      availableEnvironments: env.logicalProjectEnvironments,
      autoEnvironmentLabel: autoLabel,
      canAutoEnvironment: env.canAutoEnvironment,
    }).map((item): BranchToolbarSelectItem => ({
      ...item,
      icon: item.value === "auto" ? "scale" : (machineById.get(item.value) ?? "server"),
      detail: null,
      detailTruncation: null,
    }));
    const value = autoLabel ? "auto" : model.environmentId;
    return {
      interactive: true,
      icon: autoLabel ? "scale" : (active?.machine ?? "server"),
      label: items.find((item) => item.value === value)?.label ?? "",
      tooltip: autoLabel ?? active?.label ?? "Run on",
      value,
      groupLabel: "Run on",
      wide: false,
      items,
    };
  };

  const workspaceSelect = (model: BranchModel): BranchToolbarSelect | null => {
    if (!model.showGitControls) return null;
    const { activeWorktreePath, effectiveEnvMode } = model;
    if (model.envModeLocked) {
      return {
        interactive: false,
        icon: resolveWorkspaceIconKind({ locked: true, activeWorktreePath, effectiveEnvMode }),
        label: resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode),
        tooltip: resolveLockedWorkspaceTooltip({
          forceNewWorktree: false,
          activeWorktreePath,
          effectiveEnvMode,
        }),
        value: effectiveEnvMode,
        groupLabel: "Workspace",
        wide: false,
        items: [],
      };
    }
    const previousLabel =
      model.previousWorktreeSeed === null
        ? null
        : resolvePreviousWorktreeLabel(model.previousWorktreeSeed);
    const items = resolveEnvModeSelectItems({
      activeWorktreePath,
      previousWorktreeLabel: previousLabel,
    }).map((item): BranchToolbarSelectItem => {
      if (item.value === PREVIOUS_WORKTREE_SELECT_VALUE) {
        return {
          value: item.value,
          label: "Previous worktree",
          icon: "history",
          detail: model.previousWorktreeSeed?.branch ?? null,
          detailTruncation:
            model.previousWorktreeSeed?.branch == null
              ? null
              : splitForMiddleTruncate(model.previousWorktreeSeed.branch),
        };
      }
      return {
        ...item,
        icon:
          item.value === "worktree" ? "folder-git-2" : activeWorktreePath ? "folder-git" : "folder",
        detail: null,
        detailTruncation: null,
      };
    });
    return {
      interactive: true,
      icon: resolveWorkspaceIconKind({ locked: false, activeWorktreePath, effectiveEnvMode }),
      label:
        resolveEnvModeSelectItems({
          activeWorktreePath,
          previousWorktreeLabel: previousLabel,
        }).find((item) => item.value === effectiveEnvMode)?.label ?? "",
      tooltip: resolveEnvModeTooltip({ effectiveEnvMode, activeWorktreePath }),
      value: effectiveEnvMode,
      groupLabel: "Workspace",
      wide: previousLabel !== null,
      items,
    };
  };

  const branchMenu = (model: BranchModel): BranchMenuView | null => {
    if (!model.menu.open) return null;
    const picker = pickerItems(model);
    const refByName = new Map(model.refs.map((refName) => [refName.name, refName]));
    const presentation = resolveChangeRequestPresentation(model.status?.sourceControlProvider);
    const terminology = getChangeRequestTerminology(model.status?.sourceControlProvider);
    const items = picker.filteredItems.flatMap((value): BranchMenuItem[] => {
      if (value === picker.checkoutPullRequestItemValue && model.prReference !== null) {
        return [
          {
            value,
            kind: "checkout-pull-request",
            label: `Checkout ${terminology.singular}`,
            truncation: null,
            detail: model.prReference,
            badge: null,
            icon: presentation.icon,
          },
        ];
      }
      if (value === picker.createBranchItemValue) {
        return [
          {
            value,
            kind: "create",
            label: `Create new ref "${picker.newRefName}"`,
            truncation: null,
            detail: null,
            badge: null,
            icon: null,
          },
        ];
      }
      const refName = refByName.get(value);
      if (refName === undefined) return [];
      return [
        {
          value,
          kind: "ref",
          label: value,
          truncation: splitForMiddleTruncate(value),
          detail: null,
          badge: resolveBranchPickerBadge(refName, model.activeProjectCwd),
          icon: null,
        },
      ];
    });
    return {
      query: model.menu.query,
      items,
      highlighted: highlightedValue(model, picker.filteredItems),
      emptyText: items.length === 0 ? NO_REFS_TEXT : null,
      statusText: resolveBranchStatusText({
        isInitialBranchesLoadPending: model.isInitialBranchesLoadPending,
        isFetchingNextPage: model.isFetchingNextPage,
        hasNextPage: model.hasNextPage,
        loadedCount: model.refs.length,
        totalCount: model.totalCount,
      }),
      startFromOrigin: model.isSelectingWorktreeBase
        ? { checked: model.env.startFromOrigin }
        : null,
    };
  };

  const viewAtom = Atom.make((get): BranchToolbarView | null => {
    const model = get(modelAtom);
    if (model === null || model.input.project === undefined) return null;
    const visible = shouldShowComposerContextStrip({
      hasActiveProject: true,
      isGitRepo: model.showGitControls,
      showEnvironmentIndicator: model.showEnvironmentIndicator,
      hostsRestingComposerControls: false,
    });
    if (!visible) return null;
    const environmentControl = environmentSelect(model);
    const branchLabel = resolveBranchTriggerLabel({
      activeWorktreePath: model.activeWorktreePath,
      effectiveEnvMode: model.effectiveEnvMode,
      resolvedActiveBranch: model.resolvedActiveBranch,
      resolvedActiveBranchIsRemote: model.resolvedActiveBranchIsRemote,
      startFromOrigin: model.env.startFromOrigin,
    });
    return {
      threadKey: model.threadKey,
      environment: environmentControl,
      separator: environmentControl !== null && model.showGitControls,
      workspace: workspaceSelect(model),
      branch: model.showGitControls
        ? {
            label: branchLabel,
            truncation: splitForMiddleTruncate(branchLabel),
            disabled: model.isInitialBranchesLoadPending || get(actionPendingAtom),
            activeBranch: model.resolvedActiveBranch,
            menu: branchMenu(model),
          }
        : null,
    };
  });

  const currentModel = (action: string): BranchModel => {
    const model = registry.get(modelAtom);
    if (model === null) throw new Error(`${action} needs an open thread`);
    return model;
  };

  const draftTarget = (model: BranchModel) => model.input.draftId ?? model.input.route;

  const setMenu = (update: (current: BranchMenuState) => BranchMenuState) => {
    registry.set(menuAtom, update(registry.get(menuAtom)));
  };

  const closeMenu = () => registry.set(menuAtom, CLOSED_MENU);

  const setThreadBranch = (
    model: BranchModel,
    branch: string | null,
    worktreePath: string | null,
    automatic: boolean,
  ) => {
    const { input, env, environmentId } = model;
    const project = input.project;
    if (project === undefined) return;
    const threadId = input.thread.id;
    const plan = resolveThreadBranchChangePlan({
      hasServerThread: input.isServerThread,
      hasServerSession: input.isServerThread && input.thread.session !== null,
      worktreePath,
      activeWorktreePath: model.activeWorktreePath,
      effectiveEnvMode: model.effectiveEnvMode,
      automatic,
      draftEnvironmentSelection: input.draftThread?.environmentSelection,
    });
    if (plan.stopSession) {
      void runAtomCommand(
        registry,
        state.threadEnvironment.stopSession,
        { environmentId, input: { threadId } },
        { label: "thread session stop" },
      );
    }
    if (plan.updateServerMetadata) {
      void runAtomCommand(
        registry,
        state.threadEnvironment.updateMetadata,
        { environmentId, input: { threadId, branch, worktreePath } },
        { label: "thread metadata update" },
      );
    }
    if (plan.draftContext === null) {
      if (env.canOverrideServerThreadEnvMode) {
        environment.updatePending(env.threadKey, (current) => ({ ...current, branch }));
      }
      return;
    }
    useComposerDraftStore.getState().setDraftThreadContext(draftTarget(model), {
      branch,
      worktreePath,
      envMode: plan.draftContext.envMode,
      environmentSelection: plan.draftContext.environmentSelection,
      projectRef: scopeProjectRef(environmentId, project.id),
    });
  };

  const refreshBranchQueries = (model: BranchModel) => {
    setMenu((current) => ({ ...current, cursors: INITIAL_BRANCH_CURSORS }));
    const firstPage = model.refPageAtoms[0];
    if (firstPage !== undefined) registry.refresh(firstPage);
    if (model.statusAtom !== null) registry.refresh(model.statusAtom);
  };

  const runBranchAction = async (
    model: BranchModel,
    optimisticBranch: string,
    action: () => Promise<string | null>,
  ) => {
    registry.set(actionPendingAtom, true);
    registry.set(optimisticBranchAtom, { threadKey: model.threadKey, branch: optimisticBranch });
    try {
      await action();
    } finally {
      registry.set(optimisticBranchAtom, null);
      registry.set(actionPendingAtom, false);
      refreshBranchQueries(model);
    }
  };

  const failureToast = (title: string, error: unknown) => {
    context.addToast({
      layout: "stacked",
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };

  const selectBranch = async (model: BranchModel, refName: VcsRef) => {
    if (!model.branchCwd || !model.activeProjectCwd || registry.get(actionPendingAtom)) return;
    const plan = resolveBranchSelectionPlan({
      isSelectingWorktreeBase: model.isSelectingWorktreeBase,
      activeProjectCwd: model.activeProjectCwd,
      activeWorktreePath: model.activeWorktreePath,
      refName,
    });
    if (plan.kind === "set-worktree-base") {
      setThreadBranch(model, refName.name, null, false);
      closeMenu();
      return;
    }
    if (plan.kind === "reuse-worktree") {
      setThreadBranch(model, refName.name, plan.nextWorktreePath, false);
      closeMenu();
      return;
    }
    closeMenu();
    await runBranchAction(model, plan.selectedBranchName, async () => {
      const result = await runAtomCommand(
        registry,
        state.vcsEnvironment.switchRef,
        {
          environmentId: model.environmentId,
          input: { cwd: plan.checkoutCwd, refName: refName.name },
        },
        { reportFailure: false },
      );
      if (result._tag === "Success") {
        const nextBranchName = resolveSwitchedBranchName({
          refName,
          selectedBranchName: plan.selectedBranchName,
          switchedRefName: result.value.refName,
        });
        registry.set(optimisticBranchAtom, { threadKey: model.threadKey, branch: nextBranchName });
        setThreadBranch(model, nextBranchName, plan.nextWorktreePath, false);
        return nextBranchName;
      }
      if (!isAtomCommandInterrupted(result)) {
        failureToast("Failed to switch ref.", squashAtomCommandFailure(result));
      }
      return null;
    });
  };

  const createRef = async (model: BranchModel, rawName: string) => {
    const name = sanitizeNewRefName(rawName);
    const branchCwd = model.branchCwd;
    if (!branchCwd || !name || registry.get(actionPendingAtom)) return;
    closeMenu();
    await runBranchAction(model, name, async () => {
      const result = await runAtomCommand(
        registry,
        state.vcsEnvironment.createRef,
        {
          environmentId: model.environmentId,
          input: { cwd: branchCwd, refName: name, switchRef: true },
        },
        { reportFailure: false },
      );
      if (result._tag === "Success") {
        registry.set(optimisticBranchAtom, {
          threadKey: model.threadKey,
          branch: result.value.refName,
        });
        setThreadBranch(model, result.value.refName, model.activeWorktreePath, false);
        return result.value.refName;
      }
      if (!isAtomCommandInterrupted(result)) {
        failureToast("Failed to create and switch ref.", squashAtomCommandFailure(result));
      }
      return null;
    });
  };

  const pickBranchItem = async (model: BranchModel, value: string) => {
    const picker = pickerItems(model);
    if (value === picker.checkoutPullRequestItemValue && model.prReference !== null) {
      closeMenu();
      throw new Error("Pull request checkout is not available in the native app yet.");
    }
    if (value === picker.createBranchItemValue) {
      await createRef(model, model.trimmedQuery);
      return;
    }
    const refName = model.refs.find((candidate) => candidate.name === value);
    if (refName !== undefined) await selectBranch(model, refName);
  };

  const usePreviousWorktree = (model: BranchModel) => {
    const seed = model.previousWorktreeSeed;
    const draftThread = model.input.draftThread;
    if (seed === null || draftThread === null) return;
    useComposerDraftStore.getState().setDraftThreadContext(draftTarget(model), {
      branch: seed.branch,
      worktreePath: seed.worktreePath,
      envMode: "worktree",
      projectRef: scopeProjectRef(draftThread.environmentId, draftThread.projectId),
    });
  };

  const setEnvMode = (model: BranchModel, mode: EnvMode) => {
    const plan = resolveEnvModeChangePlan({
      mode,
      hasMultipleModelSelections: false,
      canOverrideServerThreadEnvMode: model.env.canOverrideServerThreadEnvMode,
      isLocalDraftThread: model.env.isLocalDraftThread,
      draftWorktreePath: model.input.draftThread?.worktreePath,
      newWorktreesStartFromOrigin: model.env.newWorktreesStartFromOrigin,
    });
    if (plan.kind === "pending-server-thread") {
      environment.updatePending(model.threadKey, (current) => ({
        ...current,
        envMode: plan.envMode,
      }));
    } else if (plan.kind === "draft") {
      useComposerDraftStore.getState().setDraftThreadContext(draftTarget(model), plan.context);
    }
  };

  const autoEnvironment = (model: BranchModel) => {
    const { env, input } = model;
    if (env.envLocked || input.draftId === null) return;
    if (env.composerHasAttachments) {
      context.addToast({ layout: "plain", type: "warning", ...LOAD_BALANCING_ATTACHMENTS_WARNING });
      return;
    }
    for (const option of env.logicalProjectEnvironments) {
      registry.refresh(
        state.serverEnvironment.hostResources({ environmentId: option.environmentId, input: {} }),
      );
    }
    useComposerDraftStore.getState().setDraftThreadContext(input.draftId, AUTO_ENVIRONMENT_CONTEXT);
  };

  const autoWorktreeBaseAtom = Atom.make((get) => {
    const model = get(modelAtom);
    if (model === null || !model.showGitControls) return null;
    const candidate = model.worktreeBaseBranchCandidate;
    return candidate !== null &&
      shouldAutoSelectWorktreeBaseBranch({
        effectiveEnvMode: model.effectiveEnvMode,
        activeWorktreePath: model.activeWorktreePath,
        activeThreadBranch: model.activeThreadBranch,
        worktreeBaseBranchCandidate: candidate,
      })
      ? `${model.threadKey}\u0000${candidate}`
      : null;
  });
  registry.subscribe(
    autoWorktreeBaseAtom,
    (key) => {
      if (key === null) return;
      const model = registry.get(modelAtom);
      if (model === null || model.worktreeBaseBranchCandidate === null) return;
      setThreadBranch(model, model.worktreeBaseBranchCandidate, null, true);
    },
    { immediate: true },
  );

  const loadBalancedContextAtom = Atom.make((get) => {
    const input = get(context.threadInputAtom);
    if (input === null || input.draftId === null) return null;
    const env = environment.derive(get, input);
    const draftContext = resolveLoadBalancedDraftContext({
      needsLoadBalancing: env.needsLoadBalancing,
      loadBalancingPending: env.loadBalancing.pending,
      hasDraftId: true,
      sendInFlight: false,
      loadBalancedEnvironmentId: env.loadBalancing.environmentId,
      logicalProjectEnvironments: env.logicalProjectEnvironments,
    });
    return draftContext === null ? null : { draftId: input.draftId, context: draftContext };
  });
  registry.subscribe(
    loadBalancedContextAtom,
    (target) => {
      if (target === null) return;
      useComposerDraftStore.getState().setDraftThreadContext(target.draftId, target.context);
    },
    { immediate: true },
  );

  const overrideResetAtom = Atom.make((get) => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const env = environment.derive(get, input);
    return env.canOverrideServerThreadEnvMode ? null : env.threadKey;
  });
  registry.subscribe(
    overrideResetAtom,
    (threadKey) => {
      if (threadKey === null) return;
      const pending = registry.get(environment.pendingAtom).get(threadKey);
      if (pending === undefined || (pending.envMode === null && pending.branch === undefined)) {
        return;
      }
      environment.updatePending(threadKey, (current) => ({
        ...current,
        envMode: null,
        branch: undefined,
      }));
    },
    { immediate: true },
  );

  return {
    views: { branchToolbar: viewAtom },
    actions: {
      branchToolbarSelectWorkspace: async (params) => {
        const { value } = ValueParams(params);
        const model = currentModel("branchToolbarSelectWorkspace");
        if (model.envModeLocked || value === model.effectiveEnvMode) return null;
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          usePreviousWorktree(model);
          return null;
        }
        setEnvMode(model, Schema.decodeUnknownSync(EnvMode)(value));
        return null;
      },
      branchToolbarSelectEnvironment: async (params) => {
        const { value } = ValueParams(params);
        const model = currentModel("branchToolbarSelectEnvironment");
        const { env } = model;
        if (env.envLocked || !model.showEnvironmentPicker) return null;
        if (value === "auto") {
          if (env.canAutoEnvironment) autoEnvironment(model);
          return null;
        }
        const draftId = model.input.draftId;
        const current = env.autoEnvironmentLabel ? "auto" : model.environmentId;
        const target = env.logicalProjectEnvironments.find(
          (option) => option.environmentId === value,
        );
        if (value === current || draftId === null || target === undefined) return null;
        const nextContext = resolveEnvironmentChangeContext({
          envLocked: env.envLocked,
          hasDraftId: true,
          nextEnvironmentId: target.environmentId,
          logicalProjectEnvironments: env.logicalProjectEnvironments,
        });
        if (nextContext === null) return null;
        useComposerDraftStore.getState().setDraftThreadContext(draftId, nextContext);
        return null;
      },
      branchToolbarBranchMenu: async (params) => {
        const { open } = OpenParams(params);
        const model = currentModel("branchToolbarBranchMenu");
        if (!open) {
          closeMenu();
          return null;
        }
        if (model.isInitialBranchesLoadPending || registry.get(actionPendingAtom)) return null;
        registry.set(menuAtom, { ...CLOSED_MENU, threadKey: model.threadKey, open: true });
        return null;
      },
      branchToolbarBranchQuery: async (params) => {
        const { query } = QueryParams(params);
        setMenu((current) =>
          current.open
            ? { ...current, query, highlighted: null, previousScrollTop: null }
            : current,
        );
        return null;
      },
      branchToolbarBranchHighlight: async (params) => {
        const { value } = ValueParams(params);
        setMenu((current) => (current.open ? { ...current, highlighted: value } : current));
        return null;
      },
      branchToolbarBranchMove: async (params) => {
        const { delta } = MoveParams(params);
        const model = currentModel("branchToolbarBranchMove");
        if (!model.menu.open) return null;
        const filtered = pickerItems(model).filteredItems;
        if (filtered.length === 0) return null;
        const current = highlightedValue(model, filtered);
        const index = current === null ? -1 : filtered.indexOf(current);
        const next = Math.min(filtered.length - 1, Math.max(0, index + Math.sign(delta)));
        setMenu((state) => ({ ...state, highlighted: filtered[next] ?? null }));
        return null;
      },
      branchToolbarBranchPick: async (params) => {
        const { value } = PickParams(params);
        const model = currentModel("branchToolbarBranchPick");
        if (!model.menu.open) return null;
        const filtered = pickerItems(model).filteredItems;
        const target = value ?? highlightedValue(model, filtered);
        if (target === null || !filtered.includes(target)) return null;
        await pickBranchItem(model, target);
        return null;
      },
      branchToolbarBranchScroll: async (params) => {
        const scroll = ScrollParams(params);
        const model = currentModel("branchToolbarBranchScroll");
        const previousScrollTop = model.menu.previousScrollTop;
        setMenu((current) => ({ ...current, previousScrollTop: scroll.scrollTop }));
        if (
          !model.menu.open ||
          model.nextCursor === null ||
          model.isFetchingNextPage ||
          !shouldLoadNextBranchPageAfterScroll({ previousScrollTop, ...scroll })
        ) {
          return null;
        }
        const nextCursor = model.nextCursor;
        const branchCwd = model.branchCwd;
        if (branchCwd === null) return null;
        const targetKey = JSON.stringify([
          model.environmentId,
          branchCwd,
          sanitizeNewRefName(model.trimmedQuery),
        ]);
        setMenu((current) => ({
          ...current,
          targetKey,
          cursors: appendBranchPageCursor(
            current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS,
            nextCursor,
          ),
        }));
        return null;
      },
      branchToolbarStartFromOrigin: async (params) => {
        const { checked } = CheckedParams(params);
        const model = currentModel("branchToolbarStartFromOrigin");
        const { env } = model;
        if (env.canOverrideServerThreadEnvMode) {
          environment.updatePending(model.threadKey, (current) => ({
            ...current,
            startFromOrigin: checked,
          }));
          return null;
        }
        if (env.isLocalDraftThread) {
          useComposerDraftStore
            .getState()
            .setDraftThreadContext(draftTarget(model), { startFromOrigin: checked });
        }
        return null;
      },
      branchToolbarBranchContextMenu: async (params) => {
        const { branch, x, y } = ContextMenuParams(params);
        if (branch === null) return null;
        const action = await contextMenu.show(
          [{ id: "copy-branch-name", label: "Copy branch name", icon: "copy" }],
          { x, y },
        );
        if (action !== "copy-branch-name") return null;
        try {
          await clipboard.writeText(branch);
          context.addToast({
            layout: "plain",
            type: "success",
            title: "Branch name copied",
            description: branch,
          });
        } catch (error) {
          failureToast("Failed to copy branch name", error);
        }
        return null;
      },
    },
  };
}
