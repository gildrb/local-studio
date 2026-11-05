import type { DevicePlatform, DeviceSettings, DeviceTextSize } from "@t3tools/contracts";

export const DEVICE_RAIL_TEXT_SIZES: ReadonlyArray<readonly [DeviceTextSize, string]> = [
  ["small", "Small"],
  ["default", "Default"],
  ["large", "Large"],
  ["extra-large", "Extra large"],
];

export type DeviceControlsRailModel = {
  readonly inputDisabled: boolean;
  /** Android rotates through a menu of device orientations; iOS steps the simulator. */
  readonly rotate:
    | { readonly kind: "menu"; readonly disabled: boolean }
    | { readonly kind: "button"; readonly disabled: boolean };
  readonly appearance: {
    readonly label: string;
    readonly next: "light" | "dark";
    readonly icon: "sun" | "moon";
    readonly disabled: boolean;
  };
  readonly textSize: { readonly value: DeviceTextSize | null; readonly disabled: boolean };
  readonly screenshot: { readonly label: string; readonly disabled: boolean };
  readonly phoneView: { readonly disabled: boolean; readonly description: string | null };
  readonly flatViewDisabled: boolean;
  readonly keyboard: { readonly label: string; readonly attached: boolean } | null;
};

export function buildDeviceControlsRailModel(input: {
  readonly platform: DevicePlatform;
  readonly inputConnected: boolean;
  readonly controlsDisabled: boolean;
  readonly settings: DeviceSettings | undefined;
  readonly streaming: boolean;
  readonly phoneUnavailableReason: string | null;
  readonly keyboardAttached: boolean | null;
  readonly screenshotPending: boolean;
}): DeviceControlsRailModel {
  const { settings } = input;
  const inputDisabled = !input.inputConnected;
  const next = settings?.appearance === "dark" ? "light" : "dark";
  return {
    inputDisabled,
    rotate:
      input.platform === "android"
        ? { kind: "menu", disabled: input.controlsDisabled }
        : { kind: "button", disabled: inputDisabled || input.keyboardAttached === true },
    appearance: {
      label: `Switch device to ${next} mode`,
      next,
      icon: settings?.appearance === "dark" ? "sun" : "moon",
      disabled: input.controlsDisabled || !settings?.appearance,
    },
    textSize: {
      value: settings?.textSize ?? null,
      disabled: input.controlsDisabled || !settings?.textSize,
    },
    screenshot: {
      label: input.screenshotPending ? "Capturing screenshot" : "Save screenshot",
      disabled: !input.streaming || input.screenshotPending,
    },
    phoneView: {
      disabled: !input.streaming || !!input.phoneUnavailableReason,
      description: input.phoneUnavailableReason,
    },
    flatViewDisabled: !input.streaming,
    keyboard:
      input.keyboardAttached === null
        ? null
        : {
            label: input.keyboardAttached ? "Detach Magic Keyboard" : "Attach Magic Keyboard",
            attached: input.keyboardAttached,
          },
  };
}

/** Downloaded screenshots are named after the device and capture time. */
export const deviceScreenshotFileName = (deviceName: string, now: number) =>
  `${deviceName.replace(/[^a-z0-9-]/gi, "-")}-${now}.png`;
