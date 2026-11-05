import {
  buildRedactedSensitiveTextModel,
  type RedactedSensitiveTextModel,
} from "@t3tools/web/src/components/settings/RedactedSensitiveText.logic.ts";
import {
  runAtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceEnvironmentVariable,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import {
  buildAddProviderInstanceModel,
  resolveAddProviderConfigDraftChange,
  resolveAddProviderDriverMeta,
  resolveAddProviderInstanceBack,
  resolveAddProviderInstanceSubmit,
  resolveWizardNavigation,
  ADD_PROVIDER_WIZARD_STEPS,
  DEFAULT_ADD_PROVIDER_DRIVER,
  type AddProviderConfigDrafts,
  type AddProviderInstanceModel,
} from "@t3tools/web/src/components/settings/AddProviderInstanceDialog.logic.ts";
import {
  buildAddUsageLimitSourceDialogModel,
  EMPTY_ADD_USAGE_LIMIT_SOURCE_DRAFT,
  resolveAddUsageLimitSource,
  type AddUsageLimitSourceDialogModel,
  type AddUsageLimitSourceDraft,
} from "@t3tools/web/src/components/settings/AddUsageLimitSourceDialog.logic.ts";
import {
  buildCodexManagedRuntimeFieldsModel,
  type CodexManagedRuntimeFieldsModel,
} from "@t3tools/web/src/components/settings/CodexSetupSection.logic.ts";
import {
  buildCustomModelEditorModel,
  draftFromDefinition,
  resolveCustomModelEditorChange,
  resolveCustomModelEditorSubmit,
  type CustomModelDraft,
  type CustomModelEditorIntent,
  type CustomModelEditorModel,
} from "@t3tools/web/src/components/settings/customModelEditor.logic.ts";
import {
  buildExpandableTextModel,
  DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
  type ExpandableTextModel,
} from "@t3tools/web/src/components/settings/ExpandableText.logic.ts";
import {
  buildProviderAccentColorPickerModel,
  resolveProviderAccentChange,
  resolveProviderAccentHexInput,
  type ProviderAccentColorPickerModel,
} from "@t3tools/web/src/components/settings/ProviderAccentColorPicker.logic.ts";
import {
  buildProviderEnvironmentModel,
  buildProviderInstanceCardModel,
  makeProviderEnvironmentDraftRow,
  resolveProviderEnvironmentChange,
  resolveProviderInstanceCardAction,
  shouldResetProviderEnvironmentDrafts,
  type ProviderEnvironmentDraftRow,
  type ProviderEnvironmentModel,
  type ProviderInstanceCardAction,
  type ProviderInstanceCardIcon,
  type ProviderInstanceCardModel,
  type ProviderInstanceCardStatus,
  type ProviderInstanceCardVersionAdvisory,
} from "@t3tools/web/src/components/settings/ProviderInstanceCard.logic.ts";
import {
  buildProviderModelsSectionModel,
  resolveProviderModelsChange,
  type ProviderModelsIntent,
  type ProviderModelsSectionModel,
  type ProviderModelsState,
} from "@t3tools/web/src/components/settings/ProviderModelsSection.logic.ts";
import {
  buildProviderSettingsFormModel,
  resolveProviderSettingsFormChange,
  type ProviderSettingsFormChange,
  type ProviderSettingsFormFieldRow,
} from "@t3tools/web/src/components/settings/ProviderSettingsForm.logic.ts";
import {
  buildProviderSettingsModel,
  buildProviderUpdateFailureToast,
  resolveProviderSettingsChange,
  type ProviderHealthIntervalModel,
  type ProviderInstanceRowModel,
  type ProviderLastCheckedModel,
  type ProviderSettingsChange,
  type ProviderSettingsPlaceholderModel,
} from "@t3tools/web/src/components/settings/ProviderSettingsPanel.logic.ts";
import {
  buildProviderSetupModel,
  buildProviderSetupSectionModel,
  PROVIDER_SETUP_UNEXPECTED_FAILURE_MESSAGE,
  readAntigravityAuthMethod,
  resolveProviderSetupAction,
  resolveProviderSetupCallbackUrl,
  resolveProviderSetupFailureMessage,
  type ProviderSetupCallbackDraft,
  type ProviderSetupCommand,
  type ProviderSetupIntent,
  type ProviderSetupModel,
  type ProviderSetupSectionModel,
} from "@t3tools/web/src/components/settings/ProviderSetupSection.logic.ts";
import {
  getDriverMeta,
  type ProviderDriverIconKey,
} from "@t3tools/web/src/components/settings/providerDriverMeta.logic.ts";
import {
  buildUsageProviderSettingsModel,
  resolveUsageProviderSettingsChange,
  type UsageProviderHubRow,
  type UsageProviderSettingsModel,
} from "@t3tools/web/src/components/settings/UsageProviderSettings.logic.ts";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  type ProviderUpdateRun,
} from "@t3tools/web/src/components/ProviderUpdateLaunchNotification.logic.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import {
  planSettingsTargetUpdate,
  type UnifiedSettingsPatch,
} from "@t3tools/web/src/hooks/settingsTarget.logic.ts";
import { hexToHsv, hsvToHex, type HsvColor } from "@t3tools/web/src/lib/color.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import type { CustomModelDefinition } from "@t3tools/shared/model";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../../clipboard.ts";
import type { FeatureContext } from "../../feature.ts";
import { openExternal } from "../../openExternal.ts";
import { codexSetupSettingsCardsAtom, type CodexOnboardingCardInput } from "../codexSetup.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

export const providersDeepLinkTargetAtom = Atom.make<ProviderInstanceId | null>(null).pipe(
  Atom.keepAlive,
);

const SECTION = "providers";
const ACCENT_COMMIT_DELAY_MS = 120;
const RELATIVE_TIME_TICK_MS = 1_000;

export type ProviderListRowView = {
  readonly id: ProviderInstanceId;
  readonly displayName: string;
  readonly initials: string;
  readonly iconKey: ProviderDriverIconKey | null;
  readonly icon: ProviderInstanceCardIcon;
  readonly selected: boolean;
  readonly enabled: boolean;
  readonly selectAriaLabel: string;
  readonly versionLabel: string | null;
  readonly versionAdvisory: ProviderInstanceCardVersionAdvisory | null;
  readonly status: ProviderInstanceCardStatus;
  readonly enableSwitch: ProviderInstanceCardModel["enableSwitch"];
};

export type ProviderSetupView =
  | {
      readonly kind: "antigravity";
      readonly section: ProviderSetupSectionModel;
      readonly actions: ProviderSetupModel | null;
      readonly callbackRevision: number;
    }
  | { readonly kind: "codex"; readonly key: string };

export type ProviderRuntimeView =
  | { readonly kind: "codex-managed"; readonly rows: CodexManagedRuntimeFieldsModel["rows"] }
  | { readonly kind: "form"; readonly fields: ReadonlyArray<ProviderSettingsFormFieldRow> }
  | {
      readonly kind: "unknownDriver";
      readonly title: string;
      readonly descriptionPrefix: string;
      readonly driver: string;
      readonly descriptionSuffix: string;
    }
  | { readonly kind: "none" };

export type ProviderModelsView = ProviderModelsSectionModel & {
  readonly title: string;
  readonly description: string;
  readonly addRevision: number;
  readonly editor: (CustomModelEditorModel & { readonly slug: string }) | null;
};

export type ProviderEditorView = {
  readonly instanceId: ProviderInstanceId;
  readonly card: Omit<ProviderInstanceCardModel, "modelsSection" | "environment">;
  readonly initials: string;
  readonly iconKey: ProviderDriverIconKey | null;
  readonly resetLabel: string | null;
  readonly email: RedactedSensitiveTextModel | null;
  readonly accent: ProviderAccentColorPickerModel;
  readonly canRunVersionAction: boolean;
  readonly setup: ProviderSetupView | null;
  readonly runtime: ProviderRuntimeView;
  readonly environment: ProviderEnvironmentModel;
  readonly models: ProviderModelsView | null;
};

export type ProviderAccentPopoverView = {
  readonly target: string;
  readonly model: ProviderAccentColorPickerModel;
  readonly hsv: HsvColor;
  readonly hueColor: string;
  readonly hex: string;
};

export type ProviderAddInstanceView = AddProviderInstanceModel & {
  readonly revision: number;
  readonly configFields: ReadonlyArray<ProviderSettingsFormFieldRow>;
  readonly accentPicker: ProviderAccentColorPickerModel;
  readonly stepCount: number;
};

export type ProviderUsageView = UsageProviderSettingsModel & {
  readonly addDialog: (AddUsageLimitSourceDialogModel & { readonly revision: number }) | null;
  readonly removeConfirmation: UsageProviderHubRow | null;
};

export type ProviderUpdateAllView = {
  readonly label: string;
  readonly disabled: boolean;
  readonly tooltipLines: ReadonlyArray<string>;
};

export type SettingsProvidersView =
  | { readonly kind: "message"; readonly message: string }
  | {
      readonly kind: "placeholder";
      readonly placeholder: ProviderSettingsPlaceholderModel;
      readonly error: ExpandableTextModel | null;
    }
  | {
      readonly kind: "settings";
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly readOnly: boolean;
      readonly section: { readonly id: string; readonly title: string };
      readonly updateAll: ProviderUpdateAllView | null;
      readonly lastChecked: ProviderLastCheckedModel;
      readonly refreshAction: {
        readonly label: string;
        readonly disabled: boolean;
        readonly busy: boolean;
        readonly busyText: string | null;
      } | null;
      readonly addAction: { readonly label: string } | null;
      readonly readOnlyNotice: { readonly title: string; readonly description: string } | null;
      readonly rows: ReadonlyArray<ProviderListRowView>;
      readonly editor: ProviderEditorView | null;
      readonly emptyMessage: string | null;
      readonly usage: ProviderUsageView;
      readonly health: ProviderHealthIntervalModel;
      readonly addInstance: ProviderAddInstanceView | null;
      readonly accentPopover: ProviderAccentPopoverView | null;
    };

type EnvironmentDrafts = {
  readonly instanceId: ProviderInstanceId;
  readonly rows: ReadonlyArray<ProviderEnvironmentDraftRow>;
  readonly source: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly lastPublished: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined;
};

type ModelsUi = {
  readonly instanceId: ProviderInstanceId;
  readonly input: string;
  readonly isAdding: boolean;
  readonly filter: string;
  readonly error: string | null;
  readonly editingSlug: string | null;
  readonly draft: CustomModelDraft | null;
  readonly draftError: string | null;
  readonly addRevision: number;
};

type SetupUi = {
  readonly instanceId: ProviderInstanceId;
  readonly pendingLabel: string | null;
  readonly error: string | null;
  readonly callbackDraft: ProviderSetupCallbackDraft;
  readonly copiedFlowId: string | null;
  readonly callbackRevision: number;
};

type AccentTarget =
  | { readonly kind: "instance"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "add" };

type AccentUi = {
  readonly target: AccentTarget;
  readonly hsv: HsvColor;
  readonly hexDraft: string | null;
};

type AddInstanceUi = {
  readonly revision: number;
  readonly step: number;
  readonly driver: ProviderDriverKind;
  readonly label: string;
  readonly accentColor: string;
  readonly instanceIdOverride: string | null;
  readonly configByDriver: AddProviderConfigDrafts;
  readonly hasAttemptedSubmit: boolean;
};

type ProvidersUi = {
  readonly selectedInstanceId: ProviderInstanceId | null;
  readonly targetInstanceId: ProviderInstanceId | null;
  readonly refreshing: boolean;
  readonly updatingInstanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly updatingAll: boolean;
  readonly updatingCursor: boolean;
  readonly placeholderErrorExpanded: boolean;
  readonly emailRevealedFor: ProviderInstanceId | null;
  readonly accentPending: ReadonlyMap<ProviderInstanceId, string>;
  readonly accent: AccentUi | null;
  readonly environment: EnvironmentDrafts | null;
  readonly models: ModelsUi | null;
  readonly setup: SetupUi | null;
  readonly addInstance: AddInstanceUi | null;
  readonly addHub: { readonly revision: number; readonly draft: AddUsageLimitSourceDraft } | null;
  readonly removeHubId: string | null;
};

const INITIAL_UI: ProvidersUi = {
  selectedInstanceId: null,
  targetInstanceId: null,
  refreshing: false,
  updatingInstanceIds: [],
  updatingAll: false,
  updatingCursor: false,
  placeholderErrorExpanded: false,
  emailRevealedFor: null,
  accentPending: new Map(),
  accent: null,
  environment: null,
  models: null,
  setup: null,
  addInstance: null,
  addHub: null,
  removeHubId: null,
};

const InstanceIdSchema = ProviderInstanceId;

const FormChangeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("switch"), value: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("select"), value: Schema.String }),
]);

const CardActionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("setDisplayName"), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("setEnabled"), value: Schema.Boolean }),
  Schema.Struct({
    kind: Schema.Literal("setConfigField"),
    key: Schema.String,
    change: FormChangeSchema,
  }),
]);

const SlugIntent = <K extends string>(kind: K) =>
  Schema.Struct({ kind: Schema.Literal(kind), slug: Schema.String });
const KindIntent = <K extends string>(kind: K) => Schema.Struct({ kind: Schema.Literal(kind) });
const ValueIntent = <K extends string>(kind: K) =>
  Schema.Struct({ kind: Schema.Literal(kind), value: Schema.String });
const InstanceIntent = <K extends string>(kind: K) =>
  Schema.Struct({ kind: Schema.Literal(kind), instanceId: InstanceIdSchema });

const ChangeSchema = Schema.Union([
  InstanceIntent("select-instance"),
  InstanceIntent("enable-instance"),
  InstanceIntent("remove-instance"),
  InstanceIntent("reset-default-instance"),
  InstanceIntent("run-update"),
  InstanceIntent("install-recommended"),
  InstanceIntent("copy-update-command"),
  InstanceIntent("toggle-email"),
  Schema.Struct({
    kind: Schema.Literal("card"),
    instanceId: InstanceIdSchema,
    action: CardActionSchema,
  }),
  KindIntent("add-instance"),
  KindIntent("refresh"),
  KindIntent("reset-health-interval"),
  KindIntent("update-all"),
  KindIntent("toggle-placeholder-error"),
  Schema.Struct({
    kind: Schema.Literal("set-health-interval"),
    seconds: Schema.NullOr(Schema.Number),
  }),
]);
const ChangeParams = Schema.decodeUnknownSync(Schema.Struct({ change: ChangeSchema }));

const EnvironmentChangeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("add") }),
  Schema.Struct({ kind: Schema.Literal("setName"), id: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("setValue"), id: Schema.String, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("toggleSensitive"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("remove"), id: Schema.String }),
]);
const EnvironmentParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: InstanceIdSchema, change: EnvironmentChangeSchema }),
);

const ModelsIntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("set-hidden"),
    slug: Schema.String,
    hidden: Schema.Boolean,
  }),
  SlugIntent("toggle-favorite"),
  SlugIntent("remove-custom-model"),
  SlugIntent("toggle-edit"),
  Schema.Struct({
    kind: Schema.Literal("move"),
    slug: Schema.String,
    direction: Schema.Literals([-1, 1]),
  }),
  KindIntent("bulk-toggle-hidden"),
  KindIntent("start-add"),
  KindIntent("cancel-add"),
  KindIntent("submit-add"),
  ValueIntent("set-input"),
  ValueIntent("set-filter"),
]);
const ModelsParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: InstanceIdSchema, intent: ModelsIntentSchema }),
);

const NullableString = Schema.NullOr(Schema.String);
const EditorIntentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("set-name"), name: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("set-descriptor-id"),
    descriptorKey: Schema.String,
    id: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("set-descriptor-label"),
    descriptorKey: Schema.String,
    label: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("set-descriptor-type"),
    descriptorKey: Schema.String,
    value: NullableString,
  }),
  Schema.Struct({
    kind: Schema.Literal("select-descriptor-preset"),
    descriptorKey: Schema.String,
    value: NullableString,
  }),
  Schema.Struct({ kind: Schema.Literal("remove-descriptor"), descriptorKey: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("add-choice"), descriptorKey: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("add-preset-descriptor"), presetId: Schema.String }),
  KindIntent("add-custom-descriptor"),
  KindIntent("save"),
  KindIntent("cancel"),
  Schema.Struct({
    kind: Schema.Literal("set-choice-id"),
    descriptorKey: Schema.String,
    choiceKey: Schema.String,
    id: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("set-choice-label"),
    descriptorKey: Schema.String,
    choiceKey: Schema.String,
    label: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("set-choice-default"),
    descriptorKey: Schema.String,
    choiceKey: Schema.String,
    isDefault: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("remove-choice"),
    descriptorKey: Schema.String,
    choiceKey: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("copy-from-model"), slug: NullableString }),
]);
const EditorParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: InstanceIdSchema, intent: EditorIntentSchema }),
);

const SetupIntentSchema = Schema.Union([
  KindIntent("start-install"),
  KindIntent("cancel-install"),
  KindIntent("remove-runtime"),
  KindIntent("open-sign-in-page"),
  KindIntent("copy-sign-in-link"),
  KindIntent("submit-callback"),
  KindIntent("start-sign-in"),
  KindIntent("cancel-sign-in"),
  KindIntent("sign-out"),
  KindIntent("retry-status"),
  KindIntent("enable"),
  ValueIntent("callback-input"),
]);
const SetupParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: InstanceIdSchema, intent: SetupIntentSchema }),
);

const AccentIntentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["open", "close", "clear", "hex-blur"]) }),
  Schema.Struct({
    kind: Schema.Literal("hsv"),
    h: Schema.Number,
    s: Schema.Number,
    v: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal("hex"), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("swatch"), value: Schema.String }),
]);
const AccentParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.String, intent: AccentIntentSchema }),
);

const AddInstanceIntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(["close", "back", "next", "manual", "chatgpt", "submit"]),
  }),
  Schema.Struct({ kind: Schema.Literal("step"), step: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("driver"), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literals(["label", "instance-id"]), value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("config"), key: Schema.String, change: FormChangeSchema }),
]);
const AddInstanceParams = Schema.decodeUnknownSync(
  Schema.Struct({ intent: AddInstanceIntentSchema }),
);

const UsageIntentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("set-cursor"), enabled: Schema.Boolean }),
  Schema.Struct({
    kind: Schema.Literals(["open-add", "close-add", "save-add", "cancel-remove", "confirm-remove"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("add-field"),
    key: Schema.Literals(["label", "url", "managementKey"]),
    value: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("request-remove"), id: Schema.String }),
]);
const UsageParams = Schema.decodeUnknownSync(Schema.Struct({ intent: UsageIntentSchema }));

type ProvidersContext = {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly readOnly: boolean;
  readonly settings: UnifiedSettings;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly rows: ReadonlyArray<ProviderInstanceRowModel>;
  readonly selectedInstanceId: ProviderInstanceId | null;
};

function codexCardKey(environmentId: EnvironmentId, instanceId: ProviderInstanceId): string {
  return `settings:${environmentId}:${instanceId}`;
}

function formFieldsFor(row: ProviderInstanceRowModel): ReadonlyArray<ProviderSettingsFormFieldRow> {
  const meta = getDriverMeta(row.driver);
  if (meta === undefined) return [];
  return buildProviderSettingsFormModel({
    definition: meta,
    config: row.instance.config,
    idPrefix: `provider-instance-${row.id}`,
  }).fields;
}

function accentTargetKey(target: AccentTarget): string {
  return target.kind === "add" ? "add" : `instance:${target.instanceId}`;
}

export function createProviderSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const uiAtom = Atom.make<ProvidersUi>(INITIAL_UI).pipe(Atom.keepAlive);
  const nowAtom = Atom.make(Date.now()).pipe(Atom.keepAlive);
  let draftSequence = 0;
  let revisionSequence = 0;
  let refreshing = false;
  let updatingAll = false;
  const updatingInstanceIds = new Set<ProviderInstanceId>();
  const accentTimers = new Map<ProviderInstanceId, ReturnType<typeof setTimeout>>();
  let setupPending = false;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const patchUi = (update: (ui: ProvidersUi) => ProvidersUi) =>
    registry.set(uiAtom, update(registry.get(uiAtom)));

  registry.subscribe(
    scope.sectionAtom,
    (section) => {
      if (section === SECTION) {
        if (ticker === undefined) {
          registry.set(nowAtom, Date.now());
          ticker = setInterval(() => registry.set(nowAtom, Date.now()), RELATIVE_TIME_TICK_MS);
        }
        return;
      }
      if (ticker !== undefined) {
        clearInterval(ticker);
        ticker = undefined;
      }
      patchUi((ui) => (ui.targetInstanceId === null ? ui : { ...ui, targetInstanceId: null }));
    },
    { immediate: true },
  );

  registry.subscribe(
    providersDeepLinkTargetAtom,
    (instanceId) => {
      if (instanceId === null) return;
      patchUi((ui) => ({ ...ui, targetInstanceId: instanceId, selectedInstanceId: instanceId }));
      registry.set(providersDeepLinkTargetAtom, null);
    },
    { immediate: true },
  );

  const environmentAtom = Atom.make((get) => get(scope.scopeContextAtom).environment);

  const settingsFor = (get: Atom.AtomContext, environmentId: EnvironmentId): UnifiedSettings =>
    mergeEnvironmentSettings(
      get(state.serverEnvironment.settingsValueAtom(environmentId)) ?? DEFAULT_SERVER_SETTINGS,
      get(context.clientSettingsAtom),
    );

  const modelAtom = Atom.make((get) => {
    if (get(scope.sectionAtom) !== SECTION) return null;
    const environment = get(environmentAtom);
    if (environment === null) return null;
    const ui = get(uiAtom);
    const environmentId = environment.environmentId;
    const settings = settingsFor(get, environmentId);
    const serverProviders = get(state.serverEnvironment.providersValueAtom(environmentId)) ?? [];
    const session = get(state.environmentSession.sessionStateAtom(environmentId));
    return {
      settings,
      serverProviders,
      model: buildProviderSettingsModel({
        environments: get(scope.environmentsAtom),
        isReady: true,
        primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
        target: {
          environmentId,
          ...(ui.targetInstanceId === null ? {} : { instanceId: ui.targetInstanceId }),
          scoped: true,
        },
        selectedEnvironmentId: environmentId,
        isElectron: true,
        session: {
          data: Option.getOrNull(AsyncResult.value(session)),
          isPending: session.waiting,
          hasError: session._tag === "Failure",
        },
        settings,
        serverProviders,
        selectedInstanceId: ui.selectedInstanceId,
        isRefreshing: ui.refreshing,
        updatingInstanceIds: ui.updatingInstanceIds,
        updatingCursorUsage: ui.updatingCursor,
        addingUsageHub: ui.addHub !== null,
        nowMs: get(nowAtom),
      }),
    };
  });

  const currentContext = (): ProvidersContext | null => {
    const value = registry.get(modelAtom);
    if (value === null || value.model.content.kind !== "settings") return null;
    const content = value.model.content;
    return {
      environmentId: content.environmentId,
      environmentLabel: content.environmentLabel,
      readOnly: content.readOnly,
      settings: value.settings,
      serverProviders: value.serverProviders,
      rows: content.instances.rows,
      selectedInstanceId: content.instances.selectedInstanceId,
    };
  };

  const editorRowAtom = Atom.make((get) => {
    const value = get(modelAtom);
    if (value === null || value.model.content.kind !== "settings") return null;
    const content = value.model.content;
    const row = content.instances.rows.find(
      (candidate) => candidate.id === content.instances.selectedInstanceId,
    );
    return row === undefined
      ? null
      : { row, environmentId: content.environmentId, readOnly: content.readOnly };
  });

  registry.subscribe(
    Atom.make((get): ReadonlyArray<CodexOnboardingCardInput> => {
      const editor = get(editorRowAtom);
      if (editor === null || editor.row.setup !== "codex-managed") return [];
      const { row, environmentId, readOnly } = editor;
      return [
        {
          key: codexCardKey(environmentId, row.id),
          environmentId,
          instanceId: row.id,
          providerInstanceId: row.id,
          isDefault: row.isDefault,
          instance: row.instance,
          mode: "managed",
          enabled: row.enabled,
          autoStart: false,
          displayName: null,
          presentation: "settings",
          readOnly,
        },
      ];
    }),
    (cards) => registry.set(codexSetupSettingsCardsAtom, cards),
    { immediate: true },
  );

  registry.subscribe(
    Atom.make((get) => {
      const editor = get(editorRowAtom);
      return editor === null
        ? null
        : { instanceId: editor.row.id, environment: editor.row.instance.environment ?? [] };
    }),
    (current) => {
      if (current === null) return;
      const ui = registry.get(uiAtom);
      const drafts = ui.environment;
      if (drafts === null || drafts.instanceId !== current.instanceId) {
        patchUi((latest) => ({
          ...latest,
          environment: {
            instanceId: current.instanceId,
            rows: current.environment.map(makeProviderEnvironmentDraftRow),
            source: current.environment,
            lastPublished: undefined,
          },
        }));
        return;
      }
      if (drafts.source === current.environment) return;
      const reset = shouldResetProviderEnvironmentDrafts({
        previous: drafts.source,
        next: current.environment,
        lastPublished: drafts.lastPublished,
      });
      patchUi((latest) => ({
        ...latest,
        environment: {
          instanceId: current.instanceId,
          rows: reset ? current.environment.map(makeProviderEnvironmentDraftRow) : drafts.rows,
          source: current.environment,
          lastPublished: undefined,
        },
      }));
    },
    { immediate: true },
  );

  const showToast = (toast: {
    readonly layout: "plain" | "stacked";
    readonly type: "error" | "warning" | "success" | "info" | "loading";
    readonly title: string;
    readonly description?: string;
  }) => {
    context.addToast(toast);
  };

  const updateEnvironmentSettings = (environmentId: EnvironmentId, patch: UnifiedSettingsPatch) => {
    const plan = planSettingsTargetUpdate({
      environmentId,
      environments: registry.get(scope.environmentsAtom),
      patch,
    });
    for (const description of plan.unsavedWarnings) {
      showToast({ layout: "plain", type: "warning", title: "Setting not saved", description });
    }
    for (const write of plan.serverWrites) {
      void runAtomCommand(
        registry,
        state.serverEnvironment.updateSettings,
        { environmentId: write.environmentId, input: { patch: write.patch } },
        { label: "server settings update" },
      );
    }
    const clientPatch = plan.clientPatch;
    if (clientPatch !== null) {
      void context.updateClientSettings((current) => ({ ...current, ...clientPatch }));
    }
  };

  const refreshProviders = (environmentId: EnvironmentId) => {
    if (refreshing) return;
    refreshing = true;
    patchUi((ui) => ({ ...ui, refreshing: true }));
    void runAtomCommand(
      registry,
      state.serverEnvironment.refreshProviders,
      { environmentId, input: { refreshModels: true } },
      { reportFailure: false },
    ).then(() => {
      refreshing = false;
      patchUi((ui) => ({ ...ui, refreshing: false }));
    });
  };

  const runProviderUpdate = async (
    environmentId: EnvironmentId,
    candidate: {
      readonly driver: ProviderDriverKind;
      readonly instanceId: ProviderInstanceId;
      readonly targetVersion: string | null;
    },
  ) => {
    if (updatingInstanceIds.has(candidate.instanceId)) return;
    updatingInstanceIds.add(candidate.instanceId);
    patchUi((ui) => ({ ...ui, updatingInstanceIds: [...updatingInstanceIds] }));
    const result = await runAtomCommand(
      registry,
      state.serverEnvironment.updateProvider,
      {
        environmentId,
        input: {
          provider: candidate.driver,
          instanceId: candidate.instanceId,
          ...(candidate.targetVersion ? { targetVersion: candidate.targetVersion } : {}),
        },
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      showToast({
        layout: "stacked",
        type: "error",
        ...buildProviderUpdateFailureToast({
          driver: candidate.driver,
          errorMessage: error instanceof Error ? error.message : null,
        }),
      });
    }
    updatingInstanceIds.delete(candidate.instanceId);
    patchUi((ui) => ({ ...ui, updatingInstanceIds: [...updatingInstanceIds] }));
  };

  const updateAllMachinesAtom = Atom.make((get) =>
    get(scope.environmentsAtom).flatMap((environment) => {
      const providers = environment.serverConfig?.providers ?? [];
      if (environment.connection.phase !== "connected") return [];
      const candidates = collectProviderUpdateCandidates(providers).filter((candidate) =>
        canOneClickUpdateProviderCandidate(candidate, providers),
      );
      return candidates.length > 0
        ? [{ environmentId: environment.environmentId, label: environment.label, candidates }]
        : [];
    }),
  );

  const updateAll = async () => {
    if (updatingAll) return;
    updatingAll = true;
    patchUi((ui) => ({ ...ui, updatingAll: true }));
    try {
      const machines = registry.get(updateAllMachinesAtom);
      const runs = await Promise.all(
        machines.flatMap(({ environmentId, label, candidates }) =>
          candidates.map(async (candidate): Promise<ProviderUpdateRun> => ({
            machineLabel: label,
            driver: candidate.driver,
            instanceId: candidate.instanceId,
            result: await runAtomCommand(
              registry,
              state.serverEnvironment.updateProvider,
              {
                environmentId,
                input: { provider: candidate.driver, instanceId: candidate.instanceId },
              },
              { reportFailure: false },
            ),
          })),
        ),
      );
      const view = getProviderUpdateRunToastView(runs);
      if (view) {
        showToast({
          layout: "stacked",
          type: view.type,
          title: view.title,
          description: view.description,
        });
      }
    } finally {
      updatingAll = false;
      patchUi((ui) => ({ ...ui, updatingAll: false }));
    }
  };

  const applyChange = (current: ProvidersContext, change: ProviderSettingsChange) => {
    const decision = resolveProviderSettingsChange(
      {
        settings: current.settings,
        serverProviders: current.serverProviders,
        readOnly: current.readOnly,
        isRefreshing: refreshing,
        updatingInstanceIds: [...updatingInstanceIds],
      },
      change,
    );
    switch (decision.kind) {
      case "none":
        return;
      case "select-instance":
        patchUi((ui) => ({ ...ui, selectedInstanceId: decision.instanceId }));
        return;
      case "update-environment-settings":
        updateEnvironmentSettings(current.environmentId, decision.patch);
        return;
      case "update-client-settings": {
        const patch = decision.patch;
        void context.updateClientSettings((settings) => ({ ...settings, ...patch }));
        return;
      }
      case "open-add-instance-dialog":
        revisionSequence += 1;
        patchUi((ui) => ({
          ...ui,
          addInstance: {
            revision: revisionSequence,
            step: 0,
            driver: DEFAULT_ADD_PROVIDER_DRIVER,
            label: "",
            accentColor: "",
            instanceIdOverride: null,
            configByDriver: {},
            hasAttemptedSubmit: false,
          },
        }));
        return;
      case "refresh-providers":
        refreshProviders(current.environmentId);
        return;
      case "run-provider-update":
        void runProviderUpdate(current.environmentId, decision);
        return;
    }
  };

  const rowOf = (current: ProvidersContext, instanceId: ProviderInstanceId) =>
    current.rows.find((row) => row.id === instanceId) ?? null;

  const applyCardAction = (
    current: ProvidersContext,
    row: ProviderInstanceRowModel,
    action: ProviderInstanceCardAction,
  ) => {
    if (current.readOnly) return;
    applyChange(current, {
      kind: "update-instance",
      instanceId: row.id,
      next: resolveProviderInstanceCardAction(row.instance, action),
    });
  };

  const commitAccent = (instanceId: ProviderInstanceId, value: string) => {
    const timer = accentTimers.get(instanceId);
    clearTimeout(timer);
    patchUi((ui) => ({ ...ui, accentPending: new Map(ui.accentPending).set(instanceId, value) }));
    accentTimers.set(
      instanceId,
      setTimeout(() => {
        accentTimers.delete(instanceId);
        const pending = registry.get(uiAtom).accentPending.get(instanceId);
        patchUi((ui) => {
          const next = new Map(ui.accentPending);
          next.delete(instanceId);
          return { ...ui, accentPending: next };
        });
        if (pending === undefined) return;
        const latest = currentContext();
        if (latest === null) return;
        const row = rowOf(latest, instanceId);
        if (row !== null) applyCardAction(latest, row, { kind: "setAccentColor", value: pending });
      }, ACCENT_COMMIT_DELAY_MS),
    );
  };

  const accentValue = (ui: ProvidersUi, target: AccentTarget): string => {
    if (target.kind === "add") return ui.addInstance?.accentColor ?? "";
    const pending = ui.accentPending.get(target.instanceId);
    if (pending !== undefined) return pending;
    const current = currentContext();
    const row = current === null ? null : rowOf(current, target.instanceId);
    return row?.accentColor ?? "";
  };

  const commitAccentTarget = (target: AccentTarget, value: string) => {
    const normalized = resolveProviderAccentChange(value);
    if (target.kind === "add") {
      patchUi((ui) =>
        ui.addInstance === null
          ? ui
          : { ...ui, addInstance: { ...ui.addInstance, accentColor: normalized } },
      );
      return;
    }
    commitAccent(target.instanceId, normalized);
  };

  const parseAccentTarget = (raw: string): AccentTarget | null => {
    if (raw === "add") return { kind: "add" };
    if (!raw.startsWith("instance:")) return null;
    return { kind: "instance", instanceId: ProviderInstanceId.make(raw.slice("instance:".length)) };
  };

  const modelsStateFor = (
    current: ProvidersContext,
    row: ProviderInstanceRowModel,
  ): ProviderModelsState | null => {
    const card = buildProviderInstanceCardModel({
      instanceId: row.id,
      instance: row.instance,
      driverOption: getDriverMeta(row.driver),
      liveProvider: current.serverProviders.find((provider) => provider.instanceId === row.id),
      readOnly: current.readOnly,
      isUpdating: row.update.running,
      canDelete: row.canDelete,
      canRunUpdate: row.update.available,
      canInstallRecommended: row.canInstallRecommended,
    });
    if (card.modelsSection === null) return null;
    return {
      driverKind: card.driverKind,
      models: card.modelsSection.models,
      customModels: card.modelsSection.customModels,
      hiddenModels: row.hiddenModels,
      favoriteModels: row.favoriteModels,
      modelOrder: row.modelOrder,
    };
  };

  const modelsUiFor = (ui: ProvidersUi, instanceId: ProviderInstanceId): ModelsUi =>
    ui.models !== null && ui.models.instanceId === instanceId
      ? ui.models
      : {
          instanceId,
          input: "",
          isAdding: false,
          filter: "",
          error: null,
          editingSlug: null,
          draft: null,
          draftError: null,
          addRevision: 0,
        };

  const setModelsUi = (instanceId: ProviderInstanceId, update: (models: ModelsUi) => ModelsUi) =>
    patchUi((ui) => ({ ...ui, models: update(modelsUiFor(ui, instanceId)) }));

  const applyModelsPatch = (
    current: ProvidersContext,
    row: ProviderInstanceRowModel,
    patch: {
      readonly customModels?: ReadonlyArray<CustomModelDefinition>;
      readonly modelOrder?: ReadonlyArray<string>;
      readonly favoriteModels?: ReadonlyArray<string>;
      readonly hiddenModels?: ReadonlyArray<string>;
    },
  ) => {
    if (patch.customModels) {
      applyCardAction(current, row, { kind: "setCustomModels", customModels: patch.customModels });
    }
    if (patch.modelOrder) {
      applyChange(current, {
        kind: "set-model-order",
        instanceId: row.id,
        modelOrder: patch.modelOrder,
      });
    }
    if (patch.favoriteModels) {
      applyChange(current, {
        kind: "set-favorite-models",
        instanceId: row.id,
        models: patch.favoriteModels,
      });
    }
    if (patch.hiddenModels) {
      applyChange(current, {
        kind: "set-hidden-models",
        instanceId: row.id,
        hiddenModels: patch.hiddenModels,
      });
    }
  };

  const setupUiFor = (ui: ProvidersUi, instanceId: ProviderInstanceId): SetupUi =>
    ui.setup !== null && ui.setup.instanceId === instanceId
      ? ui.setup
      : {
          instanceId,
          pendingLabel: null,
          error: null,
          callbackDraft: { flowId: null, value: "" },
          copiedFlowId: null,
          callbackRevision: 0,
        };

  const setSetupUi = (instanceId: ProviderInstanceId, update: (setup: SetupUi) => SetupUi) =>
    patchUi((ui) => ({ ...ui, setup: update(setupUiFor(ui, instanceId)) }));

  const setupTarget = (environmentId: EnvironmentId, instanceId: ProviderInstanceId) => ({
    environmentId,
    input: { instanceId },
  });

  const setupQueries = (
    get: <A>(atom: Atom.Atom<A>) => A,
    environmentId: EnvironmentId,
    instanceId: ProviderInstanceId,
  ) => {
    const target = setupTarget(environmentId, instanceId);
    const auth = get(state.serverEnvironment.providerAuthState(target));
    const install = get(state.serverEnvironment.providerInstallState(target));
    return {
      auth: Option.getOrNull(AsyncResult.value(auth)),
      installation: Option.getOrNull(AsyncResult.value(install)),
      queryError:
        auth._tag === "Failure"
          ? formatEnvironmentQueryError(auth.cause)
          : install._tag === "Failure"
            ? formatEnvironmentQueryError(install.cause)
            : null,
    };
  };

  const runSetupCommand = async (
    environmentId: EnvironmentId,
    instanceId: ProviderInstanceId,
    label: string,
    command: ProviderSetupCommand,
  ): Promise<boolean> => {
    if (setupPending) return false;
    setupPending = true;
    setSetupUi(instanceId, (setup) => ({ ...setup, pendingLabel: label, error: null }));
    const target = setupTarget(environmentId, instanceId);
    const options = { reportFailure: false, reportDefect: false };
    try {
      const result = await (() => {
        switch (command.type) {
          case "start-install":
            return runAtomCommand(
              registry,
              state.serverEnvironment.startProviderInstall,
              target,
              options,
            );
          case "cancel-install":
            return runAtomCommand(
              registry,
              state.serverEnvironment.cancelProviderInstall,
              { environmentId, input: { instanceId, operationId: command.operationId } },
              options,
            );
          case "remove-install":
            return runAtomCommand(
              registry,
              state.serverEnvironment.removeProviderInstallation,
              target,
              options,
            );
          case "start-auth":
            return runAtomCommand(
              registry,
              state.serverEnvironment.startProviderAuth,
              target,
              options,
            );
          case "complete-auth":
            return runAtomCommand(
              registry,
              state.serverEnvironment.completeProviderAuth,
              {
                environmentId,
                input: { instanceId, flowId: command.flowId, callbackUrl: command.callbackUrl },
              },
              options,
            );
          case "cancel-auth":
            return runAtomCommand(
              registry,
              state.serverEnvironment.cancelProviderAuth,
              { environmentId, input: { instanceId, flowId: command.flowId } },
              options,
            );
          case "logout":
            return runAtomCommand(
              registry,
              state.serverEnvironment.logoutProviderAuth,
              target,
              options,
            );
        }
      })();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const message = resolveProviderSetupFailureMessage(squashAtomCommandFailure(result));
          setSetupUi(instanceId, (setup) => ({ ...setup, error: message }));
        }
        return false;
      }
      return true;
    } catch {
      setSetupUi(instanceId, (setup) => ({
        ...setup,
        error: PROVIDER_SETUP_UNEXPECTED_FAILURE_MESSAGE,
      }));
      return false;
    } finally {
      setupPending = false;
      setSetupUi(instanceId, (setup) => ({ ...setup, pendingLabel: null }));
    }
  };

  const performSetup = async (
    current: ProvidersContext,
    row: ProviderInstanceRowModel,
    intent: ProviderSetupIntent,
  ): Promise<boolean> => {
    const provider = current.serverProviders.find((candidate) => candidate.instanceId === row.id);
    if (provider === undefined) return false;
    const queries = setupQueries((atom) => registry.get(atom), current.environmentId, row.id);
    const setup = setupUiFor(registry.get(uiAtom), row.id);
    const decision = resolveProviderSetupAction(intent, {
      authMethod: readAntigravityAuthMethod(row.instance.config),
      providerDisplayName: provider.displayName,
      environmentLabel: current.environmentLabel,
      auth: queries.auth,
      installation: queries.installation,
      callbackUrl: resolveProviderSetupCallbackUrl(setup.callbackDraft, queries.auth),
    });
    switch (decision.kind) {
      case "none":
        return false;
      case "run":
        return runSetupCommand(current.environmentId, row.id, decision.label, decision.command);
      case "confirm-then-run": {
        const confirmed = await (requestConfirmDialog(decision.message) ??
          Promise.reject(new Error("Confirmations are not available in the native app yet.")));
        if (!confirmed) return false;
        return runSetupCommand(current.environmentId, row.id, decision.label, decision.command);
      }
      case "open-external":
        try {
          await openExternal(decision.url);
          setSetupUi(row.id, (latest) => ({ ...latest, error: null }));
          return true;
        } catch {
          setSetupUi(row.id, (latest) => ({ ...latest, error: decision.failureMessage }));
          return false;
        }
      case "copy":
        try {
          await clipboardService(context).writeText(decision.text);
          setSetupUi(row.id, (latest) => ({
            ...latest,
            copiedFlowId: decision.flowId,
            error: null,
          }));
          return true;
        } catch {
          setSetupUi(row.id, (latest) => ({ ...latest, error: decision.failureMessage }));
          return false;
        }
    }
  };

  const listRowView = (
    current: {
      readonly readOnly: boolean;
      readonly serverProviders: ReadonlyArray<ServerProvider>;
    },
    row: ProviderInstanceRowModel,
  ): ProviderListRowView => {
    const card = buildProviderInstanceCardModel({
      instanceId: row.id,
      instance: row.instance,
      driverOption: getDriverMeta(row.driver),
      liveProvider: current.serverProviders.find((provider) => provider.instanceId === row.id),
      readOnly: current.readOnly,
      isUpdating: false,
      canDelete: false,
      canRunUpdate: false,
      canInstallRecommended: false,
    });
    return {
      id: row.id,
      displayName: card.displayName,
      initials: providerInstanceInitials(card.displayName),
      iconKey: row.iconKey,
      icon: card.icon,
      selected: row.selected,
      enabled: card.enabled,
      selectAriaLabel: card.selectAriaLabel,
      versionLabel: card.versionLabel,
      versionAdvisory: card.versionAdvisory,
      status: card.status,
      enableSwitch: card.enableSwitch,
    };
  };

  const editorView = (
    get: Atom.AtomContext,
    current: {
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly readOnly: boolean;
      readonly serverProviders: ReadonlyArray<ServerProvider>;
    },
    row: ProviderInstanceRowModel,
    ui: ProvidersUi,
  ): ProviderEditorView => {
    const liveProvider = current.serverProviders.find((provider) => provider.instanceId === row.id);
    const card = buildProviderInstanceCardModel({
      instanceId: row.id,
      instance: row.instance,
      driverOption: getDriverMeta(row.driver),
      liveProvider,
      readOnly: current.readOnly,
      isUpdating: row.update.running,
      canDelete: row.canDelete,
      canRunUpdate: row.update.available,
      canInstallRecommended: row.canInstallRecommended,
    });
    const { modelsSection, environment: _environment, ...cardRest } = card;
    const authenticatedAs = card.status.authenticatedAs;
    const emailRevealed = ui.emailRevealedFor === row.id;
    const pendingAccent = ui.accentPending.get(row.id);
    const accent = buildProviderAccentColorPickerModel({
      displayName: card.displayName,
      value: pendingAccent ?? card.accentColor ?? undefined,
      description: undefined,
      layout: "inline",
    });
    const setupUi = setupUiFor(ui, row.id);
    const setup: ProviderSetupView | null =
      row.setup === "antigravity"
        ? (() => {
            const section = buildProviderSetupSectionModel({
              environmentLabel: current.environmentLabel,
              enabled: row.enabled,
              readOnly: current.readOnly,
              hasSetup: liveProvider?.setup !== undefined,
            });
            const queries = setupQueries(get, current.environmentId, row.id);
            return {
              kind: "antigravity",
              section,
              actions:
                section.body.kind === "actions" && liveProvider !== undefined
                  ? buildProviderSetupModel({
                      instanceId: row.id,
                      provider: liveProvider,
                      authMethod: readAntigravityAuthMethod(row.instance.config),
                      binaryPath: row.binaryPath,
                      enabled: row.enabled,
                      auth: queries.auth,
                      installation: queries.installation,
                      queryError: queries.queryError,
                      error: setupUi.error,
                      pendingLabel: setupUi.pendingLabel,
                      callbackDraft: setupUi.callbackDraft,
                      copiedFlowId: setupUi.copiedFlowId,
                    })
                  : null,
              callbackRevision: setupUi.callbackRevision,
            };
          })()
        : row.setup === "codex-managed"
          ? { kind: "codex", key: codexCardKey(current.environmentId, row.id) }
          : null;
    const runtime: ProviderRuntimeView =
      row.setup === "codex-managed"
        ? (() => {
            const install = get(
              state.serverEnvironment.providerInstallState(
                setupTarget(current.environmentId, row.id),
              ),
            );
            return {
              kind: "codex-managed",
              rows: buildCodexManagedRuntimeFieldsModel({
                executablePath:
                  Option.getOrNull(AsyncResult.value(install))?.executablePath ?? null,
                installationFailed: install._tag === "Failure",
                runtimePaths: liveProvider?.runtimePaths ?? null,
              }).rows,
            };
          })()
        : card.runtime.kind === "form"
          ? { kind: "form", fields: formFieldsFor(row) }
          : card.runtime;
    const drafts =
      ui.environment !== null && ui.environment.instanceId === row.id
        ? ui.environment.rows
        : (row.instance.environment ?? []).map(makeProviderEnvironmentDraftRow);
    const modelsUi = modelsUiFor(ui, row.id);
    const models: ProviderModelsView | null =
      modelsSection === null
        ? null
        : (() => {
            const sectionModel = buildProviderModelsSectionModel({
              driverKind: card.driverKind,
              models: modelsSection.models,
              customModels: modelsSection.customModels,
              hiddenModels: row.hiddenModels,
              favoriteModels: row.favoriteModels,
              modelOrder: row.modelOrder,
              instanceId: row.id,
              filter: modelsUi.filter,
              isAdding: modelsUi.isAdding,
              error: modelsUi.error,
              editingSlug: modelsUi.editingSlug,
            });
            const editing = sectionModel.rows.find((candidate) => candidate.editingEntry !== null);
            return {
              ...sectionModel,
              title: modelsSection.title,
              description: modelsSection.description,
              addRevision: modelsUi.addRevision,
              editor:
                editing === undefined || modelsUi.draft === null
                  ? null
                  : {
                      ...buildCustomModelEditorModel({
                        instanceId: row.id,
                        driverKind: card.driverKind,
                        builtInModels: modelsSection.models.filter((model) => !model.isCustom),
                        draft: modelsUi.draft,
                        error: modelsUi.draftError,
                      }),
                      slug: editing.slug,
                    },
            };
          })();
    return {
      instanceId: row.id,
      card: cardRest,
      initials: providerInstanceInitials(card.displayName),
      iconKey: row.iconKey,
      resetLabel: row.resetLabel,
      email:
        authenticatedAs === null
          ? null
          : buildRedactedSensitiveTextModel({
              value: authenticatedAs.email,
              revealed: ui.emailRevealedFor === row.id,
              ariaLabel: authenticatedAs.emailAriaLabel,
              revealTooltip: authenticatedAs.emailRevealTooltip,
              hideTooltip: authenticatedAs.emailHideTooltip,
            }),
      accent,
      canRunVersionAction:
        card.versionAdvisory?.action?.kind === "installRecommended"
          ? row.canInstallRecommended
          : card.versionAdvisory?.action?.kind === "runUpdate"
            ? row.update.available
            : false,
      setup,
      runtime,
      environment: buildProviderEnvironmentModel(drafts),
      models,
    };
  };

  const viewAtom = Atom.make((get): SettingsProvidersView | null => {
    if (get(scope.sectionAtom) !== SECTION) return null;
    const environment = get(environmentAtom);
    if (environment === null) {
      const scopeModel = get(scope.scopeContextAtom).scope;
      return {
        kind: "message",
        message:
          scopeModel.kind === "environment"
            ? `Reconnect ${scopeModel.label} to set up its providers.`
            : "Connect an environment to set up its providers.",
      };
    }
    const value = get(modelAtom);
    if (value === null) return null;
    const ui = get(uiAtom);
    const { content } = value.model;
    if (content.kind === "empty") return null;
    if (content.kind === "placeholder") {
      return {
        kind: "placeholder",
        placeholder: content.placeholder,
        error:
          content.placeholder.error === null
            ? null
            : buildExpandableTextModel({
                text: content.placeholder.error,
                expanded: ui.placeholderErrorExpanded,
                expandLabel: DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
              }),
      };
    }
    const { instances } = content;
    const current = {
      environmentId: content.environmentId,
      environmentLabel: content.environmentLabel,
      readOnly: content.readOnly,
      serverProviders: value.serverProviders,
    };
    const selectedRow =
      instances.rows.find((row) => row.id === instances.selectedInstanceId) ?? null;
    const machines = get(updateAllMachinesAtom);
    const addInstance = ui.addInstance;
    const addModel =
      addInstance === null
        ? null
        : buildAddProviderInstanceModel({
            environmentLabel: content.environmentLabel,
            wizardStep: addInstance.step,
            driver: addInstance.driver,
            label: addInstance.label,
            accentColor: addInstance.accentColor,
            instanceIdOverride: addInstance.instanceIdOverride,
            existingInstanceIds: Object.keys(value.settings.providerInstances ?? {}),
            configByDriver: addInstance.configByDriver,
            hasAttemptedSubmit: addInstance.hasAttemptedSubmit,
          });
    const accent = ui.accent;
    const accentSwatch = accent === null ? null : accentValue(ui, accent.target);
    const removeHub =
      ui.removeHubId === null
        ? null
        : (content.usage.hubs.find((hub) => hub.id === ui.removeHubId) ?? null);
    return {
      kind: "settings",
      environmentId: content.environmentId,
      environmentLabel: content.environmentLabel,
      readOnly: content.readOnly,
      section: instances.section,
      updateAll:
        machines.length === 0 && !ui.updatingAll
          ? null
          : {
              label: ui.updatingAll ? "Updating…" : "Update all",
              disabled: ui.updatingAll,
              tooltipLines: machines.map(
                (machine) =>
                  `${machine.label}: ${machine.candidates
                    .map(
                      (candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver,
                    )
                    .join(", ")}`,
              ),
            },
      lastChecked: content.lastChecked,
      refreshAction: instances.refreshAction,
      addAction: instances.addAction === null ? null : { label: instances.addAction.label },
      readOnlyNotice: instances.readOnlyNotice,
      rows: instances.rows.map((row) => listRowView(current, row)),
      editor: selectedRow === null ? null : editorView(get, current, selectedRow, ui),
      emptyMessage: instances.emptyMessage,
      usage: {
        ...content.usage,
        addDialog:
          ui.addHub === null || content.readOnly
            ? null
            : {
                ...buildAddUsageLimitSourceDialogModel({
                  environmentLabel: content.environmentLabel,
                  draft: ui.addHub.draft,
                }),
                revision: ui.addHub.revision,
              },
        removeConfirmation: removeHub,
      },
      health: instances.healthInterval,
      addInstance:
        addInstance === null || addModel === null
          ? null
          : {
              ...addModel,
              revision: addInstance.revision,
              stepCount: ADD_PROVIDER_WIZARD_STEPS.length,
              configFields: buildProviderSettingsFormModel({
                definition: resolveAddProviderDriverMeta(addModel.config.driver),
                config: addModel.config.value,
                idPrefix: addModel.config.idPrefix,
              }).fields,
              accentPicker: buildProviderAccentColorPickerModel({
                displayName: addModel.accentField.pickerDisplayName,
                value: addModel.accentField.value || undefined,
                description: undefined,
                layout: "inline",
              }),
            },
      accentPopover:
        accent === null || accentSwatch === null
          ? null
          : {
              target: accentTargetKey(accent.target),
              model: buildProviderAccentColorPickerModel({
                displayName: "",
                value: accentSwatch,
                description: undefined,
                layout: "inline",
              }),
              hsv: accent.hsv,
              hueColor: hsvToHex(accent.hsv.h, 1, 1),
              hex: accent.hexDraft ?? hsvToHex(accent.hsv.h, accent.hsv.s, accent.hsv.v),
            },
    };
  });

  const withContext = async (run: (current: ProvidersContext) => Promise<void> | void) => {
    const current = currentContext();
    if (current === null) return null;
    await run(current);
    return null;
  };

  const addInstanceNavigate = (requested: number) => {
    const ui = registry.get(uiAtom);
    const current = currentContext();
    const add = ui.addInstance;
    if (add === null || current === null) return;
    const model = buildAddProviderInstanceModel({
      environmentLabel: current.environmentLabel,
      wizardStep: add.step,
      driver: add.driver,
      label: add.label,
      accentColor: add.accentColor,
      instanceIdOverride: add.instanceIdOverride,
      existingInstanceIds: Object.keys(current.settings.providerInstances ?? {}),
      configByDriver: add.configByDriver,
      hasAttemptedSubmit: add.hasAttemptedSubmit,
    });
    const navigation = resolveWizardNavigation(
      add.step,
      requested,
      ADD_PROVIDER_WIZARD_STEPS.length,
      { instanceIdError: model.submit.disabledReason },
    );
    patchUi((latest) =>
      latest.addInstance === null
        ? latest
        : {
            ...latest,
            addInstance: {
              ...latest.addInstance,
              step: navigation.step,
              hasAttemptedSubmit:
                navigation.kind === "blocked" ? true : latest.addInstance.hasAttemptedSubmit,
            },
          },
    );
  };

  const setAddInstance = (update: (add: AddInstanceUi) => AddInstanceUi) =>
    patchUi((ui) =>
      ui.addInstance === null ? ui : { ...ui, addInstance: update(ui.addInstance) },
    );

  return {
    views: { settingsProviders: viewAtom },
    actions: {
      settingsProvidersMount: async () => {
        for (const timer of accentTimers.values()) clearTimeout(timer);
        accentTimers.clear();
        patchUi((ui) => ({
          ...INITIAL_UI,
          targetInstanceId: ui.targetInstanceId,
          selectedInstanceId: ui.targetInstanceId,
          refreshing: ui.refreshing,
          updatingInstanceIds: ui.updatingInstanceIds,
          updatingAll: ui.updatingAll,
        }));
        return null;
      },
      settingsProvidersChange: async (params) => {
        const { change } = ChangeParams(params);
        if (change.kind === "toggle-placeholder-error") {
          patchUi((ui) => ({ ...ui, placeholderErrorExpanded: !ui.placeholderErrorExpanded }));
          return null;
        }
        if (change.kind === "update-all") {
          await updateAll();
          return null;
        }
        return withContext(async (current) => {
          switch (change.kind) {
            case "select-instance":
            case "enable-instance":
            case "remove-instance":
            case "reset-default-instance":
            case "run-update":
            case "install-recommended":
              if (current.readOnly && change.kind !== "select-instance") return;
              applyChange(current, change);
              return;
            case "add-instance":
            case "refresh":
            case "reset-health-interval":
              if (current.readOnly && change.kind !== "refresh") return;
              applyChange(current, change);
              return;
            case "set-health-interval":
              if (current.readOnly) return;
              applyChange(current, change);
              return;
            case "toggle-email":
              patchUi((ui) => ({
                ...ui,
                emailRevealedFor:
                  ui.emailRevealedFor === change.instanceId ? null : change.instanceId,
              }));
              return;
            case "copy-update-command": {
              const row = rowOf(current, change.instanceId);
              if (row === null) return;
              const card = buildProviderInstanceCardModel({
                instanceId: row.id,
                instance: row.instance,
                driverOption: getDriverMeta(row.driver),
                liveProvider: current.serverProviders.find(
                  (provider) => provider.instanceId === row.id,
                ),
                readOnly: current.readOnly,
                isUpdating: false,
                canDelete: false,
                canRunUpdate: false,
                canInstallRecommended: false,
              });
              const command = card.versionAdvisory?.updateCommand;
              if (!command) return;
              const toast = card.updateCommandCopyToast;
              try {
                await clipboardService(context).writeText(command);
                showToast({
                  layout: "plain",
                  type: "success",
                  title: toast.successTitle,
                  description: toast.successDescription,
                });
              } catch (error) {
                showToast({
                  layout: "stacked",
                  type: "error",
                  title: toast.errorTitle,
                  description: error instanceof Error ? error.message : "An error occurred.",
                });
              }
              return;
            }
            case "card": {
              const row = rowOf(current, change.instanceId);
              if (row === null) return;
              const action = change.action;
              if (action.kind === "setConfigField") {
                const field = formFieldsFor(row).find((candidate) => candidate.key === action.key);
                if (field === undefined) return;
                const formChange: ProviderSettingsFormChange = action.change;
                applyCardAction(current, row, {
                  kind: "setConfig",
                  config: resolveProviderSettingsFormChange({
                    config: row.instance.config,
                    field,
                    change: formChange,
                  }),
                });
                return;
              }
              applyCardAction(current, row, action);
              return;
            }
          }
        });
      },
      settingsProvidersEnvironment: async (params) => {
        const { instanceId, change } = EnvironmentParams(params);
        return withContext((current) => {
          const row = rowOf(current, instanceId);
          if (row === null || current.readOnly) return;
          const ui = registry.get(uiAtom);
          const drafts =
            ui.environment !== null && ui.environment.instanceId === instanceId
              ? ui.environment
              : {
                  instanceId,
                  rows: (row.instance.environment ?? []).map(makeProviderEnvironmentDraftRow),
                  source: row.instance.environment ?? [],
                  lastPublished: undefined,
                };
          const result = resolveProviderEnvironmentChange(
            drafts.rows,
            change.kind === "add" ? { kind: "add", id: `provider-env-${draftSequence++}` } : change,
          );
          patchUi((latest) => ({
            ...latest,
            environment: {
              ...drafts,
              rows: result.rows,
              lastPublished: result.published ?? drafts.lastPublished,
            },
          }));
          if (result.published === null) return;
          applyCardAction(current, row, { kind: "setEnvironment", environment: result.published });
        });
      },
      settingsProvidersModels: async (params) => {
        const { instanceId, intent } = ModelsParams(params);
        return withContext((current) => {
          const row = rowOf(current, instanceId);
          if (row === null || current.readOnly) return;
          const modelsState = modelsStateFor(current, row);
          if (modelsState === null) return;
          const models = modelsUiFor(registry.get(uiAtom), instanceId);
          switch (intent.kind) {
            case "set-input":
              setModelsUi(instanceId, (latest) => ({
                ...latest,
                input: intent.value,
                error: null,
              }));
              return;
            case "set-filter":
              setModelsUi(instanceId, (latest) => ({ ...latest, filter: intent.value }));
              return;
            case "start-add":
              setModelsUi(instanceId, (latest) => ({ ...latest, isAdding: true }));
              return;
            case "cancel-add":
              setModelsUi(instanceId, (latest) => ({
                ...latest,
                input: "",
                error: null,
                isAdding: false,
                addRevision: latest.addRevision + 1,
              }));
              return;
            case "submit-add": {
              const decision = resolveProviderModelsChange(modelsState, {
                kind: "add-custom-model",
                input: models.input,
              });
              if (decision.kind === "none") return;
              if (decision.kind === "invalid") {
                setModelsUi(instanceId, (latest) => ({ ...latest, error: decision.error }));
                return;
              }
              setModelsUi(instanceId, (latest) => ({
                ...latest,
                filter: "",
                input: "",
                error: null,
                isAdding: false,
                addRevision: latest.addRevision + 1,
              }));
              if (decision.patch.customModels) {
                applyCardAction(current, row, {
                  kind: "setCustomModels",
                  customModels: decision.patch.customModels,
                });
              }
              return;
            }
            case "toggle-edit": {
              const editing = models.editingSlug === intent.slug ? null : intent.slug;
              const entry =
                editing === null
                  ? undefined
                  : modelsState.customModels.find((candidate) => candidate.slug === editing);
              setModelsUi(instanceId, (latest) => ({
                ...latest,
                editingSlug: entry === undefined ? null : editing,
                draft: entry === undefined ? null : draftFromDefinition(entry),
                draftError: null,
              }));
              return;
            }
            case "remove-custom-model": {
              if (models.editingSlug === intent.slug) {
                setModelsUi(instanceId, (latest) => ({
                  ...latest,
                  editingSlug: null,
                  draft: null,
                  draftError: null,
                }));
              }
              const decision = resolveProviderModelsChange(modelsState, intent);
              if (decision.kind === "apply") applyModelsPatch(current, row, decision.patch);
              setModelsUi(instanceId, (latest) => ({ ...latest, error: null }));
              return;
            }
            default: {
              const modelsIntent: ProviderModelsIntent = intent;
              const decision = resolveProviderModelsChange(modelsState, modelsIntent);
              if (decision.kind === "apply") applyModelsPatch(current, row, decision.patch);
              return;
            }
          }
        });
      },
      settingsProvidersModelEditor: async (params) => {
        const { instanceId, intent } = EditorParams(params);
        return withContext((current) => {
          const row = rowOf(current, instanceId);
          if (row === null || current.readOnly) return;
          const modelsState = modelsStateFor(current, row);
          const models = modelsUiFor(registry.get(uiAtom), instanceId);
          if (modelsState === null || models.draft === null) return;
          if (intent.kind === "cancel") {
            setModelsUi(instanceId, (latest) => ({
              ...latest,
              editingSlug: null,
              draft: null,
              draftError: null,
            }));
            return;
          }
          if (intent.kind === "save") {
            const submit = resolveCustomModelEditorSubmit(models.draft);
            if (submit.kind === "invalid") {
              setModelsUi(instanceId, (latest) => ({ ...latest, draftError: submit.error }));
              return;
            }
            const decision = resolveProviderModelsChange(modelsState, {
              kind: "save-custom-model",
              definition: submit.definition,
            });
            if (decision.kind === "apply") applyModelsPatch(current, row, decision.patch);
            setModelsUi(instanceId, (latest) => ({
              ...latest,
              editingSlug: null,
              draft: null,
              draftError: null,
            }));
            return;
          }
          const editorIntent: CustomModelEditorIntent = intent;
          const change = resolveCustomModelEditorChange(
            {
              driverKind: modelsState.driverKind,
              builtInModels: modelsState.models.filter((model) => !model.isCustom),
              draft: models.draft,
            },
            editorIntent,
          );
          if (change.kind === "none") return;
          setModelsUi(instanceId, (latest) => ({
            ...latest,
            draft: change.draft,
            draftError: change.clearError ? null : latest.draftError,
          }));
        });
      },
      settingsProvidersSetup: async (params) => {
        const { instanceId, intent } = SetupParams(params);
        return withContext(async (current) => {
          const row = rowOf(current, instanceId);
          if (row === null) return;
          switch (intent.kind) {
            case "enable":
              if (current.readOnly) return;
              applyChange(current, { kind: "enable-instance", instanceId });
              return;
            case "retry-status": {
              const target = setupTarget(current.environmentId, instanceId);
              registry.refresh(state.serverEnvironment.providerAuthState(target));
              registry.refresh(state.serverEnvironment.providerInstallState(target));
              return;
            }
            case "callback-input": {
              const auth = setupQueries(
                (atom) => registry.get(atom),
                current.environmentId,
                instanceId,
              ).auth;
              setSetupUi(instanceId, (setup) => ({
                ...setup,
                callbackDraft: { flowId: auth?.flowId ?? null, value: intent.value },
              }));
              return;
            }
            case "submit-callback":
              if (await performSetup(current, row, { kind: "submit-callback" })) {
                setSetupUi(instanceId, (setup) => ({
                  ...setup,
                  callbackDraft: { flowId: null, value: "" },
                  callbackRevision: setup.callbackRevision + 1,
                }));
              }
              return;
            default:
              await performSetup(current, row, intent);
              return;
          }
        });
      },
      settingsProvidersAccent: async (params) => {
        const { target: rawTarget, intent } = AccentParams(params);
        const target = parseAccentTarget(rawTarget);
        if (target === null) return null;
        const ui = registry.get(uiAtom);
        switch (intent.kind) {
          case "open": {
            const value = accentValue(ui, target);
            const model = buildProviderAccentColorPickerModel({
              displayName: "",
              value: value || undefined,
              description: undefined,
              layout: "inline",
            });
            patchUi((latest) => ({
              ...latest,
              accent: { target, hsv: hexToHsv(model.swatchColor), hexDraft: null },
            }));
            return null;
          }
          case "close":
            patchUi((latest) => ({ ...latest, accent: null }));
            return null;
          case "clear":
            commitAccentTarget(target, "");
            patchUi((latest) => ({ ...latest, accent: null }));
            return null;
          case "swatch":
            commitAccentTarget(target, intent.value);
            return null;
          case "hsv": {
            const hsv = {
              h: Math.min(360, Math.max(0, intent.h)),
              s: Math.min(1, Math.max(0, intent.s)),
              v: Math.min(1, Math.max(0, intent.v)),
            };
            patchUi((latest) =>
              latest.accent === null ? latest : { ...latest, accent: { ...latest.accent, hsv } },
            );
            commitAccentTarget(target, hsvToHex(hsv.h, hsv.s, hsv.v));
            return null;
          }
          case "hex": {
            const committed = resolveProviderAccentHexInput(intent.value);
            patchUi((latest) =>
              latest.accent === null
                ? latest
                : {
                    ...latest,
                    accent: {
                      ...latest.accent,
                      hexDraft: intent.value,
                      hsv: committed === null ? latest.accent.hsv : hexToHsv(committed),
                    },
                  },
            );
            if (committed !== null) commitAccentTarget(target, committed);
            return null;
          }
          case "hex-blur":
            patchUi((latest) =>
              latest.accent === null
                ? latest
                : { ...latest, accent: { ...latest.accent, hexDraft: null } },
            );
            return null;
        }
      },
      settingsProvidersAddInstance: async (params) => {
        const { intent } = AddInstanceParams(params);
        const ui = registry.get(uiAtom);
        const add = ui.addInstance;
        if (add === null) return null;
        switch (intent.kind) {
          case "close":
          case "chatgpt":
            patchUi((latest) => ({
              ...latest,
              addInstance: null,
              accent: latest.accent?.target.kind === "add" ? null : latest.accent,
            }));
            return null;
          case "back": {
            const back = resolveAddProviderInstanceBack(add.step);
            if (back.kind === "close") {
              patchUi((latest) => ({ ...latest, addInstance: null }));
              return null;
            }
            setAddInstance((latest) => ({ ...latest, step: back.step }));
            return null;
          }
          case "next":
            addInstanceNavigate(add.step + 1);
            return null;
          case "manual":
            addInstanceNavigate(1);
            return null;
          case "step":
            addInstanceNavigate(intent.step);
            return null;
          case "driver": {
            const driver = ProviderDriverKind.make(intent.value);
            if (getDriverMeta(driver) === undefined) return null;
            setAddInstance((latest) => ({ ...latest, driver }));
            return null;
          }
          case "label":
            setAddInstance((latest) => ({ ...latest, label: intent.value }));
            return null;
          case "instance-id":
            setAddInstance((latest) => ({ ...latest, instanceIdOverride: intent.value }));
            return null;
          case "config": {
            const definition = resolveAddProviderDriverMeta(add.driver);
            const config = add.configByDriver[add.driver] ?? {};
            const field = buildProviderSettingsFormModel({
              definition,
              config,
              idPrefix: `add-provider-${add.driver}`,
            }).fields.find((candidate) => candidate.key === intent.key);
            if (field === undefined) return null;
            const next = resolveProviderSettingsFormChange({
              config,
              field,
              change: intent.change,
            });
            setAddInstance((latest) => ({
              ...latest,
              configByDriver: resolveAddProviderConfigDraftChange(
                latest.configByDriver,
                latest.driver,
                next,
              ),
            }));
            return null;
          }
          case "submit": {
            const current = currentContext();
            if (current === null || current.readOnly) return null;
            setAddInstance((latest) => ({ ...latest, hasAttemptedSubmit: true }));
            const submit = resolveAddProviderInstanceSubmit({
              driver: add.driver,
              label: add.label,
              accentColor: add.accentColor,
              instanceIdOverride: add.instanceIdOverride,
              configByDriver: add.configByDriver,
              providerInstances: current.settings.providerInstances ?? {},
            });
            if (submit.kind === "invalid") return null;
            try {
              updateEnvironmentSettings(current.environmentId, {
                providerInstances: submit.providerInstances,
              });
              showToast({
                layout: "plain",
                type: "success",
                title: submit.successToast.title,
                description: submit.successToast.description,
              });
              patchUi((latest) => ({
                ...latest,
                addInstance: null,
                accent: latest.accent?.target.kind === "add" ? null : latest.accent,
              }));
            } catch (error) {
              showToast({
                layout: "plain",
                type: "error",
                title: submit.failureToast.title,
                description:
                  error instanceof Error ? error.message : submit.failureToast.fallbackDescription,
              });
            }
            return null;
          }
        }
      },
      settingsProvidersUsage: async (params) => {
        const { intent } = UsageParams(params);
        return withContext(async (current) => {
          switch (intent.kind) {
            case "set-cursor": {
              if (current.readOnly) return;
              const decision = resolveUsageProviderSettingsChange({
                kind: "set-cursor-keychain-usage",
                enabled: intent.enabled,
              });
              patchUi((ui) => ({ ...ui, updatingCursor: true }));
              try {
                const result = await runAtomCommand(
                  registry,
                  state.serverEnvironment.updateSettings,
                  { environmentId: current.environmentId, input: { patch: decision.patch } },
                  { label: "update Cursor account usage" },
                );
                if (result._tag === "Success") {
                  await runAtomCommand(
                    registry,
                    state.serverEnvironment.refreshProviders,
                    { environmentId: current.environmentId, input: {} },
                    { reportFailure: false },
                  );
                }
              } finally {
                patchUi((ui) => ({ ...ui, updatingCursor: false }));
              }
              return;
            }
            case "open-add":
              if (current.readOnly) return;
              revisionSequence += 1;
              patchUi((ui) => ({
                ...ui,
                addHub: { revision: revisionSequence, draft: EMPTY_ADD_USAGE_LIMIT_SOURCE_DRAFT },
              }));
              return;
            case "close-add":
              patchUi((ui) => ({ ...ui, addHub: null }));
              return;
            case "add-field":
              patchUi((ui) =>
                ui.addHub === null
                  ? ui
                  : {
                      ...ui,
                      addHub: {
                        ...ui.addHub,
                        draft: { ...ui.addHub.draft, [intent.key]: intent.value },
                      },
                    },
              );
              return;
            case "save-add": {
              const addHub = registry.get(uiAtom).addHub;
              if (addHub === null) return;
              const decision = resolveAddUsageLimitSource(addHub.draft);
              if (decision.kind === "invalid") return;
              updateEnvironmentSettings(current.environmentId, decision.patch);
              patchUi((ui) => ({ ...ui, addHub: null }));
              return;
            }
            case "request-remove":
              if (current.readOnly) return;
              patchUi((ui) => ({ ...ui, removeHubId: intent.id }));
              return;
            case "cancel-remove":
              patchUi((ui) => ({ ...ui, removeHubId: null }));
              return;
            case "confirm-remove": {
              const id = registry.get(uiAtom).removeHubId;
              patchUi((ui) => ({ ...ui, removeHubId: null }));
              if (id === null || current.readOnly) return;
              updateEnvironmentSettings(
                current.environmentId,
                resolveUsageProviderSettingsChange({ kind: "remove-hub", id }).patch,
              );
              return;
            }
          }
        });
      },
    },
  };
}
