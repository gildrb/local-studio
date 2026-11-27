import type { ProviderRuntimeEvent, ThreadId } from "@t3tools/contracts";
import type { ProviderInstanceId } from "@t3tools/contracts";
import { encodeRpcNotification } from "./PhoneWire.ts";

const EVENT_LOG_CAPACITY = 4096;

const stringOr = (value: unknown, fallback: string | undefined): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export interface PhoneSessionEventLogEntry {
  readonly seq: number;
  readonly line: string;
}

export interface PhoneSession {
  readonly id: number;
  readonly agentName: string;
  readonly instanceId: ProviderInstanceId;
  seq: number;
  floorSeq: number;
  replayFrom: number | null;
  readonly log: Array<PhoneSessionEventLogEntry>;
  readonly threads: Set<ThreadId>;
  readonly openItems: Map<string, string>;
  readonly currentTurns: Map<ThreadId, string>;
  readonly reasoningIds: Map<ThreadId, string>;
  readonly streamedText: Map<string, string>;
}

export const createPhoneSession = (input: {
  readonly id: number;
  readonly agentName: string;
  readonly instanceId: ProviderInstanceId;
}): PhoneSession => ({
  id: input.id,
  agentName: input.agentName,
  instanceId: input.instanceId,
  seq: 0,
  floorSeq: 0,
  replayFrom: null,
  log: [],
  threads: new Set(),
  openItems: new Map(),
  currentTurns: new Map(),
  reasoningIds: new Map(),
  streamedText: new Map(),
});

export const recordFrame = (session: PhoneSession, line: string): number => {
  session.seq += 1;
  session.log.push({ seq: session.seq, line });
  if (session.log.length > EVENT_LOG_CAPACITY) {
    session.log.splice(0, session.log.length - EVENT_LOG_CAPACITY);
  }
  return session.seq;
};

export const beginSession = (session: PhoneSession, resumeLastSeq: number | null): void => {
  session.floorSeq = session.log.length > 0 ? session.log[0]!.seq - 1 : session.seq;
  session.replayFrom =
    resumeLastSeq !== null && resumeLastSeq >= session.floorSeq ? resumeLastSeq : null;
};

export const replayFrames = (session: PhoneSession): ReadonlyArray<string> =>
  session.replayFrom === null
    ? []
    : session.log.filter((entry) => entry.seq > session.replayFrom!).map((entry) => entry.line);

const itemStatus = (status: string | undefined): "inProgress" | "completed" | "failed" => {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "declined") return "failed";
  return "inProgress";
};

const itemCounter: Record<string, number> = {};
const nextItemId = (itemType: string): string => {
  const current = itemCounter[itemType] ?? 0;
  itemCounter[itemType] = current + 1;
  return `item-${itemType}-${current + 1}`;
};

const turnIdFor = (session: PhoneSession, threadId: ThreadId, turnId: string | undefined): string =>
  turnId ??
  session.currentTurns.get(threadId) ??
  `turn-phone-${session.id}-${nextItemId("orphanTurn")}`;

const asRecord = (data: unknown): Record<string, unknown> =>
  typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};

const payloadOf = (event: ProviderRuntimeEvent): Record<string, unknown> => asRecord(event.payload);

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const tokenBreakdown = (
  usage: Record<string, unknown>,
  last: boolean,
): Record<string, unknown> => ({
  totalTokens: numberOr(usage[last ? "lastUsedTokens" : "usedTokens"], 0),
  inputTokens: numberOr(usage[last ? "lastInputTokens" : "inputTokens"], 0),
  cachedInputTokens: numberOr(usage[last ? "lastCachedInputTokens" : "cachedInputTokens"], 0),
  cacheWriteInputTokens: 0,
  outputTokens: numberOr(usage[last ? "lastOutputTokens" : "outputTokens"], 0),
  reasoningOutputTokens: numberOr(
    usage[last ? "lastReasoningOutputTokens" : "reasoningOutputTokens"],
    0,
  ),
});

const tokenUsageFrame = (usage: unknown): Record<string, unknown> => {
  const record = asRecord(usage);
  return {
    total: tokenBreakdown(record, false),
    last: tokenBreakdown(record, true),
    modelContextWindow: numberOr(record["maxTokens"], 0),
  };
};

const ensureReasoningItemId = (session: PhoneSession, threadId: ThreadId): string => {
  const existing = session.reasoningIds.get(threadId);
  if (existing !== undefined) return existing;
  const id = `item-reasoning-${session.id}-${session.seq + 1}`;
  session.reasoningIds.set(threadId, id);
  return id;
};

interface MappedItem {
  readonly codexType: string;
  readonly item: Record<string, unknown>;
}

const mapItem = (
  itemType: string | undefined,
  status: string | undefined,
  title: string | undefined,
  detail: string | undefined,
  data: unknown,
): MappedItem | undefined => {
  const dataRecord = asRecord(data);
  switch (itemType) {
    case "user_message":
      return {
        codexType: "user_message",
        item: {
          type: "userMessage",
          id: nextItemId("userMessage"),
          content: [{ type: "text", text: detail ?? title ?? "" }],
        },
      };
    case "assistant_message":
      return {
        codexType: "assistant_message",
        item: { type: "agentMessage", id: nextItemId("agentMessage"), text: detail ?? title ?? "" },
      };
    case "reasoning":
      return {
        codexType: "reasoning",
        item: { type: "reasoning", id: nextItemId("reasoning"), summary: detail ? [detail] : [] },
      };
    case "plan":
      return {
        codexType: "plan",
        item: { type: "plan", id: nextItemId("plan"), text: detail ?? "" },
      };
    case "command_execution":
      return {
        codexType: "command_execution",
        item: {
          type: "commandExecution",
          id: nextItemId("commandExecution"),
          command: title ?? "",
          commandActions: [],
          cwd: typeof dataRecord.cwd === "string" ? dataRecord.cwd : "",
          status: itemStatus(status),
          ...(typeof dataRecord.aggregatedOutput === "string"
            ? { aggregatedOutput: dataRecord.aggregatedOutput }
            : {}),
          ...(typeof dataRecord.exitCode === "number" ? { exitCode: dataRecord.exitCode } : {}),
          ...(typeof dataRecord.durationMs === "number"
            ? { durationMs: dataRecord.durationMs }
            : {}),
        },
      };
    case "file_change":
      return {
        codexType: "file_change",
        item: {
          type: "fileChange",
          id: nextItemId("fileChange"),
          changes: Array.isArray(dataRecord.changes) ? dataRecord.changes : [],
          status: itemStatus(status),
        },
      };
    case "mcp_tool_call":
      return {
        codexType: "mcp_tool_call",
        item: {
          type: "mcpToolCall",
          id: nextItemId("mcpToolCall"),
          server: typeof dataRecord.server === "string" ? dataRecord.server : "",
          tool: title ?? "",
          arguments:
            typeof dataRecord.arguments === "object" && dataRecord.arguments !== null
              ? dataRecord.arguments
              : {},
          status: itemStatus(status),
        },
      };
    case "dynamic_tool_call":
      return {
        codexType: "dynamic_tool_call",
        item: {
          type: "dynamicToolCall",
          id: nextItemId("dynamicToolCall"),
          tool: title ?? "",
          arguments:
            typeof dataRecord.arguments === "object" && dataRecord.arguments !== null
              ? dataRecord.arguments
              : {},
          status: itemStatus(status),
        },
      };
    case "web_search":
      return {
        codexType: "web_search",
        item: { type: "webSearch", id: nextItemId("webSearch"), query: title ?? "" },
      };
    case "context_compaction":
      return {
        codexType: "context_compaction",
        item: { type: "contextCompaction", id: nextItemId("contextCompaction") },
      };
    case "error":
    case "unknown":
    case "review_entered":
    case "review_exited":
    case "collab_agent_tool_call":
    case "image_view":
      if (!detail && !title) return undefined;
      return {
        codexType: "assistant_message",
        item: { type: "agentMessage", id: nextItemId("agentMessage"), text: detail ?? title ?? "" },
      };
    default:
      return undefined;
  }
};

const DELTA_METHODS: ReadonlyArray<readonly [string, string]> = [
  ["assistant_text", "item/agentMessage/delta"],
  ["reasoning_summary_text", "item/reasoning/summaryTextDelta"],
  ["reasoning_text", "item/reasoning/textDelta"],
  ["plan_text", "item/plan/delta"],
  ["command_output", "item/commandExecution/outputDelta"],
  ["file_change_output", "item/fileChange/outputDelta"],
];

const turnNotification = (
  threadId: ThreadId,
  turnId: string,
  status: "inProgress" | "completed" | "interrupted" | "failed",
  extra: Record<string, unknown>,
): string =>
  encodeRpcNotification("turn/completed", {
    threadId,
    turn: { id: turnId, items: [], status, ...extra },
  });

export const mapEventToLines = (
  session: PhoneSession,
  event: ProviderRuntimeEvent,
): ReadonlyArray<string> => {
  if (!session.threads.has(event.threadId)) return [];
  const threadId = event.threadId;
  const payload = payloadOf(event);
  const createdAt = Date.parse(event.createdAt);
  switch (event.type) {
    case "thread.started":
      return [encodeRpcNotification("thread/started", { threadId })];
    case "turn.started": {
      const turnId = event.turnId ?? "";
      if (turnId) session.currentTurns.set(threadId, turnId);
      session.reasoningIds.delete(threadId);
      return [
        encodeRpcNotification("turn/started", {
          threadId,
          turn: {
            id: turnId,
            items: [],
            status: "inProgress",
            startedAt: Math.floor(createdAt / 1000),
          },
        }),
      ];
    }
    case "content.delta": {
      const turnId = turnIdFor(session, threadId, event.turnId);
      const streamKind =
        typeof payload["streamKind"] === "string" ? payload["streamKind"] : "assistant_text";
      const delta = typeof payload["delta"] === "string" ? payload["delta"] : "";
      const reportedItemId = event.itemId ?? "";
      const method =
        DELTA_METHODS.find(([kind]) => kind === streamKind)?.[1] ?? "item/agentMessage/delta";
      let itemId = reportedItemId;
      if (itemId === "") {
        if (streamKind === "reasoning_text" || streamKind === "reasoning_summary_text") {
          itemId = ensureReasoningItemId(session, threadId);
        } else {
          itemId = `item-${streamKind}-${threadId}-${session.seq + 1}`;
        }
      }
      if (streamKind === "assistant_text" && itemId !== "") {
        session.streamedText.set(itemId, (session.streamedText.get(itemId) ?? "") + delta);
      }
      const turnPayload: Record<string, unknown> = { threadId, turnId, itemId, delta };
      if (method === "item/reasoning/summaryTextDelta") {
        turnPayload.summaryIndex =
          typeof payload["summaryIndex"] === "number" ? payload["summaryIndex"] : 0;
      }
      if (method === "item/reasoning/textDelta") {
        turnPayload.contentIndex =
          typeof payload["contentIndex"] === "number" ? payload["contentIndex"] : 0;
      }
      return [encodeRpcNotification(method, turnPayload)];
    }
    case "item.started":
    case "item.updated": {
      const turnId = turnIdFor(session, threadId, event.turnId);
      const itemId = event.itemId ?? "";
      const mapped = mapItem(
        stringOr(payload["itemType"], undefined),
        stringOr(payload["status"], undefined),
        stringOr(payload["title"], undefined),
        stringOr(payload["detail"], undefined),
        payload["data"],
      );
      if (!mapped || !itemId) return [];
      session.openItems.set(itemId, mapped.codexType);
      const item = { ...mapped.item, id: itemId };
      if (event.type === "item.updated" && payload["status"] !== "inProgress") {
        return [
          encodeRpcNotification("item/completed", {
            threadId,
            turnId,
            item,
            completedAtMs: createdAt,
          }),
        ];
      }
      return [
        encodeRpcNotification("item/started", {
          threadId,
          turnId,
          item,
          startedAtMs: createdAt,
        }),
      ];
    }
    case "item.completed": {
      const turnId = turnIdFor(session, threadId, event.turnId);
      const itemId = event.itemId ?? "";
      const mapped = mapItem(
        stringOr(payload["itemType"], undefined),
        stringOr(payload["status"], "completed"),
        stringOr(payload["title"], undefined),
        stringOr(payload["detail"], undefined),
        payload["data"],
      );
      if (!mapped || !itemId) return [];
      session.openItems.delete(itemId);
      const streamed = session.streamedText.get(itemId);
      if (streamed !== undefined) {
        session.streamedText.delete(itemId);
        if (mapped.codexType === "assistant_message") {
          mapped.item.text = streamed;
        }
      }
      return [
        encodeRpcNotification("item/completed", {
          threadId,
          turnId,
          item: { ...mapped.item, id: itemId },
          completedAtMs: createdAt,
        }),
      ];
    }
    case "turn.completed": {
      const turnId = turnIdFor(session, threadId, event.turnId);
      session.reasoningIds.delete(threadId);
      const state = stringOr(payload["state"], "completed");
      const errorMessage = stringOr(payload["errorMessage"], undefined);
      return [
        turnNotification(
          threadId,
          turnId,
          state === "completed" ? "completed" : state === "failed" ? "failed" : "interrupted",
          {
            completedAt: Math.floor(createdAt / 1000),
            ...(errorMessage === undefined ? {} : { error: { message: errorMessage } }),
          },
        ),
      ];
    }
    case "turn.aborted":
      return [
        turnNotification(threadId, turnIdFor(session, threadId, event.turnId), "interrupted", {}),
      ];
    case "thread.token-usage.updated":
      return [
        encodeRpcNotification("thread/tokenUsage/updated", {
          threadId,
          turnId: turnIdFor(session, threadId, event.turnId),
          tokenUsage: tokenUsageFrame(payload["usage"]),
        }),
      ];
    case "thread.metadata.updated":
    case "thread.state.changed":
    case "session.started":
    case "session.configured":
    case "session.state.changed":
    case "session.exited":
    case "turn.plan.updated":
    case "turn.proposed.delta":
    case "turn.proposed.completed":
    case "turn.diff.updated":
    case "request.opened":
    case "request.resolved":
    case "user-input.requested":
    case "user-input.resolved":
    case "thread.realtime.started":
    case "thread.realtime.item-added":
    case "thread.realtime.audio.delta":
    case "thread.realtime.error":
    case "thread.realtime.closed":
    case "task.started":
    case "task.progress":
    case "task.updated":
    case "task.completed":
    case "hook.started":
    case "hook.progress":
    case "hook.completed":
    case "tool.progress":
    case "tool.summary":
    case "auth.status":
    case "account.updated":
    case "account.rate-limits.updated":
    case "mcp.status.updated":
    case "mcp.oauth.completed":
    case "model.rerouted":
    case "config.warning":
    case "deprecation.notice":
    case "files.persisted":
    case "tool.denied":
    case "runtime.warning":
    case "runtime.error":
      return [];
    default:
      return [];
  }
};
