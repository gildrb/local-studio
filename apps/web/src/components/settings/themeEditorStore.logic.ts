import type { ThemeAppearance, ThemeHalves } from "../../themePalette";
import { findThemeDefinition, type ThemeCatalog } from "./themeCatalog.logic";
import type { ThemeEditorSessionInput } from "./themeEditorStore";

export type ThemeEditorToggleInput = {
  readonly isOpen: boolean;
  readonly baseThemeId: string | null;
  readonly themeHalves: ThemeHalves | null;
  readonly initialAppearance: ThemeAppearance;
  readonly catalog: ThemeCatalog;
};

export type ThemeEditorToggleDecision =
  | { readonly kind: "close" }
  | { readonly kind: "open"; readonly session: ThemeEditorSessionInput };

export function resolveThemeEditorToggle(input: ThemeEditorToggleInput): ThemeEditorToggleDecision {
  if (input.isOpen) return { kind: "close" };
  const activeThemeId = input.themeHalves?.[input.initialAppearance] ?? input.baseThemeId;
  const seedThemeId = activeThemeId
    ? (findThemeDefinition(activeThemeId, input.catalog)?.id ?? null)
    : null;
  return {
    kind: "open",
    session: {
      editingThemeId: null,
      seedThemeId,
      seedName: null,
      initialAppearance: input.initialAppearance,
    },
  };
}
