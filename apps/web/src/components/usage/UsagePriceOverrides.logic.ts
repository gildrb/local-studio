import type { AuthSessionState, EnvironmentId, UsageModelPriceOverride } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
  type ProviderOperateAccess,
} from "../settings/ProviderSettingsPanel.logic";
import { USAGE_PRICE_FIELDS } from "./usagePriceForm";
import {
  isEmptyUsagePriceDraft,
  usagePriceCell,
  usagePriceTableChanges,
  usagePriceTableErrors,
  type UsagePriceDraft,
  type UsagePriceField,
} from "./usagePriceTable";
import type {
  UsagePriceChange,
  UsagePriceTarget,
  UsagePriceWriteResult,
} from "./usagePriceTargets";

export type UsagePriceSaveStatus = UsagePriceWriteResult | { readonly status: "saving" };

export type UsagePriceSaveAttempt = {
  readonly drafts: readonly UsagePriceDraft[];
  readonly destinations: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }[];
  readonly results: ReadonlyMap<EnvironmentId, UsagePriceSaveStatus>;
};

export type UsagePriceTargetAvailabilityInput = {
  readonly connected: boolean;
  readonly settingsLoaded: boolean;
  readonly supportsPriceOverrides: boolean;
  readonly access: ProviderOperateAccess;
};

export function resolveUsagePriceTargetUnavailable(
  input: UsagePriceTargetAvailabilityInput,
): string | null {
  if (!input.connected) return "Offline";
  if (!input.settingsLoaded) return "Prices not loaded";
  if (!input.supportsPriceOverrides) return "Update server to edit prices";
  if (input.access === "pending") return "Checking permissions…";
  if (input.access === "denied") return "Read-only access";
  return null;
}

export type UsagePriceTargetSources<E> = {
  readonly presentationsAtom: Atom.Atom<
    ReadonlyMap<
      EnvironmentId,
      {
        readonly entry: { readonly target: { readonly _tag: string; readonly label: string } };
        readonly connection: { readonly phase: string };
        readonly serverConfig: {
          readonly environment: {
            readonly capabilities: { readonly usagePriceOverrides?: boolean | undefined };
          };
        } | null;
      }
    >
  >;
  readonly settingsValueAtom: (environmentId: EnvironmentId) => Atom.Atom<{
    readonly usagePriceOverrides?: Readonly<Record<string, UsageModelPriceOverride>> | undefined;
  } | null>;
  readonly sessionStateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<AuthSessionState, E>>;
  readonly hasDesktopBridge: boolean;
};

export function createUsagePriceTargetsAtom<E>(
  sources: UsagePriceTargetSources<E>,
): Atom.Atom<readonly UsagePriceTarget[]> {
  return Atom.make((get): readonly UsagePriceTarget[] =>
    [...get(sources.presentationsAtom)].map(([environmentId, environment]) => {
      const settings = get(sources.settingsValueAtom(environmentId));
      const session = get(sources.sessionStateAtom(environmentId));
      const sessionAccess = {
        session: Option.getOrNull(AsyncResult.value(session)),
        isPending: session.waiting,
        hasError: session._tag === "Failure",
      };
      const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
      const access = isPrimary
        ? resolvePrimaryOperateAccess({
            ...sessionAccess,
            isPrimary,
            hasDesktopBridge: sources.hasDesktopBridge,
          })
        : resolveRemoteOperateAccess(sessionAccess);
      return {
        environmentId,
        label: environment.entry.target.label,
        prices: settings?.usagePriceOverrides ?? null,
        unavailable: resolveUsagePriceTargetUnavailable({
          connected: environment.connection.phase === "connected",
          settingsLoaded: settings !== null,
          supportsPriceOverrides:
            environment.serverConfig?.environment.capabilities.usagePriceOverrides === true,
          access,
        }),
      };
    }),
  );
}

export type UsagePriceUsageSource = {
  readonly environmentId: EnvironmentId;
  readonly summary: { readonly buckets: readonly { readonly model: string }[] } | null;
};

export type UsagePriceOverridesInput = {
  readonly environments: readonly UsagePriceTarget[];
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly usage: readonly UsagePriceUsageSource[];
  readonly drafts: readonly UsagePriceDraft[];
  readonly pending: boolean;
  readonly attempt: UsagePriceSaveAttempt | null;
};

export type UsagePriceCellModel = {
  readonly field: UsagePriceField;
  readonly ariaLabel: string;
  readonly value: string;
  readonly placeholder: string;
};

export type UsagePriceRowModel = {
  readonly id: string;
  readonly draft: UsagePriceDraft;
  readonly model: string;
  readonly isNew: boolean;
  readonly removed: boolean;
  readonly modelInvalid: boolean;
  readonly error: string | null;
  readonly removedMessage: string | null;
  readonly cells: readonly UsagePriceCellModel[];
  readonly action: {
    readonly icon: "remove" | "reset";
    readonly ariaLabel: string;
    readonly tooltip: string;
  };
};

export type UsagePriceEnvironmentOptionModel = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly checked: boolean;
  readonly unavailable: string | null;
};

export type UsagePriceDestinationStatusModel = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly statusLabel: string;
  readonly failed: boolean;
};

export type UsagePriceOverridesModel = {
  readonly title: string;
  readonly description: string;
  readonly applyLabel: string;
  readonly unitLabel: string;
  readonly selection: {
    readonly label: string;
    readonly disabled: boolean;
    readonly allSelected: boolean;
    readonly allLabel: string;
    readonly options: readonly UsagePriceEnvironmentOptionModel[];
  };
  readonly emptyMessage: string | null;
  readonly table: {
    readonly ariaLabel: string;
    readonly modelHeading: string;
    readonly fieldHeadings: readonly { readonly key: UsagePriceField; readonly label: string }[];
    readonly addButton: { readonly ariaLabel: string; readonly disabled: boolean };
    readonly rows: readonly UsagePriceRowModel[];
    readonly emptyMessage: string;
    readonly suggestedModels: readonly string[];
    readonly footnote: string;
    readonly locked: boolean;
  };
  readonly saveStatuses: readonly UsagePriceDestinationStatusModel[] | null;
  readonly footer: {
    readonly destinationNote: string;
    readonly discardButton: { readonly label: string; readonly disabled: boolean } | null;
    readonly saveButton: {
      readonly label: string;
      readonly disabled: boolean;
      readonly retry: boolean;
    };
  };
  readonly closeAllowed: boolean;
};

function selectedTargets(
  environments: readonly UsagePriceTarget[],
  selectedIds: ReadonlySet<EnvironmentId> | null,
): readonly UsagePriceTarget[] {
  return environments.filter(
    (environment) => selectedIds === null || selectedIds.has(environment.environmentId),
  );
}

function failedDestinationsOf(attempt: UsagePriceSaveAttempt | null) {
  return (
    attempt?.destinations.filter(
      (destination) => attempt.results.get(destination.environmentId)?.status === "failed",
    ) ?? []
  );
}

function stagedDraftsOf(drafts: readonly UsagePriceDraft[]) {
  return drafts.filter((draft) => !isEmptyUsagePriceDraft(draft));
}

function priceErrors(
  selected: readonly UsagePriceTarget[],
  customModels: readonly string[],
  drafts: readonly UsagePriceDraft[],
  attempt: UsagePriceSaveAttempt | null,
): ReadonlyMap<string, string> {
  const stagedDrafts = stagedDraftsOf(drafts);
  const errors = usagePriceTableErrors(selected, stagedDrafts);
  for (const draft of stagedDrafts) {
    if (!draft.isNew) continue;
    if (draft.model.trim() === "") errors.set(draft.id, "Enter a model ID.");
    else if (
      attempt === null &&
      (customModels.includes(draft.model.trim()) ||
        drafts.some((other) => other.id !== draft.id && other.model.trim() === draft.model.trim()))
    )
      errors.set(draft.id, "This model already has a row. Edit its prices there.");
  }
  return errors;
}

export function buildUsagePriceOverridesModel(
  input: UsagePriceOverridesInput,
): UsagePriceOverridesModel {
  const { environments, selectedIds, drafts, pending, attempt } = input;
  const selected = selectedTargets(environments, selectedIds);
  const customModels = [
    ...new Set(selected.flatMap((environment) => Object.keys(environment.prices ?? {}))),
  ].sort();
  const models = [
    ...new Set([
      ...customModels,
      ...input.usage
        .filter((environment) =>
          selected.some((target) => target.environmentId === environment.environmentId),
        )
        .flatMap((environment) => environment.summary?.buckets.map((bucket) => bucket.model) ?? []),
    ]),
  ].sort();
  // Keep new rows in place while successful environments publish their updated settings.
  const newModels = new Set(
    drafts.filter((draft) => draft.isNew).map((draft) => draft.model.trim()),
  );
  const rows: readonly UsagePriceDraft[] = [
    ...customModels
      .filter((model) => attempt === null || !newModels.has(model))
      .map(
        (model) =>
          drafts.find((draft) => draft.id === `model:${model}`) ?? {
            id: `model:${model}`,
            model,
            isNew: false,
            values: {},
          },
      ),
    ...drafts.filter((draft) => draft.isNew),
  ];
  const errors = priceErrors(selected, customModels, drafts, attempt);
  const failedDestinations = failedDestinationsOf(attempt);
  const locked = pending || failedDestinations.length > 0;
  const hasChanges = stagedDraftsOf(drafts).length > 0;
  const first = selected[0];
  const destinationLabel =
    selected.length === 1 && first ? first.label : `${selected.length} environments`;

  return {
    title: "Custom model prices",
    description: "Prices apply to all past and future usage on the environments you select.",
    applyLabel: "Apply to",
    unitLabel: "USD / million tokens",
    selection: {
      label: selectedIds === null ? "All environments" : destinationLabel,
      disabled: pending || hasChanges,
      allSelected: selectedIds === null,
      allLabel: "All environments",
      options: environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        checked: selectedIds === null || selectedIds.has(environment.environmentId),
        unavailable: environment.unavailable,
      })),
    },
    emptyMessage:
      selected.length === 0
        ? environments.length === 0
          ? "Connect an environment to set model prices."
          : "Select an environment to see and change its model prices."
        : null,
    table: {
      ariaLabel: "Custom model prices",
      modelHeading: "Model ID",
      fieldHeadings: USAGE_PRICE_FIELDS.map((field) => ({ key: field.key, label: field.label })),
      addButton: { ariaLabel: "Add model price", disabled: locked },
      rows: rows.map((row) => {
        const error = errors.get(row.id) ?? null;
        return {
          id: row.id,
          draft: row,
          model: row.model,
          isNew: row.isNew,
          removed: row.removed === true,
          modelInvalid: row.model.trim() !== "" && error !== null,
          error:
            error !== null &&
            (row.model.trim() !== "" || Object.values(row.values).some((value) => value !== ""))
              ? error
              : null,
          removedMessage: row.removed ? "Automatic pricing after saving" : null,
          cells: row.removed
            ? []
            : USAGE_PRICE_FIELDS.map((field) => {
                const cell = usagePriceCell(selected, row.model, field.key);
                return {
                  field: field.key,
                  ariaLabel: `${field.label} price for ${row.model || "new model"}`,
                  value: row.values[field.key] ?? (row.isNew ? "" : cell.value),
                  placeholder: row.isNew
                    ? field.optional
                      ? "Input rate"
                      : "0.00"
                    : cell.placeholder,
                };
              }),
          action: {
            icon: row.isNew ? "remove" : "reset",
            ariaLabel: row.removed
              ? `Undo reset for ${row.model}`
              : row.isNew
                ? "Remove new model"
                : `Reset price for ${row.model} to automatic`,
            tooltip: row.removed ? "Undo reset" : row.isNew ? "Remove row" : "Reset to automatic",
          },
        };
      }),
      emptyMessage: selected.some((environment) => environment.prices === null)
        ? "Some environment prices are unavailable."
        : "No custom prices. Add a row to override automatic pricing.",
      suggestedModels: models.filter((model) => !customModels.includes(model)),
      footnote: `Blank cache rates use the input price. Enter 0 for free tokens.${
        selected.length > 1 ? " Mixed cells keep each environment’s rate until you edit them." : ""
      }`,
      locked,
    },
    saveStatuses: attempt
      ? attempt.destinations.map((destination) => {
          const result = attempt.results.get(destination.environmentId);
          return {
            environmentId: destination.environmentId,
            label: destination.label,
            failed: result?.status === "failed",
            statusLabel:
              result?.status === "failed"
                ? `Not saved · ${result.error}`
                : result?.status === "saved"
                  ? "Saved"
                  : "Saving…",
          };
        })
      : null,
    footer: {
      destinationNote: hasChanges ? `Changes apply to ${destinationLabel}` : "",
      discardButton: hasChanges
        ? {
            label: failedDestinations.length > 0 ? "Discard pending changes" : "Discard changes",
            disabled: pending,
          }
        : null,
      saveButton: {
        label: pending
          ? "Saving…"
          : failedDestinations.length > 0
            ? "Retry failed saves"
            : "Save changes",
        disabled:
          pending ||
          (!hasChanges && failedDestinations.length === 0) ||
          (failedDestinations.length === 0 && (errors.size > 0 || selected.length === 0)),
        retry: failedDestinations.length > 0,
      },
    },
    closeAllowed: !pending,
  };
}

export type UsagePriceDraftAction =
  | { readonly kind: "remove-draft"; readonly id: string }
  | { readonly kind: "update-draft"; readonly draft: UsagePriceDraft };

export function resolveUsagePriceCellEdit(input: {
  readonly row: UsagePriceDraft;
  readonly field: UsagePriceField;
  readonly value: string;
  readonly environments: readonly UsagePriceTarget[];
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
}): UsagePriceDraftAction {
  const { row, field, value } = input;
  const original = usagePriceCell(
    selectedTargets(input.environments, input.selectedIds),
    row.model,
    field,
  );
  const restored =
    !row.isNew &&
    original.placeholder !== "Mixed" &&
    original.placeholder !== "Unavailable" &&
    value === original.value;
  const values = { ...row.values, [field]: value };
  if (restored) delete values[field];
  if (!row.isNew && Object.keys(values).length === 0) return { kind: "remove-draft", id: row.id };
  return { kind: "update-draft", draft: { ...row, values } };
}

export function resolveUsagePriceRowAction(row: UsagePriceDraft): UsagePriceDraftAction {
  if (row.isNew) return { kind: "remove-draft", id: row.id };
  if (row.removed) {
    return Object.keys(row.values).length === 0
      ? { kind: "remove-draft", id: row.id }
      : { kind: "update-draft", draft: { ...row, removed: false } };
  }
  return { kind: "update-draft", draft: { ...row, removed: true } };
}

export type UsagePriceSavePlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "save";
      readonly retry: boolean;
      readonly edits: readonly UsagePriceDraft[];
      readonly targets: readonly UsagePriceTarget[];
      readonly writeTargets: readonly UsagePriceTarget[];
      readonly changes: ReadonlyMap<EnvironmentId, readonly UsagePriceChange[]>;
    };

export function resolveUsagePriceSave(input: {
  readonly environments: readonly UsagePriceTarget[];
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly drafts: readonly UsagePriceDraft[];
  readonly pending: boolean;
  readonly attempt: UsagePriceSaveAttempt | null;
}): UsagePriceSavePlan {
  if (input.pending) return { kind: "none" };
  const failedDestinations = failedDestinationsOf(input.attempt);
  const retry = failedDestinations.length > 0;
  const destinations = retry
    ? failedDestinations
    : selectedTargets(input.environments, input.selectedIds);
  const edits = retry && input.attempt ? input.attempt.drafts : stagedDraftsOf(input.drafts);
  if (destinations.length === 0 || edits.length === 0) return { kind: "none" };
  const targets = destinations.map(
    (destination) =>
      input.environments.find(
        (environment) => environment.environmentId === destination.environmentId,
      ) ?? { ...destination, prices: null, unavailable: "Environment removed" },
  );
  const plans = new Map(
    targets.map((target) => [target.environmentId, usagePriceTableChanges(target, edits)]),
  );
  return {
    kind: "save",
    retry,
    edits,
    targets,
    writeTargets: targets.map((target) => ({
      ...target,
      unavailable:
        target.unavailable ??
        [...(plans.get(target.environmentId)?.errors.values() ?? [])][0] ??
        null,
    })),
    changes: new Map([...plans].map(([id, plan]) => [id, plan.changes])),
  };
}

export function startUsagePriceSaveAttempt(
  previous: UsagePriceSaveAttempt | null,
  plan: Extract<UsagePriceSavePlan, { readonly kind: "save" }>,
): UsagePriceSaveAttempt {
  return {
    drafts: plan.edits,
    destinations: plan.retry && previous ? previous.destinations : plan.targets,
    results: new Map<EnvironmentId, UsagePriceSaveStatus>([
      ...(plan.retry && previous ? previous.results : []),
      ...plan.targets.map((target): [EnvironmentId, UsagePriceSaveStatus] => [
        target.environmentId,
        { status: "saving" },
      ]),
    ]),
  };
}
