import type { ThemeAppearance, ThemeDefinition, ThemeHalves } from "../../themePalette";

export type ThemeToastContent = {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description: string;
};

export const THEME_EDITOR_STORAGE_FAILURE_TOAST: ThemeToastContent = {
  type: "error",
  title: "Could not save your theme",
  description: "Browser storage is unavailable, so the change was not kept.",
};

export type ThemeEditorSavedInput = {
  readonly savedTheme: ThemeDefinition;
  readonly created: boolean;
  readonly mergedAppearance?: ThemeAppearance | undefined;
  readonly baseThemeId: string | null;
  readonly themeHalves: ThemeHalves | null;
};

export type ThemeEditorSavedDecision =
  | {
      readonly kind: "activate";
      readonly themeId: string;
      readonly successToast: ThemeToastContent;
      readonly failureToast: ThemeToastContent;
    }
  | { readonly kind: "saved"; readonly refresh: boolean; readonly toast: ThemeToastContent };

export function resolveThemeEditorSaved(input: ThemeEditorSavedInput): ThemeEditorSavedDecision {
  const { savedTheme, mergedAppearance } = input;
  if (mergedAppearance) {
    return {
      kind: "activate",
      themeId: savedTheme.id,
      successToast: {
        type: "success",
        title: `${savedTheme.label} updated`,
        description: `Its ${mergedAppearance} palette was added.`,
      },
      failureToast: THEME_EDITOR_STORAGE_FAILURE_TOAST,
    };
  }
  if (!input.created) {
    const wasActive =
      input.baseThemeId === savedTheme.id ||
      input.themeHalves?.light === savedTheme.id ||
      input.themeHalves?.dark === savedTheme.id;
    return {
      kind: "saved",
      refresh: wasActive,
      toast: {
        type: "success",
        title: `${savedTheme.label} saved`,
        description: wasActive ? "Your changes are now active." : "Your changes are saved.",
      },
    };
  }
  return {
    kind: "activate",
    themeId: savedTheme.id,
    successToast: {
      type: "success",
      title: `${savedTheme.label} created`,
      description: "It’s now active.",
    },
    failureToast: THEME_EDITOR_STORAGE_FAILURE_TOAST,
  };
}
