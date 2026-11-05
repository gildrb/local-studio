import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { selectMessageImageResources } from "@t3tools/web/src/session-logic.ts";
import { isImageAttachment, type ChatMessage } from "@t3tools/web/src/types.ts";
import * as Option from "effect/Option";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";

import type { WorkspaceImageResolver } from "./markdownDocument.ts";
import type { CoreState } from "./state.ts";
import type { TimelineUserImageView } from "./views/timeline.ts";

/** The images a sent message shows above its text (web UserTimelineRow, useAssetUrls). */
export function userMessageImages(
  get: Atom.AtomContext,
  state: CoreState,
  environmentId: EnvironmentId,
  message: ChatMessage,
): ReadonlyArray<TimelineUserImageView> {
  const images = (message.attachments ?? []).filter(isImageAttachment);
  if (images.length === 0) return [];
  const connection = get(state.environmentSession.preparedConnectionValueAtom(environmentId));
  const urlsById = new Map<string, string>();
  for (const resource of selectMessageImageResources(message.attachments)) {
    const result = get(state.assetEnvironment.createUrl({ environmentId, input: { resource } }));
    if (!AsyncResult.isSuccess(result) || Option.isNone(connection)) continue;
    const url = resolveAssetUrl(connection.value.httpBaseUrl, result.value.relativeUrl);
    if (url !== null && resource._tag === "attachment") urlsById.set(resource.attachmentId, url);
  }
  return images.map((image) => ({
    id: image.id,
    name: image.name,
    url: urlsById.get(image.id) ?? image.previewUrl ?? null,
  }));
}

/** Signed asset URLs for Markdown images on the environment host (ChatMarkdownAssetImage). */
export function workspaceImageResolver(
  get: Atom.AtomContext,
  state: CoreState,
  environmentId: EnvironmentId,
  threadId: ThreadId,
): WorkspaceImageResolver {
  return (path) => {
    const connection = get(state.environmentSession.preparedConnectionValueAtom(environmentId));
    if (Option.isNone(connection)) return null;
    const result = get(
      state.assetEnvironment.createUrl({
        environmentId,
        input: { resource: { _tag: "media-file", threadId, path } },
      }),
    );
    if (!AsyncResult.isSuccess(result)) return null;
    return resolveAssetUrl(connection.value.httpBaseUrl, result.value.relativeUrl);
  };
}
