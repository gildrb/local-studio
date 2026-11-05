import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type { CodexFeedbackSubmission } from "@t3tools/client-runtime/state/threads";
import type {
  ModelSelection,
  ProviderInteractionMode,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveLocalCheckoutBranchMismatch } from "@t3tools/web/src/components/BranchToolbar.logic.ts";
import {
  getAntigravitySendBlockReason,
  nextLocalDispatch,
  resolveLocalDispatchAcknowledged,
  resolveSendEnvMode,
  type LocalDispatchSnapshot,
  waitForStartedServerThread,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  sendComposerTurn,
  type ComposerSendDeps,
  type ComposerSendHandle,
  type ComposerSendOutcome,
  type ComposerSendToast,
  type MutableBox,
  persistThreadSettingsForNextTurn,
  type ComposerSendInput,
} from "@t3tools/web/src/components/chat/composerSend.logic.ts";
import {
  implementPlanInNewThread,
  submitPlanFollowUp,
} from "@t3tools/web/src/components/chat/threadInteractions.logic.ts";
import { sanitizeThreadErrorMessage } from "@t3tools/client-runtime/errors";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { getComposerSubmissionValidationMessage } from "@t3tools/web/src/components/chat/composerSubmission.ts";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
} from "@t3tools/web/src/components/chat/composerProviderState.logic.ts";
import {
  beginBackgroundDraftSubmissionByRef,
  clearBackgroundDraftSubmissionByRef,
  type DraftId,
  type DraftThreadState,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  restoreFailedBackgroundDraftThread,
  useComposerDraftStore,
} from "@t3tools/web/src/composerDraftStore.ts";
import type { NewThreadOptions, NewThreadResult } from "@t3tools/web/src/hooks/newThread.logic.ts";
import { useQueuedMessageStore } from "@t3tools/web/src/queuedMessageStore.ts";
import type { ChatMessage } from "@t3tools/web/src/types.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  deriveComposerModelContext,
  deriveComposerTurnState,
  type ComposerGitStatus,
  type ComposerModelInput,
} from "./composerView.ts";
import type { CoreAttachmentUploads } from "./attachmentUploads.ts";
import { composerEnvironmentRuntime } from "./composerEnvironment.ts";
import type { CoreState } from "./state.ts";

export type CoreToast = {
  readonly id: string;
  readonly type: ComposerSendToast["type"];
  readonly title: string;
  readonly description: string | null;
  readonly actions: ReadonlyArray<{
    readonly key: "action" | "secondaryAction";
    readonly label: string;
  }>;
};

type ThreadSendState = {
  readonly sendInFlight: MutableBox<boolean>;
  readonly sendGeneration: MutableBox<number>;
  readonly environmentUnavailableToastSlot: MutableBox<number>;
  readonly feedbackUploadsInFlight: { readonly current: Set<string> };
  readonly uncertainMultipleSubmissions: { readonly current: Map<string, ThreadId> };
};

function unsupported(feature: string): never {
  throw new Error(`${feature} is not available in the native app yet.`);
}

export type SendRuntimeInput = ComposerModelInput & {
  readonly route: ScopedThreadRef;
  readonly draftId: DraftId | null;
  readonly draftThread: DraftThreadState | null;
  readonly isServerThread: boolean;
  readonly isDraftHeroState: boolean;
  readonly gitStatus: ComposerGitStatus | null;
  readonly serverConfig: ServerConfig | null;
  readonly environmentConnectionPhase: string | null;
};

export function createComposerSendRuntime(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: CoreState;
  readonly navigateToThread: (ref: ScopedThreadRef) => void;
  readonly navigateToDraft: (draftId: DraftId) => void;
  readonly openNewThread: (
    projectRef: ScopedProjectRef,
    options: NewThreadOptions,
  ) => Promise<NewThreadResult | null>;
  readonly writePrompt: (route: ScopedThreadRef, prompt: string) => void;
  readonly markThreadVisited: (threadKey: string, visitedAt: string) => void;
  readonly scrollTimelineToEnd: () => void;
  readonly currentRouteThreadKey: () => string | null;
  readonly attachmentUploads: CoreAttachmentUploads;
  readonly advancePendingUserInput: () => void;
}) {
  const { registry, state } = options;
  const localDispatchAtom = Atom.make<Readonly<Record<string, LocalDispatchSnapshot | null>>>(
    {},
  ).pipe(Atom.keepAlive);
  const optimisticMessagesAtom = Atom.make<Readonly<Record<string, ReadonlyArray<ChatMessage>>>>(
    {},
  ).pipe(Atom.keepAlive);
  const threadErrorsAtom = Atom.make<Readonly<Record<string, string | null>>>({}).pipe(
    Atom.keepAlive,
  );
  const providerInputErrorsAtom = Atom.make<Readonly<Record<string, string | null>>>({}).pipe(
    Atom.keepAlive,
  );
  const toastsAtom = Atom.make<ReadonlyArray<CoreToast>>([]).pipe(Atom.keepAlive);
  const feedbackAtom = Atom.make<Readonly<Record<string, ReadonlyArray<CodexFeedbackSubmission>>>>(
    {},
  ).pipe(Atom.keepAlive);
  const draftHeroDockedThreadKeyAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const toastActions = new Map<string, Partial<Record<"action" | "secondaryAction", () => void>>>();
  const threadStates = new Map<string, ThreadSendState>();
  let toastCounter = 0;
  const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const threadState = (threadKey: string): ThreadSendState => {
    const existing = threadStates.get(threadKey);
    if (existing !== undefined) return existing;
    const created: ThreadSendState = {
      sendInFlight: { current: false },
      sendGeneration: { current: 0 },
      environmentUnavailableToastSlot: { current: 0 },
      feedbackUploadsInFlight: { current: new Set() },
      uncertainMultipleSubmissions: { current: new Map() },
    };
    threadStates.set(threadKey, created);
    return created;
  };

  const updateRecord = <V>(
    atom: Atom.Writable<Readonly<Record<string, V>>>,
    key: string,
    update: (current: V | undefined) => V,
  ) => {
    const current = registry.get(atom);
    registry.set(atom, { ...current, [key]: update(current[key]) });
  };

  const addToast = (toast: ComposerSendToast): string => {
    toastCounter += 1;
    const id = toast.id ?? `core-toast-${toastCounter}`;
    const actions: CoreToast["actions"][number][] = [];
    const handlers: Partial<Record<"action" | "secondaryAction", () => void>> = {};
    if (toast.action) {
      actions.push({ key: "action", label: toast.action.label });
      handlers.action = toast.action.onClick;
    }
    if (toast.secondaryAction) {
      actions.push({ key: "secondaryAction", label: toast.secondaryAction.label });
      handlers.secondaryAction = toast.secondaryAction.onClick;
    }
    toastActions.set(id, handlers);
    const next: CoreToast = {
      id,
      type: toast.type,
      title: toast.title,
      description: toast.description ?? null,
      actions,
    };
    const current = registry.get(toastsAtom);
    registry.set(
      toastsAtom,
      current.some((existing) => existing.id === id)
        ? current.map((existing) => (existing.id === id ? next : existing))
        : [...current, next],
    );
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    if (toast.timeout !== undefined && toast.timeout > 0) {
      toastTimers.set(
        id,
        setTimeout(() => closeToast(id), toast.timeout),
      );
    }
    return id;
  };

  const closeToast = (id: string) => {
    toastActions.delete(id);
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    registry.set(
      toastsAtom,
      registry.get(toastsAtom).filter((toast) => toast.id !== id),
    );
  };

  const runToastAction = (id: string, key: "action" | "secondaryAction") => {
    const handler = toastActions.get(id)?.[key];
    if (handler === undefined) throw new Error(`toast ${id} has no ${key}`);
    handler();
  };

  const isSendBusy = (input: ComposerModelInput & { readonly route: ScopedThreadRef }): boolean => {
    const threadKey = scopedThreadKey(input.route);
    const localDispatch = registry.get(localDispatchAtom)[threadKey] ?? null;
    if (localDispatch === null) return false;
    const { phase, activeLatestTurn, approvals, userInputs } = deriveComposerTurnState(
      input.thread,
      input.draft,
      deriveComposerModelContext(input).interactionMode,
    );
    return !resolveLocalDispatchAcknowledged({
      localDispatch,
      activeThread: input.thread,
      activeLatestTurn,
      phase,
      hasPendingApproval: approvals.length > 0,
      hasPendingUserInput: userInputs.length > 0,
      threadError: registry.get(threadErrorsAtom)[input.thread.id] ?? null,
    });
  };

  const prepareSend = (input: SendRuntimeInput) => {
    const { route, thread, project, draftId, draftThread, isServerThread } = input;
    const isLocalDraftThread = !isServerThread && draftThread !== null;
    const threadKey = scopedThreadKey(route);
    const context = deriveComposerModelContext(input);
    const turn = deriveComposerTurnState(thread, input.draft, context.interactionMode);
    const isGitRepo = input.gitStatus?.isRepo ?? true;
    const activeWorktreePath = thread.worktreePath ?? null;
    const composerEnv = composerEnvironmentRuntime(registry, state).read(input);
    const envMode = composerEnv.envMode;
    const branch = thread.branch ?? null;
    const activeThreadBranch = composerEnv.activeThreadBranch;
    const mismatch = isServerThread
      ? resolveLocalCheckoutBranchMismatch({
          effectiveEnvMode: envMode,
          activeWorktreePath,
          activeThreadBranch,
          currentGitBranch: input.gitStatus?.refName ?? null,
        })
      : null;
    const store = () => useComposerDraftStore.getState();
    const draftNow = () => store().getComposerDraft(route);
    const sendState = threadState(threadKey);
    const refs: ComposerSendDeps["refs"] = {
      prompt: { current: draftNow()?.prompt ?? "" },
      images: { current: [...(draftNow()?.images ?? [])] },
      files: { current: [...(draftNow()?.files ?? [])] },
      terminalContexts: { current: [...(draftNow()?.terminalContexts ?? [])] },
      sendInFlight: sendState.sendInFlight,
      sendGeneration: sendState.sendGeneration,
      environmentUnavailableToastSlot: sendState.environmentUnavailableToastSlot,
      feedbackUploadsInFlight: sendState.feedbackUploadsInFlight,
      multipleModelSelections: { current: null },
      currentRouteThreadKey: {
        get current() {
          return options.currentRouteThreadKey();
        },
      },
      uncertainMultipleSubmissions: sendState.uncertainMultipleSubmissions,
    };
    const handle: ComposerSendHandle = {
      getSendContext: () => {
        const current = deriveComposerModelContext({ ...input, draft: draftNow() });
        const draft = draftNow();
        const selection = current.selection;
        const instanceId = selection?.instanceId ?? null;
        const selectedModel = selection?.selectedModel ?? thread.modelSelection.model;
        const models = selection?.entry.models ?? [];
        const providerState = getComposerProviderState({
          provider: current.selectedProvider,
          model: selectedModel,
          models,
          promptInjectionState: getComposerPromptInjectionState(draft?.prompt ?? ""),
          modelOptions: selection?.instanceModelOptions,
          planModeEnabled: current.settings.planModeEnabled,
        });
        const selectedModelSelection: ModelSelection =
          instanceId === null
            ? thread.modelSelection
            : createModelSelection(
                instanceId,
                selectedModel,
                providerState.modelOptionsForDispatch,
              );
        return {
          images: draft?.images ?? [],
          files: draft?.files ?? [],
          terminalContexts: draft?.terminalContexts ?? [],
          previewAnnotations: draft?.previewAnnotations ?? [],
          reviewComments: draft?.reviewComments ?? [],
          selectedPromptEffort: providerState.promptEffort,
          selectedModelSelection,
          multipleModelSelections: null,
          providerAvailable:
            selection !== null &&
            getAntigravitySendBlockReason(selection.entry.snapshot, selectedModel) === null,
          selectedProvider: current.selectedProvider,
          selectedModel,
          selectedProviderModels: models,
          interactionMode: current.interactionMode,
          interactionModeEnabled: current.interactionModeEnabled,
        };
      },
      validateProviderInput: (providerInput) => {
        const message = getComposerSubmissionValidationMessage({
          prompt: draftNow()?.prompt ?? "",
          providerInput,
          submissionTarget: "provider-turn",
        });
        updateRecord(providerInputErrorsAtom, threadKey, () => message);
        return message === null;
      },
      resetCursorState: (reset) => {
        if (reset?.prompt !== undefined && reset.prompt !== (draftNow()?.prompt ?? "")) {
          options.writePrompt(route, reset.prompt);
        }
      },
    };
    const commandOptions = { reportFailure: false };
    const environmentId = thread.environmentId;
    const shell = registry.get(state.environmentThreadShells.threadShellAtom(route));
    const supportsSnooze = input.serverConfig?.environment.capabilities.threadSnooze === true;
    const deps: ComposerSendDeps = {
      composer: () => handle,
      refs,
      draft: {
        read: draftNow,
        setPrompt: (prompt) => options.writePrompt(route, prompt),
        clearContent: () => {
          store().clearComposerContent(route);
          options.writePrompt(route, draftNow()?.prompt ?? "");
        },
        addImages: (images) => store().addImages(route, images),
        addFiles: (files) => store().addFiles(route, files),
        setTerminalContexts: (contexts) => store().setTerminalContexts(route, contexts),
        setPreviewAnnotations: (annotations) => store().setPreviewAnnotations(route, annotations),
        setReviewComments: (comments) => store().setReviewComments(route, comments),
        getDraftSession: (draftId) => store().getDraftSession(draftId),
        setLogicalProjectDraftThreadId: (logicalProjectKey, projectRef, draftId, extra) =>
          store().setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, extra),
        beginBackgroundSubmission: beginBackgroundDraftSubmissionByRef,
        clearBackgroundSubmission: clearBackgroundDraftSubmissionByRef,
        markPromoted: markPromotedDraftThreadByRef,
        finalizePromoted: finalizePromotedDraftThreadByRef,
        restoreFailedBackgroundThread: restoreFailedBackgroundDraftThread,
      },
      commands: {
        startTurn: (turnInput) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.startTurn,
            { environmentId, input: turnInput },
            commandOptions,
          ),
        updateMetadata: (metadata) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.updateMetadata,
            { environmentId, input: metadata },
            commandOptions,
          ),
        setRuntimeMode: (mode) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.setRuntimeMode,
            { environmentId, input: mode },
            commandOptions,
          ),
        setInteractionMode: (mode) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.setInteractionMode,
            { environmentId, input: mode },
            commandOptions,
          ),
        uploadFeedback: (feedback) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.uploadFeedback,
            { environmentId, input: feedback },
            commandOptions,
          ),
      },
      attachments: {
        readServerConfig: () =>
          registry.get(state.serverEnvironment.configValueAtom(environmentId)),
        start: (attachment) =>
          options.attachmentUploads.startAttachmentUpload({
            environmentId,
            image: attachment,
            draftTarget: route,
          }),
        await: options.attachmentUploads.awaitAttachmentUploads,
        getUploaded: (images) =>
          options.attachmentUploads.getUploadedAttachments({ environmentId, images }),
        release: options.attachmentUploads.releaseDraftAttachments,
      },
      queue: {
        read: (key) => useQueuedMessageStore.getState().queuesByThreadKey[key] ?? [],
        enqueue: (key, message) => {
          useQueuedMessageStore.getState().enqueue(key, message);
        },
      },
      toast: {
        add: addToast,
        update: (id, patch) => {
          registry.set(
            toastsAtom,
            registry
              .get(toastsAtom)
              .map((toast) =>
                toast.id === id ? { ...toast, description: patch.description } : toast,
              ),
          );
        },
        close: closeToast,
      },
      navigate: (target) => {
        if (target.kind === "thread") {
          options.navigateToThread(target.threadRef);
          return;
        }
        options.navigateToDraft(target.draftId);
      },
      confirm: () => null,
      setThreadError: (threadId, error) =>
        updateRecord(threadErrorsAtom, threadId, () => sanitizeThreadErrorMessage(error)),
      openUsageLimits: () => unsupported("The usage limits panel"),
      advancePendingUserInput: () => options.advancePendingUserInput(),
      changeInteractionMode: (mode: ProviderInteractionMode) => {
        if (mode === "plan" && !context.interactionModeEnabled) return;
        if (mode === context.interactionMode) return;
        store().setInteractionMode(route, mode);
        if (isLocalDraftThread && draftId !== null) {
          store().setDraftThreadContext(draftId, { interactionMode: mode });
        }
      },
      submitPlanFollowUp: (submission) =>
        submitPlanFollowUp(
          {
            submission,
            thread,
            isServerThread,
            isSendBusy: isSendBusy(input),
            isConnecting: false,
            environmentId,
            routeThreadKey: threadKey,
            runtimeMode: input.draft?.runtimeMode ?? thread.runtimeMode,
            localCheckoutBranch: mismatch?.currentBranch ?? null,
            activeProposedPlan: turn.activeProposedPlan,
          },
          {
            sendInFlight: sendState.sendInFlight,
            composer: () => handle,
            beginLocalDispatch: () =>
              deps.localDispatch.begin({
                preparingWorktree: false,
                submissionIntent: "foreground",
              }),
            resetLocalDispatch: () => deps.localDispatch.reset(),
            setThreadError: (threadId, error) => deps.setThreadError(threadId, error),
            scrollToEnd: () => options.scrollTimelineToEnd(),
            setOptimisticUserMessages: (update) => deps.setOptimisticUserMessages(update),
            persistThreadSettings: (settings) =>
              persistThreadSettingsForNextTurn(
                isServerThread
                  ? {
                      modelSelection: thread.modelSelection,
                      branch,
                      runtimeMode: thread.runtimeMode,
                      interactionMode: thread.interactionMode,
                    }
                  : null,
                settings,
                deps.commands,
              ),
            setInteractionMode: (threadRef, mode) => store().setInteractionMode(threadRef, mode),
            startTurn: (turnInput) => deps.commands.startTurn(turnInput),
            supportsInlineMessageContext: () =>
              registry.get(state.environmentServerConfigsAtom).get(environmentId)?.environment
                .capabilities.inlineMessageContext === true,
            clearUsageLimitsFor: () => {},
            acknowledgeThreadWoke: () => deps.acknowledgeThreadWoke(),
          },
        ),
      setFeedbackSubmissions: (update) =>
        registry.set(feedbackAtom, update(registry.get(feedbackAtom))),
      setMultipleModelSelections: () => unsupported("Multiple model runs"),
      setOptimisticUserMessages: (update) =>
        updateRecord(optimisticMessagesAtom, threadKey, (current) => update([...(current ?? [])])),
      timeline: {
        anchorFirstMessage: () => options.scrollTimelineToEnd(),
        scrollToEnd: () => options.scrollTimelineToEnd(),
      },
      draftHero: {
        dock: async (dockThreadKey) => registry.set(draftHeroDockedThreadKeyAtom, dockThreadKey),
        undock: (dockThreadKey) => {
          if (registry.get(draftHeroDockedThreadKeyAtom) === dockThreadKey) {
            registry.set(draftHeroDockedThreadKeyAtom, null);
          }
        },
      },
      localDispatch: {
        begin: (beginOptions) =>
          updateRecord(localDispatchAtom, threadKey, (current) =>
            nextLocalDispatch(
              current ?? null,
              !isSendBusy(input) && current !== undefined && current !== null,
              thread,
              beginOptions,
            ),
          ),
        reset: () => updateRecord(localDispatchAtom, threadKey, () => null),
      },
      clearUsageLimitsFor: () => {},
      acknowledgeThreadWoke: () => {
        const wokeAt =
          shell !== null && supportsSnooze
            ? threadWokeAt(shell, { now: new Date().toISOString() })
            : null;
        if (wokeAt !== null) options.markThreadVisited(threadKey, wokeAt);
      },
      openFreshDraft: (projectRef, freshDraftOptions) =>
        options.openNewThread(projectRef, freshDraftOptions),
    };
    const sendInput: ComposerSendInput = {
      submissionIntent: "foreground",
      directAnnotation: undefined,
      environmentId,
      routeThreadKey: threadKey,
      draftId,
      draftThread,
      thread,
      threadKey,
      serverThread: isServerThread
        ? {
            modelSelection: thread.modelSelection,
            branch,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
          }
        : null,
      project:
        project === undefined
          ? null
          : {
              id: project.id,
              environmentId: project.environmentId,
              workspaceRoot: project.workspaceRoot,
            },
      projectDefaultModel: context.projectDefaultModelSelection?.model ?? null,
      isServerThread,
      isLocalDraftThread,
      isDraftHeroState: input.isDraftHeroState,
      isGitRepo,
      branch: activeThreadBranch,
      envMode: resolveSendEnvMode({ requestedEnvMode: envMode, isGitRepo }),
      startFromOrigin: composerEnv.startFromOrigin,
      localCheckoutBranch: mismatch?.currentBranch ?? null,
      runtimeMode: input.draft?.runtimeMode ?? thread.runtimeMode,
      phase: turn.phase,
      threadActivities: thread.activities,
      timelineHasUserMessage: thread.messages.some((message) => message.role === "user"),
      activeProposedPlan: turn.activeProposedPlan,
      showPlanFollowUpPrompt: turn.showPlanFollowUpPrompt,
      hasActivePendingProgress: turn.activePendingProgress !== null,
      usageLimitsCommandAvailable: false,
      composerHasNonPromptContent:
        (input.draft?.images.length ?? 0) +
          (input.draft?.files.length ?? 0) +
          (input.draft?.terminalContexts.length ?? 0) +
          (input.draft?.previewAnnotations.length ?? 0) +
          (input.draft?.reviewComments.length ?? 0) >
        0,
      isSendBusy: isSendBusy(input),
      isConnecting: false,
      isRevertingCheckpoint: store().rewindingThreadKeys.has(threadKey),
      clientSettingsHydrated: true,
      threadDetailLoading: false,
      loadBalancing: {
        needed: composerEnv.needsLoadBalancing,
        pending: composerEnv.loadBalancing.pending,
      },
      environmentUnavailable:
        input.environmentConnectionPhase !== null &&
        input.environmentConnectionPhase !== "connected",
      serverSupportsRequiredWorktreeBootstrap:
        input.serverConfig?.environment.capabilities.requiredWorktreeBootstrap === true,
      providerInstanceEntries: context.entries,
      supportsAttachmentUploads:
        input.serverConfig?.environment.capabilities.attachmentUploads === true,
      followUpBehavior: context.settings.followUpBehavior,
      planModeEnabled: context.settings.planModeEnabled,
    };
    return { sendInput, deps, handle, turn, context, sendState };
  };

  const send = (input: SendRuntimeInput): Promise<ComposerSendOutcome> => {
    const { sendInput, deps } = prepareSend(input);
    return sendComposerTurn(sendInput, deps);
  };

  const implementPlan = (input: SendRuntimeInput): Promise<void> => {
    const { sendInput, deps, handle, turn, context, sendState } = prepareSend(input);
    const { thread, project } = input;
    const environmentId = thread.environmentId;
    const commandOptions = { reportFailure: false };
    return implementPlanInNewThread(
      {
        thread: { id: thread.id, environmentId, worktreePath: thread.worktreePath ?? null },
        project,
        activeProposedPlan: turn.activeProposedPlan,
        isServerThread: sendInput.isServerThread,
        isSendBusy: sendInput.isSendBusy,
        isConnecting: sendInput.isConnecting,
        environmentUnavailable: sendInput.environmentUnavailable,
        environmentId,
        branch: thread.branch ?? null,
        defaultRuntimeMode: resolveProjectSettings(context.settings, thread.projectId).settings
          .defaultRuntimeMode,
      },
      {
        sendInFlight: sendState.sendInFlight,
        composer: () => handle,
        beginLocalDispatch: () =>
          deps.localDispatch.begin({ preparingWorktree: false, submissionIntent: "foreground" }),
        resetLocalDispatch: () => deps.localDispatch.reset(),
        createThread: (createInput) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.create,
            { environmentId, input: createInput },
            commandOptions,
          ),
        startTurn: (turnInput) => deps.commands.startTurn(turnInput),
        waitForStartedThread: (threadRef) =>
          waitForStartedServerThread(
            { registry, detailAtom: state.environmentThreadDetails.detailAtom },
            threadRef,
          ),
        navigateToThread: async (threadRef) => options.navigateToThread(threadRef),
        deleteThread: (deleteInput) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.delete,
            { environmentId, input: deleteInput },
            commandOptions,
          ),
        toastError: (title, description) => {
          addToast({ layout: "stacked", type: "error", title, description });
        },
      },
    );
  };

  return {
    localDispatchAtom,
    draftHeroDockedThreadKeyAtom,
    optimisticMessagesAtom,
    threadErrorsAtom,
    providerInputErrorsAtom,
    toastsAtom,
    isSendBusy,
    send,
    implementPlan,
    addToast,
    closeToast,
    runToastAction,
  };
}
