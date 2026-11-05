import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { releaseDraftAttachments } from "./attachmentUploadQueue";
import { collectProjectDraftUploads } from "./projectDraftUploads.logic";

export function releaseComposerDraftUploads(target: ScopedThreadRef | DraftId): void {
  const draft = useComposerDraftStore.getState().getComposerDraft(target);
  if (draft) {
    releaseDraftAttachments([...draft.images, ...draft.files]);
  }
}

export function releaseProjectDraftUploads(
  projectRef: ScopedProjectRef,
  projectThreadRefs: ReadonlyArray<ScopedThreadRef> = [],
): void {
  releaseDraftAttachments(
    collectProjectDraftUploads(useComposerDraftStore.getState(), projectRef, projectThreadRefs),
  );
}
