import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ArchivedSnapshotEntry } from "@t3tools/client-runtime/state/threads";
import type {
  ContextMenuItem,
  EnvironmentId,
  OrchestrationThreadShell,
  ThreadId,
} from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ResolvedSettingsScope } from "./settingsScope";
import { searchableSetting } from "./settingsSearch";

export type ArchivedThreadMenuItemId = "unarchive" | "delete";

export type ArchivedThreadsScope = {
  readonly kind: ResolvedSettingsScope["kind"];
  readonly members: readonly { readonly environmentId: EnvironmentId; readonly id: string }[];
};

export type ArchivedThreadsSettingsModelInput = {
  readonly snapshots: readonly ArchivedSnapshotEntry[];
  readonly scope: ArchivedThreadsScope;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly now: number;
};

export type ArchivedThreadsProject = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "workspaceRoot" | "faviconPath" | "projectIcon"
>;

export type ArchivedThreadsEmptyState = {
  readonly sectionId: string | null;
  readonly sectionTitle: string;
  readonly icon: "spinner" | "archive";
  readonly title: string;
  readonly description: string;
};

export type ArchivedThreadPrimaryAction = {
  readonly kind: "unarchive";
  readonly label: string;
  readonly icon: "archive-x";
};

export type ArchivedThreadRow = {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly archivedAtLabel: string;
  readonly createdAtLabel: string;
  readonly description: string;
  readonly primaryAction: ArchivedThreadPrimaryAction;
};

export type ArchivedThreadGroup = {
  readonly id: string;
  readonly sectionId: string | null;
  readonly title: string;
  readonly project: ArchivedThreadsProject;
  readonly threads: readonly ArchivedThreadRow[];
};

export type ArchivedThreadsSettingsModel = {
  readonly emptyState: ArchivedThreadsEmptyState | null;
  readonly groups: readonly ArchivedThreadGroup[];
  readonly contextMenuItems: readonly ContextMenuItem<ArchivedThreadMenuItemId>[];
};

export type ArchivedThreadActionInput =
  | { readonly source: "button" }
  | { readonly source: "context-menu"; readonly clicked: ArchivedThreadMenuItemId | null };

export type ArchivedThreadActionIntent =
  | { readonly kind: "unarchive" }
  | { readonly kind: "delete" }
  | { readonly kind: "none" };

export type ArchivedThreadActionOutcome =
  | { readonly kind: "success" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "failure"; readonly error: unknown };

export type ArchivedThreadActionOutcomeInput = {
  readonly action: "unarchive" | "delete" | "menu";
  readonly outcome: ArchivedThreadActionOutcome;
};

export type ArchivedThreadActionEffect =
  | { readonly kind: "refresh" }
  | { readonly kind: "none" }
  | { readonly kind: "toast"; readonly title: string; readonly description: string };

const ARCHIVED_THREAD_CONTEXT_MENU_ITEMS: readonly ContextMenuItem<ArchivedThreadMenuItemId>[] = [
  { id: "unarchive", label: "Unarchive" },
  { id: "delete", label: "Delete", destructive: true },
];

const ARCHIVED_THREAD_PRIMARY_ACTION: ArchivedThreadPrimaryAction = {
  kind: "unarchive",
  label: "Unarchive",
  icon: "archive-x",
};

const ARCHIVED_THREAD_FAILURE_TITLES = {
  unarchive: "Failed to unarchive thread",
  delete: "Failed to delete thread",
  menu: "Archived thread action failed",
} as const;

function projectKey(environmentId: EnvironmentId, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

function buildArchivedThreadRow(
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
  now: number,
): ArchivedThreadRow {
  const archivedAtLabel = formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt, now);
  const createdAtLabel = formatRelativeTimeLabel(thread.createdAt, now);
  return {
    id: thread.id,
    environmentId,
    title: thread.title,
    archivedAtLabel,
    createdAtLabel,
    description: `Archived ${archivedAtLabel} \u00b7 Created ${createdAtLabel}`,
    primaryAction: ARCHIVED_THREAD_PRIMARY_ACTION,
  };
}

export function buildArchivedThreadsSettingsModel(
  input: ArchivedThreadsSettingsModelInput,
): ArchivedThreadsSettingsModel {
  const archiveSetting = searchableSetting("archive");
  const selectedProjectKeys =
    input.scope.kind === "project" || input.scope.kind === "checkout"
      ? new Set(input.scope.members.map((member) => projectKey(member.environmentId, member.id)))
      : null;
  const projectsByEnvironmentAndId = new Map<string, ArchivedThreadsProject>();
  for (const { environmentId, snapshot } of input.snapshots) {
    for (const project of snapshot.projects) {
      const key = projectKey(environmentId, project.id);
      if (selectedProjectKeys !== null && !selectedProjectKeys.has(key)) continue;
      projectsByEnvironmentAndId.set(key, {
        environmentId,
        id: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        ...(project.faviconPath === undefined ? {} : { faviconPath: project.faviconPath }),
        ...(project.projectIcon === undefined ? {} : { projectIcon: project.projectIcon }),
      });
    }
  }
  const threads = input.snapshots.flatMap(({ environmentId, snapshot }) =>
    snapshot.threads.map((thread) => ({ thread, environmentId })),
  );

  const groups: ArchivedThreadGroup[] = [];
  for (const project of projectsByEnvironmentAndId.values()) {
    const projectThreads = threads
      .filter(
        ({ thread, environmentId }) =>
          thread.projectId === project.id && environmentId === project.environmentId,
      )
      .toSorted((left, right) => {
        const leftKey = left.thread.archivedAt ?? left.thread.createdAt;
        const rightKey = right.thread.archivedAt ?? right.thread.createdAt;
        return rightKey.localeCompare(leftKey) || right.thread.id.localeCompare(left.thread.id);
      });
    if (projectThreads.length === 0) continue;
    groups.push({
      id: projectKey(project.environmentId, project.id),
      sectionId: groups.length === 0 ? archiveSetting.id : null,
      title: project.title,
      project,
      threads: projectThreads.map(({ thread, environmentId }) =>
        buildArchivedThreadRow(thread, environmentId, input.now),
      ),
    });
  }

  const emptyState: ArchivedThreadsEmptyState | null =
    groups.length > 0
      ? null
      : {
          sectionId: input.isLoading ? null : archiveSetting.id,
          sectionTitle: archiveSetting.title,
          icon: input.isLoading ? "spinner" : "archive",
          title: input.isLoading
            ? "Loading archived threads"
            : input.error
              ? "Could not load archived threads"
              : "No archived threads",
          description: input.isLoading
            ? "Checking connected environments."
            : (input.error ?? "Archived threads will appear here."),
        };

  return {
    emptyState,
    groups,
    contextMenuItems: ARCHIVED_THREAD_CONTEXT_MENU_ITEMS,
  };
}

export function resolveArchivedThreadAction(
  input: ArchivedThreadActionInput,
): ArchivedThreadActionIntent {
  if (input.source === "button") return { kind: "unarchive" };
  if (input.clicked === "unarchive") return { kind: "unarchive" };
  if (input.clicked === "delete") return { kind: "delete" };
  return { kind: "none" };
}

export function resolveArchivedThreadActionOutcome(
  input: ArchivedThreadActionOutcomeInput,
): ArchivedThreadActionEffect {
  switch (input.outcome.kind) {
    case "success":
      return input.action === "menu" ? { kind: "none" } : { kind: "refresh" };
    case "interrupted":
      return { kind: "none" };
    case "failure":
      return {
        kind: "toast",
        title: ARCHIVED_THREAD_FAILURE_TITLES[input.action],
        description:
          input.outcome.error instanceof Error ? input.outcome.error.message : "An error occurred.",
      };
  }
}
