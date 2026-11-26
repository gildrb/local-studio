import * as NodeCrypto from "node:crypto";
import * as NodeOs from "node:os";
import { fileURLToPath } from "node:url";
import * as Clock from "effect/Clock";
import * as Option from "effect/Option";
import {
  ApprovalRequestId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import packageJson from "../../package.json" with { type: "json" };
import { ServerSecretStore, type SecretStoreError } from "../auth/ServerSecretStore.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import {
  agentsFromSources,
  modelsFromProvider,
  resolveAgent,
  type PhoneAgent,
  type PhoneAgentSource,
} from "./PhoneAgents.ts";
import {
  beginSession,
  createPhoneSession,
  mapEventToLines,
  recordFrame,
  replayFrames,
  type PhoneSession,
} from "./PhoneSession.ts";
import { listenPipeServer, PipeSocket, type PipeRoutes } from "./PipeWsServer.ts";
import {
  ALLEYCAT_PROTOCOL_VERSION,
  alleycatFailure,
  encodeRpcFailure,
  encodeRpcNotification,
  encodeRpcRequest,
  encodeRpcSuccess,
  parseRpcLine,
  rpcErrorBody,
  RPC_SESSION_ERROR,
  type AlleycatResponse,
  type PairPayload,
  type PhoneRpcId,
  type PipeServerToSidecar,
} from "./PhoneWire.ts";

const PAIR_TOKEN_SECRET = "phone/pair-token";
const PIPE_TOKEN_SECRET = "phone/pipe-token";
const ALLEYCAT_KEY_FILE = "alleycat-host.key";

export interface PhoneBridgeStatus {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly nodeId: string;
}

export interface PhoneConnectionInfo {
  readonly payload: PairPayload;
  readonly json: string;
}

export class PhoneBridgeError extends Schema.TaggedError<PhoneBridgeError>()("PhoneBridgeError", {
  reason: Schema.String,
}) {}

interface SessionHandle {
  readonly session: PhoneSession;
  readonly buffered: Array<string>;
  socket: PipeSocket | undefined;
}

interface PhoneReply {
  readonly kind: "success";
  readonly result: unknown;
}

interface PhoneRejection {
  readonly kind: "failure";
  readonly message: string;
}

interface PendingPhoneReply {
  readonly resolve: (reply: PhoneReply | PhoneRejection) => void;
}

interface PhoneRuntime {
  enabled: boolean;
  server: { readonly port: number; readonly close: () => void } | undefined;
  sidecarScope: Scope.Scope | undefined;
  nodeId: string;
  nodeReady: Deferred.Deferred<string> | undefined;
  sessions: Map<number, SessionHandle>;
  streamSessions: Map<number, SessionHandle>;
  pendingReplies: Map<string, PendingPhoneReply>;
  nextSessionId: number;
  nextRpcId: number;
}

const asParams = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const decodeThreadId = (value: string): ThreadId => Schema.decodeUnknownSync(ThreadId)(value);

const decodeTurnId = (value: string): TurnId => Schema.decodeUnknownSync(TurnId)(value);

const decodeApprovalRequestId = (value: string): ApprovalRequestId =>
  Schema.decodeUnknownSync(ApprovalRequestId)(value);

const bytesToHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

const timingSafeEqual = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return NodeCrypto.timingSafeEqual(leftBytes, rightBytes);
};

const resolveSessionHandle = (
  runtime: PhoneRuntime,
  agentName: string,
): SessionHandle | undefined => {
  for (const handle of runtime.sessions.values()) {
    if (handle.session.agentName === agentName) return handle;
  }
  return undefined;
};

export interface PhoneBridgeShape {
  readonly status: Effect.Effect<PhoneBridgeStatus, SecretStoreError>;
  readonly enable: Effect.Effect<PhoneConnectionInfo, PhoneBridgeError | SecretStoreError>;
  readonly rotate: Effect.Effect<PhoneConnectionInfo, PhoneBridgeError | SecretStoreError>;
  readonly disable: Effect.Effect<void, SecretStoreError>;
}

export class PhoneBridge extends Context.Service<PhoneBridge, PhoneBridgeShape>()(
  "t3/phoneBridge/PhoneBridge",
) {}

const make = Effect.gen(function* () {
  const layerScope = yield* Scope.Scope;
  const secrets = yield* ServerSecretStore;
  const registry = yield* ProviderInstanceRegistry;
  const providerService = yield* ProviderService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const runtime: PhoneRuntime = {
    enabled: false,
    server: undefined,
    sidecarScope: undefined,
    nodeId: "",
    nodeReady: undefined,
    sessions: new Map(),
    streamSessions: new Map(),
    pendingReplies: new Map(),
    nextSessionId: 1,
    nextRpcId: 1,
  };

  const readPairToken = Effect.gen(function* () {
    const stored = yield* secrets.get(PAIR_TOKEN_SECRET);
    return Option.isSome(stored) ? bytesToHex(stored.value) : undefined;
  });

  const readPipeToken = Effect.map(secrets.getOrCreateRandom(PIPE_TOKEN_SECRET, 32), bytesToHex);

  const writeLine = (handle: SessionHandle, line: string): void => {
    if (handle.socket !== undefined) {
      handle.socket.sendText(line);
      return;
    }
    handle.buffered.push(line);
  };

  const agentsNow = Effect.gen(function* () {
    const configured = yield* registry.listInstances;
    const sources = yield* Effect.forEach(
      configured,
      (instance): Effect.Effect<PhoneAgentSource> =>
        Effect.map(instance.snapshot.getSnapshot, (snapshot) => ({ instance, snapshot })),
      { concurrency: "unbounded" },
    );
    return agentsFromSources(sources);
  });

  const requireAgent = (
    agents: ReadonlyArray<PhoneAgent>,
    agentName: string,
  ): Effect.Effect<PhoneAgent, PhoneBridgeError> => {
    const agent = resolveAgent(agents, agentName);
    return agent === undefined
      ? Effect.fail(new PhoneBridgeError({ reason: `unknown agent ${agentName}` }))
      : Effect.succeed(agent);
  };

  const requireInstance = (
    instanceId: ProviderInstanceId,
  ): Effect.Effect<ProviderInstance, PhoneBridgeError> =>
    Effect.flatMap(registry.getInstance(instanceId), (instance) =>
      instance === undefined
        ? Effect.fail(new PhoneBridgeError({ reason: `instance ${instanceId} unavailable` }))
        : Effect.succeed(instance),
    );

  const resolveSession = Effect.fn("phoneBridge.resolveSession")(function* (input: {
    readonly agent: string;
    readonly token: string;
    readonly resumeLastSeq: number | null;
  }) {
    const pairToken = yield* readPairToken;
    if (pairToken === undefined || !timingSafeEqual(input.token, pairToken)) {
      return { response: alleycatFailure("invalid token"), handle: undefined };
    }
    const agents = yield* agentsNow;
    const agent = resolveAgent(agents, input.agent);
    if (agent === undefined) {
      return {
        response: alleycatFailure(`unknown agent ${input.agent}`),
        handle: undefined,
      };
    }
    const existing = resolveSessionHandle(runtime, input.agent);
    if (existing === undefined) {
      const session = createPhoneSession({
        id: runtime.nextSessionId,
        agentName: input.agent,
        instanceId: agent.instanceId,
      });
      runtime.nextSessionId += 1;
      const handle: SessionHandle = { session, buffered: [], socket: undefined };
      runtime.sessions.set(session.id, handle);
      beginSession(session, input.resumeLastSeq);
      return {
        response: {
          v: ALLEYCAT_PROTOCOL_VERSION,
          ok: true,
          session: { attached: "fresh", current_seq: session.seq, floor_seq: session.floorSeq },
        } satisfies AlleycatResponse,
        handle,
      };
    }
    if (input.resumeLastSeq !== null) {
      beginSession(existing.session, input.resumeLastSeq);
      for (const line of replayFrames(existing.session)) {
        writeLine(existing, line);
      }
      existing.session.replayFrom = null;
      return {
        response: {
          v: ALLEYCAT_PROTOCOL_VERSION,
          ok: true,
          session: {
            attached: "resumed",
            current_seq: existing.session.seq,
            floor_seq: existing.session.floorSeq,
          },
        } satisfies AlleycatResponse,
        handle: existing,
      };
    }
    return {
      response: {
        v: ALLEYCAT_PROTOCOL_VERSION,
        ok: true,
        session: {
          attached: "fresh",
          current_seq: existing.session.seq,
          floor_seq: existing.session.floorSeq,
        },
      } satisfies AlleycatResponse,
      handle: existing,
    };
  });

  const handleOp = Effect.fn("phoneBridge.handleOp")(function* (payload: unknown) {
    const params = asParams(payload);
    if (params["v"] !== ALLEYCAT_PROTOCOL_VERSION) {
      return alleycatFailure("protocol mismatch");
    }
    const token = params["token"];
    if (typeof token !== "string" || token.trim().length === 0) {
      return alleycatFailure("empty token");
    }
    const pairToken = yield* readPairToken;
    if (pairToken === undefined || !timingSafeEqual(token, pairToken)) {
      return alleycatFailure("invalid token");
    }
    if (params["op"] === "list_agents") {
      const agents = yield* agentsNow;
      return { v: ALLEYCAT_PROTOCOL_VERSION, ok: true, agents: agents.map((agent) => agent.info) };
    }
    if (params["op"] === "restart_agent") {
      const agentName = params["agent"];
      if (typeof agentName !== "string") {
        return alleycatFailure("missing agent");
      }
      const agent = yield* requireAgent(yield* agentsNow, agentName);
      const active = yield* providerService.listSessions();
      for (const activeSession of active) {
        if (activeSession.providerInstanceId === agent.instanceId) {
          yield* providerService.stopSession({ threadId: activeSession.threadId });
        }
      }
      return { v: ALLEYCAT_PROTOCOL_VERSION, ok: true };
    }
    if (params["op"] === "connect") {
      const agentName = params["agent"];
      if (typeof agentName !== "string") {
        return alleycatFailure("missing agent");
      }
      const resume = asParams(params["resume"]);
      const lastSeq = resume["last_seq"];
      return (yield* resolveSession({
        agent: agentName,
        token,
        resumeLastSeq: typeof lastSeq === "number" ? lastSeq : null,
      })).response;
    }
    return alleycatFailure("unsupported op");
  });

  const attachSocket = (handle: SessionHandle, socket: PipeSocket): void => {
    handle.socket = socket;
    for (const line of handle.buffered) {
      socket.sendText(line);
    }
    handle.buffered.length = 0;
  };

  const sendPhoneRequest = Effect.fn("phoneBridge.sendPhoneRequest")(function* (
    handle: SessionHandle,
    method: string,
    params: unknown,
  ) {
    const id = runtime.nextRpcId;
    runtime.nextRpcId += 1;
    const deferred = yield* Deferred.make<PhoneReply | PhoneRejection>();
    runtime.pendingReplies.set(String(id), {
      resolve: (reply) => {
        void Effect.runPromise(Deferred.succeed(deferred, reply)).catch(() => {});
      },
    });
    writeLine(handle, encodeRpcRequest(id, method, params));
    return yield* Deferred.await(deferred);
  });

  const mapApprovalDecision = (decision: unknown): ProviderApprovalDecision =>
    decision === "accept" ||
    decision === "acceptForSession" ||
    decision === "decline" ||
    decision === "cancel"
      ? decision
      : "decline";

  const approvalBase = (
    handle: SessionHandle,
    event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
  ): Record<string, unknown> => ({
    threadId: event.threadId,
    turnId: event.turnId ?? handle.session.currentTurns.get(event.threadId) ?? "",
    itemId: event.itemId ?? "",
    startedAtMs: Date.parse(event.createdAt),
  });

  const handleRequestOpened = Effect.fn("phoneBridge.handleRequestOpened")(function* (
    handle: SessionHandle,
    event: Extract<ProviderRuntimeEvent, { type: "request.opened" }>,
  ) {
    const rawRequestId = event.requestId;
    if (rawRequestId === undefined) return;
    const requestId = decodeApprovalRequestId(rawRequestId);
    const payload = asParams(event.payload);
    const args = asParams(payload["args"]);
    const base = approvalBase(handle, event);
    const optionalReason = payload["detail"] === undefined ? {} : { reason: payload["detail"] };
    const requestType = payload["requestType"];
    const method =
      requestType === "tool_user_input" || requestType === "mcp_elicitation_approval"
        ? "item/tool/requestUserInput"
        : requestType === "file_change_approval" || requestType === "apply_patch_approval"
          ? "item/fileChange/requestApproval"
          : requestType === "permission_approval"
            ? "item/permissions/requestApproval"
            : "item/commandExecution/requestApproval";
    const command = payload["command"];
    const cwd = payload["cwd"];
    const permissions = payload["permissions"];
    const questions = Array.isArray(payload["questions"]) ? payload["questions"] : [];
    if (method === "item/tool/requestUserInput" && questions.length === 0) {
      yield* providerService.respondToUserInput({
        threadId: event.threadId,
        requestId,
        answers: {},
      });
      return;
    }
    const params =
      method === "item/commandExecution/requestApproval"
        ? {
            ...base,
            kind: "command",
            command:
              typeof command === "string"
                ? command
                : (typeof payload["title"] === "string" ? payload["title"] : "") ||
                  (typeof payload["detail"] === "string" ? payload["detail"] : ""),
            commandActions: Array.isArray(payload["commandActions"])
              ? payload["commandActions"]
              : [],
            cwd: typeof cwd === "string" ? cwd : "",
            ...optionalReason,
          }
        : method === "item/permissions/requestApproval"
          ? {
              ...base,
              cwd: typeof cwd === "string" ? cwd : "",
              permissions:
                typeof permissions === "object" && permissions !== null ? permissions : {},
              ...optionalReason,
            }
          : method === "item/tool/requestUserInput"
            ? {
                ...base,
                isBlocking: true,
                questions,
              }
            : { ...base, ...optionalReason };
    const reply = yield* sendPhoneRequest(handle, method, params);
    const decisionValue = reply.kind === "success" ? asParams(reply.result)["decision"] : "decline";
    if (method === "item/tool/requestUserInput") {
      const answers = reply.kind === "success" ? asParams(reply.result)["answers"] : {};
      yield* providerService.respondToUserInput({
        threadId: event.threadId,
        requestId,
        answers:
          typeof answers === "object" && answers !== null
            ? (answers as Record<string, unknown>)
            : {},
      });
    } else {
      yield* providerService.respondToRequest({
        threadId: event.threadId,
        requestId,
        decision: mapApprovalDecision(decisionValue),
      });
    }
    writeLine(
      handle,
      encodeRpcNotification("serverRequest/resolved", {
        threadId: event.threadId,
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
        decision: decisionValue,
      }),
    );
  });

  const handleUserInputRequested = Effect.fn("phoneBridge.handleUserInputRequested")(function* (
    handle: SessionHandle,
    event: Extract<ProviderRuntimeEvent, { type: "user-input.requested" }>,
  ) {
    const rawRequestId = event.requestId;
    if (rawRequestId === undefined) return;
    const requestId = decodeApprovalRequestId(rawRequestId);
    const payload = asParams(event.payload);
    const questions = Array.isArray(payload["questions"]) ? payload["questions"] : [];
    if (questions.length === 0) {
      yield* providerService.respondToUserInput({
        threadId: event.threadId,
        requestId,
        answers: {},
      });
      return;
    }
    const params = {
      threadId: event.threadId,
      turnId: event.turnId ?? handle.session.currentTurns.get(event.threadId) ?? "",
      itemId: event.itemId ?? "",
      isBlocking: true,
      questions,
    };
    const reply = yield* sendPhoneRequest(handle, "item/tool/requestUserInput", params);
    const answers = reply.kind === "success" ? asParams(reply.result)["answers"] : {};
    yield* providerService.respondToUserInput({
      threadId: event.threadId,
      requestId,
      answers:
        typeof answers === "object" && answers !== null ? (answers as Record<string, unknown>) : {},
    });
    writeLine(
      handle,
      encodeRpcNotification("serverRequest/resolved", {
        threadId: event.threadId,
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
      }),
    );
  });

  const dispatchEvent = (event: ProviderRuntimeEvent) => {
    for (const handle of runtime.sessions.values()) {
      if (!handle.session.threads.has(event.threadId)) continue;
      if (event.type === "request.opened") {
        return handleRequestOpened(handle, event);
      }
      if (event.type === "user-input.requested") {
        return handleUserInputRequested(handle, event);
      }
      for (const line of mapEventToLines(handle.session, event)) {
        recordFrame(handle.session, line);
        writeLine(handle, line);
      }
    }
    return Effect.void;
  };

  yield* providerService.streamEvents
    .pipe(Stream.runForEach((event) => dispatchEvent(event)))
    .pipe(Effect.forkScoped);

  const controlSocket: { current: PipeSocket | undefined } = { current: undefined };
  const replyToSidecar = (message: PipeServerToSidecar): void => {
    if (controlSocket.current !== undefined) {
      controlSocket.current.sendText(JSON.stringify(message));
    }
  };

  const handleControlMessage = (socket: PipeSocket, text: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const record = asParams(parsed);
    const type = record["type"];
    if (type === "node_info_request") {
      replyToSidecar({ type: "node_info", node_id: runtime.nodeId });
      return;
    }
    if (type === "op_request" && typeof record["id"] === "number") {
      const id = record["id"];
      void Effect.runPromise(
        handleOp(record["payload"]).pipe(
          Effect.map((payload) => replyToSidecar({ type: "op_response", id, payload })),
          Effect.catch(() =>
            Effect.sync(() =>
              replyToSidecar({ type: "op_response", id, payload: alleycatFailure("bridge error") }),
            ),
          ),
        ),
      ).catch(() => {});
      return;
    }
    if (type === "stream_attach" && typeof record["id"] === "number") {
      const id = record["id"];
      const agent = typeof record["agent"] === "string" ? record["agent"] : "";
      const token = typeof record["token"] === "string" ? record["token"] : "";
      const resume = record["resume_last_seq"];
      void Effect.runPromise(
        Effect.gen(function* () {
          const resolved = yield* resolveSession({
            agent,
            token,
            resumeLastSeq: typeof resume === "number" ? resume : null,
          });
          if (resolved.response.ok && resolved.handle !== undefined) {
            runtime.streamSessions.set(id, resolved.handle);
          }
          return resolved.response;
        }).pipe(
          Effect.map((payload) => replyToSidecar({ type: "stream_attached", id, payload })),
          Effect.catch(() =>
            Effect.sync(() =>
              replyToSidecar({
                type: "stream_attached",
                id,
                payload: alleycatFailure("bridge error"),
              }),
            ),
          ),
        ),
      ).catch(() => {});
    }
  };

  const resolvePendingReply = (id: PhoneRpcId, message: PhoneReply | PhoneRejection): void => {
    const key = String(id);
    const pending = runtime.pendingReplies.get(key);
    if (pending !== undefined) {
      runtime.pendingReplies.delete(key);
      pending.resolve(message);
    }
  };

  const handlePhoneLine = (handle: SessionHandle, line: string): void => {
    const message = parseRpcLine(line);
    if ("reason" in message) {
      return;
    }
    if (message.kind === "success" || message.kind === "failure") {
      resolvePendingReply(
        message.id,
        message.kind === "success"
          ? { kind: "success", result: message.result }
          : { kind: "failure", message: message.message },
      );
      return;
    }
    if (message.kind !== "request") return;
    void Effect.runPromise(
      handleRequestEffect(handle, {
        method: message.method,
        params: asParams(message.params),
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => writeLine(handle, encodeRpcSuccess(message.id, result))),
        ),
        Effect.catch((error) =>
          Effect.sync(() =>
            writeLine(
              handle,
              encodeRpcFailure(message.id, rpcErrorBody(RPC_SESSION_ERROR, error.message)),
            ),
          ),
        ),
      ),
    ).catch(() => {});
  };

  const handleThreadStart = Effect.fn("phoneBridge.handleThreadStart")(function* (
    handle: SessionHandle,
    method: string,
    params: Record<string, unknown>,
  ) {
    const agent = yield* requireAgent(yield* agentsNow, handle.session.agentName);
    const instance = yield* requireInstance(agent.instanceId);
    const snapshot = yield* instance.snapshot.getSnapshot;
    const requestedThreadId = params["threadId"];
    const threadId =
      method === "thread/resume" && typeof requestedThreadId === "string"
        ? decodeThreadId(requestedThreadId)
        : decodeThreadId(NodeCrypto.randomUUID());
    const requestedCwd = params["cwd"];
    const cwd =
      typeof requestedCwd === "string" && requestedCwd.length > 0 ? requestedCwd : NodeOs.homedir();
    const requestedModel = params["model"];
    const model =
      typeof requestedModel === "string" && requestedModel.length > 0
        ? requestedModel
        : (snapshot.models.find((candidate) => candidate.isDefault === true)?.slug ??
          snapshot.models[0]?.slug);
    const modelSelection: ModelSelection | undefined =
      model === undefined ? undefined : { instanceId: agent.instanceId, model };
    yield* providerService.startSession(threadId, {
      threadId,
      providerInstanceId: agent.instanceId,
      cwd,
      modelSelection,
      runtimeMode: "approval-required",
      resumeCursor: method === "thread/resume" ? { phone: threadId } : undefined,
    });
    handle.session.threads.add(threadId);
    const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    return {
      thread: {
        id: threadId,
        cliVersion: packageJson.version,
        createdAt: nowSeconds,
        cwd,
        ephemeral: false,
        model: model ?? null,
        modelProvider: instance.driverKind,
        preview: "",
        projectId: null,
        sessionId: threadId,
        source: "appServer",
        status: { type: "idle" },
        turns: [],
        updatedAt: nowSeconds,
      },
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      cwd,
      model: model ?? "",
      modelProvider: instance.driverKind,
      sandbox: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: true },
    };
  });

  const handleTurnStart = Effect.fn("phoneBridge.handleTurnStart")(function* (
    handle: SessionHandle,
    params: Record<string, unknown>,
  ) {
    const requestedThreadId = params["threadId"];
    if (typeof requestedThreadId !== "string") {
      return yield* Effect.fail(new PhoneBridgeError({ reason: "missing threadId" }));
    }
    const threadId = decodeThreadId(requestedThreadId);
    const agent = yield* requireAgent(yield* agentsNow, handle.session.agentName);
    const input = params["input"];
    const text = Array.isArray(input)
      ? input
          .flatMap((entry) => {
            const record = asParams(entry);
            return record["type"] === "text" && typeof record["text"] === "string"
              ? [record["text"]]
              : [];
          })
          .join("\n")
      : "";
    if (text.length === 0) {
      return yield* Effect.fail(new PhoneBridgeError({ reason: "turn has no text input" }));
    }
    const requestedModel = params["model"];
    const modelSelection: ModelSelection | undefined =
      typeof requestedModel === "string" && requestedModel.length > 0
        ? { instanceId: agent.instanceId, model: requestedModel }
        : undefined;
    const turn = yield* providerService.sendTurn({ threadId, input: text, modelSelection });
    return {
      turn: {
        id: turn.turnId,
        items: [],
        status: "inProgress",
        startedAt: Math.floor((yield* Clock.currentTimeMillis) / 1000),
      },
    };
  });

  const handleTurnInterrupt = Effect.fn("phoneBridge.handleTurnInterrupt")(function* (
    params: Record<string, unknown>,
  ) {
    const requestedThreadId = params["threadId"];
    if (typeof requestedThreadId !== "string") {
      return yield* Effect.fail(new PhoneBridgeError({ reason: "missing threadId" }));
    }
    const threadId = decodeThreadId(requestedThreadId);
    const requestedTurnId = params["turnId"];
    yield* providerService.interruptTurn({
      threadId,
      ...(typeof requestedTurnId === "string" ? { turnId: decodeTurnId(requestedTurnId) } : {}),
    });
    return {};
  });

  const handleModelList = Effect.fn("phoneBridge.handleModelList")(function* (
    handle: SessionHandle,
  ) {
    const agent = yield* requireAgent(yield* agentsNow, handle.session.agentName);
    const instance = yield* requireInstance(agent.instanceId);
    const snapshot = yield* instance.snapshot.getSnapshot;
    const models = modelsFromProvider(snapshot);
    const defaultModel = models.find((candidate) => candidate.isDefault) ?? models[0];
    return {
      data: models.map((candidate) => ({
        id: candidate.slug,
        model: candidate.slug,
        displayName: candidate.name,
        description: candidate.name,
        hidden: false,
        isDefault: candidate === defaultModel,
        defaultReasoningEffort: candidate.efforts[0] ?? "medium",
        supportedReasoningEfforts: candidate.efforts.map((effort) => ({
          reasoningEffort: effort,
          description: effort,
        })),
      })),
      nextCursor: null,
    };
  });

  const handleRequestEffect = Effect.fn("phoneBridge.handleRequest")(function* (
    handle: SessionHandle,
    request: { readonly method: string; readonly params: Record<string, unknown> },
  ) {
    switch (request.method) {
      case "initialize":
        return {
          codexHome: NodeOs.homedir(),
          platformFamily: process.platform === "win32" ? "windows" : "unix",
          platformOs: process.platform,
          userAgent: `local-studio-phone-bridge/${packageJson.version}`,
        };
      case "thread/start":
      case "thread/resume":
        return yield* handleThreadStart(handle, request.method, request.params);
      case "turn/start":
        return yield* handleTurnStart(handle, request.params);
      case "turn/interrupt":
        return yield* handleTurnInterrupt(request.params);
      case "model/list":
        return yield* handleModelList(handle);
      case "config/read":
        return { config: {}, origins: {} };
      default:
        return yield* Effect.fail(
          new PhoneBridgeError({ reason: `method not found: ${request.method}` }),
        );
    }
  });

  const startSidecar = (): Effect.Effect<void, PhoneBridgeError> =>
    Effect.gen(function* () {
      if (runtime.sidecarScope !== undefined || runtime.server === undefined) return;
      const pipeToken = yield* readPipeToken;
      const fromEnv = process.env["LOCAL_STUDIO_ALLEYCAT_HOST_BIN"];
      const resources = (process as { resourcesPath?: string }).resourcesPath;
      const bundled =
        resources === undefined
          ? undefined
          : path.join(resources, "alleycat-host", "alleycat-host");
      const built = path.resolve(
        fileURLToPath(new URL("../../../..", import.meta.url)),
        "native/alleycat-host/target/release/alleycat-host",
      );
      const command =
        fromEnv !== undefined && (yield* fileSystem.exists(fromEnv))
          ? fromEnv
          : bundled !== undefined && (yield* fileSystem.exists(bundled))
            ? bundled
            : built;
      if (!(yield* fileSystem.exists(command))) {
        yield* Effect.logWarning("alleycat-host binary not found; phone bridge idle");
        return;
      }
      const keyFile = path.join(secrets.directory ?? NodeOs.homedir(), ALLEYCAT_KEY_FILE);
      const scope = yield* Scope.make("sequential");
      const child = yield* spawner
        .spawn(
          ChildProcess.make(
            command,
            [
              "serve",
              "--pipe-url",
              `ws://127.0.0.1:${runtime.server.port}`,
              "--pipe-token",
              pipeToken,
              "--key-file",
              keyFile,
            ],
            { detached: false, shell: false, stdout: "pipe", stderr: "pipe" },
          ),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));
      runtime.sidecarScope = scope;
      yield* child.all.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) =>
          Effect.sync(() => {
            const match = /node_id ([0-9a-f]+)/.exec(line);
            if (match === null || runtime.nodeId !== "") return;
            runtime.nodeId = match[1]!;
            void Effect.runPromise(
              Effect.logInfo("phone bridge node id ready", { nodeId: runtime.nodeId }),
            ).catch(() => {});
            if (runtime.nodeReady !== undefined) {
              void Effect.runPromise(Deferred.succeed(runtime.nodeReady, runtime.nodeId)).catch(
                () => {},
              );
            }
          }),
        ),
        Effect.forkScoped,
        Effect.provideService(Scope.Scope, scope),
      );
      yield* child.exitCode.pipe(
        Effect.flatMap(() =>
          Effect.gen(function* () {
            if (runtime.sidecarScope === scope) {
              runtime.sidecarScope = undefined;
              runtime.nodeId = "";
              runtime.nodeReady = undefined;
            }
            yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
            if (runtime.enabled) {
              yield* Effect.sleep("2 seconds").pipe(
                Effect.andThen(startSidecar().pipe(Effect.catch(() => Effect.void))),
                Effect.forkScoped,
                Effect.provideService(Scope.Scope, layerScope),
              );
            }
          }),
        ),
        Effect.forkScoped,
        Effect.provideService(Scope.Scope, layerScope),
      );
    }).pipe(
      Effect.catch(
        (cause) => new PhoneBridgeError({ reason: `sidecar start failed: ${String(cause)}` }),
      ),
    );

  const stopEverything = Effect.gen(function* () {
    const scope = runtime.sidecarScope;
    runtime.sidecarScope = undefined;
    if (scope !== undefined) {
      yield* Scope.close(scope, Exit.void).pipe(Effect.ignore);
    }
    runtime.server?.close();
    runtime.server = undefined;
    controlSocket.current?.close();
    controlSocket.current = undefined;
    runtime.nodeId = "";
    runtime.nodeReady = undefined;
  });

  const startServer = (): Effect.Effect<void, PhoneBridgeError> =>
    Effect.gen(function* () {
      if (runtime.server !== undefined) return;
      const pipeToken = yield* readPipeToken;
      const routes: PipeRoutes = {
        onControl: (socket) => {
          let pipeSocket: PipeSocket | undefined;
          pipeSocket = new PipeSocket(socket, {
            onText: (text) => {
              if (pipeSocket !== undefined) handleControlMessage(pipeSocket, text);
            },
            onClose: () => {
              if (controlSocket.current === pipeSocket) {
                controlSocket.current = undefined;
              }
            },
          });
          controlSocket.current = pipeSocket;
        },
        onStream: (id, socket) => {
          const handle = runtime.streamSessions.get(id);
          if (handle === undefined) {
            socket.destroy();
            return;
          }
          let pipeSocket: PipeSocket | undefined;
          pipeSocket = new PipeSocket(socket, {
            onText: (text) => {
              if (pipeSocket !== undefined) handlePhoneLine(handle, text);
            },
            onClose: () => {
              if (handle.socket === pipeSocket) {
                handle.socket = undefined;
              }
            },
          });
          attachSocket(handle, pipeSocket);
        },
      };
      runtime.server = yield* Effect.promise(() => listenPipeServer({ token: pipeToken, routes }));
      yield* startSidecar().pipe(Effect.catch(() => Effect.void));
    }).pipe(
      Effect.catch(
        (cause) => new PhoneBridgeError({ reason: `phone bridge start failed: ${String(cause)}` }),
      ),
    );

  const awaitNodeId = Effect.gen(function* () {
    if (runtime.nodeId !== "") return;
    const ready = yield* Deferred.make<string>();
    runtime.nodeReady = ready;
    yield* Deferred.await(ready).pipe(Effect.timeoutOption("10 seconds"), Effect.asVoid);
  });

  const buildConnectionInfo = (token: string): PhoneConnectionInfo => {
    const payload: PairPayload = {
      v: ALLEYCAT_PROTOCOL_VERSION,
      node_id: runtime.nodeId,
      token,
      host_name: NodeOs.hostname(),
    };
    return { payload, json: JSON.stringify(payload) };
  };

  yield* Effect.addFinalizer(() => stopEverything);

  yield* Effect.gen(function* () {
    const token = yield* readPairToken;
    if (token === undefined) return;
    runtime.enabled = true;
    yield* startServer().pipe(Effect.catch(() => Effect.void));
  }).pipe(Effect.forkScoped);

  return {
    status: Effect.map(readPairToken, (token) => ({
      enabled: token !== undefined,
      running: runtime.sidecarScope !== undefined && runtime.server !== undefined,
      nodeId: runtime.nodeId,
    })),
    enable: Effect.gen(function* () {
      const existing = yield* readPairToken;
      if (existing !== undefined) {
        runtime.enabled = true;
        yield* startServer();
        yield* awaitNodeId;
        return buildConnectionInfo(existing);
      }
      const generated = yield* secrets.getOrCreateRandom(PAIR_TOKEN_SECRET, 32);
      yield* secrets.set(PAIR_TOKEN_SECRET, generated);
      runtime.enabled = true;
      yield* startServer();
      yield* awaitNodeId;
      return buildConnectionInfo(bytesToHex(generated));
    }),
    rotate: Effect.gen(function* () {
      const generated = NodeCrypto.randomBytes(32);
      yield* secrets.set(PAIR_TOKEN_SECRET, generated);
      runtime.enabled = true;
      yield* startServer();
      yield* awaitNodeId;
      return buildConnectionInfo(bytesToHex(generated));
    }),
    disable: Effect.gen(function* () {
      yield* secrets.remove(PAIR_TOKEN_SECRET);
      runtime.enabled = false;
      yield* stopEverything;
    }),
  };
});

let sharedPhoneBridge: PhoneBridgeShape | undefined;

export const getSharedPhoneBridge = Effect.gen(function* () {
  if (sharedPhoneBridge === undefined) {
    sharedPhoneBridge = yield* make;
  }
  return sharedPhoneBridge;
});
