import { mediaUrlReference } from "@t3tools/client-runtime/media-reference";
import type { ExpandedImageItem, ExpandedImagePreview } from "./ExpandedImagePreview";
import { markdownGalleryEntry } from "./markdownImageGallery.logic";

// Weak keys retain resolved media actions only while the rendered image is reachable.
export const markdownImageItems = new WeakMap<Element, ExpandedImageItem>();

/** Collect in document order only when opened, including PR sections separated by videos. */
export function markdownImageGallery(
  element: Element,
  selected: ExpandedImageItem,
): ExpandedImagePreview {
  const scope = element.closest("[data-image-gallery]") ?? element.closest(".chat-markdown");
  const images: ExpandedImageItem[] = [];
  let index = -1;
  for (const image of scope?.querySelectorAll("img") ?? []) {
    const registered = markdownImageItems.get(image);
    if (!registered) continue;
    const link = image.closest("a");
    const href = link ? (link.getAttribute("href") ?? "") : null;
    const entry = markdownGalleryEntry(href);
    if (!entry.included) continue;
    const linkedSource = entry.linkedSource;
    const reference = mediaUrlReference(href ?? "");
    const item =
      linkedSource && href !== null
        ? {
            ...registered,
            src: linkedSource,
            originalUrl: href,
            actionsSource: {
              kind: "image" as const,
              name: registered.name,
              src: linkedSource,
              ...(reference ? { reference } : {}),
            },
          }
        : registered;
    if (
      image === element ||
      (!markdownImageItems.has(element) && index < 0 && item.src === selected.src)
    ) {
      index = images.length;
      images.push(selected);
    } else {
      images.push(item);
    }
  }
  return index < 0 ? { images: [selected], index: 0 } : { images, index };
}
