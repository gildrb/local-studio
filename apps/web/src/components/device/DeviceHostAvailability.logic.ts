import type { DevicePlatform, DevicePlatformAvailability } from "@t3tools/contracts";

export type DeviceHostAvailabilityItemModel = {
  readonly platform: DevicePlatform;
  readonly available: boolean;
  readonly label: string;
  readonly tooltip: string;
};

export function buildDeviceHostAvailabilityModel(
  platforms: ReadonlyArray<DevicePlatformAvailability>,
): ReadonlyArray<DeviceHostAvailabilityItemModel> {
  return platforms.map((platform) => ({
    platform: platform.platform,
    available: platform.available,
    label: `${platform.platform === "ios" ? "iOS" : "Android"} ${platform.available ? "available" : "unavailable"}`,
    tooltip:
      platform.reason ?? (platform.platform === "ios" ? "iOS available" : "Android available"),
  }));
}
