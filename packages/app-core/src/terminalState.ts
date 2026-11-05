import type { ScopedThreadRef } from "@t3tools/contracts";
import { resolveStorage } from "@t3tools/web/src/lib/storage.ts";
import type { ThreadTerminalUiState } from "@t3tools/web/src/terminalUiState.logic.ts";
import {
  selectThreadTerminalUiState,
  useTerminalUiStateStore,
} from "@t3tools/web/src/terminalUiStateStore.ts";
import { Atom } from "effect/unstable/reactivity";
import { createJSONStorage } from "zustand/middleware";

export function persistTerminalUiStore(storage: Storage): Promise<void> {
  useTerminalUiStateStore.persist.setOptions({
    storage: createJSONStorage(() => resolveStorage(storage)),
  });
  return Promise.resolve(useTerminalUiStateStore.persist.rehydrate());
}

export const terminalUiStoreAtom = Atom.make((get) => {
  get.addFinalizer(useTerminalUiStateStore.subscribe((value) => get.setSelf(value)));
  return useTerminalUiStateStore.getState();
}).pipe(Atom.keepAlive);

export function routeTerminalUiState(
  get: <A>(atom: Atom.Atom<A>) => A,
  route: ScopedThreadRef,
): ThreadTerminalUiState {
  return selectThreadTerminalUiState(get(terminalUiStoreAtom).terminalUiStateByThreadKey, route);
}
