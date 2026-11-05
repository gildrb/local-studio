import type { ProviderInstanceId, UnifiedSettings } from "@t3tools/contracts";
import { useCallback } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { useSettingsScope } from "./SettingsScopeContext";
import { resolveScopedModelDisabledReason } from "./useScopedModelAvailability.logic";

/**
 * A model choice fans out to every selected target, so it must exist on all
 * of them. Returns the reason a (instance, model) pair cannot be applied, or
 * null when every target can honor it. The representative's entries decide
 * which driver the instance id names.
 */
export function useScopedModelDisabledReason(
  settings: UnifiedSettings,
  entries: readonly ProviderInstanceEntry[],
) {
  const { targets } = useSettingsScope();
  const { environments } = useEnvironments();
  return useCallback(
    (instanceId: ProviderInstanceId, model: string): string | null =>
      resolveScopedModelDisabledReason({
        settings,
        entries,
        targets,
        environments,
        instanceId,
        model,
      }),
    [entries, environments, settings, targets],
  );
}
