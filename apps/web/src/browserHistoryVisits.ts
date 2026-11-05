import type { ScopedThreadRef } from "@t3tools/contracts";

import { readPreparedConnection } from "~/state/session";

import { recordVisitForThreadOnHost } from "./browserHistoryStore";

export function recordVisitForThread(ref: ScopedThreadRef, url: string, at?: number): void {
  const connection = readPreparedConnection(ref.environmentId);
  recordVisitForThreadOnHost(
    ref,
    url,
    connection ? new URL(connection.httpBaseUrl).hostname : null,
    at,
  );
}
