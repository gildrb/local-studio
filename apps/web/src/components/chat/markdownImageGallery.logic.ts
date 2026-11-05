import { mediaKindFromPath } from "@t3tools/shared/filePreview";

import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import { resolveProtocolRelativeMediaUrl } from "../media/mediaContent";

export type MarkdownGalleryEntry =
  | { readonly included: false }
  | { readonly included: true; readonly linkedSource: string | null };

/**
 * How an image inside (or outside) a link joins the expanded gallery: a link to something other
 * than an image keeps the image out, and a link to a web image shows the linked full size.
 */
export function markdownGalleryEntry(href: string | null): MarkdownGalleryEntry {
  if (href === null) return { included: true, linkedSource: null };
  if (mediaKindFromPath(href) !== "image") return { included: false };
  return {
    included: true,
    linkedSource:
      resolveExternalWebLinkHost(href) !== null ? resolveProtocolRelativeMediaUrl(href) : null,
  };
}
