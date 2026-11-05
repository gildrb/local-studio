import type { ProjectEntry, ProjectEntryKind } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import { resolvePierreIconForEntry } from "../../pierre-icons";

export type DirectoryEntriesByPath = ReadonlyMap<string, ReadonlyArray<ProjectEntry>>;

export type FileTreePathSearchState = {
  readonly entries: ReadonlyArray<ProjectEntry>;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly truncated: boolean;
};

export type FileTreeChromeInput = {
  readonly projectName: string;
  readonly query: string;
  readonly isPending: boolean;
  readonly directoryError: string | null;
  readonly pathSearch: Omit<FileTreePathSearchState, "entries">;
  readonly directoryCount: number;
  readonly expandAll: boolean;
  readonly allDirectoriesExpanded: boolean;
};

export type FileTreeToggleAllModel = {
  readonly label: string;
  readonly icon: "chevrons-down-up" | "chevrons-up-down";
  readonly nextExpanded: boolean;
};

export type FileTreeChromeModel = {
  readonly refresh: {
    readonly ariaLabel: string;
    readonly tooltip: string;
    readonly refreshing: boolean;
  };
  readonly search: {
    readonly name: string;
    readonly ariaLabel: string;
    readonly placeholder: string;
  };
  readonly toggleAll: FileTreeToggleAllModel | null;
  readonly errorText: string | null;
  readonly truncatedText: string | null;
  readonly loadingText: string | null;
  readonly treeAriaLabel: string;
};

export type FileTreeLoadedDirectory = {
  readonly path: string;
  readonly entries: ReadonlyArray<ProjectEntry>;
};

export type FileTreeDirectoryError = {
  readonly path: string;
  readonly message: string;
};

export type FileTreeModelInput = {
  readonly projectName: string;
  readonly loadedDirectories: ReadonlyArray<FileTreeLoadedDirectory>;
  readonly loadingDirectoryPaths: ReadonlyArray<string>;
  readonly directoryErrors: ReadonlyArray<FileTreeDirectoryError>;
  readonly expandedPaths: ReadonlyArray<string>;
  readonly expandAll: boolean;
  readonly selectedPath: string | null;
  readonly query: string;
  readonly pathSearch: FileTreePathSearchState;
};

export type FileTreeRowModel = {
  readonly path: string;
  readonly treePath: string;
  readonly name: string;
  readonly kind: ProjectEntryKind;
  readonly depth: number;
  readonly expanded: boolean;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selected: boolean;
  readonly ignored: boolean;
  readonly icon: string;
  readonly iconToken: string | null;
};

export type FileTreeModel = {
  readonly ready: boolean;
  readonly searching: boolean;
  readonly chrome: FileTreeChromeModel;
  readonly rows: ReadonlyArray<FileTreeRowModel>;
  readonly directoryPaths: ReadonlyArray<string>;
  readonly allDirectoriesExpanded: boolean;
};

export type FileTreeRowIntent =
  | { readonly kind: "open-file"; readonly path: string }
  | {
      readonly kind: "set-directory-expanded";
      readonly path: string;
      readonly expanded: boolean;
      readonly loadPath: string | null;
      readonly clearExpandAll: boolean;
    };

export type FileTreeKeyboardIntent =
  | { readonly kind: "none" }
  | { readonly kind: "focus"; readonly path: string }
  | { readonly kind: "row"; readonly intent: FileTreeRowIntent };

export type FileTreeSelectionIntent =
  | { readonly kind: "ignore" }
  | { readonly kind: "open-file"; readonly path: string };

export type FileTreeRevealRequest = {
  readonly path: string;
  readonly revealId: number;
};

export type FileTreeRevealInput = {
  readonly selectedPath: string | null;
  readonly selectedKind: ProjectEntryKind | null;
  readonly revealId: number;
  readonly handledReveal: FileTreeRevealRequest | null;
  readonly selectedItemPresent: boolean;
  readonly treeSelectedPaths: ReadonlyArray<string>;
  readonly treeSelectionPath: string | null;
};

export type FileTreeRevealIntent =
  | { readonly kind: "reset" }
  | { readonly kind: "none" }
  | { readonly kind: "acknowledge"; readonly request: FileTreeRevealRequest }
  | {
      readonly kind: "reveal";
      readonly request: FileTreeRevealRequest;
      readonly treePath: string;
      readonly ancestorPaths: ReadonlyArray<string>;
    };

export type FileTreeContextMenuIntent =
  | { readonly kind: "none" }
  | { readonly kind: "file-action"; readonly action: string }
  | { readonly kind: "copy-mention"; readonly mention: string; readonly relativePath: string }
  | { readonly kind: "add-to-chat"; readonly text: string };

export type FileTreeMentionOutcome =
  | { readonly kind: "mention-copied"; readonly relativePath: string }
  | { readonly kind: "mention-copy-failed"; readonly error: unknown }
  | { readonly kind: "composer-unavailable" }
  | { readonly kind: "composer-rejected" };

export type FileTreeToastModel = {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description: string;
};

export type FileTreeContextMenuPointer = {
  readonly x: number;
  readonly y: number;
  readonly at: number;
};

export const FILE_TREE_PATH_SEARCH_LIMIT = 200;

export const FILE_TREE_PATH_SEARCH_MAX_QUERY_LENGTH = 256;

export const FILE_TREE_MENTION_MENU_ITEMS = [
  { id: "copy-mention", label: "Copy mention" },
  { id: "add-to-chat", label: "Add to chat" },
] as const;

export function fileTreePath(entry: Pick<ProjectEntry, "path" | "kind">): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function parentDirectoryPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function selectDirectChildEntries(
  entries: ReadonlyArray<ProjectEntry>,
  directoryPath: string,
): ReadonlyArray<ProjectEntry> {
  return entries.filter((entry) => parentDirectoryPath(entry.path) === directoryPath);
}

export function flattenLoadedDirectories(directories: DirectoryEntriesByPath): ProjectEntry[] {
  const result: ProjectEntry[] = [];
  const visit = (path: string) => {
    for (const entry of directories.get(path) ?? []) {
      result.push(entry);
      if (entry.kind === "directory") visit(entry.path);
    }
  };
  visit("");
  return result;
}

export function collectReachableDirectoryPaths(
  entries: ReadonlyArray<ProjectEntry>,
): ReadonlySet<string> {
  return new Set([
    "",
    ...entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
  ]);
}

export function resolveVisibleDirectoryError(
  errors: Iterable<readonly [string, string]>,
  reachableDirectories: ReadonlySet<string>,
): string | null {
  for (const [path, message] of errors) {
    if (reachableDirectories.has(path)) return message;
  }
  return null;
}

export function directoryLoadErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unable to load folder.";
}

export function mergeFileTreeEntries(input: {
  readonly directoryEntries: ReadonlyArray<ProjectEntry>;
  readonly query: string;
  readonly searchEntries: ReadonlyArray<ProjectEntry>;
  readonly searchPending: boolean;
}): ProjectEntry[] {
  const result = new Map(input.directoryEntries.map((entry) => [entry.path, entry]));
  if (input.query.trim() && !input.searchPending) {
    for (const entry of input.searchEntries) {
      if (!result.has(entry.path)) result.set(entry.path, entry);
      const segments = entry.path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const path = segments.slice(0, index).join("/");
        if (!result.has(path)) result.set(path, { path, kind: "directory" });
      }
    }
  }
  return [...result.values()];
}

export function fileTreeDirectoryPaths(entries: ReadonlyArray<ProjectEntry>): string[] {
  return entries.filter((entry) => entry.kind === "directory").map(fileTreePath);
}

export function buildIgnoredFileTreeStatus(
  entries: ReadonlyArray<ProjectEntry>,
): Array<{ path: string; status: "ignored" }> {
  return entries
    .filter((entry) => entry.ignored)
    .map((entry) => ({ path: fileTreePath(entry), status: "ignored" }));
}

export function fileTreeAncestorDirectories(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

export function buildFileTreeChromeModel(input: FileTreeChromeInput): FileTreeChromeModel {
  const searchActive = input.query.trim().length > 0;
  const collapseLabel = input.expandAll || input.allDirectoriesExpanded;
  return {
    refresh: {
      ariaLabel: "Refresh workspace files",
      tooltip: input.isPending ? "Refreshing…" : "Refresh files",
      refreshing: input.isPending,
    },
    search: {
      name: "project-files-search",
      ariaLabel: `Search ${input.projectName} files`,
      placeholder: "Search files",
    },
    toggleAll:
      input.directoryCount > 0
        ? {
            label: collapseLabel ? "Collapse all folders" : "Expand all folders",
            icon: input.allDirectoriesExpanded ? "chevrons-down-up" : "chevrons-up-down",
            nextExpanded: !collapseLabel,
          }
        : null,
    errorText:
      input.directoryError || input.pathSearch.error
        ? `${input.directoryError ?? input.pathSearch.error} Click to retry.`
        : null,
    truncatedText:
      searchActive && input.pathSearch.truncated && !input.pathSearch.isPending
        ? "More matches available. Refine your search."
        : null,
    loadingText: input.isPending || input.pathSearch.isPending ? "Loading files…" : null,
    treeAriaLabel: `${input.projectName} files`,
  };
}

function normalizeFileTreeSearchQuery(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return (trimmed.includes("\\") ? trimmed.replaceAll("\\", "/") : trimmed).toLowerCase();
}

function compareFileTreeEntries(left: ProjectEntry, right: ProjectEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  const leftName = left.path.slice(left.path.lastIndexOf("/") + 1);
  const rightName = right.path.slice(right.path.lastIndexOf("/") + 1);
  const leftIsDot = leftName.startsWith(".");
  if (leftIsDot !== rightName.startsWith(".")) return leftIsDot ? -1 : 1;
  return leftName.toLowerCase().localeCompare(rightName.toLowerCase());
}

export function buildFileTreeModel(input: FileTreeModelInput): FileTreeModel {
  const directories: DirectoryEntriesByPath = new Map(
    input.loadedDirectories.map((directory) => [directory.path, directory.entries]),
  );
  const entries = mergeFileTreeEntries({
    directoryEntries: flattenLoadedDirectories(directories),
    query: input.query,
    searchEntries: input.pathSearch.entries,
    searchPending: input.pathSearch.isPending,
  });
  const directoryEntries = entries.filter((entry) => entry.kind === "directory");
  const reachable = collectReachableDirectoryPaths(entries);
  const childrenByParent = new Map<string, ProjectEntry[]>();
  for (const entry of entries) {
    const parent = parentDirectoryPath(entry.path);
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(parent, [entry]);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(compareFileTreeEntries);

  const searchValue = normalizeFileTreeSearchQuery(input.query);
  const searching = searchValue.length > 0;
  let visible: Set<string> | null = null;
  let expanded: Set<string>;
  if (searching) {
    const matches = entries.filter((entry) =>
      fileTreePath(entry).toLowerCase().includes(searchValue),
    );
    expanded = new Set();
    if (matches.length > 0) {
      visible = new Set();
      for (const match of matches) {
        visible.add(match.path);
        if (match.kind === "directory") expanded.add(match.path);
        for (const ancestor of fileTreeAncestorDirectories(match.path).slice(1)) {
          visible.add(ancestor);
          expanded.add(ancestor);
        }
      }
    }
  } else {
    expanded = new Set(input.expandedPaths);
    if (input.expandAll) for (const entry of directoryEntries) expanded.add(entry.path);
  }

  const loading = new Set(input.loadingDirectoryPaths);
  const errors = new Map(input.directoryErrors.map((error) => [error.path, error.message]));
  const rows: FileTreeRowModel[] = [];
  const visit = (parent: string, depth: number) => {
    for (const child of childrenByParent.get(parent) ?? []) {
      let terminal = child;
      let name = child.path.slice(child.path.lastIndexOf("/") + 1);
      while (terminal.kind === "directory") {
        const children = childrenByParent.get(terminal.path);
        const onlyChild = children?.length === 1 ? children[0] : undefined;
        if (onlyChild === undefined || onlyChild.kind !== "directory") break;
        terminal = onlyChild;
        name = `${name}/${onlyChild.path.slice(onlyChild.path.lastIndexOf("/") + 1)}`;
      }
      if (visible !== null && !visible.has(terminal.path)) continue;
      const isDirectory = terminal.kind === "directory";
      const isExpanded = isDirectory && expanded.has(terminal.path);
      const icon = isDirectory ? null : resolvePierreIconForEntry(terminal.path, "file");
      rows.push({
        path: terminal.path,
        treePath: fileTreePath(terminal),
        name,
        kind: terminal.kind,
        depth,
        expanded: isExpanded,
        loaded: isDirectory && directories.has(terminal.path),
        loading: isDirectory && loading.has(terminal.path),
        error: isDirectory ? (errors.get(terminal.path) ?? null) : null,
        selected: terminal.path === input.selectedPath,
        ignored: terminal.ignored === true,
        icon: isDirectory ? (isExpanded ? "folder-open" : "folder") : (icon?.name ?? "file"),
        iconToken: icon?.token ?? null,
      });
      if (isExpanded) visit(terminal.path, depth + 1);
    }
  };
  if (directories.has("")) visit("", 0);

  const directoryPaths = directoryEntries.map(fileTreePath);
  const allDirectoriesExpanded =
    directoryEntries.length > 0 && directoryEntries.every((entry) => expanded.has(entry.path));
  return {
    ready: directories.has(""),
    searching,
    chrome: buildFileTreeChromeModel({
      projectName: input.projectName,
      query: input.query,
      isPending: loading.size > 0,
      directoryError: resolveVisibleDirectoryError(errors, reachable),
      pathSearch: input.pathSearch,
      directoryCount: directoryPaths.length,
      expandAll: input.expandAll,
      allDirectoriesExpanded,
    }),
    rows,
    directoryPaths,
    allDirectoriesExpanded,
  };
}

export function resolveFileTreeRowActivation(
  row: Pick<FileTreeRowModel, "path" | "kind" | "expanded">,
): FileTreeRowIntent {
  if (row.kind === "file") return { kind: "open-file", path: row.path };
  const expanded = !row.expanded;
  return {
    kind: "set-directory-expanded",
    path: row.path,
    expanded,
    loadPath: expanded ? row.path : null,
    clearExpandAll: !expanded,
  };
}

export function resolveFileTreeKeyboardIntent(input: {
  readonly rows: ReadonlyArray<FileTreeRowModel>;
  readonly focusedPath: string | null;
  readonly key: string;
}): FileTreeKeyboardIntent {
  const { rows } = input;
  const focusedIndex = rows.findIndex((row) => row.path === input.focusedPath);
  const focusedRow = rows[focusedIndex];
  if (focusedRow === undefined) return { kind: "none" };
  const focusIndex = (index: number): FileTreeKeyboardIntent => {
    const row = rows[index];
    return row === undefined || index === focusedIndex
      ? { kind: "none" }
      : { kind: "focus", path: row.path };
  };
  const activate: FileTreeKeyboardIntent = {
    kind: "row",
    intent: resolveFileTreeRowActivation(focusedRow),
  };
  const isDirectory = focusedRow.kind === "directory";
  switch (input.key) {
    case "ArrowDown":
      return focusIndex(focusedIndex + 1);
    case "ArrowUp":
      return focusIndex(focusedIndex - 1);
    case "ArrowRight":
      return isDirectory && !focusedRow.expanded ? activate : focusIndex(focusedIndex + 1);
    case "ArrowLeft":
      if (isDirectory && focusedRow.expanded) return activate;
      return focusIndex(rows.findIndex((row) => row.path === parentDirectoryPath(focusedRow.path)));
    case "Home":
      return focusIndex(0);
    case "End":
      return focusIndex(rows.length - 1);
    case "Enter":
      return activate;
    default:
      return { kind: "none" };
  }
}

export function resolveFileTreeSelectionIntent(input: {
  readonly selectedPaths: ReadonlyArray<string>;
  readonly syncingSelection: boolean;
  readonly dragInProgress: boolean;
  readonly entryKinds: ReadonlyMap<string, ProjectEntryKind>;
}): FileTreeSelectionIntent {
  if (input.syncingSelection || input.dragInProgress) return { kind: "ignore" };
  const selectedPath = input.selectedPaths.at(-1)?.replace(/\/$/, "");
  if (selectedPath && input.entryKinds.get(selectedPath) === "file") {
    return { kind: "open-file", path: selectedPath };
  }
  return { kind: "ignore" };
}

export function resolveFileTreeRevealIntent(input: FileTreeRevealInput): FileTreeRevealIntent {
  const { selectedPath, selectedKind } = input;
  if (!selectedPath || selectedKind === null) return { kind: "reset" };
  const request = { path: selectedPath, revealId: input.revealId };
  if (
    input.handledReveal?.path === request.path &&
    input.handledReveal.revealId === request.revealId
  ) {
    return { kind: "none" };
  }
  if (!input.selectedItemPresent) return { kind: "none" };
  const selectedInTree = input.treeSelectedPaths.some(
    (path) => path.replace(/\/$/, "") === selectedPath,
  );
  if (selectedInTree && input.treeSelectionPath === selectedPath) {
    return { kind: "acknowledge", request };
  }
  return {
    kind: "reveal",
    request,
    treePath: fileTreePath({ path: selectedPath, kind: selectedKind }),
    ancestorPaths: fileTreeAncestorDirectories(selectedPath).slice(1),
  };
}

export function resolveFileTreeContextMenuPosition(input: {
  readonly pointer: FileTreeContextMenuPointer | null;
  readonly nowMs: number;
  readonly anchorRect: { readonly left: number; readonly bottom: number };
}): { x: number; y: number } {
  const { pointer } = input;
  return pointer !== null && input.nowMs - pointer.at < 1000
    ? { x: pointer.x, y: pointer.y }
    : { x: input.anchorRect.left, y: input.anchorRect.bottom };
}

export function resolveFileTreeContextMenuIntent(input: {
  readonly clicked: string | null;
  readonly treePath: string;
  readonly fileMenuItemIds: ReadonlyArray<string>;
}): FileTreeContextMenuIntent {
  const { clicked } = input;
  if (clicked === null) return { kind: "none" };
  if (input.fileMenuItemIds.includes(clicked) || clicked.startsWith("editor:")) {
    return { kind: "file-action", action: clicked };
  }
  const relativePath = input.treePath.replace(/\/$/, "");
  const mention = serializeComposerFileLink(relativePath);
  if (clicked === "copy-mention") return { kind: "copy-mention", mention, relativePath };
  if (clicked === "add-to-chat") return { kind: "add-to-chat", text: `${mention} ` };
  return { kind: "none" };
}

export function buildFileTreeMentionToast(outcome: FileTreeMentionOutcome): FileTreeToastModel {
  switch (outcome.kind) {
    case "mention-copied":
      return { type: "success", title: "Mention copied", description: outcome.relativePath };
    case "mention-copy-failed":
      return {
        type: "error",
        title: "Failed to copy mention",
        description: outcome.error instanceof Error ? outcome.error.message : "An error occurred.",
      };
    case "composer-unavailable":
      return {
        type: "error",
        title: "Unable to add to chat",
        description: "Open a chat for this project and try again.",
      };
    case "composer-rejected":
      return {
        type: "error",
        title: "Unable to add to chat",
        description: "The chat isn't ready to accept input right now.",
      };
  }
}
