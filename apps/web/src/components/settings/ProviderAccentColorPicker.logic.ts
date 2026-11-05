import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";

export const FALLBACK_PROVIDER_ACCENT_COLOR = "#2563eb";

const PROVIDER_ACCENT_HEX_PATTERN = /^#[\da-f]{6}$/i;

export type ProviderAccentColorPickerLayout = "stacked" | "inline";

export type ProviderAccentColorPickerModelInput = {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly description: string | undefined;
  readonly layout: ProviderAccentColorPickerLayout;
};

export type ProviderAccentColorPickerModel = {
  readonly layout: ProviderAccentColorPickerLayout;
  readonly label: string;
  readonly description: string | null;
  readonly value: string | null;
  readonly swatchColor: string;
  readonly triggerAriaLabel: string;
  readonly triggerIcon: "pipette";
  readonly planeLabel: string;
  readonly hueLabel: string;
  readonly hexInputAriaLabel: string;
  readonly clearLabel: string;
  readonly clearIcon: "x";
  readonly clearDisabled: boolean;
};

export function buildProviderAccentColorPickerModel(
  input: ProviderAccentColorPickerModelInput,
): ProviderAccentColorPickerModel {
  const value = normalizeProviderAccentColor(input.value) ?? null;
  return {
    layout: input.layout,
    label: "Accent color",
    description: input.description || null,
    value,
    swatchColor: value ?? FALLBACK_PROVIDER_ACCENT_COLOR,
    triggerAriaLabel: `Choose accent color for ${input.displayName}`,
    triggerIcon: "pipette",
    planeLabel: "Accent color",
    hueLabel: "Accent color hue",
    hexInputAriaLabel: "Custom hex accent color",
    clearLabel: "Clear color",
    clearIcon: "x",
    clearDisabled: !value,
  };
}

export function resolveProviderAccentChange(value: string): string {
  return normalizeProviderAccentColor(value) ?? "";
}

export function resolveProviderAccentHexInput(draft: string): string | null {
  return PROVIDER_ACCENT_HEX_PATTERN.test(draft) ? draft : null;
}
