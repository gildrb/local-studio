import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { addProjectFromPath } from "@t3tools/web/src/components/addProject.logic.ts";
import { getEnvironmentBrowsePlatform } from "@t3tools/web/src/components/CommandPalette.logic.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";

export type FolderPickerRequestView = {
  readonly id: number;
  readonly prompt: string;
};

export interface AddProjectService {
  /** Opens the native folder picker, then adds the picked folder like the web add-project flow. */
  readonly browse: () => void;
  readonly addFromPath: (path: string) => Promise<boolean>;
  readonly feature: CoreFeature;
}

const PickedParams = Schema.decodeUnknownSync(
  Schema.Struct({ requestId: Schema.Number, path: Schema.NullOr(Schema.String) }),
);

const services = new WeakMap<FeatureContext, AddProjectService>();

export function addProjectService(context: FeatureContext): AddProjectService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const { registry, state } = context;
  const requestAtom = Atom.make<FolderPickerRequestView | null>(null).pipe(Atom.keepAlive);
  let nextId = 1;

  const addFromPath = async (path: string): Promise<boolean> => {
    const environmentId = registry.get(state.primaryEnvironmentIdAtom);
    if (environmentId === null) {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: "Environment unavailable",
        description: "The selected environment is not connected.",
      });
      return false;
    }
    const presentations = registry.get(state.environmentPresentations.presentationsAtom);
    const input = registry.get(context.threadInputAtom);
    const currentProject = input?.project ?? null;
    return addProjectFromPath(
      {
        environments: [...presentations.entries()].map(([id, presentation]) =>
          projectEnvironmentPresentation(id, presentation),
        ),
        projects: registry.get(state.environmentProjects.projectsAtom),
        threads: registry.get(state.environmentThreadShells.threadShellsAtom),
        threadSortOrder: registry.get(context.clientSettingsAtom).sidebarThreadSortOrder,
        createProject: (target) =>
          runAtomCommand(registry, state.projectEnvironment.create, target, {
            reportFailure: false,
          }),
        navigateToThread: async (threadRef) => context.navigateToThread(threadRef),
        openNewThread: (projectRef) => context.openNewThread(projectRef),
        showError: ({ title, description }) => {
          context.addToast({ layout: "stacked", type: "error", title, description });
        },
      },
      {
        environmentId,
        rawCwd: path,
        platform: getEnvironmentBrowsePlatform(
          registry.get(state.serverEnvironment.configValueAtom(environmentId))?.environment.platform
            .os,
        ),
        currentProjectCwd:
          currentProject !== null && currentProject.environmentId === environmentId
            ? currentProject.workspaceRoot
            : null,
      },
    );
  };

  const service: AddProjectService = {
    browse: () => {
      registry.set(requestAtom, { id: nextId++, prompt: "Add project" });
    },
    addFromPath,
    feature: {
      views: { folderPickerRequest: requestAtom },
      actions: {
        addProjectPicked: async (params) => {
          const { requestId, path } = PickedParams(params);
          if (registry.get(requestAtom)?.id !== requestId) return false;
          registry.set(requestAtom, null);
          return path === null ? false : addFromPath(path);
        },
      },
    },
  };
  services.set(context, service);
  return service;
}

export function createAddProjectFeature(context: FeatureContext): CoreFeature {
  return addProjectService(context).feature;
}
