export const PREVIEW_PANEL_WIDTH_STORAGE_KEY = "t3code:preview-panel-width";
export const PREVIEW_PANEL_MIN_WIDTH = 360;
/**
 * Upper bound as a fraction of the viewport; only binds on wide screens.
 * On narrow windows the container clamp below is what preserves the
 * sibling column's space.
 */
export const PREVIEW_PANEL_MAX_WIDTH_FRACTION = 0.7;
export const PREVIEW_PANEL_DEFAULT_WIDTH = 540;
/**
 * Width reserved for the sibling column (chat, pull-request list) sharing the
 * panel's flex row. The viewport fraction alone is not enough: the app
 * sidebar sits outside the row, so on narrow windows (any MacBook, even
 * fullscreen) the remaining 30% of the viewport minus the sidebar left the
 * sibling below its usable width and the composer overflowed.
 */
export const SIBLING_COLUMN_MIN_WIDTH = 360;

export function getPreviewPanelMaxWidth(viewportWidth: number, containerWidth?: number): number {
  const fractionCap = Math.floor(viewportWidth * PREVIEW_PANEL_MAX_WIDTH_FRACTION);
  const containerCap =
    containerWidth === undefined ? Infinity : Math.floor(containerWidth) - SIBLING_COLUMN_MIN_WIDTH;
  // Never below the panel's own minimum: when the row cannot fit both
  // columns' minimums the sibling yields, and useResizableWidth's clamp
  // must not see max < min (it would resolve the inversion to min and,
  // via drag-end persistence, overwrite the user's stored width).
  return Math.max(PREVIEW_PANEL_MIN_WIDTH, Math.min(fractionCap, containerCap));
}
