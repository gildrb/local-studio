import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { hostPreviewMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import {
  resolveProviderSkillSourceKind,
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import {
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type PullRequestDetail,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import {
  classifyComposerAttachmentIntake,
  fileAttachmentStagingLimit,
  planComposerAttachmentUploads,
} from "@t3tools/web/src/components/chat/composerAttachmentFiles.ts";
import { hasAvailableCompactionProvider } from "@t3tools/web/src/components/chat/ContextWindowMeter.logic.ts";
import { interactionModeControlLabels } from "@t3tools/web/src/components/chat/runtimeModeLabels.ts";
import { resolveThreadCompactAvailability } from "@t3tools/web/src/components/chat/threadRunState.logic.ts";
import {
  buildComposerMenuItems,
  COMPOSER_PULL_REQUEST_QUERY_DEBOUNCE_MS,
  COMPOSER_TRIGGER_LIST_LABELS,
  composerCommandMenuStatusText,
  composerMenuEmptyStateText,
  composerMenuSearchKey,
  composerPullRequestListHasNumber,
  composerPullRequestListInput,
  composerPullRequestTextQuery,
  composerPullRequestTriggerNumber,
  composerSkillSourceBadgeLabel,
  extendReplacementRangeForTrailingSpace,
  isComposerCompactSlashCommandAvailable,
  nextComposerMenuHighlightId,
  planComposerItemSelection,
  resolveComposerTriggerAfterDismissal,
  type ComposerCommandItem,
  type ComposerMenuItemsInput,
} from "@t3tools/web/src/components/chat/composerTriggers.logic.ts";
import { resolveComposerMenuActiveItemId } from "@t3tools/web/src/components/chat/composerMenuHighlight.ts";
import { pullRequestStateKey } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import { detectComposerTrigger, type ComposerTrigger } from "@t3tools/web/src/composer-logic.ts";
import {
  composerFileNeedsReattach,
  useComposerDraftStore,
  type ComposerImageAttachment,
} from "@t3tools/web/src/composerDraftStore.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import {
  collectInlineContextIds,
  formatInlineContextReference,
  insertInlineContextReference,
  stripInlineContextReferences,
  type ComposerContextReference,
} from "@t3tools/web/src/lib/composerContextReferences.ts";
import {
  fileContextReference,
  imageContextReference,
  terminalContextReference,
} from "@t3tools/web/src/lib/composerContextRecords.ts";
import type { TerminalContextSelection } from "@t3tools/web/src/lib/terminalContext.ts";
import {
  resolveRestingComposerControlsLayout,
  shouldUseCompactComposerFooter,
} from "@t3tools/web/src/components/composerFooterLayout.ts";
import {
  attachmentUploadStatusSuffix,
  formatAttachmentUploadProgress,
} from "@t3tools/web/src/lib/attachmentUploadState.ts";
import {
  isHeicImageFile,
  prepareImageForAttachment,
} from "@t3tools/web/src/lib/imageCompression.ts";
import {
  COMPOSER_PATH_SEARCH_LIMIT,
  PROJECT_PATH_SEARCH_DEBOUNCE_MS,
} from "@t3tools/web/src/state/pathSearch.logic.ts";
import {
  getPendingSnapShotAnimations,
  pendingSnapShotAnimationIdsForTarget,
  shouldAnimateSnapShotArrival,
  subscribeToPendingSnapShotAnimations,
} from "@t3tools/web/src/lib/snapShotAnimation.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { composerFormWidthAtom } from "../composerLayout.ts";
import { buildComposerPromptTokens, composerPathIcon } from "../composerTokens.ts";
import { deriveComposerModelContext, deriveComposerTurnState } from "../composerView.ts";
import type { CoreFeature, FeatureContext, ThreadInput } from "../feature.ts";
import { corePullRequestQueries, threadPullRequestScope } from "../pullRequests.ts";
import { composerImagePreviewPath } from "../snapShotPreviews.ts";
import { snapShotView } from "../timelineUserRow.ts";
import type {
  ComposerEditView,
  ComposerInputView,
  ComposerMenuItemView,
  ComposerMenuView,
  ComposerTokenView,
} from "../views/composerInput.ts";

const MENU_LIST_ID = "composer-suggestions";

const SKILL_SOURCE_ASSETS: Readonly<Record<ProviderSkillSourceKind, string>> = {
  app: "icons/blocks.svg",
  repo: "icons/folder.svg",
  project: "icons/folder.svg",
  personal: "icons/user-round.svg",
  system: "icons/settings.svg",
  other: "icons/package.svg",
};

const decodeCaret = Schema.decodeUnknownSync(
  Schema.Struct({ text: Schema.String, cursor: Schema.Number }),
);
const decodeItem = Schema.decodeUnknownSync(
  Schema.Struct({ itemId: Schema.NullOr(Schema.String) }),
);
const decodeSeq = Schema.decodeUnknownSync(Schema.Struct({ seq: Schema.Number }));
const decodeMove = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.Literals(["ArrowDown", "ArrowUp"]) }),
);
const decodeFiles = Schema.decodeUnknownSync(
  Schema.Struct({
    files: Schema.Array(Schema.Struct({ path: Schema.String, name: Schema.NullOr(Schema.String) })),
  }),
);
const decodeId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const decodeFooterMeasure = Schema.decodeUnknownSync(
  Schema.Struct({
    formWidth: Schema.Number,
    hostWidth: Schema.Number,
    gap: Schema.Number,
    naturalFixedWidth: Schema.Number,
    minimumFixedWidth: Schema.Number,
    blockWidths: Schema.Array(Schema.Number),
    iconOnlyBlockWidths: Schema.Array(Schema.Number),
    overflowWidth: Schema.Number,
  }),
);

type FooterLayout = {
  readonly hiddenCount: number;
  readonly iconOnlyCount: number;
  readonly visible: boolean;
};

export type ComposerInputService = {
  readonly addTerminalContext: (selection: TerminalContextSelection) => void;
  readonly focus: () => void;
  /** Start uploads for the current composer's newly attached images. */
  readonly startUploads: () => void;
};

const services = new WeakMap<FeatureContext, ComposerInputService>();

export function composerInputService(context: FeatureContext): ComposerInputService {
  const service = services.get(context);
  if (service === undefined) throw new Error("The composer input feature is not registered.");
  return service;
}

type TriggerState = {
  readonly threadKey: string | null;
  readonly text: string;
  readonly cursor: number;
  readonly trigger: ComposerTrigger | null;
  readonly dismissed: ComposerTrigger | null;
  readonly highlightedItemId: string | null;
  readonly highlightedSearchKey: string | null;
  readonly debouncedPathQuery: string | null;
  readonly debouncedPullRequestText: string | null;
  readonly debouncedPullRequestNumber: number | null;
};

const EMPTY_TRIGGER_STATE: TriggerState = {
  threadKey: null,
  text: "",
  cursor: 0,
  trigger: null,
  dismissed: null,
  highlightedItemId: null,
  highlightedSearchKey: null,
  debouncedPathQuery: null,
  debouncedPullRequestText: null,
  debouncedPullRequestNumber: null,
};

type MenuModel = {
  readonly input: ThreadInput;
  readonly trigger: ComposerTrigger;
  readonly items: ReadonlyArray<ComposerCommandItem>;
  readonly activeItemId: string | null;
  readonly isLoading: boolean;
  readonly emptyStateText: string;
  readonly planModeUiEnabled: boolean;
};

type PendingEdit = Omit<ComposerEditView, "seq">;

function skillBadge(item: ComposerCommandItem, trigger: ComposerTrigger) {
  if (item.type !== "skill") return null;
  const kind = resolveProviderSkillSourceKind(item.skill);
  return {
    label: composerSkillSourceBadgeLabel(kind, trigger.kind === "skill"),
    asset: SKILL_SOURCE_ASSETS[kind],
  };
}

function menuItemView(item: ComposerCommandItem, trigger: ComposerTrigger): ComposerMenuItemView {
  const slashSkill = trigger.kind === "slash-command" && item.type === "skill";
  return {
    id: item.id,
    label: slashSkill ? item.label.slice("/skill:".length) : item.label,
    labelPrefix: slashSkill ? "/skill:" : null,
    description: item.description,
    icon:
      item.type === "path"
        ? composerPathIcon(item.path, item.pathKind)
        : item.type === "pull-request"
          ? { kind: "pull-request", state: pullRequestStateKey(item.pullRequest) }
          : null,
    badge: skillBadge(item, trigger),
  };
}

function insertionTokens(
  text: string,
  input: ThreadInput,
  skills: ReadonlyArray<ServerProviderSkill>,
): ComposerTokenView[] {
  return buildComposerPromptTokens(text, {
    skills,
    images: input.draft?.images ?? [],
    files: input.draft?.files ?? [],
    reviewComments: input.draft?.reviewComments ?? [],
    terminalContexts: input.draft?.terminalContexts ?? [],
    previewAnnotations: input.draft?.previewAnnotations ?? [],
  });
}

export function createComposerInputFeature(context: FeatureContext): CoreFeature {
  const { registry, state, threadInputAtom, gitStatusAtom } = context;
  const store = () => useComposerDraftStore.getState();
  const triggerAtom = Atom.make<TriggerState>(EMPTY_TRIGGER_STATE).pipe(Atom.keepAlive);
  const editAtom = Atom.make<ComposerEditView | null>(null).pipe(Atom.keepAlive);
  const footerAtom = Atom.make<FooterLayout>({
    hiddenCount: 0,
    iconOnlyCount: 0,
    visible: true,
  }).pipe(Atom.keepAlive);
  const focusSeqAtom = Atom.make(0).pipe(Atom.keepAlive);
  const uploadsAtom = Atom.make((get) => {
    get.addFinalizer(
      context.attachmentUploads.store.subscribe((value) => get.setSelf(value.uploadsByImageId)),
    );
    return context.attachmentUploads.store.getState().uploadsByImageId;
  });
  const pendingSnapShotsAtom = Atom.make((get) => {
    get.addFinalizer(
      subscribeToPendingSnapShotAnimations(() => get.setSelf(getPendingSnapShotAnimations())),
    );
    return getPendingSnapShotAnimations();
  });
  const imagePaths = new WeakMap<File, string>();
  let editSeq = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pullRequestTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPullRequestQuery: { text: string | null; number: number | null } = {
    text: null,
    number: null,
  };
  const appliedEffects = new Map<number, () => void>();

  const providerSkills = (input: ThreadInput, gitCwd: string | null) => {
    const snapshot = deriveComposerModelContext(input).selectedProviderEntry?.snapshot ?? null;
    return {
      skills: snapshot === null ? [] : resolveProviderSkillsForCwd(snapshot, gitCwd),
      slashCommands: snapshot === null ? [] : resolveProviderSlashCommandsForCwd(snapshot, gitCwd),
    };
  };
  const currentSkills = (input: ThreadInput) =>
    providerSkills(input, registry.get(gitStatusAtom)?.gitCwd ?? null).skills;

  const currentInput = (): ThreadInput => {
    const input = registry.get(threadInputAtom);
    if (input === null) throw new Error("The composer needs an open thread.");
    return input;
  };

  const updateTrigger = (update: (current: TriggerState) => TriggerState) =>
    registry.set(triggerAtom, update(registry.get(triggerAtom)));

  const scheduleEdit = (edit: PendingEdit) => {
    editSeq += 1;
    registry.set(editAtom, { seq: editSeq, ...edit });
  };

  const menuModelAtom = Atom.make((get): MenuModel | null => {
    const input = get(threadInputAtom);
    if (input === null) return null;
    const threadKey = scopedThreadKey(input.route);
    const triggerState = get(triggerAtom);
    const trigger = triggerState.trigger;
    if (triggerState.threadKey !== threadKey || trigger === null) return null;
    const context = deriveComposerModelContext(input);
    const turn = deriveComposerTurnState(input.thread, input.draft, context.interactionMode);
    if (turn.approvals.length > 0) return null;
    const gitCwd = get(gitStatusAtom)?.gitCwd ?? null;
    const snapshot = context.selectedProviderEntry?.snapshot ?? null;
    let pathEntries: ReadonlyArray<{ path: string; kind: "file" | "directory" }> = [];
    let pathPending = false;
    if (trigger.kind === "path") {
      const query = trigger.query.trim();
      const debounced = triggerState.debouncedPathQuery;
      pathPending = query !== debounced;
      if (debounced !== null && debounced.length > 0 && gitCwd !== null) {
        const result = get(
          state.projectEnvironment.searchEntries({
            environmentId: input.thread.environmentId,
            input: { cwd: gitCwd, query: debounced, limit: COMPOSER_PATH_SEARCH_LIMIT },
          }),
        );
        pathEntries = Option.getOrNull(AsyncResult.value(result))?.entries ?? [];
        pathPending = pathPending || result.waiting;
      }
    }
    const scope = threadPullRequestScope(input);
    let pullRequest: ComposerMenuItemsInput["pullRequest"] = null;
    let pullRequestPending = false;
    let pullRequestReadFailed = false;
    if (trigger.kind === "pull-request" && scope.projectId !== null) {
      const environmentId = input.thread.environmentId;
      const textQuery = composerPullRequestTextQuery(trigger);
      const settledText = textQuery === triggerState.debouncedPullRequestText ? textQuery : null;
      const number = composerPullRequestTriggerNumber(trigger);
      const settledNumber = number === triggerState.debouncedPullRequestNumber ? number : null;
      const list =
        textQuery !== null && settledText === null
          ? null
          : get(
              corePullRequestQueries(state).listAtom([
                {
                  environmentId,
                  input: composerPullRequestListInput(scope.projectId, settledText),
                },
              ]),
            );
      const entries = list?.data?.entries ?? [];
      pullRequestReadFailed =
        (list?.error ?? null) !== null ||
        (list?.data?.errors.some((error) => error.projectId === scope.projectId) ?? false);
      let exactPending = false;
      let exactPullRequest: PullRequestDetail | null = null;
      if (
        settledNumber !== null &&
        scope.repository !== null &&
        !composerPullRequestListHasNumber({
          entries,
          projectId: scope.projectId,
          repository: scope.repository,
          number: settledNumber,
        })
      ) {
        const result = get(
          state.pullRequestEnvironment.detail({
            environmentId,
            input: {
              projectId: scope.projectId,
              repository: scope.repository,
              number: settledNumber,
            },
          }),
        );
        exactPending = result.waiting;
        exactPullRequest = Option.getOrNull(AsyncResult.value(result));
      }
      if (scope.repository !== null) {
        pullRequestPending =
          (list?.isPending ?? false) ||
          textQuery !== triggerState.debouncedPullRequestText ||
          number !== triggerState.debouncedPullRequestNumber ||
          exactPending;
        pullRequest = {
          projectId: scope.projectId,
          repository: scope.repository,
          triggerNumber: number,
          exactPullRequest,
          listEntries: entries,
          listProviders: list?.data?.providers ?? [],
        };
      }
    }
    const draft = input.draft;
    const compact = resolveThreadCompactAvailability({
      thread: input.thread,
      hasProject: input.project !== undefined,
      isServerThread: input.isServerThread,
      manualCompactionProviderAvailable: hasAvailableCompactionProvider({
        providers: context.entries,
        driverKind: context.selectedProvider,
        instanceId: context.selection?.instanceId ?? null,
        lockedInstanceId: context.lockedProvider
          ? (input.thread.session?.providerInstanceId ??
            input.thread.modelSelection.instanceId ??
            null)
          : null,
      }),
      isWorking: turn.phase === "running",
      threadDetailLoading: false,
      isPreparingWorktree: false,
      environmentUnavailable: false,
      feedbackUploading: false,
      pendingApprovalCount: turn.approvals.length,
      pendingUserInputCount: turn.userInputs.length,
      showPlanFollowUpPrompt: turn.showPlanFollowUpPrompt,
    });
    const items = buildComposerMenuItems({
      trigger,
      pathEntries,
      planModeUiEnabled: context.interactionModeEnabled,
      selectedProvider: context.selectedProvider,
      selectedProviderSkills:
        snapshot === null ? [] : resolveProviderSkillsForCwd(snapshot, gitCwd),
      selectedProviderSlashCommands:
        snapshot === null ? [] : resolveProviderSlashCommandsForCwd(snapshot, gitCwd),
      showSkillsInSlashMenu: context.settings.showSkillsInSlashMenu,
      compactSlashCommandAvailable: isComposerCompactSlashCommandAvailable({
        trigger,
        prompt: triggerState.text,
        compactThreadUnavailable: compact.unavailable,
        attachmentCount:
          (draft?.images.length ?? 0) +
          (draft?.files.length ?? 0) +
          (draft?.persistedAttachments.length ?? 0) +
          (draft?.terminalContexts.length ?? 0) +
          (draft?.previewAnnotations.length ?? 0) +
          (draft?.reviewComments.length ?? 0),
      }),
      pullRequest,
    });
    return {
      input,
      trigger,
      items,
      activeItemId: resolveComposerMenuActiveItemId({
        items,
        highlightedItemId: triggerState.highlightedItemId,
        currentSearchKey: composerMenuSearchKey(MENU_LIST_ID, trigger),
        highlightedSearchKey: triggerState.highlightedSearchKey,
      }),
      isLoading:
        (trigger.kind === "path" && trigger.query.length > 0 && pathPending) ||
        (trigger.kind === "pull-request" && pullRequest !== null && pullRequestPending),
      emptyStateText: composerMenuEmptyStateText({
        triggerKind: trigger.kind,
        query: trigger.query,
        pullRequestScopeAvailable: scope.projectId !== null && scope.repository !== null,
        pullRequestReadFailed,
      }),
      planModeUiEnabled: context.interactionModeEnabled,
    };
  });

  const menuView = (model: MenuModel): ComposerMenuView => ({
    triggerKind: model.trigger.kind,
    listLabel: COMPOSER_TRIGGER_LIST_LABELS[model.trigger.kind],
    items: model.items.map((item) => menuItemView(item, model.trigger)),
    activeItemId: model.activeItemId,
    statusText:
      model.items.length > 0
        ? null
        : composerCommandMenuStatusText({
            isLoading: model.isLoading,
            triggerKind: model.trigger.kind,
            emptyStateText: model.emptyStateText,
          }),
  });

  const previewPath = (image: ComposerImageAttachment) => composerImagePreviewPath(context, image);
  const clientSettingsAtom = context.clientSettingsAtom;
  const viewAtom = Atom.make((get): ComposerInputView | null => {
    const input = get(threadInputAtom);
    if (input === null) return null;
    const threadKey = scopedThreadKey(input.route);
    const context = deriveComposerModelContext(input);
    const prompt = input.draft?.prompt ?? "";
    const { skills } = providerSkills(input, get(gitStatusAtom)?.gitCwd ?? null);
    const turn = deriveComposerTurnState(input.thread, input.draft, context.interactionMode);
    const footer = get(footerAtom);
    const uploads = get(uploadsAtom);
    const uploadSuffixes: Record<string, string> = {};
    for (const attachment of [...(input.draft?.images ?? []), ...(input.draft?.files ?? [])]) {
      const suffix =
        attachment.type === "file" && composerFileNeedsReattach(attachment)
          ? "attach again"
          : attachmentUploadStatusSuffix(uploads[attachment.id]);
      if (suffix !== null) uploadSuffixes[attachment.id] = suffix;
    }
    const model = get(menuModelAtom);
    const edit = get(editAtom);
    const interactionMode = context.interactionMode === "plan" ? "plan" : "default";
    const draftImages = (input.draft?.images ?? []).filter(
      (image) => !(input.draft?.previewAnnotations ?? []).some((a) => a.id === image.id),
    );
    const snapShotTarget = input.isServerThread ? input.route : input.draftId;
    const pendingSnapShotIds =
      snapShotTarget === null
        ? []
        : pendingSnapShotAnimationIdsForTarget(get(pendingSnapShotsAtom), snapShotTarget);
    const animateSnapShots = get(clientSettingsAtom).snapShotAnimations;
    return {
      threadKey,
      prompt,
      tokens: insertionTokens(prompt, input, skills),
      uploadSuffixes,
      menu: model === null ? null : menuView(model),
      edit: edit !== null && edit.threadKey === threadKey ? edit : null,
      images: draftImages.map((image) => {
        const source = image.source?.kind === "snap-shot" ? image.source : null;
        const animationPending = source !== null && pendingSnapShotIds.includes(image.id);
        const upload =
          input.serverConfig?.environment.capabilities.attachmentUploads === true
            ? uploads[image.id]
            : undefined;
        return {
          id: image.id,
          name: image.name,
          path: previewPath(image),
          snapShot: source === null ? null : snapShotView(source),
          animationPending,
          animateArrival:
            source !== null &&
            animateSnapShots &&
            !animationPending &&
            shouldAnimateSnapShotArrival(source.capturedAt),
          upload:
            upload?.status === "uploading"
              ? { kind: "uploading", label: formatAttachmentUploadProgress(upload.progress) }
              : upload?.status === "failed"
                ? {
                    kind: "failed",
                    reason: upload.reason,
                    retryAriaLabel: `Retry upload for ${image.name}`,
                  }
                : null,
        };
      }),
      pendingSnapShots: pendingSnapShotIds.filter(
        (id) => !(input.draft?.images ?? []).some((image) => image.id === id),
      ),
      snapShotShelf:
        pendingSnapShotIds.length > 0 ||
        draftImages.some((image) => image.source?.kind === "snap-shot"),
      interactionMode: context.interactionModeEnabled
        ? { mode: interactionMode, ...interactionModeControlLabels[interactionMode] }
        : null,
      canAttach: attachmentStagingLimit(input) !== null,
      footer: {
        ...footer,
        compact: shouldUseCompactComposerFooter(get(composerFormWidthAtom), {
          hasWideActions: turn.showPlanFollowUpPrompt || turn.activePendingProgress !== null,
        }),
      },
      focusSeq: get(focusSeqAtom),
    };
  });

  const attachmentStagingLimit = (input: ThreadInput) => {
    const config = input.serverConfig;
    return fileAttachmentStagingLimit({
      attachmentUploadsCapabilityKnown: config !== null,
      supportsAttachmentUploads: config?.environment.capabilities.attachmentUploads === true,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
    });
  };

  const changeInteractionMode = (input: ThreadInput, mode: "plan" | "default") => {
    const { interactionMode, interactionModeEnabled } = deriveComposerModelContext(input);
    if (mode === "plan" && !interactionModeEnabled) return;
    if (mode === interactionMode) return;
    store().setInteractionMode(input.route, mode);
    if (input.draftId !== null) {
      store().setDraftThreadContext(input.draftId, { interactionMode: mode });
    }
  };

  const startUploads = (input: ThreadInput) => {
    const draft = store().getComposerDraft(input.route);
    const config = input.serverConfig;
    const plan = planComposerAttachmentUploads({
      attachmentUploadsCapabilityKnown: config !== null,
      supportsAttachmentUploads: config?.environment.capabilities.attachmentUploads === true,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
      images: draft?.images ?? [],
      files: draft?.files ?? [],
    });
    for (const attachment of plan.release) {
      context.attachmentUploads.releaseAttachmentUpload(attachment.id);
    }
    for (const attachment of plan.start) {
      context.attachmentUploads.startAttachmentUpload({
        environmentId: input.thread.environmentId,
        image: attachment,
        draftTarget: input.draftId ?? input.route,
      });
    }
  };

  const insertReferences = (
    input: ThreadInput,
    references: ReadonlyArray<ComposerContextReference>,
  ) => {
    if (references.length === 0) return;
    const triggerState = registry.get(triggerAtom);
    const threadKey = scopedThreadKey(input.route);
    const prompt =
      triggerState.threadKey === threadKey ? triggerState.text : (input.draft?.prompt ?? "");
    const cursor =
      triggerState.threadKey === threadKey
        ? Math.min(triggerState.cursor, prompt.length)
        : prompt.length;
    const text = `${references.map(formatInlineContextReference).join(" ")} `;
    const needsLeadingSpace = cursor > 0 && !/\s/.test(prompt[cursor - 1] ?? "");
    const rangeEnd = extendReplacementRangeForTrailingSpace(prompt, cursor, text);
    const replacement = needsLeadingSpace ? ` ${text}` : text;
    const fresh = currentInput();
    scheduleEdit({
      threadKey,
      rangeStart: cursor,
      rangeEnd,
      expectedText: prompt.slice(cursor, rangeEnd),
      text: replacement,
      tokens: insertionTokens(replacement, fresh, currentSkills(fresh)),
      focus: true,
      caret: null,
      followUpAction: null,
    });
  };

  const addFiles = async (files: ReadonlyArray<File>) => {
    const input = currentInput();
    const threadId = input.thread.id;
    const prompt = input.draft?.prompt ?? "";
    const imageAttachmentsGetChips = stripInlineContextReferences(prompt).trim().length > 0;
    const draft = store().getComposerDraft(input.route);
    const intake = classifyComposerAttachmentIntake({
      files,
      reservedCount: (draft?.images.length ?? 0) + (draft?.files.length ?? 0),
      reattachMarkers: (draft?.files ?? []).filter(composerFileNeedsReattach),
      fileStagingLimit: attachmentStagingLimit(input),
      newId: randomUUID,
    });
    context.setThreadError(threadId, intake.error);
    const references: ComposerContextReference[] = [];
    if (intake.acceptedFiles.length > 0) {
      const storedIds = new Set(
        store().addFiles(input.route, intake.acceptedFiles, { appendReference: true }),
      );
      references.push(
        ...intake.acceptedFiles.filter((file) => storedIds.has(file.id)).map(fileContextReference),
      );
    }
    const nextImages: ComposerImageAttachment[] = [];
    let compressionError: string | null = null;
    for (const file of intake.acceptedImages) {
      if (isHeicImageFile(file) || file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
        compressionError = `'${file.name}' needs compression, which is not available in the native app yet.`;
        continue;
      }
      const prepared = await prepareImageForAttachment(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
      if (!prepared.ok) {
        compressionError =
          prepared.reason === "unreadable"
            ? `'${file.name}' could not be read as an image.`
            : `'${file.name}' is too large to attach, even after compression.`;
        continue;
      }
      const previewPath = imagePaths.get(file) ?? null;
      nextImages.push({
        type: "image",
        id: randomUUID(),
        name: prepared.file.name || "image",
        mimeType: prepared.file.type,
        sizeBytes: prepared.file.size,
        previewUrl: previewPath === null ? "" : pathToFileURL(previewPath).href,
        file: prepared.file,
      });
    }
    if (nextImages.length > 0) {
      const storedImageIds = new Set(store().addImages(input.route, nextImages));
      if (imageAttachmentsGetChips) {
        references.push(
          ...nextImages.filter((image) => storedImageIds.has(image.id)).map(imageContextReference),
        );
      }
    }
    if (compressionError !== null) context.setThreadError(threadId, compressionError);
    startUploads(currentInput());
    insertReferences(currentInput(), references);
  };

  const readFiles = async (
    entries: ReadonlyArray<{ readonly path: string; readonly name: string | null }>,
  ): Promise<File[]> =>
    Promise.all(
      entries.map(async (entry) => {
        const info = await stat(entry.path);
        if (!info.isFile()) {
          throw new Error(`'${basename(entry.path)}' is a folder; attach files instead.`);
        }
        const bytes = await readFile(entry.path);
        const name = entry.name ?? basename(entry.path);
        const file = new File([bytes], name, {
          type: hostPreviewMimeTypeFromExtension(extname(name)) ?? "",
          lastModified: info.mtimeMs,
        });
        imagePaths.set(file, entry.path);
        return file;
      }),
    );

  const removeImage = async (id: string) => {
    const input = currentInput();
    const image = input.draft?.images.find((candidate) => candidate.id === id);
    const prompt = input.draft?.prompt ?? "";
    const referenced = collectInlineContextIds(prompt).includes(
      image ? imageContextReference(image).contextId : "",
    );
    if (referenced) {
      const confirmation = requestConfirmDialog(
        `Remove ${image?.name ?? "this image"} from the message?\nIt is referenced in your text; removing it also removes every reference.`,
        { variant: "destructive" },
      );
      if (confirmation !== undefined && !(await confirmation)) return;
    }
    context.attachmentUploads.releaseAttachmentUpload(id);
    store().removeImage(input.route, id);
    const next = store().getComposerDraft(input.route)?.prompt ?? "";
    if (next !== prompt) context.writePrompt(input.route, next);
  };

  const selectItem = (itemId: string | null) => {
    const model = registry.get(menuModelAtom);
    if (model === null) return;
    const item =
      model.items.find((candidate) => candidate.id === (itemId ?? model.activeItemId)) ??
      (itemId === null ? model.items[0] : undefined);
    if (item === undefined) return;
    const triggerState = registry.get(triggerAtom);
    const plan = planComposerItemSelection({
      item,
      trigger: model.trigger,
      text: triggerState.text,
      planModeUiEnabled: model.planModeUiEnabled,
      usageLimitsCommandAvailable: false,
      menuItemIds: model.items.map((candidate) => candidate.id),
    });
    if (plan === null) return;
    if (plan.effect?.kind === "interaction-mode") {
      changeInteractionMode(model.input, plan.effect.mode);
    }
    const reviewComment = plan.effect?.kind === "review-comment" ? plan.effect.comment : null;
    updateTrigger((current) => ({ ...current, highlightedItemId: null }));
    scheduleEdit({
      threadKey: scopedThreadKey(model.input.route),
      rangeStart: plan.rangeStart,
      rangeEnd: plan.rangeEnd,
      expectedText: plan.expectedText,
      text: plan.replacement,
      tokens: insertionTokens(plan.replacement, model.input, currentSkills(model.input)),
      focus: plan.focusEditor,
      caret: null,
      followUpAction: plan.effect?.kind === "open-model-picker" ? "openModelPicker" : null,
    });
    if (reviewComment !== null) {
      const target = model.input.draftId ?? model.input.route;
      appliedEffects.set(editSeq, () =>
        store().addReviewComment(target, reviewComment, { appendReference: false }),
      );
    }
  };

  const addTerminalContext = (selection: TerminalContextSelection) => {
    const input = registry.get(threadInputAtom);
    if (input === null) return;
    const { interactionMode } = deriveComposerModelContext(input);
    const turn = deriveComposerTurnState(input.thread, input.draft, interactionMode);
    if (turn.activePendingProgress?.activeQuestion?.allowCustomAnswer === false) return;
    const threadKey = scopedThreadKey(input.route);
    const triggerState = registry.get(triggerAtom);
    const prompt =
      triggerState.threadKey === threadKey ? triggerState.text : (input.draft?.prompt ?? "");
    const cursor =
      triggerState.threadKey === threadKey
        ? Math.min(triggerState.cursor, prompt.length)
        : prompt.length;
    const terminalContext = {
      id: randomUUID(),
      threadId: input.thread.id,
      createdAt: new Date().toISOString(),
      ...selection,
    };
    const insertion = insertInlineContextReference(
      prompt,
      cursor,
      terminalContextReference(terminalContext),
    );
    const inserted = store().insertTerminalContext(
      input.draftId ?? input.route,
      insertion.prompt,
      terminalContext,
      input.draft?.terminalContexts.length ?? 0,
    );
    if (!inserted) return;
    const fresh = currentInput();
    scheduleEdit({
      threadKey,
      rangeStart: 0,
      rangeEnd: prompt.length,
      expectedText: prompt,
      text: insertion.prompt,
      tokens: insertionTokens(insertion.prompt, fresh, currentSkills(fresh)),
      focus: true,
      caret: insertion.cursor,
      followUpAction: null,
    });
  };

  services.set(context, {
    addTerminalContext,
    focus: () => registry.set(focusSeqAtom, registry.get(focusSeqAtom) + 1),
    startUploads: () => startUploads(currentInput()),
  });

  return {
    views: { composerInput: viewAtom },
    actions: {
      composerFooterMeasure: async (params) => {
        const { formWidth, hostWidth, ...measurement } = decodeFooterMeasure(params);
        if (registry.get(composerFormWidthAtom) !== formWidth) {
          registry.set(composerFormWidthAtom, formWidth);
        }
        const previous = registry.get(footerAtom);
        const next = resolveRestingComposerControlsLayout({ ...measurement, hostWidth, previous });
        const layout = {
          hiddenCount: next.hiddenCount,
          iconOnlyCount: next.iconOnlyCount ?? 0,
          visible: next.visible,
        };
        if (
          layout.hiddenCount !== previous.hiddenCount ||
          layout.iconOnlyCount !== previous.iconOnlyCount ||
          layout.visible !== previous.visible
        ) {
          registry.set(footerAtom, layout);
        }
        return null;
      },
      composerCaret: async (params) => {
        const { text, cursor } = decodeCaret(params);
        const input = registry.get(threadInputAtom);
        const threadKey = input === null ? null : scopedThreadKey(input.route);
        const candidate = detectComposerTrigger(text, cursor);
        updateTrigger((current) => {
          const dismissed = current.threadKey === threadKey ? current.dismissed : null;
          const trigger = resolveComposerTriggerAfterDismissal(candidate, dismissed);
          return {
            ...current,
            threadKey,
            text,
            cursor,
            trigger,
            dismissed: candidate === null || trigger !== null ? null : dismissed,
          };
        });
        const pathQuery = candidate?.kind === "path" ? candidate.query.trim() : null;
        clearTimeout(debounceTimer ?? undefined);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          updateTrigger((current) => ({ ...current, debouncedPathQuery: pathQuery }));
        }, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
        const pullRequestQuery = {
          text: composerPullRequestTextQuery(candidate),
          number: composerPullRequestTriggerNumber(candidate),
        };
        if (
          pullRequestQuery.text !== pendingPullRequestQuery.text ||
          pullRequestQuery.number !== pendingPullRequestQuery.number
        ) {
          pendingPullRequestQuery = pullRequestQuery;
          clearTimeout(pullRequestTimer ?? undefined);
          pullRequestTimer = setTimeout(() => {
            pullRequestTimer = null;
            updateTrigger((current) => ({
              ...current,
              debouncedPullRequestText: pullRequestQuery.text,
              debouncedPullRequestNumber: pullRequestQuery.number,
            }));
          }, COMPOSER_PULL_REQUEST_QUERY_DEBOUNCE_MS);
        }
        return null;
      },
      composerEditApplied: async (params) => {
        const { seq } = decodeSeq(params);
        const effect = appliedEffects.get(seq);
        appliedEffects.delete(seq);
        effect?.();
        return null;
      },
      composerMenuHighlight: async (params) => {
        const { itemId } = decodeItem(params);
        updateTrigger((current) => ({
          ...current,
          highlightedItemId: itemId,
          highlightedSearchKey: composerMenuSearchKey(MENU_LIST_ID, current.trigger),
        }));
        return null;
      },
      composerMenuMove: async (params) => {
        const { key } = decodeMove(params);
        const model = registry.get(menuModelAtom);
        if (model === null) return null;
        const next = nextComposerMenuHighlightId(model.items, model.activeItemId, key);
        if (next === null) return null;
        updateTrigger((current) => ({
          ...current,
          highlightedItemId: next,
          highlightedSearchKey: composerMenuSearchKey(MENU_LIST_ID, current.trigger),
        }));
        return null;
      },
      composerMenuSelect: async (params) => {
        selectItem(decodeItem(params).itemId);
        return null;
      },
      composerMenuDismiss: async () => {
        updateTrigger((current) => ({ ...current, dismissed: current.trigger, trigger: null }));
        return null;
      },
      toggleInteractionMode: async () => {
        const input = currentInput();
        const { interactionMode, interactionModeEnabled } = deriveComposerModelContext(input);
        if (!interactionModeEnabled) return null;
        changeInteractionMode(input, interactionMode === "plan" ? "default" : "plan");
        return null;
      },
      composerAddFiles: async (params) => {
        const { files } = decodeFiles(params);
        if (files.length === 0) return null;
        await addFiles(await readFiles(files));
        return null;
      },
      composerRemoveImage: async (params) => {
        await removeImage(decodeId(params).id);
        return null;
      },
      composerRetryImageUpload: async (params) => {
        const { id } = decodeId(params);
        const input = currentInput();
        const image = input.draft?.images.find((candidate) => candidate.id === id);
        if (image === undefined) return null;
        context.attachmentUploads.retryAttachmentUpload({
          environmentId: input.thread.environmentId,
          image,
          draftTarget: input.draftId ?? input.route,
        });
        return null;
      },
    },
  };
}
