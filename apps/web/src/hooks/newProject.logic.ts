import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { getNewProjectGitHubRepository } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";

export interface NewProjectToast {
  readonly type: "success" | "warning" | "error";
  readonly title: string;
  readonly description: string;
}

export interface NewProjectDeps {
  readonly createNew: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly name: string };
  }) => Promise<
    AtomCommandResult<
      {
        readonly projectId: ProjectId;
        readonly workspaceRoot: string;
        readonly commitError?: string | undefined;
      },
      unknown
    >
  >;
  readonly publishRepository: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: {
      readonly cwd: string;
      readonly provider: "github";
      readonly repository: string;
      readonly visibility: "private";
    };
  }) => Promise<
    AtomCommandResult<{ readonly repository: { readonly nameWithOwner: string } }, unknown>
  >;
  readonly waitForProject: (ref: ScopedProjectRef) => Promise<unknown>;
  readonly openNewThread: (ref: ScopedProjectRef) => Promise<unknown>;
  readonly showToast: (toast: NewProjectToast) => void;
}

export interface NewProjectInput {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly github: { readonly account: string | null } | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

async function publishToGitHub(
  deps: Pick<NewProjectDeps, "publishRepository" | "showToast">,
  input: {
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string;
    readonly account: string | null;
  },
): Promise<void> {
  const result = await deps.publishRepository({
    environmentId: input.environmentId,
    input: {
      cwd: input.workspaceRoot,
      provider: "github",
      repository: getNewProjectGitHubRepository(input, input.workspaceRoot),
      visibility: "private",
    },
  });
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) {
      deps.showToast({
        type: "error",
        title: "Could not create the GitHub repository",
        description: `${errorMessage(squashAtomCommandFailure(result))} Use Publish Repository in the Git menu to try again.`,
      });
    }
    return;
  }
  deps.showToast({
    type: "success",
    title: "Published to GitHub",
    description: result.value.repository.nameWithOwner,
  });
}

export async function createNewProject(
  deps: NewProjectDeps,
  input: NewProjectInput,
): Promise<boolean> {
  const result = await deps.createNew({
    environmentId: input.environmentId,
    input: { name: input.name },
  });
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) {
      deps.showToast({
        type: "error",
        title: "Could not create the project",
        description: errorMessage(squashAtomCommandFailure(result)),
      });
    }
    return false;
  }

  const { projectId, workspaceRoot, commitError } = result.value;
  deps.showToast(
    commitError === undefined
      ? { type: "success", title: `Created ${input.name}`, description: workspaceRoot }
      : {
          type: "warning",
          title: `Created ${input.name} without a first commit`,
          description: `${commitError} The project is in ${workspaceRoot}.`,
        },
  );
  if (input.github) {
    void publishToGitHub(deps, {
      environmentId: input.environmentId,
      workspaceRoot,
      account: input.github.account,
    });
  }

  const projectRef = scopeProjectRef(input.environmentId, projectId);
  const project = await deps.waitForProject(projectRef).catch((error: unknown) => {
    deps.showToast({
      type: "error",
      title: "Failed to open project",
      description: `${errorMessage(error)} It will appear in the sidebar once this client catches up.`,
    });
    return null;
  });
  if (project === null) return true;
  await deps.openNewThread(projectRef).catch((error: unknown) => {
    deps.showToast({
      type: "error",
      title: "Failed to open project",
      description: errorMessage(error),
    });
  });
  return true;
}
