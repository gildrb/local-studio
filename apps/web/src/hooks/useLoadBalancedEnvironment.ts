import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useContext, useMemo } from "react";

import { serverEnvironment } from "../state/server";
import {
  resolveLoadBalancedEnvironment,
  toLoadBalancedEnvironmentResource,
} from "./loadBalancedEnvironment.logic";

/** Only mounted for unresolved automatic drafts, so idle clients do not poll hosts. */
export function useLoadBalancedEnvironment(
  environmentIds: readonly EnvironmentId[],
  weights: Readonly<Record<string, number>>,
) {
  const registry = useContext(RegistryContext);
  const refresh = useCallback(
    (ids: readonly EnvironmentId[]) => {
      for (const environmentId of ids) {
        registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} }));
      }
    },
    [registry],
  );
  const resourcesAtom = useMemo(
    () =>
      Atom.make((get) =>
        environmentIds.map((environmentId) =>
          toLoadBalancedEnvironmentResource(
            environmentId,
            get(serverEnvironment.hostResources({ environmentId, input: {} })),
          ),
        ),
      ),
    [environmentIds],
  );
  const resources = useAtomValue(resourcesAtom);
  return {
    refresh,
    ...resolveLoadBalancedEnvironment({ resources, weights, now: Date.now() }),
  };
}
