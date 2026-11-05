/** Discrete zoom levels mirroring Chrome's preset list. */
export const ZOOM_LEVELS: ReadonlyArray<number> = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
];

export const DEFAULT_ZOOM_FACTOR = 1.0;
export const ZOOM_EPSILON = 0.001;

const findZoomStep = (current: number): number => {
  const index = ZOOM_LEVELS.findIndex(
    (level) => Math.abs(level - current) < ZOOM_EPSILON || level > current,
  );
  if (index < 0) return ZOOM_LEVELS.length - 1;
  return Math.abs((ZOOM_LEVELS[index] ?? current) - current) < ZOOM_EPSILON ? index : index - 1;
};

/**
 * Clamp a client-supplied zoom factor onto the discrete ladder. The setting is
 * chosen from the same ladder, but it arrives over IPC from a schema that only
 * guarantees a positive number, so an out-of-band value snaps to the nearest
 * step rather than leaving the guest at a zoom the zoom controls can't reach.
 */
export const normalizeZoomFactor = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ZOOM_FACTOR;
  let closest = ZOOM_LEVELS[0] ?? DEFAULT_ZOOM_FACTOR;
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - value) < Math.abs(closest - value)) closest = level;
  }
  return closest;
};

export const nextZoomLevel = (current: number, direction: "in" | "out"): number => {
  const step = findZoomStep(current);
  if (direction === "in") {
    return ZOOM_LEVELS[Math.min(step + 1, ZOOM_LEVELS.length - 1)] ?? current;
  }
  return ZOOM_LEVELS[Math.max(step - 1, 0)] ?? current;
};

const MAX_ARTIFACT_SITE_SLUG_LENGTH = 80;

export const artifactSiteSlug = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    const slug = url.hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_ARTIFACT_SITE_SLUG_LENGTH)
      .replace(/-+$/g, "");
    return slug || "site";
  } catch {
    return "site";
  }
};
