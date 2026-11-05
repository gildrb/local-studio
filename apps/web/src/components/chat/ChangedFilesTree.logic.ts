import type { TurnId } from "@t3tools/contracts";

import {
  buildTurnDiffTree,
  summarizeTurnDiffStats,
  type TurnDiffTreeNode,
} from "../../lib/turnDiffTree";
import type { TurnDiffFileChange } from "../../types";
import { hasNonZeroStat, type DiffStat } from "./DiffStatLabel.logic";

export type ChangedFilesToggleAllModel = {
  readonly expanded: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: "chevrons-down-up" | "chevrons-up-down";
};

export type ChangedFilesOpenDiffModel = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: "file-diff";
  readonly filePath: string | null;
};

export type ChangedFilesCardInput = {
  readonly files: ReadonlyArray<TurnDiffFileChange>;
  readonly allDirectoriesExpanded: boolean;
};

export type ChangedFilesCardModel = {
  readonly countLabel: string;
  readonly stat: DiffStat | null;
  readonly toggleAllDirectories: ChangedFilesToggleAllModel | null;
  readonly openDiff: ChangedFilesOpenDiffModel;
};

export function buildChangedFilesCardModel(input: ChangedFilesCardInput): ChangedFilesCardModel {
  const { files, allDirectoriesExpanded } = input;
  const summaryStat = summarizeTurnDiffStats(files);
  const hasDirectories = files.some((file) => /[/\\]/.test(file.path));
  const toggleLabel = allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders";
  return {
    countLabel: `${files.length} changed file${files.length === 1 ? "" : "s"}`,
    stat: hasNonZeroStat(summaryStat) ? summaryStat : null,
    toggleAllDirectories: hasDirectories
      ? {
          expanded: allDirectoriesExpanded,
          ariaLabel: toggleLabel,
          tooltip: toggleLabel,
          icon: allDirectoriesExpanded ? "chevrons-down-up" : "chevrons-up-down",
        }
      : null,
    openDiff: {
      label: "Open diff",
      ariaLabel: "Open diff",
      tooltip: "Open the full diff",
      icon: "file-diff",
      filePath: files[0]?.path ?? null,
    },
  };
}

export type ChangedFilesExpansionState = {
  readonly key: string | null;
  readonly overrides: Readonly<Record<string, boolean>>;
};

export const INITIAL_CHANGED_FILES_EXPANSION_STATE: ChangedFilesExpansionState = {
  key: null,
  overrides: {},
};

export type ChangedFilesDirectoryNodeModel = {
  readonly kind: "directory";
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly indentPx: number;
  readonly expanded: boolean;
  readonly icon: "folder-open" | "folder-closed";
  readonly stat: DiffStat | null;
  readonly children: ReadonlyArray<ChangedFilesTreeNodeModel>;
};

export type ChangedFilesFileNodeModel = {
  readonly kind: "file";
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly indentPx: number;
  readonly showLeadingSpacer: boolean;
  readonly stat: DiffStat | null;
};

export type ChangedFilesTreeNodeModel = ChangedFilesDirectoryNodeModel | ChangedFilesFileNodeModel;

export type ChangedFilesTreeInput = {
  readonly files: ReadonlyArray<TurnDiffFileChange>;
  readonly allDirectoriesExpanded: boolean;
  readonly expansionState: ChangedFilesExpansionState;
};

export type ChangedFilesTreeModel = {
  readonly expansionKey: string;
  readonly nodes: ReadonlyArray<ChangedFilesTreeNodeModel>;
};

function collectTurnDiffDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectTurnDiffDirectoryPaths(node.children));
  }
  return paths;
}

function buildChangedFilesNodeModels(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  depth: number,
  context: {
    readonly allDirectoriesExpanded: boolean;
    readonly overrides: Readonly<Record<string, boolean>>;
    readonly hasDirectoryNodes: boolean;
  },
): ReadonlyArray<ChangedFilesTreeNodeModel> {
  const indentPx = 8 + depth * 14;
  return nodes.map((node): ChangedFilesTreeNodeModel => {
    if (node.kind === "directory") {
      const expanded = context.overrides[node.path] ?? context.allDirectoriesExpanded;
      return {
        kind: "directory",
        key: `dir:${node.path}`,
        path: node.path,
        name: node.name,
        depth,
        indentPx,
        expanded,
        icon: expanded ? "folder-open" : "folder-closed",
        stat: hasNonZeroStat(node.stat) ? node.stat : null,
        children: expanded ? buildChangedFilesNodeModels(node.children, depth + 1, context) : [],
      };
    }
    return {
      kind: "file",
      key: `file:${node.path}`,
      path: node.path,
      name: node.name,
      depth,
      indentPx,
      showLeadingSpacer: context.hasDirectoryNodes || depth > 0,
      stat: node.stat,
    };
  });
}

export function buildChangedFilesTreeModel(input: ChangedFilesTreeInput): ChangedFilesTreeModel {
  const treeNodes = buildTurnDiffTree(input.files);
  const directoryPathsKey = collectTurnDiffDirectoryPaths(treeNodes).join("\u0000");
  const expansionKey = `${input.allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  return {
    expansionKey,
    nodes: buildChangedFilesNodeModels(treeNodes, 0, {
      allDirectoriesExpanded: input.allDirectoriesExpanded,
      overrides: input.expansionState.key === expansionKey ? input.expansionState.overrides : {},
      hasDirectoryNodes: directoryPathsKey.length > 0,
    }),
  };
}

export type ChangedFilesDirectoryToggleInput = {
  readonly expansionKey: string;
  readonly path: string;
  readonly allDirectoriesExpanded: boolean;
};

export function toggleChangedFilesDirectory(
  current: ChangedFilesExpansionState,
  input: ChangedFilesDirectoryToggleInput,
): ChangedFilesExpansionState {
  const overrides = current.key === input.expansionKey ? current.overrides : {};
  return {
    key: input.expansionKey,
    overrides: {
      ...overrides,
      [input.path]: !(overrides[input.path] ?? input.allDirectoriesExpanded),
    },
  };
}

export type ChangedFileOpenIntent = {
  readonly kind: "open-turn-diff";
  readonly turnId: TurnId;
  readonly filePath: string | undefined;
};

export function resolveChangedFileOpen(
  turnId: TurnId,
  filePath: string | null | undefined,
): ChangedFileOpenIntent {
  return { kind: "open-turn-diff", turnId, filePath: filePath ?? undefined };
}
