import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import type { PullRequestGlyphId } from "./pullRequestPresentation.logic";

export type PullRequestThreadLinksInput = {
  readonly linkedHere: boolean;
  readonly hasCurrentThread: boolean;
  readonly linkedThreadCount: number;
  readonly relationsError: boolean;
  readonly pending: boolean;
};

export type PullRequestThreadLinksModel = {
  readonly count: {
    readonly visible: boolean;
    readonly ariaLabel: string;
    readonly countLabel: string;
    readonly tooltip: string;
  };
  readonly menuItem: {
    readonly label: string;
    readonly icon: Extract<PullRequestGlyphId, "link" | "unlink">;
    readonly disabled: boolean;
  };
  readonly pickerTitle: string;
};

export function buildPullRequestThreadLinksModel(
  input: PullRequestThreadLinksInput,
): PullRequestThreadLinksModel {
  const count = input.linkedThreadCount;
  const linkedThreadsLabel =
    count > 0 ? `Linked from ${count} ${count === 1 ? "thread" : "threads"}` : "Linked threads";
  return {
    count: {
      visible: count > 0 || input.relationsError,
      ariaLabel: linkedThreadsLabel,
      countLabel: count > 0 ? String(count) : "?",
      tooltip: `${linkedThreadsLabel}. Search in the command palette.`,
    },
    menuItem: {
      label: input.linkedHere
        ? "Unlink from this thread"
        : input.hasCurrentThread
          ? "Link to this thread"
          : "Link to thread",
      icon: input.linkedHere ? "unlink" : "link",
      disabled: input.pending,
    },
    pickerTitle: "Link pull request to a thread",
  };
}

export type PullRequestThreadLinkMenuAction =
  | { readonly kind: "change"; readonly threadId: ThreadId; readonly remove: boolean }
  | { readonly kind: "open-picker" };

export function resolvePullRequestThreadLinkMenuAction(input: {
  readonly currentThreadId: ThreadId | null;
  readonly linkedHere: boolean;
}): PullRequestThreadLinkMenuAction {
  return input.currentThreadId !== null
    ? { kind: "change", threadId: input.currentThreadId, remove: input.linkedHere }
    : { kind: "open-picker" };
}

export function pullRequestThreadLinkFailureToast(input: {
  readonly remove: boolean;
  readonly error: unknown;
}): { readonly type: "error"; readonly title: string; readonly description: string } {
  return {
    type: "error",
    title: input.remove ? "Could not unlink the pull request" : "Could not link the pull request",
    description: input.error instanceof Error ? input.error.message : String(input.error),
  };
}

export type PullRequestThreadPickerThread = {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
};

export type PullRequestThreadPickerProject = {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
};

export type PullRequestThreadPickerRowModel = {
  readonly id: ThreadId;
  readonly title: string;
  readonly projectTitle: string | null;
  readonly linked: boolean;
  readonly linkedLabel: string;
  readonly disabled: boolean;
};

export type PullRequestThreadPickerModel = {
  readonly ariaLabel: string;
  readonly searchPlaceholder: string;
  readonly searchDisabled: boolean;
  readonly emptyLabel: string | null;
  readonly rows: ReadonlyArray<PullRequestThreadPickerRowModel>;
};

export function buildPullRequestThreadPickerModel<
  Thread extends PullRequestThreadPickerThread,
>(input: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<Thread>;
  readonly projects: ReadonlyArray<PullRequestThreadPickerProject>;
  readonly query: string;
  readonly pending: boolean;
  readonly isLinked: (thread: Thread) => boolean;
}): PullRequestThreadPickerModel {
  const projectNames = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id, project.title]),
  );
  const search = input.query.trim().toLocaleLowerCase();
  const rows = input.threads
    .filter(
      (thread) =>
        thread.environmentId === input.environmentId &&
        thread.archivedAt === null &&
        `${thread.title} ${projectNames.get(thread.projectId) ?? ""}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((thread) => {
      const linked = input.isLinked(thread);
      return {
        id: thread.id,
        title: thread.title || "Untitled thread",
        projectTitle: projectNames.get(thread.projectId) ?? null,
        linked,
        linkedLabel: "Linked",
        disabled: input.pending || linked,
      };
    });
  return {
    ariaLabel: "Choose a thread",
    searchPlaceholder: "Search threads or projects...",
    searchDisabled: input.pending,
    emptyLabel: rows.length === 0 ? "No active threads found." : null,
    rows,
  };
}
