import type { DeviceInputPacket } from "@t3tools/client-runtime/device/input";
import * as Schema from "effect/Schema";

const HelloMessageSchema = Schema.Struct({
  t: Schema.Literal("hello"),
  server: Schema.NullOr(
    Schema.Struct({
      httpUrl: Schema.String,
      wsUrl: Schema.String,
      bootstrapToken: Schema.String,
    }),
  ),
  t3Home: Schema.NonEmptyString,
  platform: Schema.optional(Schema.String),
  appearance: Schema.optional(Schema.Literals(["dark", "light"])),
  stageLabel: Schema.optional(Schema.String),
});

const InboundMessageSchema = Schema.Union([
  Schema.Struct({
    t: Schema.Literal("sub"),
    id: Schema.Number,
    view: Schema.String,
    params: Schema.optional(Schema.Unknown),
  }),
  Schema.Struct({ t: Schema.Literal("unsub"), id: Schema.Number }),
  Schema.Struct({
    t: Schema.Literal("act"),
    id: Schema.Number,
    action: Schema.String,
    params: Schema.optional(Schema.Unknown),
  }),
]);

export type HelloMessage = typeof HelloMessageSchema.Type;
export type InboundMessage = typeof InboundMessageSchema.Type;

export const parseHello = Schema.decodeUnknownSync(Schema.fromJsonString(HelloMessageSchema));
export const parseInbound = Schema.decodeUnknownSync(Schema.fromJsonString(InboundMessageSchema));

export type StatusPhase = "connecting" | "ready" | "reconnecting" | "failed";

export type OutboundMessage =
  | { readonly t: "ready" }
  | { readonly t: "status"; readonly phase: StatusPhase; readonly detail: string }
  | { readonly t: "view"; readonly id: number; readonly data: unknown }
  | { readonly t: "result"; readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly t: "result"; readonly id: number; readonly ok: false; readonly error: string }
  | { readonly t: "log"; readonly level: "debug" | "info" | "warn" | "error"; readonly msg: string }
  | {
      readonly t: "term";
      readonly key: string;
      readonly op: TerminalStreamOp;
      readonly data: string;
    }
  | { readonly t: "device"; readonly stream: number; readonly packet: DeviceInputPacket };

export type TerminalStreamOp = "reset" | "append" | "paste" | "clear-selection" | "focus";

export type Send = (message: OutboundMessage) => void;

export function makeStdoutSend(): Send {
  return (message) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };
}
