import { randomUUID } from "node:crypto";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type ProjectId,
  type ScopedProjectRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolvePairRouteAccess } from "@t3tools/web/src/components/auth/PairingRouteSurface.logic.ts";
import {
  buildOnboardingAgentCardModel,
  buildOnboardingAgentTerminalModel,
  buildWelcomeWizardModel,
  describeOnboardingPairingFailure,
  ONBOARDING_COMPLETION_ERROR,
  resolveInitialWelcomeWizardState,
  resolveOnboardingAgentTerminalCommand,
  resolveOnboardingCodexSetup,
  resolveOnboardingFinishToast,
  resolveOnboardingImportCandidates,
  resolveOnboardingImportSubmit,
  resolveOnboardingImportWarning,
  resolveOnboardingPairingSubmit,
  resolveOnboardingPrimaryAgents,
  resolveWelcomeResumeEnvironmentId,
  resolveWelcomeRouteAccess,
  resolveWelcomeWizardSelectedIds,
  resolveWelcomeWizardSetupIds,
  resolveWelcomeWizardVisible,
  setOnboardingImportKeys,
  toggleWelcomeWizardSelection,
  transitionWelcomeWizardState,
  type OnboardingAgentCardModel,
  type OnboardingAgentDriver,
  type OnboardingAgentTerminalModel,
  type OnboardingAgentTerminalSetupState,
  type OnboardingCreatedAccount,
  type OnboardingImportCandidate,
  type OnboardingImportScanInput,
  type WelcomeConnectionStepModel,
  type WelcomeImportStepModel,
  type WelcomeWizardHeaderModel,
  type WelcomeWizardEvent,
  type WelcomeWizardState,
  type WelcomeWizardStep,
} from "@t3tools/web/src/components/onboarding/WelcomeWizard.logic.ts";
import {
  resolveOnboardingLandingProject,
  resolveOnboardingProjectId,
} from "@t3tools/web/src/onboarding/projectImport.logic.ts";
import { newProjectId } from "@t3tools/web/src/lib/utils.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { registerExternalTerminalSession } from "../terminalSessions.ts";
import { createFirstRunGate } from "./firstRunGate.ts";
import { createCodexSetupHost, type CodexOnboardingCardInput } from "./codexSetup.ts";
import { providersDeepLinkTargetAtom } from "./settings/providers.ts";
import { openExternal } from "../openExternal.ts";
import { receiveCodexAuthCallback } from "@t3tools/shared/codexAuthCallback";
import { codexAuthDeliveryUrl, readCodexAuthHandoff } from "@t3tools/shared/codexAuthHandoff";
import { providerAuthReturnUrl } from "@t3tools/shared/providerAuthReturnUrl";

const COPY_FEEDBACK_MS = 1500;
const NOW_TICK_MS = 60_000;
const DESKTOP_DEVELOPMENT = false;
const DESKTOP_ORIGIN = "local-studio://app";
const DeepLinkParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const NATIVE_AUTH_GATE_STATE = { status: "authenticated" } as const;
const AGENT_ONBOARDING_THREAD_ID = ThreadId.make("onboarding-agent-setup");

export type WelcomeAgentCardEntryView =
  | {
      readonly kind: "card";
      readonly key: string;
      readonly driver: OnboardingAgentDriver;
      readonly providerInstanceId: ProviderInstanceId | null;
      readonly card: OnboardingAgentCardModel;
    }
  | { readonly kind: "codexSetup"; readonly key: string; readonly hostKey: string };

export type WelcomeAgentTerminalView = {
  readonly model: OnboardingAgentTerminalModel;
  readonly sessionKey: string | null;
};

export type WelcomeAgentsSectionView = {
  readonly environmentId: EnvironmentId;
  readonly heading: string;
  readonly cards: ReadonlyArray<WelcomeAgentCardEntryView>;
  readonly addAccountLabel: string | null;
  readonly terminal: WelcomeAgentTerminalView | null;
};

export type WelcomeWizardBodyView =
  | (WelcomeConnectionStepModel & {
      readonly pairingHelpOpen: boolean;
      readonly pairingValueRevision: number;
      readonly copiedCommand: string | null;
    })
  | {
      readonly kind: "agents";
      readonly heading: string;
      readonly description: string;
      readonly sections: ReadonlyArray<WelcomeAgentsSectionView>;
      readonly continueButton: { readonly label: string; readonly enabled: boolean };
    }
  | (WelcomeImportStepModel & {
      readonly collapsedGroups: ReadonlyArray<string>;
      readonly openOther: ReadonlyArray<EnvironmentId>;
    });

export type WelcomeWizardView = {
  readonly header: WelcomeWizardHeaderModel;
  readonly step: WelcomeWizardStep;
  readonly body: WelcomeWizardBodyView;
};

type ConnectionUi = {
  readonly pairingOpen: boolean;
  readonly isPairing: boolean;
  readonly pairingUrl: string;
  readonly pairingError: string;
  readonly helpOpen: boolean;
  readonly valueRevision: number;
};

type AgentTerminalSession = {
  readonly id: number;
  readonly environmentId: EnvironmentId;
  readonly driver: OnboardingAgentDriver;
  readonly providerInstanceId: ProviderInstanceId;
  readonly cwd: string;
  readonly command: string;
  readonly terminalId: string;
  readonly setupState: OnboardingAgentTerminalSetupState;
  readonly sessionKey: string | null;
};

type ImportUi = {
  readonly selectedKeys: ReadonlyArray<string> | null;
  readonly collapsedGroups: ReadonlyArray<string>;
  readonly openOther: ReadonlyArray<EnvironmentId>;
};

type ScanEntry = OnboardingImportScanInput & { readonly refresh: () => void };

const INITIAL_CONNECTION_UI: ConnectionUi = {
  pairingOpen: false,
  isPairing: false,
  pairingUrl: "",
  pairingError: "",
  helpOpen: false,
  valueRevision: 0,
};
const INITIAL_IMPORT_UI: ImportUi = { selectedKeys: null, collapsedGroups: [], openOther: [] };

const StageParams = Schema.decodeUnknownSync(Schema.Struct({ index: Schema.Number }));
const EnvironmentCheckedParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, checked: Schema.Boolean }),
);
const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const CommandParams = Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }));
const EnvironmentParams = Schema.decodeUnknownSync(Schema.Struct({ environmentId: Schema.String }));
const TerminalParams = Schema.decodeUnknownSync(
  Schema.Struct({
    environmentId: Schema.String,
    driver: Schema.Literals(["codex", "claudeAgent"]),
    providerInstanceId: Schema.NullOr(Schema.String),
  }),
);
const KeysParams = Schema.decodeUnknownSync(
  Schema.Struct({ keys: Schema.Array(Schema.String), checked: Schema.Boolean }),
);
const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));

export function createOnboardingFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;

  const completeOnboarding = () => {
    const onboardingCompletedAt = new Date().toISOString();
    return context.updateClientSettings((current) => ({ ...current, onboardingCompletedAt }));
  };
  const gate = createFirstRunGate(context, completeOnboarding);

  const mountedAtom = Atom.make(false).pipe(Atom.keepAlive);
  const dismissedAtom = Atom.make(false).pipe(Atom.keepAlive);
  const wizardStateAtom = Atom.make<WelcomeWizardState>(
    resolveInitialWelcomeWizardState(undefined),
  ).pipe(Atom.keepAlive);
  let resumeEnvironmentId: EnvironmentId | undefined;
  const selectionAtom = Atom.make<ReadonlyArray<EnvironmentId> | null>(null).pipe(Atom.keepAlive);
  const isImportingAtom = Atom.make(false).pipe(Atom.keepAlive);
  const connectionUiAtom = Atom.make<ConnectionUi>(INITIAL_CONNECTION_UI).pipe(Atom.keepAlive);
  const copiedAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
  const terminalsAtom = Atom.make<ReadonlyMap<EnvironmentId, AgentTerminalSession>>(new Map()).pipe(
    Atom.keepAlive,
  );
  const createdAccountsAtom = Atom.make<ReadonlyMap<EnvironmentId, OnboardingCreatedAccount>>(
    new Map(),
  ).pipe(Atom.keepAlive);
  const importUiAtom = Atom.make<ImportUi>(INITIAL_IMPORT_UI).pipe(Atom.keepAlive);
  const nowAtom = Atom.make((get) => {
    const timer = setInterval(() => get.setSelf(Date.now()), NOW_TICK_MS);
    get.addFinalizer(() => clearInterval(timer));
    return Date.now();
  });

  const environmentsAtom = Atom.make((get) =>
    [...get(state.environmentPresentations.presentationsAtom).entries()].map(([id, presentation]) =>
      projectEnvironmentPresentation(id, presentation),
    ),
  );

  const selectedIdsAtom = Atom.make((get) =>
    resolveWelcomeWizardSelectedIds(get(selectionAtom), get(state.primaryEnvironmentIdAtom)),
  );

  let autoSelected = new Set<EnvironmentId>();
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let terminalSequence = 0;
  let finishing: Promise<boolean> | null = null;
  let completionErrorToastId: string | null = null;
  let importGeneration = 0;
  let importedProjects = new Map<string, ScopedProjectRef>();
  let projectsWithImportedHistory = new Map<string, ScopedProjectRef>();
  let lastImportSelection: ReadonlyArray<string> = [];
  let projectAttempts = new Map<
    string,
    { readonly projectId: ProjectId; readonly commandId: CommandId }
  >();
  let importWarning = "";
  let importedThreadCount = 0;
  let landingProject: ScopedProjectRef | null = null;
  const terminalDisposers = new Map<number, () => void>();
  const refreshedAgentEnvironments = new Set<EnvironmentId>();

  const scanAtom = (environmentId: EnvironmentId) =>
    state.onboarding.agentSessionScan({ environmentId, input: {} });

  const scansAtom = Atom.make((get): ReadonlyArray<ScanEntry> => {
    const wizard = get(wizardStateAtom);
    if (!get(mountedAtom) || wizard.step !== "import") return [];
    return wizard.setupIds.map((environmentId) => {
      const atom = scanAtom(environmentId);
      const result = get(atom);
      return {
        environmentId,
        data: Option.getOrNull(AsyncResult.value(result)),
        error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
        isPending: result.waiting || result._tag === "Initial",
        refresh: () => registry.refresh(atom),
      };
    });
  });

  const agentsSectionsAtom = Atom.make((get) => {
    const wizard = get(wizardStateAtom);
    if (!get(mountedAtom) || wizard.step !== "agents") return [];
    const createdAccounts = get(createdAccountsAtom);
    const terminals = get(terminalsAtom);
    return wizard.setupIds.map((environmentId) => {
      const providers = get(state.serverEnvironment.providersValueAtom(environmentId));
      const serverConfig = get(state.serverEnvironment.configValueAtom(environmentId));
      const createdAccount = createdAccounts.get(environmentId) ?? null;
      return {
        environmentId,
        providers,
        serverConfig,
        createdAccount,
        terminal: terminals.get(environmentId) ?? null,
        primaryAgents: resolveOnboardingPrimaryAgents(providers, createdAccount),
      };
    });
  });

  const codexCardsAtom = Atom.make((get): ReadonlyArray<CodexOnboardingCardInput> =>
    get(agentsSectionsAtom).flatMap((section) => {
      const { serverConfig, createdAccount } = section;
      if (serverConfig === null) return [];
      return section.primaryAgents.flatMap(({ driver, provider, instanceId }) => {
        if (driver !== "codex") return [];
        const account = instanceId === createdAccount?.instanceId ? createdAccount : null;
        const setup = resolveOnboardingCodexSetup({
          settings: serverConfig.settings,
          providerInstanceId: provider?.instanceId,
          createdAccount: account,
        });
        if (setup.existingChosen) return [];
        return [
          {
            key: `${section.environmentId}|${setup.instanceId}`,
            environmentId: section.environmentId,
            instanceId: setup.instanceId,
            providerInstanceId: provider?.instanceId ?? null,
            isDefault: setup.isDefault,
            instance: setup.instance,
            mode: setup.mode,
            enabled: provider?.enabled ?? true,
            autoStart: account?.autoStart === true,
            displayName: account?.displayName ?? null,
          },
        ];
      });
    }),
  );

  const wizardViewAtom = Atom.make((get): WelcomeWizardView | null => {
    if (!get(mountedAtom)) return null;
    if (!resolveWelcomeWizardVisible({ isWelcomeRoute: true, dismissed: get(dismissedAtom) })) {
      return null;
    }
    const wizard = get(wizardStateAtom);
    const isImporting = get(isImportingAtom);
    const environments = get(environmentsAtom);
    if (wizard.step === "connection") {
      const ui = get(connectionUiAtom);
      const model = buildWelcomeWizardModel({
        step: wizard.step,
        isImporting,
        body: {
          kind: "connection",
          environments,
          selectedIds: get(selectedIdsAtom),
          cloudEnabled: false,
          cloud: null,
          isPairing: ui.isPairing,
          pairingOpen: ui.pairingOpen,
          expandPairingInitially: false,
          pairingForm: { pairingUrl: ui.pairingUrl, errorMessage: ui.pairingError },
        },
      });
      if (model.body.kind !== "connection") return null;
      return {
        header: model.header,
        step: model.step,
        body: {
          ...model.body,
          pairingHelpOpen: ui.helpOpen,
          pairingValueRevision: ui.valueRevision,
          copiedCommand: get(copiedAtom),
        },
      };
    }
    if (wizard.step === "agents") {
      const sections = get(agentsSectionsAtom);
      const model = buildWelcomeWizardModel({
        step: wizard.step,
        isImporting,
        body: {
          kind: "agents",
          sections: sections.map((section) => ({
            environmentId: section.environmentId,
            machineLabel:
              environments.find(
                (environment) => environment.environmentId === section.environmentId,
              )?.label ?? "Computer",
            providers: section.providers,
            createdAccountInstanceId: section.createdAccount?.instanceId ?? null,
            terminalDriver: section.terminal?.driver ?? null,
            serverConfigAvailable: section.serverConfig !== null,
          })),
        },
      });
      if (model.body.kind !== "agents") return null;
      const body = model.body;
      return {
        header: model.header,
        step: model.step,
        body: {
          kind: "agents",
          heading: body.heading,
          description: body.description,
          continueButton: body.continueButton,
          sections: body.sections.map((sectionModel, sectionIndex) => {
            const section = sections[sectionIndex];
            const terminal = section?.terminal ?? null;
            const cards = sectionModel.cards.flatMap((card, index): WelcomeAgentCardEntryView[] => {
              const agent = section?.primaryAgents[index];
              if (section === undefined || agent === undefined) return [];
              if (card.kind === "card") {
                return [
                  {
                    kind: "card",
                    key: card.key,
                    driver: agent.driver,
                    providerInstanceId: agent.provider?.instanceId ?? null,
                    card: card.card,
                  },
                ];
              }
              const serverConfig = section.serverConfig;
              if (serverConfig === null) return [];
              const account =
                agent.instanceId === section.createdAccount?.instanceId
                  ? section.createdAccount
                  : null;
              const setup = resolveOnboardingCodexSetup({
                settings: serverConfig.settings,
                providerInstanceId: agent.provider?.instanceId,
                createdAccount: account,
              });
              return setup.existingChosen
                ? [
                    {
                      kind: "card",
                      key: card.key,
                      driver: "codex",
                      providerInstanceId: agent.provider?.instanceId ?? null,
                      card: buildOnboardingAgentCardModel({
                        driver: "codex",
                        provider: agent.provider,
                        terminalOpen: terminal?.driver === "codex",
                        terminalAvailable: true,
                      }),
                    },
                  ]
                : [
                    {
                      kind: "codexSetup",
                      key: card.key,
                      hostKey: `${section.environmentId}|${setup.instanceId}`,
                    },
                  ];
            });
            return {
              environmentId: sectionModel.environmentId,
              heading: sectionModel.heading,
              cards,
              addAccountLabel: sectionModel.addAccountLabel,
              terminal:
                terminal === null
                  ? null
                  : {
                      model: buildOnboardingAgentTerminalModel({
                        setupState: terminal.setupState,
                        command: terminal.command,
                        driver: terminal.driver,
                      }),
                      sessionKey: terminal.sessionKey,
                    },
            };
          }),
        },
      };
    }
    const ui = get(importUiAtom);
    const model = buildWelcomeWizardModel({
      step: wizard.step,
      isImporting,
      body: {
        kind: "import",
        scans: get(scansAtom),
        environments,
        selectedKeys: ui.selectedKeys,
        nowMs: get(nowAtom),
      },
    });
    if (model.body.kind !== "import" && model.body.kind !== "importLoading") return null;
    return {
      header: model.header,
      step: model.step,
      body: { ...model.body, collapsedGroups: ui.collapsedGroups, openOther: ui.openOther },
    };
  });

  const updateConnectionUi = (update: (current: ConnectionUi) => ConnectionUi) =>
    registry.set(connectionUiAtom, update(registry.get(connectionUiAtom)));

  const changePairingOpen = (open: boolean) =>
    updateConnectionUi((current) =>
      open
        ? { ...current, pairingOpen: true }
        : {
            ...current,
            pairingOpen: false,
            pairingUrl: "",
            pairingError: "",
            helpOpen: false,
            valueRevision: current.valueRevision + 1,
          },
    );

  const transition = (event: WelcomeWizardEvent) =>
    registry.set(
      wizardStateAtom,
      transitionWelcomeWizardState(registry.get(wizardStateAtom), event),
    );

  const closeTerminal = (environmentId: EnvironmentId) => {
    const terminal = registry.get(terminalsAtom).get(environmentId);
    if (terminal === undefined) return;
    const next = new Map(registry.get(terminalsAtom));
    next.delete(environmentId);
    registry.set(terminalsAtom, next);
    terminalDisposers.get(terminal.id)?.();
    terminalDisposers.delete(terminal.id);
    void runAtomCommand(
      registry,
      state.terminalEnvironment.close,
      {
        environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId: terminal.terminalId,
          deleteHistory: true,
        },
      },
      { reportFailure: false },
    );
  };

  const refreshProviders = (environmentId: EnvironmentId) =>
    void runAtomCommand(
      registry,
      state.serverEnvironment.refreshProviders,
      { environmentId, input: {} },
      { reportFailure: false },
    );

  const closeTerminalAndRefresh = (environmentId: EnvironmentId) => {
    if (registry.get(terminalsAtom).get(environmentId) === undefined) return;
    closeTerminal(environmentId);
    refreshProviders(environmentId);
  };

  const setTerminal = (session: AgentTerminalSession) => {
    const current = registry.get(terminalsAtom).get(session.environmentId);
    if (current === undefined || current.id !== session.id) return false;
    registry.set(
      terminalsAtom,
      new Map(registry.get(terminalsAtom)).set(session.environmentId, session),
    );
    return true;
  };

  const startTerminalSetup = async (session: AgentTerminalSession) => {
    const opened = await runAtomCommand(
      registry,
      state.terminalEnvironment.open,
      {
        environmentId: session.environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId: session.terminalId,
          cwd: session.cwd,
          providerInstanceId: session.providerInstanceId,
        },
      },
      { reportFailure: false },
    );
    const latest = registry.get(terminalsAtom).get(session.environmentId);
    if (latest === undefined || latest.id !== session.id) return;
    if (opened._tag !== "Success") {
      setTerminal({ ...latest, setupState: "openFailed" });
      return;
    }
    const wrote = await runAtomCommand(
      registry,
      state.terminalEnvironment.write,
      {
        environmentId: session.environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId: session.terminalId,
          data: session.command,
        },
      },
      { reportFailure: false },
    );
    const current = registry.get(terminalsAtom).get(session.environmentId);
    if (current === undefined || current.id !== session.id) return;
    const registration = registerExternalTerminalSession(context, {
      environmentId: session.environmentId,
      threadId: AGENT_ONBOARDING_THREAD_ID,
      input: {
        threadId: AGENT_ONBOARDING_THREAD_ID,
        terminalId: session.terminalId,
        cwd: session.cwd,
        providerInstanceId: session.providerInstanceId,
      },
      onExit: () => {
        const active = registry.get(terminalsAtom).get(session.environmentId);
        if (active?.id === session.id) closeTerminalAndRefresh(session.environmentId);
      },
    });
    terminalDisposers.set(session.id, registration.dispose);
    setTerminal({
      ...current,
      setupState: wrote._tag === "Success" ? "ready" : "writeFailed",
      sessionKey: registration.sessionKey,
    });
  };

  const openAgentTerminal = (
    environmentId: EnvironmentId,
    driver: OnboardingAgentDriver,
    provider: ServerProvider | undefined,
  ) => {
    const serverConfig = registry.get(state.serverEnvironment.configValueAtom(environmentId));
    if (provider === undefined || serverConfig === null) return;
    closeTerminal(environmentId);
    terminalSequence += 1;
    const session: AgentTerminalSession = {
      id: terminalSequence,
      environmentId,
      driver,
      providerInstanceId: provider.instanceId,
      cwd: serverConfig.cwd,
      command: resolveOnboardingAgentTerminalCommand({
        driver,
        provider,
        settings: serverConfig.settings,
        platform: serverConfig.environment.platform.os,
      }),
      terminalId: `onboarding-${driver}-${randomUUID()}`,
      setupState: "preparing",
      sessionKey: null,
    };
    registry.set(terminalsAtom, new Map(registry.get(terminalsAtom)).set(environmentId, session));
    void startTerminalSetup(session);
  };

  const retryAgentTerminal = (environmentId: EnvironmentId) => {
    const terminal = registry.get(terminalsAtom).get(environmentId);
    if (terminal === undefined) return;
    terminalDisposers.get(terminal.id)?.();
    terminalDisposers.delete(terminal.id);
    void runAtomCommand(
      registry,
      state.terminalEnvironment.close,
      {
        environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId: terminal.terminalId,
          deleteHistory: true,
        },
      },
      { reportFailure: false },
    );
    terminalSequence += 1;
    const session: AgentTerminalSession = {
      ...terminal,
      id: terminalSequence,
      setupState: "preparing",
      sessionKey: null,
    };
    registry.set(terminalsAtom, new Map(registry.get(terminalsAtom)).set(environmentId, session));
    void startTerminalSetup(session);
  };

  const closeAllTerminals = () => {
    for (const environmentId of registry.get(terminalsAtom).keys()) closeTerminal(environmentId);
  };

  const onDone = async (projectRef?: ScopedProjectRef) => {
    registry.set(dismissedAtom, true);
    if (projectRef !== undefined) {
      await context
        .openNewThread(projectRef, { replace: true })
        .catch(() => context.navigateHome());
      return;
    }
    context.navigateHome();
  };

  const finish = (projectRef?: ScopedProjectRef, warning?: string, threadCount = 0) => {
    if (finishing !== null) return finishing;
    if (completionErrorToastId !== null) {
      context.closeToast(completionErrorToastId);
      completionErrorToastId = null;
    }
    const completion: Promise<boolean> = completeOnboarding()
      .then(async () => {
        if (completionErrorToastId !== null) {
          context.closeToast(completionErrorToastId);
          completionErrorToastId = null;
        }
        await onDone(projectRef);
        const toast = resolveOnboardingFinishToast({
          importWarning: warning,
          importedThreadCount: threadCount,
        });
        if (toast.kind === "warning") {
          context.addToast({
            layout: "plain",
            type: "warning",
            title: toast.title,
            description: toast.description,
            timeout: 0,
          });
        } else if (toast.kind === "success") {
          context.addToast({ layout: "plain", type: "success", title: toast.title });
        }
        return true;
      })
      .catch(() => {
        completionErrorToastId = context.addToast({
          layout: "plain",
          type: "error",
          ...ONBOARDING_COMPLETION_ERROR,
          ...(completionErrorToastId === null ? {} : { id: completionErrorToastId }),
        });
        return false;
      })
      .finally(() => {
        if (finishing === completion) finishing = null;
      });
    finishing = completion;
    return completion;
  };

  const importCandidates = () =>
    resolveOnboardingImportCandidates(registry.get(scansAtom), Date.now());

  const currentImportSelectedKeys = (): ReadonlyArray<string> => {
    const view = registry.get(wizardViewAtom);
    return view?.body.kind === "import" ? view.body.selectedKeys : [];
  };

  const finishAfterImport = () => {
    const projectRef = resolveOnboardingLandingProject(
      lastImportSelection,
      projectsWithImportedHistory,
      importedProjects,
    );
    if (projectRef === undefined) {
      void finish(undefined, importWarning, importedThreadCount);
      return;
    }
    registry.set(isImportingAtom, true);
    landingProject = projectRef;
    checkLanding();
  };

  const checkLanding = () => {
    const target = landingProject;
    if (target === null) return;
    const present = registry
      .get(state.environmentProjects.projectsAtom)
      .some(
        (project) =>
          project.id === target.projectId && project.environmentId === target.environmentId,
      );
    if (!present) return;
    landingProject = null;
    void finish(target, importWarning, importedThreadCount).then((completed) => {
      if (!completed) registry.set(isImportingAtom, false);
    });
  };

  registry.subscribe(state.environmentProjects.projectsAtom, checkLanding);

  const runImport = async () => {
    const { available } = importCandidates();
    const selectedKeys = currentImportSelectedKeys();
    const selection: ReadonlyArray<OnboardingImportCandidate> = available.filter((candidate) =>
      selectedKeys.includes(candidate.key),
    );
    const decision = resolveOnboardingImportSubmit({
      isImporting: registry.get(isImportingAtom),
      selectionCount: selection.length,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "finish") {
      void finish();
      return;
    }
    registry.set(isImportingAtom, true);
    importWarning = "";
    importedThreadCount = 0;
    lastImportSelection = selection.map((candidate) => candidate.key);
    const generation = importGeneration;
    const projectsMap = importedProjects;
    const attempts = projectAttempts;
    const stale = () => generation !== importGeneration || projectsMap !== importedProjects;
    let importedProjectsCount =
      projectsMap.size > 0
        ? selection.filter((candidate) => projectsMap.has(candidate.key)).length
        : 0;
    let threadCount = 0;
    let skippedThreadCount = 0;
    const refreshEnvironments = new Set<EnvironmentId>();
    for (const candidate of selection) {
      const { environmentId } = candidate;
      if (stale()) return;
      if (projectsMap.has(candidate.key)) continue;
      let projectId = resolveOnboardingProjectId(
        registry.get(state.environmentProjects.projectsAtom),
        environmentId,
        candidate,
      );
      if (projectId === null) {
        let attempt = attempts.get(candidate.key);
        if (attempt === undefined) {
          const nextProjectId = newProjectId();
          attempt = {
            projectId: nextProjectId,
            commandId: CommandId.make(`onboarding:project:create:${nextProjectId}`),
          };
          attempts.set(candidate.key, attempt);
        }
        projectId = attempt.projectId;
        const result = await runAtomCommand(
          registry,
          state.projectEnvironment.create,
          {
            environmentId,
            input: {
              projectId,
              commandId: attempt.commandId,
              title: candidate.title,
              workspaceRoot: candidate.path,
              createWorkspaceRootIfMissing: false,
              defaultModelSelection: null,
            },
          },
          { reportFailure: false },
        );
        if (stale()) return;
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            attempts.delete(candidate.key);
            refreshEnvironments.add(environmentId);
          }
          continue;
        }
      }
      const threadImport = await runAtomCommand(
        registry,
        state.onboarding.agentSessionImport,
        { environmentId, input: { projectId, expectedWorkspaceRoot: candidate.path } },
        { reportFailure: false },
      );
      if (stale()) return;
      if (threadImport._tag === "Success") {
        threadCount += threadImport.value.importedCount;
        skippedThreadCount += threadImport.value.skippedCount;
        if (threadImport.value.importedCount > 0) {
          projectsWithImportedHistory.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
        if (threadImport.value.skippedCount === 0) {
          importedProjectsCount += 1;
          projectsMap.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
      } else if (!isAtomCommandInterrupted(threadImport)) {
        attempts.delete(candidate.key);
        refreshEnvironments.add(environmentId);
      }
    }
    for (const scan of registry.get(scansAtom)) {
      if (refreshEnvironments.has(scan.environmentId)) scan.refresh();
    }
    registry.set(isImportingAtom, false);
    importedThreadCount = threadCount;
    importWarning = resolveOnboardingImportWarning({
      importedProjectsCount,
      selectionCount: selection.length,
      importedThreadCount: threadCount,
      skippedThreadCount,
    });
    finishAfterImport();
  };

  const updateImportUi = (update: (current: ImportUi) => ImportUi) =>
    registry.set(importUiAtom, update(registry.get(importUiAtom)));

  const toggleListValue = <T>(values: ReadonlyArray<T>, value: T): ReadonlyArray<T> =>
    values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

  const autoSelect = () => {
    if (!registry.get(mountedAtom)) return;
    const added = registry
      .get(environmentsAtom)
      .filter((environment) => !autoSelected.has(environment.environmentId));
    if (added.length === 0) return;
    for (const environment of added) autoSelected.add(environment.environmentId);
    registry.set(selectionAtom, [
      ...new Set([
        ...(registry.get(selectionAtom) ?? []),
        ...added.map((environment) => environment.environmentId),
      ]),
    ]);
  };

  const refreshAgentEnvironments = () => {
    const wizard = registry.get(wizardStateAtom);
    if (!registry.get(mountedAtom) || wizard.step !== "agents") {
      refreshedAgentEnvironments.clear();
      return;
    }
    for (const environmentId of wizard.setupIds) {
      if (refreshedAgentEnvironments.has(environmentId)) continue;
      refreshedAgentEnvironments.add(environmentId);
      refreshProviders(environmentId);
    }
  };

  const mount = () => {
    autoSelected = new Set();
    finishing = null;
    completionErrorToastId = null;
    importGeneration += 1;
    importedProjects = new Map();
    projectsWithImportedHistory = new Map();
    lastImportSelection = [];
    projectAttempts = new Map();
    importWarning = "";
    importedThreadCount = 0;
    landingProject = null;
    refreshedAgentEnvironments.clear();
    registry.set(dismissedAtom, false);
    registry.set(wizardStateAtom, resolveInitialWelcomeWizardState(resumeEnvironmentId));
    resumeEnvironmentId = undefined;
    registry.set(selectionAtom, null);
    registry.set(isImportingAtom, false);
    registry.set(connectionUiAtom, INITIAL_CONNECTION_UI);
    registry.set(copiedAtom, null);
    registry.set(createdAccountsAtom, new Map());
    registry.set(importUiAtom, INITIAL_IMPORT_UI);
    registry.set(mountedAtom, true);
    autoSelect();
  };

  const unmount = () => {
    closeAllTerminals();
    importGeneration += 1;
    landingProject = null;
    registry.set(mountedAtom, false);
  };

  registry.subscribe(environmentsAtom, autoSelect);

  let previousStep: WelcomeWizardStep = registry.get(wizardStateAtom).step;
  registry.subscribe(wizardStateAtom, (wizard) => {
    if (previousStep === "agents" && wizard.step !== "agents") closeAllTerminals();
    if (previousStep === "import" && wizard.step !== "import") {
      importGeneration += 1;
      registry.set(importUiAtom, INITIAL_IMPORT_UI);
    }
    if (previousStep !== "import" && wizard.step === "import") importGeneration += 1;
    previousStep = wizard.step;
    refreshAgentEnvironments();
  });

  registry.subscribe(
    context.pageAtom,
    (page) => {
      const mounted = registry.get(mountedAtom);
      if (page.kind === "welcome") {
        const access = resolveWelcomeRouteAccess(NATIVE_AUTH_GATE_STATE);
        if (access.kind === "redirect") {
          context.navigate({ kind: "pair" });
          return;
        }
        if (!mounted) mount();
        return;
      }
      if (mounted) unmount();
      if (
        page.kind === "pair" &&
        resolvePairRouteAccess(NATIVE_AUTH_GATE_STATE).kind === "redirect"
      ) {
        context.navigateHome();
      } else if (page.kind === "connect") {
        context.navigateHome();
      }
    },
    { immediate: true },
  );

  const pairingSubmit = async () => {
    const ui = registry.get(connectionUiAtom);
    const decision = resolveOnboardingPairingSubmit({
      isPairing: ui.isPairing,
      pairingUrl: ui.pairingUrl,
    });
    if (decision.kind === "ignore") return;
    updateConnectionUi((current) => ({ ...current, isPairing: true, pairingError: "" }));
    const result = await runAtomCommand(
      registry,
      state.onboarding.connectPairing,
      { pairingUrl: decision.pairingUrl },
      { reportFailure: false },
    );
    if (!registry.get(mountedAtom)) return;
    updateConnectionUi((current) => ({ ...current, isPairing: false }));
    if (result._tag === "Success") {
      changePairingOpen(false);
      registry.set(selectionAtom, [...new Set([...registry.get(selectedIdsAtom), result.value])]);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    updateConnectionUi((current) => ({
      ...current,
      pairingError: describeOnboardingPairingFailure(squashAtomCommandFailure(result)),
    }));
  };

  const copyCommand = async (command: string) => {
    await clipboardService(context).writeText(command);
    registry.set(copiedAtom, command);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => registry.set(copiedAtom, null), COPY_FEEDBACK_MS);
  };

  const findAgent = (
    environmentId: EnvironmentId,
    driver: OnboardingAgentDriver,
    providerInstanceId: string | null,
  ) => {
    const section = registry
      .get(agentsSectionsAtom)
      .find((candidate) => candidate.environmentId === environmentId);
    const agent = section?.primaryAgents.find(
      (candidate) =>
        candidate.driver === driver &&
        (providerInstanceId === null || candidate.provider?.instanceId === providerInstanceId),
    );
    return agent?.provider;
  };

  const setCreatedAccount = (
    environmentId: EnvironmentId,
    update: (current: OnboardingCreatedAccount | null) => OnboardingCreatedAccount | null,
  ) => {
    const next = new Map(registry.get(createdAccountsAtom));
    const value = update(next.get(environmentId) ?? null);
    if (value === null) next.delete(environmentId);
    else next.set(environmentId, value);
    registry.set(createdAccountsAtom, next);
  };

  const codexHostDeps = {
    onboardingCardsAtom: codexCardsAtom,
    onAccountCreated: (
      environmentId: EnvironmentId,
      instanceId: ProviderInstanceId,
      displayName: string,
    ) => setCreatedAccount(environmentId, () => ({ instanceId, displayName, autoStart: true })),
    onAutoStartConsumed: (environmentId: EnvironmentId) =>
      setCreatedAccount(environmentId, (current) =>
        current === null ? null : { ...current, autoStart: false },
      ),
  };
  const codexSetup = createCodexSetupHost(context, codexHostDeps);

  const startProviderAuthHandoff = (url: string) => {
    const request = readCodexAuthHandoff(url, DESKTOP_DEVELOPMENT);
    if (request === undefined) return false;
    void receiveCodexAuthCallback(
      request.authorizationUrl,
      (target) =>
        openExternal(target).then(
          () => true,
          () => false,
        ),
      (callbackUrl) => codexAuthDeliveryUrl(request, callbackUrl),
    ).catch(() => undefined);
    return true;
  };

  const resumeProviderAuth = (url: string) => {
    const destination = providerAuthReturnUrl(url);
    if (destination === undefined || !destination.startsWith(`${DESKTOP_ORIGIN}/`)) return false;
    const target = new URL(destination);
    if (target.pathname === "/welcome") {
      resumeEnvironmentId = resolveWelcomeResumeEnvironmentId(target.hash.replace(/^#/u, ""));
      if (registry.get(context.pageAtom).kind === "welcome") {
        unmount();
        mount();
      } else {
        context.navigate({ kind: "welcome" });
      }
      return true;
    }
    const section = target.pathname.replace(/^\/settings\/?/u, "").split("/")[0] ?? "";
    const instanceId = target.searchParams.get("instanceId")?.trim();
    if (section === "providers" && instanceId) {
      registry.set(providersDeepLinkTargetAtom, ProviderInstanceId.make(instanceId));
    }
    context.navigate({ kind: "settings", section: section.length > 0 ? section : "general" });
    return true;
  };

  return {
    pages: ["welcome", "pair", "connect"],
    views: {
      ...codexSetup.views,
      firstRunGate: gate.viewAtom,
      welcomeWizard: wizardViewAtom,
    },
    actions: {
      ...codexSetup.actions,
      firstRunGateRetry: gate.retry,
      openDeepLink: async (params) => {
        const { url } = DeepLinkParams(params);
        return startProviderAuthHandoff(url) || resumeProviderAuth(url);
      },
      welcomeSelectStage: async (params) => {
        transition({
          type: "selectStage",
          index: StageParams(params).index,
          isImporting: registry.get(isImportingAtom),
        });
        return null;
      },
      welcomeSetEnvironmentChecked: async (params) => {
        const { environmentId, checked } = EnvironmentCheckedParams(params);
        registry.set(
          selectionAtom,
          toggleWelcomeWizardSelection(
            registry.get(selectedIdsAtom),
            EnvironmentId.make(environmentId),
            checked,
          ),
        );
        return null;
      },
      welcomeContinueConnection: async () => {
        const view = registry.get(wizardViewAtom);
        if (view?.body.kind !== "connection" || !view.body.continueButton.enabled) return null;
        transition({
          type: "continueConnection",
          environmentIds: resolveWelcomeWizardSetupIds(
            registry.get(environmentsAtom),
            registry.get(selectedIdsAtom),
          ),
        });
        return null;
      },
      welcomeSetPairingOpen: async (params) => {
        if (registry.get(connectionUiAtom).isPairing) return null;
        changePairingOpen(OpenParams(params).open);
        return null;
      },
      welcomeSetPairingUrl: async (params) => {
        const { value } = ValueParams(params);
        updateConnectionUi((current) =>
          current.isPairing || current.pairingUrl === value
            ? current
            : { ...current, pairingUrl: value },
        );
        return null;
      },
      welcomeSubmitPairing: async () => {
        await pairingSubmit();
        return null;
      },
      welcomeTogglePairingHelp: async () => {
        updateConnectionUi((current) => ({ ...current, helpOpen: !current.helpOpen }));
        return null;
      },
      welcomeCopyCommand: async (params) => {
        await copyCommand(CommandParams(params).command);
        return null;
      },
      welcomeContinueAgents: async () => {
        transition({ type: "continueAgents" });
        return null;
      },
      welcomeOpenAgentTerminal: async (params) => {
        const { environmentId, driver, providerInstanceId } = TerminalParams(params);
        const id = EnvironmentId.make(environmentId);
        openAgentTerminal(id, driver, findAgent(id, driver, providerInstanceId));
        return null;
      },
      welcomeCloseAgentTerminal: async (params) => {
        closeTerminalAndRefresh(EnvironmentId.make(EnvironmentParams(params).environmentId));
        return null;
      },
      welcomeRetryAgentTerminal: async (params) => {
        retryAgentTerminal(EnvironmentId.make(EnvironmentParams(params).environmentId));
        return null;
      },
      welcomeImportToggle: async (params) => {
        const { keys, checked } = KeysParams(params);
        if (registry.get(isImportingAtom)) return null;
        updateImportUi((current) => ({
          ...current,
          selectedKeys: setOnboardingImportKeys(currentImportSelectedKeys(), keys, checked),
        }));
        return null;
      },
      welcomeImportSelectAll: async () => {
        const view = registry.get(wizardViewAtom);
        if (view?.body.kind !== "import" || view.body.selection?.selectAll.enabled !== true)
          return null;
        const allKeys = view.body.allKeys;
        updateImportUi((current) => ({ ...current, selectedKeys: allKeys }));
        return null;
      },
      welcomeImportSelectNone: async () => {
        const view = registry.get(wizardViewAtom);
        if (view?.body.kind !== "import" || view.body.selection?.selectNone.enabled !== true)
          return null;
        updateImportUi((current) => ({ ...current, selectedKeys: [] }));
        return null;
      },
      welcomeImportToggleGroup: async (params) => {
        const { key } = KeyParams(params);
        updateImportUi((current) => ({
          ...current,
          collapsedGroups: toggleListValue(current.collapsedGroups, key),
        }));
        return null;
      },
      welcomeImportToggleOther: async (params) => {
        const environmentId = EnvironmentId.make(EnvironmentParams(params).environmentId);
        updateImportUi((current) => ({
          ...current,
          openOther: toggleListValue(current.openOther, environmentId),
        }));
        return null;
      },
      welcomeImportRetryScan: async (params) => {
        const environmentId = EnvironmentId.make(EnvironmentParams(params).environmentId);
        registry
          .get(scansAtom)
          .find((scan) => scan.environmentId === environmentId)
          ?.refresh();
        return null;
      },
      welcomeImportSkip: async () => {
        const view = registry.get(wizardViewAtom);
        if (view?.body.kind === "importLoading") {
          if (view.body.skipButton.enabled) void finish();
          return null;
        }
        if (view?.body.kind !== "import" || !view.body.skipButton.enabled) return null;
        finishAfterImport();
        return null;
      },
      welcomeImportRun: async () => {
        await runImport();
        return null;
      },
    },
  };
}
