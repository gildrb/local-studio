import { type TurnId } from "@t3tools/contracts";
import { type MouseEvent, memo, useCallback, useMemo, useState } from "react";
import { type TurnDiffFileChange } from "../../types";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ChevronRightIcon,
  FileDiffIcon,
  FolderIcon,
  FolderClosedIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { DiffStatLabel } from "./DiffStatLabel";
import {
  buildChangedFilesCardModel,
  buildChangedFilesTreeModel,
  INITIAL_CHANGED_FILES_EXPANSION_STATE,
  resolveChangedFileOpen,
  toggleChangedFilesDirectory,
  type ChangedFilesExpansionState,
  type ChangedFilesTreeNodeModel,
} from "./ChangedFilesTree.logic";
import { PierreEntryIcon } from "./PierreEntryIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MiddleTruncate } from "../ui/middle-truncate";

/** Opens the OS-level context menu for a changed file (reveal in file manager, open in editor). */
export type ChangedFileContextMenuHandler = (filePath: string, event: MouseEvent) => void;

export const ChangedFilesCard = memo(function ChangedFilesCard(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onToggleAllDirectories: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const {
    turnId,
    files,
    allDirectoriesExpanded,
    resolvedTheme,
    onToggleAllDirectories,
    onOpenTurnDiff,
    onFileContextMenu,
  } = props;
  const model = useMemo(
    () => buildChangedFilesCardModel({ files, allDirectoriesExpanded }),
    [allDirectoriesExpanded, files],
  );
  const toggleAllDirectories = model.toggleAllDirectories;

  return (
    <div
      className="@container/changed-files mt-4 rounded-lg bg-secondary dark:bg-input/20"
      data-changed-files-state="tree"
    >
      <div
        data-changed-files-header=""
        className="sticky top-2 z-10 flex items-center justify-between gap-2 rounded-t-lg bg-secondary px-3 py-2 dark:bg-background dark:bg-linear-to-b dark:from-input/20 dark:to-input/20"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-foreground">
          <span>{model.countLabel}</span>
          {model.stat && (
            <DiffStatLabel
              additions={model.stat.additions}
              deletions={model.stat.deletions}
              layout="inline"
              className="text-xs leading-4"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {toggleAllDirectories && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={toggleAllDirectories.ariaLabel}
                    data-scroll-anchor-ignore
                    onClick={onToggleAllDirectories}
                  />
                }
              >
                {toggleAllDirectories.icon === "chevrons-down-up" ? (
                  <ChevronsDownUpIcon className="size-3" />
                ) : (
                  <ChevronsUpDownIcon className="size-3" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">{toggleAllDirectories.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-muted"
                  aria-label={model.openDiff.ariaLabel}
                  onClick={() => {
                    const intent = resolveChangedFileOpen(turnId, model.openDiff.filePath);
                    onOpenTurnDiff(intent.turnId, intent.filePath);
                  }}
                />
              }
            >
              <FileDiffIcon className="size-3" />
              <span className="hidden @[24rem]/changed-files:inline">{model.openDiff.label}</span>
            </TooltipTrigger>
            <TooltipPopup side="top">{model.openDiff.tooltip}</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <ChangedFilesTree
        key={`${turnId}:${allDirectoriesExpanded}`}
        turnId={turnId}
        files={files}
        allDirectoriesExpanded={allDirectoriesExpanded}
        resolvedTheme={resolvedTheme}
        onOpenTurnDiff={onOpenTurnDiff}
        onFileContextMenu={onFileContextMenu}
      />
    </div>
  );
});

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onFileContextMenu?: ChangedFileContextMenuHandler | undefined;
}) {
  const {
    files,
    allDirectoriesExpanded,
    onOpenTurnDiff,
    resolvedTheme,
    turnId,
    onFileContextMenu,
  } = props;
  const [directoryExpansionState, setDirectoryExpansionState] =
    useState<ChangedFilesExpansionState>(INITIAL_CHANGED_FILES_EXPANSION_STATE);
  const model = useMemo(
    () =>
      buildChangedFilesTreeModel({
        files,
        allDirectoriesExpanded,
        expansionState: directoryExpansionState,
      }),
    [allDirectoriesExpanded, directoryExpansionState, files],
  );
  const expansionKey = model.expansionKey;

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) =>
        toggleChangedFilesDirectory(current, {
          expansionKey,
          path: pathValue,
          allDirectoriesExpanded,
        }),
      );
    },
    [allDirectoriesExpanded, expansionKey],
  );

  const renderTreeNode = (node: ChangedFilesTreeNodeModel) => {
    if (node.kind === "directory") {
      return (
        <div key={node.key}>
          <button
            type="button"
            data-scroll-anchor-ignore
            aria-expanded={node.expanded}
            className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            style={{ paddingLeft: `${node.indentPx}px` }}
            onClick={() => toggleDirectory(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
                node.expanded && "rotate-90",
              )}
            />
            {node.icon === "folder-open" ? (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-mono text-2xs text-muted-foreground/90 group-hover:text-foreground/90">
              {node.name}
            </span>
            {node.stat && (
              <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            )}
          </button>
          {node.expanded && (
            <div>{node.children.map((childNode) => renderTreeNode(childNode))}</div>
          )}
        </div>
      );
    }

    return (
      <button
        key={node.key}
        type="button"
        className="group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        style={{ paddingLeft: `${node.indentPx}px` }}
        onClick={() => {
          const intent = resolveChangedFileOpen(turnId, node.path);
          onOpenTurnDiff(intent.turnId, intent.filePath);
        }}
        onContextMenu={
          onFileContextMenu
            ? (event) => {
                event.preventDefault();
                onFileContextMenu(node.path, event);
              }
            : undefined
        }
      >
        {node.showLeadingSpacer ? <span aria-hidden="true" className="size-3.5 shrink-0" /> : null}
        <PierreEntryIcon
          pathValue={node.path}
          kind="file"
          theme={resolvedTheme}
          className="size-3.5 text-muted-foreground/70"
        />
        <span className="flex min-w-0 font-mono text-xs text-foreground/85 group-hover:text-foreground">
          <MiddleTruncate value={node.name} />
        </span>
        {node.stat && (
          <span className="ml-auto shrink-0 font-mono text-3xs tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}
      </button>
    );
  };

  return <div className="p-2">{model.nodes.map((node) => renderTreeNode(node))}</div>;
});
