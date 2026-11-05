import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";

import type { EnvironmentPresentation } from "../../state/environments";
import { buildEnvironmentRowModel } from "./EnvironmentRow.logic";
import { searchableSetting } from "./settingsSearch";

export const LOAD_PREFERENCE_OPTIONS = [
  { value: 100, label: "Prefer" },
  { value: 50, label: "Normal" },
  { value: 25, label: "Less often" },
  { value: 0, label: "Manual only" },
] as const;

export type LoadPreference = (typeof LOAD_PREFERENCE_OPTIONS)[number]["value"];

export type LoadPreferenceOption = {
  readonly value: LoadPreference;
  readonly label: string;
};

/** Snaps a saved weight (older builds stored a slider value) onto the four preferences. */
export function loadPreferenceForWeight(weight: number | undefined): LoadPreference {
  if (weight === undefined || weight === 50) return 50;
  if (weight === 0) return 0;
  return weight < 50 ? 25 : 100;
}

function preferenceLabel(preference: LoadPreference): string {
  return LOAD_PREFERENCE_OPTIONS.find((entry) => entry.value === preference)?.label ?? "";
}

/**
 * Closed-header summary: the machines not at Normal, so the folded section
 * still tells you what is set. Null when every machine is at the default.
 */
export function summarizeLoadPreferences(
  environments: ReadonlyArray<Pick<EnvironmentPresentation, "environmentId" | "label">>,
  weights: Readonly<Record<string, number>>,
): string | null {
  const parts = environments.flatMap((environment) => {
    const preference = loadPreferenceForWeight(weights[environment.environmentId]);
    return preference === 50
      ? []
      : [`${environment.label} ${preferenceLabel(preference).toLowerCase()}`];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}

export type LoadBalancingSettingsModelInput = {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly loadBalancingEnabled: boolean;
  readonly loadBalancingWeights: Readonly<Record<string, number>>;
  readonly settingsHydrated: boolean;
};

export type LoadBalancingEnvironmentRow = {
  readonly id: EnvironmentId;
  readonly machineKind: EnvironmentMachineKind;
  readonly label: string;
  readonly subtitle: string;
  readonly value: LoadPreference;
  readonly ariaLabel: string;
  readonly disabled: boolean;
};

export type LoadBalancingSettingsModel = {
  readonly section: { readonly id: string; readonly title: string };
  readonly visible: boolean;
  readonly summary: string | null;
  readonly enabled: boolean;
  readonly toggleAriaLabel: string;
  readonly toggleDisabled: boolean;
  readonly description: string;
  readonly options: ReadonlyArray<LoadPreferenceOption>;
  readonly rows: ReadonlyArray<LoadBalancingEnvironmentRow>;
};

export function buildLoadBalancingSettingsModel(
  input: LoadBalancingSettingsModelInput,
): LoadBalancingSettingsModel {
  return {
    section: searchableSetting("load-balancing"),
    visible: input.environments.length >= 2,
    summary: input.loadBalancingEnabled
      ? summarizeLoadPreferences(input.environments, input.loadBalancingWeights)
      : "Off",
    enabled: input.loadBalancingEnabled,
    toggleAriaLabel: "Automatically balance load",
    toggleDisabled: !input.settingsHydrated,
    description:
      "New threads in shared projects start on the machine with the most free CPU and memory, weighted by each machine's preference.",
    options: LOAD_PREFERENCE_OPTIONS.map(({ value, label }) => ({ value, label })),
    rows: input.environments.map((environment) => {
      const row = buildEnvironmentRowModel({ environment });
      return {
        id: row.id,
        machineKind: row.kind,
        label: row.label,
        subtitle: row.subtitle,
        value: loadPreferenceForWeight(input.loadBalancingWeights[environment.environmentId]),
        ariaLabel: `${environment.label} load preference`,
        disabled: !input.settingsHydrated || !input.loadBalancingEnabled,
      };
    }),
  };
}

export type LoadBalancingChange =
  | { readonly kind: "set-enabled"; readonly enabled: boolean }
  | {
      readonly kind: "set-preference";
      readonly environmentId: EnvironmentId;
      readonly preference: LoadPreference | null;
    };

export type LoadBalancingSettingsPatch =
  | { readonly loadBalancingEnabled: boolean }
  | { readonly loadBalancingWeights: Record<string, number> };

export function resolveLoadBalancingChange(
  change: LoadBalancingChange,
  currentWeights: Readonly<Record<string, number>>,
): LoadBalancingSettingsPatch | null {
  if (change.kind === "set-enabled") {
    return { loadBalancingEnabled: change.enabled };
  }
  if (change.preference === null) return null;
  return {
    loadBalancingWeights: {
      ...currentWeights,
      [change.environmentId]: change.preference,
    },
  };
}
