import { buildPullRequestActorModel } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import type { PullRequestReactionBarModel } from "@t3tools/web/src/components/pullRequest/pullRequestReactions.logic.ts";
import {
  buildPullRequestTimelineModel,
  PULL_REQUEST_TIMELINE_COMMENT_SAVE_FAILED,
  type PullRequestTimelineBodyModel,
} from "@t3tools/web/src/components/pullRequest/PullRequestTimelineTab.logic.ts";
import type { PullRequestActorModel } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import type { PullRequestBodyView, PullRequestTimelineView } from "../views/pullRequests.ts";
import { pullRequestDetailSession } from "./pullRequestDetail.ts";
import {
  buildPullRequestBodyView,
  editorView,
  pullRequestReactionsService,
  updatePullRequestComment,
  type PullRequestBodyMedia,
  type PullRequestEditorUi,
} from "./pullRequestSummary.ts";

const TargetParams = Schema.decodeUnknownSync(Schema.Struct({ target: Schema.String }));
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));
const ModeParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["write", "preview"]) }),
);
const OidParams = Schema.decodeUnknownSync(Schema.Struct({ oid: Schema.String }));

type TimelineUi = {
  readonly url: string | null;
  readonly editor: PullRequestEditorUi | null;
  readonly saving: boolean;
};

export function createPullRequestTimelineFeature(context: FeatureContext): CoreFeature {
  const { registry } = context;
  const session = pullRequestDetailSession(context);
  const reactions = pullRequestReactionsService(context);
  const uiAtom = Atom.make<TimelineUi>({ url: null, editor: null, saving: false }).pipe(
    Atom.keepAlive,
  );
  let editorRevision = 0;

  const readUi = (url: string): TimelineUi => {
    const ui = registry.get(uiAtom);
    return ui.url === url ? ui : { url, editor: null, saving: false };
  };
  const updateUi = (update: (ui: TimelineUi) => TimelineUi) => {
    const url = session.current()?.detail?.url ?? null;
    if (url === null) return;
    registry.set(uiAtom, update(readUi(url)));
  };

  const viewAtom = Atom.make((get): PullRequestTimelineView | null => {
    const frame = get(session.frameAtom);
    const detail = frame?.detail ?? null;
    if (frame === null || detail === null) return null;
    const media: PullRequestBodyMedia = { read: get, state: context.state };
    const stored = get(uiAtom);
    const ui =
      stored.url === detail.url ? stored : { url: detail.url, editor: null, saving: false };
    const reactionUi = get(reactions.uiAtom);
    const model = buildPullRequestTimelineModel({
      detail,
      order: frame.ui.timelineOrder,
      nowMs: Date.now(),
    });
    const markers: Record<string, PullRequestActorModel> = {};
    const bodies: Record<string, PullRequestBodyView> = {};
    const bars: Record<string, PullRequestReactionBarModel> = {};
    const addBody = (key: string, body: PullRequestTimelineBodyModel | null) => {
      if (body !== null && body.markdown)
        bodies[key] = buildPullRequestBodyView(body.text, frame, detail, media);
    };
    for (const row of model.rows) {
      if (row.kind !== "lifecycle") {
        const actor = row.markerActors[0];
        if (actor !== undefined) markers[row.key] = buildPullRequestActorModel(actor);
      }
      if (row.kind === "conversation") {
        for (const card of row.cards) {
          addBody(card.key, card.body);
          if (card.reactions.visible) {
            bars[card.id] = reactions.bar(
              reactionUi,
              detail.url,
              card.id,
              card.reactions.reactions,
              card.reactions.canReact,
            );
          }
        }
      } else if (row.kind === "verdict") {
        addBody(row.key, row.body);
        if (row.reactions.visible) {
          bars[row.id] = reactions.bar(
            reactionUi,
            detail.url,
            row.id,
            row.reactions.reactions,
            row.reactions.canReact,
          );
        }
      }
    }
    const editing =
      ui.editor === null
        ? undefined
        : detail.comments.find((comment) => comment.id === ui.editor?.target);
    return {
      url: detail.url,
      active: frame.ui.tab === "timeline",
      model,
      markers,
      bodies,
      reactions: bars,
      reactionPicker: reactionUi.url === detail.url ? reactionUi.picker : null,
      editor:
        ui.editor === null || editing === undefined
          ? null
          : editorView(
              ui.editor,
              ui.saving,
              false,
              editing.body,
              "Edit comment",
              null,
              frame,
              detail,
              media,
            ),
      saving: ui.saving,
    };
  });

  return {
    views: { pullRequestTimeline: viewAtom },
    actions: {
      pullRequestTimelineEdit: async (params) => {
        const { target } = TargetParams(params);
        const comment = session.current()?.detail?.comments.find((entry) => entry.id === target);
        if (comment === undefined) return null;
        editorRevision += 1;
        updateUi((ui) => ({
          ...ui,
          editor: { target, draft: comment.body, preview: false, revision: editorRevision },
        }));
        return null;
      },
      pullRequestTimelineEditorDraft: async (params) => {
        const { text } = TextParams(params);
        updateUi((ui) =>
          ui.editor === null ? ui : { ...ui, editor: { ...ui.editor, draft: text } },
        );
        return null;
      },
      pullRequestTimelineEditorMode: async (params) => {
        const { mode } = ModeParams(params);
        updateUi((ui) =>
          ui.editor === null || ui.saving
            ? ui
            : { ...ui, editor: { ...ui.editor, preview: mode === "preview" } },
        );
        return null;
      },
      pullRequestTimelineEditorCancel: async () => {
        updateUi((ui) => (ui.saving ? ui : { ...ui, editor: null }));
        return null;
      },
      pullRequestTimelineEditorSave: async (params) => {
        const { text } = TextParams(params);
        const frame = session.current();
        const detail = frame?.detail ?? null;
        if (frame === null || detail === null) return null;
        const ui = readUi(detail.url);
        if (ui.editor === null || ui.saving) return null;
        const target = ui.editor.target;
        const comment = detail.comments.find((entry) => entry.id === target);
        if (comment === undefined) return null;
        updateUi((current) => ({ ...current, saving: true }));
        const saved = await updatePullRequestComment(
          context,
          frame,
          comment,
          text,
          PULL_REQUEST_TIMELINE_COMMENT_SAVE_FAILED,
        );
        updateUi((current) => ({
          ...current,
          saving: false,
          editor: saved ? null : current.editor,
        }));
        if (saved) session.refreshDetail();
        return null;
      },
      pullRequestTimelineOpenCommit: async (params) => {
        session.openCommit(OidParams(params).oid);
        return null;
      },
    },
  };
}
