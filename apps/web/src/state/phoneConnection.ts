import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const phoneConnectionStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:server:phone-connection-status",
  tag: WS_METHODS.serverGetPhoneConnection,
  staleTimeMs: 5_000,
});

export const enablePhoneConnection = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:server:phone-connection-enable",
  tag: WS_METHODS.serverEnablePhoneConnection,
});

export const rotatePhoneConnection = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:server:phone-connection-rotate",
  tag: WS_METHODS.serverRotatePhoneConnection,
});

export const disablePhoneConnection = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-command:server:phone-connection-disable",
  tag: WS_METHODS.serverDisablePhoneConnection,
});
