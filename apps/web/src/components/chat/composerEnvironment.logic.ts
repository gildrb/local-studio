import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ScopedProjectRef,
  type ServerConfig,
} from "@t3tools/contracts";

import type { DraftThreadEnvMode } from "../../composerDraftStore";
import { resolveNewDraftStartFromOrigin } from "../../lib/chatThreadActions";
import type { EnvironmentOption } from "../BranchToolbar.logic";

export const LOAD_BALANCING_ATTACHMENTS_WARNING = {
  id: "load-balancing-attachments",
  title: "Keep attachments on this machine",
  description:
    "Remove attachments before choosing automatic routing, then attach them on the selected machine.",
} as const;

type LogicalProjectMember = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "workspaceRoot" | "repositoryIdentity"
>;

export function buildLogicalProjectEnvironments(input: {
  activeProject: LogicalProjectMember | null;
  projects: ReadonlyArray<LogicalProjectMember>;
  projectGroupingSettings: ProjectGroupingSettings;
  primaryEnvironmentId: EnvironmentId | null;
  environmentById: ReadonlyMap<
    EnvironmentId,
    { readonly label: string; readonly serverConfig: ServerConfig | null }
  >;
}): EnvironmentOption[] {
  if (!input.activeProject) return [];
  const logicalKey = deriveLogicalProjectKeyFromSettings(
    input.activeProject,
    input.projectGroupingSettings,
  );
  const memberProjects = input.projects.filter(
    (p) => deriveLogicalProjectKeyFromSettings(p, input.projectGroupingSettings) === logicalKey,
  );
  const seen = new Set<string>();
  const envs: EnvironmentOption[] = [];
  for (const p of memberProjects) {
    if (seen.has(p.environmentId)) continue;
    seen.add(p.environmentId);
    const isPrimary = p.environmentId === input.primaryEnvironmentId;
    const environment = input.environmentById.get(p.environmentId) ?? null;
    envs.push({
      environmentId: p.environmentId,
      projectId: p.id,
      label: environment?.label ?? p.environmentId,
      isPrimary,
      machine: resolveEnvironmentMachineKind(environment?.serverConfig ?? null),
    });
  }
  // Sort: primary first, then alphabetical
  envs.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return envs;
}

export function resolveComposerEnvLocked(
  thread: {
    readonly messages: ReadonlyArray<unknown>;
    readonly session: { readonly status: string } | null;
  } | null,
): boolean {
  return Boolean(
    thread &&
    (thread.messages.length > 0 ||
      (thread.session !== null && thread.session.status !== "stopped")),
  );
}

export function resolveAutomaticEnvironment(input: {
  clientSettingsHydrated: boolean;
  hasDraftId: boolean;
  envLocked: boolean;
  hasMultipleEnvironments: boolean;
  loadBalancingEnabled: boolean;
  composerHasAttachments: boolean;
  draftThread: {
    readonly environmentSelection?: "auto" | "manual";
    readonly loadBalancedEnvironmentId?: EnvironmentId | null;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  } | null;
}): boolean {
  const { draftThread } = input;
  return Boolean(
    input.clientSettingsHydrated &&
    input.hasDraftId &&
    !input.envLocked &&
    input.hasMultipleEnvironments &&
    input.loadBalancingEnabled &&
    draftThread?.environmentSelection !== "manual" &&
    (!input.composerHasAttachments || Boolean(draftThread?.loadBalancedEnvironmentId)) &&
    (!draftThread?.branch || draftThread.environmentSelection === "auto") &&
    !draftThread?.worktreePath,
  );
}

export function resolveLoadBalancingCandidates(input: {
  needsLoadBalancing: boolean;
  logicalProjectEnvironments: ReadonlyArray<EnvironmentOption>;
  environmentById: ReadonlyMap<
    EnvironmentId,
    {
      readonly connection: { readonly phase: string };
      readonly serverConfig: ServerConfig | null;
    }
  >;
  loadBalancingWeights: Readonly<Record<string, number>>;
  activeProviderInstanceId: string | null;
  selectedProvider: string;
}): EnvironmentId[] {
  if (!input.needsLoadBalancing) return [];
  return input.logicalProjectEnvironments
    .filter((candidate) => {
      const environment = input.environmentById.get(candidate.environmentId);
      return (
        environment?.connection.phase === "connected" &&
        (input.loadBalancingWeights[candidate.environmentId] ?? 50) > 0 &&
        environment.serverConfig?.providers.some(
          (provider) =>
            (input.activeProviderInstanceId === null ||
              provider.instanceId === input.activeProviderInstanceId) &&
            provider.driver === input.selectedProvider &&
            provider.enabled &&
            provider.installed &&
            provider.status !== "error" &&
            provider.auth.status !== "unauthenticated" &&
            provider.availability !== "unavailable",
        )
      );
    })
    .map((candidate) => candidate.environmentId);
}

export function resolveCanAutoEnvironment(input: {
  hasDraftId: boolean;
  envLocked: boolean;
  hasMultipleEnvironments: boolean;
  loadBalancingEnabled: boolean;
}): boolean {
  return (
    input.hasDraftId &&
    !input.envLocked &&
    input.hasMultipleEnvironments &&
    input.loadBalancingEnabled
  );
}

export function resolveAutoEnvironmentLabel(input: {
  automaticEnvironment: boolean;
  loadBalancedEnvironmentId: EnvironmentId | null | undefined;
  loadBalancingPending: boolean;
  loadBalancingFailed: boolean;
}): string | undefined {
  if (!input.automaticEnvironment) return undefined;
  if (input.loadBalancedEnvironmentId) return "Auto balance";
  if (input.loadBalancingPending) return "Checking machines…";
  if (input.loadBalancingFailed) return "Auto balance unavailable";
  return "Auto balance";
}

export function resolveCanOverrideServerThreadEnvMode(input: {
  isServerThread: boolean;
  thread: {
    readonly messages: ReadonlyArray<unknown>;
    readonly worktreePath: string | null;
  } | null;
  envLocked: boolean;
}): boolean {
  return Boolean(
    input.isServerThread &&
    input.thread &&
    input.thread.messages.length === 0 &&
    input.thread.worktreePath === null &&
    !input.envLocked,
  );
}

export interface ComposerEnvSelection {
  readonly envMode: DraftThreadEnvMode;
  readonly activeThreadBranch: string | null;
  readonly startFromOrigin: boolean;
}

export function resolveComposerEnvSelection(input: {
  canOverrideServerThreadEnvMode: boolean;
  isLocalDraftThread: boolean;
  derivedEnvMode: DraftThreadEnvMode;
  pendingServerThreadEnvMode: DraftThreadEnvMode | null;
  pendingServerThreadBranch: string | null | undefined;
  pendingServerThreadStartFromOrigin: boolean | undefined;
  draftThread: {
    readonly envMode?: DraftThreadEnvMode;
    readonly startFromOrigin?: boolean;
  } | null;
  threadBranch: string | null;
  newWorktreesStartFromOrigin: boolean;
}): ComposerEnvSelection {
  return {
    envMode: input.canOverrideServerThreadEnvMode
      ? (input.pendingServerThreadEnvMode ?? input.draftThread?.envMode ?? input.derivedEnvMode)
      : input.derivedEnvMode,
    activeThreadBranch:
      input.canOverrideServerThreadEnvMode && input.pendingServerThreadBranch !== undefined
        ? input.pendingServerThreadBranch
        : input.threadBranch,
    startFromOrigin: input.isLocalDraftThread
      ? (input.draftThread?.startFromOrigin ?? false)
      : input.canOverrideServerThreadEnvMode
        ? (input.pendingServerThreadStartFromOrigin ?? input.newWorktreesStartFromOrigin)
        : false,
  };
}

export type EnvModeChangePlan =
  | { readonly kind: "ignore" }
  | { readonly kind: "pending-server-thread"; readonly envMode: DraftThreadEnvMode }
  | {
      readonly kind: "draft";
      readonly context: {
        readonly envMode: DraftThreadEnvMode;
        readonly startFromOrigin: boolean;
        readonly worktreePath?: null;
      };
    }
  | { readonly kind: "focus-only" };

export function resolveEnvModeChangePlan(input: {
  mode: DraftThreadEnvMode;
  hasMultipleModelSelections: boolean;
  canOverrideServerThreadEnvMode: boolean;
  isLocalDraftThread: boolean;
  draftWorktreePath: string | null | undefined;
  newWorktreesStartFromOrigin: boolean;
}): EnvModeChangePlan {
  if (input.hasMultipleModelSelections) return { kind: "ignore" };
  if (input.canOverrideServerThreadEnvMode) {
    return { kind: "pending-server-thread", envMode: input.mode };
  }
  if (!input.isLocalDraftThread) return { kind: "focus-only" };
  return {
    kind: "draft",
    context: {
      envMode: input.mode,
      startFromOrigin: resolveNewDraftStartFromOrigin({
        envMode: input.mode,
        newWorktreesStartFromOrigin: input.newWorktreesStartFromOrigin,
      }),
      ...(input.mode === "worktree" && input.draftWorktreePath ? { worktreePath: null } : {}),
    },
  };
}

export function resolveEnvironmentChangeContext(input: {
  envLocked: boolean;
  hasDraftId: boolean;
  nextEnvironmentId: EnvironmentId;
  logicalProjectEnvironments: ReadonlyArray<EnvironmentOption>;
}): {
  projectRef: ScopedProjectRef;
  environmentSelection: "manual";
  loadBalancedEnvironmentId: null;
} | null {
  if (input.envLocked || !input.hasDraftId) return null;
  const target = input.logicalProjectEnvironments.find(
    (env) => env.environmentId === input.nextEnvironmentId,
  );
  if (!target) return null;
  return {
    projectRef: scopeProjectRef(target.environmentId, target.projectId),
    environmentSelection: "manual",
    loadBalancedEnvironmentId: null,
  };
}

export const AUTO_ENVIRONMENT_CONTEXT = {
  environmentSelection: "auto",
  loadBalancedEnvironmentId: null,
  branch: null,
  worktreePath: null,
} as const;

export function resolveLoadBalancedDraftContext(input: {
  needsLoadBalancing: boolean;
  loadBalancingPending: boolean;
  hasDraftId: boolean;
  sendInFlight: boolean;
  loadBalancedEnvironmentId: EnvironmentId | null;
  logicalProjectEnvironments: ReadonlyArray<EnvironmentOption>;
}): {
  projectRef: ScopedProjectRef;
  environmentSelection: "auto";
  loadBalancedEnvironmentId: EnvironmentId;
} | null {
  if (
    !input.needsLoadBalancing ||
    input.loadBalancingPending ||
    !input.hasDraftId ||
    input.sendInFlight
  ) {
    return null;
  }
  const target = input.logicalProjectEnvironments.find(
    (environment) => environment.environmentId === input.loadBalancedEnvironmentId,
  );
  if (!target) return null;
  return {
    projectRef: scopeProjectRef(target.environmentId, target.projectId),
    environmentSelection: "auto",
    loadBalancedEnvironmentId: target.environmentId,
  };
}
