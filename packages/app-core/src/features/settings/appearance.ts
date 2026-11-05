import {
  buildAppearanceSettingsModel,
  resolveAppearanceSettingsChange,
  resolveTypographySearchExpansion,
  type AppearanceFontRow,
  type AppearanceFontTarget,
  type AppearanceInterfaceSection,
  type AppearanceMotionSection,
  type AppearanceSettingsIntent,
  type AppearanceThemeSection,
  type AppearanceTypographySection,
} from "@t3tools/web/src/components/settings/AppearanceSettings.logic.ts";
import {
  buildFontFamilyPickerModel,
  resolveFontFamilyPick,
  type FontFamilyPickerItem,
} from "@t3tools/web/src/components/settings/FontFamilyPicker.logic.ts";
import {
  DIFF_PREVIEW_PATCH,
  PROMPT_PREVIEW_TEXT,
  resolveTerminalPreviewEcho,
  TERMINAL_PREVIEW_TRANSCRIPT,
} from "@t3tools/web/src/components/settings/SettingsFontPreviews.logic.ts";
import { resolveServerBackedAppStageLabel } from "@t3tools/web/src/branding.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { buildComposerPromptTokens } from "../../composerTokens.ts";
import { syntaxHighlighterRevisionAtom } from "../../syntaxHighlight.ts";
import type { ComposerTokenView } from "../../views/composerInput.ts";
import { buildStaticDiffRows, type RightPanelDiffRow } from "../rightPanelDiff.ts";
import type { FeatureContext } from "../../feature.ts";
import { registerLocalTerminal } from "../../localTerminals.ts";
import { typographyAdvancedStore } from "../../typographyAdvanced.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

export const TERMINAL_PREVIEW_KEY = "settings-terminal-preview";

export type FontFamilyPickerView = {
  readonly triggerLabel: string;
  readonly open: boolean;
  readonly query: string;
  readonly searchPlaceholder: string;
  readonly emptyLabel: string;
  readonly defaultBadgeLabel: string;
  readonly items: readonly FontFamilyPickerItem[];
};

export type AppearanceFontRowView = AppearanceFontRow & { readonly picker: FontFamilyPickerView };

export type AppearanceSettingsView = {
  readonly themes: AppearanceThemeSection;
  readonly interface: AppearanceInterfaceSection;
  readonly motion: AppearanceMotionSection;
  readonly typography: Omit<AppearanceTypographySection, "fontRows"> & {
    readonly fontRows: readonly AppearanceFontRowView[];
  };
  readonly terminalPreviewKey: string;
  readonly promptPreview: {
    readonly prompt: string;
    readonly tokens: readonly ComposerTokenView[];
  };
  readonly codePreview: ReadonlyArray<RightPanelDiffRow>;
};

type FontPickerState = {
  readonly open: AppearanceFontTarget | null;
  readonly query: string;
};

type InstalledFonts = {
  readonly families: readonly string[];
  readonly monospace: readonly string[];
};

const CLOSED_PICKER: FontPickerState = { open: null, query: "" };

const FontTarget = Schema.Literals(["interface", "prompt", "code", "terminal"]);
const SliderSetting = Schema.Literals([
  "appearanceContrast",
  "glassOpacity",
  "panelAnimationDurationMs",
]);
const SelectSetting = Schema.Literals([
  "environmentIdentificationMode",
  "diffColorScheme",
  "chatWidth",
]);
const ToggleSetting = Schema.Literals(["fontSmoothing", "wordWrap"]);

const IntentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("slider"), setting: SliderSetting, value: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("select"), setting: SelectSetting, value: Schema.Unknown }),
  Schema.Struct({
    kind: Schema.Literal("toggle"),
    setting: ToggleSetting,
    checked: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("reset"),
    setting: Schema.Union([SliderSetting, SelectSetting, ToggleSetting]),
  }),
  Schema.Struct({ kind: Schema.Literal("fontFamily"), font: FontTarget, family: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("fontSize"), font: FontTarget, value: Schema.Unknown }),
  Schema.Struct({ kind: Schema.Literal("resetFont"), font: FontTarget }),
]);

const ChangeParams = Schema.decodeUnknownSync(Schema.Struct({ intent: IntentSchema }));
const AdvancedParams = Schema.decodeUnknownSync(Schema.Struct({ advanced: Schema.Boolean }));
const FontsParams = Schema.decodeUnknownSync(
  Schema.Struct({ families: Schema.Array(Schema.String), monospace: Schema.Array(Schema.String) }),
);
const PickerParams = Schema.decodeUnknownSync(Schema.Struct({ font: Schema.NullOr(FontTarget) }));
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const PickParams = Schema.decodeUnknownSync(
  Schema.Struct({ font: FontTarget, value: Schema.String }),
);

export function createAppearanceSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry } = context;
  const advancedStore = typographyAdvancedStore(context.storage, registry);
  const pickerAtom = Atom.make<FontPickerState>(CLOSED_PICKER).pipe(Atom.keepAlive);
  const fontsAtom = Atom.make<InstalledFonts>({ families: [], monospace: [] }).pipe(Atom.keepAlive);
  let lastExpandedTargetId: string | null = null;
  let previewLineLength = 0;
  const promptPreview = {
    prompt: PROMPT_PREVIEW_TEXT,
    tokens: buildComposerPromptTokens(PROMPT_PREVIEW_TEXT, {
      skills: [],
      images: [],
      files: [],
      reviewComments: [],
      terminalContexts: [],
      previewAnnotations: [],
    }),
  };

  const emitPreview = (op: "reset" | "append", data: string) =>
    context.send({ t: "term", key: TERMINAL_PREVIEW_KEY, op, data });

  registerLocalTerminal(TERMINAL_PREVIEW_KEY, {
    input: (data) => {
      const echo = resolveTerminalPreviewEcho(data, previewLineLength);
      previewLineLength = echo.lineLength;
      if (echo.write !== null) emitPreview("append", echo.write);
    },
  });

  const viewAtom = Atom.make((get): AppearanceSettingsView | null => {
    if (get(scope.sectionAtom) !== "appearance") return null;
    const theme = get(scope.themePreference.snapshotAtom);
    const model = buildAppearanceSettingsModel({
      settings: get(scope.scopedSettingsAtom),
      appearanceMode: theme.appearanceMode,
      theme: theme.theme,
      resolvedTheme: theme.resolvedTheme,
      themeHalves: theme.themeHalves,
      environmentStageLabel: resolveServerBackedAppStageLabel({
        primaryServerVersion:
          get(context.state.primaryServerConfigAtom)?.environment.serverVersion ?? null,
        fallbackStageLabel: context.stageLabel,
      }),
      isMac: scope.isMac,
      typographyAdvanced: get(advancedStore.atom),
      defaultFamilyProbe: { sans: null, code: null },
    });
    const picker = get(pickerAtom);
    const fonts = get(fontsAtom);
    return {
      themes: model.themes,
      interface: model.interface,
      motion: model.motion,
      typography: {
        ...model.typography,
        fontRows: model.typography.fontRows.map((row) => {
          const open = picker.open === row.font;
          const pickerModel = buildFontFamilyPickerModel({
            families: row.requireMonospace ? fonts.monospace : fonts.families,
            query: open ? picker.query : "",
            selectedFamily: row.trimmedValue,
            defaultFamily: row.defaultFamily,
          });
          return {
            ...row,
            picker: {
              triggerLabel: pickerModel.triggerLabel,
              open,
              query: open ? picker.query : "",
              searchPlaceholder: pickerModel.searchPlaceholder,
              emptyLabel: pickerModel.emptyLabel,
              defaultBadgeLabel: pickerModel.defaultBadgeLabel,
              items: open ? pickerModel.items : [],
            },
          };
        }),
      },
      terminalPreviewKey: TERMINAL_PREVIEW_KEY,
      promptPreview,
      codePreview: buildStaticDiffRows(DIFF_PREVIEW_PATCH, get(syntaxHighlighterRevisionAtom)),
    };
  });

  const apply = async (intent: AppearanceSettingsIntent) => {
    const patch = resolveAppearanceSettingsChange(intent);
    if (patch !== null) await scope.updateScopedSettings(patch);
  };

  const setAdvanced = (advanced: boolean) => {
    registry.set(pickerAtom, CLOSED_PICKER);
    advancedStore.set(advanced);
  };

  const applyTypographySearchJump = (searchTargetId: string | null) => {
    const expansion = resolveTypographySearchExpansion({
      searchTargetId,
      lastExpandedTargetId,
      isMac: scope.isMac,
    });
    if (expansion.kind === "none") return;
    lastExpandedTargetId = expansion.targetId;
    setAdvanced(true);
  };
  registry.subscribe(scope.searchTargetAtom, (target) =>
    applyTypographySearchJump(target.targetId),
  );

  return {
    views: { settingsAppearance: viewAtom },
    actions: {
      settingsAppearanceMount: async () => {
        registry.set(pickerAtom, CLOSED_PICKER);
        previewLineLength = 0;
        emitPreview("reset", TERMINAL_PREVIEW_TRANSCRIPT);
        lastExpandedTargetId = null;
        applyTypographySearchJump(registry.get(scope.searchTargetAtom).targetId);
        return null;
      },
      settingsAppearanceChange: async (params) => {
        await apply(ChangeParams(params).intent);
        return null;
      },
      settingsAppearanceAdvanced: async (params) => {
        setAdvanced(AdvancedParams(params).advanced);
        return null;
      },
      settingsAppearanceFonts: async (params) => {
        registry.set(fontsAtom, FontsParams(params));
        return null;
      },
      settingsAppearanceFontPicker: async (params) => {
        registry.set(pickerAtom, { open: PickerParams(params).font, query: "" });
        return null;
      },
      settingsAppearanceFontQuery: async (params) => {
        registry.set(pickerAtom, { ...registry.get(pickerAtom), query: QueryParams(params).query });
        return null;
      },
      settingsAppearanceFontPick: async (params) => {
        const { font, value } = PickParams(params);
        registry.set(pickerAtom, CLOSED_PICKER);
        await apply({ kind: "fontFamily", font, family: resolveFontFamilyPick(value) });
        return null;
      },
    },
  };
}
