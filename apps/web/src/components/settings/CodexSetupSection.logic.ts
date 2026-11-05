import type {
  ChatGptHandoffState,
  EnvironmentId,
  ProviderAuthState,
  ProviderInstallState,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { codexAuthHandoffUrl } from "@t3tools/shared/codexAuthHandoff";
import { isLoopbackHost } from "@t3tools/shared/preview";
import { providerAuthReturnUrl } from "@t3tools/shared/providerAuthReturnUrl";

import { getOnboardingProviderState } from "../../onboarding/providerReadiness.logic";
import {
  CHATGPT_CHANGE_ACCOUNT_METHOD_ID,
  CHATGPT_PROFILE_PREFIX,
} from "./ChatGptAccountPicker.logic";
import { getProviderSummary } from "./providerStatus";

export type CodexSetupMode = "managed" | "existing";
export type CodexSetupPresentation = "settings" | "onboarding";

export const CODEX_SETUP_UNEXPECTED_FAILURE_MESSAGE = "Codex setup failed. Try again.";
export const CODEX_SETUP_OPEN_PAGE_FAILURE_MESSAGE =
  "Could not finish sign-in on this computer. Try again or paste the redirect URL below.";

export function readCodexSetupMode(config: unknown): CodexSetupMode {
  return config !== null &&
    typeof config === "object" &&
    "setupMode" in config &&
    config.setupMode === "managed"
    ? "managed"
    : "existing";
}

export function resolveCodexSetupFailureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : CODEX_SETUP_UNEXPECTED_FAILURE_MESSAGE;
}

export function resolveCodexAuthReturnUrl(input: {
  readonly href: string;
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}): string {
  const returnUrl = new URL(input.href);
  if (returnUrl.pathname === "/welcome") returnUrl.hash = `agents:${input.environmentId}`;
  if (returnUrl.pathname === "/settings/providers")
    returnUrl.searchParams.set("instanceId", input.instanceId);
  return returnUrl.toString();
}

export type CodexAuthRoutingInput = {
  readonly httpBaseUrl: string | null;
  readonly handoffActive: boolean;
  readonly hasDesktopBridge: boolean;
  readonly hasDesktopCallbackReceiver: boolean;
  readonly locationHostname: string;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primaryConnected: boolean;
  readonly primaryHttpBaseUrl: string | null;
};

export type CodexAuthRouting = {
  readonly local: boolean;
  readonly clientCallback: boolean;
  readonly remoteWeb: boolean;
  readonly primaryAuthEnvironmentId: EnvironmentId | null;
};

export function resolveCodexAuthRouting(input: CodexAuthRoutingInput): CodexAuthRouting {
  const local = input.httpBaseUrl !== null && isLoopbackHost(new URL(input.httpBaseUrl).hostname);
  const clientCallback = !input.handoffActive && (!local || input.hasDesktopCallbackReceiver);
  return {
    local,
    clientCallback,
    remoteWeb: clientCallback && !input.hasDesktopCallbackReceiver,
    primaryAuthEnvironmentId:
      !local &&
      input.primaryEnvironmentId &&
      input.primaryConnected &&
      input.primaryHttpBaseUrl &&
      isLoopbackHost(new URL(input.primaryHttpBaseUrl).hostname) &&
      (input.hasDesktopBridge || isLoopbackHost(input.locationHostname))
        ? input.primaryEnvironmentId
        : null,
  };
}

export function resolveCodexEffectiveAuth(
  authState: ProviderAuthState | null,
  handoffState: ChatGptHandoffState | null,
): ProviderAuthState | null {
  return handoffState?.phase === "auth" ? handoffState.state : authState;
}

export type CodexSignedInDescription = {
  readonly kind: "signed-in";
  readonly prefix: string;
  readonly email: string;
  readonly suffix: string;
  readonly ariaLabel: string;
  readonly revealTooltip: string;
  readonly hideTooltip: string;
};

export type CodexSignInHelpDescription = {
  readonly kind: "sign-in-help";
  readonly label: string;
  readonly toggle: { readonly ariaLabel: string; readonly expanded: boolean } | null;
};

export type CodexSetupDescription =
  | { readonly kind: "text"; readonly text: string }
  | CodexSignedInDescription
  | CodexSignInHelpDescription;

function signedInDescription(email: string): CodexSignedInDescription {
  return {
    kind: "signed-in",
    prefix: "Signed in as",
    email,
    suffix: ".",
    ariaLabel: "Toggle account email visibility",
    revealTooltip: "Click to reveal email",
    hideTooltip: "Click to hide email",
  };
}

const SIGN_IN_HELP_LABEL = "Complete sign-in in your browser.";
const SIGN_IN_TROUBLE_LABEL = "Having trouble signing in?";

function signInHelpDescription(
  label: string,
  expanded: boolean | null,
): CodexSignInHelpDescription {
  return {
    kind: "sign-in-help",
    label,
    toggle: expanded === null ? null : { ariaLabel: SIGN_IN_TROUBLE_LABEL, expanded },
  };
}

export type CodexButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
};

export type CodexStatusControl =
  | { readonly kind: "ready"; readonly label: string; readonly iconKey: "check" }
  | { readonly kind: "status"; readonly label: string };

export type CodexSetupSectionModelInput = {
  readonly mode: CodexSetupMode;
  readonly presentation: CodexSetupPresentation | undefined;
  readonly displayName: string | undefined;
  readonly provider: ServerProvider | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
};

export type CodexSetupSectionModel =
  | {
      readonly kind: "existing-card";
      readonly title: string;
      readonly description: CodexSetupDescription;
      readonly control:
        | CodexStatusControl
        | ({
            readonly kind: "connect";
            readonly mode: CodexSetupMode;
          } & CodexButtonModel);
      readonly secondary: { readonly label: string; readonly mode: CodexSetupMode } | null;
    }
  | { readonly kind: "none" }
  | {
      readonly kind: "preparing-card";
      readonly title: string;
      readonly description: CodexSetupDescription;
      readonly controlLabel: string;
      readonly secondaryLabel: string;
    }
  | { readonly kind: "preparing-row"; readonly title: string; readonly description: string }
  | { readonly kind: "managed" };

export function buildCodexSetupSectionModel(
  input: CodexSetupSectionModelInput,
): CodexSetupSectionModel {
  const { provider } = input;
  const title = input.displayName || provider?.displayName || "Codex";
  if (input.mode === "existing" && input.presentation === "onboarding") {
    const existingState = getOnboardingProviderState(provider);
    const existingReady = input.enabled && existingState === "ready";
    const existingAuthenticated = provider?.auth.status === "authenticated";
    const existingChecking = existingState === "checking";
    const existingSummary = getProviderSummary(provider);
    const email = provider?.auth.email?.trim();
    return {
      kind: "existing-card",
      title,
      description: existingReady
        ? email
          ? signedInDescription(email)
          : { kind: "text", text: "Connected with your Codex CLI." }
        : existingChecking
          ? { kind: "text", text: "Checking your Codex CLI..." }
          : provider?.installed
            ? { kind: "text", text: existingSummary.headline }
            : { kind: "text", text: "Code with your ChatGPT subscription." },
      control: existingReady
        ? { kind: "ready", label: "Ready", iconKey: "check" }
        : existingChecking
          ? { kind: "status", label: "Checking..." }
          : existingAuthenticated
            ? { kind: "status", label: existingSummary.headline }
            : {
                kind: "connect",
                label: "Continue with ChatGPT",
                disabled: input.readOnly,
                mode: "managed",
              },
      secondary:
        !existingAuthenticated && !existingReady && !existingChecking
          ? { label: "Use existing CLI", mode: "existing" }
          : null,
    };
  }
  if (input.mode === "existing") return { kind: "none" };
  if (provider?.setup === undefined) {
    return input.presentation === "onboarding"
      ? {
          kind: "preparing-card",
          title,
          description: signInHelpDescription(SIGN_IN_HELP_LABEL, null),
          controlLabel: "Open sign-in page",
          secondaryLabel: "Cancel",
        }
      : { kind: "preparing-row", title: "ChatGPT account", description: "Preparing sign-in." };
  }
  return { kind: "managed" };
}

export type CodexAwaitingProvider = "sign-in" | "handoff";

export type CodexCallbackDraft = {
  readonly flowId: string;
  readonly value: string;
};

export type CodexSetupModelInput = {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly presentation: CodexSetupPresentation | undefined;
  readonly displayName: string | undefined;
  readonly provider: ServerProvider | undefined;
  readonly auth: ProviderAuthState | null;
  readonly installation: ProviderInstallState | null;
  readonly handoffActive: boolean;
  readonly handoffState: ChatGptHandoffState | null;
  readonly queryFailed: boolean;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly awaitingProvider: CodexAwaitingProvider | null;
  readonly autoStart: boolean;
  readonly autoStartHandled: boolean;
  readonly transferFailed: boolean;
  readonly requestedMethodId: string;
  readonly allowExistingCli: boolean;
  readonly routing: CodexAuthRouting;
  readonly returnUrl: string;
  readonly isDevelopment: boolean;
  readonly callbackDraft: CodexCallbackDraft;
  readonly callbackHelpOpen: boolean;
};

export type CodexSetupState = {
  readonly authPhase: ProviderAuthState["phase"] | null;
  readonly flowId: string | null;
  readonly url: string | null;
  readonly methodIds: readonly string[];
  readonly installationOperationId: string | null;
  readonly installationPhase: ProviderInstallState["phase"] | null;
  readonly installationLoaded: boolean;
  readonly canInstall: boolean;
  readonly handoffActive: boolean;
  readonly handoffFinished: boolean;
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly updateAvailable: boolean;
  readonly finishingSignIn: boolean;
  readonly startingAutomatically: boolean;
  readonly waitingForAuthState: boolean;
  readonly authInProgress: boolean;
  readonly installActive: boolean;
  readonly authActive: boolean;
  readonly unavailable: boolean;
  readonly busy: boolean;
  readonly hasSavedAccount: boolean;
  readonly callbackUrl: string;
  readonly clientCallback: boolean;
  readonly remoteWeb: boolean;
  readonly primaryAuthEnvironmentId: EnvironmentId | null;
};

export type CodexWaitingControlModel = CodexButtonModel & { readonly emphasized: boolean };

export type CodexCallbackModel = {
  readonly prompt: string;
  readonly inputLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly maxLength: number;
  readonly inputDisabled: boolean;
  readonly submit: CodexButtonModel;
  readonly browserRetry: {
    readonly label: string;
    readonly url: string;
    readonly iconKey: "external-link";
  } | null;
  readonly handoff: {
    readonly summary: string;
    readonly label: string;
    readonly href: string;
  } | null;
};

export type CodexCallbackFallbackModel =
  | { readonly kind: "inline" }
  | { readonly kind: "help"; readonly description: CodexSignInHelpDescription };

export type CodexSettingsControls =
  | { readonly kind: "auth-active"; readonly cancel: CodexButtonModel | null }
  | { readonly kind: "install-active"; readonly cancel: CodexButtonModel }
  | {
      readonly kind: "authenticated";
      readonly changeAccount: CodexButtonModel;
      readonly disconnect: CodexButtonModel;
    }
  | {
      readonly kind: "connect";
      readonly connect: CodexButtonModel;
      readonly differentAccount: CodexButtonModel | null;
    };

export type CodexOnboardingControl =
  | CodexStatusControl
  | { readonly kind: "waiting" }
  | ({ readonly kind: "connect" } & CodexButtonModel);

export type CodexOnboardingSecondary =
  | ({ readonly kind: "cancel" } & CodexButtonModel)
  | ({ readonly kind: "use-different-account" } & CodexButtonModel)
  | ({ readonly kind: "use-existing-cli"; readonly mode: CodexSetupMode } & CodexButtonModel);

export type CodexSetupModel = {
  readonly state: CodexSetupState;
  readonly runtimeDescription: string;
  readonly accountDescription: CodexSetupDescription;
  readonly waitingControl: CodexWaitingControlModel;
  readonly callback: CodexCallbackModel | null;
  readonly callbackFallback: CodexCallbackFallbackModel | null;
  readonly callbackHelpVisible: boolean;
  readonly logoutWarning: string | null;
  readonly settings: {
    readonly ariaLabel: string;
    readonly title: string;
    readonly controls: CodexSettingsControls;
    readonly showUsage: boolean;
    readonly errorAlert: { readonly message: string | null } | null;
  };
  readonly onboarding: {
    readonly title: string;
    readonly description: CodexSetupDescription;
    readonly control: CodexOnboardingControl;
    readonly secondary: CodexOnboardingSecondary | null;
    readonly footer: "callback-fallback" | "callback-help";
    readonly setupError: string | null;
  };
};

export function buildCodexSetupModel(input: CodexSetupModelInput): CodexSetupModel {
  const { auth, installation, provider, pending, routing } = input;
  const reconnectEmail = auth?.methods?.find((method) => method.id === "chatgpt")?.accountEmail;
  const requestedAccountEmail = auth?.methods?.find(
    (method) => method.id === input.requestedMethodId,
  )?.accountEmail;
  const hasSavedAccount =
    auth?.methods?.some((method) => method.id.startsWith(CHATGPT_PROFILE_PREFIX)) === true;
  const url =
    (auth?.interaction?.type === "browser" ? auth.interaction.url : auth?.authorizationUrl) ?? null;
  const callbackUrl = input.callbackDraft.flowId === auth?.flowId ? input.callbackDraft.value : "";
  const handoffFinished = input.handoffState?.phase === "finished";
  const installed = installation?.installedVersion != null;
  const authenticated = provider?.auth.status === "authenticated";
  const updateAvailable =
    installed &&
    installation?.source !== "local" &&
    installation?.version != null &&
    installation.version !== installation.installedVersion;
  const finishingSignIn =
    input.awaitingProvider !== null &&
    !authenticated &&
    (auth?.phase === "succeeded" || input.awaitingProvider === "handoff");
  const startingAutomatically = input.autoStart && !input.autoStartHandled;
  const waitingForAuthState =
    input.awaitingProvider === "sign-in" &&
    !authenticated &&
    (auth === null || auth.phase === "idle");
  const authInProgress =
    finishingSignIn ||
    waitingForAuthState ||
    input.handoffActive ||
    auth?.phase === "starting" ||
    auth?.phase === "waiting" ||
    auth?.phase === "verifying";
  const installActive =
    installation?.phase === "downloading" ||
    installation?.phase === "extracting" ||
    installation?.phase === "verifying";
  const authActive = startingAutomatically || authInProgress || (pending && !installActive);
  const unavailable = input.readOnly || !input.enabled || pending || input.queryFailed;
  const busy = pending || authInProgress || installActive;
  const authFailedOrCancelled = auth?.phase === "failed" || auth?.phase === "cancelled";
  const email = provider?.auth.email?.trim();
  const connectDisabled =
    unavailable ||
    busy ||
    (!installed ? !provider?.setup?.canInstall : !provider?.setup?.canAuthenticate);
  const reconnectLabel = hasSavedAccount ? "Reconnect account" : "Continue with ChatGPT";

  const runtimeDescription =
    installation?.phase === "downloading"
      ? `Downloading ${(installation.downloadedBytes / 1_000_000).toFixed(1)}${installation.totalBytes === null ? "" : ` of ${(installation.totalBytes / 1_000_000).toFixed(1)}`} MB.`
      : installation?.phase === "extracting"
        ? "Installing Codex."
        : installation?.phase === "verifying"
          ? "Checking Codex."
          : installed
            ? `${installation?.source === "local" ? "Using your installed Codex" : "Managed by T3 Code"}${installation?.installedVersion ? ` · v${installation.installedVersion}` : ""}.`
            : (installation?.message ?? "T3 Code downloads and manages Codex for you.");

  const accountDescription: CodexSetupDescription = finishingSignIn
    ? { kind: "text", text: "Finishing sign-in..." }
    : installActive
      ? { kind: "text", text: runtimeDescription }
      : authActive || authFailedOrCancelled
        ? auth?.phase === "waiting" && requestedAccountEmail
          ? { kind: "text", text: `Continue as ${requestedAccountEmail} on OpenAI.` }
          : { kind: "text", text: auth?.message ?? "Finish signing in in your browser." }
        : authenticated
          ? email
            ? signedInDescription(email)
            : { kind: "text", text: "Signed in with ChatGPT." }
          : { kind: "text", text: reconnectEmail ?? "Use your ChatGPT subscription." };

  const flowId = auth?.flowId ?? null;
  const needsManualCallback = routing.remoteWeb;
  const handoffUrl =
    needsManualCallback && url && flowId && providerAuthReturnUrl(input.returnUrl)
      ? codexAuthHandoffUrl(
          {
            authorizationUrl: url,
            returnUrl: input.returnUrl,
            environmentId: input.environmentId,
            instanceId: input.instanceId,
            flowId,
          },
          input.isDevelopment,
        )
      : null;

  const waitingControl: CodexWaitingControlModel = {
    label: finishingSignIn
      ? "Finishing sign-in..."
      : handoffFinished
        ? input.transferFailed
          ? "Retry connection"
          : "Finishing sign-in..."
        : auth?.phase === "waiting"
          ? routing.remoteWeb
            ? "Open ChatGPT sign-in"
            : "Open sign-in page"
          : input.presentation === "onboarding"
            ? "Open sign-in page"
            : "Signing in...",
    disabled: handoffFinished
      ? pending || !input.transferFailed
      : !url || auth?.phase !== "waiting",
    emphasized: routing.remoteWeb,
  };

  const callback: CodexCallbackModel | null =
    !input.handoffActive && auth?.phase === "waiting" && url
      ? {
          prompt:
            "If sign-in doesn't return to T3 Code, paste the URL from the final localhost page.",
          inputLabel: "ChatGPT sign-in redirect URL",
          placeholder: "Paste the URL from the sign-in tab",
          value: callbackUrl,
          maxLength: 16_384,
          inputDisabled: pending || input.readOnly,
          submit: {
            label: "Connect",
            disabled: pending || input.readOnly || !callbackUrl.trim(),
          },
          browserRetry: !routing.remoteWeb
            ? { label: "Try sign-in in your browser", url, iconKey: "external-link" }
            : null,
          handoff: handoffUrl
            ? {
                summary: "Other ways to connect",
                label: "Use T3 desktop for automatic return",
                href: handoffUrl,
              }
            : null,
        }
      : null;

  const callbackFallback: CodexCallbackFallbackModel | null =
    callback === null
      ? null
      : needsManualCallback
        ? { kind: "inline" }
        : {
            kind: "help",
            description: signInHelpDescription(SIGN_IN_TROUBLE_LABEL, input.callbackHelpOpen),
          };

  const logoutWarning =
    auth?.phase === "idle" && auth.message?.startsWith("Signed out locally.") ? auth.message : null;

  const settingsControls: CodexSettingsControls = authActive
    ? {
        kind: "auth-active",
        cancel: finishingSignIn ? null : { label: "Cancel", disabled: pending || input.readOnly },
      }
    : installActive
      ? { kind: "install-active", cancel: { label: "Cancel", disabled: pending || input.readOnly } }
      : authenticated
        ? {
            kind: "authenticated",
            changeAccount: { label: "Change account", disabled: unavailable || busy },
            disconnect: { label: "Disconnect", disabled: unavailable || busy },
          }
        : {
            kind: "connect",
            connect: {
              label: pending ? "Setting up..." : reconnectLabel,
              disabled: connectDisabled,
            },
            differentAccount: hasSavedAccount
              ? { label: "Use a different account", disabled: unavailable || busy }
              : null,
          };

  const onboardingDescription: CodexSetupDescription = installActive
    ? { kind: "text", text: runtimeDescription }
    : authenticated
      ? email
        ? signedInDescription(email)
        : { kind: "text", text: "Connected to ChatGPT." }
      : callback && !needsManualCallback
        ? signInHelpDescription(SIGN_IN_HELP_LABEL, input.callbackHelpOpen)
        : startingAutomatically ||
            waitingForAuthState ||
            auth?.phase === "starting" ||
            auth?.phase === "waiting" ||
            (pending && !installActive)
          ? signInHelpDescription(SIGN_IN_HELP_LABEL, null)
          : authActive || authFailedOrCancelled
            ? accountDescription
            : { kind: "text", text: "Code with your ChatGPT subscription." };

  const onboardingControl: CodexOnboardingControl =
    authenticated && !busy
      ? { kind: "ready", label: "Ready", iconKey: "check" }
      : authActive
        ? { kind: "waiting" }
        : {
            kind: "connect",
            label: installActive || pending ? "Setting up..." : reconnectLabel,
            disabled: connectDisabled,
          };

  const onboardingSecondary: CodexOnboardingSecondary | null =
    (authActive && !finishingSignIn) || installActive
      ? { kind: "cancel", label: "Cancel", disabled: pending || input.readOnly }
      : !authActive && !authenticated && hasSavedAccount
        ? {
            kind: "use-different-account",
            label: "Use a different account",
            disabled: unavailable || busy,
          }
        : !authActive && !authenticated && input.allowExistingCli
          ? {
              kind: "use-existing-cli",
              label: "Use existing CLI",
              disabled: input.readOnly || busy,
              mode: "existing",
            }
          : null;

  return {
    state: {
      authPhase: auth?.phase ?? null,
      flowId,
      url,
      methodIds: (auth?.methods ?? []).map((method) => method.id),
      installationOperationId: installation?.operationId ?? null,
      installationPhase: installation?.phase ?? null,
      installationLoaded: installation !== null,
      canInstall: provider?.setup?.canInstall === true,
      handoffActive: input.handoffActive,
      handoffFinished,
      installed,
      authenticated,
      updateAvailable,
      finishingSignIn,
      startingAutomatically,
      waitingForAuthState,
      authInProgress,
      installActive,
      authActive,
      unavailable,
      busy,
      hasSavedAccount,
      callbackUrl,
      clientCallback: routing.clientCallback,
      remoteWeb: routing.remoteWeb,
      primaryAuthEnvironmentId: routing.primaryAuthEnvironmentId,
    },
    runtimeDescription,
    accountDescription,
    waitingControl,
    callback,
    callbackFallback,
    callbackHelpVisible: callback !== null && input.callbackHelpOpen,
    logoutWarning,
    settings: {
      ariaLabel: "Codex setup",
      title: "ChatGPT account",
      controls: settingsControls,
      showUsage: authenticated,
      errorAlert:
        input.error || input.queryFailed || installation?.phase === "failed"
          ? {
              message:
                input.error ??
                (installation?.phase === "failed"
                  ? installation.message
                  : "Could not read Codex setup status. Reconnect and try again."),
            }
          : null,
    },
    onboarding: {
      title: input.displayName || provider?.displayName || "Codex",
      description: onboardingDescription,
      control: onboardingControl,
      secondary: onboardingSecondary,
      footer: needsManualCallback ? "callback-fallback" : "callback-help",
      setupError:
        logoutWarning ??
        input.error ??
        (input.queryFailed
          ? "Could not read setup status. Reconnect and try again."
          : installation?.phase === "failed"
            ? installation.message
            : null),
    },
  };
}

export type CodexSetupIntent =
  | { readonly kind: "connect" }
  | { readonly kind: "select-account"; readonly methodId: string }
  | { readonly kind: "use-different-account" }
  | { readonly kind: "change-account" }
  | { readonly kind: "disconnect" }
  | { readonly kind: "waiting-control" }
  | { readonly kind: "submit-callback" }
  | { readonly kind: "cancel-onboarding" }
  | { readonly kind: "cancel-sign-in" }
  | { readonly kind: "cancel-install" };

export type CodexSetupDecision =
  | { readonly kind: "none" }
  | { readonly kind: "open-account-picker" }
  | { readonly kind: "setup"; readonly methodId: string }
  | { readonly kind: "logout" }
  | { readonly kind: "transfer-profile" }
  | { readonly kind: "open-page"; readonly url: string }
  | { readonly kind: "complete-auth"; readonly flowId: string; readonly callbackUrl: string }
  | { readonly kind: "clear-handoff" }
  | { readonly kind: "cancel-auth"; readonly flowId: string }
  | { readonly kind: "cancel-install"; readonly operationId: string };

const NO_DECISION: CodexSetupDecision = { kind: "none" };

export function resolveCodexSetupChange(
  intent: CodexSetupIntent,
  state: CodexSetupState,
): CodexSetupDecision {
  switch (intent.kind) {
    case "connect":
      return state.hasSavedAccount
        ? { kind: "open-account-picker" }
        : { kind: "setup", methodId: "chatgpt" };
    case "select-account":
      return {
        kind: "setup",
        methodId: state.methodIds.includes(intent.methodId)
          ? intent.methodId
          : CHATGPT_CHANGE_ACCOUNT_METHOD_ID,
      };
    case "use-different-account":
      return { kind: "setup", methodId: CHATGPT_CHANGE_ACCOUNT_METHOD_ID };
    case "change-account":
      return { kind: "open-account-picker" };
    case "disconnect":
      return { kind: "logout" };
    case "waiting-control":
      if (state.handoffFinished) return { kind: "transfer-profile" };
      return state.url ? { kind: "open-page", url: state.url } : NO_DECISION;
    case "submit-callback":
      if (!state.flowId || !state.callbackUrl.trim()) return NO_DECISION;
      return {
        kind: "complete-auth",
        flowId: state.flowId,
        callbackUrl: state.callbackUrl.trim(),
      };
    case "cancel-onboarding":
      if (state.handoffActive) return { kind: "clear-handoff" };
      if (state.authActive && state.flowId) return { kind: "cancel-auth", flowId: state.flowId };
      return state.installationOperationId
        ? { kind: "cancel-install", operationId: state.installationOperationId }
        : NO_DECISION;
    case "cancel-sign-in":
      if (state.handoffActive) return { kind: "clear-handoff" };
      return state.flowId ? { kind: "cancel-auth", flowId: state.flowId } : NO_DECISION;
    case "cancel-install":
      return state.installationOperationId
        ? { kind: "cancel-install", operationId: state.installationOperationId }
        : NO_DECISION;
  }
}

export type CodexSetupStepInput = Pick<
  CodexSetupState,
  "unavailable" | "busy" | "installed" | "updateAvailable"
> & { readonly methodId: string };

export type CodexSetupStep =
  | { readonly kind: "none" }
  | { readonly kind: "sign-in"; readonly methodId: string }
  | { readonly kind: "install-then-sign-in"; readonly methodId: string };

export function resolveCodexSetupStep(input: CodexSetupStepInput): CodexSetupStep {
  if (input.unavailable || input.busy) return { kind: "none" };
  return input.installed && !input.updateAvailable
    ? { kind: "sign-in", methodId: input.methodId }
    : { kind: "install-then-sign-in", methodId: input.methodId };
}

export type CodexSignInRoute =
  | { readonly kind: "handoff"; readonly primaryEnvironmentId: EnvironmentId }
  | { readonly kind: "start-auth"; readonly callbackMode: "client" | "server" };

export function resolveCodexSignInRoute(
  routing: Pick<CodexAuthRouting, "primaryAuthEnvironmentId" | "clientCallback">,
): CodexSignInRoute {
  return routing.primaryAuthEnvironmentId
    ? { kind: "handoff", primaryEnvironmentId: routing.primaryAuthEnvironmentId }
    : { kind: "start-auth", callbackMode: routing.clientCallback ? "client" : "server" };
}

export type CodexAutoStartInput = Pick<
  CodexSetupState,
  "unavailable" | "busy" | "installationLoaded" | "canInstall"
> & {
  readonly autoStart: boolean;
  readonly autoStartHandled: boolean;
};

export function shouldAutoStartCodexSetup(input: CodexAutoStartInput): boolean {
  return (
    input.autoStart &&
    !input.autoStartHandled &&
    !input.unavailable &&
    !input.busy &&
    input.installationLoaded &&
    input.canInstall
  );
}

export type CodexContinueAfterInstallInput = Pick<
  CodexSetupState,
  "installActive" | "installationPhase" | "installed"
> & {
  readonly pendingMethodId: string | null;
  readonly pending: boolean;
};

export type CodexContinueAfterInstall =
  | { readonly kind: "wait" }
  | { readonly kind: "clear" }
  | { readonly kind: "sign-in"; readonly methodId: string };

export function resolveCodexContinueAfterInstall(
  input: CodexContinueAfterInstallInput,
): CodexContinueAfterInstall {
  if (!input.pendingMethodId || input.pending || input.installActive) return { kind: "wait" };
  if (input.installationPhase === "failed" || input.installationPhase === "cancelled") {
    return { kind: "clear" };
  }
  return input.installed ? { kind: "sign-in", methodId: input.pendingMethodId } : { kind: "wait" };
}

export function shouldClearCodexAwaitingProvider(
  input: Pick<CodexSetupState, "authenticated" | "authPhase">,
): boolean {
  return input.authenticated || input.authPhase === "failed" || input.authPhase === "cancelled";
}

export type CodexHandoffFailureInput = {
  readonly handoffActive: boolean;
  readonly handoffQueryFailed: boolean;
  readonly handoffState: ChatGptHandoffState | null;
};

export function resolveCodexHandoffFailure(input: CodexHandoffFailureInput): string | null {
  if (!input.handoffActive) return null;
  const { handoffState } = input;
  if (
    !input.handoffQueryFailed &&
    !(
      handoffState?.phase === "auth" &&
      (handoffState.state.phase === "failed" || handoffState.state.phase === "cancelled")
    )
  ) {
    return null;
  }
  return handoffState?.phase === "auth"
    ? (handoffState.state.message ?? "ChatGPT sign-in could not finish. Try again.")
    : "ChatGPT sign-in on the primary environment was interrupted. Try again.";
}

export type CodexAutoOpenInput = Pick<
  CodexSetupState,
  "authPhase" | "flowId" | "url" | "remoteWeb"
> & {
  readonly openRequested: boolean;
  readonly openedFlowId: string | null;
};

export type CodexAutoOpenDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: "open";
      readonly flowId: string;
      readonly url: string;
      readonly launch: boolean;
    };

export function resolveCodexAutoOpen(input: CodexAutoOpenInput): CodexAutoOpenDecision {
  if (
    !input.openRequested ||
    input.authPhase !== "waiting" ||
    !input.flowId ||
    !input.url ||
    input.openedFlowId === input.flowId
  ) {
    return { kind: "none" };
  }
  return { kind: "open", flowId: input.flowId, url: input.url, launch: !input.remoteWeb };
}

export type CodexManagedRuntimeFieldsInput = {
  readonly executablePath: string | null;
  readonly installationFailed: boolean;
  readonly runtimePaths: ServerProvider["runtimePaths"] | null;
};

export type CodexManagedRuntimeFieldRow = {
  readonly id: "binary-path" | "home-path" | "shadow-home-path";
  readonly title: string;
  readonly description: string;
  readonly inputLabel: string;
  readonly value: string;
  readonly tooltip: string | null;
  readonly placeholder: string;
  readonly disabled: boolean;
};

export type CodexManagedRuntimeFieldsModel = {
  readonly rows: readonly CodexManagedRuntimeFieldRow[];
};

export function buildCodexManagedRuntimeFieldsModel(
  input: CodexManagedRuntimeFieldsInput,
): CodexManagedRuntimeFieldsModel {
  const executablePath = input.executablePath ?? "";
  const runtimePaths = input.runtimePaths ?? null;
  return {
    rows: [
      {
        id: "binary-path",
        title: "Binary path",
        description: "Selected by T3 Code.",
        inputLabel: "Codex binary path",
        value: executablePath,
        tooltip: executablePath,
        placeholder: input.installationFailed ? "Could not read runtime path" : "Not installed",
        disabled: true,
      },
      {
        id: "home-path",
        title: "CODEX_HOME path",
        description: "Shared Codex config, sessions, and state.",
        inputLabel: "Codex home path",
        value: runtimePaths?.homePath ?? "",
        tooltip: runtimePaths?.homePath ?? null,
        placeholder: "Unavailable",
        disabled: true,
      },
      {
        id: "shadow-home-path",
        title: "Shadow home path",
        description: runtimePaths?.shadowHomePath
          ? "Account-specific home sharing the Codex state above."
          : "This instance uses the shared Codex home directly.",
        inputLabel: "Codex shadow home path",
        value: runtimePaths?.shadowHomePath ?? "",
        tooltip: runtimePaths?.shadowHomePath ?? null,
        placeholder: runtimePaths ? "Not used" : "Unavailable",
        disabled: true,
      },
    ],
  };
}
