import { isThemeColor, themeColorToHex, type ThemeColorRole } from "../../themePalette";

const THEME_ROLE_LABELS: Partial<Record<ThemeColorRole, string>> = {
  canvas: "Background",
  toolbar: "Toolbar background",
  toolbarForeground: "Toolbar text",
  toolbarBorder: "Toolbar border",
  toolbarControl: "Toolbar control",
  toolbarControlForeground: "Toolbar control text",
  toolbarControlHover: "Toolbar control hover",
  accent: "Accent color",
  errorForeground: "Error text",
  errorSurface: "Error background",
  warningForeground: "Warning text",
  warningSurface: "Warning background",
  updateForeground: "Update text",
  updateSurface: "Update background",
};

export function getThemeRoleLabel(role: ThemeColorRole): string {
  const label = THEME_ROLE_LABELS[role];
  if (label) return label;
  return role.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}

export function themePickerAlphaSuffix(value: string): string {
  const normalized = themeColorToHex(value) ?? "";
  const alpha = normalized.length === 9 ? normalized.slice(7) : "";
  return alpha === "ff" ? "" : alpha;
}

export function normalizeThemePickerColor(value: string): string {
  return (themeColorToHex(value) ?? "#000000").slice(0, 7);
}

function themeHexToRgb(hex: string): readonly [number, number, number] {
  const numeric = Number.parseInt(normalizeThemePickerColor(hex).slice(1), 16);
  return [numeric >> 16, (numeric >> 8) & 255, numeric & 255];
}

export function themeRgbToHex(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^rgb\(\s*/i, "")
    .replace(/\s*\)$/, "");
  const channels = normalized
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (
    channels.length !== 3 ||
    channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)
  ) {
    return null;
  }

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function themeRgbValue(hex: string): string {
  return themeHexToRgb(hex).join(", ");
}

export function isThemePickerHexInput(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export type ThemeColorPickerModel = {
  readonly label: string;
  readonly subtitle: string;
  readonly triggerAriaLabel: string;
  readonly triggerTooltip: string;
  readonly hueLabel: string;
  readonly hexLabel: string;
  readonly hexAriaLabel: string;
  readonly rgbLabel: string;
  readonly rgbAriaLabel: string;
};

export function buildThemeColorPickerModel(label: string): ThemeColorPickerModel {
  return {
    label,
    subtitle: "Choose a color",
    triggerAriaLabel: `Choose ${label} color`,
    triggerTooltip: `Choose ${label} color`,
    hueLabel: `${label} hue`,
    hexLabel: "HEX",
    hexAriaLabel: `${label} picker hex value`,
    rgbLabel: "RGB",
    rgbAriaLabel: `${label} picker RGB value`,
  };
}

export type ThemeColorFieldModelInput = {
  readonly role: ThemeColorRole;
  readonly value: string;
  readonly selected: boolean;
  readonly label?: string | undefined;
};

export type ThemeColorFieldModel = {
  readonly id: string;
  readonly role: ThemeColorRole;
  readonly label: string;
  readonly value: string;
  readonly selected: boolean;
  readonly valid: boolean;
  readonly swatchValue: string;
  readonly editorValue: string;
  readonly inputId: string;
  readonly toggleAriaLabel: string;
  readonly toggleTooltip: string;
  readonly hexAriaLabel: string;
  readonly picker: ThemeColorPickerModel;
};

export function buildThemeColorFieldModel(input: ThemeColorFieldModelInput): ThemeColorFieldModel {
  const label = input.label ?? getThemeRoleLabel(input.role);
  const valid = isThemeColor(input.value);
  const visibility = input.selected ? "Hide" : "Show";
  return {
    id: input.role,
    role: input.role,
    label,
    value: input.value,
    selected: input.selected,
    valid,
    swatchValue: valid ? input.value : "#000000",
    editorValue: input.value.trim().toLowerCase().startsWith("oklch(")
      ? (themeColorToHex(input.value) ?? input.value)
      : input.value,
    inputId: `${input.role}-hex`,
    toggleAriaLabel: `${visibility} ${label} usage`,
    toggleTooltip: `${visibility} where ${label} is used`,
    hexAriaLabel: `${label} hex value`,
    picker: buildThemeColorPickerModel(label),
  };
}
