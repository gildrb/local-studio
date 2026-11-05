import { readFile, rm } from "node:fs/promises";
import * as Path from "node:path";

import {
  ConnectionPersistenceError,
  EnvironmentCacheStore,
  encodeShellSnapshotForCache,
} from "@t3tools/client-runtime/platform";
import {
  type EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
  ServerConfig,
  VcsListRefsResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { writeFileAtomically } from "../storage/fileStorage.ts";

const SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION = 1;
const THREAD_SNAPSHOT_CACHE_SCHEMA_VERSION = 4;
const SERVER_CONFIG_CACHE_SCHEMA_VERSION = 1;
const VCS_REFS_CACHE_SCHEMA_VERSION = 1;

const StoredShellSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION),
  environmentId: Schema.String,
  snapshot: OrchestrationShellSnapshot,
});
const StoredThreadSnapshot = Schema.Struct({
  schemaVersion: Schema.Literal(THREAD_SNAPSHOT_CACHE_SCHEMA_VERSION),
  environmentId: Schema.String,
  threadId: Schema.String,
  snapshot: OrchestrationThreadDetailSnapshot,
});
const StoredServerConfig = Schema.Struct({
  schemaVersion: Schema.Literal(SERVER_CONFIG_CACHE_SCHEMA_VERSION),
  environmentId: Schema.String,
  config: ServerConfig,
});
const StoredVcsRefs = Schema.Struct({
  schemaVersion: Schema.Literal(VCS_REFS_CACHE_SCHEMA_VERSION),
  environmentId: Schema.String,
  cwd: Schema.String,
  refs: VcsListRefsResult,
});

const decodeStoredShellSnapshot = Schema.decodeUnknownEffect(
  Schema.fromJsonString(StoredShellSnapshot),
);
const decodeStoredThreadSnapshot = Schema.decodeUnknownEffect(
  Schema.fromJsonString(StoredThreadSnapshot),
);
const encodeStoredThreadSnapshot = Schema.encodeEffect(Schema.fromJsonString(StoredThreadSnapshot));
const decodeStoredServerConfig = Schema.decodeUnknownEffect(
  Schema.fromJsonString(StoredServerConfig),
);
const encodeStoredServerConfig = Schema.encodeEffect(Schema.fromJsonString(StoredServerConfig));
const decodeStoredVcsRefs = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredVcsRefs));
const encodeStoredVcsRefs = Schema.encodeEffect(Schema.fromJsonString(StoredVcsRefs));

type CacheOperation = ConnectionPersistenceError["operation"];
type CacheKind = "shell" | "thread" | "server-config" | "vcs-refs";

function persistenceError(operation: CacheOperation, cause: unknown) {
  return new ConnectionPersistenceError({
    operation,
    message: `Could not ${operation.replaceAll("-", " ")}: ${String(cause)}`,
  });
}

export const make = (rootDirectory: string) => {
  const environmentDirectory = (environmentId: EnvironmentId) =>
    Path.join(rootDirectory, encodeURIComponent(environmentId));
  const recordPath = (environmentId: EnvironmentId, kind: CacheKind, cacheKey: string) =>
    Path.join(environmentDirectory(environmentId), kind, `${encodeURIComponent(cacheKey)}.json`);

  const removeRecord = (
    operation: CacheOperation,
    environmentId: EnvironmentId,
    kind: CacheKind,
    cacheKey: string,
  ) =>
    Effect.tryPromise({
      try: () => rm(recordPath(environmentId, kind, cacheKey), { force: true }),
      catch: (cause) => persistenceError(operation, cause),
    });

  const removeDirectory = (operation: CacheOperation, directory: string) =>
    Effect.tryPromise({
      try: () => rm(directory, { recursive: true, force: true }),
      catch: (cause) => persistenceError(operation, cause),
    });

  const saveRecord = (
    operation: CacheOperation,
    environmentId: EnvironmentId,
    kind: CacheKind,
    cacheKey: string,
    payload: string,
  ) =>
    Effect.try({
      try: () => writeFileAtomically(recordPath(environmentId, kind, cacheKey), payload),
      catch: (cause) => persistenceError(operation, cause),
    });

  const loadDecoded = <A, B>(input: {
    readonly environmentId: EnvironmentId;
    readonly kind: CacheKind;
    readonly cacheKey: string;
    readonly operation: CacheOperation;
    readonly decode: (raw: string) => Effect.Effect<A, unknown>;
    readonly select: (value: A) => Option.Option<B>;
  }): Effect.Effect<Option.Option<B>, ConnectionPersistenceError> =>
    Effect.tryPromise({
      try: () => readFile(recordPath(input.environmentId, input.kind, input.cacheKey), "utf8"),
      catch: (cause) => cause,
    }).pipe(
      Effect.map(Option.some),
      Effect.catch((cause) =>
        (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(persistenceError(input.operation, cause)),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(Option.none<B>()),
          onSome: (raw) =>
            input.decode(raw).pipe(
              Effect.map(input.select),
              Effect.catch((cause) =>
                Effect.logWarning("Discarding corrupt client cache record.", {
                  environmentId: input.environmentId,
                  kind: input.kind,
                  cause: String(cause),
                }).pipe(
                  Effect.andThen(
                    removeRecord(
                      input.operation,
                      input.environmentId,
                      input.kind,
                      input.cacheKey,
                    ).pipe(Effect.catch(() => Effect.void)),
                  ),
                  Effect.as(Option.none<B>()),
                ),
              ),
            ),
        }),
      ),
    );

  return EnvironmentCacheStore.of({
    loadShell: (environmentId) =>
      loadDecoded({
        environmentId,
        kind: "shell",
        cacheKey: "snapshot",
        operation: "load-shell",
        decode: decodeStoredShellSnapshot,
        select: (stored) =>
          stored.environmentId === environmentId ? Option.some(stored.snapshot) : Option.none(),
      }),
    saveShell: Effect.fn("gpuiCore.environmentCache.saveShell")(
      function* (environmentId, snapshot) {
        const encodedSnapshot = yield* encodeShellSnapshotForCache(snapshot).pipe(
          Effect.mapError((cause) => persistenceError("save-shell", cause)),
        );
        const payload = yield* Effect.try({
          try: () =>
            JSON.stringify({
              schemaVersion: SHELL_SNAPSHOT_CACHE_SCHEMA_VERSION,
              environmentId,
              snapshot: encodedSnapshot,
            } satisfies typeof StoredShellSnapshot.Encoded),
          catch: (cause) => persistenceError("save-shell", cause),
        });
        yield* saveRecord("save-shell", environmentId, "shell", "snapshot", payload);
      },
    ),
    loadThread: (environmentId, threadId) =>
      loadDecoded({
        environmentId,
        kind: "thread",
        cacheKey: threadId,
        operation: "load-thread",
        decode: decodeStoredThreadSnapshot,
        select: (stored) =>
          stored.environmentId === environmentId && stored.threadId === threadId
            ? Option.some(stored.snapshot)
            : Option.none(),
      }),
    saveThread: Effect.fn("gpuiCore.environmentCache.saveThread")(
      function* (environmentId, snapshot) {
        const threadId = snapshot.thread.id;
        const payload = yield* encodeStoredThreadSnapshot({
          schemaVersion: THREAD_SNAPSHOT_CACHE_SCHEMA_VERSION,
          environmentId,
          threadId,
          snapshot,
        }).pipe(Effect.mapError((cause) => persistenceError("save-thread", cause)));
        yield* saveRecord("save-thread", environmentId, "thread", threadId, payload);
      },
    ),
    removeThread: (environmentId, threadId) =>
      removeRecord("remove-thread", environmentId, "thread", threadId),
    loadServerConfig: (environmentId) =>
      loadDecoded({
        environmentId,
        kind: "server-config",
        cacheKey: "config",
        operation: "load-server-config",
        decode: decodeStoredServerConfig,
        select: (stored) =>
          stored.environmentId === environmentId ? Option.some(stored.config) : Option.none(),
      }),
    saveServerConfig: Effect.fn("gpuiCore.environmentCache.saveServerConfig")(
      function* (environmentId, config) {
        const payload = yield* encodeStoredServerConfig({
          schemaVersion: SERVER_CONFIG_CACHE_SCHEMA_VERSION,
          environmentId,
          config,
        }).pipe(Effect.mapError((cause) => persistenceError("save-server-config", cause)));
        yield* saveRecord("save-server-config", environmentId, "server-config", "config", payload);
      },
    ),
    loadVcsRefs: (environmentId, cwd) =>
      loadDecoded({
        environmentId,
        kind: "vcs-refs",
        cacheKey: cwd,
        operation: "load-vcs-refs",
        decode: decodeStoredVcsRefs,
        select: (stored) =>
          stored.environmentId === environmentId && stored.cwd === cwd
            ? Option.some(stored.refs)
            : Option.none(),
      }),
    saveVcsRefs: Effect.fn("gpuiCore.environmentCache.saveVcsRefs")(
      function* (environmentId, cwd, refs) {
        const payload = yield* encodeStoredVcsRefs({
          schemaVersion: VCS_REFS_CACHE_SCHEMA_VERSION,
          environmentId,
          cwd,
          refs,
        }).pipe(Effect.mapError((cause) => persistenceError("save-vcs-refs", cause)));
        yield* saveRecord("save-vcs-refs", environmentId, "vcs-refs", cwd, payload);
      },
    ),
    removeVcsRefs: (environmentId, cwd) =>
      removeRecord("remove-vcs-refs", environmentId, "vcs-refs", cwd),
    clearVcsRefs: (environmentId) =>
      removeDirectory("clear-vcs-refs", Path.join(environmentDirectory(environmentId), "vcs-refs")),
    clear: (environmentId) =>
      removeDirectory("clear-environment", environmentDirectory(environmentId)),
  });
};
