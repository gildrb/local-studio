import * as NodeServices from "@effect/platform-node/NodeServices";
import type { BrowserImportResult, BrowserImportSource, EnvironmentId } from "@t3tools/contracts";
import {
  BrowserImportFailedError,
  listBrowserImportSources as listSources,
  readBrowserImportCookies,
  summarizeCookieWrites,
} from "@t3tools/desktop/src/preview/BrowserImport/BrowserImportReader.ts";
import type { ImportedCookie } from "@t3tools/desktop/src/preview/BrowserImport/CookieDatabase.ts";
import { safariPermissionCheck } from "@t3tools/desktop/src/preview/BrowserImport/SafariPermission.ts";
import { MAC_PERMISSION_SETTINGS_URLS } from "@t3tools/desktop/src/permissions/MacPermission.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import type { BrowserHostCookie, BrowserPreviewService } from "./browserPreview.ts";
import { openExternal } from "./openExternal.ts";

async function run<A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(NodeServices.layer)));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

function hostCookie(cookie: ImportedCookie): BrowserHostCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? new URL(cookie.url).hostname,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    expires: cookie.expirationDate ?? null,
    sameSite: cookie.sameSite === "lax" || cookie.sameSite === "strict" ? cookie.sameSite : null,
  };
}

export function listBrowserImportSources(): Promise<ReadonlyArray<BrowserImportSource>> {
  return run(listSources);
}

export async function importBrowserCookies(
  preview: BrowserPreviewService,
  input: {
    readonly environmentId: EnvironmentId;
    readonly sourceId: BrowserImportSource["id"];
    readonly sourceProfileDirectory: string;
    readonly targetProfileId: string;
  },
): Promise<BrowserImportResult> {
  const read = await run(
    readBrowserImportCookies({
      sourceId: input.sourceId,
      sourceProfileDirectory: input.sourceProfileDirectory,
      targetProfileId: input.targetProfileId,
    }).pipe(Effect.scoped),
  );
  const written = await preview
    .setCookies(input.environmentId, input.targetProfileId, read.cookies.map(hostCookie))
    .catch((cause: unknown) => {
      throw new BrowserImportFailedError({
        sourceId: input.sourceId,
        reason: "sessionUnavailable",
        cause,
      });
    });
  return summarizeCookieWrites(read, written);
}

export async function checkFullDiskAccess(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const check = await run(safariPermissionCheck);
  return check();
}

export function openFullDiskAccessSettings(): Promise<void> {
  if (process.platform !== "darwin") {
    return Promise.reject(new Error("System Settings is only available on macOS."));
  }
  return openExternal(MAC_PERMISSION_SETTINGS_URLS["full-disk-access"]);
}
