import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { refreshUsage, refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { EnvironmentId, type UsageSummaryInput } from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { buildRedactedSensitiveTextModel } from "@t3tools/web/src/components/settings/RedactedSensitiveText.logic.ts";
import { CHATGPT_USAGE_BUTTON } from "@t3tools/web/src/components/settings/ChatGptWelcomeCoordinator.logic.ts";
import {
  buildUsagePageModel,
  isUsageMetric,
  makeUsageWindow,
  resolveEnvironmentSelection,
  resolveLimitsRefreshTargets,
  resolveMetricSelection,
  resolveUsageRefresh,
  resolveUsageShortcutAction,
  resolveWindowSelection,
  type UsageBreakdown,
  type UsagePageModel,
  type UsageWindowDays,
} from "@t3tools/web/src/components/usage/UsagePage.logic.ts";
import {
  RESET_CREDIT_DIALOG_COPY,
  buildResetCreditButtonModel,
  type ResetCreditButtonModel,
  resetCreditResultOf,
  resolveResetCreditStatus,
  type UsageLimitSegmentModel,
} from "@t3tools/web/src/components/usage/UsageLimits.logic.ts";
import {
  buildUsagePriceOverridesModel,
  createUsagePriceTargetsAtom,
  resolveUsagePriceCellEdit,
  resolveUsagePriceRowAction,
  resolveUsagePriceSave,
  startUsagePriceSaveAttempt,
  type UsagePriceDraftAction,
  type UsagePriceOverridesModel,
  type UsagePriceSaveAttempt,
} from "@t3tools/web/src/components/usage/UsagePriceOverrides.logic.ts";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "@t3tools/web/src/components/usage/usagePagePreferences.ts";
import type { UsagePriceDraft } from "@t3tools/web/src/components/usage/usagePriceTable.ts";
import { writeUsagePrices } from "@t3tools/web/src/components/usage/usagePriceTargets.ts";
import type { UsageMetric } from "@t3tools/web/src/components/usage/usageShortcuts.ts";
import { resolveShortcutCommand } from "@t3tools/web/src/keybindings.ts";
import {
  createUsageByWindowAtom,
  mergeSelectedUsage,
  resolveUsageReportingState,
  selectUsageEnvironments,
  usageWindowKey,
} from "@t3tools/web/src/state/usage.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import { CHAT_PAGE, type AppPage } from "../page.ts";

type UsageWindowState = {
  readonly days: UsageWindowDays;
  readonly window: UsageSummaryInput;
};

type RedeemState = {
  readonly busy: boolean;
  readonly status: string | null;
};

type PricesState = {
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly drafts: readonly UsagePriceDraft[];
  readonly pending: boolean;
  readonly attempt: UsagePriceSaveAttempt | null;
  readonly nextRowId: number;
  readonly focusRowId: string | null;
};

type UsageUiState = {
  readonly breakdown: UsageBreakdown;
  readonly isRefreshing: boolean;
  readonly limitsNowMs: number;
  readonly cursorPending: ReadonlySet<EnvironmentId>;
  readonly redeem: ReadonlyMap<string, RedeemState>;
  readonly confirmRedeem: string | null;
  readonly prices: PricesState | null;
};

export type UsageSegmentEmailView = {
  readonly hidden: { readonly text: string; readonly tooltip: string };
  readonly revealed: { readonly text: string; readonly tooltip: string };
};

export type UsagePricesView = {
  readonly model: UsagePriceOverridesModel;
  readonly focusRowId: string | null;
  readonly suggestions: Readonly<Record<string, readonly string[]>>;
};

export type UsageView = {
  readonly page: UsagePageModel;
  readonly initials: Readonly<Record<string, string>>;
  readonly cursorPending: readonly string[];
  readonly redeem: Readonly<Record<string, RedeemState>>;
  readonly resetButtons: Readonly<Record<string, ResetCreditButtonModel>>;
  readonly emails: Readonly<Record<string, UsageSegmentEmailView>>;
  readonly resetConfirm: typeof RESET_CREDIT_DIALOG_COPY | null;
  readonly chatGptButton: { readonly label: string; readonly url: string };
  readonly prices: UsagePricesView | null;
};

const MetricParams = Schema.decodeUnknownSync(Schema.Struct({ metric: Schema.String }));
const WindowParams = Schema.decodeUnknownSync(Schema.Struct({ days: Schema.Number }));
const BreakdownParams = Schema.decodeUnknownSync(
  Schema.Struct({ breakdown: Schema.Literals(["model", "time"]) }),
);
const AllParams = Schema.decodeUnknownSync(Schema.Struct({ checked: Schema.Boolean }));
const EnvironmentParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, checked: Schema.Boolean }),
);
const CursorParams = Schema.decodeUnknownSync(Schema.Struct({ environmentId: Schema.String }));
const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const SegmentParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const RowParams = Schema.decodeUnknownSync(Schema.Struct({ rowId: Schema.String }));
const ModelParams = Schema.decodeUnknownSync(
  Schema.Struct({ rowId: Schema.String, value: Schema.String }),
);
const CellParams = Schema.decodeUnknownSync(
  Schema.Struct({
    rowId: Schema.String,
    field: Schema.Literals([
      "inputCostPerMillionTokens",
      "outputCostPerMillionTokens",
      "cacheReadCostPerMillionTokens",
      "cacheWriteCostPerMillionTokens",
    ]),
    value: Schema.String,
  }),
);
const KeyParams = Schema.decodeUnknownSync(
  Schema.Struct({
    event: Schema.Struct({
      key: Schema.String,
      code: Schema.String,
      metaKey: Schema.Boolean,
      ctrlKey: Schema.Boolean,
      altKey: Schema.Boolean,
      shiftKey: Schema.Boolean,
    }),
    repeat: Schema.Boolean,
  }),
);

function freshUi(nowMs: number): UsageUiState {
  return {
    breakdown: "model",
    isRefreshing: false,
    limitsNowMs: nowMs,
    cursorPending: new Set(),
    redeem: new Map(),
    confirmRedeem: null,
    prices: null,
  };
}

function freshWindow(preferences: UsagePagePreferences, nowMs: number): UsageWindowState {
  return {
    days: preferences.windowDays,
    window: makeUsageWindow(preferences.windowDays, nowMs),
  };
}

function segmentsOf(page: UsagePageModel): ReadonlyArray<{
  readonly key: string;
  readonly segment: UsageLimitSegmentModel;
}> {
  if (page.content.kind !== "limits") return [];
  return page.content.limits.sections.flatMap((section) =>
    section.windows.flatMap((window) =>
      window.segments.map((segment) => ({
        key: `${window.key}|${segment.key}`,
        segment,
      })),
    ),
  );
}

function suggestionsFor(model: UsagePriceOverridesModel): Record<string, readonly string[]> {
  const suggestions: Record<string, readonly string[]> = {};
  for (const row of model.table.rows) {
    if (!row.isNew) continue;
    const query = row.model.trim().toLowerCase();
    suggestions[row.id] = model.table.suggestedModels.filter(
      (suggestion) => suggestion !== row.model && suggestion.toLowerCase().includes(query),
    );
  }
  return suggestions;
}

export function createUsageFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const presentationsAtom = state.environmentPresentations.presentationsAtom;

  const initialPreferences = readUsagePagePreferences();
  const initialNow = Date.now();
  const preferencesAtom = Atom.make<UsagePagePreferences>(initialPreferences).pipe(Atom.keepAlive);
  const windowAtom = Atom.make<UsageWindowState>(freshWindow(initialPreferences, initialNow)).pipe(
    Atom.keepAlive,
  );
  const selectionAtom = Atom.make<ReadonlySet<EnvironmentId> | null>(null).pipe(Atom.keepAlive);
  const uiAtom = Atom.make<UsageUiState>(freshUi(initialNow)).pipe(Atom.keepAlive);
  let refreshing = false;

  const updateUi = (update: (current: UsageUiState) => UsageUiState) =>
    registry.set(uiAtom, update(registry.get(uiAtom)));
  const updatePrices = (update: (current: PricesState) => PricesState) =>
    updateUi((current) =>
      current.prices === null ? current : { ...current, prices: update(current.prices) },
    );

  const pageOpenAtom = Atom.make((get) => get(context.pageAtom).kind === "usage");
  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(state.primaryServerConfigAtom)?.keybindings ?? []),
  );
  const usageByWindowAtom = createUsageByWindowAtom({
    label: "gpui-usage",
    presentationsAtom,
    usageSummary: state.serverEnvironment.usageSummary,
    providersValueAtom: state.serverEnvironment.providersValueAtom,
  });
  const priceTargetsAtom = createUsagePriceTargetsAtom({
    presentationsAtom,
    settingsValueAtom: state.serverEnvironment.settingsValueAtom,
    sessionStateAtom: state.environmentSession.sessionStateAtom,
    hasDesktopBridge: true,
  });

  const usageAtom = Atom.make((get) => {
    if (!get(pageOpenAtom)) return null;
    const environments = get(usageByWindowAtom(usageWindowKey(get(windowAtom).window)));
    const selectedEnvironments = selectUsageEnvironments(environments, get(selectionAtom));
    return {
      environments,
      selectedEnvironments,
      merged: mergeSelectedUsage(selectedEnvironments),
      ...resolveUsageReportingState(selectedEnvironments),
    };
  });

  const pageModelAtom = Atom.make((get): UsagePageModel | null => {
    const usage = get(usageAtom);
    if (usage === null) return null;
    const ui = get(uiAtom);
    const { days, window } = get(windowAtom);
    return buildUsagePageModel({
      metric: get(preferencesAtom).metric,
      windowDays: days,
      window,
      breakdown: ui.breakdown,
      isRefreshing: ui.isRefreshing,
      merged: usage.merged,
      environments: usage.environments,
      selectedEnvironments: usage.selectedEnvironments,
      selectedEnvironmentIds: get(selectionAtom),
      isPending: usage.isPending,
      isPartial: usage.isPartial,
      presentations: get(presentationsAtom),
      keybindings: get(keybindingsAtom),
      limitsNowMs: ui.limitsNowMs,
      timestampFormat: get(context.clientSettingsAtom).timestampFormat,
    });
  });

  const pricesModelAtom = Atom.make((get): UsagePriceOverridesModel | null => {
    const prices = get(uiAtom).prices;
    const usage = get(usageAtom);
    if (prices === null || usage === null) return null;
    return buildUsagePriceOverridesModel({
      environments: get(priceTargetsAtom),
      selectedIds: prices.selectedIds,
      usage: usage.environments,
      drafts: prices.drafts,
      pending: prices.pending,
      attempt: prices.attempt,
    });
  });

  const viewAtom = Atom.make((get): UsageView | null => {
    const page = get(pageModelAtom);
    if (page === null) return null;
    const ui = get(uiAtom);
    const initials: Record<string, string> = {};
    const emails: Record<string, UsageSegmentEmailView> = {};
    const resetButtons: Record<string, ResetCreditButtonModel> = {};
    if (page.content.kind === "limits") {
      for (const section of page.content.limits.sections) {
        initials[section.label] = providerInstanceInitials(section.label);
      }
      const prompt = page.content.cursorPrompt;
      if (prompt !== null) initials[prompt.title] = providerInstanceInitials(prompt.title);
    }
    for (const { key, segment } of segmentsOf(page)) {
      if (segment.account.avatar.kind === "instance") {
        initials[segment.account.avatar.displayName] = providerInstanceInitials(
          segment.account.avatar.displayName,
        );
      }
      if (segment.redeem !== null) {
        resetButtons[key] = buildResetCreditButtonModel(ui.redeem.get(key)?.busy ?? false);
      }
      const email = (revealed: boolean) =>
        buildRedactedSensitiveTextModel({
          value: segment.account.email,
          revealed,
          ariaLabel: "Toggle account email visibility",
          revealTooltip: "Click to reveal email",
          hideTooltip: "Click to hide email",
        });
      const hidden = email(false);
      const revealed = email(true);
      if (hidden !== null && revealed !== null) {
        emails[key] = {
          hidden: { text: hidden.text, tooltip: hidden.tooltip },
          revealed: { text: revealed.text, tooltip: revealed.tooltip },
        };
      }
    }
    const pricesModel = get(pricesModelAtom);
    return {
      page,
      initials,
      cursorPending: [...ui.cursorPending],
      redeem: Object.fromEntries(ui.redeem),
      resetButtons,
      emails,
      resetConfirm: ui.confirmRedeem === null ? null : RESET_CREDIT_DIALOG_COPY,
      chatGptButton: {
        label: CHATGPT_USAGE_BUTTON.label,
        url: CHATGPT_USAGE_BUTTON.url,
      },
      prices:
        ui.prices === null || pricesModel === null
          ? null
          : {
              model: pricesModel,
              focusRowId: ui.prices.focusRowId,
              suggestions: suggestionsFor(pricesModel),
            },
    };
  });

  const refreshLimits = async (automatic = false, afterPending = false) => {
    try {
      await Promise.all(
        resolveLimitsRefreshTargets(
          registry.get(presentationsAtom),
          registry.get(selectionAtom),
        ).map((environmentId) =>
          refreshUsageLimits(
            environmentId,
            () =>
              runAtomCommand(
                registry,
                state.serverEnvironment.refreshProviders,
                { environmentId, input: {} },
                { reportFailure: false },
              ),
            automatic,
            afterPending,
          ),
        ),
      );
    } finally {
      updateUi((current) => ({ ...current, limitsNowMs: Date.now() }));
    }
  };

  const refreshCurrentUsage = (input?: UsageSummaryInput) =>
    refreshUsage({
      registry,
      server: state.serverEnvironment,
      presentations: state.environmentPresentations,
      environmentIds: (registry.get(usageAtom)?.selectedEnvironments ?? []).map(
        ({ environmentId }) => environmentId,
      ),
      input: input ?? registry.get(windowAtom).window,
    });

  const savePreferences = (preferences: UsagePagePreferences) => {
    registry.set(preferencesAtom, preferences);
    saveUsagePagePreferences(preferences);
  };

  const selectMetric = (metric: UsageMetric) => {
    const selection = resolveMetricSelection(metric, registry.get(windowAtom).days);
    if (selection.resetLimitsClock)
      updateUi((current) => ({ ...current, limitsNowMs: Date.now() }));
    savePreferences(selection.preferences);
  };

  const selectWindow = (days: number) => {
    const selection = resolveWindowSelection(
      days,
      registry.get(preferencesAtom).metric,
      Date.now(),
    );
    if (selection.kind === "ignore") return;
    savePreferences(selection.preferences);
    registry.set(windowAtom, {
      days: selection.days,
      window: selection.window,
    });
  };

  const refreshWindow = () => {
    const { days, window } = registry.get(windowAtom);
    const action = resolveUsageRefresh({
      refreshing,
      showingLimits: registry.get(preferencesAtom).metric === "limits",
      windowDays: days,
      window,
      nowMs: Date.now(),
    });
    if (action.kind === "ignore") return;
    refreshing = true;
    updateUi((current) => ({ ...current, isRefreshing: true }));
    const settle = () => {
      refreshing = false;
      updateUi((current) => ({ ...current, isRefreshing: false }));
    };
    if (action.kind === "limits") {
      void refreshLimits().finally(settle);
      return;
    }
    const refreshed = refreshCurrentUsage(action.window);
    if (action.windowChanged) registry.set(windowAtom, { days, window: action.window });
    void refreshed.finally(settle);
  };

  const onCursorEnabled = () => {
    void refreshCurrentUsage();
    void refreshLimits(false, true);
  };

  const enableCursor = async (environmentId: EnvironmentId) => {
    updateUi((current) => ({
      ...current,
      cursorPending: new Set([...current.cursorPending, environmentId]),
    }));
    try {
      const result = await runAtomCommand(
        registry,
        state.serverEnvironment.updateSettings,
        {
          environmentId,
          input: { patch: { cursorKeychainUsageEnabled: true } },
        },
        { label: "enable Cursor account usage" },
      );
      if (result._tag === "Success") onCursorEnabled();
    } finally {
      updateUi((current) => {
        const cursorPending = new Set(current.cursorPending);
        cursorPending.delete(environmentId);
        return { ...current, cursorPending };
      });
    }
  };

  const setRedeem = (key: string, next: RedeemState) =>
    updateUi((current) => ({
      ...current,
      redeem: new Map(current.redeem).set(key, next),
    }));

  const redeem = async (key: string) => {
    const page = registry.get(pageModelAtom);
    const target = page === null ? undefined : segmentsOf(page).find((entry) => entry.key === key);
    updateUi((current) => ({ ...current, confirmRedeem: null }));
    if (target?.segment.redeem == null) return;
    const { environmentId, input } = target.segment.redeem;
    setRedeem(key, { busy: true, status: null });
    const result = await runAtomCommand(
      registry,
      state.serverEnvironment.consumeResetCredit,
      { environmentId, input },
      { reportFailure: false },
    );
    setRedeem(key, {
      busy: false,
      status: resolveResetCreditStatus(resetCreditResultOf(result)),
    });
  };

  const priceTargets = () => registry.get(priceTargetsAtom);

  const updateDraft = (draft: UsagePriceDraft) =>
    updatePrices((current) => ({
      ...current,
      drafts: current.drafts.some((entry) => entry.id === draft.id)
        ? current.drafts.map((entry) => (entry.id === draft.id ? draft : entry))
        : [...current.drafts, draft],
      attempt: null,
    }));

  const applyDraftAction = (action: UsagePriceDraftAction) => {
    if (action.kind === "remove-draft") {
      updatePrices((current) => ({
        ...current,
        drafts: current.drafts.filter((entry) => entry.id !== action.id),
      }));
      return;
    }
    updateDraft(action.draft);
  };

  const pricesRow = (rowId: string) =>
    registry.get(pricesModelAtom)?.table.rows.find((row) => row.id === rowId) ?? null;

  const savePrices = async () => {
    const prices = registry.get(uiAtom).prices;
    if (prices === null) return;
    const environments = priceTargets();
    const plan = resolveUsagePriceSave({
      environments,
      selectedIds: prices.selectedIds,
      drafts: prices.drafts,
      pending: prices.pending,
      attempt: prices.attempt,
    });
    if (plan.kind === "none") return;
    updatePrices((current) => ({
      ...current,
      pending: true,
      attempt: startUsagePriceSaveAttempt(current.attempt, plan),
    }));
    let failed = false;
    await writeUsagePrices({
      targets: plan.writeTargets,
      changes: plan.changes,
      write: (input) =>
        runAtomCommand(registry, state.serverEnvironment.updateSettings, input, {
          reportFailure: false,
        }),
      onResult: (environmentId, result) => {
        if (result.status === "failed") failed = true;
        updatePrices((current) => ({
          ...current,
          attempt:
            current.attempt === null
              ? null
              : {
                  ...current.attempt,
                  results: new Map(current.attempt.results).set(environmentId, result),
                },
        }));
      },
    });
    updatePrices((current) => ({
      ...current,
      pending: false,
      drafts: failed ? current.drafts : [],
    }));
  };

  let previousPage: AppPage = registry.get(context.pageAtom);
  let returnPage: AppPage = CHAT_PAGE;
  registry.subscribe(
    context.pageAtom,
    (page) => {
      const previous = previousPage;
      previousPage = page;
      if (page.kind !== "usage" || previous.kind === "usage") return;
      returnPage = previous;
      const now = Date.now();
      const preferences = readUsagePagePreferences();
      refreshing = false;
      registry.set(preferencesAtom, preferences);
      registry.set(windowAtom, freshWindow(preferences, now));
      registry.set(selectionAtom, null);
      registry.set(uiAtom, freshUi(now));
    },
    { immediate: false },
  );

  const autoRefreshKeyAtom = Atom.make((get) => {
    if (!get(pageOpenAtom) || get(preferencesAtom).metric !== "limits") return "";
    return resolveLimitsRefreshTargets(get(presentationsAtom), get(selectionAtom)).join(",");
  });
  let autoRefreshKey = "";
  registry.subscribe(
    autoRefreshKeyAtom,
    (key) => {
      const changed = key !== autoRefreshKey;
      autoRefreshKey = key;
      if (changed && key !== "") void refreshLimits(true);
    },
    { immediate: true },
  );

  return {
    pages: ["usage"],
    views: { usage: viewAtom },
    actions: {
      usageSelectMetric: async (params) => {
        const { metric } = MetricParams(params);
        if (isUsageMetric(metric)) selectMetric(metric);
        return null;
      },
      usageSelectWindow: async (params) => {
        selectWindow(WindowParams(params).days);
        return null;
      },
      usageSelectBreakdown: async (params) => {
        const { breakdown } = BreakdownParams(params);
        updateUi((current) => ({ ...current, breakdown }));
        return null;
      },
      usageRefresh: async () => {
        refreshWindow();
        return null;
      },
      usageSelectAllEnvironments: async (params) => {
        registry.set(selectionAtom, AllParams(params).checked ? null : new Set());
        return null;
      },
      usageToggleEnvironment: async (params) => {
        const { environmentId, checked } = EnvironmentParams(params);
        registry.set(
          selectionAtom,
          resolveEnvironmentSelection({
            environmentIds: (registry.get(usageAtom)?.environments ?? []).map(
              (environment) => environment.environmentId,
            ),
            selectedIds: registry.get(selectionAtom),
            environmentId: EnvironmentId.make(environmentId),
            checked,
          }),
        );
        return null;
      },
      usageKey: async (params) => {
        const { event, repeat } = KeyParams(params);
        const ui = registry.get(uiAtom);
        const overlay = ui.prices !== null || ui.confirmRedeem !== null;
        if (event.key.toLowerCase() === "escape" && !repeat && !overlay) {
          context.navigate(returnPage);
          return null;
        }
        const action = resolveUsageShortcutAction({
          defaultPrevented: false,
          repeat,
          isComposing: false,
          overlayOpen: overlay,
          command:
            repeat || overlay
              ? null
              : resolveShortcutCommand(event, registry.get(keybindingsAtom), {
                  platform: context.platform,
                  context: { usagePageOpen: true },
                }),
          showingLimits: registry.get(preferencesAtom).metric === "limits",
        });
        if (action.kind === "ignore") return null;
        if (action.metric !== null) selectMetric(action.metric);
        if (action.windowDays !== null) selectWindow(action.windowDays);
        return null;
      },
      usageEnableCursor: async (params) => {
        await enableCursor(EnvironmentId.make(CursorParams(params).environmentId));
        return null;
      },
      usageOpenExternal: async (params) => {
        await openExternal(UrlParams(params).url);
        return null;
      },
      usageRedeemRequest: async (params) => {
        const { key } = SegmentParams(params);
        updateUi((current) => ({ ...current, confirmRedeem: key }));
        return null;
      },
      usageRedeemCancel: async () => {
        updateUi((current) => ({ ...current, confirmRedeem: null }));
        return null;
      },
      usageRedeemConfirm: async () => {
        const key = registry.get(uiAtom).confirmRedeem;
        if (key !== null) await redeem(key);
        return null;
      },
      usagePricesOpen: async () => {
        updateUi((current) => ({
          ...current,
          prices: {
            selectedIds: registry.get(selectionAtom),
            drafts: [],
            pending: false,
            attempt: null,
            nextRowId: 0,
            focusRowId: null,
          },
        }));
        return null;
      },
      usagePricesClose: async () => {
        if (registry.get(pricesModelAtom)?.closeAllowed === false) return null;
        updateUi((current) => ({ ...current, prices: null }));
        return null;
      },
      usagePricesSelectAll: async (params) => {
        const { checked } = AllParams(params);
        updatePrices((current) => ({
          ...current,
          selectedIds: checked ? null : new Set(),
          attempt: null,
        }));
        return null;
      },
      usagePricesToggleEnvironment: async (params) => {
        const { environmentId, checked } = EnvironmentParams(params);
        const environmentIds = priceTargets().map((target) => target.environmentId);
        updatePrices((current) => ({
          ...current,
          selectedIds: resolveEnvironmentSelection({
            environmentIds,
            selectedIds: current.selectedIds,
            environmentId: EnvironmentId.make(environmentId),
            checked,
          }),
          attempt: null,
        }));
        return null;
      },
      usagePricesAddRow: async () => {
        const prices = registry.get(uiAtom).prices;
        if (prices === null) return null;
        const id = `new:${prices.nextRowId}`;
        updatePrices((current) => ({
          ...current,
          nextRowId: current.nextRowId + 1,
          focusRowId: id,
        }));
        updateDraft({ id, model: "", isNew: true, values: {} });
        return null;
      },
      usagePricesModel: async (params) => {
        const { rowId, value } = ModelParams(params);
        const row = pricesRow(rowId);
        if (row !== null) updateDraft({ ...row.draft, model: value });
        return null;
      },
      usagePricesCell: async (params) => {
        const { rowId, field, value } = CellParams(params);
        const row = pricesRow(rowId);
        const prices = registry.get(uiAtom).prices;
        if (row === null || prices === null) return null;
        applyDraftAction(
          resolveUsagePriceCellEdit({
            row: row.draft,
            field,
            value,
            environments: priceTargets(),
            selectedIds: prices.selectedIds,
          }),
        );
        return null;
      },
      usagePricesRowAction: async (params) => {
        const row = pricesRow(RowParams(params).rowId);
        if (row !== null) applyDraftAction(resolveUsagePriceRowAction(row.draft));
        return null;
      },
      usagePricesDiscard: async () => {
        updatePrices((current) => ({ ...current, drafts: [], attempt: null }));
        return null;
      },
      usagePricesSave: async () => {
        await savePrices();
        return null;
      },
    },
  };
}
