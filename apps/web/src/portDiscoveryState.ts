import type { DiscoveredLocalServer, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";

import { boundConfiguredLocalServerUrls } from "./portDiscovery.logic";
import { previewEnvironment } from "./state/preview";
import { useEnvironmentQuery } from "./state/query";

const EMPTY_PORTS: ReadonlyArray<DiscoveredLocalServer> = Object.freeze([]);

interface DiscoveredPortsState {
  readonly servers: ReadonlyArray<DiscoveredLocalServer>;
  readonly configuredUrlProbing: boolean;
}

function useDiscoveredPorts(
  environmentId: EnvironmentId | null,
  configuredUrls?: ReadonlyArray<string>,
): ReadonlyArray<DiscoveredLocalServer> {
  return useDiscoveredPortsState(environmentId, configuredUrls).servers;
}

export function useDiscoveredPortsState(
  environmentId: EnvironmentId | null,
  configuredUrls?: ReadonlyArray<string>,
): DiscoveredPortsState {
  const boundedConfiguredUrls = boundConfiguredLocalServerUrls(configuredUrls);
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : previewEnvironment.discoveredServers({
          environmentId,
          input: boundedConfiguredUrls.length ? { configuredUrls: boundedConfiguredUrls } : {},
        }),
  );
  return useMemo(
    () => ({
      servers: query.data?.servers ?? EMPTY_PORTS,
      configuredUrlProbing: query.data?.configuredUrlProbing === true,
    }),
    [query.data?.configuredUrlProbing, query.data?.servers],
  );
}

export function useThreadDiscoveredPorts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<DiscoveredLocalServer> {
  const ports = useDiscoveredPorts(input.environmentId);
  return useMemo(
    () =>
      input.threadId
        ? ports.filter((port) => port.terminal?.threadId === input.threadId)
        : EMPTY_PORTS,
    [input.threadId, ports],
  );
}
