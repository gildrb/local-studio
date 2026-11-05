/**
 * Browser import service - lists importable sources and writes their cookies
 * into a T3 Code browser profile's Electron partition.
 *
 * @module BrowserImport
 */
import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type { Session } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as BrowserSession from "../BrowserSession.ts";
import type { CookieReadResult } from "./CookieDatabase.ts";
import {
  BrowserImportFailedError,
  listBrowserImportSources,
  readBrowserImportCookies,
  summarizeCookieWrites,
  type BrowserImportPlatformServices,
} from "./BrowserImportReader.ts";

export class BrowserCookieWriteError extends Schema.TaggedError<BrowserCookieWriteError>()(
  "BrowserCookieWriteError",
  {
    url: Schema.String,
    name: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not write imported cookie ${this.name} for ${this.url}.`;
  }
}

export class BrowserImport extends Context.Service<
  BrowserImport,
  {
    readonly listSources: Effect.Effect<ReadonlyArray<BrowserImportSource>>;
    readonly importCookies: (input: {
      readonly input: BrowserImportInput;
      /** Partition scope of the target profile, derived by the caller in main. */
      readonly scope: string;
      readonly persistent: boolean;
      readonly namespace?: BrowserSession.BrowserSessionPartitionNamespace;
    }) => Effect.Effect<BrowserImportResult, BrowserImportFailedError>;
  }
>()("@t3tools/desktop/preview/BrowserImport/BrowserImport") {}

export const writeCookies = Effect.fn("BrowserImport.writeCookies")(function* (
  session: { readonly cookies: Pick<Session["cookies"], "set" | "flushStore"> },
  read: CookieReadResult,
) {
  const written: boolean[] = [];
  for (const cookie of read.cookies) {
    written.push(
      yield* Effect.tryPromise({
        try: () =>
          session.cookies.set({
            url: cookie.url,
            name: cookie.name,
            value: cookie.value,
            // Omitted for host-only cookies: Electron reads any `domain` as a
            // domain cookie and re-adds the leading dot, widening its scope.
            ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
            ...(cookie.expirationDate === undefined
              ? {}
              : { expirationDate: cookie.expirationDate }),
          }),
        catch: (cause) =>
          new BrowserCookieWriteError({ url: cookie.url, name: cookie.name, cause }),
      }).pipe(
        Effect.as(true),
        Effect.tapError((error) => Effect.logDebug(error.message, { cause: error.cause })),
        Effect.catchTags({ BrowserCookieWriteError: () => Effect.succeed(false) }),
      ),
    );
  }
  const result = summarizeCookieWrites(read, written);
  // `set` resolves once the cookie is in memory; Chromium writes the store to
  // disk on its own schedule. Flush before reporting "Done", so a crash right
  // after does not lose what the user was just told was imported. A failed
  // flush is logged rather than surfaced: the cookies are still in the
  // session and land on disk at the next scheduled write.
  if (result.imported > 0) {
    yield* Effect.tryPromise(() => session.cookies.flushStore()).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Imported cookies could not be flushed to disk", { cause: error.cause }),
      ),
      Effect.ignore,
    );
  }
  return result;
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* BrowserImportMake() {
  const browserSession = yield* BrowserSession.BrowserSession;
  // Captured here so the service's methods stay free of a requirements
  // channel: the layer is built where NodeServices is already in scope.
  const platformServices = yield* Effect.context<BrowserImportPlatformServices>();
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  const executablePath = yield* HostProcessExecutablePath;
  const provideHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(HostProcessPlatform, platform),
      Effect.provideService(HostProcessEnvironment, environment),
      Effect.provideService(HostProcessExecutablePath, executablePath),
    );

  const listSources: Effect.Effect<ReadonlyArray<BrowserImportSource>> =
    listBrowserImportSources.pipe(provideHost, Effect.provide(platformServices));

  const importCookies = Effect.fn("BrowserImport.importCookies")(function* (input: {
    readonly input: BrowserImportInput;
    readonly scope: string;
    readonly persistent: boolean;
    readonly namespace?: BrowserSession.BrowserSessionPartitionNamespace;
  }) {
    const result = yield* readBrowserImportCookies(input.input).pipe(
      Effect.scoped,
      provideHost,
      Effect.provide(platformServices),
    );

    const session = yield* browserSession
      .getSession(input.scope, input.persistent, input.namespace)
      .pipe(
        Effect.mapError(
          (cause) =>
            new BrowserImportFailedError({
              sourceId: input.input.sourceId,
              reason: "sessionUnavailable",
              cause,
            }),
        ),
      );

    // Written one at a time rather than in parallel: Chromium's cookie store
    // serialises writes anyway, and a rejected cookie should only cost itself.
    return yield* writeCookies(session, result);
  });

  return BrowserImport.of({ listSources, importCookies });
});

export const layer = Layer.effect(BrowserImport, make);
