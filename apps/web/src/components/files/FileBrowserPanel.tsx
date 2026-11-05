import { RefreshIcon } from "~/components/ui/refresh-icon";
import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
} from "@pierre/trees";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree, useFileTreeSearch, useFileTreeSelector } from "@pierre/trees/react";
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useFileContextMenu } from "~/fileContextMenu";
import type { FileContextMenuAction } from "~/fileContextMenu.logic";
import { readLocalApi } from "~/localApi";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";

import {
  FILE_TREE_MENTION_MENU_ITEMS,
  FILE_TREE_PATH_SEARCH_LIMIT,
  FILE_TREE_PATH_SEARCH_MAX_QUERY_LENGTH,
  buildFileTreeChromeModel,
  buildFileTreeMentionToast,
  buildIgnoredFileTreeStatus,
  fileTreeAncestorDirectories,
  fileTreeDirectoryPaths,
  fileTreePath,
  mergeFileTreeEntries,
  resolveFileTreeContextMenuIntent,
  resolveFileTreeContextMenuPosition,
  resolveFileTreeRevealIntent,
  resolveFileTreeSelectionIntent,
  type FileTreeChromeModel,
  type FileTreeRevealRequest,
} from "./FileBrowserPanel.logic";
import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "./fileTreeExpansion";
import { buildFileTreePathUpdates } from "./fileTreePathReconciliation";
import { useDirectoryEntries } from "./useDirectoryEntries";
import { useProjectPathSearch } from "~/state/queries";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  /** Entry currently open in the surface; revealed and selected in the tree. A directory is expanded. */
  selectedPath: string | null;
  /** Bumped when the same path should be revealed again (e.g. re-opened from search). */
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
  onRefreshSelectedFile?: () => void;
  workspaceMutationId: string | null;
}

function RefreshFilesButton(props: {
  model: FileTreeChromeModel["refresh"];
  onRefresh: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={props.model.ariaLabel}
            onClick={props.onRefresh}
          />
        }
      >
        <RefreshIcon refreshing={props.model.refreshing} />
      </TooltipTrigger>
      <TooltipPopup>{props.model.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function FileSearchField(props: {
  model: FileTreeChromeModel["search"];
  onClose: () => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        type="search"
        name={props.model.name}
        size="sm"
        value={props.value}
        aria-label={props.model.ariaLabel}
        placeholder={props.model.placeholder}
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onClose();
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
  onRefreshSelectedFile,
  workspaceMutationId,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const fileContextMenu = useFileContextMenu(environmentId);
  const {
    entries: directoryEntries,
    load,
    refresh,
    ready,
    error,
    isPending,
  } = useDirectoryEntries(environmentId, cwd);
  const [query, setQuery] = useState("");
  const [expandAll, setExpandAll] = useState(false);
  const pathSearch = useProjectPathSearch(
    { environmentId, cwd, query: query.slice(0, FILE_TREE_PATH_SEARCH_MAX_QUERY_LENGTH) },
    FILE_TREE_PATH_SEARCH_LIMIT,
  );
  const entries = useMemo(
    () =>
      mergeFileTreeEntries({
        directoryEntries,
        query,
        searchEntries: pathSearch.entries,
        searchPending: pathSearch.isPending,
      }),
    [directoryEntries, pathSearch.entries, pathSearch.isPending, query],
  );
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(fileTreePath), [entries]);
  const directoryPaths = useMemo(() => fileTreeDirectoryPaths(entries), [entries]);
  const previousTreePathsRef = useRef<readonly string[] | null>(null);
  const syncingSelectionRef = useRef(false);
  const treeSelectionPathRef = useRef<string | null>(null);
  const handledRevealRef = useRef<FileTreeRevealRequest | null>(null);

  // The tree renders rows in shadow DOM and its anchor rect is unreliable, so
  // capture the right-click position ourselves; contextmenu is a composed
  // event, so a capture-phase listener sees it with viewport coordinates.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);
  useEffect(() => {
    const capturePointer = (event: MouseEvent) => {
      contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    };
    document.addEventListener("contextmenu", capturePointer, true);
    return () => document.removeEventListener("contextmenu", capturePointer, true);
  }, []);

  /** Combines the file actions (open/reveal/open with) with the panel's own mention actions. */
  const showEntryContextMenu = async (
    item: TreeContextMenuItem,
    context: TreeContextMenuOpenContext,
  ) => {
    const api = readLocalApi();
    if (!api) {
      context.close();
      return;
    }
    const relativePath = item.path.replace(/\/$/, "");
    const position = resolveFileTreeContextMenuPosition({
      pointer: contextMenuPointerRef.current,
      nowMs: performance.now(),
      anchorRect: context.anchorElement.getBoundingClientRect(),
    });
    const fileTarget = { environmentId, filePath: relativePath, workspaceRoot: cwd };
    const fileMenuItems = fileContextMenu.buildItems(fileTarget);
    try {
      const clicked = await api.contextMenu.show(
        [...fileMenuItems, ...FILE_TREE_MENTION_MENU_ITEMS],
        position,
      );
      // "Open with" submenu selections report the child id ("editor:<id>"),
      // which is not present in the top-level item list.
      const intent = resolveFileTreeContextMenuIntent({
        clicked,
        treePath: item.path,
        fileMenuItemIds: fileMenuItems.map((entry) => entry.id),
      });
      if (intent.kind === "file-action") {
        await fileContextMenu.activate(intent.action as FileContextMenuAction, fileTarget);
        return;
      }
      if (intent.kind === "copy-mention") {
        try {
          await writeTextToClipboard(intent.mention);
          toastManager.add(
            buildFileTreeMentionToast({
              kind: "mention-copied",
              relativePath: intent.relativePath,
            }),
          );
        } catch (error) {
          toastManager.add(buildFileTreeMentionToast({ kind: "mention-copy-failed", error }));
        }
        return;
      }
      if (intent.kind === "add-to-chat") {
        const composer = composerRef?.current;
        if (!composer) {
          toastManager.add(buildFileTreeMentionToast({ kind: "composer-unavailable" }));
          return;
        }
        const inserted = composer.insertTextAtEnd(intent.text, { ensureLeadingBoundary: true });
        if (!inserted) {
          toastManager.add(buildFileTreeMentionToast({ kind: "composer-rejected" }));
        }
      }
    } finally {
      context.close();
    }
  };
  const showEntryContextMenuRef = useRef(showEntryContextMenu);
  useEffect(() => {
    showEntryContextMenuRef.current = showEntryContextMenu;
  });

  const treeModelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);
  const dragMention = useMemo(
    () =>
      createFileTreeDragMentionController({
        deselect: (path) => treeModelRef.current?.getItem(path)?.deselect(),
      }),
    [],
  );
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          void showEntryContextMenuRef.current(item, context);
        },
      },
    },
    // Rows only need to be draggable so entries can be dropped into the chat
    // composer; rearranging files inside the tree stays off.
    dragAndDrop: { canDrop: () => false },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      // The drag controller's selection cache must track every change,
      // including reveal-driven ones, or drags act on a stale selection.
      dragMention.handleSelectionChange(selectedPaths);
      // Selection changes driven by the reveal sync below are echoes of an
      // already-open file, not a request to open it again. Starting a drag
      // selects the dragged row; that selection is a side effect of the
      // gesture, not a request to open the file.
      const intent = resolveFileTreeSelectionIntent({
        selectedPaths,
        syncingSelection: syncingSelectionRef.current,
        dragInProgress: dragMention.isDragInProgress(),
        entryKinds: entryKindsRef.current,
      });
      if (intent.kind === "open-file") {
        treeSelectionPathRef.current = intent.path;
        onOpenFile(intent.path);
      }
    },
    paths: [],
    search: false,
    onSearchChange: (value) => setQuery(value ?? ""),
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
  });
  const search = useFileTreeSearch(model);
  const allDirectoriesExpanded = useFileTreeSelector(model, (currentModel) =>
    areAllDirectoriesExpanded(currentModel, directoryPaths),
  );
  const chrome = buildFileTreeChromeModel({
    projectName,
    query,
    isPending,
    directoryError: error,
    pathSearch,
    directoryCount: directoryPaths.length,
    expandAll,
    allDirectoriesExpanded,
  });
  const toggleAllDirectories = (expanded: boolean) => {
    setExpandAll(expanded);
    setAllDirectoriesExpanded(model, directoryPaths, expanded);
  };
  const closeSearch = () => {
    setQuery("");
    search.close();
  };
  const expandedPathsRef = useRef(new Set<string>());
  useEffect(() => {
    const currentPaths = new Set(directoryPaths);
    for (const path of expandedPathsRef.current) {
      if (!currentPaths.has(path)) expandedPathsRef.current.delete(path);
    }
    const loadExpanded = () => {
      if (model.isSearchOpen()) return;
      for (const path of directoryPaths) {
        const item = model.getItem(path);
        if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) {
          if (!expandedPathsRef.current.has(path)) {
            expandedPathsRef.current.add(path);
            void load(path.replace(/\/$/, ""));
          }
        } else {
          if (item?.isDirectory() && expandedPathsRef.current.has(path)) setExpandAll(false);
          expandedPathsRef.current.delete(path);
        }
      }
    };
    loadExpanded();
    return model.subscribe(loadExpanded);
  }, [directoryPaths, load, model]);
  useEffect(() => {
    model.setGitStatus(buildIgnoredFileTreeStatus(entries));
  }, [entries, model]);
  useEffect(() => {
    if (!selectedPath) return;
    const controller = new AbortController();
    void (async () => {
      for (const directoryPath of fileTreeAncestorDirectories(selectedPath)) {
        if (controller.signal.aborted) break;
        await load(directoryPath);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [load, selectedPath]);
  const handleSearchValueChange = (value: string) => {
    setQuery(value);
    if (value.trim().length === 0) {
      search.close();
      return;
    }
    search.setValue(value);
  };
  const handleRefresh = () => {
    refresh();
    if (query.trim()) pathSearch.refresh();
    onRefreshSelectedFile?.();
  };
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh: () => {
      refresh();
      if (query.trim()) pathSearch.refresh();
    },
    resourceKey: `files:${environmentId}:${cwd}`,
  });

  useEffect(() => {
    if (!ready) return;
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    const previousTreePaths = previousTreePathsRef.current;
    previousTreePathsRef.current = treePaths;
    if (previousTreePaths === null) {
      model.resetPaths(treePaths);
      return;
    }
    const updates = buildFileTreePathUpdates(previousTreePaths, treePaths);
    if (updates.length > 0) model.batch(updates);
  }, [ready, entryKinds, model, treePaths]);

  useEffect(() => {
    if (expandAll && !query.trim()) setAllDirectoriesExpanded(model, directoryPaths, true);
  }, [directoryPaths, expandAll, model, query]);

  useEffect(() => {
    // An unloaded entry has no row to reveal yet; folders do, and chat links can
    // point at them.
    const selectedKind = selectedPath ? (entryKinds.get(selectedPath) ?? null) : null;
    // Directory rows are registered with a trailing slash (see fileTreePath).
    const selectedItem =
      selectedPath && selectedKind
        ? model.getItem(fileTreePath({ path: selectedPath, kind: selectedKind }))
        : null;
    // Entry refreshes rebuild treePaths while the same preview stays open.
    // Replaying a handled reveal would close an active tree search and steal focus.
    // A selection that originated inside the tree (clicking a row, possibly
    // in an active tree search) is already visible; re-revealing it would
    // close the search and clobber the user's context. Only sync external
    // opens (file picker, content search, chat links).
    const intent = resolveFileTreeRevealIntent({
      selectedPath,
      selectedKind,
      revealId: selectedPathRevealId,
      handledReveal: handledRevealRef.current,
      selectedItemPresent: Boolean(selectedItem),
      treeSelectedPaths: selectedItem ? model.getSelectedPaths() : [],
      treeSelectionPath: treeSelectionPathRef.current,
    });
    if (intent.kind === "reset") {
      handledRevealRef.current = null;
      return;
    }
    if (intent.kind === "none") return;
    treeSelectionPathRef.current = null;
    handledRevealRef.current = intent.request;
    if (intent.kind === "acknowledge" || !selectedItem) return;

    syncingSelectionRef.current = true;
    setQuery("");
    model.closeSearch();
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }

    // Directory rows are registered with a trailing slash (see fileTreePath), so
    // ancestor lookups must use the same form to expand them.
    for (const ancestorPath of intent.ancestorPaths) {
      const item = model.getItem(`${ancestorPath}/`) ?? model.getItem(ancestorPath);
      if (item && "expand" in item) item.expand();
    }

    if ("expand" in selectedItem) selectedItem.expand();
    selectedItem.select();
    model.scrollToPath(intent.treePath, {
      focus: true,
      offset: "center",
    });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [entryKinds, model, selectedPath, selectedPathRevealId]);

  // Tag tree drags with the composer mention payload. The row is read from
  // the composed event path (the tree's shadow root is open), so this does
  // not depend on running after the tree's own dragstart handler; the drag
  // data store is writable for every dragstart listener in the dispatch.
  // The capture phase runs before the tree's own dragstart handler selects
  // the dragged row, so the drag flag is up before that selection emits.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    treeModelRef.current = model;
  }, [model]);
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const handleDragStart = (event: DragEvent) => dragMention.handleDragStart(event);
    const handleDragEnd = () => dragMention.handleDragEnd();
    panel.addEventListener("dragstart", handleDragStart, true);
    panel.addEventListener("dragend", handleDragEnd);
    return () => {
      panel.removeEventListener("dragstart", handleDragStart, true);
      panel.removeEventListener("dragend", handleDragEnd);
    };
  }, [dragMention]);

  const { toggleAll } = chrome;
  return (
    <div
      ref={panelRef}
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-1 in-data-[preview-panel-mode=inline]:h-9 in-data-[preview-panel-mode=inline]:min-h-9 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <RefreshFilesButton model={chrome.refresh} onRefresh={handleRefresh} />
        <FileSearchField
          model={chrome.search}
          value={search.value}
          onValueChange={handleSearchValueChange}
          onClose={closeSearch}
        />
        {toggleAll ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={toggleAll.label}
                  onClick={() => toggleAllDirectories(toggleAll.nextExpanded)}
                />
              }
            >
              {toggleAll.icon === "chevrons-down-up" ? (
                <ChevronsDownUpIcon className="size-3.5" />
              ) : (
                <ChevronsUpDownIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup>{toggleAll.label}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {chrome.errorText !== null ? (
        <button
          type="button"
          onClick={handleRefresh}
          className="p-4 text-left text-xs leading-relaxed text-destructive"
        >
          {chrome.errorText}
        </button>
      ) : null}
      {chrome.truncatedText !== null ? (
        <div className="px-3 py-1 text-xs text-muted-foreground">{chrome.truncatedText}</div>
      ) : null}
      {chrome.loadingText !== null && (
        <div role="status" className="px-3 py-1 text-xs text-muted-foreground">
          {chrome.loadingText}
        </div>
      )}
      <FileTree
        model={model}
        aria-label={chrome.treeAriaLabel}
        className="min-h-0 flex-1 overflow-hidden"
        style={pierreTreeStyle(resolvedTheme)}
      />
    </div>
  );
}
