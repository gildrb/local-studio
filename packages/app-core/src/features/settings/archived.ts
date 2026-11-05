import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "@t3tools/client-runtime/state/threads";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  buildArchivedThreadsSettingsModel,
  resolveArchivedThreadAction,
  resolveArchivedThreadActionOutcome,
  type ArchivedThreadActionEffect,
  type ArchivedThreadGroup,
  type ArchivedThreadsEmptyState,
} from "@t3tools/web/src/components/settings/ArchivedThreads.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { contextMenuService } from "../../contextMenu.ts";
import type { FeatureContext } from "../../feature.ts";
import { projectIconView } from "../../sidebarView.ts";
import { coreThreadActions } from "../../threadActions.ts";
import type { ProjectIconView } from "../../views/sidebar.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

export type ArchivedThreadGroupView = Omit<ArchivedThreadGroup, "project"> & {
  readonly icon: ProjectIconView;
};

export type ArchivedThreadsSettingsView = {
  readonly emptyState: ArchivedThreadsEmptyState | null;
  readonly groups: readonly ArchivedThreadGroupView[];
};

const ThreadParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, threadId: Schema.String }),
);
const MenuParams = Schema.decodeUnknownSync(
  Schema.Struct({
    environmentId: Schema.String,
    threadId: Schema.String,
    x: Schema.Number,
    y: Schema.Number,
  }),
);

export function createArchivedSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const snapshotAtom = (environmentId: EnvironmentId) =>
    state.orchestrationEnvironment.archivedShellSnapshot({ environmentId, input: {} });
  const snapshotsFamily = createArchivedThreadSnapshotsAtomFamily({
    getSnapshotAtom: snapshotAtom,
    labelPrefix: "native:archived-thread-snapshots",
  });

  const viewAtom = Atom.make((get): ArchivedThreadsSettingsView | null => {
    if (get(scope.sectionAtom) !== "archived") return null;
    const resolved = get(scope.scopeContextAtom).scope;
    const result = get(snapshotsFamily(makeArchivedThreadsEnvironmentKey(resolved.environmentIds)));
    const model = buildArchivedThreadsSettingsModel({
      snapshots: result.snapshots,
      scope: resolved,
      isLoading: result.isLoading,
      error: result.error,
      now: Date.now(),
    });
    return {
      emptyState: model.emptyState,
      groups: model.groups.map(({ project, ...group }) => ({
        ...group,
        icon: projectIconView(project),
      })),
    };
  });

  const refresh = () => {
    for (const environmentId of registry.get(scope.scopeContextAtom).scope.environmentIds) {
      registry.refresh(snapshotAtom(environmentId));
    }
  };

  const applyEffect = (effect: ArchivedThreadActionEffect) => {
    if (effect.kind === "refresh") {
      refresh();
      return;
    }
    if (effect.kind === "toast") {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: effect.title,
        description: effect.description,
      });
    }
  };

  const run = async (action: "unarchive" | "delete", environmentId: string, threadId: string) => {
    const { actions } = coreThreadActions(context);
    const threadRef = scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId));
    const result =
      action === "unarchive"
        ? await actions.unarchiveThread(threadRef)
        : await actions.confirmAndDeleteThread(threadRef);
    applyEffect(
      resolveArchivedThreadActionOutcome({
        action,
        outcome:
          result._tag === "Success"
            ? { kind: "success" }
            : isAtomCommandInterrupted(result)
              ? { kind: "interrupted" }
              : { kind: "failure", error: squashAtomCommandFailure(result) },
      }),
    );
  };

  return {
    views: { settingsArchived: viewAtom },
    actions: {
      settingsArchivedUnarchive: async (params) => {
        const { environmentId, threadId } = ThreadParams(params);
        const intent = resolveArchivedThreadAction({ source: "button" });
        if (intent.kind === "none") return null;
        await run(intent.kind, environmentId, threadId);
        return null;
      },
      settingsArchivedContextMenu: async (params) => {
        const { environmentId, threadId, x, y } = MenuParams(params);
        const items = buildArchivedThreadsSettingsModel({
          snapshots: [],
          scope: registry.get(scope.scopeContextAtom).scope,
          isLoading: false,
          error: null,
          now: Date.now(),
        }).contextMenuItems;
        const result = await settlePromise(async () => {
          const clicked = await contextMenuService(context).show(items, { x, y });
          const intent = resolveArchivedThreadAction({ source: "context-menu", clicked });
          if (intent.kind === "none") return;
          await run(intent.kind, environmentId, threadId);
        });
        if (result._tag === "Failure") {
          applyEffect(
            resolveArchivedThreadActionOutcome({
              action: "menu",
              outcome: { kind: "failure", error: squashAtomCommandFailure(result) },
            }),
          );
        }
        return null;
      },
    },
  };
}
