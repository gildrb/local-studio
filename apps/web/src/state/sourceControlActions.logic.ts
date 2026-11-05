import type { VcsActionOperation, VcsActionState } from "@t3tools/client-runtime/state/vcs";
import type { EnvironmentId } from "@t3tools/contracts";

export type SourceControlActionKind =
  | "init"
  | "pull"
  | "publishRepository"
  | "runStackedAction"
  | "preparePullRequestThread";

export interface SourceControlActionScope {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}

export interface ResolvedSourceControlActionScope {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

export const SOURCE_CONTROL_ACTION_OPERATION = {
  init: "init",
  pull: "pull",
  publishRepository: "publish_repository",
  runStackedAction: "run_change_request",
  preparePullRequestThread: "prepare_pull_request_thread",
} as const satisfies Record<SourceControlActionKind, VcsActionOperation>;

export const SOURCE_CONTROL_ACTION_LABEL = {
  init: "Initializing repository",
  pull: "Pulling latest changes",
  publishRepository: "Publishing repository",
  runStackedAction: "Running source control action",
  preparePullRequestThread: "Preparing pull request thread",
} as const satisfies Record<SourceControlActionKind, string>;

export const RUNNING_SOURCE_CONTROL_ACTIONS: ReadonlyArray<SourceControlActionKind> = [
  "runStackedAction",
  "pull",
  "publishRepository",
];

export function resolveSourceControlActionScope(
  scope: SourceControlActionScope,
): ResolvedSourceControlActionScope | null {
  if (scope.environmentId === null || scope.cwd === null) {
    return null;
  }
  return {
    environmentId: scope.environmentId,
    cwd: scope.cwd,
  };
}

export function isSourceControlActionRunning(
  state: VcsActionState,
  kinds: ReadonlyArray<SourceControlActionKind>,
): boolean {
  return (
    state.isRunning &&
    state.operation !== null &&
    kinds.some((kind) => SOURCE_CONTROL_ACTION_OPERATION[kind] === state.operation)
  );
}

export function isSourceControlActionPending(
  state: VcsActionState,
  kind: SourceControlActionKind,
): boolean {
  return state.operation === SOURCE_CONTROL_ACTION_OPERATION[kind] && state.isRunning;
}
