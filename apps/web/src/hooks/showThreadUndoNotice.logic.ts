import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { create, type StoreApi, type UseBoundStore } from "zustand";

import type { ThreadActionToast } from "./threadActions.logic";
import * as ThreadUndo from "./threadUndo";

export interface ThreadUndoClaim {
  readonly isCurrent: () => boolean;
  readonly finish: () => void;
}

export type ThreadUndoAction = "Settled" | "Snoozed" | "Unpinned" | "Archived";

export interface ThreadUndoOptions {
  readonly action: ThreadUndoAction;
  readonly undo: () => Promise<AtomCommandResult<unknown, unknown>>;
  readonly failureTitle: string;
  readonly claim: ThreadUndoClaim;
}

export interface ThreadUndoNotice {
  readonly action: ThreadUndoAction;
  readonly count: number;
  readonly undo: () => Promise<void>;
}

export interface ThreadUndoNoticeState {
  readonly notice: ThreadUndoNotice | null;
}

export interface ThreadUndoNotices {
  readonly store: UseBoundStore<StoreApi<ThreadUndoNoticeState>>;
  /** Shows one compact confirmation for the currently undoable thread actions. */
  readonly show: (options: ThreadUndoOptions) => void;
  /** Runs the group displayed in the sidebar; false when nothing is left to undo. */
  readonly undoLatest: () => boolean;
}

/** Consecutive actions of the same kind share one notice and can be restored together. */
export function createThreadUndoNotices(
  addToast: (toast: ThreadActionToast) => void,
): ThreadUndoNotices {
  const store = create<ThreadUndoNoticeState>(() => ({ notice: null }));
  let liveUndos: ThreadUndoOptions[] = [];
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function refreshNotice() {
    liveUndos = liveUndos.filter(({ claim }) => claim.isCurrent());
    const latest = liveUndos.at(-1);
    if (!latest) {
      clearTimeout(expiry);
      store.setState({ notice: null });
      return;
    }
    const group: ThreadUndoOptions[] = [];
    for (let index = liveUndos.length - 1; index >= 0; index--) {
      const entry = liveUndos[index];
      if (entry === undefined || entry.action !== latest.action) break;
      group.push(entry);
    }
    store.setState({
      notice: {
        action: latest.action,
        count: group.length,
        undo: async () => {
          const current = group.filter(
            (entry) => liveUndos.includes(entry) && entry.claim.isCurrent(),
          );
          liveUndos = liveUndos.filter((entry) => !group.includes(entry));
          // Consume every claim before awaiting, so repeated clicks or shortcuts
          // cannot restore the same group twice.
          for (const entry of current) entry.claim.finish();
          refreshNotice();
          await Promise.all(
            current.map(async ({ undo, failureTitle }) => {
              const reportFailure = (error: unknown) => {
                addToast({
                  layout: "stacked",
                  type: "error",
                  title: failureTitle,
                  description: error instanceof Error ? error.message : "An error occurred.",
                });
              };
              try {
                const result = await undo();
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  reportFailure(squashAtomCommandFailure(result));
                }
              } catch (error) {
                reportFailure(error);
              }
            }),
          );
        },
      },
    });
  }

  ThreadUndo.subscribe(refreshNotice);

  return {
    store,
    show: (options) => {
      if (!options.claim.isCurrent()) return;
      liveUndos.push(options);
      refreshNotice();
      clearTimeout(expiry);
      expiry = setTimeout(() => {
        const expired = liveUndos;
        liveUndos = [];
        for (const { claim } of expired) claim.finish();
        refreshNotice();
      }, 5_000);
    },
    undoLatest: () => {
      const notice = store.getState().notice;
      if (!notice) return false;
      void notice.undo();
      return true;
    },
  };
}
