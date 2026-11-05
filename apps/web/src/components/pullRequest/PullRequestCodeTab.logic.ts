import type {
  PullRequestCommit,
  PullRequestDetailView,
  PullRequestDiffSide,
  PullRequestOmittedFileStat,
  PullRequestReviewPosition,
  PullRequestReviewThread,
} from "@t3tools/contracts";

import {
  formatPullRequestDiffStat,
  type PullRequestDiffStatModel,
} from "./pullRequestPresentation.logic";

export const PULL_REQUEST_COMMIT_PAGE_SIZE = 10;

export const PULL_REQUEST_CODE_TOASTS = {
  loadMoreFailed: "More comments could not be loaded",
  replyFailed: "Reply could not be posted",
  commentSaveFailed: "The comment could not be saved",
  resolutionFailed: "The conversation could not be updated",
} as const;

export type PullRequestReviewAnchor = {
  readonly line: number;
  readonly side: PullRequestDiffSide;
};

export function getPullRequestReviewPositionAnchor(
  position: PullRequestReviewPosition,
): PullRequestReviewAnchor {
  switch (position.kind) {
    case "added":
      return { line: position.newLine, side: "right" };
    case "deleted":
      return { line: position.oldLine, side: "left" };
    case "context":
      return {
        line: position.side === "left" ? position.oldLine : position.newLine,
        side: position.side,
      };
  }
}

export type PullRequestCodeReviewCapabilities = {
  readonly inlineComment: boolean;
  readonly reply: boolean;
  readonly resolve: boolean;
  readonly canCommentOnLines: boolean;
};

export function resolvePullRequestCodeReviewCapabilities(
  detail: Pick<PullRequestDetailView, "capabilities" | "viewerPermissions">,
  commit: string | null,
): PullRequestCodeReviewCapabilities {
  const hostReview = detail.capabilities.review;
  const viewer = detail.viewerPermissions;
  const inlineComment = hostReview.inlineComment && viewer.comment;
  return {
    inlineComment,
    reply: hostReview.reply && viewer.comment,
    resolve: hostReview.resolve && viewer.resolve,
    canCommentOnLines: inlineComment && commit === null,
  };
}

export function orderPullRequestCommits(
  commits: ReadonlyArray<PullRequestCommit>,
): ReadonlyArray<PullRequestCommit> {
  return commits.toSorted(
    (left, right) => Date.parse(right.committedDate) - Date.parse(left.committedDate),
  );
}

export function resolvePullRequestDiffScope(value: string): string | null {
  return value === "all" ? null : value;
}

export function pullRequestFileDiffStat(input: {
  readonly hunks: ReadonlyArray<{ readonly additionLines: number; readonly deletionLines: number }>;
  readonly omitted: Pick<PullRequestOmittedFileStat, "additions" | "deletions"> | undefined;
}): { readonly additions: number; readonly deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of input.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  if (additions === 0 && deletions === 0 && input.omitted) {
    return { additions: input.omitted.additions, deletions: input.omitted.deletions };
  }
  return { additions, deletions };
}

export type PullRequestFileViewedModel = {
  readonly checked: boolean;
  readonly stale: boolean;
  readonly ariaLabel: string;
  readonly label: string;
  readonly staleTooltip: string | null;
};

export type PullRequestCodeFileHeaderModel = {
  readonly additions: number;
  readonly deletions: number;
  readonly diffStat: PullRequestDiffStatModel | null;
  readonly viewed: PullRequestFileViewedModel | null;
};

export function buildPullRequestCodeFileHeaderModel(input: {
  readonly additions: number;
  readonly deletions: number;
  readonly viewedEnabled: boolean;
  readonly viewed: boolean;
  readonly stale: boolean;
  readonly locale?: string | undefined;
}): PullRequestCodeFileHeaderModel {
  return {
    additions: input.additions,
    deletions: input.deletions,
    diffStat: formatPullRequestDiffStat(input.additions, input.deletions, input.locale),
    viewed: input.viewedEnabled
      ? {
          checked: input.viewed,
          stale: input.stale,
          ariaLabel: input.stale ? "Changed" : "Viewed",
          label: input.stale ? "Changed" : "Viewed",
          staleTooltip: input.stale
            ? "This file has been pushed to since you marked it viewed."
            : null,
        }
      : null,
  };
}

export type PullRequestCodeFileInput = {
  readonly key: string;
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly collapsed: boolean;
  readonly viewed: boolean;
  readonly stale: boolean;
};

export type PullRequestCodeFileRowModel = {
  readonly key: string;
  readonly path: string;
  readonly collapsed: boolean;
  readonly collapseAriaLabel: string;
  readonly header: PullRequestCodeFileHeaderModel;
};

export type PullRequestCodeScopeOptionModel = {
  readonly value: string;
  readonly label: string;
  readonly shortOid: string | null;
};

export type PullRequestCodeWarningModel = {
  readonly id: "viewed-store" | "viewed-error" | "viewed-truncated" | "withheld" | "commit-scope";
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type PullRequestCodeToolbarModel = {
  readonly scope: {
    readonly visible: boolean;
    readonly label: string;
    readonly ariaLabel: string;
    readonly value: string;
    readonly options: ReadonlyArray<PullRequestCodeScopeOptionModel>;
    readonly showMoreLabel: string | null;
  };
  readonly fileCountLabel: string;
  readonly viewed: {
    readonly countLabel: string;
    readonly suffix: string;
    readonly warnings: ReadonlyArray<PullRequestCodeWarningModel>;
  } | null;
  readonly warnings: ReadonlyArray<PullRequestCodeWarningModel>;
  readonly whitespace: { readonly pressed: boolean; readonly label: string };
  readonly collapseAll: {
    readonly visible: boolean;
    readonly allCollapsed: boolean;
    readonly label: string;
  };
  readonly layout: {
    readonly value: "stacked" | "split";
    readonly ariaLabel: string;
    readonly options: ReadonlyArray<{
      readonly value: "stacked" | "split";
      readonly ariaLabel: string;
    }>;
  };
  readonly wordWrap: {
    readonly pressed: boolean;
    readonly ariaLabel: string;
    readonly tooltip: string;
  };
  readonly fileTree: {
    readonly visible: boolean;
    readonly pressed: boolean;
    readonly label: string;
  };
};

export type PullRequestCodeBodyModel =
  | { readonly kind: "loading"; readonly label: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "raw" }
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "files" };

export type PullRequestCodeFooterModel =
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string; readonly retryLabel: string }
  | { readonly kind: "loading"; readonly label: string }
  | { readonly kind: "idle" };

export type PullRequestCodeOrphansModel = {
  readonly heading: string;
  readonly countLabel: string;
  readonly srLabel: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly threads: ReadonlyArray<{
      readonly id: string;
      readonly lineLabel: string | null;
    }>;
  }>;
} | null;

export type PullRequestCodeTabInput = {
  readonly detailNumber: number;
  readonly commits: ReadonlyArray<PullRequestCommit>;
  readonly selectedCommitOid: string | null;
  readonly visibleCommitCount: number;
  readonly files: ReadonlyArray<PullRequestCodeFileInput>;
  readonly hasMore: boolean;
  readonly diffPending: boolean;
  readonly diffError: string | null;
  readonly loadedSliceCount: number;
  readonly rawSliceCount: number;
  readonly withheldContent: boolean;
  readonly inlineComment: boolean;
  readonly viewed: {
    readonly enabled: boolean;
    readonly count: number;
    readonly store: "host" | "environment" | undefined;
    readonly error: string | null;
    readonly truncated: boolean;
  };
  readonly appBaseName: string;
  readonly ignoreWhitespace: boolean;
  readonly wordWrap: boolean;
  readonly fileTreeOpen: boolean;
  readonly allFilesCollapsed: boolean;
  readonly diffLayout: "stacked" | "split";
  readonly orphanThreads: ReadonlyArray<PullRequestReviewThread>;
  readonly locale?: string | undefined;
};

export type PullRequestCodeTabModel = {
  readonly toolbar: PullRequestCodeToolbarModel;
  readonly body: PullRequestCodeBodyModel;
  readonly files: ReadonlyArray<PullRequestCodeFileRowModel>;
  readonly orphans: PullRequestCodeOrphansModel;
  readonly footer: PullRequestCodeFooterModel;
  readonly fileTree: {
    readonly ariaLabel: string;
    readonly footer: {
      readonly label: string;
      readonly disabled: boolean;
      readonly action: "retry" | "load";
    } | null;
  };
};

export function groupPullRequestOrphanThreads(
  threads: ReadonlyArray<PullRequestReviewThread>,
): ReadonlyMap<string, ReadonlyArray<PullRequestReviewThread>> {
  const files = new Map<string, PullRequestReviewThread[]>();
  for (const thread of threads) {
    const existing = files.get(thread.path);
    if (existing) existing.push(thread);
    else files.set(thread.path, [thread]);
  }
  return files;
}

function buildToolbarModel(input: PullRequestCodeTabInput): PullRequestCodeToolbarModel {
  const ordered = orderPullRequestCommits(input.commits);
  const selected = ordered.find((entry) => entry.oid === input.selectedCommitOid);
  const scopeLabel = selected ? selected.messageHeadline : "All commits";
  const fileCount = input.files.length;
  const viewedWarnings: PullRequestCodeWarningModel[] = [];
  if (input.viewed.store === "environment") {
    viewedWarnings.push({
      id: "viewed-store",
      ariaLabel: "These ticks are kept here, not on the host",
      tooltip:
        "This host keeps no shared record of which files you have read, so these ticks are kept by this environment. They follow you between the apps connected to it, but the host's own web UI will not show them.",
    });
  }
  if (input.viewed.error !== null) {
    viewedWarnings.push({
      id: "viewed-error",
      ariaLabel: "Your ticks could not be read",
      tooltip: `The boxes below are whatever was last read, and empty if nothing has been read yet. ${input.viewed.error}`,
    });
  }
  if (input.viewed.truncated) {
    viewedWarnings.push({
      id: "viewed-truncated",
      ariaLabel: "This count covers only part of the change",
      tooltip:
        "This change has more files than the host will report ticks for in one read, so the count is short and some boxes below start empty.",
    });
  }
  const warnings: PullRequestCodeWarningModel[] = [];
  if (input.withheldContent) {
    warnings.push({
      id: "withheld",
      ariaLabel: "Some of this diff was not shown",
      tooltip:
        "The host withheld part of this diff — a binary file, or a change too large to inline.",
    });
  }
  if (input.selectedCommitOid !== null && input.inlineComment) {
    warnings.push({
      id: "commit-scope",
      ariaLabel: "Line comments are written from the whole change",
      tooltip: "A comment is anchored to the whole change, so switch to All commits to write one.",
    });
  }
  const hasFiles = fileCount > 0;
  return {
    scope: {
      visible: ordered.length > 0,
      label: scopeLabel,
      ariaLabel: `Diff scope: ${scopeLabel}`,
      value: input.selectedCommitOid ?? "all",
      options: [
        { value: "all", label: "All commits", shortOid: null },
        ...ordered.slice(0, input.visibleCommitCount).map((entry) => ({
          value: entry.oid,
          label: entry.messageHeadline,
          shortOid: entry.oid.slice(0, 7),
        })),
      ],
      showMoreLabel:
        ordered.length > input.visibleCommitCount
          ? `Show more (${ordered.length - input.visibleCommitCount} left)`
          : null,
    },
    fileCountLabel: `${fileCount} ${fileCount === 1 ? "file" : "files"}${input.hasMore ? "+" : ""}`,
    viewed:
      input.viewed.enabled && hasFiles
        ? {
            countLabel: `${input.viewed.count} / ${fileCount}`,
            suffix:
              input.viewed.store === "environment" ? `viewed in ${input.appBaseName}` : "viewed",
            warnings: viewedWarnings,
          }
        : null,
    warnings,
    whitespace: {
      pressed: input.ignoreWhitespace,
      label: input.ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes",
    },
    collapseAll: {
      visible: hasFiles,
      allCollapsed: input.allFilesCollapsed,
      label: input.allFilesCollapsed ? "Expand all files" : "Collapse all files",
    },
    layout: {
      value: input.diffLayout,
      ariaLabel: "Diff layout",
      options: [
        { value: "stacked", ariaLabel: "Stacked diff view" },
        { value: "split", ariaLabel: "Split diff view" },
      ],
    },
    wordWrap: {
      pressed: input.wordWrap,
      ariaLabel: input.wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping",
      tooltip: input.wordWrap ? "Disable line wrapping" : "Enable line wrapping",
    },
    fileTree: {
      visible: hasFiles,
      pressed: input.fileTreeOpen,
      label: input.fileTreeOpen ? "Hide file tree" : "Show file tree",
    },
  };
}

export function buildPullRequestCodeTabModel(
  input: PullRequestCodeTabInput,
): PullRequestCodeTabModel {
  const commitScoped = input.selectedCommitOid !== null;
  const body: PullRequestCodeBodyModel =
    input.diffPending && input.loadedSliceCount === 0
      ? { kind: "loading", label: "Loading pull request diff..." }
      : input.diffError && input.loadedSliceCount === 0
        ? { kind: "error", message: input.diffError }
        : input.files.length === 0 && input.rawSliceCount > 0
          ? { kind: "raw" }
          : input.files.length === 0 && !input.hasMore
            ? {
                kind: "empty",
                message: commitScoped
                  ? "This commit has no file changes."
                  : "This pull request has no file changes.",
              }
            : { kind: "files" };
  const orphanFiles = groupPullRequestOrphanThreads(input.orphanThreads);
  const orphanCount = input.orphanThreads.length;
  return {
    toolbar: buildToolbarModel(input),
    body,
    files: input.files.map((file) => ({
      key: file.key,
      path: file.path,
      collapsed: file.collapsed,
      collapseAriaLabel: file.collapsed ? "Expand diff" : "Collapse diff",
      header: buildPullRequestCodeFileHeaderModel({
        additions: file.additions,
        deletions: file.deletions,
        viewedEnabled: input.viewed.enabled,
        viewed: file.viewed,
        stale: file.stale,
        locale: input.locale,
      }),
    })),
    orphans:
      orphanFiles.size > 0
        ? {
            heading: input.hasMore
              ? "Conversations not on the diff loaded so far"
              : "Conversations not on the current diff",
            countLabel: String(orphanCount),
            srLabel: orphanCount === 1 ? "1 conversation" : `${orphanCount} conversations`,
            files: [...orphanFiles].map(([path, threads]) => ({
              path,
              threads: threads.map((thread) => ({
                id: thread.id,
                lineLabel: thread.line === null ? null : `Line ${thread.line}`,
              })),
            })),
          }
        : null,
    footer: buildPullRequestCodeFooterModel({
      hasMore: input.hasMore,
      error: input.diffError,
      pending: input.diffPending,
    }),
    fileTree: {
      ariaLabel: `Pull request #${input.detailNumber} files`,
      footer: input.hasMore
        ? {
            label:
              input.diffError !== null
                ? "Retry"
                : input.diffPending
                  ? "Loading more files..."
                  : "Load more files",
            disabled: input.diffPending,
            action: input.diffError !== null ? "retry" : "load",
          }
        : null,
    },
  };
}

export function pullRequestDraftRangeLabel(
  path: string,
  position: PullRequestReviewPosition,
): string {
  return `${path}:${getPullRequestReviewPositionAnchor(position).line}`;
}

export function buildPullRequestCodeFooterModel(input: {
  readonly hasMore: boolean;
  readonly error: string | null;
  readonly pending: boolean;
}): PullRequestCodeFooterModel {
  if (!input.hasMore) return { kind: "none" };
  if (input.error !== null) {
    return {
      kind: "error",
      message: "The rest of this diff could not be loaded.",
      retryLabel: "Retry",
    };
  }
  return input.pending ? { kind: "loading", label: "Loading more files..." } : { kind: "idle" };
}
