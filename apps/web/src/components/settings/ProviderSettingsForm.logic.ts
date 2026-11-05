import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  ProviderSettingsFormAnnotation,
  ProviderSettingsFormControl,
  ProviderSettingsFormOption,
  ProviderSettingsFormSchemaAnnotation,
} from "@t3tools/contracts";

import type { ProviderDriverMeta } from "./providerDriverMeta.logic";

export type ProviderSettingsFormDefinition = Pick<ProviderDriverMeta, "settingsSchema">;

type ProviderSettingsFieldSchema = ProviderDriverMeta["settingsSchema"]["fields"][string];

export type ProviderSettingsFieldModel = {
  readonly key: string;
  readonly control: ProviderSettingsFormControl;
  readonly label: string;
  readonly description?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearWhenEmpty: "omit" | "persist";
  readonly defaultBooleanValue?: boolean | undefined;
  readonly options?: ReadonlyArray<ProviderSettingsFormOption> | undefined;
};

export type ProviderSettingsFormFieldRow = ProviderSettingsFieldModel & {
  readonly inputId: string;
  readonly descriptionId: string | null;
  readonly textValue: string;
  readonly checked: boolean;
  readonly selectedLabel: string;
  readonly inputType: "password" | null;
  readonly autoComplete: "off" | null;
  readonly sensitive: boolean;
};

export type ProviderSettingsFormModelInput = {
  readonly definition: ProviderSettingsFormDefinition;
  readonly config: unknown;
  readonly idPrefix: string;
};

export type ProviderSettingsFormModel = {
  readonly fields: ReadonlyArray<ProviderSettingsFormFieldRow>;
};

export type ProviderSettingsFormChange =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "switch"; readonly value: boolean }
  | { readonly kind: "select"; readonly value: string };

export type ProviderSettingsFormChangeInput = {
  readonly config: unknown;
  readonly field: ProviderSettingsFieldModel;
  readonly change: ProviderSettingsFormChange;
};

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function titleizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function readFieldAnnotations(fieldSchema: ProviderSettingsFieldSchema) {
  return Schema.resolveAnnotationsKey(fieldSchema) ?? Schema.resolveAnnotations(fieldSchema);
}

function readFieldAnnotationString(
  fieldSchema: ProviderSettingsFieldSchema,
  key: "title" | "description",
): string | undefined {
  const annotations = readFieldAnnotations(fieldSchema);
  const value = annotations?.[key];
  return typeof value === "string" ? value : undefined;
}

function readProviderSettingsFormAnnotation(
  fieldSchema: ProviderSettingsFieldSchema,
): ProviderSettingsFormAnnotation {
  const annotation = readFieldAnnotations(fieldSchema)?.providerSettingsForm;
  return annotation ?? {};
}

function readProviderSettingsFormSchemaAnnotation(
  definition: ProviderSettingsFormDefinition,
): ProviderSettingsFormSchemaAnnotation {
  return Schema.resolveAnnotations(definition.settingsSchema)?.providerSettingsFormSchema ?? {};
}

function readFieldBooleanDefault(fieldSchema: ProviderSettingsFieldSchema): boolean | undefined {
  const decodeDefault = Schema.decodeUnknownOption(
    Schema.make<Schema.Decoder<unknown>>(fieldSchema.ast),
  );
  const decoded = decodeDefault(undefined);
  return Option.isSome(decoded) && typeof decoded.value === "boolean" ? decoded.value : undefined;
}

export function deriveProviderSettingsFields(
  definition: ProviderSettingsFormDefinition,
): ReadonlyArray<ProviderSettingsFieldModel> {
  const schemaAnnotation = readProviderSettingsFormSchemaAnnotation(definition);
  const orderedKeys = new Map(
    (schemaAnnotation.order ?? []).map((key, index) => [key, index] as const),
  );
  const orderFallbackOffset = orderedKeys.size;

  return Object.entries(definition.settingsSchema.fields)
    .map(([key, fieldSchema], index) => ({ key, fieldSchema, index }))
    .toSorted((left, right) => {
      return (
        (orderedKeys.get(left.key) ?? orderFallbackOffset + left.index) -
        (orderedKeys.get(right.key) ?? orderFallbackOffset + right.index)
      );
    })
    .flatMap(({ key, fieldSchema }) => {
      const formAnnotation = readProviderSettingsFormAnnotation(fieldSchema);
      if (formAnnotation.hidden) return [];

      const annotatedTitle = readFieldAnnotationString(fieldSchema, "title");
      const annotatedDescription = readFieldAnnotationString(fieldSchema, "description");
      return [
        {
          key,
          control: formAnnotation.control ?? "text",
          label: annotatedTitle ?? titleizeFieldKey(key),
          ...(annotatedDescription !== undefined ? { description: annotatedDescription } : {}),
          ...(formAnnotation.placeholder !== undefined
            ? { placeholder: formAnnotation.placeholder }
            : {}),
          clearWhenEmpty: formAnnotation.clearWhenEmpty ?? "omit",
          ...(formAnnotation.control === "switch"
            ? { defaultBooleanValue: readFieldBooleanDefault(fieldSchema) }
            : {}),
          ...(formAnnotation.control === "select" && formAnnotation.options
            ? { options: formAnnotation.options }
            : {}),
        } satisfies ProviderSettingsFieldModel,
      ];
    });
}

function readProviderConfigString(config: unknown, key: string): string {
  if (!isConfigRecord(config)) return "";
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function readProviderConfigBoolean(config: unknown, key: string, defaultValue = false): boolean {
  if (!isConfigRecord(config)) return defaultValue;
  const value = config[key];
  return typeof value === "boolean" ? value : defaultValue;
}

function providerSettingsSelectFallback(field: ProviderSettingsFieldModel): string {
  return field.options?.[0]?.value ?? "";
}

export function nextProviderConfigWithFieldValue(
  config: unknown,
  field: ProviderSettingsFieldModel,
  value: string | boolean,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> = isConfigRecord(config) ? { ...config } : {};

  if (typeof value === "boolean") {
    const emptyBooleanValue = field.defaultBooleanValue ?? false;
    if (field.clearWhenEmpty === "omit" && value === emptyBooleanValue) {
      delete base[field.key];
    } else {
      base[field.key] = value;
    }
    return Object.keys(base).length > 0 ? base : undefined;
  }

  const trimmed = value.trim();
  if (field.clearWhenEmpty === "omit" && trimmed.length === 0) {
    delete base[field.key];
  } else {
    base[field.key] = value;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

function buildProviderSettingsFormFieldRow(
  field: ProviderSettingsFieldModel,
  config: unknown,
  idPrefix: string,
): ProviderSettingsFormFieldRow {
  const inputId = `${idPrefix}-${field.key}`;
  const textValue = readProviderConfigString(config, field.key);
  const selectedValue =
    field.control === "select" ? textValue || providerSettingsSelectFallback(field) : textValue;
  const selectedLabel =
    field.options?.find((option) => option.value === selectedValue)?.label ?? selectedValue;
  return {
    ...field,
    inputId,
    descriptionId: field.description ? `${inputId}-description` : null,
    textValue: selectedValue,
    checked: readProviderConfigBoolean(config, field.key, field.defaultBooleanValue),
    selectedLabel,
    inputType: field.control === "password" ? "password" : null,
    autoComplete: field.control === "password" ? "off" : null,
    sensitive: field.control === "password",
  };
}

export function buildProviderSettingsFormModel(
  input: ProviderSettingsFormModelInput,
): ProviderSettingsFormModel {
  return {
    fields: deriveProviderSettingsFields(input.definition).map((field) =>
      buildProviderSettingsFormFieldRow(field, input.config, input.idPrefix),
    ),
  };
}

export function resolveProviderSettingsFormChange(
  input: ProviderSettingsFormChangeInput,
): Record<string, unknown> | undefined {
  const { change, config, field } = input;
  if (change.kind === "select") {
    const fallback = providerSettingsSelectFallback(field);
    return nextProviderConfigWithFieldValue(
      config,
      field,
      change.value === fallback ? "" : change.value,
    );
  }
  return nextProviderConfigWithFieldValue(config, field, change.value);
}
