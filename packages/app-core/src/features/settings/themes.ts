import { writeFile } from "node:fs/promises";

import {
  buildThemeLibraryModel,
  buildThemeRemovalDialogModel,
  groupCustomThemeCollections,
  resolveThemeExport,
  resolveThemeHalfAssignment,
  resolveThemeRemovalConfirm,
  resolveThemeRemovalSelection,
  resolveThemeRemovalStart,
  THEME_REMOVAL_FAILURE_TOAST,
  THEME_SELECTION_SAVE_FAILURE_TOAST,
  type ThemeLibraryCardModel,
  type ThemeLibraryUseIntent,
  type ThemeRemovalTarget,
  type ThemeSelectionStep,
} from "@t3tools/web/src/components/settings/ThemeSettings.logic.ts";
import type { ThemeCardPreviewColors } from "@t3tools/web/src/components/settings/ThemePreviewCircles.logic.ts";
import {
  getCustomThemes,
  getEnvironmentThemes,
  getThemeDefinition,
  removeCustomThemes,
  themeColorToHex,
  type ThemeAppearance,
  type ThemeDefinition,
} from "@t3tools/web/src/themePalette.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import { themeOrbSvg } from "../../themeOrb.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";
import { themeEditorStore } from "../../themeEditorStore.ts";
import { createThemeImport } from "./themeImport.ts";

type ThemeMode = ThemeAppearance | "system";

export type ThemeOrbView = {
  readonly mode: ThemeAppearance;
  readonly svg: string;
};

export type ThemePreviewView = {
  readonly mode: ThemeAppearance;
  readonly picked: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly badgeIcon: "sun" | "moon";
  readonly pick: ThemeSelectionStep;
  readonly orb: ThemeOrbView;
};

export type ThemeVariantOptionView = {
  readonly label: string;
  readonly active: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly select: ThemeLibraryUseIntent;
  readonly orb: ThemeOrbView;
};

export type ThemeVariantGroupView = {
  readonly mode: ThemeAppearance;
  readonly active: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly badgeIcon: "sun" | "moon";
  readonly extraCountLabel: string | null;
  readonly selected: ThemeVariantOptionView;
  readonly options: readonly ThemeVariantOptionView[];
};

export type ThemeCardActionView = {
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type ThemeCardView = {
  readonly key: string;
  readonly collectionId: string | null;
  readonly kind: ThemeLibraryCardModel["kind"];
  readonly title: string;
  readonly titleAriaLabel: string;
  readonly tooltip: string;
  readonly use: ThemeLibraryUseIntent;
  readonly previews: readonly ThemePreviewView[];
  readonly variantNavigation: {
    readonly ariaLabel: string;
    readonly groups: readonly ThemeVariantGroupView[];
  } | null;
  readonly duplicate: ThemeCardActionView | null;
  readonly edit: ThemeCardActionView | null;
  readonly export:
    | (ThemeCardActionView & {
        readonly themeId: string;
        readonly filename: string;
      })
    | null;
  readonly remove: (ThemeCardActionView & { readonly themeId: string }) | null;
};

export type ThemeWireframePaneView = {
  readonly clip: "left" | "right" | null;
  readonly colors: Readonly<Record<keyof ThemeCardPreviewColors, string>>;
};

export type ThemeModeTileView = {
  readonly mode: ThemeMode;
  readonly label: string;
  readonly ariaLabel: string;
  readonly active: boolean;
  readonly panes: readonly ThemeWireframePaneView[];
};

export type ThemeRemovalView = {
  readonly title: string;
  readonly description: string;
  readonly canRemoveCollection: boolean;
  readonly options: readonly {
    readonly themeId: string;
    readonly label: string;
    readonly checked: boolean;
    readonly orbs: readonly ThemeOrbView[];
  }[];
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly confirmDisabled: boolean;
};

export type SettingsThemesView = {
  readonly colorSchemeTitle: string;
  readonly themeTitle: string;
  readonly modeGroupAriaLabel: string;
  readonly modeTiles: readonly ThemeModeTileView[];
  readonly createThemeLabel: string;
  readonly addThemeLabel: string;
  readonly cards: readonly ThemeCardView[];
  readonly removal: ThemeRemovalView | null;
};

type RemovalState = {
  readonly target: ThemeRemovalTarget;
  readonly selectedIds: readonly string[];
};

const ThemeModeSchema = Schema.Literals(["light", "dark", "system"]);
const StepSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("persist-theme"), theme: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("assign-half"),
    appearance: Schema.Literals(["light", "dark"]),
    themeId: Schema.NullOr(Schema.String),
  }),
]);
const IntentSchema = Schema.Struct({
  steps: Schema.Array(StepSchema),
  variantIndex: Schema.NullOr(Schema.Number),
});
const ModeParams = Schema.decodeUnknownSync(Schema.Struct({ mode: ThemeModeSchema }));
const UseParams = Schema.decodeUnknownSync(
  Schema.Struct({ intent: IntentSchema, collectionId: Schema.NullOr(Schema.String) }),
);
const ExportParams = Schema.decodeUnknownSync(
  Schema.Struct({ themeId: Schema.String, path: Schema.String }),
);
const CardParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const RemoveStartParams = Schema.decodeUnknownSync(Schema.Struct({ themeId: Schema.String }));
const RemoveToggleParams = Schema.decodeUnknownSync(
  Schema.Struct({ themeId: Schema.String, checked: Schema.Boolean }),
);

function hex(value: string): string {
  return themeColorToHex(value) ?? value;
}

function orb(colors: ThemeCardPreviewColors, mode: ThemeAppearance): ThemeOrbView {
  return {
    mode,
    svg: themeOrbSvg(
      { canvas: colors.canvas, accent: colors.accent, messageAction: colors.messageAction },
      mode,
    ),
  };
}

function paneColors(
  colors: ThemeCardPreviewColors,
): Readonly<Record<keyof ThemeCardPreviewColors, string>> {
  return {
    sidebar: hex(colors.sidebar),
    canvas: hex(colors.canvas),
    surface: hex(colors.surface),
    accentSurface: hex(colors.accentSurface),
    accent: hex(colors.accent),
    messageSurface: hex(colors.messageSurface),
    messageAction: hex(colors.messageAction),
  };
}

function cardView(card: ThemeLibraryCardModel, collectionId: string | null): ThemeCardView {
  const exportThemeId = card.export?.themeId;
  const exportTheme = getCustomThemes().find((theme) => theme.id === exportThemeId);
  return {
    key: collectionId ?? card.id,
    collectionId,
    kind: card.kind,
    title: card.title,
    titleAriaLabel: card.titleAriaLabel,
    tooltip: card.tooltip,
    use: card.use,
    previews: card.previews.map((preview) => ({
      mode: preview.mode,
      picked: preview.picked,
      ariaLabel: preview.ariaLabel,
      tooltip: preview.tooltip,
      badgeIcon: preview.badgeIcon,
      pick: preview.pick,
      orb: orb(preview.colors, preview.mode),
    })),
    variantNavigation:
      card.variantNavigation === null
        ? null
        : {
            ariaLabel: card.variantNavigation.ariaLabel,
            groups: card.variantNavigation.groups.map((group) => {
              const option = (
                candidate: (typeof group.options)[number],
              ): ThemeVariantOptionView => ({
                label: candidate.label,
                active: candidate.active,
                ariaLabel: candidate.ariaLabel,
                tooltip: candidate.tooltip,
                select: candidate.select,
                orb: orb(candidate.colors, candidate.mode),
              });
              return {
                mode: group.mode,
                active: group.active,
                ariaLabel: group.ariaLabel,
                tooltip: group.tooltip,
                badgeIcon: group.badgeIcon,
                extraCountLabel: group.extraCountLabel,
                selected: option(group.selected),
                options: group.options.map(option),
              };
            }),
          },
    duplicate:
      card.duplicate === null
        ? null
        : { ariaLabel: card.duplicate.ariaLabel, tooltip: card.duplicate.tooltip },
    edit:
      card.edit === null ? null : { ariaLabel: card.edit.ariaLabel, tooltip: card.edit.tooltip },
    export:
      card.export === null || exportTheme === undefined
        ? null
        : {
            ariaLabel: card.export.ariaLabel,
            tooltip: card.export.tooltip,
            themeId: card.export.themeId,
            filename: resolveThemeExport(exportTheme).filename,
          },
    remove:
      card.remove === null
        ? null
        : {
            ariaLabel: card.remove.ariaLabel,
            tooltip: card.remove.tooltip,
            themeId: card.remove.themeId,
          },
  };
}

export function createThemeSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry } = context;
  const store = scope.themePreference;
  const variantIndexesAtom = Atom.make<Readonly<Record<string, number>>>({}).pipe(Atom.keepAlive);
  const removalAtom = Atom.make<RemovalState | null>(null).pipe(Atom.keepAlive);

  const stackedToast = (toast: {
    readonly type: "error" | "success" | "info" | "warning";
    readonly title: string;
    readonly description?: string;
  }) => context.addToast({ layout: "stacked", ...toast });

  const viewAtom = Atom.make((get): SettingsThemesView | null => {
    if (get(scope.sectionAtom) !== "appearance") return null;
    const snapshot = get(store.snapshotAtom);
    const model = buildThemeLibraryModel({
      baseThemeId: getThemeDefinition(snapshot.theme)?.id ?? null,
      appearanceMode: snapshot.appearanceMode,
      themeHalves: snapshot.themeHalves,
      initialAppearance: snapshot.resolvedTheme,
      customThemes: getCustomThemes(),
      environmentThemes: getEnvironmentThemes(),
      collectionVariantIndexes: get(variantIndexesAtom),
    });
    const removal = get(removalAtom);
    const dialog =
      removal === null
        ? null
        : buildThemeRemovalDialogModel({
            target: removal.target,
            selectedIds: removal.selectedIds,
          });
    return {
      colorSchemeTitle: model.colorSchemeTitle,
      themeTitle: model.themeTitle,
      modeGroupAriaLabel: model.modeGroupAriaLabel,
      modeTiles: model.modeTiles.map((tile) => ({
        mode: tile.mode,
        label: tile.label,
        ariaLabel: tile.ariaLabel,
        active: tile.active,
        panes: tile.panes.map((pane) => ({
          clip: pane.clip ?? null,
          colors: paneColors(pane.colors),
        })),
      })),
      createThemeLabel: model.createTheme.label,
      addThemeLabel: model.addTheme.label,
      cards: [
        ...model.cards.map((card) => cardView(card, null)),
        ...model.collections.flatMap((collection) =>
          collection.card === null ? [] : [cardView(collection.card, collection.id)],
        ),
      ],
      removal:
        dialog === null
          ? null
          : {
              title: dialog.title,
              description: dialog.description,
              canRemoveCollection: dialog.canRemoveCollection,
              options: dialog.options.map((option) => ({
                themeId: option.themeId,
                label: option.label,
                checked: option.checked,
                orbs: option.previews.map((preview) => orb(preview.colors, preview.mode)),
              })),
              cancelLabel: dialog.cancelLabel,
              confirmLabel: dialog.confirmLabel,
              confirmDisabled: dialog.confirmDisabled,
            },
    };
  });

  const persistTheme = (theme: string) => {
    const saved = store.setTheme(theme);
    if (!saved) stackedToast(THEME_SELECTION_SAVE_FAILURE_TOAST);
    return saved;
  };

  const baseThemeId = () => getThemeDefinition(store.readTheme())?.id ?? null;

  const assignHalf = (appearance: ThemeAppearance, themeId: string | null) => {
    const snapshot = registry.get(store.snapshotAtom);
    const plan = resolveThemeHalfAssignment({
      appearance,
      themeId,
      baseThemeId: baseThemeId(),
      appearanceMode: snapshot.appearanceMode,
      storedHalves: store.readThemeHalvesRaw(),
    });
    if (plan.kind === "convert-base") {
      if (!persistTheme(plan.basePreference)) return;
      if (!store.setThemeHalf(plan.otherAppearance, plan.otherThemeId)) {
        store.setTheme(snapshot.theme);
        stackedToast(THEME_SELECTION_SAVE_FAILURE_TOAST);
      }
      return;
    }
    if (!store.setThemeHalf(plan.appearance, plan.themeId)) {
      stackedToast(THEME_SELECTION_SAVE_FAILURE_TOAST);
    }
  };

  const libraryModel = () => {
    const snapshot = registry.get(store.snapshotAtom);
    return buildThemeLibraryModel({
      baseThemeId: getThemeDefinition(snapshot.theme)?.id ?? null,
      appearanceMode: snapshot.appearanceMode,
      themeHalves: snapshot.themeHalves,
      initialAppearance: snapshot.resolvedTheme,
      customThemes: getCustomThemes(),
      environmentThemes: getEnvironmentThemes(),
      collectionVariantIndexes: registry.get(variantIndexesAtom),
    });
  };

  const cardModel = (key: string) => {
    const model = libraryModel();
    return (
      model.cards.find((card) => card.id === key) ??
      model.collections.find((collection) => collection.id === key)?.card ??
      null
    );
  };

  const themeImport = createThemeImport(context, store, { persistTheme, assignHalf });

  return {
    views: { settingsThemes: viewAtom, ...themeImport.views },
    actions: {
      ...themeImport.actions,
      settingsThemesCreate: async () => {
        themeEditorStore(context).open(libraryModel().createTheme.session);
        return null;
      },
      settingsThemesDuplicate: async (params) => {
        const session = cardModel(CardParams(params).key)?.duplicate?.session;
        if (session) themeEditorStore(context).open(session);
        return null;
      },
      settingsThemesEdit: async (params) => {
        const session = cardModel(CardParams(params).key)?.edit?.session;
        if (session) themeEditorStore(context).open(session);
        return null;
      },
      settingsThemesMount: async () => {
        registry.set(variantIndexesAtom, {});
        registry.set(removalAtom, null);
        return null;
      },
      settingsThemesMode: async (params) => {
        if (!store.setAppearanceMode(ModeParams(params).mode)) {
          stackedToast(THEME_SELECTION_SAVE_FAILURE_TOAST);
        }
        return null;
      },
      settingsThemesUse: async (params) => {
        const { intent, collectionId } = UseParams(params);
        for (const step of intent.steps) {
          if (step.kind === "persist-theme") persistTheme(step.theme);
          else assignHalf(step.appearance, step.themeId);
        }
        if (collectionId !== null && intent.variantIndex !== null) {
          registry.set(variantIndexesAtom, {
            ...registry.get(variantIndexesAtom),
            [collectionId]: intent.variantIndex,
          });
        }
        return null;
      },
      settingsThemesExport: async (params) => {
        const { themeId, path } = ExportParams(params);
        const theme = getCustomThemes().find((candidate) => candidate.id === themeId);
        if (theme === undefined) return null;
        await writeFile(path, resolveThemeExport(theme).contents, "utf8");
        return null;
      },
      settingsThemesRemoveStart: async (params) => {
        const { themeId } = RemoveStartParams(params);
        const theme = getCustomThemes().find((candidate) => candidate.id === themeId);
        if (theme === undefined) return null;
        const start = resolveThemeRemovalStart({
          theme,
          collectionThemes: groupCustomThemeCollections(getCustomThemes()).find((collection) =>
            collection.themes.some((candidate) => candidate.id === theme.id),
          )?.themes ?? [theme],
        });
        registry.set(removalAtom, { target: start.target, selectedIds: start.selectedIds });
        return null;
      },
      settingsThemesRemoveToggle: async (params) => {
        const { themeId, checked } = RemoveToggleParams(params);
        const current = registry.get(removalAtom);
        if (current === null) return null;
        registry.set(removalAtom, {
          ...current,
          selectedIds: resolveThemeRemovalSelection(current.selectedIds, themeId, checked),
        });
        return null;
      },
      settingsThemesRemoveCancel: async () => {
        registry.set(removalAtom, null);
        return null;
      },
      settingsThemesRemoveConfirm: async () => {
        const current = registry.get(removalAtom);
        if (current === null) return null;
        const plan = resolveThemeRemovalConfirm({
          selectedIds: current.selectedIds,
          baseThemeId: baseThemeId(),
          appearanceMode: registry.get(store.snapshotAtom).appearanceMode,
          storedHalves: store.readThemeHalvesRaw(),
        });
        if (plan.kind === "none") return null;
        if (plan.basePreference !== null && !persistTheme(plan.basePreference)) return null;
        for (const write of plan.halfWrites) {
          if (!store.setThemeHalf(write.appearance, write.themeId)) {
            stackedToast(THEME_REMOVAL_FAILURE_TOAST);
            return null;
          }
        }
        try {
          removeCustomThemes(plan.removedIds);
        } catch {
          stackedToast(THEME_REMOVAL_FAILURE_TOAST);
          return null;
        }
        store.refreshLibrary();
        registry.set(removalAtom, null);
        return null;
      },
    },
  };
}
