import {
  ApprovalRequestId,
  EventId,
  PI_DEFAULT_MODEL,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
  type EukheSettings,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import type { AcpSessionRuntime } from "../acp/AcpSessionRuntime.ts";
import {
  EUKHE_DRIVER_KIND,
  EUKHE_MODEL_CONFIG_ID,
  EUKHE_RUN_REPORT_METHOD,
  EUKHE_THOUGHT_LEVEL_CONFIG_ID,
  REASONING_OPTION_ID,
  currentEukheModelSlug,
  eukheModelValueForSlug,
  eukheResumeFromCursor,
  eukheSessionCatalogFromConfigOptions,
  makeEukheAcpRuntime,
  resolveEukheBinary,
} from "../acp/EukheAcpSupport.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

const PROVIDER = EUKHE_DRIVER_KIND;
const RESUME_SCHEMA_VERSION = 1;

const EukheRunReport = Schema.Struct({
  stopReason: Schema.NullOr(Schema.String),
  error: Schema.optional(Schema.String),
  answer: Schema.NullOr(Schema.String),
});
const EukheUsageUpdate = Schema.Struct({
  used: Schema.Number,
  size: Schema.Number,
  cost: Schema.optional(Schema.Struct({ amount: Schema.Number, currency: Schema.String })),
});
const EukheTitleUpdate = Schema.Struct({
  title: Schema.NullOr(Schema.String),
});

const parseRunReport = (params: unknown) => {
  const decoded = Schema.decodeUnknownOption(EukheRunReport)(params);
  return Option.isNone(decoded) ? undefined : decoded.value;
};

interface TranscriptTurn {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

interface EukheSessionContext {
  readonly threadId: ThreadId;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime["Service"];
  readonly acpSessionId: string;
  readonly pendingApprovals: Map<ApprovalRequestId, Deferred.Deferred<ProviderApprovalDecision>>;
  readonly turns: Array<TranscriptTurn>;
  session: ProviderSession;
  activeTurnId?: TurnId | undefined;
  interrupted: boolean;
  stopping: boolean;
  terminated: boolean;
  model?: string | undefined;
  effort?: string | undefined;
  runReport: unknown;
  answerText: string;
  lastCostAmount?: number | undefined;
}

const permissionKindDecision = (kind: string | undefined): ProviderApprovalDecision => {
  switch (kind) {
    case "allow_always":
      return "acceptAlways";
    case "reject_once":
    case "reject_always":
      return "decline";
    default:
      return "accept";
  }
};

const selectedPermissionOptionId = (
  params: EffectAcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined => {
  const preferred =
    decision === "acceptForSession" || decision === "acceptAlways"
      ? ["allow_always", "allow_once"]
      : ["allow_once", "allow_always"];
  for (const kind of preferred) {
    const option = params.options.find((entry) => entry.kind === kind);
    if (option) return option.optionId;
  }
  return undefined;
};

export const makeEukheAcpAdapter = Effect.fn("makeEukheAcpAdapter")(function* (
  settings: EukheSettings,
  options: { readonly environment: NodeJS.ProcessEnv; readonly instanceId: ProviderInstanceId },
) {
  type Shape = ProviderAdapterShape<ProviderAdapterError>;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const uuid = Effect.orDie(crypto.randomUUIDv4);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, EukheSessionContext>();
  const ownerScope = yield* Effect.scope;

  const makeStamp = Effect.all({
    eventId: Effect.map(uuid, (id) => EventId.make(id)),
    createdAt: nowIso,
  });
  const envelope = (threadId: ThreadId, turnId: TurnId | undefined) =>
    Effect.map(makeStamp, (stamp) => ({
      ...stamp,
      provider: PROVIDER,
      providerInstanceId: options.instanceId,
      threadId,
      ...(turnId ? { turnId } : {}),
    }));
  const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);
  const emitApprovalResolved = (
    ctx: EukheSessionContext,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) =>
    Effect.gen(function* () {
      yield* offerRuntimeEvent({
        ...(yield* envelope(ctx.threadId, ctx.activeTurnId)),
        type: "request.resolved",
        requestId: RuntimeRequestId.make(requestId),
        payload: { requestType: "dynamic_tool_call", decision },
      });
    });

  const requestError = (method: string, detail: string, cause?: unknown) =>
    new ProviderAdapterRequestError({ provider: PROVIDER, method, detail, cause });
  const validationError = (operation: string, issue: string) =>
    new ProviderAdapterValidationError({ provider: PROVIDER, operation, issue });
  const processError = (threadId: ThreadId, detail: string) => (cause: unknown) =>
    new ProviderAdapterProcessError({ provider: PROVIDER, threadId, detail, cause });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<EukheSessionContext, ProviderAdapterSessionNotFoundError> => {
    const ctx = sessions.get(threadId);
    return ctx && !ctx.stopping
      ? Effect.succeed(ctx)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const settleApprovalsAsCancelled = (ctx: EukheSessionContext) =>
    Effect.forEach(
      [...ctx.pendingApprovals.keys()],
      (requestId) =>
        Effect.gen(function* () {
          const pending = ctx.pendingApprovals.get(requestId);
          if (!pending) return;
          ctx.pendingApprovals.delete(requestId);
          yield* Deferred.succeed(pending, "cancel");
          yield* emitApprovalResolved(ctx, requestId, "cancel");
        }),
      { discard: true },
    );

  const stopSessionInternal = (ctx: EukheSessionContext) =>
    Effect.gen(function* () {
      if (ctx.stopping) return;
      ctx.stopping = true;
      yield* settleApprovalsAsCancelled(ctx);
      sessions.delete(ctx.threadId);
      yield* offerRuntimeEvent({
        ...(yield* envelope(ctx.threadId, undefined)),
        type: "session.exited",
        payload: ctx.terminated
          ? { exitKind: "error", recoverable: true }
          : { exitKind: "graceful" },
      });
      yield* Scope.close(ctx.scope, Exit.void);
    });

  const settleTurn = (
    ctx: EukheSessionContext,
    turnId: TurnId,
    stopReason: string | null,
    errorMessage?: string,
  ) =>
    Effect.gen(function* () {
      yield* settleApprovalsAsCancelled(ctx);
      const report = parseRunReport(ctx.runReport);
      const aborted = ctx.interrupted || stopReason === "cancelled";
      const failure = !aborted ? (errorMessage ?? report?.error) : undefined;
      const answer = (report?.answer ?? ctx.answerText).trim();
      const index = ctx.turns.findIndex((turn) => turn.id === turnId);
      const existingTurn = index >= 0 ? ctx.turns[index] : undefined;
      if (existingTurn && answer.length > 0) {
        ctx.turns[index] = {
          id: turnId,
          items: [...existingTurn.items, { type: "assistant_message", text: answer }],
        };
      }
      yield* offerRuntimeEvent({
        ...(yield* envelope(ctx.threadId, turnId)),
        type: "turn.completed",
        payload: {
          state: aborted ? "interrupted" : failure ? "failed" : "completed",
          ...(failure ? {} : { stopReason: stopReason ?? null }),
          ...(failure ? { errorMessage: failure } : {}),
          ...(ctx.lastCostAmount !== undefined ? { totalCostUsd: ctx.lastCostAmount } : {}),
          ...(ctx.runReport !== undefined ? { usage: { eukhe: ctx.runReport } } : {}),
        },
      });
      ctx.runReport = undefined;
      ctx.answerText = "";
      const { activeTurnId: _activeTurnId, ...ready } = ctx.session;
      ctx.activeTurnId = undefined;
      ctx.interrupted = false;
      ctx.session = { ...ready, status: "ready", updatedAt: yield* nowIso };
      yield* offerRuntimeEvent({
        ...(yield* envelope(ctx.threadId, undefined)),
        type: "session.state.changed",
        payload: { state: "ready" },
      });
    });

  const setEukheConfig = (ctx: EukheSessionContext, configId: string, value: string) =>
    ctx.acp
      .setConfigOption(configId, value)
      .pipe(
        Effect.mapError((cause) =>
          mapAcpToAdapterError(PROVIDER, ctx.threadId, "session/set_config_option", cause),
        ),
      );

  const applySelection = (ctx: EukheSessionContext, selection: ModelSelection | undefined) =>
    Effect.gen(function* () {
      const slug = selection?.model;
      if (slug && slug !== PI_DEFAULT_MODEL) {
        const configOptions = yield* ctx.acp.getConfigOptions;
        const value = eukheModelValueForSlug(configOptions, slug);
        if (!value) {
          return yield* validationError(
            "set_config_option",
            `Eukhe does not offer model '${slug}'.`,
          );
        }
        yield* setEukheConfig(ctx, EUKHE_MODEL_CONFIG_ID, value);
        ctx.model = slug;
        ctx.session = { ...ctx.session, model: slug };
      }
      const effort = getModelSelectionStringOptionValue(selection, REASONING_OPTION_ID);
      if (effort) {
        const catalog = eukheSessionCatalogFromConfigOptions(yield* ctx.acp.getConfigOptions);
        const values = catalog.reasoningDescriptor?.values ?? [];
        if (!values.includes(effort)) {
          return yield* validationError(
            "set_config_option",
            `Eukhe does not offer reasoning effort '${effort}' for '${ctx.model ?? PI_DEFAULT_MODEL}'.`,
          );
        }
        yield* setEukheConfig(ctx, EUKHE_THOUGHT_LEVEL_CONFIG_ID, effort);
        ctx.effort = effort;
      }
    });

  const startPump = (ctx: EukheSessionContext) =>
    Stream.runDrain(
      Stream.mapEffect(ctx.acp.getEvents(), (event) =>
        Effect.gen(function* () {
          if (event._tag === "ConnectionTerminated") {
            ctx.terminated = true;
            yield* Effect.gen(function* () {
              if (sessions.get(ctx.threadId) !== ctx) return;
              if (ctx.activeTurnId) {
                yield* settleTurn(ctx, ctx.activeTurnId, null);
              }
              yield* stopSessionInternal(ctx);
            }).pipe(
              Effect.tapError((cause) =>
                Effect.logError("Failed to settle a terminated Eukhe session.", {
                  cause,
                  threadId: ctx.threadId,
                }),
              ),
              Effect.ignore,
              Effect.forkIn(ownerScope),
            );
            return;
          }
          if (event._tag === "EventStreamBarrier") {
            yield* Deferred.succeed(event.acknowledge, undefined);
            return;
          }
          if (event._tag === "ConfigOptionsUpdated") {
            const model = currentEukheModelSlug(event.configOptions);
            if (model) ctx.session = { ...ctx.session, model };
            return;
          }
          if (event._tag === "ModeChanged" || event._tag === "AvailableCommandsUpdated") {
            return;
          }
          if (ctx.activeTurnId === undefined) return;
          const turnId = ctx.activeTurnId;
          switch (event._tag) {
            case "AssistantItemStarted":
            case "AssistantItemCompleted":
              yield* offerRuntimeEvent(
                makeAcpAssistantItemEvent({
                  stamp: yield* makeStamp,
                  provider: PROVIDER,
                  threadId: ctx.threadId,
                  turnId,
                  itemId: event.itemId,
                  lifecycle:
                    event._tag === "AssistantItemStarted" ? "item.started" : "item.completed",
                }),
              );
              return;
            case "ContentDelta":
              ctx.answerText += event.text;
              yield* offerRuntimeEvent(
                makeAcpContentDeltaEvent({
                  stamp: yield* makeStamp,
                  provider: PROVIDER,
                  threadId: ctx.threadId,
                  turnId,
                  ...(event.itemId ? { itemId: event.itemId } : {}),
                  text: event.text,
                  rawPayload: event.rawPayload,
                }),
              );
              return;
            case "ThoughtDelta":
              yield* offerRuntimeEvent(
                makeAcpContentDeltaEvent({
                  stamp: yield* makeStamp,
                  provider: PROVIDER,
                  threadId: ctx.threadId,
                  turnId,
                  streamKind: "reasoning_text",
                  text: event.text,
                  rawPayload: event.rawPayload,
                }),
              );
              return;
            case "ToolCallUpdated":
              yield* offerRuntimeEvent(
                makeAcpToolCallEvent({
                  stamp: yield* makeStamp,
                  provider: PROVIDER,
                  threadId: ctx.threadId,
                  turnId,
                  toolCall: event.toolCall,
                  rawPayload: event.rawPayload,
                }),
              );
              return;
            case "PlanUpdated":
              yield* offerRuntimeEvent(
                makeAcpPlanUpdatedEvent({
                  stamp: yield* makeStamp,
                  provider: PROVIDER,
                  threadId: ctx.threadId,
                  turnId,
                  payload: event.payload,
                  source: "acp.jsonrpc",
                  method: "session/update",
                  rawPayload: event.rawPayload,
                }),
              );
              return;
          }
        }),
      ),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logError("Failed to process Eukhe runtime notification.", { cause }),
      ),
      Effect.forkIn(ctx.scope),
    );

  const startSession: Shape["startSession"] = (input) =>
    Effect.gen(function* () {
      const previous = sessions.get(input.threadId);
      if (previous) yield* stopSessionInternal(previous);
      const cwd = path.resolve(input.cwd ?? serverConfig.cwd);
      const binary = yield* resolveEukheBinary(settings, options.environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (binary._tag !== "Resolved") {
        return yield* new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: binary.detail,
        });
      }
      const sessionScope = yield* Scope.make();
      const resumeSessionId = eukheResumeFromCursor(input.resumeCursor);
      const acp = yield* makeEukheAcpRuntime({
        bin: binary.bin,
        cwd,
        environment: options.environment,
        childProcessSpawner: spawner,
        clientInfo: { name: "t3-code", version: "0.0.0" },
        ...(resumeSessionId ? { resumeSessionId } : {}),
      }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(Scope.Scope, sessionScope),
        Effect.mapError((cause) => processError(input.threadId, cause.message)(cause)),
        Effect.onError(() => Scope.close(sessionScope, Exit.void)),
      );
      yield* acp.handleRequestPermission((params) =>
        Effect.gen(function* () {
          const live = sessions.get(input.threadId);
          if (!live) return { outcome: { outcome: "cancelled" as const } };
          const permissionRequest = parsePermissionRequest(params);
          if (input.runtimeMode === "full-access") {
            const autoOptionId = selectedPermissionOptionId(params, "accept");
            if (autoOptionId)
              return { outcome: { outcome: "selected" as const, optionId: autoOptionId } };
          }
          const requestId = ApprovalRequestId.make(yield* uuid);
          const runtimeRequestId = RuntimeRequestId.make(requestId);
          const decision = yield* Deferred.make<ProviderApprovalDecision>();
          live.pendingApprovals.set(requestId, decision);
          yield* offerRuntimeEvent(
            makeAcpRequestOpenedEvent({
              stamp: yield* makeStamp,
              provider: PROVIDER,
              threadId: live.threadId,
              turnId: live.activeTurnId,
              requestId: runtimeRequestId,
              permissionRequest,
              approvalOptions: params.options.map((option) => ({
                decision: permissionKindDecision(option.kind),
                label: option.name,
              })),
              detail: permissionRequest.detail ?? params.toolCall.title ?? "Eukhe approval request",
              args: params,
              source: "acp.jsonrpc",
              method: "session/request_permission",
              rawPayload: params,
            }),
          );
          const resolved = yield* Deferred.await(decision);
          live.pendingApprovals.delete(requestId);
          yield* offerRuntimeEvent(
            makeAcpRequestResolvedEvent({
              stamp: yield* makeStamp,
              provider: PROVIDER,
              threadId: live.threadId,
              turnId: live.activeTurnId,
              requestId: runtimeRequestId,
              permissionRequest,
              decision: resolved,
            }),
          );
          const optionId = selectedPermissionOptionId(params, resolved);
          return optionId
            ? { outcome: { outcome: "selected" as const, optionId } }
            : { outcome: { outcome: "cancelled" as const } };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new EffectAcpErrors.AcpTransportError({
                detail: "Failed to process the Eukhe permission request.",
                cause,
              }),
          ),
        ),
      );
      yield* acp.handleUnknownExtNotification((method, params) =>
        method !== EUKHE_RUN_REPORT_METHOD
          ? Effect.void
          : Effect.sync(() => {
              const live = sessions.get(input.threadId);
              if (live) live.runReport = params;
            }),
      );
      yield* acp.handleSessionUpdate((notification) => {
        const update: unknown = notification.update;
        const usage = Schema.decodeUnknownOption(EukheUsageUpdate)(update);
        if (Option.isSome(usage)) {
          return Effect.gen(function* () {
            const live = sessions.get(input.threadId);
            if (!live) return;
            if (usage.value.cost) live.lastCostAmount = usage.value.cost.amount;
            yield* offerRuntimeEvent({
              ...(yield* envelope(live.threadId, live.activeTurnId)),
              type: "thread.token-usage.updated",
              payload: {
                usage: {
                  usedTokens: Math.max(0, Math.floor(usage.value.used)),
                  ...(usage.value.size > 0 ? { maxTokens: usage.value.size } : {}),
                },
              },
            });
          });
        }
        const title = Schema.decodeUnknownOption(EukheTitleUpdate)(update);
        const titleName = Option.isSome(title) ? title.value.title : undefined;
        if (titleName) {
          return Effect.gen(function* () {
            const live = sessions.get(input.threadId);
            if (!live) return;
            yield* offerRuntimeEvent({
              ...(yield* envelope(live.threadId, undefined)),
              type: "thread.metadata.updated",
              payload: { name: titleName },
            });
          });
        }
        return Effect.void;
      });
      const started = yield* acp
        .start()
        .pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", cause),
          ),
        );
      const now = yield* nowIso;
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd,
        threadId: input.threadId,
        resumeCursor: { schemaVersion: RESUME_SCHEMA_VERSION, sessionId: started.sessionId },
        createdAt: now,
        updatedAt: now,
      };
      const ctx: EukheSessionContext = {
        threadId: input.threadId,
        scope: sessionScope,
        acp,
        acpSessionId: started.sessionId,
        pendingApprovals: new Map(),
        turns: [],
        session,
        interrupted: false,
        stopping: false,
        terminated: false,
        answerText: "",
        runReport: undefined,
      };
      sessions.set(input.threadId, ctx);
      yield* startPump(ctx);
      const configOptions = yield* acp.getConfigOptions;
      ctx.model = currentEukheModelSlug(configOptions);
      if (ctx.model) ctx.session = { ...session, model: ctx.model };
      yield* applySelection(ctx, input.modelSelection);
      yield* offerRuntimeEvent({
        ...(yield* envelope(input.threadId, undefined)),
        type: "session.started",
        payload: { resume: session.resumeCursor },
      });
      yield* offerRuntimeEvent({
        ...(yield* envelope(input.threadId, undefined)),
        type: "thread.started",
        payload: { providerThreadId: started.sessionId },
      });
      yield* offerRuntimeEvent({
        ...(yield* envelope(input.threadId, undefined)),
        type: "session.state.changed",
        payload: { state: "ready" },
      });
      return ctx.session;
    });

  const sendTurn: Shape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(input.threadId);
      if (ctx.activeTurnId !== undefined) {
        return yield* requestError(
          "session/prompt",
          "Eukhe runs one turn at a time. Wait for the active turn or interrupt it.",
        );
      }
      const text = input.input?.trim() ?? "";
      const imageParts = yield* Effect.forEach(
        (input.attachments ?? []).filter((attachment) => attachment.type === "image"),
        (attachment) =>
          Effect.gen(function* () {
            const file = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!file) {
              return yield* requestError(
                "session/prompt",
                `Invalid attachment id '${attachment.id}'.`,
              );
            }
            const bytes = yield* fileSystem
              .readFile(file)
              .pipe(
                Effect.mapError((cause) =>
                  requestError(
                    "session/prompt",
                    `Failed to read attachment '${attachment.id}'.`,
                    cause,
                  ),
                ),
              );
            return {
              type: "image" as const,
              data: Buffer.from(bytes).toString("base64"),
              mimeType: attachment.mimeType,
            } satisfies EffectAcpSchema.ContentBlock;
          }),
      );
      if (!text && imageParts.length === 0) {
        return yield* validationError("sendTurn", "A turn needs text or an image.");
      }
      yield* applySelection(ctx, input.modelSelection);
      const turnId = TurnId.make(yield* uuid);
      ctx.runReport = undefined;
      ctx.answerText = "";
      ctx.interrupted = false;
      ctx.turns.push({ id: turnId, items: text ? [{ type: "user_message", text }] : [] });
      ctx.activeTurnId = turnId;
      ctx.session = {
        ...ctx.session,
        status: "running",
        activeTurnId: turnId,
        updatedAt: yield* nowIso,
        ...(ctx.model ? { model: ctx.model } : {}),
      };
      yield* offerRuntimeEvent({
        ...(yield* envelope(input.threadId, turnId)),
        type: "turn.started",
        payload: {
          ...(ctx.model ? { model: ctx.model } : {}),
          ...(ctx.effort ? { effort: ctx.effort } : {}),
        },
      });
      yield* offerRuntimeEvent({
        ...(yield* envelope(input.threadId, turnId)),
        type: "session.state.changed",
        payload: { state: "running" },
      });
      if (ctx.interrupted) {
        yield* settleTurn(ctx, turnId, "cancelled");
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: ctx.session.resumeCursor,
        };
      }
      const outcome = yield* ctx.acp
        .prompt({
          prompt: [...(text ? [{ type: "text" as const, text }] : []), ...imageParts],
        })
        .pipe(Effect.result);
      if (Result.isFailure(outcome)) {
        const error = mapAcpToAdapterError(
          PROVIDER,
          input.threadId,
          "session/prompt",
          outcome.failure,
        );
        if (ctx.activeTurnId === turnId) {
          yield* settleTurn(ctx, turnId, null, error.message);
        }
        return yield* error;
      }
      yield* ctx.acp.drainEvents;
      if (ctx.activeTurnId === turnId) {
        yield* settleTurn(ctx, turnId, outcome.success.stopReason);
      }
      return {
        threadId: input.threadId,
        turnId,
        resumeCursor: ctx.session.resumeCursor,
      };
    });

  const readThread: Shape["readThread"] = (threadId) =>
    Effect.map(requireSession(threadId), (ctx) => ({ threadId, turns: ctx.turns }));

  const rollbackThread: Shape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* validationError("rollbackThread", "numTurns must be an integer >= 1.");
      }
      const ctx = yield* requireSession(threadId);
      if (ctx.activeTurnId !== undefined) {
        return yield* requestError("_eukhe/undo", "Wait for the active turn before rolling back.");
      }
      let undone = 0;
      for (let attempt = 0; attempt < numTurns; attempt += 1) {
        const result = yield* ctx.acp
          .request("_eukhe/undo", { sessionId: ctx.acpSessionId })
          .pipe(Effect.result);
        if (Result.isFailure(result)) {
          const failure = result.failure;
          const data = isAcpRequestError(failure) ? failure.data : undefined;
          if (
            isAcpRequestError(failure) &&
            failure.code === -32603 &&
            typeof data === "object" &&
            data !== null &&
            "code" in data &&
            data.code === "nothing_to_undo"
          ) {
            break;
          }
          return yield* mapAcpToAdapterError(PROVIDER, threadId, "_eukhe/undo", failure);
        }
        undone += 1;
      }
      if (undone > 0) {
        ctx.turns.splice(Math.max(0, ctx.turns.length - undone), undone);
        yield* offerRuntimeEvent({
          ...(yield* envelope(threadId, undefined)),
          type: "session.started",
          payload: {
            resume: {
              schemaVersion: RESUME_SCHEMA_VERSION,
              sessionId: ctx.acpSessionId,
              undone,
            },
          },
        });
      }
      return yield* readThread(threadId);
    });

  const stopAll = () =>
    Effect.forEach([...sessions.values()], (ctx) => stopSessionInternal(ctx), { discard: true });
  yield* Effect.addFinalizer(() =>
    Effect.andThen(Effect.ignore(stopAll()), PubSub.shutdown(events)),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: true },
    compaction: { type: "slash-command", command: "/compact" },
    startSession,
    sendTurn,
    interruptTurn: (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (ctx.activeTurnId === undefined) return;
        if (turnId !== undefined && turnId !== ctx.activeTurnId) return;
        ctx.interrupted = true;
        yield* settleApprovalsAsCancelled(ctx);
        yield* Effect.ignore(
          ctx.acp.cancel.pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", cause),
            ),
          ),
        );
      }),
    respondToRequest: (threadId, requestId, decision) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* requestError(
            "session/request_permission",
            `Unknown pending approval request: ${requestId}`,
          );
        }
        ctx.pendingApprovals.delete(requestId);
        yield* Deferred.succeed(pending, decision);
        yield* emitApprovalResolved(ctx, requestId, decision);
      }),
    respondToUserInput: () =>
      Effect.fail(requestError("respondToUserInput", "Eukhe has no structured user-input gate.")),
    stopSession: (threadId) =>
      Effect.flatMap(requireSession(threadId), (ctx) => stopSessionInternal(ctx)),
    listSessions: () =>
      Effect.sync(() => [...sessions.values()].map((ctx) => ({ ...ctx.session }))),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(events),
  } satisfies Shape;
});
