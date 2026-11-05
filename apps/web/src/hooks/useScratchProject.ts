import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { waitForProject } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";
import {
  openScratchProject as openScratchProjectWith,
  scratchEnvironmentIdFor,
  scratchWorkspaceRootFor as scratchWorkspaceRootForEnvironment,
} from "./scratchProject.logic";

function reportScratchFailure(error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not start without a project",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Threads without a project live in the environment's scratch project, a
 * plain folder the server owns (users see it as "No project"). The server
 * creates it on first use; after that it is an ordinary project on the
 * non-git path, and each thread gets its own subfolder.
 */
export function useScratchProject() {
  const { environments } = useEnvironments();
  const ensureScratch = useAtomCommand(projectEnvironment.ensureScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  const scratchWorkspaceRootFor = useCallback(
    (environmentId: EnvironmentId | null): string | null =>
      scratchWorkspaceRootForEnvironment(environments, environmentId),
    [environments],
  );

  const scratchEnvironmentId = useCallback(
    (current: EnvironmentId | null): EnvironmentId | null =>
      scratchEnvironmentIdFor(environments, current),
    [environments],
  );

  const openScratchProject = useCallback(
    (environmentId: EnvironmentId): Promise<EnvironmentProject | null> =>
      openScratchProjectWith(
        { ensureScratch, waitForProject, reportFailure: reportScratchFailure },
        environmentId,
      ),
    [ensureScratch],
  );

  const startScratchThread = useCallback(
    async (environmentId: EnvironmentId) => {
      const project = await openScratchProject(environmentId);
      if (project) {
        await handleNewThread(scopeProjectRef(project.environmentId, project.id)).catch(
          reportScratchFailure,
        );
      }
    },
    [handleNewThread, openScratchProject],
  );

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
