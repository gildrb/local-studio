import type { ComposerContextRecord, KnownComposerContextRecord } from "@t3tools/contracts";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";

import {
  asKnownContextRecord,
  type ResolvedUserMessageContext,
} from "../../lib/composerContextRecords";
import {
  isFileAttachment,
  isImageAttachment,
  isVideoAttachment,
  type ChatAttachment,
  type ChatFileAttachment,
  type ChatImageAttachment,
} from "../../types";

export const MAX_COLLAPSED_USER_MESSAGE_LINES = 8;
export const MAX_COLLAPSED_USER_MESSAGE_LENGTH = 600;
export const COLLAPSED_USER_MESSAGE_FADE_HEIGHT_REM = 1.75;

export function shouldCollapseUserMessage(text: string): boolean {
  if (text.trim().length === 0) {
    return false;
  }

  return (
    text.length > MAX_COLLAPSED_USER_MESSAGE_LENGTH ||
    text.split("\n").length > MAX_COLLAPSED_USER_MESSAGE_LINES
  );
}

const PREVIEW_ANNOTATION_IMAGE_PREFIX = "preview-annotation-";

export interface UserMessageAttachments {
  readonly userImages: ReadonlyArray<ChatImageAttachment>;
  readonly userFiles: ReadonlyArray<ChatFileAttachment>;
  readonly userVideos: ReadonlyArray<ChatFileAttachment>;
  readonly regularImages: ReadonlyArray<ChatImageAttachment>;
  readonly previewImages: ReadonlyArray<ChatImageAttachment>;
  readonly unchippedFiles: ReadonlyArray<ChatFileAttachment>;
  readonly unknownAttachments: ReadonlyArray<ChatAttachment>;
  readonly annotationRecordIds: ReadonlyArray<string>;
}

export function deriveUserMessageAttachments(input: {
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly previewAttachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly context: ResolvedUserMessageContext;
}): UserMessageAttachments {
  const attachments = input.attachments ?? [];
  const userImages = (input.previewAttachments ?? []).filter(isImageAttachment);
  const userFiles = attachments.filter(isFileAttachment);
  const userVideos = userFiles.filter(isVideoAttachment);
  const otherUserFiles = userFiles.filter((file) => !isVideoAttachment(file));
  const unknownAttachments = attachments.filter(
    (attachment) => !isImageAttachment(attachment) && !isFileAttachment(attachment),
  );
  const chippedAttachmentIds = new Set(
    collectComposerContextReferences(input.context.text).flatMap((occurrence) => {
      const record = asKnownContextRecord(input.context.recordsById.get(occurrence.contextId));
      return record?.kind === "file" || record?.kind === "image" ? [record.attachmentId] : [];
    }),
  );
  return {
    userImages,
    userFiles,
    userVideos,
    regularImages: userImages.filter(
      (image) => !image.name.startsWith(PREVIEW_ANNOTATION_IMAGE_PREFIX),
    ),
    previewImages: userImages.filter((image) =>
      image.name.startsWith(PREVIEW_ANNOTATION_IMAGE_PREFIX),
    ),
    unchippedFiles: otherUserFiles.filter((file) => !chippedAttachmentIds.has(file.id)),
    unknownAttachments,
    annotationRecordIds: input.context.records
      .filter((record) => record.kind === "preview-annotation")
      .map((record) => record.contextId),
  };
}

export function resolvePreviewAnnotationImage(input: {
  record: Extract<KnownComposerContextRecord, { kind: "preview-annotation" }>;
  recordsById: ReadonlyMap<string, ComposerContextRecord>;
  userImages: ReadonlyArray<ChatImageAttachment>;
  previewImages: ReadonlyArray<ChatImageAttachment>;
  annotationRecordIds: ReadonlyArray<string>;
}): ChatImageAttachment | null {
  const screenshotRecord = input.record.screenshotContextId
    ? asKnownContextRecord(input.recordsById.get(input.record.screenshotContextId))
    : undefined;
  return (
    (screenshotRecord?.kind === "image"
      ? input.userImages.find((image) => image.id === screenshotRecord.attachmentId)
      : undefined) ??
    input.previewImages.find(
      (image) =>
        image.name === `${PREVIEW_ANNOTATION_IMAGE_PREFIX}${input.record.annotationId}.png`,
    ) ??
    input.previewImages[input.annotationRecordIds.indexOf(input.record.contextId)] ??
    null
  );
}
