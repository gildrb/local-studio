import type {
  DeviceColorFilter,
  DeviceOrientation,
  DevicePermission,
  DevicePlatform,
  DeviceTextSize,
} from "@t3tools/contracts";

export const DEVICE_TEXT_SIZES: ReadonlyArray<{ value: DeviceTextSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "extra-large", label: "Extra large" },
];

export const DEVICE_COLOR_FILTERS: ReadonlyArray<{ value: DeviceColorFilter; label: string }> = [
  { value: "none", label: "None" },
  { value: "grayscale", label: "Grayscale" },
  { value: "red-green", label: "Red / green (protanopia)" },
  { value: "green-red", label: "Green / red (deuteranopia)" },
  { value: "blue-yellow", label: "Blue / yellow (tritanopia)" },
];

export const DEVICE_ORIENTATIONS: ReadonlyArray<{ value: DeviceOrientation; label: string }> = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape_left", label: "Landscape left" },
  { value: "portrait_upside_down", label: "Upside down" },
  { value: "landscape_right", label: "Landscape right" },
];

const IOS_PERMISSIONS: ReadonlyArray<{ value: DevicePermission; label: string }> = [
  { value: "camera", label: "Camera" },
  { value: "microphone", label: "Microphone" },
  { value: "photos", label: "Photos" },
  { value: "contacts", label: "Contacts" },
  { value: "calendar", label: "Calendar" },
  { value: "reminders", label: "Reminders" },
  { value: "location", label: "Location" },
  { value: "notifications", label: "Notifications" },
  { value: "motion", label: "Motion" },
  { value: "media-library", label: "Media library" },
  { value: "faceid", label: "Face ID" },
];

const ANDROID_PERMISSIONS: ReadonlyArray<{ value: DevicePermission; label: string }> = [
  { value: "camera", label: "Camera" },
  { value: "microphone", label: "Microphone" },
  { value: "photos", label: "Photos" },
  { value: "contacts", label: "Contacts" },
  { value: "calendar", label: "Calendar" },
  { value: "location", label: "Location" },
  { value: "notifications", label: "Notifications" },
  { value: "motion", label: "Physical activity" },
];

export const devicePermissions = (platform: DevicePlatform) =>
  platform === "ios" ? IOS_PERMISSIONS : ANDROID_PERMISSIONS;

export const DEVICE_LOCATION_PRESETS = [
  { label: "San Francisco", latitude: 37.7749, longitude: -122.4194 },
  { label: "New York", latitude: 40.7128, longitude: -74.006 },
  { label: "London", latitude: 51.5074, longitude: -0.1278 },
  { label: "Stockholm", latitude: 59.3293, longitude: 18.0686 },
  { label: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
] as const;

/** Coordinates typed into the Location fields, or null while they are incomplete or out of range. */
export function parseDeviceLocation(
  latitude: string,
  longitude: string,
): { readonly latitude: number; readonly longitude: number } | null {
  const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
  const valid =
    latitude.trim() !== "" &&
    longitude.trim() !== "" &&
    Math.abs(parsed.latitude) <= 90 &&
    Math.abs(parsed.longitude) <= 180;
  return valid ? parsed : null;
}

export const DEVICE_EVENT_LOG_LIMIT = 100;

/** Merge pushed event-log entries, keeping the newest `DEVICE_EVENT_LOG_LIMIT`. */
export function mergeDeviceEventLog<T>(
  current: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
  reset: boolean,
): ReadonlyArray<T> {
  const merged = reset ? [...incoming] : [...current, ...incoming];
  return merged.length > DEVICE_EVENT_LOG_LIMIT ? merged.slice(-DEVICE_EVENT_LOG_LIMIT) : merged;
}
