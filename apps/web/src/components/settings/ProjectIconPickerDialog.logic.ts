import {
  ProjectMonogramText,
  type ProjectIconColor,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { IconName } from "lucide-react/dynamic";

import { PROJECT_ICON_COLORS } from "../../projectIconColors";
import { filterProjectIconNames, PROJECT_EMOJIS } from "../../projectIconOptions";
import { deriveProjectIdentity } from "../../projectIdentity";

export type ProjectIconMode = ProjectIconOverride["kind"];

export type ProjectIconPickerState = {
  readonly mode: ProjectIconMode;
  readonly iconName: string;
  readonly color: ProjectIconColor;
  readonly letters: string;
  readonly emoji: string;
};

export type ProjectIconPickerOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
};

export type ProjectIconPickerColorOption = ProjectIconPickerOption<ProjectIconColor> & {
  readonly selected: boolean;
};

export type ProjectIconPickerIconOption = {
  readonly name: IconName;
  readonly label: string;
  readonly selected: boolean;
};

export type ProjectIconPickerEmojiOption = {
  readonly emoji: string;
  readonly label: string;
  readonly selected: boolean;
};

export type ProjectIconPickerColorSection = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly options: readonly ProjectIconPickerColorOption[];
};

export type ProjectIconPickerIconSection = {
  readonly searchAriaLabel: string;
  readonly searchPlaceholder: string;
  readonly icons: readonly ProjectIconPickerIconOption[];
  readonly emptyLabel: string | null;
};

export type ProjectIconPickerMonogramSection = {
  readonly inputId: string;
  readonly hintId: string;
  readonly label: string;
  readonly hint: string;
  readonly previewText: string;
  readonly color: ProjectIconColor;
  readonly valid: boolean;
};

export type ProjectIconPickerEmojiSection = {
  readonly options: readonly ProjectIconPickerEmojiOption[];
  readonly customLabel: string;
  readonly customAriaLabel: string;
  readonly customPlaceholder: string;
};

export type ProjectIconPickerModelInput = {
  readonly projectName: string;
  readonly state: ProjectIconPickerState;
  readonly query: string;
  readonly iconCatalog: ReadonlyArray<IconName>;
};

export type ProjectIconPickerModel = {
  readonly title: string;
  readonly description: string;
  readonly mode: ProjectIconMode;
  readonly modeAriaLabel: string;
  readonly modeOptions: readonly ProjectIconPickerOption<ProjectIconMode>[];
  readonly colors: ProjectIconPickerColorSection | null;
  readonly icons: ProjectIconPickerIconSection | null;
  readonly monogram: ProjectIconPickerMonogramSection | null;
  readonly emojis: ProjectIconPickerEmojiSection | null;
  readonly cancelLabel: string;
  readonly saveLabel: string;
  readonly saveDisabled: boolean;
};

export type ProjectIconPickerSave =
  | { readonly kind: "invalid" }
  | { readonly kind: "select"; readonly icon: ProjectIconOverride };

const DEFAULT_ICON: IconName = "folder-code";
const DEFAULT_EMOJI = "💻";
const isMonogramText = Schema.is(ProjectMonogramText);

export const PROJECT_ICON_MODE_OPTIONS: readonly ProjectIconPickerOption<ProjectIconMode>[] = [
  { value: "lucide", label: "Icons" },
  { value: "emoji", label: "Emoji" },
  { value: "monogram", label: "Monogram" },
];

export function projectIconLabel(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolveProjectIconPickerInitialState(
  current: ProjectIconOverride | null,
  projectName: string,
): ProjectIconPickerState {
  const automatic = deriveProjectIdentity(projectName);
  return {
    mode: current?.kind ?? "lucide",
    iconName: current?.kind === "lucide" ? current.name : DEFAULT_ICON,
    color: current && current.kind !== "emoji" ? current.color : automatic.color,
    letters: current?.kind === "monogram" ? current.text : automatic.monogram,
    emoji: current?.kind === "emoji" ? current.emoji : DEFAULT_EMOJI,
  };
}

function normalizeMonogram(letters: string): string {
  return letters.normalize("NFKC").trim().toUpperCase();
}

export function buildProjectIconPickerModel(
  input: ProjectIconPickerModelInput,
): ProjectIconPickerModel {
  const { state } = input;
  const monogram = normalizeMonogram(state.letters);
  const validMonogram = isMonogramText(monogram);
  const icons =
    state.mode === "lucide" ? filterProjectIconNames(input.query, input.iconCatalog) : [];
  return {
    title: "Choose project icon",
    description: "Choose an icon, emoji, or monogram.",
    mode: state.mode,
    modeAriaLabel: "Icon type",
    modeOptions: PROJECT_ICON_MODE_OPTIONS,
    colors:
      state.mode !== "emoji"
        ? {
            label: "Color",
            ariaLabel: "Icon color",
            options: PROJECT_ICON_COLORS.map((option) => ({
              value: option.value,
              label: option.label,
              selected: state.color === option.value,
            })),
          }
        : null,
    icons:
      state.mode === "lucide"
        ? {
            searchAriaLabel: "Search Lucide icons",
            searchPlaceholder: "Search all Lucide icons",
            icons: icons.map((name) => ({
              name,
              label: projectIconLabel(name),
              selected: state.iconName === name,
            })),
            emptyLabel: icons.length === 0 ? "No icons found." : null,
          }
        : null,
    monogram:
      state.mode === "monogram"
        ? {
            inputId: "project-monogram",
            hintId: "project-monogram-hint",
            label: "Letters",
            hint: "One or two letters or numbers.",
            previewText: validMonogram
              ? monogram
              : deriveProjectIdentity(input.projectName).monogram,
            color: state.color,
            valid: validMonogram,
          }
        : null,
    emojis:
      state.mode === "emoji"
        ? {
            options: PROJECT_EMOJIS.map((option) => ({
              emoji: option.emoji,
              label: option.label,
              selected: state.emoji === option.emoji,
            })),
            customLabel: "Or paste any emoji",
            customAriaLabel: "Custom emoji",
            customPlaceholder: "Paste an emoji",
          }
        : null,
    cancelLabel: "Cancel",
    saveLabel: "Save icon",
    saveDisabled: state.mode === "monogram" && !validMonogram,
  };
}

export function resolveProjectIconPickerMode(value: unknown): ProjectIconMode | null {
  return value === "lucide" || value === "emoji" || value === "monogram" ? value : null;
}

export function resolveProjectIconPickerSave(state: ProjectIconPickerState): ProjectIconPickerSave {
  const monogram = normalizeMonogram(state.letters);
  if (state.mode === "monogram" && !isMonogramText(monogram)) return { kind: "invalid" };
  return {
    kind: "select",
    icon:
      state.mode === "monogram"
        ? { kind: "monogram", text: monogram, color: state.color }
        : state.mode === "lucide"
          ? { kind: "lucide", name: state.iconName, color: state.color }
          : { kind: "emoji", emoji: state.emoji },
  };
}
