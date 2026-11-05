import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import type { CreateProjectInput } from "@t3tools/client-runtime/state/projects";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";

import {
  findProjectByPath,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { getLatestThreadForProject } from "../lib/threadSort";
import { newProjectId } from "../lib/utils";

export interface AddProjectInput {
  readonly environmentId: EnvironmentId;
  readonly rawCwd: string;
  readonly platform: string;
  readonly currentProjectCwd: string | null;
}

export interface AddProjectErrorToast {
  readonly title: string;
  readonly description: string;
}

export interface AddProjectDeps {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly connection: { readonly phase: EnvironmentConnectionPhase };
  }>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly createProject: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: CreateProjectInput;
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly navigateToThread: (threadRef: ScopedThreadRef) => Promise<void>;
  readonly openNewThread: (projectRef: ScopedProjectRef) => Promise<unknown>;
  readonly showError: (toast: AddProjectErrorToast) => void;
}

/**
 * Adds the folder at `rawCwd` as a project, or opens it when it is already
 * one: its latest unsettled thread, else a new draft. Resolves `true` when
 * the caller's surface (palette, picker) can close.
 */
export async function addProjectFromPath(
  deps: AddProjectDeps,
  input: AddProjectInput,
): Promise<boolean> {
  const environment = deps.environments.find(
    (candidate) => candidate.environmentId === input.environmentId,
  );
  if (!canCreateProjectInEnvironment(environment?.connection.phase)) {
    deps.showError({
      title: "Environment unavailable",
      description: `${environment?.label ?? "The selected environment"} is not connected.`,
    });
    return false;
  }
  const rawCwd = input.rawCwd;

  if (isUnsupportedWindowsProjectPath(rawCwd.trim(), input.platform)) {
    deps.showError({
      title: "Failed to add project",
      description: "Windows-style paths are only supported on Windows.",
    });
    return false;
  }

  if (isExplicitRelativeProjectPath(rawCwd.trim()) && !input.currentProjectCwd) {
    deps.showError({
      title: "Failed to add project",
      description: "Relative paths require an active project.",
    });
    return false;
  }

  const cwd = resolveProjectPathForDispatch(rawCwd, input.currentProjectCwd);
  if (cwd.length === 0) return false;

  const existing = findProjectByPath(
    deps.projects.filter((project) => project.environmentId === input.environmentId),
    cwd,
  );
  if (existing) {
    const latestThread = getLatestThreadForProject(
      deps.threads.filter((thread) => thread.environmentId === existing.environmentId),
      existing.id,
      deps.threadSortOrder,
    );
    if (latestThread && latestThread.settledOverride !== "settled") {
      await deps.navigateToThread(scopeThreadRef(latestThread.environmentId, latestThread.id));
    } else {
      const navigationResult = await settlePromise(() =>
        deps.openNewThread(scopeProjectRef(existing.environmentId, existing.id)),
      );
      if (navigationResult._tag === "Failure") {
        const error = squashAtomCommandFailure(navigationResult);
        deps.showError({
          title: "Failed to open project",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        return false;
      }
    }
    return true;
  }

  const projectId = newProjectId();
  const createResult = await deps.createProject({
    environmentId: input.environmentId,
    input: {
      projectId,
      title: inferProjectTitleFromPath(cwd),
      workspaceRoot: cwd,
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: null,
    },
  });
  if (createResult._tag === "Failure") {
    if (!isAtomCommandInterrupted(createResult)) {
      const error = squashAtomCommandFailure(createResult);
      deps.showError({
        title: "Failed to add project",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
    return false;
  }

  const navigationResult = await settlePromise(() =>
    deps.openNewThread(scopeProjectRef(input.environmentId, projectId)),
  );
  if (navigationResult._tag === "Failure") {
    const error = squashAtomCommandFailure(navigationResult);
    deps.showError({
      title: "Failed to add project",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
    return false;
  }
  return true;
}
