import { FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import { memo, useMemo } from "react";

import {
  PREVIOUS_WORKTREE_SELECT_VALUE,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveEnvModeSelectItems,
  resolveEnvModeTooltip,
  resolveLockedWorkspaceLabel,
  resolveLockedWorkspaceTooltip,
  resolveWorkspaceIconKind,
  type EnvMode,
  type WorkspaceIconKind,
} from "./BranchToolbar.logic";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { PreviousWorktreeItemContent } from "./PreviousWorktreeItemContent";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const WORKSPACE_ICONS: Record<WorkspaceIconKind, typeof FolderIcon> = {
  folder: FolderIcon,
  "folder-git": FolderGitIcon,
  "folder-git-2": FolderGit2Icon,
};

interface BranchToolbarEnvModeSelectorProps {
  forceNewWorktree?: boolean;
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel?: string | null;
  previousWorktreeBranch?: string | null;
  onUsePreviousWorktree?: () => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  forceNewWorktree = false,
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  previousWorktreeLabel,
  previousWorktreeBranch = null,
  onUsePreviousWorktree,
}: BranchToolbarEnvModeSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const showPreviousWorktree = Boolean(previousWorktreeLabel && onUsePreviousWorktree);
  const envModeItems = useMemo(
    () =>
      resolveEnvModeSelectItems({
        activeWorktreePath,
        previousWorktreeLabel:
          showPreviousWorktree && previousWorktreeLabel ? previousWorktreeLabel : null,
      }),
    [activeWorktreePath, previousWorktreeLabel, showPreviousWorktree],
  );

  if (envLocked || forceNewWorktree) {
    const LockedWorkspaceIcon =
      WORKSPACE_ICONS[
        resolveWorkspaceIconKind({ locked: true, activeWorktreePath, effectiveEnvMode })
      ];
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="inline-flex h-7 min-w-0 items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
          data-composer-context-control
        >
          <LockedWorkspaceIcon className="size-3 shrink-0" />
          <span
            data-composer-label
            className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
          >
            <span
              data-composer-label-motion
              className="block w-full min-w-0 max-w-[240px] truncate transition-opacity duration-180 ease-drawer group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
            >
              {resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup>
          {resolveLockedWorkspaceTooltip({
            forceNewWorktree,
            activeWorktreePath,
            effectiveEnvMode,
          })}
        </TooltipPopup>
      </Tooltip>
    );
  }

  const WorkspaceIcon =
    WORKSPACE_ICONS[
      resolveWorkspaceIconKind({ locked: false, activeWorktreePath, effectiveEnvMode })
    ];
  return (
    <Select
      modal={false}
      value={effectiveEnvMode}
      onValueChange={(value: string | null) => {
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        onEnvModeChange(value as EnvMode);
      }}
      items={envModeItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SelectTrigger
              variant="ghost"
              size="xs"
              className="min-w-0 shrink"
              aria-label="Workspace"
              data-composer-shortcut="composer.workspace"
              data-composer-context-control
            />
          }
        >
          <WorkspaceIcon className="size-3" />
          <span
            data-composer-label
            className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
          >
            <span
              data-composer-label-motion
              className="block w-full min-w-0 max-w-[240px] truncate transition-opacity duration-180 ease-drawer group-data-[compact]/composer-context:opacity-0 motion-reduce:transition-none"
            >
              <SelectValue />
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup>
          {resolveEnvModeTooltip({ effectiveEnvMode, activeWorktreePath })}
        </TooltipPopup>
      </Tooltip>
      <SelectPopup
        alignItemWithTrigger={false}
        className={showPreviousWorktree ? "w-[min(21rem,calc(100vw-2rem))]" : undefined}
        {...composerFloatingLayerProps}
      >
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              {activeWorktreePath ? (
                <FolderGitIcon className="size-3" />
              ) : (
                <FolderIcon className="size-3" />
              )}
              {resolveCurrentWorkspaceLabel(activeWorktreePath)}
            </span>
          </SelectItem>
          <SelectItem value="worktree">
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {resolveEnvModeLabel("worktree")}
            </span>
          </SelectItem>
          {showPreviousWorktree && previousWorktreeLabel ? (
            <SelectItem value={PREVIOUS_WORKTREE_SELECT_VALUE}>
              <PreviousWorktreeItemContent branch={previousWorktreeBranch} />
            </SelectItem>
          ) : null}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
