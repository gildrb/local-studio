import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  planThreadPullRequestMutation,
  threadPullRequestLinkMode,
  type ThreadPullRequestMutation,
} from "@t3tools/client-runtime/thread-pull-request-compatibility";
import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ScopedThreadRef,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  matchesLinkedPullRequestUrl,
  parseChangeRequestUrl,
} from "@t3tools/shared/changeRequestUrl";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";

import {
  findProjectForChangeRequest,
  findProjectOnChangeRequestHost,
} from "~/lib/changeRequestProjects";

export type PullRequestLinkMode = "multiple" | "single" | "unsupported";

export type PullRequestLinkedThread = {
  readonly pullRequests?: readonly ThreadPullRequestLink[];
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
};

export type PullRequestLinkingRules = {
  readonly mode: PullRequestLinkMode;
  readonly canLink: (url: string) => boolean;
  readonly isLinked: (thread: PullRequestLinkedThread | null, url: string) => boolean;
  readonly planChange: (
    threadRef: ScopedThreadRef,
    url: string,
    linked: boolean,
  ) => ThreadPullRequestMutation;
};

/** Routes link actions through the command advertised by this environment. */
export function createPullRequestLinkingRules(input: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly capabilities: ExecutionEnvironmentCapabilities | undefined;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}): PullRequestLinkingRules {
  const { capabilities, environmentId } = input;
  const mode = threadPullRequestLinkMode(capabilities);
  const environmentProjects = input.projects.filter(
    (project) => project.environmentId === environmentId,
  );
  const canLink = (url: string) => {
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null || mode === "unsupported") return false;
    return (
      (mode === "multiple" ? findProjectOnChangeRequestHost : findProjectForChangeRequest)(
        environmentProjects,
        parsed,
      ) !== undefined
    );
  };
  const isLinked = (thread: PullRequestLinkedThread | null, url: string) => {
    if (thread === null || mode === "unsupported") return false;
    if (mode !== "multiple")
      return (
        thread.linkedPullRequest != null &&
        matchesLinkedPullRequestUrl(thread.linkedPullRequest, url)
      );
    const parsed = parseChangeRequestUrl(url);
    return (
      parsed !== null &&
      visibleThreadPullRequests(thread.pullRequests ?? []).some((entry) =>
        threadPullRequestKeysEqual(entry, parsed),
      )
    );
  };
  const planChange = (threadRef: ScopedThreadRef, url: string, linked: boolean) => {
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null || threadRef.environmentId !== environmentId || (linked && !canLink(url)))
      throw new Error("The pull request is not available in this environment.");
    const legacyProject = findProjectForChangeRequest(environmentProjects, parsed);
    const mutation = planThreadPullRequestMutation({
      capabilities,
      threadId: threadRef.threadId,
      reference: { ...parsed, url },
      legacyProjectId: legacyProject?.id ?? null,
      legacyRepository:
        sourceControlRepositorySelector(legacyProject?.repositoryIdentity) ?? undefined,
      linked,
    });
    if (mutation === null)
      throw new Error("This environment does not support linking this pull request.");
    return mutation;
  };
  return { mode, canLink, isLinked, planChange };
}
