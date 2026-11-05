import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { videoMimeType } from "@t3tools/shared/video";

import type { ChatFileAttachment } from "../../types";

export interface ExpandedMediaAsset {
  readonly environmentId: EnvironmentId;
  readonly resource: AssetResource;
}

/** Wraps navigation in either direction, including offsets beyond a complete cycle. */
export function wrapExpandedImageIndex(index: number, imageCount: number): number {
  return imageCount > 0 ? ((index % imageCount) + imageCount) % imageCount : 0;
}

export function buildAttachmentVideoAsset(
  environmentId: EnvironmentId,
  attachment: ChatFileAttachment,
): ExpandedMediaAsset {
  return {
    environmentId,
    resource: {
      _tag: "attachment" as const,
      attachmentId: attachment.id,
      fileName: attachment.name,
      mimeType: videoMimeType(attachment) ?? attachment.mimeType,
    },
  };
}

/** The expanded viewer's caption: the item name, with its position when there is a gallery. */
export function expandedMediaCaption(name: string, index: number, count: number): string {
  return count > 1 ? `${name} (${index + 1}/${count})` : name;
}

/** The failure copy an expanded image shows, depending on whether it has a web original. */
export function expandedImageFailureMessage(hasOriginalLink: boolean): string {
  return hasOriginalLink
    ? "This image could not be loaded."
    : "Image unavailable. The file may have been moved or deleted.";
}

/** The snapshot contents toggle's label, which names what pressing it reveals. */
export function expandedMediaContentsLabel(
  showingDetails: boolean,
  format: "json" | "text" | undefined,
): string {
  if (showingDetails) return "Show screenshot";
  return format === "json" ? "Show accessibility JSON" : "Show extracted text";
}
