/**
 * Single Zustand store for terminal UI state keyed by scoped thread identity.
 *
 * Terminal UI transitions live in `terminalUiState.logic.ts`.
 */

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";
import {
  closeThreadTerminal,
  createDefaultThreadTerminalUiState,
  ensureThreadTerminal,
  getDefaultThreadTerminalUiState,
  isDefaultThreadTerminalUiState,
  newThreadTerminal,
  reconcileThreadTerminalSessionIds,
  setThreadActiveTerminal,
  setThreadTerminalHeight,
  setThreadTerminalOpen,
  splitThreadTerminal,
  type EnsureThreadTerminalOptions,
  type ThreadTerminalUiState,
} from "./terminalUiState.logic";

// Keep the old storage key so existing drawer layout preferences migrate.
const TERMINAL_UI_STATE_STORAGE_KEY = "t3code:terminal-state:v1";

interface PersistedTerminalUiStateStoreState {
  terminalUiStateByThreadKey?: Record<string, ThreadTerminalUiState>;
  terminalStateByThreadKey?: Record<string, ThreadTerminalUiState>;
}

export function migratePersistedTerminalUiStateStoreState(
  persistedState: unknown,
  _version: number,
): PersistedTerminalUiStateStoreState {
  if (!persistedState || typeof persistedState !== "object") {
    return { terminalUiStateByThreadKey: {} };
  }

  const candidate = persistedState as PersistedTerminalUiStateStoreState;
  const persistedUiStateByThreadKey =
    candidate.terminalUiStateByThreadKey ?? candidate.terminalStateByThreadKey ?? {};
  const terminalUiStateByThreadKey = Object.fromEntries(
    Object.entries(persistedUiStateByThreadKey).filter(([threadKey]) =>
      parseScopedThreadKey(threadKey),
    ),
  );

  return { terminalUiStateByThreadKey };
}

function createTerminalUiStateStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function terminalThreadKey(threadRef: ScopedThreadRef): string {
  return scopedThreadKey(threadRef);
}

export function selectThreadTerminalUiState(
  terminalUiStateByThreadKey: Record<string, ThreadTerminalUiState>,
  threadRef: ScopedThreadRef | null | undefined,
): ThreadTerminalUiState {
  if (!threadRef || threadRef.threadId.length === 0) {
    return getDefaultThreadTerminalUiState();
  }
  return (
    terminalUiStateByThreadKey[terminalThreadKey(threadRef)] ?? getDefaultThreadTerminalUiState()
  );
}

function updateTerminalUiStateByThreadKey(
  terminalUiStateByThreadKey: Record<string, ThreadTerminalUiState>,
  threadRef: ScopedThreadRef,
  updater: (state: ThreadTerminalUiState) => ThreadTerminalUiState,
): Record<string, ThreadTerminalUiState> {
  if (threadRef.threadId.length === 0) {
    return terminalUiStateByThreadKey;
  }

  const threadKey = terminalThreadKey(threadRef);
  const current = selectThreadTerminalUiState(terminalUiStateByThreadKey, threadRef);
  const next = updater(current);
  if (next === current) {
    return terminalUiStateByThreadKey;
  }

  if (isDefaultThreadTerminalUiState(next)) {
    if (terminalUiStateByThreadKey[threadKey] === undefined) {
      return terminalUiStateByThreadKey;
    }
    const { [threadKey]: _removed, ...rest } = terminalUiStateByThreadKey;
    return rest;
  }

  return {
    ...terminalUiStateByThreadKey,
    [threadKey]: next,
  };
}

function updateSuppressedTerminalId(
  suppressedTerminalIdsByThreadKey: Record<string, string[]>,
  threadRef: ScopedThreadRef,
  terminalId: string,
  suppressed: boolean,
): Record<string, string[]> {
  const normalizedTerminalId = terminalId.trim();
  if (normalizedTerminalId.length === 0) {
    return suppressedTerminalIdsByThreadKey;
  }
  const threadKey = terminalThreadKey(threadRef);
  const currentIds = suppressedTerminalIdsByThreadKey[threadKey] ?? [];
  const currentlySuppressed = currentIds.includes(normalizedTerminalId);
  if (currentlySuppressed === suppressed) {
    return suppressedTerminalIdsByThreadKey;
  }
  if (suppressed) {
    return {
      ...suppressedTerminalIdsByThreadKey,
      [threadKey]: [...currentIds, normalizedTerminalId],
    };
  }

  const remainingIds = currentIds.filter((id) => id !== normalizedTerminalId);
  if (remainingIds.length > 0) {
    return {
      ...suppressedTerminalIdsByThreadKey,
      [threadKey]: remainingIds,
    };
  }
  return removeRecordEntry(suppressedTerminalIdsByThreadKey, threadKey);
}

function removeRecordEntry<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (record[key] === undefined) {
    return record;
  }
  const { [key]: _removed, ...remaining } = record;
  return remaining;
}

interface TerminalUiStateStoreState {
  terminalUiStateByThreadKey: Record<string, ThreadTerminalUiState>;
  /** Closed ids hidden from stale server metadata until that id is explicitly opened again. */
  suppressedTerminalIdsByThreadKey: Record<string, string[]>;
  setTerminalOpen: (threadRef: ScopedThreadRef, open: boolean) => void;
  setTerminalHeight: (threadRef: ScopedThreadRef, height: number) => void;
  splitTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  splitTerminalVertical: (threadRef: ScopedThreadRef, terminalId: string) => void;
  newTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  ensureTerminal: (
    threadRef: ScopedThreadRef,
    terminalId: string,
    options?: EnsureThreadTerminalOptions,
  ) => void;
  setActiveTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  closeTerminal: (threadRef: ScopedThreadRef, terminalId: string) => void;
  reconcileTerminalIds: (threadRef: ScopedThreadRef, nextIds: string[]) => void;
  clearTerminalUiState: (threadRef: ScopedThreadRef) => void;
  removeTerminalUiState: (threadRef: ScopedThreadRef) => void;
  removeOrphanedTerminalUiStates: (activeThreadKeys: Set<string>) => void;
}

export const useTerminalUiStateStore = create<TerminalUiStateStoreState>()(
  persist(
    (set, get) => {
      const updateTerminal = (
        threadRef: ScopedThreadRef,
        updater: (
          state: ThreadTerminalUiState,
          suppressedTerminalIds: readonly string[],
        ) => ThreadTerminalUiState,
        suppression?: { terminalId: string; suppressed: boolean },
      ) => {
        set((state) => {
          const threadKey = terminalThreadKey(threadRef);
          const suppressedTerminalIds = state.suppressedTerminalIdsByThreadKey[threadKey] ?? [];
          const nextTerminalUiStateByThreadKey = updateTerminalUiStateByThreadKey(
            state.terminalUiStateByThreadKey,
            threadRef,
            (terminalState) => updater(terminalState, suppressedTerminalIds),
          );
          const nextSuppressedTerminalIdsByThreadKey = suppression
            ? updateSuppressedTerminalId(
                state.suppressedTerminalIdsByThreadKey,
                threadRef,
                suppression.terminalId,
                suppression.suppressed,
              )
            : state.suppressedTerminalIdsByThreadKey;
          if (
            nextTerminalUiStateByThreadKey === state.terminalUiStateByThreadKey &&
            nextSuppressedTerminalIdsByThreadKey === state.suppressedTerminalIdsByThreadKey
          ) {
            return state;
          }
          return {
            terminalUiStateByThreadKey: nextTerminalUiStateByThreadKey,
            suppressedTerminalIdsByThreadKey: nextSuppressedTerminalIdsByThreadKey,
          };
        });
      };

      return {
        terminalUiStateByThreadKey: {},
        suppressedTerminalIdsByThreadKey: {},
        setTerminalOpen: (threadRef, open) => {
          const terminalState = selectThreadTerminalUiState(
            get().terminalUiStateByThreadKey,
            threadRef,
          );
          updateTerminal(
            threadRef,
            (state) => setThreadTerminalOpen(state, open),
            open && terminalState.terminalIds.length === 0
              ? { terminalId: DEFAULT_THREAD_TERMINAL_ID, suppressed: false }
              : undefined,
          );
        },
        setTerminalHeight: (threadRef, height) =>
          updateTerminal(threadRef, (state) => setThreadTerminalHeight(state, height)),
        splitTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => splitThreadTerminal(state, terminalId), {
            terminalId,
            suppressed: false,
          }),
        splitTerminalVertical: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => splitThreadTerminal(state, terminalId, "vertical"), {
            terminalId,
            suppressed: false,
          }),
        newTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => newThreadTerminal(state, terminalId), {
            terminalId,
            suppressed: false,
          }),
        ensureTerminal: (threadRef, terminalId, options) =>
          updateTerminal(threadRef, (state) => ensureThreadTerminal(state, terminalId, options), {
            terminalId,
            suppressed: false,
          }),
        setActiveTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => closeThreadTerminal(state, terminalId), {
            terminalId,
            suppressed: true,
          }),
        reconcileTerminalIds: (threadRef, nextIds) =>
          updateTerminal(threadRef, (state, suppressedTerminalIds) =>
            reconcileThreadTerminalSessionIds(state, nextIds, suppressedTerminalIds),
          ),
        clearTerminalUiState: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef);
            const nextTerminalUiStateByThreadKey = updateTerminalUiStateByThreadKey(
              state.terminalUiStateByThreadKey,
              threadRef,
              () => createDefaultThreadTerminalUiState(),
            );
            const hadSuppressedTerminalIds =
              state.suppressedTerminalIdsByThreadKey[threadKey] !== undefined;
            if (
              nextTerminalUiStateByThreadKey === state.terminalUiStateByThreadKey &&
              !hadSuppressedTerminalIds
            ) {
              return state;
            }
            return {
              terminalUiStateByThreadKey: nextTerminalUiStateByThreadKey,
              suppressedTerminalIdsByThreadKey: removeRecordEntry(
                state.suppressedTerminalIdsByThreadKey,
                threadKey,
              ),
            };
          }),
        removeTerminalUiState: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef);
            const hadTerminalUiState = state.terminalUiStateByThreadKey[threadKey] !== undefined;
            const hadSuppressedTerminalIds =
              state.suppressedTerminalIdsByThreadKey[threadKey] !== undefined;
            if (!hadTerminalUiState && !hadSuppressedTerminalIds) {
              return state;
            }
            return {
              terminalUiStateByThreadKey: removeRecordEntry(
                state.terminalUiStateByThreadKey,
                threadKey,
              ),
              suppressedTerminalIdsByThreadKey: removeRecordEntry(
                state.suppressedTerminalIdsByThreadKey,
                threadKey,
              ),
            };
          }),
        removeOrphanedTerminalUiStates: (activeThreadKeys) =>
          set((state) => {
            const orphanedIds = new Set(
              [
                ...Object.keys(state.terminalUiStateByThreadKey),
                ...Object.keys(state.suppressedTerminalIdsByThreadKey),
              ].filter((key) => !activeThreadKeys.has(key)),
            );
            if (orphanedIds.size === 0) {
              return state;
            }
            const nextTerminalUiStateByThreadKey = { ...state.terminalUiStateByThreadKey };
            const nextSuppressedTerminalIdsByThreadKey = {
              ...state.suppressedTerminalIdsByThreadKey,
            };
            for (const id of orphanedIds) {
              delete nextTerminalUiStateByThreadKey[id];
              delete nextSuppressedTerminalIdsByThreadKey[id];
            }
            return {
              terminalUiStateByThreadKey: nextTerminalUiStateByThreadKey,
              suppressedTerminalIdsByThreadKey: nextSuppressedTerminalIdsByThreadKey,
            };
          }),
      };
    },
    {
      name: TERMINAL_UI_STATE_STORAGE_KEY,
      version: 4,
      storage: createJSONStorage(createTerminalUiStateStorage),
      migrate: migratePersistedTerminalUiStateStoreState,
      partialize: (state) => ({
        terminalUiStateByThreadKey: state.terminalUiStateByThreadKey,
      }),
    },
  ),
);
