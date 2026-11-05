import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import type { ThemeDefinition } from "../../themePalette";

export type ThemeCatalog = {
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
  readonly environmentThemes: ReadonlyArray<ThemeDefinition>;
};

export function findThemeDefinition(
  themeId: string | null | undefined,
  catalog: ThemeCatalog,
): ThemeDefinition | null {
  if (!themeId) return null;
  return (
    BUILT_IN_THEMES.find((definition) => definition.id === themeId) ??
    catalog.customThemes.find((definition) => definition.id === themeId) ??
    catalog.environmentThemes.find((definition) => definition.id === themeId) ??
    null
  );
}
