import {
  normalizeThemePickerColor,
  isThemePickerHexInput,
  themePickerAlphaSuffix,
  themeRgbToHex,
  themeRgbValue,
  buildThemeColorPickerModel,
  type ThemeColorFieldModel,
} from "@t3tools/web/src/components/settings/ThemeColorPicker.logic.ts";
import {
  applyThemeEditorColorChange,
  buildThemeEditorModel,
  getThemeEditorColorsByAppearance,
  markThemeEditorAppearancesDirty,
  regenerateThemeEditorColors,
  resolveThemeEditorAdvancedToggle,
  resolveThemeEditorAutoAppearance,
  resolveThemeEditorColorChangeEffects,
  resolveThemeEditorRoleSelection,
  resolveThemeEditorRoleToggle,
  resolveThemeEditorSave,
  resolveThemeEditorSeed,
  themeEditorRoleDisplayLabel,
  themeEditorSaveErrorMessage,
  THEME_EDITOR_ACTIVATION_FAILURE_MESSAGE,
  type ThemeEditorColorsByAppearance,
  type ThemeEditorDirtyByAppearance,
  type ThemeEditorModel,
} from "@t3tools/web/src/components/settings/ThemeEditorPanel.logic.ts";
import {
  resolveThemeEditorSaved,
  type ThemeToastContent,
} from "@t3tools/web/src/components/settings/ThemeEditorHost.logic.ts";
import { hexToHsv, hsvToHex, type HsvColor } from "@t3tools/web/src/lib/color.ts";
import {
  getCustomThemes,
  getThemeDefinition,
  installCustomTheme,
  removeCustomTheme,
  THEME_COLOR_ROLES,
  updateCustomTheme,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeDefinition,
} from "@t3tools/web/src/themePalette.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { themeEditorStore, type ThemeEditorSession } from "../themeEditorStore.ts";
import { themePreferenceStore } from "../themePreference.ts";

type PickerState = {
  readonly role: ThemeColorRole;
  readonly label: string;
  readonly hsv: HsvColor;
  readonly hexDraft: string;
  readonly rgbDraft: string;
  readonly editingText: boolean;
};

type Draft = {
  readonly session: ThemeEditorSession;
  readonly name: string;
  readonly activeAppearance: ThemeAppearance;
  readonly isAdvanced: boolean;
  readonly colorsByAppearance: ThemeEditorColorsByAppearance;
  readonly guidedDirty: ThemeEditorDirtyByAppearance;
  readonly shouldRegenerateGuidedColors: boolean;
  readonly error: string | null;
  readonly isMinimized: boolean;
  readonly roleQuery: string;
  readonly isInspecting: boolean;
  readonly selectedRole: ThemeColorRole | null;
  readonly usageCount: number | null;
  readonly reveal: { readonly role: ThemeColorRole; readonly revision: number } | null;
  readonly picker: PickerState | null;
};

export type ThemeEditorPickerView = {
  readonly role: ThemeColorRole;
  readonly label: string;
  readonly subtitle: string;
  readonly hueLabel: string;
  readonly hexLabel: string;
  readonly rgbLabel: string;
  readonly hsv: HsvColor;
  readonly hueColor: string;
  readonly currentColor: string;
  readonly hexDraft: string;
  readonly rgbDraft: string;
};

export type ThemeEditorView = {
  readonly sessionId: number;
  readonly model: ThemeEditorModel;
  readonly roleLabels: Readonly<Record<string, string>>;
  readonly reveal: { readonly role: ThemeColorRole; readonly revision: number } | null;
  readonly picker: ThemeEditorPickerView | null;
  readonly fieldTooltips: Readonly<Record<string, string>>;
};

const RoleSchema = Schema.Literals(THEME_COLOR_ROLES);
const decodeRole = Schema.decodeUnknownSync(Schema.Struct({ role: RoleSchema }));
const decodeValue = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const decodeRoleValue = Schema.decodeUnknownSync(
  Schema.Struct({ role: RoleSchema, value: Schema.String }),
);
const decodeChecked = Schema.decodeUnknownSync(Schema.Struct({ checked: Schema.Boolean }));
const decodeAppearance = Schema.decodeUnknownSync(
  Schema.Struct({ appearance: Schema.Literals(["light", "dark"]) }),
);
const decodeCount = Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Number }));
const decodeHsv = Schema.decodeUnknownSync(
  Schema.Struct({ h: Schema.Number, s: Schema.Number, v: Schema.Number }),
);
const decodeSelect = Schema.decodeUnknownSync(
  Schema.Struct({ role: RoleSchema, reveal: Schema.Boolean }),
);
const decodePickerOpen = Schema.decodeUnknownSync(
  Schema.Struct({ role: RoleSchema, label: Schema.String }),
);

const ROLE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  THEME_COLOR_ROLES.map((role) => [role, themeEditorRoleDisplayLabel(role)]),
);

function definition(id: string | null): ThemeDefinition | null {
  return id === null ? null : (getThemeDefinition(id) ?? null);
}

function seedDraft(session: ThemeEditorSession): Draft {
  const seed = resolveThemeEditorSeed({
    editingTheme: definition(session.editingThemeId),
    seedTheme: definition(session.seedThemeId),
    seedName: session.seedName,
    initialAppearance: session.initialAppearance,
  });
  return {
    session,
    name: seed.name,
    activeAppearance: seed.activeAppearance,
    isAdvanced: seed.isAdvanced,
    colorsByAppearance: seed.colorsByAppearance,
    guidedDirty: { light: false, dark: false },
    shouldRegenerateGuidedColors: seed.shouldRegenerateGuidedColors,
    error: null,
    isMinimized: false,
    roleQuery: "",
    isInspecting: false,
    selectedRole: null,
    usageCount: null,
    reveal: null,
    picker: null,
  };
}

function modelFor(draft: Draft): ThemeEditorModel {
  return buildThemeEditorModel({
    editingTheme: definition(draft.session.editingThemeId),
    customThemes: getCustomThemes(),
    name: draft.name,
    activeAppearance: draft.activeAppearance,
    isAdvanced: draft.isAdvanced,
    colorsByAppearance: draft.colorsByAppearance,
    roleQuery: draft.roleQuery,
    selectedRole: draft.selectedRole,
    usageCount: draft.usageCount,
    isInspecting: draft.isInspecting,
    isMinimized: draft.isMinimized,
    error: draft.error,
  });
}

function pickerHsv(picker: PickerState, value: string): HsvColor {
  const normalized = normalizeThemePickerColor(value);
  return hsvToHex(picker.hsv.h, picker.hsv.s, picker.hsv.v) === normalized
    ? picker.hsv
    : hexToHsv(normalized);
}

function pickerView(draft: Draft): ThemeEditorPickerView | null {
  const picker = draft.picker;
  if (picker === null) return null;
  const value = draft.colorsByAppearance[draft.activeAppearance][picker.role];
  const hsv = pickerHsv(picker, value);
  const normalized = normalizeThemePickerColor(value);
  const model = buildThemeColorPickerModel(picker.label);
  return {
    role: picker.role,
    label: picker.label,
    subtitle: model.subtitle,
    hueLabel: model.hueLabel,
    hexLabel: model.hexLabel,
    rgbLabel: model.rgbLabel,
    hsv,
    hueColor: hsvToHex(hsv.h, 1, 1),
    currentColor: hsvToHex(hsv.h, hsv.s, hsv.v),
    hexDraft: picker.editingText ? picker.hexDraft : normalized,
    rgbDraft: picker.editingText ? picker.rgbDraft : themeRgbValue(normalized),
  };
}

function fieldTooltips(model: ThemeEditorModel): Readonly<Record<string, string>> {
  const fields: ReadonlyArray<ThemeColorFieldModel> = [
    ...model.colors.guidedFields,
    ...model.colors.groups.flatMap((group) => group.fields),
  ];
  return Object.fromEntries(fields.map((field) => [field.role, field.picker.triggerTooltip]));
}

export function createThemeEditorFeature(context: FeatureContext): CoreFeature {
  const { registry } = context;
  const editor = themeEditorStore(context);
  const themes = themePreferenceStore(context);
  const draftAtom = Atom.make<Draft | null>(null).pipe(Atom.keepAlive);
  let revealRevision = 0;

  const stackedToast = (toast: ThemeToastContent) =>
    context.addToast({ layout: "stacked", ...toast });

  registry.subscribe(
    editor.sessionAtom,
    (session) => {
      if (session === null) {
        registry.set(draftAtom, null);
        themes.clearPreview();
        return;
      }
      registry.set(draftAtom, seedDraft(session));
    },
    { immediate: true },
  );

  registry.subscribe(draftAtom, (draft) => {
    if (draft === null) return;
    themes.setPreview(draft.activeAppearance, draft.colorsByAppearance[draft.activeAppearance]);
  });

  const viewAtom = Atom.make((get): ThemeEditorView | null => {
    get(themes.snapshotAtom);
    const draft = get(draftAtom);
    if (draft === null) return null;
    const model = modelFor(draft);
    return {
      sessionId: draft.session.id,
      model,
      roleLabels: ROLE_LABELS,
      reveal: draft.reveal,
      picker: pickerView(draft),
      fieldTooltips: fieldTooltips(model),
    };
  });

  const update = (change: (draft: Draft) => Draft) => {
    const draft = registry.get(draftAtom);
    if (draft !== null) registry.set(draftAtom, change(draft));
  };

  const updateColor = (draft: Draft, role: ThemeColorRole, value: string): Draft => {
    const change = {
      activeAppearance: draft.activeAppearance,
      isAdvanced: draft.isAdvanced,
      role,
      value,
    };
    const effects = resolveThemeEditorColorChangeEffects(change);
    return {
      ...draft,
      colorsByAppearance: applyThemeEditorColorChange(draft.colorsByAppearance, change),
      guidedDirty: effects.markGuidedDirty
        ? markThemeEditorAppearancesDirty(draft.guidedDirty, [draft.activeAppearance])
        : draft.guidedDirty,
      shouldRegenerateGuidedColors: effects.markRegenerateGuided
        ? true
        : draft.shouldRegenerateGuidedColors,
    };
  };

  const selectRole = (draft: Draft, role: ThemeColorRole, reveal: boolean): Draft => {
    const selection = resolveThemeEditorRoleSelection(role);
    if (reveal) revealRevision += 1;
    return {
      ...draft,
      selectedRole: selection.selectedRole,
      ...(selection.revealAdvanced ? { isAdvanced: true, roleQuery: "" } : {}),
      reveal: reveal ? { role: selection.selectedRole, revision: revealRevision } : draft.reveal,
    };
  };

  const autoAppearance = (draft: Draft): Draft => {
    if (draft.session.editingThemeId !== null) return draft;
    const target = modelFor(draft).mergeTarget;
    if (target === null) return draft;
    return {
      ...draft,
      activeAppearance: resolveThemeEditorAutoAppearance(
        draft.activeAppearance,
        target.takenAppearances,
      ),
    };
  };

  const onSaved = (
    savedTheme: ThemeDefinition,
    saveContext: { readonly created: boolean; readonly mergedAppearance?: ThemeAppearance },
  ): boolean => {
    const snapshot = registry.get(themes.snapshotAtom);
    const decision = resolveThemeEditorSaved({
      savedTheme,
      created: saveContext.created,
      mergedAppearance: saveContext.mergedAppearance,
      baseThemeId: getThemeDefinition(snapshot.theme)?.id ?? null,
      themeHalves: snapshot.themeHalves,
    });
    if (decision.kind === "saved") {
      if (decision.refresh) themes.refreshLibrary();
      stackedToast(decision.toast);
      return true;
    }
    if (!themes.setTheme(decision.themeId)) {
      stackedToast(decision.failureToast);
      return false;
    }
    stackedToast(decision.successToast);
    return true;
  };

  const submit = (draft: Draft) => {
    const editingTheme = definition(draft.session.editingThemeId);
    const isEditing = editingTheme !== null;
    try {
      const plan = resolveThemeEditorSave({
        name: draft.name,
        editingTheme,
        customThemes: getCustomThemes(),
        activeAppearance: draft.activeAppearance,
        isAdvanced: draft.isAdvanced,
        colorsByAppearance: draft.colorsByAppearance,
        guidedDirtyByAppearance: draft.guidedDirty,
      });
      if (plan.kind === "error") {
        update((current) => ({ ...current, error: plan.message }));
        return;
      }
      const savedTheme =
        plan.kind === "install" ? installCustomTheme(plan.theme) : updateCustomTheme(plan.theme);
      if (plan.kind === "merge-edited") {
        try {
          removeCustomTheme(plan.retiredTheme.id);
        } catch (cause) {
          try {
            updateCustomTheme(plan.mergeTarget);
          } catch {
            void 0;
          }
          throw cause;
        }
      }
      if (!onSaved(savedTheme, plan.context)) {
        const rollback = plan.rollback;
        try {
          if (rollback.kind === "remove-saved") removeCustomTheme(savedTheme.id);
          else if (rollback.kind === "restore-merge") {
            updateCustomTheme(rollback.mergeTarget);
            if (rollback.retiredTheme) installCustomTheme(rollback.retiredTheme);
          }
        } catch {
          void 0;
        }
        update((current) => ({ ...current, error: THEME_EDITOR_ACTIVATION_FAILURE_MESSAGE }));
        return;
      }
      editor.close();
    } catch (cause) {
      update((current) => ({ ...current, error: themeEditorSaveErrorMessage(cause, isEditing) }));
    }
  };

  const action =
    (run: (params: unknown) => void) =>
    async (params: unknown): Promise<null> => {
      run(params);
      return null;
    };

  return {
    views: { themeEditor: viewAtom },
    actions: {
      themeEditorToggle: action(() => editor.toggle()),
      themeEditorClose: action(() => editor.close()),
      themeEditorName: action((params) => {
        const { value } = decodeValue(params);
        update((draft) => autoAppearance({ ...draft, name: value, error: null }));
      }),
      themeEditorAppearance: action((params) => {
        const { appearance } = decodeAppearance(params);
        update((draft) => {
          const option = modelFor(draft).appearance.options.find(
            (candidate) => candidate.value === appearance,
          );
          return option && !option.locked ? { ...draft, activeAppearance: appearance } : draft;
        });
      }),
      themeEditorAdvanced: action((params) => {
        const { checked } = decodeChecked(params);
        update((draft) => {
          const decision = resolveThemeEditorAdvancedToggle({
            checked,
            selectedRole: draft.selectedRole,
            shouldRegenerateGuidedColors: draft.shouldRegenerateGuidedColors,
            editingTheme: definition(draft.session.editingThemeId),
            activeAppearance: draft.activeAppearance,
          });
          const next: Draft = {
            ...draft,
            isAdvanced: decision.isAdvanced,
            selectedRole: decision.clearSelectedRole ? null : draft.selectedRole,
          };
          const appearances = decision.regenerateAppearances;
          if (appearances === null) return next;
          return {
            ...next,
            guidedDirty: markThemeEditorAppearancesDirty(next.guidedDirty, appearances),
            colorsByAppearance: regenerateThemeEditorColors(next.colorsByAppearance, appearances),
            shouldRegenerateGuidedColors: false,
          };
        });
      }),
      themeEditorFilter: action((params) => {
        const { value } = decodeValue(params);
        update((draft) => ({ ...draft, roleQuery: value }));
      }),
      themeEditorColor: action((params) => {
        const { role, value } = decodeRoleValue(params);
        update((draft) => updateColor(draft, role, value));
      }),
      themeEditorSelectRole: action((params) => {
        const { role, reveal } = decodeSelect(params);
        update((draft) => selectRole(draft, role, reveal));
      }),
      themeEditorToggleRole: action((params) => {
        const { role } = decodeRole(params);
        update((draft) => ({
          ...draft,
          selectedRole: resolveThemeEditorRoleToggle(draft.selectedRole, role),
        }));
      }),
      themeEditorInspect: action(() => {
        update((draft) =>
          draft.isInspecting
            ? { ...draft, isInspecting: false, selectedRole: null, usageCount: null }
            : { ...draft, isInspecting: true },
        );
      }),
      themeEditorInspectCancel: action(() => {
        update((draft) => ({
          ...draft,
          isInspecting: false,
          selectedRole: null,
          usageCount: null,
        }));
      }),
      themeEditorInspectPick: action((params) => {
        const { role } = decodeRole(params);
        update((draft) => ({ ...selectRole(draft, role, true), isInspecting: false }));
      }),
      themeEditorUsage: action((params) => {
        const { count } = decodeCount(params);
        update((draft) => (draft.usageCount === count ? draft : { ...draft, usageCount: count }));
      }),
      themeEditorMinimize: action(() => {
        update((draft) => ({ ...draft, isMinimized: !draft.isMinimized }));
      }),
      themeEditorSubmit: action(() => {
        const draft = registry.get(draftAtom);
        if (draft !== null) submit(draft);
      }),
      themeEditorPickerOpen: action((params) => {
        const { role, label } = decodePickerOpen(params);
        update((draft) => {
          const color = normalizeThemePickerColor(
            draft.colorsByAppearance[draft.activeAppearance][role],
          );
          return {
            ...selectRole(draft, role, false),
            picker: {
              role,
              label,
              hsv: hexToHsv(color),
              hexDraft: color,
              rgbDraft: themeRgbValue(color),
              editingText: false,
            },
          };
        });
      }),
      themeEditorPickerClose: action(() => {
        update((draft) => ({ ...draft, picker: null }));
      }),
      themeEditorPickerHsv: action((params) => {
        const hsv = decodeHsv(params);
        update((draft) => {
          const picker = draft.picker;
          if (picker === null) return draft;
          const value = draft.colorsByAppearance[draft.activeAppearance][picker.role];
          const color = hsvToHex(hsv.h, hsv.s, hsv.v);
          return {
            ...updateColor(draft, picker.role, color + themePickerAlphaSuffix(value)),
            picker: {
              ...picker,
              hsv,
              hexDraft: color,
              rgbDraft: themeRgbValue(color),
              editingText: false,
            },
          };
        });
      }),
      themeEditorPickerHex: action((params) => {
        const { value } = decodeValue(params);
        update((draft) => {
          const picker = draft.picker;
          if (picker === null) return draft;
          const typed = { ...picker, hexDraft: value, editingText: true };
          if (!isThemePickerHexInput(value)) return { ...draft, picker: typed };
          return {
            ...updateColor(draft, picker.role, value.toLowerCase()),
            picker: { ...typed, hsv: hexToHsv(value), rgbDraft: themeRgbValue(value) },
          };
        });
      }),
      themeEditorPickerRgb: action((params) => {
        const { value } = decodeValue(params);
        update((draft) => {
          const picker = draft.picker;
          if (picker === null) return draft;
          const typed = { ...picker, rgbDraft: value, editingText: true };
          const color = themeRgbToHex(value);
          if (color === null) return { ...draft, picker: typed };
          const current = draft.colorsByAppearance[draft.activeAppearance][picker.role];
          return {
            ...updateColor(draft, picker.role, color + themePickerAlphaSuffix(current)),
            picker: { ...typed, hsv: hexToHsv(color), hexDraft: color },
          };
        });
      }),
      themeEditorPickerBlur: action(() => {
        update((draft) =>
          draft.picker === null
            ? draft
            : { ...draft, picker: { ...draft.picker, editingText: false } },
        );
      }),
    },
  };
}
