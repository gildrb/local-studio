import type { UnifiedSettings } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import * as Equal from "effect/Equal";

import type { ThemeHalves, ThemePreference, ThemePreferenceMode } from "../../themePalette";
import type { ScopedSettingsPatch } from "./scopedSettings";
import {
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
} from "./SettingsPanels.logic";

export type SettingsRestoreModelInput = {
  readonly theme: ThemePreference;
  readonly followSystem: boolean;
  readonly themeHalves: ThemeHalves | null;
  readonly settings: UnifiedSettings;
};

export type SettingsRestoreConfirmDialog = {
  readonly message: string;
  readonly variant: "destructive";
};

export type SettingsRestoreModel = {
  readonly actionLabel: string;
  readonly changedSettingLabels: string[];
  readonly canRestore: boolean;
  readonly confirmDialog: SettingsRestoreConfirmDialog | null;
};

export type SettingsRestorePatchInput = {
  readonly liveTheme: ThemePreference;
  readonly liveThemeHalves: ThemeHalves | null;
  readonly liveAppearanceMode: ThemePreferenceMode;
};

export type SettingsRestoreFailureToast = {
  readonly title: string;
  readonly description: string;
};

export type SettingsRestorePlan = {
  readonly resetTheme: boolean;
  readonly clearThemeMix: boolean;
  readonly resetFollowSystem: boolean;
  readonly themeFailureToast: SettingsRestoreFailureToast;
  readonly settingsPatch: ScopedSettingsPatch;
};

const SETTINGS_RESTORE_PATCH: ScopedSettingsPatch = {
  appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
  diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
  chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
  timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
  notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
  inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
  wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
  diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
  diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
  diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
  proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
  showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
  composerCollapseOnScroll: DEFAULT_UNIFIED_SETTINGS.composerCollapseOnScroll,
  composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
  sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
  followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
  contextWindowMeterEnabled: DEFAULT_UNIFIED_SETTINGS.contextWindowMeterEnabled,
  environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
  glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
  panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
  sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
  sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
  sidebarWorkingShelfEnabled: DEFAULT_UNIFIED_SETTINGS.sidebarWorkingShelfEnabled,
  sidebarAutoSettleAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays,
  sidebarAutoSettleOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleOnMerge,
  responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
  enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
  continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
  backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
  automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
  providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
  defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
  newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
  addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
  confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
  confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
  confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
  confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
  textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
  fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
  fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
  fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
  fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
  fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
  fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
  fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
  fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
  browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
  browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
  browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
  browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
  browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
  browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
  browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
  browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
  enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
};

const THEME_RESTORE_FAILURE_TOAST: SettingsRestoreFailureToast = {
  title: "Couldn’t restore theme settings",
  description: "Try again.",
};

function changedLabel(changed: boolean, label: string): string[] {
  return changed ? [label] : [];
}

function getChangedSettingLabels(input: SettingsRestoreModelInput): string[] {
  const { settings } = input;
  const defaults = DEFAULT_UNIFIED_SETTINGS;
  return [
    ...changedLabel(input.theme !== "system", "Theme"),
    ...changedLabel(!input.followSystem, "Follow system"),
    ...changedLabel(input.themeHalves !== null, "Theme mix"),
    ...changedLabel(settings.appearanceContrast !== defaults.appearanceContrast, "Contrast"),
    ...changedLabel(settings.glassOpacity !== defaults.glassOpacity, "Glass opacity"),
    ...changedLabel(settings.diffColorScheme !== defaults.diffColorScheme, "Diff colors"),
    ...changedLabel(settings.chatWidth !== defaults.chatWidth, "Chat width"),
    ...changedLabel(
      settings.panelAnimationDurationMs !== defaults.panelAnimationDurationMs,
      "Panel animations",
    ),
    ...changedLabel(
      settings.environmentIdentificationMode !== defaults.environmentIdentificationMode,
      "Environment identification",
    ),
    ...changedLabel(settings.timestampFormat !== defaults.timestampFormat, "Time format"),
    ...changedLabel(
      settings.notificationMode !== defaults.notificationMode,
      "Thread notifications",
    ),
    ...changedLabel(
      settings.inAppNotificationsEnabled !== defaults.inAppNotificationsEnabled,
      "In-app notifications",
    ),
    ...changedLabel(
      settings.sidebarThreadPreviewCount !== defaults.sidebarThreadPreviewCount,
      "Visible threads",
    ),
    ...changedLabel(
      settings.sidebarProjectGroupingMode !== defaults.sidebarProjectGroupingMode,
      "Project Grouping",
    ),
    ...changedLabel(
      settings.sidebarWorkingShelfEnabled !== defaults.sidebarWorkingShelfEnabled,
      "Working section",
    ),
    ...changedLabel(
      settings.sidebarAutoSettleAfterDays !== defaults.sidebarAutoSettleAfterDays,
      "Auto-settle inactive threads",
    ),
    ...changedLabel(
      settings.sidebarAutoSettleOnMerge !== defaults.sidebarAutoSettleOnMerge,
      "Auto-settle merged threads",
    ),
    ...changedLabel(settings.wordWrap !== defaults.wordWrap, "Word wrap"),
    ...getChangedTypographySettingLabels(settings),
    ...changedLabel(
      settings.diffFilesCollapsed !== defaults.diffFilesCollapsed,
      "Default diff file state",
    ),
    ...changedLabel(
      settings.diffIgnoreWhitespace !== defaults.diffIgnoreWhitespace,
      "Diff whitespace changes",
    ),
    ...changedLabel(settings.diffLayout !== defaults.diffLayout, "Diff layout"),
    ...changedLabel(
      settings.proactivePanelsEnabled !== defaults.proactivePanelsEnabled,
      "Proactive panels",
    ),
    ...changedLabel(
      settings.showSkillsInSlashMenu !== defaults.showSkillsInSlashMenu,
      "Show skills in slash menu",
    ),
    ...changedLabel(
      settings.composerCollapseOnScroll !== defaults.composerCollapseOnScroll,
      "Collapse composer on scroll",
    ),
    ...changedLabel(
      settings.composerRichTextEnabled !== defaults.composerRichTextEnabled,
      "Rich text composer",
    ),
    ...changedLabel(settings.sendShortcut !== defaults.sendShortcut, "Send shortcut"),
    ...changedLabel(settings.followUpBehavior !== defaults.followUpBehavior, "Follow-up behavior"),
    ...changedLabel(
      settings.contextWindowMeterEnabled !== defaults.contextWindowMeterEnabled,
      "Context window indicator",
    ),
    ...changedLabel(
      settings.responseStreamingMode !== defaults.responseStreamingMode,
      "Response streaming",
    ),
    ...changedLabel(
      settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks,
      "Provider update checks",
    ),
    ...changedLabel(
      settings.continueThreadsAfterServerUpdate !== defaults.continueThreadsAfterServerUpdate,
      "Continue threads after restarts",
    ),
    ...changedLabel(hasChangedBackgroundActivitySettings(settings), "Background activity"),
    ...changedLabel(
      settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode,
      "New thread mode",
    ),
    ...changedLabel(
      settings.newWorktreesStartFromOrigin !== defaults.newWorktreesStartFromOrigin,
      "New worktrees start from origin",
    ),
    ...changedLabel(
      settings.addProjectBaseDirectory !== defaults.addProjectBaseDirectory,
      "Add project base directory",
    ),
    ...changedLabel(
      settings.confirmThreadUnpin !== defaults.confirmThreadUnpin,
      "Unpin confirmation",
    ),
    ...changedLabel(
      settings.confirmThreadArchive !== defaults.confirmThreadArchive,
      "Archive confirmation",
    ),
    ...changedLabel(
      settings.confirmThreadDelete !== defaults.confirmThreadDelete,
      "Delete confirmation",
    ),
    ...changedLabel(settings.confirmQuit !== defaults.confirmQuit, "Quit shortcut"),
    ...changedLabel(
      !Equal.equals(
        settings.textGenerationModelSelection ?? null,
        defaults.textGenerationModelSelection ?? null,
      ),
      "Text generation model",
    ),
    ...getChangedBrowserSettingLabels(settings),
    ...changedLabel(
      settings.enableAgentBrowserAccess !== defaults.enableAgentBrowserAccess,
      "Agent browser access",
    ),
  ];
}

export function buildSettingsRestoreModel(input: SettingsRestoreModelInput): SettingsRestoreModel {
  const changedSettingLabels = getChangedSettingLabels(input);
  const canRestore = changedSettingLabels.length > 0;
  return {
    actionLabel: "Restore device defaults",
    changedSettingLabels,
    canRestore,
    confirmDialog: canRestore
      ? {
          message: [
            "Restore default settings?",
            `This will reset: ${changedSettingLabels.join(", ")}.`,
          ].join("\n"),
          variant: "destructive",
        }
      : null,
  };
}

export function resolveSettingsRestorePatch(input: SettingsRestorePatchInput): SettingsRestorePlan {
  return {
    resetTheme: input.liveTheme !== "system",
    clearThemeMix: input.liveThemeHalves !== null,
    resetFollowSystem: input.liveAppearanceMode !== "system",
    themeFailureToast: THEME_RESTORE_FAILURE_TOAST,
    settingsPatch: SETTINGS_RESTORE_PATCH,
  };
}
