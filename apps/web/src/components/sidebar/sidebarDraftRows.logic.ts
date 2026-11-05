import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";

import {
  type ComposerThreadDraftState,
  composerDraftHasUserContent,
  DraftId,
  type DraftSessionState,
  getComposerDraftState,
} from "../../composerDraftStore";

export interface SidebarDraftRowData {
  readonly draftId: DraftId;
  readonly session: DraftSessionState;
  readonly composer: ComposerThreadDraftState;
}

export interface SidebarDraftStoreSnapshot {
  readonly draftThreadsByThreadKey: Record<string, DraftSessionState>;
  readonly draftsByThreadKey: Record<string, ComposerThreadDraftState>;
}

function isScopedOut(
  session: DraftSessionState,
  scopedProjectKeys: ReadonlySet<string> | null,
): boolean {
  return (
    scopedProjectKeys !== null &&
    !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
  );
}

export function countVisibleSidebarDraftSessions(
  store: SidebarDraftStoreSnapshot,
  scopedProjectKeys: ReadonlySet<string> | null,
): number {
  let count = 0;
  for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
    if (session.promotedTo != null) continue;
    if (!composerDraftHasUserContent(store.draftsByThreadKey[draftKey])) continue;
    if (isScopedOut(session, scopedProjectKeys)) continue;
    count += 1;
  }
  return count;
}

export function resolveFrozenSidebarDraftRow(
  store: SidebarDraftStoreSnapshot,
  routeDraftId: string | null,
): SidebarDraftRowData | null {
  if (routeDraftId === null) return null;
  const draftId = DraftId.make(routeDraftId);
  const session = store.draftThreadsByThreadKey[draftId] ?? null;
  const composer = getComposerDraftState(store, draftId);
  return session && session.promotedTo == null && composer && composerDraftHasUserContent(composer)
    ? { draftId, session, composer }
    : null;
}

export function collectSidebarDraftRows(input: {
  readonly store: SidebarDraftStoreSnapshot;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly routeDraftId: string | null;
  readonly frozenActive: {
    readonly routeDraftId: string | null;
    readonly row: SidebarDraftRowData | null;
  };
}): ReadonlyArray<SidebarDraftRowData> {
  const rows: SidebarDraftRowData[] = [];
  for (const [draftKey, session] of Object.entries(input.store.draftThreadsByThreadKey)) {
    if (session.promotedTo != null) continue;
    if (isScopedOut(session, input.scopedProjectKeys)) continue;
    if (draftKey === input.routeDraftId) {
      if (input.frozenActive.routeDraftId === draftKey && input.frozenActive.row !== null) {
        rows.push(input.frozenActive.row);
      }
      continue;
    }
    const composer = input.store.draftsByThreadKey[draftKey];
    if (!composer || !composerDraftHasUserContent(composer)) continue;
    rows.push({ draftId: DraftId.make(draftKey), session, composer });
  }
  rows.sort((left, right) => right.session.createdAt.localeCompare(left.session.createdAt));
  return rows;
}

export function sidebarDraftRowPreview(composer: ComposerThreadDraftState): string {
  const promptPreview =
    replaceComposerContextReferences(composer.prompt, (occurrence) => occurrence.label)
      .trim()
      .split("\n", 1)[0] ?? "";
  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  return promptPreview.length > 0
    ? promptPreview
    : `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
}
