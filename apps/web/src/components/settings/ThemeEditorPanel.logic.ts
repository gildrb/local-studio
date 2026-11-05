import {
  THEME_COLOR_ROLES,
  THEME_FILE_VERSION,
  createVividThemeColors,
  getStandardThemeColors,
  getThemeColorsForMode,
  getThemeModes,
  isThemeColor,
  parseThemeFile,
  themeIdFromName,
  updateThemeColorFamily,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "../../themePalette";
import {
  buildThemeColorFieldModel,
  getThemeRoleLabel,
  type ThemeColorFieldModel,
} from "./ThemeColorPicker.logic";

export const THEME_EDITOR_SIMPLE_ROLES: ReadonlyArray<ThemeColorRole> = ["canvas", "accent"];

export type ThemeEditorColorFamily = Readonly<{
  id: string;
  label: string;
  role: ThemeColorRole;
  roles: ReadonlyArray<ThemeColorRole>;
}>;

export type ThemeEditorRoleGroup = Readonly<{
  id: string;
  title: string;
  families: ReadonlyArray<ThemeEditorColorFamily>;
}>;

export const THEME_EDITOR_ROLE_GROUPS: ReadonlyArray<ThemeEditorRoleGroup> = [
  {
    id: "foundation",
    title: "Foundation",
    families: [
      {
        id: "background",
        label: "Background",
        role: "canvas",
        roles: ["canvas", "chrome", "toolbar"],
      },
      { id: "surface", label: "Surface", role: "surface", roles: ["surface"] },
      {
        id: "raised-surface",
        label: "Raised surface",
        role: "surfaceRaised",
        roles: ["surfaceRaised"],
      },
      {
        id: "overlay",
        label: "Overlay",
        role: "surfaceOverlay",
        roles: ["surfaceOverlay"],
      },
      {
        id: "text",
        label: "Text",
        role: "text",
        roles: ["text", "toolbarForeground", "toolbarControlForeground"],
      },
      {
        id: "muted-text",
        label: "Muted text",
        role: "mutedForeground",
        roles: [
          "textMuted",
          "mutedForeground",
          "placeholder",
          "secondaryLabel",
          "iconMuted",
          "sidebarMutedForeground",
        ],
      },
      {
        id: "border",
        label: "Border",
        role: "border",
        roles: ["border", "toolbarBorder", "sidebarBorder"],
      },
      { id: "input", label: "Input", role: "input", roles: ["input"] },
    ],
  },
  {
    id: "brand-content",
    title: "Brand & content",
    families: [
      {
        id: "subtle-surface",
        label: "Subtle surface",
        role: "secondary",
        roles: ["secondary", "secondaryForeground", "muted", "toolbarControl"],
      },
      {
        id: "highlight-surface",
        label: "Highlight surface",
        role: "accentSurface",
        roles: ["accentSurface", "accentSurfaceForeground", "toolbarControlHover"],
      },
      {
        id: "accent",
        label: "Accent",
        role: "accent",
        roles: [
          "accent",
          "accentForeground",
          "focus",
          "update",
          "updateForeground",
          "updateSurface",
          "terminalCursor",
        ],
      },
      {
        id: "action",
        label: "Action",
        role: "messageAction",
        roles: ["messageAction", "messageActionForeground", "messageActionHover"],
      },
      {
        id: "message-surface",
        label: "Message surface",
        role: "messageSurface",
        roles: ["messageSurface", "messageForeground"],
      },
      {
        id: "code-surface",
        label: "Code surface",
        role: "codeBackground",
        roles: ["codeBackground", "codeForeground"],
      },
    ],
  },
  {
    id: "context",
    title: "Context",
    families: [
      {
        id: "sidebar-background",
        label: "Sidebar background",
        role: "sidebar",
        roles: ["sidebar", "sidebarForeground"],
      },
      {
        id: "sidebar-controls",
        label: "Sidebar controls",
        role: "sidebarControlSurface",
        roles: ["sidebarControlSurface"],
      },
      {
        id: "sidebar-selection",
        label: "Sidebar selection",
        role: "sidebarRowSelected",
        roles: ["sidebarRowHover", "sidebarRowActive", "sidebarRowSelected"],
      },
      {
        id: "terminal-background",
        label: "Terminal background",
        role: "terminalBackground",
        roles: [
          "terminalBackground",
          "terminalForeground",
          "terminalSelection",
          "terminalScrollbar",
          "terminalScrollbarHover",
        ],
      },
    ],
  },
  {
    id: "status",
    title: "Status",
    families: [
      {
        id: "error",
        label: "Error",
        role: "error",
        roles: ["error", "errorForeground", "errorSurface"],
      },
      {
        id: "warning",
        label: "Warning",
        role: "warning",
        roles: ["warning", "warningForeground", "warningSurface"],
      },
    ],
  },
];

const THEME_EDITOR_COLOR_FAMILY_BY_ROLE = new Map(
  THEME_EDITOR_ROLE_GROUPS.flatMap((group) => group.families).flatMap((family) =>
    family.roles.map((role) => [role, family] as const),
  ),
);

export function getThemeEditorColorFamily(role: ThemeColorRole): ThemeEditorColorFamily | null {
  return THEME_EDITOR_COLOR_FAMILY_BY_ROLE.get(role) ?? null;
}

export function themeEditorRoleDisplayLabel(role: ThemeColorRole): string {
  return getThemeEditorColorFamily(role)?.label ?? getThemeRoleLabel(role);
}

export function isThemeEditorSimpleRole(role: ThemeColorRole): boolean {
  return THEME_EDITOR_SIMPLE_ROLES.includes(role);
}

export type ThemeEditorColorsByAppearance = Record<ThemeAppearance, ThemeColors>;
export type ThemeEditorDirtyByAppearance = Record<ThemeAppearance, boolean>;

export function getThemeEditorColorsByAppearance(): ThemeEditorColorsByAppearance {
  return {
    light: { ...getStandardThemeColors("light") },
    dark: { ...getStandardThemeColors("dark") },
  };
}

function isThemeEditorColor(value: string): boolean {
  return isThemeColor(value.trim());
}

export function getManagedEditorColors(
  appearance: ThemeAppearance,
  colors: ThemeColors,
): ThemeColors {
  const defaults = getStandardThemeColors(appearance);
  return createVividThemeColors(
    appearance,
    isThemeEditorColor(colors.canvas) ? colors.canvas : defaults.canvas,
    isThemeEditorColor(colors.accent) ? colors.accent : defaults.accent,
  );
}

export type ThemeEditorSeedInput = {
  readonly editingTheme: ThemeDefinition | null;
  readonly seedTheme: ThemeDefinition | null;
  readonly seedName: string | null;
  readonly initialAppearance: ThemeAppearance;
};

export type ThemeEditorSeed = {
  readonly name: string;
  readonly activeAppearance: ThemeAppearance;
  readonly isAdvanced: boolean;
  readonly shouldRegenerateGuidedColors: boolean;
  readonly colorsByAppearance: ThemeEditorColorsByAppearance;
};

export function resolveThemeEditorSeed(input: ThemeEditorSeedInput): ThemeEditorSeed {
  const sourceTheme = input.editingTheme ?? input.seedTheme;
  const colorsByAppearance = getThemeEditorColorsByAppearance();
  const activeAppearance = sourceTheme
    ? getThemeColorsForMode(sourceTheme, input.initialAppearance)
      ? input.initialAppearance
      : sourceTheme.appearance
    : input.initialAppearance;
  if (sourceTheme) {
    colorsByAppearance[sourceTheme.appearance] = { ...sourceTheme.colors };
    for (const appearance of ["light", "dark"] as const) {
      const variantColors = sourceTheme.variants?.[appearance];
      if (variantColors) colorsByAppearance[appearance] = { ...variantColors };
    }
  }
  const isUnmanaged = sourceTheme !== null && sourceTheme.managed !== true;
  return {
    name: input.editingTheme?.label ?? input.seedName ?? "",
    activeAppearance,
    isAdvanced: isUnmanaged,
    shouldRegenerateGuidedColors: isUnmanaged,
    colorsByAppearance,
  };
}

export type ThemeEditorMergeTargetInput = {
  readonly name: string;
  readonly editingTheme: ThemeDefinition | null;
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
};

export function resolveThemeEditorMergeTarget(
  input: ThemeEditorMergeTargetInput,
): ThemeDefinition | null {
  const nameTargetId = themeIdFromName(input.name);
  const normalizedName = input.name.trim().toLowerCase();
  if (normalizedName === "") return null;
  return (
    input.customThemes.find(
      (theme) =>
        theme.id !== input.editingTheme?.id &&
        (theme.id === nameTargetId || theme.label.trim().toLowerCase() === normalizedName),
    ) ?? null
  );
}

export type ThemeEditorAppearanceLockInput = {
  readonly appearance: ThemeAppearance;
  readonly editingTheme: ThemeDefinition | null;
  readonly mergeTarget: ThemeDefinition | null;
};

export function resolveThemeEditorAppearanceLock(
  input: ThemeEditorAppearanceLockInput,
): string | null {
  const editableAppearances = input.editingTheme ? getThemeModes(input.editingTheme) : null;
  if (editableAppearances && !editableAppearances.includes(input.appearance)) {
    return `“${input.editingTheme?.label}” has no ${input.appearance} palette. Create a theme with the same name to add one.`;
  }
  const takenAppearances = input.mergeTarget ? getThemeModes(input.mergeTarget) : [];
  if (input.editingTheme === null && takenAppearances.includes(input.appearance)) {
    return `“${input.mergeTarget?.label}” already has a ${input.appearance} palette.`;
  }
  return null;
}

export function resolveThemeEditorAutoAppearance(
  current: ThemeAppearance,
  takenAppearances: ReadonlyArray<ThemeAppearance>,
): ThemeAppearance {
  if (takenAppearances.length !== 1) return current;
  if (!takenAppearances.includes(current)) return current;
  return takenAppearances[0] === "light" ? "dark" : "light";
}

export type ThemeEditorColorChange = {
  readonly activeAppearance: ThemeAppearance;
  readonly isAdvanced: boolean;
  readonly role: ThemeColorRole;
  readonly value: string;
};

export function applyThemeEditorColorChange(
  colors: ThemeEditorColorsByAppearance,
  change: ThemeEditorColorChange,
): ThemeEditorColorsByAppearance {
  const current = colors[change.activeAppearance];
  const nextColors = { ...current, [change.role]: change.value };
  const shouldManageColors =
    !change.isAdvanced && isThemeEditorSimpleRole(change.role) && isThemeEditorColor(change.value);
  return {
    ...colors,
    [change.activeAppearance]: change.isAdvanced
      ? updateThemeColorFamily(change.activeAppearance, current, change.role, change.value)
      : shouldManageColors
        ? getManagedEditorColors(change.activeAppearance, nextColors)
        : nextColors,
  };
}

export type ThemeEditorColorChangeEffects = {
  readonly markGuidedDirty: boolean;
  readonly markRegenerateGuided: boolean;
};

export function resolveThemeEditorColorChangeEffects(
  change: ThemeEditorColorChange,
): ThemeEditorColorChangeEffects {
  return {
    markGuidedDirty:
      !change.isAdvanced &&
      isThemeEditorSimpleRole(change.role) &&
      isThemeEditorColor(change.value),
    markRegenerateGuided: change.isAdvanced,
  };
}

export type ThemeEditorRoleSelection = {
  readonly selectedRole: ThemeColorRole;
  readonly revealAdvanced: boolean;
};

export function resolveThemeEditorRoleSelection(role: ThemeColorRole): ThemeEditorRoleSelection {
  const selectedRole = getThemeEditorColorFamily(role)?.role ?? role;
  return { selectedRole, revealAdvanced: !isThemeEditorSimpleRole(selectedRole) };
}

export function resolveThemeEditorRoleToggle(
  current: ThemeColorRole | null,
  role: ThemeColorRole,
): ThemeColorRole | null {
  return current === role ? null : role;
}

export type ThemeEditorHighlightInput = {
  readonly selectedRole: ThemeColorRole | null;
  readonly isAdvanced: boolean;
  readonly colors: ThemeColors;
};

export function resolveThemeEditorHighlightRoles(
  input: ThemeEditorHighlightInput,
): ReadonlyArray<ThemeColorRole> {
  const selectedRole = input.selectedRole;
  if (!selectedRole) return [];
  if (input.isAdvanced) return getThemeEditorColorFamily(selectedRole)?.roles ?? [selectedRole];
  if (!isThemeEditorSimpleRole(selectedRole)) return [selectedRole];
  const selectedValue = input.colors[selectedRole].trim().toLowerCase();
  return THEME_COLOR_ROLES.filter(
    (role) => input.colors[role].trim().toLowerCase() === selectedValue,
  );
}

export type ThemeEditorAdvancedToggleInput = {
  readonly checked: boolean;
  readonly selectedRole: ThemeColorRole | null;
  readonly shouldRegenerateGuidedColors: boolean;
  readonly editingTheme: ThemeDefinition | null;
  readonly activeAppearance: ThemeAppearance;
};

export type ThemeEditorAdvancedToggleDecision = {
  readonly isAdvanced: boolean;
  readonly clearSelectedRole: boolean;
  readonly regenerateAppearances: ReadonlyArray<ThemeAppearance> | null;
};

export function resolveThemeEditorAdvancedToggle(
  input: ThemeEditorAdvancedToggleInput,
): ThemeEditorAdvancedToggleDecision {
  if (input.checked) {
    return { isAdvanced: true, clearSelectedRole: false, regenerateAppearances: null };
  }
  const clearSelectedRole =
    input.selectedRole !== null && !isThemeEditorSimpleRole(input.selectedRole);
  if (!input.shouldRegenerateGuidedColors) {
    return { isAdvanced: false, clearSelectedRole, regenerateAppearances: null };
  }
  return {
    isAdvanced: false,
    clearSelectedRole,
    regenerateAppearances:
      input.editingTheme && getThemeModes(input.editingTheme).length > 1
        ? ["light", "dark"]
        : [input.activeAppearance],
  };
}

export function markThemeEditorAppearancesDirty(
  dirty: ThemeEditorDirtyByAppearance,
  appearances: ReadonlyArray<ThemeAppearance>,
): ThemeEditorDirtyByAppearance {
  const next = { ...dirty };
  for (const appearance of appearances) next[appearance] = true;
  return next;
}

export function regenerateThemeEditorColors(
  colors: ThemeEditorColorsByAppearance,
  appearances: ReadonlyArray<ThemeAppearance>,
): ThemeEditorColorsByAppearance {
  const next = { ...colors };
  for (const appearance of appearances) {
    next[appearance] = getManagedEditorColors(appearance, colors[appearance]);
  }
  return next;
}

export const THEME_EDITOR_NAME_REQUIRED_MESSAGE = "Name your theme first.";
export const THEME_EDITOR_ACTIVATION_FAILURE_MESSAGE =
  "Theme saved, but it could not be made active. Try again.";

export function themeEditorSaveErrorMessage(cause: unknown, isEditing: boolean): string {
  if (cause instanceof Error) return cause.message;
  return isEditing ? "Could not save the theme." : "Could not create the theme.";
}

export type ThemeEditorSaveContext = {
  readonly created: boolean;
  readonly mergedAppearance?: ThemeAppearance;
};

export type ThemeEditorSaveRollback =
  | { readonly kind: "none" }
  | { readonly kind: "remove-saved" }
  | {
      readonly kind: "restore-merge";
      readonly mergeTarget: ThemeDefinition;
      readonly retiredTheme: ThemeDefinition | null;
    };

export type ThemeEditorSavePlan =
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "merge-edited";
      readonly theme: ThemeDefinition;
      readonly mergeTarget: ThemeDefinition;
      readonly retiredTheme: ThemeDefinition;
      readonly context: ThemeEditorSaveContext;
      readonly rollback: ThemeEditorSaveRollback;
    }
  | {
      readonly kind: "update" | "merge-new";
      readonly theme: ThemeDefinition;
      readonly context: ThemeEditorSaveContext;
      readonly rollback: ThemeEditorSaveRollback;
    }
  | {
      readonly kind: "install";
      readonly theme: ThemeDefinition;
      readonly context: ThemeEditorSaveContext;
      readonly rollback: ThemeEditorSaveRollback;
    };

export type ThemeEditorSaveInput = {
  readonly name: string;
  readonly editingTheme: ThemeDefinition | null;
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
  readonly activeAppearance: ThemeAppearance;
  readonly isAdvanced: boolean;
  readonly colorsByAppearance: ThemeEditorColorsByAppearance;
  readonly guidedDirtyByAppearance: ThemeEditorDirtyByAppearance;
};

function saveContext(created: boolean, mergedAppearance: ThemeAppearance | null) {
  return { created, ...(mergedAppearance ? { mergedAppearance } : {}) };
}

function mergeRollback(
  mergeTarget: ThemeDefinition,
  mergedAppearance: ThemeAppearance | null,
  retiredTheme: ThemeDefinition | null,
): ThemeEditorSaveRollback {
  return mergedAppearance === null
    ? { kind: "none" }
    : { kind: "restore-merge", mergeTarget, retiredTheme };
}

export function resolveThemeEditorSave(input: ThemeEditorSaveInput): ThemeEditorSavePlan {
  const { name, editingTheme, isAdvanced, colorsByAppearance, activeAppearance } = input;
  if (!name.trim()) return { kind: "error", message: THEME_EDITOR_NAME_REQUIRED_MESSAGE };

  const colorsForSave = !isAdvanced
    ? {
        light: input.guidedDirtyByAppearance.light
          ? getManagedEditorColors("light", colorsByAppearance.light)
          : colorsByAppearance.light,
        dark: input.guidedDirtyByAppearance.dark
          ? getManagedEditorColors("dark", colorsByAppearance.dark)
          : colorsByAppearance.dark,
      }
    : colorsByAppearance;
  const mergeTarget = resolveThemeEditorMergeTarget(input);
  const takenAppearances = mergeTarget ? getThemeModes(mergeTarget) : [];

  if (editingTheme && mergeTarget) {
    const editedModes = getThemeModes(editingTheme);
    const collision = editedModes.find((mode) => takenAppearances.includes(mode));
    if (collision) {
      return {
        kind: "error",
        message: `“${mergeTarget.label}” already has a ${collision} palette. Pick another name.`,
      };
    }
    const mergedAppearance = editedModes[0] ?? null;
    return {
      kind: "merge-edited",
      theme: {
        ...parseThemeFile({
          version: THEME_FILE_VERSION,
          id: mergeTarget.id,
          name: mergeTarget.label,
          appearance: mergeTarget.appearance,
          colors: mergeTarget.colors,
          variants: {
            ...mergeTarget.variants,
            ...Object.fromEntries(editedModes.map((mode) => [mode, colorsForSave[mode]])),
          },
          ...(mergeTarget.managed === true && !isAdvanced ? { managed: true } : {}),
        }),
        ...(mergeTarget.collection ? { collection: mergeTarget.collection } : {}),
      },
      mergeTarget,
      retiredTheme: editingTheme,
      context: saveContext(false, mergedAppearance),
      rollback: mergeRollback(mergeTarget, mergedAppearance, editingTheme),
    };
  }
  if (editingTheme) {
    const baseAppearance = editingTheme.appearance;
    const variantAppearance = baseAppearance === "light" ? "dark" : "light";
    return {
      kind: "update",
      theme: {
        ...parseThemeFile({
          version: THEME_FILE_VERSION,
          id: editingTheme.id,
          name,
          appearance: baseAppearance,
          colors: colorsForSave[baseAppearance],
          ...(getThemeModes(editingTheme).length > 1
            ? { variants: { [variantAppearance]: colorsForSave[variantAppearance] } }
            : {}),
          ...(isAdvanced ? {} : { managed: true }),
        }),
        ...(editingTheme.collection ? { collection: editingTheme.collection } : {}),
      },
      context: saveContext(false, null),
      rollback: { kind: "none" },
    };
  }
  if (mergeTarget) {
    if (takenAppearances.includes(activeAppearance)) {
      return {
        kind: "error",
        message: `“${mergeTarget.label}” already has light and dark palettes. Pick another name.`,
      };
    }
    return {
      kind: "merge-new",
      theme: {
        ...parseThemeFile({
          version: THEME_FILE_VERSION,
          id: mergeTarget.id,
          name: mergeTarget.label,
          appearance: mergeTarget.appearance,
          colors: mergeTarget.colors,
          variants: {
            ...mergeTarget.variants,
            [activeAppearance]: colorsForSave[activeAppearance],
          },
          ...(mergeTarget.managed === true && !isAdvanced ? { managed: true } : {}),
        }),
        ...(mergeTarget.collection ? { collection: mergeTarget.collection } : {}),
      },
      context: saveContext(false, activeAppearance),
      rollback: mergeRollback(mergeTarget, activeAppearance, null),
    };
  }
  return {
    kind: "install",
    theme: parseThemeFile({
      version: THEME_FILE_VERSION,
      name,
      appearance: activeAppearance,
      colors: colorsForSave[activeAppearance],
      ...(isAdvanced ? {} : { managed: true }),
    }),
    context: saveContext(true, null),
    rollback: { kind: "remove-saved" },
  };
}

export type ThemeEditorModelInput = {
  readonly editingTheme: ThemeDefinition | null;
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
  readonly name: string;
  readonly activeAppearance: ThemeAppearance;
  readonly isAdvanced: boolean;
  readonly colorsByAppearance: ThemeEditorColorsByAppearance;
  readonly roleQuery: string;
  readonly selectedRole: ThemeColorRole | null;
  readonly usageCount: number | null;
  readonly isInspecting: boolean;
  readonly isMinimized: boolean;
  readonly error: string | null;
};

export type ThemeEditorAppearanceOption = {
  readonly value: ThemeAppearance;
  readonly label: string;
  readonly locked: boolean;
  readonly lockReason: string | null;
};

export type ThemeEditorFieldGroup = {
  readonly id: string;
  readonly title: string;
  readonly fields: ReadonlyArray<ThemeColorFieldModel>;
};

export type ThemeEditorSubmitIcon = "plus" | "paintbrush";

export type ThemeEditorModel = {
  readonly title: string;
  readonly isEditing: boolean;
  readonly statusText: string | null;
  readonly inspect: {
    readonly active: boolean;
    readonly label: string;
    readonly ariaLabel: string;
    readonly tooltip: string;
    readonly icon: "mouse-pointer-2";
  };
  readonly minimize: {
    readonly minimized: boolean;
    readonly ariaLabel: string;
    readonly icon: "chevron-up" | "chevron-down";
  };
  readonly close: { readonly ariaLabel: string; readonly icon: "x" };
  readonly nameField: {
    readonly label: string;
    readonly placeholder: string;
    readonly value: string;
  };
  readonly error: string | null;
  readonly appearance: {
    readonly label: string;
    readonly ariaLabel: string;
    readonly value: ThemeAppearance;
    readonly options: ReadonlyArray<ThemeEditorAppearanceOption>;
  };
  readonly colors: {
    readonly title: string;
    readonly subtitle: string | null;
    readonly advanced: boolean;
    readonly advancedLabel: string;
    readonly advancedAriaLabel: string;
    readonly filter: {
      readonly ariaLabel: string;
      readonly placeholder: string;
      readonly value: string;
    } | null;
    readonly groups: ReadonlyArray<ThemeEditorFieldGroup>;
    readonly guidedFields: ReadonlyArray<ThemeColorFieldModel>;
    readonly emptyMessage: string | null;
  };
  readonly mergeTarget: {
    readonly id: string;
    readonly label: string;
    readonly takenAppearances: ReadonlyArray<ThemeAppearance>;
  } | null;
  readonly highlightRoles: ReadonlyArray<ThemeColorRole>;
  readonly footer: {
    readonly cancelLabel: string;
    readonly submitLabel: string;
    readonly submitIcon: ThemeEditorSubmitIcon | null;
    readonly submitDisabled: boolean;
  };
};

function themeEditorStatusText(input: ThemeEditorModelInput): string | null {
  if (input.isMinimized) return null;
  if (input.isInspecting) return "Select an element · Esc to cancel";
  if (!input.selectedRole) return "Select a color below";
  const label = input.isAdvanced
    ? themeEditorRoleDisplayLabel(input.selectedRole)
    : getThemeRoleLabel(input.selectedRole);
  return `${label} · ${input.usageCount ?? 0} ${input.usageCount === 1 ? "use" : "uses"}`;
}

function themeEditorSubmit(
  isEditing: boolean,
  mergeTarget: ThemeDefinition | null,
  activeAppearance: ThemeAppearance,
): { readonly label: string; readonly icon: ThemeEditorSubmitIcon | null } {
  if (isEditing) {
    return {
      label: mergeTarget ? `Merge into “${mergeTarget.label}”` : "Save changes",
      icon: null,
    };
  }
  return mergeTarget
    ? { label: `Add ${activeAppearance} palette`, icon: "plus" }
    : { label: "Create theme", icon: "paintbrush" };
}

export function buildThemeEditorModel(input: ThemeEditorModelInput): ThemeEditorModel {
  const isEditing = input.editingTheme !== null;
  const mergeTarget = resolveThemeEditorMergeTarget(input);
  const colors = input.colorsByAppearance[input.activeAppearance];
  const query = input.roleQuery.trim().toLowerCase();
  const groups = input.isAdvanced
    ? THEME_EDITOR_ROLE_GROUPS.map((group) => ({
        id: group.id,
        title: group.title,
        fields: group.families
          .filter(
            (family) =>
              !query ||
              [family.label, ...family.roles.map((role) => getThemeRoleLabel(role))]
                .join(" ")
                .toLowerCase()
                .includes(query),
          )
          .map((family) => ({
            ...buildThemeColorFieldModel({
              role: family.role,
              value: colors[family.role],
              selected: input.selectedRole === family.role,
              label: family.label,
            }),
            id: family.id,
          })),
      })).filter((group) => group.fields.length > 0)
    : [];
  const guidedFields = input.isAdvanced
    ? []
    : THEME_EDITOR_SIMPLE_ROLES.map((role) =>
        buildThemeColorFieldModel({
          role,
          value: colors[role],
          selected: input.selectedRole === role,
          label: role === "canvas" ? "Background" : "Accent",
        }),
      );
  const submit = themeEditorSubmit(isEditing, mergeTarget, input.activeAppearance);
  return {
    title: isEditing ? "Edit theme" : "Create theme",
    isEditing,
    statusText: themeEditorStatusText(input),
    inspect: {
      active: input.isInspecting,
      label: input.isInspecting ? "Cancel" : "Inspect",
      ariaLabel: input.isInspecting ? "Cancel inspecting app colors" : "Inspect app colors",
      tooltip: input.isInspecting ? "Cancel and clear the selection" : "Pick a color from the app",
      icon: "mouse-pointer-2",
    },
    minimize: {
      minimized: input.isMinimized,
      ariaLabel: input.isMinimized ? "Expand the theme editor" : "Minimize the theme editor",
      icon: input.isMinimized ? "chevron-up" : "chevron-down",
    },
    close: { ariaLabel: "Close the theme editor", icon: "x" },
    nameField: {
      label: "Theme name",
      placeholder: isEditing ? "Theme name" : "e.g. Aurora",
      value: input.name,
    },
    error: input.error,
    appearance: {
      label: "Appearance",
      ariaLabel: "Theme appearance",
      value: input.activeAppearance,
      options: (["light", "dark"] as const).map((appearance) => {
        const lockReason = resolveThemeEditorAppearanceLock({
          appearance,
          editingTheme: input.editingTheme,
          mergeTarget,
        });
        return {
          value: appearance,
          label: appearance === "light" ? "Light" : "Dark",
          locked: lockReason !== null,
          lockReason,
        };
      }),
    },
    colors: {
      title: "Colors",
      subtitle: input.isAdvanced ? null : "Two colors, rest derived",
      advanced: input.isAdvanced,
      advancedLabel: "Advanced",
      advancedAriaLabel: "Use advanced theme colors",
      filter: input.isAdvanced
        ? { ariaLabel: "Filter colors", placeholder: "Filter colors", value: input.roleQuery }
        : null,
      groups,
      guidedFields,
      emptyMessage: input.isAdvanced && groups.length === 0 ? "No matches." : null,
    },
    mergeTarget: mergeTarget
      ? {
          id: mergeTarget.id,
          label: mergeTarget.label,
          takenAppearances: getThemeModes(mergeTarget),
        }
      : null,
    highlightRoles: resolveThemeEditorHighlightRoles({
      selectedRole: input.selectedRole,
      isAdvanced: input.isAdvanced,
      colors,
    }),
    footer: {
      cancelLabel: "Cancel",
      submitLabel: submit.label,
      submitIcon: submit.icon,
      submitDisabled: !input.name.trim(),
    },
  };
}
