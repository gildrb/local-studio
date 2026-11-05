import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import {
  isProviderDriverKind,
  resolveProviderInstanceEnabled,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  normalizeProviderAccentColor,
  providerInstanceInitials,
} from "@t3tools/client-runtime/state/provider-instance-display";
import {
  type CustomModelDefinition,
  readCustomModelEntries,
  toCustomModelSetting,
} from "@t3tools/shared/model";

import { readCodexSetupMode } from "./CodexSetupSection.logic";
import type { ProviderDriverMeta } from "./providerDriverMeta.logic";
import {
  buildProviderStatusModel,
  getProviderVersionAdvisoryPresentation,
  getProviderVersionLabel,
  type ProviderStatusKey,
} from "./providerStatus";

const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type ProviderInstanceCardDriverOption = Pick<ProviderDriverMeta, "label" | "badgeLabel">;

export type ProviderInstanceCardModelInput = {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driverOption: ProviderInstanceCardDriverOption | undefined;
  readonly liveProvider: ServerProvider | undefined;
  readonly readOnly: boolean;
  readonly isUpdating: boolean;
  readonly canDelete: boolean;
  readonly canRunUpdate: boolean;
  readonly canInstallRecommended: boolean;
};

export type ProviderInstanceCardIcon =
  | {
      readonly kind: "driver";
      readonly driverKind: ProviderDriverKind;
      readonly accentColor: string | null;
      readonly showBadge: boolean;
    }
  | { readonly kind: "driverOption" }
  | { readonly kind: "initials"; readonly initials: string };

export type ProviderInstanceCardStatus = {
  readonly key: ProviderStatusKey;
  readonly headline: string;
  readonly needsAttention: boolean;
  readonly inlineDetail: string | null;
  readonly listDetail: string | null;
  readonly diagnostic: string | null;
  readonly authenticatedAs: {
    readonly email: string;
    readonly emailAriaLabel: string;
    readonly emailRevealTooltip: string;
    readonly emailHideTooltip: string;
    readonly authLabel: string | null;
  } | null;
};

export type ProviderInstanceCardVersionAction = {
  readonly kind: "installRecommended" | "runUpdate";
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
};

export type ProviderInstanceCardVersionAdvisory = {
  readonly title: string;
  readonly detail: string;
  readonly emphasis: "normal" | "strong";
  readonly icon: "alert-triangle" | "arrow-up-circle";
  readonly compatibilityWarning: boolean;
  readonly listIndicator: "compatibility" | "copyCommand" | "updateAvailable";
  readonly listCopyCommandAriaLabel: string;
  readonly listCopyCommandTooltip: string;
  readonly updateAvailableAriaLabel: string;
  readonly detailsAriaLabel: string;
  readonly updateCommand: string | null;
  readonly copyCommandAriaLabel: string;
  readonly copyCommandTooltip: string;
  readonly action: ProviderInstanceCardVersionAction | null;
  readonly manualUpdateDividerLabel: string | null;
};

export type ProviderUpdateCommandCopyToast = {
  readonly successTitle: string;
  readonly successDescription: string;
  readonly errorTitle: string;
};

export type ProviderInstanceCardRuntime =
  | { readonly kind: "form"; readonly idPrefix: string }
  | {
      readonly kind: "unknownDriver";
      readonly title: string;
      readonly descriptionPrefix: string;
      readonly driver: string;
      readonly descriptionSuffix: string;
    };

export type ProviderInstanceCardModel = {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly driverKind: ProviderDriverKind | null;
  readonly driverLabel: string | null;
  readonly badgeLabel: string | null;
  readonly icon: ProviderInstanceCardIcon;
  readonly accentColor: string | null;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly selectAriaLabel: string;
  readonly enableSwitch: {
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly ariaLabel: string;
  };
  readonly status: ProviderInstanceCardStatus;
  readonly versionLabel: string | null;
  readonly versionAdvisory: ProviderInstanceCardVersionAdvisory | null;
  readonly updateCommandCopyToast: ProviderUpdateCommandCopyToast;
  readonly deleteAction: { readonly ariaLabel: string; readonly disabled: boolean } | null;
  readonly displayNameRow: {
    readonly title: string;
    readonly inputId: string;
    readonly value: string;
    readonly placeholder: string;
  };
  readonly setupSectionTitle: string;
  readonly runtimeSection: {
    readonly title: string;
    readonly layout: "folded" | "section";
    readonly foldedId: string;
  };
  readonly runtime: ProviderInstanceCardRuntime;
  readonly environmentSectionTitle: string;
  readonly environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly modelsSection: {
    readonly title: string;
    readonly description: string;
    readonly models: ReadonlyArray<ServerProviderModel>;
    readonly customModels: ReadonlyArray<CustomModelDefinition>;
  } | null;
};

export type ProviderInstanceCardAction =
  | { readonly kind: "setDisplayName"; readonly value: string }
  | { readonly kind: "setEnabled"; readonly value: boolean }
  | { readonly kind: "setAccentColor"; readonly value: string }
  | { readonly kind: "setConfig"; readonly config: Record<string, unknown> | undefined }
  | {
      readonly kind: "setCustomModels";
      readonly customModels: ReadonlyArray<CustomModelDefinition>;
    }
  | {
      readonly kind: "setEnvironment";
      readonly environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
    };

export type ProviderEnvironmentDraftRow = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly valueRedacted?: boolean;
};

export type ProviderEnvironmentChange =
  | { readonly kind: "add"; readonly id: string }
  | { readonly kind: "setName"; readonly id: string; readonly name: string }
  | { readonly kind: "setValue"; readonly id: string; readonly value: string }
  | { readonly kind: "toggleSensitive"; readonly id: string }
  | { readonly kind: "remove"; readonly id: string };

export type ProviderEnvironmentChangeResult = {
  readonly rows: ReadonlyArray<ProviderEnvironmentDraftRow>;
  readonly published: ReadonlyArray<ProviderInstanceEnvironmentVariable> | null;
};

export type ProviderEnvironmentSyncInput = {
  readonly previous: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly next: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly lastPublished: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined;
};

export type ProviderEnvironmentRowModel = {
  readonly id: string;
  readonly name: string;
  readonly nameAriaLabel: string;
  readonly namePlaceholder: string;
  readonly value: string;
  readonly valueAriaLabel: string;
  readonly valuePlaceholder: string;
  readonly valueInputType: "password" | null;
  readonly sensitive: boolean;
  readonly sensitivityIcon: "lock" | "lock-open";
  readonly sensitivityAriaLabel: string;
  readonly sensitivityTooltip: string;
  readonly removeAriaLabel: string;
};

export type ProviderEnvironmentModel = {
  readonly title: string;
  readonly description: string;
  readonly addLabel: string;
  readonly rows: ReadonlyArray<ProviderEnvironmentRowModel>;
  readonly footnote: string | null;
};

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readConfigCustomModels(config: unknown): ReadonlyArray<CustomModelDefinition> {
  if (!isConfigRecord(config)) return [];
  return readCustomModelEntries(config.customModels);
}

export function deriveProviderModelsForDisplay(input: {
  readonly liveModels: ReadonlyArray<ServerProviderModel> | undefined;
  readonly customModels: ReadonlyArray<CustomModelDefinition>;
}): ReadonlyArray<ServerProviderModel> {
  const liveCustomModelsBySlug = new Map(
    Arr.filterMap(input.liveModels ?? [], (model) =>
      model.isCustom ? Result.succeed([model.slug, model] as const) : Result.failVoid,
    ),
  );
  const serverModels = input.liveModels?.filter((model) => !model.isCustom) ?? [];
  const customModels = input.customModels.map((entry) => ({
    slug: entry.slug,
    name: entry.name,
    isCustom: true,
    capabilities:
      entry.capabilities ?? liveCustomModelsBySlug.get(entry.slug)?.capabilities ?? null,
  }));
  return [...serverModels, ...customModels];
}

function compatibilityInlineDetail(status: string | undefined): string {
  if (status === "broken") return "Incompatible";
  if (status === "unsupported") return "Unsupported";
  return "Limited support";
}

export function buildProviderInstanceCardModel(
  input: ProviderInstanceCardModelInput,
): ProviderInstanceCardModel {
  const { instance, instanceId, driverOption, liveProvider } = input;
  const enabled = resolveProviderInstanceEnabled(instance);
  const compatibility = enabled ? liveProvider?.compatibilityAdvisory : undefined;
  const statusModel = buildProviderStatusModel({ enabled, provider: liveProvider });
  const authEmail = liveProvider?.auth.email?.trim();
  const isAuthenticated = enabled && liveProvider?.auth.status === "authenticated";
  const authLabel =
    enabled && liveProvider?.auth.status === "authenticated"
      ? (liveProvider.auth.label ?? liveProvider.auth.type ?? null)
      : null;
  const versionLabel = getProviderVersionLabel(liveProvider?.version);
  const advisory = getProviderVersionAdvisoryPresentation(
    liveProvider?.versionAdvisory,
    liveProvider?.compatibilityAdvisory,
    enabled,
  );
  const updateCommand = advisory?.updateCommand ?? null;
  const hasCompatibilityWarning =
    compatibility !== undefined &&
    compatibility.status !== "supported" &&
    compatibility.status !== "unknown";
  const displayName =
    instance.displayName?.trim() || driverOption?.label || String(instance.driver);
  const accentColor = normalizeProviderAccentColor(instance.accentColor) ?? null;
  const driverKind: ProviderDriverKind | null = isProviderDriverKind(instance.driver)
    ? instance.driver
    : null;
  const needsAttention = statusModel.statusKey === "warning" || statusModel.statusKey === "error";
  const inlineDetail = hasCompatibilityWarning
    ? compatibilityInlineDetail(compatibility?.status)
    : statusModel.detail;
  const versionActionKind: ProviderInstanceCardVersionAction["kind"] = advisory?.targetVersion
    ? "installRecommended"
    : "runUpdate";
  const hasVersionAction =
    versionActionKind === "installRecommended" ? input.canInstallRecommended : input.canRunUpdate;
  const customModels =
    instance.driver === "antigravity" ? [] : readConfigCustomModels(instance.config);

  return {
    instanceId,
    displayName,
    driverKind,
    driverLabel: driverOption?.label ?? null,
    badgeLabel: driverOption?.badgeLabel || null,
    icon: driverKind
      ? { kind: "driver", driverKind, accentColor, showBadge: Boolean(accentColor) }
      : driverOption
        ? { kind: "driverOption" }
        : { kind: "initials", initials: providerInstanceInitials(displayName) },
    accentColor,
    enabled,
    readOnly: input.readOnly,
    selectAriaLabel: `Select ${displayName}`,
    enableSwitch: {
      checked: enabled,
      disabled: input.readOnly,
      ariaLabel: `Enable ${displayName}`,
    },
    status: {
      key: statusModel.statusKey,
      headline: statusModel.headline,
      needsAttention,
      inlineDetail,
      listDetail: needsAttention && inlineDetail ? inlineDetail : null,
      diagnostic: hasCompatibilityWarning && needsAttention ? statusModel.detail : null,
      authenticatedAs:
        isAuthenticated && authEmail
          ? {
              email: authEmail,
              emailAriaLabel: "Toggle account email visibility",
              emailRevealTooltip: "Click to reveal email",
              emailHideTooltip: "Click to hide email",
              authLabel,
            }
          : null,
    },
    versionLabel,
    versionAdvisory: advisory
      ? {
          title: advisory.title,
          detail: advisory.detail,
          emphasis: advisory.emphasis,
          icon: hasCompatibilityWarning ? "alert-triangle" : "arrow-up-circle",
          compatibilityWarning: hasCompatibilityWarning,
          listIndicator: hasCompatibilityWarning
            ? "compatibility"
            : updateCommand
              ? "copyCommand"
              : "updateAvailable",
          listCopyCommandAriaLabel: `Copy ${displayName} update command`,
          listCopyCommandTooltip: "Copy update command",
          updateAvailableAriaLabel: "Update available",
          detailsAriaLabel: `${advisory.title} — view details`,
          updateCommand,
          copyCommandAriaLabel: "Copy update command",
          copyCommandTooltip: "Copy command",
          action: hasVersionAction
            ? {
                kind: versionActionKind,
                label: input.isUpdating
                  ? "Updating"
                  : advisory.targetVersion
                    ? `Install ${getProviderVersionLabel(advisory.targetVersion)}`
                    : "Update now",
                busy: input.isUpdating,
                disabled: input.isUpdating,
              }
            : null,
          manualUpdateDividerLabel:
            hasVersionAction && updateCommand ? "or, update manually using" : null,
        }
      : null,
    updateCommandCopyToast: {
      successTitle: `${displayName} update command copied`,
      successDescription: "Run it in a terminal when you are ready to update.",
      errorTitle: `Could not copy ${displayName} update command`,
    },
    deleteAction: input.canDelete
      ? { ariaLabel: `Delete instance ${instanceId}`, disabled: input.readOnly }
      : null,
    displayNameRow: {
      title: "Display name",
      inputId: `provider-instance-${instanceId}-display-name`,
      value: instance.displayName ?? "",
      placeholder: driverOption?.label ?? "Instance label",
    },
    setupSectionTitle: "Setup",
    runtimeSection: {
      title: "Runtime",
      layout:
        instance.driver === "codex" && readCodexSetupMode(instance.config) === "managed"
          ? "folded"
          : "section",
      foldedId: `provider-instance-${instanceId}-runtime`,
    },
    runtime: driverOption
      ? { kind: "form", idPrefix: `provider-instance-${instanceId}` }
      : {
          kind: "unknownDriver",
          title: "Driver",
          descriptionPrefix: "This instance uses ",
          driver: String(instance.driver),
          descriptionSuffix:
            ", which is not available in this build. Its configuration is preserved.",
        },
    environmentSectionTitle: "Environment",
    environment: instance.environment ?? [],
    modelsSection:
      driverOption !== undefined
        ? {
            title: "Models",
            description:
              "Favorites, visibility, and ordering are saved on this device. Custom models are saved on the selected environment.",
            models: deriveProviderModelsForDisplay({
              liveModels: liveProvider?.models,
              customModels,
            }),
            customModels,
          }
        : null,
  };
}

export function resolveProviderInstanceCardAction(
  instance: ProviderInstanceConfig,
  action: ProviderInstanceCardAction,
): ProviderInstanceConfig {
  switch (action.kind) {
    case "setDisplayName": {
      const trimmed = action.value.trim();
      const { displayName: _omit, ...rest } = instance;
      return trimmed.length > 0 ? { ...rest, displayName: trimmed } : rest;
    }
    case "setEnabled":
      return { ...instance, enabled: action.value };
    case "setAccentColor": {
      const normalized = normalizeProviderAccentColor(action.value);
      const { accentColor: _omit, ...rest } = instance;
      return normalized ? { ...rest, accentColor: normalized } : rest;
    }
    case "setConfig": {
      const { config: _omit, ...rest } = instance;
      return action.config !== undefined ? { ...rest, config: action.config } : rest;
    }
    case "setCustomModels": {
      const base: Record<string, unknown> = isConfigRecord(instance.config)
        ? { ...instance.config }
        : {};
      base.customModels = action.customModels.map(toCustomModelSetting);
      const { config: _omit, ...rest } = instance;
      return { ...rest, config: base };
    }
    case "setEnvironment": {
      const cleaned = action.environment.filter((variable) => variable.name.trim().length > 0);
      const { environment: _omit, ...rest } = instance;
      return cleaned.length > 0 ? { ...rest, environment: cleaned } : rest;
    }
  }
}

export function makeProviderEnvironmentDraftRow(
  variable: ProviderInstanceEnvironmentVariable,
  index: number,
): ProviderEnvironmentDraftRow {
  return {
    id: `${index}:${variable.name}`,
    name: variable.name,
    value: variable.value,
    sensitive: variable.sensitive,
    ...(variable.valueRedacted !== undefined ? { valueRedacted: variable.valueRedacted } : {}),
  };
}

function providerEnvironmentsEqual(
  left: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
  right: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): boolean {
  return (
    left.length === right.length &&
    left.every((variable, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        variable.name === other.name &&
        variable.value === other.value &&
        variable.sensitive === other.sensitive &&
        variable.valueRedacted === other.valueRedacted
      );
    })
  );
}

export function shouldResetProviderEnvironmentDrafts(input: ProviderEnvironmentSyncInput): boolean {
  return !(
    input.previous === input.next ||
    providerEnvironmentsEqual(input.previous, input.next) ||
    (input.lastPublished !== undefined &&
      providerEnvironmentsEqual(input.lastPublished, input.next))
  );
}

function publishProviderEnvironmentRows(
  rows: ReadonlyArray<ProviderEnvironmentDraftRow>,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> | null {
  const published: ProviderInstanceEnvironmentVariable[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name)) {
      if (
        name.length > 0 ||
        row.value.length > 0 ||
        row.sensitive !== true ||
        row.valueRedacted !== undefined
      ) {
        return null;
      }
      continue;
    }
    const { id: _id, ...rest } = row;
    published.push({ ...rest, name });
  }
  return published;
}

function patchProviderEnvironmentRow(
  rows: ReadonlyArray<ProviderEnvironmentDraftRow>,
  id: string,
  patch: Partial<Omit<ProviderEnvironmentDraftRow, "id">>,
): ProviderEnvironmentChangeResult {
  const nextRows = rows.map((row) =>
    row.id === id
      ? {
          ...row,
          ...patch,
          ...(patch.value !== undefined ? { valueRedacted: false } : {}),
        }
      : row,
  );
  return { rows: nextRows, published: publishProviderEnvironmentRows(nextRows) };
}

export function resolveProviderEnvironmentChange(
  rows: ReadonlyArray<ProviderEnvironmentDraftRow>,
  change: ProviderEnvironmentChange,
): ProviderEnvironmentChangeResult {
  switch (change.kind) {
    case "add":
      return {
        rows: [...rows, { id: change.id, name: "", value: "", sensitive: true }],
        published: null,
      };
    case "setName":
      return patchProviderEnvironmentRow(rows, change.id, { name: change.name.trim() });
    case "setValue":
      return patchProviderEnvironmentRow(rows, change.id, { value: change.value });
    case "toggleSensitive": {
      const variable = rows.find((row) => row.id === change.id);
      if (!variable) return { rows, published: null };
      const sensitive = !variable.sensitive;
      return patchProviderEnvironmentRow(rows, change.id, {
        sensitive,
        ...(sensitive && variable.valueRedacted === undefined
          ? {}
          : { valueRedacted: sensitive ? variable.valueRedacted : false }),
      });
    }
    case "remove": {
      const nextRows = rows.filter((row) => row.id !== change.id);
      return { rows: nextRows, published: publishProviderEnvironmentRows(nextRows) };
    }
  }
}

export function buildProviderEnvironmentModel(
  rows: ReadonlyArray<ProviderEnvironmentDraftRow>,
): ProviderEnvironmentModel {
  return {
    title: "Variables",
    description: "API keys, base URLs, and other per-instance CLI settings.",
    addLabel: "Add variable",
    rows: rows.map((variable, index) => ({
      id: variable.id,
      name: variable.name,
      nameAriaLabel: `Environment variable name ${index + 1}`,
      namePlaceholder: "VARIABLE_NAME",
      value: variable.valueRedacted ? "" : variable.value,
      valueAriaLabel: `Environment variable value ${index + 1}`,
      valuePlaceholder: variable.valueRedacted
        ? "Stored secret, enter a new value to replace"
        : "value",
      valueInputType: variable.sensitive ? "password" : null,
      sensitive: variable.sensitive,
      sensitivityIcon: variable.sensitive ? "lock" : "lock-open",
      sensitivityAriaLabel: `Mark environment variable ${variable.name || index + 1} as sensitive`,
      sensitivityTooltip: variable.sensitive ? "Sensitive, stored separately" : "Plain text",
      removeAriaLabel: `Remove environment variable ${variable.name || index + 1}`,
    })),
    footnote:
      rows.length > 0
        ? "Sensitive values are stored separately and never returned to the app."
        : null,
  };
}
