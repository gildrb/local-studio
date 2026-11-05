import { resolveExternalWebLinkHost } from "../chat/externalLinkContextMenu";
import { resolveProtocolRelativeMediaUrl } from "./mediaContent";

export interface OpenMediaLinkTarget {
  readonly url: string;
  readonly isBlob: boolean;
  readonly label: "Open original" | "Download video" | "Open in browser";
}

/** Where a media escape hatch leads: the authored web original first, else the loaded source. */
export function resolveOpenMediaLink(input: {
  readonly originalUrl?: string | null | undefined;
  readonly src?: string | null | undefined;
}): OpenMediaLinkTarget | null {
  const originalUrl =
    resolveExternalWebLinkHost(input.originalUrl ?? undefined) !== null
      ? (input.originalUrl ?? undefined)
      : undefined;
  const source = originalUrl ?? input.src;
  if (!source) return null;
  const url = resolveProtocolRelativeMediaUrl(source);
  let isBlob = false;
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:" && protocol !== "blob:") return null;
    isBlob = protocol === "blob:";
  } catch {
    return null;
  }
  return {
    url,
    isBlob,
    label: originalUrl ? "Open original" : isBlob ? "Download video" : "Open in browser",
  };
}
