import type { AuthSessionState } from "@t3tools/contracts";

export type PairRouteAuthGateState =
  | { readonly status: "authenticated" }
  | { readonly status: "hosted-static" }
  | { readonly status: "hosted-pairing" }
  | {
      readonly status: "requires-auth";
      readonly auth: AuthSessionState["auth"];
      readonly errorMessage?: string;
    };

export type PairRouteAccess =
  | { readonly kind: "redirect"; readonly to: "/" }
  | { readonly kind: "render" };

export function resolvePairRouteAccess(authGateState: {
  readonly status: string;
}): PairRouteAccess {
  if (authGateState.status === "authenticated" || authGateState.status === "hosted-static") {
    return { kind: "redirect", to: "/" };
  }
  return { kind: "render" };
}

export type PairRouteView =
  | { readonly kind: "none" }
  | { readonly kind: "hosted" }
  | {
      readonly kind: "pairing";
      readonly auth: AuthSessionState["auth"];
      readonly initialErrorMessage: string | null;
    };

export function resolvePairRouteView(
  authGateState: PairRouteAuthGateState | null | undefined,
): PairRouteView {
  if (!authGateState) return { kind: "none" };
  if (authGateState.status === "hosted-pairing") return { kind: "hosted" };
  if (authGateState.status !== "requires-auth") return { kind: "none" };
  return {
    kind: "pairing",
    auth: authGateState.auth,
    initialErrorMessage: authGateState.errorMessage ? authGateState.errorMessage : null,
  };
}

export function describePairingError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Authentication failed.";
}

export function describePairingAuthGate(bootstrapMethods: ReadonlyArray<string>): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment expects a trusted pairing credential before the app can connect.";
  }
  return "Enter a pairing token to start a session with this environment.";
}

export function describePairingSupportedMethods(bootstrapMethods: ReadonlyArray<string>): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.";
  }
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.";
  }
  return "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.";
}

export type PairingAutoSubmitDecision =
  | { readonly kind: "none" }
  | { readonly kind: "submit"; readonly token: string };

export function resolvePairingAutoSubmit(input: {
  readonly token: string | null;
  readonly attempted: boolean;
}): PairingAutoSubmitDecision {
  if (!input.token || input.attempted) return { kind: "none" };
  return { kind: "submit", token: input.token };
}

export type HostedPairingStatus = "pairing" | "paired" | "error";

export type HostedPairingState = {
  readonly status: HostedPairingStatus;
  readonly message: string;
  readonly canRetry: boolean;
};

const HOSTED_PAIRING_CONNECTING = "Connecting to this backend.";
const HOSTED_PAIRING_MISSING = "This pairing link is missing its backend host or token.";

export function resolveInitialHostedPairingState(hasRequest: boolean): HostedPairingState {
  return hasRequest
    ? { status: "pairing", message: HOSTED_PAIRING_CONNECTING, canRetry: false }
    : { status: "error", message: HOSTED_PAIRING_MISSING, canRetry: false };
}

export type HostedPairingSubmitDecision =
  | { readonly kind: "fail"; readonly state: HostedPairingState }
  | { readonly kind: "submit"; readonly state: HostedPairingState };

export function resolveHostedPairingSubmit(input: {
  readonly hasRequest: boolean;
  readonly tokenSubmitted: boolean;
}): HostedPairingSubmitDecision {
  if (!input.hasRequest) {
    return {
      kind: "fail",
      state: { status: "error", message: HOSTED_PAIRING_MISSING, canRetry: false },
    };
  }
  if (input.tokenSubmitted) {
    return {
      kind: "fail",
      state: {
        status: "error",
        message: "This one-time pairing token was already submitted. Request a new pairing link.",
        canRetry: false,
      },
    };
  }
  return {
    kind: "submit",
    state: { status: "pairing", message: HOSTED_PAIRING_CONNECTING, canRetry: false },
  };
}

export function resolveHostedPairingSuccess(label: string): HostedPairingState {
  return {
    status: "paired",
    message: `${label || "The environment"} is saved in this browser.`,
    canRetry: false,
  };
}

export function resolveHostedPairingFailure(error: unknown): HostedPairingState {
  return {
    status: "error",
    message: `${describePairingError(error)} If the backend accepted this one-time token, request a new pairing link before retrying.`,
    canRetry: true,
  };
}

export type PairingScreenInput =
  | { readonly variant: "pending"; readonly appName: string }
  | {
      readonly variant: "token";
      readonly appName: string;
      readonly bootstrapMethods: ReadonlyArray<string>;
      readonly credential: string;
      readonly errorMessage: string;
      readonly isSubmitting: boolean;
    }
  | {
      readonly variant: "hosted";
      readonly appName: string;
      readonly state: HostedPairingState;
      readonly host: string | null;
    };

export type PairingScreenButtonModel = {
  readonly label: string;
  readonly enabled: boolean;
};

export type PairingScreenModel =
  | {
      readonly variant: "pending";
      readonly eyebrow: string;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly variant: "token";
      readonly eyebrow: string;
      readonly title: string;
      readonly description: string;
      readonly input: {
        readonly id: string;
        readonly label: string;
        readonly placeholder: string;
        readonly value: string;
        readonly disabled: boolean;
      };
      readonly errorMessage: string | null;
      readonly submit: PairingScreenButtonModel;
      readonly reload: PairingScreenButtonModel;
      readonly supportedMethods: string;
    }
  | {
      readonly variant: "hosted";
      readonly eyebrow: string;
      readonly title: string;
      readonly description: string;
      readonly hostLabel: string;
      readonly host: string | null;
      readonly errorHelp: string | null;
      readonly primary:
        | { readonly kind: "pairing"; readonly label: string; readonly enabled: boolean }
        | { readonly kind: "retry"; readonly label: string; readonly enabled: boolean }
        | null;
      readonly openApp: PairingScreenButtonModel | null;
    };

export function buildPairingScreenModel(input: PairingScreenInput): PairingScreenModel {
  switch (input.variant) {
    case "pending":
      return {
        variant: "pending",
        eyebrow: input.appName,
        title: "Pairing with this environment",
        description: "Validating the pairing link and preparing your session.",
      };
    case "token":
      return {
        variant: "token",
        eyebrow: input.appName,
        title: "Pair with this environment",
        description: describePairingAuthGate(input.bootstrapMethods),
        input: {
          id: "pairing-token",
          label: "Pairing token",
          placeholder: "Paste a one-time token or pairing secret",
          value: input.credential,
          disabled: input.isSubmitting,
        },
        errorMessage: input.errorMessage ? input.errorMessage : null,
        submit: {
          label: input.isSubmitting ? "Pairing..." : "Continue",
          enabled: !input.isSubmitting,
        },
        reload: { label: "Reload app", enabled: !input.isSubmitting },
        supportedMethods: describePairingSupportedMethods(input.bootstrapMethods),
      };
    case "hosted": {
      const { status, message, canRetry } = input.state;
      return {
        variant: "hosted",
        eyebrow: input.appName,
        title:
          status === "paired"
            ? "Backend paired"
            : status === "error"
              ? "Pairing failed"
              : "Pairing backend",
        description: message,
        hostLabel: "Host:",
        host: input.host,
        errorHelp:
          status === "error"
            ? "Verify the backend is reachable from this browser, supports CORS for hosted clients, and is served over HTTPS when opening this page from HTTPS."
            : null,
        primary:
          status === "pairing"
            ? { kind: "pairing", label: "Pairing...", enabled: false }
            : canRetry
              ? { kind: "retry", label: "Try again", enabled: true }
              : null,
        openApp: status === "paired" ? { label: "Open app", enabled: true } : null,
      };
    }
  }
}
