import type {
  BrowserNavigationTarget,
  EnvironmentId,
  PreviewUrlResolution,
} from "@t3tools/contracts";

import { readPreparedConnection } from "~/state/session";

import {
  resolveBrowserNavigationTargetWith,
  resolveDiscoveredServerUrlWith,
} from "./browserTargetResolver.logic";

export {
  normalizeHostname,
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
} from "@t3tools/shared/hostClassification";

const environmentUrlReader = (environmentId: EnvironmentId) => (): URL => {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error(`Environment ${environmentId} is not connected.`);
  return new URL(connection.httpBaseUrl);
};

export function resolveBrowserNavigationTarget(
  environmentId: EnvironmentId,
  target: BrowserNavigationTarget,
): PreviewUrlResolution {
  return resolveBrowserNavigationTargetWith(
    environmentId,
    target,
    environmentUrlReader(environmentId),
  );
}

export function resolveDiscoveredServerUrl(environmentId: EnvironmentId, rawUrl: string): string {
  return resolveDiscoveredServerUrlWith(environmentId, rawUrl, environmentUrlReader(environmentId));
}
