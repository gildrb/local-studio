import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  CreateThreadInput,
  DeleteThreadInput,
  DismissThreadUserInputInput,
  RespondToThreadApprovalInput,
  RespondToThreadUserInputInput,
  RevertThreadCheckpointInput,
  StartThreadTurnInput,
} from "@t3tools/client-runtime/state/threads";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import type {
  ApprovalRequestId,
  EnvironmentId,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedThreadRef,
  ThreadId,
  UserInputAttachments,
  UserInputQuestion,
} from "@t3tools/contracts";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { truncate } from "@t3tools/shared/String";

import { newMessageId, newThreadId } from "../../lib/utils";
import {
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
  type PendingUserInputProgress,
} from "../../pendingUserInput";
import {
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
} from "../../proposedPlan";
import type { ChatMessage, SessionPhase } from "../../types";
import { waitForRevertedMessage, type ThreadDetailSource } from "../ChatView.logic";
import {
  formatOutgoingPrompt,
  type ComposerSendHandle,
  type MutableBox,
  type PlanFollowUpSubmission,
  type ThreadNextTurnSettingsInput,
} from "./composerSend.logic";
import { recallableComposerPrompt } from "./composerPromptHistory";

type CommandResult = AtomCommandResult<unknown, unknown>;

export type SetThreadError = (threadId: ThreadId, error: string | null) => void;

function failureMessage(result: CommandResult, fallback: string): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
}

export interface RespondToPendingApprovalDeps<R extends CommandResult> {
  readonly setResponding: (requestId: ApprovalRequestId, responding: boolean) => void;
  readonly respond: (input: RespondToThreadApprovalInput) => Promise<R>;
  readonly setThreadError: SetThreadError;
}

export async function respondToPendingApproval<R extends CommandResult>(
  input: {
    readonly threadId: ThreadId | null;
    readonly requestId: ApprovalRequestId;
    readonly decision: ProviderApprovalDecision;
  },
  deps: RespondToPendingApprovalDeps<R>,
): Promise<R | undefined> {
  const { threadId, requestId, decision } = input;
  if (!threadId) return undefined;
  deps.setResponding(requestId, true);
  const result = await deps.respond({ threadId, requestId, decision });
  const error = failureMessage(result, "Failed to submit approval decision.");
  if (error !== null) deps.setThreadError(threadId, error);
  deps.setResponding(requestId, false);
  return result;
}

export type PendingUserInputAttachmentResolution =
  | { readonly _tag: "ready"; readonly attachmentsByQuestionId: UserInputAttachments | null }
  | { readonly _tag: "wait" }
  | { readonly _tag: "error"; readonly message: string };

export interface RespondToPendingUserInputDeps<R extends CommandResult> {
  readonly inFlight: Set<string>;
  readonly resolveAttachments: () => PendingUserInputAttachmentResolution;
  readonly setResponding: (requestId: ApprovalRequestId, responding: boolean) => void;
  readonly respond: (input: RespondToThreadUserInputInput) => Promise<R>;
  readonly setThreadError: SetThreadError;
}

export async function respondToPendingUserInput<R extends CommandResult>(
  input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId | null;
    readonly hasActivePendingUserInput: boolean;
    readonly isResponding: boolean;
    readonly requestId: ApprovalRequestId;
    readonly answers: Record<string, unknown>;
  },
  deps: RespondToPendingUserInputDeps<R>,
): Promise<R | undefined> {
  const { threadId, requestId } = input;
  if (!threadId || !input.hasActivePendingUserInput || input.isResponding) return undefined;
  const responseKey = JSON.stringify([input.environmentId, threadId, requestId]);
  if (deps.inFlight.has(responseKey)) return undefined;
  const attachments = deps.resolveAttachments();
  if (attachments._tag === "wait") return undefined;
  if (attachments._tag === "error") {
    deps.setThreadError(threadId, attachments.message);
    return undefined;
  }
  deps.inFlight.add(responseKey);
  deps.setResponding(requestId, true);
  const result = await deps.respond({
    threadId,
    requestId,
    answers: input.answers,
    ...(attachments.attachmentsByQuestionId !== null
      ? { attachmentsByQuestionId: attachments.attachmentsByQuestionId }
      : {}),
  });
  const error = failureMessage(result, "Failed to submit user input.");
  if (error !== null) deps.setThreadError(threadId, error);
  deps.inFlight.delete(responseKey);
  deps.setResponding(requestId, false);
  return result;
}

export async function dismissPendingUserInput<R extends CommandResult>(
  input: { readonly threadId: ThreadId | null; readonly requestId: ApprovalRequestId },
  deps: {
    readonly setResponding: (requestId: ApprovalRequestId, responding: boolean) => void;
    readonly dismiss: (input: DismissThreadUserInputInput) => Promise<R>;
    readonly setThreadError: SetThreadError;
  },
): Promise<R | undefined> {
  const { threadId, requestId } = input;
  if (!threadId) return undefined;
  deps.setResponding(requestId, true);
  const result = await deps.dismiss({ threadId, requestId });
  const error = failureMessage(result, "Failed to dismiss the question.");
  if (error !== null) deps.setThreadError(threadId, error);
  deps.setResponding(requestId, false);
  return result;
}

export type PendingUserInputAnswersByRequestKey = Record<
  string,
  Record<string, PendingUserInputDraftAnswer>
>;

export function pendingUserInputRequestKey(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  requestId: ApprovalRequestId | undefined,
): string {
  return JSON.stringify([environmentId, threadId, requestId]);
}

export function applyPendingUserInputOptionSelection(
  existing: PendingUserInputAnswersByRequestKey,
  input: {
    readonly requestKey: string;
    readonly questions: ReadonlyArray<UserInputQuestion>;
    readonly activeQuestion: UserInputQuestion | null | undefined;
    readonly questionId: string;
    readonly optionValue: string;
  },
): PendingUserInputAnswersByRequestKey {
  const question =
    (input.activeQuestion?.id === input.questionId ? input.activeQuestion : undefined) ??
    input.questions.find((entry) => entry.id === input.questionId);
  if (!question) {
    return existing;
  }
  return {
    ...existing,
    [input.requestKey]: {
      ...existing[input.requestKey],
      [input.questionId]: togglePendingUserInputOptionSelection(
        question,
        existing[input.requestKey]?.[input.questionId],
        input.optionValue,
      ),
    },
  };
}

export function applyPendingUserInputCustomAnswer(
  existing: PendingUserInputAnswersByRequestKey,
  input: { readonly requestKey: string; readonly questionId: string; readonly value: string },
): PendingUserInputAnswersByRequestKey {
  return {
    ...existing,
    [input.requestKey]: {
      ...existing[input.requestKey],
      [input.questionId]: setPendingUserInputCustomAnswer(
        existing[input.requestKey]?.[input.questionId],
        input.value,
      ),
    },
  };
}

export function acceptsPendingUserInputCustomAnswer(
  questions: ReadonlyArray<UserInputQuestion>,
  questionId: string,
): boolean {
  const question = questions.find((entry) => entry.id === questionId);
  return question !== undefined && question.allowCustomAnswer !== false;
}

export type PendingUserInputAdvance =
  | { readonly _tag: "none" }
  | { readonly _tag: "submit"; readonly answers: Record<string, string | string[]> }
  | { readonly _tag: "next"; readonly questionIndex: number };

export function resolvePendingUserInputAdvance(input: {
  readonly hasActivePendingUserInput: boolean;
  readonly progress: PendingUserInputProgress | null;
  readonly isResponding: boolean;
  readonly resolvedAnswers: Record<string, string | string[]> | null;
}): PendingUserInputAdvance {
  const { progress } = input;
  if (!input.hasActivePendingUserInput || !progress || !progress.canAdvance || input.isResponding) {
    return { _tag: "none" };
  }
  if (progress.isLastQuestion) {
    return input.resolvedAnswers
      ? { _tag: "submit", answers: input.resolvedAnswers }
      : { _tag: "none" };
  }
  return { _tag: "next", questionIndex: progress.questionIndex + 1 };
}

export function previousPendingUserInputQuestionIndex(progress: PendingUserInputProgress): number {
  return Math.max(progress.questionIndex - 1, 0);
}

export interface OptimisticSingleSelect {
  readonly questionId: string;
  readonly optionValue: string;
}

export function reconcileOptimisticSingleSelect(
  optimistic: OptimisticSingleSelect | null,
  activeQuestion: UserInputQuestion | null,
  progress: Pick<PendingUserInputProgress, "customAnswer" | "selectedOptionValues">,
): OptimisticSingleSelect | null {
  if (!activeQuestion || activeQuestion.multiSelect || !optimistic) {
    return optimistic;
  }
  if (optimistic.questionId !== activeQuestion.id) {
    return null;
  }
  if (
    progress.customAnswer.trim().length === 0 &&
    progress.selectedOptionValues.includes(optimistic.optionValue)
  ) {
    return null;
  }
  return optimistic;
}

export interface PendingUserInputOptionRow {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;
  readonly selected: boolean;
  readonly shortcutKey: number | null;
}

export function resolvePendingUserInputOptionRows(input: {
  readonly question: UserInputQuestion;
  readonly progress: Pick<PendingUserInputProgress, "customAnswer" | "selectedOptionValues">;
  readonly optimistic: OptimisticSingleSelect | null;
}): PendingUserInputOptionRow[] {
  const { question, progress, optimistic } = input;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  return question.options.map((option, index) => {
    const value = option.value ?? option.label;
    const optimisticallySelected =
      optimistic?.questionId === question.id && optimistic.optionValue === value;
    return {
      value,
      label: option.label,
      description:
        option.description && option.description !== option.label ? option.description : null,
      selected:
        optimisticallySelected ||
        (!customAnswerActive && progress.selectedOptionValues.includes(value)),
      shortcutKey: index < 9 ? index + 1 : null,
    };
  });
}

export const PENDING_USER_INPUT_AUTO_ADVANCE_MS = 200;

export function formatPendingPrimaryActionLabel(input: {
  readonly compact: boolean;
  readonly isLastQuestion: boolean;
  readonly isResponding: boolean;
  readonly questionIndex: number;
}): string {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
}

export function isPendingPrimaryActionDisabled(input: {
  readonly isEnvironmentUnavailable: boolean;
  readonly isResponding: boolean;
  readonly isLastQuestion: boolean;
  readonly isComplete: boolean;
  readonly canAdvance: boolean;
}): boolean {
  return (
    input.isEnvironmentUnavailable ||
    input.isResponding ||
    (input.isLastQuestion ? !input.isComplete : !input.canAdvance)
  );
}

export function resolvePlanFollowUpPrimaryAction(input: {
  readonly promptHasText: boolean;
  readonly isSendBusy: boolean;
  readonly isSendDisabled: boolean;
  readonly isConnecting: boolean;
  readonly isEnvironmentUnavailable: boolean;
}): { readonly kind: "refine" | "implement"; readonly label: string; readonly disabled: boolean } {
  const busy = input.isConnecting || input.isSendBusy;
  const disabled =
    input.isSendBusy ||
    input.isSendDisabled ||
    input.isConnecting ||
    input.isEnvironmentUnavailable;
  return input.promptHasText
    ? { kind: "refine", label: busy ? "Sending..." : "Refine", disabled }
    : { kind: "implement", label: busy ? "Sending..." : "Implement", disabled };
}

export interface PlanFollowUpInput {
  readonly submission: PlanFollowUpSubmission;
  readonly thread:
    | { readonly id: ThreadId; readonly environmentId: EnvironmentId; readonly title: string }
    | undefined;
  readonly isServerThread: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly environmentId: EnvironmentId;
  readonly routeThreadKey: string;
  readonly runtimeMode: RuntimeMode;
  readonly localCheckoutBranch: string | null;
  readonly activeProposedPlan: { readonly id: string } | null;
}

export interface PlanFollowUpDeps {
  readonly sendInFlight: MutableBox<boolean>;
  readonly composer: () => ComposerSendHandle | null;
  readonly beginLocalDispatch: () => void;
  readonly resetLocalDispatch: () => void;
  readonly setThreadError: SetThreadError;
  readonly scrollToEnd: () => void;
  readonly setOptimisticUserMessages: (update: (existing: ChatMessage[]) => ChatMessage[]) => void;
  readonly persistThreadSettings: (
    input: ThreadNextTurnSettingsInput,
  ) => Promise<AtomCommandResult<void, unknown>>;
  readonly setInteractionMode: (threadRef: ScopedThreadRef, mode: ProviderInteractionMode) => void;
  readonly startTurn: (input: StartThreadTurnInput) => Promise<CommandResult>;
  readonly supportsInlineMessageContext: () => boolean;
  readonly clearUsageLimitsFor: (threadKey: string) => void;
  readonly acknowledgeThreadWoke: () => void;
}

export async function submitPlanFollowUp(
  input: PlanFollowUpInput,
  deps: PlanFollowUpDeps,
): Promise<boolean> {
  const { thread, submission } = input;
  const { context, interactionMode: nextInteractionMode } = submission;
  if (
    !thread ||
    !input.isServerThread ||
    input.isSendBusy ||
    input.isConnecting ||
    deps.sendInFlight.current
  ) {
    return false;
  }

  const trimmed = submission.text.trim();
  if (!trimmed) {
    return false;
  }

  const sendCtx = deps.composer()?.getSendContext();
  if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
    return false;
  }

  const threadIdForSend = thread.id;
  const messageIdForSend = newMessageId();
  const messageCreatedAt = new Date().toISOString();
  const outgoingMessageText = formatOutgoingPrompt({
    provider: sendCtx.selectedProvider,
    model: sendCtx.selectedModel,
    models: sendCtx.selectedProviderModels,
    effort: sendCtx.selectedPromptEffort,
    text: trimmed,
  });

  deps.sendInFlight.current = true;
  deps.beginLocalDispatch();
  deps.setThreadError(threadIdForSend, null);

  deps.scrollToEnd();

  deps.setOptimisticUserMessages((existing) => [
    ...existing,
    {
      id: messageIdForSend,
      role: "user",
      text: outgoingMessageText,
      ...(context ? { context } : {}),
      turnId: null,
      createdAt: messageCreatedAt,
      updatedAt: messageCreatedAt,
      streaming: false,
    },
  ]);

  const settingsResult = await deps.persistThreadSettings({
    threadId: threadIdForSend,
    createdAt: messageCreatedAt,
    modelSelection: sendCtx.selectedModelSelection,
    ...(input.localCheckoutBranch ? { branch: input.localCheckoutBranch } : {}),
    runtimeMode: input.runtimeMode,
    interactionMode: nextInteractionMode,
  });
  let failure: CommandResult | null = settingsResult._tag === "Failure" ? settingsResult : null;

  if (failure === null) {
    deps.setInteractionMode(
      scopeThreadRef(thread.environmentId, threadIdForSend),
      nextInteractionMode,
    );

    const startResult = await deps.startTurn({
      threadId: threadIdForSend,
      message: {
        messageId: messageIdForSend,
        role: "user",
        ...(deps.supportsInlineMessageContext()
          ? { text: outgoingMessageText, ...(context ? { context } : {}) }
          : {
              text: serializeLegacyContextMessage({
                text: outgoingMessageText,
                records: context?.records ?? [],
              }),
            }),
        attachments: [],
      },
      modelSelection: sendCtx.selectedModelSelection,
      titleSeed: thread.title,
      runtimeMode: input.runtimeMode,
      interactionMode: nextInteractionMode,
      ...(nextInteractionMode === "default" && input.activeProposedPlan
        ? {
            sourceProposedPlan: {
              threadId: thread.id,
              planId: input.activeProposedPlan.id,
            },
          }
        : {}),
      createdAt: messageCreatedAt,
    });
    failure = startResult._tag === "Failure" ? startResult : null;
  }

  if (failure === null) {
    deps.clearUsageLimitsFor(input.routeThreadKey);
    deps.acknowledgeThreadWoke();
    deps.sendInFlight.current = false;
    return true;
  }

  deps.setOptimisticUserMessages((existing) =>
    existing.filter((message) => message.id !== messageIdForSend),
  );
  const error = failureMessage(failure, "Failed to send plan follow-up.");
  if (error !== null) deps.setThreadError(threadIdForSend, error);
  deps.sendInFlight.current = false;
  deps.resetLocalDispatch();
  return false;
}

export interface ImplementPlanInNewThreadInput {
  readonly thread:
    | {
        readonly id: ThreadId;
        readonly environmentId: EnvironmentId;
        readonly worktreePath: string | null;
      }
    | undefined;
  readonly project: { readonly id: ProjectId } | undefined;
  readonly activeProposedPlan: { readonly id: string; readonly planMarkdown: string } | null;
  readonly isServerThread: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly environmentUnavailable: boolean;
  readonly environmentId: EnvironmentId;
  readonly branch: string | null;
  readonly defaultRuntimeMode: RuntimeMode;
}

export interface ImplementPlanInNewThreadDeps {
  readonly sendInFlight: MutableBox<boolean>;
  readonly composer: () => ComposerSendHandle | null;
  readonly beginLocalDispatch: () => void;
  readonly resetLocalDispatch: () => void;
  readonly createThread: (input: CreateThreadInput) => Promise<CommandResult>;
  readonly startTurn: (input: StartThreadTurnInput) => Promise<CommandResult>;
  readonly waitForStartedThread: (threadRef: ScopedThreadRef) => Promise<boolean>;
  readonly navigateToThread: (threadRef: ScopedThreadRef) => Promise<unknown>;
  readonly deleteThread: (input: DeleteThreadInput) => Promise<CommandResult>;
  readonly toastError: (title: string, description: string) => void;
}

export async function implementPlanInNewThread(
  input: ImplementPlanInNewThreadInput,
  deps: ImplementPlanInNewThreadDeps,
): Promise<void> {
  const { thread, project, activeProposedPlan } = input;
  if (
    !thread ||
    !project ||
    !activeProposedPlan ||
    !input.isServerThread ||
    input.isSendBusy ||
    input.isConnecting ||
    input.environmentUnavailable ||
    deps.sendInFlight.current
  ) {
    return;
  }

  const sendCtx = deps.composer()?.getSendContext();
  if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
    return;
  }

  const createdAt = new Date().toISOString();
  const nextThreadId = newThreadId();
  const planMarkdown = activeProposedPlan.planMarkdown;
  const outgoingImplementationPrompt = formatOutgoingPrompt({
    provider: sendCtx.selectedProvider,
    model: sendCtx.selectedModel,
    models: sendCtx.selectedProviderModels,
    effort: sendCtx.selectedPromptEffort,
    text: buildPlanImplementationPrompt(planMarkdown),
  });
  if (deps.composer()?.validateProviderInput(outgoingImplementationPrompt) === false) {
    return;
  }
  const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
  const nextThreadModelSelection: ModelSelection = sendCtx.selectedModelSelection;

  deps.sendInFlight.current = true;
  deps.beginLocalDispatch();
  const finish = () => {
    deps.sendInFlight.current = false;
    deps.resetLocalDispatch();
  };

  const createResult = await deps.createThread({
    threadId: nextThreadId,
    projectId: project.id,
    title: nextThreadTitle,
    modelSelection: nextThreadModelSelection,
    runtimeMode: input.defaultRuntimeMode,
    interactionMode: "default",
    branch: input.branch,
    worktreePath: thread.worktreePath,
    createdAt,
  });
  let failure: AtomCommandResult<unknown, unknown> | null =
    createResult._tag === "Failure" ? createResult : null;

  if (failure === null) {
    const startResult = await deps.startTurn({
      threadId: nextThreadId,
      message: {
        messageId: newMessageId(),
        role: "user",
        text: outgoingImplementationPrompt,
        attachments: [],
      },
      modelSelection: sendCtx.selectedModelSelection,
      titleSeed: nextThreadTitle,
      runtimeMode: input.defaultRuntimeMode,
      interactionMode: "default",
      sourceProposedPlan: {
        threadId: thread.id,
        planId: activeProposedPlan.id,
      },
      createdAt,
    });
    failure = startResult._tag === "Failure" ? startResult : null;
  }

  const nextThreadRef = scopeThreadRef(thread.environmentId, nextThreadId);
  if (failure === null) {
    const startedResult = await settlePromise(() => deps.waitForStartedThread(nextThreadRef));
    failure = startedResult._tag === "Failure" ? startedResult : null;
  }

  if (failure === null) {
    const navigateResult = await settlePromise(() => deps.navigateToThread(nextThreadRef));
    failure = navigateResult._tag === "Failure" ? navigateResult : null;
  }

  if (failure !== null) {
    const cleanupResult = await deps.deleteThread({ threadId: nextThreadId });
    if (cleanupResult._tag === "Failure" && !isAtomCommandInterrupted(cleanupResult)) {
      console.warn(
        "Failed to clean up implementation thread after start failure.",
        squashAtomCommandFailure(cleanupResult),
      );
    }
    if (!isAtomCommandInterrupted(failure)) {
      const error = squashAtomCommandFailure(failure);
      deps.toastError(
        "Could not start implementation thread",
        error instanceof Error ? error.message : "An error occurred while creating the new thread.",
      );
    }
  }
  finish();
}

export type RevertPreflight =
  | { readonly _tag: "ignore" }
  | { readonly _tag: "error"; readonly message: string }
  | { readonly _tag: "confirm" }
  | { readonly _tag: "revert"; readonly message: ChatMessage; readonly restoreFiles: boolean };

export function resolveRevertPreflight(input: {
  readonly canRevert: boolean;
  readonly messages: ReadonlyArray<ChatMessage> | undefined;
  readonly isRevertingCheckpoint: boolean;
  readonly messageId: MessageId;
  readonly restoreFiles: boolean | undefined;
  readonly supportsConversationRollback: boolean;
  readonly environmentUnavailableLabel: string | null;
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
}): RevertPreflight {
  if (!input.canRevert || !input.messages || input.isRevertingCheckpoint) return { _tag: "ignore" };
  const message = input.messages.find((entry) => entry.id === input.messageId);
  if (!message || message.role !== "user") return { _tag: "ignore" };
  if (!input.supportsConversationRollback) {
    return {
      _tag: "error",
      message:
        "This provider does not support reverting conversation history. Start a new thread instead.",
    };
  }
  if (input.environmentUnavailableLabel) {
    return {
      _tag: "error",
      message: `Reconnect ${input.environmentUnavailableLabel} before reverting checkpoints.`,
    };
  }
  if (input.phase === "running" || input.isSendBusy || input.isConnecting) {
    return { _tag: "error", message: "Interrupt the current turn before reverting checkpoints." };
  }
  if (input.restoreFiles === undefined) return { _tag: "confirm" };
  return { _tag: "revert", message, restoreFiles: input.restoreFiles };
}

export function resolveRevertDialogDescription(activeWorktreePath: string | null): string {
  return `Rewind chat to before this message. Your prompt and attachments return to the composer.${
    activeWorktreePath === null
      ? " Files stay as they are because this thread shares the project directory."
      : ""
  }`;
}

export function joinRestoredPrompt(currentPrompt: string, messageText: string): string {
  const restoredPrompt = recallableComposerPrompt(messageText);
  return restoredPrompt.length === 0
    ? currentPrompt
    : currentPrompt.length > 0
      ? `${currentPrompt}\n\n${restoredPrompt}`
      : restoredPrompt;
}

export interface RevertToTurnCountDeps<A> {
  readonly setThreadError: (error: string | null) => void;
  readonly setRewinding: (rewinding: boolean) => void;
  readonly hasPendingAttachments: () => boolean;
  readonly prepareAttachments: (message: ChatMessage) => Promise<ReadonlyArray<A>>;
  readonly readDraftAttachmentCount: () => number;
  readonly source: ThreadDetailSource;
  readonly revertCheckpoint: (input: RevertThreadCheckpointInput) => Promise<CommandResult>;
  readonly readPrompt: () => string;
  readonly writePrompt: (prompt: string) => void;
  readonly restoreAttachments: (attachments: ReadonlyArray<A>, message: ChatMessage) => void;
  readonly afterRestore: (prompt: string) => void;
}

export async function revertToTurnCount<A>(
  input: {
    readonly threadRef: ScopedThreadRef;
    readonly threadId: ThreadId;
    readonly turnCount: number;
    readonly message: ChatMessage;
    readonly restoreFiles: boolean;
  },
  deps: RevertToTurnCountDeps<A>,
): Promise<void> {
  const { threadRef, threadId, turnCount, message, restoreFiles } = input;
  deps.setRewinding(true);
  deps.setThreadError(null);
  try {
    if (deps.hasPendingAttachments()) {
      throw new Error("Wait for attachments to finish preparing before rewinding.");
    }
    const attachments = await deps.prepareAttachments(message);
    if (deps.readDraftAttachmentCount() + attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      throw new Error("Make room for this message's attachments in the composer before rewinding.");
    }
    await waitForRevertedMessage(deps.source, threadRef, message.id, turnCount, async () => {
      const result = await deps.revertCheckpoint({
        threadId,
        turnCount,
        restoreFiles,
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
    const nextPrompt = joinRestoredPrompt(deps.readPrompt(), message.text);
    deps.writePrompt(nextPrompt);
    deps.restoreAttachments(attachments, message);
    deps.afterRestore(nextPrompt);
  } catch (error) {
    deps.setThreadError(error instanceof Error ? error.message : "Failed to revert thread state.");
  } finally {
    deps.setRewinding(false);
  }
}
