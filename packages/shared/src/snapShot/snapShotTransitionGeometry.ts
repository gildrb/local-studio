import type { SnapShotRectangle } from "./snapShotImage.ts";

const MIN_DURATION_MS = 280;
const MAX_DURATION_MS = 680;
const DURATION_DISTANCE_SCALE = 2_000;

/** CSS easing of the capture flight; `cubic-bezier(.2,.8,.2,1)`. */
export const SNAP_SHOT_ANIMATION_EASING = [0.2, 0.8, 0.2, 1] as const;
/** A transition that never receives its destination is torn down after this long. */
export const SNAP_SHOT_ANIMATION_TIMEOUT_MS = 6_000;

export type SnapShotAnimationDetails = {
  readonly appName: string;
  readonly windowTitle: string;
  readonly appIconDataUrl?: string | undefined;
};

export type SnapShotAnimationDestination = {
  readonly frame: SnapShotRectangle;
  /** Unit coordinates in T3's content area; GNOME supplies the real compositor origin. */
  readonly relativeFrame?: SnapShotRectangle | undefined;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderWidth: number;
  readonly cornerRadius: number;
  readonly scaleFactor: number;
  readonly details?: SnapShotAnimationDetails | undefined;
};

export function snapShotAnimationDurationMs(
  source: SnapShotRectangle,
  target: SnapShotRectangle,
): number {
  const distance = Math.hypot(
    source.x + source.width / 2 - target.x - target.width / 2,
    source.y + source.height / 2 - target.y - target.height / 2,
  );
  return (
    MAX_DURATION_MS -
    (MAX_DURATION_MS - MIN_DURATION_MS) * Math.exp(-distance / DURATION_DISTANCE_SCALE)
  );
}

export function snapShotAnimationOverlayBounds(
  displays: ReadonlyArray<{ readonly bounds: SnapShotRectangle }>,
): SnapShotRectangle {
  const firstDisplay = displays[0];
  const first = firstDisplay?.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const display of displays.slice(1)) {
    const bounds = display.bounds;
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function snapShotAnimationDisplayBounds(
  displays: ReadonlyArray<{ readonly bounds: SnapShotRectangle }>,
  source: SnapShotRectangle,
  destination: SnapShotRectangle,
): Array<SnapShotRectangle> {
  const flight = snapShotAnimationOverlayBounds([{ bounds: source }, { bounds: destination }]);
  return displays
    .map((display) => display.bounds)
    .filter(
      (bounds) =>
        bounds.x < flight.x + flight.width &&
        bounds.x + bounds.width > flight.x &&
        bounds.y < flight.y + flight.height &&
        bounds.y + bounds.height > flight.y,
    );
}
