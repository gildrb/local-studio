/** The failure line a video shows in place of its frame. */
export function videoUnavailableLabel(label: string): string {
  return `Video unavailable${label ? ` · ${label}` : ""}`;
}

/** A failed video can retry when it has a source to reload or a way to mint a fresh one. */
export function canRetryVideo(latestSrc: string | null, hasRetry: boolean): boolean {
  return latestSrc !== null || hasRetry;
}
