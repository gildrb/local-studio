import {
  buildStorageSettingsModel,
  resolveRetentionCommit,
  resolveRetentionToggle,
  resolveStorageSettingsAction,
  type StorageRetentionControlModel,
  type StorageRuleRow,
  type StorageSettingsIntent,
  type StorageWorktreeModeRow,
} from "@t3tools/web/src/components/settings/StorageSettings.logic.ts";
import {
  buildSettingsScopeNoticeModel,
  type SettingsScopeNoticeChoice,
} from "@t3tools/web/src/components/settings/SettingsScopeNotice.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import type { SettingsRowScope, SettingsScopeRuntime, SettingsSection } from "./scope.ts";

export type StorageRuleRowView =
  | (Extract<StorageRuleRow, { control: "switch" }> & { readonly rowScope: SettingsRowScope })
  | (Extract<StorageRuleRow, { control: "retention" }> & {
      readonly rowScope: SettingsRowScope;
      readonly retention: StorageRetentionControlModel;
    });

export type StorageSectionView = {
  readonly id: string;
  readonly title: string;
  readonly modeRow: (StorageWorktreeModeRow & { readonly rowScope: SettingsRowScope }) | null;
  readonly rows: readonly StorageRuleRowView[];
};

export type StorageSettingsView =
  | {
      readonly kind: "notice";
      readonly message: string;
      readonly choices: readonly SettingsScopeNoticeChoice[];
    }
  | { readonly kind: "settings"; readonly sections: readonly StorageSectionView[] };

const RuleKey = Schema.Literals(["worktreeOnDelete", "worktreeOnMerge", "worktreeUnchanged"]);
const RetentionKey = Schema.Literals([
  "worktreeAfterDays",
  "browserArtifactsAfterDays",
  "logsAfterDays",
]);

const IntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("select-worktree-mode"),
    mode: Schema.NullOr(Schema.Literals(["inherit", "off", "custom"])),
  }),
  Schema.Struct({ kind: Schema.Literal("toggle-rule"), key: RuleKey, checked: Schema.Boolean }),
  Schema.Struct({
    kind: Schema.Literal("set-retention"),
    key: RetentionKey,
    days: Schema.NullOr(Schema.Number),
  }),
]);

const ChangeParams = Schema.decodeUnknownSync(Schema.Struct({ intent: IntentSchema }));
const RetentionCommitParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: RetentionKey, next: Schema.NullOr(Schema.Number), value: Schema.Number }),
);
const RetentionToggleParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: RetentionKey, enabled: Schema.Boolean }),
);

export function createStorageSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const viewAtom = Atom.make((get): StorageSettingsView | null => {
    if (get(scope.sectionAtom) !== "storage") return null;
    const scopeContext = get(scope.scopeContextAtom);
    const model = buildStorageSettingsModel({
      scopeKind: scopeContext.scope.kind,
      settings: get(scope.scopedSettingsAtom),
      target: scopeContext.target,
      targets: scopeContext.targets,
      connectedEnvironments: scopeContext.connectedEnvironments,
    });
    if (model.kind === "notice") {
      const notice = model.notice;
      const choices = buildSettingsScopeNoticeModel({
        message: notice.message,
        target: notice.target,
        eligibleEnvironmentIds:
          notice.target === "environment" ? notice.eligibleEnvironmentIds : null,
        search: scopeContext.search,
        groups: scopeContext.groups,
        environments: get(scope.environmentsAtom),
      }).choices;
      return { kind: "notice", message: notice.message, choices };
    }
    return {
      kind: "settings",
      sections: model.sections.map((section) => ({
        id: section.id,
        title: section.title,
        modeRow:
          section.modeRow === null
            ? null
            : {
                ...section.modeRow,
                rowScope: scope.rowScope(get, {
                  serverScoped: true,
                  settingKeys: section.modeRow.settingKeys,
                  mixed: section.modeRow.mixed,
                }),
              },
        rows: section.rows.map((row) => ({
          ...row,
          rowScope: scope.rowScope(get, { serverScoped: row.serverScoped, settingKeys: [] }),
        })),
      })),
    };
  });

  const dispatch = async (intent: StorageSettingsIntent) => {
    const action = resolveStorageSettingsAction({
      scopeKind: context.registry.get(scope.scopeContextAtom).scope.kind,
      intent,
    });
    if (action.kind === "clear") await scope.clearScopedSettings(action.keys);
    else if (action.kind === "update") await scope.updateScopedSettings(action.patch);
  };

  return {
    views: { settingsStorage: viewAtom },
    actions: {
      settingsStorageChange: async (params) => {
        await dispatch(ChangeParams(params).intent);
        return null;
      },
      settingsStorageRetentionCommit: async (params) => {
        const { key, next, value } = RetentionCommitParams(params);
        const decision = resolveRetentionCommit(next, value);
        if (decision.kind === "commit") {
          await dispatch({ kind: "set-retention", key, days: decision.days });
          return decision.days;
        }
        return decision.draft;
      },
      settingsStorageRetentionToggle: async (params) => {
        const { key, enabled } = RetentionToggleParams(params);
        await dispatch({ kind: "set-retention", key, days: resolveRetentionToggle(enabled) });
        return null;
      },
    },
  };
}
