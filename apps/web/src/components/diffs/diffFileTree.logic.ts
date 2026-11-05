import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileTreeBatchOperation, FileTreeSortComparator, GitStatus } from "@pierre/trees";

import { resolveFileDiffPath } from "~/lib/diffRendering";

/** One changed file as the tree shows it: its current path and how it changed. */
export interface DiffFileTreeEntry {
  readonly path: string;
  readonly status: GitStatus;
}

export function diffFileGitStatus(file: FileDiffMetadata): GitStatus {
  switch (file.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
  }
}

/**
 * Maps parsed diff files to tree entries, keeping the diff's own order. A path
 * appears once: a type change (regular file to symlink) is a deletion plus an
 * addition of the same path, and the tree shows the surviving file as modified.
 */
export function diffFileTreeEntries(
  files: ReadonlyArray<FileDiffMetadata>,
): ReadonlyArray<DiffFileTreeEntry> {
  const statusByPath = new Map<string, GitStatus>();
  for (const file of files) {
    const path = resolveFileDiffPath(file);
    const status = diffFileGitStatus(file);
    const previous = statusByPath.get(path);
    statusByPath.set(path, previous === undefined || previous === status ? status : "modified");
  }
  return [...statusByPath].map(([path, status]) => ({ path, status }));
}

/**
 * Every directory on the way to each file, registered with the trailing slash Pierre uses for
 * directory ids. Parents come before children so the tree can add them in order.
 */
export function collectDirectoryPaths(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    let directory = "";
    for (const segment of segments.slice(0, -1)) {
      directory += `${segment}/`;
      directories.add(directory);
    }
  }
  return [...directories];
}

/** A folder takes the position of its first file in the diff. */
export function diffFileTreePositions(paths: ReadonlyArray<string>): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  paths.forEach((path, index) => {
    positions.set(path, index);
    let directory = "";
    for (const segment of path.split("/").slice(0, -1)) {
      directory += `${segment}/`;
      if (!positions.has(directory)) positions.set(directory, index);
    }
  });
  return positions;
}

export function compareDiffFileTreeEntries(
  getPositions: () => ReadonlyMap<string, number>,
): FileTreeSortComparator {
  return (left, right) => {
    const positions = getPositions();
    return (
      (positions.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right.path) ?? Number.MAX_SAFE_INTEGER) ||
      left.depth - right.depth ||
      left.path.localeCompare(right.path)
    );
  };
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/**
 * The adds and removes that turn one set of file paths into another, so a diff that changes
 * under the reader (a new slice, a refresh after an agent edit) keeps the directories they
 * have already opened or closed instead of rebuilding the tree from scratch.
 *
 * Directories are removed only once no file needs them; a directory that gains its first file
 * is added before that file.
 */
export function buildDiffFileTreeUpdates(
  previousPaths: ReadonlyArray<string>,
  nextPaths: ReadonlyArray<string>,
): FileTreeBatchOperation[] {
  const previousDirectories = new Set(collectDirectoryPaths(previousPaths));
  const nextDirectories = new Set(collectDirectoryPaths(nextPaths));
  const previous = new Set(previousPaths);
  const next = new Set(nextPaths);
  const updates: FileTreeBatchOperation[] = [];

  for (const path of previousPaths) {
    if (!next.has(path)) updates.push({ type: "remove", path });
  }
  // Deepest first: a directory can only go once everything under it has.
  const removedDirectories = [...previousDirectories]
    .filter((directory) => !nextDirectories.has(directory))
    .toSorted((left, right) => pathDepth(right) - pathDepth(left));
  for (const directory of removedDirectories) {
    updates.push({ type: "remove", path: directory, recursive: true });
  }

  // Shallowest first: a file's directory has to exist before the file does.
  const addedDirectories = [...nextDirectories]
    .filter((directory) => !previousDirectories.has(directory))
    .toSorted((left, right) => pathDepth(left) - pathDepth(right));
  for (const directory of addedDirectories) updates.push({ type: "add", path: directory });
  for (const path of nextPaths) {
    if (!previous.has(path)) updates.push({ type: "add", path });
  }

  return updates;
}

export type DiffFileGitStatusPresentation = {
  readonly letter: string | null;
  readonly title: string;
  readonly tone: GitStatus;
};

const GIT_STATUS_PRESENTATION: Readonly<Record<GitStatus, DiffFileGitStatusPresentation>> = {
  added: { letter: "A", title: "Git status: added", tone: "added" },
  deleted: { letter: "D", title: "Git status: deleted", tone: "deleted" },
  ignored: { letter: null, title: "Git status: ignored", tone: "ignored" },
  modified: { letter: "M", title: "Git status: modified", tone: "modified" },
  renamed: { letter: "R", title: "Git status: renamed", tone: "renamed" },
  untracked: { letter: "U", title: "Git status: untracked", tone: "untracked" },
};

export function describeDiffFileGitStatus(status: GitStatus): DiffFileGitStatusPresentation {
  return GIT_STATUS_PRESENTATION[status];
}

export const DIFF_FILE_TREE_DIRECTORY_DECORATION_TITLE = "Contains git status items";

export type DiffFileTreeToggleAllModel = {
  readonly expanded: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: "chevrons-down-up" | "chevrons-up-down";
};

export type DiffFileTreeHeaderInput = {
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly allDirectoriesExpanded: boolean;
};

export type DiffFileTreeHeaderModel = {
  readonly title: string;
  readonly fileCount: number;
  readonly toggleAllDirectories: DiffFileTreeToggleAllModel | null;
};

export function buildDiffFileTreeHeaderModel(
  input: DiffFileTreeHeaderInput,
): DiffFileTreeHeaderModel {
  const expanded = input.allDirectoriesExpanded;
  const label = expanded ? "Collapse all folders" : "Expand all folders";
  return {
    title: "Files",
    fileCount: input.fileCount,
    toggleAllDirectories:
      input.directoryCount > 0
        ? {
            expanded,
            ariaLabel: label,
            tooltip: label,
            icon: expanded ? "chevrons-down-up" : "chevrons-up-down",
          }
        : null,
  };
}

export type DiffFileTreeDirectoryRow = {
  readonly kind: "directory";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly expanded: boolean;
  readonly decorationTitle: string;
};

export type DiffFileTreeFileRow = {
  readonly kind: "file";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly status: GitStatus;
  readonly statusLetter: string | null;
  readonly statusTitle: string;
  readonly tone: GitStatus;
  readonly selected: boolean;
};

export type DiffFileTreeRow = DiffFileTreeDirectoryRow | DiffFileTreeFileRow;

export type DiffFileTreeInput = {
  readonly entries: ReadonlyArray<DiffFileTreeEntry>;
  readonly selectedPath: string | null;
  readonly collapsedDirectoryPaths: ReadonlyArray<string>;
};

export type DiffFileTreeModel = {
  readonly header: DiffFileTreeHeaderModel;
  readonly directoryPaths: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<DiffFileTreeRow>;
};

type TreeDirectory = {
  readonly path: string;
  readonly name: string;
  readonly directories: Map<string, TreeDirectory>;
  readonly files: DiffFileTreeEntry[];
};

type TreeChild =
  | { readonly kind: "directory"; readonly path: string; readonly node: TreeDirectory }
  | { readonly kind: "file"; readonly path: string; readonly entry: DiffFileTreeEntry };

function sortedTreeChildren(
  directory: TreeDirectory,
  positions: ReadonlyMap<string, number>,
): ReadonlyArray<TreeChild> {
  const children: TreeChild[] = [
    ...[...directory.directories.values()].map((node): TreeChild => ({
      kind: "directory",
      path: node.path,
      node,
    })),
    ...directory.files.map((entry): TreeChild => ({ kind: "file", path: entry.path, entry })),
  ];
  return children.toSorted(
    (left, right) =>
      (positions.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right.path) ?? Number.MAX_SAFE_INTEGER) ||
      left.path.localeCompare(right.path),
  );
}

function appendDiffFileTreeRows(
  rows: DiffFileTreeRow[],
  directory: TreeDirectory,
  depth: number,
  context: {
    readonly positions: ReadonlyMap<string, number>;
    readonly collapsed: ReadonlySet<string>;
    readonly selectedPath: string | null;
  },
): void {
  for (const child of sortedTreeChildren(directory, context.positions)) {
    if (child.kind === "file") {
      const presentation = describeDiffFileGitStatus(child.entry.status);
      rows.push({
        kind: "file",
        path: child.entry.path,
        name: child.entry.path.split("/").at(-1) ?? child.entry.path,
        depth,
        status: child.entry.status,
        statusLetter: presentation.letter,
        statusTitle: presentation.title,
        tone: presentation.tone,
        selected: child.entry.path === context.selectedPath,
      });
      continue;
    }
    let node = child.node;
    let name = node.name;
    while (node.files.length === 0 && node.directories.size === 1) {
      const only = node.directories.values().next().value;
      if (only === undefined) break;
      node = only;
      name = `${name}/${only.name}`;
    }
    const expanded = !context.collapsed.has(node.path);
    rows.push({
      kind: "directory",
      path: node.path,
      name,
      depth,
      expanded,
      decorationTitle: DIFF_FILE_TREE_DIRECTORY_DECORATION_TITLE,
    });
    if (expanded) appendDiffFileTreeRows(rows, node, depth + 1, context);
  }
}

export function buildDiffFileTreeModel(input: DiffFileTreeInput): DiffFileTreeModel {
  const paths = input.entries.map((entry) => entry.path);
  const directoryPaths = collectDirectoryPaths(paths);
  const collapsed = new Set(
    input.collapsedDirectoryPaths.filter((path) => directoryPaths.includes(path)),
  );
  const root: TreeDirectory = { path: "", name: "", directories: new Map(), files: [] };
  for (const entry of input.entries) {
    let directory = root;
    for (const segment of entry.path.split("/").slice(0, -1)) {
      const existing = directory.directories.get(segment);
      if (existing) {
        directory = existing;
        continue;
      }
      const created: TreeDirectory = {
        path: `${directory.path}${segment}/`,
        name: segment,
        directories: new Map(),
        files: [],
      };
      directory.directories.set(segment, created);
      directory = created;
    }
    directory.files.push(entry);
  }
  const rows: DiffFileTreeRow[] = [];
  appendDiffFileTreeRows(rows, root, 0, {
    positions: diffFileTreePositions(paths),
    collapsed,
    selectedPath: input.selectedPath,
  });
  return {
    header: buildDiffFileTreeHeaderModel({
      fileCount: input.entries.length,
      directoryCount: directoryPaths.length,
      allDirectoriesExpanded: collapsed.size === 0,
    }),
    directoryPaths,
    rows,
  };
}

export type DiffFileTreeSelectIntent =
  | { readonly kind: "select-file"; readonly path: string }
  | { readonly kind: "none" };

export function resolveDiffFileTreeSelectionChange(
  selectedPaths: ReadonlyArray<string>,
  filePaths: ReadonlySet<string>,
): DiffFileTreeSelectIntent {
  const path = selectedPaths.at(-1)?.replace(/\/$/, "");
  return path && filePaths.has(path) ? { kind: "select-file", path } : { kind: "none" };
}

export type DiffFileTreeRowClickInput = {
  readonly isPlainPrimaryClick: boolean;
  readonly selectedPaths: ReadonlyArray<string>;
  readonly filePaths: ReadonlySet<string>;
  readonly clickedItemPaths: ReadonlyArray<string>;
};

export function resolveDiffFileTreeRowClick(
  input: DiffFileTreeRowClickInput,
): DiffFileTreeSelectIntent {
  if (!input.isPlainPrimaryClick) return { kind: "none" };
  const path = input.selectedPaths.length === 1 ? input.selectedPaths[0] : undefined;
  if (!path || !input.filePaths.has(path)) return { kind: "none" };
  return input.clickedItemPaths.includes(path) ? { kind: "select-file", path } : { kind: "none" };
}

export type DiffFileTreeToggleAllIntent = {
  readonly kind: "set-all-directories-expanded";
  readonly expanded: boolean;
};

export function resolveDiffFileTreeToggleAllDirectories(
  allDirectoriesExpanded: boolean,
): DiffFileTreeToggleAllIntent {
  return { kind: "set-all-directories-expanded", expanded: !allDirectoriesExpanded };
}

export type DiffFileTreeToggleDirectoryIntent = {
  readonly kind: "set-collapsed-directories";
  readonly paths: ReadonlyArray<string>;
};

export function resolveDiffFileTreeToggleDirectory(
  collapsedDirectoryPaths: ReadonlyArray<string>,
  path: string,
): DiffFileTreeToggleDirectoryIntent {
  return {
    kind: "set-collapsed-directories",
    paths: collapsedDirectoryPaths.includes(path)
      ? collapsedDirectoryPaths.filter((candidate) => candidate !== path)
      : [...collapsedDirectoryPaths, path],
  };
}
