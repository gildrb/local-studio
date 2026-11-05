import type { ConnectionTarget } from "@t3tools/client-runtime/connection";
import type {
  AgentSessionProjectCandidate,
  AgentSessionSource,
  ExecutionEnvironmentPlatformOs,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerProvider,
  ServerSettings,
} from "@t3tools/contracts";
import { defaultInstanceIdForDriver, EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  groupOnboardingProjects,
  onboardingProjectKey,
  partitionOnboardingProjects,
  type OnboardingProjectGroup,
} from "../../onboarding/projectImport.logic";
import {
  getOnboardingProviderState,
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
  selectOnboardingProvidersByDriver,
} from "../../onboarding/providerReadiness.logic";
import { isOnboardingRelayEnvironment } from "../../onboarding/targetEnvironment.logic";
import { formatRelativeTime } from "../../timestampFormat";
import { getProviderSummary } from "../settings/providerStatus";
import { readCodexSetupMode } from "../settings/CodexSetupSection.logic";

export type WelcomeWizardStep = "connection" | "agents" | "import";

export type WelcomeWizardState = {
  readonly step: WelcomeWizardStep;
  readonly setupIds: ReadonlyArray<EnvironmentId>;
};

export type WelcomeWizardEvent =
  | { readonly type: "continueConnection"; readonly environmentIds: ReadonlyArray<EnvironmentId> }
  | { readonly type: "continueAgents" }
  | { readonly type: "selectStage"; readonly index: number; readonly isImporting: boolean };

export const WELCOME_WIZARD_STAGES = ["Connect", "Agents", "Projects"] as const;
export const ONBOARDING_SCAN_LIMIT_MESSAGE =
  "Scan limit reached. Some projects or conversations may be missing.";

export function resolveInitialWelcomeWizardState(
  resumeEnvironmentId: EnvironmentId | undefined,
): WelcomeWizardState {
  return resumeEnvironmentId
    ? { step: "agents", setupIds: [resumeEnvironmentId] }
    : { step: "connection", setupIds: [] };
}

export function resolveWelcomeWizardStageIndex(step: WelcomeWizardStep): number {
  return step === "agents" ? 1 : step === "import" ? 2 : 0;
}

export function transitionWelcomeWizardState(
  state: WelcomeWizardState,
  event: WelcomeWizardEvent,
): WelcomeWizardState {
  switch (event.type) {
    case "continueConnection":
      return event.environmentIds.length === 0
        ? state
        : { step: "agents", setupIds: event.environmentIds };
    case "continueAgents":
      return { ...state, step: "import" };
    case "selectStage": {
      if (event.isImporting || event.index > resolveWelcomeWizardStageIndex(state.step)) {
        return state;
      }
      return { ...state, step: event.index === 0 ? "connection" : "agents" };
    }
  }
}

const decodeEnvironmentId = Schema.decodeOption(EnvironmentId);

export function resolveWelcomeResumeEnvironmentId(hash: string): EnvironmentId | undefined {
  return hash.startsWith("agents:")
    ? Option.getOrUndefined(decodeEnvironmentId(hash.slice("agents:".length)))
    : undefined;
}

export type WelcomeRouteAuthGateState = { readonly status: string };

export type WelcomeRouteAccess =
  | { readonly kind: "redirect"; readonly to: "/pair" }
  | { readonly kind: "render"; readonly localAvailable: boolean };

export function resolveWelcomeRouteAccess(
  authGateState: WelcomeRouteAuthGateState,
): WelcomeRouteAccess {
  if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
    return { kind: "redirect", to: "/pair" };
  }
  return { kind: "render", localAvailable: authGateState.status === "authenticated" };
}

export function resolveWelcomeWizardVisible(input: {
  readonly isWelcomeRoute: boolean;
  readonly dismissed: boolean;
}): boolean {
  return input.isWelcomeRoute && !input.dismissed;
}

export type WelcomeWizardStageModel = {
  readonly index: number;
  readonly label: string;
  readonly current: boolean;
  readonly disabled: boolean;
};

export type WelcomeWizardHeaderInput = {
  readonly step: WelcomeWizardStep;
  readonly isImporting: boolean;
  readonly isLoadingProjects: boolean;
};

export type WelcomeWizardHeaderModel = {
  readonly title: string;
  readonly brandLabel: string;
  readonly brandImageSrc: string;
  readonly stageIndex: number;
  readonly stageLabels: ReadonlyArray<string>;
  readonly stages: ReadonlyArray<WelcomeWizardStageModel>;
  readonly holdHeight: boolean;
};

export function buildWelcomeWizardHeaderModel(
  input: WelcomeWizardHeaderInput,
): WelcomeWizardHeaderModel {
  const stageIndex = resolveWelcomeWizardStageIndex(input.step);
  return {
    title: "Set up Local Studio",
    brandLabel: "Local Studio",
    brandImageSrc: "/local-studio.png",
    stageIndex,
    stageLabels: [...WELCOME_WIZARD_STAGES],
    stages: WELCOME_WIZARD_STAGES.map((label, index) => ({
      index,
      label,
      current: index === stageIndex,
      disabled: input.isImporting || index >= stageIndex,
    })),
    holdHeight: input.isLoadingProjects,
  };
}

export function resolveWelcomeWizardSelectedIds(
  selection: ReadonlyArray<EnvironmentId> | null,
  primaryEnvironmentId: EnvironmentId | null,
): ReadonlyArray<EnvironmentId> {
  return selection ?? (primaryEnvironmentId ? [primaryEnvironmentId] : []);
}

export function toggleWelcomeWizardSelection(
  selectedIds: ReadonlyArray<EnvironmentId>,
  environmentId: EnvironmentId,
  checked: boolean,
): ReadonlyArray<EnvironmentId> {
  const next = new Set(selectedIds);
  if (checked) next.add(environmentId);
  else next.delete(environmentId);
  return [...next];
}

export type OnboardingEnvironmentInput = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl?: string | null | undefined;
  readonly connection: { readonly phase: string };
  readonly entry: { readonly target: ConnectionTarget };
};

export function resolveWelcomeWizardSetupIds(
  environments: ReadonlyArray<Pick<OnboardingEnvironmentInput, "environmentId">>,
  selectedIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<EnvironmentId> {
  return environments
    .filter((environment) => selectedIds.includes(environment.environmentId))
    .map((environment) => environment.environmentId);
}

export function isWelcomeConnectionReady(
  environments: ReadonlyArray<Pick<OnboardingEnvironmentInput, "environmentId" | "connection">>,
  selectedIds: ReadonlyArray<EnvironmentId>,
): boolean {
  return (
    selectedIds.length > 0 &&
    selectedIds.every((id) =>
      environments.some(
        (environment) =>
          environment.environmentId === id && environment.connection.phase === "connected",
      ),
    )
  );
}

export type OnboardingCommandBlockModel = {
  readonly prompt: string;
  readonly command: string;
  readonly copyLabel: string;
};

function commandBlock(command: string): OnboardingCommandBlockModel {
  return { prompt: "$", command, copyLabel: "Copy command" };
}

export type OnboardingTextSegment = { readonly kind: "text" | "code"; readonly text: string };

export type OnboardingPairingFormInput = {
  readonly pairingUrl: string;
  readonly errorMessage: string;
  readonly isPairing: boolean;
};

export type OnboardingPairingFormModel = {
  readonly inputId: string;
  readonly errorId: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly readOnly: boolean;
  readonly invalid: boolean;
  readonly errorMessage: string | null;
  readonly helpToggleLabel: string;
  readonly helpText: string;
  readonly helpCommand: OnboardingCommandBlockModel;
  readonly helpFootnote: ReadonlyArray<OnboardingTextSegment>;
  readonly submit: { readonly label: string; readonly enabled: boolean };
};

export function buildOnboardingPairingFormModel(
  input: OnboardingPairingFormInput,
): OnboardingPairingFormModel {
  return {
    inputId: "onboarding-pairing-url",
    errorId: "onboarding-pairing-error",
    label: "Pairing link",
    placeholder: "https://your-server:5230/pair#token=…",
    value: input.pairingUrl,
    readOnly: input.isPairing,
    invalid: input.errorMessage.length > 0,
    errorMessage: input.errorMessage ? input.errorMessage : null,
    helpToggleLabel: "Need a pairing link?",
    helpText: "Run this on the computer with your code.",
    helpCommand: commandBlock("npx t3 pair"),
    helpFootnote: [
      { kind: "text", text: "Start T3 Code first, or run " },
      { kind: "code", text: "npx t3 serve" },
      { kind: "text", text: ". Add " },
      { kind: "code", text: "--tailscale" },
      { kind: "text", text: " to use your tailnet." },
    ],
    submit: {
      label: input.isPairing ? "Pairing..." : "Pair",
      enabled: !input.isPairing && input.pairingUrl.trim().length > 0,
    },
  };
}

export type OnboardingPairingSubmitDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "submit"; readonly pairingUrl: string };

export function resolveOnboardingPairingSubmit(input: {
  readonly isPairing: boolean;
  readonly pairingUrl: string;
}): OnboardingPairingSubmitDecision {
  const pairingUrl = input.pairingUrl.trim();
  if (input.isPairing || pairingUrl.length === 0) return { kind: "ignore" };
  return { kind: "submit", pairingUrl };
}

export function describeOnboardingPairingFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Pairing failed.";
}

export type OnboardingCloudOptionInput = {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
  readonly discoveryReady: boolean;
  readonly expanded: boolean;
  readonly disabled: boolean;
};

export type OnboardingCloudOptionModel = {
  readonly label: string;
  readonly statusLabel: string | null;
  readonly open: boolean;
  readonly chevronExpanded: boolean;
  readonly triggerDisabled: boolean;
  readonly showComputers: boolean;
  readonly emptyLabel: string;
  readonly instructions: string;
  readonly command: OnboardingCommandBlockModel;
  readonly footnote: string;
};

export function buildOnboardingCloudOptionModel(
  input: OnboardingCloudOptionInput,
): OnboardingCloudOptionModel {
  return {
    label: "T3 Connect",
    statusLabel: !input.isLoaded
      ? "Loading sign-in…"
      : !input.isSignedIn
        ? "Sign in"
        : !input.discoveryReady
          ? "Loading computers…"
          : null,
    open: input.expanded && input.isSignedIn && input.discoveryReady,
    chevronExpanded: input.expanded && input.isSignedIn,
    triggerDisabled: input.disabled || !input.isLoaded,
    showComputers: input.isSignedIn,
    emptyLabel: "No computers linked yet.",
    instructions: "Run this on each computer you want to connect.",
    command: commandBlock("npx t3 connect"),
    footnote: "Keep T3 Code running. Select the computers you want to set up above.",
  };
}

export type OnboardingCloudTriggerDecision =
  | { readonly kind: "openAuthPrompt" }
  | { readonly kind: "toggle" };

export function resolveOnboardingCloudTrigger(isSignedIn: boolean): OnboardingCloudTriggerDecision {
  return isSignedIn ? { kind: "toggle" } : { kind: "openAuthPrompt" };
}

export type WelcomeConnectionStepInput = {
  readonly environments: ReadonlyArray<OnboardingEnvironmentInput>;
  readonly selectedIds: ReadonlyArray<EnvironmentId>;
  readonly cloudEnabled: boolean;
  readonly cloud: Omit<OnboardingCloudOptionInput, "disabled"> | null;
  readonly isPairing: boolean;
  readonly pairingOpen: boolean;
  readonly expandPairingInitially: boolean;
  readonly pairingForm: Omit<OnboardingPairingFormInput, "isPairing">;
};

export type WelcomeConnectionRowModel = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly statusLabel: string;
  readonly displayUrl: string | null;
  readonly checked: boolean;
};

export type WelcomeConnectionStepModel = {
  readonly kind: "connection";
  readonly heading: string;
  readonly description: string;
  readonly legend: string;
  readonly rows: ReadonlyArray<WelcomeConnectionRowModel>;
  readonly cloud: OnboardingCloudOptionModel | null;
  readonly pairing: {
    readonly label: string;
    readonly open: boolean;
    readonly triggerDisabled: boolean;
    readonly form: OnboardingPairingFormModel;
  };
  readonly ready: boolean;
  readonly continueButton: {
    readonly label: string;
    readonly enabled: boolean;
    readonly autoFocus: boolean;
  };
};

export function buildWelcomeConnectionStepModel(
  input: WelcomeConnectionStepInput,
): WelcomeConnectionStepModel {
  const ready = isWelcomeConnectionReady(input.environments, input.selectedIds);
  return {
    kind: "connection",
    heading: "Connect your computers",
    description: "Choose one or more computers. We’ll set up agents and projects on each.",
    legend: "Computers to set up",
    rows: input.environments
      .filter((environment) => !input.cloudEnabled || !isOnboardingRelayEnvironment(environment))
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        statusLabel: environment.connection.phase === "connected" ? "Connected" : "Connecting…",
        displayUrl: environment.displayUrl ? environment.displayUrl : null,
        checked: input.selectedIds.includes(environment.environmentId),
      })),
    cloud:
      input.cloudEnabled && input.cloud !== null
        ? buildOnboardingCloudOptionModel({ ...input.cloud, disabled: input.isPairing })
        : null,
    pairing: {
      label: "Add a computer",
      open: input.pairingOpen,
      triggerDisabled: input.isPairing,
      form: buildOnboardingPairingFormModel({ ...input.pairingForm, isPairing: input.isPairing }),
    },
    ready,
    continueButton: {
      label: "Continue",
      enabled: ready && !input.isPairing,
      autoFocus: !input.expandPairingInitially,
    },
  };
}

export const ONBOARDING_AGENT_DRIVERS = ["codex", "claudeAgent"] as const;
export type OnboardingAgentDriver = (typeof ONBOARDING_AGENT_DRIVERS)[number];

const ONBOARDING_AGENT_LABELS: Record<OnboardingAgentDriver, string> = {
  codex: "Codex",
  claudeAgent: "Claude Code",
};

export type OnboardingCreatedAccount = {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly autoStart: boolean;
};

export type OnboardingPrimaryAgent = {
  readonly driver: OnboardingAgentDriver;
  readonly provider: ServerProvider | undefined;
  readonly instanceId: ProviderInstanceId | undefined;
};

export function resolveOnboardingPrimaryAgents(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
  createdAccount: Pick<OnboardingCreatedAccount, "instanceId"> | null,
): ReadonlyArray<OnboardingPrimaryAgent> {
  const byDriver = selectOnboardingProvidersByDriver(providers);
  const primaryAgents: OnboardingPrimaryAgent[] = ONBOARDING_AGENT_DRIVERS.flatMap((driver) => {
    const instances =
      driver === "codex" ? providers?.filter((provider) => provider.driver === driver) : undefined;
    return instances?.length
      ? instances.map((provider) => ({ driver, provider, instanceId: provider.instanceId }))
      : [{ driver, provider: byDriver.get(driver), instanceId: byDriver.get(driver)?.instanceId }];
  });
  if (createdAccount) {
    const index = primaryAgents.findIndex(
      (agent) => agent.instanceId === createdAccount.instanceId,
    );
    const [existing] = index >= 0 ? primaryAgents.splice(index, 1) : [];
    primaryAgents.unshift(
      existing ?? { driver: "codex", provider: undefined, instanceId: createdAccount.instanceId },
    );
  }
  return primaryAgents;
}

export function canAddOnboardingCodexAccount(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): boolean {
  return (
    providers?.some(
      (provider) => provider.driver === "codex" && getOnboardingProviderState(provider) === "ready",
    ) ?? false
  );
}

export type OnboardingAgentCardStatusModel =
  | { readonly kind: "ready"; readonly label: string }
  | { readonly kind: "text"; readonly label: string }
  | {
      readonly kind: "action";
      readonly label: string;
      readonly icon: "terminal";
      readonly enabled: boolean;
    };

export type OnboardingAgentCardInput = {
  readonly driver: OnboardingAgentDriver;
  readonly provider: ServerProvider | undefined;
  readonly terminalOpen: boolean;
  readonly terminalAvailable: boolean;
};

export type OnboardingAgentCardModel = {
  readonly driver: OnboardingAgentDriver;
  readonly icon: OnboardingAgentDriver;
  readonly iconFilled: boolean;
  readonly displayName: string;
  readonly description: string;
  readonly status: OnboardingAgentCardStatusModel;
};

export function buildOnboardingAgentCardModel(
  input: OnboardingAgentCardInput,
): OnboardingAgentCardModel {
  const { driver, provider } = input;
  const summary = getProviderSummary(provider);
  const providerState = getOnboardingProviderState(provider);
  const ready = providerState === "ready";
  return {
    driver,
    icon: driver,
    iconFilled: driver !== "claudeAgent",
    displayName: provider?.displayName || ONBOARDING_AGENT_LABELS[driver],
    description: ready
      ? "Ready to code."
      : `${summary.headline}${summary.detail ? ` · ${summary.detail}` : ""}`,
    status: ready
      ? { kind: "ready", label: "Ready" }
      : providerState === "checking"
        ? { kind: "text", label: "Checking..." }
        : providerState === "disabled"
          ? { kind: "text", label: "Disabled" }
          : providerState === "attention"
            ? { kind: "text", label: summary.headline }
            : {
                kind: "action",
                label: providerState === "signIn" ? "Sign in" : "Install",
                icon: "terminal",
                enabled: !input.terminalOpen && input.terminalAvailable,
              },
  };
}

export type OnboardingAgentTerminalCommandInput = {
  readonly driver: OnboardingAgentDriver;
  readonly provider: ServerProvider;
  readonly settings: ServerSettings;
  readonly platform: ExecutionEnvironmentPlatformOs;
};

export function resolveOnboardingAgentTerminalCommand(
  input: OnboardingAgentTerminalCommandInput,
): string {
  return input.provider.installed
    ? resolveOnboardingProviderLoginCommand(input.provider, input.settings, input.platform)
    : resolveOnboardingProviderInstallCommand(input.driver, input.platform);
}

export type OnboardingAgentsSectionInput = {
  readonly environmentId: EnvironmentId;
  readonly machineLabel: string;
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly createdAccountInstanceId: ProviderInstanceId | null;
  readonly terminalDriver: OnboardingAgentDriver | null;
  readonly serverConfigAvailable: boolean;
};

export type OnboardingAgentsSectionModel = {
  readonly environmentId: EnvironmentId;
  readonly heading: string;
  readonly cards: ReadonlyArray<
    | { readonly kind: "codexSetup"; readonly key: string }
    | { readonly kind: "card"; readonly key: string; readonly card: OnboardingAgentCardModel }
  >;
  readonly addAccountLabel: string | null;
};

export function buildOnboardingAgentsSectionModel(
  input: OnboardingAgentsSectionInput,
): OnboardingAgentsSectionModel {
  return {
    environmentId: input.environmentId,
    heading: input.machineLabel,
    cards: resolveOnboardingPrimaryAgents(
      input.providers,
      input.createdAccountInstanceId === null
        ? null
        : { instanceId: input.createdAccountInstanceId },
    ).map(({ driver, provider, instanceId }) =>
      driver === "codex" && input.serverConfigAvailable
        ? { kind: "codexSetup", key: instanceId ?? driver }
        : {
            kind: "card",
            key: driver,
            card: buildOnboardingAgentCardModel({
              driver,
              provider,
              terminalOpen: input.terminalDriver === driver,
              terminalAvailable: input.serverConfigAvailable,
            }),
          },
    ),
    addAccountLabel: canAddOnboardingCodexAccount(input.providers)
      ? "Connect another ChatGPT account"
      : null,
  };
}

export function resolveOnboardingMachineLabel(
  environments: ReadonlyArray<Pick<OnboardingEnvironmentInput, "environmentId" | "label">>,
  environmentId: EnvironmentId,
): string {
  return (
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "Computer"
  );
}

export type WelcomeAgentsStepInput = {
  readonly sections: ReadonlyArray<OnboardingAgentsSectionInput>;
};

export type WelcomeAgentsStepModel = {
  readonly kind: "agents";
  readonly heading: string;
  readonly description: string;
  readonly sections: ReadonlyArray<OnboardingAgentsSectionModel>;
  readonly continueButton: { readonly label: string; readonly enabled: boolean };
};

export function buildWelcomeAgentsStepModel(input: WelcomeAgentsStepInput): WelcomeAgentsStepModel {
  return {
    kind: "agents",
    heading: "Connect your agents",
    description: "Choose an agent to start coding. You can add more later.",
    sections: input.sections.map(buildOnboardingAgentsSectionModel),
    continueButton: { label: "Continue", enabled: true },
  };
}

export type OnboardingCodexSetupInput = {
  readonly settings: ServerSettings;
  readonly providerInstanceId: ProviderInstanceId | undefined;
  readonly createdAccount: Pick<OnboardingCreatedAccount, "instanceId"> | null;
};

export type OnboardingCodexSetup = {
  readonly instanceId: ProviderInstanceId;
  readonly isDefault: boolean;
  readonly instance: ProviderInstanceConfig;
  readonly mode: "managed" | "existing";
  readonly existingChosen: boolean;
};

export function resolveOnboardingCodexSetup(
  input: OnboardingCodexSetupInput,
): OnboardingCodexSetup {
  const codex = ProviderDriverKind.make("codex");
  const defaultInstanceId = defaultInstanceIdForDriver(codex);
  const instanceId =
    input.createdAccount?.instanceId ?? input.providerInstanceId ?? defaultInstanceId;
  const settings = input.settings;
  const instance: ProviderInstanceConfig = settings.providerInstances[instanceId] ?? {
    driver: codex,
    enabled: settings.providers.codex.enabled,
    config: input.createdAccount
      ? { enabled: true, setupMode: "managed" }
      : settings.providers.codex,
  };
  const mode = readCodexSetupMode(instance.config);
  return {
    instanceId,
    isDefault: instanceId === defaultInstanceId,
    instance,
    mode,
    existingChosen:
      mode === "existing" &&
      instance.config !== null &&
      typeof instance.config === "object" &&
      "setupMode" in instance.config &&
      instance.config.setupMode === "existing",
  };
}

export function resolveOnboardingCodexModeInstance(
  instance: ProviderInstanceConfig,
  setupMode: "managed" | "existing",
): ProviderInstanceConfig {
  return {
    ...instance,
    enabled: true,
    config: {
      ...(instance.config !== null && typeof instance.config === "object" ? instance.config : {}),
      enabled: true,
      setupMode,
    },
  };
}

export type OnboardingAgentTerminalSetupState =
  | "preparing"
  | "ready"
  | "openFailed"
  | "writeFailed";

export type OnboardingAgentTerminalModel = {
  readonly message:
    | { readonly kind: "runCommand"; readonly command: string }
    | { readonly kind: "text"; readonly text: string };
  readonly retryLabel: string | null;
  readonly closeLabel: string;
  readonly showViewport: boolean;
  readonly terminalLabel: string;
};

export function buildOnboardingAgentTerminalModel(input: {
  readonly setupState: OnboardingAgentTerminalSetupState;
  readonly command: string;
  readonly driver: OnboardingAgentDriver;
}): OnboardingAgentTerminalModel {
  const { setupState } = input;
  return {
    message:
      setupState === "writeFailed"
        ? { kind: "runCommand", command: input.command }
        : {
            kind: "text",
            text:
              setupState === "ready"
                ? "Review the command, then press Enter to run it."
                : setupState === "openFailed"
                  ? "Could not open the setup terminal."
                  : "Preparing command...",
          },
    retryLabel: setupState === "openFailed" ? "Retry" : null,
    closeLabel: "Close",
    showViewport: setupState === "ready" || setupState === "writeFailed",
    terminalLabel: `Install ${input.driver}`,
  };
}

export type OnboardingImportCandidate = AgentSessionProjectCandidate & {
  readonly environmentId: EnvironmentId;
  readonly key: string;
};

export type OnboardingImportScanInput = {
  readonly environmentId: EnvironmentId;
  readonly data: {
    readonly candidates: ReadonlyArray<AgentSessionProjectCandidate>;
    readonly truncated?: boolean | undefined;
  } | null;
  readonly error: string | null;
  readonly isPending: boolean;
};

export type OnboardingImportCandidates = {
  readonly available: ReadonlyArray<OnboardingImportCandidate>;
  readonly recent: ReadonlyArray<OnboardingImportCandidate>;
};

export function resolveOnboardingImportCandidates(
  scans: ReadonlyArray<Pick<OnboardingImportScanInput, "environmentId" | "data">>,
  nowMs: number,
): OnboardingImportCandidates {
  return partitionOnboardingProjects(
    scans.flatMap((scan) =>
      (scan.data?.candidates ?? []).map((candidate) => ({
        ...candidate,
        environmentId: scan.environmentId,
        key: onboardingProjectKey(scan.environmentId, candidate.path),
      })),
    ),
    nowMs,
  );
}

export function resolveOnboardingImportSelectedKeys(
  selectedKeys: ReadonlyArray<string> | null,
  recent: ReadonlyArray<Pick<OnboardingImportCandidate, "key">>,
): ReadonlyArray<string> {
  return selectedKeys ?? recent.map((candidate) => candidate.key);
}

export function isOnboardingImportLoading(
  scans: ReadonlyArray<Pick<OnboardingImportScanInput, "data" | "isPending">>,
): boolean {
  return scans.every((scan) => scan.data === null) && scans.some((scan) => scan.isPending);
}

export function setOnboardingImportKeys(
  selectedKeys: ReadonlyArray<string>,
  keys: ReadonlyArray<string>,
  checked: boolean,
): ReadonlyArray<string> {
  const next = new Set(selectedKeys);
  for (const key of keys) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  return [...next];
}

export type OnboardingImportSourceSlot = {
  readonly icon: "claude" | "codex" | "pi";
  readonly label: string;
} | null;

export type OnboardingImportRowMetaModel = {
  readonly sourceSlots: ReadonlyArray<OnboardingImportSourceSlot>;
  readonly threadCount: string;
  readonly age: string;
};

export function buildOnboardingImportRowMetaModel(input: {
  readonly sources: ReadonlyArray<AgentSessionSource> | null;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
  readonly nowMs: number;
}): OnboardingImportRowMetaModel {
  const relative =
    input.lastActiveAt === null ? null : formatRelativeTime(input.lastActiveAt, input.nowMs);
  const sources = input.sources;
  return {
    sourceSlots: [
      sources?.includes("claudeAgent") ? { icon: "claude", label: "Claude Code" } : null,
      sources?.includes("codex") ? { icon: "codex", label: "Codex" } : null,
      sources?.some((source) => source === "piAgent" || source === "omp")
        ? { icon: "pi", label: "Pi / Oh My Pi" }
        : null,
    ],
    threadCount: String(input.threadCount),
    age: relative === null ? "" : relative.suffix === null ? "now" : relative.value,
  };
}

export type OnboardingImportRowModel = {
  readonly key: string;
  readonly label: string;
  readonly secondary: string | null;
  readonly tooltip: string;
  readonly nested: boolean;
  readonly checked: boolean;
  readonly meta: OnboardingImportRowMetaModel;
};

function buildImportRow(
  candidate: OnboardingImportCandidate,
  label: string,
  secondary: string | null,
  nested: boolean,
  selectedKeys: ReadonlySet<string>,
  nowMs: number,
): OnboardingImportRowModel {
  return {
    key: candidate.key,
    label,
    secondary,
    tooltip: candidate.path,
    nested,
    checked: selectedKeys.has(candidate.key),
    meta: buildOnboardingImportRowMetaModel({
      sources: nested ? null : candidate.sources,
      threadCount: candidate.threadCount,
      lastActiveAt: candidate.lastActiveAt,
      nowMs,
    }),
  };
}

export type OnboardingImportGroupModel =
  | { readonly kind: "row"; readonly row: OnboardingImportRowModel }
  | {
      readonly kind: "group";
      readonly key: string;
      readonly label: string;
      readonly keys: ReadonlyArray<string>;
      readonly checked: boolean;
      readonly indeterminate: boolean;
      readonly meta: OnboardingImportRowMetaModel;
      readonly rows: ReadonlyArray<OnboardingImportRowModel>;
    };

export function buildOnboardingImportGroupModel(
  group: OnboardingProjectGroup<OnboardingImportCandidate>,
  selectedKeys: ReadonlySet<string>,
  nowMs: number,
): OnboardingImportGroupModel {
  const keys = group.candidates.map((candidate) => candidate.key);
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  const only = group.candidates[0];
  if (group.candidates.length === 1 && only !== undefined) {
    return {
      kind: "row",
      row: buildImportRow(
        only,
        group.label,
        group.repository === null ? null : only.path,
        false,
        selectedKeys,
        nowMs,
      ),
    };
  }
  return {
    kind: "group",
    key: group.key,
    label: group.label,
    keys,
    checked: selectedCount === keys.length,
    indeterminate: selectedCount > 0 && selectedCount < keys.length,
    meta: buildOnboardingImportRowMetaModel({
      sources: [...new Set(group.candidates.flatMap((candidate) => candidate.sources))],
      threadCount: group.threadCount,
      lastActiveAt: group.lastActiveAt,
      nowMs,
    }),
    rows: group.candidates.map((candidate) =>
      buildImportRow(candidate, candidate.path, null, true, selectedKeys, nowMs),
    ),
  };
}

export type OnboardingImportOtherModel = {
  readonly label: string;
  readonly countLabel: string;
  readonly keys: ReadonlyArray<string>;
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly rows: ReadonlyArray<OnboardingImportRowModel>;
};

export type OnboardingImportListModel = {
  readonly groups: ReadonlyArray<OnboardingImportGroupModel>;
  readonly other: OnboardingImportOtherModel | null;
};

export function buildOnboardingImportListModel(input: {
  readonly candidates: ReadonlyArray<OnboardingImportCandidate>;
  readonly selectedKeys: ReadonlyArray<string>;
  readonly nowMs: number;
}): OnboardingImportListModel {
  const selectedKeys = new Set(input.selectedKeys);
  const { repositories, other } = groupOnboardingProjects(input.candidates);
  const otherSelected = other.filter((candidate) => selectedKeys.has(candidate.key)).length;
  return {
    groups: repositories.map((group) =>
      buildOnboardingImportGroupModel(group, selectedKeys, input.nowMs),
    ),
    other:
      other.length > 0
        ? {
            label: "Other folders",
            countLabel: `${other.length} ${other.length === 1 ? "folder" : "folders"}`,
            keys: other.map((candidate) => candidate.key),
            checked: otherSelected === other.length,
            indeterminate: otherSelected > 0 && otherSelected < other.length,
            rows: other.map((candidate) =>
              buildImportRow(candidate, candidate.path, null, true, selectedKeys, input.nowMs),
            ),
          }
        : null,
  };
}

export type OnboardingImportSectionStatus =
  | { readonly kind: "pending"; readonly label: string }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly retryLabel: string;
    }
  | { readonly kind: "empty"; readonly label: string }
  | { readonly kind: "none" };

export type OnboardingImportSectionModel = {
  readonly environmentId: EnvironmentId;
  readonly legend: string | null;
  readonly disabled: boolean;
  readonly status: OnboardingImportSectionStatus;
  readonly truncatedMessage: string | null;
  readonly list: OnboardingImportListModel;
};

export type WelcomeImportStepInput = {
  readonly scans: ReadonlyArray<OnboardingImportScanInput>;
  readonly environments: ReadonlyArray<Pick<OnboardingEnvironmentInput, "environmentId" | "label">>;
  readonly selectedKeys: ReadonlyArray<string> | null;
  readonly isImporting: boolean;
  readonly nowMs: number;
};

export type WelcomeImportStepModel =
  | {
      readonly kind: "importLoading";
      readonly heading: string;
      readonly message: string;
      readonly skipButton: { readonly label: string; readonly enabled: boolean };
    }
  | {
      readonly kind: "import";
      readonly heading: string;
      readonly description: string;
      readonly selection: {
        readonly summary: string;
        readonly selectAll: { readonly label: string; readonly enabled: boolean };
        readonly selectNone: { readonly label: string; readonly enabled: boolean };
      } | null;
      readonly selectedKeys: ReadonlyArray<string>;
      readonly allKeys: ReadonlyArray<string>;
      readonly sections: ReadonlyArray<OnboardingImportSectionModel>;
      readonly skipButton: { readonly label: string; readonly enabled: boolean };
      readonly importButton: { readonly label: string; readonly enabled: boolean };
    };

export function buildWelcomeImportStepModel(input: WelcomeImportStepInput): WelcomeImportStepModel {
  if (isOnboardingImportLoading(input.scans)) {
    return {
      kind: "importLoading",
      heading: "Your projects",
      message: "Looking for projects from Claude Code and Codex…",
      skipButton: { label: "Do not import projects", enabled: true },
    };
  }
  const { available, recent } = resolveOnboardingImportCandidates(input.scans, input.nowMs);
  const selectedKeys = resolveOnboardingImportSelectedKeys(input.selectedKeys, recent);
  const selectedCount = available.filter((candidate) =>
    selectedKeys.includes(candidate.key),
  ).length;
  return {
    kind: "import",
    heading: "Choose your projects",
    description: "Import projects and conversations from your selected computers.",
    selection:
      available.length > 0
        ? {
            summary: `${selectedCount} of ${available.length} selected`,
            selectAll: {
              label: "Select all",
              enabled: !input.isImporting && selectedCount !== available.length,
            },
            selectNone: {
              label: "Select none",
              enabled: !input.isImporting && selectedCount !== 0,
            },
          }
        : null,
    selectedKeys,
    allKeys: available.map((candidate) => candidate.key),
    sections: input.scans.map((scan) => {
      const scanCandidates = available.filter(
        (candidate) => candidate.environmentId === scan.environmentId,
      );
      return {
        environmentId: scan.environmentId,
        legend:
          input.scans.length > 1
            ? resolveOnboardingMachineLabel(input.environments, scan.environmentId)
            : null,
        disabled: input.isImporting,
        status:
          scan.isPending && scan.data === null
            ? { kind: "pending", label: "Looking for projects…" }
            : scan.error !== null
              ? {
                  kind: "error",
                  message: `Could not check projects. ${scan.error}`,
                  retryLabel: "Retry",
                }
              : scanCandidates.length === 0
                ? { kind: "empty", label: "No existing Claude Code or Codex projects found." }
                : { kind: "none" },
        truncatedMessage: scan.data?.truncated ? ONBOARDING_SCAN_LIMIT_MESSAGE : null,
        list: buildOnboardingImportListModel({
          candidates: scanCandidates,
          selectedKeys,
          nowMs: input.nowMs,
        }),
      };
    }),
    skipButton: { label: "Do not import projects", enabled: !input.isImporting },
    importButton: {
      label: input.isImporting
        ? "Importing…"
        : `Import ${selectedCount} ${selectedCount === 1 ? "project" : "projects"}`,
      enabled: !input.isImporting && selectedCount > 0,
    },
  };
}

export type OnboardingImportSubmitDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "finish" }
  | { readonly kind: "import" };

export function resolveOnboardingImportSubmit(input: {
  readonly isImporting: boolean;
  readonly selectionCount: number;
}): OnboardingImportSubmitDecision {
  if (input.isImporting) return { kind: "ignore" };
  if (input.selectionCount === 0) return { kind: "finish" };
  return { kind: "import" };
}

function pluralThreads(count: number): string {
  return `${count} ${count === 1 ? "thread" : "threads"}`;
}

export function resolveOnboardingImportWarning(input: {
  readonly importedProjectsCount: number;
  readonly selectionCount: number;
  readonly importedThreadCount: number;
  readonly skippedThreadCount: number;
}): string {
  const { importedThreadCount, skippedThreadCount } = input;
  if (input.importedProjectsCount >= input.selectionCount) return "";
  if (importedThreadCount > 0 && skippedThreadCount > 0) {
    return `Imported ${pluralThreads(importedThreadCount)}. ${pluralThreads(skippedThreadCount)} could not be imported.`;
  }
  if (skippedThreadCount > 0) {
    return `${skippedThreadCount} ${skippedThreadCount === 1 ? "thread could" : "threads could"} not be imported.`;
  }
  if (importedThreadCount > 0) {
    return `Imported ${pluralThreads(importedThreadCount)}. Some thread history could not be imported.`;
  }
  return "Could not import thread history.";
}

export type OnboardingFinishToast =
  | { readonly kind: "none" }
  | {
      readonly kind: "warning";
      readonly title: string;
      readonly description: string;
    }
  | { readonly kind: "success"; readonly title: string };

export function resolveOnboardingFinishToast(input: {
  readonly importWarning: string | undefined;
  readonly importedThreadCount: number;
}): OnboardingFinishToast {
  if (input.importWarning) {
    return {
      kind: "warning",
      title: "Some history was not imported",
      description: input.importWarning,
    };
  }
  if (input.importedThreadCount > 0) {
    return { kind: "success", title: `Imported ${pluralThreads(input.importedThreadCount)}` };
  }
  return { kind: "none" };
}

export const ONBOARDING_COMPLETION_ERROR = {
  title: "Could not finish setup",
  description: "Your settings could not be saved. Try again.",
} as const;

export type WelcomeWizardBodyInput =
  | ({ readonly kind: "connection" } & WelcomeConnectionStepInput)
  | ({ readonly kind: "agents" } & WelcomeAgentsStepInput)
  | ({ readonly kind: "import" } & Omit<WelcomeImportStepInput, "isImporting">);

export type WelcomeWizardInput = {
  readonly step: WelcomeWizardStep;
  readonly isImporting: boolean;
  readonly body: WelcomeWizardBodyInput;
};

export type WelcomeWizardModel = {
  readonly header: WelcomeWizardHeaderModel;
  readonly step: WelcomeWizardStep;
  readonly body: WelcomeConnectionStepModel | WelcomeAgentsStepModel | WelcomeImportStepModel;
};

export function buildWelcomeWizardModel(input: WelcomeWizardInput): WelcomeWizardModel {
  const body = input.body;
  return {
    header: buildWelcomeWizardHeaderModel({
      step: input.step,
      isImporting: input.isImporting,
      isLoadingProjects: body.kind === "import" && isOnboardingImportLoading(body.scans),
    }),
    step: input.step,
    body:
      body.kind === "connection"
        ? buildWelcomeConnectionStepModel(body)
        : body.kind === "agents"
          ? buildWelcomeAgentsStepModel(body)
          : buildWelcomeImportStepModel({ ...body, isImporting: input.isImporting }),
  };
}
