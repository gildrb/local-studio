import type { TerminalOpenInput, ThreadId } from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { nextTerminalId } from "@t3tools/shared/terminalLabels";

import type { RightPanelSurface } from "../../rightPanelStore";

export interface PanelToggleModel {
  readonly visible: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: "panel-bottom" | "panel-right";
  readonly badgeCount: number | null;
}

export interface PanelLayoutControlsInput {
  readonly showTerminalControl: boolean;
  readonly terminalAvailable: boolean;
  readonly terminalOpen: boolean;
  readonly terminalShortcutLabel: string | null;
  readonly rightPanelAvailable: boolean;
  readonly rightPanelOpen: boolean;
  readonly rightPanelShortcutLabel: string | null;
  readonly rightPanelUnavailableLabel: string;
  readonly liveAgentCount: number;
}

export interface PanelLayoutControlsModel {
  readonly terminal: PanelToggleModel;
  readonly rightPanel: PanelToggleModel;
}

export const DEFAULT_RIGHT_PANEL_UNAVAILABLE_LABEL = "Right panel is unavailable";

export function buildPanelLayoutControlsModel(
  input: PanelLayoutControlsInput,
): PanelLayoutControlsModel {
  const agents =
    input.liveAgentCount > 0
      ? `${input.liveAgentCount} ${input.liveAgentCount === 1 ? "agent" : "agents"} working`
      : null;
  return {
    terminal: {
      visible: input.showTerminalControl,
      pressed: input.terminalOpen,
      disabled: !input.terminalAvailable,
      ariaLabel: "Toggle terminal drawer",
      tooltip: input.terminalAvailable
        ? `Toggle terminal drawer${input.terminalShortcutLabel ? ` (${input.terminalShortcutLabel})` : ""}`
        : "Terminal drawer is unavailable",
      icon: "panel-bottom",
      badgeCount: null,
    },
    rightPanel: {
      visible: true,
      pressed: input.rightPanelOpen,
      disabled: !input.rightPanelAvailable,
      ariaLabel: agents ? `Toggle right panel, ${agents}` : "Toggle right panel",
      tooltip: input.rightPanelAvailable
        ? `Toggle right panel${input.rightPanelShortcutLabel ? ` (${input.rightPanelShortcutLabel})` : ""}${
            agents ? ` · ${agents}` : ""
          }`
        : input.rightPanelUnavailableLabel,
      icon: "panel-right",
      badgeCount: input.liveAgentCount > 0 ? input.liveAgentCount : null,
    },
  };
}

export interface RightPanelMaximizeModel {
  readonly pressed: boolean;
  readonly label: string;
  readonly icon: "minimize-2" | "maximize-2";
}

export function buildRightPanelMaximizeModel(maximized: boolean): RightPanelMaximizeModel {
  return {
    pressed: maximized,
    label: maximized ? "Restore panel size" : "Maximize panel",
    icon: maximized ? "minimize-2" : "maximize-2",
  };
}

export function resolvePanelToggleLiveAgentCount(input: {
  readonly rightPanelOpen: boolean;
  readonly activeSurfaceKind: RightPanelSurface["kind"] | null;
  readonly liveAgentCount: number;
}): number {
  return input.rightPanelOpen && input.activeSurfaceKind === "agents" ? 0 : input.liveAgentCount;
}

export type TerminalToggleIntent =
  | { readonly kind: "none" }
  | { readonly kind: "set-open"; readonly open: boolean }
  | {
      readonly kind: "open-first-terminal";
      readonly terminalId: string;
      readonly input: TerminalOpenInput;
    };

export function resolveTerminalToggleIntent(input: {
  readonly hasThread: boolean;
  readonly threadId: ThreadId | null;
  readonly terminalOpen: boolean;
  readonly terminalCount: number;
  readonly projectWorkspaceRoot: string | null;
  readonly gitCwd: string | null;
  readonly worktreePath: string | null;
  readonly allocatableTerminalIds: ReadonlyArray<string>;
}): TerminalToggleIntent {
  if (!input.hasThread) return { kind: "none" };
  const nextOpen = !input.terminalOpen;
  if (!nextOpen || input.terminalCount > 0) return { kind: "set-open", open: nextOpen };
  if (!input.threadId || input.projectWorkspaceRoot === null) return { kind: "none" };
  const cwd = input.gitCwd ?? input.projectWorkspaceRoot;
  if (!cwd) return { kind: "none" };
  const terminalId = nextTerminalId(input.allocatableTerminalIds);
  return {
    kind: "open-first-terminal",
    terminalId,
    input: {
      threadId: input.threadId,
      terminalId,
      cwd,
      ...(input.worktreePath != null ? { worktreePath: input.worktreePath } : {}),
      env: projectScriptRuntimeEnv({
        project: { cwd: input.projectWorkspaceRoot },
        worktreePath: input.worktreePath,
      }),
    },
  };
}

export type RightPanelToggleIntent =
  | { readonly kind: "none" }
  | { readonly kind: "close" }
  | { readonly kind: "toggle-visibility" };

export function resolveRightPanelToggleIntent(input: {
  readonly hasThread: boolean;
  readonly rightPanelOpen: boolean;
}): RightPanelToggleIntent {
  if (!input.hasThread) return { kind: "none" };
  return input.rightPanelOpen ? { kind: "close" } : { kind: "toggle-visibility" };
}

export type RightPanelCloseFloat =
  | { readonly kind: "browser"; readonly resourceId: string }
  | {
      readonly kind: "device";
      readonly target: NonNullable<Extract<RightPanelSurface, { kind: "device" }>["target"]>;
    }
  | null;

export function resolveRightPanelCloseFloat(
  activeSurface: RightPanelSurface | null,
): RightPanelCloseFloat {
  if (activeSurface?.kind === "preview" && activeSurface.resourceId) {
    return { kind: "browser", resourceId: activeSurface.resourceId };
  }
  if (activeSurface?.kind === "device" && activeSurface.target) {
    return { kind: "device", target: activeSurface.target };
  }
  return null;
}

export function resolveCanMaximizeRightPanel(input: {
  readonly rightPanelOpen: boolean;
  readonly usesRightPanelSheet: boolean;
}): boolean {
  return input.rightPanelOpen && !input.usesRightPanelSheet;
}

export function isRightPanelMaximized(input: {
  readonly canMaximize: boolean;
  readonly maximizedThreadKey: string | null;
  readonly routeThreadKey: string;
}): boolean {
  return input.canMaximize && input.maximizedThreadKey === input.routeThreadKey;
}

export function toggleMaximizedRightPanelThreadKey(
  maximizedThreadKey: string | null,
  routeThreadKey: string,
): string | null {
  return maximizedThreadKey === routeThreadKey ? null : routeThreadKey;
}
