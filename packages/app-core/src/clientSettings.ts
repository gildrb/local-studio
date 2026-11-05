import * as Path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { resolveDesktopStateDir } from "@t3tools/desktop/src/app/DesktopStatePaths.ts";
import { makeAtPath } from "@t3tools/desktop/src/settings/DesktopClientSettings.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export async function openClientSettingsStore(t3Home: string) {
  const stateDir = resolveDesktopStateDir({
    baseDir: t3Home,
    isDevelopment: false,
    joinPath: Path.join,
    t3Home: Option.some(t3Home),
  });
  const service = await Effect.runPromise(
    makeAtPath(Path.join(stateDir, "client-settings.json")).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );
  const stored = await Effect.runPromise(service.get);
  return {
    initial: Option.getOrElse(stored, (): ClientSettings => DEFAULT_CLIENT_SETTINGS),
    save: (settings: ClientSettings) => Effect.runPromise(service.set(settings)),
  };
}
