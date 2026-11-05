import { useMemo } from "react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "~/hooks/useSettings";
import type { EnvironmentPresentation } from "~/state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { EnvironmentRow } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import {
  buildLoadBalancingSettingsModel,
  type LoadBalancingChange,
  resolveLoadBalancingChange,
} from "./LoadBalancingSettings.logic";

/**
 * Folded section under the environments list. Its switch turns balancing on
 * for this client, and the body holds one row per switched-on machine with
 * how often that machine should receive new threads. Rendered only when two
 * or more machines are on, since one machine has nothing to balance against.
 */
export function LoadBalancingSettings({
  environments,
}: {
  environments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const settings = useClientSettings();
  const settingsHydrated = useClientSettingsHydrated();
  const updateSettings = useUpdateClientSettings();
  const model = useMemo(
    () =>
      buildLoadBalancingSettingsModel({
        environments,
        loadBalancingEnabled: settings.loadBalancingEnabled,
        loadBalancingWeights: settings.loadBalancingWeights,
        settingsHydrated,
      }),
    [environments, settings.loadBalancingEnabled, settings.loadBalancingWeights, settingsHydrated],
  );

  if (!model.visible) return null;

  const applyChange = (change: LoadBalancingChange) => {
    const patch = resolveLoadBalancingChange(change, settings.loadBalancingWeights);
    if (patch) updateSettings(patch);
  };

  return (
    <FoldedSettingsSection
      id={model.section.id}
      title={model.section.title}
      summary={model.summary}
      control={
        <Switch
          aria-label={model.toggleAriaLabel}
          checked={model.enabled}
          disabled={model.toggleDisabled}
          onCheckedChange={(enabled) => applyChange({ kind: "set-enabled", enabled })}
        />
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">{model.description}</p>
      {model.rows.map((row) => (
        <EnvironmentRow
          key={row.id}
          kind={row.machineKind}
          label={row.label}
          subtitle={row.subtitle}
        >
          <Select
            items={model.options}
            value={row.value}
            disabled={row.disabled}
            onValueChange={(preference) =>
              applyChange({ kind: "set-preference", environmentId: row.id, preference })
            }
          >
            <SelectTrigger size="xs" className="w-32" aria-label={row.ariaLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {model.options.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </EnvironmentRow>
      ))}
    </FoldedSettingsSection>
  );
}
