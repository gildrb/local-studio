import { RefreshIcon } from "~/components/ui/refresh-icon";
import { Spinner } from "~/components/ui/spinner";
import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { cn } from "~/lib/utils";
import { isAbsolutePath } from "~/terminal-links";

import { type FileBreadcrumb, fileBreadcrumbs } from "./filePath";
import { buildBreadcrumbMenuModel } from "./FileBreadcrumbs.logic";
import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBreadcrumbsProps {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly onOpenFile: (relativePath: string) => void;
  readonly projectName: string;
  readonly relativePath: string;
  readonly workspaceMutationId: string | null;
}

function BreadcrumbLabel(props: {
  readonly current?: boolean;
  readonly label: string;
  readonly pathLabel: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "block max-w-40 truncate rounded-sm px-0.5",
              props.current ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          />
        }
      >
        {props.label}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.pathLabel}</TooltipPopup>
    </Tooltip>
  );
}

function BreadcrumbMenuContent(props: {
  readonly cwd: string;
  readonly currentFilePath: string;
  readonly directoryPath: string;
  readonly environmentId: EnvironmentId;
  readonly onDirectoryChange: (path: string) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenFile: (path: string) => void;
  readonly projectName: string;
  readonly rootPath: string;
  readonly workspaceMutationId: string | null;
}) {
  const entriesQuery = useProjectEntriesQuery(props.environmentId, props.cwd, props.directoryPath);
  useWorkspaceMutationRefresh({
    mutationId: props.workspaceMutationId,
    refresh: entriesQuery.refresh,
    resourceKey: `files:${props.environmentId}:${props.cwd}`,
  });
  const { resolvedTheme } = useTheme();
  const menu = useMemo(
    () =>
      buildBreadcrumbMenuModel({
        directoryPath: props.directoryPath,
        rootPath: props.rootPath,
        currentFilePath: props.currentFilePath,
        projectName: props.projectName,
        entries: {
          data: entriesQuery.data,
          isPending: entriesQuery.isPending,
          error: entriesQuery.error,
        },
      }),
    [
      entriesQuery.data,
      entriesQuery.error,
      entriesQuery.isPending,
      props.currentFilePath,
      props.directoryPath,
      props.projectName,
      props.rootPath,
    ],
  );
  const { back, content } = menu;

  return (
    <MenuPopup
      align="start"
      side="bottom"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" || back === null) return;
        event.preventDefault();
        event.stopPropagation();
        props.onDirectoryChange(back.path);
      }}
    >
      {back !== null ? (
        <>
          <MenuItem closeOnClick={false} onClick={() => props.onDirectoryChange(back.path)}>
            <ArrowLeftIcon />
            <span className="truncate">{back.label}</span>
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      <MenuGroup key={props.directoryPath}>
        {content.kind === "loading" ? (
          <MenuItem disabled>
            <Spinner />
            {content.label}
          </MenuItem>
        ) : content.kind === "retry" ? (
          <MenuItem closeOnClick={false} onClick={entriesQuery.refresh}>
            <RefreshIcon refreshing={content.refreshing} />
            <span className="min-w-0 flex-1 truncate">{content.label}</span>
          </MenuItem>
        ) : content.kind === "notice" ? (
          <MenuItem disabled>{content.label}</MenuItem>
        ) : (
          // Files form a radio group keyed by path so the open file is marked as checked;
          // directories only navigate the menu, so they stay plain items.
          <MenuRadioGroup
            value={props.currentFilePath}
            onValueChange={(path) => {
              props.onOpenChange(false);
              props.onOpenFile(path);
            }}
          >
            {content.items.map((entry) => {
              const row = (
                <>
                  <PierreEntryIcon pathValue={entry.path} kind={entry.kind} theme={resolvedTheme} />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            entry.ignored && "text-muted-foreground",
                          )}
                        />
                      }
                    >
                      {entry.label}
                    </TooltipTrigger>
                    <TooltipPopup side="right">{entry.path}</TooltipPopup>
                  </Tooltip>
                </>
              );
              return entry.kind === "directory" ? (
                <MenuItem
                  key={entry.path}
                  closeOnClick={false}
                  onClick={() => props.onDirectoryChange(entry.path)}
                >
                  {row}
                  <ChevronRightIcon />
                </MenuItem>
              ) : (
                <MenuRadioItem
                  key={entry.path}
                  value={entry.path}
                  closeOnClick
                  aria-current={entry.current ? "page" : undefined}
                >
                  <span className="flex min-w-0 items-center gap-2">{row}</span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        )}
      </MenuGroup>
      {menu.refreshFailed !== null ? (
        <>
          <MenuSeparator />
          <MenuItem closeOnClick={false} onClick={entriesQuery.refresh}>
            <RefreshIcon refreshing={menu.refreshFailed.refreshing} />
            {menu.refreshFailed.label}
          </MenuItem>
        </>
      ) : null}
      {menu.truncatedNotice !== null ? (
        <>
          <MenuSeparator />
          <MenuItem disabled>{menu.truncatedNotice}</MenuItem>
        </>
      ) : null}
    </MenuPopup>
  );
}

function DirectoryBreadcrumb(props: FileBreadcrumbsProps & { readonly crumb: FileBreadcrumb }) {
  const [open, setOpen] = useState(false);
  const [directoryPath, setDirectoryPath] = useState(props.crumb.path);

  useEffect(() => {
    setOpen(false);
    setDirectoryPath(props.crumb.path);
  }, [props.crumb.path, props.relativePath]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) setDirectoryPath(props.crumb.path);
  };

  return (
    <Menu open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Browse ${props.crumb.label}`}
                  className="relative block max-w-40 cursor-pointer rounded-sm px-0.5 text-left text-muted-foreground outline-none pointer-coarse:after:-inset-y-3 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground"
                />
              }
            />
          }
        >
          <span className="block truncate">{props.crumb.label}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{props.crumb.path || props.projectName}</TooltipPopup>
      </Tooltip>
      {open ? (
        <BreadcrumbMenuContent
          cwd={props.cwd}
          currentFilePath={props.relativePath}
          directoryPath={directoryPath}
          environmentId={props.environmentId}
          onDirectoryChange={setDirectoryPath}
          onOpenChange={handleOpenChange}
          onOpenFile={props.onOpenFile}
          projectName={props.projectName}
          rootPath={props.crumb.path}
          workspaceMutationId={props.workspaceMutationId}
        />
      ) : null}
    </Menu>
  );
}

export function FileBreadcrumbs(props: FileBreadcrumbsProps) {
  const hostPath = isAbsolutePath(props.relativePath);
  const breadcrumbs = useMemo(
    () => fileBreadcrumbs(props.projectName, props.relativePath),
    [props.projectName, props.relativePath],
  );

  return breadcrumbs.map((crumb, index) => (
    <div
      key={crumb.path || "project"}
      className="flex min-w-0 shrink-0 items-center"
      data-current-file-crumb={crumb.kind === "file"}
    >
      {index > 0 ? (
        <ChevronRightIcon className="mx-1 size-3.5 shrink-0 text-muted-foreground/60" />
      ) : null}
      {crumb.kind === "file" ? (
        <span aria-current="page">
          <BreadcrumbLabel current label={crumb.label} pathLabel={crumb.path} />
        </span>
      ) : hostPath ? (
        <BreadcrumbLabel label={crumb.label} pathLabel={crumb.path} />
      ) : (
        <DirectoryBreadcrumb {...props} crumb={crumb} />
      )}
    </div>
  ));
}
