import {
  type ChatFileAttachment,
  type EnvironmentId,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "@t3tools/contracts";
import {
  clampFileAttachmentUploadBytes,
  fileAttachmentTooLargeMessage,
} from "@t3tools/client-runtime/state/attachments";

import {
  composerFileMatchesReattachMarker,
  composerFileNeedsReattach,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "../../composerDraftStore";
import { isHeicImageFile } from "../../lib/imageCompression";
import { isVideoAttachment, videoMimeType } from "../../types";

type ComposerAttachmentFileKind = "image" | "file" | "unsupported-image";

interface FileAttachmentCapabilityState {
  readonly attachmentUploadsCapabilityKnown: boolean;
  readonly supportsAttachmentUploads: boolean;
  readonly maxFileAttachmentBytes: number | null;
}

const IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Some sources (drags from other apps, files piped through a shell) hand over
 * a `File` with an empty or generic MIME type. Maps the extension to a
 * provider-supported image type so a plain `photo.jpg` still lands on the
 * image path; anything unrecognized stays a generic file.
 */
export function inferImageMimeTypeFromName(name: string): string | null {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return null;
  }
  return IMAGE_MIME_TYPE_BY_EXTENSION[name.slice(dotIndex + 1).toLowerCase()] ?? null;
}

function inferImageMimeTypeForUnknownFile(file: Pick<File, "name" | "type">): string | null {
  const mimeType = file.type.toLowerCase();
  if (mimeType !== "" && mimeType !== "application/octet-stream") {
    return null;
  }
  return inferImageMimeTypeFromName(file.name);
}

/** Give extension-recognized images a concrete type before compression. */
export function normalizeComposerImageFileMimeType(file: File): File {
  const inferredMimeType = inferImageMimeTypeForUnknownFile(file);
  if (!inferredMimeType) {
    return file;
  }
  return new File([file], file.name, {
    type: inferredMimeType,
    lastModified: file.lastModified,
  });
}

export function classifyComposerAttachmentFile(
  file: Pick<File, "name" | "type">,
): ComposerAttachmentFileKind {
  if (isHeicImageFile(file)) {
    return "image";
  }
  if (inferImageMimeTypeForUnknownFile(file)) {
    return "image";
  }
  if (!file.type.toLowerCase().startsWith("image/")) {
    return "file";
  }
  return isProviderSendTurnSupportedImageMimeType(file.type) ? "image" : "unsupported-image";
}

export interface ComposerAttachmentIntake {
  readonly acceptedImages: File[];
  readonly acceptedFiles: ComposerFileAttachment[];
  readonly error: string | null;
}

export function classifyComposerAttachmentIntake(input: {
  readonly files: ReadonlyArray<File>;
  readonly reservedCount: number;
  readonly reattachMarkers: ReadonlyArray<ComposerFileAttachment>;
  readonly fileStagingLimit: number | null;
  readonly newId: () => string;
  readonly source?: ChatFileAttachment["source"];
}): ComposerAttachmentIntake {
  let reservedCount = input.reservedCount;
  const replacedReattachMarkerIds = new Set<string>();
  const acceptedImages: File[] = [];
  const acceptedFiles: ComposerFileAttachment[] = [];
  let error: string | null = null;
  for (const file of input.files) {
    const attachmentKind = classifyComposerAttachmentFile(file);
    const fileMimeType =
      attachmentKind === "file"
        ? (videoMimeType({ name: file.name, mimeType: file.type }) ??
          (file.type || "application/octet-stream"))
        : file.type;
    const matchingReattachMarker =
      attachmentKind === "file"
        ? input.reattachMarkers.find(
            (marker) =>
              !replacedReattachMarkerIds.has(marker.id) &&
              composerFileMatchesReattachMarker(marker, {
                name: file.name || "file",
                mimeType: fileMimeType,
                sizeBytes: file.size,
              }),
          )
        : undefined;
    if (matchingReattachMarker) {
      replacedReattachMarkerIds.add(matchingReattachMarker.id);
    }
    if (!matchingReattachMarker && reservedCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
      continue;
    }
    if (attachmentKind === "unsupported-image") {
      error = `'${file.name}' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.`;
      continue;
    }
    if (attachmentKind === "image") {
      acceptedImages.push(normalizeComposerImageFileMimeType(file));
    } else {
      if (input.fileStagingLimit === null) {
        error = "This server does not support file attachments.";
        continue;
      }
      if (file.size <= 0) {
        error = `'${file.name}' is empty or could not be read.`;
        continue;
      }
      if (file.size > input.fileStagingLimit) {
        error = fileAttachmentTooLargeMessage(file.name, input.fileStagingLimit);
        continue;
      }
      const attachmentFile =
        file.type === fileMimeType
          ? file
          : new File([file], file.name, { type: fileMimeType, lastModified: file.lastModified });
      acceptedFiles.push({
        type: "file",
        id: input.newId(),
        name: attachmentFile.name || "file",
        mimeType: fileMimeType,
        sizeBytes: attachmentFile.size,
        file: attachmentFile,
        ...(input.source ? { source: input.source } : {}),
      });
    }
    if (!matchingReattachMarker) {
      reservedCount += 1;
    }
  }
  return { acceptedImages, acceptedFiles, error };
}

export function isPreviewableComposerVideo(
  file: ComposerFileAttachment,
  environmentId: EnvironmentId,
): boolean {
  return (
    isVideoAttachment(file) &&
    (file.file !== null ||
      (file.uploadedAttachmentId !== undefined && file.uploadEnvironmentId === environmentId))
  );
}

/** Non-media files without an inline reference still need the legacy attachment row. */
export function composerOtherFilesForPresentation(
  files: ReadonlyArray<ComposerFileAttachment>,
  environmentId: EnvironmentId,
  inlineFileIds: ReadonlySet<string>,
): ComposerFileAttachment[] {
  return files.filter(
    (file) => !isPreviewableComposerVideo(file, environmentId) && !inlineFileIds.has(file.id),
  );
}

/** Byte limit for adding a generic file to the local composer draft. */
export function fileAttachmentStagingLimit(input: FileAttachmentCapabilityState): number | null {
  if (!input.attachmentUploadsCapabilityKnown) {
    return PROVIDER_SEND_TURN_MAX_FILE_BYTES;
  }
  if (!input.supportsAttachmentUploads || input.maxFileAttachmentBytes === null) {
    return null;
  }
  return clampFileAttachmentUploadBytes(input.maxFileAttachmentBytes);
}

/** Why retained generic files cannot send with the current server config. */
export function fileAttachmentCapabilityBlockReason(
  input: FileAttachmentCapabilityState & {
    readonly files: ReadonlyArray<{ readonly name: string; readonly sizeBytes: number }>;
  },
): string | null {
  if (input.files.length === 0) {
    return null;
  }
  if (!input.attachmentUploadsCapabilityKnown) {
    return "Waiting for the server before file attachments can send";
  }
  const maxFileAttachmentBytes = fileAttachmentStagingLimit(input);
  if (maxFileAttachmentBytes === null) {
    return "This server does not accept file attachments right now. Remove the files to send.";
  }
  const oversizedFile = input.files.find((file) => file.sizeBytes > maxFileAttachmentBytes);
  if (oversizedFile) {
    return fileAttachmentTooLargeMessage(oversizedFile.name, maxFileAttachmentBytes);
  }
  return null;
}

/**
 * When `capabilities.attachmentUploads` flips off (reconnect, version skew),
 * tear down only uploads that have not been persisted onto a draft file.
 * Once `uploadedAttachmentId` is stamped, the draft references that server
 * copy after reload even if its local `File` is still available in memory.
 * Explicit attachment removal releases persisted uploads through
 * `releaseDraftAttachment`.
 */
export function attachmentsToReleaseOnUploadCapabilityLoss(
  attachments: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>,
): Array<ComposerImageAttachment | ComposerFileAttachment> {
  return attachments.filter(
    (attachment) => !(attachment.type === "file" && attachment.uploadedAttachmentId !== undefined),
  );
}

export interface ComposerAttachmentUploadPlan {
  readonly release: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
  readonly start: ReadonlyArray<ComposerImageAttachment | ComposerFileAttachment>;
}

export function planComposerAttachmentUploads(input: {
  readonly attachmentUploadsCapabilityKnown: boolean;
  readonly supportsAttachmentUploads: boolean;
  readonly maxFileAttachmentBytes: number | null;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
}): ComposerAttachmentUploadPlan {
  if (!input.attachmentUploadsCapabilityKnown) {
    return { release: [], start: [] };
  }
  if (!input.supportsAttachmentUploads) {
    return {
      release: attachmentsToReleaseOnUploadCapabilityLoss([...input.images, ...input.files]),
      start: [],
    };
  }
  const maxBytes = input.maxFileAttachmentBytes;
  const invalidFiles =
    maxBytes === null ? input.files : input.files.filter((file) => file.sizeBytes > maxBytes);
  const uploadableFiles =
    maxBytes === null ? [] : input.files.filter((file) => file.sizeBytes <= maxBytes);
  return {
    release: attachmentsToReleaseOnUploadCapabilityLoss(invalidFiles),
    start: [...input.images, ...uploadableFiles].filter(
      (attachment) => !(attachment.type === "file" && composerFileNeedsReattach(attachment)),
    ),
  };
}

/**
 * Whether a paste's files should be claimed as composer attachments instead of
 * falling through to the default text paste. Deliberately no capacity or
 * pending-plan-question gate here: `addComposerAttachments` owns those limits
 * and reports them, while a gate at this layer would swallow the paste with no
 * feedback.
 */
export function shouldHandleComposerAttachmentPaste(input: {
  readonly files: ReadonlyArray<File>;
  readonly plainText: string;
}): boolean {
  if (
    input.files.some((file) => {
      const classification = classifyComposerAttachmentFile(file);
      return classification === "image" || classification === "unsupported-image";
    })
  ) {
    return true;
  }

  if (input.plainText.length > 0) {
    return false;
  }

  return input.files.some((file) => classifyComposerAttachmentFile(file) === "file");
}
