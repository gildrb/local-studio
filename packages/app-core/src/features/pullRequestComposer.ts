import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { PullRequestReviewVerdict } from "@t3tools/contracts";
import {
  buildPullRequestCommentFormModel,
  buildPullRequestComposerModel,
  PULL_REQUEST_COMMENT_POST_FAILED,
  pullRequestComposerOpenMode,
  resolvePullRequestCommentSubmit,
  type PullRequestCommentSubmitAction,
  type PullRequestComposerMode,
} from "@t3tools/web/src/components/pullRequest/PullRequestComposer.logic.ts";
import {
  buildPullRequestReviewFormModel,
  PULL_REQUEST_REVIEW_FAILURE_TITLE,
  PULL_REQUEST_REVIEW_VERDICTS,
  resolvePullRequestReviewSubmit,
} from "@t3tools/web/src/components/pullRequest/PullRequestReviewForm.logic.ts";
import {
  pullRequestReviewKey,
  usePullRequestReviewStore,
} from "@t3tools/web/src/components/pullRequest/pullRequestReviewStore.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import type { PullRequestComposerView } from "../views/pullRequests.ts";
import { pullRequestDetailSession } from "./pullRequestDetail.ts";

const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const ModeParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["comment", "review"]) }),
);
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));
const SubmitParams = Schema.decodeUnknownSync(
  Schema.Struct({ action: Schema.Literals(["comment", "close", "reopen"]) }),
);
const VerdictParams = Schema.decodeUnknownSync(Schema.Struct({ verdict: Schema.String }));

type ComposerUi = {
  readonly scope: string | null;
  readonly open: boolean;
  readonly requestedMode: PullRequestComposerMode;
  readonly commentBody: string;
  readonly commentRevision: number;
  readonly submitting: PullRequestCommentSubmitAction | null;
  readonly reviewPending: boolean;
  readonly requestedVerdict: PullRequestReviewVerdict;
  readonly summaryRevision: number;
};

function initialUi(scope: string | null): ComposerUi {
  return {
    scope,
    open: false,
    requestedMode: "comment",
    commentBody: "",
    commentRevision: 0,
    submitting: null,
    reviewPending: false,
    requestedVerdict: "comment",
    summaryRevision: 0,
  };
}

function verdictValue(value: string): PullRequestReviewVerdict | null {
  return PULL_REQUEST_REVIEW_VERDICTS.find((verdict) => verdict.value === value)?.value ?? null;
}

export function createPullRequestComposerFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const session = pullRequestDetailSession(context);
  const uiAtom = Atom.make<ComposerUi>(initialUi(null)).pipe(Atom.keepAlive);
  const reviewStoreAtom = Atom.make((get) => {
    get.addFinalizer(usePullRequestReviewStore.subscribe((value) => get.setSelf(value)));
    return usePullRequestReviewStore.getState();
  }).pipe(Atom.keepAlive);

  const scopeOf = (): string | null => {
    const frame = session.current();
    if (frame === null) return null;
    return JSON.stringify([frame.target.environmentId, pullRequestReviewKey(frame.reference)]);
  };
  const readUi = (scope: string): ComposerUi => {
    const ui = registry.get(uiAtom);
    return ui.scope === scope ? ui : initialUi(scope);
  };
  const updateUi = (update: (ui: ComposerUi) => ComposerUi) => {
    const scope = scopeOf();
    if (scope === null) return;
    registry.set(uiAtom, update(readUi(scope)));
  };

  const viewAtom = Atom.make((get): PullRequestComposerView | null => {
    const frame = get(session.frameAtom);
    const detail = frame?.detail ?? null;
    if (frame === null || detail === null || frame.model === null || !frame.model.composerVisible) {
      return null;
    }
    const scope = JSON.stringify([
      frame.target.environmentId,
      pullRequestReviewKey(frame.reference),
    ]);
    const stored = get(uiAtom);
    const ui = stored.scope === scope ? stored : initialUi(scope);
    const store = get(reviewStoreAtom);
    const reviewKey = pullRequestReviewKey(frame.reference);
    const pending = store.drafts[reviewKey] ?? [];
    const summary = store.summaries[reviewKey] ?? "";
    const model = buildPullRequestComposerModel({
      detail,
      requestedMode: ui.requestedMode,
      pendingCommentCount: pending.length,
      summaryStarted: summary.trim().length > 0,
    });
    if (!model.visible) return null;
    const actionPending = frame.ui.pendingAction !== null;
    return {
      open: ui.open,
      model,
      comment: {
        model: buildPullRequestCommentFormModel({
          detail,
          body: ui.commentBody,
          submitting: ui.submitting,
          actionPending,
        }),
        revision: ui.commentRevision,
        body: ui.commentBody,
      },
      review:
        model.verdicts.length === 0
          ? null
          : {
              model: buildPullRequestReviewFormModel({
                verdicts: model.verdicts,
                requestedVerdict: ui.requestedVerdict,
                requestChangesSummaryRequired: model.requestChangesSummaryRequired,
                body: summary,
                pendingCommentCount: pending.length,
                pending: ui.reviewPending,
              }),
              summary,
              revision: ui.summaryRevision,
              pending: ui.reviewPending,
            },
    };
  });

  const submitComment = async (action: PullRequestCommentSubmitAction) => {
    const frame = session.current();
    const scope = scopeOf();
    if (frame === null || scope === null) return;
    const ui = readUi(scope);
    const trimmed = resolvePullRequestCommentSubmit({
      body: ui.commentBody,
      submitting: ui.submitting,
      actionPending: frame.ui.pendingAction !== null,
    });
    if (trimmed === null) return;
    updateUi((current) => ({ ...current, submitting: action }));
    if (action !== "comment") {
      const result = await session.performCommentAction(trimmed, action);
      updateUi((current) =>
        result.commentPosted
          ? {
              ...current,
              submitting: null,
              open: false,
              commentBody: "",
              commentRevision: current.commentRevision + 1,
            }
          : { ...current, submitting: null },
      );
      return;
    }
    const result = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.comment,
      { environmentId: frame.target.environmentId, input: { ...frame.reference, body: trimmed } },
      { reportFailure: false },
    );
    if (result._tag === "Failure") {
      updateUi((current) => ({ ...current, submitting: null }));
      context.addToast({ layout: "plain", type: "error", title: PULL_REQUEST_COMMENT_POST_FAILED });
      return;
    }
    updateUi((current) => ({
      ...current,
      submitting: null,
      open: false,
      commentBody: "",
      commentRevision: current.commentRevision + 1,
    }));
    session.refreshDetail();
  };

  const submitReview = async () => {
    const view = registry.get(viewAtom);
    const frame = session.current();
    if (view === null || view.review === null || frame === null) return;
    const decision = resolvePullRequestReviewSubmit(view.review.model, view.review.pending);
    if (decision.kind === "ignore" || view.review.model.submitDisabled) return;
    const reviewKey = pullRequestReviewKey(frame.reference);
    const store = usePullRequestReviewStore.getState();
    const submittedBody = store.summaries[reviewKey] ?? "";
    const submittedComments = store.drafts[reviewKey] ?? [];
    updateUi((current) => ({ ...current, reviewPending: true }));
    const result = await runAtomCommand(
      registry,
      state.pullRequestEnvironment.submitReview,
      {
        environmentId: frame.target.environmentId,
        input: {
          ...frame.reference,
          verdict: decision.verdict.value,
          body: submittedBody,
          comments: submittedComments,
        },
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure") {
      updateUi((current) => ({ ...current, reviewPending: false }));
      context.addToast({
        layout: "plain",
        type: "error",
        title: PULL_REQUEST_REVIEW_FAILURE_TITLE,
      });
      return;
    }
    const after = usePullRequestReviewStore.getState();
    after.removeComments(
      reviewKey,
      submittedComments.map((comment) => comment.id),
    );
    after.clearSummary(reviewKey, submittedBody);
    updateUi((current) => ({
      ...current,
      reviewPending: false,
      open: false,
      summaryRevision: current.summaryRevision + 1,
    }));
    context.addToast({ layout: "plain", type: "success", title: decision.verdict.sent });
    session.refreshDetail();
  };

  return {
    views: { pullRequestComposer: viewAtom },
    actions: {
      pullRequestComposerOpen: async (params) => {
        const { open } = OpenParams(params);
        const frame = session.current();
        if (frame === null) return null;
        const reviewKey = pullRequestReviewKey(frame.reference);
        const store = usePullRequestReviewStore.getState();
        const reviewStarted =
          (store.drafts[reviewKey] ?? []).length > 0 ||
          (store.summaries[reviewKey] ?? "").trim().length > 0;
        updateUi((ui) =>
          open
            ? { ...ui, open, requestedMode: pullRequestComposerOpenMode(reviewStarted) }
            : { ...ui, open },
        );
        return null;
      },
      pullRequestComposerSetMode: async (params) => {
        const { mode } = ModeParams(params);
        updateUi((ui) => ({ ...ui, requestedMode: mode }));
        return null;
      },
      pullRequestComposerCommentDraft: async (params) => {
        const { text } = TextParams(params);
        updateUi((ui) => ({ ...ui, commentBody: text }));
        return null;
      },
      pullRequestComposerCommentSubmit: async (params) => {
        await submitComment(SubmitParams(params).action);
        return null;
      },
      pullRequestComposerReviewSummary: async (params) => {
        const { text } = TextParams(params);
        const frame = session.current();
        if (frame === null) return null;
        usePullRequestReviewStore
          .getState()
          .setSummary(pullRequestReviewKey(frame.reference), text);
        return null;
      },
      pullRequestComposerSetVerdict: async (params) => {
        const verdict = verdictValue(VerdictParams(params).verdict);
        if (verdict !== null) updateUi((ui) => ({ ...ui, requestedVerdict: verdict }));
        return null;
      },
      pullRequestComposerReviewSubmit: async () => {
        await submitReview();
        return null;
      },
      pullRequestComposerDiscard: async () => {
        const frame = session.current();
        if (frame === null) return null;
        usePullRequestReviewStore.getState().clear(pullRequestReviewKey(frame.reference));
        return null;
      },
    },
  };
}
