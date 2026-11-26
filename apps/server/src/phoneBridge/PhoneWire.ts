import * as Schema from "effect/Schema";

export const ALLEYCAT_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1_048_576;

export type AlleycatAgentWire = "websocket" | "jsonl";

export interface AlleycatAgentPresentation {
  readonly title?: string;
  readonly is_beta: boolean;
  readonly sort_order: number;
  readonly description?: string;
  readonly aliases: ReadonlyArray<string>;
}

export interface AlleycatAgentCapabilities {
  readonly locks_reasoning_effort_after_activity: boolean;
  readonly visible_modes?: ReadonlyArray<string>;
  readonly supports_ssh_bridge: boolean;
  readonly uses_direct_codex_port: boolean;
  readonly supports_thread_permission_overrides?: boolean;
  readonly reports_effective_thread_permissions?: boolean;
}

export interface AlleycatAgentInfo {
  readonly name: string;
  readonly display_name: string;
  readonly wire: AlleycatAgentWire;
  readonly available: boolean;
  readonly presentation?: AlleycatAgentPresentation;
  readonly capabilities?: AlleycatAgentCapabilities;
}

export type AlleycatAttachKind = "fresh" | "resumed" | "drift_reload";

export interface AlleycatSessionInfo {
  readonly attached: AlleycatAttachKind;
  readonly current_seq: number;
  readonly floor_seq: number;
}

export type AlleycatRequest =
  | { readonly op: "list_agents"; readonly v: number; readonly token: string }
  | {
      readonly op: "restart_agent";
      readonly v: number;
      readonly token: string;
      readonly agent: string;
    }
  | {
      readonly op: "connect";
      readonly v: number;
      readonly token: string;
      readonly agent: string;
      readonly resume?: { readonly last_seq: number };
    };

export interface AlleycatResponse {
  readonly v: number;
  readonly ok: boolean;
  readonly agents?: ReadonlyArray<AlleycatAgentInfo>;
  readonly session?: AlleycatSessionInfo;
  readonly error?: string;
}

export const alleycatFailure = (error: string): AlleycatResponse => ({
  v: ALLEYCAT_PROTOCOL_VERSION,
  ok: false,
  error,
});

export type PipeServerToSidecar =
  | { readonly type: "node_info"; readonly node_id: string }
  | { readonly type: "op_response"; readonly id: number; readonly payload: AlleycatResponse }
  | { readonly type: "stream_attached"; readonly id: number; readonly payload: AlleycatResponse };

export type PipeSidecarToServer =
  | { readonly type: "node_info_request" }
  | { readonly type: "op_request"; readonly id: number; readonly payload: unknown }
  | {
      readonly type: "stream_attach";
      readonly id: number;
      readonly agent: string;
      readonly token: string;
      readonly resume_last_seq: number | null;
    };

export interface PairPayload {
  readonly v: number;
  readonly node_id: string;
  readonly token: string;
  readonly relay?: string;
  readonly host_name?: string;
}

export type PhoneRpcId = number | string;

export interface PhoneRpcRequest {
  readonly kind: "request";
  readonly id: PhoneRpcId;
  readonly method: string;
  readonly params: unknown;
}

export interface PhoneRpcNotification {
  readonly kind: "notification";
  readonly method: string;
  readonly params: unknown;
}

export interface PhoneRpcSuccess {
  readonly kind: "success";
  readonly id: PhoneRpcId;
  readonly result: unknown;
}

export interface PhoneRpcFailure {
  readonly kind: "failure";
  readonly id: PhoneRpcId;
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export type PhoneRpcMessage =
  | PhoneRpcRequest
  | PhoneRpcNotification
  | PhoneRpcSuccess
  | PhoneRpcFailure;

export class PhoneRpcParseError extends Schema.TaggedError<PhoneRpcParseError>()(
  "PhoneRpcParseError",
  { reason: Schema.String },
) {}

const hasId = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

export const parseRpcLine = (line: string): PhoneRpcMessage | PhoneRpcParseError => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return new PhoneRpcParseError({ reason: "invalid JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return new PhoneRpcParseError({ reason: "not an object" });
  }
  const record = parsed as Record<string, unknown>;
  const method = record.method;
  if (typeof method === "string") {
    const params = record.params;
    if (hasId(record.id)) {
      return {
        kind: "request",
        id: record.id,
        method,
        params: params === undefined ? {} : params,
      };
    }
    return { kind: "notification", method, params: params === undefined ? {} : params };
  }
  if (hasId(record.id)) {
    if (record.error !== undefined && record.error !== null) {
      const error = record.error;
      if (typeof error === "object" && error !== null && !Array.isArray(error)) {
        const errorRecord = error as Record<string, unknown>;
        return {
          kind: "failure",
          id: record.id,
          code: typeof errorRecord.code === "number" ? errorRecord.code : -32603,
          message: typeof errorRecord.message === "string" ? errorRecord.message : "unknown error",
          data: errorRecord.data,
        };
      }
      return { kind: "failure", id: record.id, code: -32603, message: "unknown error" };
    }
    return { kind: "success", id: record.id, result: record.result };
  }
  return new PhoneRpcParseError({ reason: "message has neither method nor id" });
};

export interface RpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export const rpcErrorBody = (code: number, message: string, data?: unknown): RpcErrorBody => ({
  code,
  message,
  ...(data === undefined ? {} : { data }),
});

export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;
export const RPC_SESSION_ERROR = -32000;

export const encodeRpcRequest = (id: PhoneRpcId, method: string, params: unknown): string =>
  JSON.stringify({ id, method, params, jsonrpc: "2.0" });

export const encodeRpcNotification = (method: string, params: unknown): string =>
  JSON.stringify({ method, params, jsonrpc: "2.0" });

export const encodeRpcSuccess = (id: PhoneRpcId, result: unknown): string =>
  JSON.stringify({ id, result, jsonrpc: "2.0" });

export const encodeRpcFailure = (id: PhoneRpcId, error: RpcErrorBody): string =>
  JSON.stringify({ id, error, jsonrpc: "2.0" });
