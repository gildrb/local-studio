import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { sanitizeThreadErrorMessage } from "@t3tools/client-runtime/errors";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  ApprovalRequestId,
  MessageId,
  ProviderApprovalDecision,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { isChatGptUsageLimitError } from "@t3tools/shared/usageLimits";
import { CHATGPT_USAGE_BUTTON } from "@t3tools/web/src/components/settings/ChatGptWelcomeCoordinator.logic.ts";
import {
  describePendingApproval,
  DEFAULT_APPROVAL_OPTIONS,
  splitApprovalOptions,
} from "@t3tools/web/src/components/chat/ComposerPendingApproval.logic.ts";
import {
  PLAN_WORKSPACE_UNAVAILABLE_TOAST,
  resolveInitialPlanSavePath,
  resolveProposedPlanCardModel,
  savePlanToWorkspace,
  type ProposedPlanToast,
} from "@t3tools/web/src/components/chat/ProposedPlanCard.logic.ts";
import {
  dismissThreadErrorBannerForSession,
  getThreadErrorBannerKey,
  resolveThreadError,
  resolveVisibleThreadError,
} from "@t3tools/web/src/components/chat/ThreadErrorBanner.logic.ts";
import {
  acceptsPendingUserInputCustomAnswer,
  applyPendingUserInputCustomAnswer,
  applyPendingUserInputOptionSelection,
  dismissPendingUserInput,
  PENDING_USER_INPUT_AUTO_ADVANCE_MS,
  pendingUserInputRequestKey,
  previousPendingUserInputQuestionIndex,
  reconcileOptimisticSingleSelect,
  resolvePendingUserInputAdvance,
  resolvePendingUserInputOptionRows,
  resolveRevertDialogDescription,
  resolveRevertPreflight,
  respondToPendingApproval,
  respondToPendingUserInput,
  revertToTurnCount,
  type OptimisticSingleSelect,
  type PendingUserInputAnswersByRequestKey,
} from "@t3tools/web/src/components/chat/threadInteractions.logic.ts";
import {
  carryDisplacedCustomAnswerIntoPrompt,
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
} from "@t3tools/web/src/pendingUserInput.ts";
import { derivePhase } from "@t3tools/web/src/session-logic.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  deriveComposerModelContext,
  deriveComposerTurnState,
  type ComposerPendingDraft,
} from "../composerView.ts";
import { proposedPlanTitle } from "@t3tools/web/src/proposedPlan.ts";
import type { CoreFeature, ThreadInput } from "../feature.ts";
import type { CoreState } from "../state.ts";
import type { TimelineExpansion } from "../timelineView.ts";
import type { ComposerSendToast } from "@t3tools/web/src/components/chat/composerSend.logic.ts";

const NOT_AVAILABLE_ATTACHMENTS = "Attachments are not available in the native app yet.";
const COPIED_RESET_MS = 2000;

const RespondToApprovalParams = Schema.decodeUnknownSync(
  Schema.Struct({ requestId: Schema.String, decision: ProviderApprovalDecision }),
);
const RequestIdParams = Schema.decodeUnknownSync(Schema.Struct({ requestId: Schema.String }));
const SelectOptionParams = Schema.decodeUnknownSync(
  Schema.Struct({ questionId: Schema.String, optionValue: Schema.String }),
);
const RevertParams = Schema.decodeUnknownSync(
  Schema.Struct({ turnCount: Schema.Number, messageId: Schema.String }),
);
const ConfirmRevertParams = Schema.decodeUnknownSync(
  Schema.Struct({ restoreFiles: Schema.Boolean }),
);
const MenuParams = Schema.decodeUnknownSync(Schema.Struct({ menu: Schema.NullOr(Schema.String) }));
const PlanIdParams = Schema.decodeUnknownSync(Schema.Struct({ planId: Schema.String }));
const SavePathParams = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));

export type ApprovalOptionView = {
  readonly decision: string;
  readonly label: string;
  readonly warning: string | null;
};

export type ThreadInteractionsDrawer =
  | {
      readonly kind: "approval";
      readonly requestId: string;
      readonly label: string;
      readonly appName: string | null;
      readonly detail: string;
      readonly detailFormat: "prose" | "code";
      readonly countLabel: string | null;
      readonly responding: boolean;
      readonly primaryOptions: ReadonlyArray<ApprovalOptionView & { readonly primary: boolean }>;
      readonly moreOptions: ReadonlyArray<ApprovalOptionView>;
    }
  | {
      readonly kind: "user-input";
      readonly requestId: string;
      readonly questionId: string;
      readonly header: string;
      readonly question: string;
      readonly multiSelect: boolean;
      readonly collapsed: boolean;
      readonly countLabel: string | null;
      readonly dismissible: boolean;
      readonly responding: boolean;
      readonly options: ReadonlyArray<{
        readonly value: string;
        readonly label: string;
        readonly description: string | null;
        readonly selected: boolean;
        readonly shortcutKey: number | null;
      }>;
    }
  | { readonly kind: "plan-follow-up"; readonly title: string | null };

export type ThreadInteractionsView = {
  readonly threadKey: string;
  readonly threadError: {
    readonly message: string;
    readonly usageButton: { readonly label: string; readonly url: string } | null;
  } | null;
  readonly drawer: ThreadInteractionsDrawer | null;
  readonly openMenu: string | null;
  readonly copiedPlanId: string | null;
  readonly pendingRevert: {
    readonly title: string;
    readonly description: string;
    readonly canRestoreFiles: boolean;
  } | null;
  readonly planSaveDialog: {
    readonly planId: string;
    readonly workspaceRoot: string;
    readonly path: string;
    readonly placeholder: string;
    readonly saving: boolean;
  } | null;
};

type PendingRevert = {
  readonly turnCount: number;
  readonly messageId: MessageId;
  readonly threadKey: string;
};

type PlanSaveDialog = {
  readonly planId: string;
  readonly threadKey: string;
  readonly path: string;
  readonly saving: boolean;
};

type CollapsedQuestion = { readonly requestKey: string; readonly questionId: string };

type StoredOptimistic = OptimisticSingleSelect & { readonly requestKey: string };

export type ThreadInteractionsOptions = {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: CoreState;
  readonly threadInputAtom: Atom.Atom<ThreadInput | null>;
  readonly threadErrorsAtom: Atom.Atom<Readonly<Record<string, string | null>>>;
  readonly setThreadError: (threadId: string, error: string | null) => void;
  readonly isSendBusy: (input: ThreadInput) => boolean;
  readonly sendBusyDependencies: (get: Atom.AtomContext) => void;
  readonly supportsConversationRollback: (input: ThreadInput) => boolean;
  readonly writePrompt: (route: ScopedThreadRef, prompt: string) => void;
  readonly bumpPromptRevision: () => void;
  readonly addToast: (toast: ComposerSendToast) => string;
  readonly expansionAtom: Atom.Writable<TimelineExpansion>;
  readonly implementPlanInNewThread: () => Promise<void>;
};

export type ThreadInteractions = {
  readonly feature: CoreFeature;
  readonly pendingDraft: (get: Atom.AtomContext, input: ThreadInput) => ComposerPendingDraft;
  readonly pendingUserInputResponding: (get: Atom.AtomContext, input: ThreadInput) => boolean;
  readonly setCustomAnswer: (input: ThreadInput, value: string) => boolean;
  readonly advancePendingUserInput: () => void;
};

function activeRequestKey(input: ThreadInput): string | null {
  const userInput = derivePendingRequests(input.thread.activities).userInputs[0];
  return userInput === undefined
    ? null
    : pendingUserInputRequestKey(input.thread.environmentId, input.thread.id, userInput.requestId);
}

export function createThreadInteractions(options: ThreadInteractionsOptions): ThreadInteractions {
  const { registry, state } = options;
  const answersAtom = Atom.make<PendingUserInputAnswersByRequestKey>({}).pipe(Atom.keepAlive);
  const questionIndexAtom = Atom.make<Readonly<Record<string, number>>>({}).pipe(Atom.keepAlive);
  const respondingApprovalIdsAtom = Atom.make<ReadonlyArray<ApprovalRequestId>>([]).pipe(
    Atom.keepAlive,
  );
  const respondingUserInputIdsAtom = Atom.make<ReadonlyArray<ApprovalRequestId>>([]).pipe(
    Atom.keepAlive,
  );
  const optimisticAtom = Atom.make<StoredOptimistic | null>(null).pipe(Atom.keepAlive);
  const collapsedAtom = Atom.make<CollapsedQuestion | null>(null).pipe(Atom.keepAlive);
  const openMenuAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const copiedPlanIdAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const pendingRevertAtom = Atom.make<PendingRevert | null>(null).pipe(Atom.keepAlive);
  const planSaveDialogAtom = Atom.make<PlanSaveDialog | null>(null).pipe(Atom.keepAlive);
  const errorDismissTickAtom = Atom.make(0).pipe(Atom.keepAlive);
  const userInputResponsesInFlight = new Set<string>();
  let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const currentInput = (action: string): ThreadInput => {
    const input = registry.get(options.threadInputAtom);
    if (input === null) throw new Error(`${action} needs an open thread`);
    return input;
  };

  const setThreadError = (threadId: string, error: string | null) =>
    options.setThreadError(threadId, sanitizeThreadErrorMessage(error));

  const updateIds = (
    atom: Atom.Writable<ReadonlyArray<ApprovalRequestId>>,
    requestId: ApprovalRequestId,
    responding: boolean,
  ) => {
    const existing = registry.get(atom);
    registry.set(
      atom,
      responding
        ? existing.includes(requestId)
          ? existing
          : [...existing, requestId]
        : existing.filter((id) => id !== requestId),
    );
  };

  const pendingState = (input: ThreadInput) => {
    const { approvals, userInputs } = derivePendingRequests(input.thread.activities);
    const userInput = userInputs[0] ?? null;
    const requestKey = pendingUserInputRequestKey(
      input.thread.environmentId,
      input.thread.id,
      userInput?.requestId,
    );
    const answers = registry.get(answersAtom)[requestKey] ?? {};
    const questionIndex = registry.get(questionIndexAtom)[requestKey] ?? 0;
    const progress = userInput
      ? derivePendingUserInputProgress(userInput.questions, answers, questionIndex)
      : null;
    return { approvals, userInputs, userInput, requestKey, answers, progress };
  };

  const reconcileOptimistic = () => {
    const stored = registry.get(optimisticAtom);
    if (stored === null) return;
    const input = registry.get(options.threadInputAtom);
    const pending = input === null ? null : pendingState(input);
    if (pending === null || pending.requestKey !== stored.requestKey || pending.progress === null) {
      registry.set(optimisticAtom, null);
      return;
    }
    const next = reconcileOptimisticSingleSelect(
      stored,
      pending.progress.activeQuestion,
      pending.progress,
    );
    if (next !== stored) registry.set(optimisticAtom, next === null ? null : stored);
  };

  const setQuestionIndex = (requestKey: string, index: number) => {
    registry.set(questionIndexAtom, { ...registry.get(questionIndexAtom), [requestKey]: index });
    reconcileOptimistic();
  };

  const respondToUserInput = async (
    input: ThreadInput,
    requestId: ApprovalRequestId,
    answers: Record<string, unknown>,
  ) => {
    const isResponding = registry.get(respondingUserInputIdsAtom).includes(requestId);
    await respondToPendingUserInput(
      {
        environmentId: input.thread.environmentId,
        threadId: input.thread.id,
        hasActivePendingUserInput: pendingState(input).userInput !== null,
        isResponding,
        requestId,
        answers,
      },
      {
        inFlight: userInputResponsesInFlight,
        resolveAttachments: () => ({ _tag: "ready", attachmentsByQuestionId: null }),
        setResponding: (id, responding) => updateIds(respondingUserInputIdsAtom, id, responding),
        respond: (commandInput) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.respondToUserInput,
            { environmentId: input.thread.environmentId, input: commandInput },
            { reportFailure: false },
          ),
        setThreadError,
      },
    );
  };

  const advancePendingUserInput = () => {
    const input = registry.get(options.threadInputAtom);
    if (input === null) return;
    const pending = pendingState(input);
    const isResponding =
      pending.userInput !== null &&
      registry.get(respondingUserInputIdsAtom).includes(pending.userInput.requestId);
    const advance = resolvePendingUserInputAdvance({
      hasActivePendingUserInput: pending.userInput !== null,
      progress: pending.progress,
      isResponding,
      resolvedAnswers: pending.userInput
        ? buildPendingUserInputAnswers(pending.userInput.questions, pending.answers)
        : null,
    });
    if (advance._tag === "submit" && pending.userInput) {
      void respondToUserInput(input, pending.userInput.requestId, advance.answers);
      return;
    }
    if (advance._tag === "next") setQuestionIndex(pending.requestKey, advance.questionIndex);
  };

  const setCustomAnswer = (input: ThreadInput, value: string): boolean => {
    const pending = pendingState(input);
    if (pending.approvals.length > 0) return true;
    const questionId = pending.progress?.activeQuestion?.id;
    if (pending.userInput === null || questionId === undefined) return false;
    if (acceptsPendingUserInputCustomAnswer(pending.userInput.questions, questionId)) {
      registry.set(
        answersAtom,
        applyPendingUserInputCustomAnswer(registry.get(answersAtom), {
          requestKey: pending.requestKey,
          questionId,
          value,
        }),
      );
      reconcileOptimistic();
    }
    return true;
  };

  const selectOption = (questionId: string, optionValue: string) => {
    const input = currentInput("selectPendingUserInputOption");
    const pending = pendingState(input);
    const { userInput, progress } = pending;
    if (userInput === null) return;
    if (registry.get(respondingUserInputIdsAtom).includes(userInput.requestId)) return;
    const multiSelect = progress?.activeQuestion?.multiSelect === true;
    if (!multiSelect) {
      registry.set(optimisticAtom, { requestKey: pending.requestKey, questionId, optionValue });
    }
    const displacedAnswer = pending.answers[questionId]?.customAnswer;
    const currentPrompt =
      useComposerDraftStore.getState().getComposerDraft(input.route)?.prompt ?? "";
    const nextPrompt = carryDisplacedCustomAnswerIntoPrompt(currentPrompt, displacedAnswer);
    if (nextPrompt !== currentPrompt) {
      useComposerDraftStore.getState().setPrompt(input.route, nextPrompt);
    }
    registry.set(
      answersAtom,
      applyPendingUserInputOptionSelection(registry.get(answersAtom), {
        requestKey: pending.requestKey,
        questions: userInput.questions,
        activeQuestion: progress?.activeQuestion,
        questionId,
        optionValue,
      }),
    );
    options.bumpPromptRevision();
    reconcileOptimistic();
    if (multiSelect) return;
    clearTimeout(autoAdvanceTimer ?? undefined);
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      advancePendingUserInput();
    }, PENDING_USER_INPUT_AUTO_ADVANCE_MS);
  };

  const environmentUnavailableLabel = (input: ThreadInput): string | null => {
    const presentation = registry
      .get(state.environmentPresentations.presentationsAtom)
      .get(input.thread.environmentId);
    if (presentation === undefined) return null;
    const environment = projectEnvironmentPresentation(input.thread.environmentId, presentation);
    return environment.connection.phase !== "connected" ? environment.label : null;
  };

  const runRevert = async (
    input: ThreadInput,
    turnCount: number,
    messageId: MessageId,
    restoreFiles: boolean | undefined,
  ) => {
    const threadKey = scopedThreadKey(input.route);
    const preflight = resolveRevertPreflight({
      canRevert: true,
      messages: input.thread.messages,
      isRevertingCheckpoint: useComposerDraftStore.getState().rewindingThreadKeys.has(threadKey),
      messageId,
      restoreFiles,
      supportsConversationRollback: options.supportsConversationRollback(input),
      environmentUnavailableLabel: environmentUnavailableLabel(input),
      phase: derivePhase(input.thread.session ?? null),
      isSendBusy: options.isSendBusy(input),
      isConnecting: false,
    });
    if (preflight._tag === "ignore") return;
    if (preflight._tag === "error") {
      setThreadError(input.thread.id, preflight.message);
      return;
    }
    if (preflight._tag === "confirm") {
      registry.set(pendingRevertAtom, { turnCount, messageId, threadKey });
      return;
    }
    const store = () => useComposerDraftStore.getState();
    await revertToTurnCount(
      {
        threadRef: input.route,
        threadId: input.thread.id,
        turnCount,
        message: preflight.message,
        restoreFiles: preflight.restoreFiles,
      },
      {
        setThreadError: (error) => setThreadError(input.thread.id, error),
        setRewinding: (rewinding) =>
          useComposerDraftStore.setState((current) => {
            const next = new Set(current.rewindingThreadKeys);
            if (rewinding) next.add(threadKey);
            else next.delete(threadKey);
            return { rewindingThreadKeys: next };
          }),
        hasPendingAttachments: () => false,
        prepareAttachments: async (message) => {
          if ((message.attachments?.length ?? 0) > 0) throw new Error(NOT_AVAILABLE_ATTACHMENTS);
          return [];
        },
        readDraftAttachmentCount: () => {
          const draft = store().getComposerDraft(input.route);
          return (draft?.images.length ?? 0) + (draft?.files.length ?? 0);
        },
        source: { registry, detailAtom: state.environmentThreadDetails.detailAtom },
        revertCheckpoint: (commandInput) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.revertCheckpoint,
            { environmentId: input.thread.environmentId, input: commandInput },
            { reportFailure: false },
          ),
        readPrompt: () => store().getComposerDraft(input.route)?.prompt ?? "",
        writePrompt: (prompt) => options.writePrompt(input.route, prompt),
        restoreAttachments: () => {},
        afterRestore: () => {},
      },
    );
  };

  const toast = (value: ProposedPlanToast) =>
    options.addToast({
      layout: value.layout,
      type: value.type,
      title: value.title,
      ...(value.description === undefined ? {} : { description: value.description }),
    });

  const planWorkspaceRoot = (input: ThreadInput): string | undefined =>
    input.thread.worktreePath ?? input.project?.workspaceRoot;

  const findPlan = (input: ThreadInput, planId: string) => {
    const plan = input.thread.proposedPlans.find((candidate) => candidate.id === planId);
    if (plan === undefined) throw new Error(`Unknown plan ${planId}`);
    return plan;
  };

  const viewAtom = Atom.make((get): ThreadInteractionsView | null => {
    const input = get(options.threadInputAtom);
    if (input === null) return null;
    options.sendBusyDependencies(get);
    get(errorDismissTickAtom);
    const answersByKey = get(answersAtom);
    const questionIndexByKey = get(questionIndexAtom);
    const respondingApprovals = get(respondingApprovalIdsAtom);
    const respondingUserInputs = get(respondingUserInputIdsAtom);
    const threadKey = scopedThreadKey(input.route);
    const threadError = resolveThreadError({
      isServerThread: input.isServerThread,
      localServerError: get(options.threadErrorsAtom)[input.thread.id] ?? null,
      sessionLastError: input.thread.session?.lastError,
      localDraftError: get(options.threadErrorsAtom)[input.thread.id] ?? null,
    });
    const visibleError = resolveVisibleThreadError(threadKey, threadError);
    const { approvals, userInputs } = derivePendingRequests(input.thread.activities);
    let drawer: ThreadInteractionsDrawer | null = null;
    const approval = approvals[0];
    const userInput = userInputs[0];
    if (approval !== undefined) {
      const copy = describePendingApproval(approval.requestKind);
      const { primaryOptions, moreOptions } = splitApprovalOptions(
        approval.options ?? DEFAULT_APPROVAL_OPTIONS,
      );
      const optionView = (option: (typeof primaryOptions)[number]): ApprovalOptionView => ({
        decision: option.decision,
        label: option.label,
        warning: option.warning ?? null,
      });
      drawer = {
        kind: "approval",
        requestId: approval.requestId,
        label: copy.label,
        appName: approval.appName ?? null,
        detail: approval.detail || copy.label,
        detailFormat: copy.detailFormat,
        countLabel: approvals.length > 1 ? `1/${approvals.length}` : null,
        responding: respondingApprovals.includes(approval.requestId),
        primaryOptions: primaryOptions.map((option) => ({
          ...optionView(option),
          primary: option.decision === "accept",
        })),
        moreOptions: moreOptions.map(optionView),
      };
    } else if (userInput !== undefined) {
      const requestKey = pendingUserInputRequestKey(
        input.thread.environmentId,
        input.thread.id,
        userInput.requestId,
      );
      const questionIndex = questionIndexByKey[requestKey] ?? 0;
      const progress = derivePendingUserInputProgress(
        userInput.questions,
        answersByKey[requestKey] ?? {},
        questionIndex,
      );
      const question = progress.activeQuestion;
      const stored = get(optimisticAtom);
      const collapsed = get(collapsedAtom);
      if (question !== null) {
        drawer = {
          kind: "user-input",
          requestId: userInput.requestId,
          questionId: question.id,
          header: question.header,
          question: question.question,
          multiSelect: question.multiSelect === true,
          collapsed: collapsed?.requestKey === requestKey && collapsed.questionId === question.id,
          countLabel:
            userInput.questions.length > 1
              ? `${questionIndex + 1}/${userInput.questions.length}`
              : null,
          dismissible: userInput.dismissible === true,
          responding: respondingUserInputs.includes(userInput.requestId),
          options: resolvePendingUserInputOptionRows({
            question,
            progress,
            optimistic: stored?.requestKey === requestKey ? stored : null,
          }),
        };
      }
    } else {
      const { activeProposedPlan, showPlanFollowUpPrompt } = deriveComposerTurnState(
        input.thread,
        input.draft,
        deriveComposerModelContext(input).interactionMode,
      );
      if (showPlanFollowUpPrompt && activeProposedPlan !== null) {
        drawer = {
          kind: "plan-follow-up",
          title: proposedPlanTitle(activeProposedPlan.planMarkdown),
        };
      }
    }
    const pendingRevert = get(pendingRevertAtom);
    const saveDialog = get(planSaveDialogAtom);
    const workspaceRoot = planWorkspaceRoot(input);
    return {
      threadKey,
      threadError:
        visibleError === null
          ? null
          : {
              message: visibleError,
              usageButton: isChatGptUsageLimitError(input.thread.activities, visibleError)
                ? { label: CHATGPT_USAGE_BUTTON.label, url: CHATGPT_USAGE_BUTTON.url }
                : null,
            },
      drawer,
      openMenu: get(openMenuAtom),
      copiedPlanId: get(copiedPlanIdAtom),
      pendingRevert:
        pendingRevert === null || pendingRevert.threadKey !== threadKey
          ? null
          : {
              title: "Edit from here?",
              description: resolveRevertDialogDescription(input.thread.worktreePath ?? null),
              canRestoreFiles: (input.thread.worktreePath ?? null) !== null,
            },
      planSaveDialog:
        saveDialog === null || saveDialog.threadKey !== threadKey || workspaceRoot === undefined
          ? null
          : {
              planId: saveDialog.planId,
              workspaceRoot,
              path: saveDialog.path,
              placeholder: resolveProposedPlanCardModel(
                input.thread.proposedPlans.find((plan) => plan.id === saveDialog.planId)
                  ?.planMarkdown ?? "",
              ).downloadFilename,
              saving: saveDialog.saving,
            },
    };
  });

  const actions: CoreFeature["actions"] = {
    respondToApproval: async (params) => {
      const { requestId, decision } = RespondToApprovalParams(params);
      const input = currentInput("respondToApproval");
      registry.set(openMenuAtom, null);
      await respondToPendingApproval(
        { threadId: input.thread.id, requestId: ApprovalRequestId.make(requestId), decision },
        {
          setResponding: (id, responding) => updateIds(respondingApprovalIdsAtom, id, responding),
          respond: (commandInput) =>
            runAtomCommand(
              registry,
              state.threadEnvironment.respondToApproval,
              { environmentId: input.thread.environmentId, input: commandInput },
              { reportFailure: false },
            ),
          setThreadError,
        },
      );
      return null;
    },
    selectPendingUserInputOption: async (params) => {
      const { questionId, optionValue } = SelectOptionParams(params);
      selectOption(questionId, optionValue);
      return null;
    },
    advancePendingUserInput: async () => {
      advancePendingUserInput();
      return null;
    },
    previousPendingUserInputQuestion: async () => {
      const pending = pendingState(currentInput("previousPendingUserInputQuestion"));
      if (pending.userInput === null || pending.progress === null) return null;
      setQuestionIndex(pending.requestKey, previousPendingUserInputQuestionIndex(pending.progress));
      return null;
    },
    togglePendingUserInputCollapsed: async () => {
      const pending = pendingState(currentInput("togglePendingUserInputCollapsed"));
      const questionId = pending.progress?.activeQuestion?.id;
      if (questionId === undefined) return null;
      const collapsed = registry.get(collapsedAtom);
      const isCollapsed =
        collapsed?.requestKey === pending.requestKey && collapsed.questionId === questionId;
      registry.set(
        collapsedAtom,
        isCollapsed ? null : { requestKey: pending.requestKey, questionId },
      );
      return null;
    },
    dismissPendingUserInput: async (params) => {
      const { requestId } = RequestIdParams(params);
      const input = currentInput("dismissPendingUserInput");
      await dismissPendingUserInput(
        { threadId: input.thread.id, requestId: ApprovalRequestId.make(requestId) },
        {
          setResponding: (id, responding) => updateIds(respondingUserInputIdsAtom, id, responding),
          dismiss: (commandInput) =>
            runAtomCommand(
              registry,
              state.threadEnvironment.dismissUserInput,
              { environmentId: input.thread.environmentId, input: commandInput },
              { reportFailure: false },
            ),
          setThreadError,
        },
      );
      return null;
    },
    setInteractionMenu: async (params) => {
      registry.set(openMenuAtom, MenuParams(params).menu);
      return null;
    },
    implementPlanInNewThread: async () => {
      registry.set(openMenuAtom, null);
      await options.implementPlanInNewThread();
      return null;
    },
    revertToTurnCount: async (params) => {
      const { turnCount, messageId } = RevertParams(params);
      await runRevert(
        currentInput("revertToTurnCount"),
        turnCount,
        MessageId.make(messageId),
        undefined,
      );
      return null;
    },
    confirmRevert: async (params) => {
      const { restoreFiles } = ConfirmRevertParams(params);
      const input = currentInput("confirmRevert");
      const pending = registry.get(pendingRevertAtom);
      if (pending === null || pending.threadKey !== scopedThreadKey(input.route)) return null;
      registry.set(pendingRevertAtom, null);
      await runRevert(input, pending.turnCount, pending.messageId, restoreFiles);
      return null;
    },
    cancelRevert: async () => {
      registry.set(pendingRevertAtom, null);
      return null;
    },
    dismissThreadError: async () => {
      const input = currentInput("dismissThreadError");
      const threadKey = scopedThreadKey(input.route);
      const threadError = resolveThreadError({
        isServerThread: input.isServerThread,
        localServerError: registry.get(options.threadErrorsAtom)[input.thread.id] ?? null,
        sessionLastError: input.thread.session?.lastError,
        localDraftError: registry.get(options.threadErrorsAtom)[input.thread.id] ?? null,
      });
      setThreadError(input.thread.id, null);
      dismissThreadErrorBannerForSession(getThreadErrorBannerKey(threadKey, threadError));
      registry.set(errorDismissTickAtom, registry.get(errorDismissTickAtom) + 1);
      return null;
    },
    togglePlanExpanded: async (params) => {
      const { planId } = PlanIdParams(params);
      const current = registry.get(options.expansionAtom);
      const planIds = new Set(current.planIds);
      if (!planIds.delete(planId)) planIds.add(planId);
      registry.set(options.expansionAtom, { ...current, planIds });
      return null;
    },
    markPlanCopied: async (params) => {
      const { planId } = PlanIdParams(params);
      registry.set(openMenuAtom, null);
      registry.set(copiedPlanIdAtom, planId);
      clearTimeout(copiedTimer ?? undefined);
      copiedTimer = setTimeout(() => {
        copiedTimer = null;
        registry.set(copiedPlanIdAtom, null);
      }, COPIED_RESET_MS);
      return null;
    },
    openPlanSaveDialog: async (params) => {
      const { planId } = PlanIdParams(params);
      const input = currentInput("openPlanSaveDialog");
      registry.set(openMenuAtom, null);
      if (!planWorkspaceRoot(input)) {
        toast(PLAN_WORKSPACE_UNAVAILABLE_TOAST);
        return null;
      }
      const { downloadFilename } = resolveProposedPlanCardModel(
        findPlan(input, planId).planMarkdown,
      );
      const existing = registry.get(planSaveDialogAtom);
      registry.set(planSaveDialogAtom, {
        planId,
        threadKey: scopedThreadKey(input.route),
        path: resolveInitialPlanSavePath(
          existing?.planId === planId ? existing.path : "",
          downloadFilename,
        ),
        saving: false,
      });
      return null;
    },
    setPlanSavePath: async (params) => {
      const { path } = SavePathParams(params);
      const dialog = registry.get(planSaveDialogAtom);
      if (dialog !== null) registry.set(planSaveDialogAtom, { ...dialog, path });
      return null;
    },
    closePlanSaveDialog: async () => {
      const dialog = registry.get(planSaveDialogAtom);
      if (dialog !== null && !dialog.saving) registry.set(planSaveDialogAtom, null);
      return null;
    },
    savePlanToWorkspace: async () => {
      const dialog = registry.get(planSaveDialogAtom);
      const input = currentInput("savePlanToWorkspace");
      if (dialog === null) return null;
      const plan = findPlan(input, dialog.planId);
      const updateDialog = (update: (current: PlanSaveDialog) => PlanSaveDialog | null) => {
        const current = registry.get(planSaveDialogAtom);
        if (current !== null && current.planId === dialog.planId) {
          registry.set(planSaveDialogAtom, update(current));
        }
      };
      await savePlanToWorkspace(
        {
          environmentId: input.thread.environmentId,
          workspaceRoot: planWorkspaceRoot(input),
          savePath: dialog.path,
          contents: resolveProposedPlanCardModel(plan.planMarkdown).saveContents,
        },
        {
          setSaving: (saving) => updateDialog((current) => ({ ...current, saving })),
          writeFile: (command) =>
            runAtomCommand(registry, state.projectEnvironment.writeFile, command, {
              reportFailure: false,
            }),
          onSaved: () => updateDialog(() => null),
          toast,
        },
      );
      return null;
    },
  };

  const promptSourceAtom = Atom.make((get): string | null => {
    const input = get(options.threadInputAtom);
    if (input === null) return null;
    const { approvals, userInputs } = derivePendingRequests(input.thread.activities);
    const approval = approvals[0];
    if (approval !== undefined) return `approval:${approval.requestId}`;
    const userInput = userInputs[0];
    if (userInput === undefined) return `draft:${scopedThreadKey(input.route)}`;
    const requestKey = pendingUserInputRequestKey(
      input.thread.environmentId,
      input.thread.id,
      userInput.requestId,
    );
    return `question:${requestKey}:${get(questionIndexAtom)[requestKey] ?? 0}`;
  });
  let promptSource: string | null = null;
  registry.subscribe(
    promptSourceAtom,
    (source) => {
      if (source === promptSource) return;
      const changedWithinThread = promptSource !== null && source !== null;
      promptSource = source;
      if (changedWithinThread) options.bumpPromptRevision();
    },
    { immediate: true },
  );

  return {
    feature: { views: { threadInteractions: viewAtom }, actions },
    pendingDraft: (get, input) => {
      const requestKey = activeRequestKey(input);
      if (requestKey === null) return { answers: {}, questionIndex: 0 };
      return {
        answers: get(answersAtom)[requestKey] ?? {},
        questionIndex: get(questionIndexAtom)[requestKey] ?? 0,
      };
    },
    pendingUserInputResponding: (get, input) => {
      const userInput = derivePendingRequests(input.thread.activities).userInputs[0];
      return (
        userInput !== undefined && get(respondingUserInputIdsAtom).includes(userInput.requestId)
      );
    },
    setCustomAnswer,
    advancePendingUserInput,
  };
}
