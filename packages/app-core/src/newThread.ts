import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { T3_PROJECT_FILE_NAME, type ScopedProjectRef } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import type { DraftId } from "@t3tools/web/src/composerDraftStore.ts";
import {
  openNewThreadDraft,
  type NewThreadOptions,
  type NewThreadResult,
} from "@t3tools/web/src/hooks/newThread.logic.ts";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes.ts";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { AppPage } from "./page.ts";
import type { CoreState } from "./state.ts";

export function createNewThreadOpener(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly state: CoreState;
  readonly clientSettingsAtom: Atom.Atom<ClientSettings>;
  readonly routeTargetAtom: Atom.Atom<ThreadRouteTarget | null>;
  readonly pageAtom: Atom.Atom<AppPage>;
  readonly navigateToDraft: (draftId: DraftId) => void;
}) {
  const { registry, state } = input;
  return (
    projectRef: ScopedProjectRef,
    options?: NewThreadOptions,
  ): Promise<NewThreadResult | null> =>
    openNewThreadDraft(
      {
        readServerSettings: (environmentId) =>
          registry.get(state.serverEnvironment.configValueAtom(environmentId))?.settings ?? null,
        projectGroupingSettings: selectProjectGroupingSettings(
          registry.get(input.clientSettingsAtom),
        ),
        currentRouteTarget: () => registry.get(input.routeTargetAtom),
        currentLocation: () =>
          JSON.stringify([registry.get(input.pageAtom), registry.get(input.routeTargetAtom)]),
        navigateToDraft: async (draftId) => input.navigateToDraft(draftId),
        readProjects: () => registry.get(state.environmentProjects.projectsAtom),
        readThreadShell: (ref) => registry.get(state.environmentThreadShells.threadShellAtom(ref)),
        readT3ProjectFile: async (environmentId, workspaceRoot) => {
          const result = await executeAtomQuery(
            registry,
            state.projectEnvironment.readFile({
              environmentId,
              input: { cwd: workspaceRoot, relativePath: T3_PROJECT_FILE_NAME },
            }),
            { reportDefect: false, reportFailure: false },
          );
          if (result._tag !== "Success" || result.value.truncated) return null;
          return parseT3ProjectFile(result.value.contents);
        },
      },
      projectRef,
      options,
    );
}
