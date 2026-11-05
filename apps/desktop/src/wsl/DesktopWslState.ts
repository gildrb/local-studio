import type { DesktopWslState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { DesktopSettings } from "../settings/DesktopAppSettings.ts";
import type { DesktopWslEnvironment } from "./DesktopWslEnvironment.ts";

export const resolveDesktopWslState = Effect.fnUntraced(function* (input: {
  readonly settings: DesktopSettings;
  readonly wslEnvironment: DesktopWslEnvironment["Service"];
  readonly preflightError: Effect.Effect<Option.Option<string>>;
}) {
  const { settings, wslEnvironment } = input;
  const available = settings.localEnvironmentEnabled && (yield* wslEnvironment.isAvailable);
  // Only enumerate distros when WSL is actually available — listDistros on a
  // non-WSL host would spawn wsl.exe and hit the timeout for nothing.
  const distros = available ? yield* wslEnvironment.listDistros : [];
  const preflightError = yield* input.preflightError;
  return {
    enabled: settings.wslBackendEnabled,
    distro: settings.wslDistro,
    available,
    wslOnly: settings.wslOnly,
    distros,
    // Only the dual-mode secondary records this; a wsl-only failure surfaces via
    // a dialog + Windows fallback, so it stays null there.
    preflightError: settings.wslOnly ? null : Option.getOrNull(preflightError),
  } satisfies DesktopWslState;
});
