import {
  type EukheSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { ChildProcess } from "effect/unstable/process";
import { EukheError, MINIMUM_EUKHE_VERSION, findEukhe } from "eukhe";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { spawnAndCollect, type CommandResult } from "../providerSnapshot.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const DRIVER_KIND = ProviderDriverKind.make("eukhe");

export const EUKHE_DRIVER_KIND = DRIVER_KIND;
export const EUKHE_AUTH_METHOD_ID = "eukhe-login";
export const EUKHE_MODEL_CONFIG_ID = "model";
export const EUKHE_THOUGHT_LEVEL_CONFIG_ID = "thought_level";
export const EUKHE_RUN_REPORT_METHOD = "_eukhe/run_report";
export const REASONING_OPTION_ID = "reasoningEffort";
const VERSION_PROBE_TIMEOUT_MS = 10_000;
export const EMPTY_EUKHE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export type ResolvedEukheBinary =
  | { readonly _tag: "Resolved"; readonly bin: string; readonly version: string | null }
  | { readonly _tag: "NotInstalled"; readonly detail: string }
  | { readonly _tag: "TooOld"; readonly found: string; readonly detail: string };

const EukheResumeCursor = Schema.Struct({ sessionId: Schema.String });
export const EukheLoginErrorData = Schema.Struct({
  login: Schema.Struct({
    command: Schema.String,
    slashCommand: Schema.NullOr(Schema.String),
    instructions: Schema.String,
  }),
});
const releaseParts = (version: string): ReadonlyArray<number> | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};

const releaseIsOlder = (release: ReadonlyArray<number>, minimum: string): boolean => {
  const floor = releaseParts(minimum) ?? [];
  for (const [index, part] of release.entries()) {
    const other = floor[index] ?? 0;
    if (part !== other) return part < other;
  }
  return false;
};

const lookupEukheBinary = (
  settings: Pick<EukheSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<string, { readonly _tag: "NotInstalled"; readonly detail: string }> => {
  const configured = settings.binaryPath.trim();
  const explicit = configured.length > 0 && /[/\\]/.test(configured) ? configured : undefined;
  return Effect.tryPromise({
    try: () => findEukhe(explicit, environment),
    catch: (cause): { readonly _tag: "NotInstalled"; readonly detail: string } => {
      if (cause instanceof EukheError && cause.$ === "NotInstalled") {
        return {
          _tag: "NotInstalled",
          detail: `Eukhe CLI is not installed (looked at ${cause.searched.join(", ")}). Install it with: ${cause.installCommand}`,
        };
      }
      return {
        _tag: "NotInstalled",
        detail: cause instanceof Error ? cause.message : "Eukhe CLI is not installed.",
      };
    },
  });
};

const versionOutput = (
  bin: string,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<CommandResult | undefined, never, ChildProcessSpawner.ChildProcessSpawner> =>
  resolveSpawnCommand(bin, ["--version"], { env: environment }).pipe(
    Effect.flatMap((spawnCommand) =>
      spawnAndCollect(
        bin,
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: environment,
          shell: spawnCommand.shell,
        }),
      ),
    ),
    Effect.timeout(VERSION_PROBE_TIMEOUT_MS),
    Effect.orElseSucceed(() => undefined),
  );

export const resolveEukheBinary = Effect.fn("resolveEukheBinary")(function* (
  settings: Pick<EukheSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ResolvedEukheBinary, never, ChildProcessSpawner.ChildProcessSpawner> {
  const looked = yield* Effect.result(lookupEukheBinary(settings, environment));
  if (Result.isFailure(looked)) {
    return looked.failure;
  }
  const bin = looked.success;
  const result = yield* versionOutput(bin, environment);
  if (result === undefined || result.code !== 0) {
    return { _tag: "Resolved", bin, version: null };
  }
  const match = /\b(\d+\.\d+\.\d+)\b/.exec(`${result.stdout}\n${result.stderr}`);
  const version = match?.[1] ?? null;
  const parts = version !== null ? releaseParts(version) : undefined;
  if (version !== null && parts !== undefined && releaseIsOlder(parts, MINIMUM_EUKHE_VERSION)) {
    return {
      _tag: "TooOld",
      found: version,
      detail: `Eukhe ${version} is older than ${MINIMUM_EUKHE_VERSION}, the first release with \`eukhe acp\`. Update it with: ${bin} update`,
    };
  }
  const resolved: Extract<ResolvedEukheBinary, { readonly _tag: "Resolved" }> = {
    _tag: "Resolved",
    bin,
    version,
  };
  return resolved;
});

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const parseModelValue = (
  value: string,
): { readonly provider: string; readonly id: string } | undefined => {
  const parsed = parseJsonText(value);
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [provider, id] = parsed;
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : undefined;
};

const selectOptionEntries = (
  option: EffectAcpSchema.SessionConfigOption,
): ReadonlyArray<{ readonly value: string; readonly name: string }> =>
  option.type !== "select"
    ? []
    : option.options.flatMap((entry) =>
        "value" in entry ? [{ value: entry.value, name: entry.name }] : [],
      );

const findConfigOption = (
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  id: string,
): EffectAcpSchema.SessionConfigOption | undefined =>
  configOptions.find((option) => option.id.trim() === id);

const stringValueOption = (
  option: EffectAcpSchema.SessionConfigOption | undefined,
): string | undefined => {
  const value = option?.currentValue;
  return typeof value === "string" ? value : undefined;
};

export interface EukheSessionCatalog {
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly reasoningDescriptor:
    | {
        readonly id: string;
        readonly label: string;
        readonly currentValue: string | undefined;
        readonly values: ReadonlyArray<string>;
      }
    | undefined;
}

export const eukheSessionCatalogFromConfigOptions = (
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EukheSessionCatalog => {
  const modelOption = findConfigOption(configOptions, EUKHE_MODEL_CONFIG_ID);
  const thoughtOption = findConfigOption(configOptions, EUKHE_THOUGHT_LEVEL_CONFIG_ID);
  const modelValue = stringValueOption(modelOption);
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  for (const entry of modelOption ? selectOptionEntries(modelOption) : []) {
    const pair = parseModelValue(entry.value);
    if (!pair) continue;
    const slug = `${pair.provider}/${pair.id}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    models.push({
      slug,
      name: entry.name.trim() || slug,
      isCustom: false,
      ...(modelValue !== undefined && entry.value === modelValue ? { isDefault: true } : {}),
      capabilities: EMPTY_EUKHE_MODEL_CAPABILITIES,
    });
  }
  const thoughtEntries = thoughtOption ? selectOptionEntries(thoughtOption) : [];
  const thoughtValue = stringValueOption(thoughtOption);
  return {
    models,
    reasoningDescriptor:
      thoughtEntries.length > 0
        ? {
            id: REASONING_OPTION_ID,
            label: thoughtOption?.name.trim() || "Reasoning",
            currentValue: thoughtValue,
            values: thoughtEntries.map((entry) => entry.value),
          }
        : undefined,
  };
};

export const eukheCapabilitiesFromCatalog = (catalog: EukheSessionCatalog): ModelCapabilities =>
  catalog.reasoningDescriptor
    ? createModelCapabilities({
        optionDescriptors: [
          {
            id: catalog.reasoningDescriptor.id,
            label: catalog.reasoningDescriptor.label,
            type: "select",
            options: catalog.reasoningDescriptor.values.map((value) => ({
              id: value,
              label: value,
              ...(value === catalog.reasoningDescriptor?.currentValue ? { isDefault: true } : {}),
            })),
            ...(catalog.reasoningDescriptor.currentValue
              ? { currentValue: catalog.reasoningDescriptor.currentValue }
              : {}),
          },
        ],
      })
    : EMPTY_EUKHE_MODEL_CAPABILITIES;

export const eukheModelValueForSlug = (
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  slug: string,
): string | undefined => {
  const option = findConfigOption(configOptions, EUKHE_MODEL_CONFIG_ID);
  if (!option) return undefined;
  for (const entry of selectOptionEntries(option)) {
    const pair = parseModelValue(entry.value);
    if (pair && `${pair.provider}/${pair.id}` === slug) return entry.value;
  }
  return undefined;
};

export const currentEukheModelSlug = (
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): string | undefined => {
  const pair = parseModelValue(
    stringValueOption(findConfigOption(configOptions, EUKHE_MODEL_CONFIG_ID)) ?? "",
  );
  return pair ? `${pair.provider}/${pair.id}` : undefined;
};

export interface EukheLoginData {
  readonly command: string;
  readonly slashCommand: string | null;
  readonly instructions: string;
}

export const parseEukheLoginData = (data: unknown): EukheLoginData | undefined => {
  const decoded = Schema.decodeUnknownOption(EukheLoginErrorData)(data);
  return Option.isNone(decoded) ? undefined : decoded.value.login;
};

export const eukheResumeFromCursor = (raw: unknown): string | undefined => {
  const decoded = Schema.decodeUnknownOption(EukheResumeCursor)(raw);
  if (Option.isNone(decoded)) return undefined;
  const sessionId = decoded.value.sessionId.trim();
  return sessionId.length > 0 ? sessionId : undefined;
};

export interface EukheAcpRuntimeInput {
  readonly bin: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly clientInfo: { readonly name: string; readonly version: string };
  readonly extraArgs?: ReadonlyArray<string>;
  readonly resumeSessionId?: string;
}

export const makeEukheAcpRuntime = (
  input: EukheAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AcpSessionRuntime.layer({
        cwd: input.cwd,
        spawn: {
          command: input.bin,
          args: ["acp", ...(input.extraArgs ?? [])],
          cwd: input.cwd,
          env: input.environment,
        },
        authMethodId: EUKHE_AUTH_METHOD_ID,
        clientInfo: input.clientInfo,
        ...(input.resumeSessionId
          ? { resumeSessionId: input.resumeSessionId, resumeMethod: "resume" as const }
          : {}),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
  });
