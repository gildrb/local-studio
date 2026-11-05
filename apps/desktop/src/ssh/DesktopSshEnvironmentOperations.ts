import type {
  DesktopDiscoveredSshHost,
  DesktopSshEnvironmentBootstrap,
  DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as SshAuth from "@t3tools/ssh/auth";
import { resolveSshTarget } from "@t3tools/ssh/command";
import { discoverSshHosts } from "@t3tools/ssh/config";
import {
  SshCommandError,
  SshHostDiscoveryError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPairingError,
  SshPasswordPromptError,
  SshReadinessError,
} from "@t3tools/ssh/errors";
import * as SshTunnel from "@t3tools/ssh/tunnel";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import serverPackageJson from "../../../server/package.json" with { type: "json" };

export type DesktopSshEnvironmentRuntimeServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService.NetService;

export type DesktopSshEnvironmentOperationError =
  | SshCommandError
  | SshInvalidTargetError
  | SshLaunchError
  | SshPairingError
  | SshReadinessError
  | SshPasswordPromptError
  | NetService.NetError;

export type DesktopSshEnvironmentDiscoverError = SshHostDiscoveryError;

export interface DesktopSshEnvironmentOperations {
  readonly discoverHosts: (input?: {
    readonly homeDir?: string;
  }) => Effect.Effect<readonly DesktopDiscoveredSshHost[], DesktopSshEnvironmentDiscoverError>;
  readonly resolveHost: (
    alias: string,
  ) => Effect.Effect<DesktopSshEnvironmentTarget, SshCommandError | SshInvalidTargetError>;
  readonly ensureEnvironment: (
    target: DesktopSshEnvironmentTarget,
    options?: { readonly issuePairingToken?: boolean },
  ) => Effect.Effect<DesktopSshEnvironmentBootstrap, DesktopSshEnvironmentOperationError>;
  readonly disconnectEnvironment: (
    target: DesktopSshEnvironmentTarget,
  ) => Effect.Effect<void, DesktopSshEnvironmentOperationError>;
}

export interface DesktopSshEnvironmentLayerOptions {
  readonly resolveCliRunner?: Effect.Effect<SshTunnel.RemoteT3RunnerOptions>;
}

// The remote runs the exact release this app is on, from its self-contained
// archive, so it needs neither Node nor npm. Development points the remote at
// a source checkout instead so the two sides can be iterated together.
export function resolveDesktopSshCliRunner(input: {
  readonly isDevelopment: boolean;
  readonly devRemoteT3ServerEntryPath: Option.Option<string>;
  readonly appVersion: string;
}): SshTunnel.RemoteT3RunnerOptions {
  const devRemoteEntryPath = Option.getOrUndefined(input.devRemoteT3ServerEntryPath);
  if (input.isDevelopment && devRemoteEntryPath !== undefined) {
    return {
      nodeScriptPath: devRemoteEntryPath,
      nodeEngineRange: serverPackageJson.engines.node,
    };
  }
  return { archiveVersion: input.appVersion };
}

export const sshEnvironmentManagerLayer = (options: DesktopSshEnvironmentLayerOptions = {}) =>
  SshTunnel.SshEnvironmentManager.layer(
    options.resolveCliRunner === undefined ? {} : { resolveCliRunner: options.resolveCliRunner },
  );

export type SshPasswordPromptFailure = {
  readonly message: string;
  readonly cancelled: boolean;
};

export const makeSshPasswordPrompt = (
  request: (request: SshAuth.SshPasswordRequest) => Effect.Effect<string, SshPasswordPromptFailure>,
): SshAuth.SshPasswordPromptShape => ({
  isAvailable: true,
  request: (input) =>
    request(input).pipe(
      Effect.mapError((cause) => new SshPasswordPromptError({ message: cause.message, cause })),
    ),
});

export function isSshPasswordPromptFailureCancellation(error: unknown): boolean {
  if (!(error instanceof SshPasswordPromptError)) return false;
  const cause: unknown = error.cause;
  return (
    typeof cause === "object" && cause !== null && "cancelled" in cause && cause.cancelled === true
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const makeDesktopSshEnvironmentOperations = Effect.fnUntraced(function* (
  passwordPrompt: SshAuth.SshPasswordPromptShape,
) {
  const manager = yield* SshTunnel.SshEnvironmentManager;
  const runtimeContext = yield* Effect.context<DesktopSshEnvironmentRuntimeServices>();
  const prompt = SshAuth.SshPasswordPrompt.of(passwordPrompt);

  return {
    discoverHosts: (input) =>
      discoverSshHosts(input ?? {}).pipe(
        Effect.provide(runtimeContext),
        Effect.withSpan("desktop.ssh.discoverHosts"),
      ),
    resolveHost: (alias) =>
      resolveSshTarget(alias.trim()).pipe(
        Effect.provide(runtimeContext),
        Effect.withSpan("desktop.ssh.resolveHost"),
      ),
    ensureEnvironment: (target, ensureOptions) =>
      manager
        .ensureEnvironment(target, ensureOptions)
        .pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, prompt),
          Effect.provide(runtimeContext),
          Effect.withSpan("desktop.ssh.ensureEnvironment"),
        ),
    disconnectEnvironment: (target) =>
      manager
        .disconnectEnvironment(target)
        .pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, prompt),
          Effect.provide(runtimeContext),
          Effect.withSpan("desktop.ssh.disconnectEnvironment"),
        ),
  } satisfies DesktopSshEnvironmentOperations;
});
