export type ConnectCliAuthInput = {
  readonly hasRequest: boolean;
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
};

export type ConnectCliAuthModel = {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly signIn: { readonly label: string } | null;
};

export function buildConnectCliAuthModel(input: ConnectCliAuthInput): ConnectCliAuthModel {
  if (!input.hasRequest) {
    return {
      eyebrow: "Authorization request",
      title: "This connect link is incomplete",
      description:
        "The link is missing its authorization request. Re-run `t3 connect` in your terminal and open the freshly printed URL.",
      signIn: null,
    };
  }
  return {
    eyebrow: "Browser authorization",
    title: "Connecting your terminal",
    description: input.isSignedIn
      ? "Redirecting to authorize T3 Connect for your CLI…"
      : "Sign in to continue authorizing T3 Connect for your CLI.",
    signIn: input.isLoaded && !input.isSignedIn ? { label: "Sign in" } : null,
  };
}

export type ConnectCliAuthEffect =
  | { readonly kind: "none" }
  | { readonly kind: "openSignIn" }
  | { readonly kind: "redirect" };

export function resolveConnectCliAuthEffect(
  input: ConnectCliAuthInput & {
    readonly signInOpened: boolean;
    readonly redirecting: boolean;
  },
): ConnectCliAuthEffect {
  if (!input.hasRequest || !input.isLoaded || input.redirecting) return { kind: "none" };
  if (!input.isSignedIn) return input.signInOpened ? { kind: "none" } : { kind: "openSignIn" };
  return { kind: "redirect" };
}
