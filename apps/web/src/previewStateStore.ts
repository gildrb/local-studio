/**
 * Per-thread preview UI state.
 *
 * Each thread owns an independent atom. Most consumers read exactly one
 * thread; the desktop browser host uses the aggregate session atom because it
 * is the one place that must enumerate every live preview tab.
 */
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type PreviewEvent,
  type PreviewListResult,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { PREVIEW_RECENT_URL_LIMIT } from "./components/preview/previewConstants";
import {
  type DesktopPreviewOverlay,
  EMPTY_THREAD_PREVIEW_STATE,
  reduceActivePreviewTab,
  reduceBeginPreviewSessionClose,
  reduceCancelPreviewSessionClose,
  reducePreviewDesktopState,
  reducePreviewServerEvent,
  reducePreviewServerSessions,
  reducePreviewServerSnapshot,
  reduceRememberPreviewUrl,
  reduceUpdatePreviewServerSnapshot,
  type ThreadPreviewState,
} from "./previewState.logic";
import { appAtomRegistry } from "./rpc/atomRegistry";

const emptyPreviewStateAtom = Atom.make<ThreadPreviewState>(EMPTY_THREAD_PREVIEW_STATE).pipe(
  Atom.withLabel("preview:empty-thread"),
);

export const previewStateAtom = Atom.family((threadKey: string) =>
  Atom.make<ThreadPreviewState>(EMPTY_THREAD_PREVIEW_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`preview:thread:${threadKey}`),
  ),
);

// Only the Electron browser host needs a cross-thread view. Keep that index
// separate so thread-local readers never subscribe to unrelated previews.
interface ActivePreviewThreadIndex {
  readonly keys: ReadonlySet<string>;
}

const activePreviewThreadKeysAtom = Atom.make<ActivePreviewThreadIndex>({
  keys: new Set<string>(),
}).pipe(Atom.keepAlive, Atom.withLabel("preview:active-thread-keys"));

const activePreviewSessionsAtom = Atom.make((get) => {
  const byThreadKey: Record<string, ThreadPreviewState> = {};
  for (const threadKey of get(activePreviewThreadKeysAtom).keys) {
    const state = get(previewStateAtom(threadKey));
    if (Object.keys(state.sessions).length > 0) {
      byThreadKey[threadKey] = state;
    }
  }
  return byThreadKey;
}).pipe(Atom.withLabel("preview:active-sessions"));

const changedPreviewThreadKeys = new Set<string>();

function syncActivePreviewThread(threadKey: string, state: ThreadPreviewState): void {
  const active = Object.keys(state.sessions).length > 0;
  appAtomRegistry.update(activePreviewThreadKeysAtom, (current) => {
    if (current.keys.has(threadKey) === active) return current;
    const next = new Set(current.keys);
    if (active) next.add(threadKey);
    else next.delete(threadKey);
    return { keys: next };
  });
}

function updateThreadPreviewState(
  ref: ScopedThreadRef,
  update: (current: ThreadPreviewState) => ThreadPreviewState,
): void {
  const threadKey = scopedThreadKey(ref);
  const atom = previewStateAtom(threadKey);
  let nextState = appAtomRegistry.get(atom);
  const changed = appAtomRegistry.modify(atom, (current) => {
    nextState = update(current);
    return [nextState !== current, nextState];
  });
  if (!changed) return;
  changedPreviewThreadKeys.add(threadKey);
  syncActivePreviewThread(threadKey, nextState);
}

export function useThreadPreviewState(ref: ScopedThreadRef | null | undefined): ThreadPreviewState {
  const atom = ref ? previewStateAtom(scopedThreadKey(ref)) : emptyPreviewStateAtom;
  return useAtomValue(atom);
}

export function useActivePreviewSessions(): Record<string, ThreadPreviewState> {
  return useAtomValue(activePreviewSessionsAtom);
}

export function readThreadPreviewState(ref: ScopedThreadRef): ThreadPreviewState {
  return appAtomRegistry.get(previewStateAtom(scopedThreadKey(ref)));
}

export function applyPreviewServerEvent(ref: ScopedThreadRef, event: PreviewEvent): void {
  updateThreadPreviewState(ref, (current) => reducePreviewServerEvent(current, event));
}

export function applyPreviewServerSnapshot(
  ref: ScopedThreadRef,
  snapshot: PreviewSessionSnapshot | null,
): void {
  updateThreadPreviewState(ref, (current) => reducePreviewServerSnapshot(current, snapshot));
}

/**
 * Merge a server mutation without changing which tab the user is viewing.
 *
 * Commands such as resize can target background tabs. Their response is
 * authoritative for that tab, but it is not a request to focus the tab.
 */
export function updatePreviewServerSnapshot(
  ref: ScopedThreadRef,
  snapshot: PreviewSessionSnapshot,
): void {
  updateThreadPreviewState(ref, (current) => reduceUpdatePreviewServerSnapshot(current, snapshot));
}

/**
 * Replace the local session index from an authoritative preview.list result.
 * Missing tabs are removed while the current active tab is preserved whenever
 * it still exists in the server result.
 */
export function reconcilePreviewServerSessions(
  ref: ScopedThreadRef,
  result: PreviewListResult,
): void {
  updateThreadPreviewState(ref, (current) => reducePreviewServerSessions(current, result));
}

export function applyPreviewDesktopState(
  ref: ScopedThreadRef,
  tabId: string,
  overlay: DesktopPreviewOverlay | null,
): void {
  updateThreadPreviewState(ref, (current) => reducePreviewDesktopState(current, tabId, overlay));
}

export function beginPreviewSessionClose(ref: ScopedThreadRef, tabId: string): void {
  updateThreadPreviewState(ref, (current) => reduceBeginPreviewSessionClose(current, tabId));
}

export function cancelPreviewSessionClose(
  ref: ScopedThreadRef,
  snapshot: PreviewSessionSnapshot | null,
  tabId: string,
): void {
  updateThreadPreviewState(ref, (current) =>
    reduceCancelPreviewSessionClose(current, snapshot, tabId),
  );
}

export function setActivePreviewTab(ref: ScopedThreadRef, tabId: string): void {
  updateThreadPreviewState(ref, (current) => reduceActivePreviewTab(current, tabId));
}

export function rememberPreviewUrl(ref: ScopedThreadRef, url: string): void {
  if (url.trim().length === 0) return;
  updateThreadPreviewState(ref, (current) => reduceRememberPreviewUrl(current, url));
}

export function isPreviewSupportedInRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.desktopBridge?.preview);
}

export function resetPreviewStateForTests(): void {
  for (const threadKey of changedPreviewThreadKeys) {
    appAtomRegistry.set(previewStateAtom(threadKey), EMPTY_THREAD_PREVIEW_STATE);
  }
  changedPreviewThreadKeys.clear();
  appAtomRegistry.set(activePreviewThreadKeysAtom, { keys: new Set<string>() });
}

export const __testing = {
  EMPTY_THREAD_PREVIEW_STATE,
  RECENT_URL_LIMIT: PREVIEW_RECENT_URL_LIMIT,
};
