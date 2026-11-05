import { useMemo } from "react";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useProjects, useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { createPullRequestLinkingRules } from "./pullRequestLinking.logic";

/** Routes link actions through the command advertised by this environment. */
export function usePullRequestLinking(environmentId: EnvironmentId | null | undefined) {
  const configs = useServerConfigs();
  const projects = useProjects();
  const capabilities =
    environmentId == null ? undefined : configs.get(environmentId)?.environment.capabilities;
  const link = useAtomCommand(threadEnvironment.linkPullRequest, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkPullRequest, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  return useMemo(() => {
    const rules = createPullRequestLinkingRules({ environmentId, capabilities, projects });
    const changeLink = async (threadRef: ScopedThreadRef, url: string, linked: boolean) => {
      const mutation = rules.planChange(threadRef, url, linked);
      const result = await (mutation.type === "thread.meta.update"
        ? updateMetadata({ environmentId: threadRef.environmentId, input: mutation.input })
        : mutation.type === "thread.pull-request.link"
          ? link({ environmentId: threadRef.environmentId, input: mutation.input })
          : unlink({ environmentId: threadRef.environmentId, input: mutation.input }));
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
        throw squashAtomCommandFailure(result);
      }
    };
    return { mode: rules.mode, canLink: rules.canLink, isLinked: rules.isLinked, changeLink };
  }, [capabilities, environmentId, link, projects, unlink, updateMetadata]);
}
