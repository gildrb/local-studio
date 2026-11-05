import { randomUUID } from "node:crypto";

import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitActionProgressEvent,
  SourceControlCloneProtocol,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryVisibility,
  VcsStatusResult,
} from "@t3tools/contracts";
import {
  applyGitActionProgressEvent,
  buildDefaultBranchConfirmationModel,
  buildGitActionsToolbarModel,
  buildGitCommitDialogModel,
  GIT_ACTION_COPY,
  initialGitActionProgressState,
  resolveChangeRequestTerminology,
  resolveCommitDialogRunRequest,
  resolveDefaultBranchContinuation,
  resolveGitActionProgressDescription,
  resolveGitActionRunPlan,
  resolveGitMenuItemIntent,
  resolveGitPullSuccessToast,
  resolveGitQuickActionIntent,
  resolveOpenExistingPrIntent,
  resolveThreadBranchMetadataPatch,
  resolveThreadBranchUpdate,
  toggleCommitDialogFileExclusion,
  toggleCommitDialogSelectAll,
  type DefaultBranchConfirmationModel,
  type GitActionMenuItemModel,
  type GitActionProgressState,
  type GitActionRunRequest,
  type GitCommitDialogModel,
  type GitMenuNotice,
  type PendingDefaultBranchAction,
} from "@t3tools/web/src/components/GitActionsControl.logic.ts";
import {
  buildPublishRepositoryInput,
  isPublishWizardStepDisabled,
  PUBLISH_VISIBILITY_OPTIONS,
  PUBLISH_WIZARD_STEPS,
  resolvePublishRepositoryState,
  resolvePublishResultCopy,
  type PublishProviderKind,
} from "@t3tools/web/src/components/publishRepository.logic.ts";
import { openInPreferredEditor } from "@t3tools/web/src/editorPreferences.logic.ts";
import {
  isSourceControlActionPending,
  isSourceControlActionRunning,
  RUNNING_SOURCE_CONTROL_ACTIONS,
  SOURCE_CONTROL_ACTION_LABEL,
  SOURCE_CONTROL_ACTION_OPERATION,
} from "@t3tools/web/src/state/sourceControlActions.logic.ts";
import { resolvePathLinkTarget } from "@t3tools/web/src/terminal-links.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext, ThreadInput } from "../feature.ts";
import { openExternal } from "../openExternal.ts";

const PROGRESS_TICK_MS = 1000;
const SUCCESS_TOAST_MS = 10_000;
const DEFAULT_TOAST_MS = 5000;
const SOURCE_CONTROL_SETTINGS_SECTION = "source-control";

const PublishProvider = Schema.Literals([
  "github",
  "gitlab",
  "forgejo",
  "bitbucket",
  "azure-devops",
]);
const MenuItemParams = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.Literals(["commit", "push", "pr"]) }),
);
const MessageParams = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }));
const PathParams = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));
const SubmitCommitParams = Schema.decodeUnknownSync(Schema.Struct({ onNewBranch: Schema.Boolean }));
const ContinueParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["continue", "feature_branch"]) }),
);
const ProviderParams = Schema.decodeUnknownSync(Schema.Struct({ provider: PublishProvider }));
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const VisibilityParams = Schema.decodeUnknownSync(
  Schema.Struct({ visibility: Schema.Literals(["private", "public"]) }),
);
const ProtocolParams = Schema.decodeUnknownSync(
  Schema.Struct({ protocol: Schema.Literals(["ssh", "https"]) }),
);
const StepParams = Schema.decodeUnknownSync(Schema.Struct({ step: Schema.Number }));

type CommitDialogState = {
  readonly open: boolean;
  readonly message: string;
  readonly excludedFiles: ReadonlySet<string>;
  readonly isEditingFiles: boolean;
  readonly revision: number;
};

type PublishDialogState = {
  readonly open: boolean;
  readonly selectedProvider: PublishProviderKind | null;
  readonly repositoryOverride: string | null;
  readonly visibility: SourceControlRepositoryVisibility;
  readonly remoteName: string;
  readonly protocol: SourceControlCloneProtocol;
  readonly step: number;
  readonly advancedOpen: boolean;
  readonly error: string | null;
  readonly result: SourceControlPublishRepositoryResult | null;
  readonly revision: number;
};

type GitActionsUiState = {
  readonly menuOpen: boolean;
  readonly commit: CommitDialogState;
  readonly pendingDefaultBranchAction: PendingDefaultBranchAction | null;
  readonly publish: PublishDialogState;
};

export type GitMenuView = {
  readonly items: ReadonlyArray<GitActionMenuItemModel>;
  readonly publishItem: {
    readonly label: string;
    readonly icon: string;
    readonly disabled: boolean;
  } | null;
  readonly notices: ReadonlyArray<GitMenuNotice>;
  readonly sourceControlIcon: string;
};

export type GitCommitDialogView = GitCommitDialogModel & {
  readonly isEditingFiles: boolean;
  readonly revision: number;
};

export type GitPublishProviderView = {
  readonly value: PublishProviderKind;
  readonly label: string;
  readonly ready: boolean;
  readonly hint: string;
  readonly selected: boolean;
};

export type GitPublishStepView = {
  readonly label: string;
  readonly summary: string | null;
  readonly disabled: boolean;
};

export type GitPublishDialogView = {
  readonly step: number;
  readonly steps: ReadonlyArray<GitPublishStepView>;
  readonly providers: ReadonlyArray<GitPublishProviderView>;
  readonly provider: PublishProviderKind;
  readonly providerLabel: string;
  readonly host: string;
  readonly pathPlaceholder: string;
  readonly repository: string;
  readonly visibilityOptions: ReadonlyArray<{
    readonly value: SourceControlRepositoryVisibility;
    readonly label: string;
    readonly description: string;
    readonly icon: "lock" | "globe";
    readonly selected: boolean;
  }>;
  readonly advancedOpen: boolean;
  readonly remoteName: string;
  readonly protocol: SourceControlCloneProtocol;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly result: {
    readonly title: string;
    readonly description: string;
    readonly nameWithOwner: string;
  } | null;
  readonly canSubmit: boolean;
  readonly nextDisabled: boolean;
  readonly revision: number;
};

export type GitActionsView = {
  readonly menuOpen: boolean;
  readonly menu: GitMenuView | null;
  readonly commitDialog: GitCommitDialogView | null;
  readonly defaultBranchDialog: DefaultBranchConfirmationModel | null;
  readonly publishDialog: GitPublishDialogView | null;
};

type GitScope = {
  readonly input: ThreadInput;
  readonly environmentId: EnvironmentId;
  readonly gitCwd: string;
  readonly status: VcsStatusResult | null;
  readonly statusError: string | null;
};

type ActiveProgress = GitActionProgressState & { readonly toastId: string };
type AtomGetter = <A>(atom: Atom.Atom<A>) => A;

const INITIAL_COMMIT: CommitDialogState = {
  open: false,
  message: "",
  excludedFiles: new Set(),
  isEditingFiles: false,
  revision: 0,
};

const INITIAL_PUBLISH: PublishDialogState = {
  open: false,
  selectedProvider: null,
  repositoryOverride: null,
  visibility: "private",
  remoteName: "origin",
  protocol: "ssh",
  step: 0,
  advancedOpen: false,
  error: null,
  result: null,
  revision: 0,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : GIT_ACTION_COPY.genericError;
}

export function createGitActionsFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const uiAtom = Atom.make<GitActionsUiState>({
    menuOpen: false,
    commit: INITIAL_COMMIT,
    pendingDefaultBranchAction: null,
    publish: INITIAL_PUBLISH,
  }).pipe(Atom.keepAlive);
  let activeProgress: ActiveProgress | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  const updateUi = (update: (current: GitActionsUiState) => GitActionsUiState) => {
    registry.set(uiAtom, update(registry.get(uiAtom)));
  };

  const updatePublish = (update: (current: PublishDialogState) => PublishDialogState) =>
    updateUi((current) => ({ ...current, publish: update(current.publish) }));

  const updateCommit = (update: (current: CommitDialogState) => CommitDialogState) =>
    updateUi((current) => ({ ...current, commit: update(current.commit) }));

  const readScope = (get: AtomGetter): GitScope | null => {
    const input = get(context.threadInputAtom);
    const git = get(context.gitStatusAtom);
    if (input === null || git === null) return null;
    return {
      input,
      environmentId: input.thread.environmentId,
      gitCwd: git.gitCwd,
      status: git.status,
      statusError: git.error,
    };
  };

  const currentScope = (): GitScope | null => readScope((atom) => registry.get(atom));

  const actionTarget = (scope: GitScope) => ({
    environmentId: scope.environmentId,
    cwd: scope.gitCwd,
  });

  const actionState = (scope: GitScope) =>
    registry.get(state.vcsActionManager.stateAtom(actionTarget(scope)));

  const refreshStatus = (scope: GitScope) => {
    registry.refresh(
      state.vcsEnvironment.status({
        environmentId: scope.environmentId,
        input: { cwd: scope.gitCwd },
      }),
    );
  };

  const requestStatusRefresh = (scope: GitScope) => {
    void runAtomCommand(
      registry,
      state.vcsEnvironment.refreshStatus,
      { environmentId: scope.environmentId, input: { cwd: scope.gitCwd } },
      { reportFailure: false },
    );
  };

  const toolbarModel = (scope: GitScope) => {
    const vcsState = actionState(scope);
    return buildGitActionsToolbarModel({
      gitCwd: scope.gitCwd,
      gitStatus: scope.status,
      gitStatusError: scope.statusError,
      isGitActionRunning: isSourceControlActionRunning(vcsState, RUNNING_SOURCE_CONTROL_ACTIONS),
      isInitPending: isSourceControlActionPending(vcsState, "init"),
    });
  };

  const addErrorToast = (title: string, error: unknown, id?: string) => {
    context.addToast({
      layout: "stacked",
      type: "error",
      title,
      description: errorMessage(error),
      ...(id !== undefined ? { id, timeout: 0 } : {}),
    });
  };

  const stopProgressTicker = () => {
    clearInterval(progressTimer ?? undefined);
    progressTimer = null;
  };

  const renderProgressToast = () => {
    const progress = activeProgress;
    if (progress === null) return;
    context.addToast({
      layout: "plain",
      type: "loading",
      id: progress.toastId,
      title: progress.title,
      description: resolveGitActionProgressDescription(progress, Date.now()),
      timeout: 0,
    });
  };

  const persistThreadBranch = (scope: GitScope, branch: string | null) => {
    const thread = scope.input.thread;
    if (thread.branch === branch) return;
    void runAtomCommand(
      registry,
      state.threadEnvironment.updateMetadata,
      {
        environmentId: thread.environmentId,
        input: {
          threadId: thread.id,
          ...resolveThreadBranchMetadataPatch(branch, thread.branch),
        },
      },
      { label: "thread branch metadata update" },
    );
  };

  const openExistingPr = async (scope: GitScope) => {
    const intent = resolveOpenExistingPrIntent({ gitStatus: scope.status, canOpenInApp: false });
    if (intent.kind === "missing" || intent.kind === "open_in_app") {
      context.addToast({
        layout: "plain",
        type: "error",
        title: GIT_ACTION_COPY.noOpenPr,
        timeout: DEFAULT_TOAST_MS,
      });
      return;
    }
    await openExternal(intent.url).catch((error: unknown) =>
      addErrorToast(GIT_ACTION_COPY.openPrLinkFailed, error),
    );
  };

  const runGitActionWithToast = async (request: GitActionRunRequest): Promise<void> => {
    const scope = currentScope();
    if (scope === null) return;
    const plan = resolveGitActionRunPlan({
      request,
      gitStatus: scope.status,
      isDefaultRef: scope.status?.isDefaultRef ?? false,
      terminology: resolveChangeRequestTerminology(scope.status),
    });
    if (plan.kind === "confirm_default_branch") {
      updateUi((current) => ({ ...current, pendingDefaultBranchAction: plan.pending }));
      return;
    }

    const actionId = randomUUID();
    const toastId = context.addToast({
      layout: "plain",
      type: "loading",
      id: `git-action-${actionId}`,
      title: plan.initialTitle,
      description: GIT_ACTION_COPY.waitingForGit,
      timeout: 0,
    });
    activeProgress = { ...initialGitActionProgressState(actionId, plan.initialTitle), toastId };
    stopProgressTicker();
    progressTimer = setInterval(renderProgressToast, PROGRESS_TICK_MS);

    const onProgress = (event: GitActionProgressEvent) => {
      const progress = activeProgress;
      if (progress === null) return;
      const next = applyGitActionProgressEvent({
        progress,
        event,
        gitCwd: scope.gitCwd,
        nowMs: Date.now(),
      });
      if (next === null) return;
      activeProgress = next;
      renderProgressToast();
    };

    const result = await runAtomCommand(
      registry,
      state.vcsActionManager.runStackedAction(actionTarget(scope)),
      {
        actionId,
        ...plan.command,
        threadId: scope.input.thread.id,
        onProgress,
      },
      { reportFailure: false },
    );

    activeProgress = null;
    stopProgressTicker();
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        context.closeToast(toastId);
        return;
      }
      addErrorToast(GIT_ACTION_COPY.actionFailed, squashAtomCommandFailure(result), toastId);
      return;
    }
    refreshStatus(scope);

    const actionResult = result.value;
    const branchUpdate = resolveThreadBranchUpdate(actionResult);
    if (branchUpdate) persistThreadBranch(scope, branchUpdate.branch);

    const cta = actionResult.toast.cta;
    const action =
      cta.kind === "run_action"
        ? {
            label: cta.label,
            onClick: () => {
              context.closeToast(toastId);
              void runGitActionWithToast({ action: cta.action.kind });
            },
          }
        : cta.kind === "open_pr"
          ? {
              label: cta.label,
              onClick: () => {
                context.closeToast(toastId);
                void openExternal(cta.url).catch((error: unknown) =>
                  addErrorToast(GIT_ACTION_COPY.openPrLinkFailed, error),
                );
              },
            }
          : null;
    context.addToast({
      layout: action === null ? "plain" : "stacked",
      type: "success",
      id: toastId,
      title: actionResult.toast.title,
      description: actionResult.toast.description,
      timeout: SUCCESS_TOAST_MS,
      ...(action !== null ? { action } : {}),
    });
  };

  const trackAction = async <A, E>(
    scope: GitScope,
    kind: "init" | "pull" | "publishRepository",
    run: () => Promise<AtomCommandResult<A, E>>,
  ) => {
    const result = await state.vcsActionManager.track(
      registry,
      actionTarget(scope),
      {
        operation: SOURCE_CONTROL_ACTION_OPERATION[kind],
        label: SOURCE_CONTROL_ACTION_LABEL[kind],
      },
      run,
    );
    if (AsyncResult.isSuccess(result) && kind !== "init") refreshStatus(scope);
    return result;
  };

  const runPull = async (scope: GitScope) => {
    const toastId = context.addToast({
      layout: "plain",
      type: "loading",
      id: `git-pull-${randomUUID()}`,
      title: GIT_ACTION_COPY.pulling,
      timeout: 0,
    });
    const result = await trackAction(scope, "pull", () =>
      runAtomCommand(
        registry,
        state.vcsEnvironment.pull,
        { environmentId: scope.environmentId, input: { cwd: scope.gitCwd } },
        { reportFailure: false },
      ),
    );
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        context.closeToast(toastId);
        return;
      }
      addErrorToast(GIT_ACTION_COPY.pullFailed, squashAtomCommandFailure(result), toastId);
      return;
    }
    context.addToast({
      layout: "plain",
      type: "success",
      id: toastId,
      ...resolveGitPullSuccessToast(result.value),
      timeout: 0,
    });
  };

  const openPublishDialog = () =>
    updatePublish((current) => ({
      ...INITIAL_PUBLISH,
      open: true,
      revision: current.revision + 1,
    }));

  const requireScope = (): GitScope => {
    const scope = currentScope();
    if (scope === null) throw new Error("Git actions need an open thread with a project.");
    return scope;
  };

  const commitModel = (scope: GitScope, commit: CommitDialogState) =>
    buildGitCommitDialogModel({
      gitStatus: scope.status,
      excludedFiles: commit.excludedFiles,
      isEditingFiles: commit.isEditingFiles,
    });

  const publishModel = (
    get: AtomGetter,
    scope: GitScope,
    publish: PublishDialogState,
    isPending: boolean,
  ) => {
    const discovery = get(
      state.sourceControlEnvironment.discovery({ environmentId: scope.environmentId, input: {} }),
    );
    return resolvePublishRepositoryState({
      sourceControlProviders:
        Option.getOrNull(AsyncResult.value(discovery))?.sourceControlProviders ?? [],
      selectedProvider: publish.selectedProvider,
      repositoryOverride: publish.repositoryOverride,
      isPending,
      result: publish.result,
    });
  };

  const currentPublishModel = (scope: GitScope) => {
    const ui = registry.get(uiAtom);
    return publishModel(
      (atom) => registry.get(atom),
      scope,
      ui.publish,
      isSourceControlActionPending(actionState(scope), "publishRepository"),
    );
  };

  const viewAtom = Atom.make((get): GitActionsView | null => {
    const scope = readScope(get);
    if (scope === null) return null;
    const ui = get(uiAtom);
    const vcsState = get(state.vcsActionManager.stateAtom(actionTarget(scope)));
    const model = buildGitActionsToolbarModel({
      gitCwd: scope.gitCwd,
      gitStatus: scope.status,
      gitStatusError: scope.statusError,
      isGitActionRunning: isSourceControlActionRunning(vcsState, RUNNING_SOURCE_CONTROL_ACTIONS),
      isInitPending: isSourceControlActionPending(vcsState, "init"),
    });
    const terminology = resolveChangeRequestTerminology(scope.status);
    const isPublishPending = isSourceControlActionPending(vcsState, "publishRepository");
    let publishDialog: GitPublishDialogView | null = null;
    if (ui.publish.open) {
      const publish = publishModel(get, scope, ui.publish, isPublishPending);
      publishDialog = {
        step: ui.publish.step,
        steps: PUBLISH_WIZARD_STEPS.map((label, index) => ({
          label,
          summary: publish.stepSummaries[index] ?? null,
          disabled: isPublishWizardStepDisabled(index, ui.publish.step),
        })),
        providers: publish.sortedOptions.map((option) => {
          const readiness = publish.readiness[option.value];
          return {
            value: option.value,
            label: option.label,
            ready: readiness.ready,
            hint: readiness.hint ?? "Open Settings -> Source Control to configure this provider.",
            selected: publish.provider === option.value && readiness.ready,
          };
        }),
        provider: publish.provider,
        providerLabel: publish.providerOption.label,
        host: publish.host,
        pathPlaceholder: publish.providerOption.pathPlaceholder,
        repository: publish.repository,
        visibilityOptions: PUBLISH_VISIBILITY_OPTIONS.map((option) => ({
          ...option,
          selected: option.value === ui.publish.visibility,
        })),
        advancedOpen: ui.publish.advancedOpen,
        remoteName: ui.publish.remoteName,
        protocol: ui.publish.protocol,
        isPending: isPublishPending,
        error: ui.publish.error,
        result:
          ui.publish.result === null
            ? null
            : {
                ...resolvePublishResultCopy(ui.publish.result, publish.providerOption.label),
                nameWithOwner: ui.publish.result.repository.nameWithOwner,
              },
        canSubmit: publish.canSubmit,
        nextDisabled: !publish.hasReadyProvider || !publish.providerReadiness.ready,
        revision: ui.publish.revision,
      };
    }
    return {
      menuOpen: ui.menuOpen && model.kind === "repo" && !model.menuTriggerDisabled,
      menu:
        model.kind === "repo"
          ? {
              items: model.menuItems,
              publishItem: model.publishItem,
              notices: model.notices,
              sourceControlIcon: model.sourceControlIcon,
            }
          : null,
      commitDialog: ui.commit.open
        ? {
            ...commitModel(scope, ui.commit),
            isEditingFiles: ui.commit.isEditingFiles,
            revision: ui.commit.revision,
          }
        : null,
      defaultBranchDialog:
        ui.pendingDefaultBranchAction === null
          ? null
          : buildDefaultBranchConfirmationModel(ui.pendingDefaultBranchAction, terminology),
      publishDialog,
    };
  });

  const submitPublish = async () => {
    const scope = requireScope();
    const publish = currentPublishModel(scope);
    if (!publish.canSubmit) return null;
    const ui = registry.get(uiAtom).publish;
    updatePublish((current) => ({ ...current, error: null }));
    const input = buildPublishRepositoryInput({
      provider: publish.provider,
      repository: publish.repository,
      visibility: ui.visibility,
      remoteName: ui.remoteName,
      protocol: ui.protocol,
    });
    const result = await trackAction(scope, "publishRepository", () =>
      runAtomCommand(
        registry,
        state.sourceControlEnvironment.publishRepository,
        { environmentId: scope.environmentId, input: { cwd: scope.gitCwd, ...input } },
        { reportFailure: false },
      ),
    );
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        updatePublish((current) => ({ ...current, error: errorMessage(error) }));
      }
      return null;
    }
    updatePublish((current) => ({ ...current, result: result.value, step: 2 }));
    return null;
  };

  return {
    views: { gitActions: viewAtom },
    actions: {
      gitMenuOpen: async () => {
        const scope = requireScope();
        updateUi((current) => ({ ...current, menuOpen: true }));
        requestStatusRefresh(scope);
        return null;
      },
      gitMenuClose: async () => {
        updateUi((current) => ({ ...current, menuOpen: false }));
        return null;
      },
      gitRefreshStatus: async () => {
        requestStatusRefresh(requireScope());
        return null;
      },
      gitQuickAction: async () => {
        const scope = requireScope();
        const model = toolbarModel(scope);
        if (model.kind !== "repo") return null;
        const intent = resolveGitQuickActionIntent(model.quickAction);
        switch (intent.kind) {
          case "open_pr":
            await openExistingPr(scope);
            return null;
          case "open_publish":
            openPublishDialog();
            return null;
          case "run_pull":
            void runPull(scope);
            return null;
          case "show_hint":
            context.addToast({
              layout: "plain",
              type: "info",
              title: intent.title,
              description: intent.description,
              timeout: DEFAULT_TOAST_MS,
            });
            return null;
          case "run_action":
            void runGitActionWithToast({ action: intent.action });
            return null;
          case "none":
            return null;
        }
      },
      gitMenuItem: async (params) => {
        const { id } = MenuItemParams(params);
        const scope = requireScope();
        updateUi((current) => ({ ...current, menuOpen: false }));
        const model = toolbarModel(scope);
        if (model.kind !== "repo") return null;
        const item = model.menuItems.find((candidate) => candidate.id === id);
        if (item === undefined) return null;
        const intent = resolveGitMenuItemIntent(item);
        switch (intent.kind) {
          case "open_pr":
            await openExistingPr(scope);
            return null;
          case "run_action":
            void runGitActionWithToast({ action: intent.action });
            return null;
          case "open_commit_dialog":
            updateCommit((current) => ({
              ...INITIAL_COMMIT,
              open: true,
              revision: current.revision + 1,
            }));
            return null;
          case "none":
            return null;
        }
      },
      gitInit: async () => {
        const scope = requireScope();
        const result = await trackAction(scope, "init", () =>
          runAtomCommand(
            registry,
            state.vcsEnvironment.init,
            { environmentId: scope.environmentId, input: { cwd: scope.gitCwd } },
            { reportFailure: false },
          ),
        );
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
        addErrorToast(GIT_ACTION_COPY.initFailed, squashAtomCommandFailure(result));
        return null;
      },
      gitCommitDialogSetMessage: async (params) => {
        const { message } = MessageParams(params);
        updateCommit((current) => ({ ...current, message }));
        return null;
      },
      gitCommitDialogToggleEditing: async () => {
        updateCommit((current) => ({ ...current, isEditingFiles: !current.isEditingFiles }));
        return null;
      },
      gitCommitDialogToggleFile: async (params) => {
        const { path } = PathParams(params);
        updateCommit((current) => ({
          ...current,
          excludedFiles: toggleCommitDialogFileExclusion(current.excludedFiles, path),
        }));
        return null;
      },
      gitCommitDialogToggleAll: async () => {
        const scope = requireScope();
        updateCommit((current) => ({
          ...current,
          excludedFiles: toggleCommitDialogSelectAll(commitModel(scope, current)),
        }));
        return null;
      },
      gitCommitDialogOpenFile: async (params) => {
        const { path } = PathParams(params);
        const scope = requireScope();
        const result = await openInPreferredEditor({
          environmentId: scope.environmentId,
          availableEditors: scope.input.serverConfig?.availableEditors ?? [],
          targetPath: resolvePathLinkTarget(path, scope.gitCwd),
          openInEditor: (target) =>
            runAtomCommand(registry, state.shellEnvironment.openInEditor, target, {
              reportFailure: false,
            }),
        });
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
        addErrorToast(GIT_ACTION_COPY.openFileFailed, squashAtomCommandFailure(result));
        return null;
      },
      gitCommitDialogClose: async () => {
        updateCommit((current) => ({ ...INITIAL_COMMIT, revision: current.revision }));
        return null;
      },
      gitCommitDialogSubmit: async (params) => {
        const { onNewBranch } = SubmitCommitParams(params);
        const scope = requireScope();
        const commit = registry.get(uiAtom).commit;
        if (!commit.open) return null;
        const request = resolveCommitDialogRunRequest({
          commitMessage: commit.message,
          model: commitModel(scope, commit),
          onNewBranch,
        });
        updateCommit((current) => ({ ...INITIAL_COMMIT, revision: current.revision }));
        void runGitActionWithToast(request);
        return null;
      },
      gitDefaultBranchAbort: async () => {
        updateUi((current) => ({ ...current, pendingDefaultBranchAction: null }));
        return null;
      },
      gitDefaultBranchContinue: async (params) => {
        const { mode } = ContinueParams(params);
        const pending = registry.get(uiAtom).pendingDefaultBranchAction;
        if (pending === null) return null;
        updateUi((current) => ({ ...current, pendingDefaultBranchAction: null }));
        void runGitActionWithToast(resolveDefaultBranchContinuation(pending, mode));
        return null;
      },
      gitPublishOpen: async () => {
        updateUi((current) => ({ ...current, menuOpen: false }));
        openPublishDialog();
        return null;
      },
      gitPublishClose: async () => {
        updatePublish((current) => ({
          ...current,
          open: false,
          remoteName: "origin",
          repositoryOverride: null,
          step: 0,
          advancedOpen: false,
          error: null,
          result: null,
        }));
        return null;
      },
      gitPublishSelectProvider: async (params) => {
        const { provider } = ProviderParams(params);
        updatePublish((current) => ({
          ...current,
          selectedProvider: provider,
          repositoryOverride: null,
          revision: current.revision + 1,
        }));
        return null;
      },
      gitPublishSetRepository: async (params) => {
        const { value } = ValueParams(params);
        updatePublish((current) => ({ ...current, repositoryOverride: value }));
        return null;
      },
      gitPublishSetVisibility: async (params) => {
        const { visibility } = VisibilityParams(params);
        updatePublish((current) => ({ ...current, visibility }));
        return null;
      },
      gitPublishSetRemoteName: async (params) => {
        const { value } = ValueParams(params);
        updatePublish((current) => ({ ...current, remoteName: value }));
        return null;
      },
      gitPublishSetProtocol: async (params) => {
        const { protocol } = ProtocolParams(params);
        updatePublish((current) => ({ ...current, protocol }));
        return null;
      },
      gitPublishToggleAdvanced: async () => {
        updatePublish((current) => ({ ...current, advancedOpen: !current.advancedOpen }));
        return null;
      },
      gitPublishSetStep: async (params) => {
        const { step } = StepParams(params);
        updatePublish((current) =>
          isPublishWizardStepDisabled(step, current.step) ? current : { ...current, step },
        );
        return null;
      },
      gitPublishBack: async () => {
        updatePublish((current) => ({ ...current, step: Math.max(0, current.step - 1) }));
        return null;
      },
      gitPublishNext: async () => {
        updatePublish((current) => ({ ...current, step: Math.min(1, current.step + 1) }));
        return null;
      },
      gitPublishSubmit: submitPublish,
      gitPublishOpenResult: async () => {
        const result = registry.get(uiAtom).publish.result;
        if (result === null) return null;
        await openExternal(result.repository.url).catch(() => undefined);
        return null;
      },
      gitPublishOpenSettings: async () => {
        updatePublish((current) => ({ ...INITIAL_PUBLISH, revision: current.revision }));
        context.navigate({ kind: "settings", section: SOURCE_CONTROL_SETTINGS_SECTION });
        return null;
      },
    },
  };
}
