import {
  BROWSER_PROFILE_MAX_COUNT,
  BROWSER_PROFILE_NAME_MAX_LENGTH,
  BROWSER_RECORDING_FRAME_RATES,
  BrowserImportFailureReason,
  DEFAULT_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
  DEFAULT_BROWSER_LINK_TARGET,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_BROWSER_RECORDING_FRAME_RATE,
  DEFAULT_BROWSER_VIEWPORT,
  DEFAULT_PREVIEW_APPEARANCE,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_VIEWPORT_MAX_AREA,
  PREVIEW_VIEWPORT_MAX_DIMENSION,
  PREVIEW_VIEWPORT_MIN_DIMENSION,
  PREVIEW_ZOOM_LEVELS,
  findBrowserProfile,
  isBuiltInBrowserProfileId,
  resolveBrowserProfiles,
  type BrowserImportSource,
  type BrowserLinkTarget,
  type BrowserProfile,
  type ClientSettings,
  type ClientSettingsPatch,
  type DeviceServiceState,
  type DeviceToolVersions,
  type EnvironmentId,
  type PreviewAppearancePreference,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { PREVIEW_VIEWPORT_PRESETS } from "@t3tools/shared/previewViewport";

import type { previewBridge } from "../preview/previewBridge";
import type { ImportOutcome, WizardTarget, WizardTargetProfile } from "./browserImportWizard.logic";
import {
  buildDeviceHostListModel,
  buildDeviceHostsSettingsModel,
  type DeviceHostListModel,
  type DeviceHostListModelInput,
  type DeviceHostsSettingsModel,
  type DeviceHostsSettingsModelInput,
} from "./deviceHostsSettings.logic";
import { searchableSetting } from "./settingsSearch";

export type BrowserProfileDataBridge = Pick<
  NonNullable<typeof previewBridge>,
  "clearCookies" | "clearCache"
>;

export async function clearBrowserProfileData(
  bridge: BrowserProfileDataBridge | null,
  environmentIds: ReadonlyArray<EnvironmentId>,
  profileId: string,
): Promise<void> {
  if (bridge === null || environmentIds.length === 0) {
    throw new Error("Browser profile data is not available to clear.");
  }
  await Promise.all(
    environmentIds.flatMap((environmentId) => [
      bridge.clearCookies(environmentId, profileId),
      bridge.clearCache(environmentId, profileId),
    ]),
  );
}

export function browserProfileRemovalAvailable(
  bridgeAvailable: boolean,
  environmentsReady: boolean,
  environmentCount: number,
): boolean {
  return bridgeAvailable && environmentsReady && environmentCount > 0;
}

/**
 * IPC flattens the failure to its message, so the reason token travels inside
 * it. Anything unrecognised reads as a plain read failure rather than leaking
 * the raw message into a toast.
 */
export function importFailureReason(cause: unknown): BrowserImportFailureReason {
  const message =
    typeof cause === "object" && cause !== null && "message" in cause
      ? String(cause.message ?? "")
      : "";
  return (
    BrowserImportFailureReason.literals.find((reason) => message.includes(`failed: ${reason}.`)) ??
    "readFailed"
  );
}

export function importFailureMessage(
  sourceId: BrowserImportSource["id"],
  reason: "profileLimitReached" | "profileNotSaved",
): string {
  return `Importing cookies from ${sourceId} failed: ${reason}.`;
}

export type IntegrationsToast = {
  readonly type: "error" | "success";
  readonly title: string;
  readonly description?: string;
};

export type IntegrationsOption = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
};

export type IntegrationsResetModel = { readonly label: string };

export type IntegrationsBrowserSettings = Pick<
  ClientSettings,
  | "browserDefaultViewport"
  | "browserDefaultZoomFactor"
  | "browserDefaultAppearance"
  | "browserRecordingFrameRate"
  | "browserRecordingShowKeyPresses"
  | "browserRecordingShowMousePresses"
  | "browserLinkTarget"
  | "browserAutoShowFloatingPreview"
  | "browserProfiles"
  | "browserDefaultProfileId"
>;

export type IntegrationsSelectRowModel = {
  readonly kind: "select";
  readonly title: string;
  readonly id:
    | "browser-default-zoom"
    | "browser-default-appearance"
    | "browser-recording-frame-rate"
    | "browser-link-target";
  readonly description: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly valueLabel: string;
  readonly options: ReadonlyArray<IntegrationsOption>;
  readonly disabled: boolean;
  readonly reset: IntegrationsResetModel | null;
};

export type IntegrationsSwitchRowModel = {
  readonly kind: "switch";
  readonly title: string;
  readonly id:
    | "browser-recording-key-presses"
    | "browser-recording-mouse-presses"
    | "browser-auto-show-floating-preview";
  readonly description: string;
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly reset: IntegrationsResetModel | null;
};

export type BrowserViewportSizeModel = {
  readonly width: number;
  readonly height: number;
  readonly min: number;
  readonly max: number;
  readonly widthAriaLabel: string;
  readonly heightAriaLabel: string;
  readonly separator: string;
  readonly rotate: { readonly ariaLabel: string; readonly tooltip: string };
};

export type BrowserViewportRowModel = {
  readonly kind: "viewport";
  readonly id: "browser-default-viewport";
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly valueLabel: string;
  readonly options: ReadonlyArray<IntegrationsOption>;
  readonly presetGroup: {
    readonly label: string;
    readonly options: ReadonlyArray<IntegrationsOption>;
  };
  readonly disabled: boolean;
  readonly reset: IntegrationsResetModel | null;
  readonly size: BrowserViewportSizeModel | null;
};

const FILL_VALUE = "fill";
const RESPONSIVE_VALUE = "responsive";

/**
 * The size a "Responsive" default falls back to when the user switches away
 * from Fill and hasn't typed dimensions yet. Fill has no dimensions to carry
 * over, so the picker needs something concrete to seed the inputs with.
 */
const RESPONSIVE_SEED_SIZE = { width: 1280, height: 800 } as const;

const APPEARANCE_LABELS: Readonly<Record<PreviewAppearancePreference, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const LINK_TARGET_LABELS: Readonly<Record<BrowserLinkTarget, string>> = {
  system: "Your default browser",
  app: "Local Studio",
};

const zoomLabel = (zoomFactor: number) => `${Math.round(zoomFactor * 100)}%`;

const viewportSelectValue = (viewport: PreviewViewportSetting): string => {
  if (viewport._tag === "fill") return FILL_VALUE;
  if (
    viewport._tag === "preset" &&
    PREVIEW_VIEWPORT_PRESETS.some((preset) => preset.id === viewport.presetId)
  ) {
    return viewport.presetId;
  }
  return RESPONSIVE_VALUE;
};

const presentedViewportSize = (viewport: PreviewViewportSetting) => ({
  width: viewport._tag === "fill" ? RESPONSIVE_SEED_SIZE.width : viewport.width,
  height: viewport._tag === "fill" ? RESPONSIVE_SEED_SIZE.height : viewport.height,
});

export function buildBrowserViewportRowModel(input: {
  readonly viewport: PreviewViewportSetting;
  readonly disabled: boolean;
}): BrowserViewportRowModel {
  const { viewport, disabled } = input;
  const value = viewportSelectValue(viewport);
  const size = presentedViewportSize(viewport);
  return {
    kind: "viewport",
    id: "browser-default-viewport",
    title: searchableSetting("browser-default-viewport").title,
    description:
      "Tab size for you and agents. Fill fits the panel; other sizes show the device toolbar.",
    ariaLabel: "Default browser viewport",
    value,
    valueLabel:
      value === FILL_VALUE
        ? "Fill panel"
        : value === RESPONSIVE_VALUE
          ? "Responsive"
          : (PREVIEW_VIEWPORT_PRESETS.find((preset) => preset.id === value)?.label ?? "Responsive"),
    options: [
      { value: FILL_VALUE, label: "Fill panel" },
      { value: RESPONSIVE_VALUE, label: "Responsive" },
    ],
    presetGroup: {
      label: "Standard",
      options: PREVIEW_VIEWPORT_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.label,
        description: preset.detail,
      })),
    },
    disabled,
    reset:
      !disabled && viewport._tag !== DEFAULT_BROWSER_VIEWPORT._tag
        ? { label: "default browser viewport" }
        : null,
    size:
      viewport._tag === "fill"
        ? null
        : {
            width: size.width,
            height: size.height,
            min: PREVIEW_VIEWPORT_MIN_DIMENSION,
            max: PREVIEW_VIEWPORT_MAX_DIMENSION,
            widthAriaLabel: "Default viewport width",
            heightAriaLabel: "Default viewport height",
            separator: "×",
            rotate: {
              ariaLabel: `Rotate to ${size.height >= size.width ? "landscape" : "portrait"}`,
              tooltip: "Rotate",
            },
          },
  };
}

function selectRowReset(
  disabled: boolean,
  changed: boolean,
  label: string,
): IntegrationsResetModel | null {
  return !disabled && changed ? { label } : null;
}

export function buildBrowserZoomRowModel(input: {
  readonly zoomFactor: number;
  readonly disabled: boolean;
}): IntegrationsSelectRowModel {
  return {
    kind: "select",
    id: "browser-default-zoom",
    title: searchableSetting("browser-default-zoom").title,
    description: "Page zoom applied to new browser tabs.",
    ariaLabel: "Default browser zoom",
    value: String(input.zoomFactor),
    valueLabel: zoomLabel(input.zoomFactor),
    options: PREVIEW_ZOOM_LEVELS.map((level) => ({
      value: String(level),
      label: zoomLabel(level),
    })),
    disabled: input.disabled,
    reset: selectRowReset(
      input.disabled,
      input.zoomFactor !== DEFAULT_PREVIEW_ZOOM_FACTOR,
      "default browser zoom",
    ),
  };
}

export function buildBrowserAppearanceRowModel(input: {
  readonly appearance: PreviewAppearancePreference;
  readonly disabled: boolean;
}): IntegrationsSelectRowModel {
  return {
    kind: "select",
    id: "browser-default-appearance",
    title: searchableSetting("browser-default-appearance").title,
    description: "The color scheme pages are told to prefer. System follows your OS setting.",
    ariaLabel: "Default browser appearance",
    value: input.appearance,
    valueLabel: APPEARANCE_LABELS[input.appearance],
    options: Object.entries(APPEARANCE_LABELS).map(([value, label]) => ({ value, label })),
    disabled: input.disabled,
    reset: selectRowReset(
      input.disabled,
      input.appearance !== DEFAULT_PREVIEW_APPEARANCE,
      "default browser appearance",
    ),
  };
}

export function buildBrowserRecordingFrameRateRowModel(input: {
  readonly frameRate: ClientSettings["browserRecordingFrameRate"];
  readonly disabled: boolean;
}): IntegrationsSelectRowModel {
  return {
    kind: "select",
    id: "browser-recording-frame-rate",
    title: searchableSetting("browser-recording-frame-rate").title,
    description: "Maximum recording rate. 30 fps saves CPU and storage; 60 fps is smoother.",
    ariaLabel: "Browser recording frame rate",
    value: String(input.frameRate),
    valueLabel: `${input.frameRate} fps`,
    options: BROWSER_RECORDING_FRAME_RATES.map((rate) => ({
      value: String(rate),
      label: `${rate} fps`,
    })),
    disabled: input.disabled,
    reset: selectRowReset(
      input.disabled,
      input.frameRate !== DEFAULT_BROWSER_RECORDING_FRAME_RATE,
      "browser recording frame rate",
    ),
  };
}

export function buildBrowserRecordingInputRowModels(input: {
  readonly showKeyPresses: boolean;
  readonly showMousePresses: boolean;
  readonly disabled: boolean;
}): readonly [IntegrationsSwitchRowModel, IntegrationsSwitchRowModel] {
  return [
    {
      kind: "switch",
      id: "browser-recording-key-presses",
      title: searchableSetting("browser-recording-key-presses").title,
      description:
        "Show pressed keys and shortcuts in new recordings. Password fields are excluded.",
      ariaLabel: "Show key presses in recordings",
      checked: input.showKeyPresses,
      disabled: input.disabled,
      reset: null,
    },
    {
      kind: "switch",
      id: "browser-recording-mouse-presses",
      title: searchableSetting("browser-recording-mouse-presses").title,
      description: "Highlight mouse presses and held buttons in new recordings.",
      ariaLabel: "Show mouse presses in recordings",
      checked: input.showMousePresses,
      disabled: input.disabled,
      reset: null,
    },
  ];
}

export function buildBrowserLinkTargetRowModel(input: {
  readonly linkTarget: BrowserLinkTarget;
  readonly disabled: boolean;
}): IntegrationsSelectRowModel {
  return {
    kind: "select",
    id: "browser-link-target",
    title: searchableSetting("browser-link-target").title,
    description:
      "Where links in the chat and terminal open. Hold ⌘ or Ctrl while clicking a link to open it in your default browser either way.",
    ariaLabel: "Open links in",
    value: input.linkTarget,
    valueLabel: LINK_TARGET_LABELS[input.linkTarget],
    options: Object.entries(LINK_TARGET_LABELS).map(([value, label]) => ({ value, label })),
    disabled: input.disabled,
    reset: selectRowReset(
      input.disabled,
      input.linkTarget !== DEFAULT_BROWSER_LINK_TARGET,
      "link target",
    ),
  };
}

export function buildBrowserAutoShowFloatingPreviewRowModel(input: {
  readonly autoShow: boolean;
  readonly disabled: boolean;
}): IntegrationsSwitchRowModel {
  return {
    kind: "switch",
    id: "browser-auto-show-floating-preview",
    title: searchableSetting("browser-auto-show-floating-preview").title,
    description:
      "Show the floating preview when an agent opens a browser or device unless the agent says otherwise.",
    ariaLabel: "Auto-show floating preview",
    checked: input.autoShow,
    disabled: input.disabled,
    reset: selectRowReset(
      input.disabled,
      input.autoShow !== DEFAULT_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
      "auto-show floating preview",
    ),
  };
}

export type IntegrationsResettableSetting =
  | "browserDefaultViewport"
  | "browserDefaultZoomFactor"
  | "browserDefaultAppearance"
  | "browserRecordingFrameRate"
  | "browserLinkTarget"
  | "browserAutoShowFloatingPreview";

export type IntegrationsSettingsChange =
  | {
      readonly kind: "viewportSelect";
      readonly current: PreviewViewportSetting;
      readonly value: string | null;
    }
  | {
      readonly kind: "viewportDimension";
      readonly current: PreviewViewportSetting;
      readonly axis: "width" | "height";
      readonly value: number | null;
    }
  | { readonly kind: "viewportRotate"; readonly current: PreviewViewportSetting }
  | { readonly kind: "zoomSelect"; readonly value: string | null }
  | { readonly kind: "appearanceSelect"; readonly value: string | null }
  | { readonly kind: "frameRateSelect"; readonly value: string | null }
  | { readonly kind: "linkTargetSelect"; readonly value: string | null }
  | { readonly kind: "recordingKeyPressesToggle"; readonly checked: boolean }
  | { readonly kind: "recordingMousePressesToggle"; readonly checked: boolean }
  | { readonly kind: "autoShowFloatingPreviewToggle"; readonly checked: boolean }
  | { readonly kind: "reset"; readonly setting: IntegrationsResettableSetting };

function resolveViewportSelect(
  current: PreviewViewportSetting,
  value: string | null,
): ClientSettingsPatch | null {
  if (value === FILL_VALUE) return { browserDefaultViewport: FILL_PREVIEW_VIEWPORT };
  if (value === RESPONSIVE_VALUE) {
    return { browserDefaultViewport: { _tag: "freeform", ...presentedViewportSize(current) } };
  }
  const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value);
  if (!preset) return null;
  return {
    browserDefaultViewport: {
      _tag: "preset",
      width: preset.width,
      height: preset.height,
      presetId: preset.id,
    },
  };
}

function resolveViewportDimension(
  current: PreviewViewportSetting,
  axis: "width" | "height",
  value: number | null,
): ClientSettingsPatch | null {
  if (
    value === null ||
    !Number.isInteger(value) ||
    value < PREVIEW_VIEWPORT_MIN_DIMENSION ||
    value > PREVIEW_VIEWPORT_MAX_DIMENSION
  ) {
    return null;
  }
  const next = { ...presentedViewportSize(current), [axis]: value };
  if (next.width * next.height > PREVIEW_VIEWPORT_MAX_AREA) return null;
  if (current._tag !== "fill" && next.width === current.width && next.height === current.height) {
    return null;
  }
  return { browserDefaultViewport: { _tag: "freeform", ...next } };
}

const RESET_PATCHES: Readonly<Record<IntegrationsResettableSetting, ClientSettingsPatch>> = {
  browserDefaultViewport: { browserDefaultViewport: DEFAULT_BROWSER_VIEWPORT },
  browserDefaultZoomFactor: { browserDefaultZoomFactor: DEFAULT_PREVIEW_ZOOM_FACTOR },
  browserDefaultAppearance: { browserDefaultAppearance: DEFAULT_PREVIEW_APPEARANCE },
  browserRecordingFrameRate: { browserRecordingFrameRate: DEFAULT_BROWSER_RECORDING_FRAME_RATE },
  browserLinkTarget: { browserLinkTarget: DEFAULT_BROWSER_LINK_TARGET },
  browserAutoShowFloatingPreview: {
    browserAutoShowFloatingPreview: DEFAULT_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
  },
};

export function resolveIntegrationsSettingsChange(
  change: IntegrationsSettingsChange,
): ClientSettingsPatch | null {
  switch (change.kind) {
    case "viewportSelect":
      return resolveViewportSelect(change.current, change.value);
    case "viewportDimension":
      return resolveViewportDimension(change.current, change.axis, change.value);
    case "viewportRotate":
      // Presets keep their identity through a rotation, so a rotated iPad is
      // still an iPad, not an anonymous custom size.
      return change.current._tag === "fill"
        ? null
        : {
            browserDefaultViewport: {
              ...change.current,
              width: change.current.height,
              height: change.current.width,
            },
          };
    case "zoomSelect": {
      const next = PREVIEW_ZOOM_LEVELS.find((level) => String(level) === change.value);
      return next === undefined ? null : { browserDefaultZoomFactor: next };
    }
    case "appearanceSelect":
      return change.value === "system" || change.value === "light" || change.value === "dark"
        ? { browserDefaultAppearance: change.value }
        : null;
    case "frameRateSelect": {
      const next = BROWSER_RECORDING_FRAME_RATES.find((rate) => String(rate) === change.value);
      return next === undefined ? null : { browserRecordingFrameRate: next };
    }
    case "linkTargetSelect":
      return change.value === "system" || change.value === "app"
        ? { browserLinkTarget: change.value }
        : null;
    case "recordingKeyPressesToggle":
      return { browserRecordingShowKeyPresses: change.checked };
    case "recordingMousePressesToggle":
      return { browserRecordingShowMousePresses: change.checked };
    case "autoShowFloatingPreviewToggle":
      return { browserAutoShowFloatingPreview: change.checked };
    case "reset":
      return RESET_PATCHES[change.setting];
  }
}

export type BrowserProfilesModelInput = {
  readonly userProfiles: ReadonlyArray<BrowserProfile>;
  readonly defaultProfileId: string;
  readonly settingsHydrated: boolean;
  readonly disabled: boolean;
  readonly bridgeAvailable: boolean;
  readonly environmentsReady: boolean;
  readonly environmentCount: number;
  readonly primaryEnvironmentAvailable: boolean;
  readonly importInFlight: boolean;
  readonly sources: ReadonlyArray<BrowserImportSource> | null;
  readonly pendingRemoval: { readonly id: string; readonly name: string } | null;
  readonly removalError: string | null;
  readonly removalInFlight: boolean;
};

export type BrowserProfileMenuItemModel = {
  readonly action: "setDefault" | "clearData" | "remove";
  readonly label: string;
  readonly disabled: boolean;
  readonly destructive: boolean;
};

export type BrowserProfileRowModel = {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly isDefault: boolean;
  readonly dimmed: boolean;
  readonly rename: {
    readonly ariaLabel: string;
    readonly disabled: boolean;
    readonly maxLength: number;
  } | null;
  readonly defaultBadge: string | null;
  readonly menu: {
    readonly ariaLabel: string;
    readonly disabled: boolean;
    readonly items: ReadonlyArray<BrowserProfileMenuItemModel>;
    readonly notice: string | null;
  };
};

export type BrowserImportSourceItemModel = {
  readonly id: BrowserImportSource["id"];
  readonly label: string;
  readonly disabled: boolean;
};

export type BrowserProfileRemovalDialogModel = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly error: string | null;
  readonly unavailableNotice: string | null;
  readonly cancel: { readonly label: string; readonly disabled: boolean };
  readonly confirm: { readonly label: string; readonly disabled: boolean };
};

export type BrowserProfilesModel = {
  readonly kind: "profiles";
  readonly id: "browser-profiles";
  readonly title: string;
  readonly description: string;
  readonly removalAvailable: boolean;
  readonly atProfileLimit: boolean;
  readonly canCreateProfile: boolean;
  readonly addMenu: {
    readonly label: string;
    readonly icon: "plus";
    readonly disabled: boolean;
    readonly blankProfile: { readonly label: string; readonly disabled: boolean };
    readonly limitNotice: string | null;
    readonly importGroupLabel: string;
    readonly importPlaceholder: string | null;
    readonly importSources: ReadonlyArray<BrowserImportSourceItemModel>;
    readonly importNotice: string | null;
  };
  readonly profiles: ReadonlyArray<BrowserProfileRowModel>;
  readonly wizardTargetProfiles: ReadonlyArray<WizardTargetProfile>;
  readonly removalDialog: BrowserProfileRemovalDialogModel;
};

/**
 * A browser that is not on this machine is left out rather than listed as a
 * dead row, and so is an unsupported one; every other unavailable reason names
 * a step the user can take.
 */
export function importableBrowserSources(
  sources: ReadonlyArray<BrowserImportSource> | null,
): ReadonlyArray<BrowserImportSource> {
  return (sources ?? []).filter(
    (source) =>
      source.unavailable !== "notInstalled" && source.unavailable !== "unsupportedPlatform",
  );
}

export function buildBrowserProfilesModel(input: BrowserProfilesModelInput): BrowserProfilesModel {
  const { settingsHydrated, importInFlight } = input;
  const removalAvailable = browserProfileRemovalAvailable(
    input.bridgeAvailable,
    input.environmentsReady,
    input.environmentCount,
  );
  const profileWritesDisabled = input.disabled || !settingsHydrated;
  // Incognito is deliberately not a row, so the default resolves against the
  // list that renders.
  const listedProfiles = resolveBrowserProfiles(input.userProfiles).filter(
    (profile) => profile.kind !== "incognito",
  );
  const resolvedDefaultId =
    findBrowserProfile(listedProfiles, input.defaultProfileId)?.id ?? DEFAULT_BROWSER_PROFILE_ID;
  const atProfileLimit = input.userProfiles.length >= BROWSER_PROFILE_MAX_COUNT;
  const importableSources = importableBrowserSources(input.sources);
  const pendingRemoval = input.pendingRemoval;
  return {
    kind: "profiles",
    id: "browser-profiles",
    title: searchableSetting("browser-profiles").title,
    description:
      "Profiles separate cookies and logins. Incognito data is cleared when the app closes.",
    removalAvailable,
    atProfileLimit,
    canCreateProfile: settingsHydrated && !atProfileLimit,
    addMenu: {
      label: "Add profile",
      icon: "plus",
      disabled: profileWritesDisabled || importInFlight,
      blankProfile: { label: "Blank profile", disabled: !settingsHydrated || atProfileLimit },
      limitNotice: atProfileLimit ? "You’ve reached the profile limit" : null,
      importGroupLabel: "Import from",
      importPlaceholder:
        input.sources === null
          ? "Looking for browsers…"
          : importableSources.length === 0
            ? "No supported browsers found"
            : null,
      importSources:
        input.sources === null
          ? []
          : importableSources.map((source) => ({
              id: source.id,
              label: source.name,
              disabled: !settingsHydrated || !input.primaryEnvironmentAvailable,
            })),
      importNotice:
        input.sources !== null && importableSources.length > 0 && !input.primaryEnvironmentAvailable
          ? "Connect to an environment to import cookies"
          : null,
    },
    profiles: listedProfiles.map((profile) => {
      const builtIn = isBuiltInBrowserProfileId(profile.id);
      const isDefault = profile.id === resolvedDefaultId;
      const items: Array<BrowserProfileMenuItemModel> = [
        {
          action: "setDefault",
          label: "Set as default",
          disabled: !settingsHydrated || isDefault,
          destructive: false,
        },
        {
          action: "clearData",
          label: "Clear cookies and cache",
          disabled: !settingsHydrated || !removalAvailable,
          destructive: false,
        },
      ];
      if (!builtIn) {
        items.push({
          action: "remove",
          label: "Remove profile and data",
          disabled: !settingsHydrated || !removalAvailable,
          destructive: true,
        });
      }
      return {
        id: profile.id,
        name: profile.name,
        builtIn,
        isDefault,
        dimmed: profileWritesDisabled,
        rename: builtIn
          ? null
          : {
              ariaLabel: `Rename ${profile.name}`,
              disabled: profileWritesDisabled || importInFlight,
              maxLength: BROWSER_PROFILE_NAME_MAX_LENGTH,
            },
        defaultBadge: isDefault ? "Default" : null,
        menu: {
          ariaLabel: `${profile.name} options`,
          disabled: profileWritesDisabled || importInFlight,
          items,
          notice: removalAvailable
            ? null
            : input.environmentsReady
              ? "Connect to an environment to clear profile data"
              : "Checking environments…",
        },
      };
    }),
    wizardTargetProfiles: listedProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    })),
    removalDialog: {
      open: pendingRemoval !== null,
      title: `Remove “${pendingRemoval?.name ?? ""}”?`,
      description:
        "Its cookies and logins are deleted. Tabs already open in this profile stay open until you close them.",
      error: input.removalError,
      unavailableNotice: removalAvailable
        ? null
        : "Connect to an environment to remove this profile and its data.",
      cancel: { label: "Cancel", disabled: input.removalInFlight },
      confirm: {
        label: input.removalInFlight ? "Removing…" : "Remove profile",
        disabled: input.removalInFlight || !settingsHydrated || !removalAvailable,
      },
    },
  };
}

export type BrowserProfileWriteGate = {
  readonly settingsHydrated: boolean;
  readonly importInFlight: boolean;
};

function uniqueBrowserProfileName(
  baseName: string,
  currentProfiles: ReadonlyArray<BrowserProfile>,
): string {
  const taken = new Set(resolveBrowserProfiles(currentProfiles).map((profile) => profile.name));
  let name = baseName;
  for (let index = 2; taken.has(name); index += 1) name = `${baseName} ${index}`;
  return name;
}

export type BrowserProfileCreation = {
  readonly profile: BrowserProfile;
  readonly patch: ClientSettingsPatch;
};

/** Checked against the live settings so two quick clicks cannot both pass the cap. */
export function resolveCreateBrowserProfile(
  input: BrowserProfileWriteGate & {
    readonly currentProfiles: ReadonlyArray<BrowserProfile>;
    readonly baseName: string;
    readonly profileId: string;
  },
): BrowserProfileCreation | null {
  if (!input.settingsHydrated || input.importInFlight) return null;
  if (input.currentProfiles.length >= BROWSER_PROFILE_MAX_COUNT) return null;
  const profile: BrowserProfile = {
    id: input.profileId,
    name: uniqueBrowserProfileName(input.baseName, input.currentProfiles),
    kind: "persistent",
  };
  return { profile, patch: { browserProfiles: [...input.currentProfiles, profile] } };
}

export function resolveRenameBrowserProfile(
  input: BrowserProfileWriteGate & {
    readonly currentProfiles: ReadonlyArray<BrowserProfile>;
    readonly profileId: string;
    readonly next: string;
  },
): ClientSettingsPatch | null {
  if (!input.settingsHydrated || input.importInFlight) return null;
  const name = input.next.trim().slice(0, BROWSER_PROFILE_NAME_MAX_LENGTH);
  if (name === "") return null;
  return {
    browserProfiles: input.currentProfiles.map((profile) =>
      profile.id === input.profileId ? { ...profile, name } : profile,
    ),
  };
}

export function resolveSetDefaultBrowserProfile(input: {
  readonly settingsHydrated: boolean;
  readonly profileId: string;
}): ClientSettingsPatch | null {
  return input.settingsHydrated ? { browserDefaultProfileId: input.profileId } : null;
}

export type BrowserProfileClearDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "unavailable"; readonly toast: IntegrationsToast }
  | {
      readonly kind: "clear";
      readonly successToast: IntegrationsToast;
      readonly failureToast: IntegrationsToast;
    };

export function resolveClearBrowserProfileData(
  input: BrowserProfileWriteGate & {
    readonly bridgeAvailable: boolean;
    readonly environmentsReady: boolean;
    readonly environmentCount: number;
    readonly name: string;
  },
): BrowserProfileClearDecision {
  if (!input.settingsHydrated || input.importInFlight) return { kind: "ignore" };
  const failureTitle = `Could not clear ${input.name}'s data`;
  if (!input.bridgeAvailable || !input.environmentsReady || input.environmentCount === 0) {
    return {
      kind: "unavailable",
      toast: {
        type: "error",
        title: failureTitle,
        description: "You're not connected to a server yet.",
      },
    };
  }
  return {
    kind: "clear",
    successToast: { type: "success", title: `Cleared ${input.name}'s cookies and cache` },
    failureToast: { type: "error", title: failureTitle },
  };
}

export const BROWSER_PROFILE_REMOVAL_FAILED_MESSAGE =
  "Profile data could not be deleted. Try again.";

export type BrowserProfileRemoveDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "unavailable"; readonly error: string }
  | { readonly kind: "remove" };

export function resolveRemoveBrowserProfile(
  input: BrowserProfileWriteGate & { readonly removalAvailable: boolean },
): BrowserProfileRemoveDecision {
  if (!input.settingsHydrated || input.importInFlight) return { kind: "ignore" };
  if (!input.removalAvailable) {
    return {
      kind: "unavailable",
      error: "Connect to an environment before removing this profile.",
    };
  }
  return { kind: "remove" };
}

/** Drops the profile and reassigns the default rather than leaving it pointing at nothing. */
export function browserProfileRemovalPatch(
  current: Pick<ClientSettings, "browserProfiles" | "browserDefaultProfileId">,
  profileId: string,
): ClientSettingsPatch {
  return {
    browserProfiles: current.browserProfiles.filter((profile) => profile.id !== profileId),
    ...(current.browserDefaultProfileId === profileId
      ? { browserDefaultProfileId: DEFAULT_BROWSER_PROFILE_ID }
      : {}),
  };
}

export function wizardImportTargetMissing(
  target: WizardTarget,
  currentProfiles: ReadonlyArray<BrowserProfile>,
): boolean {
  return (
    target.kind === "existing" &&
    !resolveBrowserProfiles(currentProfiles).some((profile) => profile.id === target.profileId)
  );
}

export function resolveWizardImportBlock(input: {
  readonly bridgeAvailable: boolean;
  readonly settingsHydrated: boolean;
  readonly importInFlight: boolean;
  readonly target: WizardTarget;
  readonly currentProfiles: ReadonlyArray<BrowserProfile>;
}): ImportOutcome | null {
  if (!input.bridgeAvailable || !input.settingsHydrated) {
    return { kind: "blocked", reason: "sessionUnavailable" };
  }
  if (wizardImportTargetMissing(input.target, input.currentProfiles) || input.importInFlight) {
    return { kind: "blocked", reason: "readFailed" };
  }
  return null;
}

export type ImportedProfileRegistration =
  | { readonly kind: "existing" }
  | { readonly kind: "limitReached" }
  | { readonly kind: "register"; readonly browserProfiles: ReadonlyArray<BrowserProfile> };

/**
 * The cap can be reached while an import runs; this sees the newest settings,
 * so it is the check that holds.
 */
export function resolveImportedProfileRegistration(
  currentProfiles: ReadonlyArray<BrowserProfile>,
  profileId: string,
  sourceName: string,
): ImportedProfileRegistration {
  if (currentProfiles.some((profile) => profile.id === profileId)) return { kind: "existing" };
  if (currentProfiles.length >= BROWSER_PROFILE_MAX_COUNT) return { kind: "limitReached" };
  return {
    kind: "register",
    browserProfiles: [
      ...currentProfiles,
      {
        id: profileId,
        name: uniqueBrowserProfileName(sourceName, currentProfiles),
        kind: "persistent",
      },
    ],
  };
}

export type DeviceIntegrationPending = "hub" | "check" | "agent" | "update-hub" | "update-agent";

export type DeviceTool = "hub" | "agent";

export type DeviceToolUpdateError = { readonly tool: DeviceTool; readonly message: string };

export type DeviceIntegrationEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
};

export type DeviceIntegrationModelInput = {
  readonly environmentId: EnvironmentId | null;
  readonly enabled: boolean;
  readonly agentAccessEnabled: boolean;
  readonly loaded: boolean;
  readonly state: Pick<
    DeviceServiceState,
    "hostStatus" | "hosts" | "supportsToolUpdate" | "supportsToolInspection"
  >;
  readonly projectScope: boolean;
  readonly connectedEnvironments: ReadonlyArray<DeviceIntegrationEnvironment>;
  readonly anyHubEnabled: boolean;
  readonly pending: DeviceIntegrationPending | null;
  readonly updateError: DeviceToolUpdateError | null;
  readonly platformsRevealed: boolean;
};

export type DeviceToolActionsModel = {
  readonly update: { readonly label: string; readonly disabled: boolean } | null;
  readonly check: { readonly label: string; readonly disabled: boolean } | null;
  readonly error: string | null;
};

export type DeviceIntegrationSwitchModel = {
  readonly id: "device-hub" | "agent-device-access";
  readonly title: string;
  readonly settingKeys: ReadonlyArray<"enableDeviceSupport" | "enableAgentDeviceAccess">;
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly showSetupStatus: boolean;
  readonly toolActions: DeviceToolActionsModel;
};

export type DeviceIntegrationModel = {
  readonly localTools: DeviceToolVersions | null;
  readonly hub: DeviceIntegrationSwitchModel;
  readonly platforms: {
    readonly visible: boolean;
    readonly id: "device-platform-support";
    readonly title: string;
    readonly description: string | null;
    readonly refresh: { readonly label: string; readonly disabled: boolean };
  };
  readonly agent: DeviceIntegrationSwitchModel;
  readonly showHostUpdates: boolean;
};

export const DEVICE_TOOL_UPDATE_FAILED_MESSAGE =
  "Update failed. Check this host's network connection and try again.";

export function buildDeviceIntegrationModel(
  input: DeviceIntegrationModelInput,
): DeviceIntegrationModel {
  const { state, pending, environmentId } = input;
  const busy = state.hostStatus === "installing" || state.hostStatus === "starting";
  const localTools = state.hosts.find((host) => host.kind === "local")?.tools;
  const actionDisabled = !environmentId || pending !== null || busy;
  const toolActions = (tool: DeviceTool): DeviceToolActionsModel => {
    const version = localTools?.[tool];
    const needsUpdate =
      version !== undefined && !version.installedVersions.includes(version.requiredVersion);
    return {
      update:
        state.supportsToolUpdate && needsUpdate
          ? {
              label:
                pending === `update-${tool}`
                  ? "Updating…"
                  : `Update to v${version.requiredVersion}`,
              disabled: actionDisabled,
            }
          : null,
      check: state.supportsToolInspection
        ? {
            label: pending === "check" ? "Checking…" : "Check versions",
            disabled: actionDisabled,
          }
        : null,
      error: input.updateError?.tool === tool ? input.updateError.message : null,
    };
  };
  return {
    localTools: localTools ?? null,
    hub: {
      id: "device-hub",
      title: searchableSetting("device-hub").title,
      settingKeys: ["enableDeviceSupport"],
      ariaLabel: "Device hub",
      checked: input.enabled,
      disabled: input.projectScope || !input.loaded || !environmentId || busy || pending !== null,
      showSetupStatus: pending === "hub",
      toolActions: toolActions("hub"),
    },
    platforms: {
      visible: input.platformsRevealed,
      id: "device-platform-support",
      title: searchableSetting("device-platform-support").title,
      description:
        input.connectedEnvironments.length > 1
          ? `Status for ${input.connectedEnvironments.find((environment) => environment.environmentId === environmentId)?.label}. Select an environment to inspect its simulator support.`
          : null,
      refresh: {
        label: pending === "check" ? "Checking…" : "Refresh",
        disabled: !environmentId || !input.enabled || busy || pending !== null,
      },
    },
    agent: {
      id: "agent-device-access",
      title: searchableSetting("agent-device-access").title,
      settingKeys: ["enableAgentDeviceAccess"],
      ariaLabel: "Agent device access",
      checked: input.agentAccessEnabled,
      disabled:
        input.connectedEnvironments.length === 0 ||
        (!input.projectScope && (!input.loaded || !input.anyHubEnabled || busy)) ||
        pending !== null,
      showSetupStatus: pending === "agent",
      toolActions: toolActions("agent"),
    },
    showHostUpdates: environmentId !== null,
  };
}

/** Diagnostics stay visible through later agent setup and refresh phases. */
export function resolveDevicePlatformsRevealed(input: {
  readonly platformsRevealed: boolean;
  readonly enabled: boolean;
  readonly hostStatus: DeviceServiceState["hostStatus"];
  readonly pending: DeviceIntegrationPending | null;
}): boolean {
  if (input.platformsRevealed && !input.enabled) return false;
  if (
    input.enabled &&
    !input.platformsRevealed &&
    input.hostStatus === "ready" &&
    input.pending !== "hub"
  ) {
    return true;
  }
  return input.platformsRevealed;
}

export type DeviceConfigureInput = {
  readonly enabled?: boolean;
  readonly agentAccessEnabled?: boolean;
};

export type DeviceIntegrationToggleDecision =
  | {
      readonly kind: "configure";
      readonly pending: "hub" | "agent";
      readonly input: DeviceConfigureInput;
    }
  | { readonly kind: "scopedPatch"; readonly patch: { readonly enableAgentDeviceAccess: boolean } };

export function resolveDeviceIntegrationToggle(input: {
  readonly target: DeviceTool;
  readonly checked: boolean;
  readonly projectScope: boolean;
}): DeviceIntegrationToggleDecision {
  if (input.target === "hub") {
    return {
      kind: "configure",
      pending: "hub",
      input: { enabled: input.checked, ...(input.checked ? {} : { agentAccessEnabled: false }) },
    };
  }
  return input.projectScope
    ? { kind: "scopedPatch", patch: { enableAgentDeviceAccess: input.checked } }
    : { kind: "configure", pending: "agent", input: { agentAccessEnabled: input.checked } };
}

export function deviceConfigureRequest(
  input: DeviceConfigureInput,
): DeviceConfigureInput & { readonly onboardingCompleted?: true } {
  return { ...input, ...(input.enabled ? { onboardingCompleted: true as const } : {}) };
}

export function deviceSettingsFailureToast(failedLabels: ReadonlyArray<string>): IntegrationsToast {
  return {
    type: "error",
    title: "Device settings not saved on all environments",
    description: `Could not update ${failedLabels.join(", ")}.`,
  };
}

export type DeviceListAction =
  | { readonly kind: "update"; readonly tool: DeviceTool }
  | { readonly kind: "inspect" }
  | { readonly kind: "refresh" };

export type DeviceListRequest = {
  readonly pending: DeviceIntegrationPending;
  readonly input: { readonly updateTool?: DeviceTool; readonly inspectOnly?: boolean };
};

export function resolveDeviceListRequest(action: DeviceListAction): DeviceListRequest {
  if (action.kind === "update") {
    return {
      pending: action.tool === "hub" ? "update-hub" : "update-agent",
      input: { updateTool: action.tool },
    };
  }
  if (action.kind === "inspect") return { pending: "check", input: { inspectOnly: true } };
  return { pending: "check", input: {} };
}

export type IntegrationsPageModel = {
  readonly projectDefaultsCategory: "integrations";
  readonly previewDefaultsDisabled: boolean;
  readonly browser: {
    readonly id: "browser";
    readonly title: string;
    readonly unavailableMessage: string | null;
  };
  readonly devices: {
    readonly id: "devices";
    readonly title: string;
  };
};

/** Client-local preview defaults are editable only where the preview exists. */
export function buildIntegrationsPageModel(input: {
  readonly isElectron: boolean;
}): IntegrationsPageModel {
  return {
    projectDefaultsCategory: "integrations",
    previewDefaultsDisabled: !input.isElectron,
    browser: {
      id: "browser",
      title: "Browser",
      unavailableMessage: input.isElectron ? null : "Only available in the desktop app.",
    },
    devices: { id: "devices", title: "Devices" },
  };
}

export type IntegrationsBrowserRowModel =
  | BrowserProfilesModel
  | BrowserViewportRowModel
  | IntegrationsSelectRowModel
  | IntegrationsSwitchRowModel;

export type IntegrationsSettingsModelInput = {
  readonly isElectron: boolean;
  readonly settings: IntegrationsBrowserSettings;
  readonly profiles: Omit<
    BrowserProfilesModelInput,
    "userProfiles" | "defaultProfileId" | "disabled"
  >;
  readonly deviceControls: DeviceIntegrationModelInput;
  readonly deviceHosts: DeviceHostsSettingsModelInput;
  readonly deviceHostLists: ReadonlyArray<DeviceHostListModelInput>;
};

export type IntegrationsSettingsModel = IntegrationsPageModel & {
  readonly browserRows: ReadonlyArray<IntegrationsBrowserRowModel>;
  readonly deviceControls: DeviceIntegrationModel;
  readonly deviceHosts: DeviceHostsSettingsModel;
  readonly deviceHostLists: ReadonlyArray<DeviceHostListModel>;
};

export function buildIntegrationsSettingsModel(
  input: IntegrationsSettingsModelInput,
): IntegrationsSettingsModel {
  const page = buildIntegrationsPageModel({ isElectron: input.isElectron });
  const disabled = page.previewDefaultsDisabled;
  const { settings } = input;
  return {
    ...page,
    browserRows: [
      buildBrowserProfilesModel({
        ...input.profiles,
        userProfiles: settings.browserProfiles,
        defaultProfileId: settings.browserDefaultProfileId,
        disabled,
      }),
      buildBrowserViewportRowModel({ viewport: settings.browserDefaultViewport, disabled }),
      buildBrowserZoomRowModel({ zoomFactor: settings.browserDefaultZoomFactor, disabled }),
      buildBrowserAppearanceRowModel({ appearance: settings.browserDefaultAppearance, disabled }),
      buildBrowserRecordingFrameRateRowModel({
        frameRate: settings.browserRecordingFrameRate,
        disabled,
      }),
      ...buildBrowserRecordingInputRowModels({
        showKeyPresses: settings.browserRecordingShowKeyPresses,
        showMousePresses: settings.browserRecordingShowMousePresses,
        disabled,
      }),
      buildBrowserLinkTargetRowModel({ linkTarget: settings.browserLinkTarget, disabled }),
      buildBrowserAutoShowFloatingPreviewRowModel({
        autoShow: settings.browserAutoShowFloatingPreview,
        disabled,
      }),
    ],
    deviceControls: buildDeviceIntegrationModel(input.deviceControls),
    deviceHosts: buildDeviceHostsSettingsModel(input.deviceHosts),
    deviceHostLists: input.deviceHostLists.map(buildDeviceHostListModel),
  };
}
