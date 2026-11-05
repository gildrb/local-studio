import { squashAtomCommandFailure, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  PullRequestComment,
  PullRequestDetailView,
  PullRequestReaction,
  PullRequestReactionContent,
} from "@t3tools/contracts";
import { buildPullRequestActivityUnavailableModel } from "@t3tools/web/src/components/pullRequest/PullRequestDetailPanel.logic.ts";
import { buildPullRequestActorModel } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import {
  buildPullRequestLabelPickerModel,
  pullRequestLabelToggleFailureToast,
  resolvePullRequestLabelToggle,
} from "@t3tools/web/src/components/pullRequest/PullRequestLabelPicker.logic.ts";
import { buildPullRequestMarkdownEditorModel } from "@t3tools/web/src/components/pullRequest/PullRequestMarkdownEditor.logic.ts";
import {
  buildPullRequestReviewerPickerModel,
  pullRequestReviewerCandidateKey,
  pullRequestReviewerToggleToast,
  resolvePullRequestReviewerToggle,
} from "@t3tools/web/src/components/pullRequest/PullRequestReviewerPicker.logic.ts";
import {
  buildPullRequestSummaryModel,
  partitionPullRequestComments,
  PULL_REQUEST_COMMENT_PAGE,
  PULL_REQUEST_SUMMARY_TOASTS,
  resolvePullRequestCommentFinding,
  resolvePullRequestCommentSave,
} from "@t3tools/web/src/components/pullRequest/PullRequestSummaryTab.logic.ts";
import { splitPullRequestBody } from "@t3tools/web/src/components/pullRequest/pullRequestMarkdown.logic.ts";
import {
  buildPullRequestReactionBarModel,
  PULL_REQUEST_REACTION_FAILURE_TITLE,
  PULL_REQUEST_REACTION_ORDER,
  pullRequestReactionsSignature,
  resolvePullRequestReactionToggle,
  type PullRequestReactionBarModel,
} from "@t3tools/web/src/components/pullRequest/pullRequestReactions.logic.ts";
import { markdownImageSourceFragment } from "@t3tools/client-runtime/markdown-images";
import { githubMediaFetchUrl } from "@t3tools/shared/githubMedia";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { buildMarkdownDocument } from "../markdownDocument.ts";
import { openExternal } from "../openExternal.ts";
import { readQuery } from "../pullRequestShared.ts";
import type {
  PullRequestBodySegmentView,
  PullRequestBodyView,
  PullRequestMarkdownEditorView,
  PullRequestSummaryPickerView,
  PullRequestSummaryView,
} from "../views/pullRequests.ts";
import { pullRequestDetailSession, type PullRequestDetailFrame } from "./pullRequestDetail.ts";
import { assetUrlState, mediaVideoView, type MediaRead } from "./mediaViewer.ts";
import type { CoreState } from "../state.ts";
import type { MediaVideoView } from "../views/media.ts";

const BoolParams = Schema.decodeUnknownSync(Schema.Struct({ bots: Schema.Boolean }));
const TargetParams = Schema.decodeUnknownSync(Schema.Struct({ target: Schema.String }));
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));
const ModeParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["write", "preview"]) }),
);
const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const CommentParams = Schema.decodeUnknownSync(Schema.Struct({ commentId: Schema.String }));
const IndexParams = Schema.decodeUnknownSync(Schema.Struct({ index: Schema.Number }));
const PickerKind = Schema.Literals(["reviewers", "labels"]);
const PickerOpenParams = Schema.decodeUnknownSync(
  Schema.Struct({ picker: PickerKind, open: Schema.Boolean }),
);
const PickerQueryParams = Schema.decodeUnknownSync(
  Schema.Struct({ picker: PickerKind, query: Schema.String }),
);
const PickerSelectParams = Schema.decodeUnknownSync(
  Schema.Struct({ picker: PickerKind, key: Schema.String }),
);
const ReactionPickerParams = Schema.decodeUnknownSync(
  Schema.Struct({ subject: Schema.NullOr(Schema.String) }),
);
const ReactParams = Schema.decodeUnknownSync(
  Schema.Struct({ subject: Schema.String, content: Schema.String }),
);

export const PULL_REQUEST_REACTION_SUBJECT = "pull-request";
const DESCRIPTION_TARGET = "description";

type PickerUi = {
  readonly open: boolean;
  readonly query: string;
  readonly pending: string | null;
};

export type PullRequestEditorUi = {
  readonly target: string;
  readonly draft: string;
  readonly preview: boolean;
  readonly revision: number;
};

type SummaryUi = {
  readonly url: string | null;
  readonly shown: number;
  readonly shownBots: number;
  readonly botOpened: boolean;
  readonly order: "newest" | "oldest";
  readonly editor: PullRequestEditorUi | null;
  readonly saving: boolean;
  readonly reviewers: PickerUi;
  readonly labels: PickerUi;
};

const CLOSED_PICKER: PickerUi = { open: false, query: "", pending: null };

function initialUi(url: string | null, order: "newest" | "oldest"): SummaryUi {
  return {
    url,
    shown: PULL_REQUEST_COMMENT_PAGE,
    shownBots: PULL_REQUEST_COMMENT_PAGE,
    botOpened: false,
    order,
    editor: null,
    saving: false,
    reviewers: CLOSED_PICKER,
    labels: CLOSED_PICKER,
  };
}

type ReactionPending = {
  readonly signature: string;
  readonly values: ReadonlyMap<PullRequestReactionContent, boolean>;
};

export type PullRequestReactionsUi = {
  readonly url: string | null;
  readonly picker: string | null;
  readonly pending: ReadonlyMap<string, ReactionPending>;
};

const EMPTY_PENDING: ReadonlyMap<PullRequestReactionContent, boolean> = new Map();

function reactionContent(value: string): PullRequestReactionContent | null {
  return PULL_REQUEST_REACTION_ORDER.find((content) => content === value) ?? null;
}

export interface PullRequestReactionsService {
  readonly bar: (
    ui: PullRequestReactionsUi,
    url: string,
    subject: string,
    reactions: ReadonlyArray<PullRequestReaction>,
    canReact: boolean,
  ) => PullRequestReactionBarModel;
  readonly uiAtom: Atom.Atom<PullRequestReactionsUi>;
  readonly actions: CoreFeature["actions"];
}

const reactionServices = new WeakMap<FeatureContext, PullRequestReactionsService>();

export function pullRequestReactionsService(context: FeatureContext): PullRequestReactionsService {
  const existing = reactionServices.get(context);
  if (existing !== undefined) return existing;
  const { registry, state } = context;
  const session = pullRequestDetailSession(context);
  const uiAtom = Atom.make<PullRequestReactionsUi>({
    url: null,
    picker: null,
    pending: new Map(),
  }).pipe(Atom.keepAlive);
  const readUi = (url: string): PullRequestReactionsUi => {
    const ui = registry.get(uiAtom);
    return ui.url === url ? ui : { url, picker: null, pending: new Map() };
  };
  const pendingFor = (ui: PullRequestReactionsUi, subject: string, signature: string) => {
    const entry = ui.pending.get(subject);
    return entry !== undefined && entry.signature === signature ? entry.values : EMPTY_PENDING;
  };
  const bar: PullRequestReactionsService["bar"] = (ui, url, subject, reactions, canReact) =>
    buildPullRequestReactionBarModel({
      reactions,
      pending:
        ui.url === url
          ? pendingFor(ui, subject, pullRequestReactionsSignature(reactions))
          : EMPTY_PENDING,
      canReact,
    });
  const subjectReactions = (
    detail: PullRequestDetailView,
    subject: string,
  ): {
    readonly reactions: ReadonlyArray<PullRequestReaction>;
    readonly canReact: boolean;
  } | null => {
    const canReact = detail.capabilities.reactions === true;
    if (subject === PULL_REQUEST_REACTION_SUBJECT)
      return { reactions: detail.reactions ?? [], canReact };
    const comment = detail.comments.find((entry) => entry.id === subject);
    return comment === undefined ? null : { reactions: comment.reactions ?? [], canReact };
  };
  const service: PullRequestReactionsService = {
    bar,
    uiAtom,
    actions: {
      pullRequestReactionPicker: async (params) => {
        const { subject } = ReactionPickerParams(params);
        const url = session.current()?.detail?.url ?? null;
        if (url === null) return null;
        registry.set(uiAtom, { ...readUi(url), picker: subject });
        return null;
      },
      pullRequestReact: async (params) => {
        const { subject, content: raw } = ReactParams(params);
        const content = reactionContent(raw);
        const frame = session.current();
        const detail = frame?.detail ?? null;
        if (frame === null || detail === null || content === null) return null;
        const source = subjectReactions(detail, subject);
        if (source === null) return null;
        const ui = readUi(detail.url);
        const signature = pullRequestReactionsSignature(source.reactions);
        const values = pendingFor(ui, subject, signature);
        const model = buildPullRequestReactionBarModel({
          reactions: source.reactions,
          pending: values,
          canReact: source.canReact,
        });
        const { reacted } = resolvePullRequestReactionToggle(model, content);
        const nextPending = new Map(ui.pending);
        nextPending.set(subject, { signature, values: new Map([...values, [content, reacted]]) });
        registry.set(uiAtom, { ...ui, picker: null, pending: nextPending });
        const result = await runAtomCommand(
          registry,
          state.pullRequestEnvironment.setReaction,
          {
            environmentId: frame.target.environmentId,
            input: {
              ...frame.reference,
              ...(subject === PULL_REQUEST_REACTION_SUBJECT ? {} : { subjectId: subject }),
              content,
              reacted,
            },
          },
          { reportFailure: false },
        );
        if (result._tag === "Failure") {
          const current = readUi(detail.url);
          const entry = current.pending.get(subject);
          if (entry !== undefined) {
            const reverted = new Map(entry.values);
            reverted.delete(content);
            const pending = new Map(current.pending);
            pending.set(subject, { signature: entry.signature, values: reverted });
            registry.set(uiAtom, { ...current, pending });
          }
          context.addToast({
            layout: "plain",
            type: "error",
            title: PULL_REQUEST_REACTION_FAILURE_TITLE,
          });
          return null;
        }
        session.refreshDetail();
        return null;
      },
    },
  };
  reactionServices.set(context, service);
  return service;
}

export type PullRequestBodyMedia = { readonly read: MediaRead; readonly state: CoreState };

/** A PR upload's player (web `PullRequestGitHubVideo` / `MediaVideoPlayer`). */
function pullRequestVideoView(
  url: string,
  frame: PullRequestDetailFrame,
  detail: PullRequestDetailView,
  media: PullRequestBodyMedia,
): MediaVideoView {
  const label = "Pull request video";
  const fetchUrl = githubMediaFetchUrl(url);
  if (fetchUrl === null) {
    return mediaVideoView({ label, src: url, sourceFailed: false, originalUrl: url, retry: null });
  }
  const asset = {
    environmentId: frame.target.environmentId,
    resource: { _tag: "github-media" as const, cwd: detail.workspaceRoot, url: fetchUrl },
  };
  const resolved = assetUrlState(media.read, media.state, asset);
  const src =
    resolved._tag === "Success" ? resolved.url : resolved._tag === "Failure" ? fetchUrl : null;
  return mediaVideoView({
    label,
    src: src === null ? null : src + markdownImageSourceFragment(url),
    sourceFailed: false,
    originalUrl: url,
    retry: asset,
  });
}

export function buildPullRequestBodyView(
  text: string,
  frame: PullRequestDetailFrame,
  detail: PullRequestDetailView,
  media: PullRequestBodyMedia,
): PullRequestBodyView {
  const segments = splitPullRequestBody(text).map((segment): PullRequestBodySegmentView => {
    if (segment.kind === "markdown") {
      return {
        kind: "markdown",
        id: segment.id,
        document: buildMarkdownDocument(segment.text, {
          cwd: detail.workspaceRoot,
          lineBreaks: false,
          streaming: false,
          wordWrap: true,
          canRunShellCommands: false,
          repositoryUrl: frame.markdownRepositoryUrl,
        }),
      };
    }
    if (segment.media === "video") {
      return {
        kind: "video",
        id: `${segment.id}:${segment.url}`,
        video: pullRequestVideoView(segment.url, frame, detail, media),
      };
    }
    return {
      kind: "attachment",
      id: segment.id,
      url: segment.url,
      label: "Open attachment on GitHub",
    };
  });
  return { segments };
}

export async function updatePullRequestComment(
  context: FeatureContext,
  frame: PullRequestDetailFrame,
  comment: PullRequestComment,
  text: string,
  failureTitle: string,
): Promise<boolean> {
  const decision = resolvePullRequestCommentSave({ comment, body: text, saving: false });
  if (decision.kind === "ignore") return false;
  const result = await runAtomCommand(
    context.registry,
    context.state.pullRequestEnvironment.updateComment,
    {
      environmentId: frame.target.environmentId,
      input: {
        ...frame.reference,
        commentId: decision.commentId,
        kind: decision.commentKind,
        body: decision.body,
      },
    },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    context.addToast({ layout: "plain", type: "error", title: failureTitle });
    return false;
  }
  return true;
}

export function editorView(
  editor: PullRequestEditorUi,
  saving: boolean,
  allowEmpty: boolean,
  initial: string,
  label: string,
  placeholder: string | null,
  frame: PullRequestDetailFrame,
  detail: PullRequestDetailView,
  media: PullRequestBodyMedia,
): PullRequestMarkdownEditorView {
  const model = buildPullRequestMarkdownEditorModel({
    draft: editor.draft,
    preview: editor.preview,
    saving,
    allowEmpty,
  });
  return {
    target: editor.target,
    revision: editor.revision,
    initial,
    label,
    placeholder,
    model,
    preview:
      editor.preview && !model.empty
        ? buildPullRequestBodyView(editor.draft, frame, detail, media)
        : null,
  };
}

export function createPullRequestSummaryFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const session = pullRequestDetailSession(context);
  const reactions = pullRequestReactionsService(context);
  const uiAtom = Atom.make<SummaryUi>(initialUi(null, "newest")).pipe(Atom.keepAlive);
  let editorRevision = 0;

  const readUi = (url: string): SummaryUi => {
    const ui = registry.get(uiAtom);
    return ui.url === url ? ui : initialUi(url, ui.order);
  };
  const updateUi = (update: (ui: SummaryUi) => SummaryUi) => {
    const url = session.current()?.detail?.url ?? null;
    if (url === null) return;
    registry.set(uiAtom, update(readUi(url)));
  };

  const candidatesAtom = Atom.make((get) => {
    const frame = get(session.frameAtom);
    const detail = frame?.detail ?? null;
    if (frame === null || detail === null) return null;
    const stored = get(uiAtom);
    const ui = stored.url === detail.url ? stored : initialUi(detail.url, stored.order);
    const target = { environmentId: frame.target.environmentId, input: frame.reference };
    return {
      reviewers: readQuery(
        get,
        ui.reviewers.open ? state.pullRequestEnvironment.reviewerCandidates(target) : null,
      ),
      labels: readQuery(
        get,
        ui.labels.open ? state.pullRequestEnvironment.labelCandidates(target) : null,
      ),
    };
  });

  const viewAtom = Atom.make((get): PullRequestSummaryView | null => {
    const frame = get(session.frameAtom);
    const detail = frame?.detail ?? null;
    if (frame === null || detail === null || frame.model === null) return null;
    const media: PullRequestBodyMedia = { read: get, state };
    const stored = get(uiAtom);
    const ui = stored.url === detail.url ? stored : initialUi(detail.url, stored.order);
    const reactionUi = get(reactions.uiAtom);
    const model = buildPullRequestSummaryModel({
      detail,
      activityPending: frame.activityPending,
      activityError: frame.activityError,
      checksStale: frame.model.checks.stale,
      pendingFinding: frame.ui.handoff,
      fixFindingLabel: frame.model.handoffLabels.fixFinding,
      fixCheckLabel: frame.model.handoffLabels.fixCheck,
      canFix: true,
      shownComments: ui.shown,
      shownBotComments: ui.shownBots,
      botGroupOpened: ui.botOpened,
      commentOrder: ui.order,
      editingDescription: ui.editor?.target === DESCRIPTION_TARGET,
      format: { nowMs: Date.now() },
    });
    const partition = partitionPullRequestComments(detail);
    const commentById = new Map(detail.comments.map((comment) => [comment.id, comment] as const));
    const rendered = [
      ...model.comments.visible,
      ...(model.comments.bots?.visible ?? []),
      ...(model.comments.finished?.items ?? []),
    ];
    const bodies: Record<string, PullRequestBodyView> = {};
    const reactionBars: Record<string, PullRequestReactionBarModel> = {};
    const fixable: Record<string, boolean> = {};
    for (const card of rendered) {
      const comment = commentById.get(card.id);
      if (comment === undefined) continue;
      if (bodies[card.id] === undefined)
        bodies[card.id] = buildPullRequestBodyView(comment.body, frame, detail, media);
      reactionBars[card.id] = reactions.bar(
        reactionUi,
        detail.url,
        card.id,
        card.reactions,
        card.canReact,
      );
      fixable[card.id] =
        resolvePullRequestCommentFinding(comment, partition.threadByCommentId.get(comment.id)) !==
        null;
    }
    const editingComment =
      ui.editor !== null && ui.editor.target !== DESCRIPTION_TARGET
        ? commentById.get(ui.editor.target)
        : undefined;
    const editor =
      ui.editor === null
        ? null
        : ui.editor.target === DESCRIPTION_TARGET
          ? editorView(
              ui.editor,
              ui.saving,
              true,
              detail.body,
              model.description.editorLabel,
              model.description.editorPlaceholder,
              frame,
              detail,
              media,
            )
          : editingComment === undefined
            ? null
            : editorView(
                ui.editor,
                ui.saving,
                false,
                editingComment.body,
                "Edit comment",
                null,
                frame,
                detail,
                media,
              );
    const candidates = get(candidatesAtom);
    const reviewerQuery = candidates?.reviewers;
    const labelQuery = candidates?.labels;
    const reviewers: PullRequestSummaryPickerView | null = model.reviewers.picker.visible
      ? {
          open: ui.reviewers.open,
          query: ui.reviewers.query,
          model: buildPullRequestReviewerPickerModel({
            allowed: model.reviewers.picker.allowed,
            query: ui.reviewers.query,
            candidates: reviewerQuery?.data?.candidates ?? null,
            isPending:
              reviewerQuery !== undefined &&
              (reviewerQuery.isPending ||
                (!reviewerQuery.isSuccess && reviewerQuery.error === null)),
            error: reviewerQuery?.error ?? null,
            truncated: reviewerQuery?.data?.truncated === true,
            changePending: ui.reviewers.pending !== null,
          }),
        }
      : null;
    const labels: PullRequestSummaryPickerView | null = model.labels.picker.visible
      ? {
          open: ui.labels.open,
          query: ui.labels.query,
          model: buildPullRequestLabelPickerModel({
            allowed: model.labels.picker.allowed,
            query: ui.labels.query,
            candidates: labelQuery?.data?.candidates ?? null,
            isPending:
              labelQuery !== undefined &&
              (labelQuery.isPending || (!labelQuery.isSuccess && labelQuery.error === null)),
            error: labelQuery?.error ?? null,
            truncated: labelQuery?.data?.truncated === true,
            changePending: ui.labels.pending !== null,
          }),
        }
      : null;
    return {
      url: detail.url,
      active: frame.ui.tab === "summary",
      model,
      description: buildPullRequestBodyView(model.description.text, frame, detail, media),
      bodies,
      reactions: reactionBars,
      reactionPicker: reactionUi.url === detail.url ? reactionUi.picker : null,
      fixable,
      editor,
      saving: ui.saving,
      reviewers,
      labels,
      activityUnavailable:
        model.comments.state === "error" && frame.activityError !== null
          ? buildPullRequestActivityUnavailableModel({ error: frame.activityError, compact: true })
          : null,
      groupActors: Object.fromEntries(
        [
          ...(model.comments.bots?.group.avatars ?? []),
          ...(model.comments.finished?.group.avatars ?? []),
        ].map((avatar) => [avatar.key, buildPullRequestActorModel(avatar.actor)]),
      ),
    };
  });

  const editTarget = (target: string) => {
    const detail = session.current()?.detail ?? null;
    if (detail === null) return;
    const initial =
      target === DESCRIPTION_TARGET
        ? detail.body
        : detail.comments.find((comment) => comment.id === target)?.body;
    if (initial === undefined) return;
    editorRevision += 1;
    updateUi((ui) => ({
      ...ui,
      editor: { target, draft: initial, preview: false, revision: editorRevision },
    }));
  };

  const saveEditor = async (text: string) => {
    const frame = session.current();
    const detail = frame?.detail ?? null;
    if (frame === null || detail === null) return;
    const ui = readUi(detail.url);
    const editor = ui.editor;
    if (editor === null || ui.saving) return;
    const environmentId = frame.target.environmentId;
    if (editor.target === DESCRIPTION_TARGET) {
      updateUi((current) => ({ ...current, saving: true }));
      const result = await runAtomCommand(
        registry,
        state.pullRequestEnvironment.update,
        { environmentId, input: { ...frame.reference, body: text } },
        { reportFailure: false },
      );
      updateUi((current) => ({ ...current, saving: false }));
      if (result._tag === "Failure") {
        context.addToast({
          layout: "plain",
          type: "error",
          title: PULL_REQUEST_SUMMARY_TOASTS.descriptionSaveFailed,
        });
        return;
      }
      updateUi((current) => ({ ...current, editor: null }));
      session.refreshDetail();
      return;
    }
    const comment: PullRequestComment | undefined = detail.comments.find(
      (entry) => entry.id === editor.target,
    );
    if (comment === undefined) return;
    updateUi((current) => ({ ...current, saving: true }));
    const saved = await updatePullRequestComment(
      context,
      frame,
      comment,
      text,
      PULL_REQUEST_SUMMARY_TOASTS.commentSaveFailed,
    );
    updateUi((current) => ({ ...current, saving: false, editor: saved ? null : current.editor }));
    if (saved) session.refreshDetail();
  };

  const toggleReviewer = async (key: string) => {
    const frame = session.current();
    const detail = frame?.detail ?? null;
    const candidates = registry.get(candidatesAtom)?.reviewers.data?.candidates ?? [];
    if (frame === null || detail === null) return;
    const candidate = candidates.find((entry) => pullRequestReviewerCandidateKey(entry) === key);
    if (candidate === undefined) return;
    const ui = readUi(detail.url);
    const decision = resolvePullRequestReviewerToggle({
      candidate,
      changePending: ui.reviewers.pending !== null,
    });
    if (decision.kind === "ignore") return;
    updateUi((current) => ({
      ...current,
      reviewers: { ...current.reviewers, pending: candidate.id },
    }));
    const result = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.requestReviewers,
      {
        environmentId: frame.target.environmentId,
        input: {
          ...frame.reference,
          reviewers: [decision.reviewer],
          requested: decision.requested,
        },
      },
      { reportFailure: false },
    );
    updateUi((current) => ({ ...current, reviewers: { ...current.reviewers, pending: null } }));
    const toast = pullRequestReviewerToggleToast({
      candidate,
      failed: result._tag === "Failure",
      failure: result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
    });
    context.addToast({ layout: "plain", ...toast });
  };

  const toggleLabel = async (key: string) => {
    const frame = session.current();
    const detail = frame?.detail ?? null;
    const candidates = registry.get(candidatesAtom)?.labels.data?.candidates ?? [];
    if (frame === null || detail === null) return;
    const found = candidates.find((entry) => entry.name === key);
    if (found === undefined) return;
    const candidate = { name: found.name, isApplied: found.isApplied };
    const ui = readUi(detail.url);
    const decision = resolvePullRequestLabelToggle({
      candidate,
      changePending: ui.labels.pending !== null,
    });
    if (decision.kind === "ignore") return;
    updateUi((current) => ({ ...current, labels: { ...current.labels, pending: decision.label } }));
    const result = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.setLabels,
      {
        environmentId: frame.target.environmentId,
        input: { ...frame.reference, labels: [decision.label], applied: decision.applied },
      },
      { reportFailure: false },
    );
    updateUi((current) => ({ ...current, labels: { ...current.labels, pending: null } }));
    if (result._tag === "Failure") {
      const toast = pullRequestLabelToggleFailureToast({
        candidate,
        failure: squashAtomCommandFailure(result),
      });
      context.addToast({ layout: "plain", ...toast });
    }
  };

  return {
    views: { pullRequestSummary: viewAtom },
    actions: {
      ...reactions.actions,
      pullRequestSummaryShowOlder: async (params) => {
        const { bots } = BoolParams(params);
        updateUi((ui) =>
          bots
            ? { ...ui, shownBots: ui.shownBots + PULL_REQUEST_COMMENT_PAGE }
            : { ...ui, shown: ui.shown + PULL_REQUEST_COMMENT_PAGE },
        );
        return null;
      },
      pullRequestSummaryShowRecent: async (params) => {
        const { bots } = BoolParams(params);
        updateUi((ui) =>
          bots
            ? { ...ui, shownBots: PULL_REQUEST_COMMENT_PAGE }
            : { ...ui, shown: PULL_REQUEST_COMMENT_PAGE },
        );
        return null;
      },
      pullRequestSummaryToggleOrder: async () => {
        updateUi((ui) => ({ ...ui, order: ui.order === "newest" ? "oldest" : "newest" }));
        return null;
      },
      pullRequestSummaryOpenBots: async () => {
        updateUi((ui) => ({ ...ui, botOpened: true }));
        return null;
      },
      pullRequestSummaryEdit: async (params) => {
        editTarget(TargetParams(params).target);
        return null;
      },
      pullRequestSummaryEditorDraft: async (params) => {
        const { text } = TextParams(params);
        updateUi((ui) =>
          ui.editor === null ? ui : { ...ui, editor: { ...ui.editor, draft: text } },
        );
        return null;
      },
      pullRequestSummaryEditorMode: async (params) => {
        const { mode } = ModeParams(params);
        updateUi((ui) =>
          ui.editor === null || ui.saving
            ? ui
            : { ...ui, editor: { ...ui.editor, preview: mode === "preview" } },
        );
        return null;
      },
      pullRequestSummaryEditorCancel: async () => {
        updateUi((ui) => (ui.saving ? ui : { ...ui, editor: null }));
        return null;
      },
      pullRequestSummaryEditorSave: async (params) => {
        await saveEditor(TextParams(params).text);
        return null;
      },
      pullRequestSummaryOpenCheck: async (params) => {
        await openExternal(UrlParams(params).url).catch(() =>
          context.addToast({
            layout: "plain",
            type: "error",
            title: PULL_REQUEST_SUMMARY_TOASTS.checkOpenFailed,
          }),
        );
        return null;
      },
      pullRequestSummaryFixComment: async (params) => {
        const { commentId } = CommentParams(params);
        const detail = session.current()?.detail ?? null;
        if (detail === null) return null;
        const comment = detail.comments.find((entry) => entry.id === commentId);
        if (comment === undefined) return null;
        const thread = partitionPullRequestComments(detail).threadByCommentId.get(comment.id);
        const finding = resolvePullRequestCommentFinding(comment, thread);
        if (finding !== null) session.startFixFinding(finding);
        return null;
      },
      pullRequestSummaryFixCheck: async (params) => {
        const { index } = IndexParams(params);
        const check = session.current()?.detail?.checks[index];
        if (check !== undefined) session.startFixFinding({ kind: "check", check });
        return null;
      },
      pullRequestSummaryRefreshChecks: async () => {
        await session.refreshFromHost();
        return null;
      },
      pullRequestSummaryRetry: async () => {
        session.refreshDetail();
        return null;
      },
      pullRequestSummaryPickerOpen: async (params) => {
        const { picker, open } = PickerOpenParams(params);
        updateUi((ui) =>
          picker === "reviewers"
            ? { ...ui, reviewers: { ...ui.reviewers, open, query: open ? ui.reviewers.query : "" } }
            : { ...ui, labels: { ...ui.labels, open, query: open ? ui.labels.query : "" } },
        );
        return null;
      },
      pullRequestSummaryPickerQuery: async (params) => {
        const { picker, query } = PickerQueryParams(params);
        updateUi((ui) =>
          picker === "reviewers"
            ? { ...ui, reviewers: { ...ui.reviewers, query } }
            : { ...ui, labels: { ...ui.labels, query } },
        );
        return null;
      },
      pullRequestSummaryPickerSelect: async (params) => {
        const { picker, key } = PickerSelectParams(params);
        if (picker === "reviewers") await toggleReviewer(key);
        else await toggleLabel(key);
        return null;
      },
    },
  };
}
