import { PrimaryEnvironmentAuth } from "@t3tools/client-runtime/platform";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { AuthEnvironmentScope, AuthSessionId } from "@t3tools/contracts";
import { pairingCredentialRequestPayload } from "@t3tools/web/src/environments/primary/requestError.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/unstable/http";
import type { Atom } from "effect/unstable/reactivity";

const withPrimaryClient = (httpBaseUrl: string) =>
  Effect.gen(function* () {
    const token = yield* (yield* PrimaryEnvironmentAuth).bearerToken;
    const client = yield* makeEnvironmentHttpApiClient(httpBaseUrl);
    const headers = Option.match(token, {
      onNone: () => ({}),
      onSome: (bearer) => ({ authorization: `Bearer ${bearer}` }),
    });
    return { client, headers };
  });

export function createPrimaryAuthHttp<R, ER>(
  runtime: Atom.AtomRuntime<R | PrimaryEnvironmentAuth | HttpClient.HttpClient, ER>,
) {
  return {
    createPairingCredential: createRuntimeCommand(runtime, {
      label: "primary auth: create pairing credential",
      execute: (input: {
        readonly httpBaseUrl: string;
        readonly label: string;
        readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
      }) =>
        Effect.flatMap(withPrimaryClient(input.httpBaseUrl), ({ client, headers }) =>
          client.auth.pairingCredential({
            headers,
            payload: pairingCredentialRequestPayload({ label: input.label, scopes: input.scopes }),
          }),
        ),
    }),
    revokePairingLink: createRuntimeCommand(runtime, {
      label: "primary auth: revoke pairing link",
      execute: (input: { readonly httpBaseUrl: string; readonly id: string }) =>
        Effect.flatMap(withPrimaryClient(input.httpBaseUrl), ({ client, headers }) =>
          client.auth.revokePairingLink({ headers, payload: { id: input.id } }),
        ),
    }),
    revokeClient: createRuntimeCommand(runtime, {
      label: "primary auth: revoke client",
      execute: (input: { readonly httpBaseUrl: string; readonly sessionId: AuthSessionId }) =>
        Effect.flatMap(withPrimaryClient(input.httpBaseUrl), ({ client, headers }) =>
          client.auth.revokeClient({ headers, payload: { sessionId: input.sessionId } }),
        ),
    }),
    revokeOtherClients: createRuntimeCommand(runtime, {
      label: "primary auth: revoke other clients",
      execute: (input: { readonly httpBaseUrl: string }) =>
        Effect.flatMap(withPrimaryClient(input.httpBaseUrl), ({ client, headers }) =>
          client.auth.revokeOtherClients({ headers }),
        ),
    }),
  };
}
