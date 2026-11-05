import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  PullRequestDiffResult,
  PullRequestOmittedFileStat,
  PullRequestReviewPosition,
  PullRequestReviewThread,
  PullRequestThreadComment,
} from "@t3tools/contracts";
import {
  buildDiffFileTreeModel,
  diffFileTreeEntries,
} from "@t3tools/web/src/components/diffs/diffFileTree.logic.ts";
import {
  buildPullRequestCodeTabModel,
  PULL_REQUEST_CODE_TOASTS,
  PULL_REQUEST_COMMIT_PAGE_SIZE,
  getPullRequestReviewPositionAnchor,
  pullRequestDraftRangeLabel,
  pullRequestFileDiffStat,
  resolvePullRequestCodeReviewCapabilities,
  resolvePullRequestDiffScope,
} from "@t3tools/web/src/components/pullRequest/PullRequestCodeTab.logic.ts";
import {
  isFileDiffCollapsed,
  isLineInFileDiff,
  toggleFileDiffFoldForViewed,
  type DiffFoldOverride,
} from "@t3tools/web/src/components/pullRequest/pullRequestDiff.logic.ts";
import {
  editPullRequestThreadComment,
  mergePullRequestThreadComments,
  pullRequestFindingKey,
} from "@t3tools/web/src/components/pullRequest/pullRequestDetail.logic.ts";
import { canEditPullRequestComment } from "@t3tools/web/src/components/pullRequest/pullRequestEditing.logic.ts";
import { orderDiffFiles } from "@t3tools/web/src/components/pullRequest/pullRequestFileOrder.logic.ts";
import {
  countViewedFiles,
  isFileViewed,
  isStaleViewedState,
  revertFileViewedOverlay,
  settleFileViewedOverlay,
  toFileViewedBatch,
  toFileViewedStates,
  type FileViewedOverlay,
  type FileViewedStates,
} from "@t3tools/web/src/components/pullRequest/pullRequestFilesViewed.logic.ts";
import { buildPullRequestActorModel } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import type { PullRequestReactionBarModel } from "@t3tools/web/src/components/pullRequest/pullRequestReactions.logic.ts";
import { buildPullRequestReviewThreadCardModel } from "@t3tools/web/src/components/pullRequest/PullRequestReviewAnnotation.logic.ts";
import {
  nextPendingReviewCommentId,
  pullRequestReviewKey,
  usePullRequestReviewStore,
} from "@t3tools/web/src/components/pullRequest/pullRequestReviewStore.ts";
import {
  buildDiffReviewComment,
  resolveDiffReviewPosition,
} from "@t3tools/web/src/reviewCommentContext.ts";
import { diffFileOldPath, hydratedDiffFile } from "@t3tools/web/src/lib/diffFileContents.ts";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
  type RenderablePatch,
} from "@t3tools/web/src/lib/diffRendering.ts";
import { formatRelativeTimeLabel } from "@t3tools/web/src/timestampFormat.ts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { readQuery } from "../pullRequestShared.ts";
import type {
  PullRequestCodeFileView,
  PullRequestCodeSegmentView,
  PullRequestCodeThreadView,
  PullRequestCodeView,
} from "../views/pullRequests.ts";
import { pullRequestDetailSession, type PullRequestDetailFrame } from "./pullRequestDetail.ts";
import {
  buildPullRequestBodyView,
  editorView,
  pullRequestReactionsService,
  type PullRequestBodyMedia,
  type PullRequestEditorUi,
} from "./pullRequestSummary.ts";
import {
  buildStaticDiffFile,
  canHydrateFile,
  changeIcon,
  EXPANSION_LINE_COUNT,
  type RightPanelDiffRow,
} from "./rightPanelDiff.ts";

const FILE_TREE_STORAGE_KEY = "t3code.pullRequestFileTreeOpen";
const APP_BASE_NAME = "Local Studio";
const VIEWED_FLUSH_MS = 400;
const NO_SLICES: ReadonlyArray<CodeSlice> = [];

const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const PathParams = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));
const EnabledParams = Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean }));
const LayoutParams = Schema.decodeUnknownSync(
  Schema.Struct({ layout: Schema.Literals(["stacked", "split"]) }),
);
const ViewedParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, path: Schema.String, viewed: Schema.Boolean }),
);
const ThreadParams = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.String }));
const ReplyParams = Schema.decodeUnknownSync(
  Schema.Struct({ threadId: Schema.String, body: Schema.String }),
);
const CommentEditParams = Schema.decodeUnknownSync(
  Schema.Struct({ threadId: Schema.String, commentId: Schema.String }),
);
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));
const ModeParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["write", "preview"]) }),
);
const SideSchema = Schema.Literals(["left", "right"]);
const DraftParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    side: SideSchema,
    line: Schema.Number,
    startSide: Schema.optional(SideSchema),
    startLine: Schema.optional(Schema.Number),
  }),
);
const ExpandParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    hunkIndex: Schema.Number,
    direction: Schema.Literals(["up", "down", "both"]),
    all: Schema.Boolean,
  }),
);

type DiffSide = "left" | "right";

type ExpandedRegion = { readonly fromStart: number; readonly fromEnd: number };

type FileDiff = Extract<RenderablePatch, { readonly kind: "files" }>["files"][number];

type CodeSlice = {
  readonly cursor: string | null;
  readonly patch: string;
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly omittedFileStats: ReadonlyArray<PullRequestOmittedFileStat>;
};

type ThreadPage = {
  readonly comments: ReadonlyArray<PullRequestThreadComment>;
  readonly nextCursor: string | null;
};

type CodeEditor = PullRequestEditorUi & { readonly threadId: string };

type CodeDraft = {
  readonly fileKey: string;
  readonly path: string;
  readonly oldPath: string | null;
  readonly position: PullRequestReviewPosition;
  readonly startSide: DiffSide;
  readonly startLine: number;
  readonly side: DiffSide;
  readonly line: number;
  readonly revision: number;
};

type CodeUi = {
  readonly scope: string | null;
  readonly cursor: string | null;
  readonly slices: ReadonlyArray<CodeSlice>;
  readonly toggled: ReadonlySet<string>;
  readonly foldOverride: DiffFoldOverride;
  readonly visibleCommitCount: number;
  readonly orphansOpen: boolean;
  readonly treeCollapsed: ReadonlyArray<string>;
  readonly treeSelected: string | null;
  readonly reveal: { readonly key: string; readonly revision: number } | null;
  readonly threadPending: boolean;
  readonly pages: ReadonlyMap<string, ThreadPage>;
  readonly loadingMore: ReadonlySet<string>;
  readonly replyRevision: ReadonlyMap<string, number>;
  readonly editor: CodeEditor | null;
  readonly editorSaving: boolean;
  readonly draft: CodeDraft | null;
  readonly expansions: ReadonlyMap<string, ReadonlyMap<number, ExpandedRegion>>;
  readonly hydrated: ReadonlyMap<string, { readonly source: FileDiff; readonly file: FileDiff }>;
  readonly hydrating: ReadonlySet<string>;
  readonly appliedRefresh: number;
};

function initialUi(scope: string | null, appliedRefresh: number): CodeUi {
  return {
    scope,
    cursor: null,
    slices: NO_SLICES,
    toggled: new Set(),
    foldOverride: null,
    visibleCommitCount: PULL_REQUEST_COMMIT_PAGE_SIZE,
    orphansOpen: false,
    treeCollapsed: [],
    treeSelected: null,
    reveal: null,
    threadPending: false,
    pages: new Map(),
    loadingMore: new Set(),
    replyRevision: new Map(),
    editor: null,
    editorSaving: false,
    draft: null,
    expansions: new Map(),
    hydrated: new Map(),
    hydrating: new Set(),
    appliedRefresh,
  };
}

type ViewedUi = {
  readonly scope: string | null;
  readonly overlay: FileViewedOverlay;
};

type ParsedSlice = { readonly key: string; readonly parsed: RenderablePatch | null };

function codeScope(frame: PullRequestDetailFrame, commit: string | null): string {
  const reference = pullRequestReviewKey(frame.reference);
  return `${frame.target.environmentId}:${commit === null ? reference : `${reference}@${commit}`}`;
}

function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function sameSlice(left: CodeSlice, right: CodeSlice): boolean {
  return (
    left.patch === right.patch &&
    left.truncated === right.truncated &&
    left.nextCursor === right.nextCursor &&
    left.omittedFileStats.length === right.omittedFileStats.length &&
    left.omittedFileStats.every((file, index) => {
      const other = right.omittedFileStats[index];
      return (
        other !== undefined &&
        other.path === file.path &&
        other.additions === file.additions &&
        other.deletions === file.deletions
      );
    })
  );
}

function readFileTreeOpen(storage: Storage): boolean {
  return storage.getItem(FILE_TREE_STORAGE_KEY) === "true";
}

export function createPullRequestCodeFeature(context: FeatureContext): CoreFeature {
  const { registry, state, storage } = context;
  const session = pullRequestDetailSession(context);
  const reactions = pullRequestReactionsService(context);
  const uiAtom = Atom.make<CodeUi>(initialUi(null, 0)).pipe(Atom.keepAlive);
  const viewedAtom = Atom.make<ViewedUi>({ scope: null, overlay: new Map() }).pipe(Atom.keepAlive);
  const fileTreeOpenAtom = Atom.make(readFileTreeOpen(storage)).pipe(Atom.keepAlive);
  const wordWrapAtom = Atom.make<boolean | null>(null).pipe(Atom.keepAlive);
  const whitespaceAtom = Atom.make<boolean | null>(null).pipe(Atom.keepAlive);
  const parseCache = new Map<string, RenderablePatch | null>();
  let editorRevision = 0;
  let revealRevision = 0;
  let draftRevision = 0;
  let latestFiles: ReadonlyMap<string, { readonly source: FileDiff; readonly file: FileDiff }> =
    new Map();
  let latestSourceFiles: ReadonlyArray<FileDiff> = [];
  const reviewStoreAtom = Atom.make((get) => {
    get.addFinalizer(usePullRequestReviewStore.subscribe((value) => get.setSelf(value)));
    return usePullRequestReviewStore.getState();
  }).pipe(Atom.keepAlive);

  const scopeOf = (frame: PullRequestDetailFrame) =>
    codeScope(
      frame,
      frame.ui.codeCommit?.pullRequestKey === frame.pullRequestKey ? frame.ui.codeCommit.oid : null,
    );
  const commitOf = (frame: PullRequestDetailFrame) =>
    frame.ui.codeCommit?.pullRequestKey === frame.pullRequestKey ? frame.ui.codeCommit.oid : null;

  const readUi = (scope: string, refresh: number): CodeUi => {
    const ui = registry.get(uiAtom);
    return ui.scope === scope ? ui : initialUi(scope, refresh);
  };
  const updateUi = (update: (ui: CodeUi) => CodeUi) => {
    const frame = session.current();
    if (frame === null) return;
    registry.set(uiAtom, update(readUi(scopeOf(frame), frame.codeRefreshToken)));
  };

  const viewedScopeOf = (frame: PullRequestDetailFrame) =>
    `${frame.target.environmentId} ${frame.reference.projectId} ${frame.reference.repository} ${frame.reference.number}`;
  const readViewed = (scope: string): ViewedUi => {
    const viewed = registry.get(viewedAtom);
    return viewed.scope === scope ? viewed : { scope, overlay: new Map() };
  };
  let queued = new Map<string, boolean>();
  let sentBy = new Map<string, number>();
  let answeredFrom = new Map<string, FileViewedStates | null>();
  let requests = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let viewedScope: string | null = null;
  let lastStates: FileViewedStates | null = null;

  const activeUiAtom = Atom.make((get) => {
    const frame = get(session.frameAtom);
    if (frame === null || frame.detail === null) return null;
    const scope = scopeOf(frame);
    const stored = get(uiAtom);
    const ui = stored.scope === scope ? stored : initialUi(scope, frame.codeRefreshToken);
    return { frame, ui, commit: commitOf(frame), scope };
  });

  const diffQueryAtom = Atom.make((get) => {
    const active = get(activeUiAtom);
    if (active === null) return null;
    const { frame, ui, commit } = active;
    const mounted = frame.view.mountedTabs.includes("code");
    if (!mounted) return null;
    const query = readQuery(
      get,
      state.pullRequestEnvironment.diff({
        environmentId: frame.target.environmentId,
        input: {
          ...frame.reference,
          ...(ui.cursor === null ? {} : { cursor: ui.cursor }),
          ...(commit === null ? {} : { commit }),
        },
      }),
    );
    return { scope: active.scope, cursor: ui.cursor, query };
  });

  const filesViewedQueryAtom = Atom.make((get) => {
    const frame = get(session.frameAtom);
    const detail = frame?.detail ?? null;
    if (frame === null || detail === null || detail.capabilities.viewedFiles === undefined)
      return null;
    if (!frame.view.mountedTabs.includes("code")) return null;
    return readQuery(
      get,
      state.pullRequestEnvironment.filesViewed({
        environmentId: frame.target.environmentId,
        input: frame.reference,
      }),
    );
  });

  const applyDiff = (result: {
    readonly scope: string;
    readonly cursor: string | null;
    readonly data: PullRequestDiffResult;
  }) => {
    const current = registry.get(uiAtom);
    if (current.scope !== null && current.scope !== result.scope) return;
    const base = current.scope === result.scope ? current : null;
    const slices = base?.slices ?? NO_SLICES;
    const next: CodeSlice = {
      cursor: result.cursor,
      patch: result.data.patch,
      truncated: result.data.truncated,
      nextCursor: result.data.nextCursor,
      omittedFileStats: result.data.omittedFileStats ?? [],
    };
    const index = slices.findIndex((slice) => slice.cursor === result.cursor);
    const existing = index === -1 ? undefined : slices[index];
    if (existing !== undefined && sameSlice(existing, next)) return;
    const merged = index === -1 ? [...slices, next] : [...slices.slice(0, index), next];
    const frame = session.current();
    const ui = base ?? initialUi(result.scope, frame?.codeRefreshToken ?? 0);
    registry.set(uiAtom, { ...ui, slices: merged });
  };

  registry.subscribe(
    diffQueryAtom,
    (value) => {
      if (value === null || value.query.data === null) return;
      applyDiff({ scope: value.scope, cursor: value.cursor, data: value.query.data });
    },
    { immediate: true },
  );

  registry.subscribe(
    session.frameAtom,
    (frame) => {
      if (frame === null || frame.detail === null) return;
      const scope = scopeOf(frame);
      const ui = registry.get(uiAtom);
      if (ui.scope !== scope) {
        registry.set(uiAtom, initialUi(scope, frame.codeRefreshToken));
        return;
      }
      if (ui.appliedRefresh !== frame.codeRefreshToken) {
        registry.set(uiAtom, {
          ...ui,
          cursor: null,
          slices: NO_SLICES,
          appliedRefresh: frame.codeRefreshToken,
        });
        const commit = commitOf(frame);
        registry.refresh(
          state.pullRequestEnvironment.diff({
            environmentId: frame.target.environmentId,
            input: { ...frame.reference, ...(commit === null ? {} : { commit }) },
          }),
        );
        if (frame.detail.capabilities.viewedFiles !== undefined) {
          registry.refresh(
            state.pullRequestEnvironment.filesViewed({
              environmentId: frame.target.environmentId,
              input: frame.reference,
            }),
          );
        }
      }
      const commit = commitOf(frame);
      if (commit !== null && !frame.detail.commits.some((entry) => entry.oid === commit)) {
        session.selectCodeCommit(null);
      }
    },
    { immediate: true },
  );

  const flushViewed = () => {
    flushTimer = null;
    const frame = session.current();
    if (frame === null) return;
    const batch = toFileViewedBatch(queued);
    if (batch.length === 0) return;
    queued = new Map();
    const sentFrom = viewedScopeOf(frame);
    requests += 1;
    const request = requests;
    for (const file of batch) sentBy.set(file.path, request);
    void runAtomCommand(
      registry,
      state.pullRequestEnvironment.setFilesViewed,
      { environmentId: frame.target.environmentId, input: { ...frame.reference, files: batch } },
      { reportFailure: false },
    ).then((result) => {
      const mine = batch.map((file) => file.path).filter((path) => sentBy.get(path) === request);
      for (const path of mine) sentBy.delete(path);
      if (viewedScope !== sentFrom) return;
      if (result._tag === "Failure") {
        const owned = new Set(mine.filter((path) => !queued.has(path)));
        const viewed = readViewed(sentFrom);
        registry.set(viewedAtom, {
          scope: sentFrom,
          overlay: revertFileViewedOverlay(viewed.overlay, batch, owned),
        });
        if (owned.size > 0 && !isAtomCommandInterrupted(result)) {
          context.addToast({
            layout: "plain",
            type: "error",
            title: "Could not update viewed files",
          });
        }
        return;
      }
      for (const path of mine) answeredFrom.set(path, lastStates);
      registry.refresh(
        state.pullRequestEnvironment.filesViewed({
          environmentId: frame.target.environmentId,
          input: frame.reference,
        }),
      );
    });
  };

  registry.subscribe(
    filesViewedQueryAtom,
    (query) => {
      const frame = session.current();
      if (frame === null) return;
      const scope = viewedScopeOf(frame);
      if (viewedScope !== scope) {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushViewed();
        }
        queued = new Map();
        sentBy = new Map();
        answeredFrom = new Map();
        viewedScope = scope;
        registry.set(viewedAtom, { scope, overlay: new Map() });
      }
      const states = toFileViewedStates(query?.data ?? null);
      if (states === lastStates) return;
      lastStates = states;
      const pending = new Set([...queued.keys(), ...sentBy.keys()]);
      const answered = new Set<string>();
      for (const [path, from] of answeredFrom) {
        if (pending.has(path) || from === states) continue;
        answered.add(path);
        answeredFrom.delete(path);
      }
      const viewed = readViewed(scope);
      registry.set(viewedAtom, {
        scope,
        overlay: settleFileViewedOverlay(viewed.overlay, states, pending, answered),
      });
    },
    { immediate: true },
  );

  const viewAtom = Atom.make((get): PullRequestCodeView | null => {
    const active = get(activeUiAtom);
    if (active === null) return null;
    const { frame, ui, commit } = active;
    const detail = frame.detail;
    if (detail === null) return null;
    const media: PullRequestBodyMedia = { read: get, state };
    const diff = get(diffQueryAtom);
    const settings = get(context.clientSettingsAtom);
    const wordWrap = get(wordWrapAtom) ?? settings.wordWrap;
    const ignoreWhitespace = get(whitespaceAtom) ?? settings.diffIgnoreWhitespace;
    const layout = settings.diffLayout;
    const fileTreeOpen = get(fileTreeOpenAtom);
    const foldOverride = ui.foldOverride ?? (settings.diffFilesCollapsed ? "folded" : "expanded");
    const slices = ui.slices;
    const parsed: ParsedSlice[] = slices.map((slice) => {
      const key = `pull-request:${active.scope}:${ignoreWhitespace}:${slice.cursor ?? "first"}:${fnv(slice.patch)}`;
      const cached = parseCache.get(key);
      if (cached !== undefined) return { key, parsed: cached };
      const result = getRenderablePatch(slice.patch, key, {
        compactPartialHunkOffsets: true,
        ignoreWhitespace,
      });
      parseCache.set(key, result);
      return { key, parsed: result };
    });
    const originals = parsed.flatMap((entry) =>
      entry.parsed?.kind === "files" ? orderDiffFiles(entry.parsed.files) : [],
    );
    const keys = originals.map((file) => buildFileDiffRenderKey(file));
    const files = originals.map((file, index) => {
      const hydrated = ui.hydrated.get(keys[index] ?? "");
      return hydrated !== undefined && hydrated.source === file ? hydrated.file : file;
    });
    latestFiles = new Map(
      originals.map((source, index) => [
        keys[index] ?? "",
        { source, file: files[index] ?? source },
      ]),
    );
    latestSourceFiles = parsed.flatMap((entry) =>
      entry.parsed?.kind === "files" ? entry.parsed.sourceFiles : [],
    );
    const omitted = new Map(
      slices.flatMap((slice) => slice.omittedFileStats.map((file) => [file.path, file] as const)),
    );
    const nextCursor = slices.at(-1)?.nextCursor ?? null;
    const rawSlices =
      nextCursor === null
        ? parsed.flatMap((entry) =>
            entry.parsed?.kind === "raw"
              ? [{ reason: entry.parsed.reason, text: entry.parsed.text }]
              : [],
          )
        : [];
    const withheldContent =
      slices.some((slice) => slice.truncated) ||
      parsed.some((entry) => entry.parsed?.kind === "raw");
    const review = resolvePullRequestCodeReviewCapabilities(detail, commit);
    const viewedEnabled = detail.capabilities.viewedFiles !== undefined;
    const viewedQuery = get(filesViewedQueryAtom);
    const states = toFileViewedStates(viewedQuery?.data ?? null);
    const viewedState = get(viewedAtom);
    const overlay: FileViewedOverlay =
      viewedState.scope === viewedScopeOf(frame) ? viewedState.overlay : new Map();
    const paths = files.map((file) => resolveFileDiffPath(file));
    const placed = new Set<string>();
    const threadsByFile = new Map<string, PullRequestReviewThread[]>();
    if (commit === null) {
      for (const file of files) {
        const path = resolveFileDiffPath(file);
        for (const thread of detail.reviewThreads) {
          if (
            thread.path === path &&
            thread.line !== null &&
            isLineInFileDiff(file, thread.side, thread.line)
          ) {
            placed.add(thread.id);
            const list = threadsByFile.get(path);
            if (list === undefined) threadsByFile.set(path, [thread]);
            else list.push(thread);
          }
        }
      }
    }
    const fileInputs = files.map((file, index) => {
      const path = resolveFileDiffPath(file);
      const key = keys[index] ?? buildFileDiffRenderKey(file);
      return {
        key,
        path,
        ...pullRequestFileDiffStat({ hunks: file.hunks, omitted: omitted.get(path) }),
        collapsed: isFileDiffCollapsed(key, foldOverride, ui.toggled),
        viewed: viewedEnabled && isFileViewed(path, states, overlay),
        stale: viewedEnabled && !overlay.has(path) && isStaleViewedState(states?.get(path)),
      };
    });
    const orphanThreads = detail.reviewThreads.filter((thread) => !placed.has(thread.id));
    const model = buildPullRequestCodeTabModel({
      detailNumber: detail.number,
      commits: detail.commits,
      selectedCommitOid: commit,
      visibleCommitCount: ui.visibleCommitCount,
      files: fileInputs,
      hasMore: nextCursor !== null,
      diffPending: diff?.query.isPending ?? false,
      diffError: diff?.query.error ?? null,
      loadedSliceCount: slices.length,
      rawSliceCount: rawSlices.length,
      withheldContent,
      inlineComment: review.inlineComment,
      viewed: {
        enabled: viewedEnabled,
        count: countViewedFiles(paths, states, overlay),
        store: detail.capabilities.viewedFiles,
        error: viewedQuery?.error ?? null,
        truncated: viewedQuery?.data?.truncated === true,
      },
      appBaseName: APP_BASE_NAME,
      ignoreWhitespace,
      wordWrap,
      fileTreeOpen,
      allFilesCollapsed: fileInputs.length > 0 && fileInputs.every((file) => file.collapsed),
      diffLayout: layout,
      orphanThreads,
    });
    const reactionUi = get(reactions.uiAtom);
    const threadViews: Record<string, PullRequestCodeThreadView> = {};
    const bars: Record<string, PullRequestReactionBarModel> = {};
    const canReact = detail.capabilities.reactions === true;
    for (const thread of detail.reviewThreads) {
      const card = buildPullRequestReviewThreadCardModel({
        thread,
        loadedPage: ui.pages.get(thread.id) ?? null,
        pending: ui.threadPending,
        fixPending: frame.ui.handoff === pullRequestFindingKey({ kind: "thread", thread }),
        fixLabel: frame.model?.handoffLabels.fixFinding ?? "Fix in a thread",
        canFix: true,
        canResolve: review.resolve,
        canReply: review.reply,
        loadingMore: ui.loadingMore.has(thread.id),
      });
      threadViews[thread.id] = {
        id: thread.id,
        resolved: card.resolved,
        statusLabel: card.statusLabel,
        outdatedLabel: card.outdatedLabel,
        fix: card.fix,
        resolve: card.resolve,
        loadMore: card.loadMore,
        reply: card.reply,
        replyRevision: ui.replyRevision.get(thread.id) ?? 0,
        editLabel: card.editLabel,
        comments: card.comments.map((comment) => {
          if (canReact || (comment.reactions ?? []).length > 0) {
            bars[comment.id] = reactions.bar(
              reactionUi,
              detail.url,
              comment.id,
              comment.reactions ?? [],
              canReact,
            );
          }
          return {
            id: comment.id,
            author: buildPullRequestActorModel(comment.author),
            time: formatRelativeTimeLabel(comment.createdAt),
            body: buildPullRequestBodyView(comment.body, frame, detail, media),
            canEdit: canEditPullRequestComment(detail, {
              author: comment.author,
              kind: "review-comment",
            }),
          };
        }),
      };
    }
    const layoutKind = layout === "split" ? "split" : "unified";
    const reviewKey = pullRequestReviewKey(frame.reference);
    const pendingComments = commit === null ? (get(reviewStoreAtom).drafts[reviewKey] ?? []) : [];
    const draft = ui.draft;
    const fileViews: PullRequestCodeFileView[] = files.map((file, index) => {
      const input = fileInputs[index];
      const path = resolveFileDiffPath(file);
      const key = keys[index] ?? buildFileDiffRenderKey(file);
      if (input === undefined || input.collapsed) {
        return { key, path, changeIcon: changeIcon(file), segments: [] };
      }
      const built = buildStaticDiffFile(file, path, 0, layoutKind, {
        regions: ui.expansions.get(key) ?? new Map(),
        expandable: !file.isPartial || canHydrateFile(file),
        lineCount: EXPANSION_LINE_COUNT,
      });
      const anchorIndex = (side: "left" | "right", line: number) =>
        built.anchors.find((entry) =>
          side === "left" ? entry.oldLine === line : entry.newLine === line,
        )?.index;
      const after = new Map<
        number,
        { threadIds: string[]; pendingIds: string[]; draft: boolean }
      >();
      const slot = (rowIndex: number) => {
        const existing = after.get(rowIndex);
        if (existing !== undefined) return existing;
        const created = { threadIds: [], pendingIds: [], draft: false };
        after.set(rowIndex, created);
        return created;
      };
      for (const thread of threadsByFile.get(path) ?? []) {
        if (thread.line === null) continue;
        const rowIndex = anchorIndex(thread.side, thread.line);
        if (rowIndex !== undefined) slot(rowIndex).threadIds.push(thread.id);
      }
      for (const comment of pendingComments) {
        if (comment.path !== path) continue;
        const anchor = getPullRequestReviewPositionAnchor(comment.position);
        const rowIndex = anchorIndex(anchor.side, anchor.line);
        if (rowIndex !== undefined) slot(rowIndex).pendingIds.push(comment.id);
      }
      if (draft !== null && draft.fileKey === key) {
        const rowIndex = anchorIndex(draft.side, draft.line);
        if (rowIndex !== undefined) slot(rowIndex).draft = true;
      }
      const lineOf = new Map(
        built.anchors.map((anchor) => [
          anchor.index,
          anchor.oldLine === null && anchor.newLine === null
            ? null
            : { oldLine: anchor.oldLine, newLine: anchor.newLine },
        ]),
      );
      const segments: PullRequestCodeSegmentView[] = [];
      let chunk: RightPanelDiffRow[] = [];
      let lines: Array<{
        readonly oldLine: number | null;
        readonly newLine: number | null;
      } | null> = [];
      built.rows.forEach((row, rowIndex) => {
        chunk.push(row);
        lines.push(lineOf.get(rowIndex) ?? null);
        const annotations = after.get(rowIndex);
        if (annotations !== undefined) {
          segments.push({ kind: "rows", rows: chunk, lines });
          segments.push({ kind: "annotations", ...annotations });
          chunk = [];
          lines = [];
        }
      });
      if (chunk.length > 0) segments.push({ kind: "rows", rows: chunk, lines });
      return { key, path, changeIcon: changeIcon(file), segments };
    });
    const pendingViews = Object.fromEntries(
      pendingComments.map((comment) => [comment.id, { body: comment.body }]),
    );
    const tree = fileTreeOpen
      ? buildDiffFileTreeModel({
          entries: diffFileTreeEntries(files),
          selectedPath: ui.treeSelected,
          collapsedDirectoryPaths: ui.treeCollapsed,
        })
      : null;
    const editingComment =
      ui.editor === null
        ? undefined
        : mergePullRequestThreadComments(
            detail.reviewThreads.find((thread) => thread.id === ui.editor?.threadId)?.comments ??
              [],
            ui.pages.get(ui.editor.threadId)?.comments ?? [],
          ).find((comment) => comment.id === ui.editor?.target);
    return {
      active: frame.ui.tab === "code",
      model,
      files: fileViews,
      threads: threadViews,
      reactions: bars,
      reactionPicker: reactionUi.url === detail.url ? reactionUi.picker : null,
      raw: rawSlices,
      tree,
      wordWrap,
      layout,
      orphansOpen: ui.orphansOpen,
      reveal: ui.reveal,
      editor:
        ui.editor === null || editingComment === undefined
          ? null
          : editorView(
              ui.editor,
              ui.editorSaving,
              false,
              editingComment.body,
              "Edit comment",
              null,
              frame,
              detail,
              media,
            ),
      editorThreadId: ui.editor?.threadId ?? null,
      canCommentOnLines: review.canCommentOnLines,
      pending: pendingViews,
      pendingLabel: "Pending — sent when you submit the review",
      pendingRemoveLabel: "Discard this comment",
      draft:
        draft === null
          ? null
          : {
              revision: draft.revision,
              selection: {
                fileKey: draft.fileKey,
                startSide: draft.startSide,
                startLine: draft.startLine,
                side: draft.side,
                line: draft.line,
              },
              rangeLabel: pullRequestDraftRangeLabel(draft.path, draft.position),
              ariaLabel: `Comment on lines ${pullRequestDraftRangeLabel(draft.path, draft.position)}`,
              placeholder: "Add a comment…",
              hint: "⌘/Ctrl Enter to send",
              cancelLabel: "Cancel",
              submitLabel: "Add to review",
              secondaryLabel: "Add to agent",
            },
    };
  });

  const runThreadCommand = async (
    label: string,
    run: (frame: PullRequestDetailFrame) => Promise<{ readonly _tag: string }>,
  ): Promise<boolean> => {
    const frame = session.current();
    if (frame === null) return false;
    const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
    if (ui.threadPending) return false;
    updateUi((current) => ({ ...current, threadPending: true }));
    const result = await run(frame);
    updateUi((current) => ({ ...current, threadPending: false }));
    if (result._tag === "Failure") {
      context.addToast({ layout: "plain", type: "error", title: label });
      return false;
    }
    session.refreshDetail();
    return true;
  };

  const threadOf = (threadId: string) =>
    session.current()?.detail?.reviewThreads.find((thread) => thread.id === threadId);

  return {
    views: { pullRequestCode: viewAtom },
    actions: {
      pullRequestCodeSelectScope: async (params) => {
        session.selectCodeCommit(resolvePullRequestDiffScope(ValueParams(params).value));
        return null;
      },
      pullRequestCodeShowMoreCommits: async () => {
        updateUi((ui) => ({
          ...ui,
          visibleCommitCount: ui.visibleCommitCount + PULL_REQUEST_COMMIT_PAGE_SIZE,
        }));
        return null;
      },
      pullRequestCodeSetWhitespace: async (params) => {
        registry.set(whitespaceAtom, EnabledParams(params).enabled);
        return null;
      },
      pullRequestCodeSetWordWrap: async (params) => {
        registry.set(wordWrapAtom, EnabledParams(params).enabled);
        return null;
      },
      pullRequestCodeSetLayout: async (params) => {
        const { layout } = LayoutParams(params);
        await context.updateClientSettings((current) => ({ ...current, diffLayout: layout }));
        return null;
      },
      pullRequestCodeSetFileTreeOpen: async (params) => {
        const { enabled } = EnabledParams(params);
        storage.setItem(FILE_TREE_STORAGE_KEY, enabled ? "true" : "false");
        registry.set(fileTreeOpenAtom, enabled);
        return null;
      },
      pullRequestCodeToggleAll: async () => {
        const view = registry.get(viewAtom);
        if (view === null) return null;
        updateUi((ui) => ({
          ...ui,
          foldOverride: view.model.toolbar.collapseAll.allCollapsed ? "expanded" : "folded",
          toggled: new Set(),
        }));
        return null;
      },
      pullRequestCodeToggleFile: async (params) => {
        const { key } = KeyParams(params);
        updateUi((ui) => {
          const toggled = new Set(ui.toggled);
          if (toggled.has(key)) toggled.delete(key);
          else toggled.add(key);
          return { ...ui, toggled };
        });
        return null;
      },
      pullRequestCodeSetViewed: async (params) => {
        const { key, path, viewed } = ViewedParams(params);
        const frame = session.current();
        if (frame === null) return null;
        const settings = registry.get(context.clientSettingsAtom);
        updateUi((ui) => ({
          ...ui,
          toggled: toggleFileDiffFoldForViewed(
            key,
            viewed,
            ui.foldOverride ?? (settings.diffFilesCollapsed ? "folded" : "expanded"),
            ui.toggled,
          ),
        }));
        const scope = viewedScopeOf(frame);
        viewedScope = scope;
        const current = readViewed(scope);
        registry.set(viewedAtom, { scope, overlay: new Map(current.overlay).set(path, viewed) });
        queued.set(path, viewed);
        clearTimeout(flushTimer ?? undefined);
        flushTimer = setTimeout(flushViewed, VIEWED_FLUSH_MS);
        return null;
      },
      pullRequestCodeLoadMore: async () => {
        const view = registry.get(viewAtom);
        const frame = session.current();
        if (view === null || frame === null) return null;
        const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
        const next = ui.slices.at(-1)?.nextCursor ?? null;
        if (next === null || next === ui.cursor) return null;
        updateUi((current) => ({ ...current, cursor: next }));
        return null;
      },
      pullRequestCodeRetry: async () => {
        const frame = session.current();
        if (frame === null) return null;
        const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
        const commit = commitOf(frame);
        registry.refresh(
          state.pullRequestEnvironment.diff({
            environmentId: frame.target.environmentId,
            input: {
              ...frame.reference,
              ...(ui.cursor === null ? {} : { cursor: ui.cursor }),
              ...(commit === null ? {} : { commit }),
            },
          }),
        );
        return null;
      },
      pullRequestCodeToggleOrphans: async () => {
        updateUi((ui) => ({ ...ui, orphansOpen: !ui.orphansOpen }));
        return null;
      },
      pullRequestCodeTreeToggleDirectory: async (params) => {
        const { path } = PathParams(params);
        updateUi((ui) => ({
          ...ui,
          treeCollapsed: ui.treeCollapsed.includes(path)
            ? ui.treeCollapsed.filter((entry) => entry !== path)
            : [...ui.treeCollapsed, path],
        }));
        return null;
      },
      pullRequestCodeTreeToggleAll: async () => {
        const view = registry.get(viewAtom);
        const tree = view?.tree ?? null;
        if (tree === null) return null;
        const expanded = tree.header.toggleAllDirectories?.expanded ?? true;
        updateUi((ui) => ({ ...ui, treeCollapsed: expanded ? [...tree.directoryPaths] : [] }));
        return null;
      },
      pullRequestCodeRevealFile: async (params) => {
        const { path } = PathParams(params);
        const view = registry.get(viewAtom);
        const file = view?.model.files.find((entry) => entry.path === path);
        if (file === undefined) return null;
        revealRevision += 1;
        updateUi((ui) => {
          const toggled = new Set(ui.toggled);
          if (file.collapsed) {
            if (toggled.has(file.key)) toggled.delete(file.key);
            else toggled.add(file.key);
          }
          return {
            ...ui,
            toggled,
            treeSelected: path,
            reveal: { key: file.key, revision: revealRevision },
          };
        });
        return null;
      },
      pullRequestCodeThreadFix: async (params) => {
        const thread = threadOf(ThreadParams(params).threadId);
        if (thread !== undefined) session.startFixFinding({ kind: "thread", thread });
        return null;
      },
      pullRequestCodeThreadResolve: async (params) => {
        const thread = threadOf(ThreadParams(params).threadId);
        if (thread === undefined) return null;
        await runThreadCommand(PULL_REQUEST_CODE_TOASTS.resolutionFailed, (frame) =>
          runAtomCommand(
            registry,
            state.pullRequestEnvironment.setThreadResolution,
            {
              environmentId: frame.target.environmentId,
              input: { ...frame.reference, threadId: thread.id, resolved: !thread.isResolved },
            },
            { reportFailure: false },
          ),
        );
        return null;
      },
      pullRequestCodeThreadReply: async (params) => {
        const { threadId, body } = ReplyParams(params);
        const trimmed = body.trim();
        if (trimmed.length === 0) return null;
        const thread = threadOf(threadId);
        if (thread === undefined) return null;
        const sent = await runThreadCommand(PULL_REQUEST_CODE_TOASTS.replyFailed, (frame) =>
          runAtomCommand(
            registry,
            state.pullRequestEnvironment.replyToThread,
            {
              environmentId: frame.target.environmentId,
              input: { ...frame.reference, threadId, body: trimmed },
            },
            { reportFailure: false },
          ),
        );
        if (sent) {
          updateUi((ui) => {
            const pages = new Map(ui.pages);
            const page = pages.get(threadId);
            if (page !== undefined) {
              pages.set(threadId, {
                ...page,
                nextCursor: page.nextCursor ?? thread.nextCommentsCursor ?? null,
              });
            }
            const replyRevision = new Map(ui.replyRevision);
            replyRevision.set(threadId, (replyRevision.get(threadId) ?? 0) + 1);
            return { ...ui, pages, replyRevision };
          });
        }
        return null;
      },
      pullRequestCodeThreadLoadMore: async (params) => {
        const { threadId } = ThreadParams(params);
        const view = registry.get(viewAtom);
        const frame = session.current();
        const thread = threadOf(threadId);
        if (view === null || frame === null || thread === undefined) return null;
        const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
        const page = ui.pages.get(threadId);
        const cursor = page === undefined ? (thread.nextCommentsCursor ?? null) : page.nextCursor;
        if (cursor === null || ui.loadingMore.has(threadId)) return null;
        updateUi((current) => ({
          ...current,
          loadingMore: new Set([...current.loadingMore, threadId]),
        }));
        const result = await runAtomCommand(
          registry,
          state.pullRequestEnvironment.threadComments,
          {
            environmentId: frame.target.environmentId,
            input: { ...frame.reference, threadId, cursor },
          },
          { reportFailure: false },
        );
        updateUi((current) => {
          const loadingMore = new Set(current.loadingMore);
          loadingMore.delete(threadId);
          if (result._tag === "Failure") return { ...current, loadingMore };
          const pages = new Map(current.pages);
          const previous = pages.get(threadId);
          pages.set(threadId, {
            comments: mergePullRequestThreadComments(
              previous?.comments ?? [],
              result.value.comments,
            ),
            nextCursor: result.value.nextCursor,
          });
          return { ...current, loadingMore, pages };
        });
        if (result._tag === "Failure") {
          context.addToast({
            layout: "plain",
            type: "error",
            title: PULL_REQUEST_CODE_TOASTS.loadMoreFailed,
          });
        }
        return null;
      },
      pullRequestCodeCommentEdit: async (params) => {
        const { threadId, commentId } = CommentEditParams(params);
        const frame = session.current();
        const thread = threadOf(threadId);
        if (frame === null || thread === undefined) return null;
        const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
        const comment = mergePullRequestThreadComments(
          thread.comments,
          ui.pages.get(threadId)?.comments ?? [],
        ).find((entry) => entry.id === commentId);
        if (comment === undefined) return null;
        editorRevision += 1;
        updateUi((current) => ({
          ...current,
          editor: {
            threadId,
            target: commentId,
            draft: comment.body,
            preview: false,
            revision: editorRevision,
          },
        }));
        return null;
      },
      pullRequestCodeEditorDraft: async (params) => {
        const { text } = TextParams(params);
        updateUi((ui) =>
          ui.editor === null ? ui : { ...ui, editor: { ...ui.editor, draft: text } },
        );
        return null;
      },
      pullRequestCodeEditorMode: async (params) => {
        const { mode } = ModeParams(params);
        updateUi((ui) =>
          ui.editor === null || ui.editorSaving
            ? ui
            : { ...ui, editor: { ...ui.editor, preview: mode === "preview" } },
        );
        return null;
      },
      pullRequestCodeEditorCancel: async () => {
        updateUi((ui) => (ui.editorSaving ? ui : { ...ui, editor: null }));
        return null;
      },
      pullRequestCodeBeginDraft: async (params) => {
        const { key, side, line, startSide, startLine } = DraftParams(params);
        const view = registry.get(viewAtom);
        const frame = session.current();
        if (view === null || frame === null || !view.canCommentOnLines) return null;
        const file = latestFiles.get(key)?.file;
        if (file === undefined) return null;
        const path = resolveFileDiffPath(file);
        const previousPath = resolveFileDiffPreviousPath(file);
        const sourceFile = latestSourceFiles.find(
          (candidate) => resolveFileDiffPath(candidate) === path,
        );
        const viewerSide = side === "left" ? "deletions" : "additions";
        const position =
          (sourceFile && resolveDiffReviewPosition(sourceFile, line, viewerSide)) ??
          resolveDiffReviewPosition(file, line, viewerSide);
        if (position === null) return null;
        const current = readUi(scopeOf(frame), frame.codeRefreshToken).draft;
        const revision =
          current !== null && current.fileKey === key ? current.revision : (draftRevision += 1);
        updateUi((ui) => ({
          ...ui,
          draft: {
            fileKey: key,
            path,
            oldPath: previousPath === path ? null : previousPath,
            position,
            startSide: startSide ?? side,
            startLine: startLine ?? line,
            side,
            line,
            revision,
          },
        }));
        return null;
      },
      pullRequestCodeExpand: async (params) => {
        const { key, hunkIndex, direction, all } = ExpandParams(params);
        const frame = session.current();
        const entry = latestFiles.get(key);
        if (frame === null || entry === undefined) return null;
        const count = all ? Number.POSITIVE_INFINITY : EXPANSION_LINE_COUNT;
        const expanding = all ? "both" : direction;
        updateUi((ui) => {
          const regions = new Map(ui.expansions.get(key) ?? []);
          const region = regions.get(hunkIndex) ?? { fromStart: 0, fromEnd: 0 };
          regions.set(hunkIndex, {
            fromStart: region.fromStart + (expanding === "up" || expanding === "both" ? count : 0),
            fromEnd: region.fromEnd + (expanding === "down" || expanding === "both" ? count : 0),
          });
          return { ...ui, expansions: new Map(ui.expansions).set(key, regions) };
        });
        const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
        const source = entry.source;
        const hydrated = ui.hydrated.get(key);
        if (!canHydrateFile(source) || ui.hydrating.has(key) || hydrated?.source === source) {
          return null;
        }
        updateUi((current) => ({ ...current, hydrating: new Set(current.hydrating).add(key) }));
        const newPath = resolveFileDiffPath(source);
        const oldPath = diffFileOldPath(source);
        const commit = commitOf(frame);
        const result = await runAtomCommand(
          registry,
          state.pullRequestEnvironment.diffFileContents,
          {
            environmentId: frame.target.environmentId,
            input: {
              ...frame.reference,
              ...(commit === null ? {} : { commit }),
              changeType: source.type,
              oldPath,
              newPath,
            },
          },
          { reportFailure: false },
        );
        const cacheKey = `pull-request:${pullRequestReviewKey(frame.reference)}:${frame.detail?.updatedAt ?? ""}:${commit ?? "all"}`;
        updateUi((current) => {
          const hydrating = new Set(current.hydrating);
          hydrating.delete(key);
          if (result._tag === "Failure" || !source.isPartial) return { ...current, hydrating };
          const file = hydratedDiffFile(source, result.value, cacheKey);
          return {
            ...current,
            hydrating,
            hydrated: new Map(current.hydrated).set(key, { source, file }),
          };
        });
        return null;
      },
      pullRequestCodeDraftCancel: async () => {
        updateUi((ui) => ({ ...ui, draft: null }));
        return null;
      },
      pullRequestCodeDraftAdd: async (params) => {
        const body = TextParams(params).text.trim();
        const frame = session.current();
        if (frame === null || body.length === 0) return null;
        const draft = readUi(scopeOf(frame), frame.codeRefreshToken).draft;
        if (draft === null) return null;
        usePullRequestReviewStore.getState().addComment(pullRequestReviewKey(frame.reference), {
          id: nextPendingReviewCommentId(),
          path: draft.path,
          ...(draft.oldPath === null ? {} : { oldPath: draft.oldPath }),
          position: draft.position,
          body,
        });
        updateUi((ui) => ({ ...ui, draft: null }));
        return null;
      },
      pullRequestCodeDraftAgent: async (params) => {
        const text = TextParams(params).text.trim();
        const frame = session.current();
        const detail = frame?.detail ?? null;
        if (frame === null || detail === null || text.length === 0) return null;
        const draft = readUi(scopeOf(frame), frame.codeRefreshToken).draft;
        if (draft === null) return null;
        const file = latestFiles.get(draft.fileKey)?.file;
        const comment =
          file === undefined
            ? null
            : buildDiffReviewComment({
                id: `pull-request-selection:${draft.fileKey}:${draft.startLine}:${draft.line}`,
                sectionId: `pull-request:${detail.number}`,
                sectionTitle: `PR #${detail.number} review`,
                filePath: draft.path,
                fileDiff: file,
                range: {
                  start: draft.startLine,
                  end: draft.line,
                  side: draft.startSide === "left" ? "deletions" : "additions",
                  endSide: draft.side === "left" ? "deletions" : "additions",
                },
                text,
              });
        updateUi((ui) => ({ ...ui, draft: null }));
        if (comment !== null) session.addSelectionToAgent({ comment, request: text });
        return null;
      },
      pullRequestCodePendingRemove: async (params) => {
        const { key } = KeyParams(params);
        const frame = session.current();
        if (frame === null) return null;
        usePullRequestReviewStore
          .getState()
          .removeComment(pullRequestReviewKey(frame.reference), key);
        return null;
      },
      pullRequestCodeEditorSave: async (params) => {
        const { text } = TextParams(params);
        const frame = session.current();
        if (frame === null) return null;
        const ui = readUi(scopeOf(frame), frame.codeRefreshToken);
        const editor = ui.editor;
        if (editor === null || ui.editorSaving) return null;
        updateUi((current) => ({ ...current, editorSaving: true }));
        const saved = await runThreadCommand(
          PULL_REQUEST_CODE_TOASTS.commentSaveFailed,
          (current) =>
            runAtomCommand(
              registry,
              state.pullRequestEnvironment.updateComment,
              {
                environmentId: current.target.environmentId,
                input: {
                  ...current.reference,
                  commentId: editor.target,
                  kind: "review-comment",
                  body: text,
                },
              },
              { reportFailure: false },
            ),
        );
        updateUi((current) => {
          if (!saved) return { ...current, editorSaving: false };
          const pages = new Map(current.pages);
          const page = pages.get(editor.threadId);
          if (page !== undefined) {
            pages.set(editor.threadId, {
              ...page,
              comments: editPullRequestThreadComment(page.comments, editor.target, text),
            });
          }
          return { ...current, editorSaving: false, editor: null, pages };
        });
        return null;
      },
    },
  };
}
