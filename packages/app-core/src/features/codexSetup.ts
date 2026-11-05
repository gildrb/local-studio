import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  type ProviderAuthMethod,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  cancelCodexAuthCallback,
  receiveCodexAuthCallback,
} from "@t3tools/shared/codexAuthCallback";
import {
  buildAddCodexAccountModel,
  resolveAddCodexAccountCreate,
} from "@t3tools/web/src/components/settings/AddCodexAccountDialog.logic.ts";
import {
  buildChatGptAccountPickerModel,
  type ChatGptAccountOption,
} from "@t3tools/web/src/components/settings/ChatGptAccountPicker.logic.ts";
import {
  buildChatGptWelcomeModel,
  CHATGPT_USAGE_BUTTON,
  CHATGPT_WELCOME_STORAGE_KEY,
  parseAcknowledgedChatGptProfiles,
  resolveChatGptWelcomeDismiss,
} from "@t3tools/web/src/components/settings/ChatGptWelcomeCoordinator.logic.ts";
import {
  createCodexSetupFlow,
  type CodexHandoffRequest,
  type CodexSetupFlow,
  type CodexSetupFlowHost,
  type CodexSetupFlowSnapshot,
} from "@t3tools/web/src/components/settings/CodexSetupFlow.logic.ts";
import {
  buildCodexSetupModel,
  buildCodexSetupSectionModel,
  resolveCodexAuthReturnUrl,
  resolveCodexAuthRouting,
  resolveCodexEffectiveAuth,
  resolveCodexHandoffFailure,
  type CodexAwaitingProvider,
  type CodexCallbackDraft,
  type CodexCallbackModel,
  type CodexSetupDescription,
  type CodexSetupModel,
  type CodexSetupPresentation,
  type CodexSetupSectionModel,
} from "@t3tools/web/src/components/settings/CodexSetupSection.logic.ts";
import { buildRedactedSensitiveTextModel } from "@t3tools/web/src/components/settings/RedactedSensitiveText.logic.ts";
import { buildProviderInstanceUpdatePatch } from "@t3tools/web/src/components/settings/SettingsPanels.logic.ts";
import { resolveOnboardingCodexModeInstance } from "@t3tools/web/src/components/onboarding/WelcomeWizard.logic.ts";
import { randomUUID } from "@t3tools/web/src/lib/utils.ts";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";

export type CodexOnboardingCardInput = {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly isDefault: boolean;
  readonly instance: ProviderInstanceConfig;
  readonly mode: "managed" | "existing";
  readonly enabled: boolean;
  readonly autoStart: boolean;
  readonly displayName: string | null;
  readonly presentation?: CodexSetupPresentation;
  readonly readOnly?: boolean;
  readonly allowExistingCli?: boolean;
};

export const codexSetupSettingsCardsAtom = Atom.make<ReadonlyArray<CodexOnboardingCardInput>>(
  [],
).pipe(Atom.keepAlive);

export type CodexSetupHostDeps = {
  readonly onboardingCardsAtom: Atom.Atom<ReadonlyArray<CodexOnboardingCardInput>>;
  readonly onAccountCreated: (
    environmentId: EnvironmentId,
    instanceId: ProviderInstanceId,
    displayName: string,
  ) => void;
  readonly onAutoStartConsumed: (environmentId: EnvironmentId) => void;
};

type CodexSetupMode = "managed" | "existing";

export type CodexSetupCardIntent =
  | { readonly kind: "existing-connect"; readonly mode: CodexSetupMode }
  | { readonly kind: "change-mode"; readonly mode: CodexSetupMode }
  | { readonly kind: "connect" }
  | { readonly kind: "waiting-control" }
  | { readonly kind: "use-different-account" }
  | { readonly kind: "cancel" }
  | { readonly kind: "toggle-callback-help" }
  | { readonly kind: "submit-callback" }
  | { readonly kind: "browser-retry" }
  | { readonly kind: "toggle-email" }
  | { readonly kind: "change-account" }
  | { readonly kind: "disconnect" }
  | { readonly kind: "cancel-sign-in" }
  | { readonly kind: "cancel-install" };

export type CodexSetupButtonView = {
  readonly label: string;
  readonly disabled: boolean;
  readonly intent: CodexSetupCardIntent | null;
};

export type CodexSetupCardControlView =
  | { readonly kind: "ready"; readonly label: string }
  | { readonly kind: "status"; readonly label: string }
  | ({ readonly kind: "connect" } & CodexSetupButtonView)
  | ({ readonly kind: "button"; readonly emphasized: boolean } & CodexSetupButtonView);

export type CodexSetupHelpToggleView = {
  readonly expanded: boolean;
  readonly ariaLabel: string;
};

export type CodexSetupDescriptionView =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "signed-in";
      readonly prefix: string;
      readonly suffix: string;
      readonly email: {
        readonly text: string;
        readonly revealed: boolean;
        readonly tooltip: string;
        readonly ariaLabel: string;
      } | null;
    }
  | {
      readonly kind: "sign-in-help";
      readonly label: string;
      readonly toggle: CodexSetupHelpToggleView | null;
    };

export type CodexSetupCallbackView = {
  readonly flowId: string;
  readonly prompt: string;
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly maxLength: number;
  readonly inputDisabled: boolean;
  readonly submit: { readonly label: string; readonly disabled: boolean };
  readonly browserRetry: { readonly label: string } | null;
  readonly handoff: {
    readonly summary: string;
    readonly label: string;
    readonly href: string;
  } | null;
};

export type CodexSetupCardFooterView =
  | {
      readonly kind: "completion";
      readonly bordered: boolean;
      readonly callback: CodexSetupCallbackView;
    }
  | {
      readonly kind: "help";
      readonly label: string;
      readonly toggle: CodexSetupHelpToggleView | null;
      readonly content: CodexSetupCallbackView | null;
    };

export type CodexSetupCardView = {
  readonly key: string;
  readonly title: string;
  readonly description: CodexSetupDescriptionView;
  readonly control: CodexSetupCardControlView;
  readonly secondary: CodexSetupButtonView | null;
  readonly footer: CodexSetupCardFooterView | null;
  readonly setupError: string | null;
};

export type CodexSetupSettingsControlsView =
  | {
      readonly kind: "auth-active";
      readonly waiting: CodexSetupButtonView & { readonly emphasized: boolean };
      readonly cancel: CodexSetupButtonView | null;
    }
  | { readonly kind: "install-active"; readonly cancel: CodexSetupButtonView }
  | {
      readonly kind: "authenticated";
      readonly changeAccount: CodexSetupButtonView;
      readonly disconnect: CodexSetupButtonView;
    }
  | {
      readonly kind: "connect";
      readonly connect: CodexSetupButtonView;
      readonly differentAccount: CodexSetupButtonView | null;
    };

export type CodexSetupSettingsView =
  | {
      readonly kind: "preparing";
      readonly key: string;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly kind: "managed";
      readonly key: string;
      readonly title: string;
      readonly description: CodexSetupDescriptionView;
      readonly controls: CodexSetupSettingsControlsView;
      readonly usageLabel: string | null;
      readonly logoutWarning: string | null;
      readonly fallback: CodexSetupCardFooterView | null;
      readonly error: string | null;
    };

export type CodexSetupAddAccountView = {
  readonly revision: number;
  readonly title: string;
  readonly description: string;
  readonly form: {
    readonly title: string;
    readonly description: string;
    readonly inputLabel: string;
    readonly placeholder: string;
    readonly value: string;
    readonly disabled: boolean;
  } | null;
  readonly preparing: { readonly title: string; readonly description: string } | null;
  readonly setupKey: string | null;
  readonly cancel: { readonly label: string; readonly disabled: boolean } | null;
  readonly submit: { readonly label: string; readonly disabled: boolean } | null;
  readonly finishLater: { readonly label: string } | null;
};

export type CodexSetupAccountPickerView = {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly groupLabel: string;
  readonly selectedMethodId: string;
  readonly options: ReadonlyArray<ChatGptAccountOption>;
  readonly confirmLabel: string;
};

export type CodexSetupWelcomeView = {
  readonly title: string;
  readonly description: string;
  readonly detail: string;
  readonly usageLabel: string;
  readonly continueLabel: string;
};

export type CodexSetupDialogsView = {
  readonly addAccount: CodexSetupAddAccountView | null;
  readonly accountPicker: CodexSetupAccountPickerView | null;
  readonly welcome: CodexSetupWelcomeView | null;
};

type ManagedUi = {
  readonly pending: boolean;
  readonly error: string | null;
  readonly awaitingProvider: CodexAwaitingProvider | null;
  readonly handoff: CodexHandoffRequest | null;
  readonly transferFailed: boolean;
  readonly requestedMethodId: string;
  readonly callbackDraft: CodexCallbackDraft;
  readonly callbackHelpOpen: boolean;
  readonly accountPickerOpen: boolean;
  readonly pickerSelection: string | null;
  readonly autoStartHandled: boolean;
};

type CardUi = {
  readonly requested: boolean;
  readonly emailRevealed: boolean;
};

type AddAccountUi = {
  readonly environmentId: EnvironmentId;
  readonly revision: number;
  readonly name: string;
  readonly pending: boolean;
  readonly mode: "onboarding" | "settings";
  readonly instanceId: ProviderInstanceId | null;
};

type CardSection = {
  readonly card: CodexOnboardingCardInput;
  readonly section: CodexSetupSectionModel;
};

type SessionSnapshot = {
  readonly flow: CodexSetupFlowSnapshot;
  readonly model: CodexSetupModel;
  readonly ui: ManagedUi;
  readonly methods: ReadonlyArray<ProviderAuthMethod>;
  readonly handoffFailure: string | null;
};

type ManagedSession = {
  readonly snapshotAtom: Atom.Atom<SessionSnapshot>;
  readonly flow: CodexSetupFlow;
  readonly dispose: () => void;
};

const NATIVE_HREF = "local-studio://app/welcome";
const NATIVE_SETTINGS_HREF = "local-studio://app/settings/providers";
const ADD_ACCOUNT_KEY_PREFIX = "add-account:";
const NATIVE_LOCATION_HOSTNAME = "app";
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const COMMAND_OPTIONS = { reportFailure: false, reportDefect: false };
const INITIAL_MANAGED_UI: ManagedUi = {
  pending: false,
  error: null,
  awaitingProvider: null,
  handoff: null,
  transferFailed: false,
  requestedMethodId: "chatgpt",
  callbackDraft: { flowId: "", value: "" },
  callbackHelpOpen: false,
  accountPickerOpen: false,
  pickerSelection: null,
  autoStartHandled: false,
};
const INITIAL_CARD_UI: CardUi = { requested: false, emailRevealed: false };
const INITIAL_ACCOUNT_NAME = "Personal";

const Mode = Schema.Literals(["managed", "existing"]);
const CardIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["existing-connect", "change-mode"]), mode: Mode }),
  Schema.Struct({
    kind: Schema.Literals([
      "connect",
      "waiting-control",
      "use-different-account",
      "cancel",
      "toggle-callback-help",
      "submit-callback",
      "browser-retry",
      "toggle-email",
      "change-account",
      "disconnect",
      "cancel-sign-in",
      "cancel-install",
    ]),
  }),
]);
const CardActParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, intent: CardIntent }),
);
const KeyValueParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, value: Schema.String }),
);
const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const EnvironmentParams = Schema.decodeUnknownSync(Schema.Struct({ environmentId: EnvironmentId }));
const AddAccountOpenParams = Schema.decodeUnknownSync(
  Schema.Struct({
    environmentId: EnvironmentId,
    mode: Schema.optional(Schema.Literals(["onboarding", "settings"])),
  }),
);

function sameDeps(previous: ReadonlyArray<unknown> | null, next: ReadonlyArray<unknown>) {
  return (
    previous !== null &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  );
}

function helpToggle(
  toggle: { readonly ariaLabel: string; readonly expanded: boolean } | null,
): CodexSetupHelpToggleView | null {
  return toggle === null ? null : { expanded: toggle.expanded, ariaLabel: toggle.ariaLabel };
}

function describe(
  description: CodexSetupDescription,
  emailRevealed: boolean,
  toggleable: boolean,
): CodexSetupDescriptionView {
  switch (description.kind) {
    case "text":
      return { kind: "text", text: description.text };
    case "signed-in": {
      const email = buildRedactedSensitiveTextModel({
        value: description.email,
        revealed: emailRevealed,
        ariaLabel: description.ariaLabel,
        revealTooltip: description.revealTooltip,
        hideTooltip: description.hideTooltip,
      });
      return {
        kind: "signed-in",
        prefix: description.prefix,
        suffix: description.suffix,
        email:
          email === null
            ? null
            : {
                text: email.text,
                revealed: email.revealed,
                tooltip: email.tooltip,
                ariaLabel: email.ariaLabel,
              },
      };
    }
    case "sign-in-help":
      return {
        kind: "sign-in-help",
        label: description.label,
        toggle: toggleable ? helpToggle(description.toggle) : null,
      };
  }
}

function callbackView(callback: CodexCallbackModel, flowId: string): CodexSetupCallbackView {
  return {
    flowId,
    prompt: callback.prompt,
    inputLabel: callback.inputLabel,
    placeholder: callback.placeholder,
    value: callback.value,
    maxLength: callback.maxLength,
    inputDisabled: callback.inputDisabled,
    submit: { label: callback.submit.label, disabled: callback.submit.disabled },
    browserRetry: callback.browserRetry === null ? null : { label: callback.browserRetry.label },
    handoff: callback.handoff,
  };
}

function managedCardView(
  key: string,
  snapshot: SessionSnapshot,
  cardUi: CardUi,
): CodexSetupCardView {
  const { model } = snapshot;
  const { onboarding } = model;
  const control = onboarding.control;
  const secondary = onboarding.secondary;
  const callback =
    model.callback === null ? null : callbackView(model.callback, model.state.flowId ?? "");
  const fallback = model.callbackFallback;
  const footer: CodexSetupCardFooterView | null =
    onboarding.footer === "callback-fallback"
      ? fallback?.kind === "inline" && callback !== null
        ? { kind: "completion", bordered: false, callback }
        : fallback?.kind === "help"
          ? {
              kind: "help",
              label: fallback.description.label,
              toggle: helpToggle(fallback.description.toggle),
              content: model.callbackHelpVisible ? callback : null,
            }
          : null
      : model.callbackHelpVisible && callback !== null
        ? { kind: "completion", bordered: true, callback }
        : null;
  return {
    key,
    title: onboarding.title,
    description: describe(onboarding.description, cardUi.emailRevealed, true),
    control:
      control.kind === "waiting"
        ? {
            kind: "button",
            label: model.waitingControl.label,
            disabled: model.waitingControl.disabled,
            emphasized: model.waitingControl.emphasized,
            intent: { kind: "waiting-control" },
          }
        : control.kind === "connect"
          ? {
              kind: "connect",
              label: control.label,
              disabled: control.disabled,
              intent: { kind: "connect" },
            }
          : { kind: control.kind, label: control.label },
    secondary:
      secondary === null
        ? null
        : {
            label: secondary.label,
            disabled: secondary.disabled,
            intent:
              secondary.kind === "cancel"
                ? { kind: "cancel" }
                : secondary.kind === "use-different-account"
                  ? { kind: "use-different-account" }
                  : { kind: "change-mode", mode: secondary.mode },
          },
    footer,
    setupError: onboarding.setupError,
  };
}

function sectionCardView(
  key: string,
  section: CodexSetupSectionModel,
  cardUi: CardUi,
): CodexSetupCardView | null {
  switch (section.kind) {
    case "existing-card": {
      const control = section.control;
      return {
        key,
        title: section.title,
        description: describe(section.description, cardUi.emailRevealed, false),
        control:
          control.kind === "connect"
            ? {
                kind: "connect",
                label: control.label,
                disabled: control.disabled,
                intent: { kind: "existing-connect", mode: control.mode },
              }
            : { kind: control.kind, label: control.label },
        secondary:
          section.secondary === null
            ? null
            : {
                label: section.secondary.label,
                disabled: false,
                intent: { kind: "change-mode", mode: section.secondary.mode },
              },
        footer: null,
        setupError: null,
      };
    }
    case "preparing-card":
      return {
        key,
        title: section.title,
        description: describe(section.description, cardUi.emailRevealed, false),
        control: {
          kind: "button",
          label: section.controlLabel,
          disabled: true,
          emphasized: false,
          intent: null,
        },
        secondary: { label: section.secondaryLabel, disabled: true, intent: null },
        footer: null,
        setupError: null,
      };
    case "none":
    case "preparing-row":
    case "managed":
      return null;
  }
}

function settingsButton(
  button: { readonly label: string; readonly disabled: boolean },
  intent: CodexSetupCardIntent,
): CodexSetupButtonView {
  return { label: button.label, disabled: button.disabled, intent };
}

function managedSettingsView(
  key: string,
  snapshot: SessionSnapshot,
  cardUi: CardUi,
): CodexSetupSettingsView {
  const { model } = snapshot;
  const controls = model.settings.controls;
  const callback =
    model.callback === null ? null : callbackView(model.callback, model.state.flowId ?? "");
  const fallback = model.callbackFallback;
  const footer: CodexSetupCardFooterView | null =
    fallback?.kind === "inline" && callback !== null
      ? { kind: "completion", bordered: false, callback }
      : fallback?.kind === "help"
        ? {
            kind: "help",
            label: fallback.description.label,
            toggle: helpToggle(fallback.description.toggle),
            content: model.callbackHelpVisible ? callback : null,
          }
        : null;
  const errorAlert = model.settings.errorAlert;
  return {
    kind: "managed",
    key,
    title: model.settings.title,
    description: describe(model.accountDescription, cardUi.emailRevealed, false),
    controls:
      controls.kind === "auth-active"
        ? {
            kind: "auth-active",
            waiting: {
              ...settingsButton(model.waitingControl, { kind: "waiting-control" }),
              emphasized: model.waitingControl.emphasized,
            },
            cancel:
              controls.cancel === null
                ? null
                : settingsButton(controls.cancel, { kind: "cancel-sign-in" }),
          }
        : controls.kind === "install-active"
          ? {
              kind: "install-active",
              cancel: settingsButton(controls.cancel, { kind: "cancel-install" }),
            }
          : controls.kind === "authenticated"
            ? {
                kind: "authenticated",
                changeAccount: settingsButton(controls.changeAccount, { kind: "change-account" }),
                disconnect: settingsButton(controls.disconnect, { kind: "disconnect" }),
              }
            : {
                kind: "connect",
                connect: settingsButton(controls.connect, { kind: "connect" }),
                differentAccount:
                  controls.differentAccount === null
                    ? null
                    : settingsButton(controls.differentAccount, {
                        kind: "use-different-account",
                      }),
              },
    usageLabel: model.settings.showUsage ? CHATGPT_USAGE_BUTTON.label : null,
    logoutWarning: model.logoutWarning,
    fallback: footer,
    error: errorAlert === null ? null : (errorAlert.message ?? ""),
  };
}

function readAcknowledged(storage: Storage): readonly string[] {
  try {
    return parseAcknowledgedChatGptProfiles(storage.getItem(CHATGPT_WELCOME_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function createCodexSetupHost(
  context: FeatureContext,
  deps: CodexSetupHostDeps,
): CoreFeature {
  const { registry, state, storage } = context;
  const managedUiAtom = Atom.make<ReadonlyMap<string, ManagedUi>>(new Map()).pipe(Atom.keepAlive);
  const cardUiAtom = Atom.make<ReadonlyMap<string, CardUi>>(new Map()).pipe(Atom.keepAlive);
  const sessionsAtom = Atom.make<ReadonlyMap<string, ManagedSession>>(new Map()).pipe(
    Atom.keepAlive,
  );
  const addAccountAtom = Atom.make<AddAccountUi | null>(null).pipe(Atom.keepAlive);
  const acknowledgedAtom = Atom.make<readonly string[]>(readAcknowledged(storage)).pipe(
    Atom.keepAlive,
  );
  let sessionSequence = 0;
  let addAccountRevision = 0;

  const providerOf = (
    get: Atom.AtomContext,
    card: CodexOnboardingCardInput,
  ): ServerProvider | undefined =>
    get(state.serverEnvironment.providersValueAtom(card.environmentId))?.find(
      (provider) => provider.instanceId === card.providerInstanceId,
    );

  const addAccountCardsAtom = Atom.make((get): ReadonlyArray<CodexOnboardingCardInput> => {
    const add = get(addAccountAtom);
    if (add === null || add.mode !== "settings" || add.instanceId === null) return [];
    const instance = (
      get(state.serverEnvironment.settingsValueAtom(add.environmentId)) ?? DEFAULT_SERVER_SETTINGS
    ).providerInstances?.[add.instanceId];
    if (instance === undefined) return [];
    return [
      {
        key: `${ADD_ACCOUNT_KEY_PREFIX}${add.instanceId}`,
        environmentId: add.environmentId,
        instanceId: add.instanceId,
        providerInstanceId: add.instanceId,
        isDefault: false,
        instance,
        mode: "managed",
        enabled: true,
        autoStart: true,
        displayName: instance.displayName ?? null,
        presentation: "settings",
        readOnly: false,
        allowExistingCli: false,
      },
    ];
  });

  const cardsAtom = Atom.make((get): ReadonlyArray<CodexOnboardingCardInput> => [
    ...get(deps.onboardingCardsAtom),
    ...get(codexSetupSettingsCardsAtom),
    ...get(addAccountCardsAtom),
  ]);

  const sectionsAtom = Atom.make((get): ReadonlyArray<CardSection> =>
    get(cardsAtom).map((card) => ({
      card,
      section: buildCodexSetupSectionModel({
        mode: card.mode,
        presentation: card.presentation ?? "onboarding",
        displayName: card.displayName ?? undefined,
        provider: providerOf(get, card),
        enabled: card.enabled,
        readOnly: card.readOnly ?? false,
      }),
    })),
  );

  const updateManagedUi = (key: string, update: (ui: ManagedUi) => ManagedUi) => {
    const current = registry.get(managedUiAtom);
    const ui = current.get(key);
    if (ui === undefined) return;
    registry.set(managedUiAtom, new Map(current).set(key, update(ui)));
  };

  const updateCardUi = (key: string, update: (ui: CardUi) => CardUi) => {
    const current = registry.get(cardUiAtom);
    registry.set(
      cardUiAtom,
      new Map(current).set(key, update(current.get(key) ?? INITIAL_CARD_UI)),
    );
  };

  const changeMode = (card: CodexOnboardingCardInput, setupMode: CodexSetupMode) => {
    const settings = registry.get(
      state.serverEnvironment.configValueAtom(card.environmentId),
    )?.settings;
    if (settings === undefined) return;
    void runAtomCommand(
      registry,
      state.serverEnvironment.updateSettings,
      {
        environmentId: card.environmentId,
        input: {
          patch: buildProviderInstanceUpdatePatch({
            settings,
            instanceId: card.instanceId,
            driver: CODEX_DRIVER,
            isDefault: card.isDefault,
            instance: resolveOnboardingCodexModeInstance(card.instance, setupMode),
          }),
        },
      },
      { label: "Codex setup settings" },
    );
  };

  const createSession = (initialCard: CodexOnboardingCardInput): ManagedSession => {
    const { key, environmentId, instanceId } = initialCard;
    let card = initialCard;
    registry.set(managedUiAtom, new Map(registry.get(managedUiAtom)).set(key, INITIAL_MANAGED_UI));
    const target = { environmentId, input: { instanceId } };
    const snapshotAtom = Atom.make((get): SessionSnapshot => {
      card = get(cardsAtom).find((candidate) => candidate.key === key) ?? card;
      const presentation = card.presentation ?? "onboarding";
      const href = presentation === "onboarding" ? NATIVE_HREF : NATIVE_SETTINGS_HREF;
      const ui = get(managedUiAtom).get(key) ?? INITIAL_MANAGED_UI;
      const cardUi = get(cardUiAtom).get(key) ?? INITIAL_CARD_UI;
      const authResult = get(state.serverEnvironment.providerAuthState(target));
      const installResult = get(state.serverEnvironment.providerInstallState(target));
      const handoffResult =
        ui.handoff === null ? null : get(state.serverEnvironment.chatGptHandoffState(ui.handoff));
      const handoffState =
        handoffResult === null ? null : Option.getOrNull(AsyncResult.value(handoffResult));
      const auth = resolveCodexEffectiveAuth(
        Option.getOrNull(AsyncResult.value(authResult)),
        handoffState,
      );
      const installation = Option.getOrNull(AsyncResult.value(installResult));
      const provider = providerOf(get, card);
      const preparedConnection = get(
        state.environmentSession.preparedConnectionValueAtom(environmentId),
      );
      const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
      const primaryConnection =
        primaryEnvironmentId === null
          ? Option.none()
          : get(state.environmentSession.preparedConnectionValueAtom(primaryEnvironmentId));
      const primaryPresentation =
        primaryEnvironmentId === null
          ? undefined
          : get(state.environmentPresentations.presentationsAtom).get(primaryEnvironmentId);
      const handoffActive = ui.handoff !== null;
      const routing = resolveCodexAuthRouting({
        httpBaseUrl: Option.isSome(preparedConnection)
          ? preparedConnection.value.httpBaseUrl
          : null,
        handoffActive,
        hasDesktopBridge: true,
        hasDesktopCallbackReceiver: true,
        locationHostname: NATIVE_LOCATION_HOSTNAME,
        primaryEnvironmentId,
        primaryConnected: primaryPresentation?.connection.phase === "connected",
        primaryHttpBaseUrl: Option.isSome(primaryConnection)
          ? primaryConnection.value.httpBaseUrl
          : null,
      });
      const autoStart = cardUi.requested || card.autoStart;
      const model = buildCodexSetupModel({
        environmentId,
        instanceId,
        presentation,
        displayName: card.displayName ?? undefined,
        provider,
        auth,
        installation,
        handoffActive,
        handoffState,
        queryFailed: authResult._tag === "Failure" || installResult._tag === "Failure",
        enabled: card.enabled,
        readOnly: card.readOnly ?? false,
        pending: ui.pending,
        error: ui.error,
        awaitingProvider: ui.awaitingProvider,
        autoStart,
        autoStartHandled: ui.autoStartHandled,
        transferFailed: ui.transferFailed,
        requestedMethodId: ui.requestedMethodId,
        allowExistingCli: card.allowExistingCli ?? true,
        routing,
        returnUrl: resolveCodexAuthReturnUrl({ href, environmentId, instanceId }),
        isDevelopment: false,
        callbackDraft: ui.callbackDraft,
        callbackHelpOpen: ui.callbackHelpOpen,
      });
      return {
        flow: {
          environmentId,
          instanceId,
          href,
          state: model.state,
          pending: ui.pending,
          awaitingProvider: ui.awaitingProvider,
          autoStart,
          autoStartHandled: ui.autoStartHandled,
          handoff: ui.handoff,
          handoffState,
        },
        model,
        ui,
        methods: auth?.methods ?? [],
        handoffFailure: resolveCodexHandoffFailure({
          handoffActive,
          handoffQueryFailed: handoffResult?._tag === "Failure",
          handoffState,
        }),
      };
    });

    let frozen: CodexSetupFlowSnapshot | null = null;
    const setUi =
      <K extends keyof ManagedUi>(field: K) =>
      (value: ManagedUi[K]) =>
        updateManagedUi(key, (ui) => ({ ...ui, [field]: value }));
    const host: CodexSetupFlowHost = {
      snapshot: () => frozen ?? registry.get(snapshotAtom).flow,
      commands: {
        startAuth: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.startProviderAuth,
            value,
            COMMAND_OPTIONS,
          ),
        completeAuth: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.completeProviderAuth,
            value,
            COMMAND_OPTIONS,
          ),
        cancelAuth: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.cancelProviderAuth,
            value,
            COMMAND_OPTIONS,
          ),
        logoutAuth: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.logoutProviderAuth,
            value,
            COMMAND_OPTIONS,
          ),
        startInstall: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.startProviderInstall,
            value,
            COMMAND_OPTIONS,
          ),
        cancelInstall: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.cancelProviderInstall,
            value,
            COMMAND_OPTIONS,
          ),
        reconnectProfile: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.chatGptReconnectProfile,
            value,
            COMMAND_OPTIONS,
          ),
        importProfile: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.chatGptImportProfile,
            value,
            COMMAND_OPTIONS,
          ),
        refreshProviders: (value) =>
          runAtomCommand(
            registry,
            state.serverEnvironment.refreshProviders,
            value,
            COMMAND_OPTIONS,
          ),
      },
      handoffIdPrefix: `native-codex-${++sessionSequence}`,
      setPending: setUi("pending"),
      setError: setUi("error"),
      setAwaitingProvider: setUi("awaitingProvider"),
      setHandoff: setUi("handoff"),
      setTransferFailed: setUi("transferFailed"),
      setRequestedMethodId: setUi("requestedMethodId"),
      setCallbackDraft: setUi("callbackDraft"),
      setAccountPickerOpen: setUi("accountPickerOpen"),
      setAutoStartHandled: setUi("autoStartHandled"),
      onAutoStartConsumed: () => {
        updateCardUi(key, (ui) => ({ ...ui, requested: false }));
        if ((card.presentation ?? "onboarding") === "onboarding") {
          deps.onAutoStartConsumed(environmentId);
        }
      },
      openExternal,
      receiveCallback: (authorizationUrl) =>
        receiveCodexAuthCallback(authorizationUrl, async (url) => {
          await openExternal(url);
          return true;
        }),
      cancelCallback: async (authorizationUrl) => cancelCodexAuthCallback(authorizationUrl),
    };
    const flow = createCodexSetupFlow(host);

    let disposed = false;
    let scheduled = false;
    let clearDeps: ReadonlyArray<unknown> | null = null;
    let refreshDeps: ReadonlyArray<unknown> | null = null;
    let failureDeps: ReadonlyArray<unknown> | null = null;
    let callbackDeps: ReadonlyArray<unknown> | null = null;
    let callbackCleanup: (() => void) | undefined;
    const runEffects = () => {
      scheduled = false;
      if (disposed) return;
      const snapshot = registry.get(snapshotAtom);
      const { state: setupState } = snapshot.model;
      frozen = snapshot.flow;
      try {
        const nextClear = [setupState.authenticated, setupState.authPhase];
        if (!sameDeps(clearDeps, nextClear)) {
          clearDeps = nextClear;
          flow.clearAwaitingProvider();
        }
        const nextRefresh = [snapshot.ui.awaitingProvider, setupState.authPhase];
        if (!sameDeps(refreshDeps, nextRefresh)) {
          refreshDeps = nextRefresh;
          flow.refreshAfterSignIn();
        }
        flow.importFinishedHandoff();
        const nextFailure = [snapshot.handoffFailure];
        if (!sameDeps(failureDeps, nextFailure)) {
          failureDeps = nextFailure;
          flow.applyHandoffFailure(snapshot.handoffFailure);
        }
        flow.autoStart();
        flow.continueAfterInstall();
        const nextCallback = [setupState.clientCallback, setupState.url];
        if (!sameDeps(callbackDeps, nextCallback)) {
          callbackDeps = nextCallback;
          callbackCleanup?.();
          callbackCleanup = flow.watchCallback();
        }
        flow.autoOpen();
      } finally {
        frozen = null;
      }
    };
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(runEffects);
    };
    const unsubscribe = registry.subscribe(snapshotAtom, schedule, { immediate: true });
    return {
      snapshotAtom,
      flow,
      dispose: () => {
        disposed = true;
        unsubscribe();
        callbackCleanup?.();
        callbackCleanup = undefined;
        const current = new Map(registry.get(managedUiAtom));
        current.delete(key);
        registry.set(managedUiAtom, current);
      },
    };
  };

  const reconcile = () => {
    const sections = registry.get(sectionsAtom);
    const managed = new Map(
      sections
        .filter(({ section }) => section.kind === "managed")
        .map(({ card }) => [card.key, card] as const),
    );
    const current = registry.get(sessionsAtom);
    let next: Map<string, ManagedSession> | null = null;
    for (const [key, session] of current) {
      if (managed.has(key)) continue;
      session.dispose();
      next ??= new Map(current);
      next.delete(key);
    }
    for (const [key, card] of managed) {
      if (current.has(key)) continue;
      next ??= new Map(current);
      next.set(key, createSession(card));
    }
    if (next !== null) registry.set(sessionsAtom, next);
    const cardKeys = new Set(sections.map(({ card }) => card.key));
    const cardUi = registry.get(cardUiAtom);
    if ([...cardUi.keys()].some((key) => !cardKeys.has(key))) {
      registry.set(cardUiAtom, new Map([...cardUi].filter(([key]) => cardKeys.has(key))));
    }
  };

  registry.subscribe(
    Atom.make((get) =>
      get(sectionsAtom)
        .map(({ card, section }) => `${card.key}\u0000${section.kind}`)
        .join("\u0001"),
    ),
    reconcile,
    { immediate: true },
  );

  const cardsViewAtom = Atom.make((get): Readonly<Record<string, CodexSetupCardView>> => {
    const sessions = get(sessionsAtom);
    const cardUi = get(cardUiAtom);
    const cards: Record<string, CodexSetupCardView> = {};
    for (const { card, section } of get(sectionsAtom)) {
      if ((card.presentation ?? "onboarding") !== "onboarding") continue;
      const ui = cardUi.get(card.key) ?? INITIAL_CARD_UI;
      const session = sessions.get(card.key);
      const view =
        section.kind === "managed"
          ? session === undefined
            ? null
            : managedCardView(card.key, get(session.snapshotAtom), ui)
          : sectionCardView(card.key, section, ui);
      if (view !== null) cards[card.key] = view;
    }
    return cards;
  });

  const settingsViewAtom = Atom.make((get): Readonly<Record<string, CodexSetupSettingsView>> => {
    const sessions = get(sessionsAtom);
    const cardUi = get(cardUiAtom);
    const views: Record<string, CodexSetupSettingsView> = {};
    for (const { card, section } of get(sectionsAtom)) {
      if ((card.presentation ?? "onboarding") === "onboarding") continue;
      if (section.kind === "preparing-row") {
        views[card.key] = {
          kind: "preparing",
          key: card.key,
          title: section.title,
          description: section.description,
        };
        continue;
      }
      if (section.kind !== "managed") continue;
      const session = sessions.get(card.key);
      if (session === undefined) continue;
      views[card.key] = managedSettingsView(
        card.key,
        get(session.snapshotAtom),
        cardUi.get(card.key) ?? INITIAL_CARD_UI,
      );
    }
    return views;
  });

  registry.subscribe(
    Atom.make((get) => {
      const add = get(addAccountAtom);
      if (add === null || add.mode !== "settings" || add.instanceId === null) return null;
      const provider = get(state.serverEnvironment.providersValueAtom(add.environmentId))?.find(
        (candidate) => candidate.instanceId === add.instanceId,
      );
      return usesChatGptSharing(provider) ? add.revision : null;
    }),
    (connectedRevision) => {
      if (connectedRevision === null) return;
      if (registry.get(addAccountAtom)?.revision === connectedRevision) {
        registry.set(addAccountAtom, null);
      }
    },
    { immediate: true },
  );

  const welcomeModelAtom = Atom.make((get) =>
    buildChatGptWelcomeModel({
      environments: [...get(state.environmentPresentations.presentationsAtom)].map(
        ([environmentId, presentation]) => ({
          environmentId,
          connected: presentation.connection.phase === "connected",
          environmentLabel: presentation.entry.target.label,
          providers: presentation.serverConfig?.providers ?? [],
        }),
      ),
      acknowledged: get(acknowledgedAtom),
    }),
  );

  const dialogsViewAtom = Atom.make((get): CodexSetupDialogsView => {
    const addAccount = get(addAccountAtom);
    const addProvider =
      addAccount === null || addAccount.instanceId === null
        ? undefined
        : get(state.serverEnvironment.providersValueAtom(addAccount.environmentId))?.find(
            (candidate) => candidate.instanceId === addAccount.instanceId,
          );
    const addModel =
      addAccount === null
        ? null
        : buildAddCodexAccountModel({
            name: addAccount.name,
            instanceId: addAccount.instanceId,
            pending: addAccount.pending,
            providerHasSetup: addProvider?.setup !== undefined,
            connected: usesChatGptSharing(addProvider),
          });
    const addSetupKey =
      addAccount === null || addAccount.instanceId === null
        ? null
        : `${ADD_ACCOUNT_KEY_PREFIX}${addAccount.instanceId}`;
    const addSetupReady = addSetupKey !== null && get(settingsViewAtom)[addSetupKey] !== undefined;
    let accountPicker: CodexSetupAccountPickerView | null = null;
    for (const [key, session] of get(sessionsAtom)) {
      const snapshot = get(session.snapshotAtom);
      if (!snapshot.ui.accountPickerOpen) continue;
      const picker = buildChatGptAccountPickerModel({
        methods: snapshot.methods,
        selection: snapshot.ui.pickerSelection,
      });
      accountPicker = {
        key,
        title: picker.title,
        description: picker.description,
        groupLabel: picker.groupLabel,
        selectedMethodId: picker.selectedMethodId,
        options: picker.options,
        confirmLabel: picker.confirmLabel,
      };
      break;
    }
    const welcome = get(welcomeModelAtom);
    return {
      addAccount:
        addAccount === null || addModel === null || !addModel.open
          ? null
          : {
              revision: addAccount.revision,
              title: addModel.title,
              description: addModel.description,
              form:
                addModel.body.kind === "form"
                  ? {
                      title: addModel.body.title,
                      description: addModel.body.description,
                      inputLabel: addModel.body.inputLabel,
                      placeholder: addModel.body.placeholder,
                      value: addModel.body.value,
                      disabled: addModel.body.disabled,
                    }
                  : null,
              preparing:
                addModel.body.kind === "preparing"
                  ? { title: addModel.body.title, description: addModel.body.description }
                  : null,
              setupKey: addModel.body.kind === "setup" && addSetupReady ? addSetupKey : null,
              cancel: addModel.footer.kind === "create" ? addModel.footer.cancel : null,
              submit: addModel.footer.kind === "create" ? addModel.footer.submit : null,
              finishLater:
                addModel.footer.kind === "finish-later"
                  ? { label: addModel.footer.finishLater.label }
                  : null,
            },
      accountPicker,
      welcome: welcome.open
        ? {
            title: welcome.title,
            description: welcome.description,
            detail: welcome.detail,
            usageLabel: welcome.usage.label,
            continueLabel: welcome.continueLabel,
          }
        : null,
    };
  });

  const sessionFor = (key: string) => registry.get(sessionsAtom).get(key);

  const submitAddAccount = async () => {
    const current = registry.get(addAccountAtom);
    if (current === null) return;
    const settings =
      registry.get(state.serverEnvironment.settingsValueAtom(current.environmentId)) ??
      DEFAULT_SERVER_SETTINGS;
    const create = resolveAddCodexAccountCreate({
      name: current.name,
      pending: current.pending,
      instanceSuffix: randomUUID(),
      providerInstances: settings.providerInstances,
    });
    if (create.kind === "none") return;
    registry.set(addAccountAtom, { ...current, pending: true });
    const result = await runAtomCommand(
      registry,
      state.serverEnvironment.updateSettings,
      {
        environmentId: current.environmentId,
        input: { patch: { providerInstances: create.providerInstances } },
      },
      { label: "Add ChatGPT account" },
    );
    const latest = registry.get(addAccountAtom);
    if (result._tag === "Success") {
      if (current.mode === "settings") {
        if (latest?.revision === current.revision) {
          registry.set(addAccountAtom, {
            ...latest,
            instanceId: create.instanceId,
            pending: false,
          });
        }
        return;
      }
      deps.onAccountCreated(current.environmentId, create.instanceId, create.displayName);
      if (latest?.revision === current.revision) registry.set(addAccountAtom, null);
      return;
    }
    if (latest?.revision === current.revision) {
      registry.set(addAccountAtom, { ...latest, pending: false });
    }
  };

  return {
    views: {
      codexSetupOnboardingCards: cardsViewAtom,
      codexSetupSettingsSections: settingsViewAtom,
      codexSetupDialogs: dialogsViewAtom,
    },
    actions: {
      codexSetupCardAct: async (params) => {
        const { key, intent } = CardActParams(params);
        const card = registry.get(cardsAtom).find((entry) => entry.key === key);
        if (card === undefined) return null;
        const session = sessionFor(key);
        switch (intent.kind) {
          case "existing-connect":
            updateCardUi(key, (ui) => ({ ...ui, requested: true }));
            changeMode(card, intent.mode);
            return null;
          case "change-mode":
            changeMode(card, intent.mode);
            return null;
          case "toggle-email":
            updateCardUi(key, (ui) => ({ ...ui, emailRevealed: !ui.emailRevealed }));
            return null;
          case "connect":
          case "waiting-control":
          case "use-different-account":
          case "submit-callback":
          case "change-account":
          case "disconnect":
            session?.flow.change({ kind: intent.kind });
            return null;
          case "cancel-sign-in":
            session?.flow.cancelSignIn(
              key.startsWith(ADD_ACCOUNT_KEY_PREFIX)
                ? () => registry.set(addAccountAtom, null)
                : undefined,
            );
            return null;
          case "cancel-install":
            session?.flow.cancelInstall();
            return null;
          case "cancel":
            session?.flow.cancelOnboarding();
            return null;
          case "toggle-callback-help":
            updateManagedUi(key, (ui) => ({ ...ui, callbackHelpOpen: !ui.callbackHelpOpen }));
            return null;
          case "browser-retry": {
            const retry =
              session === undefined
                ? null
                : registry.get(session.snapshotAtom).model.callback?.browserRetry;
            if (retry) void openExternal(retry.url).catch(() => undefined);
            return null;
          }
        }
      },
      codexSetupCallbackInput: async (params) => {
        const { key, value } = KeyValueParams(params);
        const session = sessionFor(key);
        if (session === undefined) return null;
        const flowId = registry.get(session.snapshotAtom).model.state.flowId ?? "";
        updateManagedUi(key, (ui) => ({ ...ui, callbackDraft: { flowId, value } }));
        return null;
      },
      codexSetupAddAccountOpen: async (params) => {
        const { environmentId, mode } = AddAccountOpenParams(params);
        registry.set(addAccountAtom, {
          environmentId,
          revision: ++addAccountRevision,
          name: INITIAL_ACCOUNT_NAME,
          pending: false,
          mode: mode ?? "onboarding",
          instanceId: null,
        });
        return null;
      },
      codexSetupAddAccountClose: async () => {
        registry.set(addAccountAtom, null);
        return null;
      },
      codexSetupAddAccountSetName: async (params) => {
        const { value } = ValueParams(params);
        const current = registry.get(addAccountAtom);
        if (current !== null) registry.set(addAccountAtom, { ...current, name: value });
        return null;
      },
      codexSetupAddAccountSubmit: async () => {
        await submitAddAccount();
        return null;
      },
      codexSetupPickerSelect: async (params) => {
        const { key, value } = KeyValueParams(params);
        updateManagedUi(key, (ui) => ({ ...ui, pickerSelection: value }));
        return null;
      },
      codexSetupPickerClose: async (params) => {
        const { key } = KeyParams(params);
        updateManagedUi(key, (ui) => ({ ...ui, accountPickerOpen: false }));
        return null;
      },
      codexSetupPickerConfirm: async (params) => {
        const { key } = KeyParams(params);
        const session = sessionFor(key);
        if (session === undefined) return null;
        const snapshot = registry.get(session.snapshotAtom);
        const { selectedMethodId } = buildChatGptAccountPickerModel({
          methods: snapshot.methods,
          selection: snapshot.ui.pickerSelection,
        });
        updateManagedUi(key, (ui) => ({ ...ui, accountPickerOpen: false }));
        session.flow.change({ kind: "select-account", methodId: selectedMethodId });
        return null;
      },
      codexSetupWelcomeDismiss: async () => {
        const acknowledged = registry.get(acknowledgedAtom);
        const decision = resolveChatGptWelcomeDismiss({
          next: registry.get(welcomeModelAtom).next,
          acknowledged,
        });
        if (decision.kind === "none") return null;
        registry.set(acknowledgedAtom, decision.acknowledged);
        try {
          storage.setItem(CHATGPT_WELCOME_STORAGE_KEY, decision.stored);
        } catch {
          return null;
        }
        return null;
      },
      codexSetupWelcomeOpenUsage: async () => {
        await openExternal(CHATGPT_USAGE_BUTTON.url);
        return null;
      },
    },
  };
}
