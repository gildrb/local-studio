import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  type BitbucketSettings,
  type EnvironmentId,
  type UnifiedSettings,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import {
  buildBitbucketCredentialsModel,
  EMPTY_BITBUCKET_CREDENTIALS_DRAFT,
  resolveBitbucketCredentialMethodChange,
  resolveBitbucketCredentialsDraftChange,
  resolveBitbucketCredentialsRemove,
  resolveBitbucketCredentialsSave,
  resolveBitbucketCredentialsSaved,
  type BitbucketCredentialsDraft,
  type BitbucketCredentialsIntent,
  type BitbucketCredentialsModel,
} from "@t3tools/web/src/components/settings/BitbucketCredentialsSettings.logic.ts";
import { buildRedactedSensitiveTextModel } from "@t3tools/web/src/components/settings/RedactedSensitiveText.logic.ts";
import {
  buildGitFetchIntervalModel,
  buildSourceControlSettingsModel,
  resolveGitFetchIntervalChange,
  resolveGitFetchIntervalReset,
  resolveSourceControlDiscoveryEnvironmentId,
  shouldExpandSourceControlRowForSearchTarget,
  SOURCE_CONTROL_ACCOUNT_REDACTION,
  type GitFetchIntervalModel,
  type SourceControlDiscoveryRowModel,
  type SourceControlDiscoveryViewModel,
  type SourceControlScanButtonModel,
} from "@t3tools/web/src/components/settings/SourceControlSettings.logic.ts";
import {
  buildSourceControlWritingSettingsModel,
  deriveSourceControlWriterModelState,
  resolveFollowChangeRequestTemplatesChange,
  resolveFollowChangeRequestTemplatesReset,
  resolveSourceControlBulkInstructionsApply,
  resolveSourceControlCustomInstructionsCommit,
  resolveSourceControlWriterModelChange,
  resolveSourceControlWriterModelToggle,
  resolveSourceControlWritingModeChange,
  resolveSourceControlWritingStyleReset,
  type SourceControlWriterModelState,
  type SourceControlWritingSettingsModel,
} from "@t3tools/web/src/components/settings/SourceControlWritingSettings.logic.ts";
import { scopedSettingsAreMixed } from "@t3tools/web/src/components/settings/scopedSettings.ts";
import { resolveScopedModelDisabledReason } from "@t3tools/web/src/components/settings/useScopedModelAvailability.logic.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import {
  settingsModelPickerControl,
  type SettingsModelPickerControlView,
  type SettingsModelPickerPopupView,
  type SettingsModelPickerSource,
} from "./modelPickers.ts";
import {
  createProjectDefaults,
  PROJECT_DEFAULTS_PICKER,
  type ProjectDefaultsView,
} from "./projectDefaults.ts";
import type {
  SettingsRowScope,
  SettingsScopeContextSnapshot,
  SettingsScopeRuntime,
  SettingsSection,
} from "./scope.ts";
import { createSectionPickers } from "./sectionPickers.ts";

const WRITER_PICKER = "writer-model";

type SourceControlUi = {
  readonly expanded: ReadonlySet<string>;
  readonly revealed: ReadonlySet<string>;
  readonly bitbucket: {
    readonly environmentId: EnvironmentId | null;
    readonly draft: BitbucketCredentialsDraft;
    readonly saving: boolean;
  };
  readonly bulk: { readonly editing: boolean; readonly draft: string | null };
};

const INITIAL_UI: SourceControlUi = {
  expanded: new Set(),
  revealed: new Set(),
  bitbucket: { environmentId: null, draft: EMPTY_BITBUCKET_CREDENTIALS_DRAFT, saving: false },
  bulk: { editing: false, draft: null },
};

export type SourceControlAccountView = {
  readonly text: string;
  readonly revealed: boolean;
  readonly tooltip: string;
};

export type SourceControlRowView = SourceControlDiscoveryRowModel & {
  readonly expanded: boolean;
  readonly account: SourceControlAccountView | null;
};

export type SourceControlDiscoveryView =
  | Exclude<SourceControlDiscoveryViewModel, { readonly kind: "discovered" }>
  | {
      readonly kind: "discovered";
      readonly sections: ReadonlyArray<{
        readonly key: string;
        readonly id: string | null;
        readonly title: string;
        readonly showScanButton: boolean;
        readonly rows: readonly SourceControlRowView[];
      }>;
    };

export type SourceControlSettingsView = {
  readonly defaults: ProjectDefaultsView;
  readonly scanButton: SourceControlScanButtonModel;
  readonly discovery: SourceControlDiscoveryView;
  readonly gitFetch: GitFetchIntervalModel;
  readonly bitbucket: (BitbucketCredentialsModel & { readonly searchTargetId: string }) | null;
  readonly writing: SourceControlWritingSettingsModel;
  readonly writingRowScope: SettingsRowScope;
  readonly templatesRowScope: SettingsRowScope;
  readonly writerRowScope: SettingsRowScope;
  readonly writerPicker: SettingsModelPickerControlView | null;
  readonly modelPicker: SettingsModelPickerPopupView | null;
};

const RowParams = Schema.decodeUnknownSync(Schema.Struct({ rowId: Schema.String }));
const SecondsParams = Schema.decodeUnknownSync(
  Schema.Struct({ seconds: Schema.NullOr(Schema.Number) }),
);
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const FieldParams = Schema.decodeUnknownSync(
  Schema.Struct({
    field: Schema.Literals(["access-token", "email", "api-token"]),
    value: Schema.String,
  }),
);
const ModeParams = Schema.decodeUnknownSync(
  Schema.Struct({ value: Schema.String, customDraft: Schema.optional(Schema.String) }),
);
const CheckedParams = Schema.decodeUnknownSync(Schema.Struct({ checked: Schema.Boolean }));

type WriterDerived = {
  readonly settings: UnifiedSettings;
  readonly scopeContext: SettingsScopeContextSnapshot;
  readonly writer: SourceControlWriterModelState;
  readonly source: SettingsModelPickerSource | null;
  readonly disabledReason: SettingsModelPickerSource["disabledReason"];
};

export function createSourceControlSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const uiAtom = Atom.make<SourceControlUi>(INITIAL_UI).pipe(Atom.keepAlive);
  const ui = () => registry.get(uiAtom);
  const patchUi = (patch: Partial<SourceControlUi>) => registry.set(uiAtom, { ...ui(), ...patch });
  const defaults = createProjectDefaults(context, scope, "source-control");

  const deriveWriter = (input: {
    readonly settings: UnifiedSettings;
    readonly scopeContext: SettingsScopeContextSnapshot;
    readonly clientSettings: ClientSettings;
  }): WriterDerived => {
    const { settings, scopeContext } = input;
    const environment = scopeContext.environment;
    const writer = deriveSourceControlWriterModelState(
      settings,
      environment?.serverConfig?.providers ?? [],
    );
    const disabledReason: SettingsModelPickerSource["disabledReason"] = (instanceId, model) =>
      resolveScopedModelDisabledReason({
        settings,
        entries: writer.instanceEntries,
        targets: scopeContext.targets,
        environments: registry.get(scope.environmentsAtom),
        instanceId,
        model,
      });
    const mixed = scopedSettingsAreMixed(scopeContext.targets, [
      "sourceControlWriterModelSelection",
    ]);
    const canShow =
      scopeContext.connectedEnvironments.length > 0 &&
      writer.usesDedicatedModel &&
      writer.canEnableDedicatedModel;
    return {
      settings,
      scopeContext,
      writer,
      disabledReason,
      source: canShow
        ? {
            contextInput: {
              activeInstanceId: writer.activeSelection.instanceId,
              model: writer.activeSelection.model,
              instanceEntries: writer.instanceEntries,
              modelOptionsByInstance: writer.modelOptionsByInstance,
              lockedProvider: null,
              canOpenProviderSetup: environment !== null,
              favorites: input.clientSettings.favorites,
            },
            triggerLabel: mixed ? "Mixed" : null,
            disabledReason,
            traits: null,
          }
        : null,
    };
  };

  const currentWriter = () =>
    deriveWriter({
      settings: registry.get(scope.scopedSettingsAtom),
      scopeContext: registry.get(scope.scopeContextAtom),
      clientSettings: registry.get(context.clientSettingsAtom),
    });

  const pickers = createSectionPickers(context, "settingsSourceControl", {
    [PROJECT_DEFAULTS_PICKER]: defaults.binding,
    [WRITER_PICKER]: {
      source: () => currentWriter().source,
      select: async (instanceId, model) => {
        const decision = resolveSourceControlWriterModelChange({
          instanceId,
          model,
          disabledReason: currentWriter().disabledReason(instanceId, model),
        });
        if (decision.kind === "reject") {
          context.addToast({ layout: "stacked", ...decision.toast });
          return;
        }
        await scope.updateScopedSettings(decision.patch);
      },
      traits: async () => {},
    },
  });

  const discoveryAtomFor = (environmentId: EnvironmentId) =>
    state.sourceControlEnvironment.discovery({ environmentId, input: {} });

  const discoveryEnvironmentId = () =>
    resolveSourceControlDiscoveryEnvironmentId(registry.get(scope.scopeContextAtom).environment);

  const modelAtom = Atom.make((get) => {
    if (get(scope.sectionAtom) !== "source-control") return null;
    const scopeContext = get(scope.scopeContextAtom);
    const environmentId = resolveSourceControlDiscoveryEnvironmentId(scopeContext.environment);
    const result = environmentId === null ? null : get(discoveryAtomFor(environmentId));
    return buildSourceControlSettingsModel({
      environment: scopeContext.environment,
      scopeEnvironmentCount: scopeContext.scope.environmentIds.length,
      connectedEnvironmentCount: scopeContext.connectedEnvironments.length,
      discovery: {
        data: result === null ? null : Option.getOrNull(AsyncResult.value(result)),
        isPending: result !== null && result.waiting,
        error:
          result !== null && result._tag === "Failure"
            ? formatEnvironmentQueryError(result.cause)
            : null,
      },
    });
  });

  const expandTargetsAtom = Atom.make((get) => {
    const model = get(modelAtom);
    const targetId = get(scope.searchTargetAtom).targetId;
    if (model === null || model.view.kind !== "discovered") return "";
    return model.view.sections
      .flatMap((section) => section.rows)
      .filter((row) => shouldExpandSourceControlRowForSearchTarget(row, targetId))
      .map((row) => row.id)
      .join("\u0000");
  });

  const expandForSearch = (ids: string) => {
    if (ids.length === 0) return;
    const expanded = new Set(ui().expanded);
    for (const id of ids.split("\u0000")) expanded.add(id);
    patchUi({ expanded });
  };
  registry.subscribe(expandTargetsAtom, expandForSearch);

  const bitbucketSaved = (
    read: <A>(atom: Atom.Atom<A>) => A,
    environmentId: EnvironmentId,
  ): BitbucketSettings =>
    mergeEnvironmentSettings(
      read(state.serverEnvironment.settingsValueAtom(environmentId)) ?? DEFAULT_SERVER_SETTINGS,
      read(context.clientSettingsAtom),
    ).bitbucket;

  const bitbucketDraft = (environmentId: EnvironmentId) => {
    const current = ui().bitbucket;
    return current.environmentId === environmentId
      ? current
      : { environmentId, draft: EMPTY_BITBUCKET_CREDENTIALS_DRAFT, saving: false };
  };

  const viewAtom = Atom.make((get): SourceControlSettingsView | null => {
    const model = get(modelAtom);
    if (model === null) return null;
    const current = get(uiAtom);
    const settings = get(scope.scopedSettingsAtom);
    const scopeContext = get(scope.scopeContextAtom);
    const discovery: SourceControlDiscoveryView =
      model.view.kind === "discovered"
        ? {
            kind: "discovered",
            sections: model.view.sections.map((section) => ({
              ...section,
              rows: section.rows.map((row) => {
                const account =
                  row.summary.kind === "authenticated"
                    ? buildRedactedSensitiveTextModel({
                        value: row.summary.account,
                        revealed: current.revealed.has(row.id),
                        ...SOURCE_CONTROL_ACCOUNT_REDACTION,
                      })
                    : null;
                return {
                  ...row,
                  expanded: current.expanded.has(row.id),
                  account:
                    account === null
                      ? null
                      : {
                          text: account.text,
                          revealed: account.revealed,
                          tooltip: account.tooltip,
                        },
                };
              }),
            })),
          }
        : model.view;
    const bitbucketRow =
      model.view.kind === "discovered"
        ? model.view.sections
            .flatMap((section) => section.rows)
            .find((row) => row.details?.kind === "bitbucket-credentials")
        : undefined;
    const environmentId = model.environmentId;
    const bitbucket =
      bitbucketRow?.details && environmentId !== null
        ? (() => {
            const draftState =
              current.bitbucket.environmentId === environmentId
                ? current.bitbucket
                : { draft: EMPTY_BITBUCKET_CREDENTIALS_DRAFT, saving: false };
            return {
              ...buildBitbucketCredentialsModel({
                environmentId,
                saved: bitbucketSaved(get, environmentId),
                draft: draftState.draft,
                saving: draftState.saving,
              }),
              searchTargetId: bitbucketRow.details.searchTargetId,
            };
          })()
        : null;
    const writer = deriveWriter({
      settings,
      scopeContext,
      clientSettings: get(context.clientSettingsAtom),
    });
    const defaultsView = defaults.view(get);
    const writing = buildSourceControlWritingSettingsModel({
      settings,
      targetWritingStyles: scopeContext.targets.map(
        (target) => target.settings.sourceControlWritingStyle,
      ),
      writerModelMixed: scopedSettingsAreMixed(scopeContext.targets, [
        "sourceControlWriterModelSelection",
      ]),
      hasServerTargets: scopeContext.connectedEnvironments.length > 0,
      environmentId: scopeContext.environment?.environmentId ?? null,
      writerModel: writer.writer,
      bulkInstructions: current.bulk,
    });
    return {
      defaults: defaultsView.view,
      scanButton: model.scanButton,
      discovery,
      gitFetch: buildGitFetchIntervalModel({ settings }),
      bitbucket,
      writing,
      writingRowScope: scope.rowScope(get, {
        serverScoped: true,
        settingKeys: ["sourceControlWritingStyle"],
        mixed: writing.writingStyle.mixed,
      }),
      templatesRowScope: scope.rowScope(get, {
        serverScoped: true,
        settingKeys: ["sourceControlWritingStyle"],
        mixed: writing.templates.mixed,
      }),
      writerRowScope: scope.rowScope(get, {
        serverScoped: true,
        settingKeys: ["sourceControlWriterModelSelection"],
      }),
      writerPicker: writer.source === null ? null : settingsModelPickerControl(writer.source),
      modelPicker: pickers.popup(get, {
        [PROJECT_DEFAULTS_PICKER]: defaultsView.source,
        [WRITER_PICKER]: writer.source,
      }),
    };
  });

  const scan = () => {
    const environmentId = discoveryEnvironmentId();
    if (environmentId !== null) registry.refresh(discoveryAtomFor(environmentId));
  };

  const runBitbucketIntent = async (intent: BitbucketCredentialsIntent) => {
    if (intent.kind !== "save") return;
    const environmentId = registry.get(modelAtom)?.environmentId ?? null;
    if (environmentId === null) return;
    const started = bitbucketDraft(environmentId);
    patchUi({ bitbucket: { ...started, saving: true } });
    try {
      const result = await runAtomCommand(
        registry,
        state.serverEnvironment.updateSettings,
        { environmentId, input: { patch: { bitbucket: intent.settings } } },
        { label: "save Bitbucket credentials" },
      );
      if (result._tag === "Success") {
        const latest = bitbucketDraft(environmentId);
        patchUi({
          bitbucket: { ...latest, draft: resolveBitbucketCredentialsSaved(latest.draft) },
        });
        scan();
      }
    } finally {
      patchUi({ bitbucket: { ...bitbucketDraft(environmentId), saving: false } });
    }
  };

  const updateBitbucketDraft = (
    change: (draft: BitbucketCredentialsDraft) => BitbucketCredentialsDraft,
  ) => {
    const environmentId = registry.get(modelAtom)?.environmentId ?? null;
    if (environmentId === null) return;
    const current = bitbucketDraft(environmentId);
    if (current.saving) return;
    patchUi({ bitbucket: { ...current, draft: change(current.draft) } });
  };

  const toggleIn = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  return {
    views: { settingsSourceControl: viewAtom },
    actions: {
      ...pickers.actions,
      settingsSourceControlMount: async () => {
        registry.set(uiAtom, INITIAL_UI);
        pickers.reset();
        expandForSearch(registry.get(expandTargetsAtom));
        return null;
      },
      settingsSourceControlDefaults: defaults.changeAction,
      settingsSourceControlScan: async () => {
        scan();
        return null;
      },
      settingsSourceControlToggleRow: async (params) => {
        patchUi({ expanded: toggleIn(ui().expanded, RowParams(params).rowId) });
        return null;
      },
      settingsSourceControlRevealAccount: async (params) => {
        patchUi({ revealed: toggleIn(ui().revealed, RowParams(params).rowId) });
        return null;
      },
      settingsSourceControlFetchInterval: async (params) => {
        const { seconds } = SecondsParams(params);
        await scope.updateScopedSettings(
          resolveGitFetchIntervalChange(
            registry.get(scope.scopedSettingsAtom).backgroundActivity,
            seconds,
          ),
        );
        return null;
      },
      settingsSourceControlFetchIntervalReset: async () => {
        await scope.updateScopedSettings(
          resolveGitFetchIntervalReset(registry.get(scope.scopedSettingsAtom).backgroundActivity),
        );
        return null;
      },
      settingsSourceControlBitbucketMethod: async (params) => {
        const methodChoice = resolveBitbucketCredentialMethodChange([ValueParams(params).value]);
        if (methodChoice !== null) updateBitbucketDraft((draft) => ({ ...draft, methodChoice }));
        return null;
      },
      settingsSourceControlBitbucketField: async (params) => {
        const { field, value } = FieldParams(params);
        updateBitbucketDraft((draft) =>
          resolveBitbucketCredentialsDraftChange(draft, field, value),
        );
        return null;
      },
      settingsSourceControlBitbucketSave: async () => {
        const environmentId = registry.get(modelAtom)?.environmentId ?? null;
        if (environmentId === null) return null;
        const current = bitbucketDraft(environmentId);
        if (current.saving) return null;
        await runBitbucketIntent(
          resolveBitbucketCredentialsSave({
            saved: bitbucketSaved((atom) => registry.get(atom), environmentId),
            draft: current.draft,
          }),
        );
        return null;
      },
      settingsSourceControlBitbucketRemove: async () => {
        await runBitbucketIntent(resolveBitbucketCredentialsRemove());
        return null;
      },
      settingsSourceControlWritingMode: async (params) => {
        const { value, customDraft } = ModeParams(params);
        const patch = resolveSourceControlWritingModeChange({
          value,
          customInstructionsDraft: customDraft,
        });
        if (patch !== null) await scope.updateScopedSettings(patch);
        return null;
      },
      settingsSourceControlCustomInstructions: async (params) => {
        const patch = resolveSourceControlCustomInstructionsCommit({
          value: ValueParams(params).value,
          current: registry.get(scope.scopedSettingsAtom).sourceControlWritingStyle
            .customInstructions,
        });
        if (patch !== null) await scope.updateScopedSettings(patch);
        return null;
      },
      settingsSourceControlBulkOpen: async () => {
        patchUi({ bulk: { editing: true, draft: null } });
        return null;
      },
      settingsSourceControlBulkDraft: async (params) => {
        patchUi({ bulk: { editing: ui().bulk.editing, draft: ValueParams(params).value } });
        return null;
      },
      settingsSourceControlBulkApply: async () => {
        const patch = resolveSourceControlBulkInstructionsApply(ui().bulk.draft);
        if (patch === null) return null;
        await scope.updateScopedSettings(patch);
        patchUi({ bulk: { editing: false, draft: ui().bulk.draft } });
        return null;
      },
      settingsSourceControlWritingReset: async () => {
        await scope.updateScopedSettings(resolveSourceControlWritingStyleReset());
        return null;
      },
      settingsSourceControlTemplates: async (params) => {
        await scope.updateScopedSettings(
          resolveFollowChangeRequestTemplatesChange(CheckedParams(params).checked),
        );
        return null;
      },
      settingsSourceControlTemplatesReset: async () => {
        await scope.updateScopedSettings(resolveFollowChangeRequestTemplatesReset());
        return null;
      },
      settingsSourceControlWriterToggle: async (params) => {
        await scope.updateScopedSettings(
          resolveSourceControlWriterModelToggle({
            checked: CheckedParams(params).checked,
            defaultModelSelection: currentWriter().writer.defaultModelSelection,
          }),
        );
        return null;
      },
    },
  };
}
