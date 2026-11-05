import type { UnifiedSettings } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import {
  buildProjectDefaultsModel,
  resolveDefaultModelDisabledReason,
  resolveProjectDefaultsChange,
  resolveProjectDefaultsModelPicker,
  resolveProjectDefaultsModelTargets,
  type ProjectDefaultsChangeContext,
  type ProjectDefaultsIntent,
  type ProjectDefaultsRow,
  type ProjectSettingsCategory,
} from "@t3tools/web/src/components/settings/ProjectDefaultsSettings.logic.ts";
import { scopedSettingsAreMixed } from "@t3tools/web/src/components/settings/scopedSettings.ts";
import type { EnvironmentPresentation } from "@t3tools/web/src/state/environments.ts";
import * as Schema from "effect/Schema";
import type { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import {
  settingsModelPickerControl,
  type SettingsModelPickerControlView,
  type SettingsModelPickerSource,
} from "./modelPickers.ts";
import type {
  SettingsRowScope,
  SettingsScopeContextSnapshot,
  SettingsScopeRuntime,
} from "./scope.ts";
import type { SectionPickerBinding } from "./sectionPickers.ts";

export const PROJECT_DEFAULTS_PICKER = "default-model";

export type ProjectDefaultsRowView = ProjectDefaultsRow & {
  readonly rowScope: SettingsRowScope;
};

export type ProjectDefaultsView = {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly rows: readonly ProjectDefaultsRowView[];
  readonly modelPicker: SettingsModelPickerControlView | null;
};

const IntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("reset"),
    key: Schema.Literals([
      "model",
      "permissions",
      "workspace",
      "submodules",
      "auto-pull",
      "merge-method",
      "browser-access",
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("select"),
    key: Schema.Literals(["permissions", "workspace", "submodules", "merge-method"]),
    value: Schema.Unknown,
  }),
  Schema.Struct({
    kind: Schema.Literal("toggle"),
    key: Schema.Literals(["auto-pull", "browser-access"]),
    checked: Schema.Boolean,
  }),
]);

const IntentParams = Schema.decodeUnknownSync(Schema.Struct({ intent: IntentSchema }));

type ProjectDefaultsDerived = {
  readonly changeContext: ProjectDefaultsChangeContext;
  readonly source: SettingsModelPickerSource | null;
  readonly view: (get: Atom.AtomContext) => ProjectDefaultsView;
};

export type ProjectDefaults = {
  readonly view: (get: Atom.AtomContext) => {
    readonly view: ProjectDefaultsView;
    readonly source: SettingsModelPickerSource | null;
  };
  readonly apply: (intent: ProjectDefaultsIntent) => Promise<void>;
  readonly binding: SectionPickerBinding;
  readonly changeAction: (params: unknown) => Promise<null>;
};

export function createProjectDefaults(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
  category: ProjectSettingsCategory,
): ProjectDefaults {
  const { registry } = context;

  const derive = (input: {
    readonly settings: UnifiedSettings;
    readonly scopeContext: SettingsScopeContextSnapshot;
    readonly environments: readonly EnvironmentPresentation[];
    readonly clientSettings: ClientSettings;
  }): ProjectDefaultsDerived => {
    const { settings, scopeContext, environments, clientSettings } = input;
    const { target, targets } = scopeContext;
    const representative = target
      ? (environments.find((candidate) => candidate.environmentId === target.environmentId) ?? null)
      : null;
    const picker = resolveProjectDefaultsModelPicker({
      providers: representative?.serverConfig?.providers ?? [],
      settings,
    });
    const changeContext: ProjectDefaultsChangeContext = {
      settings,
      entries: picker.entries,
      modelTargets: resolveProjectDefaultsModelTargets({ targets, environments }),
    };
    const { selection, activeEntry } = picker;
    const mixedModel = scopedSettingsAreMixed(targets, ["defaultModelSelection"]);
    const source: SettingsModelPickerSource | null =
      selection && activeEntry
        ? {
            contextInput: {
              activeInstanceId: selection.instanceId,
              model: selection.model,
              instanceEntries: picker.entries,
              modelOptionsByInstance: picker.modelOptions,
              lockedProvider: null,
              canOpenProviderSetup: representative !== null,
              favorites: clientSettings.favorites,
            },
            triggerLabel: mixedModel ? "Mixed" : null,
            disabledReason: (instanceId, modelSlug) =>
              resolveDefaultModelDisabledReason(changeContext, instanceId, modelSlug),
            traits: mixedModel
              ? null
              : {
                  provider: activeEntry.driverKind,
                  models: activeEntry.models,
                  model: selection.model,
                  modelOptions: selection.options ?? [],
                  planModeEnabled: settings.planModeEnabled,
                },
          }
        : null;
    return {
      changeContext,
      source,
      view: (get) => {
        const model = buildProjectDefaultsModel({
          category,
          scopeKind: scopeContext.scope.kind,
          connectedEnvironmentCount: scopeContext.connectedEnvironments.length,
          settings,
          targetSettings: target?.settings ?? null,
          targets,
          modelPicker: picker,
        });
        return {
          sectionId: model.sectionId,
          sectionTitle: model.sectionTitle,
          rows: model.rows.map((row) => ({
            ...row,
            rowScope: scope.rowScope(get, {
              serverScoped: true,
              settingKeys: row.settingKeys,
              mixed: row.mixed,
            }),
          })),
          modelPicker: source === null ? null : settingsModelPickerControl(source),
        };
      },
    };
  };

  const current = () =>
    derive({
      settings: registry.get(scope.scopedSettingsAtom),
      scopeContext: registry.get(scope.scopeContextAtom),
      environments: registry.get(scope.environmentsAtom),
      clientSettings: registry.get(context.clientSettingsAtom),
    });

  const apply = async (intent: ProjectDefaultsIntent) => {
    const change = resolveProjectDefaultsChange(intent, current().changeContext);
    if (change.kind === "rejected") {
      context.addToast({ layout: "plain", ...change.toast });
      return;
    }
    if (change.kind === "patch") await scope.updateScopedSettings(change.patch);
  };

  return {
    view: (get) => {
      const derived = derive({
        settings: get(scope.scopedSettingsAtom),
        scopeContext: get(scope.scopeContextAtom),
        environments: get(scope.environmentsAtom),
        clientSettings: get(context.clientSettingsAtom),
      });
      return { view: derived.view(get), source: derived.source };
    },
    apply,
    binding: {
      source: () => current().source,
      select: (instanceId, model) =>
        apply({ kind: "model", selection: createModelSelection(instanceId, model) }),
      traits: async (options) => {
        const source = current().source;
        if (source === null) return;
        await apply({
          kind: "model",
          selection: createModelSelection(
            source.contextInput.activeInstanceId,
            source.contextInput.model,
            options,
          ),
        });
      },
    },
    changeAction: async (params) => {
      await apply(IntentParams(params).intent);
      return null;
    },
  };
}
