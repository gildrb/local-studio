import { useMemo } from "react";

import type { EnvironmentId } from "@t3tools/contracts";
import { resolveDiscoveredServerUrl } from "~/browser/browserTargetResolver";
import { useDiscoveredPortsState } from "~/portDiscoveryState";

import { mergeServers, type PreviewableServer } from "./discoveredLocalServers.logic";

interface UseDiscoveredLocalServersInput {
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
}

/**
 * Enrich the environment-level live server snapshot with matching configured
 * URLs and return a stable sorted list.
 */
export function useDiscoveredLocalServers(
  input: UseDiscoveredLocalServersInput,
): ReadonlyArray<PreviewableServer> {
  const scannerState = useDiscoveredPortsState(input.environmentId, input.configuredUrls);

  return useMemo(
    () =>
      mergeServers({
        scanner: scannerState.servers.map((server) => ({
          ...server,
          url: resolveDiscoveredServerUrl(input.environmentId, server.url),
          requestedUrl: server.url,
        })),
        configuredUrls: input.configuredUrls ?? [],
        configuredUrlProbing: scannerState.configuredUrlProbing,
      }),
    [input.environmentId, scannerState, input.configuredUrls],
  );
}
