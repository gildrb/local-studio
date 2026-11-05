import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  wasBootstrapThreadDeleted,
  wasBootstrapThreadNotCreated,
} from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  parseCodexFeedbackCommand,
  submitCodexFeedback,
} from "@t3tools/client-runtime/state/threads";
import type {
  CodexFeedbackSubmission,
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
  UpdateThreadMetadataInput,
} from "@t3tools/client-runtime/state/threads";
import { DEFAULT_MODEL, PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import type {
  ChatAttachment,
  EnvironmentId,
  MessageId,
  ModelSelection,
  OrchestrationMessageContext,
  OrchestrationThreadActivity,
  PreviewAnnotationPayload,
  ProjectId,
  ProviderDriverKind,
  ProviderInteractionMode,
  ProviderUploadFeedbackResult,
  RuntimeMode,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import {
  applyClaudePromptEffortPrefix,
  createModelSelection,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";
import { truncate } from "@t3tools/shared/String";
import { isUsageLimitsCommand } from "@t3tools/shared/usageLimits";
import { AsyncResult } from "effect/unstable/reactivity";

import {
  collapseExpandedComposerCursor,
  parseStandaloneComposerSlashCommand,
} from "../../composer-logic";
import type { ComposerSubmissionIntent } from "../../composer-logic";
import { composerDraftHasUserContent } from "../../composerDraftStore";
import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerThreadDraftState,
  DraftId,
  DraftSessionState,
  DraftThreadEnvMode,
  DraftThreadState,
} from "../../composerDraftStore";
import {
  buildMessageContext,
  previewAnnotationContextLabel,
  previewAnnotationContextReference,
  reviewCommentContextLabel,
  terminalContextReference,
} from "../../lib/composerContextRecords";
import {
  ensureInlineContextReferences,
  removeInlineContextReference,
  stripInlineContextReferences,
} from "../../lib/composerContextReferences";
import { formatTerminalContextLabel } from "../../lib/terminalContext";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import { newMessageId, newThreadId, randomHex } from "../../lib/utils";
import { resolvePlanFollowUpSubmission } from "../../proposedPlan";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { getProviderModelCapabilities } from "../../providerModels";
import { latestCompletedToolActivityId } from "../../queuedMessageStore";
import type { QueuedComposerMessage, QueuedMessageSendSettings } from "../../queuedMessageStore";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import type { ChatMessage, SessionPhase, Thread } from "../../types";
import {
  buildExpiredTerminalContextToastCopy,
  cloneComposerImageForRetry,
  deriveComposerSendState,
  getAntigravitySendBlockReason,
  readFileAsDataUrl,
  resolveBackgroundDraftWorkspaceOptions,
  resolveComposerInteractionMode,
  resolveThreadMetadataUpdateForNextTurn,
  restorePlanFollowUpComposer,
  revokeUserMessagePreviewUrls,
  shouldDockDraftHeroForSubmission,
} from "../ChatView.logic";
import type { BackgroundDraftWorkspaceOptions } from "../ChatView.logic";
import { fileAttachmentCapabilityBlockReason } from "./composerAttachmentFiles";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./composerPromptHistory";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
} from "./composerProviderState.logic";

const ENVIRONMENT_UNAVAILABLE_SEND_TOAST_TRAIL_SIZE = 3;

export interface MutableBox<T> {
  current: T;
}

export interface ReadonlyBox<T> {
  readonly current: T;
}

export interface ComposerSendContext {
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly selectedPromptEffort: string | null;
  readonly selectedModelSelection: ModelSelection;
  readonly multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  readonly providerAvailable: boolean;
  readonly selectedProvider: ProviderDriverKind;
  readonly selectedModel: string;
  readonly selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  readonly interactionMode: ProviderInteractionMode;
  readonly interactionModeEnabled: boolean;
}

export interface ComposerCursorResetOptions {
  readonly cursor?: number;
  readonly prompt?: string;
  readonly detectTrigger?: boolean;
}

export interface ComposerSendHandle {
  readonly getSendContext: () => ComposerSendContext;
  readonly validateProviderInput: (providerInput: string) => boolean;
  readonly resetCursorState: (options?: ComposerCursorResetOptions) => void;
}

export interface ComposerDirectAnnotation {
  readonly annotation: PreviewAnnotationPayload;
  readonly image: ComposerImageAttachment | null;
}

export type ComposerSendThread = Pick<
  Thread,
  "id" | "environmentId" | "session" | "messages" | "worktreePath" | "latestTurn" | "createdAt"
>;

export interface ComposerSendProject {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
}

export interface ThreadNextTurnSettingsSnapshot {
  readonly modelSelection: ModelSelection;
  readonly branch: string | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface ThreadNextTurnSettingsInput {
  readonly threadId: ThreadId;
  readonly createdAt: string;
  readonly modelSelection?: ModelSelection;
  readonly branch?: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface ThreadSettingsCommands {
  readonly updateMetadata: (
    input: UpdateThreadMetadataInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly setRuntimeMode: (
    input: SetThreadRuntimeModeInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly setInteractionMode: (
    input: SetThreadInteractionModeInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}

export interface ComposerSendCommands extends ThreadSettingsCommands {
  readonly startTurn: (input: StartThreadTurnInput) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly uploadFeedback: (input: {
    readonly threadId: ThreadId;
    readonly reason?: string;
  }) => Promise<AtomCommandResult<ProviderUploadFeedbackResult, unknown>>;
}

export interface ComposerSendToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ComposerSendToast {
  readonly layout: "stacked" | "plain";
  readonly type: "error" | "warning" | "success" | "info" | "loading";
  readonly title: string;
  readonly description?: string | undefined;
  readonly id?: string;
  readonly timeout?: number;
  readonly action?: ComposerSendToastAction;
  readonly secondaryAction?: ComposerSendToastAction;
}

export type ComposerSendNavigation =
  | { readonly kind: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "draft"; readonly draftId: DraftId };

export interface PlanFollowUpSubmission {
  readonly text: string;
  readonly context?: OrchestrationMessageContext | undefined;
  readonly interactionMode: "default" | "plan";
}

export type FeedbackSubmissionsByThreadKey = Record<string, ReadonlyArray<CodexFeedbackSubmission>>;

type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;
type TurnAttachment = StartThreadTurnInput["message"]["attachments"][number];
type OptimisticAttachment = NonNullable<ChatMessage["attachments"]>[number];

export interface ComposerSendInput {
  readonly submissionIntent: ComposerSubmissionIntent;
  readonly directAnnotation: ComposerDirectAnnotation | undefined;
  readonly environmentId: EnvironmentId;
  readonly routeThreadKey: string;
  readonly draftId: DraftId | null;
  readonly draftThread: DraftThreadState | null;
  readonly thread: ComposerSendThread | undefined;
  readonly threadKey: string | null;
  readonly serverThread: ThreadNextTurnSettingsSnapshot | null;
  readonly project: ComposerSendProject | null;
  readonly projectDefaultModel: string | null;
  readonly isServerThread: boolean;
  readonly isLocalDraftThread: boolean;
  readonly isDraftHeroState: boolean;
  readonly isGitRepo: boolean;
  readonly branch: string | null;
  readonly envMode: DraftThreadEnvMode;
  readonly startFromOrigin: boolean;
  readonly localCheckoutBranch: string | null;
  readonly runtimeMode: RuntimeMode;
  readonly phase: SessionPhase;
  readonly threadActivities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly timelineHasUserMessage: boolean;
  readonly activeProposedPlan: { readonly planMarkdown: string } | null;
  readonly showPlanFollowUpPrompt: boolean;
  readonly hasActivePendingProgress: boolean;
  readonly usageLimitsCommandAvailable: boolean;
  readonly composerHasNonPromptContent: boolean;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly clientSettingsHydrated: boolean;
  readonly threadDetailLoading: boolean;
  readonly loadBalancing: { readonly needed: boolean; readonly pending: boolean };
  readonly environmentUnavailable: boolean;
  readonly serverSupportsRequiredWorktreeBootstrap: boolean;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly supportsAttachmentUploads: boolean;
  readonly followUpBehavior: "queue" | "steer";
  readonly planModeEnabled: boolean;
}

export interface ComposerSendRefs {
  readonly prompt: MutableBox<string>;
  readonly images: MutableBox<ComposerImageAttachment[]>;
  readonly files: MutableBox<ComposerFileAttachment[]>;
  readonly terminalContexts: MutableBox<TerminalContextDraft[]>;
  readonly sendInFlight: MutableBox<boolean>;
  readonly sendGeneration: MutableBox<number>;
  readonly environmentUnavailableToastSlot: MutableBox<number>;
  readonly feedbackUploadsInFlight: ReadonlyBox<Set<string>>;
  readonly multipleModelSelections: ReadonlyBox<ReadonlyArray<ModelSelection> | null>;
  readonly currentRouteThreadKey: ReadonlyBox<string | null>;
  readonly uncertainMultipleSubmissions: ReadonlyBox<Map<string, ThreadId>>;
}

export interface ComposerSendDraftStore {
  readonly read: () => ComposerThreadDraftState | null;
  readonly setPrompt: (prompt: string) => void;
  readonly clearContent: () => void;
  readonly addImages: (images: ComposerImageAttachment[]) => void;
  readonly addFiles: (files: ComposerFileAttachment[]) => void;
  readonly setTerminalContexts: (contexts: TerminalContextDraft[]) => void;
  readonly setPreviewAnnotations: (annotations: ReadonlyArray<PreviewAnnotationPayload>) => void;
  readonly setReviewComments: (comments: ReadonlyArray<ReviewCommentContext>) => void;
  readonly getDraftSession: (draftId: DraftId) => DraftSessionState | null;
  readonly setLogicalProjectDraftThreadId: (
    logicalProjectKey: string,
    projectRef: ScopedProjectRef,
    draftId: DraftId,
    options: { readonly threadId: ThreadId; readonly createdAt: string },
  ) => void;
  readonly beginBackgroundSubmission: (threadRef: ScopedThreadRef) => void;
  readonly clearBackgroundSubmission: (threadRef: ScopedThreadRef) => void;
  readonly markPromoted: (threadRef: ScopedThreadRef) => void;
  readonly finalizePromoted: (threadRef: ScopedThreadRef) => void;
  readonly restoreFailedBackgroundThread: (
    draftId: DraftId,
    draftThread: DraftThreadState,
    threadId: ThreadId,
  ) => void;
}

export interface ComposerSendAttachmentUploads {
  readonly readServerConfig: () => ServerConfig | null;
  readonly start: (attachment: ComposerAttachment) => void;
  readonly await: (attachmentIds: ReadonlyArray<string>) => Promise<void>;
  readonly getUploaded: (attachments: ReadonlyArray<ComposerAttachment>) => ChatAttachment[] | null;
  readonly release: (attachments: ReadonlyArray<ComposerAttachment>) => void;
}

export interface ComposerSendDeps {
  readonly composer: () => ComposerSendHandle | null;
  readonly refs: ComposerSendRefs;
  readonly draft: ComposerSendDraftStore;
  readonly commands: ComposerSendCommands;
  readonly attachments: ComposerSendAttachmentUploads;
  readonly queue: {
    readonly read: (threadKey: string) => ReadonlyArray<QueuedComposerMessage>;
    readonly enqueue: (threadKey: string, message: Omit<QueuedComposerMessage, "id">) => void;
  };
  readonly toast: {
    readonly add: (toast: ComposerSendToast) => string;
    readonly update: (id: string, patch: { readonly description: string }) => void;
    readonly close: (id: string) => void;
  };
  readonly navigate: (target: ComposerSendNavigation) => void;
  readonly confirm: (message: string) => Promise<boolean> | null;
  readonly setThreadError: (threadId: ThreadId, error: string | null) => void;
  readonly openUsageLimits: () => boolean;
  readonly advancePendingUserInput: () => void;
  readonly changeInteractionMode: (mode: ProviderInteractionMode) => void;
  readonly submitPlanFollowUp: (submission: PlanFollowUpSubmission) => Promise<boolean>;
  readonly setFeedbackSubmissions: (
    update: (current: FeedbackSubmissionsByThreadKey) => FeedbackSubmissionsByThreadKey,
  ) => void;
  readonly setMultipleModelSelections: (selections: ReadonlyArray<ModelSelection>) => void;
  readonly setOptimisticUserMessages: (update: (existing: ChatMessage[]) => ChatMessage[]) => void;
  readonly timeline: {
    readonly anchorFirstMessage: (threadKey: string, messageId: MessageId) => void;
    readonly scrollToEnd: () => void;
  };
  readonly draftHero: {
    readonly dock: (threadKey: string) => Promise<void>;
    readonly undock: (threadKey: string | null) => void;
  };
  readonly localDispatch: {
    readonly begin: (options: {
      readonly preparingWorktree: boolean;
      readonly submissionIntent: ComposerSubmissionIntent;
    }) => void;
    readonly reset: () => void;
  };
  readonly clearUsageLimitsFor: (threadKey: string) => void;
  readonly acknowledgeThreadWoke: () => void;
  readonly openFreshDraft: (
    projectRef: ScopedProjectRef,
    options: BackgroundDraftWorkspaceOptions,
  ) => Promise<unknown>;
}

export type ComposerSendBlockReason =
  | "unavailable"
  | "load-balancing"
  | "environment-unavailable"
  | "pending-user-input"
  | "provider-unavailable"
  | "multiple-models-unsupported"
  | "multiple-models-invalid"
  | "feedback-needs-session"
  | "invalid-provider-input"
  | "empty"
  | "no-project"
  | "missing-base-branch"
  | "provider-instance-unavailable"
  | "attachments-blocked";

export type ComposerSendOutcome =
  | { readonly _tag: "UsageLimitsCommand"; readonly opened: boolean }
  | { readonly _tag: "Blocked"; readonly reason: ComposerSendBlockReason }
  | { readonly _tag: "PendingUserInputAdvanced" }
  | { readonly _tag: "FeedbackSubmitted" }
  | { readonly _tag: "PlanFollowUp"; readonly sent: boolean }
  | { readonly _tag: "InteractionModeChanged"; readonly mode: ProviderInteractionMode }
  | { readonly _tag: "Queued" }
  | {
      readonly _tag: "MultipleStarted";
      readonly startedCount: number;
      readonly failedCount: number;
    }
  | { readonly _tag: "Sent"; readonly threadId: ThreadId; readonly messageId: MessageId }
  | {
      readonly _tag: "SendFailed";
      readonly threadId: ThreadId;
      readonly messageId: MessageId;
      readonly error: string | null;
    };

function blocked(reason: ComposerSendBlockReason): ComposerSendOutcome {
  return { _tag: "Blocked", reason };
}

export function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  const promptEffort = resolvePromptInjectedEffort(caps, params.effort);
  return applyClaudePromptEffortPrefix(params.text, promptEffort);
}

// The composer's model and modes, as a queued message keeps them for its send.
export function readComposerSendSettings(
  sendCtx: ComposerSendContext,
  runtimeMode: RuntimeMode,
): QueuedMessageSendSettings {
  return {
    modelSelection: sendCtx.selectedModelSelection,
    runtimeMode,
    interactionMode: sendCtx.interactionMode,
    promptEffort: resolvePromptInjectedEffort(
      getProviderModelCapabilities(
        sendCtx.selectedProviderModels,
        sendCtx.selectedModel,
        sendCtx.selectedProvider,
      ),
      sendCtx.selectedPromptEffort,
    ),
  };
}

export async function persistThreadSettingsForNextTurn(
  serverThread: ThreadNextTurnSettingsSnapshot | null,
  input: ThreadNextTurnSettingsInput,
  commands: ThreadSettingsCommands,
): Promise<AtomCommandResult<void, unknown>> {
  if (!serverThread) {
    return AsyncResult.success(undefined);
  }

  let result: AtomCommandResult<void, unknown> = AsyncResult.success(undefined);
  const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
    currentModelSelection: serverThread.modelSelection,
    ...(input.modelSelection ? { nextModelSelection: input.modelSelection } : {}),
    currentBranch: serverThread.branch,
    ...(input.branch ? { nextBranch: input.branch } : {}),
  });
  if (metadataUpdate) {
    result = mapAtomCommandResult(
      await commands.updateMetadata({
        threadId: input.threadId,
        ...metadataUpdate,
      }),
      () => undefined,
    );
    if (result._tag === "Failure") {
      return result;
    }
  }

  if (input.runtimeMode !== serverThread.runtimeMode) {
    result = mapAtomCommandResult(
      await commands.setRuntimeMode({
        threadId: input.threadId,
        runtimeMode: input.runtimeMode,
        createdAt: input.createdAt,
      }),
      () => undefined,
    );
    if (result._tag === "Failure") {
      return result;
    }
  }

  if (input.interactionMode !== serverThread.interactionMode) {
    result = mapAtomCommandResult(
      await commands.setInteractionMode({
        threadId: input.threadId,
        interactionMode: input.interactionMode,
        createdAt: input.createdAt,
      }),
      () => undefined,
    );
  }
  return result;
}

function turnAttachmentIds(
  attachments: ReadonlyArray<TurnAttachment>,
): ReadonlyArray<string | undefined> {
  return attachments.map((attachment) =>
    "id" in attachment && attachment.id !== undefined ? attachment.id : undefined,
  );
}

export async function sendComposerTurn(
  input: ComposerSendInput,
  deps: ComposerSendDeps,
): Promise<ComposerSendOutcome> {
  const { directAnnotation, submissionIntent, environmentId, routeThreadKey, draftId } = input;
  const { refs, draft } = deps;
  // Typed out in full rather than picked from the menu. Attachments or contexts
  // mean the user is sending a prompt, so those go through as usual.
  if (
    input.usageLimitsCommandAvailable &&
    !directAnnotation &&
    !input.composerHasNonPromptContent &&
    isUsageLimitsCommand(refs.prompt.current)
  ) {
    const opened = deps.openUsageLimits();
    if (opened) {
      refs.prompt.current = "";
      draft.setPrompt("");
      deps.composer()?.resetCursorState();
    }
    return { _tag: "UsageLimitsCommand", opened };
  }

  const notifyDirectAnnotationAttached = () => {
    if (!directAnnotation) return;
    deps.toast.add({
      layout: "stacked",
      type: "info",
      title: "Annotation attached to draft",
      description: "Sending is unavailable right now. Finish the current action, then send.",
    });
  };
  const activeThread = input.thread;
  if (
    !activeThread ||
    input.isSendBusy ||
    input.isConnecting ||
    input.isRevertingCheckpoint ||
    !input.clientSettingsHydrated ||
    input.threadDetailLoading ||
    refs.sendInFlight.current ||
    refs.feedbackUploadsInFlight.current.has(routeThreadKey)
  ) {
    notifyDirectAnnotationAttached();
    return blocked("unavailable");
  }
  if (input.loadBalancing.needed) {
    deps.toast.add({
      layout: "plain",
      type: "warning",
      title: input.loadBalancing.pending
        ? "Checking machine resources"
        : "Choose a machine to continue",
      description: input.loadBalancing.pending
        ? "Resource checks are still running. You can choose a machine in the composer."
        : "No eligible machine has available resources. Choose a machine in the composer to override.",
    });
    return blocked("load-balancing");
  }
  if (input.environmentUnavailable) {
    const toastSlot = refs.environmentUnavailableToastSlot.current;
    refs.environmentUnavailableToastSlot.current =
      (toastSlot + 1) % ENVIRONMENT_UNAVAILABLE_SEND_TOAST_TRAIL_SIZE;
    deps.toast.add({
      layout: "stacked",
      type: "warning",
      title: "Not connected: message not sent",
      description: "Reconnecting to the environment. Try again once it is connected.",
      id: `chat-send-environment-unavailable:${toastSlot}`,
    });
    return blocked("environment-unavailable");
  }
  if (input.hasActivePendingProgress) {
    if (directAnnotation) {
      notifyDirectAnnotationAttached();
      return blocked("pending-user-input");
    }
    deps.advancePendingUserInput();
    return { _tag: "PendingUserInputAdvanced" };
  }
  const sendCtx = deps.composer()?.getSendContext();
  if (!sendCtx?.providerAvailable) {
    notifyDirectAnnotationAttached();
    return blocked("provider-unavailable");
  }
  const multipleModelSelections = sendCtx.multipleModelSelections;
  if (multipleModelSelections !== null && !input.serverSupportsRequiredWorktreeBootstrap) {
    deps.setThreadError(activeThread.id, "Update this server before starting multiple models.");
    return blocked("multiple-models-unsupported");
  }
  const activeThreadBranch = input.branch;
  if (
    multipleModelSelections !== null &&
    (!input.isLocalDraftThread ||
      !input.isGitRepo ||
      !activeThreadBranch ||
      multipleModelSelections.length === 0)
  ) {
    deps.toast.add({
      layout: "stacked",
      type: "warning",
      title: "Choose models and a base branch",
      description:
        "Multiple models need a new thread in a Git project. Each gets its own worktree.",
    });
    return blocked("multiple-models-invalid");
  }
  const multiple =
    multipleModelSelections !== null && activeThreadBranch
      ? { selections: multipleModelSelections, baseBranch: activeThreadBranch }
      : null;
  const {
    images: sendContextImages,
    files: composerFiles,
    terminalContexts: composerTerminalContexts,
    previewAnnotations: sendContextPreviewAnnotations,
    reviewComments: composerReviewComments,
    selectedProvider: ctxSelectedProvider,
    selectedModel: ctxSelectedModel,
    selectedProviderModels: ctxSelectedProviderModels,
    selectedPromptEffort: ctxSelectedPromptEffort,
    selectedModelSelection: ctxSelectedModelSelection,
    interactionMode: sendInteractionMode,
    interactionModeEnabled: sendInteractionModeEnabled,
  } = sendCtx;
  const annotationImageAlreadyAttached =
    directAnnotation?.image !== undefined &&
    sendContextImages.some((image) => image.id === directAnnotation.image?.id);
  // A full composer (e.g. 8 files) cannot take the annotation screenshot;
  // over the cap the server rejects the whole turn.
  const annotationImageAppended =
    directAnnotation?.image !== undefined &&
    !annotationImageAlreadyAttached &&
    sendContextImages.length + composerFiles.length < PROVIDER_SEND_TURN_MAX_ATTACHMENTS;
  const composerImages =
    directAnnotation?.image && annotationImageAppended
      ? [...sendContextImages, directAnnotation.image]
      : sendContextImages;
  const composerPreviewAnnotations =
    directAnnotation &&
    !sendContextPreviewAnnotations.some(
      (annotation) => annotation.id === directAnnotation.annotation.id,
    )
      ? [
          ...sendContextPreviewAnnotations,
          {
            ...directAnnotation.annotation,
            // Claim an attached crop only when the screenshot really rides
            // along; a cap-dropped image must not produce a lying prompt.
            screenshot:
              directAnnotation.annotation.screenshot &&
              (annotationImageAppended || annotationImageAlreadyAttached)
                ? { ...directAnnotation.annotation.screenshot, dataUrl: "" }
                : null,
          },
        ]
      : sendContextPreviewAnnotations;
  // A direct "send annotation" writes the draft and sends in the same tick; the reference
  // must be in the text now, not after the next render.
  const promptForSend = directAnnotation
    ? ensureInlineContextReferences(refs.prompt.current, [
        previewAnnotationContextReference(directAnnotation.annotation),
      ])
    : refs.prompt.current;
  const {
    trimmedPrompt: trimmed,
    sendableTerminalContexts: sendableComposerTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent,
  } = deriveComposerSendState({
    prompt: promptForSend,
    imageCount: composerImages.length + composerFiles.length,
    terminalContexts: composerTerminalContexts,
    elementContextCount: composerPreviewAnnotations.length + composerReviewComments.length,
  });
  const feedbackCommand =
    ctxSelectedProvider === "codex" &&
    composerImages.length === 0 &&
    composerFiles.length === 0 &&
    sendableComposerTerminalContexts.length === 0 &&
    composerPreviewAnnotations.length === 0 &&
    composerReviewComments.length === 0
      ? parseCodexFeedbackCommand(trimmed)
      : null;
  if (feedbackCommand && multiple === null) {
    if (!input.isServerThread || activeThread.session === null) {
      deps.toast.add({
        layout: "stacked",
        type: "warning",
        title: "Start a Codex thread first",
        description: "Send a message before you submit feedback.",
      });
      return blocked("feedback-needs-session");
    }
    refs.feedbackUploadsInFlight.current.add(routeThreadKey);
    await submitCodexFeedback({
      submission: {
        id: newMessageId(),
        command: trimmed,
        createdAt: new Date().toISOString(),
      },
      clearDraft: () => {
        refs.prompt.current = "";
        draft.clearContent();
        deps.composer()?.resetCursorState();
      },
      onUpdate: (submission) => {
        deps.setFeedbackSubmissions((current) => {
          const existing = current[routeThreadKey] ?? [];
          const found = existing.some((entry) => entry.id === submission.id);
          return {
            ...current,
            [routeThreadKey]: found
              ? existing.map((entry) => (entry.id === submission.id ? submission : entry))
              : [...existing, submission],
          };
        });
      },
      upload: () =>
        deps.commands.uploadFeedback({
          threadId: activeThread.id,
          ...feedbackCommand,
        }),
    }).finally(() => {
      refs.feedbackUploadsInFlight.current.delete(routeThreadKey);
    });

    return { _tag: "FeedbackSubmitted" };
  }
  if (
    !directAnnotation &&
    sendInteractionModeEnabled &&
    input.showPlanFollowUpPrompt &&
    input.activeProposedPlan &&
    composerImages.length === 0 &&
    composerFiles.length === 0
  ) {
    const followUp = resolvePlanFollowUpSubmission({
      draftText: promptForSend,
      planMarkdown: input.activeProposedPlan.planMarkdown,
    });
    const outgoingFollowUpText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: followUp.text.trim(),
    });
    if (deps.composer()?.validateProviderInput(outgoingFollowUpText) === false) {
      return blocked("invalid-provider-input");
    }
    // The composer is cleared before the send resolves, so hold everything it carried: a
    // transient failure must give the prose and its context back, as the ordinary send does.
    // Snapshot exactly what was sent, copied, so later mutations cannot alias the backup.
    const followUpPromptSnapshot = refs.prompt.current;
    const followUpTerminalContexts = [...sendableComposerTerminalContexts];
    const followUpReviewComments = [...composerReviewComments];
    const followUpPreviewAnnotations = [...composerPreviewAnnotations];
    refs.prompt.current = "";
    draft.clearContent();
    deps.composer()?.resetCursorState();
    const followUpSent = await deps.submitPlanFollowUp({
      text: followUp.text,
      context: buildMessageContext({
        terminalContexts: sendableComposerTerminalContexts,
        reviewComments: composerReviewComments,
        previewAnnotations: composerPreviewAnnotations,
      }),
      interactionMode: followUp.interactionMode,
    });
    if (!followUpSent) {
      refs.prompt.current = followUpPromptSnapshot;
      refs.terminalContexts.current = [...followUpTerminalContexts];
      restorePlanFollowUpComposer({
        snapshot: {
          prompt: followUpPromptSnapshot,
          terminalContexts: followUpTerminalContexts,
          reviewComments: followUpReviewComments,
          previewAnnotations: followUpPreviewAnnotations,
        },
        writePrompt: (prompt) => draft.setPrompt(prompt),
        writeTerminalContexts: (contexts) => draft.setTerminalContexts([...contexts]),
        writeReviewComments: (comments) => draft.setReviewComments([...comments]),
        writePreviewAnnotations: (annotations) => draft.setPreviewAnnotations([...annotations]),
        resetCursor: (options) => deps.composer()?.resetCursorState(options),
      });
    }
    return { _tag: "PlanFollowUp", sent: followUpSent };
  }
  // Providers without the legacy toggle receive their native commands unchanged.
  const standaloneSlashCommand =
    sendInteractionModeEnabled &&
    composerImages.length === 0 &&
    composerFiles.length === 0 &&
    sendableComposerTerminalContexts.length === 0 &&
    composerPreviewAnnotations.length === 0 &&
    composerReviewComments.length === 0
      ? parseStandaloneComposerSlashCommand(trimmed)
      : null;
  if (standaloneSlashCommand && multiple === null) {
    deps.changeInteractionMode(standaloneSlashCommand);
    refs.prompt.current = "";
    draft.clearContent();
    deps.composer()?.resetCursorState();
    return { _tag: "InteractionModeChanged", mode: standaloneSlashCommand };
  }
  if (!hasSendableContent) {
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(expiredTerminalContextCount, "empty");
      deps.toast.add({
        layout: "stacked",
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      });
    }
    return blocked("empty");
  }
  const activeProject = input.project;
  if (!activeProject) {
    deps.toast.add({
      layout: "stacked",
      type: "warning",
      title: "Choose a project first",
      description: "This draft no longer points to an available project.",
    });
    return blocked("no-project");
  }
  const activeThreadKey = input.threadKey;
  // A queued message that will still leave on its own goes first, so a new
  // send lines up behind it instead of overtaking it.
  const queueStillSending =
    activeThreadKey !== null &&
    deps.queue
      .read(activeThreadKey)
      .some((message) => message.sending !== undefined || !message.holdUntilUserAction);
  if (
    !directAnnotation &&
    activeThreadKey &&
    (queueStillSending ||
      (input.phase === "running" &&
        (input.followUpBehavior === "queue") !== (submissionIntent === "alternate")))
  ) {
    const sendSettings = readComposerSendSettings(sendCtx, input.runtimeMode);
    if (
      deps
        .composer()
        ?.validateProviderInput(
          applyClaudePromptEffortPrefix(promptForSend, sendSettings.promptEffort),
        ) === false
    ) {
      return blocked("invalid-provider-input");
    }
    deps.queue.enqueue(activeThreadKey, {
      prompt: promptForSend,
      images: [...composerImages],
      files: [...composerFiles],
      terminalContexts: [...composerTerminalContexts],
      previewAnnotations: [...composerPreviewAnnotations],
      reviewComments: [...composerReviewComments],
      sendSettings,
      queuedAfterToolActivityId: latestCompletedToolActivityId(input.threadActivities),
      createdAt: new Date().toISOString(),
    });
    refs.prompt.current = "";
    // Attachments move with the message; their uploads stay pending. The
    // refs clear now too, so a Stop before the composer's sync effect runs
    // does not restore the moved attachments twice.
    refs.images.current = [];
    refs.files.current = [];
    refs.terminalContexts.current = [];
    draft.clearContent();
    deps.composer()?.resetCursorState();
    return { _tag: "Queued" };
  }
  const threadIdForSend = activeThread.id;
  const isFirstMessage = !input.isServerThread || activeThread.messages.length === 0;
  const baseBranchForWorktree =
    isFirstMessage && input.envMode === "worktree" && !activeThread.worktreePath
      ? activeThreadBranch
      : null;

  // In worktree mode, require an explicit base branch so we don't silently
  // fall back to local execution when branch selection is missing.
  const shouldCreateWorktree =
    isFirstMessage && input.envMode === "worktree" && !activeThread.worktreePath;
  if (shouldCreateWorktree && !activeThreadBranch) {
    deps.setThreadError(
      threadIdForSend,
      "Select a base branch before sending in New worktree mode.",
    );
    return blocked("missing-base-branch");
  }

  const composerImagesSnapshot = [...composerImages];
  const composerFilesSnapshot = [...composerFiles];
  const composerAttachmentsSnapshot: ComposerAttachment[] = [
    ...composerImagesSnapshot,
    ...composerFilesSnapshot,
  ];
  const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
  const composerPreviewAnnotationsSnapshot = [...composerPreviewAnnotations];
  const composerReviewCommentsSnapshot: ReviewCommentContext[] = [...composerReviewComments];
  // Expired terminal excerpts are not sent; their chips leave the text with them.
  const messageTextForSend = composerTerminalContexts
    .filter((context) => !composerTerminalContextsSnapshot.includes(context))
    .reduce(
      (text, context) =>
        removeInlineContextReference(text, terminalContextReference(context).contextId).prompt,
      promptForSend,
    )
    .trim();
  // Records bind attachments by the id each side knows: the local id for the optimistic
  // row, the upload id (or local id on the data-URL path) on the wire; the server
  // rebinds them to the persisted id.
  const buildOutgoingMessageContext = (attachmentIds: ReadonlyArray<string | undefined>) =>
    buildMessageContext({
      terminalContexts: composerTerminalContextsSnapshot,
      reviewComments: composerReviewCommentsSnapshot,
      previewAnnotations: composerPreviewAnnotationsSnapshot,
      attachments: composerAttachmentsSnapshot.map((attachment, index) => ({
        attachment,
        attachmentId: attachmentIds[index] ?? attachment.id,
      })),
    });
  const outgoingMessageContext = buildOutgoingMessageContext(
    composerAttachmentsSnapshot.map((attachment) => attachment.id),
  );
  const outgoingMessageText = formatOutgoingPrompt({
    provider: ctxSelectedProvider,
    model: ctxSelectedModel,
    models: ctxSelectedProviderModels,
    effort: ctxSelectedPromptEffort,
    text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
  });
  if (deps.composer()?.validateProviderInput(outgoingMessageText) === false) {
    return blocked("invalid-provider-input");
  }

  const readLiveAttachmentCapabilities = () => {
    const config = deps.attachments.readServerConfig();
    const liveSupportsAttachmentUploads =
      config?.environment.capabilities.attachmentUploads === true;
    return {
      supportsAttachmentUploads: liveSupportsAttachmentUploads,
      fileBlockReason: fileAttachmentCapabilityBlockReason({
        files: composerFilesSnapshot,
        attachmentUploadsCapabilityKnown: config !== null,
        supportsAttachmentUploads: liveSupportsAttachmentUploads,
        maxFileAttachmentBytes:
          config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
      }),
    };
  };

  const multipleTargets = [];
  for (const selection of multiple?.selections ?? []) {
    const provider = input.providerInstanceEntries.find(
      (entry) => entry.instanceId === selection.instanceId,
    );
    if (!provider?.enabled || !provider.isAvailable || provider.status !== "ready") {
      deps.setThreadError(threadIdForSend, `Provider for ${selection.model} is unavailable.`);
      return blocked("provider-instance-unavailable");
    }
    const providerBlockReason = getAntigravitySendBlockReason(provider.snapshot, selection.model);
    if (providerBlockReason) {
      deps.setThreadError(threadIdForSend, providerBlockReason);
      return blocked("provider-instance-unavailable");
    }
    const providerState = getComposerProviderState({
      provider: provider.driverKind,
      model: selection.model,
      models: provider.models,
      modelOptions: selection.options,
      promptInjectionState: getComposerPromptInjectionState(messageTextForSend),
      planModeEnabled: input.planModeEnabled,
    });
    const text = formatOutgoingPrompt({
      provider: provider.driverKind,
      model: selection.model,
      models: provider.models,
      effort: providerState.promptEffort,
      text: messageTextForSend || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
    });
    if (deps.composer()?.validateProviderInput(text) === false) {
      return blocked("invalid-provider-input");
    }
    multipleTargets.push({
      selection: createModelSelection(
        selection.instanceId,
        selection.model,
        providerState.modelOptionsForDispatch,
      ),
      text,
      interactionMode: resolveComposerInteractionMode({
        planModeEnabled: input.planModeEnabled,
        provider: provider.snapshot,
        interactionMode: sendInteractionMode,
      }).interactionMode,
    });
  }

  refs.sendInFlight.current = true;
  const sendGeneration = ++refs.sendGeneration.current;
  const attachmentCapabilitiesBeforeUpload = readLiveAttachmentCapabilities();
  if (attachmentCapabilitiesBeforeUpload.fileBlockReason !== null) {
    refs.sendInFlight.current = false;
    deps.setThreadError(threadIdForSend, attachmentCapabilitiesBeforeUpload.fileBlockReason);
    return blocked("attachments-blocked");
  }
  const turnUsesAttachmentUploads =
    composerFilesSnapshot.length > 0
      ? attachmentCapabilitiesBeforeUpload.supportsAttachmentUploads
      : input.supportsAttachmentUploads;
  if (turnUsesAttachmentUploads && composerAttachmentsSnapshot.length > 0) {
    for (const attachment of composerAttachmentsSnapshot) {
      deps.attachments.start(attachment);
    }
    await deps.attachments.await(composerAttachmentsSnapshot.map((attachment) => attachment.id));
    const attachmentCapabilitiesAfterUpload = readLiveAttachmentCapabilities();
    if (attachmentCapabilitiesAfterUpload.fileBlockReason !== null) {
      refs.sendInFlight.current = false;
      deps.setThreadError(threadIdForSend, attachmentCapabilitiesAfterUpload.fileBlockReason);
      return blocked("attachments-blocked");
    }
    if (deps.attachments.getUploaded(composerAttachmentsSnapshot) === null) {
      refs.sendInFlight.current = false;
      deps.setThreadError(threadIdForSend, "Retry or remove failed uploads before sending.");
      return blocked("attachments-blocked");
    }
  }

  const resolvedSubmissionIntent =
    (multiple !== null || submissionIntent === "background") && input.isLocalDraftThread
      ? "background"
      : "foreground";
  if (
    shouldDockDraftHeroForSubmission({
      isDraftHeroState: input.isDraftHeroState,
      activeThreadKey,
      submissionIntent: resolvedSubmissionIntent,
    }) &&
    activeThreadKey
  ) {
    await deps.draftHero.dock(activeThreadKey);
  }

  const attachmentCapabilitiesBeforeDispatch = readLiveAttachmentCapabilities();
  if (attachmentCapabilitiesBeforeDispatch.fileBlockReason !== null) {
    refs.sendInFlight.current = false;
    deps.setThreadError(threadIdForSend, attachmentCapabilitiesBeforeDispatch.fileBlockReason);
    deps.draftHero.undock(activeThreadKey);
    return blocked("attachments-blocked");
  }
  deps.localDispatch.begin({
    preparingWorktree: multiple !== null || Boolean(baseBranchForWorktree),
    submissionIntent: resolvedSubmissionIntent,
  });

  const messageIdForSend = newMessageId();
  const messageCreatedAt = new Date().toISOString();
  const turnAttachmentsPromise = Promise.all(
    composerAttachmentsSnapshot.map(async (attachment): Promise<TurnAttachment> => {
      if (turnUsesAttachmentUploads) {
        const uploaded = deps.attachments.getUploaded([attachment])?.[0];
        if (!uploaded) {
          throw new Error(`Attachment '${attachment.name}' did not finish uploading.`);
        }
        return uploaded;
      }
      if (attachment.type !== "image") {
        throw new Error("This server does not support file attachments.");
      }
      return {
        type: "image",
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: await readFileAsDataUrl(attachment.file),
        ...(attachment.source ? { source: attachment.source } : {}),
      };
    }),
  );
  if (multiple !== null) {
    const failedSelections: ModelSelection[] = [];
    let clearedDraft = false;
    let releasedComposer = false;
    let canRestoreDraft = () => false;
    let startedCount = 0;
    try {
      const attachments = await turnAttachmentsPromise;
      const fileBlockReason = readLiveAttachmentCapabilities().fileBlockReason;
      if (fileBlockReason !== null) throw new Error(fileBlockReason);
      const context = buildOutgoingMessageContext(turnAttachmentIds(attachments));
      const title = truncate(
        assistantCitationsToPlainText(stripInlineContextReferences(trimmed)).trim() ||
          composerAttachmentsSnapshot[0]?.name ||
          "New thread",
      );
      refs.prompt.current = "";
      draft.clearContent();
      deps.composer()?.resetCursorState();
      clearedDraft = true;
      const clearedDraftSnapshot = draft.read();
      const submittedSelections = refs.multipleModelSelections.current;
      canRestoreDraft = () =>
        refs.currentRouteThreadKey.current === routeThreadKey &&
        refs.sendGeneration.current === sendGeneration &&
        draft.read() === clearedDraftSnapshot &&
        refs.multipleModelSelections.current === submittedSelections;
      deps.setThreadError(threadIdForSend, null);
      const starts = Promise.all(
        multipleTargets.map(async (target) => {
          const retryKey = JSON.stringify([
            routeThreadKey,
            target.selection.instanceId,
            target.selection.model,
          ]);
          const uncertainThreadId = refs.uncertainMultipleSubmissions.current.get(retryKey);
          const targetThreadId = uncertainThreadId ?? newThreadId();
          let requestMayHaveStarted = false;
          try {
            if (uncertainThreadId) {
              throw new Error(
                "The previous request may have started. Open its thread to check before sending again.",
              );
            }
            const supportsInlineMessageContext =
              deps.attachments.readServerConfig()?.environment.capabilities.inlineMessageContext ===
              true;
            requestMayHaveStarted = true;
            const result = await deps.commands.startTurn({
              threadId: targetThreadId,
              message: {
                messageId: newMessageId(),
                role: "user",
                text:
                  context && !supportsInlineMessageContext
                    ? serializeLegacyContextMessage({
                        text: target.text,
                        records: context.records,
                      })
                    : target.text,
                attachments,
                ...(context && supportsInlineMessageContext ? { context } : {}),
              },
              modelSelection: target.selection,
              titleSeed: title,
              runtimeMode: input.runtimeMode,
              interactionMode: target.interactionMode,
              bootstrap: {
                createThread: {
                  projectId: activeProject.id,
                  title,
                  modelSelection: target.selection,
                  runtimeMode: input.runtimeMode,
                  interactionMode: target.interactionMode,
                  branch: activeThreadBranch,
                  worktreePath: null,
                  createdAt: messageCreatedAt,
                },
                prepareWorktree: {
                  projectCwd: activeProject.workspaceRoot,
                  baseBranch: multiple.baseBranch,
                  requireWorktree: true,
                  branch: buildTemporaryWorktreeBranchName(randomHex),
                  ...(input.startFromOrigin ? { startFromOrigin: true } : {}),
                },
                runSetupScript: true,
              },
              createdAt: messageCreatedAt,
            });
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              if (wasBootstrapThreadDeleted(error) || wasBootstrapThreadNotCreated(error)) {
                requestMayHaveStarted = false;
              }
              throw error;
            }
            startedCount += 1;
          } catch (error) {
            if (requestMayHaveStarted && !refs.uncertainMultipleSubmissions.current.has(retryKey)) {
              refs.uncertainMultipleSubmissions.current.set(retryKey, targetThreadId);
            }
            failedSelections.push(target.selection);
            const retainedThreadId = refs.uncertainMultipleSubmissions.current.get(retryKey);
            const failureToastId = deps.toast.add({
              layout: "stacked",
              type: "error",
              title: `Could not start ${target.selection.model}`,
              description: error instanceof Error ? error.message : "Failed to send message.",
              ...(retainedThreadId
                ? {
                    timeout: 0,
                    secondaryAction: {
                      label: "Allow retry",
                      onClick: () => {
                        void deps
                          .confirm(
                            "The previous request may already be running. Check its thread first. Allow another send that could create a duplicate thread?",
                          )
                          ?.then(
                            (confirmed) => {
                              if (
                                confirmed &&
                                refs.uncertainMultipleSubmissions.current.get(retryKey) ===
                                  retainedThreadId
                              ) {
                                refs.uncertainMultipleSubmissions.current.delete(retryKey);
                                deps.toast.close(failureToastId);
                              }
                            },
                            () => undefined,
                          );
                      },
                    },
                    action: {
                      label: "Open thread",
                      onClick: () => {
                        deps.navigate({
                          kind: "thread",
                          threadRef: scopeThreadRef(environmentId, retainedThreadId),
                        });
                      },
                    },
                  }
                : {}),
            });
          }
        }),
      );
      // Each request now owns its background thread. The original draft is
      // ready for another prompt while checkout and setup scripts finish.
      refs.sendInFlight.current = false;
      deps.localDispatch.reset();
      releasedComposer = true;
      await starts;
      if (startedCount > 0) {
        deps.toast.add({
          layout: "stacked",
          type: "success",
          title: `Started ${startedCount} ${startedCount === 1 ? "thread" : "threads"} in background`,
        });
      }
      if (failedSelections.length === 0 && turnUsesAttachmentUploads) {
        deps.attachments.release(composerAttachmentsSnapshot);
      }
    } catch (error) {
      failedSelections.push(...multiple.selections);
      deps.setThreadError(
        threadIdForSend,
        error instanceof Error ? error.message : "Failed to send messages.",
      );
    } finally {
      const restoreFailedDraft = () => {
        deps.setMultipleModelSelections(failedSelections);
        if (clearedDraft) {
          draft.setPrompt(messageTextForSend);
          draft.addImages(composerImagesSnapshot.map(cloneComposerImageForRetry));
          draft.addFiles(composerFilesSnapshot);
          draft.setTerminalContexts(composerTerminalContextsSnapshot);
          draft.setPreviewAnnotations(composerPreviewAnnotationsSnapshot);
          draft.setReviewComments(composerReviewCommentsSnapshot);
          const composer = deps.composer();
          if (composer && refs.currentRouteThreadKey.current === routeThreadKey) {
            refs.prompt.current = messageTextForSend;
            composer.resetCursorState({
              cursor: collapseExpandedComposerCursor(messageTextForSend, messageTextForSend.length),
              prompt: messageTextForSend,
              detectTrigger: true,
            });
          }
        }
      };
      if (failedSelections.length > 0) {
        if (canRestoreDraft() && deps.composer()) {
          restoreFailedDraft();
        } else if (clearedDraft) {
          const recoveryToastId = deps.toast.add({
            layout: "stacked",
            type: "error",
            title: "A background prompt could not be sent",
            description:
              "Your newer draft is unchanged. Restore the failed prompt when this composer is empty.",
            timeout: 0,
            action: {
              label: "Restore prompt",
              onClick: () => {
                if (
                  !draftId ||
                  !draft.getDraftSession(draftId) ||
                  refs.sendInFlight.current ||
                  composerDraftHasUserContent(draft.read())
                ) {
                  deps.toast.update(recoveryToastId, {
                    description:
                      "Return to the original draft and send or clear its current prompt before restoring.",
                  });
                  return;
                }
                restoreFailedDraft();
                deps.navigate({ kind: "draft", draftId });
                deps.toast.close(recoveryToastId);
              },
            },
          });
        }
      }
      if (!releasedComposer) {
        refs.sendInFlight.current = false;
        deps.localDispatch.reset();
      }
    }
    return {
      _tag: "MultipleStarted",
      startedCount,
      failedCount: failedSelections.length,
    };
  }
  const optimisticAttachments = composerAttachmentsSnapshot.map(
    (attachment): OptimisticAttachment =>
      attachment.type === "image"
        ? {
            type: "image",
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            previewUrl: attachment.previewUrl,
            ...(attachment.source ? { source: attachment.source } : {}),
          }
        : {
            type: "file",
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            downloadable: false,
            ...(attachment.source ? { source: attachment.source } : {}),
          },
  );
  const shouldAnchorFirstMessage =
    activeThread.latestTurn === null && !input.timelineHasUserMessage;
  if (shouldAnchorFirstMessage) {
    deps.timeline.anchorFirstMessage(
      scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
      messageIdForSend,
    );
  } else {
    deps.timeline.scrollToEnd();
  }
  deps.setOptimisticUserMessages((existing) => [
    ...existing,
    {
      id: messageIdForSend,
      role: "user",
      text: outgoingMessageText,
      ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
      ...(outgoingMessageContext !== undefined ? { context: outgoingMessageContext } : {}),
      turnId: null,
      createdAt: messageCreatedAt,
      updatedAt: messageCreatedAt,
      streaming: false,
    },
  ]);
  deps.setThreadError(threadIdForSend, null);
  if (expiredTerminalContextCount > 0) {
    const toastCopy = buildExpiredTerminalContextToastCopy(expiredTerminalContextCount, "omitted");
    deps.toast.add({
      layout: "stacked",
      type: "warning",
      title: toastCopy.title,
      description: toastCopy.description,
    });
  }
  refs.prompt.current = "";
  draft.clearContent();
  deps.composer()?.resetCursorState();

  const firstComposerImage = composerImagesSnapshot[0];
  const firstComposerFile = composerFilesSnapshot[0];
  const firstTerminalContext = composerTerminalContextsSnapshot[0];
  const firstReviewComment = composerReviewCommentsSnapshot[0];
  const firstPreviewAnnotation = composerPreviewAnnotationsSnapshot[0];
  let titleSeed = assistantCitationsToPlainText(stripInlineContextReferences(trimmed)).trim();
  if (!titleSeed) {
    if (firstComposerImage) {
      titleSeed = `Image: ${firstComposerImage.name}`;
    } else if (firstComposerFile) {
      titleSeed = `File: ${firstComposerFile.name}`;
    } else if (firstTerminalContext) {
      titleSeed = formatTerminalContextLabel(firstTerminalContext);
    } else if (firstReviewComment) {
      titleSeed = `Review: ${reviewCommentContextLabel(firstReviewComment)}`;
    } else if (firstPreviewAnnotation) {
      titleSeed = previewAnnotationContextLabel(firstPreviewAnnotation);
    } else {
      titleSeed = "New thread";
    }
  }
  const title = truncate(titleSeed);
  const threadCreateModelSelection = createModelSelection(
    ctxSelectedModelSelection.instanceId,
    ctxSelectedModel || input.projectDefaultModel || DEFAULT_MODEL,
    ctxSelectedModelSelection.options,
  );

  let failure: AtomCommandResult<unknown, unknown> | null = null;
  // Auto-title from first message
  if (isFirstMessage && input.isServerThread) {
    const titleResult = await deps.commands.updateMetadata({
      threadId: threadIdForSend,
      title,
    });
    if (titleResult._tag === "Failure") {
      failure = titleResult;
    }
  }

  if (failure === null && input.isServerThread) {
    const settingsResult = await persistThreadSettingsForNextTurn(
      input.serverThread,
      {
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
        ...(input.localCheckoutBranch !== null ? { branch: input.localCheckoutBranch } : {}),
        runtimeMode: input.runtimeMode,
        interactionMode: sendInteractionMode,
      },
      deps.commands,
    );
    if (settingsResult._tag === "Failure") {
      failure = settingsResult;
    }
  }

  const turnAttachmentsResult = await settlePromise(async () => {
    const turnAttachments = await turnAttachmentsPromise;
    const liveFileBlockReason = readLiveAttachmentCapabilities().fileBlockReason;
    if (liveFileBlockReason !== null) {
      throw new Error(liveFileBlockReason);
    }
    return turnAttachments;
  });
  if (failure === null && turnAttachmentsResult._tag === "Failure") {
    failure = turnAttachmentsResult;
  }

  let turnStartSucceeded = false;
  let backgroundDraftOpened = false;
  if (failure === null && turnAttachmentsResult._tag === "Success") {
    const bootstrap =
      input.isLocalDraftThread || baseBranchForWorktree
        ? {
            ...(input.isLocalDraftThread
              ? {
                  createThread: {
                    projectId: activeProject.id,
                    title,
                    modelSelection: threadCreateModelSelection,
                    runtimeMode: input.runtimeMode,
                    interactionMode: sendInteractionMode,
                    branch: activeThreadBranch,
                    worktreePath: activeThread.worktreePath,
                    createdAt: activeThread.createdAt,
                  },
                }
              : {}),
            ...(baseBranchForWorktree
              ? {
                  prepareWorktree: {
                    projectCwd: activeProject.workspaceRoot,
                    baseBranch: baseBranchForWorktree,
                    branch: buildTemporaryWorktreeBranchName(randomHex),
                    ...(input.startFromOrigin ? { startFromOrigin: true } : {}),
                  },
                  runSetupScript: true,
                }
              : {}),
          }
        : undefined;
    const backgroundThreadRef =
      resolvedSubmissionIntent === "background"
        ? scopeThreadRef(activeThread.environmentId, threadIdForSend)
        : null;
    if (backgroundThreadRef) {
      draft.beginBackgroundSubmission(backgroundThreadRef);
    }
    const turnAttachments = turnAttachmentsResult.value;
    const messageContextFields = () => {
      const context = buildOutgoingMessageContext(turnAttachmentIds(turnAttachments));
      if (context === undefined) return {};
      // Read the capability at dispatch time: the upload and persistence
      // awaits above can span a server reconnect that changes it. Servers
      // from before inline context drop the records and forward the links
      // as literal text, so their turns carry the payload the legacy way.
      const supportsInlineMessageContext =
        deps.attachments.readServerConfig()?.environment.capabilities.inlineMessageContext === true;
      if (!supportsInlineMessageContext) {
        return {
          text: serializeLegacyContextMessage({
            text: outgoingMessageText,
            records: context.records,
          }),
        };
      }
      return { context };
    };
    const startPromise = deps.commands.startTurn({
      threadId: threadIdForSend,
      message: {
        messageId: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        attachments: turnAttachments,
        ...messageContextFields(),
      },
      modelSelection: ctxSelectedModelSelection,
      titleSeed: title,
      runtimeMode: input.runtimeMode,
      interactionMode: sendInteractionMode,
      ...(bootstrap ? { bootstrap } : {}),
      createdAt: messageCreatedAt,
    });
    if (backgroundThreadRef) {
      draft.markPromoted(backgroundThreadRef);
      try {
        backgroundDraftOpened = Boolean(
          await deps.openFreshDraft(
            scopeProjectRef(activeProject.environmentId, activeProject.id),
            resolveBackgroundDraftWorkspaceOptions({
              envMode: input.envMode,
              branch: activeThreadBranch,
              startFromOrigin: input.startFromOrigin,
            }),
          ),
        );
      } catch (error) {
        draft.clearBackgroundSubmission(backgroundThreadRef);
        deps.toast.add({
          layout: "stacked",
          type: "warning",
          title: "Could not open a fresh composer",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }
    const startResult = await startPromise;
    if (startResult._tag === "Failure") {
      failure = startResult;
    } else {
      turnStartSucceeded = true;
      // The turn is under way and will spend quota, so that thread's limits
      // snapshot is stale. Uploads may have outlasted a navigation, so only
      // the sending thread's panel clears.
      deps.clearUsageLimitsFor(routeThreadKey);
      if (turnUsesAttachmentUploads) {
        deps.attachments.release(composerAttachmentsSnapshot);
      }
      deps.acknowledgeThreadWoke();
      if (backgroundThreadRef) {
        if (backgroundDraftOpened || refs.currentRouteThreadKey.current !== routeThreadKey) {
          draft.finalizePromoted(backgroundThreadRef);
        } else {
          draft.clearBackgroundSubmission(backgroundThreadRef);
        }
        if (backgroundDraftOpened) {
          deps.toast.add({
            layout: "stacked",
            type: "success",
            title: "Started in background",
            timeout: 5_000,
            action: {
              label: "Open",
              onClick: () => {
                deps.navigate({ kind: "thread", threadRef: backgroundThreadRef });
              },
            },
          });
        }
      }
    }
  }

  let failureMessage: string | null = null;
  if (failure !== null) {
    const draftThread = input.draftThread;
    if (resolvedSubmissionIntent === "background" && draftId && draftThread) {
      draft.restoreFailedBackgroundThread(
        draftId,
        draftThread,
        wasBootstrapThreadDeleted(squashAtomCommandFailure(failure))
          ? newThreadId()
          : threadIdForSend,
      );
      draft.clearBackgroundSubmission(scopeThreadRef(environmentId, threadIdForSend));
    }
    if (
      backgroundDraftOpened
        ? !composerDraftHasUserContent(draft.read())
        : refs.prompt.current.length === 0 &&
          refs.images.current.length === 0 &&
          refs.files.current.length === 0 &&
          refs.terminalContexts.current.length === 0 &&
          (draft.read()?.previewAnnotations.length ?? 0) === 0 &&
          (draft.read()?.reviewComments.length ?? 0) === 0
    ) {
      deps.setOptimisticUserMessages((existing) => {
        const removed = existing.filter((message) => message.id === messageIdForSend);
        for (const message of removed) {
          revokeUserMessagePreviewUrls(message);
        }
        const next = existing.filter((message) => message.id !== messageIdForSend);
        return next.length === existing.length ? existing : next;
      });
      refs.prompt.current = messageTextForSend;
      const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
      refs.images.current = retryComposerImages;
      refs.files.current = composerFilesSnapshot;
      refs.terminalContexts.current = composerTerminalContextsSnapshot;
      draft.setPrompt(messageTextForSend);
      draft.addImages(retryComposerImages);
      draft.addFiles(composerFilesSnapshot);
      draft.setTerminalContexts(composerTerminalContextsSnapshot);
      draft.setPreviewAnnotations(composerPreviewAnnotationsSnapshot);
      draft.setReviewComments(composerReviewCommentsSnapshot);
      deps.composer()?.resetCursorState({
        cursor: collapseExpandedComposerCursor(messageTextForSend, messageTextForSend.length),
        prompt: messageTextForSend,
        detectTrigger: true,
      });
    }
    if (!isAtomCommandInterrupted(failure)) {
      const error = squashAtomCommandFailure(failure);
      if (
        resolvedSubmissionIntent !== "background" &&
        input.isLocalDraftThread &&
        draftId &&
        wasBootstrapThreadDeleted(error)
      ) {
        const failedDraftSession = draft.getDraftSession(draftId);
        if (failedDraftSession?.threadId === threadIdForSend) {
          draft.setLogicalProjectDraftThreadId(
            failedDraftSession.logicalProjectKey,
            scopeProjectRef(failedDraftSession.environmentId, failedDraftSession.projectId),
            draftId,
            {
              threadId: newThreadId(),
              createdAt: new Date().toISOString(),
            },
          );
        }
      }
      failureMessage = error instanceof Error ? error.message : "Failed to send message.";
      deps.setThreadError(threadIdForSend, failureMessage);
      if (backgroundDraftOpened && draftId) {
        deps.toast.add({
          layout: "stacked",
          type: "error",
          title: "Background task failed",
          description: failureMessage,
          action: {
            label: "Open draft",
            onClick: () => {
              deps.navigate({ kind: "draft", draftId });
            },
          },
        });
      }
    }
  }
  refs.sendInFlight.current = false;
  if (!turnStartSucceeded) {
    deps.draftHero.undock(activeThreadKey);
    deps.localDispatch.reset();
  }
  return turnStartSucceeded
    ? { _tag: "Sent", threadId: threadIdForSend, messageId: messageIdForSend }
    : {
        _tag: "SendFailed",
        threadId: threadIdForSend,
        messageId: messageIdForSend,
        error: failureMessage,
      };
}
