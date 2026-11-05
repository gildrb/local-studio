import * as Path from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  AdvertisedEndpoint,
  DesktopDiscoveredSshHost,
  DesktopServerExposureMode,
  DesktopServerExposureState,
  DesktopSshEnvironmentTarget,
  DesktopSshPasswordPromptRequest,
  DesktopWslState,
} from "@t3tools/contracts";
import * as DesktopConfig from "@t3tools/desktop/src/app/DesktopConfig.ts";
import { resolveDesktopStateDir } from "@t3tools/desktop/src/app/DesktopStatePaths.ts";
import * as DesktopNetworkInterfaces from "@t3tools/desktop/src/backend/DesktopNetworkInterfaces.ts";
import * as DesktopServerExposure from "@t3tools/desktop/src/backend/DesktopServerExposure.ts";
import * as DesktopAppSettings from "@t3tools/desktop/src/settings/DesktopAppSettings.ts";
import {
  bootstrapSshBearerSession,
  fetchSshEnvironmentDescriptor,
} from "@t3tools/desktop/src/ssh/DesktopSshEnvironmentApi.ts";
import {
  makeDesktopSshEnvironmentOperations,
  makeSshPasswordPrompt,
  resolveDesktopSshCliRunner,
  sshEnvironmentManagerLayer,
  type SshPasswordPromptFailure,
} from "@t3tools/desktop/src/ssh/DesktopSshEnvironmentOperations.ts";
import * as DesktopWslEnvironment from "@t3tools/desktop/src/wsl/DesktopWslEnvironment.ts";
import { resolveDesktopWslState } from "@t3tools/desktop/src/wsl/DesktopWslState.ts";
import * as NetService from "@t3tools/shared/Net";
import type { DesktopSshGatewayBridge } from "@t3tools/web/src/connection/sshGateway.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { readAppVersion } from "./appVersion.ts";
import { createNativeUpdates, type NativeUpdates } from "./nativeUpdates.ts";

const SSH_PASSWORD_PROMPT_TIMEOUT_MS = 3 * 60 * 1000;
const PROMPT_EXPIRED_MESSAGE = "SSH password prompt expired or is no longer pending.";

export type NativeDesktopNetworkAccess = {
  readonly serverExposureState: DesktopServerExposureState;
  readonly advertisedEndpoints: ReadonlyArray<AdvertisedEndpoint>;
};

export interface NativeDesktop {
  readonly serverHttpUrl: string | null;
  readonly localEnvironmentEnabled: boolean;
  readonly sshGatewayBridge: DesktopSshGatewayBridge;
  readonly discoverSshHosts: () => Promise<ReadonlyArray<DesktopDiscoveredSshHost>>;
  readonly resolveSshHost: (alias: string) => Promise<DesktopSshEnvironmentTarget>;
  readonly getNetworkAccess: () => Promise<NativeDesktopNetworkAccess>;
  readonly setServerExposureMode: (
    mode: DesktopServerExposureMode,
  ) => Promise<DesktopServerExposureState>;
  readonly setTailscaleServeEnabled: (input: {
    readonly enabled: boolean;
    readonly port: number;
  }) => Promise<DesktopServerExposureState>;
  readonly getWslState: () => Promise<DesktopWslState>;
  readonly setWslBackendEnabled: (enabled: boolean) => Promise<DesktopWslState>;
  readonly setWslDistro: (distro: string | null) => Promise<DesktopWslState>;
  readonly setWslOnly: (enabled: boolean) => Promise<DesktopWslState>;
  readonly setLocalEnvironmentEnabled: (enabled: boolean) => Promise<void>;
  readonly sshPasswordPromptsAtom: Atom.Atom<ReadonlyArray<DesktopSshPasswordPromptRequest>>;
  readonly resolveSshPasswordPrompt: (requestId: string, password: string | null) => Promise<void>;
  readonly relaunchRevisionAtom: Atom.Atom<number>;
  readonly updates: NativeUpdates;
}

export interface NativeDesktopOptions {
  readonly t3Home: string;
  readonly serverHttpUrl: string | null;
  readonly registry: AtomRegistry.AtomRegistry;
}

function unavailable(feature: string): Error {
  return new Error(`${feature} is not available in the native app yet.`);
}

export async function createNativeDesktop(options: NativeDesktopOptions): Promise<NativeDesktop> {
  const { registry } = options;
  const appVersion = readAppVersion();
  const stateDir = resolveDesktopStateDir({
    baseDir: options.t3Home,
    isDevelopment: false,
    joinPath: Path.join,
    t3Home: Option.some(options.t3Home),
  });
  const settingsLayer = Layer.effect(
    DesktopAppSettings.DesktopAppSettings,
    DesktopAppSettings.makeAtPath({
      settingsPath: Path.join(stateDir, "desktop-settings.json"),
      defaultSettings: DesktopAppSettings.resolveDefaultDesktopSettings(appVersion),
      appVersion,
    }),
  );
  const foundationLayer = Layer.mergeAll(
    NodeServices.layer,
    NodeHttpClient.layerUndici,
    NetService.layer,
  );
  const desktopLayer = Layer.mergeAll(
    DesktopServerExposure.layer,
    sshEnvironmentManagerLayer({
      resolveCliRunner: DesktopConfig.DesktopConfig.pipe(
        Effect.map((config) =>
          resolveDesktopSshCliRunner({
            isDevelopment: true,
            devRemoteT3ServerEntryPath: config.devRemoteT3ServerEntryPath,
            appVersion,
          }),
        ),
        Effect.orDie,
      ),
    }),
  ).pipe(
    Layer.provideMerge(Layer.mergeAll(settingsLayer, DesktopNetworkInterfaces.layer)),
    Layer.provideMerge(foundationLayer),
  );
  const runtime = ManagedRuntime.make(desktopLayer);
  const run = <A, E>(
    effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>,
  ): Promise<A> => runtime.runPromise(effect);

  const getAppSettings = Effect.service(DesktopAppSettings.DesktopAppSettings);
  const getExposure = Effect.service(DesktopServerExposure.DesktopServerExposure);
  const settings = await run(Effect.flatMap(getAppSettings, (service) => service.load));
  if (options.serverHttpUrl !== null) {
    const port = Number(new URL(options.serverHttpUrl).port);
    await run(Effect.flatMap(getExposure, (service) => service.configureFromSettings({ port })));
  }

  const relaunchRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);
  const requestRelaunch = () =>
    registry.set(relaunchRevisionAtom, registry.get(relaunchRevisionAtom) + 1);

  const updates = createNativeUpdates({
    registry,
    appVersion,
    t3Home: options.t3Home,
    initialChannel: settings.updateChannel,
    persistChannel: async (channel) => {
      await run(Effect.flatMap(getAppSettings, (service) => service.setUpdateChannel(channel)));
    },
  });

  const sshPasswordPromptsAtom = Atom.make<ReadonlyArray<DesktopSshPasswordPromptRequest>>([]).pipe(
    Atom.keepAlive,
  );
  const pendingPrompts = new Map<
    string,
    {
      readonly resolve: (password: string) => void;
      readonly reject: (failure: SshPasswordPromptFailure) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  const removePrompt = (requestId: string) => {
    const pending = pendingPrompts.get(requestId);
    if (pending !== undefined) clearTimeout(pending.timer);
    pendingPrompts.delete(requestId);
    registry.set(
      sshPasswordPromptsAtom,
      registry.get(sshPasswordPromptsAtom).filter((request) => request.requestId !== requestId),
    );
  };
  let promptCount = 0;
  const askPassword = (request: {
    readonly destination: string;
    readonly username: string | null;
    readonly prompt: string;
  }): Promise<string> => {
    promptCount += 1;
    const requestId = `ssh-password-${promptCount}`;
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const timer = setTimeout(() => {
      removePrompt(requestId);
      reject({ message: "SSH password prompt timed out.", cancelled: false });
    }, SSH_PASSWORD_PROMPT_TIMEOUT_MS);
    pendingPrompts.set(requestId, { resolve, reject, timer });
    registry.set(sshPasswordPromptsAtom, [
      ...registry.get(sshPasswordPromptsAtom),
      {
        requestId,
        destination: request.destination,
        username: request.username,
        prompt: request.prompt,
        expiresAt: new Date(Date.now() + SSH_PASSWORD_PROMPT_TIMEOUT_MS).toISOString(),
      },
    ]);
    return promise;
  };
  const passwordPrompt = makeSshPasswordPrompt((request) =>
    Effect.tryPromise({
      try: () => askPassword(request),
      catch: (cause): SshPasswordPromptFailure =>
        typeof cause === "object" &&
        cause !== null &&
        "cancelled" in cause &&
        "message" in cause &&
        typeof cause.message === "string"
          ? { message: cause.message, cancelled: cause.cancelled === true }
          : { message: String(cause), cancelled: false },
    }),
  );
  const sshOperations = await run(makeDesktopSshEnvironmentOperations(passwordPrompt));

  const readWslState = () =>
    run(
      Effect.gen(function* () {
        const appSettings = yield* getAppSettings;
        const wslEnvironment = yield* DesktopWslEnvironment.makeForPlatform(process.platform);
        return yield* resolveDesktopWslState({
          settings: yield* appSettings.get,
          wslEnvironment,
          preflightError: Effect.succeedNone,
        });
      }),
    );

  return {
    localEnvironmentEnabled: settings.localEnvironmentEnabled,
    serverHttpUrl: options.serverHttpUrl,
    sshGatewayBridge: {
      ensureSshEnvironment: (target, ensureOptions) =>
        run(sshOperations.ensureEnvironment(target, ensureOptions)),
      fetchSshEnvironmentDescriptor: (httpBaseUrl) =>
        run(fetchSshEnvironmentDescriptor(httpBaseUrl)),
      bootstrapSshBearerSession: (httpBaseUrl, credential) =>
        run(bootstrapSshBearerSession({ httpBaseUrl, credential })),
      disconnectSshEnvironment: (target) => run(sshOperations.disconnectEnvironment(target)),
    },
    discoverSshHosts: () => run(sshOperations.discoverHosts({})),
    resolveSshHost: (alias) => run(sshOperations.resolveHost(alias)),
    getNetworkAccess: () =>
      run(
        Effect.gen(function* () {
          const exposure = yield* getExposure;
          return {
            serverExposureState: yield* exposure.getState,
            advertisedEndpoints: yield* exposure.getAdvertisedEndpoints,
          };
        }),
      ),
    setServerExposureMode: async (mode) => {
      const change = await run(Effect.flatMap(getExposure, (exposure) => exposure.setMode(mode)));
      if (change.requiresRelaunch) requestRelaunch();
      return change.state;
    },
    setTailscaleServeEnabled: async (input) => {
      const change = await run(
        Effect.flatMap(getExposure, (exposure) => exposure.setTailscaleServeEnabled(input)),
      );
      if (change.requiresRelaunch) requestRelaunch();
      return change.state;
    },
    getWslState: readWslState,
    setWslBackendEnabled: async (enabled) => {
      if (enabled) throw unavailable("Running the WSL backend");
      await run(Effect.flatMap(getAppSettings, (service) => service.setWslBackendEnabled(false)));
      return readWslState();
    },
    setWslDistro: async () => {
      throw unavailable("Choosing a WSL distro");
    },
    setWslOnly: async (enabled) => {
      if (enabled) throw unavailable("Running only the WSL backend");
      const change = await run(
        Effect.flatMap(getAppSettings, (service) => service.setWslOnly(false)),
      );
      if (change.changed) requestRelaunch();
      return readWslState();
    },
    setLocalEnvironmentEnabled: async (enabled) => {
      const change = await run(
        Effect.flatMap(getAppSettings, (service) => service.setLocalEnvironmentEnabled(enabled)),
      );
      if (change.changed) requestRelaunch();
    },
    sshPasswordPromptsAtom,
    resolveSshPasswordPrompt: async (requestId, password) => {
      const pending = pendingPrompts.get(requestId);
      if (pending === undefined) throw new Error(PROMPT_EXPIRED_MESSAGE);
      removePrompt(requestId);
      if (password === null) {
        pending.reject({ message: "SSH password prompt was cancelled.", cancelled: true });
        return;
      }
      pending.resolve(password);
    },
    relaunchRevisionAtom,
    updates,
  };
}
