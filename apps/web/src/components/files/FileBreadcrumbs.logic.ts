import type { ProjectEntry } from "@t3tools/contracts";

import { type FileBreadcrumbChild, fileBreadcrumbChildren, fileBreadcrumbParent } from "./filePath";

export function breadcrumbPathLabel(path: string, projectName: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || projectName;
}

export type BreadcrumbMenuEntriesInput = {
  readonly data: {
    readonly entries: ReadonlyArray<ProjectEntry>;
    readonly truncated: boolean;
  } | null;
  readonly isPending: boolean;
  readonly error: string | null;
};

export type BreadcrumbMenuItemModel = FileBreadcrumbChild & {
  readonly current: boolean;
};

export type BreadcrumbMenuContentModel =
  | { readonly kind: "loading"; readonly label: string }
  | { readonly kind: "retry"; readonly label: string; readonly refreshing: boolean }
  | { readonly kind: "notice"; readonly label: string }
  | { readonly kind: "items"; readonly items: ReadonlyArray<BreadcrumbMenuItemModel> };

export type BreadcrumbMenuModel = {
  readonly back: { readonly path: string; readonly label: string } | null;
  readonly content: BreadcrumbMenuContentModel;
  readonly refreshFailed: { readonly label: string; readonly refreshing: boolean } | null;
  readonly truncatedNotice: string | null;
};

/** The folder menu a directory crumb opens: back navigation, children, and load states. */
export function buildBreadcrumbMenuModel(input: {
  readonly directoryPath: string;
  readonly rootPath: string;
  readonly currentFilePath: string;
  readonly projectName: string;
  readonly entries: BreadcrumbMenuEntriesInput;
}): BreadcrumbMenuModel {
  const { entries } = input;
  const entriesTruncated = entries.data?.truncated ?? false;
  const children = fileBreadcrumbChildren(entries.data?.entries ?? [], input.directoryPath);
  const directoryAvailable = entries.data !== null;
  const parentPath = fileBreadcrumbParent(input.directoryPath);
  const canGoBack =
    input.directoryPath !== input.rootPath &&
    parentPath !== null &&
    (input.rootPath === "" ||
      parentPath === input.rootPath ||
      parentPath.startsWith(`${input.rootPath}/`));
  const content: BreadcrumbMenuContentModel =
    entries.isPending && entries.data === null
      ? { kind: "loading", label: "Loading folder…" }
      : entries.error && entries.data === null
        ? { kind: "retry", label: "Retry loading folder", refreshing: entries.isPending }
        : !directoryAvailable && !entriesTruncated
          ? { kind: "notice", label: "This folder is no longer available." }
          : children.length === 0
            ? {
                kind: "notice",
                label: entriesTruncated
                  ? "No entries from this folder are available in the partial workspace index."
                  : "This folder is empty.",
              }
            : {
                kind: "items",
                items: children.map((entry) => ({
                  ...entry,
                  current: entry.kind === "file" && entry.path === input.currentFilePath,
                })),
              };
  return {
    back:
      canGoBack && parentPath !== null
        ? {
            path: parentPath,
            label: `Back to ${breadcrumbPathLabel(parentPath, input.projectName)}`,
          }
        : null,
    content,
    refreshFailed:
      entries.error && entries.data !== null
        ? { label: "Refresh failed — retry", refreshing: entries.isPending }
        : null,
    truncatedNotice: entriesTruncated ? "Some workspace entries are not shown." : null,
  };
}
