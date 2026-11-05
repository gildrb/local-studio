import { SshEnvironmentGateway } from "@t3tools/client-runtime/platform";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import type { DesktopBridge, DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export type DesktopSshGatewayBridge = Pick<
  DesktopBridge,
  | "ensureSshEnvironment"
  | "fetchSshEnvironmentDescriptor"
  | "bootstrapSshBearerSession"
  | "disconnectSshEnvironment"
>;

const SSH_UNSUPPORTED_DETAIL = "SSH environments are only available in the desktop app.";

function sshPreparationError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.toLowerCase().includes("cancel")) {
    return new ConnectionBlockedError({
      reason: "authentication",
      detail: message,
    });
  }
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not prepare the SSH environment: ${message}`,
  });
}

export const provisionDesktopSshEnvironment = Effect.fn(
  "web.connectionPlatform.ssh.provisionDesktop",
)(function* (bridge: DesktopSshGatewayBridge, target: DesktopSshEnvironmentTarget) {
  const bootstrap = yield* Effect.tryPromise({
    try: () =>
      bridge.ensureSshEnvironment(target, {
        issuePairingToken: true,
      }),
    catch: sshPreparationError,
  });
  const pairingToken = bootstrap.pairingToken;
  if (pairingToken === null) {
    return yield* new ConnectionBlockedError({
      reason: "authentication",
      detail: "The SSH environment did not issue a pairing credential.",
    });
  }
  const descriptor = yield* Effect.tryPromise({
    try: () => bridge.fetchSshEnvironmentDescriptor(bootstrap.httpBaseUrl),
    catch: sshPreparationError,
  });
  const access = yield* Effect.tryPromise({
    try: () => bridge.bootstrapSshBearerSession(bootstrap.httpBaseUrl, pairingToken),
    catch: sshPreparationError,
  });
  return {
    environmentId: descriptor.environmentId,
    label: descriptor.label,
    bootstrap,
    bearerToken: access.access_token,
  };
});

export function makeDesktopSshEnvironmentGateway(
  getBridge: () => DesktopSshGatewayBridge | undefined,
) {
  return SshEnvironmentGateway.of({
    provision: Effect.fn("web.connectionPlatform.ssh.provision")(function* (target) {
      const bridge = getBridge();
      if (bridge === undefined) {
        return yield* new ConnectionBlockedError({
          reason: "unsupported",
          detail: SSH_UNSUPPORTED_DETAIL,
        });
      }
      return yield* provisionDesktopSshEnvironment(bridge, target);
    }),
    prepare: Effect.fn("web.connectionPlatform.ssh.prepare")(function* (input) {
      const bridge = getBridge();
      if (bridge === undefined) {
        return yield* new ConnectionBlockedError({
          reason: "unsupported",
          detail: SSH_UNSUPPORTED_DETAIL,
        });
      }
      const bootstrap = yield* Effect.tryPromise({
        try: () =>
          bridge.ensureSshEnvironment(input.target, {
            issuePairingToken: true,
          }),
        catch: sshPreparationError,
      });
      const pairingToken = bootstrap.pairingToken;
      if (pairingToken === null) {
        return yield* new ConnectionBlockedError({
          reason: "authentication",
          detail: "The SSH environment did not issue a pairing credential.",
        });
      }
      const access = yield* Effect.tryPromise({
        try: () => bridge.bootstrapSshBearerSession(bootstrap.httpBaseUrl, pairingToken),
        catch: sshPreparationError,
      });
      return {
        bootstrap,
        bearerToken: access.access_token,
      };
    }),
    disconnect: Effect.fn("web.connectionPlatform.ssh.disconnect")(function* (target) {
      const bridge = getBridge();
      if (bridge === undefined) {
        return;
      }
      yield* Effect.tryPromise({
        try: () => bridge.disconnectSshEnvironment(target),
        catch: (cause) =>
          new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: `Could not disconnect the SSH environment: ${String(cause)}`,
          }),
      });
    }),
  });
}
