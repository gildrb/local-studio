import { PrimaryEnvironmentAuth } from "@t3tools/client-runtime/platform";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { Atom } from "effect/unstable/reactivity";

export class LocalRequestError extends Data.TaggedError("LocalRequestError")<{
  message: string;
}> {}

export type LocalStudioRequest = {
  readonly httpBaseUrl: string;
  readonly path: string;
  readonly controller: string;
  readonly body?: unknown;
};

export function createLocalStudioHttp<R, ER>(
  runtime: Atom.AtomRuntime<R | PrimaryEnvironmentAuth | HttpClient.HttpClient, ER>,
) {
  return createRuntimeCommand(runtime, {
    label: "local studio request",
    execute: (input: LocalStudioRequest) =>
      Effect.gen(function* () {
        const [route, query] = input.path.split("?");
        const url = new URL(`/api/local/${route}`, input.httpBaseUrl);
        url.search = query ?? "";
        if (input.controller) url.searchParams.set("controller", input.controller);
        const token = yield* (yield* PrimaryEnvironmentAuth).bearerToken;
        const base =
          input.body === undefined
            ? HttpClientRequest.get(url)
            : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(input.body));
        const request = Option.match(token, {
          onNone: () => base,
          onSome: (bearer) => HttpClientRequest.bearerToken(base, bearer),
        });
        const response = yield* (yield* HttpClient.HttpClient).execute(request);
        if (response.status < 400) return yield* response.json;
        const message = (yield* response.text) || `HTTP ${response.status}`;
        return yield* new LocalRequestError({ message });
      }).pipe(Effect.scoped, Effect.timeout("3 minutes")),
  });
}
