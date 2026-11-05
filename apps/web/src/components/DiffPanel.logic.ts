import type { FileDiffMetadata } from "@pierre/diffs";
import type { GitStatus } from "@pierre/trees";
import type { ReviewDiffFileStat, ScopedThreadRef, TurnId, VcsRef } from "@t3tools/contracts";
import type { DiffLayout, TimestampFormat } from "@t3tools/contracts/settings";

import type { DiffPanelSelection } from "../diffPanelStore";
import { buildBaseRefChoices, filterBaseRefChoices } from "../lib/baseRefChoices";
import { areAllDiffFilesCollapsed, toggleAllDiffFiles } from "../lib/diffCollapse";
import {
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
  resolveFileDiffPreviousPath,
  type RenderablePatch,
} from "../lib/diffRendering";
import { formatShortTimestamp } from "../timestampFormat";
import type { TurnDiffSummary } from "../types";
import {
  buildDiffStatLabelModel,
  type DiffStat,
  type DiffStatLabelModel,
} from "./chat/DiffStatLabel.logic";
import {
  buildDiffFileStatusModel,
  type DiffFileLoadState,
  type DiffFileStatusModel,
} from "./diffs/DiffFileStatus.logic";
import { describeDiffFileGitStatus, diffFileGitStatus } from "./diffs/diffFileTree.logic";

export type DiffTurnCheckpointCounts = Readonly<Record<TurnId, number>>;

function turnCheckpointCount(
  summary: TurnDiffSummary,
  inferred: DiffTurnCheckpointCounts,
): number | undefined {
  return summary.checkpointTurnCount ?? inferred[summary.turnId];
}

export function orderDiffTurnSummaries(
  summaries: ReadonlyArray<TurnDiffSummary>,
  inferred: DiffTurnCheckpointCounts,
): ReadonlyArray<TurnDiffSummary> {
  return [...summaries].toSorted((left, right) => {
    const leftTurnCount = turnCheckpointCount(left, inferred) ?? 0;
    const rightTurnCount = turnCheckpointCount(right, inferred) ?? 0;
    if (leftTurnCount !== rightTurnCount) {
      return rightTurnCount - leftTurnCount;
    }
    return right.completedAt.localeCompare(left.completedAt);
  });
}

export type DiffGitScope = "branch" | "unstaged";

export type DiffScopeOption = {
  readonly value: string;
  readonly label: string;
};

export type DiffTurnOption = {
  readonly value: string;
  readonly turnId: TurnId;
  readonly label: string;
  readonly timestampLabel: string;
};

export type DiffCheckpointRange = {
  readonly fromTurnCount: number;
  readonly toTurnCount: number;
};

export type DiffPanelScopeInput = {
  readonly threadRef: ScopedThreadRef | null;
  readonly selection: DiffPanelSelection;
  readonly orderedTurns: ReadonlyArray<TurnDiffSummary>;
  readonly inferredCheckpointTurnCountByTurnId: DiffTurnCheckpointCounts;
  readonly timestampFormat: TimestampFormat;
};

export type DiffPanelScopeModel = {
  readonly requestedTurnId: TurnId | null;
  readonly activeTurnId: TurnId | null;
  readonly gitScope: DiffGitScope;
  readonly baseRef: string | null;
  readonly filePath: string | null;
  readonly revealRequestId: number;
  readonly checkpointRange: DiffCheckpointRange | null;
  readonly checkpointCacheScope: string | null;
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly turnValue: string;
  readonly reviewSectionId: string;
  readonly reviewSectionTitle: string;
  readonly collapseScopeKey: string | null;
  readonly threadKey: string | null;
  readonly scopeOptions: ReadonlyArray<DiffScopeOption>;
  readonly turnMenuLabel: string;
  readonly turnOptions: ReadonlyArray<DiffTurnOption>;
};

const DIFF_SCOPE_OPTIONS: ReadonlyArray<DiffScopeOption> = [
  { value: "unstaged", label: "Working tree" },
  { value: "branch", label: "Branch changes" },
  { value: "latest", label: "Latest turn" },
];

export function buildDiffPanelScopeModel(input: DiffPanelScopeInput): DiffPanelScopeModel {
  const { selection, orderedTurns, threadRef } = input;
  const inferred = input.inferredCheckpointTurnCountByTurnId;
  const requestedTurnId = selection.kind === "turn" ? selection.turnId : null;
  const gitScope: DiffGitScope = selection.kind === "unstaged" ? "unstaged" : "branch";
  const selectedTurn =
    requestedTurnId === null
      ? undefined
      : (orderedTurns.find((summary) => summary.turnId === requestedTurnId) ?? orderedTurns[0]);
  const checkpointTurnCount = selectedTurn
    ? turnCheckpointCount(selectedTurn, inferred)
    : undefined;
  const latestTurn = orderedTurns[0];
  const isLatestTurn = selectedTurn?.turnId === latestTurn?.turnId;
  const gitScopeLabel = gitScope === "unstaged" ? "Working tree" : "Branch changes";
  const label =
    requestedTurnId === null
      ? gitScopeLabel
      : isLatestTurn
        ? "Latest turn"
        : `Turn ${checkpointTurnCount ?? "?"}`;
  const reviewSectionId = selectedTurn ? `turn:${selectedTurn.turnId}` : gitScope;
  const collapseScopeKey = threadRef
    ? `${threadRef.environmentId}:${threadRef.threadId}:${reviewSectionId}`
    : null;
  const turnValue = selectedTurn ? `turn:${selectedTurn.turnId}` : "";
  return {
    requestedTurnId,
    activeTurnId: selectedTurn?.turnId ?? null,
    gitScope,
    baseRef: selection.kind === "branch" ? selection.baseRef : null,
    filePath: selection.kind === "turn" ? selection.filePath : null,
    revealRequestId: selection.kind === "turn" ? selection.revealRequestId : 0,
    checkpointRange:
      typeof checkpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, checkpointTurnCount - 1),
            toTurnCount: checkpointTurnCount,
          }
        : null,
    checkpointCacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : null,
    label,
    ariaLabel: `Diff scope: ${label}`,
    value: requestedTurnId === null ? gitScope : isLatestTurn ? "latest" : turnValue,
    turnValue,
    reviewSectionId,
    reviewSectionTitle: selectedTurn ? `Turn ${checkpointTurnCount ?? "?"}` : gitScopeLabel,
    collapseScopeKey,
    threadKey: threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null,
    scopeOptions: DIFF_SCOPE_OPTIONS,
    turnMenuLabel: "Turn",
    turnOptions: orderedTurns.map((summary) => ({
      value: `turn:${summary.turnId}`,
      turnId: summary.turnId,
      label: `Turn ${turnCheckpointCount(summary, inferred) ?? "?"}`,
      timestampLabel: formatShortTimestamp(summary.completedAt, input.timestampFormat),
    })),
  };
}

export type DiffScopeSelectionIntent =
  | { readonly kind: "select-git-scope"; readonly scope: DiffGitScope }
  | { readonly kind: "select-turn"; readonly turnId: TurnId }
  | { readonly kind: "none" };

export function resolveDiffScopeSelection(
  value: string,
  orderedTurns: ReadonlyArray<TurnDiffSummary>,
): DiffScopeSelectionIntent {
  if (value === "unstaged" || value === "branch") {
    return { kind: "select-git-scope", scope: value };
  }
  if (value === "latest") {
    const latestTurn = orderedTurns[0];
    return latestTurn ? { kind: "select-turn", turnId: latestTurn.turnId } : { kind: "none" };
  }
  const turn = orderedTurns.find((summary) => `turn:${summary.turnId}` === value);
  return turn ? { kind: "select-turn", turnId: turn.turnId } : { kind: "none" };
}

export const DIFF_AUTOMATIC_BASE_REF = "__automatic_base_ref__";

export function resolveBaseRefSearchQuery(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type DiffBaseRefRemoteToggleModel =
  | {
      readonly kind: "switch";
      readonly checked: boolean;
      readonly ariaLabel: string;
      readonly localRef: string | null;
      readonly remoteRef: string | null;
    }
  | { readonly kind: "remote-only"; readonly label: string }
  | { readonly kind: "none" };

export type DiffBaseRefChoiceModel = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly remoteToggle: DiffBaseRefRemoteToggleModel;
};

export type DiffBaseRefPickerInput = {
  readonly isBranchScope: boolean;
  readonly headRef: string | null | undefined;
  readonly baseRef: string | null | undefined;
  readonly selectedBaseRef: string | null;
  readonly query: string;
  readonly localRefs: ReadonlyArray<VcsRef>;
  readonly remoteRefs: ReadonlyArray<VcsRef>;
};

export type DiffBaseRefPickerModel = {
  readonly headLabel: string;
  readonly baseRef: string;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly triggerAriaLabel: string;
  readonly value: string;
  readonly items: ReadonlyArray<string>;
  readonly filteredItems: ReadonlyArray<string>;
  readonly searchPlaceholder: string;
  readonly emptyLabel: string;
  readonly branchColumnLabel: string;
  readonly remoteColumnLabel: string;
  readonly automatic: { readonly value: string; readonly label: string };
  readonly choices: ReadonlyArray<DiffBaseRefChoiceModel>;
};

export function buildDiffBaseRefPickerModel(
  input: DiffBaseRefPickerInput,
): DiffBaseRefPickerModel | null {
  const baseRef = input.baseRef;
  if (!input.isBranchScope || !baseRef) return null;
  const { selectedBaseRef } = input;
  const choices = buildBaseRefChoices(
    input.localRefs.filter((ref) => ref.name !== input.headRef),
    input.remoteRefs,
  );
  const valueForChoice = (choice: (typeof choices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const headLabel = input.headRef ?? "HEAD";
  return {
    headLabel,
    baseRef,
    ariaLabel: `Comparing ${headLabel} against ${baseRef}`,
    tooltip: `${headLabel} → ${baseRef}`,
    triggerAriaLabel: `Change comparison target. Currently ${baseRef}`,
    value: selectedBaseRef ?? DIFF_AUTOMATIC_BASE_REF,
    items: [DIFF_AUTOMATIC_BASE_REF, ...choices.map(valueForChoice)],
    filteredItems: [
      ...(input.query.trim().length === 0 ? [DIFF_AUTOMATIC_BASE_REF] : []),
      ...filterBaseRefChoices(choices, input.query).map(valueForChoice),
    ],
    searchPlaceholder: "Search refs...",
    emptyLabel: "No matching refs.",
    branchColumnLabel: "Branch",
    remoteColumnLabel: "Remote",
    automatic: { value: DIFF_AUTOMATIC_BASE_REF, label: "Automatic" },
    choices: choices.map((choice) => {
      const value = valueForChoice(choice);
      const remoteToggle: DiffBaseRefRemoteToggleModel =
        choice.local !== null && choice.remote !== null
          ? {
              kind: "switch",
              checked: choice.remote.name === value,
              ariaLabel: `Use remote version of ${choice.label}`,
              localRef: choice.local.name,
              remoteRef: choice.remote.name,
            }
          : choice.remote
            ? { kind: "remote-only", label: "Remote only" }
            : { kind: "none" };
      return { id: choice.id, label: choice.label, value, remoteToggle };
    }),
  };
}

export type DiffBaseRefSelectionIntent =
  | { readonly kind: "select-base-ref"; readonly baseRef: string | null }
  | { readonly kind: "none" };

export function resolveBaseRefValueChange(
  value: string | null | undefined,
): DiffBaseRefSelectionIntent {
  if (!value) return { kind: "none" };
  return { kind: "select-base-ref", baseRef: value === DIFF_AUTOMATIC_BASE_REF ? null : value };
}

export function resolveBaseRefRemoteToggle(
  toggle: { readonly localRef: string | null; readonly remoteRef: string | null },
  checked: boolean,
): DiffBaseRefSelectionIntent {
  const nextRef = checked ? toggle.remoteRef : toggle.localRef;
  return nextRef ? { kind: "select-base-ref", baseRef: nextRef } : { kind: "none" };
}

export type DiffPanelLineStatInput = {
  readonly hasActiveTurn: boolean;
  readonly sourceFileStats: ReadonlyArray<ReviewDiffFileStat> | null | undefined;
  readonly files: ReadonlyArray<FileDiffMetadata>;
};

export function resolveDiffPanelLineStat(input: DiffPanelLineStatInput): DiffStat {
  if (!input.hasActiveTurn && input.sourceFileStats) {
    return input.sourceFileStats.reduce(
      (total, file) => ({
        additions: total.additions + file.additions,
        deletions: total.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  }
  return getDiffLineStat(input.files);
}

export type DiffPanelHeaderInput = {
  readonly visibleFileCount: number;
  readonly sourceFileStatCount: number;
  readonly lineStat: DiffStat;
  readonly canRefresh: boolean;
  readonly isRefreshing: boolean;
  readonly diffFileCount: number;
  readonly allFilesCollapsed: boolean;
  readonly diffLayout: DiffLayout;
  readonly wordWrap: boolean;
  readonly ignoreWhitespace: boolean;
  readonly fileTreeOpen: boolean;
};

export type DiffPanelToggleModel<Icon extends string> = {
  readonly pressed: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: Icon;
};

export type DiffLayoutOptionModel = {
  readonly value: DiffLayout;
  readonly ariaLabel: string;
  readonly icon: "rows-3" | "columns-2";
};

export type DiffPanelHeaderModel = {
  readonly stat: DiffStatLabelModel | null;
  readonly refresh: {
    readonly refreshing: boolean;
    readonly ariaLabel: string;
    readonly tooltip: string;
  } | null;
  readonly collapseAll: {
    readonly allCollapsed: boolean;
    readonly ariaLabel: string;
    readonly tooltip: string;
    readonly icon: "chevrons-up-down" | "chevrons-down-up";
  } | null;
  readonly layout: {
    readonly ariaLabel: string;
    readonly value: DiffLayout;
    readonly diffStyle: "unified" | "split";
    readonly options: ReadonlyArray<DiffLayoutOptionModel>;
  };
  readonly wordWrap: DiffPanelToggleModel<"text-wrap"> & {
    readonly overflow: "wrap" | "scroll";
  };
  readonly whitespace: DiffPanelToggleModel<"pilcrow">;
  readonly fileTree: DiffPanelToggleModel<"folder-tree"> | null;
};

const DIFF_LAYOUT_OPTIONS: ReadonlyArray<DiffLayoutOptionModel> = [
  { value: "stacked", ariaLabel: "Stacked diff view", icon: "rows-3" },
  { value: "split", ariaLabel: "Split diff view", icon: "columns-2" },
];

export function buildDiffPanelHeaderModel(input: DiffPanelHeaderInput): DiffPanelHeaderModel {
  const collapseLabel = input.allFilesCollapsed ? "Expand all files" : "Collapse all files";
  const whitespaceLabel = input.ignoreWhitespace
    ? "Show whitespace changes"
    : "Hide whitespace changes";
  const fileTreeLabel = input.fileTreeOpen ? "Hide file tree" : "Show file tree";
  return {
    stat:
      input.visibleFileCount > 0 || input.sourceFileStatCount > 0
        ? buildDiffStatLabelModel(input.lineStat)
        : null,
    refresh: input.canRefresh
      ? {
          refreshing: input.isRefreshing,
          ariaLabel: input.isRefreshing ? "Refreshing diff" : "Refresh diff",
          tooltip: input.isRefreshing ? "Refreshing diff…" : "Refresh diff",
        }
      : null,
    collapseAll:
      input.diffFileCount > 0
        ? {
            allCollapsed: input.allFilesCollapsed,
            ariaLabel: collapseLabel,
            tooltip: collapseLabel,
            icon: input.allFilesCollapsed ? "chevrons-up-down" : "chevrons-down-up",
          }
        : null,
    layout: {
      ariaLabel: "Diff layout",
      value: input.diffLayout,
      diffStyle: input.diffLayout === "split" ? "split" : "unified",
      options: DIFF_LAYOUT_OPTIONS,
    },
    wordWrap: {
      pressed: input.wordWrap,
      ariaLabel: input.wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping",
      tooltip: input.wordWrap ? "Disable line wrapping" : "Enable line wrapping",
      icon: "text-wrap",
      overflow: input.wordWrap ? "wrap" : "scroll",
    },
    whitespace: {
      pressed: input.ignoreWhitespace,
      ariaLabel: whitespaceLabel,
      tooltip: whitespaceLabel,
      icon: "pilcrow",
    },
    fileTree:
      input.diffFileCount > 0
        ? {
            pressed: input.fileTreeOpen,
            ariaLabel: fileTreeLabel,
            tooltip: fileTreeLabel,
            icon: "folder-tree",
          }
        : null,
  };
}

export type DiffLayoutChangeIntent =
  | { readonly kind: "set-diff-layout"; readonly layout: DiffLayout }
  | { readonly kind: "none" };

export function resolveDiffLayoutChange(values: ReadonlyArray<unknown>): DiffLayoutChangeIntent {
  const next = values[0];
  return next === "stacked" || next === "split"
    ? { kind: "set-diff-layout", layout: next }
    : { kind: "none" };
}

export type DiffPanelBodyInput = {
  readonly hasThread: boolean;
  readonly isGitRepo: boolean;
  readonly isTurnScope: boolean;
  readonly turnCount: number;
  readonly hasActiveTurn: boolean;
  readonly gitScope: DiffGitScope;
  readonly patch: string | undefined;
  readonly isLoading: boolean;
  readonly error: string | null | undefined;
  readonly renderablePatch: RenderablePatch | null;
  readonly lazy: boolean;
  readonly truncated: boolean;
  readonly hasSourceFileStats: boolean;
};

export type DiffPanelContentView =
  | { readonly kind: "loading"; readonly label: string }
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "files" }
  | { readonly kind: "raw"; readonly reason: string; readonly text: string };

export type DiffPanelBodyModel =
  | {
      readonly kind: "message";
      readonly reason: "no-thread" | "not-git-repo" | "no-turns";
      readonly message: string;
    }
  | {
      readonly kind: "content";
      readonly notice: string | null;
      readonly error: string | null;
      readonly view: DiffPanelContentView;
    };

function buildDiffPanelContentView(input: DiffPanelBodyInput): DiffPanelContentView {
  const renderablePatch = input.renderablePatch;
  if (!renderablePatch && !input.lazy) {
    if (input.isLoading) {
      return {
        kind: "loading",
        label: input.hasActiveTurn
          ? "Loading checkpoint diff..."
          : input.gitScope === "unstaged"
            ? "Loading working tree diff..."
            : "Loading branch diff...",
      };
    }
    const hasNoNetChanges = typeof input.patch === "string" && input.patch.trim().length === 0;
    return {
      kind: "empty",
      message: hasNoNetChanges
        ? "No net changes in this selection."
        : "No patch available for this selection.",
    };
  }
  if (input.lazy || renderablePatch?.kind === "files") return { kind: "files" };
  return renderablePatch?.kind === "raw"
    ? { kind: "raw", reason: renderablePatch.reason, text: renderablePatch.text }
    : { kind: "raw", reason: "", text: "" };
}

export function buildDiffPanelBodyModel(input: DiffPanelBodyInput): DiffPanelBodyModel {
  if (!input.hasThread) {
    return {
      kind: "message",
      reason: "no-thread",
      message: "Select a thread to inspect turn diffs.",
    };
  }
  if (!input.isGitRepo) {
    return {
      kind: "message",
      reason: "not-git-repo",
      message: "Turn diffs are unavailable because this project is not a git repository.",
    };
  }
  if (input.isTurnScope && input.turnCount === 0) {
    return { kind: "message", reason: "no-turns", message: "No completed turns yet." };
  }
  return {
    kind: "content",
    notice:
      input.truncated && !input.lazy
        ? `This preview exceeds the size limit. Changes shown are incomplete.${
            input.hasSourceFileStats ? " Totals include all changes." : ""
          }`
        : null,
    error: input.error && !input.renderablePatch ? input.error : null,
    view: buildDiffPanelContentView(input),
  };
}

export type DiffCollapsedFilesState = {
  readonly scopeKey: string | null;
  readonly fileKeys: ReadonlySet<string>;
};

export const EMPTY_COLLAPSED_DIFF_FILE_KEYS: ReadonlySet<string> = new Set();

export const INITIAL_DIFF_COLLAPSED_FILES_STATE: DiffCollapsedFilesState = {
  scopeKey: null,
  fileKeys: EMPTY_COLLAPSED_DIFF_FILE_KEYS,
};

export function buildDefaultCollapsedDiffFileKeys(
  fileKeys: ReadonlyArray<string>,
  collapsedByDefault: boolean,
): ReadonlySet<string> {
  return collapsedByDefault ? new Set(fileKeys) : EMPTY_COLLAPSED_DIFF_FILE_KEYS;
}

export type DiffCollapseScope = {
  readonly scopeKey: string | null;
  readonly defaultKeys: ReadonlySet<string>;
};

export function resolveCollapsedDiffFileKeys(
  state: DiffCollapsedFilesState,
  scope: DiffCollapseScope,
): ReadonlySet<string> {
  return state.scopeKey === scope.scopeKey ? state.fileKeys : scope.defaultKeys;
}

export function toggleCollapsedDiffFile(
  state: DiffCollapsedFilesState,
  scope: DiffCollapseScope,
  fileKey: string,
): DiffCollapsedFilesState {
  const next = new Set(resolveCollapsedDiffFileKeys(state, scope));
  if (next.has(fileKey)) {
    next.delete(fileKey);
  } else {
    next.add(fileKey);
  }
  return { scopeKey: scope.scopeKey, fileKeys: next };
}

export function expandCollapsedDiffFile(
  state: DiffCollapsedFilesState,
  scope: DiffCollapseScope,
  fileKey: string,
): DiffCollapsedFilesState {
  const next = new Set(resolveCollapsedDiffFileKeys(state, scope));
  next.delete(fileKey);
  return { scopeKey: scope.scopeKey, fileKeys: next };
}

export function toggleAllCollapsedDiffFiles(
  state: DiffCollapsedFilesState,
  scope: DiffCollapseScope,
  fileKeys: ReadonlyArray<string>,
): DiffCollapsedFilesState {
  return {
    scopeKey: scope.scopeKey,
    fileKeys: toggleAllDiffFiles(fileKeys, resolveCollapsedDiffFileKeys(state, scope)),
  };
}

export type DiffFileChangeTone = "addition" | "deletion" | "modified" | "muted";

export function resolveDiffFileChangeTone(fileDiff: FileDiffMetadata): DiffFileChangeTone {
  switch (fileDiff.type) {
    case "new":
      return "addition";
    case "deleted":
      return "deletion";
    case "change":
    case "rename-pure":
    case "rename-changed":
      return "modified";
    default:
      return "muted";
  }
}

export function isPendingDiffFile(fileDiff: FileDiffMetadata): boolean {
  return fileDiff.cacheKey?.endsWith(":pending") === true;
}

export type DiffFileCollapseToggleModel = {
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly icon: "chevron-right" | "chevron-down";
};

export type DiffFileHeaderInput = {
  readonly fileDiff: FileDiffMetadata;
  readonly fileKey: string;
  readonly collapsedFileKeys: ReadonlySet<string>;
};

export type DiffFileHeaderModel = {
  readonly fileKey: string;
  readonly path: string;
  readonly previousPath: string | null;
  readonly name: string;
  readonly directory: string | null;
  readonly changeType: FileDiffMetadata["type"];
  readonly status: GitStatus;
  readonly statusLetter: string | null;
  readonly statusTitle: string;
  readonly statusTone: GitStatus;
  readonly tone: DiffFileChangeTone;
  readonly unavailable: boolean;
  readonly collapsed: boolean;
  readonly collapseToggle: DiffFileCollapseToggleModel;
};

export function buildDiffFileHeaderModel(input: DiffFileHeaderInput): DiffFileHeaderModel {
  const { fileDiff, fileKey } = input;
  const path = resolveFileDiffPath(fileDiff);
  const previousPath = resolveFileDiffPreviousPath(fileDiff);
  const separatorIndex = path.lastIndexOf("/");
  const status = diffFileGitStatus(fileDiff);
  const presentation = describeDiffFileGitStatus(status);
  const unavailable = isPendingDiffFile(fileDiff);
  const collapsed = unavailable || input.collapsedFileKeys.has(fileKey);
  return {
    fileKey,
    path,
    previousPath: previousPath === path ? null : previousPath,
    name: separatorIndex === -1 ? path : path.slice(separatorIndex + 1),
    directory: separatorIndex === -1 ? null : path.slice(0, separatorIndex),
    changeType: fileDiff.type,
    status,
    statusLetter: presentation.letter,
    statusTitle: presentation.title,
    statusTone: presentation.tone,
    tone: resolveDiffFileChangeTone(fileDiff),
    unavailable,
    collapsed,
    collapseToggle: {
      ariaLabel: collapsed ? `Expand ${path}` : `Collapse ${path}`,
      tooltip: collapsed ? "Expand diff" : "Collapse diff",
      expanded: !collapsed,
      disabled: unavailable,
      icon: collapsed ? "chevron-right" : "chevron-down",
    },
  };
}

export type DiffPanelFileEntry = {
  readonly fileDiff: FileDiffMetadata;
  readonly fileKey: string;
};

export type DiffPanelFileListInput = {
  readonly files: ReadonlyArray<DiffPanelFileEntry>;
  readonly collapsedFileKeys: ReadonlySet<string>;
  readonly lazy: boolean;
  readonly readyFilePaths: ReadonlySet<string>;
  readonly fileStats: ReadonlyArray<ReviewDiffFileStat> | null | undefined;
  readonly fileStates: ReadonlyMap<string, DiffFileLoadState>;
};

export type DiffPanelFileModel = DiffFileHeaderModel & {
  readonly visible: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly headerStat: DiffStatLabelModel | null;
  readonly loadStatus: DiffFileStatusModel | null;
};

export type DiffPanelFileListModel = {
  readonly files: ReadonlyArray<DiffPanelFileModel>;
  readonly fileKeys: ReadonlyArray<string>;
  readonly visibleFileCount: number;
  readonly allCollapsed: boolean;
};

export function buildDiffPanelFileListModel(input: DiffPanelFileListInput): DiffPanelFileListModel {
  const statsByPath = new Map(input.fileStats?.map((file) => [file.path, file]));
  const files = input.files.map((entry): DiffPanelFileModel => {
    const header = buildDiffFileHeaderModel({
      fileDiff: entry.fileDiff,
      fileKey: entry.fileKey,
      collapsedFileKeys: input.collapsedFileKeys,
    });
    const stat = statsByPath.get(header.path);
    const lineStat = stat ?? getDiffLineStat([entry.fileDiff]);
    const visible = !input.lazy || input.readyFilePaths.has(header.path);
    return {
      ...header,
      visible,
      additions: lineStat.additions,
      deletions: lineStat.deletions,
      headerStat: stat ? buildDiffStatLabelModel(stat) : null,
      loadStatus: stat ? buildDiffFileStatusModel(input.fileStates.get(header.path) ?? {}) : null,
    };
  });
  const fileKeys = files.map((file) => file.fileKey);
  return {
    files,
    fileKeys,
    visibleFileCount: files.filter((file) => file.visible).length,
    allCollapsed: areAllDiffFilesCollapsed(fileKeys, input.collapsedFileKeys),
  };
}

export function resolveSelectedDiffFileKey(
  files: ReadonlyArray<DiffFileTarget & { readonly visible: boolean }>,
  selectedFilePath: string | null,
): string | null {
  return selectedFilePath
    ? (files.find((file) => file.visible && file.path === selectedFilePath)?.fileKey ?? null)
    : null;
}

export type DiffFileTarget = {
  readonly path: string;
  readonly fileKey: string;
};

export type DiffCodeViewClickInput = {
  readonly clickedControl: boolean;
  readonly titlePath: string | null | undefined;
  readonly headerTitlePath: string | null | undefined;
  readonly files: ReadonlyArray<DiffFileTarget & { readonly visible: boolean }>;
};

export type DiffCodeViewClickIntent =
  | { readonly kind: "open-file"; readonly filePath: string }
  | { readonly kind: "toggle-file-collapsed"; readonly fileKey: string }
  | { readonly kind: "none" };

export function resolveDiffCodeViewClick(input: DiffCodeViewClickInput): DiffCodeViewClickIntent {
  if (input.clickedControl) return { kind: "none" };
  if (input.titlePath) return { kind: "open-file", filePath: input.titlePath };
  const headerTitlePath = input.headerTitlePath;
  if (!headerTitlePath) return { kind: "none" };
  const file = input.files.find(
    (candidate) => candidate.visible && candidate.path === headerTitlePath,
  );
  return file ? { kind: "toggle-file-collapsed", fileKey: file.fileKey } : { kind: "none" };
}

export type DiffFileContextMenuIntent =
  | { readonly kind: "open-context-menu"; readonly filePath: string }
  | { readonly kind: "none" };

export function resolveDiffFileContextMenu(
  titleText: string | null | undefined,
): DiffFileContextMenuIntent {
  const filePath = titleText?.trim();
  return filePath ? { kind: "open-context-menu", filePath } : { kind: "none" };
}

export type DiffRevealFileInput = {
  readonly filePath: string;
  readonly files: ReadonlyArray<DiffFileTarget>;
  readonly lazy: boolean;
  readonly settledFileCount: number;
};

export type DiffRevealFileIntent =
  | {
      readonly kind: "reveal-file";
      readonly fileKey: string;
      readonly requestFileIndex: number | null;
    }
  | { readonly kind: "none" };

export function resolveRevealDiffFile(input: DiffRevealFileInput): DiffRevealFileIntent {
  const index = input.files.findIndex((candidate) => candidate.path === input.filePath);
  const file = input.files[index];
  if (!file) return { kind: "none" };
  return {
    kind: "reveal-file",
    fileKey: file.fileKey,
    requestFileIndex: input.lazy && index >= input.settledFileCount ? index : null,
  };
}

export function compareDiffPaths(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function compareDiffFilesByPath(left: FileDiffMetadata, right: FileDiffMetadata): number {
  return compareDiffPaths(resolveFileDiffPath(left), resolveFileDiffPath(right));
}

export type DiffLineKind = "context" | "addition" | "deletion";

export type DiffLineModel = {
  readonly kind: DiffLineKind;
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly text: string;
};

export type DiffHunkModel = {
  readonly header: string;
  readonly context: string | null;
  readonly collapsedBefore: number;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly oldMissingNewlineAtEnd: boolean;
  readonly newMissingNewlineAtEnd: boolean;
  readonly lines: ReadonlyArray<DiffLineModel>;
};

export type DiffFileHunksModel = {
  readonly path: string;
  readonly previousPath: string | null;
  readonly changeType: FileDiffMetadata["type"];
  readonly isPartial: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: ReadonlyArray<DiffHunkModel>;
};

function diffLineText(line: string | undefined): string {
  return (line ?? "").replace(/\r?\n$/, "");
}

export function buildDiffFileHunksModel(fileDiff: FileDiffMetadata): DiffFileHunksModel {
  const path = resolveFileDiffPath(fileDiff);
  const previousPath = resolveFileDiffPreviousPath(fileDiff);
  const stat = getDiffLineStat([fileDiff]);
  const hunks = fileDiff.hunks.map((hunk): DiffHunkModel => {
    const lines: DiffLineModel[] = [];
    for (const content of hunk.hunkContent) {
      const oldOffset = hunk.deletionStart + content.deletionLineIndex - hunk.deletionLineIndex;
      const newOffset = hunk.additionStart + content.additionLineIndex - hunk.additionLineIndex;
      if (content.type === "context") {
        for (let index = 0; index < content.lines; index += 1) {
          lines.push({
            kind: "context",
            oldLineNumber: oldOffset + index,
            newLineNumber: newOffset + index,
            text: diffLineText(fileDiff.additionLines[content.additionLineIndex + index]),
          });
        }
        continue;
      }
      for (let index = 0; index < content.deletions; index += 1) {
        lines.push({
          kind: "deletion",
          oldLineNumber: oldOffset + index,
          newLineNumber: null,
          text: diffLineText(fileDiff.deletionLines[content.deletionLineIndex + index]),
        });
      }
      for (let index = 0; index < content.additions; index += 1) {
        lines.push({
          kind: "addition",
          oldLineNumber: null,
          newLineNumber: newOffset + index,
          text: diffLineText(fileDiff.additionLines[content.additionLineIndex + index]),
        });
      }
    }
    return {
      header:
        hunk.hunkSpecs?.trimEnd() ??
        `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`,
      context: hunk.hunkContext ?? null,
      collapsedBefore: hunk.collapsedBefore,
      oldStart: hunk.deletionStart,
      oldCount: hunk.deletionCount,
      newStart: hunk.additionStart,
      newCount: hunk.additionCount,
      additions: hunk.additionLines,
      deletions: hunk.deletionLines,
      oldMissingNewlineAtEnd: hunk.noEOFCRDeletions,
      newMissingNewlineAtEnd: hunk.noEOFCRAdditions,
      lines,
    };
  });
  return {
    path,
    previousPath: previousPath === path ? null : previousPath,
    changeType: fileDiff.type,
    isPartial: fileDiff.isPartial,
    additions: stat.additions,
    deletions: stat.deletions,
    hunks,
  };
}

export type DiffSplitRowModel = {
  readonly left: DiffLineModel | null;
  readonly right: DiffLineModel | null;
};

export function buildDiffSplitRows(lines: ReadonlyArray<DiffLineModel>): DiffSplitRowModel[] {
  const rows: DiffSplitRowModel[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      index += 1;
      continue;
    }
    const deletions: DiffLineModel[] = [];
    const additions: DiffLineModel[] = [];
    while (lines[index]?.kind === "deletion") {
      const deletion = lines[index];
      if (deletion) deletions.push(deletion);
      index += 1;
    }
    while (lines[index]?.kind === "addition") {
      const addition = lines[index];
      if (addition) additions.push(addition);
      index += 1;
    }
    for (let pair = 0; pair < Math.max(deletions.length, additions.length); pair += 1) {
      rows.push({ left: deletions[pair] ?? null, right: additions[pair] ?? null });
    }
  }
  return rows;
}

export type DiffPatchModelInput = {
  readonly patch: string | undefined;
  readonly cacheScope: string;
  readonly ignoreWhitespace: boolean;
  readonly compactPartialHunkOffsets: boolean;
};

export type DiffPatchModel =
  | { readonly kind: "none" }
  | { readonly kind: "raw"; readonly reason: string; readonly text: string }
  | {
      readonly kind: "files";
      readonly stat: DiffStat;
      readonly files: ReadonlyArray<DiffFileHunksModel>;
    };

export function buildDiffPatchModel(input: DiffPatchModelInput): DiffPatchModel {
  const renderable = getRenderablePatch(input.patch, input.cacheScope, {
    ignoreWhitespace: input.ignoreWhitespace,
    compactPartialHunkOffsets: input.compactPartialHunkOffsets,
  });
  if (!renderable) return { kind: "none" };
  if (renderable.kind === "raw") {
    return { kind: "raw", reason: renderable.reason, text: renderable.text };
  }
  const files = renderable.files.toSorted(compareDiffFilesByPath);
  return {
    kind: "files",
    stat: getDiffLineStat(files),
    files: files.map(buildDiffFileHunksModel),
  };
}
