import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";

export type ScratchProjectEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: { readonly scratchWorkspaceRoot?: string | null | undefined } | null;
};

export function scratchWorkspaceRootFor(
  environments: ReadonlyArray<ScratchProjectEnvironment>,
  environmentId: EnvironmentId | null,
): string | null {
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  return environment?.connection.phase === "connected"
    ? (environment.serverConfig?.scratchWorkspaceRoot ?? null)
    : null;
}

export function scratchEnvironmentIdFor(
  environments: ReadonlyArray<ScratchProjectEnvironment>,
  current: EnvironmentId | null,
): EnvironmentId | null {
  if (current !== null) {
    return scratchWorkspaceRootFor(environments, current) !== null ? current : null;
  }
  const offering = environments.filter(
    (entry) => scratchWorkspaceRootFor(environments, entry.environmentId) !== null,
  );
  return offering.length === 1 ? (offering[0]?.environmentId ?? null) : null;
}

export interface OpenScratchProjectDeps {
  readonly ensureScratch: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: Record<string, never>;
  }) => Promise<AtomCommandResult<{ readonly projectId: ProjectId }, unknown>>;
  readonly waitForProject: (ref: ScopedProjectRef) => Promise<EnvironmentProject>;
  readonly reportFailure: (error: unknown) => void;
}

/** Resolves to the scratch project once it is in this client's store. */
export async function openScratchProject(
  deps: OpenScratchProjectDeps,
  environmentId: EnvironmentId,
): Promise<EnvironmentProject | null> {
  const result = await deps.ensureScratch({ environmentId, input: {} });
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) {
      deps.reportFailure(squashAtomCommandFailure(result));
    }
    return null;
  }
  // Drafts key off the project's stored path and settings, so wait for
  // the create event to reach the store before targeting one.
  return deps
    .waitForProject(scopeProjectRef(environmentId, result.value.projectId))
    .catch((error: unknown) => {
      deps.reportFailure(error);
      return null;
    });
}
