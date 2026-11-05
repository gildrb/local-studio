import type { EnvironmentId, ServerSelfUpdateCapability } from "@t3tools/contracts";
import type { ServerUpdateStage } from "@t3tools/client-runtime/state/server";

import { manualServerUpdateCommand } from "../versionSkew.logic";

// The wire "installing" stage is a sub-second launcher handoff, so the UI
// folds it into the download phase; everything after the handoff is the
// restart the user is actually waiting through.
const UPDATE_STAGE_LABELS: Record<ServerUpdateStage, string> = {
  downloading: "Downloading…",
  installing: "Downloading…",
  resuming: "Restarting…",
};

export function serverUpdateStageLabel(stage: ServerUpdateStage): string {
  return UPDATE_STAGE_LABELS[stage];
}

export function serverUpdateFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Server update failed.";
}

export interface ServerUpdateTarget {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly desktopAppUpdate?: boolean;
  readonly threadContinuation?: boolean;
  readonly targetVersion: string;
  readonly continueThreadsAfterServerUpdate?: boolean;
}

export function resolveServerUpdateInput(target: ServerUpdateTarget): {
  readonly targetVersion: string;
  readonly continueRunningThreads?: true;
} {
  return {
    targetVersion: target.targetVersion,
    ...(target.threadContinuation && target.continueThreadsAfterServerUpdate
      ? { continueRunningThreads: true }
      : {}),
  };
}

export function resolveServerUpdateSuccessToast(input: {
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly targetVersion: string;
}): { readonly title: string; readonly description: string } {
  return {
    title: `${input.serverLabel} updated`,
    description:
      input.selfUpdate === "desktop-managed"
        ? `Desktop app relaunched on ${input.targetVersion}.`
        : `Reconnected on t3@${input.targetVersion}.`,
  };
}

export function resolveEligibleServerUpdateTargets<T extends ServerUpdateTarget>(
  targets: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return targets.filter(
    (target) =>
      target.selfUpdate !== null &&
      (target.selfUpdate !== "desktop-managed" || target.desktopAppUpdate),
  );
}

export function desktopAppsUpdateConfirmMessage(serverLabels: ReadonlyArray<string>): string {
  return `Update the T3 Code desktop apps on ${serverLabels.join(", ")}? They will close and relaunch on those machines.`;
}

export function desktopAppUpdateConfirmMessage(serverLabel: string): string {
  return `Update the T3 Code desktop app that runs the ${serverLabel}? It will close and relaunch on that machine.`;
}

export type ServerUpdateActionModel =
  | { readonly kind: "desktop-app-required"; readonly text: string }
  | {
      readonly kind: "action";
      readonly label: string;
      readonly ariaLabel: string;
      readonly manualCommand: string | null;
      readonly confirmDesktopApp: boolean;
    };

export function buildServerUpdateActionModel(input: {
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly desktopAppUpdate: boolean;
  readonly targetVersion: string;
  readonly label: string;
}): ServerUpdateActionModel {
  if (input.selfUpdate === "desktop-managed" && !input.desktopAppUpdate) {
    return {
      kind: "desktop-app-required",
      text: "Update the desktop app on that machine to update this server.",
    };
  }
  const manualCommand =
    input.selfUpdate === null ? manualServerUpdateCommand(input.targetVersion) : null;
  const label = manualCommand !== null ? "Copy update command" : input.label;
  return {
    kind: "action",
    label,
    ariaLabel: `${label} for ${input.serverLabel}`,
    manualCommand,
    confirmDesktopApp: input.selfUpdate === "desktop-managed",
  };
}

export function resolveUpdateCommandCopyToast(input: {
  readonly command: string;
  readonly serverLabel: string;
}): { readonly title: string; readonly description: string } {
  return {
    title: "Update command copied",
    description: `Run \`${input.command}\` on ${input.serverLabel} to update it.`,
  };
}

export const UPDATE_COMMAND_COPY_FAILURE_TITLE = "Could not copy update command";
