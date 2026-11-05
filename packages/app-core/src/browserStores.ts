import { createHash } from "node:crypto";
import * as Path from "node:path";

import { resolveDesktopStateDir } from "@t3tools/desktop/src/app/DesktopStatePaths.ts";
import { resolvePartitionScope } from "@t3tools/desktop/src/preview/PartitionScope.ts";
import * as Option from "effect/Option";

export type BrowserHostStore = {
  readonly id: string;
  readonly persistent: boolean;
  readonly dataDirectory: string;
};

const STORE_ID_BYTES = 16;

export function browserProfileStore(
  t3Home: string,
  environmentId: string,
  profileId: string | undefined,
): BrowserHostStore {
  const { scope, persistent } = resolvePartitionScope(environmentId, profileId);
  const id = createHash("sha256")
    .update(scope)
    .digest()
    .subarray(0, STORE_ID_BYTES)
    .toString("hex");
  return {
    id,
    persistent,
    dataDirectory: Path.join(
      resolveDesktopStateDir({
        baseDir: t3Home,
        isDevelopment: false,
        joinPath: Path.join,
        t3Home: Option.some(t3Home),
      }),
      "browser-profiles",
      id,
    ),
  };
}
