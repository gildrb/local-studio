import type { UnifiedSettings } from "@t3tools/contracts";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type ChatWidth,
  type EnvironmentIdentificationMode,
  MAX_APPEARANCE_CONTRAST,
  MAX_CODE_FONT_SIZE,
  MAX_GLASS_OPACITY,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_APPEARANCE_CONTRAST,
  MIN_CODE_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PANEL_ANIMATION_DURATION_MS,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "@t3tools/contracts/settings";
import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
} from "../../appearanceFonts";
import type {
  ThemeAppearance,
  ThemeHalves,
  ThemePreference,
  ThemePreferenceMode,
} from "../../themePalette";
import { resolveEnvironmentIdentificationPillLabel } from "../SidebarStageBackdrop.logic";
import { getChangedTypographySettingLabels } from "./SettingsPanels.logic";
import { searchableSetting } from "./settingsSearch";

export type AppearanceSettingsValues = Pick<
  UnifiedSettings,
  | "appearanceContrast"
  | "glassOpacity"
  | "environmentIdentificationMode"
  | "diffColorScheme"
  | "chatWidth"
  | "panelAnimationDurationMs"
  | "fontFamilySans"
  | "fontFamilyComposer"
  | "fontFamilyCode"
  | "fontFamilyTerminal"
  | "fontSizeInterface"
  | "fontSizePrompt"
  | "fontSizeCode"
  | "fontSizeTerminal"
  | "fontSmoothing"
  | "wordWrap"
>;

export type AppearanceSettingsPatch = Partial<AppearanceSettingsValues>;

export type DiffColorScheme = UnifiedSettings["diffColorScheme"];

export type AppearanceSliderSetting =
  | "appearanceContrast"
  | "glassOpacity"
  | "panelAnimationDurationMs";

export type AppearanceSelectSetting =
  | "environmentIdentificationMode"
  | "diffColorScheme"
  | "chatWidth";

export type AppearanceToggleSetting = "fontSmoothing" | "wordWrap";

export type AppearanceFontTarget = "interface" | "prompt" | "code" | "terminal";

export type AppearanceOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
};

export type AppearanceSliderRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly setting: AppearanceSliderSetting;
  readonly inputId: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly valueLabel: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly progressRatio: number;
  readonly changed: boolean;
  readonly resetLabel: string;
};

export type AppearanceSelectRow<Value extends string> = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly setting: AppearanceSelectSetting;
  readonly ariaLabel: string;
  readonly value: Value;
  readonly valueLabel: string;
  readonly options: readonly AppearanceOption<Value>[];
  readonly changed: boolean;
  readonly resetLabel: string;
};

export type AppearanceDiffColorsRow = AppearanceSelectRow<DiffColorScheme> & {
  readonly swatchesReversed: boolean;
};

export type AppearanceSwitchRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly setting: AppearanceToggleSetting;
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly changed: boolean;
  readonly resetLabel: string;
};

export type AppearanceFontSizeControl = {
  readonly ariaLabel: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  readonly selectedValue: string;
  readonly valueLabel: string;
  readonly defaultValue: number;
  readonly options: readonly AppearanceOption<string>[];
};

export type AppearanceFontPreview =
  | { readonly kind: "prompt" }
  | { readonly kind: "code" }
  | { readonly kind: "terminal"; readonly family: string; readonly size: number };

export type AppearanceFontRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly font: AppearanceFontTarget;
  readonly value: string;
  readonly trimmedValue: string;
  readonly defaultValue: string;
  readonly defaultFamily: string;
  readonly requireMonospace: boolean;
  readonly familyAriaLabel: string;
  readonly familyMaxLength: number;
  readonly size: AppearanceFontSizeControl;
  readonly changed: boolean;
  readonly resetLabel: string;
  readonly previews: readonly AppearanceFontPreview[];
};

export type FontDefaultFamilyProbe = {
  readonly sans: string | null;
  readonly code: string | null;
};

export type FontDefaultFamilies = {
  readonly sans: string;
  readonly code: string;
  readonly interfaceFamily: string;
};

export type AppearanceThemeSection = {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly anchorId: string;
  readonly appearanceMode: ThemePreferenceMode;
  readonly theme: ThemePreference;
  readonly resolvedTheme: ThemeAppearance;
  readonly themeHalves: ThemeHalves | null;
};

export type AppearanceInterfaceSection = {
  readonly sectionId: string;
  readonly title: string;
  readonly contrast: AppearanceSliderRow;
  readonly glassOpacity: AppearanceSliderRow;
  readonly environmentIdentification: AppearanceSelectRow<EnvironmentIdentificationMode> | null;
  readonly diffColors: AppearanceDiffColorsRow;
  readonly chatWidth: AppearanceSelectRow<ChatWidth>;
};

export type AppearanceMotionSection = {
  readonly sectionId: string;
  readonly title: string;
  readonly panelAnimations: AppearanceSliderRow;
};

export type AppearanceTypographySection = {
  readonly sectionId: string;
  readonly title: string;
  readonly advanced: boolean;
  readonly advancedLabel: string;
  readonly advancedAriaLabel: string;
  readonly changedLabels: readonly string[];
  readonly fontRows: readonly AppearanceFontRow[];
  readonly fontSmoothing: AppearanceSwitchRow | null;
  readonly wordWrap: AppearanceSwitchRow;
};

export type AppearanceSettingsModelInput = {
  readonly settings: AppearanceSettingsValues;
  readonly appearanceMode: ThemePreferenceMode;
  readonly theme: ThemePreference;
  readonly resolvedTheme: ThemeAppearance;
  readonly themeHalves: ThemeHalves | null;
  readonly environmentStageLabel: string;
  readonly isMac: boolean;
  readonly typographyAdvanced: boolean;
  readonly defaultFamilyProbe: FontDefaultFamilyProbe;
};

export type AppearanceSettingsModel = {
  readonly themes: AppearanceThemeSection;
  readonly interface: AppearanceInterfaceSection;
  readonly motion: AppearanceMotionSection;
  readonly typography: AppearanceTypographySection;
};

export type AppearanceSettingsIntent =
  | { readonly kind: "slider"; readonly setting: AppearanceSliderSetting; readonly value: number }
  | { readonly kind: "select"; readonly setting: AppearanceSelectSetting; readonly value: unknown }
  | {
      readonly kind: "toggle";
      readonly setting: AppearanceToggleSetting;
      readonly checked: boolean;
    }
  | {
      readonly kind: "reset";
      readonly setting: AppearanceSliderSetting | AppearanceSelectSetting | AppearanceToggleSetting;
    }
  | { readonly kind: "fontFamily"; readonly font: AppearanceFontTarget; readonly family: string }
  | { readonly kind: "fontSize"; readonly font: AppearanceFontTarget; readonly value: unknown }
  | { readonly kind: "resetFont"; readonly font: AppearanceFontTarget };

export type TypographySearchExpansion =
  | { readonly kind: "expand"; readonly targetId: string }
  | { readonly kind: "none" };

export const FONT_FAMILY_DRAFT_COMMIT_DELAY_MS = 400;

const FONT_FAMILY_MAX_LENGTH = 200;

const ENVIRONMENT_IDENTIFICATION_OPTIONS: readonly AppearanceOption<EnvironmentIdentificationMode>[] =
  [
    { value: "artwork", label: "Artwork" },
    { value: "pill", label: "Version pill" },
    { value: "none", label: "None" },
  ];

const DIFF_COLOR_SCHEME_OPTIONS: readonly AppearanceOption<DiffColorScheme>[] = [
  { value: "red-green", label: "Red & green (default)" },
  { value: "blue-orange", label: "Blue & orange" },
];

const DIFF_COLOR_SCHEME_LABELS: Record<DiffColorScheme, string> = {
  "red-green": "Red & green",
  "blue-orange": "Blue & orange",
};

const CHAT_WIDTH_OPTIONS: readonly AppearanceOption<ChatWidth>[] = [
  { value: "comfortable", label: "Comfortable (default)" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: "Comfortable",
  wide: "Wide",
  full: "Full",
};

const SLIDER_BOUNDS: Record<
  AppearanceSliderSetting,
  { readonly min: number; readonly max: number }
> = {
  appearanceContrast: { min: MIN_APPEARANCE_CONTRAST, max: MAX_APPEARANCE_CONTRAST },
  glassOpacity: { min: MIN_GLASS_OPACITY, max: MAX_GLASS_OPACITY },
  panelAnimationDurationMs: {
    min: MIN_PANEL_ANIMATION_DURATION_MS,
    max: MAX_PANEL_ANIMATION_DURATION_MS,
  },
};

const FONT_SIZE_BOUNDS: Record<
  AppearanceFontTarget,
  { readonly min: number; readonly max: number; readonly label: string }
> = {
  interface: {
    min: MIN_INTERFACE_FONT_SIZE,
    max: MAX_INTERFACE_FONT_SIZE,
    label: "Interface font size",
  },
  prompt: { min: MIN_PROMPT_FONT_SIZE, max: MAX_PROMPT_FONT_SIZE, label: "Prompt font size" },
  code: { min: MIN_CODE_FONT_SIZE, max: MAX_CODE_FONT_SIZE, label: "Code font size" },
  terminal: {
    min: MIN_TERMINAL_FONT_SIZE,
    max: MAX_TERMINAL_FONT_SIZE,
    label: "Terminal font size",
  },
};

function buildSliderRow(input: {
  readonly anchor: { readonly id: string; readonly title: string };
  readonly description: string;
  readonly setting: AppearanceSliderSetting;
  readonly inputId: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly unit: string;
  readonly step: number;
  readonly defaultValue: number;
  readonly resetLabel: string;
}): AppearanceSliderRow {
  const { min, max } = SLIDER_BOUNDS[input.setting];
  return {
    id: input.anchor.id,
    title: input.anchor.title,
    description: input.description,
    setting: input.setting,
    inputId: input.inputId,
    ariaLabel: input.ariaLabel,
    value: input.value,
    valueLabel: `${input.value}${input.unit}`,
    min,
    max,
    step: input.step,
    progressRatio: (input.value - min) / (max - min),
    changed: input.value !== input.defaultValue,
    resetLabel: input.resetLabel,
  };
}

export function resolveFontDefaultFamilies(
  probe: FontDefaultFamilyProbe,
  fontFamilySans: string,
): FontDefaultFamilies {
  const sans = probe.sans ?? "System default";
  const code = probe.code ?? "System monospace";
  return { sans, code, interfaceFamily: fontFamilySans.trim() || sans };
}

function buildFontSizeControl(font: AppearanceFontTarget, value: number, defaultValue: number) {
  const bounds = FONT_SIZE_BOUNDS[font];
  return {
    ariaLabel: bounds.label,
    min: bounds.min,
    max: bounds.max,
    value,
    selectedValue: String(value),
    valueLabel: `${value} px`,
    defaultValue,
    options: Array.from({ length: bounds.max - bounds.min + 1 }, (_, index) => {
      const px = bounds.min + index;
      return { value: String(px), label: `${px} px` };
    }),
  } satisfies AppearanceFontSizeControl;
}

function buildFontRow(input: {
  readonly anchor: { readonly id: string; readonly title: string };
  readonly title?: string;
  readonly description: string;
  readonly font: AppearanceFontTarget;
  readonly value: string;
  readonly defaultValue: string;
  readonly defaultFamily: string;
  readonly requireMonospace: boolean;
  readonly sizeValue: number;
  readonly sizeDefaultValue: number;
  readonly previews: readonly AppearanceFontPreview[];
}): AppearanceFontRow {
  const title = input.title ?? input.anchor.title;
  return {
    id: input.anchor.id,
    title,
    description: input.description,
    font: input.font,
    value: input.value,
    trimmedValue: input.value.trim(),
    defaultValue: input.defaultValue,
    defaultFamily: input.defaultFamily,
    requireMonospace: input.requireMonospace,
    familyAriaLabel: `${title} family`,
    familyMaxLength: FONT_FAMILY_MAX_LENGTH,
    size: buildFontSizeControl(input.font, input.sizeValue, input.sizeDefaultValue),
    changed: input.value !== input.defaultValue || input.sizeValue !== input.sizeDefaultValue,
    resetLabel: title.toLowerCase(),
    previews: input.previews,
  };
}

function buildTypographyFontRows(
  settings: AppearanceSettingsValues,
  defaults: FontDefaultFamilies,
  advanced: boolean,
): AppearanceFontRow[] {
  const interfaceRow = (previews: readonly AppearanceFontPreview[]) =>
    buildFontRow({
      anchor: searchableSetting("interface-font"),
      description: "Everything outside code blocks and the terminal.",
      font: "interface",
      value: settings.fontFamilySans,
      defaultValue: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      defaultFamily: defaults.sans,
      requireMonospace: false,
      sizeValue: settings.fontSizeInterface,
      sizeDefaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      previews,
    });
  const codeRow = (
    overrides: { readonly title?: string; readonly description: string },
    previews: readonly AppearanceFontPreview[],
  ) =>
    buildFontRow({
      anchor: searchableSetting("code-font"),
      ...overrides,
      font: "code",
      value: settings.fontFamilyCode,
      defaultValue: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      defaultFamily: defaults.code,
      requireMonospace: true,
      sizeValue: settings.fontSizeCode,
      sizeDefaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      previews,
    });
  if (!advanced) {
    return [
      interfaceRow([{ kind: "prompt" }]),
      codeRow(
        {
          title: "Monospace font",
          description: "Code blocks, diffs, file previews, and the terminal.",
        },
        [
          { kind: "code" },
          {
            kind: "terminal",
            family: resolveTerminalFontPreference({
              advanced: false,
              code: settings.fontFamilyCode,
              terminal: settings.fontFamilyTerminal,
            }),
            size: resolveTerminalFontSizePreference({
              advanced: false,
              code: settings.fontSizeCode,
              terminal: settings.fontSizeTerminal,
            }),
          },
        ],
      ),
    ];
  }
  return [
    interfaceRow([]),
    buildFontRow({
      anchor: searchableSetting("prompt-font"),
      description: "Only the box you write prompts in. Mono works well here.",
      font: "prompt",
      value: settings.fontFamilyComposer,
      defaultValue: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      defaultFamily: defaults.interfaceFamily,
      requireMonospace: false,
      sizeValue: settings.fontSizePrompt,
      sizeDefaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      previews: [{ kind: "prompt" }],
    }),
    codeRow({ description: "Code blocks, diffs, and file previews." }, [{ kind: "code" }]),
    buildFontRow({
      anchor: searchableSetting("terminal-font"),
      description: "Terminal output, independent from code blocks and diffs.",
      font: "terminal",
      value: settings.fontFamilyTerminal,
      defaultValue: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      defaultFamily: defaults.code,
      requireMonospace: true,
      sizeValue: settings.fontSizeTerminal,
      sizeDefaultValue: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      previews: [
        {
          kind: "terminal",
          family: resolveTerminalFontPreference({
            advanced: true,
            code: settings.fontFamilyCode,
            terminal: settings.fontFamilyTerminal,
          }),
          size: settings.fontSizeTerminal,
        },
      ],
    }),
  ];
}

function buildTypographySection(input: AppearanceSettingsModelInput): AppearanceTypographySection {
  const { settings, typographyAdvanced: advanced } = input;
  const defaults = resolveFontDefaultFamilies(input.defaultFamilyProbe, settings.fontFamilySans);
  const fontSmoothingAnchor = searchableSetting("font-smoothing");
  const wordWrapAnchor = searchableSetting("word-wrap");
  return {
    sectionId: "typography",
    title: "Typography",
    advanced,
    advancedLabel: "Advanced",
    advancedAriaLabel: "Show advanced typography settings",
    changedLabels: getChangedTypographySettingLabels(settings),
    fontRows: buildTypographyFontRows(settings, defaults, advanced),
    fontSmoothing:
      advanced && input.isMac
        ? {
            id: fontSmoothingAnchor.id,
            title: fontSmoothingAnchor.title,
            description: "Use thinner grayscale text smoothing instead of the macOS default.",
            setting: "fontSmoothing",
            ariaLabel: "Font smoothing",
            checked: settings.fontSmoothing,
            changed: settings.fontSmoothing !== DEFAULT_UNIFIED_SETTINGS.fontSmoothing,
            resetLabel: "font smoothing",
          }
        : null,
    wordWrap: {
      id: wordWrapAnchor.id,
      title: wordWrapAnchor.title,
      description: "Wrap long lines in code blocks, tables, diffs, and file previews by default.",
      setting: "wordWrap",
      ariaLabel: "Wrap code, tables, diffs, and file previews by default",
      checked: settings.wordWrap,
      changed: settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap,
      resetLabel: "word wrapping",
    },
  };
}

function buildInterfaceSection(input: AppearanceSettingsModelInput): AppearanceInterfaceSection {
  const { settings } = input;
  const environmentAnchor = searchableSetting("environment-identification");
  const diffAnchor = searchableSetting("diff-color-scheme");
  const chatWidthAnchor = searchableSetting("chat-width");
  return {
    sectionId: "appearance-interface",
    title: "Interface",
    contrast: buildSliderRow({
      anchor: searchableSetting("setting-appearance-contrast"),
      description: "Adjust the contrast of colors and borders across the interface.",
      setting: "appearanceContrast",
      inputId: "appearance-contrast",
      ariaLabel: "Contrast",
      value: settings.appearanceContrast,
      unit: "%",
      step: 5,
      defaultValue: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      resetLabel: "contrast",
    }),
    glassOpacity: buildSliderRow({
      anchor: searchableSetting("setting-glass-opacity"),
      description: "Higher values make menus, dialogs, and the composer more solid.",
      setting: "glassOpacity",
      inputId: "glass-opacity",
      ariaLabel: "Glass opacity",
      value: settings.glassOpacity,
      unit: "%",
      step: 5,
      defaultValue: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      resetLabel: "glass opacity",
    }),
    environmentIdentification:
      resolveEnvironmentIdentificationPillLabel(input.environmentStageLabel) !== null
        ? {
            id: environmentAnchor.id,
            title: environmentAnchor.title,
            description: "Choose how Dev and Nightly environments are identified.",
            setting: "environmentIdentificationMode",
            ariaLabel: "Environment identification",
            value: settings.environmentIdentificationMode,
            valueLabel:
              ENVIRONMENT_IDENTIFICATION_OPTIONS.find(
                (option) => option.value === settings.environmentIdentificationMode,
              )?.label ?? "",
            options: ENVIRONMENT_IDENTIFICATION_OPTIONS,
            changed:
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
            resetLabel: "environment identification",
          }
        : null,
    diffColors: {
      id: diffAnchor.id,
      title: diffAnchor.title,
      description: "Choose colors for additions and deletions, including change counts.",
      setting: "diffColorScheme",
      ariaLabel: "Diff colors",
      value: settings.diffColorScheme,
      valueLabel: DIFF_COLOR_SCHEME_LABELS[settings.diffColorScheme],
      options: DIFF_COLOR_SCHEME_OPTIONS,
      changed: settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      resetLabel: "diff colors",
      swatchesReversed: settings.diffColorScheme === "blue-orange",
    },
    chatWidth: {
      id: chatWidthAnchor.id,
      title: chatWidthAnchor.title,
      description: "Set how wide messages and the composer can grow on large screens.",
      setting: "chatWidth",
      ariaLabel: "Chat width",
      value: settings.chatWidth,
      valueLabel: CHAT_WIDTH_LABELS[settings.chatWidth],
      options: CHAT_WIDTH_OPTIONS,
      changed: settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth,
      resetLabel: "chat width",
    },
  };
}

export function buildAppearanceSettingsModel(
  input: AppearanceSettingsModelInput,
): AppearanceSettingsModel {
  return {
    themes: {
      sectionId: "appearance",
      sectionTitle: "Colors & themes",
      anchorId: searchableSetting("theme").id,
      appearanceMode: input.appearanceMode,
      theme: input.theme,
      resolvedTheme: input.resolvedTheme,
      themeHalves: input.themeHalves,
    },
    interface: buildInterfaceSection(input),
    motion: {
      sectionId: "motion",
      title: "Motion",
      panelAnimations: buildSliderRow({
        anchor: searchableSetting("panel-animations"),
        description: "Set how fast panels open and close.",
        setting: "panelAnimationDurationMs",
        inputId: "panel-animation-duration",
        ariaLabel: "Panel animation duration",
        value: input.settings.panelAnimationDurationMs,
        unit: " ms",
        step: 25,
        defaultValue: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
        resetLabel: "panel animations",
      }),
    },
    typography: buildTypographySection(input),
  };
}

function findOption<Value extends string>(
  options: readonly AppearanceOption<Value>[],
  value: unknown,
): Value | null {
  return options.find((option) => option.value === value)?.value ?? null;
}

function resolveSliderChange(
  setting: AppearanceSliderSetting,
  value: number,
): AppearanceSettingsPatch | null {
  const { min, max } = SLIDER_BOUNDS[setting];
  if (!Number.isInteger(value) || value < min || value > max) return null;
  switch (setting) {
    case "appearanceContrast":
      return { appearanceContrast: value };
    case "glassOpacity":
      return { glassOpacity: value };
    case "panelAnimationDurationMs":
      return { panelAnimationDurationMs: value };
  }
}

function resolveSelectChange(
  setting: AppearanceSelectSetting,
  value: unknown,
): AppearanceSettingsPatch | null {
  switch (setting) {
    case "environmentIdentificationMode": {
      const environmentIdentificationMode = findOption(ENVIRONMENT_IDENTIFICATION_OPTIONS, value);
      return environmentIdentificationMode === null ? null : { environmentIdentificationMode };
    }
    case "diffColorScheme": {
      const diffColorScheme = findOption(DIFF_COLOR_SCHEME_OPTIONS, value);
      return diffColorScheme === null ? null : { diffColorScheme };
    }
    case "chatWidth": {
      const chatWidth = findOption(CHAT_WIDTH_OPTIONS, value);
      return chatWidth === null ? null : { chatWidth };
    }
  }
}

function resolveSettingReset(
  setting: AppearanceSliderSetting | AppearanceSelectSetting | AppearanceToggleSetting,
): AppearanceSettingsPatch {
  switch (setting) {
    case "appearanceContrast":
      return { appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast };
    case "glassOpacity":
      return { glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity };
    case "panelAnimationDurationMs":
      return { panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs };
    case "environmentIdentificationMode":
      return { environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE };
    case "diffColorScheme":
      return { diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme };
    case "chatWidth":
      return { chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth };
    case "fontSmoothing":
      return { fontSmoothing: DEFAULT_UNIFIED_SETTINGS.fontSmoothing };
    case "wordWrap":
      return { wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap };
  }
}

function resolveFontFamilyChange(
  font: AppearanceFontTarget,
  family: string,
): AppearanceSettingsPatch {
  switch (font) {
    case "interface":
      return { fontFamilySans: family };
    case "prompt":
      return { fontFamilyComposer: family };
    case "code":
      return { fontFamilyCode: family };
    case "terminal":
      return { fontFamilyTerminal: family };
  }
}

function resolveFontSizeChange(
  font: AppearanceFontTarget,
  value: unknown,
): AppearanceSettingsPatch | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  const { min, max } = FONT_SIZE_BOUNDS[font];
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  switch (font) {
    case "interface":
      return { fontSizeInterface: parsed };
    case "prompt":
      return { fontSizePrompt: parsed };
    case "code":
      return { fontSizeCode: parsed };
    case "terminal":
      return { fontSizeTerminal: parsed };
  }
}

function resolveFontReset(font: AppearanceFontTarget): AppearanceSettingsPatch {
  switch (font) {
    case "interface":
      return {
        fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
        fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      };
    case "prompt":
      return {
        fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
        fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      };
    case "code":
      return {
        fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
        fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      };
    case "terminal":
      return {
        fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
        fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      };
  }
}

export function resolveAppearanceSettingsChange(
  intent: AppearanceSettingsIntent,
): AppearanceSettingsPatch | null {
  switch (intent.kind) {
    case "slider":
      return resolveSliderChange(intent.setting, intent.value);
    case "select":
      return resolveSelectChange(intent.setting, intent.value);
    case "toggle":
      return intent.setting === "fontSmoothing"
        ? { fontSmoothing: intent.checked }
        : { wordWrap: intent.checked };
    case "reset":
      return resolveSettingReset(intent.setting);
    case "fontFamily":
      return resolveFontFamilyChange(intent.font, intent.family);
    case "fontSize":
      return resolveFontSizeChange(intent.font, intent.value);
    case "resetFont":
      return resolveFontReset(intent.font);
  }
}

export function resolveAdvancedTypographyTargetIds(isMac: boolean): readonly string[] {
  return ["prompt-font", "terminal-font", ...(isMac ? ["font-smoothing"] : [])];
}

export function resolveTypographySearchExpansion(input: {
  readonly searchTargetId: string | null;
  readonly lastExpandedTargetId: string | null;
  readonly isMac: boolean;
}): TypographySearchExpansion {
  const { searchTargetId } = input;
  if (
    searchTargetId === null ||
    !resolveAdvancedTypographyTargetIds(input.isMac).includes(searchTargetId)
  ) {
    return { kind: "none" };
  }
  if (input.lastExpandedTargetId === searchTargetId) return { kind: "none" };
  return { kind: "expand", targetId: searchTargetId };
}

export function shouldCommitFontFamilyDraft(input: {
  readonly draft: string;
  readonly isAvailable: boolean;
  readonly isMonospace: boolean;
  readonly requireMonospace: boolean;
}): boolean {
  return (
    input.draft.trim().length === 0 ||
    (input.isAvailable && (!input.requireMonospace || input.isMonospace))
  );
}

export function isFontFamilyDraftPending(input: {
  readonly draft: string;
  readonly value: string;
  readonly settled: boolean;
}): boolean {
  const draftTrimmed = input.draft.trim();
  return input.settled && draftTrimmed.length > 0 && draftTrimmed !== input.value.trim();
}
