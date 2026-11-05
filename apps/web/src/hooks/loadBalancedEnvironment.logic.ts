import { chooseLoadBalancedEnvironment } from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import type { AsyncResult } from "effect/unstable/reactivity";

export interface LoadBalancedEnvironmentResource {
  readonly environmentId: EnvironmentId;
  readonly resources: HostResourcesSnapshot | null;
  readonly receivedAt: number;
  readonly pending: boolean;
  readonly failed: boolean;
}

export interface LoadBalancedEnvironmentState {
  readonly pending: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly failed: boolean;
}

export function toLoadBalancedEnvironmentResource<E>(
  environmentId: EnvironmentId,
  result: AsyncResult.AsyncResult<HostResourcesSnapshot, E>,
): LoadBalancedEnvironmentResource {
  return {
    environmentId,
    resources: result._tag === "Success" ? result.value : null,
    receivedAt: result._tag === "Success" ? result.timestamp : 0,
    pending: result._tag === "Initial" || result.waiting,
    failed: result._tag === "Failure",
  };
}

export function resolveLoadBalancedEnvironment(input: {
  resources: ReadonlyArray<LoadBalancedEnvironmentResource>;
  weights: Readonly<Record<string, number>>;
  now: number;
}): LoadBalancedEnvironmentState {
  const pending = input.resources.some((resource) => resource.pending);
  const chosen = chooseLoadBalancedEnvironment(
    input.resources.map((resource) => ({
      ...resource,
      weight: input.weights[resource.environmentId] ?? 50,
    })),
    input.now,
  );
  const environmentId =
    chosen === null
      ? null
      : (input.resources.find((resource) => resource.environmentId === chosen)?.environmentId ??
        null);
  return {
    pending,
    environmentId,
    failed:
      !pending && environmentId === null && input.resources.some((resource) => resource.failed),
  };
}
