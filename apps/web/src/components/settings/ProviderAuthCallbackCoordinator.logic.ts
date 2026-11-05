import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";

export type ProviderAuthDelivery = {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly flowId: string;
  readonly callbackUrl: string;
};

export type ProviderAuthCallbackEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
};

export function isProviderAuthDeliveryConnected(
  delivery: ProviderAuthDelivery | undefined,
  environments: readonly ProviderAuthCallbackEnvironment[],
): boolean {
  return environments.some(
    (environment) => environment.environmentId === delivery?.environmentId && environment.connected,
  );
}

export type ProviderAuthCompletion = {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly instanceId: ProviderInstanceId;
    readonly flowId: string;
    readonly callbackUrl: string;
  };
};

export function resolveProviderAuthCompletion(input: {
  readonly delivery: ProviderAuthDelivery | undefined;
  readonly started: boolean;
  readonly connected: boolean;
}): ProviderAuthCompletion | null {
  const { delivery } = input;
  if (!delivery || input.started || !input.connected) return null;
  return {
    environmentId: delivery.environmentId,
    input: {
      instanceId: delivery.instanceId,
      flowId: delivery.flowId,
      callbackUrl: delivery.callbackUrl,
    },
  };
}

export type ProviderAuthCallbackOutcome = "success" | "failure" | "error";

export type ProviderAuthCallbackFeedback =
  | { readonly kind: "none" }
  | { readonly kind: "error-toast"; readonly title: string; readonly description: string };

export function resolveProviderAuthCallbackFeedback(
  outcome: ProviderAuthCallbackOutcome,
): ProviderAuthCallbackFeedback {
  switch (outcome) {
    case "success":
      return { kind: "none" };
    case "failure":
      return {
        kind: "error-toast",
        title: "ChatGPT sign-in couldn't finish",
        description: "Return to the provider and try again.",
      };
    case "error":
      return {
        kind: "error-toast",
        title: "ChatGPT sign-in couldn't finish",
        description: "Reconnect to the environment and try again.",
      };
  }
}
