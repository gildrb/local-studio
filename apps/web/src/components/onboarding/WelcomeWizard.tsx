import { useAuth } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CommandId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  CopyIcon,
  LinkIcon,
  MonitorIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { useCompleteOnboarding } from "../../onboarding/firstRun";
import {
  resolveOnboardingLandingProject,
  resolveOnboardingProjectId,
} from "../../onboarding/projectImport.logic";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { newProjectId, randomUUID } from "../../lib/utils";
import { agentSessionImport } from "../../state/agentSessions";
import { readProjects, useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { useProjectScans } from "../../onboarding/useProjectScans";
import { projectEnvironment } from "../../state/projects";
import { serverEnvironment } from "../../state/server";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { connectPairing } from "../../connection/onboarding";
import { getDriverOption } from "../settings/providerDriverMeta";
import { ChatGptWelcomeCoordinator } from "../settings/ChatGptWelcomeCoordinator";
import { AddManagedCodexAccountDialog, CodexSetupSection } from "../settings/CodexSetupSection";
import { buildProviderInstanceUpdatePatch } from "../settings/SettingsPanels.logic";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { ClaudeAI, OpenAI, PiAgentIcon } from "../Icons";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { WizardPanel, WizardSteps, WizardPopup, WizardHeader } from "../ui/wizard";
import { Dialog } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { cn } from "../../lib/utils";
import {
  buildOnboardingAgentCardModel,
  buildOnboardingAgentsSectionModel,
  buildOnboardingAgentTerminalModel,
  buildOnboardingCloudOptionModel,
  buildWelcomeAgentsStepModel,
  buildWelcomeConnectionStepModel,
  buildWelcomeImportStepModel,
  buildWelcomeWizardHeaderModel,
  describeOnboardingPairingFailure,
  isOnboardingImportLoading,
  ONBOARDING_COMPLETION_ERROR,
  resolveInitialWelcomeWizardState,
  resolveOnboardingAgentTerminalCommand,
  resolveOnboardingCloudTrigger,
  resolveOnboardingCodexModeInstance,
  resolveOnboardingCodexSetup,
  resolveOnboardingFinishToast,
  resolveOnboardingImportCandidates,
  resolveOnboardingImportSubmit,
  resolveOnboardingImportWarning,
  resolveOnboardingMachineLabel,
  resolveOnboardingPairingSubmit,
  resolveOnboardingPrimaryAgents,
  resolveWelcomeWizardSelectedIds,
  resolveWelcomeWizardSetupIds,
  setOnboardingImportKeys,
  toggleWelcomeWizardSelection,
  transitionWelcomeWizardState,
  type OnboardingAgentCardModel,
  type OnboardingAgentDriver,
  type OnboardingAgentTerminalSetupState,
  type OnboardingCommandBlockModel,
  type OnboardingCreatedAccount,
  type OnboardingImportCandidate,
  type OnboardingImportGroupModel,
  type OnboardingImportListModel,
  type OnboardingImportRowMetaModel,
  type OnboardingImportRowModel,
  type OnboardingImportScanInput,
  type OnboardingPairingFormModel,
  type WelcomeWizardState,
} from "./WelcomeWizard.logic";

/**
 * First-run welcome wizard. Rendered over the workspace at `/welcome` on a
 * fresh install (no completed-onboarding flag, empty workspace). Flow per the
 * onboarding overhaul spec: connection choice → sign-in/pair (remote paths) →
 * managed Codex setup or an inline CLI terminal → project import → main screen.
 * Every step past the connection gate is skippable; the whole wizard is
 * re-runnable by clearing the flag.
 */

const NO_ENVIRONMENTS: readonly EnvironmentId[] = [];

const AGENT_ONBOARDING_THREAD_ID = ThreadId.make("onboarding-agent-setup");

export function WelcomeWizard({
  localAvailable,
  onDone,
  resumeEnvironmentId,
}: {
  /** Whether this client is authenticated to the server serving the app. */
  readonly localAvailable: boolean;
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const completeOnboarding = useCompleteOnboarding();
  const [wizardState, setWizardState] = useState<WelcomeWizardState>(() =>
    resolveInitialWelcomeWizardState(resumeEnvironmentId),
  );
  const { step, setupIds } = wizardState;
  const { environments } = useEnvironments();
  const [selection, setSelection] = useState<ReadonlySet<EnvironmentId> | null>(null);
  const autoSelectedComputers = useRef(new Set<EnvironmentId>());
  const [isImporting, setIsImporting] = useState(false);
  const finishingPromiseRef = useRef<Promise<boolean> | null>(null);
  const completionErrorToastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const primaryEnvironment = usePrimaryEnvironment();
  useEffect(() => {
    const newComputers = environments.filter(
      (environment) => !autoSelectedComputers.current.has(environment.environmentId),
    );
    if (newComputers.length === 0) return;
    for (const environment of newComputers) {
      autoSelectedComputers.current.add(environment.environmentId);
    }
    setSelection(
      (current) =>
        new Set([
          ...(current ?? []),
          ...newComputers.map((environment) => environment.environmentId),
        ]),
    );
  }, [environments]);
  const selectedIds = new Set(
    resolveWelcomeWizardSelectedIds(
      selection === null ? null : [...selection],
      primaryEnvironment ? primaryEnvironment.environmentId : null,
    ),
  );
  const scans = useProjectScans(step === "import" ? setupIds : NO_ENVIRONMENTS);
  const header = buildWelcomeWizardHeaderModel({
    step,
    isImporting,
    isLoadingProjects: step === "import" && isOnboardingImportLoading(scans),
  });
  const stageIndex = header.stageIndex;
  const finish = useCallback(
    (projectRef?: ScopedProjectRef, importWarning?: string, importedThreadCount = 0) => {
      if (finishingPromiseRef.current !== null) return finishingPromiseRef.current;
      if (completionErrorToastIdRef.current !== null) {
        toastManager.close(completionErrorToastIdRef.current);
        completionErrorToastIdRef.current = null;
      }

      const completion = completeOnboarding()
        .then(async () => {
          if (completionErrorToastIdRef.current !== null) {
            toastManager.close(completionErrorToastIdRef.current);
            completionErrorToastIdRef.current = null;
          }
          await onDone(projectRef);
          const toast = resolveOnboardingFinishToast({ importWarning, importedThreadCount });
          if (toast.kind === "warning") {
            toastManager.add({
              type: "warning",
              title: toast.title,
              description: toast.description,
              timeout: 0,
            });
          } else if (toast.kind === "success") {
            toastManager.add({ type: "success", title: toast.title });
          }
          return true;
        })
        .catch(() => {
          const errorToast = { type: "error", ...ONBOARDING_COMPLETION_ERROR } as const;
          if (completionErrorToastIdRef.current === null) {
            completionErrorToastIdRef.current = toastManager.add(errorToast);
          } else {
            toastManager.update(completionErrorToastIdRef.current, errorToast);
          }
          return false;
        })
        .finally(() => {
          if (finishingPromiseRef.current === completion) {
            finishingPromiseRef.current = null;
          }
        });
      finishingPromiseRef.current = completion;
      return completion;
    },
    [completeOnboarding, onDone],
  );

  return (
    <Dialog open disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
      <WizardPopup
        size="wide"
        bottomStickOnMobile={false}
        showCloseButton={false}
        initialFocus={() => document.getElementById("onboarding-pairing-url") ?? true}
      >
        <WizardHeader
          title={header.title}
          identity={
            <div className="flex items-center gap-2" role="img" aria-label={header.brandLabel}>
              <img src={header.brandImageSrc} alt="" className="size-6 rounded-md" />
              <span className="text-2xl font-medium tracking-tight">{header.brandLabel}</span>
            </div>
          }
        >
          <WizardSteps
            steps={header.stageLabels}
            currentStep={stageIndex}
            isStepDisabled={(index) => header.stages[index]?.disabled ?? true}
            onStepChange={(index) =>
              setWizardState((state) =>
                transitionWelcomeWizardState(state, { type: "selectStage", index, isImporting }),
              )
            }
          />
        </WizardHeader>

        <WizardPanel holdHeight={header.holdHeight}>
          {step === "connection" ? (
            <ConnectionStep
              expandPairingInitially={!localAvailable && !hasCloudPublicConfig()}
              selectedIds={selectedIds}
              autoSelectedComputers={autoSelectedComputers.current}
              onSelectionChange={setSelection}
              onToggleEnvironment={(environmentId, checked) =>
                setSelection(
                  (current) =>
                    new Set(
                      toggleWelcomeWizardSelection(
                        [...(current ?? selectedIds)],
                        environmentId,
                        checked,
                      ),
                    ),
                )
              }
              onContinue={() =>
                setWizardState((state) =>
                  transitionWelcomeWizardState(state, {
                    type: "continueConnection",
                    environmentIds: resolveWelcomeWizardSetupIds(environments, [...selectedIds]),
                  }),
                )
              }
              onPaired={(environmentId) => {
                setSelection(new Set([...selectedIds, environmentId]));
              }}
            />
          ) : step === "agents" ? (
            <AgentsStep
              environmentIds={setupIds}
              onContinue={() =>
                setWizardState((state) =>
                  transitionWelcomeWizardState(state, { type: "continueAgents" }),
                )
              }
            />
          ) : (
            <ImportStep
              scans={scans}
              isImporting={isImporting}
              setIsImporting={setIsImporting}
              onDone={finish}
            />
          )}
        </WizardPanel>
      </WizardPopup>
      <ChatGptWelcomeCoordinator />
    </Dialog>
  );
}

// ── Step 1: connection choice ────────────────────────────────

function ConnectionStep({
  autoSelectedComputers,
  expandPairingInitially,
  selectedIds,
  onSelectionChange,
  onToggleEnvironment,
  onContinue,
  onPaired,
}: {
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly expandPairingInitially: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId>) => void;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
  readonly onContinue: () => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const { environments } = useEnvironments();
  const cloudEnabled = hasCloudPublicConfig();
  const [pairingOpen, setPairingOpen] = useState(expandPairingInitially);
  const [isPairing, setIsPairing] = useState(false);
  const [pairingUrl, setPairingUrl] = useState("");
  const [pairingError, setPairingError] = useState("");
  const changePairingOpen = (open: boolean) => {
    setPairingOpen(open);
    if (!open) {
      setPairingUrl("");
      setPairingError("");
    }
  };
  const model = buildWelcomeConnectionStepModel({
    environments,
    selectedIds: [...selectedIds],
    cloudEnabled,
    cloud: null,
    isPairing,
    pairingOpen,
    expandPairingInitially,
    pairingForm: { pairingUrl, errorMessage: pairingError },
  });
  const ready = model.ready;
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      ready &&
      (document.activeElement === document.body ||
        document.activeElement?.getAttribute("role") === "dialog")
    ) {
      continueRef.current?.focus();
    }
  }, [ready]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{model.heading}</h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{model.description}</p>
      {model.rows.length > 0 ? (
        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">{model.legend}</legend>
          {model.rows.map((row) => (
            <label
              key={row.environmentId}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-3"
            >
              <Checkbox
                checked={row.checked}
                onCheckedChange={(checked) => {
                  onSelectionChange(
                    new Set(
                      toggleWelcomeWizardSelection(
                        [...selectedIds],
                        row.environmentId,
                        checked === true,
                      ),
                    ),
                  );
                }}
              />
              <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium break-words">{row.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{row.statusLabel}</span>
                </span>
                {row.displayUrl !== null ? (
                  <span className="mt-0.5 block text-xs break-all text-muted-foreground">
                    {row.displayUrl}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="mt-4 space-y-2">
        {cloudEnabled ? (
          <ConnectAccountOption
            autoSelectedComputers={autoSelectedComputers}
            disabled={isPairing}
            selectedIds={selectedIds}
            onToggleEnvironment={onToggleEnvironment}
          />
        ) : null}
        <div className="rounded-lg border border-border bg-background">
          <Collapsible open={model.pairing.open} onOpenChange={changePairingOpen}>
            <CollapsibleTrigger
              disabled={model.pairing.triggerDisabled}
              render={
                <Button
                  variant="ghost"
                  size="sm-multiline"
                  className="min-h-14 w-full justify-start"
                />
              }
            >
              <LinkIcon className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left">{model.pairing.label}</span>
              <ChevronRightIcon
                className={cn("size-4 text-muted-foreground", model.pairing.open && "rotate-90")}
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="px-3 pb-3">
                <PairingForm
                  form={model.pairing.form}
                  isPairing={isPairing}
                  setIsPairing={setIsPairing}
                  setPairingUrl={setPairingUrl}
                  setErrorMessage={setPairingError}
                  onPaired={(environmentId) => {
                    changePairingOpen(false);
                    onPaired(environmentId);
                    requestAnimationFrame(() => continueRef.current?.focus());
                  }}
                />
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        <Button
          ref={continueRef}
          autoFocus={model.continueButton.autoFocus}
          disabled={!model.continueButton.enabled}
          onClick={onContinue}
        >
          {model.continueButton.label}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </>
  );
}

function ConnectAccountOption({
  autoSelectedComputers,
  disabled,
  selectedIds,
  onToggleEnvironment,
}: {
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly disabled: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
}) {
  const { environments } = useEnvironments();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const [expanded, setExpanded] = useState(true);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const onDiscoveryReady = useCallback(() => setDiscoveryReady(true), []);
  const model = buildOnboardingCloudOptionModel({
    isLoaded,
    isSignedIn: isSignedIn === true,
    discoveryReady,
    expanded,
    disabled,
  });

  return (
    <div className="rounded-lg border border-border bg-background">
      <Collapsible open={model.open} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          disabled={model.triggerDisabled}
          onClick={(event) => {
            if (resolveOnboardingCloudTrigger(isSignedIn === true).kind === "openAuthPrompt") {
              event.preventDefault();
              setExpanded(true);
              openAuthPrompt();
            }
          }}
          render={
            <Button variant="ghost" size="sm-multiline" className="min-h-14 w-full justify-start" />
          }
        >
          <CloudIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">{model.label}</span>
          <span className="text-xs text-muted-foreground">{model.statusLabel}</span>
          <ChevronRightIcon
            className={cn("size-4 text-muted-foreground", model.chevronExpanded && "rotate-90")}
          />
        </CollapsibleTrigger>
        <CollapsiblePanel keepMounted>
          <div className="px-3 pb-3">
            <div className="mb-3 space-y-1.5">
              {model.showComputers ? (
                <CloudEnvironmentConnectRows
                  primaryEnvironmentId={null}
                  savedEnvironments={environments}
                  showSavedEnvironments
                  onDiscoveryReady={onDiscoveryReady}
                  selection={{ selectedIds, onChange: onToggleEnvironment, autoSelectedComputers }}
                  refreshWhileEmpty
                  empty={<p className="py-3 text-sm text-muted-foreground">{model.emptyLabel}</p>}
                />
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{model.instructions}</p>
            <CommandBlock model={model.command} className="mt-3" />
            <p className="mt-3 text-xs text-muted-foreground">{model.footnote}</p>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

// ── Step 2′: Direct pairing ──────────────────────────────────

/**
 * Register a computer in this browser using a server-minted pairing link.
 */
function PairingForm({
  form,
  isPairing,
  setIsPairing,
  setPairingUrl,
  setErrorMessage,
  onPaired,
}: {
  readonly form: OnboardingPairingFormModel;
  readonly isPairing: boolean;
  readonly setIsPairing: (value: boolean) => void;
  readonly setPairingUrl: (value: string) => void;
  readonly setErrorMessage: (value: string) => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async () => {
    const decision = resolveOnboardingPairingSubmit({ isPairing, pairingUrl: form.value });
    if (decision.kind === "ignore") return;
    setIsPairing(true);
    setErrorMessage("");
    const result = await connectPairingEnvironment({ pairingUrl: decision.pairingUrl });
    if (!mountedRef.current) return;
    setIsPairing(false);
    if (result._tag === "Success") {
      onPaired(result.value);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    setErrorMessage(describeOnboardingPairingFailure(squashAtomCommandFailure(result)));
  };

  return (
    <>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label className="block text-sm text-muted-foreground" htmlFor={form.inputId}>
            {form.label}
          </label>
          <Input
            id={form.inputId}
            autoFocus
            aria-invalid={form.invalid}
            aria-describedby={form.errorMessage !== null ? form.errorId : undefined}
            className="mt-2"
            size="lg"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            nativeInput
            readOnly={form.readOnly}
            placeholder={form.placeholder}
            value={form.value}
            onChange={(event) => setPairingUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              ) {
                event.preventDefault();
              }
            }}
          />
        </div>
        {form.errorMessage !== null ? (
          <div
            id={form.errorId}
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive"
          >
            {form.errorMessage}
          </div>
        ) : null}
        <Collapsible>
          <div className="flex items-center justify-between gap-3">
            <CollapsibleTrigger
              type="button"
              className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronRightIcon className="size-3.5 group-data-panel-open:rotate-90" />
              {form.helpToggleLabel}
            </CollapsibleTrigger>
            <Button type="submit" disabled={!form.submit.enabled}>
              {form.submit.label}
            </Button>
          </div>
          <CollapsiblePanel>
            <p className="pt-3 text-sm text-muted-foreground">{form.helpText}</p>
            <CommandBlock model={form.helpCommand} className="mt-2" />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {form.helpFootnote.map((segment, index) =>
                segment.kind === "code" ? (
                  <code key={index} className="font-mono">
                    {segment.text}
                  </code>
                ) : (
                  segment.text
                ),
              )}
            </p>
          </CollapsiblePanel>
        </Collapsible>
      </form>
    </>
  );
}

// ── Step 3: agents ───────────────────────────────────────────

/** Setup values stay fixed while provider probes refresh the surrounding cards. */
interface AgentTerminalSession {
  readonly environmentId: EnvironmentId;
  readonly driver: OnboardingAgentDriver;
  readonly providerInstanceId: ServerProvider["instanceId"];
  readonly cwd: string;
  readonly command: string;
  readonly keybindings: ServerConfig["keybindings"];
}

/** Codex uses managed setup; existing CLI installs retain the terminal path. */
function AgentsStep({
  environmentIds,
  onContinue,
}: {
  readonly environmentIds: readonly EnvironmentId[];
  readonly onContinue: () => void;
}) {
  const { environments } = useEnvironments();
  const model = buildWelcomeAgentsStepModel({ sections: [] });
  return (
    <StepShell title={model.heading} description={model.description}>
      <ScrollArea scrollFade className="mt-5 h-auto max-h-[min(32rem,55dvh)]">
        <div className="space-y-5 pr-3">
          {environmentIds.map((environmentId) => (
            <ConnectedAgentsStep
              key={environmentId}
              environmentId={environmentId}
              machineLabel={resolveOnboardingMachineLabel(environments, environmentId)}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="mt-6 flex justify-end">
        <Button autoFocus disabled={!model.continueButton.enabled} onClick={onContinue}>
          {model.continueButton.label}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </StepShell>
  );
}

function ConnectedAgentsStep({
  environmentId,
  machineLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly machineLabel: string;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const [terminalSession, setTerminalSession] = useState<AgentTerminalSession | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [createdAccount, setCreatedAccount] = useState<OnboardingCreatedAccount | null>(null);

  // Re-probe on entry so freshly installed CLIs show up without a manual
  // refresh; harmless when nothing changed (single-flighted per environment).
  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  const primaryAgents = resolveOnboardingPrimaryAgents(providers, createdAccount);
  const model = buildOnboardingAgentsSectionModel({
    environmentId,
    machineLabel,
    providers,
    createdAccountInstanceId: createdAccount?.instanceId ?? null,
    terminalDriver: terminalSession?.driver ?? null,
    serverConfigAvailable: serverConfig !== null,
  });
  const openTerminal = (driver: OnboardingAgentDriver, provider: ServerProvider | undefined) => {
    if (provider === undefined || serverConfig === null) return;
    setTerminalSession({
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
      keybindings: serverConfig.keybindings,
    });
  };
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{model.heading}</h2>
      <div className="space-y-1.5">
        {primaryAgents.map(({ driver, provider, instanceId }, index) => {
          const card = model.cards[index];
          if (card === undefined) return null;
          return card.kind === "codexSetup" && serverConfig !== null ? (
            <OnboardingCodexSetup
              key={card.key}
              environmentId={environmentId}
              provider={provider}
              serverConfig={serverConfig}
              createdAccount={instanceId === createdAccount?.instanceId ? createdAccount : null}
              onAutoStartConsumed={() =>
                setCreatedAccount((account) => (account ? { ...account, autoStart: false } : null))
              }
              terminalOpen={terminalSession?.driver === driver}
              onOpenTerminal={() => openTerminal(driver, provider)}
            />
          ) : card.kind === "card" ? (
            <AgentCard
              key={card.key}
              model={card.card}
              onOpenTerminal={() => openTerminal(driver, provider)}
            />
          ) : null;
        })}
      </div>
      {model.addAccountLabel !== null ? (
        <div className="mt-3">
          <Button size="xs" variant="ghost-muted" onClick={() => setAddingAccount(true)}>
            {model.addAccountLabel}
          </Button>
        </div>
      ) : null}
      {addingAccount ? (
        <AddManagedCodexAccountDialog
          environmentId={environmentId}
          onClose={() => setAddingAccount(false)}
          onAccountCreated={(instanceId, displayName) =>
            setCreatedAccount({ instanceId, displayName, autoStart: true })
          }
        />
      ) : null}
      {terminalSession !== null ? (
        <AgentInstallTerminal
          key={`${terminalSession.environmentId}:${terminalSession.providerInstanceId}:${terminalSession.driver}`}
          session={terminalSession}
          onClose={() => {
            setTerminalSession(null);
            void refreshProviders({ environmentId, input: {} });
          }}
        />
      ) : null}
    </section>
  );
}

function OnboardingCodexSetup({
  createdAccount,
  onAutoStartConsumed,
  environmentId,
  provider,
  serverConfig,
  terminalOpen,
  onOpenTerminal,
}: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider | undefined;
  readonly serverConfig: ServerConfig;
  readonly terminalOpen: boolean;
  readonly onOpenTerminal: () => void;
  readonly createdAccount: OnboardingCreatedAccount | null;
  readonly onAutoStartConsumed: () => void;
}) {
  const update = useAtomCommand(serverEnvironment.updateSettings, "Codex setup settings");
  const settings = serverConfig.settings;
  const setup = resolveOnboardingCodexSetup({
    settings,
    providerInstanceId: provider?.instanceId,
    createdAccount,
  });
  const changeMode = (setupMode: "managed" | "existing") => {
    void update({
      environmentId,
      input: {
        patch: buildProviderInstanceUpdatePatch({
          settings,
          instanceId: setup.instanceId,
          driver: ProviderDriverKind.make("codex"),
          isDefault: setup.isDefault,
          instance: resolveOnboardingCodexModeInstance(setup.instance, setupMode),
        }),
      },
    });
  };
  return setup.existingChosen ? (
    <AgentCard
      model={buildOnboardingAgentCardModel({
        driver: "codex",
        provider,
        terminalOpen,
        terminalAvailable: true,
      })}
      onOpenTerminal={onOpenTerminal}
    />
  ) : (
    <CodexSetupSection
      presentation="onboarding"
      autoStart={createdAccount?.autoStart === true}
      displayName={createdAccount?.displayName}
      onAutoStartConsumed={onAutoStartConsumed}
      environmentId={environmentId}
      instanceId={setup.instanceId}
      provider={provider}
      mode={setup.mode}
      enabled={provider?.enabled ?? true}
      onModeChange={changeMode}
    />
  );
}

function AgentCard({
  model,
  onOpenTerminal,
}: {
  readonly model: OnboardingAgentCardModel;
  readonly onOpenTerminal: () => void;
}) {
  const Icon = getDriverOption(ProviderDriverKind.make(model.icon))?.icon;
  const status = model.status;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-4">
      {Icon ? (
        <Icon className={cn("size-5 shrink-0", model.iconFilled && "fill-foreground")} />
      ) : null}
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{model.displayName}</span>
        <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {model.description}
        </p>
      </div>
      <div className="shrink-0">
        {status.kind === "ready" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
            <CheckIcon className="size-3.5" />
            {status.label}
          </span>
        ) : status.kind === "text" ? (
          <span className="text-xs text-muted-foreground">{status.label}</span>
        ) : (
          <Button size="xs" variant="ghost" onClick={onOpenTerminal} disabled={!status.enabled}>
            <TerminalIcon className="size-3.5" />
            {status.label}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline install terminal. Opens a PTY on the connected environment under a
 * synthetic onboarding thread id (terminals are keyed by free-form thread id;
 * the server validates only the cwd) and pre-types the install or login
 * command without submitting, so the user reviews and presses Enter.
 */
function AgentInstallTerminal({
  session,
  onClose,
}: {
  readonly session: AgentTerminalSession;
  readonly onClose: () => void;
}) {
  const { command, cwd, driver, environmentId, keybindings, providerInstanceId } = session;
  // Same terminal typography preference the thread drawer honors.
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const setupQueueRef = useRef(Promise.resolve());
  const setupGenerationRef = useRef(0);
  const activeSetupGenerationRef = useRef<number | null>(null);
  const [terminalId] = useState(() => `onboarding-${driver}-${randomUUID()}`);
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, AGENT_ONBOARDING_THREAD_ID),
    [environmentId],
  );
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [setupState, setSetupState] = useState<OnboardingAgentTerminalSetupState>("preparing");
  const terminalModel = buildOnboardingAgentTerminalModel({ setupState, command, driver });

  // Keep each setup generation distinct. In Strict Mode, a canceled open can
  // finish after the replacement setup starts; it must not close or pre-type
  // into the replacement session that shares this terminal id.
  useEffect(() => {
    const generation = setupGenerationRef.current + 1;
    setupGenerationRef.current = generation;
    activeSetupGenerationRef.current = generation;
    setSetupState("preparing");

    setupQueueRef.current = setupQueueRef.current.then(async () => {
      if (activeSetupGenerationRef.current !== generation) return;
      const opened = await openTerminal({
        environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId,
          cwd,
          providerInstanceId,
        },
      });
      if (opened._tag !== "Success") {
        if (activeSetupGenerationRef.current === generation) setSetupState("openFailed");
        return;
      }

      if (activeSetupGenerationRef.current !== generation) return;

      const wrote = await writeTerminal({
        environmentId,
        input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, data: command },
      });
      if (activeSetupGenerationRef.current !== generation) return;
      setSetupState(wrote._tag === "Success" ? "ready" : "writeFailed");
    });

    // Every exit path unmounts the drawer (Done, Continue/Skip, card switch,
    // session exit), so this cleanup is the single place the PTY dies —
    // nothing is left running behind the wizard. An interrupted install is
    // re-runnable from the card.
    return () => {
      if (activeSetupGenerationRef.current === generation) {
        activeSetupGenerationRef.current = null;
      }
      setupQueueRef.current = setupQueueRef.current.then(async () => {
        await closeTerminal({
          environmentId,
          input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, deleteHistory: true },
        });
      });
    };
  }, [
    closeTerminal,
    command,
    cwd,
    environmentId,
    openTerminal,
    providerInstanceId,
    setupAttempt,
    terminalId,
    writeTerminal,
  ]);

  return (
    <div
      data-thread-terminal-drawer
      className="mt-4 overflow-hidden rounded-lg border border-border/70 bg-background text-foreground"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-3 py-1.5">
        <span className="text-2xs font-medium text-muted-foreground">
          {terminalModel.message.kind === "runCommand" ? (
            <>
              Run{" "}
              <code className="rounded bg-muted px-1 font-mono">
                {terminalModel.message.command}
              </code>{" "}
              in this terminal.
            </>
          ) : (
            terminalModel.message.text
          )}
        </span>
        <div className="flex items-center gap-1">
          {terminalModel.retryLabel !== null ? (
            <Button size="xs" variant="ghost" onClick={() => setSetupAttempt((value) => value + 1)}>
              {terminalModel.retryLabel}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost-muted" onClick={onClose}>
            {terminalModel.closeLabel}
          </Button>
        </div>
      </div>
      <div className="h-64">
        {terminalModel.showViewport ? (
          <TerminalViewport
            threadRef={threadRef}
            threadId={AGENT_ONBOARDING_THREAD_ID}
            terminalId={terminalId}
            terminalLabel={terminalModel.terminalLabel}
            cwd={cwd}
            providerInstanceId={providerInstanceId}
            advancedTypography={advancedTypography}
            onSessionExited={onClose}
            focusRequestId={1}
            autoFocus
            visible
            resizeEpoch={0}
            drawerHeight={256}
            keybindings={keybindings}
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Step 4: import ───────────────────────────────────────────

function ImportStep({
  scans,
  isImporting,
  setIsImporting,
  onDone,
}: {
  readonly scans: ReadonlyArray<OnboardingImportScanInput & { readonly refresh: () => void }>;
  readonly isImporting: boolean;
  readonly setIsImporting: (value: boolean) => void;
  readonly onDone: (
    projectRef?: ScopedProjectRef,
    importWarning?: string,
    importedThreadCount?: number,
  ) => Promise<boolean>;
}) {
  const { environments } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importThreads = useAtomCommand(agentSessionImport, { reportFailure: false });
  const projects = useProjects();
  const [selectedPaths, setSelectedPaths] = useState<ReadonlyArray<string> | null>(null);
  const importWarningRef = useRef("");
  const importedThreadCountRef = useRef(0);
  const [landingProject, setLandingProject] = useState<ScopedProjectRef | null>(null);
  // Keep project creation attempts separate from completed history imports so both can retry.
  const importedProjectsRef = useRef(new Map<string, ScopedProjectRef>());
  const projectsWithImportedHistoryRef = useRef(new Map<string, ScopedProjectRef>());
  const lastImportSelectionRef = useRef<ReadonlyArray<string>>([]);
  const projectAttemptsRef = useRef(
    new Map<string, { readonly projectId: ProjectId; readonly commandId: CommandId }>(),
  );
  const importGenerationRef = useRef(0);

  // Ignore command completions after leaving the import step.
  useEffect(() => {
    importGenerationRef.current += 1;
    return () => {
      importGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (
      landingProject !== null &&
      projects.some(
        (project) =>
          project.id === landingProject.projectId &&
          project.environmentId === landingProject.environmentId,
      )
    ) {
      setLandingProject(null);
      void onDone(landingProject, importWarningRef.current, importedThreadCountRef.current).then(
        (completed) => {
          if (!completed) setIsImporting(false);
        },
      );
    }
  }, [landingProject, onDone, projects, setIsImporting]);

  const { available: candidates } = useMemo(
    () => resolveOnboardingImportCandidates(scans, Date.now()),
    [scans],
  );
  const model = buildWelcomeImportStepModel({
    scans,
    environments,
    selectedKeys: selectedPaths,
    isImporting,
    nowMs: Date.now(),
  });
  const selectedKeys = model.kind === "import" ? model.selectedKeys : [];
  const selected = candidates.filter((candidate) => selectedKeys.includes(candidate.key));

  const finishAfterImport = () => {
    const projectRef = resolveOnboardingLandingProject(
      lastImportSelectionRef.current,
      projectsWithImportedHistoryRef.current,
      importedProjectsRef.current,
    );
    if (projectRef === undefined) {
      void onDone(undefined, importWarningRef.current, importedThreadCountRef.current);
      return;
    }
    setIsImporting(true);
    setLandingProject(projectRef);
  };

  const runImport = async (selection: ReadonlyArray<OnboardingImportCandidate>) => {
    const decision = resolveOnboardingImportSubmit({
      isImporting,
      selectionCount: selection.length,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "finish") {
      void onDone();
      return;
    }
    setIsImporting(true);
    importWarningRef.current = "";
    importedThreadCountRef.current = 0;
    lastImportSelectionRef.current = selection.map((candidate) => candidate.key);
    const importGeneration = importGenerationRef.current;
    const importedProjects = importedProjectsRef.current;
    const projectAttempts = projectAttemptsRef.current;
    // Interrupted imports are neither failures nor successes — the command was
    // superseded or the environment dropped — but they still didn't land, so
    // they must not read as "imported everything". Retries skip paths that
    // already landed this session (re-creating them would only trip the
    // duplicate-root invariant and read as a failure).
    let importedProjectsCount =
      importedProjects.size > 0
        ? selection.filter((candidate) => importedProjects.has(candidate.key)).length
        : 0;
    let importedThreadCount = 0;
    let skippedThreadCount = 0;
    const refreshEnvironments = new Set<EnvironmentId>();
    for (const candidate of selection) {
      const { environmentId } = candidate;
      if (
        importGeneration !== importGenerationRef.current ||
        importedProjects !== importedProjectsRef.current
      ) {
        return;
      }
      if (importedProjects.has(candidate.key)) continue;
      let projectId = resolveOnboardingProjectId(readProjects(), environmentId, candidate);
      if (projectId === null) {
        let attempt = projectAttempts.get(candidate.key);
        if (attempt === undefined) {
          const nextProjectId = newProjectId();
          attempt = {
            projectId: nextProjectId,
            commandId: CommandId.make(`onboarding:project:create:${nextProjectId}`),
          };
          projectAttempts.set(candidate.key, attempt);
        }
        projectId = attempt.projectId;
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: attempt.commandId,
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (
          importGeneration !== importGenerationRef.current ||
          importedProjects !== importedProjectsRef.current
        ) {
          return;
        }
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            projectAttempts.delete(candidate.key);
            refreshEnvironments.add(environmentId);
          }
          continue;
        }
      }

      const threadImportResult = await importThreads({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path },
      });
      if (
        importGeneration !== importGenerationRef.current ||
        importedProjects !== importedProjectsRef.current
      ) {
        return;
      }
      if (threadImportResult._tag === "Success") {
        importedThreadCount += threadImportResult.value.importedCount;
        skippedThreadCount += threadImportResult.value.skippedCount;
        if (threadImportResult.value.importedCount > 0) {
          projectsWithImportedHistoryRef.current.set(
            candidate.key,
            scopeProjectRef(environmentId, projectId),
          );
        }
        if (threadImportResult.value.skippedCount === 0) {
          importedProjectsCount += 1;
          importedProjects.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
      } else if (!isAtomCommandInterrupted(threadImportResult)) {
        projectAttempts.delete(candidate.key);
        refreshEnvironments.add(environmentId);
      }
    }
    for (const scan of scans) {
      if (refreshEnvironments.has(scan.environmentId)) scan.refresh();
    }
    setIsImporting(false);
    importedThreadCountRef.current = importedThreadCount;
    importWarningRef.current = resolveOnboardingImportWarning({
      importedProjectsCount,
      selectionCount: selection.length,
      importedThreadCount,
      skippedThreadCount,
    });
    finishAfterImport();
  };

  if (model.kind === "importLoading") {
    return (
      <div className="flex h-full min-h-40 flex-col">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{model.heading}</h1>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
          <Spinner size="lg" tone="muted" />
          <p className="text-center text-sm text-muted-foreground">{model.message}</p>
        </div>
        <div className="flex justify-end">
          <Button
            variant="ghost-muted"
            disabled={!model.skipButton.enabled}
            onClick={() => void onDone()}
          >
            {model.skipButton.label}
          </Button>
        </div>
      </div>
    );
  }

  const toggleKeys = (keys: ReadonlyArray<string>, checked: boolean) =>
    setSelectedPaths(setOnboardingImportKeys(model.selectedKeys, keys, checked));

  return (
    <StepShell title={model.heading} description={model.description}>
      {model.selection !== null ? (
        <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span role="status">{model.selection.summary}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={!model.selection.selectAll.enabled}
              onClick={() => setSelectedPaths(model.allKeys)}
            >
              {model.selection.selectAll.label}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={!model.selection.selectNone.enabled}
              onClick={() => setSelectedPaths([])}
            >
              {model.selection.selectNone.label}
            </Button>
          </div>
        </div>
      ) : null}
      <ScrollArea scrollFade className="mt-2 h-auto max-h-80">
        <div className="space-y-5 pr-3">
          {model.sections.map((section) => {
            const scan = scans.find((item) => item.environmentId === section.environmentId);
            const status = section.status;
            return (
              <fieldset
                key={section.environmentId}
                className="min-w-0 space-y-0.5"
                disabled={section.disabled}
              >
                {section.legend !== null ? (
                  <legend className="mb-2 text-sm font-medium">{section.legend}</legend>
                ) : null}
                {status.kind === "pending" ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                    <Spinner size="md" />
                    {status.label}
                  </div>
                ) : status.kind === "error" ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <span>{status.message}</span>
                    <Button variant="ghost" size="sm" onClick={() => scan?.refresh()}>
                      {status.retryLabel}
                    </Button>
                  </div>
                ) : status.kind === "empty" ? (
                  <p className="py-2 text-sm text-muted-foreground">{status.label}</p>
                ) : null}
                {section.truncatedMessage !== null ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {section.truncatedMessage}
                  </p>
                ) : null}
                <ImportCandidateList list={section.list} onToggle={toggleKeys} />
              </fieldset>
            );
          })}
        </div>
      </ScrollArea>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="ghost-muted"
          disabled={!model.skipButton.enabled}
          onClick={finishAfterImport}
        >
          {model.skipButton.label}
        </Button>
        <Button
          autoFocus
          disabled={!model.importButton.enabled}
          onClick={() => void runImport(selected)}
        >
          {model.importButton.label}
        </Button>
      </div>
    </StepShell>
  );
}

/**
 * Repositories first, newest activity on top. Clones of one repository share
 * a group with a tri-state checkbox. Folders that are not git repositories
 * sit collapsed at the bottom so they stay reachable without adding noise.
 * Source icons appear only on repository rows so the columns stay still.
 */
function ImportCandidateList({
  list,
  onToggle,
}: {
  readonly list: OnboardingImportListModel;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  const other = list.other;
  return (
    <>
      {list.groups.map((group) => (
        <ImportRepositoryGroup
          key={group.kind === "row" ? group.row.key : group.key}
          group={group}
          onToggle={onToggle}
        />
      ))}
      {other !== null ? (
        <Collapsible>
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
            <Checkbox
              checked={other.checked}
              indeterminate={other.indeterminate}
              onCheckedChange={(checked) => onToggle(other.keys, checked === true)}
            />
            <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
              <span className="truncate text-sm text-muted-foreground">{other.label}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {other.countLabel}
              </span>
            </CollapsibleTrigger>
          </div>
          <CollapsiblePanel>
            {other.rows.map((row) => (
              <ImportCandidateRow
                key={row.key}
                row={row}
                onCheckedChange={(checked) => onToggle([row.key], checked)}
              />
            ))}
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </>
  );
}

function ImportRepositoryGroup({
  group,
  onToggle,
}: {
  readonly group: OnboardingImportGroupModel;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  if (group.kind === "row") {
    return (
      <ImportCandidateRow
        row={group.row}
        onCheckedChange={(checked) => onToggle([group.row.key], checked)}
      />
    );
  }
  return (
    <Collapsible defaultOpen>
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
        <Checkbox
          checked={group.checked}
          indeterminate={group.indeterminate}
          onCheckedChange={(checked) => onToggle(group.keys, checked === true)}
        />
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
          <span className="truncate text-sm font-medium">{group.label}</span>
          <ImportRowMeta meta={group.meta} />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        {group.rows.map((row) => (
          <ImportCandidateRow
            key={row.key}
            row={row}
            onCheckedChange={(checked) => onToggle([row.key], checked)}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ImportCandidateRow({
  row,
  onCheckedChange,
}: {
  readonly row: OnboardingImportRowModel;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 has-disabled:cursor-default",
        row.nested && "pl-8",
      )}
    >
      <Checkbox
        checked={row.checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Tooltip>
        <TooltipTrigger
          render={<span className="flex min-w-0 flex-1 items-baseline gap-2 truncate" />}
        >
          <span
            className={cn("truncate", row.nested ? "font-mono text-xs" : "text-sm font-medium")}
          >
            {row.label}
          </span>
          {row.secondary !== null ? (
            <span className="truncate font-mono text-2xs text-muted-foreground">
              {row.secondary}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup variant="code">{row.tooltip}</TooltipPopup>
      </Tooltip>
      <ImportRowMeta meta={row.meta} />
    </label>
  );
}

const IMPORT_SOURCE_ICONS = { claude: ClaudeAI, codex: OpenAI, pi: PiAgentIcon } as const;

/**
 * Trailing columns shared by every import row: source icons, thread count,
 * last activity. Each column has a fixed width and each icon has its own slot
 * so nothing shifts between rows that differ in sources or digit count.
 */
function ImportRowMeta({ meta }: { readonly meta: OnboardingImportRowMetaModel }) {
  return (
    <span className="ml-auto grid shrink-0 grid-cols-[1rem_1rem_1rem_2.5rem_2.25rem] items-center gap-x-1 text-xs text-muted-foreground tabular-nums">
      {meta.sourceSlots.map((slot, index) => {
        const Icon = slot === null ? null : IMPORT_SOURCE_ICONS[slot.icon];
        return (
          <span key={index} className="flex size-4 items-center justify-center">
            {slot !== null && Icon !== null ? (
              <Icon className="size-3" aria-label={slot.label} />
            ) : null}
          </span>
        );
      })}
      <span className="text-right">{meta.threadCount}</span>
      <span className="text-right whitespace-nowrap">{meta.age}</span>
    </span>
  );
}

// ── Shared bits ──────────────────────────────────────────────

function StepShell({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? (
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </>
  );
}

function CommandBlock({
  model,
  className,
  prominent = false,
}: {
  readonly model: OnboardingCommandBlockModel;
  readonly className?: string;
  readonly prominent?: boolean;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    timeout: 1500,
    target: "command",
  });
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 font-mono",
        prominent ? "px-4 py-3.5 text-base" : "px-3 py-2.5 text-sm",
        className,
      )}
    >
      <span className="min-w-0 truncate">
        <span className="mr-2 text-muted-foreground">{model.prompt}</span>
        {model.command}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={model.copyLabel}
        onClick={() => copyToClipboard(model.command, undefined)}
      >
        {isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </Button>
    </div>
  );
}
