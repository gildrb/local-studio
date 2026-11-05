import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";

import type {
  ThreadActionResult,
  ThreadActions,
  ThreadActionToast,
} from "../../hooks/threadActions.logic";
import { shouldNavigateAfterThreadPark } from "../Sidebar.logic";

export type SidebarForwardNavigation =
  | { readonly kind: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "new-thread"; readonly projectRef: ScopedProjectRef }
  | { readonly kind: "home" };

export function resolveSidebarForwardNavigation(input: {
  readonly threadKey: string;
  readonly currentThreadKey: string | null;
  readonly orderedKeys: ReadonlyArray<string>;
  readonly settledKeys: ReadonlySet<string>;
  readonly snoozedKeys: ReadonlySet<string>;
  readonly coParkingKeys?: ReadonlySet<string> | undefined;
  readonly threadByKey: ReadonlyMap<
    string,
    Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">
  >;
}): SidebarForwardNavigation | null {
  const { threadKey, orderedKeys } = input;
  if (input.currentThreadKey !== threadKey) return null;
  const shell = input.threadByKey.get(threadKey);
  const currentIndex = orderedKeys.indexOf(threadKey);
  const nextCardKey =
    currentIndex === -1
      ? null
      : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
          (key) =>
            !input.settledKeys.has(key) &&
            !input.snoozedKeys.has(key) &&
            !input.coParkingKeys?.has(key),
        ) ?? null);
  const nextThread = nextCardKey ? input.threadByKey.get(nextCardKey) : null;
  if (nextThread) {
    return { kind: "thread", threadRef: scopeThreadRef(nextThread.environmentId, nextThread.id) };
  }
  if (shell) {
    return {
      kind: "new-thread",
      projectRef: scopeProjectRef(shell.environmentId, shell.projectId),
    };
  }
  return { kind: "home" };
}

export type SidebarSnoozeOutcome =
  | { readonly status: "skipped" }
  | { readonly status: "interrupted" }
  | { readonly status: "failure"; readonly error: unknown }
  | { readonly status: "success" };

export interface SidebarThreadLifecycleDeps {
  readonly actions: Pick<
    ThreadActions,
    | "settleThread"
    | "unsettleThread"
    | "snoozeThread"
    | "unsnoozeThread"
    | "pinThread"
    | "confirmAndUnpinThread"
  >;
  readonly settlingThreadKeys: Set<string>;
  readonly snoozingThreadKeys: Set<string>;
  readonly planForwardNavigation: (
    threadKey: string,
    coParkingKeys?: ReadonlySet<string>,
  ) => (() => void) | null;
  readonly currentRouteThreadKey: () => string | null;
  readonly readThreadShell: (ref: ScopedThreadRef) => EnvironmentThreadShell | null;
  readonly addToast: (toast: ThreadActionToast) => void;
}

export interface SidebarThreadLifecycle {
  readonly attemptSettle: (
    threadRef: ScopedThreadRef,
    opts?: { readonly coSettlingKeys?: ReadonlySet<string> },
  ) => void;
  readonly attemptUnsettle: (threadRef: ScopedThreadRef) => void;
  readonly attemptUnsnooze: (threadRef: ScopedThreadRef) => void;
  readonly attemptPin: (threadRef: ScopedThreadRef) => void;
  readonly attemptUnpin: (threadRef: ScopedThreadRef) => void;
  readonly performSnooze: (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts?: { readonly coSnoozingKeys?: ReadonlySet<string> },
  ) => Promise<SidebarSnoozeOutcome>;
  readonly attemptSnooze: (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts?: { readonly coSnoozingKeys?: ReadonlySet<string> },
  ) => void;
}

function failureToast(title: string, error: unknown): ThreadActionToast {
  return {
    layout: "stacked",
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  };
}

export function createSidebarThreadLifecycle(
  deps: SidebarThreadLifecycleDeps,
): SidebarThreadLifecycle {
  const { actions } = deps;
  const reportFailure = (title: string, run: () => Promise<ThreadActionResult>) => {
    void (async () => {
      const result = await run();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        deps.addToast(failureToast(title, squashAtomCommandFailure(result)));
      }
    })();
  };

  const attemptSettle: SidebarThreadLifecycle["attemptSettle"] = (threadRef, opts = {}) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      if (deps.settlingThreadKeys.has(threadKey)) return;
      deps.settlingThreadKeys.add(threadKey);
      try {
        const navigateAfterSettle = deps.planForwardNavigation(threadKey, opts.coSettlingKeys);
        const result = await actions.settleThread(threadRef);
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            deps.addToast(
              failureToast("Failed to settle thread", squashAtomCommandFailure(result)),
            );
          }
          return;
        }
        if (
          shouldNavigateAfterThreadPark({
            threadKey,
            currentThreadKey: deps.currentRouteThreadKey(),
            action: "settle",
            now: new Date().toISOString(),
            thread: deps.readThreadShell(threadRef),
          })
        ) {
          navigateAfterSettle?.();
        }
      } finally {
        deps.settlingThreadKeys.delete(threadKey);
      }
    })();
  };

  const performSnooze: SidebarThreadLifecycle["performSnooze"] = async (
    threadRef,
    preset,
    opts = {},
  ) => {
    const threadKey = scopedThreadKey(threadRef);
    if (deps.snoozingThreadKeys.has(threadKey)) {
      return { status: "skipped" };
    }
    deps.snoozingThreadKeys.add(threadKey);
    try {
      const navigateAfterSnooze = deps.planForwardNavigation(threadKey, opts.coSnoozingKeys);
      const result = await actions.snoozeThread(threadRef, preset.snoozedUntil);
      if (result._tag === "Failure") {
        return isAtomCommandInterrupted(result)
          ? { status: "interrupted" }
          : { status: "failure", error: squashAtomCommandFailure(result) };
      }
      if (
        shouldNavigateAfterThreadPark({
          threadKey,
          currentThreadKey: deps.currentRouteThreadKey(),
          action: "snooze",
          now: new Date().toISOString(),
          thread: deps.readThreadShell(threadRef),
        })
      ) {
        navigateAfterSnooze?.();
      }
      return { status: "success" };
    } finally {
      deps.snoozingThreadKeys.delete(threadKey);
    }
  };

  return {
    attemptSettle,
    attemptUnsettle: (threadRef) =>
      reportFailure("Failed to un-settle thread", () => actions.unsettleThread(threadRef)),
    attemptUnsnooze: (threadRef) =>
      reportFailure("Failed to wake thread", () => actions.unsnoozeThread(threadRef)),
    attemptPin: (threadRef) =>
      reportFailure("Failed to pin thread", () => actions.pinThread(threadRef)),
    attemptUnpin: (threadRef) =>
      reportFailure("Failed to unpin thread", () => actions.confirmAndUnpinThread(threadRef)),
    performSnooze,
    attemptSnooze: (threadRef, preset, opts = {}) => {
      void (async () => {
        const outcome = await performSnooze(threadRef, preset, opts);
        if (outcome.status === "failure") {
          deps.addToast(failureToast("Failed to snooze thread", outcome.error));
        }
      })();
    },
  };
}
