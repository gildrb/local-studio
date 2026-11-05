import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
  RemoteEnvironmentAuthUndeclaredStatusError,
  type RemoteEnvironmentAuthError,
} from "@t3tools/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import {
  EnvironmentAuthInvalidError,
  EnvironmentInternalError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import { SshHttpBridgeError } from "@t3tools/ssh/errors";
import { resolveLoopbackSshHttpBaseUrl } from "@t3tools/ssh/tunnel";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type DesktopSshEnvironmentRequestOperation =
  | "fetch-environment-descriptor"
  | "bootstrap-bearer-session"
  | "fetch-session-state"
  | "issue-websocket-ticket";

type DesktopSshEnvironmentRequestCause = RemoteEnvironmentAuthError | SshHttpBridgeError;

const isEnvironmentAuthInvalidError = Schema.is(EnvironmentAuthInvalidError);
const isEnvironmentInternalError = Schema.is(EnvironmentInternalError);
const isEnvironmentOperationForbiddenError = Schema.is(EnvironmentOperationForbiddenError);
const isEnvironmentRequestInvalidError = Schema.is(EnvironmentRequestInvalidError);
const isEnvironmentScopeRequiredError = Schema.is(EnvironmentScopeRequiredError);

function readSshHttpStatus(cause: DesktopSshEnvironmentRequestCause): number | null {
  if (
    cause instanceof RemoteEnvironmentAuthUndeclaredStatusError ||
    cause instanceof SshHttpBridgeError
  ) {
    return cause.status ?? null;
  }
  if (isEnvironmentRequestInvalidError(cause)) {
    return 400;
  }
  if (isEnvironmentAuthInvalidError(cause)) {
    return 401;
  }
  if (isEnvironmentScopeRequiredError(cause)) {
    return 403;
  }
  if (isEnvironmentOperationForbiddenError(cause)) {
    return 403;
  }
  if (isEnvironmentInternalError(cause)) {
    return 500;
  }
  return null;
}

export class DesktopSshEnvironmentRequestError extends Data.TaggedError(
  "DesktopSshEnvironmentRequestError",
)<{
  readonly operation: DesktopSshEnvironmentRequestOperation;
  readonly cause: DesktopSshEnvironmentRequestCause;
  readonly sshHttpStatus: number | null;
}> {
  override get message() {
    const prefix = this.sshHttpStatus === null ? "" : `[ssh_http:${this.sshHttpStatus}] `;
    return `${prefix}SSH remote API request failed during ${this.operation}.`;
  }
}

const withLoopbackSshApi =
  <A, R>(
    operation: DesktopSshEnvironmentRequestOperation,
    use: (httpBaseUrl: string) => Effect.Effect<A, RemoteEnvironmentAuthError, R>,
  ) =>
  (httpBaseUrl: string): Effect.Effect<A, DesktopSshEnvironmentRequestError, R> =>
    resolveLoopbackSshHttpBaseUrl(httpBaseUrl).pipe(
      Effect.flatMap(use),
      Effect.mapError(
        (cause) =>
          new DesktopSshEnvironmentRequestError({
            operation,
            cause,
            sshHttpStatus: readSshHttpStatus(cause),
          }),
      ),
    );

export const fetchSshEnvironmentDescriptor = (httpBaseUrl: string) =>
  withLoopbackSshApi("fetch-environment-descriptor", (resolvedHttpBaseUrl) =>
    fetchRemoteEnvironmentDescriptor({ httpBaseUrl: resolvedHttpBaseUrl }),
  )(httpBaseUrl);

export const bootstrapSshBearerSession = (input: {
  readonly httpBaseUrl: string;
  readonly credential: string;
}) =>
  withLoopbackSshApi("bootstrap-bearer-session", (resolvedHttpBaseUrl) =>
    bootstrapRemoteBearerSession({
      httpBaseUrl: resolvedHttpBaseUrl,
      credential: input.credential,
    }),
  )(input.httpBaseUrl);

export const fetchSshSessionState = (input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}) =>
  withLoopbackSshApi("fetch-session-state", (resolvedHttpBaseUrl) =>
    fetchRemoteSessionState({
      httpBaseUrl: resolvedHttpBaseUrl,
      bearerToken: input.bearerToken,
    }),
  )(input.httpBaseUrl);

export const issueSshWebSocketTicket = (input: {
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
}) =>
  withLoopbackSshApi("issue-websocket-ticket", (resolvedHttpBaseUrl) =>
    issueRemoteWebSocketTicket({
      httpBaseUrl: resolvedHttpBaseUrl,
      bearerToken: input.bearerToken,
    }),
  )(input.httpBaseUrl);
