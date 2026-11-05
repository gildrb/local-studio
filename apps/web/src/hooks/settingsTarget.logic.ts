import { type EnvironmentId, ServerSettings, type ServerSettingsPatch } from "@t3tools/contracts";
import type { ClientSettingsPatch } from "@t3tools/contracts/settings";
import {
  filterSharedServerPatch,
  splitSharedServerPatch,
  supportsSharedSettingsSync,
} from "@t3tools/client-runtime/state/shared-settings";
import * as Struct from "effect/Struct";

import { PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE } from "../components/settings/settingsLayout.logic";
import type { EnvironmentPresentation } from "../state/environments";

export type UnifiedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

export function splitSettingsPatch(patch: UnifiedSettingsPatch): {
  serverPatch: ServerSettingsPatch;
  clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

export type SettingsTargetWrite = {
  readonly environmentId: EnvironmentId;
  readonly patch: ServerSettingsPatch;
};

export type SettingsTargetUpdatePlan = {
  readonly serverWrites: ReadonlyArray<SettingsTargetWrite>;
  readonly clientPatch: ClientSettingsPatch | null;
  readonly unsavedWarnings: ReadonlyArray<string>;
};

/**
 * Routes each key of a unified patch to the store that owns it. Shared server
 * keys go to every eligible sync target, not only the selected one, so a user
 * preference does not silently drift between machines.
 */
export function planSettingsTargetUpdate(input: {
  readonly environmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<
    Pick<EnvironmentPresentation, "environmentId" | "connection" | "serverConfig">
  >;
  readonly patch: UnifiedSettingsPatch;
}): SettingsTargetUpdatePlan {
  const { environmentId, environments } = input;
  const { serverPatch, clientPatch } = splitSettingsPatch(input.patch);
  const serverWrites: SettingsTargetWrite[] = [];
  const unsavedWarnings: string[] = [];
  if (Object.keys(serverPatch).length > 0) {
    const { sharedPatch, localPatch } = splitSharedServerPatch(serverPatch);
    if (Object.keys(localPatch).length > 0) {
      if (environmentId) {
        serverWrites.push({ environmentId, patch: localPatch });
      } else {
        unsavedWarnings.push(PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE);
      }
    }
    if (Object.keys(sharedPatch).length > 0) {
      const sourceSettings = environments.find((target) => target.environmentId === environmentId)
        ?.serverConfig?.settings;
      const targets = new Set(
        environments.filter(supportsSharedSettingsSync).map((target) => target.environmentId),
      );
      if (environmentId) {
        targets.add(environmentId);
      }
      let wroteToTarget = false;
      for (const targetId of targets) {
        const target = environments.find((candidate) => candidate.environmentId === targetId);
        const targetPatch = filterSharedServerPatch(
          sharedPatch,
          target?.serverConfig?.environment.capabilities,
          target?.serverConfig?.settings,
          sourceSettings,
          targetId === environmentId,
        );
        if (Object.keys(targetPatch).length === 0) continue;
        wroteToTarget = true;
        serverWrites.push({ environmentId: targetId, patch: targetPatch });
      }
      if (!wroteToTarget) {
        unsavedWarnings.push(
          targets.size > 0
            ? "Update older servers to save this setting."
            : PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE,
        );
      }
    }
  }
  return {
    serverWrites,
    clientPatch: Object.keys(clientPatch).length > 0 ? clientPatch : null,
    unsavedWarnings,
  };
}
