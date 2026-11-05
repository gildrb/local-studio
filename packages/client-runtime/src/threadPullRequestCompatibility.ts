import type {
  ExecutionEnvironmentCapabilities,
  ProjectId,
  ThreadId,
  ThreadPullRequestKey,
} from "@t3tools/contracts";
import { normalizeThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";

import type {
  LinkThreadPullRequestInput,
  UnlinkThreadPullRequestInput,
  UpdateThreadMetadataInput,
} from "./operations/commands.ts";

export type ThreadPullRequestMutation =
  | { readonly type: "thread.pull-request.link"; readonly input: LinkThreadPullRequestInput }
  | { readonly type: "thread.pull-request.unlink"; readonly input: UnlinkThreadPullRequestInput }
  | { readonly type: "thread.meta.update"; readonly input: UpdateThreadMetadataInput };

type LinkingCapabilities = Pick<
  ExecutionEnvironmentCapabilities,
  "threadPullRequests" | "threadPullRequestLinking"
>;

/** Capability negotiation keeps both single-link and multi-link environments usable. */
export function threadPullRequestLinkMode(capabilities: LinkingCapabilities | null | undefined) {
  return capabilities?.threadPullRequests === true
    ? "multiple"
    : capabilities?.threadPullRequestLinking === true
      ? "single"
      : "unsupported";
}

export function planThreadPullRequestMutation({
  capabilities,
  threadId,
  reference,
  legacyProjectId,
  legacyRepository,
  linked,
}: {
  capabilities: LinkingCapabilities | null | undefined;
  threadId: ThreadId;
  reference: ThreadPullRequestKey & { readonly url: string };
  /** Older servers need the exact repository checkout; same-host routing is not available. */
  legacyProjectId: ProjectId | null;
  /** Provider selector for legacy APIs, which omit Azure organization and project paths. */
  legacyRepository?: string | undefined;
  linked: boolean;
}): ThreadPullRequestMutation | null {
  const key = normalizeThreadPullRequestKey(reference);
  switch (threadPullRequestLinkMode(capabilities)) {
    case "multiple":
      return linked
        ? {
            type: "thread.pull-request.link" as const,
            input: { threadId, ...reference, ...key, source: "manual" as const },
          }
        : {
            type: "thread.pull-request.unlink" as const,
            input: {
              threadId,
              ...key,
            },
          };
    case "single":
      if (linked && legacyProjectId === null) return null;
      return {
        type: "thread.meta.update" as const,
        input: {
          threadId,
          linkedPullRequest:
            linked && legacyProjectId !== null
              ? {
                  projectId: legacyProjectId,
                  repository: legacyRepository ?? reference.repository,
                  number: reference.number,
                  url: reference.url,
                }
              : null,
        },
      };
    case "unsupported":
      return null;
  }
}
