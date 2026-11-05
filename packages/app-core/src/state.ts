import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";
import { createAssetEnvironmentAtoms } from "@t3tools/client-runtime/state/assets";
import { createAttachmentEnvironmentAtoms } from "@t3tools/client-runtime/state/attachments";
import { createEnvironmentPresentationAtoms } from "@t3tools/client-runtime/state/presentation";
import { createFilesystemEnvironmentAtoms } from "@t3tools/client-runtime/state/filesystem";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import {
  createEnvironmentProjectAtoms,
  createProjectEnvironmentAtoms,
} from "@t3tools/client-runtime/state/projects";
import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime/state/review";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import {
  createEnvironmentServerConfigsAtom,
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@t3tools/client-runtime/state/shell";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";
import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
} from "@t3tools/client-runtime/state/vcs";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import { createGitEnvironmentAtoms } from "@t3tools/client-runtime/state/git";
import {
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestEnvironmentAtoms,
  createPullRequestStackAtomFamily,
} from "@t3tools/client-runtime/state/pull-requests";
import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime/state/terminal";
import { createPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/preview";
import { createDeviceEnvironmentAtoms } from "@t3tools/client-runtime/state/device";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import { WS_METHODS, type DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import { createAuthEnvironmentAtoms } from "@t3tools/client-runtime/state/auth";
import { createPrimaryAuthHttp } from "./primaryAuthHttp.ts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { makeConnectionAtomRuntime } from "./connection/runtime.ts";
import { createLocalStudioHttp } from "./localStudioHttp.ts";
import { createDeviceHubAccessAtoms } from "./deviceHubAccess.ts";
import type { EnvironmentId } from "@t3tools/contracts";

type CoreAtomRuntime = ReturnType<typeof makeConnectionAtomRuntime>["runtime"];

type ServerConfigValue =
  ReturnType<ReturnType<typeof createServerEnvironmentAtoms>["configValueAtom"]> extends Atom.Atom<
    infer Value
  >
    ? Value
    : never;

export function createCoreState(runtime: CoreAtomRuntime) {
  const environmentCatalog = createEnvironmentCatalogAtoms(runtime);
  const environmentSession = createEnvironmentSessionAtoms(runtime);
  const serverEnvironment = createServerEnvironmentAtoms(runtime, {
    initialConfigValueAtom: environmentSession.initialConfigValueAtom,
    environmentThemes: true,
    usageLimitSources: true,
    usageLimitsCommand: true,
  });
  const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    serverConfigValueAtom: serverEnvironment.configValueAtom,
  });
  const environmentShell = createEnvironmentShellAtoms(runtime);
  const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
  const threadEnvironment = createThreadEnvironmentAtoms(runtime, environmentSnapshotAtom);
  const environmentThreadShells = createEnvironmentThreadShellAtoms({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    snapshotAtom: threadEnvironment.snapshotAtom,
  });
  const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
    createEnvironmentThreadStateAtoms(runtime).stateAtom,
  );
  const environmentProjects = createEnvironmentProjectAtoms({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    snapshotAtom: environmentSnapshotAtom,
  });
  const environmentPresentations = createEnvironmentPresentationAtoms({
    catalogValueAtom: environmentCatalog.catalogValueAtom,
    stateAtom: environmentCatalog.stateAtom,
    serverConfigValueAtom: serverEnvironment.configValueAtom,
  });
  const vcsEnvironment = createVcsEnvironmentAtoms(runtime);
  const vcsActionManager = createVcsActionManager(runtime);
  const sourceControlEnvironment = createSourceControlEnvironmentAtoms(runtime);
  const gitEnvironment = createGitEnvironmentAtoms(runtime);
  const pullRequestEnvironment = createPullRequestEnvironmentAtoms(runtime);
  const pullRequestStack = createPullRequestStackAtomFamily(
    runtime,
    pullRequestEnvironment.refreshes,
  );
  const linkedPullRequestSummary = createLinkedPullRequestSummaryAtomFamily(
    runtime,
    pullRequestEnvironment.refreshes,
  );
  const projectEnvironment = createProjectEnvironmentAtoms(runtime);
  const shellEnvironment = createShellEnvironmentAtoms(runtime);
  const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(runtime);
  const terminalEnvironment = createTerminalEnvironmentAtoms(runtime);
  const reviewEnvironment = createReviewEnvironmentAtoms(runtime);
  const filesystemEnvironment = createFilesystemEnvironmentAtoms(runtime);
  const previewEnvironment = createPreviewEnvironmentAtoms(runtime);
  const deviceEnvironment = createDeviceEnvironmentAtoms(runtime);
  const primaryEnvironmentIdAtom: Atom.Atom<EnvironmentId | null> = Atom.make((get) => {
    for (const [environmentId, entry] of get(environmentCatalog.catalogValueAtom).entries) {
      if (entry.target._tag === "PrimaryConnectionTarget") return environmentId;
    }
    return null;
  }).pipe(Atom.withLabel("gpui-primary-environment-id"));
  const primaryServerConfigAtom: Atom.Atom<ServerConfigValue | null> = Atom.make((get) => {
    const environmentId = get(primaryEnvironmentIdAtom);
    return environmentId === null ? null : get(serverEnvironment.configValueAtom(environmentId));
  }).pipe(Atom.withLabel("gpui-primary-server-config"));
  const localMediaEnvironmentAtom = Atom.make((get) => {
    const environmentId = get(primaryEnvironmentIdAtom);
    if (environmentId === null) return null;
    const connection = get(environmentSession.preparedConnectionValueAtom(environmentId));
    const config = get(environmentSession.initialConfigValueAtom(environmentId));
    return connection._tag === "None" || config === null
      ? null
      : { environmentId, httpBaseUrl: connection.value.httpBaseUrl };
  }).pipe(Atom.withLabel("gpui-local-media-environment"));
  const assetEnvironment = createAssetEnvironmentAtoms(runtime, localMediaEnvironmentAtom);
  const attachmentEnvironment = createAttachmentEnvironmentAtoms(runtime);
  const onboarding = {
    agentSessionScan: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:agent-sessions:scan",
      tag: WS_METHODS.agentSessionsScan,
      staleTimeMs: 30_000,
      idleTtlMs: 5 * 60_000,
    }),
    agentSessionImport: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:agent-sessions:import",
      tag: WS_METHODS.agentSessionsImport,
    }),
    connectPairing: createRuntimeCommand(runtime, {
      label: "gpui:connection:connect-pairing",
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "singleFlight",
        key: (input: { pairingUrl?: string; host?: string; pairingCode?: string }) =>
          JSON.stringify(input),
      },
      execute: (input: {
        readonly pairingUrl?: string;
        readonly host?: string;
        readonly pairingCode?: string;
      }) => ConnectionOnboarding.pipe(Effect.flatMap((service) => service.registerPairing(input))),
    }),
    connectSsh: createRuntimeCommand(runtime, {
      label: "gpui:connection:connect-ssh",
      scheduler: createAtomCommandScheduler(),
      concurrency: {
        mode: "serial",
        key: (input: { readonly target: DesktopSshEnvironmentTarget }) =>
          JSON.stringify(input.target),
      },
      execute: (input: { readonly target: DesktopSshEnvironmentTarget; readonly label?: string }) =>
        ConnectionOnboarding.pipe(Effect.flatMap((service) => service.registerSsh(input))),
    }),
  };

  return {
    environmentCatalog,
    authEnvironment: createAuthEnvironmentAtoms(runtime),
    primaryAuthHttp: createPrimaryAuthHttp(runtime),
    environmentSession,
    serverEnvironment,
    environmentServerConfigsAtom,
    environmentShell,
    environmentSnapshotAtom,
    threadEnvironment,
    environmentThreadShells,
    environmentProjects,
    environmentThreadDetails,
    environmentPresentations,
    vcsEnvironment,
    vcsActionManager,
    sourceControlEnvironment,
    gitEnvironment,
    pullRequestEnvironment,
    pullRequestStack,
    linkedPullRequestSummary,
    projectEnvironment,
    shellEnvironment,
    orchestrationEnvironment,
    terminalEnvironment,
    reviewEnvironment,
    filesystemEnvironment,
    previewEnvironment,
    deviceEnvironment,
    deviceHubAccess: createDeviceHubAccessAtoms(
      runtime,
      environmentSession.preparedConnectionValueAtom,
    ),
    primaryEnvironmentIdAtom,
    primaryServerConfigAtom,
    assetEnvironment,
    attachmentEnvironment,
    onboarding,
    localStudioHttp: createLocalStudioHttp(runtime),
  };
}

export type CoreState = ReturnType<typeof createCoreState>;
