import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import type {
  ComposerFileAttachment,
  ComposerImageAttachment,
  ComposerThreadDraftState,
  DraftThreadState,
} from "../composerDraftStore";

export type ProjectDraftUploadsSource = {
  readonly draftsByThreadKey: Readonly<Record<string, ComposerThreadDraftState>>;
  readonly draftThreadsByThreadKey: Readonly<Record<string, DraftThreadState>>;
};

/**
 * Every upload a deleted project's drafts still hold. Draft-thread sessions
 * carry their project ref, but drafts on the project's real threads live in
 * `draftsByThreadKey` under scoped thread keys with no project in the key, so
 * the caller passes the project's thread refs alongside.
 */
export function collectProjectDraftUploads(
  source: ProjectDraftUploadsSource,
  projectRef: ScopedProjectRef,
  projectThreadRefs: ReadonlyArray<ScopedThreadRef> = [],
): Array<ComposerImageAttachment | ComposerFileAttachment> {
  const uploads: Array<ComposerImageAttachment | ComposerFileAttachment> = [];
  for (const [draftKey, session] of Object.entries(source.draftThreadsByThreadKey)) {
    if (
      session.environmentId === projectRef.environmentId &&
      session.projectId === projectRef.projectId
    ) {
      const draft = source.draftsByThreadKey[draftKey];
      if (draft) uploads.push(...draft.images, ...draft.files);
    }
  }
  for (const threadRef of projectThreadRefs) {
    const draft = source.draftsByThreadKey[scopedThreadKey(threadRef)];
    if (draft) uploads.push(...draft.images, ...draft.files);
  }
  return uploads;
}
