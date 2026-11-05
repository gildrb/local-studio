import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  RuntimeMode,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  buildRunningThreadTurnInterruptInput,
  getAntigravitySendBlockReason,
  deriveComposerSendState,
  deriveLockedProvider,
  findRecordedWorktreeSetup,
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
  shouldShowPlanFollowUpPrompt,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import { resolveComposerOptionSelections } from "@t3tools/web/src/components/chat/composerProviderState.logic.ts";
import { resolveModelPickerTrigger } from "@t3tools/web/src/components/chat/modelPickerTrigger.logic.ts";
import { runtimeModeLabels } from "@t3tools/web/src/components/chat/runtimeModeLabels.ts";
import {
  resolveAwaitingBootstrapTurn,
  resolveThreadIsCompacting,
  resolveThreadIsWorking,
  resolveThreadTurnState,
} from "@t3tools/web/src/components/chat/threadRunState.logic.ts";
import {
  buildTraitsMenuModel,
  buildTraitsTriggerDisplay,
  getTraitsSectionVisibility,
  type TraitsMenuModel,
  type TraitsSectionVisibility,
} from "@t3tools/web/src/components/chat/TraitsPicker.logic.ts";
import {
  deriveEffectiveComposerModelState,
  type ComposerThreadDraftState,
  type DraftThreadState,
} from "@t3tools/web/src/composerDraftStore.ts";
import { resolveComposerPlaceholder } from "@t3tools/web/src/composerPlaceholder.ts";
import {
  getAppModelOptionsForInstance,
  type AppModelOption,
} from "@t3tools/web/src/modelSelection.ts";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "@t3tools/web/src/pendingUserInput.ts";
import {
  formatPendingPrimaryActionLabel,
  isPendingPrimaryActionDisabled,
  resolvePlanFollowUpPrimaryAction,
} from "@t3tools/web/src/components/chat/threadInteractions.logic.ts";
import {
  shouldUseCompactComposerFooter,
  shouldUseCompactComposerPrimaryActions,
} from "@t3tools/web/src/components/composerFooterLayout.ts";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
  shouldShowInstanceBadge,
  sortProviderInstanceEntries,
} from "@t3tools/web/src/providerInstances.ts";
import {
  derivePhase,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "@t3tools/web/src/session-logic.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import {
  type ChatMessage,
  DEFAULT_INTERACTION_MODE,
  type Project,
  type Thread,
} from "@t3tools/web/src/types.ts";

import type { ComposerView } from "./views/composer.ts";

export type ComposerGitStatus = {
  readonly isRepo: boolean | undefined;
  readonly refName: string | null;
};

const EMPTY_PENDING_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};

export type ComposerModelInput = {
  readonly thread: Thread;
  readonly project: Project | undefined;
  readonly serverConfig: ServerConfig | null;
  readonly clientSettings: ClientSettings;
  readonly draft: ComposerThreadDraftState | null;
};

export interface ComposerModelSelection {
  readonly entry: ProviderInstanceEntry;
  readonly instanceId: ProviderInstanceId;
  readonly selectedModel: string;
  readonly instanceModelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly pickerOptions: ReadonlyArray<AppModelOption>;
  readonly modelForPicker: string;
  readonly traitsVisibility: TraitsSectionVisibility;
}

export interface ComposerModelContext {
  readonly settings: UnifiedSettings;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selectedProviderEntry: ProviderInstanceEntry | undefined;
  readonly selectedProvider: ProviderDriverKind;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly lockedContinuationGroupKey: string | null;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly projectDefaultModelSelection: ModelSelection | null | undefined;
  readonly prompt: string;
  readonly selection: ComposerModelSelection | null;
  readonly interactionMode: ProviderInteractionMode;
  readonly interactionModeEnabled: boolean;
}

export function deriveComposerModelContext(input: ComposerModelInput): ComposerModelContext {
  const { thread, project, serverConfig, draft } = input;
  const providers = serverConfig?.providers ?? [];
  const settings = mergeEnvironmentSettings(
    serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
    input.clientSettings,
  );
  const projectSettings = resolveProjectSettings(settings, thread.projectId, project).settings;
  const projectDefaultModelSelection = projectSettings.defaultModelSelection;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const draftActiveProvider = draft?.activeProvider ?? null;
  const lockedProvider = deriveLockedProvider({
    thread,
    selectedProvider: draftActiveProvider,
    threadProvider:
      thread.modelSelection.instanceId ?? projectDefaultModelSelection?.instanceId ?? null,
    providers,
  });
  const { selectedProviderEntry, requestedDriverKind, lockedContinuationGroupKey } =
    resolveComposerProviderSelection({
      entries,
      candidateInstanceIds: [
        draftActiveProvider,
        thread.session?.providerInstanceId,
        thread.modelSelection.instanceId,
        projectDefaultModelSelection?.instanceId,
      ],
      lockedProvider,
      lockedInstanceId: thread.session?.providerInstanceId ?? thread.modelSelection.instanceId,
    });
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const prompt = draft?.prompt ?? "";
  const selection =
    selectedProviderEntry === undefined
      ? null
      : ((): ComposerModelSelection => {
          const instanceId = selectedProviderEntry.instanceId;
          const { modelOptions, selectedModel } = deriveEffectiveComposerModelState({
            draft,
            providers,
            selectedProvider,
            selectedInstanceId: instanceId,
            threadModelSelection: thread.modelSelection,
            projectModelSelection: projectDefaultModelSelection,
            settings,
          });
          const models = selectedProviderEntry.models;
          const { selections } = resolveComposerOptionSelections(
            models,
            selectedModel,
            selectedProvider,
            modelOptions?.[instanceId],
            settings.planModeEnabled,
          );
          const pickerOptions = getAppModelOptionsForInstance(
            settings,
            selectedProviderEntry,
            selectedModel,
          );
          return {
            entry: selectedProviderEntry,
            instanceId,
            selectedModel,
            instanceModelOptions: modelOptions?.[instanceId],
            pickerOptions,
            modelForPicker: pickerOptions.some((option) => option.slug === selectedModel)
              ? selectedModel
              : (normalizeModelSlug(selectedModel, selectedProvider) ?? selectedModel),
            traitsVisibility: getTraitsSectionVisibility({
              provider: selectedProvider,
              models,
              model: selectedModel,
              prompt,
              modelOptions: selections,
              planModeEnabled: settings.planModeEnabled,
            }),
          };
        })();
  const { enabled: interactionModeEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: selectedProviderEntry?.snapshot ?? null,
    interactionMode: draft?.interactionMode ?? thread.interactionMode ?? DEFAULT_INTERACTION_MODE,
  });
  const modelOptionsByInstance = new Map(
    entries.map((entry) => [
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selection?.instanceId ? selection.selectedModel : null,
      ),
    ]),
  );
  return {
    settings,
    entries,
    providers,
    selectedProviderEntry,
    selectedProvider,
    lockedProvider,
    lockedContinuationGroupKey,
    modelOptionsByInstance,
    projectDefaultModelSelection,
    prompt,
    selection,
    interactionMode,
    interactionModeEnabled,
  };
}

export type ComposerPendingDraft = {
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
  readonly questionIndex: number;
};

const EMPTY_PENDING_DRAFT: ComposerPendingDraft = {
  answers: EMPTY_PENDING_ANSWERS,
  questionIndex: 0,
};

export function deriveComposerTurnState(
  thread: Thread,
  draft: ComposerThreadDraftState | null,
  interactionMode: ProviderInteractionMode,
  pendingDraft: ComposerPendingDraft = EMPTY_PENDING_DRAFT,
) {
  const phase = derivePhase(thread.session ?? null);
  const { activeLatestTurn } = resolveThreadTurnState(thread);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, thread.session ?? null);
  const { approvals, userInputs } = derivePendingRequests(thread.activities);
  const activePendingUserInput = userInputs[0] ?? null;
  const activePendingProgress = activePendingUserInput
    ? derivePendingUserInputProgress(
        activePendingUserInput.questions,
        pendingDraft.answers,
        pendingDraft.questionIndex,
      )
    : null;
  const activeProposedPlan = latestTurnSettled
    ? findLatestProposedPlan(thread.proposedPlans, activeLatestTurn?.turnId ?? null)
    : null;
  const hasAttachments = (draft?.images.length ?? 0) > 0 || (draft?.files.length ?? 0) > 0;
  const showPlanFollowUpPrompt = shouldShowPlanFollowUpPrompt({
    pendingUserInputCount: userInputs.length,
    interactionMode,
    latestTurnSettled,
    hasActionableProposedPlan: hasActionableProposedPlan(activeProposedPlan),
    hasComposerAttachments: hasAttachments,
  });
  return {
    phase,
    activeLatestTurn,
    approvals,
    userInputs,
    activePendingUserInput,
    activePendingProgress,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  };
}

export function buildComposerView(
  input: ComposerModelInput & {
    readonly threadKey: string;
    readonly promptRevision: number;
    readonly isSendBusy: boolean;
    readonly optimisticUserMessages: ReadonlyArray<ChatMessage>;
    readonly threadError: string | null;
    readonly providerInputError: string | null;
    readonly pendingDraft: ComposerPendingDraft;
    readonly pendingUserInputResponding: boolean;
    readonly environmentUnavailable: boolean;
    readonly isServerThread: boolean;
    readonly draftThread: DraftThreadState | null;
    readonly composerWidth: number | null;
  },
): ComposerView {
  const { thread, project, serverConfig, draft } = input;
  const {
    settings,
    entries,
    selectedProviderEntry,
    selectedProvider,
    prompt,
    selection,
    interactionMode,
  } = deriveComposerModelContext(input);
  const noProviderAvailable = selectedProviderEntry === undefined;
  const showProviderUnavailable = noProviderAvailable && serverConfig !== null;
  let model: ComposerView["model"] =
    noProviderAvailable && serverConfig === null
      ? {
          label: resolveModelPickerTrigger({
            driverKind: undefined,
            model: thread.modelSelection.model,
            options: [],
          }).title,
          driverKind: null,
          initials: "",
          accentColor: null,
          showInstanceBadge: false,
        }
      : null;
  let traits: string | null = null;
  let traitsMenu: TraitsMenuModel | null = null;
  if (selection !== null) {
    const { entry, modelForPicker, pickerOptions, traitsVisibility } = selection;
    const trigger = resolveModelPickerTrigger({
      driverKind: entry.driverKind,
      model: modelForPicker,
      options: pickerOptions,
    });
    model = {
      label: trigger.title,
      driverKind: entry.driverKind,
      initials: providerInstanceInitials(entry.displayName),
      accentColor: entry.accentColor ?? null,
      showInstanceBadge: shouldShowInstanceBadge(entry, entries),
    };
    if (traitsVisibility.hasAnyControls) {
      traits = buildTraitsTriggerDisplay({
        provider: selectedProvider,
        descriptors: traitsVisibility.descriptors,
        primarySelectDescriptorId: traitsVisibility.primarySelectDescriptor?.id ?? null,
        ultrathinkPromptControlled: traitsVisibility.ultrathinkPromptControlled,
      }).label;
    }
    traitsMenu = buildTraitsMenuModel(traitsVisibility);
  }

  const runtimeMode = draft?.runtimeMode ?? thread.runtimeMode;

  const {
    phase,
    activeLatestTurn,
    approvals,
    activePendingProgress,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  } = deriveComposerTurnState(thread, draft, interactionMode, input.pendingDraft);
  const approvalPending = approvals.length > 0;
  const choiceOnly = activePendingProgress?.activeQuestion?.allowCustomAnswer === false;
  const placeholder = resolveComposerPlaceholder({
    approvalPending,
    pendingQuestion: activePendingProgress ? { choiceOnly } : null,
    planFollowUp: Boolean(showPlanFollowUpPrompt && activeProposedPlan),
    projectSelectionRequired:
      !input.isServerThread && input.draftThread !== null && project === undefined,
    providerUnavailable: showProviderUnavailable,
    disconnected: phase === "disconnected",
  });
  const isSendDisabled =
    selection !== null &&
    getAntigravitySendBlockReason(selection.entry.snapshot, selection.selectedModel) !== null;
  const hasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const compact =
    shouldUseCompactComposerFooter(input.composerWidth, { hasWideActions }) &&
    shouldUseCompactComposerPrimaryActions(input.composerWidth, { hasWideActions });
  const pendingAction: ComposerView["pendingAction"] =
    activePendingProgress === null
      ? null
      : {
          compact,
          showPrevious: activePendingProgress.questionIndex > 0,
          label: formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: activePendingProgress.isLastQuestion,
            isResponding: input.pendingUserInputResponding,
            questionIndex: activePendingProgress.questionIndex,
          }),
          disabled: isPendingPrimaryActionDisabled({
            isEnvironmentUnavailable: input.environmentUnavailable,
            isResponding: input.pendingUserInputResponding,
            isLastQuestion: activePendingProgress.isLastQuestion,
            isComplete: activePendingProgress.isComplete,
            canAdvance: activePendingProgress.canAdvance,
          }),
          previousDisabled: input.pendingUserInputResponding,
        };
  const planAction: ComposerView["planAction"] =
    pendingAction === null && showPlanFollowUpPrompt
      ? {
          compact,
          ...resolvePlanFollowUpPrimaryAction({
            promptHasText: prompt.trim().length > 0,
            isSendBusy: input.isSendBusy,
            isSendDisabled,
            isConnecting: false,
            isEnvironmentUnavailable: input.environmentUnavailable,
          }),
        }
      : null;

  const working = resolveThreadIsWorking({
    phase,
    isSendBusy: input.isSendBusy,
    isConnecting: false,
    isRevertingCheckpoint: false,
    isCompacting: resolveThreadIsCompacting({
      thread,
      activeLatestTurn,
      phase,
      isSendBusy: input.isSendBusy,
      optimisticUserMessages: input.optimisticUserMessages,
    }),
    awaitingBootstrapTurn: resolveAwaitingBootstrapTurn({
      serverThread: thread,
      routeThreadId: thread.id,
      recordedWorktreeSetup: findRecordedWorktreeSetup(thread.activities, thread.id),
    }),
  });

  const { hasSendableContent } = deriveComposerSendState({
    prompt,
    imageCount: (draft?.images.length ?? 0) + (draft?.files.length ?? 0),
    terminalContexts: draft?.terminalContexts ?? [],
    elementContextCount:
      (draft?.previewAnnotations.length ?? 0) + (draft?.reviewComments.length ?? 0),
  });

  return {
    threadKey: input.threadKey,
    placeholder,
    prompt: approvalPending
      ? ""
      : activePendingProgress
        ? activePendingProgress.customAnswer
        : prompt,
    promptRevision: input.promptRevision,
    threadError: input.threadError,
    providerInputError: input.providerInputError,
    approvalPending,
    editorDisabled: approvalPending || choiceOnly || input.pendingUserInputResponding,
    pendingAction,
    planAction,
    hasSendableContent,
    running: phase === "running",
    canInterrupt: buildRunningThreadTurnInterruptInput(thread, phase) !== null,
    working,
    model,
    traits,
    traitsMenu,
    access: { mode: runtimeMode, label: runtimeModeLabels[runtimeMode].label },
    accessOptions: RuntimeMode.literals.map((mode) => ({
      mode,
      label: runtimeModeLabels[mode].label,
      description: runtimeModeLabels[mode].description,
    })),
  };
}
