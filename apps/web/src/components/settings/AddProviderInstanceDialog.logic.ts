import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";

import {
  getDriverMeta,
  PROVIDER_DRIVER_METAS,
  type ProviderDriverIconKey,
  type ProviderDriverMeta,
} from "./providerDriverMeta.logic";
import { deriveProviderSettingsFields } from "./ProviderSettingsForm.logic";

export type WizardNavigation =
  | { readonly kind: "navigate"; readonly step: number }
  | { readonly kind: "blocked"; readonly step: number; readonly error: string };

const IDENTITY_STEP = 1;

export const ADD_PROVIDER_WIZARD_STEPS = ["Driver", "Identity", "Config"] as const;

/**
 * Resolve navigation within the add-provider wizard.
 *
 * Moving forward past Identity requires a valid instance id, whether the user
 * advances one step at a time or skips directly to Config from a step header.
 * A blocked skip lands on Identity so its existing inline validation is
 * visible. Backward navigation is always preserved.
 */
export function resolveWizardNavigation(
  currentStep: number,
  requestedStep: number,
  stepCount: number,
  validation: { readonly instanceIdError: string | null },
): WizardNavigation {
  const lastStep = Math.max(0, stepCount - 1);
  const targetStep = Math.max(0, Math.min(lastStep, requestedStep));
  const movesForwardPastIdentity = currentStep <= IDENTITY_STEP && targetStep > IDENTITY_STEP;

  if (movesForwardPastIdentity && validation.instanceIdError !== null) {
    return {
      kind: "blocked",
      step: Math.min(IDENTITY_STEP, lastStep),
      error: validation.instanceIdError,
    };
  }

  return { kind: "navigate", step: targetStep };
}

export const PROVIDER_ACCENT_SWATCHES = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
] as const;

export const DEFAULT_ADD_PROVIDER_DRIVER = ProviderDriverKind.make("codex");

export type AddProviderComingSoonIconKey = "github-copilot" | "gemini" | "acp-registry";

const COMING_SOON_DRIVER_OPTIONS: ReadonlyArray<{
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly iconKey: AddProviderComingSoonIconKey;
}> = [
  {
    value: ProviderDriverKind.make("githubCopilot"),
    label: "Github Copilot",
    iconKey: "github-copilot",
  },
  { value: ProviderDriverKind.make("gemini"), label: "Gemini", iconKey: "gemini" },
  { value: ProviderDriverKind.make("acpRegistry"), label: "ACP Registry", iconKey: "acp-registry" },
];

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Normalize a user-provided label into a slug suffix for the instance id.
 * The full id is formed by prefixing the driver slug — e.g. label "Work" on
 * driver "codex" becomes `codex_work`. Output is trimmed to 48 chars so the
 * final composed id stays under the 64-char slug cap enforced by
 * `ProviderInstanceId` in `@t3tools/contracts`.
 */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Validate an instance id against the same slug rules the server applies in
 * `ProviderInstanceId` (see `packages/contracts/src/providerInstance.ts`).
 * Returns a user-facing error string, or `null` if valid.
 */
function validateInstanceId(id: string, existing: readonly string[]): string | null {
  if (id.length === 0) return "Instance ID is required.";
  if (id.length > 64) return "Instance ID must be 64 characters or fewer.";
  if (!INSTANCE_ID_PATTERN.test(id)) {
    return "Instance ID must start with a letter and use only letters, digits, '-', or '_'.";
  }
  if (existing.includes(id)) return `An instance named '${id}' already exists.`;
  return null;
}

export function resolveAddProviderDriverMeta(driver: ProviderDriverKind): ProviderDriverMeta {
  const meta = getDriverMeta(driver) ?? PROVIDER_DRIVER_METAS[0];
  if (!meta) throw new Error("No provider drivers are registered.");
  return meta;
}

export function resolveAddProviderInstanceId(input: {
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly instanceIdOverride: string | null;
}): string {
  if (input.instanceIdOverride !== null) return input.instanceIdOverride;
  const slug = slugifyLabel(input.label);
  return slug ? `${input.driver}_${slug}` : "";
}

export type AddProviderConfigDrafts = Readonly<Record<string, Record<string, unknown>>>;

export function resolveAddProviderConfigDraftChange(
  drafts: AddProviderConfigDrafts,
  driver: ProviderDriverKind,
  config: Record<string, unknown> | undefined,
): AddProviderConfigDrafts {
  const next = { ...drafts };
  if (config === undefined || Object.keys(config).length === 0) {
    delete next[driver];
  } else {
    next[driver] = config;
  }
  return next;
}

export type AddProviderInstanceModelInput = {
  readonly environmentLabel: string;
  readonly wizardStep: number;
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly accentColor: string;
  readonly instanceIdOverride: string | null;
  readonly existingInstanceIds: readonly string[];
  readonly configByDriver: AddProviderConfigDrafts;
  readonly hasAttemptedSubmit: boolean;
};

export type AddProviderDriverOptionModel = {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly iconKey: ProviderDriverIconKey | AddProviderComingSoonIconKey;
  readonly badgeLabel: string | null;
  readonly disabled: boolean;
};

export type AddProviderWizardStepModel = {
  readonly label: string;
  readonly summary: string | null;
  readonly current: boolean;
};

export type AddProviderAccentSwatchModel = {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
};

export type AddProviderFooterPrimary =
  | {
      readonly kind: "codex-choice";
      readonly manualLabel: string;
      readonly chatGptLabel: string;
    }
  | { readonly kind: "next"; readonly label: string }
  | { readonly kind: "submit"; readonly label: string };

export type AddProviderInstanceModel = {
  readonly title: string;
  readonly description: string;
  readonly currentStep: number;
  readonly steps: readonly AddProviderWizardStepModel[];
  readonly stepSummaries: readonly (string | null)[];
  readonly driverField: {
    readonly id: string;
    readonly label: string;
    readonly value: ProviderDriverKind;
    readonly options: readonly AddProviderDriverOptionModel[];
    readonly visible: boolean;
  };
  readonly labelField: {
    readonly label: string;
    readonly placeholder: string;
    readonly value: string;
    readonly hint: string;
    readonly visible: boolean;
  };
  readonly instanceIdField: {
    readonly label: string;
    readonly placeholder: string;
    readonly value: string;
    readonly invalid: boolean;
    readonly error: string | null;
    readonly hint: string;
    readonly visible: boolean;
  };
  readonly accentField: {
    readonly label: string;
    readonly value: string;
    readonly pickerDisplayName: string;
    readonly swatches: readonly AddProviderAccentSwatchModel[];
    readonly clearLabel: string | null;
    readonly hint: string;
    readonly visible: boolean;
  };
  readonly config: {
    readonly driver: ProviderDriverKind;
    readonly idPrefix: string;
    readonly value: Record<string, unknown>;
    readonly hasFields: boolean;
    readonly emptyMessage: string | null;
    readonly visible: boolean;
  };
  readonly footer: {
    readonly back: { readonly kind: "cancel" | "back"; readonly label: string };
    readonly primary: AddProviderFooterPrimary;
  };
  readonly submit: { readonly enabled: boolean; readonly disabledReason: string | null };
};

const EMPTY_CONFIG_DRAFT: Record<string, unknown> = {};

export function buildAddProviderInstanceModel(
  input: AddProviderInstanceModelInput,
): AddProviderInstanceModel {
  const { driver, wizardStep } = input;
  const driverMeta = resolveAddProviderDriverMeta(driver);
  const instanceId = resolveAddProviderInstanceId(input);
  const instanceIdError = validateInstanceId(instanceId, input.existingInstanceIds);
  const showInstanceIdError = input.hasAttemptedSubmit && instanceIdError !== null;
  const previewLabel = input.label.trim() || `${driverMeta.label} Workspace`;
  const stepSummaries = [driverMeta.label, previewLabel, null];
  const hasFields = deriveProviderSettingsFields(driverMeta).length > 0;
  return {
    title: "Add provider instance",
    description: `Add an account or configure a provider on ${input.environmentLabel}.`,
    currentStep: wizardStep,
    steps: ADD_PROVIDER_WIZARD_STEPS.map((label, index) => ({
      label,
      summary: stepSummaries[index] ?? null,
      current: index === wizardStep,
    })),
    stepSummaries,
    driverField: {
      id: "add-instance-driver-label",
      label: "Driver",
      value: driver,
      options: [
        ...PROVIDER_DRIVER_METAS.map((meta) => ({
          value: meta.value,
          label: meta.label,
          iconKey: meta.iconKey,
          badgeLabel: meta.badgeLabel ?? null,
          disabled: false,
        })),
        ...COMING_SOON_DRIVER_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          iconKey: option.iconKey,
          badgeLabel: "Coming Soon",
          disabled: true,
        })),
      ],
      visible: wizardStep === 0,
    },
    labelField: {
      label: "Label",
      placeholder: "e.g. Work",
      value: input.label,
      hint: "Shown in the provider list. Optional.",
      visible: wizardStep === 1,
    },
    instanceIdField: {
      label: "Instance ID",
      placeholder: `${driver}_work`,
      value: instanceId,
      invalid: showInstanceIdError,
      error: showInstanceIdError ? instanceIdError : null,
      hint: "Routing key used by threads and sessions. Letters, digits, '-', or '_'.",
      visible: wizardStep === 1,
    },
    accentField: {
      label: "Accent color",
      value: input.accentColor,
      pickerDisplayName: input.label || driverMeta.label,
      swatches: PROVIDER_ACCENT_SWATCHES.map((swatch) => ({
        value: swatch,
        label: `Use ${swatch} accent`,
        selected: input.accentColor.toLowerCase() === swatch,
      })),
      clearLabel: input.accentColor ? "Clear" : null,
      hint: "Optional marker shown in the picker.",
      visible: wizardStep === 1,
    },
    config: {
      driver,
      idPrefix: `add-provider-${driver}`,
      value: input.configByDriver[driver] ?? EMPTY_CONFIG_DRAFT,
      hasFields,
      emptyMessage:
        !hasFields && wizardStep === 2
          ? "This driver has no required configuration. You can add the instance now."
          : null,
      visible: wizardStep === 2,
    },
    footer: {
      back:
        wizardStep === 0 ? { kind: "cancel", label: "Cancel" } : { kind: "back", label: "Back" },
      primary:
        wizardStep === 0 && driver === "codex"
          ? {
              kind: "codex-choice",
              manualLabel: "Configure manually",
              chatGptLabel: "Continue with ChatGPT",
            }
          : wizardStep < ADD_PROVIDER_WIZARD_STEPS.length - 1
            ? { kind: "next", label: "Next" }
            : { kind: "submit", label: "Add instance" },
    },
    submit: { enabled: instanceIdError === null, disabledReason: instanceIdError },
  };
}

export type AddProviderInstanceBack =
  | { readonly kind: "close" }
  | { readonly kind: "navigate"; readonly step: number };

export function resolveAddProviderInstanceBack(wizardStep: number): AddProviderInstanceBack {
  return wizardStep === 0
    ? { kind: "close" }
    : { kind: "navigate", step: Math.max(0, wizardStep - 1) };
}

export type AddProviderInstanceSubmitInput = {
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly accentColor: string;
  readonly instanceIdOverride: string | null;
  readonly configByDriver: AddProviderConfigDrafts;
  readonly providerInstances: Readonly<Record<ProviderInstanceId, ProviderInstanceConfig>>;
};

export type AddProviderInstanceSubmit =
  | { readonly kind: "invalid"; readonly error: string }
  | {
      readonly kind: "save";
      readonly instanceId: ProviderInstanceId;
      readonly providerInstances: Record<ProviderInstanceId, ProviderInstanceConfig>;
      readonly successToast: { readonly title: string; readonly description: string };
      readonly failureToast: { readonly title: string; readonly fallbackDescription: string };
    };

export function resolveAddProviderInstanceSubmit(
  input: AddProviderInstanceSubmitInput,
): AddProviderInstanceSubmit {
  const { driver } = input;
  const instanceId = resolveAddProviderInstanceId(input);
  const instanceIdError = validateInstanceId(instanceId, Object.keys(input.providerInstances));
  if (instanceIdError !== null) return { kind: "invalid", error: instanceIdError };

  const config =
    driver === "codex"
      ? { ...input.configByDriver[driver], setupMode: "existing" }
      : (input.configByDriver[driver] ?? {});
  const hasConfig = Object.keys(config).length > 0;
  const normalizedAccentColor = normalizeProviderAccentColor(input.accentColor);
  const label = input.label.trim();

  const nextInstance: ProviderInstanceConfig = {
    driver,
    enabled: true,
    ...(label.length > 0 ? { displayName: label } : {}),
    ...(normalizedAccentColor ? { accentColor: normalizedAccentColor } : {}),
    ...(hasConfig ? { config } : {}),
  };
  const brandedId = ProviderInstanceId.make(instanceId);
  return {
    kind: "save",
    instanceId: brandedId,
    providerInstances: { ...input.providerInstances, [brandedId]: nextInstance },
    successToast: {
      title: "Provider instance added",
      description: `${resolveAddProviderDriverMeta(driver).label} instance '${instanceId}' was added.`,
    },
    failureToast: {
      title: "Could not add provider instance",
      fallbackDescription: "Update failed.",
    },
  };
}
