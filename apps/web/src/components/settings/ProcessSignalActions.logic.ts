import type { ServerProcessSignal } from "@t3tools/contracts";

export type ProcessSignalActionTone = "muted" | "destructive";

export type ProcessSignalActionModel = {
  readonly signal: ServerProcessSignal;
  readonly label: string;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly tone: ProcessSignalActionTone;
  readonly disabled: boolean;
};

export type ProcessSignalActionsModelInput = {
  readonly disabled: boolean;
};

export type ProcessSignalActionsModel = {
  readonly actions: ReadonlyArray<ProcessSignalActionModel>;
};

const PROCESS_SIGNAL_ACTIONS: ReadonlyArray<{
  readonly signal: ServerProcessSignal;
  readonly label: string;
  readonly tone: ProcessSignalActionTone;
}> = [
  { signal: "SIGINT", label: "INT", tone: "muted" },
  { signal: "SIGKILL", label: "KILL", tone: "destructive" },
];

export function buildProcessSignalActionsModel(
  input: ProcessSignalActionsModelInput,
): ProcessSignalActionsModel {
  return {
    actions: PROCESS_SIGNAL_ACTIONS.map((action) => ({
      signal: action.signal,
      label: action.label,
      ariaLabel: `Send ${action.signal}`,
      tooltip: `Send ${action.signal}`,
      tone: action.tone,
      disabled: input.disabled,
    })),
  };
}
