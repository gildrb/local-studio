/**
 * Browser import reader - lists importable sources and reads their cookies
 * without touching any browser engine, so every host writes them its own way.
 *
 * @module BrowserImportReader
 */
import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
  BrowserImportUnavailableReason,
} from "@t3tools/contracts";
import { BrowserImportFailureReason } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessExecutablePath, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { ChromiumCookieReadError, readChromiumCookies } from "./ChromiumCookies.ts";
import type { CookieReadResult } from "./CookieDatabase.ts";
import { FirefoxCookieReadError, readFirefoxCookies } from "./FirefoxCookies.ts";
import { readSafariCookies, safariAccessDenied, SafariCookieReadError } from "./SafariCookies.ts";
import {
  BROWSER_IMPORT_SOURCES,
  resolveCookieDatabase,
  isSourceInstalled,
  isSourceRunning,
  listSourceProfiles,
  sourcePathContext,
  type BrowserImportPathContext,
  type BrowserImportSourceDefinition,
} from "./Sources.ts";

export class BrowserImportFailedError extends Schema.TaggedError<BrowserImportFailedError>()(
  "BrowserImportFailedError",
  {
    sourceId: Schema.String,
    reason: BrowserImportFailureReason,
    /** Kept for the log; the user only ever sees the reason's copy. */
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // The reason token is part of the message on purpose: IPC flattens the error
  // to its message, and the renderer maps that token back to user-facing copy.
  override get message(): string {
    return `Importing cookies from ${this.sourceId} failed: ${this.reason}.`;
  }
}

export type BrowserImportPlatformServices =
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner;

const unavailableReason = Effect.fn("BrowserImport.unavailableReason")(function* (
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Effect.fn.Return<
  BrowserImportUnavailableReason | undefined,
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  if (!definition.platforms.includes(context.platform)) return "unsupportedPlatform";
  if (!(yield* isSourceInstalled(definition, context))) return "notInstalled";
  if (yield* isSourceRunning(definition, context)) return "browserRunning";
  // Safari's jar is found by `stat`, which TCC permits without Full Disk
  // Access — so a Safari that lists as ready may still refuse the read. Probe
  // the grant here, so the wizard can open on the permission step and a
  // post-grant recheck can tell granted from still-denied, rather than only
  // discovering it by attempting the import.
  if (definition.engine === "safari") {
    const jar = yield* resolveCookieDatabase(definition, context, ".");
    if (jar !== undefined && (yield* safariAccessDenied(jar))) return "needsFullDiskAccess";
  }
  return undefined;
});

/** The host a constructed cookie URL points at, for naming what was skipped. */
const cookieHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** Tallies one write outcome per read cookie, in read order. */
export function summarizeCookieWrites(
  read: CookieReadResult,
  written: ReadonlyArray<boolean>,
): BrowserImportResult {
  let imported = 0;
  let skipped = read.undecryptable;
  const skippedDomains = new Set(read.undecryptableHosts);
  read.cookies.forEach((cookie, index) => {
    if (written[index] === true) {
      imported += 1;
    } else {
      skipped += 1;
      skippedDomains.add(cookieHost(cookie.url));
    }
  });
  return { imported, skipped, skippedDomains: [...skippedDomains].slice(0, 20) };
}

export const listBrowserImportSources = Effect.gen(function* () {
  const pathContext = yield* sourcePathContext;
  return yield* Effect.forEach(
    BROWSER_IMPORT_SOURCES,
    Effect.fnUntraced(function* (definition) {
      const unavailable = yield* unavailableReason(definition, pathContext);
      return {
        id: definition.id,
        name: definition.name,
        // Listing profiles touches the source's own files, so skip it when the
        // source is unusable anyway.
        profiles:
          unavailable === undefined ? yield* listSourceProfiles(definition, pathContext) : [],
        ...(unavailable === undefined ? {} : { unavailable }),
      } satisfies BrowserImportSource;
    }),
  );
});

export const readBrowserImportCookies = Effect.fn("BrowserImport.readCookies")(function* (
  input: BrowserImportInput,
): Effect.fn.Return<
  CookieReadResult,
  BrowserImportFailedError,
  BrowserImportPlatformServices | Scope.Scope
> {
  const platform = yield* HostProcessPlatform;
  const executablePath = yield* HostProcessExecutablePath;
  const pathContext = yield* sourcePathContext;
  const definition = BROWSER_IMPORT_SOURCES.find((candidate) => candidate.id === input.sourceId);
  if (!definition) {
    return yield* new BrowserImportFailedError({
      sourceId: input.sourceId,
      reason: "unknownSource",
    });
  }

  const blocked = yield* unavailableReason(definition, pathContext);
  if (blocked !== undefined) {
    return yield* new BrowserImportFailedError({ sourceId: definition.id, reason: blocked });
  }

  if (platform === "darwin" && definition.engine === "chromium") {
    // macOS attributes the Keychain prompt and the resulting ACL grant to the
    // executable that asks, so record which one that was — in a packaged build
    // it is the signed app, in dev whatever binary hosts the main process.
    yield* Effect.logInfo("Reading browser cookie key from the keychain", {
      sourceId: definition.id,
      executablePath,
    });
  }

  // The profile directory arrives over IPC, so it is only honoured when the
  // source itself reported it. Forwarding it unchecked would let `..`
  // segments walk out of the browser's user-data directory and read any
  // cookie database reachable on disk.
  const sourceProfiles = yield* listSourceProfiles(definition, pathContext);
  const requestedProfile = sourceProfiles.find(
    (profile) => profile.directory === input.sourceProfileDirectory,
  );
  if (requestedProfile === undefined) {
    return yield* new BrowserImportFailedError({
      sourceId: definition.id,
      reason: "unknownSourceProfile",
    });
  }

  // The profile was listed against a database moments ago; resolve it again
  // rather than assume a path, since a Chromium jar may sit under `Network/`.
  const databasePath = yield* resolveCookieDatabase(
    definition,
    pathContext,
    requestedProfile.directory,
  );
  if (databasePath === undefined) {
    // A profile we listed moments ago can lose its database before the
    // import runs (browser data cleanup, a profile reset). That is a read
    // failure, not a platform problem.
    return yield* new BrowserImportFailedError({ sourceId: definition.id, reason: "readFailed" });
  }

  // Both branches fail with a tagged error, so the union stays structurally
  // identifiable and each tag is handled on its own below. The success side
  // is normalized to one shape too, so the skipped tally survives either
  // engine — Firefox stores plaintext, so nothing there is ever unreadable.
  const userDataDirectory = definition.userDataDirectory(pathContext);
  const read: Effect.Effect<
    CookieReadResult,
    ChromiumCookieReadError | FirefoxCookieReadError | SafariCookieReadError,
    BrowserImportPlatformServices | Scope.Scope
  > =
    definition.engine === "safari"
      ? readSafariCookies(databasePath).pipe(
          Effect.map((cookies) => ({ cookies, undecryptable: 0, undecryptableHosts: [] })),
        )
      : definition.engine === "firefox"
        ? readFirefoxCookies(databasePath).pipe(
            Effect.map((cookies) => ({ cookies, undecryptable: 0, undecryptableHosts: [] })),
          )
        : readChromiumCookies({
            cookieDatabasePath: databasePath,
            keychainService: definition.keychainService,
            keychainAccount: definition.keychainAccount,
            linuxSecretApplication: definition.linuxSecretApplication,
            ...(platform === "win32" && userDataDirectory !== undefined
              ? {
                  windowsLocalStatePath: pathContext.path.join(userDataDirectory, "Local State"),
                }
              : {}),
            platform,
          });

  return yield* read.pipe(
    Effect.catchTags({
      ChromiumCookieReadError: (cause) =>
        Effect.fail(
          new BrowserImportFailedError({ sourceId: definition.id, reason: cause.reason, cause }),
        ),
      // Firefox has one failure mode — its plaintext database would not open
      // — so its error carries no reason of its own and the user-facing one
      // is supplied here.
      FirefoxCookieReadError: (cause) =>
        Effect.fail(
          new BrowserImportFailedError({ sourceId: definition.id, reason: "readFailed", cause }),
        ),
      // Safari's reasons are already user-facing: a TCC refusal is the Full
      // Disk Access prompt, anything else is a read failure.
      SafariCookieReadError: (cause) =>
        Effect.fail(
          new BrowserImportFailedError({ sourceId: definition.id, reason: cause.reason, cause }),
        ),
    }),
  );
});
