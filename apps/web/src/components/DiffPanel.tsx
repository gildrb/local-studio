import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import type { FileDiffContentsLoader, FileDiffMetadata } from "@pierre/diffs";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  FolderTreeIcon,
  PilcrowIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCodeViewFileReveal } from "./diffs/useCodeViewFileReveal";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { useFileContextMenuHandler } from "../fileContextMenu";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffContentVersion,
  buildFileDiffIdentityKey,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../lib/syntaxHighlighting";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useWorkspaceMutationRefresh } from "../hooks/useWorkspaceMutationRefresh";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { DiffFilePathCopyButton } from "./DiffFilePathCopyButton";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import {
  buildDefaultCollapsedDiffFileKeys,
  buildDiffBaseRefPickerModel,
  buildDiffFileHeaderModel,
  buildDiffPanelBodyModel,
  buildDiffPanelFileListModel,
  buildDiffPanelHeaderModel,
  buildDiffPanelScopeModel,
  expandCollapsedDiffFile,
  INITIAL_DIFF_COLLAPSED_FILES_STATE,
  orderDiffTurnSummaries,
  resolveBaseRefRemoteToggle,
  resolveBaseRefSearchQuery,
  resolveBaseRefValueChange,
  resolveCollapsedDiffFileKeys,
  resolveDiffCodeViewClick,
  resolveDiffFileContextMenu,
  resolveDiffLayoutChange,
  resolveDiffPanelLineStat,
  resolveDiffScopeSelection,
  resolveRevealDiffFile,
  resolveSelectedDiffFileKey,
  toggleAllCollapsedDiffFiles,
  toggleCollapsedDiffFile,
  type DiffBaseRefSelectionIntent,
  type DiffCollapsedFilesState,
  type DiffFileChangeTone,
} from "./DiffPanel.logic";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { DiffFileTree } from "./diffs/DiffFileTree";
import { diffFileTreeEntries } from "./diffs/diffFileTree.logic";
import { Button } from "./ui/button";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Switch } from "./ui/switch";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { createGitDiffFileContentsLoader } from "../lib/diffFileContents";

import { useReviewFilePatches } from "./diffs/useReviewFilePatches";
import { DiffFileLoadingBoundary } from "./diffs/DiffFileLoadingBoundary";
import { DiffFileStatus } from "./diffs/DiffFileStatus";

type DiffThemeType = "light" | "dark";
const DIFF_FILE_TREE_STORAGE_KEY = "t3code.diffFileTreeOpen";
const DIFF_FILE_TONE_CLASS_NAME: Readonly<Record<DiffFileChangeTone, string>> = {
  addition: "text-[var(--diffs-addition-base)]",
  deletion: "text-[var(--diffs-deletion-base)]",
  modified: "text-[var(--diffs-modified-base)]",
  muted: "text-muted-foreground/80",
};
const fileEntryCache = new WeakMap<
  FileDiffMetadata,
  { fileDiff: FileDiffMetadata; fileKey: string; fileVersion: number }
>();

function getCachedFileEntry(fileDiff: FileDiffMetadata) {
  const cached = fileEntryCache.get(fileDiff);
  if (cached) return cached;
  const entry = {
    fileDiff,
    fileKey: buildFileDiffIdentityKey(fileDiff),
    fileVersion: buildFileDiffContentVersion(fileDiff),
  };
  fileEntryCache.set(fileDiff, entry);
  return entry;
}

interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
  workspaceMutationId: string | null;
}

export default function DiffPanel({
  mode = "inline",
  composerDraftTarget,
  workspaceMutationId,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const diffLayout = settings.diffLayout;
  const updateClientSettings = useUpdateClientSettings();
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [fileTreeOpen, setFileTreeOpen] = useLocalStorage(
    DIFF_FILE_TREE_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [collapsedDiffFiles, setCollapsedDiffFiles] = useState<DiffCollapsedFilesState>(
    INITIAL_DIFF_COLLAPSED_FILES_STATE,
  );
  const [codeViewRevision, setCodeViewRevision] = useState(0);
  const [codeView, setCodeView] = useState<AnnotatableCodeViewHandle | null>(null);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useThread(routeThreadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useProject(
    activeThread && activeProjectId
      ? {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.workspaceRoot;
  const activeRepositoryRoot = activeThread?.worktreePath
    ? undefined
    : activeProject?.repositoryIdentity?.rootPath;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(activeThread?.environmentId ?? null),
  );
  const onFileContextMenu = useFileContextMenuHandler(activeThread?.environmentId ?? null);
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const getDiffFileContents = useAtomCommand(reviewEnvironment.diffFileContents);
  const gitStatusQuery = useEnvironmentQuery(
    activeThread !== null && activeThread !== undefined && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: activeThread.environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(state.byThreadKey, routeThreadRef),
  );
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () => orderDiffTurnSummaries(turnDiffSummaries, inferredCheckpointTurnCountByTurnId),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!routeThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      routeThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [diffSelection, orderedTurnDiffSummaries, routeThreadRef]);

  const scope = useMemo(
    () =>
      buildDiffPanelScopeModel({
        threadRef: routeThreadRef ?? null,
        selection: diffSelection,
        orderedTurns: orderedTurnDiffSummaries,
        inferredCheckpointTurnCountByTurnId,
        timestampFormat: settings.timestampFormat,
      }),
    [
      diffSelection,
      inferredCheckpointTurnCountByTurnId,
      orderedTurnDiffSummaries,
      routeThreadRef,
      settings.timestampFormat,
    ],
  );
  const selectedTurnId = scope.requestedTurnId;
  const selectedGitScope = scope.gitScope;
  const selectedBaseRef = scope.baseRef;
  const selectedFilePath = scope.filePath;
  const selectedFileRevealRequestId = scope.revealRequestId;
  const hasActiveTurn = scope.activeTurnId !== null;
  const reviewSectionId = scope.reviewSectionId;
  const collapseScopeKey = scope.collapseScopeKey;
  const codeViewMountKey = `${collapseScopeKey ?? reviewSectionId}:${codeViewRevision}`;
  const reviewSectionTitle = scope.reviewSectionTitle;
  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: scope.checkpointRange?.fromTurnCount ?? null,
      toTurnCount: scope.checkpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: scope.checkpointCacheScope,
    },
    { enabled: isGitRepo && hasActiveTurn },
  );
  const primaryBranchDiffPreview = useEnvironmentQuery(
    selectedTurnId === null && activeThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: activeCwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const shouldRetryBranchDiffAtEnvironmentCwd =
    selectedTurnId === null &&
    primaryBranchDiffPreview.error?.includes("configured workspace root") === true &&
    serverConfig?.cwd !== undefined &&
    serverConfig.cwd !== activeCwd;
  const fallbackBranchDiffPreview = useEnvironmentQuery(
    shouldRetryBranchDiffAtEnvironmentCwd && activeThread && serverConfig
      ? reviewEnvironment.diffPreview({
          environmentId: activeThread.environmentId,
          input: {
            cwd: serverConfig.cwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const branchDiffPreview = shouldRetryBranchDiffAtEnvironmentCwd
    ? fallbackBranchDiffPreview
    : primaryBranchDiffPreview;
  const canRefreshGitDiff =
    isGitRepo && selectedTurnId === null && activeThread != null && activeCwd != null;

  const selectedGitSource = branchDiffPreview.data?.sources.find(
    (source) => source.kind === (selectedGitScope === "unstaged" ? "working-tree" : "branch-range"),
  );
  const refreshPreviewQuery = branchDiffPreview.refresh;
  const refreshDiffFromUserAction = refreshPreviewQuery;

  const currentLoadDiffFiles = useMemo<FileDiffContentsLoader | undefined>(() => {
    const preview = branchDiffPreview.data;
    if (selectedTurnId !== null || !activeThread || !preview || !selectedGitSource) {
      return undefined;
    }

    return createGitDiffFileContentsLoader(getDiffFileContents, {
      environmentId: activeThread.environmentId,
      cwd: preview.cwd,
      sourceKind: selectedGitSource.kind,
      baseRef: selectedGitSource.baseRef,
      headRef: selectedGitSource.headRef,
      cacheKey: selectedGitSource.diffHash,
    });
  }, [
    activeThread,
    branchDiffPreview.data,
    getDiffFileContents,
    selectedGitSource,
    selectedTurnId,
  ]);
  const loadDiffFilesRef = useRef(currentLoadDiffFiles);
  loadDiffFilesRef.current = currentLoadDiffFiles;
  const loadDiffFiles = useCallback<FileDiffContentsLoader>(async (fileDiff) => {
    const loader = loadDiffFilesRef.current;
    if (!loader) throw new Error("Diff file contents are unavailable for this selection.");
    return loader(fileDiff);
  }, []);
  const baseRefSearchQuery = resolveBaseRefSearchQuery(baseRefQuery);
  const localBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefSearchQuery ? { query: baseRefSearchQuery } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      activeThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: activeThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(baseRefSearchQuery ? { query: baseRefSearchQuery } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const baseRefPicker = buildDiffBaseRefPickerModel({
    isBranchScope: selectedTurnId === null && selectedGitScope === "branch",
    headRef: selectedGitSource?.headRef,
    baseRef: selectedGitSource?.baseRef,
    selectedBaseRef,
    query: baseRefQuery,
    localRefs: localBranchRefs.data?.refs ?? [],
    remoteRefs: remoteBranchRefs.data?.refs ?? [],
  });
  const gitDiff = selectedGitSource?.diff;

  const selectedPatch = hasActiveTurn ? activeCheckpointDiff.data?.diff : gitDiff;
  const isSelectedPatchTruncated = !hasActiveTurn && selectedGitSource?.truncated === true;
  const isLoadingSelectedPatch = hasActiveTurn
    ? activeCheckpointDiff.isPending
    : branchDiffPreview.isPending;
  const selectedPatchError = hasActiveTurn ? activeCheckpointDiff.error : branchDiffPreview.error;
  const lazySource =
    !hasActiveTurn && selectedGitSource?.truncated && selectedGitSource.files
      ? selectedGitSource
      : null;
  const renderablePatch = useMemo(
    () =>
      lazySource
        ? null
        : getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
            compactPartialHunkOffsets: selectedTurnId === null,
          }),
    [lazySource, resolvedTheme, selectedPatch, selectedTurnId],
  );
  const {
    scope: filePatchScope,
    isPending: areFilePatchesPending,
    fileStates,
    retry,
    requestFile,
    readyFilePaths,
    renderableFiles,
    settledFileCount,
    loadNextFiles,
  } = useReviewFilePatches({
    environmentId: activeThread?.environmentId,
    cwd: branchDiffPreview.data?.cwd,
    source: lazySource,
    baseRef: lazySource?.baseRef ?? selectedBaseRef,
    ignoreWhitespace: diffIgnoreWhitespace,
    theme: resolvedTheme,
    revision: branchDiffPreview.data
      ? DateTime.formatIso(branchDiffPreview.data.generatedAt)
      : undefined,
    preview: renderablePatch,
  });
  const refreshBranchDiffPreview = refreshPreviewQuery;

  useEffect(() => {
    if (!canRefreshGitDiff) return;
    const refreshOnFocus = () => refreshBranchDiffPreview();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [canRefreshGitDiff, refreshBranchDiffPreview]);

  useWorkspaceMutationRefresh({
    enabled: canRefreshGitDiff,
    mutationId: workspaceMutationId,
    refresh: refreshBranchDiffPreview,
    resourceKey: `diff:${scope.threadKey ?? ""}`,
  });

  const isRefreshingDiff = branchDiffPreview.isPending || areFilePatchesPending;
  const renderableFileEntries = useMemo(
    () => renderableFiles.map(getCachedFileEntry),
    [renderableFiles],
  );
  const defaultCollapsedDiffFileKeys = useMemo(
    () =>
      buildDefaultCollapsedDiffFileKeys(
        renderableFileEntries.map((file) => file.fileKey),
        settings.diffFilesCollapsed,
      ),
    [renderableFileEntries, settings.diffFilesCollapsed],
  );
  const collapseScope = useMemo(
    () => ({ scopeKey: collapseScopeKey, defaultKeys: defaultCollapsedDiffFileKeys }),
    [collapseScopeKey, defaultCollapsedDiffFileKeys],
  );
  const collapsedDiffFileKeys = resolveCollapsedDiffFileKeys(collapsedDiffFiles, collapseScope);
  const renderLoadingBoundary = useCallback(
    () =>
      settledFileCount < renderableFiles.length ? (
        <DiffFileLoadingBoundary
          load={loadNextFiles}
          count={renderableFiles.length - settledFileCount}
        />
      ) : null,
    [settledFileCount, renderableFiles.length, loadNextFiles],
  );
  const diffFileList = useMemo(
    () =>
      buildDiffPanelFileListModel({
        files: renderableFileEntries,
        collapsedFileKeys: collapsedDiffFileKeys,
        lazy: lazySource !== null,
        readyFilePaths,
        fileStats: lazySource?.files,
        fileStates,
      }),
    [collapsedDiffFileKeys, fileStates, lazySource, readyFilePaths, renderableFileEntries],
  );
  const diffFileModelsByPath = useMemo(
    () => new Map(diffFileList.files.map((file) => [file.path, file])),
    [diffFileList],
  );
  const codeViewFiles = useMemo(
    () =>
      renderableFileEntries.flatMap(({ fileDiff, fileVersion }, index) => {
        const file = diffFileList.files[index];
        // Header-only placeholders use the viewer's collapsed geometry until their patch arrives.
        return file?.visible
          ? [
              {
                fileDiff,
                filePath: file.path,
                fileKey: file.fileKey,
                fileVersion,
                collapsed: file.collapsed,
              },
            ]
          : [];
      }),
    [diffFileList, renderableFileEntries],
  );
  const diffLineStat = useMemo(
    () =>
      resolveDiffPanelLineStat({
        hasActiveTurn,
        sourceFileStats: selectedGitSource?.files,
        files: renderableFiles,
      }),
    [hasActiveTurn, renderableFiles, selectedGitSource],
  );
  const header = buildDiffPanelHeaderModel({
    visibleFileCount: diffFileList.visibleFileCount,
    sourceFileStatCount: hasActiveTurn ? 0 : (selectedGitSource?.files?.length ?? 0),
    lineStat: diffLineStat,
    canRefresh: canRefreshGitDiff,
    isRefreshing: isRefreshingDiff,
    diffFileCount: diffFileList.fileKeys.length,
    allFilesCollapsed: diffFileList.allCollapsed,
    diffLayout,
    wordWrap,
    ignoreWhitespace: diffIgnoreWhitespace,
    fileTreeOpen,
  });
  const body = buildDiffPanelBodyModel({
    hasThread: Boolean(activeThread),
    isGitRepo,
    isTurnScope: selectedTurnId !== null,
    turnCount: orderedTurnDiffSummaries.length,
    hasActiveTurn,
    gitScope: selectedGitScope,
    patch: selectedPatch,
    isLoading: isLoadingSelectedPatch,
    error: selectedPatchError,
    renderablePatch,
    lazy: lazySource !== null,
    truncated: isSelectedPatchTruncated,
    hasSourceFileStats: Boolean(selectedGitSource?.files),
  });
  const fileTreeEntries = useMemo(() => diffFileTreeEntries(renderableFiles), [renderableFiles]);
  const selectedDiffFileKey = resolveSelectedDiffFileKey(diffFileList.files, selectedFilePath);

  useEffect(() => {
    if (!selectedDiffFileKey || !codeView?.getInstance()) return;
    codeView.scrollTo({ type: "item", id: selectedDiffFileKey, align: "start" });
  }, [codeView, codeViewMountKey, selectedDiffFileKey, selectedFileRevealRequestId]);

  const treeRevealScope = useMemo(
    () => ({ collapseScopeKey, diffSelection }),
    [collapseScopeKey, diffSelection],
  );
  const requestTreeReveal = useCodeViewFileReveal(
    codeView,
    treeRevealScope,
    codeViewFiles.map((file) => file.fileKey),
  );
  const revealDiffFile = useCallback(
    (filePath: string) => {
      const intent = resolveRevealDiffFile({
        filePath,
        files: diffFileList.files,
        lazy: lazySource !== null,
        settledFileCount,
      });
      if (intent.kind === "none") return;
      setCollapsedDiffFiles((current) =>
        expandCollapsedDiffFile(current, collapseScope, intent.fileKey),
      );
      if (intent.requestFileIndex !== null) {
        requestFile(intent.requestFileIndex);
      }
      requestTreeReveal(intent.fileKey);
    },
    [
      diffFileList.files,
      collapseScope,
      requestTreeReveal,
      lazySource,
      settledFileCount,
      requestFile,
    ],
  );

  const externalRevealRef = useRef<{ cache: string; key: string } | null>(null);
  useEffect(() => {
    if (!lazySource || !selectedFilePath) return;
    const key = `${selectedFilePath}:${selectedFileRevealRequestId}`;
    if (
      externalRevealRef.current?.cache === filePatchScope &&
      externalRevealRef.current.key === key
    )
      return;
    externalRevealRef.current = { cache: filePatchScope, key };
    revealDiffFile(selectedFilePath);
  }, [lazySource, selectedFilePath, selectedFileRevealRequestId, filePatchScope, revealDiffFile]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: routeThreadRef,
        filePath,
        activeCwd,
        repositoryRoot: activeRepositoryRoot,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(routeThreadRef
                  ? {
                      environmentId: routeThreadRef.environmentId,
                      threadId: routeThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, activeRepositoryRoot, openInPreferredEditor, routeThreadRef],
  );
  const toggleDiffFileCollapsed = useCallback(
    (fileKey: string) => {
      setCollapsedDiffFiles((current) => toggleCollapsedDiffFile(current, collapseScope, fileKey));
    },
    [collapseScope],
  );

  const toggleDiffFileCollapse = useCallback(() => {
    setCodeViewRevision((current) => current + 1);
    setCollapsedDiffFiles((current) =>
      toggleAllCollapsedDiffFiles(current, collapseScope, diffFileList.fileKeys),
    );
  }, [collapseScope, diffFileList.fileKeys]);

  const selectScopeValue = (value: string) => {
    const intent = resolveDiffScopeSelection(value, orderedTurnDiffSummaries);
    if (intent.kind === "none" || !routeThreadRef) return;
    if (intent.kind === "select-git-scope") {
      useDiffPanelStore.getState().selectGitScope(routeThreadRef, intent.scope);
    } else {
      useDiffPanelStore.getState().selectTurn(routeThreadRef, intent.turnId);
    }
  };
  const selectBranchBaseRef = (intent: DiffBaseRefSelectionIntent) => {
    if (intent.kind === "none" || !routeThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(routeThreadRef, intent.baseRef);
  };

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3 [-webkit-app-region:no-drag]">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="xs" variant="secondary" />}
            className="max-w-full"
            aria-label={scope.ariaLabel}
          >
            <span className="truncate">{scope.label}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={scope.value} onValueChange={selectScopeValue}>
              {scope.scopeOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                  <span>{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{scope.turnMenuLabel}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={scope.turnValue} onValueChange={selectScopeValue}>
                  {scope.turnOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.turnId} value={option.value} closeOnClick>
                      <span className="flex items-center gap-2">
                        <span>{option.label}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {option.timestampLabel}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        {baseRefPicker && (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
            aria-label={baseRefPicker.ariaLabel}
          >
            <Tooltip>
              <TooltipTrigger render={<span className="flex min-w-0 items-center gap-2" />}>
                <span className="min-w-0 max-w-48 truncate">{baseRefPicker.headLabel}</span>
                <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
              </TooltipTrigger>
              <TooltipPopup side="top">{baseRefPicker.tooltip}</TooltipPopup>
            </Tooltip>
            <Combobox
              items={baseRefPicker.items}
              filteredItems={baseRefPicker.filteredItems}
              value={baseRefPicker.value}
              onOpenChange={(open) => {
                if (!open) setBaseRefQuery("");
              }}
              onValueChange={(value) => {
                selectBranchBaseRef(resolveBaseRefValueChange(value));
              }}
            >
              <ComboboxTrigger
                render={<Button variant="ghost-muted" size="xs" />}
                className="min-w-0 max-w-48"
                aria-label={baseRefPicker.triggerAriaLabel}
              >
                <span className="min-w-0 truncate">{baseRefPicker.baseRef}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
              </ComboboxTrigger>
              <ComboboxPopup
                align="start"
                className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden"
              >
                <ComboboxSearchInput
                  placeholder={baseRefPicker.searchPlaceholder}
                  value={baseRefQuery}
                  onChange={(event) => setBaseRefQuery(event.target.value)}
                />
                <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-3xs text-muted-foreground uppercase tracking-wide">
                  <span aria-hidden="true" />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                    <span>{baseRefPicker.branchColumnLabel}</span>
                    <span className="text-right">{baseRefPicker.remoteColumnLabel}</span>
                  </div>
                </div>
                <ComboboxEmpty>{baseRefPicker.emptyLabel}</ComboboxEmpty>
                <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
                  <ComboboxItem
                    className="w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)]"
                    value={baseRefPicker.automatic.value}
                  >
                    <span className="block min-w-0 truncate">{baseRefPicker.automatic.label}</span>
                  </ComboboxItem>
                  {baseRefPicker.choices.map((choice) => {
                    const remoteToggle = choice.remoteToggle;
                    return (
                      <ComboboxItem
                        key={choice.id}
                        className="w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)]"
                        value={choice.value}
                      >
                        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                          <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                          {remoteToggle.kind === "switch" ? (
                            <div
                              className="flex justify-end"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <Switch
                                aria-label={remoteToggle.ariaLabel}
                                checked={remoteToggle.checked}
                                className="[--thumb-size:--spacing(3)]"
                                onCheckedChange={(checked) => {
                                  selectBranchBaseRef(
                                    resolveBaseRefRemoteToggle(remoteToggle, checked),
                                  );
                                }}
                              />
                            </div>
                          ) : remoteToggle.kind === "remote-only" ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="flex justify-end text-muted-foreground">
                                    <CheckIcon
                                      role="img"
                                      aria-label={remoteToggle.label}
                                      className="size-3"
                                    />
                                  </span>
                                }
                              />
                              <TooltipPopup side="top">{remoteToggle.label}</TooltipPopup>
                            </Tooltip>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  })}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        {header.stat ? (
          <DiffStatLabel
            additions={header.stat.additions}
            deletions={header.stat.deletions}
            className="mr-1 text-2xs"
            layout="inline"
          />
        ) : null}
        {header.refresh && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={header.refresh.ariaLabel}
                  onClick={refreshDiffFromUserAction}
                />
              }
            >
              <RefreshIcon size="sm" refreshing={header.refresh.refreshing} />
            </TooltipTrigger>
            <TooltipPopup side="top">{header.refresh.tooltip}</TooltipPopup>
          </Tooltip>
        )}
        {header.collapseAll && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={header.collapseAll.ariaLabel}
                  onClick={toggleDiffFileCollapse}
                />
              }
            >
              {header.collapseAll.icon === "chevrons-up-down" ? (
                <ChevronsUpDownIcon className="size-3.5" />
              ) : (
                <ChevronsDownUpIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{header.collapseAll.tooltip}</TooltipPopup>
          </Tooltip>
        )}
        <ToggleGroup
          aria-label={header.layout.ariaLabel}
          className="shrink-0"
          variant="segmented"
          value={[header.layout.value]}
          onValueChange={(value) => {
            const intent = resolveDiffLayoutChange(value);
            if (intent.kind === "set-diff-layout") {
              updateClientSettings({ diffLayout: intent.layout });
            }
          }}
        >
          {header.layout.options.map((option) => (
            <Toggle key={option.value} aria-label={option.ariaLabel} value={option.value}>
              {option.icon === "rows-3" ? (
                <Rows3Icon className="size-3.5" />
              ) : (
                <Columns2Icon className="size-3.5" />
              )}
            </Toggle>
          ))}
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={header.wordWrap.ariaLabel}
                variant="ghost"
                size="sm"
                pressed={header.wordWrap.pressed}
                onPressedChange={(pressed) => {
                  setWordWrap(Boolean(pressed));
                }}
              />
            }
          >
            <TextWrapIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{header.wordWrap.tooltip}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                aria-label={header.whitespace.ariaLabel}
                variant="ghost"
                size="sm"
                pressed={header.whitespace.pressed}
                onPressedChange={(pressed) => {
                  setDiffIgnoreWhitespace(Boolean(pressed));
                }}
              />
            }
          >
            <PilcrowIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{header.whitespace.tooltip}</TooltipPopup>
        </Tooltip>
        {header.fileTree && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={header.fileTree.ariaLabel}
                  variant="ghost"
                  size="sm"
                  pressed={header.fileTree.pressed}
                  onPressedChange={(pressed) => setFileTreeOpen(Boolean(pressed))}
                />
              }
            >
              <FolderTreeIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">{header.fileTree.tooltip}</TooltipPopup>
          </Tooltip>
        )}
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {body.kind === "message" ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          {body.message}
        </div>
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            {body.notice && (
              <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-2xs text-muted-foreground">
                {body.notice}
              </p>
            )}
            {body.error && (
              <div className="px-3">
                <p className="mb-2 text-2xs text-error/80">{body.error}</p>
              </div>
            )}
            {body.view.kind === "loading" ? (
              <DiffPanelLoadingState label={body.view.label} />
            ) : body.view.kind === "empty" ? (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>{body.view.message}</p>
              </div>
            ) : body.view.kind === "files" ? (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <div
                  className="min-h-0 min-w-0 flex-1"
                  onClickCapture={(event) => {
                    const composedPath = event.nativeEvent.composedPath?.() ?? [];
                    const findMarkedElement = (attribute: string) =>
                      composedPath.find(
                        (node): node is HTMLElement =>
                          node instanceof HTMLElement && node.hasAttribute(attribute),
                      );
                    // Header controls keep their own actions. In particular, the chevron must
                    // not also trigger the row handler or the two toggles cancel each other.
                    // The filename remains the explicit "open in editor" affordance.
                    const intent = resolveDiffCodeViewClick({
                      clickedControl: composedPath.some(
                        (node) =>
                          node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement,
                      ),
                      titlePath: findMarkedElement("data-title")?.textContent,
                      headerTitlePath:
                        findMarkedElement("data-diffs-header")?.querySelector("[data-title]")
                          ?.textContent,
                      files: diffFileList.files,
                    });
                    if (intent.kind === "open-file") {
                      openDiffFile(intent.filePath);
                    } else if (intent.kind === "toggle-file-collapsed") {
                      toggleDiffFileCollapsed(intent.fileKey);
                    }
                  }}
                  onContextMenuCapture={(event) => {
                    const composedPath = event.nativeEvent.composedPath?.() ?? [];
                    const title = composedPath.find(
                      (node): node is HTMLElement =>
                        node instanceof HTMLElement && node.hasAttribute("data-title"),
                    );
                    const intent = resolveDiffFileContextMenu(title?.textContent);
                    if (intent.kind === "none") return;
                    event.preventDefault();
                    onFileContextMenu(
                      {
                        environmentId: activeThread?.environmentId ?? null,
                        filePath: intent.filePath,
                        workspaceRoot: activeCwd,
                        repositoryRoot: activeRepositoryRoot,
                      },
                      event,
                    );
                  }}
                >
                  <AnnotatableCodeView
                    key={collapseScopeKey ?? reviewSectionId}
                    viewerRef={setCodeView}
                    codeViewKey={`${codeViewMountKey}:${lazySource ? filePatchScope : "preview"}`}
                    className="h-full min-h-0 overflow-auto"
                    files={codeViewFiles}
                    renderCodeViewFooter={renderLoadingBoundary}
                    sectionId={reviewSectionId}
                    sectionTitle={reviewSectionTitle}
                    composerDraftTarget={composerDraftTarget}
                    renderHeaderFilenameSuffix={(fileDiff) => {
                      const path = resolveFileDiffPath(fileDiff);
                      const file = diffFileModelsByPath.get(path);
                      return (
                        <>
                          <DiffFilePathCopyButton filePath={path} />
                          {file?.headerStat ? (
                            <DiffFileStatus {...fileStates.get(path)} retry={() => retry(path)} />
                          ) : null}
                        </>
                      );
                    }}
                    {...(lazySource
                      ? {
                          unsafeCSSExtra:
                            "[data-additions-count], [data-deletions-count] { display: none; }",
                          renderHeaderMetadata: (fileDiff: FileDiffMetadata) => {
                            const stat = diffFileModelsByPath.get(
                              resolveFileDiffPath(fileDiff),
                            )?.headerStat;
                            return stat ? (
                              <DiffStatLabel
                                additions={stat.additions}
                                deletions={stat.deletions}
                              />
                            ) : null;
                          },
                        }
                      : {})}
                    renderHeaderPrefix={(fileDiff, fileKey) => {
                      const fileHeader = buildDiffFileHeaderModel({
                        fileDiff,
                        fileKey,
                        collapsedFileKeys: collapsedDiffFileKeys,
                      });
                      const toggle = fileHeader.collapseToggle;
                      const iconClassName = cn(
                        "size-4",
                        DIFF_FILE_TONE_CLASS_NAME[fileHeader.tone],
                      );
                      return (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-micro"
                                variant="ghost"
                                className="-ms-0.5"
                                aria-label={toggle.ariaLabel}
                                aria-expanded={toggle.expanded}
                                disabled={toggle.disabled}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleDiffFileCollapsed(fileKey);
                                }}
                              />
                            }
                          >
                            {toggle.icon === "chevron-right" ? (
                              <ChevronRightIcon className={iconClassName} />
                            ) : (
                              <ChevronDownIcon className={iconClassName} />
                            )}
                          </TooltipTrigger>
                          <TooltipPopup side="top">{toggle.tooltip}</TooltipPopup>
                        </Tooltip>
                      );
                    }}
                    options={{
                      diffStyle: header.layout.diffStyle,
                      lineDiffType: "none",
                      overflow: header.wordWrap.overflow,
                      theme: resolveDiffThemeName(resolvedTheme),
                      preferredHighlighter: PREFERRED_HIGHLIGHTER,
                      themeType: resolvedTheme as DiffThemeType,
                      stickyHeaders: true,
                      ...(currentLoadDiffFiles ? { loadDiffFiles } : {}),
                    }}
                  />
                </div>
                {fileTreeOpen ? (
                  <aside className="flex w-[min(16rem,40%)] min-w-40 shrink-0 border-l border-border/60">
                    <DiffFileTree
                      ariaLabel={`${reviewSectionTitle} files`}
                      entries={fileTreeEntries}
                      selectedPath={selectedFilePath}
                      revealRequestId={selectedFileRevealRequestId}
                      onSelectFile={revealDiffFile}
                    />
                  </aside>
                ) : null}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-2xs text-muted-foreground/75">{body.view.reason}</p>
                  <pre
                    className={cn(
                      "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-2xs leading-relaxed text-muted-foreground/90",
                      wordWrap
                        ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                        : "overflow-auto",
                    )}
                  >
                    {body.view.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}
