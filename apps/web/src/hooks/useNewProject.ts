import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { waitForProject } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";
import { createNewProject } from "./newProject.logic";
import { useNewThreadHandler } from "./useHandleNewThread";

/**
 * Starts a project from just a name. The server makes a folder under its
 * `newProjectsRoot` with a README, an icon, and a first commit; this then
 * opens a new thread draft in it. With `github`, it also publishes the
 * repository as private, without holding up the draft.
 *
 * Resolves to whether the project was created.
 */
export function useNewProject() {
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const publishRepository = useAtomCommand(sourceControlEnvironment.publishRepository, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();

  return useCallback(
    (input: {
      readonly environmentId: EnvironmentId;
      readonly name: string;
      readonly github: { readonly account: string | null } | null;
    }): Promise<boolean> =>
      createNewProject(
        {
          createNew,
          publishRepository,
          waitForProject: (projectRef) => waitForProject(projectRef),
          openNewThread: handleNewThread,
          showToast: (toast) => {
            toastManager.add(stackedThreadToast(toast));
          },
        },
        input,
      ),
    [createNew, handleNewThread, publishRepository],
  );
}
