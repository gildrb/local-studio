import {
  DEFAULT_BROWSER_PROFILE_ID,
  resolveBrowserProfiles,
  type BrowserProfile,
  type PreviewAppearancePreference,
  type PreviewViewportSetting,
} from "@t3tools/contracts";

import { resolveResponsiveBrowserViewportSize } from "./browserViewportLayout";

export interface BrowserDefaults {
  readonly viewport: PreviewViewportSetting;
  readonly zoomFactor: number;
  readonly appearance: PreviewAppearancePreference;
  readonly autoShowFloatingPreview: boolean;
  readonly profiles: ReadonlyArray<BrowserProfile>;
  readonly profileId: string;
}

export const toBrowserDefaults = (settings: {
  readonly browserDefaultViewport: PreviewViewportSetting;
  readonly browserDefaultZoomFactor: number;
  readonly browserDefaultAppearance: PreviewAppearancePreference;
  readonly browserAutoShowFloatingPreview: boolean;
  readonly browserProfiles: ReadonlyArray<BrowserProfile>;
  readonly browserDefaultProfileId: string;
}): BrowserDefaults => {
  const profiles = resolveBrowserProfiles(settings.browserProfiles);
  return {
    viewport: settings.browserDefaultViewport,
    zoomFactor: settings.browserDefaultZoomFactor,
    appearance: settings.browserDefaultAppearance,
    autoShowFloatingPreview: settings.browserAutoShowFloatingPreview,
    profiles,
    // A default pointing at a deleted profile falls back rather than opening
    // tabs into a partition with no profile behind it.
    // Incognito is a per-tab choice, not a default: a profile that discards
    // everything on close would leave every new tab signed out. Excluding it
    // here keeps the resolved default equal to what the settings list offers,
    // so the row badged "Default" is the one tabs actually open under.
    profileId:
      profiles.find(
        (profile) =>
          profile.id === settings.browserDefaultProfileId && profile.kind !== "incognito",
      )?.id ?? DEFAULT_BROWSER_PROFILE_ID,
  };
};

/**
 * The viewport to switch to when the user turns the device toolbar on for a tab
 * currently in fill mode.
 *
 * A configured non-fill default is what the user said they want to look at, so
 * it wins. When the default is fill there is no stated preference to honour, so
 * fall back to fitting the panel — and only when the panel hasn't been measured
 * yet does a fixed size apply.
 */
export const FALLBACK_RESPONSIVE_VIEWPORT_SIZE = { width: 1024, height: 768 } as const;

export function responsiveViewportForToggle(input: {
  readonly defaults: BrowserDefaults;
  readonly panelRect: { readonly width: number; readonly height: number } | null;
  readonly zoomFactor: number | undefined;
}): PreviewViewportSetting {
  if (input.defaults.viewport._tag !== "fill") return input.defaults.viewport;
  const size = input.panelRect
    ? resolveResponsiveBrowserViewportSize(input.panelRect, input.zoomFactor)
    : FALLBACK_RESPONSIVE_VIEWPORT_SIZE;
  return { _tag: "freeform", ...size };
}
