import * as Schema from "effect/Schema";

export const PhoneConnectionStatus = Schema.Struct({
  enabled: Schema.Boolean,
  running: Schema.Boolean,
  nodeId: Schema.String,
});
export type PhoneConnectionStatus = typeof PhoneConnectionStatus.Type;

export const PhoneConnectionPairing = Schema.Struct({
  connectionJson: Schema.String,
  nodeId: Schema.String,
});
export type PhoneConnectionPairing = typeof PhoneConnectionPairing.Type;

export class PhoneBridgeOperationError extends Schema.TaggedError<PhoneBridgeOperationError>()(
  "PhoneBridgeOperationError",
  { message: Schema.String },
) {}
