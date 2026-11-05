import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, ResolvedKeybindingsConfig, VcsStatusResult } from "@t3tools/contracts";
import { shortcutLabelForCommand } from "@t3tools/web/src/keybindings.ts";
import {
  buildChatHeaderModel,
  resolveHeaderActionsLayout,
  shouldShowOpenInPicker,
  type ChatHeaderModel,
} from "@t3tools/web/src/components/chat/ChatHeader.logic.ts";
import {
  buildPanelLayoutControlsModel,
  DEFAULT_RIGHT_PANEL_UNAVAILABLE_LABEL,
  type PanelLayoutControlsModel,
} from "@t3tools/web/src/components/chat/PanelLayoutControls.logic.ts";
import {
  buildGitActionsToolbarModel,
  type GitActionsToolbarModel,
} from "@t3tools/web/src/components/GitActionsControl.logic.ts";
import { resolveRemoteOpenResolution } from "@t3tools/web/src/remoteOpen.logic.ts";
import { responsiveBreakpointFadeDurationMs } from "@t3tools/web/src/panelAnimations.logic.ts";

export interface HeaderToolbarInput {
  readonly platform: string;
  readonly environmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly presentation: EnvironmentPresentation | null;
  readonly project: { readonly title: string } | null;
  readonly threadTitle: string;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly gitCwd: string | null;
  readonly gitStatus: VcsStatusResult | null;
  readonly gitStatusError: string | null;
  readonly isGitActionRunning: boolean;
  readonly isInitPending: boolean;
  readonly terminalOpen: boolean;
  readonly rightPanelOpen: boolean;
  readonly liveAgentCount: number;
  readonly actionsWidth: number | null;
  readonly panelAnimationDurationMs: number;
}

export interface HeaderToolbarView {
  readonly actions: ChatHeaderModel["actions"];
  readonly layout: {
    readonly collapsed: boolean;
    readonly expanded: boolean;
    readonly fadeMs: number;
    readonly transitionMs: number;
  };
  readonly git: GitActionsToolbarModel;
  readonly panels: PanelLayoutControlsModel;
}

export function buildHeaderToolbarView(input: HeaderToolbarInput): HeaderToolbarView {
  const remote = resolveRemoteOpenResolution(input.presentation, true).state;
  const layout = resolveHeaderActionsLayout({
    containerWidth: input.actionsWidth ?? Number.POSITIVE_INFINITY,
    isMobile: false,
  });
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName: input.project?.title,
    activeThreadEnvironmentId: input.environmentId,
    primaryEnvironmentId: input.primaryEnvironmentId,
    remoteOpenMode: remote.mode,
  });
  const header = buildChatHeaderModel({
    activeProject: input.project,
    activeThreadTitle: input.threadTitle,
    isServerThread: true,
    renamingTitle: null,
    hasProjectScripts: true,
    showOpenInPicker,
    gitCwd: input.gitCwd,
    actionsCollapsed: layout.actionsCollapsed,
  });
  const projectAvailable = input.project !== null;
  return {
    actions: header.actions,
    layout: {
      collapsed: layout.actionsCollapsed,
      expanded: layout.actionsExpanded,
      fadeMs:
        input.panelAnimationDurationMs > 0
          ? responsiveBreakpointFadeDurationMs(input.panelAnimationDurationMs)
          : 0,
      transitionMs: input.panelAnimationDurationMs,
    },
    git: header.actions.showGitActions
      ? buildGitActionsToolbarModel({
          gitCwd: input.gitCwd,
          gitStatus: input.gitStatus,
          gitStatusError: input.gitStatusError,
          isGitActionRunning: input.isGitActionRunning,
          isInitPending: input.isInitPending,
        })
      : { kind: "hidden" },
    panels: buildPanelLayoutControlsModel({
      showTerminalControl: true,
      terminalAvailable: projectAvailable,
      terminalOpen: input.terminalOpen,
      terminalShortcutLabel: shortcutLabelForCommand(
        input.keybindings,
        "terminal.toggle",
        input.platform,
      ),
      rightPanelAvailable: projectAvailable,
      rightPanelOpen: input.rightPanelOpen,
      rightPanelShortcutLabel: shortcutLabelForCommand(
        input.keybindings,
        "rightPanel.toggle",
        input.platform,
      ),
      rightPanelUnavailableLabel: DEFAULT_RIGHT_PANEL_UNAVAILABLE_LABEL,
      liveAgentCount: input.liveAgentCount,
    }),
  };
}
