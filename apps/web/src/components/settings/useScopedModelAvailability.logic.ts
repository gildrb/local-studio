import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  ServerSettings,
  UnifiedSettings,
} from "@t3tools/contracts";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";

export type ScopedModelAvailabilityTarget = {
  readonly environmentId: EnvironmentId;
  readonly settings: ServerSettings;
};

export type ScopedModelAvailabilityEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly serverConfig: { readonly providers: ReadonlyArray<ServerProvider> } | null | undefined;
};

export type ScopedModelDisabledReasonInput = {
  readonly settings: UnifiedSettings;
  readonly entries: readonly ProviderInstanceEntry[];
  readonly targets: readonly ScopedModelAvailabilityTarget[];
  readonly environments: readonly ScopedModelAvailabilityEnvironment[];
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
};

export function resolveScopedModelDisabledReason(
  input: ScopedModelDisabledReasonInput,
): string | null {
  const sourceEntry = input.entries.find((entry) => entry.instanceId === input.instanceId);
  for (const candidate of input.targets) {
    const environment = input.environments.find(
      (entry) => entry.environmentId === candidate.environmentId,
    );
    const config = environment?.serverConfig;
    if (!config) continue;
    const entry = applyProviderInstanceSettings(
      deriveProviderInstanceEntries(config.providers),
      candidate.settings,
    ).find((option) => option.instanceId === input.instanceId);
    const options = getCustomModelOptionsByInstance(
      { ...input.settings, ...candidate.settings },
      config.providers,
    ).get(input.instanceId);
    if (
      !entry?.enabled ||
      !entry.isAvailable ||
      entry.driverKind !== sourceEntry?.driverKind ||
      !options?.some((option) => option.slug === input.model && !option.isUnavailable)
    ) {
      return `This model is unavailable on ${environment?.label ?? "a selected environment"}. Select that environment to choose its model separately.`;
    }
  }
  return null;
}
