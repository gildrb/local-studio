import { writeFile } from "node:fs/promises";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import { resolveFileAttachmentUrl } from "@t3tools/web/src/components/ChatView.logic.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { isFileAttachment, type ChatFileAttachment } from "@t3tools/web/src/types.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext, ThreadInput } from "./feature.ts";
import { openExternal } from "./openExternal.ts";
import { mediaViewerService } from "./features/mediaViewer.ts";
import type { TimelineExpansion } from "./timelineView.ts";

const MessageParams = Schema.decodeUnknownSync(Schema.Struct({ messageId: Schema.String }));
const PathParams = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }));
const AttachmentParams = Schema.decodeUnknownSync(
  Schema.Struct({ messageId: Schema.String, attachmentId: Schema.String }),
);
const ExpandImageParams = Schema.decodeUnknownSync(
  Schema.Struct({
    messageId: Schema.String,
    attachmentId: Schema.String,
    scope: Schema.optional(Schema.Literals(["grid", "message"])),
  }),
);
const DownloadParams = Schema.decodeUnknownSync(
  Schema.Struct({ messageId: Schema.String, attachmentId: Schema.String, path: Schema.String }),
);
const HrefParams = Schema.decodeUnknownSync(Schema.Struct({ href: Schema.String }));
const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

export function createTimelineUserFeature(
  context: FeatureContext,
  deps: { readonly expansionAtom: Atom.Writable<TimelineExpansion> },
): CoreFeature {
  const { registry, state } = context;

  const requireInput = (action: string): ThreadInput => {
    const input = registry.get(context.threadInputAtom);
    if (input === null) throw new Error(`${action} needs an open thread.`);
    return input;
  };

  const findFileAttachment = (
    action: string,
    messageId: string,
    attachmentId: string,
  ): { readonly input: ThreadInput; readonly attachment: ChatFileAttachment } => {
    const input = requireInput(action);
    const attachment = input.thread.messages
      .find((message) => message.id === messageId)
      ?.attachments?.find((candidate) => candidate.id === attachmentId);
    if (attachment === undefined || !isFileAttachment(attachment)) {
      throw new Error("The attachment is unavailable.");
    }
    return { input, attachment };
  };

  return {
    views: {},
    actions: {
      toggleUserMessageExpanded: async (params) => {
        const { messageId } = MessageParams(params);
        const current = registry.get(deps.expansionAtom);
        const userMessageIds = new Set(current.userMessageIds);
        if (!userMessageIds.delete(messageId)) userMessageIds.add(messageId);
        registry.set(deps.expansionAtom, { ...current, userMessageIds });
        return null;
      },
      openTimelineMention: async (params) => {
        const { path } = PathParams(params);
        useRightPanelStore.getState().openFile(requireInput("openTimelineMention").route, path);
        return null;
      },
      openTimelineAttachment: async (params) => {
        const { messageId, attachmentId } = AttachmentParams(params);
        const { input, attachment } = findFileAttachment(
          "openTimelineAttachment",
          messageId,
          attachmentId,
        );
        useRightPanelStore.getState().openAttachment(input.route, attachment);
        return null;
      },
      downloadTimelineAttachment: async (params) => {
        const { messageId, attachmentId, path } = DownloadParams(params);
        const { input, attachment } = findFileAttachment(
          "downloadTimelineAttachment",
          messageId,
          attachmentId,
        );
        const environmentId = input.thread.environmentId;
        const connection = registry.get(
          state.environmentSession.preparedConnectionValueAtom(environmentId),
        );
        if (Option.isNone(connection)) {
          context.addToast({
            layout: "plain",
            type: "error",
            title: "The environment is not connected.",
          });
          return null;
        }
        try {
          const url = await resolveFileAttachmentUrl({
            attachment,
            environmentId,
            httpBaseUrl: connection.value.httpBaseUrl,
            createAssetUrl: (target) =>
              executeAtomQuery(registry, state.assetEnvironment.createUrl(target), {
                label: "Create attachment URL",
                reportFailure: false,
                reportDefect: true,
                refresh: true,
              }),
          });
          const response = await fetch(url);
          if (!response.ok) throw new Error(`The download failed (${response.status}).`);
          await writeFile(path, new Uint8Array(await response.arrayBuffer()));
        } catch (error) {
          context.addToast({
            layout: "plain",
            type: "error",
            title: "Could not download " + attachment.name,
            description: error instanceof Error ? error.message : "The attachment is unavailable.",
          });
        }
        return null;
      },
      expandTimelineImage: async (params) => {
        const { messageId, attachmentId, scope } = ExpandImageParams(params);
        const input = requireInput("expandTimelineImage");
        const message = input.thread.messages.find((candidate) => candidate.id === messageId);
        if (message === undefined) throw new Error("The message is unavailable.");
        mediaViewerService(context).openTimelineImage(
          message,
          input.thread.environmentId,
          attachmentId,
          scope ?? "message",
        );
        return null;
      },
      expandTimelineVideo: async (params) => {
        const { messageId, attachmentId } = AttachmentParams(params);
        const input = requireInput("expandTimelineVideo");
        const message = input.thread.messages.find((candidate) => candidate.id === messageId);
        if (message === undefined) throw new Error("The message is unavailable.");
        mediaViewerService(context).openTimelineVideo(
          message,
          input.thread.environmentId,
          attachmentId,
        );
        return null;
      },
      openTimelinePullRequest: async (params) => {
        await openExternal(UrlParams(params).url);
        return null;
      },
      openAssistantCitation: async (params) => {
        const citation = parseAssistantCitationHref(HrefParams(params).href);
        if (citation === null) throw new Error("The cited assistant text is unavailable.");
        context.navigateToThread(scopeThreadRef(citation.environmentId, citation.threadId));
        return null;
      },
    },
  };
}
