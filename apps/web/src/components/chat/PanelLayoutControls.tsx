import { Maximize2Icon, Minimize2Icon, PanelBottomIcon, PanelRightIcon } from "lucide-react";
import { memo } from "react";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildPanelLayoutControlsModel,
  buildRightPanelMaximizeModel,
  DEFAULT_RIGHT_PANEL_UNAVAILABLE_LABEL,
} from "./PanelLayoutControls.logic";

interface PanelLayoutControlsProps {
  showTerminalControl?: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  rightPanelUnavailableLabel?: string;
  /** Running + waiting subagents in this thread; badges the right panel toggle. */
  liveAgentCount: number;
  onToggleTerminal: () => void;
  onToggleRightPanel: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  showTerminalControl = true,
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  rightPanelUnavailableLabel = DEFAULT_RIGHT_PANEL_UNAVAILABLE_LABEL,
  liveAgentCount,
  onToggleTerminal,
  onToggleRightPanel,
}: PanelLayoutControlsProps) {
  const { terminal, rightPanel } = buildPanelLayoutControlsModel({
    showTerminalControl,
    terminalAvailable,
    terminalOpen,
    terminalShortcutLabel,
    rightPanelAvailable,
    rightPanelOpen,
    rightPanelShortcutLabel,
    rightPanelUnavailableLabel,
    liveAgentCount,
  });
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {terminal.visible ? (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={terminal.pressed}
              onPressedChange={onToggleTerminal}
              aria-label={terminal.ariaLabel}
              variant="ghost"
              size="sm"
              disabled={terminal.disabled}
            >
              <PanelBottomIcon className="size-4" />
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">{terminal.tooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={rightPanel.pressed}
            onPressedChange={onToggleRightPanel}
            aria-label={rightPanel.ariaLabel}
            variant="ghost"
            size="sm"
            disabled={rightPanel.disabled}
          >
            <PanelRightIcon className="size-4" />
            {rightPanel.badgeCount !== null ? (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-3xs font-semibold tabular-nums text-white"
              >
                {rightPanel.badgeCount}
              </span>
            ) : null}
          </Toggle>
        </TooltipTrigger>
        <TooltipPopup side="bottom">{rightPanel.tooltip}</TooltipPopup>
      </Tooltip>
    </div>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const model = buildRightPanelMaximizeModel(maximized);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={model.pressed}
            onPressedChange={onToggle}
            aria-label={model.label}
            variant="ghost"
            size="sm"
          >
            {model.icon === "minimize-2" ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{model.label}</TooltipPopup>
    </Tooltip>
  );
});
