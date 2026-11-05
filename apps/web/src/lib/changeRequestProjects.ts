import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { pullRequestHostOf, SourceControlProviderKind } from "@t3tools/contracts";
import type { ChangeRequestLink } from "@t3tools/shared/changeRequestUrl";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";
import * as Schema from "effect/Schema";

const isProviderKind = Schema.is(SourceControlProviderKind);

function resolvedForgejoRepository(project: EnvironmentProject): URL | null {
  const identity = project.repositoryIdentity;
  if (identity?.provider !== "forgejo" || !identity.webUrl) return null;
  try {
    const url = new URL(identity.webUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Keep Forgejo servers on different HTTP ports separate when selecting a project. */
function matchesChangeRequestAuthority(
  project: EnvironmentProject,
  link: ChangeRequestLink,
): boolean {
  if (link.authority === undefined) return true;
  try {
    const remote = new URL(project.repositoryIdentity?.locator.remoteUrl ?? "");
    if (remote.protocol === "http:" || remote.protocol === "https:") {
      return remote.host.toLowerCase() === link.authority;
    }
  } catch {
    // SSH remotes do not specify the server's HTTP port; tea resolves the configured login.
  }
  return true;
}

/**
 * The project a link belongs to, or nothing. Matched the way the server matches: the repository
 * identity is the full path below the host where one was recorded — which is what nested GitLab
 * groups and Azure project paths need — and the host is the first segment of the canonical
 * remote, so github.com and an Enterprise install stay apart.
 */
export function findProjectForChangeRequest(
  projects: ReadonlyArray<EnvironmentProject>,
  link: ChangeRequestLink,
): EnvironmentProject | undefined {
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    if (!identity || !matchesChangeRequestAuthority(project, link)) return false;
    const kind = identity.provider;
    if (kind === undefined || !isProviderKind(kind)) return false;
    const web = resolvedForgejoRepository(project);
    if (web)
      return (
        web.host.toLowerCase() === (link.authority ?? link.host).toLowerCase() &&
        web.pathname.replace(/^\/+|\/+$/g, "").toLowerCase() === link.repository.toLowerCase()
      );
    if (kind === "azure-devops") {
      return (
        canonicalRepositoryKey(identity.canonicalKey.toLowerCase()) ===
        canonicalRepositoryKey(`${link.host}/${link.repository}`.toLowerCase())
      );
    }
    const repository =
      identity.displayName ??
      (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null);
    return (
      repository !== null &&
      repository.toLowerCase() === link.repository.toLowerCase() &&
      (pullRequestHostOf(identity, kind) === link.host.toLowerCase() ||
        pullRequestHostOf(identity, kind) === link.authority)
    );
  });
}

/**
 * Any project checked out from the link's host. Thread links are host-level, so a pull request
 * from a repository nobody has checked out is still linkable as long as one project on that
 * host can lend the server its credentials. The link's own project, when it exists, comes first.
 */
export function findProjectOnChangeRequestHost(
  projects: ReadonlyArray<EnvironmentProject>,
  link: ChangeRequestLink,
): EnvironmentProject | undefined {
  const own = findProjectForChangeRequest(projects, link);
  if (own !== undefined) return own;
  // Azure CLI reads use the checkout's organization and project, not host-wide credentials.
  if (
    canonicalRepositoryKey(`${link.host}/${link.repository}`.toLowerCase()).startsWith(
      "dev.azure.com/",
    )
  )
    return undefined;
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    const kind = identity?.provider;
    const web = resolvedForgejoRepository(project);
    if (web) {
      const mount = web.pathname
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .slice(0, -2)
        .join("/");
      return (
        web.host.toLowerCase() === (link.authority ?? link.host).toLowerCase() &&
        (!mount || link.repository.toLowerCase().startsWith(`${mount.toLowerCase()}/`))
      );
    }
    return (
      identity != null &&
      kind !== undefined &&
      isProviderKind(kind) &&
      kind !== "azure-devops" &&
      matchesChangeRequestAuthority(project, link) &&
      (pullRequestHostOf(identity, kind) === link.host.toLowerCase() ||
        pullRequestHostOf(identity, kind) === link.authority)
    );
  });
}
