import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ReviewDiffPreviewResult,
  ReviewDiffPreviewSourceKind,
  ScopedThreadRef,
  VcsRef,
} from "@t3tools/contracts";
import type { DiffLayout } from "@t3tools/contracts/settings";
import {
  buildDefaultCollapsedDiffFileKeys,
  buildDiffBaseRefPickerModel,
  buildDiffFileHunksModel,
  buildDiffPanelBodyModel,
  buildDiffPanelFileListModel,
  buildDiffPanelHeaderModel,
  buildDiffPanelScopeModel,
  buildDiffSplitRows,
  expandCollapsedDiffFile,
  INITIAL_DIFF_COLLAPSED_FILES_STATE,
  orderDiffTurnSummaries,
  resolveBaseRefRemoteToggle,
  resolveBaseRefSearchQuery,
  resolveBaseRefValueChange,
  resolveCollapsedDiffFileKeys,
  resolveDiffLayoutChange,
  resolveDiffPanelLineStat,
  resolveDiffScopeSelection,
  resolveRevealDiffFile,
  resolveSelectedDiffFileKey,
  toggleAllCollapsedDiffFiles,
  toggleCollapsedDiffFile,
  type DiffBaseRefPickerModel,
  type DiffBaseRefSelectionIntent,
  type DiffCollapsedFilesState,
  type DiffCollapseScope,
  type DiffFileChangeTone,
  type DiffLineKind,
  type DiffFileHunksModel,
  type DiffLineModel,
  type DiffPanelBodyModel,
  type DiffPanelContentView,
  type DiffScopeSelectionIntent,
  type DiffPanelFileListModel,
  type DiffPanelHeaderModel,
  type DiffPanelScopeModel,
} from "@t3tools/web/src/components/DiffPanel.logic.ts";
import {
  buildDiffFilePathCopyModel,
  resolveDiffFilePathCopy,
} from "@t3tools/web/src/components/DiffFilePathCopyButton.logic.ts";
import {
  buildDiffFileTreeModel,
  diffFileTreeEntries,
  resolveDiffFileTreeToggleAllDirectories,
  resolveDiffFileTreeToggleDirectory,
  type DiffFileTreeEntry,
} from "@t3tools/web/src/components/diffs/diffFileTree.logic.ts";
import {
  addRequestedReviewFileIndices,
  buildReviewFilePatchRequests,
  buildReviewFilePatchScope,
  buildReviewFileStates,
  buildReviewReadyFilePaths,
  buildReviewRenderableFiles,
  INITIAL_REVIEW_FILE_INDICES,
  isReviewFilePatchPending,
  nextReviewFileIndices,
  parseReviewFilePatch,
  resolveRequestedReviewFileIndices,
  resolveReviewSettledFileCount,
  sortReviewSourceFiles,
  type ParsedReviewFilePatch,
  type ReviewFileRequestState,
} from "@t3tools/web/src/components/diffs/reviewFilePatches.logic.ts";
import { resolveDiffFilePrimaryAction } from "@t3tools/web/src/diffFileActions.logic.ts";
import {
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
} from "@t3tools/web/src/diffPanelStore.ts";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  type RenderablePatch,
  resolveFileDiffPath,
} from "@t3tools/web/src/lib/diffRendering.ts";
import { diffFileOldPath, hydratedDiffFile } from "@t3tools/web/src/lib/diffFileContents.ts";
import {
  DIFF_COMMENT_COPY,
  diffCommentAriaLabel,
} from "@t3tools/web/src/components/diffs/DiffCommentAnnotation.logic.ts";
import {
  annotationSide,
  buildPersistedDiffCommentAnnotations,
  type DiffCommentLineAnnotation,
} from "@t3tools/web/src/components/diffs/AnnotatableCodeView.logic.ts";
import { nextFileCommentId } from "@t3tools/web/src/components/files/fileCommentAnnotations.ts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import {
  buildDiffReviewComment,
  type ReviewCommentContext,
} from "@t3tools/web/src/reviewCommentContext.ts";
import type { SelectedLineRange } from "@pierre/diffs";
import { resolveStorage } from "@t3tools/web/src/lib/storage.ts";
import { resolveSyntaxLanguage } from "@t3tools/web/src/lib/syntaxHighlighting.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { inferCheckpointTurnCountByTurnId } from "@t3tools/web/src/session-logic.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import { openInPreferredEditor } from "@t3tools/web/src/editorPreferences.logic.ts";
import {
  buildFileContextMenuItems,
  resolveFileContextMenuAbsolutePath,
  resolveFileContextMenuActivation,
  resolveFileContextMenuCapabilities,
  type FileContextMenuTarget,
} from "@t3tools/web/src/fileContextMenu.logic.ts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { createJSONStorage } from "zustand/middleware";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { makeRouteRightPanelStateAtom } from "../rightPanelState.ts";
import {
  highlightLinesSync,
  syntaxHighlighterRevisionAtom,
  type SyntaxLine,
  type SyntaxToken,
} from "../syntaxHighlight.ts";
import { resolvePierreFileIcon, type PierreIconView } from "../pierreIcon.ts";
import { computeLineDiffSpans, type LineSpanRange } from "../lineDiff.ts";
import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import { makeWorkspaceMutationIdAtom } from "../workspaceMutation.ts";
import { workspaceMutationRefreshToken } from "@t3tools/web/src/hooks/useWorkspaceMutationRefresh.ts";

const DIFF_FILE_TREE_STORAGE_KEY = "t3code.diffFileTreeOpen";
const DIFF_PATCH_CACHE_SCOPE = "diff-panel:dark";
const MIN_GUTTER_DIGITS = 3;
const MAX_LOADING_SKELETONS = 4;
const COPY_FEEDBACK_MS = 1000;
export const EXPANSION_LINE_COUNT = 100;

const FileTreeOpenJson = Schema.fromJsonString(Schema.Boolean);
const decodeFileTreeOpen = Schema.decodeUnknownSync(FileTreeOpenJson);
const encodeFileTreeOpen = Schema.encodeSync(FileTreeOpenJson);

const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const RemoteToggleParams = Schema.decodeUnknownSync(
  Schema.Struct({ choiceId: Schema.String, checked: Schema.Boolean }),
);
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const FileKeyParams = Schema.decodeUnknownSync(Schema.Struct({ fileKey: Schema.String }));
const PathParams = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));
const ContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ path: Schema.String, x: Schema.Number, y: Schema.Number }),
);
const EnabledParams = Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean }));
const LayoutParams = Schema.decodeUnknownSync(
  Schema.Struct({ layout: Schema.Literals(["stacked", "split"]) }),
);
const CommentBeginParams = Schema.decodeUnknownSync(
  Schema.Struct({
    fileKey: Schema.String,
    side: Schema.Literals(["additions", "deletions"]),
    line: Schema.Number,
    startSide: Schema.Literals(["additions", "deletions"]),
    startLine: Schema.Number,
  }),
);
const CommentTextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));
const CommentEntryParams = Schema.decodeUnknownSync(
  Schema.Struct({ entryId: Schema.optionalKey(Schema.String) }),
);
const ExpandParams = Schema.decodeUnknownSync(
  Schema.Struct({
    fileKey: Schema.String,
    hunkIndex: Schema.Number,
    direction: Schema.Literals(["up", "down", "both"]),
    all: Schema.Boolean,
  }),
);

type FileDiff = Extract<RenderablePatch, { readonly kind: "files" }>["files"][number];

export function canHydrateFile(file: FileDiff): boolean {
  return file.isPartial && (file.type === "change" || file.type === "rename-changed");
}

type FileEntry = {
  readonly fileDiff: FileDiff;
  readonly fileKey: string;
  readonly fileVersion: number;
};

type ContentsSource = {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly sourceKind: ReviewDiffPreviewSourceKind;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly cacheKey: string;
};

type HydratedFile = { readonly source: FileDiff; readonly file: FileDiff };

type ExpansionState = {
  readonly regions: ReadonlyMap<string, ReadonlyMap<number, StaticDiffExpandedRegion>>;
  readonly hydrated: ReadonlyMap<string, HydratedFile>;
  readonly hydrating: ReadonlySet<string>;
};

type QueryState<A> = {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
};

type FilePatchQuery = Atom.Atom<AsyncResult.AsyncResult<ParsedReviewFilePatch, unknown>>;

export type RightPanelDiffStatView = {
  readonly additionsText: string;
  readonly deletionsText: string;
  readonly ariaLabel: string;
};

export type RightPanelDiffScopeView = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly selected: boolean;
  }>;
  readonly turnMenuLabel: string;
  readonly turnOptions: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly timestampLabel: string;
    readonly selected: boolean;
  }>;
};

export type RightPanelDiffBaseRefChoiceView = {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
  readonly remoteToggle:
    | { readonly kind: "switch"; readonly checked: boolean; readonly ariaLabel: string }
    | { readonly kind: "remote-only"; readonly label: string }
    | { readonly kind: "none" };
};

export type RightPanelDiffBaseRefView = {
  readonly headLabel: string;
  readonly baseRef: string;
  readonly tooltip: string;
  readonly triggerAriaLabel: string;
  readonly query: string;
  readonly searchPlaceholder: string;
  readonly emptyLabel: string;
  readonly branchColumnLabel: string;
  readonly remoteColumnLabel: string;
  readonly automatic: {
    readonly value: string;
    readonly label: string;
    readonly selected: boolean;
  } | null;
  readonly choices: ReadonlyArray<RightPanelDiffBaseRefChoiceView>;
};

export type RightPanelDiffToggleView = {
  readonly pressed: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type RightPanelDiffHeaderView = {
  readonly scope: RightPanelDiffScopeView;
  readonly baseRef: RightPanelDiffBaseRefView | null;
  readonly stat: RightPanelDiffStatView | null;
  readonly refresh: {
    readonly refreshing: boolean;
    readonly ariaLabel: string;
    readonly tooltip: string;
  } | null;
  readonly collapseAll: {
    readonly icon: "chevrons-up-down" | "chevrons-down-up";
    readonly ariaLabel: string;
    readonly tooltip: string;
  } | null;
  readonly layout: {
    readonly value: DiffLayout;
    readonly options: ReadonlyArray<{
      readonly value: DiffLayout;
      readonly ariaLabel: string;
      readonly icon: "rows-3" | "columns-2";
      readonly selected: boolean;
    }>;
  };
  readonly wordWrap: RightPanelDiffToggleView;
  readonly whitespace: RightPanelDiffToggleView;
  readonly fileTree: RightPanelDiffToggleView | null;
};

export type RightPanelDiffSideLine = {
  readonly lineKind: DiffLineKind;
  readonly number: number | null;
  readonly tokens: ReadonlyArray<RightPanelDiffToken>;
};

export type RightPanelDiffFileHeaderRow = {
  readonly kind: "file-header";
  readonly fileKey: string;
  readonly path: string;
  readonly tone: DiffFileChangeTone;
  readonly changeIcon: "added" | "deleted" | "modified" | "moved";
  readonly collapsed: boolean;
  readonly toggleDisabled: boolean;
  readonly toggleTooltip: string;
  readonly copy: {
    readonly ariaLabel: string;
    readonly tooltip: string;
    readonly icon: "check" | "copy";
  };
  readonly stat:
    | ({ readonly style: "label" } & RightPanelDiffStatView)
    | { readonly style: "counts"; readonly additionsText: string; readonly deletionsText: string };
  readonly loadStatus: {
    readonly kind: "error" | "truncated";
    readonly tooltip: string;
  } | null;
};

export type StaticDiffExpandButton = "up" | "down" | "both";

export type StaticDiffSeparatorExpand = {
  readonly hunkIndex: number;
  readonly buttons: ReadonlyArray<StaticDiffExpandButton>;
};

export type RightPanelDiffLineAnchor = {
  readonly fileKey: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
};

export type RightPanelDiffCommentEntry =
  | {
      readonly kind: "comment";
      readonly id: string;
      readonly rangeLabel: string;
      readonly text: string;
      readonly deleteLabel: string;
    }
  | {
      readonly kind: "draft";
      readonly id: string;
      readonly rangeLabel: string;
      readonly ariaLabel: string;
      readonly placeholder: string;
      readonly submitLabel: string;
      readonly cancelLabel: string;
      readonly sendHint: string;
    };

type DiffCommentAnnotationEntry = {
  readonly id: string;
  readonly kind: "draft" | "comment";
  readonly range: SelectedLineRange;
  readonly rangeLabel: string;
  readonly text: string;
};

type DiffCommentAnnotation = {
  readonly side: "additions" | "deletions";
  readonly line: number;
  readonly entries: ReadonlyArray<DiffCommentAnnotationEntry>;
};

type CommentDraft = {
  readonly fileKey: string;
  readonly annotation: DiffCommentAnnotation;
};

const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

export type RightPanelDiffRow =
  | RightPanelDiffFileHeaderRow
  | {
      readonly kind: "separator";
      readonly label: string;
      readonly expand?: StaticDiffSeparatorExpand;
    }
  | {
      readonly kind: "line";
      readonly gutterDigits: number;
      readonly line: RightPanelDiffSideLine;
      readonly anchor?: RightPanelDiffLineAnchor;
    }
  | {
      readonly kind: "split";
      readonly gutterDigits: number;
      readonly left: RightPanelDiffSideLine | null;
      readonly right: RightPanelDiffSideLine | null;
      readonly anchor?: RightPanelDiffLineAnchor;
    }
  | {
      readonly kind: "comments";
      readonly fileKey: string;
      readonly hasDraft: boolean;
      readonly entries: ReadonlyArray<RightPanelDiffCommentEntry>;
    }
  | { readonly kind: "file-end" };

export type RightPanelDiffTreeRow =
  | {
      readonly kind: "directory";
      readonly path: string;
      readonly name: string;
      readonly depth: number;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly name: string;
      readonly depth: number;
      readonly statusLetter: string | null;
      readonly statusTitle: string;
      readonly icon: PierreIconView;
      readonly tone: string;
      readonly selected: boolean;
    };

export type RightPanelDiffFileTreeView = {
  readonly title: string;
  readonly fileCount: number;
  readonly toggleAll: {
    readonly icon: "chevrons-down-up" | "chevrons-up-down";
    readonly ariaLabel: string;
    readonly tooltip: string;
  } | null;
  readonly rows: ReadonlyArray<RightPanelDiffTreeRow>;
};

export type RightPanelDiffContentView =
  | Exclude<DiffPanelContentView, { readonly kind: "files" }>
  | {
      readonly kind: "files";
      readonly layout: "unified" | "split";
      readonly wrap: boolean;
      readonly rows: ReadonlyArray<RightPanelDiffRow>;
      readonly lineSelection: boolean;
      readonly pendingCount: number;
      readonly loadMoreKey: string | null;
      readonly scrollTarget: { readonly fileKey: string; readonly key: string } | null;
      readonly fileTree: RightPanelDiffFileTreeView | null;
    };

export type RightPanelDiffBodyView =
  | { readonly kind: "message"; readonly message: string }
  | {
      readonly kind: "content";
      readonly notice: string | null;
      readonly error: string | null;
      readonly view: RightPanelDiffContentView;
    };

export type RightPanelDiffView = {
  readonly threadKey: string;
  readonly header: RightPanelDiffHeaderView;
  readonly body: RightPanelDiffBodyView;
};

type DiffModel = {
  readonly route: ScopedThreadRef;
  readonly activeCwd: string | undefined;
  readonly repositoryRoot: string | undefined;
  readonly scope: DiffPanelScopeModel;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly reviewCommentsVersion: number;
  readonly orderedTurnIds: ReadonlyArray<string>;
  readonly orderedTurnValues: (value: string) => DiffScopeSelectionIntent;
  readonly header: DiffPanelHeaderModel;
  readonly baseRefPicker: DiffBaseRefPickerModel | null;
  readonly baseRefQuery: string;
  readonly body: DiffPanelBodyModel;
  readonly fileList: DiffPanelFileListModel;
  readonly entries: ReadonlyArray<FileEntry>;
  readonly collapseScope: DiffCollapseScope;
  readonly collapsedKeys: ReadonlySet<string>;
  readonly lazy: boolean;
  readonly filePatchScope: string;
  readonly settledFileCount: number;
  readonly fileCount: number;
  readonly retryQueries: ReadonlyMap<string, FilePatchQuery>;
  readonly refreshQuery: Atom.Atom<unknown> | null;
  readonly fileTreeEntries: ReadonlyArray<DiffFileTreeEntry>;
  readonly layout: DiffLayout;
  readonly wrap: boolean;
  readonly fileTreeOpen: boolean;
  readonly contentsSource: ContentsSource | null;
};

function queryState<A, E>(result: AsyncResult.AsyncResult<A, E> | null): QueryState<A> {
  if (result === null) return { data: null, error: null, isPending: false };
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    isPending: result.waiting,
  };
}

function readFileTreeOpen(storage: Storage): boolean {
  const raw = storage.getItem(DIFF_FILE_TREE_STORAGE_KEY);
  if (raw === null) return false;
  try {
    return decodeFileTreeOpen(raw);
  } catch {
    return false;
  }
}

export function changeIcon(fileDiff: FileDiff): RightPanelDiffFileHeaderRow["changeIcon"] {
  switch (fileDiff.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "moved";
    case "change":
      return "modified";
  }
}

export type RightPanelDiffToken = SyntaxToken & { readonly emphasis?: true };

type DiffTokens = ReadonlyArray<RightPanelDiffToken>;

type HighlightedFile = {
  readonly revision: number;
  readonly tokens: ReadonlyMap<DiffLineModel, DiffTokens>;
  readonly hunks: DiffFileHunksModel;
  readonly gutterDigits: number;
};

const highlightedFiles = new WeakMap<FileDiff, HighlightedFile>();

function plainTokens(text: string): DiffTokens {
  return [{ text, dark: null, light: null }];
}

function emphasize(tokens: DiffTokens, ranges: ReadonlyArray<LineSpanRange>): DiffTokens {
  if (ranges.length === 0) return tokens;
  const boundaries = [...new Set(ranges.flat())].toSorted((left, right) => left - right);
  const inRange = (offset: number) =>
    ranges.some(([start, end]) => offset >= start && offset < end);
  const result: RightPanelDiffToken[] = [];
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    const cuts = [offset, ...boundaries.filter((cut) => cut > offset && cut < end), end];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const start = cuts[index] ?? offset;
      const stop = cuts[index + 1] ?? end;
      if (stop <= start) continue;
      const { emphasis: _emphasis, ...base } = token;
      result.push({
        ...base,
        text: token.text.slice(start - offset, stop - offset),
        ...(inRange(start) ? { emphasis: true } : {}),
      });
    }
    offset = end;
  }
  return result;
}

const DEFAULT_TOKEN_COLORS = { dark: "#FAFAFA", light: "#0A0A0A" };

function compactTokens(tokens: SyntaxLine): SyntaxLine {
  const compacted: SyntaxToken[] = [];
  for (const token of tokens) {
    const plain =
      token.dark === DEFAULT_TOKEN_COLORS.dark && token.light === DEFAULT_TOKEN_COLORS.light;
    const dark = plain ? null : token.dark;
    const light = plain ? null : token.light;
    const previous = compacted.at(-1);
    if (
      previous !== undefined &&
      previous.dark === dark &&
      previous.light === light &&
      previous.fontStyle === token.fontStyle
    ) {
      compacted[compacted.length - 1] = { ...previous, text: previous.text + token.text };
      continue;
    }
    compacted.push({
      text: token.text,
      dark,
      light,
      ...(token.fontStyle === undefined ? {} : { fontStyle: token.fontStyle }),
    });
  }
  return compacted;
}

function highlightFile(fileDiff: FileDiff, path: string, revision: number): HighlightedFile {
  const cached = highlightedFiles.get(fileDiff);
  if (cached !== undefined && (cached.revision === revision || cached.revision === -1)) {
    return cached;
  }
  const hunks = cached?.hunks ?? buildDiffFileHunksModel(fileDiff);
  const lines = hunks.hunks.flatMap((hunk) => hunk.lines);
  const oldSide: string[] = [];
  const newSide: string[] = [];
  for (const line of lines) {
    if (line.kind !== "addition") oldSide.push(line.text);
    if (line.kind !== "deletion") newSide.push(line.text);
  }
  const language = resolveSyntaxLanguage(path);
  const oldTokens = highlightLinesSync(oldSide, language);
  const newTokens = highlightLinesSync(newSide, language);
  let oldIndex = 0;
  let newIndex = 0;
  let maxLineNumber = 0;
  const tokens = new Map<DiffLineModel, DiffTokens>();
  for (const line of lines) {
    const lineTokens = line.kind === "deletion" ? oldTokens?.[oldIndex] : newTokens?.[newIndex];
    if (line.kind !== "addition") oldIndex += 1;
    if (line.kind !== "deletion") newIndex += 1;
    tokens.set(line, lineTokens ? compactTokens(lineTokens) : plainTokens(line.text));
    maxLineNumber = Math.max(maxLineNumber, line.oldLineNumber ?? 0, line.newLineNumber ?? 0);
  }
  for (const hunk of hunks.hunks) {
    for (const { left, right } of buildDiffSplitRows(hunk.lines)) {
      if (left?.kind !== "deletion" || right?.kind !== "addition") continue;
      const spans = computeLineDiffSpans(left.text, right.text);
      if (spans === null) continue;
      tokens.set(left, emphasize(tokens.get(left) ?? plainTokens(left.text), spans.deletion));
      tokens.set(right, emphasize(tokens.get(right) ?? plainTokens(right.text), spans.addition));
    }
  }
  const highlighted: HighlightedFile = {
    revision: oldTokens !== null && newTokens !== null ? -1 : revision,
    tokens,
    hunks,
    gutterDigits: Math.max(MIN_GUTTER_DIGITS, String(maxLineNumber).length),
  };
  highlightedFiles.set(fileDiff, highlighted);
  return highlighted;
}

function unmodifiedLabel(count: number): string {
  return `${count} unmodified line${count === 1 ? "" : "s"}`;
}

function sideLine(line: DiffLineModel, tokens: DiffTokens): RightPanelDiffSideLine {
  return {
    lineKind: line.kind,
    number: line.kind === "deletion" ? line.oldLineNumber : line.newLineNumber,
    tokens,
  };
}

export type StaticDiffLineAnchor = {
  readonly index: number;
  readonly oldLine: number | null;
  readonly newLine: number | null;
};

export type StaticDiffExpandedRegion = { readonly fromStart: number; readonly fromEnd: number };

export type StaticDiffExpansion = {
  readonly regions: ReadonlyMap<number, StaticDiffExpandedRegion>;
  readonly expandable: boolean;
  readonly lineCount: number;
};

const MORE_CONTEXT_LABEL = "More unchanged context may be available";
const contextTokenCache = new WeakMap<FileDiff, ReadonlyArray<DiffTokens | undefined>>();

function contextTokens(fileDiff: FileDiff, path: string): ReadonlyArray<DiffTokens | undefined> {
  const cached = contextTokenCache.get(fileDiff);
  if (cached !== undefined) return cached;
  const lines = fileDiff.additionLines.map((line) => line.replace(/\r?\n$/, ""));
  const highlighted = highlightLinesSync(lines, resolveSyntaxLanguage(path));
  const tokens = lines.map((text, index) => {
    const line = highlighted?.[index];
    return line === undefined ? plainTokens(text) : compactTokens(line);
  });
  if (highlighted !== null) contextTokenCache.set(fileDiff, tokens);
  return tokens;
}

function expandedRegion(
  isPartial: boolean,
  rangeSize: number,
  region: StaticDiffExpandedRegion | undefined,
  trailing: boolean,
): { readonly fromStart: number; readonly fromEnd: number; readonly collapsed: number } {
  const size = Math.max(rangeSize, 0);
  if (size === 0 || isPartial) return { fromStart: 0, fromEnd: 0, collapsed: size };
  if (size <= 1) return { fromStart: size, fromEnd: 0, collapsed: 0 };
  const fromStart = Math.min(Math.max(region?.fromStart ?? 0, 0), size);
  const fromEnd = trailing ? 0 : Math.min(Math.max(region?.fromEnd ?? 0, 0), size);
  if (fromStart + fromEnd >= size) return { fromStart: size, fromEnd: 0, collapsed: 0 };
  return { fromStart, fromEnd, collapsed: size - fromStart - fromEnd };
}

function separatorButtons(
  first: boolean,
  last: boolean,
  chunked: boolean,
): ReadonlyArray<StaticDiffExpandButton> {
  if (!chunked) return [!first && !last ? "both" : first ? "down" : "up"];
  const buttons: StaticDiffExpandButton[] = [];
  if (!first) buttons.push("up");
  if (!last) buttons.push("down");
  return buttons;
}

function appendContextLines(
  rows: RightPanelDiffRow[],
  fileDiff: FileDiff,
  tokens: ReadonlyArray<DiffTokens | undefined>,
  gutterDigits: number,
  layout: "unified" | "split",
  newIndex: number,
  oldIndex: number,
  count: number,
  anchors?: StaticDiffLineAnchor[],
): void {
  for (let offset = 0; offset < count; offset += 1) {
    const text = (fileDiff.additionLines[newIndex + offset] ?? "").replace(/\r?\n$/, "");
    const lineTokens = tokens[newIndex + offset] ?? plainTokens(text);
    const newLine = newIndex + offset + 1;
    const oldLine = oldIndex + offset + 1;
    if (layout === "unified") {
      rows.push({
        kind: "line",
        gutterDigits,
        line: { lineKind: "context", number: newLine, tokens: lineTokens },
      });
    } else {
      rows.push({
        kind: "split",
        gutterDigits,
        left: { lineKind: "context", number: oldLine, tokens: lineTokens },
        right: { lineKind: "context", number: newLine, tokens: lineTokens },
      });
    }
    anchors?.push({ index: rows.length - 1, oldLine, newLine });
  }
}

function appendFileLines(
  rows: RightPanelDiffRow[],
  highlighted: HighlightedFile,
  layout: "unified" | "split",
  anchors?: StaticDiffLineAnchor[],
  expansion?: StaticDiffExpansion & { readonly fileDiff: FileDiff; readonly path: string },
): void {
  const tokensByLine = highlighted.tokens;
  const gutterDigits = expansion
    ? Math.max(
        highlighted.gutterDigits,
        String(
          Math.max(
            expansion.fileDiff.additionLines.length,
            expansion.fileDiff.deletionLines.length,
          ),
        ).length,
      )
    : highlighted.gutterDigits;
  const fileDiff = expansion?.fileDiff;
  const fullTokens =
    expansion !== undefined && fileDiff !== undefined && !fileDiff.isPartial
      ? contextTokens(fileDiff, expansion.path)
      : [];
  highlighted.hunks.hunks.forEach((hunk, hunkIndex) => {
    const fileHunk = fileDiff?.hunks[hunkIndex];
    if (expansion === undefined || fileDiff === undefined || fileHunk === undefined) {
      if (hunk.collapsedBefore > 0) {
        rows.push({ kind: "separator", label: unmodifiedLabel(hunk.collapsedBefore) });
      }
    } else {
      const rangeSize = Math.max(fileHunk.collapsedBefore, 0);
      const region = expandedRegion(
        fileDiff.isPartial,
        rangeSize,
        expansion.regions.get(hunkIndex),
        false,
      );
      const gapNew = fileHunk.additionLineIndex - rangeSize;
      const gapOld = fileHunk.deletionLineIndex - rangeSize;
      appendContextLines(
        rows,
        fileDiff,
        fullTokens,
        gutterDigits,
        layout,
        gapNew,
        gapOld,
        region.fromStart,
        anchors,
      );
      if (region.collapsed > 0) {
        rows.push({
          kind: "separator",
          label: unmodifiedLabel(region.collapsed),
          ...(expansion.expandable
            ? {
                expand: {
                  hunkIndex,
                  buttons: separatorButtons(
                    hunkIndex === 0,
                    false,
                    rangeSize > expansion.lineCount,
                  ),
                },
              }
            : {}),
        });
      }
      const endStart = rangeSize - region.fromEnd;
      appendContextLines(
        rows,
        fileDiff,
        fullTokens,
        gutterDigits,
        layout,
        gapNew + endStart,
        gapOld + endStart,
        region.fromEnd,
        anchors,
      );
    }
    if (layout === "unified") {
      for (const line of hunk.lines) {
        rows.push({
          kind: "line",
          gutterDigits,
          line: sideLine(line, tokensByLine.get(line) ?? plainTokens(line.text)),
        });
        anchors?.push({
          index: rows.length - 1,
          oldLine: line.kind === "addition" ? null : line.oldLineNumber,
          newLine: line.kind === "deletion" ? null : line.newLineNumber,
        });
      }
      return;
    }
    for (const split of buildDiffSplitRows(hunk.lines)) {
      const left = split.left;
      const right = split.right;
      rows.push({
        kind: "split",
        gutterDigits,
        left:
          left === null
            ? null
            : {
                lineKind: left.kind,
                number: left.oldLineNumber,
                tokens: tokensByLine.get(left) ?? plainTokens(left.text),
              },
        right:
          right === null
            ? null
            : {
                lineKind: right.kind,
                number: right.newLineNumber,
                tokens: tokensByLine.get(right) ?? plainTokens(right.text),
              },
      });
      anchors?.push({
        index: rows.length - 1,
        oldLine: left === null || left.kind === "addition" ? null : left.oldLineNumber,
        newLine: right === null || right.kind === "deletion" ? null : right.newLineNumber,
      });
    }
  });
  const lastHunk = fileDiff?.hunks.at(-1);
  if (expansion !== undefined && fileDiff !== undefined && lastHunk !== undefined) {
    const hunkIndex = fileDiff.hunks.length;
    if (fileDiff.isPartial) {
      if (expansion.expandable) {
        rows.push({
          kind: "separator",
          label: MORE_CONTEXT_LABEL,
          expand: { hunkIndex, buttons: separatorButtons(false, true, false) },
        });
      }
    } else if (fileDiff.additionLines.length > 0 && fileDiff.deletionLines.length > 0) {
      const newIndex = lastHunk.additionLineIndex + lastHunk.additionCount;
      const oldIndex = lastHunk.deletionLineIndex + lastHunk.deletionCount;
      const remaining = Math.min(
        fileDiff.additionLines.length - newIndex,
        fileDiff.deletionLines.length - oldIndex,
      );
      if (remaining > 0) {
        const region = expandedRegion(false, remaining, expansion.regions.get(hunkIndex), true);
        appendContextLines(
          rows,
          fileDiff,
          fullTokens,
          gutterDigits,
          layout,
          newIndex,
          oldIndex,
          region.fromStart,
          anchors,
        );
        if (region.collapsed > 0) {
          rows.push({
            kind: "separator",
            label: unmodifiedLabel(region.collapsed),
            ...(expansion.expandable
              ? {
                  expand: {
                    hunkIndex,
                    buttons: separatorButtons(false, true, remaining > expansion.lineCount),
                  },
                }
              : {}),
          });
        }
      }
    }
  }
  rows.push({ kind: "file-end" });
}

export function buildStaticDiffRows(
  patch: string,
  revision: number,
): ReadonlyArray<RightPanelDiffRow> {
  const renderable = getRenderablePatch(patch, "settings-font-preview");
  if (renderable === null || renderable.kind !== "files") return [];
  const entries = renderable.files.map((fileDiff) => ({
    fileDiff,
    fileKey: buildFileDiffIdentityKey(fileDiff),
  }));
  const fileList = buildDiffPanelFileListModel({
    files: entries,
    collapsedFileKeys: new Set(),
    lazy: false,
    readyFilePaths: new Set(),
    fileStats: null,
    fileStates: new Map(),
  });
  const rows: RightPanelDiffRow[] = [];
  entries.forEach((entry, index) => {
    const file = fileList.files[index];
    if (file === undefined) return;
    const copy = buildDiffFilePathCopyModel(false);
    rows.push({
      kind: "file-header",
      fileKey: file.fileKey,
      path: file.path,
      tone: file.tone,
      changeIcon: changeIcon(entry.fileDiff),
      collapsed: false,
      toggleDisabled: true,
      toggleTooltip: file.collapseToggle.tooltip,
      copy: { ariaLabel: copy.ariaLabel, tooltip: copy.tooltip, icon: copy.icon },
      stat: {
        style: "counts",
        additionsText: `+${file.additions}`,
        deletionsText: `-${file.deletions}`,
      },
      loadStatus: null,
    });
    appendFileLines(rows, highlightFile(entry.fileDiff, file.path, revision), "unified");
  });
  return rows;
}

export function buildStaticDiffFile(
  fileDiff: FileDiff,
  path: string,
  revision: number,
  layout: "unified" | "split",
  expansion?: StaticDiffExpansion,
): {
  readonly rows: ReadonlyArray<RightPanelDiffRow>;
  readonly anchors: ReadonlyArray<StaticDiffLineAnchor>;
} {
  const rows: RightPanelDiffRow[] = [];
  const anchors: StaticDiffLineAnchor[] = [];
  appendFileLines(
    rows,
    highlightFile(fileDiff, path, revision),
    layout,
    anchors,
    expansion === undefined ? undefined : { ...expansion, fileDiff, path },
  );
  rows.pop();
  return { rows, anchors };
}

export function rightPanelDiffFeature(context: FeatureContext): CoreFeature {
  const { registry, state, storage } = context;
  useDiffPanelStore.persist.setOptions({
    storage: createJSONStorage(() => resolveStorage(storage)),
  });
  void useDiffPanelStore.persist.rehydrate();

  const diffStoreAtom = Atom.make((get) => {
    get.addFinalizer(useDiffPanelStore.subscribe((value) => get.setSelf(value)));
    return useDiffPanelStore.getState();
  });
  const routePanelAtom = makeRouteRightPanelStateAtom(context.routeAtom);
  const activeAtom = Atom.make((get) => {
    const panel = get(routePanelAtom);
    return panel !== null && panel.state.isOpen && panel.activeSurface?.kind === "diff";
  });

  const wordWrapAtom = Atom.make<boolean | null>(null).pipe(Atom.keepAlive);
  const ignoreWhitespaceAtom = Atom.make<boolean | null>(null).pipe(Atom.keepAlive);
  const fileTreeOpenAtom = Atom.make(readFileTreeOpen(storage)).pipe(Atom.keepAlive);
  const baseRefQueryAtom = Atom.make("").pipe(Atom.keepAlive);
  const collapsedAtom = Atom.make<DiffCollapsedFilesState>(INITIAL_DIFF_COLLAPSED_FILES_STATE).pipe(
    Atom.keepAlive,
  );
  const requestedAtom = Atom.make<ReviewFileRequestState>({
    scope: "",
    indices: INITIAL_REVIEW_FILE_INDICES,
  }).pipe(Atom.keepAlive);
  const treeCollapsedAtom = Atom.make<ReadonlyArray<string>>([]).pipe(Atom.keepAlive);
  const treeSelectedAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const copiedPathAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const scrollRequestAtom = Atom.make<{ readonly fileKey: string; readonly key: string } | null>(
    null,
  ).pipe(Atom.keepAlive);
  const initialExpansion: ExpansionState = {
    regions: new Map<string, ReadonlyMap<number, StaticDiffExpandedRegion>>(),
    hydrated: new Map<string, HydratedFile>(),
    hydrating: new Set<string>(),
  };
  const expansionAtom = Atom.make(initialExpansion).pipe(Atom.keepAlive);
  const commentDraftAtom = Atom.make<CommentDraft | null>(null).pipe(Atom.keepAlive);
  const reviewCommentsVersionAtom = Atom.make(0).pipe(Atom.keepAlive);
  useComposerDraftStore.subscribe((state, previous) => {
    const ids = Object.values(state.draftsByThreadKey)
      .flatMap((draft) => draft.reviewComments.map((comment) => comment.id))
      .sort()
      .join("\u0000");
    const previousIds = Object.values(previous.draftsByThreadKey)
      .flatMap((draft) => draft.reviewComments.map((comment) => comment.id))
      .sort()
      .join("\u0000");
    if (ids !== previousIds) {
      registry.set(reviewCommentsVersionAtom, registry.get(reviewCommentsVersionAtom) + 1);
    }
  });
  const expansionKey = (source: ContentsSource, fileKey: string) =>
    `${source.cacheKey}\u0000${fileKey}`;

  const fileEntries = new WeakMap<FileDiff, FileEntry>();
  const fileEntry = (fileDiff: FileDiff): FileEntry => {
    const cached = fileEntries.get(fileDiff);
    if (cached !== undefined) return cached;
    const entry = {
      fileDiff,
      fileKey: buildFileDiffIdentityKey(fileDiff),
      fileVersion: buildFileDiffContentVersion(fileDiff),
    };
    fileEntries.set(fileDiff, entry);
    return entry;
  };

  const parsedPatchFamily = Atom.family(
    (
      query: Atom.Atom<
        AsyncResult.AsyncResult<ReviewDiffPreviewResult["sources"][number], unknown>
      >,
    ) =>
      Atom.map(query, (result) =>
        AsyncResult.map(result, (source) => parseReviewFilePatch(source, "dark")),
      ),
  );

  let previousFilePatches: {
    scope: string;
    revision: string | undefined;
    queries: ReadonlyArray<Atom.Atom<unknown>>;
  } = { scope: "", revision: undefined, queries: [] };

  const modelAtom = Atom.make((get): DiffModel | null => {
    if (!get(activeAtom)) return null;
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const { route, thread, project, serverConfig, clientSettings } = input;
    const hasThread = input.isServerThread;
    const environmentId = thread.environmentId;
    const activeCwd = hasThread ? (thread.worktreePath ?? project?.workspaceRoot) : undefined;
    const repositoryRoot =
      !hasThread || thread.worktreePath ? undefined : project?.repositoryIdentity?.rootPath;
    const wordWrap = get(wordWrapAtom) ?? clientSettings.wordWrap;
    const ignoreWhitespace = get(ignoreWhitespaceAtom) ?? clientSettings.diffIgnoreWhitespace;
    const fileTreeOpen = get(fileTreeOpenAtom);
    const gitStatus = queryState(
      activeCwd == null
        ? null
        : get(state.vcsEnvironment.status({ environmentId, input: { cwd: activeCwd } })),
    );
    const isGitRepo = gitStatus.data?.isRepo ?? true;
    const selection = selectThreadDiffPanelSelection(get(diffStoreAtom).byThreadKey, route);
    const turnDiffSummaries = hasThread ? thread.checkpoints : [];
    const inferred = inferCheckpointTurnCountByTurnId(turnDiffSummaries);
    const orderedTurns = orderDiffTurnSummaries(turnDiffSummaries, inferred);
    const scope = buildDiffPanelScopeModel({
      threadRef: route,
      selection,
      orderedTurns,
      inferredCheckpointTurnCountByTurnId: inferred,
      timestampFormat: clientSettings.timestampFormat,
    });
    const selectedTurnId = scope.requestedTurnId;
    const hasActiveTurn = scope.activeTurnId !== null;
    const range = scope.checkpointRange;
    const checkpointEnabled = hasThread && isGitRepo && hasActiveTurn && range !== null;
    const checkpointDiff = queryState(
      !checkpointEnabled || range === null
        ? null
        : range.fromTurnCount === 0
          ? get(
              state.orchestrationEnvironment.fullThreadDiff({
                environmentId,
                input: {
                  threadId: thread.id,
                  toTurnCount: range.toTurnCount,
                  ignoreWhitespace,
                },
              }),
            )
          : get(
              state.orchestrationEnvironment.turnDiff({
                environmentId,
                input: {
                  threadId: thread.id,
                  fromTurnCount: range.fromTurnCount,
                  toTurnCount: range.toTurnCount,
                  ignoreWhitespace,
                },
              }),
            ),
    );
    const previewInput = (cwd: string) => ({
      environmentId,
      input: {
        cwd,
        ...(scope.baseRef ? { baseRef: scope.baseRef } : {}),
        ignoreWhitespace,
      },
    });
    const primaryAtom =
      selectedTurnId === null && activeCwd
        ? state.reviewEnvironment.diffPreview(previewInput(activeCwd))
        : null;
    const primaryPreview = queryState(primaryAtom === null ? null : get(primaryAtom));
    const serverCwd = serverConfig?.cwd;
    const retryAtEnvironmentCwd =
      selectedTurnId === null &&
      primaryPreview.error?.includes("configured workspace root") === true &&
      serverCwd !== undefined &&
      serverCwd !== activeCwd;
    const fallbackAtom =
      retryAtEnvironmentCwd && serverCwd !== undefined
        ? state.reviewEnvironment.diffPreview(previewInput(serverCwd))
        : null;
    const branchPreview = retryAtEnvironmentCwd
      ? queryState(fallbackAtom === null ? null : get(fallbackAtom))
      : primaryPreview;
    const refreshQuery = retryAtEnvironmentCwd ? fallbackAtom : primaryAtom;
    const canRefresh = isGitRepo && selectedTurnId === null && activeCwd != null;
    const selectedGitSource = branchPreview.data?.sources.find(
      (source) => source.kind === (scope.gitScope === "unstaged" ? "working-tree" : "branch-range"),
    );
    const baseRefQuery = get(baseRefQueryAtom);
    const baseRefSearchQuery = resolveBaseRefSearchQuery(baseRefQuery);
    const previewCwd = branchPreview.data?.cwd;
    const listRefs = (refKind: "local" | "remote"): ReadonlyArray<VcsRef> =>
      selectedTurnId === null && scope.gitScope === "branch" && previewCwd
        ? (queryState(
            get(
              state.vcsEnvironment.listRefs({
                environmentId,
                input: {
                  cwd: previewCwd,
                  includeMatchingRemoteRefs: true,
                  refKind,
                  ...(baseRefSearchQuery ? { query: baseRefSearchQuery } : {}),
                  limit: 100,
                },
              }),
            ),
          ).data?.refs ?? [])
        : [];
    const baseRefPicker = buildDiffBaseRefPickerModel({
      isBranchScope: selectedTurnId === null && scope.gitScope === "branch",
      headRef: selectedGitSource?.headRef,
      baseRef: selectedGitSource?.baseRef,
      selectedBaseRef: scope.baseRef,
      query: baseRefQuery,
      localRefs: listRefs("local"),
      remoteRefs: listRefs("remote"),
    });
    const selectedPatch = hasActiveTurn ? checkpointDiff.data?.diff : selectedGitSource?.diff;
    const truncated = !hasActiveTurn && selectedGitSource?.truncated === true;
    const isLoading = hasActiveTurn ? checkpointDiff.isPending : branchPreview.isPending;
    const error = hasActiveTurn ? checkpointDiff.error : branchPreview.error;
    const lazySource =
      !hasActiveTurn && selectedGitSource?.truncated && selectedGitSource.files
        ? selectedGitSource
        : null;
    const renderablePatch = lazySource
      ? null
      : getRenderablePatch(selectedPatch, DIFF_PATCH_CACHE_SCOPE, {
          compactPartialHunkOffsets: selectedTurnId === null,
        });

    const filePatchBaseRef = lazySource?.baseRef ?? scope.baseRef;
    const filePatchScope = buildReviewFilePatchScope({
      environmentId,
      cwd: previewCwd,
      source: lazySource,
      baseRef: filePatchBaseRef,
      ignoreWhitespace,
    });
    const sourceFiles = sortReviewSourceFiles(lazySource?.files);
    const requests = buildReviewFilePatchRequests({
      environmentId,
      cwd: previewCwd,
      source: lazySource,
      files: sourceFiles,
      indices: resolveRequestedReviewFileIndices(get(requestedAtom), filePatchScope),
      scope: filePatchScope,
      baseRef: filePatchBaseRef,
      ignoreWhitespace,
    });
    const queries = requests.map((request) => ({
      index: request.index,
      query: state.reviewEnvironment.diffFilePatch({
        environmentId: request.environmentId,
        input: request.input,
      }),
    }));
    const revision = branchPreview.data
      ? DateTime.formatIso(branchPreview.data.generatedAt)
      : undefined;
    const previous = previousFilePatches;
    previousFilePatches = {
      scope: filePatchScope,
      revision,
      queries: queries.map(({ query }) => query),
    };
    for (const { query } of queries) {
      const changed = previous.scope === filePatchScope && previous.revision !== revision;
      const current = registry.get(query);
      const cached =
        !previous.queries.includes(query) && current._tag !== "Initial" && !current.waiting;
      if (changed || cached) queueMicrotask(() => registry.refresh(query));
    }
    const patches = new Map(
      queries.map(({ index, query }) => [index, get(parsedPatchFamily(query))]),
    );
    const settledFileCount = resolveReviewSettledFileCount({
      source: lazySource,
      files: sourceFiles,
      patches,
      preview: renderablePatch,
    });
    const renderableFiles = buildReviewRenderableFiles({
      source: lazySource,
      files: sourceFiles,
      patches,
      scope: filePatchScope,
      preview: renderablePatch,
    });
    const fileStates = buildReviewFileStates(sourceFiles, patches);
    const readyFilePaths = buildReviewReadyFilePaths(sourceFiles, patches);
    const retryQueries = new Map<string, FilePatchQuery>();
    for (const { index, query } of queries) {
      const file = sourceFiles[index];
      if (file) retryQueries.set(file.path, parsedPatchFamily(query));
    }
    const isRefreshing = branchPreview.isPending || isReviewFilePatchPending(patches);
    const entries = renderableFiles.map(fileEntry);
    const defaultKeys = buildDefaultCollapsedDiffFileKeys(
      entries.map((entry) => entry.fileKey),
      clientSettings.diffFilesCollapsed,
    );
    const collapseScope = { scopeKey: scope.collapseScopeKey, defaultKeys };
    const collapsedKeys = resolveCollapsedDiffFileKeys(get(collapsedAtom), collapseScope);
    const fileList = buildDiffPanelFileListModel({
      files: entries,
      collapsedFileKeys: collapsedKeys,
      lazy: lazySource !== null,
      readyFilePaths,
      fileStats: lazySource?.files,
      fileStates,
    });
    const lineStat = resolveDiffPanelLineStat({
      hasActiveTurn,
      sourceFileStats: selectedGitSource?.files,
      files: renderableFiles,
    });
    const header = buildDiffPanelHeaderModel({
      visibleFileCount: fileList.visibleFileCount,
      sourceFileStatCount: hasActiveTurn ? 0 : (selectedGitSource?.files?.length ?? 0),
      lineStat,
      canRefresh,
      isRefreshing,
      diffFileCount: fileList.fileKeys.length,
      allFilesCollapsed: fileList.allCollapsed,
      diffLayout: clientSettings.diffLayout,
      wordWrap,
      ignoreWhitespace,
      fileTreeOpen,
    });
    const body = buildDiffPanelBodyModel({
      hasThread,
      isGitRepo,
      isTurnScope: selectedTurnId !== null,
      turnCount: orderedTurns.length,
      hasActiveTurn,
      gitScope: scope.gitScope,
      patch: selectedPatch,
      isLoading,
      error,
      renderablePatch,
      lazy: lazySource !== null,
      truncated,
      hasSourceFileStats: Boolean(selectedGitSource?.files),
    });
    return {
      route,
      activeCwd,
      repositoryRoot,
      scope,
      orderedTurnIds: orderedTurns.map((summary) => summary.turnId),
      orderedTurnValues: (value) => resolveDiffScopeSelection(value, orderedTurns),
      header,
      baseRefPicker,
      baseRefQuery,
      body,
      fileList,
      entries,
      collapseScope,
      collapsedKeys,
      lazy: lazySource !== null,
      filePatchScope,
      settledFileCount,
      fileCount: renderableFiles.length,
      retryQueries,
      refreshQuery,
      reviewComments:
        useComposerDraftStore.getState().getComposerDraft(route)?.reviewComments ??
        EMPTY_REVIEW_COMMENTS,
      reviewCommentsVersion: get(reviewCommentsVersionAtom),
      fileTreeEntries: diffFileTreeEntries(renderableFiles),
      layout: clientSettings.diffLayout,
      wrap: wordWrap,
      fileTreeOpen,
      contentsSource:
        selectedTurnId !== null ||
        !hasThread ||
        branchPreview.data === null ||
        selectedGitSource === undefined
          ? null
          : {
              environmentId,
              cwd: branchPreview.data.cwd,
              sourceKind: selectedGitSource.kind,
              baseRef: selectedGitSource.baseRef,
              headRef: selectedGitSource.headRef,
              cacheKey: selectedGitSource.diffHash,
            },
    };
  }).pipe(Atom.withLabel("gpui-right-panel-diff-model"));

  function annotationMatchesRow(
    annotation: DiffCommentAnnotation,
    row: RightPanelDiffRow,
  ): boolean {
    if (row.kind === "line") {
      const number = row.line.number;
      if (number === null) return false;
      return annotation.side === "deletions"
        ? row.line.lineKind === "deletion" && number === annotation.line
        : (row.line.lineKind === "addition" || row.line.lineKind === "context") &&
            number === annotation.line;
    }
    if (row.kind === "split") {
      if (annotation.side === "deletions") {
        return (
          row.left !== null &&
          row.left.lineKind === "deletion" &&
          row.left.number === annotation.line
        );
      }
      return (
        row.right !== null &&
        (row.right.lineKind === "addition" || row.right.lineKind === "context") &&
        row.right.number === annotation.line
      );
    }
    return false;
  }

  const appendAnnotatedRows = (
    rows: RightPanelDiffRow[],
    fileRows: RightPanelDiffRow[],
    fileKey: string,
    annotations: ReadonlyArray<DiffCommentAnnotation>,
  ): void => {
    const pending = annotations.filter((annotation) => annotation.entries.length > 0);
    for (const row of fileRows) {
      rows.push(row);
      const index = pending.findIndex((annotation) => annotationMatchesRow(annotation, row));
      if (index < 0) continue;
      const [annotation] = pending.splice(index, 1);
      if (annotation === undefined) continue;
      rows.push({
        kind: "comments",
        fileKey,
        hasDraft: annotation.entries.some((entry) => entry.kind === "draft"),
        entries: annotation.entries.map((entry) =>
          entry.kind === "draft"
            ? {
                kind: "draft" as const,
                id: entry.id,
                rangeLabel: entry.rangeLabel,
                ariaLabel: diffCommentAriaLabel(entry.rangeLabel),
                placeholder: DIFF_COMMENT_COPY.placeholder,
                submitLabel: DIFF_COMMENT_COPY.submitLabel,
                cancelLabel: DIFF_COMMENT_COPY.cancelLabel,
                sendHint: DIFF_COMMENT_COPY.sendHint,
              }
            : {
                kind: "comment" as const,
                id: entry.id,
                rangeLabel: entry.rangeLabel,
                text: entry.text,
                deleteLabel: DIFF_COMMENT_COPY.deleteLabel,
              },
        ),
      });
    }
  };

  const toDiffCommentAnnotations = (
    annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  ): DiffCommentAnnotation[] =>
    annotations.map((annotation) => ({
      side: annotation.side,
      line: annotation.lineNumber,
      entries: annotation.metadata.entries.map((entry) => ({ ...entry })),
    }));

  const buildRows = (
    model: DiffModel,
    revision: number,
    copiedPath: string | null,
    expansion: {
      readonly regions: ReadonlyMap<string, ReadonlyMap<number, StaticDiffExpandedRegion>>;
      readonly hydrated: ReadonlyMap<string, HydratedFile>;
    },
    draft: CommentDraft | null,
  ): ReadonlyArray<RightPanelDiffRow> => {
    const rows: RightPanelDiffRow[] = [];
    const layout = model.header.layout.diffStyle;
    model.entries.forEach((entry, index) => {
      const file = model.fileList.files[index];
      if (file === undefined || !file.visible) return;
      const copy = buildDiffFilePathCopyModel(copiedPath === file.path);
      rows.push({
        kind: "file-header",
        fileKey: file.fileKey,
        path: file.path,
        tone: file.tone,
        changeIcon: changeIcon(entry.fileDiff),
        collapsed: file.collapsed,
        toggleDisabled: file.collapseToggle.disabled,
        toggleTooltip: file.collapseToggle.tooltip,
        copy: { ariaLabel: copy.ariaLabel, tooltip: copy.tooltip, icon: copy.icon },
        stat: file.headerStat
          ? { style: "label", ...file.headerStat }
          : {
              style: "counts",
              additionsText: `+${file.additions}`,
              deletionsText: `-${file.deletions}`,
            },
        loadStatus: file.loadStatus
          ? { kind: file.loadStatus.kind, tooltip: file.loadStatus.tooltip }
          : null,
      });
      if (!file.collapsed) {
        const fileRows: RightPanelDiffRow[] = [];
        const anchors: StaticDiffLineAnchor[] = [];
        const source = model.contentsSource;
        if (source === null) {
          appendFileLines(
            fileRows,
            highlightFile(entry.fileDiff, file.path, revision),
            layout,
            anchors,
          );
        } else {
          const key = expansionKey(source, entry.fileKey);
          const hydrated = expansion.hydrated.get(key);
          const fileDiff = hydrated?.source === entry.fileDiff ? hydrated.file : entry.fileDiff;
          appendFileLines(fileRows, highlightFile(fileDiff, file.path, revision), layout, anchors, {
            regions: expansion.regions.get(key) ?? new Map(),
            expandable: !fileDiff.isPartial || canHydrateFile(fileDiff),
            lineCount: EXPANSION_LINE_COUNT,
            fileDiff,
            path: file.path,
          });
        }
        const persisted = toDiffCommentAnnotations(
          buildPersistedDiffCommentAnnotations({
            reviewComments: model.reviewComments,
            sectionId: model.scope.reviewSectionId,
            filePath: file.path,
            fileDiff: entry.fileDiff,
          }),
        );
        const annotations =
          draft !== null && draft.fileKey === entry.fileKey
            ? [...persisted, draft.annotation]
            : persisted;
        appendAnnotatedRows(rows, fileRows, entry.fileKey, annotations);
      }
    });
    return rows;
  };

  const viewAtom = Atom.make((get): RightPanelDiffView | null => {
    const route = get(context.routeAtom);
    if (route === null) return null;
    const model = get(modelAtom);
    if (model === null) return null;
    const { header, scope, body } = model;
    const picker = model.baseRefPicker;
    const filtered = new Set(picker?.filteredItems ?? []);
    const headerView: RightPanelDiffHeaderView = {
      scope: {
        label: scope.label,
        ariaLabel: scope.ariaLabel,
        options: scope.scopeOptions.map((option) => ({
          value: option.value,
          label: option.label,
          selected: option.value === scope.value,
        })),
        turnMenuLabel: scope.turnMenuLabel,
        turnOptions: scope.turnOptions.map((option) => ({
          value: option.value,
          label: option.label,
          timestampLabel: option.timestampLabel,
          selected: option.value === scope.turnValue,
        })),
      },
      baseRef:
        picker === null
          ? null
          : {
              headLabel: picker.headLabel,
              baseRef: picker.baseRef,
              tooltip: picker.tooltip,
              triggerAriaLabel: picker.triggerAriaLabel,
              query: model.baseRefQuery,
              searchPlaceholder: picker.searchPlaceholder,
              emptyLabel: picker.emptyLabel,
              branchColumnLabel: picker.branchColumnLabel,
              remoteColumnLabel: picker.remoteColumnLabel,
              automatic: filtered.has(picker.automatic.value)
                ? {
                    value: picker.automatic.value,
                    label: picker.automatic.label,
                    selected: picker.value === picker.automatic.value,
                  }
                : null,
              choices: picker.choices
                .filter((choice) => filtered.has(choice.value))
                .map((choice) => ({
                  id: choice.id,
                  value: choice.value,
                  label: choice.label,
                  selected: picker.value === choice.value,
                  remoteToggle:
                    choice.remoteToggle.kind === "switch"
                      ? {
                          kind: "switch",
                          checked: choice.remoteToggle.checked,
                          ariaLabel: choice.remoteToggle.ariaLabel,
                        }
                      : choice.remoteToggle,
                })),
            },
      stat: header.stat,
      refresh: header.refresh,
      collapseAll: header.collapseAll,
      layout: {
        value: header.layout.value,
        options: header.layout.options.map((option) => ({
          ...option,
          selected: option.value === header.layout.value,
        })),
      },
      wordWrap: header.wordWrap,
      whitespace: header.whitespace,
      fileTree: header.fileTree,
    };
    if (body.kind === "message") {
      return {
        threadKey: scopedThreadKey(route),
        header: headerView,
        body: { kind: "message", message: body.message },
      };
    }
    let view: RightPanelDiffContentView;
    if (body.view.kind === "files") {
      const revision = get(syntaxHighlighterRevisionAtom);
      const pending = model.fileCount - model.settledFileCount;
      const selectedPath = get(treeSelectedAtom) ?? scope.filePath;
      const externalKey = resolveSelectedDiffFileKey(model.fileList.files, scope.filePath);
      const tree =
        model.fileTreeOpen && header.fileTree !== null
          ? buildDiffFileTreeModel({
              entries: model.fileTreeEntries,
              selectedPath,
              collapsedDirectoryPaths: get(treeCollapsedAtom),
            })
          : null;
      const commentDraft = get(commentDraftAtom);
      view = {
        kind: "files",
        layout: header.layout.diffStyle,
        wrap: model.wrap,
        rows: buildRows(model, revision, get(copiedPathAtom), get(expansionAtom), commentDraft),
        lineSelection: commentDraft === null,
        pendingCount: Math.min(Math.max(pending, 0), MAX_LOADING_SKELETONS),
        loadMoreKey: pending > 0 ? `${model.filePatchScope}:${model.settledFileCount}` : null,
        scrollTarget:
          get(scrollRequestAtom) ??
          (externalKey === null
            ? null
            : { fileKey: externalKey, key: `reveal:${scope.revealRequestId}` }),
        fileTree:
          tree === null
            ? null
            : {
                title: tree.header.title,
                fileCount: tree.header.fileCount,
                toggleAll: tree.header.toggleAllDirectories
                  ? {
                      icon: tree.header.toggleAllDirectories.icon,
                      ariaLabel: tree.header.toggleAllDirectories.ariaLabel,
                      tooltip: tree.header.toggleAllDirectories.tooltip,
                    }
                  : null,
                rows: tree.rows.map((row): RightPanelDiffTreeRow =>
                  row.kind === "directory"
                    ? {
                        kind: "directory",
                        path: row.path,
                        name: row.name,
                        depth: row.depth,
                        expanded: row.expanded,
                      }
                    : {
                        kind: "file",
                        path: row.path,
                        name: row.name,
                        depth: row.depth,
                        statusLetter: row.statusLetter,
                        statusTitle: row.statusTitle,
                        icon: resolvePierreFileIcon(row.path),
                        tone: row.tone,
                        selected: row.selected,
                      },
                ),
              },
      };
    } else {
      view = body.view;
    }
    return {
      threadKey: scopedThreadKey(route),
      header: headerView,
      body: { kind: "content", notice: body.notice, error: body.error, view },
    };
  }).pipe(Atom.withLabel("gpui-right-panel-diff"));

  const mutationIdAtom = makeWorkspaceMutationIdAtom(context);
  const mutationRefreshAtom = Atom.make((get) => {
    const model = get(modelAtom);
    if (model === null || model.header.refresh === null) return null;
    return workspaceMutationRefreshToken(
      `diff:${model.scope.threadKey ?? ""}`,
      get(mutationIdAtom),
    );
  });
  let handledMutationToken: string | null = null;
  registry.subscribe(
    mutationRefreshAtom,
    (token) => {
      if (token === null || token === handledMutationToken) return;
      handledMutationToken = token;
      const query = registry.get(modelAtom)?.refreshQuery;
      if (query) registry.refresh(query);
    },
    { immediate: true },
  );

  const reconcileAtom = Atom.make((get) => {
    const model = get(modelAtom);
    if (model === null || model.scope.requestedTurnId === null) return null;
    return { route: model.route, turnIds: model.orderedTurnIds.join("\u0000") };
  });
  registry.subscribe(
    reconcileAtom,
    (value) => {
      if (value === null) return;
      const model = registry.get(modelAtom);
      if (model === null) return;
      useDiffPanelStore.getState().reconcileTurnSelection(
        model.route,
        model.scope.turnOptions.map((option) => option.turnId),
      );
    },
    { immediate: true },
  );

  const currentModel = (): DiffModel => {
    const model = registry.get(modelAtom);
    if (model === null) throw new Error("The diff panel is not open.");
    return model;
  };

  const selectBaseRef = (model: DiffModel, intent: DiffBaseRefSelectionIntent) => {
    if (intent.kind === "none") return;
    useDiffPanelStore.getState().selectBranchBaseRef(model.route, intent.baseRef);
  };

  const revealFile = (model: DiffModel, path: string) => {
    registry.set(treeSelectedAtom, path);
    const intent = resolveRevealDiffFile({
      filePath: path,
      files: model.fileList.files,
      lazy: model.lazy,
      settledFileCount: model.settledFileCount,
    });
    if (intent.kind === "none") return;
    registry.set(
      collapsedAtom,
      expandCollapsedDiffFile(registry.get(collapsedAtom), model.collapseScope, intent.fileKey),
    );
    if (intent.requestFileIndex !== null) {
      registry.set(
        requestedAtom,
        addRequestedReviewFileIndices(registry.get(requestedAtom), model.filePatchScope, [
          intent.requestFileIndex,
        ]),
      );
    }
    const previous = registry.get(scrollRequestAtom);
    const next = previous === null ? 1 : Number(previous.key.split(":")[1] ?? "0") + 1;
    registry.set(scrollRequestAtom, { fileKey: intent.fileKey, key: `tree:${next}` });
  };

  return {
    views: { rightPanelDiff: viewAtom },
    actions: {
      rightPanelDiffSelectScope: async (params) => {
        const { value } = ValueParams(params);
        const model = currentModel();
        const intent = model.orderedTurnValues(value);
        if (intent.kind === "none") return null;
        if (intent.kind === "select-git-scope") {
          useDiffPanelStore.getState().selectGitScope(model.route, intent.scope);
        } else {
          useDiffPanelStore.getState().selectTurn(model.route, intent.turnId);
        }
        return null;
      },
      rightPanelDiffSelectBaseRef: async (params) => {
        const { value } = ValueParams(params);
        const model = currentModel();
        selectBaseRef(model, resolveBaseRefValueChange(value));
        registry.set(baseRefQueryAtom, "");
        return null;
      },
      rightPanelDiffToggleBaseRefRemote: async (params) => {
        const { choiceId, checked } = RemoteToggleParams(params);
        const model = currentModel();
        const toggle = model.baseRefPicker?.choices.find(
          (choice) => choice.id === choiceId,
        )?.remoteToggle;
        if (toggle?.kind !== "switch") return null;
        selectBaseRef(model, resolveBaseRefRemoteToggle(toggle, checked));
        return null;
      },
      rightPanelDiffSetBaseRefQuery: async (params) => {
        registry.set(baseRefQueryAtom, QueryParams(params).query);
        return null;
      },
      rightPanelDiffToggleFile: async (params) => {
        const { fileKey } = FileKeyParams(params);
        const model = currentModel();
        registry.set(
          collapsedAtom,
          toggleCollapsedDiffFile(registry.get(collapsedAtom), model.collapseScope, fileKey),
        );
        return null;
      },
      rightPanelDiffExpand: async (params) => {
        const { fileKey, hunkIndex, direction, all } = ExpandParams(params);
        const model = currentModel();
        const source = model.contentsSource;
        const entry = model.entries.find((candidate) => candidate.fileKey === fileKey);
        if (source === null || entry === undefined) return null;
        const key = expansionKey(source, fileKey);
        const count = all ? Number.POSITIVE_INFINITY : EXPANSION_LINE_COUNT;
        const expanding = all ? "both" : direction;
        const current = registry.get(expansionAtom);
        const region = current.regions.get(key)?.get(hunkIndex) ?? { fromStart: 0, fromEnd: 0 };
        const regions = new Map(current.regions.get(key) ?? []).set(hunkIndex, {
          fromStart: region.fromStart + (expanding === "up" || expanding === "both" ? count : 0),
          fromEnd: region.fromEnd + (expanding === "down" || expanding === "both" ? count : 0),
        });
        registry.set(expansionAtom, {
          ...current,
          regions: new Map(current.regions).set(key, regions),
        });
        const fileDiff = entry.fileDiff;
        if (
          !canHydrateFile(fileDiff) ||
          current.hydrating.has(key) ||
          current.hydrated.get(key)?.source === fileDiff
        ) {
          return null;
        }
        const started = registry.get(expansionAtom);
        registry.set(expansionAtom, { ...started, hydrating: new Set(started.hydrating).add(key) });
        const result = await runAtomCommand(
          registry,
          state.reviewEnvironment.diffFileContents,
          {
            environmentId: source.environmentId,
            input: {
              cwd: source.cwd,
              sourceKind: source.sourceKind,
              changeType: fileDiff.type,
              baseRef: source.baseRef,
              headRef: source.headRef,
              oldPath: diffFileOldPath(fileDiff),
              newPath: resolveFileDiffPath(fileDiff),
            },
          },
          { reportFailure: false },
        );
        const finished = registry.get(expansionAtom);
        const hydrating = new Set(finished.hydrating);
        hydrating.delete(key);
        registry.set(
          expansionAtom,
          result._tag === "Failure"
            ? { ...finished, hydrating }
            : {
                ...finished,
                hydrating,
                hydrated: new Map(finished.hydrated).set(key, {
                  source: fileDiff,
                  file: hydratedDiffFile(fileDiff, result.value, source.cacheKey),
                }),
              },
        );
        return null;
      },
      rightPanelDiffCommentBegin: async (params) => {
        const { fileKey, side, line, startSide, startLine } = CommentBeginParams(params);
        const model = currentModel();
        if (model.scope.reviewSectionId === null) return null;
        const range: SelectedLineRange =
          startSide === side
            ? { side, start: startLine, end: line }
            : { side: startSide, start: startLine, end: line, endSide: side };
        let located: { readonly fileDiff: FileDiff; readonly path: string } | null = null;
        for (let index = 0; index < model.entries.length; index += 1) {
          const file = model.fileList.files[index];
          const candidate = model.entries[index];
          if (file === undefined || candidate === undefined || !file.visible) continue;
          if (file.fileKey === fileKey) {
            located = { fileDiff: candidate.fileDiff, path: file.path };
            break;
          }
        }
        if (located === null) return null;
        const id = nextFileCommentId();
        const comment = buildDiffReviewComment({
          id,
          sectionId: model.scope.reviewSectionId,
          sectionTitle: model.scope.reviewSectionTitle,
          filePath: located.path,
          fileDiff: located.fileDiff,
          range,
          text: "",
        });
        if (comment === null) return null;
        registry.set(commentDraftAtom, {
          fileKey,
          annotation: {
            side: annotationSide(range),
            line: range.end,
            entries: [{ id, kind: "draft", range, rangeLabel: comment.rangeLabel, text: "" }],
          },
        });
        return null;
      },
      rightPanelDiffCommentSubmit: async (params) => {
        const { text } = CommentTextParams(params);
        const draft = registry.get(commentDraftAtom);
        if (draft === null) return null;
        const model = currentModel();
        if (model.scope.reviewSectionId === null) return null;
        const entry = draft.annotation.entries.find((candidate) => candidate.kind === "draft");
        if (entry === undefined) return null;
        let located: { readonly fileDiff: FileDiff; readonly path: string } | null = null;
        for (let index = 0; index < model.entries.length; index += 1) {
          const file = model.fileList.files[index];
          const candidate = model.entries[index];
          if (file === undefined || candidate === undefined || !file.visible) continue;
          if (file.fileKey === draft.fileKey) {
            located = { fileDiff: candidate.fileDiff, path: file.path };
            break;
          }
        }
        if (located === null) return null;
        const comment = buildDiffReviewComment({
          id: entry.id,
          sectionId: model.scope.reviewSectionId,
          sectionTitle: model.scope.reviewSectionTitle,
          filePath: located.path,
          fileDiff: located.fileDiff,
          range: entry.range,
          text,
        });
        if (comment === null) return null;
        useComposerDraftStore.getState().addReviewComment(model.route, comment);
        registry.set(commentDraftAtom, null);
        return null;
      },
      rightPanelDiffCommentCancel: async (params) => {
        const { entryId } = CommentEntryParams(params);
        const draft = registry.get(commentDraftAtom);
        if (
          draft !== null &&
          (entryId === undefined || draft.annotation.entries.some((entry) => entry.id === entryId))
        ) {
          registry.set(commentDraftAtom, null);
          return null;
        }
        if (entryId === undefined) return null;
        const model = currentModel();
        useComposerDraftStore.getState().removeReviewComment(model.route, entryId);
        return null;
      },
      rightPanelDiffToggleAllFiles: async () => {
        const model = currentModel();
        registry.set(
          collapsedAtom,
          toggleAllCollapsedDiffFiles(
            registry.get(collapsedAtom),
            model.collapseScope,
            model.fileList.fileKeys,
          ),
        );
        return null;
      },
      rightPanelDiffSetLayout: async (params) => {
        const intent = resolveDiffLayoutChange([LayoutParams(params).layout]);
        if (intent.kind !== "set-diff-layout") return null;
        await context.updateClientSettings((current) => ({
          ...current,
          diffLayout: intent.layout,
        }));
        return null;
      },
      rightPanelDiffSetWordWrap: async (params) => {
        registry.set(wordWrapAtom, EnabledParams(params).enabled);
        return null;
      },
      rightPanelDiffSetIgnoreWhitespace: async (params) => {
        registry.set(ignoreWhitespaceAtom, EnabledParams(params).enabled);
        return null;
      },
      rightPanelDiffSetFileTreeOpen: async (params) => {
        const open = EnabledParams(params).enabled;
        storage.setItem(DIFF_FILE_TREE_STORAGE_KEY, encodeFileTreeOpen(open));
        registry.set(fileTreeOpenAtom, open);
        return null;
      },
      rightPanelDiffWindowFocused: async () => {
        const model = registry.get(modelAtom);
        if (model === null || model.header.refresh === null || model.refreshQuery === null) {
          return null;
        }
        registry.refresh(model.refreshQuery);
        return null;
      },
      rightPanelDiffRefresh: async () => {
        const query = currentModel().refreshQuery;
        if (query !== null) registry.refresh(query);
        return null;
      },
      rightPanelDiffLoadMore: async () => {
        const model = currentModel();
        if (!model.lazy || model.settledFileCount >= model.fileCount) return null;
        registry.set(
          requestedAtom,
          addRequestedReviewFileIndices(
            registry.get(requestedAtom),
            model.filePatchScope,
            nextReviewFileIndices(model.settledFileCount),
          ),
        );
        return null;
      },
      rightPanelDiffRetryFile: async (params) => {
        const query = currentModel().retryQueries.get(PathParams(params).path);
        if (query !== undefined) registry.refresh(query);
        return null;
      },
      rightPanelDiffOpenFile: async (params) => {
        const { path } = PathParams(params);
        const model = currentModel();
        const action = resolveDiffFilePrimaryAction({
          threadRef: model.route,
          filePath: path,
          activeCwd: model.activeCwd,
          repositoryRoot: model.repositoryRoot,
        });
        switch (action.kind) {
          case "none":
            return null;
          case "open-in-files-panel":
            useRightPanelStore.getState().openFile(action.threadRef, action.filePath);
            return null;
          case "open-in-editor": {
            const input = registry.get(context.threadInputAtom);
            const result = await openInPreferredEditor({
              environmentId: model.route.environmentId,
              availableEditors: input?.serverConfig?.availableEditors ?? [],
              targetPath: action.targetPath,
              openInEditor: (target) =>
                runAtomCommand(registry, state.shellEnvironment.openInEditor, target, {
                  reportFailure: false,
                }),
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                environmentId: model.route.environmentId,
                threadId: model.route.threadId,
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
            return null;
          }
        }
      },
      rightPanelDiffCopyPath: async (params) => {
        const { path } = PathParams(params);
        try {
          await clipboardService(context).writeText(resolveDiffFilePathCopy(path).text);
        } catch (error) {
          context.addToast({
            layout: "plain",
            type: "error",
            title: "Could not copy",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
          return null;
        }
        registry.set(copiedPathAtom, path);
        setTimeout(() => {
          if (registry.get(copiedPathAtom) === path) registry.set(copiedPathAtom, null);
        }, COPY_FEEDBACK_MS);
        return null;
      },
      rightPanelDiffFileContextMenu: async (params) => {
        const { path, x, y } = ContextMenuParams(params);
        const model = currentModel();
        const environmentId = model.route.environmentId;
        const serverConfig = registry.get(context.threadInputAtom)?.serverConfig ?? null;
        const capabilities = resolveFileContextMenuCapabilities(environmentId, serverConfig);
        const target: FileContextMenuTarget = {
          environmentId,
          filePath: path.trim(),
          workspaceRoot: model.activeCwd,
          repositoryRoot: model.repositoryRoot,
        };
        if (target.filePath.length === 0) return null;
        const items = buildFileContextMenuItems({
          hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
          capabilities,
        });
        if (items.length === 0) return null;
        const clicked = await contextMenuService(context).show(items, { x, y });
        if (clicked === null) return null;
        const activation = resolveFileContextMenuActivation({
          action: clicked,
          target,
          capabilities,
          environmentId,
        });
        if (activation === null) return null;
        const result = await runAtomCommand(
          registry,
          state.shellEnvironment.openInEditor,
          { environmentId: activation.environmentId, input: activation.input },
          { reportFailure: false },
        );
        if (result._tag === "Failure") {
          context.addToast({
            layout: "plain",
            type: "error",
            title: activation.failureTitle,
            description: activation.failureDescription,
          });
        }
        return null;
      },
      rightPanelDiffRevealFile: async (params) => {
        revealFile(currentModel(), PathParams(params).path);
        return null;
      },
      rightPanelDiffToggleTreeDirectory: async (params) => {
        const intent = resolveDiffFileTreeToggleDirectory(
          registry.get(treeCollapsedAtom),
          PathParams(params).path,
        );
        registry.set(treeCollapsedAtom, intent.paths);
        return null;
      },
      rightPanelDiffToggleAllTreeDirectories: async () => {
        const model = currentModel();
        const tree = buildDiffFileTreeModel({
          entries: model.fileTreeEntries,
          selectedPath: null,
          collapsedDirectoryPaths: registry.get(treeCollapsedAtom),
        });
        const intent = resolveDiffFileTreeToggleAllDirectories(
          tree.header.toggleAllDirectories?.expanded ?? true,
        );
        registry.set(treeCollapsedAtom, intent.expanded ? [] : tree.directoryPaths);
        return null;
      },
    },
  };
}
