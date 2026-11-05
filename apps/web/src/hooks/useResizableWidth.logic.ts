export interface ResizableWidthBounds {
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

export function clampResizableWidth(value: number, bounds: ResizableWidthBounds): number {
  if (!Number.isFinite(value)) return bounds.defaultWidth;
  return Math.max(bounds.minWidth, Math.min(bounds.maxWidth, value));
}
