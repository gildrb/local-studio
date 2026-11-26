import {
  EukheSettings,
  type ProviderAuthInteraction,
  type ProviderAuthMethod,
  type ProviderAuthResponse,
  ProviderSetupError,
  type ProviderInstanceId,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as BackgroundPolicyModule from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeEukheTextGeneration } from "../../textGeneration/EukheTextGeneration.ts";
import {
  type EukheSessionCatalog,
  EUKHE_AUTH_METHOD_ID,
  EUKHE_DRIVER_KIND,
  EMPTY_EUKHE_MODEL_CAPABILITIES,
  eukheCapabilitiesFromCatalog,
  eukheSessionCatalogFromConfigOptions,
  makeEukheAcpRuntime,
  parseEukheLoginData,
  resolveEukheBinary,
  type EukheLoginData,
} from "../acp/EukheAcpSupport.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeEukheAcpAdapter } from "../Layers/EukheAcpAdapter.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import * as ProviderAuthFlow from "../ProviderAuthFlow.ts";
import type * as ProviderAuthService from "../Services/ProviderAuthService.ts";
import {
  AUTH_PROBE_TIMEOUT_MS,
  COMPACT_SLASH_COMMAND,
  buildServerProvider,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";

export type EukheAcpDriverEnv =
  | BackgroundPolicyModule.BackgroundPolicy
  | Crypto.Crypto
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig
  | ServerSettingsService;

const DRIVER = EUKHE_DRIVER_KIND;
const EUKHE_PRESENTATION = {
  displayName: "Eukhe",
  supportsConversationRollback: true,
  showInteractionModeToggle: false,
  reportsContextWindow: true,
} as const;
const EUKHE_LOGIN_METHOD: ProviderAuthMethod = {
  id: EUKHE_AUTH_METHOD_ID,
  name: "Log in to a model provider",
  description:
    "Runs `eukhe login <provider>`. Type the provider name (for example openai-codex) and follow the sign-in steps.",
  type: "terminal",
};
const LOGIN_OUTPUT_LIMIT = 12_000;
const EMPTY_CATALOG: EukheSessionCatalog = {
  models: [],
  reasoningDescriptor: undefined,
};
const EukheLoginListing = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      loggedIn: Schema.Boolean,
    }),
  ),
});

interface EukheProbeOutcome {
  readonly catalog: EukheSessionCatalog;
  readonly login: EukheLoginData | undefined;
  readonly failed: boolean;
}

const eukheModelsFromSettings = (
  settings: EukheSettings,
  discovered: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> =>
  providerModelsFromSettings(discovered, settings.customModels, EMPTY_EUKHE_MODEL_CAPABILITIES);

const draft = (
  settings: EukheSettings,
  checkedAt: string,
  probe: {
    installed: boolean;
    version: string | null;
    status: "ready" | "warning" | "error";
    auth: ServerProviderAuth;
    message?: string;
  },
  models: ReadonlyArray<ServerProviderModel>,
): ServerProviderDraft =>
  buildServerProvider({
    presentation: EUKHE_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: eukheModelsFromSettings(settings, models),
    slashCommands: [COMPACT_SLASH_COMMAND],
    probe,
  });

export const buildInitialEukheProviderSnapshot = (settings: EukheSettings) =>
  Effect.map(DateTime.now, (now) =>
    draft(
      settings,
      DateTime.formatIso(now),
      settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking the Eukhe CLI...",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Eukhe is disabled in T3 Code settings.",
          },
      [],
    ),
  );

const isEukheAuthRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

const probeEukheCatalog = (
  bin: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Effect.Effect<
  EukheProbeOutcome,
  never,
  Crypto.Crypto | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const started = yield* makeEukheAcpRuntime({
      bin,
      cwd,
      environment,
      childProcessSpawner: spawner,
      clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
      extraArgs: ["--no-session"],
    }).pipe(
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.flatMap((runtime) => runtime.start()),
      Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS),
      Effect.result,
    );
    if (Result.isFailure(started)) {
      const error = started.failure;
      return isEukheAuthRequestError(error) && error.code === -32000
        ? { catalog: EMPTY_CATALOG, login: parseEukheLoginData(error.data), failed: false }
        : { catalog: EMPTY_CATALOG, login: undefined, failed: true };
    }
    if (Option.isNone(started.success)) {
      return { catalog: EMPTY_CATALOG, login: undefined, failed: true };
    }
    return {
      catalog: eukheSessionCatalogFromConfigOptions(
        started.success.value.sessionSetupResult.configOptions ?? [],
      ),
      login: undefined,
      failed: false,
    };
  }).pipe(Effect.scoped);

export const checkEukheProviderStatus = Effect.fn("checkEukheProviderStatus")(function* (
  settings: EukheSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return draft(
      settings,
      checkedAt,
      {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Eukhe is disabled in T3 Code settings.",
      },
      [],
    );
  }
  const binary = yield* resolveEukheBinary(settings, environment);
  if (binary._tag === "NotInstalled") {
    return draft(
      settings,
      checkedAt,
      {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: binary.detail,
      },
      [],
    );
  }
  if (binary._tag === "TooOld") {
    return draft(
      settings,
      checkedAt,
      {
        installed: true,
        version: binary.found,
        status: "error",
        auth: { status: "unknown" },
        message: binary.detail,
      },
      [],
    );
  }
  const version = binary.version;
  const probe = yield* Effect.result(probeEukheCatalog(binary.bin, environment, cwd));
  if (Result.isFailure(probe)) {
    yield* Effect.logWarning("Eukhe provider probe crashed.", {
      errorTag: causeErrorTag(probe.failure),
    });
  }
  const result = Result.isSuccess(probe) ? probe.success : undefined;
  if (result === undefined) {
    return draft(
      settings,
      checkedAt,
      {
        installed: true,
        version,
        status: "warning",
        auth: { status: "unknown" },
        message: "Eukhe is installed, but the model probe failed. Custom models still work.",
      },
      [],
    );
  }
  if (result.login) {
    return draft(
      settings,
      checkedAt,
      {
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: `Eukhe has no model provider login. Run \`${result.login.command}\`. ${result.login.instructions}`,
      },
      result.catalog.models,
    );
  }
  if (result.failed) {
    return draft(
      settings,
      checkedAt,
      {
        installed: true,
        version,
        status: "warning",
        auth: { status: "unknown" },
        message: "Eukhe is installed, but the model probe failed. Custom models still work.",
      },
      [],
    );
  }
  if (result.catalog.models.length === 0) {
    return draft(
      settings,
      checkedAt,
      {
        installed: true,
        version,
        status: "warning",
        auth: { status: "authenticated", type: "cached_token", label: "Eukhe" },
        message: "Eukhe is signed in but offered no models. Custom models still work.",
      },
      [],
    );
  }
  return draft(
    settings,
    checkedAt,
    {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", type: "cached_token", label: "Eukhe" },
    },
    result.catalog.models.map((model) => ({
      ...model,
      capabilities: eukheCapabilitiesFromCatalog(result.catalog),
    })),
  );
});

const isProviderSetupError = Schema.is(ProviderSetupError);
const noLoggedInProviders: ReadonlyArray<string> = [];

const providerFromResponse = (data: string): string | undefined => {
  const line = data
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (line === undefined) return undefined;
  const stripped = /^eukhe\s+login\s+/i.test(line) ? line.replace(/^eukhe\s+login\s+/i, "") : line;
  const provider = stripped.trim().split(/\s+/)[0];
  return provider !== undefined && /^[a-z0-9][a-z0-9._-]*$/i.test(provider)
    ? provider.toLowerCase()
    : undefined;
};

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const makeEukheAuth = Effect.fn("makeEukheAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly settings: EukheSettings;
  readonly environment: NodeJS.ProcessEnv;
}): Effect.fn.Return<
  ProviderAuthService.ProviderAuthController,
  never,
  Crypto.Crypto | Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = options.settings.binaryPath || "eukhe";
  const setupError = (operation: string, detail: string, cause?: unknown) =>
    new ProviderSetupError({
      instanceId: options.instanceId,
      operation,
      detail,
      ...(cause !== undefined ? { cause } : {}),
    });

  const runCli = (args: ReadonlyArray<string>, stdin?: string) =>
    Effect.gen(function* () {
      const spawnCommand = yield* resolveSpawnCommand(command, args, { env: options.environment });
      return yield* spawnAndCollect(
        command,
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: options.environment,
          shell: spawnCommand.shell,
          ...(stdin !== undefined ? { stdin: Stream.encodeText(Stream.make(`${stdin}\n`)) } : {}),
        }),
      );
    });

  const loggedInProviders = Effect.gen(function* () {
    const listing: CommandResult = yield* runCli(["login", "--json"]);
    const decoded = Schema.decodeUnknownOption(EukheLoginListing)(parseJsonText(listing.stdout));
    if (Option.isNone(decoded)) return noLoggedInProviders;
    return decoded.value.providers
      .filter((provider) => provider.loggedIn)
      .map((provider) => provider.provider);
  }).pipe(Effect.orElseSucceed(() => noLoggedInProviders));

  const logout = Effect.gen(function* () {
    const providers = yield* loggedInProviders;
    if (providers.length === 0) {
      return "No model provider is logged in to Eukhe.";
    }
    const outcomes = yield* Effect.forEach(
      providers,
      (provider) =>
        runCli(["logout", provider]).pipe(
          Effect.map((result) => (result.code === 0 ? undefined : provider)),
          Effect.orElseSucceed(() => provider),
        ),
      { discard: false },
    );
    const remaining = outcomes.filter((outcome) => outcome !== undefined);
    return remaining.length === 0
      ? undefined
      : `Eukhe sign-out failed for: ${remaining.join(", ")}. Run \`eukhe logout <provider>\` to finish it.`;
  }).pipe(
    Effect.mapError((cause) => setupError("logout", "Eukhe sign-out failed.", cause)),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );

  const authenticate = (methodId: string, context: ProviderAuthFlow.ProviderAuthFlowContext) =>
    Effect.gen(function* () {
      if (methodId !== EUKHE_AUTH_METHOD_ID) {
        return yield* setupError("start", "Eukhe does not advertise this sign-in method.");
      }
      let output = "";
      let stdinWriter: ((line: string) => Effect.Effect<void>) | undefined;
      const trimmedOutput = () =>
        output.length > LOGIN_OUTPUT_LIMIT ? output.slice(-LOGIN_OUTPUT_LIMIT) : output;
      const publish = () =>
        context.setInteraction({
          type: "terminal",
          id: EUKHE_AUTH_METHOD_ID,
          output: trimmedOutput(),
        } satisfies ProviderAuthInteraction);
      const providerPicked = yield* Deferred.make<string, ProviderSetupError>();
      const respond = (response: ProviderAuthResponse) => {
        if (response.type !== "terminal") {
          return Effect.void;
        }
        const writer = stdinWriter;
        if (writer !== undefined) {
          return writer(`${response.data}\n`);
        }
        const provider = providerFromResponse(response.data);
        if (!provider) {
          return Effect.asVoid(
            context.setInteraction({
              type: "terminal",
              id: EUKHE_AUTH_METHOD_ID,
              output:
                "That does not name a provider. Type a provider name, for example openai-codex.",
            } satisfies ProviderAuthInteraction),
          );
        }
        return Deferred.succeed(providerPicked, provider);
      };
      yield* context.setInteraction(
        {
          type: "terminal",
          id: EUKHE_AUTH_METHOD_ID,
          output:
            "Type the model provider to log into (for example openai-codex) and press Enter. `eukhe login` lists the providers.",
        } satisfies ProviderAuthInteraction,
        respond,
      );
      const provider = yield* Deferred.await(providerPicked);
      output = `${output}\nRunning \`eukhe login ${provider}\`.\n`;
      const spawnCommand = yield* resolveSpawnCommand(command, ["login", provider], {
        env: options.environment,
      }).pipe(
        Effect.mapError((cause) => setupError("start", "Failed to resolve the Eukhe CLI.", cause)),
      );
      const child = yield* spawner
        .spawn(
          ChildProcess.make(spawnCommand.command, spawnCommand.args, {
            env: options.environment,
            shell: spawnCommand.shell,
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            setupError("start", `Failed to run \`eukhe login ${provider}\`.`, cause),
          ),
        );
      stdinWriter = (line) =>
        Stream.run(Stream.encodeText(Stream.make(line)), child.stdin).pipe(Effect.ignore);
      const authScope = yield* Effect.scope;
      const forward = (stream: ChildProcessSpawner.ChildProcessHandle["stdout"]) =>
        Stream.runForEach(Stream.decodeText(stream), (chunk: string) =>
          Effect.gen(function* () {
            output += chunk;
            yield* publish();
          }),
        ).pipe(Effect.forkIn(authScope), Effect.ignore);
      yield* forward(child.stderr);
      yield* forward(child.stdout);
      const exitOption = yield* child.exitCode.pipe(Effect.option);
      const exitCode = Option.getOrElse(exitOption, () => -1);
      stdinWriter = undefined;
      if (exitCode !== 0) {
        return yield* setupError(
          "start",
          `\`eukhe login ${provider}\` exited with code ${exitCode}. Check the output above and try again.`,
        );
      }
      yield* context.verifying;
      const loggedIn = yield* loggedInProviders.pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (!loggedIn.includes(provider)) {
        return yield* setupError(
          "start",
          `\`eukhe login ${provider}\` finished, but Eukhe still reports the provider as signed out.`,
        );
      }
    }).pipe(Effect.scoped);

  return yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: DRIVER },
    methods: Effect.succeed([EUKHE_LOGIN_METHOD]),
    logout,
    authenticate,
  });
});

export const EukheDriver: ProviderDriver<EukheSettings, EukheAcpDriverEnv> = {
  driverKind: DRIVER,
  metadata: { displayName: "Eukhe", supportsMultipleInstances: true },
  configSchema: EukheSettings,
  defaultConfig: () => Schema.decodeSync(EukheSettings)({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const settings = { ...config, enabled } satisfies EukheSettings;
      const snapshotSettings = makeProviderSnapshotSettingsSource(
        settings,
        yield* ServerSettingsService,
      );
      const auth = yield* makeEukheAuth({ instanceId, settings, environment: processEnv });
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<EukheSettings>>({
        resolveMaintenance: () =>
          Effect.succeed(
            makeManualOnlyProviderMaintenanceCapabilities({
              provider: DRIVER,
              packageName: "eukhe",
            }),
          ),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (current) =>
          buildInitialEukheProviderSnapshot(current.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkEukheProviderStatus(
          settings,
          processEnv,
          (yield* ServerConfig).cwd,
        ).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(Crypto.Crypto, crypto),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail: `Failed to build the Eukhe snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );
      return {
        instanceId,
        driverKind: DRIVER,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter: yield* makeEukheAcpAdapter(settings, {
          environment: processEnv,
          instanceId,
        }),
        textGeneration: yield* makeEukheTextGeneration(settings, processEnv),
        auth,
      } satisfies ProviderInstance;
    }),
};
