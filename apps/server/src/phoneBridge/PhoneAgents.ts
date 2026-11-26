import {
  isProviderAvailable,
  type ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import type {
  AlleycatAgentCapabilities,
  AlleycatAgentInfo,
  AlleycatAgentPresentation,
} from "./PhoneWire.ts";

const DRIVER_SORT_ORDER: ReadonlyArray<string> = ["eukhe", "pi", "omp", "codex", "claude"];

const driverSortOrder = (driverKind: ProviderDriverKind): number => {
  const index = DRIVER_SORT_ORDER.indexOf(driverKind);
  return index === -1 ? DRIVER_SORT_ORDER.length + driverKind.length : index;
};

export interface PhoneAgentSource {
  readonly instance: ProviderInstance;
  readonly snapshot: ServerProvider;
}

export interface PhoneAgent {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly info: AlleycatAgentInfo;
}

export const agentsFromSources = (
  sources: ReadonlyArray<PhoneAgentSource>,
): ReadonlyArray<PhoneAgent> =>
  sources.map(({ instance, snapshot }): PhoneAgent => {
    const displayName = instance.displayName ?? snapshot.displayName ?? instance.driverKind;
    const presentation: AlleycatAgentPresentation = {
      title: displayName,
      is_beta: instance.driverKind === "eukhe",
      sort_order: driverSortOrder(instance.driverKind),
      description: `Local ${displayName} provider instance ${instance.instanceId}`,
      aliases: [],
    };
    const capabilities: AlleycatAgentCapabilities = {
      locks_reasoning_effort_after_activity: false,
      supports_ssh_bridge: false,
      uses_direct_codex_port: false,
      supports_thread_permission_overrides: false,
      reports_effective_thread_permissions: false,
    };
    return {
      instanceId: instance.instanceId,
      info: {
        name: instance.driverKind,
        display_name: displayName,
        wire: "jsonl",
        available:
          snapshot.installed &&
          isProviderAvailable(snapshot) &&
          snapshot.auth.status !== "unauthenticated",
        presentation,
        capabilities,
      },
    };
  });

export const resolveAgent = (
  agents: ReadonlyArray<PhoneAgent>,
  agent: string,
): PhoneAgent | undefined =>
  agents.find((candidate) => candidate.info.name === agent) ??
  agents.find((candidate) => candidate.info.display_name.toLowerCase() === agent.toLowerCase()) ??
  agents.find((candidate) => candidate.instanceId === agent);

const effortsForCapabilities = (capabilities: unknown): ReadonlyArray<string> => {
  if (typeof capabilities !== "object" || capabilities === null) return [];
  const record = capabilities as Record<string, unknown>;
  const efforts = record["reasoningEfforts"] ?? record["reasoning_efforts"];
  return Array.isArray(efforts)
    ? efforts.filter((effort): effort is string => typeof effort === "string")
    : [];
};

export interface PhoneModelEntry {
  readonly slug: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly efforts: ReadonlyArray<string>;
}

export const modelsFromProvider = (provider: ServerProvider): ReadonlyArray<PhoneModelEntry> =>
  provider.models
    .filter((model) => !model.isLegacy)
    .map((model) => ({
      slug: model.slug,
      name: model.name,
      isDefault: model.isDefault === true,
      efforts: effortsForCapabilities(model.capabilities),
    }));
