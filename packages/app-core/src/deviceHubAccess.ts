import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { resolveDeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import { EMPTY_DEVICE_STATE } from "./deviceState.ts";

/**
 * Hub access for one environment, as the web panel resolves it. Bearer and
 * DPoP connections mint a ticket here; a stream that gets a 401 back
 * refreshes this atom and reconnects. Keyed on the prepared connection so a
 * re-pair produces new credentials.
 */
export function createDeviceHubAccessAtoms<R, ER>(
  runtime: Atom.AtomRuntime<R | HttpClient.HttpClient, ER>,
  preparedConnectionValueAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<Option.Option<PreparedConnection>>,
) {
  return Atom.family((environmentId: EnvironmentId) =>
    runtime
      .atom((get) => {
        const prepared = Option.getOrNull(get(preparedConnectionValueAtom(environmentId)));
        if (prepared === null) return Effect.never;
        return resolveDeviceHubAccess({ prepared, hubBasePath: EMPTY_DEVICE_STATE.hubBasePath });
      })
      .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`device-hub-access:${environmentId}`)),
  );
}
