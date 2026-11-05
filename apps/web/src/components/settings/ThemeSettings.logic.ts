import {
  EMBER_THEME,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
  getThemeModes,
  serializeThemeFile,
  singleAppearanceOf,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemeHalves,
} from "../../themePalette";
import type { ThemeToastContent } from "./ThemeEditorHost.logic";
import {
  STANDARD_THEME_CARDS,
  getThemeCardDefinition,
  previewColorsOf,
  type ThemeCardDefinition,
  type ThemeCardPreview,
  type ThemeCardPreviewColors,
  type ThemeMode,
} from "./ThemePreviewCircles.logic";
import { searchableSetting } from "./settingsSearch";
import { findThemeDefinition, type ThemeCatalog } from "./themeCatalog.logic";
import type { ThemeEditorSessionInput } from "./themeEditorStore";

const MAINTAINER_THEMES: ReadonlyArray<ThemeDefinition> = [
  T3_CHAT_THEME,
  GROVE_THEME,
  OCEAN_THEME,
  EMBER_THEME,
  IRIS_THEME,
];

export const THEME_SELECTION_SAVE_FAILURE_TOAST: ThemeToastContent = {
  type: "error",
  title: "Couldn’t save theme selection",
  description: "Try again.",
};

export const THEME_REMOVAL_FAILURE_TOAST: ThemeToastContent = {
  type: "error",
  title: "Couldn’t remove theme",
  description: "Try again.",
};

export type ThemeSelectionStep =
  | { readonly kind: "persist-theme"; readonly theme: string }
  | {
      readonly kind: "assign-half";
      readonly appearance: ThemeAppearance;
      readonly themeId: string | null;
    };

export type ThemeLibraryUseIntent = {
  readonly steps: ReadonlyArray<ThemeSelectionStep>;
  readonly variantIndex: number | null;
};

export type ThemeOwners = {
  readonly light: string | null;
  readonly dark: string | null;
};

export function resolveThemeOwners(
  baseThemeId: string | null,
  themeHalves: ThemeHalves | null,
): ThemeOwners {
  return {
    light: themeHalves?.light ?? baseThemeId,
    dark: themeHalves?.dark ?? baseThemeId,
  };
}

export function resolveThemePickedModes(
  owners: ThemeOwners,
  themeId: string | null,
): ReadonlyArray<ThemeMode> {
  const rings: ThemeMode[] = [];
  if (owners.light === themeId) rings.push("light");
  if (owners.dark === themeId) rings.push("dark");
  return rings;
}

function assignHalfStep(appearance: ThemeAppearance, themeId: string | null): ThemeSelectionStep {
  return { kind: "assign-half", appearance, themeId };
}

function themeModeLabel(mode: ThemeMode): string {
  return mode === "system" ? "System" : mode === "light" ? "Light" : "Dark";
}

function duplicateSession(
  label: string,
  seedThemeId: string | null,
  initialAppearance: ThemeAppearance,
): ThemeEditorSessionInput {
  return { editingThemeId: null, seedThemeId, seedName: `${label} copy`, initialAppearance };
}

export function resolveCustomThemeUse(theme: ThemeDefinition): ThemeSelectionStep {
  const [onlyMode, ...otherModes] = getThemeModes(theme);
  return onlyMode && otherModes.length === 0
    ? assignHalfStep(onlyMode, theme.id)
    : { kind: "persist-theme", theme: theme.id };
}

export type ThemeCardActionIcon = "copy" | "pen-line" | "upload" | "trash-2";

export type ThemeCardAction = {
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: ThemeCardActionIcon;
};

export type ThemeLibraryPreviewModel = ThemeCardPreview & {
  readonly picked: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly badgeIcon: "sun" | "moon";
  readonly pick: ThemeSelectionStep;
};

export type ThemeLibraryVariantOptionModel = {
  readonly themeIndex: number;
  readonly themeId: string;
  readonly label: string;
  readonly mode: ThemeAppearance;
  readonly colors: ThemeCardPreviewColors;
  readonly active: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly select: ThemeLibraryUseIntent;
};

export type ThemeLibraryVariantGroupModel = {
  readonly mode: ThemeAppearance;
  readonly modeLabel: string;
  readonly selected: ThemeLibraryVariantOptionModel;
  readonly active: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly badgeIcon: "sun" | "moon";
  readonly extraCountLabel: string | null;
  readonly options: ReadonlyArray<ThemeLibraryVariantOptionModel>;
};

export type ThemeLibraryCardKind = "standard" | "builtin" | "environment" | "custom";

export type ThemeLibraryCardModel = {
  readonly id: string;
  readonly kind: ThemeLibraryCardKind;
  readonly cardId: string;
  readonly themeId: string | null;
  readonly label: string;
  readonly title: string;
  readonly titleAriaLabel: string;
  readonly tooltip: string;
  readonly activeModes: ReadonlyArray<ThemeMode>;
  readonly previews: ReadonlyArray<ThemeLibraryPreviewModel>;
  readonly variantNavigation: {
    readonly collectionLabel: string;
    readonly ariaLabel: string;
    readonly groups: ReadonlyArray<ThemeLibraryVariantGroupModel>;
  } | null;
  readonly use: ThemeLibraryUseIntent;
  readonly duplicate: (ThemeCardAction & { readonly session: ThemeEditorSessionInput }) | null;
  readonly edit: (ThemeCardAction & { readonly session: ThemeEditorSessionInput }) | null;
  readonly export: (ThemeCardAction & { readonly themeId: string }) | null;
  readonly remove:
    | (ThemeCardAction & {
        readonly themeId: string;
        readonly collectionThemeIds: ReadonlyArray<string>;
      })
    | null;
};

type CardBaseInput = {
  readonly id: string;
  readonly kind: ThemeLibraryCardKind;
  readonly themeId: string | null;
  readonly card: ThemeCardDefinition;
  readonly owners: ThemeOwners;
  readonly use: ThemeLibraryUseIntent;
  readonly duplicateSeedThemeId: string | null;
  readonly initialAppearance: ThemeAppearance;
};

function buildPreviews(
  card: ThemeCardDefinition,
  themeId: string | null,
  activeModes: ReadonlyArray<ThemeMode>,
): ReadonlyArray<ThemeLibraryPreviewModel> {
  return card.previews.map((preview) => ({
    mode: preview.mode,
    colors: preview.colors,
    picked: activeModes.includes(preview.mode),
    ariaLabel: `Use ${card.label} ${preview.mode} mode`,
    tooltip: preview.mode === "light" ? "Use for light mode only" : "Use for dark mode only",
    badgeIcon: preview.mode === "light" ? "sun" : "moon",
    pick: assignHalfStep(preview.mode, themeId),
  }));
}

function cardTooltip(card: ThemeCardDefinition, hasVariants: boolean): string {
  if (hasVariants) return "Use the first variants for light and dark";
  const cardModes = card.previews.map((preview) => preview.mode);
  return cardModes.length > 1 ? "Use for both light and dark" : `Use for ${cardModes[0]} mode only`;
}

function buildBaseCard(input: CardBaseInput): ThemeLibraryCardModel {
  const activeModes = resolveThemePickedModes(input.owners, input.themeId);
  return {
    id: input.id,
    kind: input.kind,
    cardId: input.card.id,
    themeId: input.themeId,
    label: input.card.label,
    title: input.card.label,
    titleAriaLabel: `Use ${input.card.label} theme`,
    tooltip: cardTooltip(input.card, false),
    activeModes,
    previews: buildPreviews(input.card, input.themeId, activeModes),
    variantNavigation: null,
    use: input.use,
    duplicate: {
      ariaLabel: `Duplicate ${input.card.label}`,
      tooltip: "Duplicate theme",
      icon: "copy",
      session: duplicateSession(
        input.card.label,
        input.duplicateSeedThemeId,
        input.initialAppearance,
      ),
    },
    edit: null,
    export: null,
    remove: null,
  };
}

export function collectionVariantLabels(
  themes: ReadonlyArray<ThemeDefinition>,
): ReadonlyArray<string> {
  const words = themes.map((theme) => theme.label.trim().split(/\s+/));
  const [firstWords] = words;
  if (!firstWords) return [];
  const sharedWordCount = firstWords.findIndex((word, index) =>
    words.some((labelWords) => labelWords[index]?.toLocaleLowerCase() !== word.toLocaleLowerCase()),
  );
  const prefixLength = sharedWordCount === -1 ? firstWords.length - 1 : sharedWordCount;

  return themes.map((theme, index) => {
    const shortLabel = words[index]?.slice(Math.max(0, prefixLength)).join(" ").trim();
    return shortLabel || theme.label;
  });
}

export function resolveThemeCollectionInitialVariantIndex(
  themes: ReadonlyArray<ThemeDefinition>,
  owners: ThemeOwners,
): number {
  const activeIndex = themes.findIndex(
    (theme) => resolveThemePickedModes(owners, theme.id).length > 0,
  );
  return activeIndex < 0 ? 0 : activeIndex;
}

export function resolveThemeCollectionUse(
  themes: ReadonlyArray<ThemeDefinition>,
): ThemeLibraryUseIntent {
  const [onlyTheme, ...otherThemes] = themes;
  if (onlyTheme && otherThemes.length === 0) {
    return { steps: [resolveCustomThemeUse(onlyTheme)], variantIndex: null };
  }
  const defaultLightTheme = themes.find((candidate) => getThemeModes(candidate).includes("light"));
  const defaultDarkTheme = themes.find((candidate) => getThemeModes(candidate).includes("dark"));
  return {
    steps: [
      ...(defaultLightTheme ? [assignHalfStep("light", defaultLightTheme.id)] : []),
      ...(defaultDarkTheme ? [assignHalfStep("dark", defaultDarkTheme.id)] : []),
    ],
    variantIndex: 0,
  };
}

export type ThemeCollectionCardInput = {
  readonly collectionId: string;
  readonly themes: ReadonlyArray<ThemeDefinition>;
  readonly variantIndex: number;
  readonly owners: ThemeOwners;
  readonly initialAppearance: ThemeAppearance;
};

export function resolveThemeCollectionSafeIndex(
  themes: ReadonlyArray<ThemeDefinition>,
  variantIndex: number,
): number {
  return Math.min(variantIndex, themes.length - 1);
}

function buildVariantGroups(
  themes: ReadonlyArray<ThemeDefinition>,
  owners: ThemeOwners,
): ReadonlyArray<ThemeLibraryVariantGroupModel> {
  const variantLabels = collectionVariantLabels(themes);
  const options = themes.flatMap((variant, themeIndex) =>
    getThemeCardDefinition(variant).previews.map((preview) => ({
      themeIndex,
      themeId: variant.id,
      label: variantLabels[themeIndex] ?? variant.label,
      activeModes: resolveThemePickedModes(owners, variant.id),
      preview,
    })),
  );
  return (["light", "dark"] as const).flatMap((mode) => {
    const modeOptions = options
      .filter((option) => option.preview.mode === mode)
      .map((option): ThemeLibraryVariantOptionModel => {
        const active = option.activeModes.includes(mode);
        return {
          themeIndex: option.themeIndex,
          themeId: option.themeId,
          label: option.label,
          mode,
          colors: option.preview.colors,
          active,
          ariaLabel: `Use ${option.label} for ${mode} mode${active ? ", currently active" : ""}`,
          tooltip: `Use ${option.label} for ${mode} mode`,
          select: {
            steps: [assignHalfStep(mode, option.themeId)],
            variantIndex: option.themeIndex,
          },
        };
      });
    const selected = modeOptions.find((option) => option.active) ?? modeOptions[0];
    if (!selected) return [];
    const modeLabel = mode === "light" ? "Light" : "Dark";
    const count = modeOptions.length;
    return [
      {
        mode,
        modeLabel,
        selected,
        active: selected.active,
        ariaLabel:
          count > 1
            ? `Choose ${mode} variant, ${count} options, currently ${selected.label}`
            : `Use ${mode} variant, currently ${selected.label}`,
        tooltip: `${modeLabel}: ${selected.label}`,
        badgeIcon: mode === "light" ? "sun" : "moon",
        extraCountLabel: count > 1 ? `+${count - 1}` : null,
        options: count > 1 ? modeOptions : [],
      },
    ];
  });
}

export function buildThemeCollectionCardModel(
  input: ThemeCollectionCardInput,
): ThemeLibraryCardModel | null {
  const theme = input.themes[resolveThemeCollectionSafeIndex(input.themes, input.variantIndex)];
  if (!theme) return null;
  const card = getThemeCardDefinition(theme);
  const hasVariants = input.themes.length > 1;
  const collectionLabel = theme.collection?.label ?? theme.label;
  const activeModes = resolveThemePickedModes(input.owners, theme.id);
  return {
    id: input.collectionId,
    kind: "custom",
    cardId: card.id,
    themeId: theme.id,
    label: theme.label,
    title: hasVariants ? collectionLabel : theme.label,
    titleAriaLabel: hasVariants
      ? `Use ${collectionLabel}, ${theme.label} variant`
      : `Use ${theme.label} theme`,
    tooltip: cardTooltip(card, hasVariants),
    activeModes,
    previews: buildPreviews(card, theme.id, activeModes),
    variantNavigation: hasVariants
      ? {
          collectionLabel,
          ariaLabel: "Light and dark theme variants",
          groups: buildVariantGroups(input.themes, input.owners),
        }
      : null,
    use: resolveThemeCollectionUse(input.themes),
    duplicate: {
      ariaLabel: `Duplicate ${theme.label}`,
      tooltip: "Duplicate theme",
      icon: "copy",
      session: duplicateSession(theme.label, theme.id, input.initialAppearance),
    },
    edit: {
      ariaLabel: `Edit ${theme.label}`,
      tooltip: "Edit theme",
      icon: "pen-line",
      session: {
        editingThemeId: theme.id,
        seedThemeId: null,
        seedName: null,
        initialAppearance: input.initialAppearance,
      },
    },
    export: {
      ariaLabel: `Export ${theme.label}`,
      tooltip: "Export theme file",
      icon: "upload",
      themeId: theme.id,
    },
    remove: {
      ariaLabel: hasVariants ? `Remove themes from ${collectionLabel}` : `Remove ${theme.label}`,
      tooltip: hasVariants ? "Remove themes" : "Remove theme",
      icon: "trash-2",
      themeId: theme.id,
      collectionThemeIds: input.themes.map((candidate) => candidate.id),
    },
  };
}

export type ThemeCustomCollection = {
  readonly id: string;
  readonly themes: ReadonlyArray<ThemeDefinition>;
};

export function groupCustomThemeCollections(
  customThemes: ReadonlyArray<ThemeDefinition>,
): ReadonlyArray<ThemeCustomCollection> {
  const groups = new Map<string, ThemeDefinition[]>();
  for (const customTheme of customThemes) {
    const groupId = customTheme.collection
      ? `collection:${customTheme.collection.id}`
      : `theme:${customTheme.id}`;
    const group = groups.get(groupId);
    if (group) group.push(customTheme);
    else groups.set(groupId, [customTheme]);
  }
  return [...groups.entries()].map(([id, themes]) => ({ id, themes }));
}

export type ThemeWireframePane = {
  readonly clip?: "left" | "right";
  readonly colors: ThemeCardPreviewColors;
};

export type ThemeModeTileModel = {
  readonly mode: ThemeMode;
  readonly label: string;
  readonly ariaLabel: string;
  readonly active: boolean;
  readonly panes: ReadonlyArray<ThemeWireframePane>;
};

export type ThemeLibraryModelInput = {
  readonly baseThemeId: string | null;
  readonly appearanceMode: ThemeMode;
  readonly themeHalves: ThemeHalves | null;
  readonly initialAppearance: ThemeAppearance;
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
  readonly environmentThemes: ReadonlyArray<ThemeDefinition>;
  readonly collectionVariantIndexes?: Readonly<Record<string, number>>;
};

export type ThemeLibraryModel = {
  readonly colorSchemeTitle: string;
  readonly themeTitle: string;
  readonly modeGroupAriaLabel: string;
  readonly modeTiles: ReadonlyArray<ThemeModeTileModel>;
  readonly createTheme: {
    readonly label: string;
    readonly icon: "paintbrush";
    readonly session: ThemeEditorSessionInput;
  };
  readonly addTheme: { readonly label: string; readonly icon: "plus" };
  readonly cards: ReadonlyArray<ThemeLibraryCardModel>;
  readonly collections: ReadonlyArray<
    ThemeCustomCollection & {
      readonly initialVariantIndex: number;
      readonly card: ThemeLibraryCardModel | null;
    }
  >;
};

function ownerPreviewColors(
  themeId: string | null,
  appearance: ThemeAppearance,
  catalog: ThemeCatalog,
): ThemeCardPreviewColors | null {
  const definition = findThemeDefinition(themeId, catalog);
  const card = definition ? getThemeCardDefinition(definition) : STANDARD_THEME_CARDS[0];
  if (!card) return null;
  return previewColorsOf(card, appearance) ?? card.previews[0]?.colors ?? null;
}

function buildModeTiles(
  input: ThemeLibraryModelInput,
  owners: ThemeOwners,
  catalog: ThemeCatalog,
): ReadonlyArray<ThemeModeTileModel> {
  const lightColors = ownerPreviewColors(owners.light, "light", catalog);
  const darkColors = ownerPreviewColors(owners.dark, "dark", catalog);
  return (["system", "light", "dark"] as const).map((mode) => {
    const panes: ThemeWireframePane[] = [];
    if (mode === "system") {
      if (lightColors) panes.push({ clip: "left", colors: lightColors });
      if (darkColors) panes.push({ clip: "right", colors: darkColors });
    } else {
      const colors = mode === "dark" ? darkColors : lightColors;
      if (colors) panes.push({ colors });
    }
    return {
      mode,
      label: themeModeLabel(mode),
      ariaLabel: mode === "system" ? "Follow the system appearance" : `Use ${mode} mode`,
      active: input.appearanceMode === mode,
      panes,
    };
  });
}

export function buildThemeLibraryModel(input: ThemeLibraryModelInput): ThemeLibraryModel {
  const catalog: ThemeCatalog = {
    customThemes: input.customThemes,
    environmentThemes: input.environmentThemes,
  };
  const owners = resolveThemeOwners(input.baseThemeId, input.themeHalves);
  const activeThemeForAppearance = findThemeDefinition(
    input.initialAppearance === "light" ? owners.light : owners.dark,
    catalog,
  );
  const standardCards = STANDARD_THEME_CARDS.map((card) =>
    buildBaseCard({
      id: card.id,
      kind: "standard",
      themeId: null,
      card,
      owners,
      use: { steps: [{ kind: "persist-theme", theme: input.appearanceMode }], variantIndex: null },
      duplicateSeedThemeId: null,
      initialAppearance: input.initialAppearance,
    }),
  );
  const maintainerCards = MAINTAINER_THEMES.map((theme) =>
    buildBaseCard({
      id: theme.id,
      kind: "builtin",
      themeId: theme.id,
      card: getThemeCardDefinition(theme),
      owners,
      use: { steps: [{ kind: "persist-theme", theme: theme.id }], variantIndex: null },
      duplicateSeedThemeId: theme.id,
      initialAppearance: input.initialAppearance,
    }),
  );
  const environmentCards = input.environmentThemes
    .filter(
      (environmentTheme) => !input.customThemes.some((theme) => theme.id === environmentTheme.id),
    )
    .map((theme) => {
      const half = singleAppearanceOf(theme);
      return buildBaseCard({
        id: theme.id,
        kind: "environment",
        themeId: theme.id,
        card: getThemeCardDefinition(theme),
        owners,
        use: {
          steps: [
            half === null
              ? { kind: "persist-theme", theme: theme.id }
              : assignHalfStep(half, theme.id),
          ],
          variantIndex: null,
        },
        duplicateSeedThemeId: theme.id,
        initialAppearance: input.initialAppearance,
      });
    });
  const collections = groupCustomThemeCollections(input.customThemes).map((collection) => {
    const initialVariantIndex = resolveThemeCollectionInitialVariantIndex(
      collection.themes,
      owners,
    );
    return {
      ...collection,
      initialVariantIndex,
      card: buildThemeCollectionCardModel({
        collectionId: collection.id,
        themes: collection.themes,
        variantIndex: input.collectionVariantIndexes?.[collection.id] ?? initialVariantIndex,
        owners,
        initialAppearance: input.initialAppearance,
      }),
    };
  });
  return {
    colorSchemeTitle: searchableSetting("color-scheme").title,
    themeTitle: searchableSetting("theme").title,
    modeGroupAriaLabel: "Appearance mode",
    modeTiles: buildModeTiles(input, owners, catalog),
    createTheme: {
      label: "Create theme",
      icon: "paintbrush",
      session: {
        editingThemeId: null,
        seedThemeId: activeThemeForAppearance?.id ?? null,
        seedName: null,
        initialAppearance: input.initialAppearance,
      },
    },
    addTheme: { label: "Add theme", icon: "plus" },
    cards: [...standardCards, ...maintainerCards, ...environmentCards],
    collections,
  };
}

export type ThemeHalfAssignmentInput = {
  readonly appearance: ThemeAppearance;
  readonly themeId: string | null;
  readonly baseThemeId: string | null;
  readonly appearanceMode: ThemeMode;
  readonly storedHalves: ThemeHalves;
};

export type ThemeHalfAssignmentPlan =
  | {
      readonly kind: "set-half";
      readonly appearance: ThemeAppearance;
      readonly themeId: string | null;
    }
  | {
      readonly kind: "convert-base";
      readonly basePreference: string;
      readonly otherAppearance: ThemeAppearance;
      readonly otherThemeId: string;
    };

export function resolveThemeHalfAssignment(
  input: ThemeHalfAssignmentInput,
): ThemeHalfAssignmentPlan {
  if (input.themeId === null && input.baseThemeId !== null) {
    const otherAppearance = input.appearance === "light" ? "dark" : "light";
    return {
      kind: "convert-base",
      basePreference: input.appearanceMode,
      otherAppearance,
      otherThemeId: input.storedHalves[otherAppearance] ?? input.baseThemeId,
    };
  }
  return { kind: "set-half", appearance: input.appearance, themeId: input.themeId };
}

export type ThemeRemovalTarget = {
  readonly theme: ThemeDefinition;
  readonly collectionThemes: ReadonlyArray<ThemeDefinition>;
};

export function resolveThemeRemovalStart(target: ThemeRemovalTarget): {
  readonly target: ThemeRemovalTarget;
  readonly selectedIds: ReadonlyArray<string>;
} {
  return {
    target,
    selectedIds: target.collectionThemes.length > 1 ? [] : [target.theme.id],
  };
}

export function resolveThemeRemovalSelection(
  current: ReadonlyArray<string>,
  themeId: string,
  checked: boolean,
): ReadonlyArray<string> {
  return checked ? [...current, themeId] : current.filter((candidate) => candidate !== themeId);
}

export type ThemeRemovalDialogModelInput = {
  readonly target: ThemeRemovalTarget | null;
  readonly selectedIds: ReadonlyArray<string>;
};

export type ThemeRemovalOptionModel = {
  readonly themeId: string;
  readonly label: string;
  readonly checked: boolean;
  readonly checkboxId: string;
  readonly previews: ReadonlyArray<ThemeCardPreview>;
};

export type ThemeRemovalDialogModel = {
  readonly canRemoveCollection: boolean;
  readonly title: string;
  readonly description: string;
  readonly options: ReadonlyArray<ThemeRemovalOptionModel>;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly confirmDisabled: boolean;
};

export function buildThemeRemovalDialogModel(
  input: ThemeRemovalDialogModelInput,
): ThemeRemovalDialogModel {
  const theme = input.target?.theme;
  const collectionThemes = input.target?.collectionThemes ?? [];
  const canRemoveCollection = collectionThemes.length > 1;
  const collectionLabel = theme?.collection?.label ?? theme?.label;
  const selectedCount = input.selectedIds.length;
  return {
    canRemoveCollection,
    title: canRemoveCollection
      ? `Remove themes from “${collectionLabel}”?`
      : `Remove “${theme?.label}”?`,
    description: canRemoveCollection
      ? "Select the variants you want to remove. You can restore them by importing the extension again."
      : "You can bring it back anytime by importing its JSON file.",
    options: canRemoveCollection
      ? collectionThemes.map((customTheme) => ({
          themeId: customTheme.id,
          label: customTheme.label,
          checked: input.selectedIds.includes(customTheme.id),
          checkboxId: `remove-theme-${customTheme.id}`,
          previews: getThemeCardDefinition(customTheme).previews,
        }))
      : [],
    cancelLabel: "Cancel",
    confirmLabel: canRemoveCollection
      ? `Remove selected${selectedCount > 0 ? ` (${selectedCount})` : ""}`
      : "Remove theme",
    confirmDisabled: selectedCount === 0,
  };
}

export type ThemeRemovalConfirmInput = {
  readonly selectedIds: ReadonlyArray<string>;
  readonly baseThemeId: string | null;
  readonly appearanceMode: ThemeMode;
  readonly storedHalves: ThemeHalves;
};

export type ThemeRemovalHalfWrite = {
  readonly appearance: ThemeAppearance;
  readonly themeId: string | null;
};

export type ThemeRemovalPlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "remove";
      readonly removedIds: ReadonlyArray<string>;
      readonly basePreference: string | null;
      readonly halfWrites: ReadonlyArray<ThemeRemovalHalfWrite>;
    };

export function resolveThemeRemovalConfirm(input: ThemeRemovalConfirmInput): ThemeRemovalPlan {
  const removedIds = new Set(input.selectedIds);
  if (removedIds.size === 0) return { kind: "none" };
  const removesBase = removedIds.has(input.baseThemeId ?? "");
  const halfWrites: ThemeRemovalHalfWrite[] = [];
  for (const appearance of ["light", "dark"] as const) {
    const half = input.storedHalves[appearance];
    if (half === undefined) continue;
    const next = half && removedIds.has(half) ? null : removesBase ? half : undefined;
    if (next !== undefined) halfWrites.push({ appearance, themeId: next });
  }
  return {
    kind: "remove",
    removedIds: [...removedIds],
    basePreference: removesBase ? input.appearanceMode : null,
    halfWrites,
  };
}

export function resolveThemeExport(theme: ThemeDefinition): {
  readonly filename: string;
  readonly contents: string;
} {
  return { filename: `${theme.id}.json`, contents: serializeThemeFile(theme) };
}

export type ThemeImportedActivation =
  | {
      readonly kind: "assign-half";
      readonly appearance: ThemeAppearance;
      readonly themeId: string;
      readonly toast: ThemeToastContent;
    }
  | { readonly kind: "persist-theme"; readonly themeId: string; readonly toast: ThemeToastContent };

export function resolveThemeImportedActivation(theme: ThemeDefinition): ThemeImportedActivation {
  const step = resolveCustomThemeUse(theme);
  if (step.kind === "assign-half") {
    return {
      kind: "assign-half",
      appearance: step.appearance,
      themeId: theme.id,
      toast: {
        type: "success",
        title: `${theme.label} added`,
        description: `It’s now your ${step.appearance} theme.`,
      },
    };
  }
  return {
    kind: "persist-theme",
    themeId: theme.id,
    toast: { type: "success", title: `${theme.label} added`, description: "It’s now active." },
  };
}

export function buildThemesImportedToast(
  themes: ReadonlyArray<ThemeDefinition>,
  updated: boolean,
): ThemeToastContent {
  const verb = updated ? "updated" : "added";
  const [onlyTheme] = themes;
  return {
    type: "success",
    title:
      onlyTheme && themes.length === 1
        ? `${onlyTheme.label} ${verb}`
        : `${themes.length} themes ${verb}`,
    description: themes.map((imported) => imported.label).join(", "),
  };
}
