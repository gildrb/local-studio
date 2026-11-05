import {
  ANTIGRAVITY_AUTH_METHODS,
  type AntigravityAuthMethod,
  type ProviderAuthState,
  type ProviderInstallState,
  type ServerProvider,
} from "@t3tools/contracts";

const AUTH_PHASE_LABELS: Record<ProviderAuthState["phase"], string> = {
  idle: "Sign in with your Google account.",
  starting: "Starting Google sign-in.",
  waiting: "Waiting for Google sign-in.",
  verifying: "Checking Google sign-in and available models.",
  succeeded: "Google sign-in complete.",
  failed: "Google sign-in failed.",
  cancelled: "Google sign-in cancelled.",
};

const CREDENTIAL_PHASE_LABELS: Record<ProviderAuthState["phase"], string> = {
  idle: "Connect with the credentials in the provider settings.",
  starting: "Checking credentials.",
  waiting: "Checking credentials.",
  verifying: "Checking credentials and available models.",
  succeeded: "Connected.",
  failed: "Could not connect with the configured credentials.",
  cancelled: "Connection cancelled.",
};

export const PROVIDER_SETUP_UNEXPECTED_FAILURE_MESSAGE = "Provider setup failed. Try again.";

export function readAntigravityAuthMethod(config: unknown): AntigravityAuthMethod {
  const value =
    config !== null && typeof config === "object" && "authMethod" in config
      ? config.authMethod
      : undefined;
  return (
    ANTIGRAVITY_AUTH_METHODS.find((method) => method.value === value)?.value ?? "oauth-personal"
  );
}

export function resolveProviderSetupFailureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Provider setup failed.";
}

export type ProviderSetupSectionModelInput = {
  readonly environmentLabel: string;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly hasSetup: boolean;
};

export type ProviderSetupSectionBody =
  | { readonly kind: "notice"; readonly title: string; readonly description: string }
  | { readonly kind: "actions" };

export type ProviderSetupSectionModel = {
  readonly ariaLabel: string;
  readonly environment: {
    readonly title: string;
    readonly description: string;
    readonly value: string;
    readonly enableLabel: string | null;
  };
  readonly body: ProviderSetupSectionBody;
};

export function buildProviderSetupSectionModel(
  input: ProviderSetupSectionModelInput,
): ProviderSetupSectionModel {
  return {
    ariaLabel: "Antigravity setup",
    environment: {
      title: "Environment",
      description: "Device that runs this provider.",
      value: input.environmentLabel,
      enableLabel: !input.enabled && !input.readOnly ? "Enable Antigravity" : null,
    },
    body: input.readOnly
      ? { kind: "notice", title: "Setup unavailable", description: "Provider setup is read-only." }
      : !input.hasSetup
        ? {
            kind: "notice",
            title: "Update required",
            description: "Update this environment to manage Antigravity.",
          }
        : { kind: "actions" },
  };
}

export type ProviderSetupCallbackDraft = {
  readonly flowId: string | null;
  readonly value: string;
};

export type ProviderSetupModelInput = {
  readonly instanceId: string;
  readonly provider: ServerProvider;
  readonly authMethod: AntigravityAuthMethod;
  readonly binaryPath: string | undefined;
  readonly enabled: boolean;
  readonly auth: ProviderAuthState | null;
  readonly installation: ProviderInstallState | null;
  readonly queryError: string | null;
  readonly error: string | null;
  readonly pendingLabel: string | null;
  readonly callbackDraft: ProviderSetupCallbackDraft;
  readonly copiedFlowId: string | null;
};

export type ProviderSetupButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
};

export type ProviderSetupAuthMethodOption = {
  readonly value: AntigravityAuthMethod;
  readonly label: string;
};

export type ProviderSetupRuntimePrimaryControl =
  | ({ readonly kind: "cancel-install" } & ProviderSetupButtonModel)
  | ({ readonly kind: "start-install" } & ProviderSetupButtonModel);

export type ProviderSetupAuthPrimaryControl =
  | ({ readonly kind: "cancel-sign-in" } & ProviderSetupButtonModel)
  | ({ readonly kind: "start-sign-in" } & ProviderSetupButtonModel);

export type ProviderSetupRuntimeModel = {
  readonly title: string;
  readonly description: string;
  readonly notices: readonly string[];
  readonly statusMessage: string;
  readonly progress: {
    readonly label: string;
    readonly value: number;
    readonly max: number;
  } | null;
  readonly detailMessage: string | null;
  readonly primaryControl: ProviderSetupRuntimePrimaryControl | null;
  readonly remove: (ProviderSetupButtonModel & { readonly iconKey: "trash-2" }) | null;
};

export type ProviderSetupCallbackModel =
  | {
      readonly kind: "form";
      readonly expiry: {
        readonly prefix: string;
        readonly dateTime: string;
        readonly timeLabel: string;
      } | null;
      readonly inputId: string;
      readonly prompt: string;
      readonly placeholder: string;
      readonly value: string;
      readonly maxLength: number;
      readonly disabled: boolean;
      readonly submit: ProviderSetupButtonModel;
    }
  | { readonly kind: "other-client"; readonly message: string };

export type ProviderSetupAuthModel = {
  readonly title: string;
  readonly description: string;
  readonly methodOptions: readonly ProviderSetupAuthMethodOption[];
  readonly selectedMethod: AntigravityAuthMethod;
  readonly statusMessage: string;
  readonly statusVisuallyHidden: boolean;
  readonly signInLinks: {
    readonly openLabel: string;
    readonly copyLabel: string;
  } | null;
  readonly primaryControl: ProviderSetupAuthPrimaryControl | null;
  readonly signOut: (ProviderSetupButtonModel & { readonly variant: "outline" | "ghost" }) | null;
  readonly callback: ProviderSetupCallbackModel | null;
};

export type ProviderSetupModel = {
  readonly runtime: ProviderSetupRuntimeModel;
  readonly auth: ProviderSetupAuthModel;
  readonly pendingStatus: string | null;
  readonly alert: { readonly message: string; readonly retryLabel: string | null } | null;
};

export function resolveProviderSetupCallbackUrl(
  draft: ProviderSetupCallbackDraft,
  auth: ProviderAuthState | null,
): string {
  return draft.flowId === auth?.flowId ? draft.value : "";
}

export function buildProviderSetupModel(input: ProviderSetupModelInput): ProviderSetupModel {
  const { auth, installation, provider } = input;
  const usesBrowser =
    input.authMethod === "oauth-personal" || input.authMethod === "oauth-business";
  const phaseLabels = usesBrowser ? AUTH_PHASE_LABELS : CREDENTIAL_PHASE_LABELS;
  const methodLabel =
    ANTIGRAVITY_AUTH_METHODS.find((method) => method.value === input.authMethod)?.label ??
    "Google account";
  const callbackUrl = resolveProviderSetupCallbackUrl(input.callbackDraft, auth);
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive =
    installation?.phase === "downloading" ||
    installation?.phase === "extracting" ||
    installation?.phase === "verifying";
  const usesCustomBinary = Boolean(input.binaryPath?.trim());
  const installed =
    provider.installed || (!usesCustomBinary && installation?.installedVersion != null);
  const authenticated = provider.auth.status === "authenticated";
  const authStatusMessage =
    auth === null
      ? "Reading sign-in status."
      : authActive || auth.phase === "failed" || auth.phase === "cancelled"
        ? (auth.message ?? phaseLabels[auth.phase])
        : authenticated
          ? usesBrowser
            ? "Signed in with Google."
            : "Connected."
          : auth.phase === "idle" && auth.message
            ? auth.message
            : phaseLabels.idle;
  const authorizationUrl = auth?.phase === "waiting" ? auth.authorizationUrl : null;
  const actionsDisabled = input.pendingLabel !== null || input.queryError !== null;
  const installationStatusMessage =
    installation?.phase === "downloading"
      ? `Downloading ${(installation.downloadedBytes / 1_000_000).toFixed(1)} MB${installation.totalBytes === null ? "" : ` of ${(installation.totalBytes / 1_000_000).toFixed(1)} MB`}.`
      : installation?.phase === "extracting"
        ? "Extracting Antigravity."
        : installation?.phase === "verifying"
          ? "Checking the downloaded runtime."
          : installed
            ? "Installed."
            : usesCustomBinary
              ? input.enabled
                ? "The configured Antigravity runtime is unavailable."
                : "The configured Antigravity runtime has not been checked."
              : installation?.totalBytes
                ? `${Math.ceil(installation.totalBytes / 1_000_000)} MB download.`
                : "Not installed.";

  const notices: string[] = [];
  if (usesCustomBinary) {
    notices.push("Uses the custom binary path below. Installation keeps that path.");
  }
  if (!installed && !provider.setup?.canInstall) {
    notices.push(
      "Automatic installation unavailable. Set a binary path or use another environment.",
    );
  }

  const runtimePrimaryControl: ProviderSetupRuntimePrimaryControl | null =
    installActive && installation?.operationId
      ? { kind: "cancel-install", label: "Cancel installation", disabled: actionsDisabled }
      : !installActive && provider.setup?.canInstall
        ? {
            kind: "start-install",
            label: installation?.installedVersion
              ? installation.version && installation.version !== installation.installedVersion
                ? "Update Antigravity"
                : "Reinstall Antigravity"
              : installation?.phase === "failed" || installation?.phase === "cancelled"
                ? "Retry installation"
                : installed
                  ? "Install managed runtime"
                  : "Install Antigravity",
            disabled: actionsDisabled || installation === null || authActive,
          }
        : null;

  const authFailedOrCancelled = auth?.phase === "failed" || auth?.phase === "cancelled";
  const authPrimaryControl: ProviderSetupAuthPrimaryControl | null =
    authActive && auth?.flowId
      ? { kind: "cancel-sign-in", label: "Cancel sign-in", disabled: actionsDisabled }
      : !authActive && !authenticated && provider.setup?.canAuthenticate
        ? {
            kind: "start-sign-in",
            label: usesBrowser
              ? authFailedOrCancelled
                ? "Retry Google sign-in"
                : "Sign in with Google"
              : authFailedOrCancelled
                ? "Retry connection"
                : "Connect",
            disabled: actionsDisabled || !installed || auth === null || installActive,
          }
        : null;

  const callback: ProviderSetupCallbackModel | null = authorizationUrl
    ? {
        kind: "form",
        expiry: auth?.expiresAt
          ? {
              prefix: "Link expires at",
              dateTime: auth.expiresAt,
              timeLabel: new Date(auth.expiresAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            }
          : null,
        inputId: `provider-callback-${input.instanceId}`,
        prompt: "If the final localhost page does not load, paste its full URL here.",
        placeholder: "http://127.0.0.1:...",
        value: callbackUrl,
        maxLength: 16_384,
        disabled: actionsDisabled,
        submit: { label: "Continue", disabled: actionsDisabled || !callbackUrl.trim() },
      }
    : auth?.phase === "waiting"
      ? {
          kind: "other-client",
          message: "Sign-in is open in another client. Complete or cancel it there.",
        }
      : null;

  const alertMessage = input.error ?? input.queryError;

  return {
    runtime: {
      title: "Runtime",
      description: "Install and manage Antigravity.",
      notices,
      statusMessage: installationStatusMessage,
      progress:
        installation?.phase === "downloading" &&
        installation.totalBytes !== null &&
        installation.totalBytes > 0
          ? {
              label: "Antigravity download",
              value: installation.downloadedBytes,
              max: installation.totalBytes,
            }
          : null,
      detailMessage:
        !installActive &&
        installation?.message &&
        installation.message !== installationStatusMessage
          ? installation.message
          : null,
      primaryControl: runtimePrimaryControl,
      remove:
        installation?.canRemove && !installActive
          ? {
              label: "Remove downloaded runtime",
              disabled: actionsDisabled || authActive,
              iconKey: "trash-2",
            }
          : null,
    },
    auth: {
      title: methodLabel,
      description: usesBrowser
        ? "Connect your Google account."
        : "Connect with the credentials below.",
      methodOptions: ANTIGRAVITY_AUTH_METHODS.map((method) => ({
        value: method.value,
        label: method.label,
      })),
      selectedMethod: input.authMethod,
      statusMessage: authStatusMessage,
      statusVisuallyHidden: authStatusMessage === phaseLabels.idle,
      signInLinks: authorizationUrl
        ? {
            openLabel: "Open sign-in page",
            copyLabel: input.copiedFlowId === auth?.flowId ? "Link copied" : "Copy sign-in link",
          }
        : null,
      primaryControl: authPrimaryControl,
      signOut:
        !authActive && provider.setup?.canAuthenticate
          ? {
              label: usesBrowser ? "Sign out of Google" : "Disconnect",
              disabled: actionsDisabled || auth === null,
              variant: authenticated ? "outline" : "ghost",
            }
          : null,
      callback,
    },
    pendingStatus: input.pendingLabel ? `${input.pendingLabel}.` : null,
    alert:
      alertMessage !== null && (input.error || input.queryError)
        ? {
            message: alertMessage,
            retryLabel: input.queryError ? "Retry setup status" : null,
          }
        : null,
  };
}

export type ProviderSetupIntent =
  | { readonly kind: "start-install" }
  | { readonly kind: "cancel-install" }
  | { readonly kind: "remove-runtime" }
  | { readonly kind: "open-sign-in-page" }
  | { readonly kind: "copy-sign-in-link" }
  | { readonly kind: "submit-callback" }
  | { readonly kind: "start-sign-in" }
  | { readonly kind: "cancel-sign-in" }
  | { readonly kind: "sign-out" };

export type ProviderSetupActionContext = {
  readonly authMethod: AntigravityAuthMethod;
  readonly providerDisplayName: string | undefined;
  readonly environmentLabel: string;
  readonly auth: ProviderAuthState | null;
  readonly installation: ProviderInstallState | null;
  readonly callbackUrl: string;
};

export type ProviderSetupCommand =
  | { readonly type: "start-install" }
  | { readonly type: "cancel-install"; readonly operationId: string }
  | { readonly type: "remove-install" }
  | { readonly type: "start-auth" }
  | { readonly type: "complete-auth"; readonly flowId: string; readonly callbackUrl: string }
  | { readonly type: "cancel-auth"; readonly flowId: string }
  | { readonly type: "logout" };

export type ProviderSetupActionDecision =
  | { readonly kind: "none" }
  | { readonly kind: "run"; readonly label: string; readonly command: ProviderSetupCommand }
  | {
      readonly kind: "confirm-then-run";
      readonly message: string;
      readonly label: string;
      readonly command: ProviderSetupCommand;
    }
  | { readonly kind: "open-external"; readonly url: string; readonly failureMessage: string }
  | {
      readonly kind: "copy";
      readonly text: string;
      readonly label: string;
      readonly flowId: string | null;
      readonly failureMessage: string;
    };

const NO_ACTION: ProviderSetupActionDecision = { kind: "none" };

export function resolveProviderSetupAction(
  intent: ProviderSetupIntent,
  context: ProviderSetupActionContext,
): ProviderSetupActionDecision {
  const { auth, installation } = context;
  const authorizationUrl = auth?.phase === "waiting" ? auth.authorizationUrl : null;
  switch (intent.kind) {
    case "start-install":
      return { kind: "run", label: "Starting installation", command: { type: "start-install" } };
    case "cancel-install": {
      const operationId = installation?.operationId;
      if (!operationId) return NO_ACTION;
      return {
        kind: "run",
        label: "Cancelling installation",
        command: { type: "cancel-install", operationId },
      };
    }
    case "remove-runtime":
      return {
        kind: "confirm-then-run",
        message: `Remove the downloaded Antigravity runtime from ${context.environmentLabel}? Google sign-in and thread history are kept.`,
        label: "Removing runtime",
        command: { type: "remove-install" },
      };
    case "open-sign-in-page":
      if (!authorizationUrl) return NO_ACTION;
      return {
        kind: "open-external",
        url: authorizationUrl,
        failureMessage:
          "Could not open the sign-in page. Copy the link and open it in your browser.",
      };
    case "copy-sign-in-link":
      if (!authorizationUrl) return NO_ACTION;
      return {
        kind: "copy",
        text: authorizationUrl,
        label: "Google sign-in link",
        flowId: auth?.flowId ?? null,
        failureMessage: "Could not copy the sign-in link. Use Open sign-in page.",
      };
    case "submit-callback": {
      const flowId = auth?.flowId;
      if (!flowId || !context.callbackUrl.trim() || auth.phase !== "waiting") return NO_ACTION;
      return {
        kind: "run",
        label: "Checking redirect",
        command: { type: "complete-auth", flowId, callbackUrl: context.callbackUrl },
      };
    }
    case "start-sign-in":
      return { kind: "run", label: "Starting sign-in", command: { type: "start-auth" } };
    case "cancel-sign-in": {
      const flowId = auth?.flowId;
      if (!flowId) return NO_ACTION;
      return { kind: "run", label: "Cancelling sign-in", command: { type: "cancel-auth", flowId } };
    }
    case "sign-out":
      return {
        kind: "confirm-then-run",
        message: `${context.authMethod === "oauth-personal" || context.authMethod === "oauth-business" ? "Sign out of Google" : "Disconnect"} for ${context.providerDisplayName ?? "Antigravity"} on ${context.environmentLabel}? This stops its running threads. Thread history is kept.`,
        label: "Signing out",
        command: { type: "logout" },
      };
  }
}
