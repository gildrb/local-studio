import { readFile } from "node:fs/promises";

import {
  ConnectionCatalogDocument,
  type ConnectionCatalogDocument as ConnectionCatalogDocumentType,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileAtomically } from "../storage/fileStorage.ts";

function catalogError(operation: string, cause: unknown) {
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not ${operation} the local connection catalog: ${String(cause)}`,
  });
}

const ConnectionCatalogDocumentJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeConnectionCatalogDocument = Schema.decodeEffect(ConnectionCatalogDocumentJson);
const encodeConnectionCatalogDocument = Schema.encodeEffect(ConnectionCatalogDocumentJson);

export interface CatalogStore {
  readonly read: Effect.Effect<ConnectionCatalogDocumentType, ConnectionTransientError>;
  readonly update: (
    transform: (catalog: ConnectionCatalogDocumentType) => ConnectionCatalogDocumentType,
  ) => Effect.Effect<void, ConnectionTransientError>;
}

export const make = Effect.fn("gpuiCore.connectionStorage.makeCatalogStore")(function* (
  filePath: string,
) {
  const state = yield* Ref.make<Option.Option<ConnectionCatalogDocumentType>>(Option.none());
  const lock = yield* Semaphore.make(1);

  const readRaw = Effect.tryPromise({
    try: () => readFile(filePath, "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) =>
      (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
        ? Effect.succeed(null)
        : Effect.fail(catalogError("load", cause)),
    ),
  );

  const loadUnlocked = Effect.gen(function* () {
    const cached = yield* Ref.get(state);
    if (Option.isSome(cached)) return cached.value;
    const raw = yield* readRaw;
    const catalog =
      raw === null || raw.trim() === ""
        ? EMPTY_CONNECTION_CATALOG_DOCUMENT
        : yield* decodeConnectionCatalogDocument(raw).pipe(
            Effect.catch((error) =>
              Effect.logWarning("Discarding corrupt connection catalog", error).pipe(
                Effect.as(EMPTY_CONNECTION_CATALOG_DOCUMENT),
              ),
            ),
          );
    yield* Ref.set(state, Option.some(catalog));
    return catalog;
  });

  const read = lock.withPermits(1)(loadUnlocked);
  const update: CatalogStore["update"] = Effect.fn("gpuiCore.connectionStorage.updateCatalog")(
    function* (transform) {
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const next = transform(yield* loadUnlocked);
          const encoded = yield* encodeConnectionCatalogDocument(next).pipe(
            Effect.mapError((cause) => catalogError("encode", cause)),
          );
          yield* Effect.try({
            try: () => writeFileAtomically(filePath, encoded),
            catch: (cause) => catalogError("save", cause),
          });
          yield* Ref.set(state, Option.some(next));
        }),
      );
    },
  );

  return { read, update } satisfies CatalogStore;
});
