import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  resolveEffectiveEnvMode,
  type EnvironmentOption,
  type EnvMode,
} from "@t3tools/web/src/components/BranchToolbar.logic.ts";
import { findRecordedWorktreeSetup } from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  buildLogicalProjectEnvironments,
  resolveAutoEnvironmentLabel,
  resolveAutomaticEnvironment,
  resolveCanAutoEnvironment,
  resolveCanOverrideServerThreadEnvMode,
  resolveComposerEnvLocked,
  resolveComposerEnvSelection,
  resolveLoadBalancingCandidates,
} from "@t3tools/web/src/components/chat/composerEnvironment.logic.ts";
import { resolveAwaitingBootstrapTurn } from "@t3tools/web/src/components/chat/threadRunState.logic.ts";
import {
  resolveLoadBalancedEnvironment,
  toLoadBalancedEnvironmentResource,
  type LoadBalancedEnvironmentState,
} from "@t3tools/web/src/hooks/loadBalancedEnvironment.logic.ts";
import { selectProjectGroupingSettings } from "@t3tools/web/src/logicalProject.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { deriveComposerModelContext } from "./composerView.ts";
import type { ThreadInput } from "./feature.ts";
import type { CoreState } from "./state.ts";

export type PendingServerThreadEnv = {
  readonly envMode: EnvMode | null;
  readonly branch: string | null | undefined;
  readonly startFromOrigin: boolean | undefined;
};

export type ComposerEnvironment = {
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  readonly isLocalDraftThread: boolean;
  readonly envLocked: boolean;
  readonly canOverrideServerThreadEnvMode: boolean;
  readonly envMode: EnvMode;
  readonly activeThreadBranch: string | null;
  readonly startFromOrigin: boolean;
  readonly newWorktreesStartFromOrigin: boolean;
  readonly logicalProjectEnvironments: ReadonlyArray<EnvironmentOption>;
  readonly hasMultipleEnvironments: boolean;
  readonly composerHasAttachments: boolean;
  readonly automaticEnvironment: boolean;
  readonly needsLoadBalancing: boolean;
  readonly loadBalancingCandidates: ReadonlyArray<EnvironmentId>;
  readonly loadBalancing: LoadBalancedEnvironmentState;
  readonly autoEnvironmentLabel: string | undefined;
  readonly canAutoEnvironment: boolean;
};

type Reader = <A>(atom: Atom.Atom<A>) => A;

const EMPTY_PENDING: PendingServerThreadEnv = {
  envMode: null,
  branch: undefined,
  startFromOrigin: undefined,
};

export type ComposerEnvironmentRuntime = {
  readonly pendingAtom: Atom.Writable<ReadonlyMap<string, PendingServerThreadEnv>>;
  readonly derive: (read: Reader, input: ThreadInput) => ComposerEnvironment;
  readonly read: (input: ThreadInput) => ComposerEnvironment;
  readonly updatePending: (
    threadKey: string,
    update: (current: PendingServerThreadEnv) => PendingServerThreadEnv,
  ) => void;
};

const runtimes = new WeakMap<AtomRegistry.AtomRegistry, ComposerEnvironmentRuntime>();

export function composerEnvironmentRuntime(
  registry: AtomRegistry.AtomRegistry,
  state: CoreState,
): ComposerEnvironmentRuntime {
  const existing = runtimes.get(registry);
  if (existing !== undefined) return existing;

  const pendingAtom = Atom.make<ReadonlyMap<string, PendingServerThreadEnv>>(new Map()).pipe(
    Atom.keepAlive,
  );

  const derive = (read: Reader, input: ThreadInput): ComposerEnvironment => {
    const { thread, project, draftThread } = input;
    const threadKey = scopedThreadKey(input.route);
    const isLocalDraftThread = !input.isServerThread && draftThread !== null;
    const settings = mergeEnvironmentSettings(
      input.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      input.clientSettings,
    );
    const newWorktreesStartFromOrigin = resolveProjectSettings(settings, thread.projectId, project)
      .settings.newWorktreesStartFromOrigin;
    const envLocked = resolveComposerEnvLocked(thread);
    const derivedEnvMode = resolveEffectiveEnvMode({
      activeWorktreePath: thread.worktreePath ?? null,
      hasServerThread: input.isServerThread,
      draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
      preparingWorktree: resolveAwaitingBootstrapTurn({
        serverThread: input.isServerThread ? thread : null,
        routeThreadId: thread.id,
        recordedWorktreeSetup: findRecordedWorktreeSetup(thread.activities, thread.id),
      }),
    });
    const canOverrideServerThreadEnvMode = resolveCanOverrideServerThreadEnvMode({
      isServerThread: input.isServerThread,
      thread,
      envLocked,
    });
    const pending = read(pendingAtom).get(threadKey) ?? EMPTY_PENDING;
    const selection = resolveComposerEnvSelection({
      canOverrideServerThreadEnvMode,
      isLocalDraftThread,
      derivedEnvMode,
      pendingServerThreadEnvMode: pending.envMode,
      pendingServerThreadBranch: pending.branch,
      pendingServerThreadStartFromOrigin: pending.startFromOrigin,
      draftThread,
      threadBranch: thread.branch ?? null,
      newWorktreesStartFromOrigin,
    });
    const presentations = read(state.environmentPresentations.presentationsAtom);
    const environmentById = new Map(
      [...presentations.entries()].map(([environmentId, presentation]) => [
        environmentId,
        projectEnvironmentPresentation(environmentId, presentation),
      ]),
    );
    const logicalProjectEnvironments = buildLogicalProjectEnvironments({
      activeProject: project ?? null,
      projects: read(state.environmentProjects.projectsAtom),
      projectGroupingSettings: selectProjectGroupingSettings(input.clientSettings),
      primaryEnvironmentId: read(state.primaryEnvironmentIdAtom),
      environmentById,
    });
    const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;
    const composerHasAttachments =
      (input.draft?.images.length ?? 0) > 0 || (input.draft?.files.length ?? 0) > 0;
    const automaticEnvironment = resolveAutomaticEnvironment({
      clientSettingsHydrated: true,
      hasDraftId: input.draftId !== null,
      envLocked,
      hasMultipleEnvironments,
      loadBalancingEnabled: input.clientSettings.loadBalancingEnabled,
      composerHasAttachments,
      draftThread,
    });
    const needsLoadBalancing = automaticEnvironment && !draftThread?.loadBalancedEnvironmentId;
    const modelContext = needsLoadBalancing ? deriveComposerModelContext(input) : null;
    const loadBalancingCandidates =
      modelContext === null
        ? []
        : resolveLoadBalancingCandidates({
            needsLoadBalancing,
            logicalProjectEnvironments,
            environmentById,
            loadBalancingWeights: input.clientSettings.loadBalancingWeights,
            activeProviderInstanceId: modelContext.selectedProviderEntry?.instanceId ?? null,
            selectedProvider: modelContext.selectedProvider,
          });
    const loadBalancing = resolveLoadBalancedEnvironment({
      resources: loadBalancingCandidates.map((environmentId) =>
        toLoadBalancedEnvironmentResource(
          environmentId,
          read(state.serverEnvironment.hostResources({ environmentId, input: {} })),
        ),
      ),
      weights: input.clientSettings.loadBalancingWeights,
      now: Date.now(),
    });
    return {
      threadKey,
      environmentId: thread.environmentId,
      isLocalDraftThread,
      envLocked,
      canOverrideServerThreadEnvMode,
      envMode: selection.envMode,
      activeThreadBranch: selection.activeThreadBranch,
      startFromOrigin: selection.startFromOrigin,
      newWorktreesStartFromOrigin,
      logicalProjectEnvironments,
      hasMultipleEnvironments,
      composerHasAttachments,
      automaticEnvironment,
      needsLoadBalancing,
      loadBalancingCandidates,
      loadBalancing,
      autoEnvironmentLabel: resolveAutoEnvironmentLabel({
        automaticEnvironment,
        loadBalancedEnvironmentId: draftThread?.loadBalancedEnvironmentId,
        loadBalancingPending: loadBalancing.pending,
        loadBalancingFailed: loadBalancing.failed,
      }),
      canAutoEnvironment: resolveCanAutoEnvironment({
        hasDraftId: input.draftId !== null,
        envLocked,
        hasMultipleEnvironments,
        loadBalancingEnabled: input.clientSettings.loadBalancingEnabled,
      }),
    };
  };

  const updatePending = (
    threadKey: string,
    update: (current: PendingServerThreadEnv) => PendingServerThreadEnv,
  ) => {
    const current = registry.get(pendingAtom);
    const next = new Map(current);
    next.set(threadKey, update(current.get(threadKey) ?? EMPTY_PENDING));
    registry.set(pendingAtom, next);
  };

  const runtime: ComposerEnvironmentRuntime = {
    pendingAtom,
    derive,
    read: (input) => derive((atom) => registry.get(atom), input),
    updatePending,
  };
  runtimes.set(registry, runtime);
  return runtime;
}
