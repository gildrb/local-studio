import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";

import {
  findProjectForChangeRequest,
  findProjectOnChangeRequestHost,
} from "./changeRequestProjects";

export type ChangeRequestEnvironmentCapabilities = {
  readonly pullRequests?: boolean | undefined;
  readonly threadPullRequests?: boolean | undefined;
};

export type ChangeRequestPanelSurface = {
  readonly environmentId?: string;
  readonly projectId: string;
  readonly host?: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
};

export type ChangeRequestPageSearch = {
  readonly repository: string;
  readonly number: number;
  readonly selectedHost: string;
  readonly selectedProjectId: ProjectId;
  readonly selectedEnvironmentId: EnvironmentId;
};

export type ChangeRequestLinkTarget =
  | {
      readonly kind: "panel";
      readonly panelRef: ScopedThreadRef;
      readonly surface: ChangeRequestPanelSurface;
      readonly page: ChangeRequestPageSearch | null;
    }
  | { readonly kind: "page"; readonly search: ChangeRequestPageSearch };

/**
 * Where a change request link opens inside the app: the thread's own panel, or the pull requests
 * page. Null when no project can read it, so it stays an ordinary link.
 */
export function resolveChangeRequestLinkTarget(input: {
  readonly url: string;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly panelRef: ScopedThreadRef | undefined;
  readonly targetEnvironmentId: EnvironmentId | undefined;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly capabilitiesOf: (
    environmentId: EnvironmentId,
  ) => ChangeRequestEnvironmentCapabilities | undefined;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): ChangeRequestLinkTarget | null {
  const { threadRef, capabilitiesOf } = input;
  const panelRef = input.panelRef ?? threadRef;
  const parsed = parseChangeRequestUrl(input.url);
  if (parsed === null) return null;
  const reads = (environmentId: EnvironmentId) =>
    capabilitiesOf(environmentId)?.pullRequests === true;
  const linksThreads = (environmentId: EnvironmentId) =>
    capabilitiesOf(environmentId)?.threadPullRequests === true;
  // Beside a thread the panel reads on that thread's environment, so a project from another
  // one could not be read there whatever its remote says. The page has no such tie, so the
  // link is resolved against every server, the primary first.
  const projects = threadRef
    ? input.projects.filter((project) => project.environmentId === threadRef.environmentId)
    : input.targetEnvironmentId
      ? input.projects.filter((project) => project.environmentId === input.targetEnvironmentId)
      : input.projects
          .filter((project) => reads(project.environmentId))
          .toSorted(
            (left, right) =>
              Number(right.environmentId === input.primaryEnvironmentId) -
              Number(left.environmentId === input.primaryEnvironmentId),
          );
  const project =
    findProjectForChangeRequest(projects, parsed) ??
    (panelRef
      ? findProjectOnChangeRequestHost(
          projects.filter((candidate) => linksThreads(candidate.environmentId)),
          parsed,
        )
      : undefined);
  if (project === undefined || !reads(project.environmentId)) return null;
  const threadLinks = linksThreads(project.environmentId);
  const repository = threadLinks
    ? parsed.repository
    : (sourceControlRepositorySelector(project.repositoryIdentity) ?? parsed.repository);
  const search: ChangeRequestPageSearch = {
    repository,
    number: parsed.number,
    selectedHost: parsed.authority ?? parsed.host,
    selectedProjectId: project.id,
    selectedEnvironmentId: project.environmentId,
  };
  if (panelRef) {
    return {
      kind: "panel",
      panelRef,
      surface: {
        ...(panelRef.environmentId === project.environmentId
          ? {}
          : { environmentId: project.environmentId }),
        projectId: project.id,
        ...(threadLinks ? { host: parsed.authority ?? parsed.host } : {}),
        repository,
        url: input.url,
        number: parsed.number,
      },
      page: threadRef ? null : search,
    };
  }
  return { kind: "page", search };
}
