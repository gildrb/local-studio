import { DEFAULT_INTERFACE_FONT_SIZE } from "@t3tools/contracts";
import type { ChatWidth } from "@t3tools/contracts/settings";
import {
  clampCodeFontSize,
  clampInterfaceFontSize,
  clampPromptFontSize,
  fontFamilyNames,
} from "@t3tools/web/src/appearanceFonts.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { themePreferenceStore } from "../themePreference.ts";

export type AppAppearanceView = {
  readonly zoom: number;
  readonly fontSmoothing: boolean;
  readonly sansFamilies: ReadonlyArray<string>;
  readonly monoFamilies: ReadonlyArray<string>;
  readonly composerFamilies: ReadonlyArray<string>;
  readonly promptFontSize: number;
  readonly codeFontSize: number;
  readonly contrast: number;
  readonly glassOpacity: number;
  readonly chatWidth: ChatWidth;
  readonly diffColorScheme: "red-green" | "blue-orange";
};

const SystemAppearanceParams = Schema.decodeUnknownSync(
  Schema.Struct({ appearance: Schema.Literals(["light", "dark"]) }),
);

export function createAppThemeFeature(context: FeatureContext): CoreFeature {
  const store = themePreferenceStore(context);
  const appearanceAtom = Atom.make((get): AppAppearanceView => {
    const settings = get(context.clientSettingsAtom);
    return {
      zoom: clampInterfaceFontSize(settings.fontSizeInterface) / DEFAULT_INTERFACE_FONT_SIZE,
      fontSmoothing: settings.fontSmoothing,
      sansFamilies: fontFamilyNames(settings.fontFamilySans),
      monoFamilies: fontFamilyNames(settings.fontFamilyCode),
      composerFamilies: fontFamilyNames(settings.fontFamilyComposer),
      promptFontSize: clampPromptFontSize(settings.fontSizePrompt),
      codeFontSize: clampCodeFontSize(settings.fontSizeCode),
      contrast: settings.appearanceContrast,
      glassOpacity: settings.glassOpacity,
      chatWidth: settings.chatWidth,
      diffColorScheme: settings.diffColorScheme,
    };
  });
  return {
    views: { appTheme: store.appThemeAtom, appAppearance: appearanceAtom },
    actions: {
      appSetSystemAppearance: async (params) => {
        store.setSystemAppearance(SystemAppearanceParams(params).appearance);
        return null;
      },
    },
  };
}
