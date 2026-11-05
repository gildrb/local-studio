import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { TurnId } from "@t3tools/contracts";
import { toggleChangedFilesDirectory } from "@t3tools/web/src/components/chat/ChangedFilesTree.logic.ts";
import { formatWorkingTimerNow } from "@t3tools/web/src/components/chat/MessagesTimeline.logic.ts";
import { useDiffPanelStore } from "@t3tools/web/src/diffPanelStore.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { setThreadChangedFilesExpanded } from "@t3tools/web/src/uiState.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";
import type { TimelineExpansion } from "./timelineView.ts";
import type { TimelineView } from "./views/timeline.ts";

const WORKING_TIMER_TICK_MS = 1_000;

const WorkEntryParams = Schema.decodeUnknownSync(Schema.Struct({ entryId: Schema.String }));
const ReasoningParams = Schema.decodeUnknownSync(Schema.Struct({ messageId: Schema.String }));
const ChangedFilesAllParams = Schema.decodeUnknownSync(Schema.Struct({ turnId: Schema.String }));
const ChangedFilesDirectoryParams = Schema.decodeUnknownSync(
  Schema.Struct({
    turnId: Schema.String,
    path: Schema.String,
    expansionKey: Schema.String,
    allDirectoriesExpanded: Schema.Boolean,
  }),
);
const OpenTurnDiffParams = Schema.decodeUnknownSync(
  Schema.Struct({ turnId: Schema.String, filePath: Schema.NullOr(Schema.String) }),
);

function toggled(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function createTimelineWorkFeature(
  context: FeatureContext,
  deps: {
    readonly expansionAtom: Atom.Writable<TimelineExpansion>;
    readonly timelineAtom: Atom.Atom<TimelineView>;
  },
): CoreFeature {
  const { registry } = context;
  const { expansionAtom, timelineAtom } = deps;

  const updateExpansion = (update: (current: TimelineExpansion) => TimelineExpansion) =>
    registry.set(expansionAtom, update(registry.get(expansionAtom)));

  const requireRoute = (action: string) => {
    const route = registry.get(context.routeAtom);
    if (route === null) throw new Error(`${action} needs an open thread.`);
    return route;
  };

  const nowTickAtom = Atom.make((get) => {
    const timer = setInterval(() => get.setSelf(Date.now()), WORKING_TIMER_TICK_MS);
    get.addFinalizer(() => clearInterval(timer));
    return Date.now();
  });

  const workingTimerAtom = Atom.make((get): string | null => {
    get(nowTickAtom);
    for (const row of get(timelineAtom).rows) {
      if (row.kind === "working" && row.working.timerStartedAt !== null) {
        return formatWorkingTimerNow(row.working.timerStartedAt);
      }
    }
    return null;
  });

  return {
    views: { timelineWorkingTimer: workingTimerAtom },
    actions: {
      toggleWorkEntry: async (params) => {
        const { entryId } = WorkEntryParams(params);
        updateExpansion((current) => ({
          ...current,
          workEntryIds: toggled(current.workEntryIds, entryId),
        }));
        return null;
      },
      toggleReasoning: async (params) => {
        const { messageId } = ReasoningParams(params);
        updateExpansion((current) => ({
          ...current,
          reasoningMessageIds: toggled(current.reasoningMessageIds, messageId),
        }));
        return null;
      },
      toggleChangedFilesAll: async (params) => {
        const { turnId } = ChangedFilesAllParams(params);
        const threadKey = scopedThreadKey(requireRoute("toggleChangedFilesAll"));
        const expanded =
          registry.get(context.uiStateAtom).threadChangedFilesExpandedById[threadKey]?.[turnId] ??
          false;
        context.updateUiState((current) =>
          setThreadChangedFilesExpanded(current, threadKey, turnId, !expanded),
        );
        updateExpansion((current) => {
          const changedFilesDirectories = new Map(current.changedFilesDirectories);
          changedFilesDirectories.delete(turnId);
          return { ...current, changedFilesDirectories };
        });
        return null;
      },
      toggleChangedFilesDirectory: async (params) => {
        const { turnId, path, expansionKey, allDirectoriesExpanded } =
          ChangedFilesDirectoryParams(params);
        updateExpansion((current) => {
          const changedFilesDirectories = new Map(current.changedFilesDirectories);
          const previous = changedFilesDirectories.get(turnId) ?? { key: null, overrides: {} };
          changedFilesDirectories.set(
            turnId,
            toggleChangedFilesDirectory(previous, { expansionKey, path, allDirectoriesExpanded }),
          );
          return { ...current, changedFilesDirectories };
        });
        return null;
      },
      openTurnDiff: async (params) => {
        const { turnId, filePath } = OpenTurnDiffParams(params);
        const input = registry.get(context.threadInputAtom);
        if (input === null || !input.isServerThread) return null;
        const route = requireRoute("openTurnDiff");
        useDiffPanelStore.getState().selectTurn(route, TurnId.make(turnId), filePath ?? undefined);
        useRightPanelStore.getState().open(route, "diff");
        return null;
      },
    },
  };
}
