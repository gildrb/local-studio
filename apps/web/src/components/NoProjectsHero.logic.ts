export type NoProjectsHeroInput = {
  readonly scratchAvailable: boolean;
  readonly electron: boolean;
};

export type NoProjectsHeroModel = {
  readonly showTitlebar: boolean;
  readonly title: string;
  readonly description: string;
  readonly addProject: { readonly label: string; readonly icon: "plus" };
  readonly startWithoutProject: { readonly label: string; readonly icon: "scratch" } | null;
};

export function buildNoProjectsHeroModel(input: NoProjectsHeroInput): NoProjectsHeroModel {
  return {
    showTitlebar: input.electron,
    title: "What should we work on?",
    description: input.scratchAvailable
      ? "Add a project, or start without one."
      : "Add a project to start your first thread.",
    addProject: { label: "Add project", icon: "plus" },
    startWithoutProject: input.scratchAvailable
      ? { label: "Start without a project", icon: "scratch" }
      : null,
  };
}

export type HostedStaticOnboardingInput = {
  readonly appName: string;
  readonly cloudEnabled: boolean;
  readonly localEnvironmentOff: boolean;
  readonly electron: boolean;
};

export type HostedStaticOnboardingModel = {
  readonly appName: string;
  readonly electron: boolean;
  readonly icon: "link";
  readonly title: string;
  readonly descriptions: ReadonlyArray<string>;
  readonly action: { readonly label: string; readonly icon: "plus"; readonly to: string };
};

export function buildHostedStaticOnboardingModel(
  input: HostedStaticOnboardingInput,
): HostedStaticOnboardingModel {
  return {
    appName: input.appName,
    electron: input.electron,
    icon: "link",
    title: "Connect to a computer running T3 Code",
    descriptions: [
      "This app connects to T3 Code running on your computer or a server. Start the T3 Code desktop app or command-line server on that machine and keep it running.",
      input.localEnvironmentOff
        ? "The local environment is turned off. Connect a remote environment, or turn the local environment back on in Connections."
        : input.cloudEnabled
          ? "Enable T3 Connect on that machine, then open Connections here to sign in with the same account. You can also add the machine using a pairing link."
          : "Open Connections and add that machine using its pairing link. This app must be able to reach it.",
    ],
    action: { label: "Open Connections", icon: "plus", to: "/settings/connections" },
  };
}

export type DraftStartErrorModel = {
  readonly title: string;
  readonly description: string;
  readonly retry: { readonly label: string; readonly icon: "refresh" };
};

export function buildDraftStartErrorModel(): DraftStartErrorModel {
  return {
    title: "Couldn’t start a new thread",
    description: "The project is still available. Try opening the draft again.",
    retry: { label: "Try again", icon: "refresh" },
  };
}

export type ChatIndexView =
  | { readonly kind: "none" }
  | { readonly kind: "hostedOnboarding" }
  | { readonly kind: "landing" };

export function resolveChatIndexView(input: {
  readonly authStatus: string;
  readonly catalogReady: boolean;
  readonly environmentCount: number;
}): ChatIndexView {
  if (input.authStatus === "hosted-static") {
    if (!input.catalogReady) return { kind: "none" };
    if (input.environmentCount === 0) return { kind: "hostedOnboarding" };
  }
  return { kind: "landing" };
}

export type IndexDraftLandingView =
  | { readonly kind: "none" }
  | { readonly kind: "startError" }
  | { readonly kind: "noProjects" };

export function resolveIndexDraftLandingView(input: {
  readonly bootstrapped: boolean;
  readonly hasProject: boolean;
  readonly startFailed: boolean;
}): IndexDraftLandingView {
  if (!input.bootstrapped) return { kind: "none" };
  if (input.hasProject) return input.startFailed ? { kind: "startError" } : { kind: "none" };
  return { kind: "noProjects" };
}
