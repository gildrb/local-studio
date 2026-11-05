import type { DeviceScreenSize } from "@t3tools/client-runtime/device/input";
import type { DevicePlatform } from "@t3tools/contracts";

export const DEVICE_CONTROLS_RAIL_WIDTH = 56;

/** Displayed aspect ratio (width / height) of the device as the user sees it. */
export function deviceDisplayAspect(
  platform: DevicePlatform,
  screen: DeviceScreenSize | null,
): number {
  if (!screen) return platform === "ios" ? 9 / 19.5 : 9 / 20;
  const landscape =
    screen.orientation === "landscape_left" || screen.orientation === "landscape_right";
  const w = landscape
    ? Math.max(screen.width, screen.height)
    : Math.min(screen.width, screen.height);
  const h = landscape
    ? Math.min(screen.width, screen.height)
    : Math.max(screen.width, screen.height);
  return w / h;
}

/**
 * serve-sim streams the raw framebuffer; rotate the display for a device
 * that reports landscape while its frames stay portrait.
 */
export function deviceDisplayRotation(
  platform: DevicePlatform,
  screen: DeviceScreenSize | null,
): 0 | 90 | -90 | 180 {
  if (platform !== "ios" || !screen || screen.width > screen.height) return 0;
  switch (screen.orientation) {
    case "landscape_left":
      return 90;
    case "landscape_right":
      return -90;
    case "portrait_upside_down":
      return 180;
    default:
      return 0;
  }
}

/**
 * A sideways rotation draws the raw portrait frame into a landscape box: the
 * media takes the transposed size and is rotated about the box's center.
 */
export function deviceMediaBox(
  frame: { readonly width: number; readonly height: number },
  rotation: number,
): {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
} {
  return rotation === 90 || rotation === -90
    ? {
        width: frame.height,
        height: frame.width,
        left: (frame.width - frame.height) / 2,
        top: (frame.height - frame.width) / 2,
      }
    : { width: frame.width, height: frame.height, left: 0, top: 0 };
}

/**
 * Android restarts its encoder when a fold changes the framebuffer size.
 * Keep the last decoded frame and viewer mounted while the next keyframe arrives.
 */
export const isRetainingAndroidFrame = (input: {
  readonly platform: DevicePlatform;
  readonly status: "connecting" | "streaming" | "error";
  readonly inputConnected: boolean;
  readonly screen: DeviceScreenSize | null;
}) =>
  input.platform === "android" &&
  input.status === "connecting" &&
  input.inputConnected &&
  input.screen !== null;

export const deviceInputDisconnectedNotice = (detail: string | undefined) =>
  `Input disconnected${detail ? ` (${detail})` : ""}, reconnecting…`;

export const deviceStreamLoadingMessage = (
  status: "connecting" | "streaming" | "error",
  detail: string | undefined,
) => (status === "error" ? (detail ?? "Stream failed.") : "Connecting video…");

/** Clamp a pointer inside the displayed frame to normalized device coordinates. */
export function normalizedDevicePoint(
  point: { readonly x: number; readonly y: number },
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): { readonly x: number; readonly y: number } {
  const x = (point.x - rect.left) / rect.width;
  const y = (point.y - rect.top) / rect.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}
