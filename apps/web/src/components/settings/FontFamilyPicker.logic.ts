export const DEFAULT_FONT_VALUE = "__default__";

export type FontFamilyPickerItem = {
  readonly value: string;
  readonly family: string;
  readonly isDefault: boolean;
  readonly selected: boolean;
};

export type FontFamilyPickerModelInput = {
  readonly families: readonly string[];
  readonly query: string;
  readonly selectedFamily: string;
  readonly defaultFamily: string;
};

export type FontFamilyPickerModel = {
  readonly triggerLabel: string;
  readonly selectedValue: string;
  readonly searchPlaceholder: string;
  readonly emptyLabel: string;
  readonly defaultBadgeLabel: string;
  readonly items: readonly FontFamilyPickerItem[];
};

export function buildFontFamilyPickerModel(
  input: FontFamilyPickerModelInput,
): FontFamilyPickerModel {
  const trimmedQuery = input.query.trim().toLowerCase();
  const values: string[] = [];
  if (trimmedQuery.length === 0) values.push(DEFAULT_FONT_VALUE);
  values.push(
    ...input.families.filter(
      (family) => trimmedQuery.length === 0 || family.toLowerCase().includes(trimmedQuery),
    ),
  );
  const selectedValue =
    input.selectedFamily.length === 0 ? DEFAULT_FONT_VALUE : input.selectedFamily;
  return {
    triggerLabel: input.selectedFamily.length === 0 ? input.defaultFamily : input.selectedFamily,
    selectedValue,
    searchPlaceholder: "Search fonts…",
    emptyLabel: "No fonts found.",
    defaultBadgeLabel: "default",
    items: values.map((value) => {
      const isDefault = value === DEFAULT_FONT_VALUE;
      return {
        value,
        family: isDefault ? input.defaultFamily : value,
        isDefault,
        selected: value === selectedValue,
      };
    }),
  };
}

export function resolveFontFamilyPick(value: string): string {
  return value === DEFAULT_FONT_VALUE ? "" : value;
}
