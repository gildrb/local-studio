import type { CoreFeature, FeatureContext } from "./feature.ts";
import { createConfirmDialogFeature } from "./features/confirmDialog.ts";
import { createRightPanelFeature } from "./features/rightPanel.ts";
import { createHeaderLayoutFeature } from "./headerLayout.ts";
import { rightPanelAgentsFeature } from "./features/rightPanelAgents.ts";
import { rightPanelDiffFeature } from "./features/rightPanelDiff.ts";
import { rightPanelFilesFeature } from "./features/rightPanelFiles.ts";
import { createGitActionsFeature } from "./features/gitActions.ts";
import { createOpenInFeature } from "./features/openIn.ts";
import { createTerminalFeature } from "./features/terminal.ts";
import { createLocalFeature } from "./features/local.ts";
import { createProjectScriptsFeature } from "./features/projectScripts.ts";
import { createTimelineMarkdownFeature } from "./features/timelineMarkdown.ts";
import { createContextMenuFeature } from "./contextMenu.ts";
import { createClipboardFeature } from "./clipboard.ts";
import { createThreadActionsFeature } from "./threadActions.ts";
import { createCustomSnoozeFeature } from "./features/customSnooze.ts";
import { createThreadHeaderFeature } from "./features/threadHeader.ts";
import { commandPaletteFeature } from "./features/commandPalette.ts";
import { createDraftsFeature } from "./features/drafts.ts";
import { createComposerInputFeature } from "./features/composerInput.ts";
import { createSidebarFeature } from "./features/sidebar.ts";
import { createBranchToolbarFeature } from "./features/branchToolbar.ts";
import { createSettingsFeature } from "./features/settings.ts";
import { createUsageFeature } from "./features/usage.ts";
import { createPullRequestsPageFeature } from "./features/pullRequestsPage.ts";
import { createPullRequestPopoverFeature } from "./features/pullRequestPopover.ts";
import { createPullRequestDetailFeature } from "./features/pullRequestDetail.ts";
import { createPullRequestSummaryFeature } from "./features/pullRequestSummary.ts";
import { createPullRequestTimelineFeature } from "./features/pullRequestTimeline.ts";
import { createPullRequestComposerFeature } from "./features/pullRequestComposer.ts";
import { createPullRequestCodeFeature } from "./features/pullRequestCode.ts";
import { createThreadPullRequestsPanelFeature } from "./features/threadPullRequestsPanel.ts";
import { createWindowActivityFeature } from "./pullRequestShared.ts";
import { createOnboardingFeature } from "./features/onboarding.ts";
import { createAppThemeFeature } from "./features/appTheme.ts";
import { createBrowserHostFeature } from "./browserPreview.ts";
import { createBrowserFeature } from "./features/browser.ts";
import { createBrowserAutomationFeature } from "./features/browserAutomation.ts";
import { createPreviewMiniPlayerFeature } from "./features/previewMiniPlayer.ts";
import { createSnapShotFeature } from "./snapShot.ts";
import { createDeviceFeature } from "./features/device.ts";
import { createThemeEditorFeature } from "./features/themeEditor.ts";
import { createThreadNotificationsFeature } from "./features/threadNotifications.ts";
import { createNativeDesktopShellFeature } from "./features/nativeDesktopShell.ts";
import { createMediaViewerFeature } from "./features/mediaViewer.ts";

export const FEATURES: ReadonlyArray<(context: FeatureContext) => CoreFeature> = [
  createConfirmDialogFeature,
  createRightPanelFeature,
  createHeaderLayoutFeature,
  rightPanelAgentsFeature,
  rightPanelDiffFeature,
  rightPanelFilesFeature,
  createGitActionsFeature,
  createOpenInFeature,
  createTerminalFeature,
  createLocalFeature,
  createProjectScriptsFeature,
  createTimelineMarkdownFeature,
  createContextMenuFeature,
  createClipboardFeature,
  createThreadActionsFeature,
  createCustomSnoozeFeature,
  createThreadHeaderFeature,
  commandPaletteFeature,
  createDraftsFeature,
  createComposerInputFeature,
  createSidebarFeature,
  createBranchToolbarFeature,
  createSettingsFeature,
  createUsageFeature,
  createPullRequestsPageFeature,
  createPullRequestPopoverFeature,
  createPullRequestDetailFeature,
  createPullRequestSummaryFeature,
  createPullRequestTimelineFeature,
  createPullRequestComposerFeature,
  createPullRequestCodeFeature,
  createThreadPullRequestsPanelFeature,
  createWindowActivityFeature,
  createOnboardingFeature,
  createAppThemeFeature,
  createBrowserHostFeature,
  createBrowserFeature,
  createBrowserAutomationFeature,
  createPreviewMiniPlayerFeature,
  createDeviceFeature,
  createThemeEditorFeature,
  createThreadNotificationsFeature,
  createSnapShotFeature,
  createNativeDesktopShellFeature,
  createMediaViewerFeature,
];
