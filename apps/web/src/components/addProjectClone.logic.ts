import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  addProjectRemoteSourceProvider,
  getCloneDestinationPath,
  getCloneDirectoryName,
  getDefaultCloneUrl,
  normalizePastedCloneUrl,
  type AddProjectCloneFlow,
  type AddProjectRemoteProviderKind,
} from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  SourceControlRepositoryInfo,
} from "@t3tools/contracts";

import {
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";

export interface AddProjectCloneDeps {
  readonly lookupRepository: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: {
      readonly provider: AddProjectRemoteProviderKind;
      readonly repository: string;
    };
  }) => Promise<AtomCommandResult<SourceControlRepositoryInfo, unknown>>;
  readonly cloneRepository: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly remoteUrl: string; readonly destinationPath: string };
  }) => Promise<AtomCommandResult<{ readonly cwd: string }, unknown>>;
  readonly startProjectClone: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: {
      readonly projectId: ProjectId;
      readonly title: string;
      readonly createdAt: string;
      readonly remoteUrl: string;
      readonly destinationPath: string;
    };
  }) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly addProject: (cwd: string) => Promise<void>;
  readonly waitForProject: (ref: ScopedProjectRef) => Promise<unknown>;
  readonly openNewThread: (ref: ScopedProjectRef) => Promise<unknown>;
  readonly newProjectId: () => ProjectId;
  readonly showError: (toast: { readonly title: string; readonly description: string }) => void;
  readonly close: () => void;
  readonly startLookup: () => number;
  readonly isCurrentLookup: (generation: number) => boolean;
  readonly finishLookup: () => void;
  readonly setCloning: (cloning: boolean) => void;
}

export interface AddProjectCloneInput {
  readonly flow: AddProjectCloneFlow;
  readonly query: string;
  readonly destinationPathInput?: string | undefined;
  readonly environment: { readonly connected: boolean; readonly label: string | null };
  readonly isLookingUp: boolean;
  readonly isCloning: boolean;
  readonly defaultCloneParentPath: string;
  readonly platform: string;
  readonly currentProjectCwd: string | null;
  readonly cloneTracking: boolean;
}

export type AddProjectCloneStep = {
  readonly flow: AddProjectCloneFlow;
  readonly query: string;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "An error occurred.";
}

export async function submitAddProjectClone(
  deps: AddProjectCloneDeps,
  input: AddProjectCloneInput,
): Promise<AddProjectCloneStep | null> {
  const { flow } = input;
  if (!input.environment.connected) {
    deps.showError({
      title: "Environment unavailable",
      description: `${input.environment.label ?? "The selected environment"} is not connected.`,
    });
    return null;
  }

  if (flow.step === "repository") {
    const rawRepository = input.query.trim();
    if (rawRepository.length === 0 || input.isLookingUp) return null;

    const provider = addProjectRemoteSourceProvider(flow.source);
    if (!provider) {
      return {
        flow: {
          step: "confirm",
          environmentId: flow.environmentId,
          source: flow.source,
          repositoryInput: rawRepository,
          repository: null,
          remoteUrl: normalizePastedCloneUrl(rawRepository),
        },
        query: getCloneDestinationPath(
          input.defaultCloneParentPath,
          getCloneDirectoryName(rawRepository),
        ),
      };
    }

    const generation = deps.startLookup();
    const lookupResult = await deps.lookupRepository({
      environmentId: flow.environmentId,
      input: { provider, repository: rawRepository },
    });
    if (!deps.isCurrentLookup(generation)) return null;
    deps.finishLookup();
    if (lookupResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(lookupResult)) {
        deps.showError({
          title: "Repository lookup failed",
          description: errorMessage(squashAtomCommandFailure(lookupResult)),
        });
      }
      return null;
    }
    const repository = lookupResult.value;
    return {
      flow: {
        step: "confirm",
        environmentId: flow.environmentId,
        source: flow.source,
        repositoryInput: rawRepository,
        repository,
        remoteUrl: getDefaultCloneUrl(repository),
      },
      query: getCloneDestinationPath(
        input.defaultCloneParentPath,
        getCloneDirectoryName(repository.nameWithOwner),
      ),
    };
  }

  const rawDestination = (input.destinationPathInput ?? input.query).trim();
  if (rawDestination.length === 0 || input.isCloning) return null;

  if (isUnsupportedWindowsProjectPath(rawDestination, input.platform)) {
    deps.showError({
      title: "Clone failed",
      description: "Windows-style paths are only supported on Windows.",
    });
    return null;
  }

  if (isExplicitRelativeProjectPath(rawDestination) && !input.currentProjectCwd) {
    deps.showError({
      title: "Clone failed",
      description: "Relative paths require an active project.",
    });
    return null;
  }

  const destinationPath = resolveProjectPathForDispatch(rawDestination, input.currentProjectCwd);
  if (destinationPath.length === 0) return null;

  if (!input.cloneTracking) {
    deps.setCloning(true);
    const cloneResult = await deps.cloneRepository({
      environmentId: flow.environmentId,
      input: { remoteUrl: flow.remoteUrl, destinationPath },
    });
    deps.setCloning(false);
    if (cloneResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(cloneResult)) {
        deps.showError({
          title: "Clone failed",
          description: errorMessage(squashAtomCommandFailure(cloneResult)),
        });
      }
      return null;
    }
    await deps.addProject(cloneResult.value.cwd);
    return null;
  }

  const projectId = deps.newProjectId();
  deps.setCloning(true);
  const startResult = await deps.startProjectClone({
    environmentId: flow.environmentId,
    input: {
      projectId,
      title: inferProjectTitleFromPath(destinationPath),
      createdAt: new Date().toISOString(),
      remoteUrl: flow.remoteUrl,
      destinationPath,
    },
  });
  deps.setCloning(false);
  if (startResult._tag === "Failure") {
    if (!isAtomCommandInterrupted(startResult)) {
      deps.showError({
        title: "Clone failed",
        description: errorMessage(squashAtomCommandFailure(startResult)),
      });
    }
    return null;
  }
  deps.close();
  const projectRef = scopeProjectRef(flow.environmentId, projectId);
  await deps.waitForProject(projectRef).catch(() => null);
  const navigationResult = await settlePromise(() => deps.openNewThread(projectRef));
  if (navigationResult._tag === "Failure") {
    const error = squashAtomCommandFailure(navigationResult);
    deps.showError({
      title: "Failed to open project",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return null;
}
