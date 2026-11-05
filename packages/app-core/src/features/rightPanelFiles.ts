import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { executeAtomQuery, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  type ContextMenuItem,
  type EnvironmentId,
  ProjectReadFileError,
  type ProjectEntry,
  type ProjectReadFileResult,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { filePreviewDelimiter, parseDelimitedPreview } from "@t3tools/shared/delimitedPreview";
import { updatePendingFileSurfaceIds } from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  isComposerTextInsertionBlocked,
  resolveComposerTextInsertion,
} from "@t3tools/web/src/components/chat/composerTriggers.logic.ts";
import {
  FILE_TREE_MENTION_MENU_ITEMS,
  FILE_TREE_PATH_SEARCH_LIMIT,
  FILE_TREE_PATH_SEARCH_MAX_QUERY_LENGTH,
  type FileTreeChromeModel,
  type FileTreeRevealRequest,
  buildFileTreeMentionToast,
  buildFileTreeModel,
  collectReachableDirectoryPaths,
  directoryLoadErrorMessage,
  fileTreeAncestorDirectories,
  flattenLoadedDirectories,
  resolveFileTreeContextMenuIntent,
  resolveFileTreeRevealIntent,
  resolveFileTreeRowActivation,
  selectDirectChildEntries,
} from "@t3tools/web/src/components/files/FileBrowserPanel.logic.ts";
import {
  type BreadcrumbMenuModel,
  buildBreadcrumbMenuModel,
} from "@t3tools/web/src/components/files/FileBreadcrumbs.logic.ts";
import { fileBreadcrumbs } from "@t3tools/web/src/components/files/filePath.ts";
import { buildFilePreviewModel } from "@t3tools/web/src/components/files/filePreviewMode.ts";
import {
  FILE_SAVE_DEBOUNCE_MS,
  FileSaveCoordinator,
} from "@t3tools/web/src/components/files/fileSaveCoordinator.ts";
import {
  confirmOptimisticProjectFile,
  writeOptimisticProjectFile,
} from "@t3tools/web/src/components/files/projectFileOptimistic.logic.ts";
import {
  buildFileContextMenuItems,
  type FileContextMenuAction,
  type FileContextMenuTarget,
  resolveFileContextMenuAbsolutePath,
  resolveFileContextMenuActivation,
  resolveFileContextMenuCapabilities,
} from "@t3tools/web/src/fileContextMenu.logic.ts";
import { workspaceMutationRefreshToken } from "@t3tools/web/src/hooks/useWorkspaceMutationRefresh.ts";
import { getLocalStorageItem, setLocalStorageItem } from "@t3tools/web/src/lib/localStorageItem.ts";
import { resolveSyntaxLanguage } from "@t3tools/web/src/lib/syntaxHighlighting.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { PROJECT_PATH_SEARCH_DEBOUNCE_MS } from "@t3tools/web/src/state/pathSearch.logic.ts";
import { resolvePathLinkTarget } from "@t3tools/web/src/terminal-links.ts";
import { resolveRemoteOpenResolution } from "@t3tools/web/src/remoteOpen.logic.ts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { buildMarkdownDocument } from "../markdownDocument.ts";
import { type PierreIconView, pierreTreeIconView, resolvePierreFileIcon } from "../pierreIcon.ts";
import { makeRouteRightPanelStateAtom, pendingFileSurfaceIdsAtom } from "../rightPanelState.ts";
import {
  type SyntaxLine,
  highlightLinesSync,
  syntaxHighlighterRevisionAtom,
} from "../syntaxHighlight.ts";
import type { MarkdownDocView } from "../views/markdown.ts";
import type { MediaVideoView } from "../views/media.ts";
import { assetUrlState, mediaVideoView } from "./mediaViewer.ts";
import { makeWorkspaceMutationIdAtom } from "../workspaceMutation.ts";

const FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen";
const RENDER_MARKDOWN_STORAGE_KEY = "t3code.renderMarkdown";
const RENDER_BROWSER_FILE_STORAGE_KEY = "t3code.renderBrowserFile";
const RENDER_TABLE_STORAGE_KEY = "t3code.renderTable";
const MAX_DIRECTORY_LOADS = 4;
const UNAVAILABLE = "Files is not available in the native app yet.";

export type FilesTreeRowView = {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly depth: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly ignored: boolean;
  readonly icon: PierreIconView | null;
};

export type FilesExplorerView = {
  readonly layout: "full" | "aside";
  readonly query: string;
  readonly chrome: FileTreeChromeModel;
  readonly rows: ReadonlyArray<FilesTreeRowView>;
  readonly scrollRequest: { readonly path: string; readonly id: number } | null;
};

export type FilesCrumbView = {
  readonly label: string;
  readonly path: string;
  readonly kind: "project" | "directory" | "file";
  readonly tooltip: string;
  readonly browsable: boolean;
  readonly open: boolean;
};

export type FilesCrumbMenuItemView = {
  readonly path: string;
  readonly label: string;
  readonly kind: "file" | "directory";
  readonly current: boolean;
  readonly ignored: boolean;
  readonly icon: PierreIconView | null;
};

export type FilesCrumbMenuView = {
  readonly crumbPath: string;
  readonly back: { readonly path: string; readonly label: string } | null;
  readonly content:
    | { readonly kind: "loading"; readonly label: string }
    | { readonly kind: "retry"; readonly label: string; readonly refreshing: boolean }
    | { readonly kind: "notice"; readonly label: string }
    | { readonly kind: "items"; readonly items: ReadonlyArray<FilesCrumbMenuItemView> };
  readonly refreshFailed: { readonly label: string; readonly refreshing: boolean } | null;
  readonly truncatedNotice: string | null;
};

export type FilesHeaderActionView = {
  readonly id: "rendered" | "word-wrap" | "explorer";
  readonly label: string;
  readonly pressed: boolean;
  readonly icon: "code" | "table" | "eye" | "wrap-text" | "folder-tree";
};

export type FilesHeaderView = {
  readonly crumbs: ReadonlyArray<FilesCrumbView>;
  readonly crumbMenu: FilesCrumbMenuView | null;
  readonly openInPath: string | null;
  readonly actions: ReadonlyArray<FilesHeaderActionView>;
};

export type FilesBodyView =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unsupported"; readonly message: string }
  | {
      readonly kind: "image";
      readonly src: string | null;
      readonly failed: boolean;
      readonly alt: string;
    }
  | { readonly kind: "video"; readonly video: MediaVideoView }
  | { readonly kind: "markdown"; readonly document: MarkdownDocView }
  | {
      readonly kind: "table";
      readonly label: string;
      readonly header: ReadonlyArray<string> | null;
      readonly rows: ReadonlyArray<ReadonlyArray<string>>;
      readonly truncatedNotice: string | null;
    }
  | { readonly kind: "text" };

export type RightPanelFilesView = {
  readonly key: string;
  readonly header: FilesHeaderView | null;
  readonly notice: string | null;
  readonly previewVisible: boolean;
  readonly body: FilesBodyView;
  readonly explorer: FilesExplorerView | null;
};

export type RightPanelFilesSourceView = {
  readonly key: string;
  readonly contents: string;
  readonly editable: boolean;
  readonly wordWrap: boolean;
  readonly revision: number;
  readonly lines: ReadonlyArray<SyntaxLine> | null;
  readonly reveal: { readonly line: number; readonly requestId: number } | null;
};

type FilesTarget = {
  readonly route: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly requestedPath: string | null;
  readonly attachmentOpen: boolean;
  readonly revealLine: number | null;
  readonly revealRequestId: number;
};

type TreeState = {
  readonly key: string;
  readonly directories: ReadonlyMap<string, ReadonlyArray<ProjectEntry>>;
  readonly loading: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, string>;
  readonly expanded: ReadonlySet<string>;
  readonly expandAll: boolean;
  readonly selectedPath: string | null;
  readonly query: string;
  readonly searchedQuery: string;
  readonly handledReveal: FileTreeRevealRequest | null;
  readonly treeSelectionPath: string | null;
  readonly scrollRequest: { readonly path: string; readonly id: number } | null;
};

type CrumbMenuState = {
  readonly key: string;
  readonly rootPath: string;
  readonly directoryPath: string;
};

type HandledReveal = { readonly path: string; readonly requestId: number };

const PathParams = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));
const OpenFileParams = Schema.decodeUnknownSync(
  Schema.Struct({ path: Schema.String, line: Schema.optional(Schema.Number) }),
);
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const ToggleAllParams = Schema.decodeUnknownSync(Schema.Struct({ expanded: Schema.Boolean }));
const HeaderActionParams = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.Literals(["rendered", "word-wrap", "explorer"]) }),
);
const CrumbMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ path: Schema.NullOr(Schema.String) }),
);
const ContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ path: Schema.String, x: Schema.Number, y: Schema.Number }),
);
const ChangeParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    revision: Schema.Number,
    contents: Schema.String,
  }),
);

const isProjectReadFileError = Schema.is(ProjectReadFileError);

function readBoolean(key: string, fallback: boolean): boolean {
  try {
    return getLocalStorageItem(key, Schema.Boolean) ?? fallback;
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean): void {
  try {
    setLocalStorageItem(key, value, Schema.Boolean);
  } catch (error) {
    console.error(error);
  }
}

function emptyTreeState(key: string): TreeState {
  return {
    key,
    directories: new Map(),
    loading: new Set(),
    errors: new Map(),
    expanded: new Set(),
    expandAll: false,
    selectedPath: null,
    query: "",
    searchedQuery: "",
    handledReveal: null,
    treeSelectionPath: null,
    scrollRequest: null,
  };
}

function normalizeSearchQuery(query: string): string {
  return query.slice(0, FILE_TREE_PATH_SEARCH_MAX_QUERY_LENGTH).trim();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Workspace query failed.";
}

function failureCause<A, E>(result: AsyncResult.AsyncResult<A, E>): unknown {
  return result._tag === "Failure" ? Cause.squash(result.cause) : null;
}

function directoryEntries(tree: TreeState): ReadonlyArray<ProjectEntry> {
  return flattenLoadedDirectories(tree.directories);
}

function crumbMenuView(menu: BreadcrumbMenuModel, crumbPath: string): FilesCrumbMenuView {
  const content: FilesCrumbMenuView["content"] =
    menu.content.kind === "items"
      ? {
          kind: "items",
          items: menu.content.items.map((item) => ({
            path: item.path,
            label: item.label,
            kind: item.kind,
            current: item.current,
            ignored: item.ignored === true,
            icon: item.kind === "file" ? resolvePierreFileIcon(item.path) : null,
          })),
        }
      : menu.content;
  return {
    crumbPath,
    back: menu.back,
    content,
    refreshFailed: menu.refreshFailed,
    truncatedNotice: menu.truncatedNotice,
  };
}

export function rightPanelFilesFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const routePanelAtom = makeRouteRightPanelStateAtom(context.routeAtom);
  const mutationIdAtom = makeWorkspaceMutationIdAtom(context);

  const explorerOpenAtom = Atom.make(readBoolean(FILE_EXPLORER_STORAGE_KEY, true)).pipe(
    Atom.keepAlive,
  );
  const renderMarkdownAtom = Atom.make(readBoolean(RENDER_MARKDOWN_STORAGE_KEY, false)).pipe(
    Atom.keepAlive,
  );
  const renderBrowserFileAtom = Atom.make(readBoolean(RENDER_BROWSER_FILE_STORAGE_KEY, true)).pipe(
    Atom.keepAlive,
  );
  const renderTableAtom = Atom.make(readBoolean(RENDER_TABLE_STORAGE_KEY, true)).pipe(
    Atom.keepAlive,
  );
  const handledRevealAtom = Atom.make<HandledReveal | null>(null).pipe(Atom.keepAlive);
  const treeAtom = Atom.make<TreeState | null>(null).pipe(Atom.keepAlive);
  const crumbMenuAtom = Atom.make<CrumbMenuState | null>(null).pipe(Atom.keepAlive);
  const editRevisionsAtom = Atom.make<ReadonlyMap<string, number>>(new Map()).pipe(Atom.keepAlive);

  const targetAtom = Atom.make((get): FilesTarget | null => {
    const panel = get(routePanelAtom);
    if (panel === null || !panel.state.isOpen) return null;
    const surface = panel.activeSurface;
    if (surface === null || (surface.kind !== "files" && surface.kind !== "file")) return null;
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const attachmentOpen = surface.kind === "file" && surface.attachment !== undefined;
    const cwd = input.thread.worktreePath ?? input.project?.workspaceRoot ?? null;
    if (cwd === null || (input.project === undefined && !attachmentOpen)) return null;
    const environmentId = input.thread.environmentId;
    return {
      route: panel.route,
      environmentId,
      cwd,
      projectKey: `${environmentId}:${cwd}`,
      projectName: input.project?.title ?? "",
      requestedPath: surface.kind === "file" ? surface.relativePath : null,
      attachmentOpen,
      revealLine: surface.kind === "file" ? surface.revealLine : null,
      revealRequestId: surface.kind === "file" ? surface.revealRequestId : 0,
    };
  });

  const fileQueryAtom = (target: FilesTarget, relativePath: string) =>
    state.projectEnvironment.readFile({
      environmentId: target.environmentId,
      input: { cwd: target.cwd, relativePath },
    });
  const optimisticAtom = (target: FilesTarget, relativePath: string) =>
    state.projectEnvironment.optimisticFile({
      environmentId: target.environmentId,
      cwd: target.cwd,
      relativePath,
    });

  type FileRead = {
    readonly data: ProjectReadFileResult | null;
    readonly error: string | null;
    readonly isNotFile: boolean;
  };

  const readFileState = (
    get: Atom.AtomContext,
    target: FilesTarget,
    relativePath: string | null,
  ): FileRead => {
    if (target.attachmentOpen || relativePath === null) {
      return { data: null, error: null, isNotFile: false };
    }
    const result = get(fileQueryAtom(target, relativePath));
    const optimistic = get(optimisticAtom(target, relativePath));
    const cause = failureCause(result);
    return {
      data: optimistic?.data ?? Option.getOrNull(AsyncResult.value(result)),
      error: cause === null ? null : errorMessage(cause),
      isNotFile: isProjectReadFileError(cause) && cause.failure === "path_not_file",
    };
  };

  const previewAtom = Atom.make((get) => {
    const target = get(targetAtom);
    if (target === null) return null;
    const requested = target.requestedPath;
    const probe = buildFilePreviewModel({
      requestedPath: requested,
      cwd: target.cwd,
      attachmentOpen: target.attachmentOpen,
      explorerOpen: get(explorerOpenAtom),
      renderMarkdownPreferred: get(renderMarkdownAtom),
      renderBrowserFilePreferred: get(renderBrowserFileAtom),
      renderTablePreferred: get(renderTableAtom),
      revealLine: target.revealLine,
      revealRequestId: target.revealRequestId,
      handledReveal: get(handledRevealAtom),
      file: { data: null, error: null, isNotFile: false },
      previewSupported: false,
      tableDelimiter: null,
    });
    const file = readFileState(get, target, probe.readsFile ? probe.relativePath : null);
    const model = buildFilePreviewModel({
      requestedPath: requested,
      cwd: target.cwd,
      attachmentOpen: target.attachmentOpen,
      explorerOpen: get(explorerOpenAtom),
      renderMarkdownPreferred: get(renderMarkdownAtom),
      renderBrowserFilePreferred: get(renderBrowserFileAtom),
      renderTablePreferred: get(renderTableAtom),
      revealLine: target.revealLine,
      revealRequestId: target.revealRequestId,
      handledReveal: get(handledRevealAtom),
      file,
      previewSupported: false,
      tableDelimiter:
        probe.relativePath === null ? null : filePreviewDelimiter({ name: probe.relativePath }),
    });
    return { target, model, file };
  });

  let session: {
    readonly key: string;
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
    active: boolean;
    running: number;
    readonly waiting: Array<() => void>;
    readonly requests: Map<string, Promise<void>>;
    readonly loaded: Set<string>;
    readonly requested: Set<string>;
  } | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let nextScrollId = 1;

  const updateTree = (update: (tree: TreeState) => TreeState) => {
    const current = registry.get(treeAtom);
    if (current === null) return;
    const next = update(current);
    if (next !== current) registry.set(treeAtom, next);
  };

  const load = (directoryPath: string, refresh = false): Promise<void> => {
    const current = session;
    if (current === null) return Promise.resolve();
    const existing = current.requests.get(directoryPath);
    if (existing) return refresh ? existing.then(() => load(directoryPath, true)) : existing;
    if (!refresh && current.loaded.has(directoryPath)) return Promise.resolve();
    current.loaded.add(directoryPath);
    current.requested.add(directoryPath);
    const atom = state.projectEnvironment.listEntries({
      environmentId: current.environmentId,
      input: { cwd: current.cwd, directoryPath },
    });
    updateTree((tree) => ({ ...tree, loading: new Set(tree.loading).add(directoryPath) }));
    const request = (async () => {
      if (current.running >= MAX_DIRECTORY_LOADS) {
        await new Promise<void>((resolve) => current.waiting.push(resolve));
      } else {
        current.running++;
      }
      try {
        if (!current.active) return undefined;
        return await executeAtomQuery(registry, atom, {
          refresh: true,
          reportFailure: false,
          reportDefect: false,
        });
      } finally {
        const next = current.waiting.shift();
        if (next) next();
        else current.running--;
      }
    })()
      .then((result) => {
        if (!current.active || !result) return;
        if (result._tag === "Success") {
          updateTree((tree) => {
            const errors = new Map(tree.errors);
            errors.delete(directoryPath);
            return {
              ...tree,
              directories: new Map(tree.directories).set(
                directoryPath,
                selectDirectChildEntries(result.value.entries, directoryPath),
              ),
              errors,
            };
          });
        } else {
          current.loaded.delete(directoryPath);
          const cause = Cause.squash(result.cause);
          updateTree((tree) => ({
            ...tree,
            errors: new Map(tree.errors).set(directoryPath, directoryLoadErrorMessage(cause)),
          }));
        }
      })
      .finally(() => {
        current.requests.delete(directoryPath);
        if (!current.active) return;
        updateTree((tree) => {
          const loading = new Set(tree.loading);
          loading.delete(directoryPath);
          return { ...tree, loading };
        });
        loadExpanded();
        reconcileReveal();
      });
    current.requests.set(directoryPath, request);
    return request;
  };

  const effectiveExpanded = (tree: TreeState): ReadonlySet<string> => {
    if (!tree.expandAll) return tree.expanded;
    const expanded = new Set(tree.expanded);
    for (const entry of directoryEntries(tree)) {
      if (entry.kind === "directory") expanded.add(entry.path);
    }
    return expanded;
  };

  const loadExpanded = () => {
    const tree = registry.get(treeAtom);
    if (tree === null || session === null || tree.query.trim().length > 0) return;
    const reachable = collectReachableDirectoryPaths(directoryEntries(tree));
    for (const path of effectiveExpanded(tree)) {
      if (reachable.has(path) && !session.loaded.has(path)) void load(path);
    }
  };

  const refreshTree = () => {
    const current = session;
    const tree = registry.get(treeAtom);
    if (current === null || tree === null) return;
    const reachable = collectReachableDirectoryPaths(directoryEntries(tree));
    const paths = [...current.requested].filter((path) => reachable.has(path));
    let next = 0;
    const worker = async () => {
      while (next < paths.length && current.active) {
        const path = paths[next++];
        if (path !== undefined) await load(path, true);
      }
    };
    for (let index = 0; index < Math.min(MAX_DIRECTORY_LOADS, paths.length); index++) {
      void worker();
    }
  };

  const searchAtom = (tree: TreeState) =>
    session === null
      ? null
      : state.projectEnvironment.searchEntries({
          environmentId: session.environmentId,
          input: {
            cwd: session.cwd,
            query: tree.searchedQuery,
            limit: FILE_TREE_PATH_SEARCH_LIMIT,
          },
        });

  const refreshSearch = () => {
    const tree = registry.get(treeAtom);
    if (tree === null || tree.searchedQuery.length === 0) return;
    const atom = searchAtom(tree);
    if (atom !== null) registry.refresh(atom);
  };

  const explorerMountAtom = Atom.make((get) => {
    const preview = get(previewAtom);
    if (preview === null || !preview.model.showExplorer) return null;
    return {
      key: preview.target.projectKey,
      environmentId: preview.target.environmentId,
      cwd: preview.target.cwd,
    };
  });

  const selectedPathAtom = Atom.make((get) => {
    const preview = get(previewAtom);
    if (preview === null) return null;
    return {
      key: preview.target.projectKey,
      path: preview.model.relativePath,
      revealId: preview.target.revealRequestId,
    };
  });

  let ancestorsLoadedFor: string | null = null;
  const reconcileReveal = () => {
    const tree = registry.get(treeAtom);
    const selection = registry.get(selectedPathAtom);
    if (tree === null || selection === null || selection.key !== tree.key) return;
    const selectedPath = selection.path;
    const ancestorKey = selectedPath === null ? null : `${tree.key}\u0000${selectedPath}`;
    if (selectedPath !== null && ancestorKey !== ancestorsLoadedFor) {
      ancestorsLoadedFor = ancestorKey;
      const ancestors = fileTreeAncestorDirectories(selectedPath);
      void (async () => {
        for (const directoryPath of ancestors) {
          if (ancestorsLoadedFor !== ancestorKey) break;
          await load(directoryPath);
        }
      })();
    }
    const entries = directoryEntries(tree);
    const selectedKind =
      selectedPath === null
        ? null
        : (entries.find((entry) => entry.path === selectedPath)?.kind ?? null);
    const intent = resolveFileTreeRevealIntent({
      selectedPath,
      selectedKind,
      revealId: selection.revealId,
      handledReveal: tree.handledReveal,
      selectedItemPresent: selectedKind !== null,
      treeSelectedPaths: tree.selectedPath === null ? [] : [tree.selectedPath],
      treeSelectionPath: tree.treeSelectionPath,
    });
    switch (intent.kind) {
      case "reset":
        if (tree.handledReveal !== null)
          updateTree((current) => ({ ...current, handledReveal: null }));
        return;
      case "none":
        return;
      case "acknowledge":
        updateTree((current) => ({
          ...current,
          handledReveal: intent.request,
          treeSelectionPath: null,
        }));
        return;
      case "reveal": {
        clearTimeout(searchTimer);
        searchTimer = undefined;
        updateTree((current) => {
          const expanded = new Set(current.expanded);
          for (const ancestor of intent.ancestorPaths) expanded.add(ancestor);
          if (selectedKind === "directory") expanded.add(intent.request.path);
          return {
            ...current,
            query: "",
            searchedQuery: "",
            expanded,
            selectedPath: intent.request.path,
            handledReveal: intent.request,
            treeSelectionPath: null,
            scrollRequest: { path: intent.request.path, id: nextScrollId++ },
          };
        });
        loadExpanded();
        return;
      }
    }
  };

  const treeMutationAtom = Atom.make((get) => {
    const tree = get(treeAtom);
    if (tree === null) return null;
    return workspaceMutationRefreshToken(`files:${tree.key}`, get(mutationIdAtom));
  });
  const fileMutationAtom = Atom.make((get) => {
    const preview = get(previewAtom);
    if (preview === null || !preview.model.refreshesOnMutation) return null;
    const relativePath = preview.model.relativePath;
    if (relativePath === null) return null;
    const pending =
      get(pendingFileSurfaceIdsAtom).get(preview.target.projectKey)?.has(`file:${relativePath}`) ??
      false;
    if (pending) return null;
    return workspaceMutationRefreshToken(
      `file:${preview.target.environmentId}:${preview.target.cwd}:${relativePath}`,
      get(mutationIdAtom),
    );
  });
  const refreshSelectedFile = () => {
    const preview = registry.get(previewAtom);
    if (preview === null || !preview.model.readsFile || preview.model.relativePath === null) return;
    registry.refresh(fileQueryAtom(preview.target, preview.model.relativePath));
  };

  const explorerAtom = Atom.make((get): FilesExplorerView | null => {
    const preview = get(previewAtom);
    const tree = get(treeAtom);
    if (preview === null || tree === null || !preview.model.showExplorer) return null;
    const searchQueryAtom = tree.searchedQuery.length > 0 ? searchAtom(tree) : null;
    const searchResult = searchQueryAtom === null ? null : get(searchQueryAtom);
    const searchCause = searchResult === null ? null : failureCause(searchResult);
    const searchData =
      searchResult === null ? null : Option.getOrNull(AsyncResult.value(searchResult));
    const normalized = normalizeSearchQuery(tree.query);
    const searchPending =
      normalized !== tree.searchedQuery || (searchResult !== null && searchResult.waiting);
    const model = buildFileTreeModel({
      projectName: preview.target.projectName,
      loadedDirectories: [...tree.directories].map(([path, entries]) => ({ path, entries })),
      loadingDirectoryPaths: [...tree.loading],
      directoryErrors: [...tree.errors].map(([path, message]) => ({ path, message })),
      expandedPaths: [...tree.expanded],
      expandAll: tree.expandAll,
      selectedPath: tree.selectedPath,
      query: tree.query,
      pathSearch: {
        entries: searchData?.entries ?? [],
        isPending: normalized.length > 0 && searchPending,
        error: searchCause === null ? null : errorMessage(searchCause),
        truncated: searchData?.truncated ?? false,
      },
    });
    return {
      layout: preview.model.previewPath === null ? "full" : "aside",
      query: tree.query,
      chrome: model.chrome,
      rows: model.rows.map((row) => ({
        path: row.path,
        name: row.name,
        kind: row.kind,
        depth: row.depth,
        expanded: row.expanded,
        selected: row.selected,
        ignored: row.ignored,
        icon:
          row.kind === "directory"
            ? null
            : pierreTreeIconView(row.icon, row.iconToken ?? undefined),
      })),
      scrollRequest: tree.scrollRequest,
    };
  });

  const crumbMenuViewAtom = Atom.make((get): FilesCrumbMenuView | null => {
    const preview = get(previewAtom);
    const menu = get(crumbMenuAtom);
    if (preview === null || menu === null || preview.model.relativePath === null) return null;
    if (menu.key !== `${preview.target.projectKey}\u0000${preview.model.relativePath}`) return null;
    const result = get(
      state.projectEnvironment.listEntries({
        environmentId: preview.target.environmentId,
        input: { cwd: preview.target.cwd, directoryPath: menu.directoryPath },
      }),
    );
    const cause = failureCause(result);
    return crumbMenuView(
      buildBreadcrumbMenuModel({
        directoryPath: menu.directoryPath,
        rootPath: menu.rootPath,
        currentFilePath: preview.model.relativePath,
        projectName: preview.target.projectName,
        entries: {
          data: Option.getOrNull(AsyncResult.value(result)),
          isPending: result.waiting,
          error: cause === null ? null : errorMessage(cause),
        },
      }),
      menu.rootPath,
    );
  });

  const headerAtom = Atom.make((get): FilesHeaderView | null => {
    const preview = get(previewAtom);
    if (preview === null) return null;
    const { model, target } = preview;
    const relativePath = model.relativePath;
    if (relativePath === null || target.attachmentOpen) return null;
    const menu = get(crumbMenuViewAtom);
    const hostPath = model.isHostFile;
    const actions: FilesHeaderActionView[] = [];
    if (
      model.canToggleRendered &&
      model.renderedToggleLabel !== null &&
      model.renderedToggleIcon !== null
    ) {
      actions.push({
        id: "rendered",
        label: model.renderedToggleLabel,
        pressed: model.rendered,
        icon: model.renderedToggleIcon,
      });
    }
    const wordWrap = get(context.clientSettingsAtom).wordWrap;
    if (model.showsRawText) {
      actions.push({
        id: "word-wrap",
        label: wordWrap ? "Disable word wrap" : "Enable word wrap",
        pressed: wordWrap,
        icon: "wrap-text",
      });
    }
    if (model.canToggleExplorer) {
      actions.push({
        id: "explorer",
        label: model.explorerToggleLabel,
        pressed: get(explorerOpenAtom),
        icon: "folder-tree",
      });
    }
    return {
      crumbs: fileBreadcrumbs(target.projectName, relativePath).map((crumb) => ({
        label: crumb.label,
        path: crumb.path,
        kind: crumb.kind,
        tooltip: crumb.kind === "file" ? crumb.path : crumb.path || target.projectName,
        browsable: crumb.kind !== "file" && !hostPath,
        open: menu !== null && crumb.kind !== "file" && menu.crumbPath === crumb.path,
      })),
      crumbMenu: menu,
      openInPath:
        target.environmentId === get(state.primaryEnvironmentIdAtom) ||
        resolveRemoteOpenResolution(
          get(state.environmentPresentations.presentationsAtom).get(target.environmentId) ?? null,
          true,
        ).state.mode !== "local-exec"
          ? resolvePathLinkTarget(relativePath, target.cwd)
          : null,
      actions,
    };
  });

  const bodyAtom = Atom.make((get): FilesBodyView => {
    const preview = get(previewAtom);
    if (preview === null) return { kind: "none" };
    const { model, file, target } = preview;
    const body = model.body;
    switch (body.kind) {
      case "none":
        return { kind: "none" };
      case "attachment":
        return {
          kind: "unsupported",
          message: "Attachment previews are not available in the native app yet.",
        };
      case "video":
      case "image": {
        const relativePath = model.relativePath;
        const name = relativePath?.split("/").at(-1) ?? "file";
        const absolutePath =
          relativePath === null ? null : resolvePathLinkTarget(relativePath, target.cwd);
        if (absolutePath === null) {
          return body.kind === "image"
            ? { kind: "image", src: null, failed: false, alt: name }
            : {
                kind: "video",
                video: mediaVideoView({
                  label: name,
                  src: null,
                  sourceFailed: false,
                  originalUrl: null,
                  retry: null,
                }),
              };
        }
        const resource =
          body.kind === "image"
            ? {
                _tag: "workspace-file" as const,
                threadId: target.route.threadId,
                path: absolutePath,
              }
            : { _tag: "media-file" as const, threadId: target.route.threadId, path: absolutePath };
        const asset = { environmentId: target.environmentId, resource };
        const url = assetUrlState(get, state, asset);
        const revision = get(mutationIdAtom);
        const suffix =
          revision === null
            ? ""
            : `${url._tag === "Success" && url.url.includes("?") ? "&" : "?"}workspace-revision=${encodeURIComponent(revision)}`;
        const src = url._tag === "Success" ? `${url.url}${suffix}` : null;
        return body.kind === "image"
          ? { kind: "image", src, failed: url._tag === "Failure", alt: name }
          : {
              kind: "video",
              video: mediaVideoView({
                label: name,
                src,
                sourceFailed: url._tag === "Failure",
                originalUrl: null,
                retry: asset,
              }),
            };
      }
      case "audio":
        return {
          kind: "unsupported",
          message: "Audio previews are not available in the native app yet.",
        };
      case "browser":
        return {
          kind: "unsupported",
          message: model.isPdf
            ? "PDF previews are not available in the native app yet."
            : "Rendered HTML previews are not available in the native app yet.",
        };
      case "error":
        return { kind: "error", message: body.message };
      case "loading":
        return { kind: "loading" };
      case "markdown":
        return {
          kind: "markdown",
          document: buildMarkdownDocument(file.data?.contents ?? "", {
            cwd: target.cwd,
            lineBreaks: false,
            streaming: false,
            wordWrap: get(context.clientSettingsAtom).wordWrap,
            canRunShellCommands: false,
          }),
        };
      case "table": {
        const table = parseDelimitedPreview(file.data?.contents ?? "", body.delimiter);
        const [header, ...rows] = table.rows;
        return {
          kind: "table",
          label: model.relativePath ?? "",
          header: header ?? null,
          rows,
          truncatedNotice: table.truncated
            ? "Table limited to the first 100 rows and 30 columns. Switch to source for the rest."
            : null,
        };
      }
      case "source":
      case "editor":
        return { kind: "text" };
    }
  });

  const viewAtom = Atom.make((get): RightPanelFilesView | null => {
    const preview = get(previewAtom);
    if (preview === null) return null;
    return {
      key: preview.target.projectKey,
      header: get(headerAtom),
      notice: preview.model.truncatedNotice,
      previewVisible: preview.model.previewPath !== null,
      body: get(bodyAtom),
      explorer: get(explorerAtom),
    };
  });

  const sourceKey = (target: FilesTarget, relativePath: string) =>
    `${target.projectKey}\u0000${relativePath}`;

  const sourceAtom = Atom.make((get): RightPanelFilesSourceView | null => {
    const preview = get(previewAtom);
    if (preview === null) return null;
    const { model, file, target } = preview;
    const relativePath = model.relativePath;
    if (relativePath === null || file.data === null) return null;
    if (model.body.kind !== "source" && model.body.kind !== "editor") return null;
    const contents = file.data.contents;
    get(syntaxHighlighterRevisionAtom);
    const key = sourceKey(target, relativePath);
    const lineCount = contents.split("\n").length;
    return {
      key,
      contents,
      editable: model.body.kind === "editor",
      wordWrap: get(context.clientSettingsAtom).wordWrap,
      revision: get(editRevisionsAtom).get(key) ?? 0,
      lines: highlightLinesSync(contents.split("\n"), resolveSyntaxLanguage(relativePath)),
      reveal:
        target.revealLine === null
          ? null
          : {
              line: Math.min(Math.max(1, target.revealLine), lineCount),
              requestId: target.revealRequestId,
            },
    };
  });

  const coordinators = new Map<string, FileSaveCoordinator>();
  const coordinatorFor = (target: FilesTarget, relativePath: string): FileSaveCoordinator => {
    const key = sourceKey(target, relativePath);
    const existing = coordinators.get(key);
    if (existing !== undefined) return existing;
    const atoms = {
      optimistic: optimisticAtom(target, relativePath),
      query: fileQueryAtom(target, relativePath),
    };
    const coordinator = new FileSaveCoordinator({
      debounceMs: FILE_SAVE_DEBOUNCE_MS,
      onPendingChange: (pending) =>
        registry.set(
          pendingFileSurfaceIdsAtom,
          updatePendingFileSurfaceIds(
            registry.get(pendingFileSurfaceIdsAtom),
            target.projectKey,
            relativePath,
            pending,
          ),
        ),
      persist: (contents) =>
        runAtomCommand(registry, state.projectEnvironment.writeFile, {
          environmentId: target.environmentId,
          input: { cwd: target.cwd, relativePath, contents },
        }),
      onConfirmed: (contents) => {
        confirmOptimisticProjectFile(registry, atoms, contents);
      },
    });
    coordinators.set(key, coordinator);
    return coordinator;
  };

  const currentPreview = () => {
    const preview = registry.get(previewAtom);
    if (preview === null) throw new Error(UNAVAILABLE);
    return preview;
  };

  const openFile = (path: string, line?: number) => {
    const { target } = currentPreview();
    useRightPanelStore.getState().openFile(target.route, path, line);
  };

  const setDirectoryExpanded = (path: string, expanded: boolean, clearExpandAll: boolean) => {
    updateTree((tree) => {
      const next = new Set(clearExpandAll ? effectiveExpanded(tree) : tree.expanded);
      if (expanded) next.add(path);
      else next.delete(path);
      return {
        ...tree,
        expanded: next,
        expandAll: clearExpandAll ? false : tree.expandAll,
        selectedPath: path,
        treeSelectionPath: null,
      };
    });
    if (expanded) void load(path);
  };

  const insertMention = (text: string) => {
    const input = registry.get(context.threadInputAtom);
    if (input === null) {
      context.addToast({
        layout: "plain",
        ...buildFileTreeMentionToast({ kind: "composer-unavailable" }),
      });
      return;
    }
    const prompt = input.draft?.prompt ?? "";
    const { approvals, userInputs } = derivePendingRequests(input.thread.activities);
    if (
      isComposerTextInsertionBlocked({
        text,
        isConnecting: false,
        approvalPending: approvals.length > 0,
        pendingUserInputCount: userInputs.length,
        projectSelectionRequired: false,
      })
    ) {
      context.addToast({
        layout: "plain",
        ...buildFileTreeMentionToast({ kind: "composer-rejected" }),
      });
      return;
    }
    const insertion = resolveComposerTextInsertion({
      prompt,
      cursor: prompt.length,
      text,
      ensureLeadingBoundary: true,
    });
    context.writePrompt(
      input.route,
      `${prompt.slice(0, insertion.rangeStart)}${insertion.replacement}${prompt.slice(insertion.rangeEnd)}`,
    );
  };

  registry.subscribe(
    explorerMountAtom,
    (mount) => {
      if (mount !== null && session !== null && session.key === mount.key) return;
      if (session !== null) session.active = false;
      session = null;
      clearTimeout(searchTimer);
      searchTimer = undefined;
      if (mount === null) {
        registry.set(treeAtom, null);
        return;
      }
      session = {
        key: mount.key,
        environmentId: mount.environmentId,
        cwd: mount.cwd,
        active: true,
        running: 0,
        waiting: [],
        requests: new Map(),
        loaded: new Set(),
        requested: new Set(),
      };
      registry.set(treeAtom, emptyTreeState(mount.key));
      void load("");
      reconcileReveal();
    },
    { immediate: true },
  );

  registry.subscribe(selectedPathAtom, () => reconcileReveal(), { immediate: true });

  let handledTreeToken: string | null = null;
  registry.subscribe(
    treeMutationAtom,
    (token) => {
      if (token === null || token === handledTreeToken) return;
      handledTreeToken = token;
      refreshTree();
      refreshSearch();
    },
    { immediate: true },
  );

  let handledFileToken: string | null = null;
  registry.subscribe(
    fileMutationAtom,
    (token) => {
      if (token === null || token === handledFileToken) return;
      handledFileToken = token;
      refreshSelectedFile();
    },
    { immediate: true },
  );

  return {
    views: { rightPanelFiles: viewAtom, rightPanelFilesSource: sourceAtom },
    actions: {
      rightPanelFilesActivateRow: async (params) => {
        const { path } = PathParams(params);
        const tree = registry.get(treeAtom);
        const explorer = registry.get(explorerAtom);
        const row = explorer?.rows.find((candidate) => candidate.path === path);
        if (tree === null || row === undefined) return null;
        const intent = resolveFileTreeRowActivation(row);
        if (intent.kind === "open-file") {
          updateTree((current) => ({
            ...current,
            selectedPath: intent.path,
            treeSelectionPath: intent.path,
          }));
          openFile(intent.path);
          return null;
        }
        setDirectoryExpanded(intent.path, intent.expanded, intent.clearExpandAll);
        return null;
      },
      rightPanelFilesToggleAll: async (params) => {
        const { expanded } = ToggleAllParams(params);
        updateTree((tree) => ({
          ...tree,
          expandAll: expanded,
          expanded: expanded
            ? new Set(
                directoryEntries(tree)
                  .filter((entry) => entry.kind === "directory")
                  .map((entry) => entry.path),
              )
            : new Set(),
        }));
        loadExpanded();
        return null;
      },
      rightPanelFilesSetQuery: async (params) => {
        const { query } = QueryParams(params);
        clearTimeout(searchTimer);
        searchTimer = undefined;
        if (query.trim().length === 0) {
          updateTree((tree) => ({ ...tree, query: "", searchedQuery: "" }));
          loadExpanded();
          return null;
        }
        updateTree((tree) => ({ ...tree, query }));
        const normalized = normalizeSearchQuery(query);
        searchTimer = setTimeout(() => {
          searchTimer = undefined;
          updateTree((tree) =>
            normalizeSearchQuery(tree.query) === normalized
              ? { ...tree, searchedQuery: normalized }
              : tree,
          );
        }, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
        return null;
      },
      rightPanelFilesRefresh: async () => {
        const preview = currentPreview();
        refreshTree();
        refreshSearch();
        if (preview.model.previewPath !== null && !preview.model.isMedia && !preview.model.isPdf) {
          refreshSelectedFile();
        }
        return null;
      },
      rightPanelFilesOpenFile: async (params) => {
        const { path, line } = OpenFileParams(params);
        openFile(path, line);
        return null;
      },
      rightPanelFilesHeaderAction: async (params) => {
        const { id } = HeaderActionParams(params);
        const { model, target } = currentPreview();
        switch (id) {
          case "rendered": {
            const pressed = !model.rendered;
            const atom = model.isMarkdown
              ? renderMarkdownAtom
              : model.renderedMode === "table"
                ? renderTableAtom
                : renderBrowserFileAtom;
            const key = model.isMarkdown
              ? RENDER_MARKDOWN_STORAGE_KEY
              : model.renderedMode === "table"
                ? RENDER_TABLE_STORAGE_KEY
                : RENDER_BROWSER_FILE_STORAGE_KEY;
            writeBoolean(key, pressed);
            registry.set(atom, pressed);
            registry.set(
              handledRevealAtom,
              pressed && model.relativePath !== null
                ? { path: model.relativePath, requestId: target.revealRequestId }
                : null,
            );
            return null;
          }
          case "word-wrap":
            await context.updateClientSettings((current) => ({
              ...current,
              wordWrap: !current.wordWrap,
            }));
            return null;
          case "explorer": {
            const next = !registry.get(explorerOpenAtom);
            writeBoolean(FILE_EXPLORER_STORAGE_KEY, next);
            registry.set(explorerOpenAtom, next);
            return null;
          }
        }
      },
      rightPanelFilesCrumbMenu: async (params) => {
        const { path } = CrumbMenuParams(params);
        const { model, target } = currentPreview();
        if (path === null || model.relativePath === null) {
          registry.set(crumbMenuAtom, null);
          return null;
        }
        registry.set(crumbMenuAtom, {
          key: `${target.projectKey}\u0000${model.relativePath}`,
          rootPath: path,
          directoryPath: path,
        });
        return null;
      },
      rightPanelFilesCrumbMenuNavigate: async (params) => {
        const { path } = PathParams(params);
        const menu = registry.get(crumbMenuAtom);
        if (menu !== null) registry.set(crumbMenuAtom, { ...menu, directoryPath: path });
        return null;
      },
      rightPanelFilesCrumbMenuRetry: async () => {
        const menu = registry.get(crumbMenuAtom);
        const { target } = currentPreview();
        if (menu === null) return null;
        registry.refresh(
          state.projectEnvironment.listEntries({
            environmentId: target.environmentId,
            input: { cwd: target.cwd, directoryPath: menu.directoryPath },
          }),
        );
        return null;
      },
      rightPanelFilesRowContextMenu: async (params) => {
        const { path, x, y } = ContextMenuParams(params);
        const { target } = currentPreview();
        const explorer = registry.get(explorerAtom);
        const row = explorer?.rows.find((candidate) => candidate.path === path);
        if (row === undefined) return null;
        const treePath = row.kind === "directory" ? `${row.path}/` : row.path;
        const serverConfig = registry.get(context.threadInputAtom)?.serverConfig ?? null;
        const capabilities = resolveFileContextMenuCapabilities(target.environmentId, serverConfig);
        const fileTarget: FileContextMenuTarget = {
          environmentId: target.environmentId,
          filePath: row.path,
          workspaceRoot: target.cwd,
        };
        const fileMenuItems = buildFileContextMenuItems({
          hasAbsolutePath: resolveFileContextMenuAbsolutePath(fileTarget) !== null,
          capabilities,
        });
        const clicked = await contextMenuService(context).show<string>(
          [...fileMenuItems, ...FILE_TREE_MENTION_MENU_ITEMS],
          { x, y },
        );
        const intent = resolveFileTreeContextMenuIntent({
          clicked,
          treePath,
          fileMenuItemIds: fileMenuItems.map((item) => item.id),
        });
        switch (intent.kind) {
          case "none":
            return null;
          case "file-action": {
            const action = findFileMenuAction(fileMenuItems, intent.action);
            if (action === null) return null;
            const activation = resolveFileContextMenuActivation({
              action,
              target: fileTarget,
              capabilities,
              environmentId: target.environmentId,
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
          }
          case "copy-mention":
            try {
              await clipboardService(context).writeText(intent.mention);
              context.addToast({
                layout: "plain",
                ...buildFileTreeMentionToast({
                  kind: "mention-copied",
                  relativePath: intent.relativePath,
                }),
              });
            } catch (error) {
              context.addToast({
                layout: "plain",
                ...buildFileTreeMentionToast({ kind: "mention-copy-failed", error }),
              });
            }
            return null;
          case "add-to-chat":
            insertMention(intent.text);
            return null;
        }
      },
      rightPanelFilesChange: async (params) => {
        const { key, revision, contents } = ChangeParams(params);
        const { model, target } = currentPreview();
        const relativePath = model.relativePath;
        if (relativePath === null || model.body.kind !== "editor") return null;
        if (sourceKey(target, relativePath) !== key) return null;
        registry.set(
          editRevisionsAtom,
          new Map(registry.get(editRevisionsAtom)).set(key, revision),
        );
        writeOptimisticProjectFile(
          registry,
          {
            optimistic: optimisticAtom(target, relativePath),
            query: fileQueryAtom(target, relativePath),
          },
          relativePath,
          contents,
        );
        coordinatorFor(target, relativePath).change(contents);
        return null;
      },
    },
  };
}

function findFileMenuAction(
  items: ReadonlyArray<ContextMenuItem<FileContextMenuAction>>,
  id: string,
): FileContextMenuAction | null {
  for (const item of items) {
    if (item.id === id) return item.id;
    const nested = item.children === undefined ? null : findFileMenuAction(item.children, id);
    if (nested !== null) return nested;
  }
  return null;
}
