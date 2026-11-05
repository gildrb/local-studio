import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { Children, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { ensureLocalApi } from "../../localApi";
import {
  useEnvironmentHttpBaseUrl,
  usePrimaryEnvironmentId,
  useEnvironment,
} from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ChatGptConnectionButton } from "./ChatGptConnectionButton";
import { ChatGptUsageButton } from "./ChatGptUsageButton";
import { ChatGptAccountPicker } from "./ChatGptAccountPicker";
import { Input } from "../ui/input";
import { OpenAI } from "../Icons";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsRow } from "./settingsLayout";
import { AddCodexAccountDialog } from "./AddCodexAccountDialog";
import { createCodexSetupFlow, type CodexHandoffRequest } from "./CodexSetupFlow.logic";
import {
  buildCodexManagedRuntimeFieldsModel,
  buildCodexSetupModel,
  buildCodexSetupSectionModel,
  resolveCodexAuthReturnUrl,
  resolveCodexAuthRouting,
  resolveCodexEffectiveAuth,
  resolveCodexHandoffFailure,
  resolveCodexSetupChange,
  type CodexAwaitingProvider,
  type CodexSetupDescription,
  type CodexSetupMode,
  type CodexSetupPresentation,
  type CodexSignInHelpDescription,
  type CodexStatusControl,
} from "./CodexSetupSection.logic";

const noop = () => undefined;

interface CodexSetupSectionProps {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly mode: CodexSetupMode;
  readonly enabled: boolean;
  readonly readOnly?: boolean;
  readonly presentation?: CodexSetupPresentation;
  readonly onModeChange: (mode: CodexSetupMode) => void;
  readonly autoStart?: boolean;
  readonly displayName?: string | undefined;
  readonly onAutoStartConsumed?: () => void;
  readonly onSignInCancelled?: (() => void) | undefined;
}

function renderCodexDescription(
  description: CodexSetupDescription,
  options: {
    readonly emailClassName?: string;
    readonly controls?: string;
    readonly onToggle?: () => void;
  } = {},
): ReactNode {
  switch (description.kind) {
    case "text":
      return description.text;
    case "signed-in":
      return (
        <>
          {description.prefix}{" "}
          <RedactedSensitiveText
            value={description.email}
            ariaLabel={description.ariaLabel}
            revealTooltip={description.revealTooltip}
            hideTooltip={description.hideTooltip}
            {...(options.emailClassName ? { className: options.emailClassName } : {})}
          />
          {description.suffix}
        </>
      );
    case "sign-in-help":
      return (
        <CodexSignInDescription
          description={description}
          controls={options.controls}
          onToggle={options.onToggle}
        />
      );
  }
}

function CodexStatus({ control }: { readonly control: CodexStatusControl }) {
  return control.kind === "ready" ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
      <CheckIcon className="size-3.5" />
      {control.label}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">{control.label}</span>
  );
}

/** Welcome and provider settings run the same environment-owned setup flow. */
export function CodexSetupSection(props: CodexSetupSectionProps) {
  const [requested, setRequested] = useState(false);
  const model = buildCodexSetupSectionModel({
    mode: props.mode,
    presentation: props.presentation,
    displayName: props.displayName,
    provider: props.provider,
    enabled: props.enabled,
    readOnly: props.readOnly === true,
  });
  switch (model.kind) {
    case "existing-card": {
      const control = model.control;
      const secondary = model.secondary;
      return (
        <CodexWelcomeCard
          title={model.title}
          description={renderCodexDescription(model.description, { emailClassName: "break-all" })}
          control={
            control.kind === "connect" ? (
              <ChatGptConnectionButton
                size="sm"
                disabled={control.disabled}
                onClick={() => {
                  setRequested(true);
                  props.onModeChange(control.mode);
                }}
              >
                {control.label}
              </ChatGptConnectionButton>
            ) : (
              <CodexStatus control={control} />
            )
          }
          secondaryControl={
            secondary ? (
              <Button
                size="sm"
                variant="ghost-muted"
                onClick={() => props.onModeChange(secondary.mode)}
              >
                {secondary.label}
              </Button>
            ) : null
          }
        />
      );
    }
    case "none":
      return null;
    case "preparing-card":
      return (
        <CodexWelcomeCard
          title={model.title}
          description={renderCodexDescription(model.description)}
          control={
            <Button size="sm" variant="outline" className="min-w-44" disabled>
              {model.controlLabel}
            </Button>
          }
          secondaryControl={
            <Button size="sm" variant="ghost-muted" disabled>
              {model.secondaryLabel}
            </Button>
          }
        />
      );
    case "preparing-row":
      return <SettingsRow title={model.title} description={model.description} />;
    case "managed":
      return (
        <ManagedCodexSetup
          key={`${props.environmentId}:${props.instanceId}`}
          {...props}
          autoStart={requested || props.autoStart === true}
          onAutoStartConsumed={() => {
            setRequested(false);
            props.onAutoStartConsumed?.();
          }}
        />
      );
  }
}

/** All add-Codex entry points use the same managed account setup. */
export function AddManagedCodexAccountDialog({
  environmentId,
  onClose,
  onAccountCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onAccountCreated?:
    | ((instanceId: ProviderInstanceId, displayName: string) => void)
    | undefined;
}) {
  return (
    <AddCodexAccountDialog
      environmentId={environmentId}
      onClose={onClose}
      onAccountCreated={onAccountCreated}
      renderSetup={(instanceId, provider) => (
        <ManagedCodexSetup
          key={instanceId}
          environmentId={environmentId}
          instanceId={instanceId}
          provider={provider}
          mode="managed"
          enabled
          autoStart
          onAutoStartConsumed={noop}
          onModeChange={noop}
          onSignInCancelled={onClose}
          allowExistingCli={false}
        />
      )}
    />
  );
}

function ManagedCodexSetup({
  environmentId,
  instanceId,
  provider,
  enabled,
  readOnly,
  onModeChange,
  autoStart,
  onAutoStartConsumed,
  allowExistingCli = true,
  presentation,
  displayName,
  onSignInCancelled,
}: CodexSetupSectionProps & {
  readonly autoStart: boolean;
  readonly onAutoStartConsumed: () => void;
  readonly allowExistingCli?: boolean;
}) {
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const [handoff, setHandoff] = useState<CodexHandoffRequest | null>(null);
  const handoffQuery = useEnvironmentQuery(
    handoff ? serverEnvironment.chatGptHandoffState(handoff) : null,
  );
  const auth = resolveCodexEffectiveAuth(authQuery.data, handoffQuery.data);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [requestedMethodId, setRequestedMethodId] = useState("chatgpt");
  const installation = installQuery.data;
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const options = { reportFailure: false, reportDefect: false };
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, options);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, options);
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, options);
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, options);
  const logoutAuth = useAtomCommand(serverEnvironment.logoutProviderAuth, options);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, options);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, options);
  const reconnectProfile = useAtomCommand(serverEnvironment.chatGptReconnectProfile, options);
  const importProfile = useAtomCommand(serverEnvironment.chatGptImportProfile, options);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironment = useEnvironment(primaryEnvironmentId);
  const primaryHttpBaseUrl = useEnvironmentHttpBaseUrl(primaryEnvironmentId);
  const hasDesktopBridge = window.desktopBridge !== undefined;
  const hasDesktopCallbackReceiver =
    window.desktopBridge?.receiveProviderAuthCallback !== undefined;
  const locationHostname = window.location.hostname;
  const primaryConnected = primaryEnvironment?.connection.phase === "connected";
  const handoffActive = handoff !== null;
  const routing = useMemo(
    () =>
      resolveCodexAuthRouting({
        httpBaseUrl,
        handoffActive,
        hasDesktopBridge,
        hasDesktopCallbackReceiver,
        locationHostname,
        primaryEnvironmentId,
        primaryConnected,
        primaryHttpBaseUrl,
      }),
    [
      httpBaseUrl,
      handoffActive,
      hasDesktopBridge,
      hasDesktopCallbackReceiver,
      locationHostname,
      primaryEnvironmentId,
      primaryConnected,
      primaryHttpBaseUrl,
    ],
  );
  const returnUrl = resolveCodexAuthReturnUrl({
    href: window.location.href,
    environmentId,
    instanceId,
  });
  const callbackHelpId = useId();
  const [callbackHelpOpen, setCallbackHelpOpen] = useState(false);
  const [callbackDraft, setCallbackDraft] = useState({ flowId: "", value: "" });
  const [pending, setPending] = useState(false);
  const [awaitingProvider, setAwaitingProvider] = useState<CodexAwaitingProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoStartHandled, setAutoStartHandled] = useState(false);
  const [transferFailed, setTransferFailed] = useState(false);
  const handoffState = handoffQuery.data;
  const queryFailed = authQuery.error !== null || installQuery.error !== null;
  const model = useMemo(
    () =>
      buildCodexSetupModel({
        environmentId,
        instanceId,
        presentation,
        displayName,
        provider,
        auth,
        installation,
        handoffActive,
        handoffState,
        queryFailed,
        enabled,
        readOnly: readOnly === true,
        pending,
        error,
        awaitingProvider,
        autoStart,
        autoStartHandled,
        transferFailed,
        requestedMethodId,
        allowExistingCli,
        routing,
        returnUrl,
        isDevelopment: import.meta.env.DEV,
        callbackDraft,
        callbackHelpOpen,
      }),
    [
      environmentId,
      instanceId,
      presentation,
      displayName,
      provider,
      auth,
      installation,
      handoffActive,
      handoffState,
      queryFailed,
      enabled,
      readOnly,
      pending,
      error,
      awaitingProvider,
      autoStart,
      autoStartHandled,
      transferFailed,
      requestedMethodId,
      allowExistingCli,
      routing,
      returnUrl,
      callbackDraft,
      callbackHelpOpen,
    ],
  );
  const { state } = model;
  const { authPhase, flowId, url, authenticated, clientCallback } = state;
  const handoffId = useId();
  const rendered = {
    snapshot: {
      environmentId,
      instanceId,
      state,
      pending,
      awaitingProvider,
      autoStart,
      autoStartHandled,
      handoff,
      handoffState,
    },
    onAutoStartConsumed,
  };
  const latest = useRef(rendered);
  latest.current = rendered;
  const [flow] = useState(() =>
    createCodexSetupFlow({
      snapshot: () => ({ ...latest.current.snapshot, href: window.location.href }),
      commands: {
        startAuth,
        completeAuth,
        cancelAuth,
        logoutAuth,
        startInstall,
        cancelInstall,
        reconnectProfile,
        importProfile,
        refreshProviders,
      },
      handoffIdPrefix: handoffId,
      setPending,
      setError,
      setAwaitingProvider,
      setHandoff,
      setTransferFailed,
      setRequestedMethodId,
      setCallbackDraft,
      setAccountPickerOpen,
      setAutoStartHandled,
      onAutoStartConsumed: () => latest.current.onAutoStartConsumed(),
      openExternal: (externalUrl) => ensureLocalApi().shell.openExternal(externalUrl),
      receiveCallback: window.desktopBridge?.receiveProviderAuthCallback,
      cancelCallback: window.desktopBridge?.cancelProviderAuthCallback,
    }),
  );
  useEffect(() => flow.clearAwaitingProvider(), [flow, authenticated, authPhase]);
  useEffect(
    () => flow.refreshAfterSignIn(),
    [flow, awaitingProvider, authPhase, refreshProviders, environmentId, instanceId],
  );
  useEffect(() => flow.importFinishedHandoff());
  const handoffFailure = resolveCodexHandoffFailure({
    handoffActive: handoff !== null,
    handoffQueryFailed: handoffQuery.error !== null,
    handoffState: handoffQuery.data,
  });
  useEffect(() => flow.applyHandoffFailure(handoffFailure), [flow, handoffFailure]);
  useEffect(() => flow.autoStart());
  useEffect(() => flow.continueAfterInstall());
  useEffect(() => flow.watchCallback(), [flow, clientCallback, url]);
  useEffect(() => flow.autoOpen());
  const { execute } = flow;

  const toggleCallbackHelp = () => setCallbackHelpOpen((open) => !open);
  const waitingControl = (
    <Button
      size="sm"
      variant={model.waitingControl.emphasized ? "default" : "outline"}
      className={presentation === "onboarding" ? "min-w-44" : undefined}
      disabled={model.waitingControl.disabled}
      onClick={() => execute(resolveCodexSetupChange({ kind: "waiting-control" }, state))}
    >
      {model.waitingControl.label}
    </Button>
  );
  const callback = model.callback;
  const browserRetry = callback?.browserRetry ?? null;
  const callbackCompletion = callback ? (
    <div className="flex w-full flex-col gap-3 text-xs leading-relaxed text-muted-foreground">
      <p>{callback.prompt}</p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          execute(resolveCodexSetupChange({ kind: "submit-callback" }, state));
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            aria-label={callback.inputLabel}
            type="password"
            autoComplete="off"
            placeholder={callback.placeholder}
            value={callback.value}
            maxLength={callback.maxLength}
            disabled={callback.inputDisabled}
            onChange={(event) =>
              setCallbackDraft({ flowId: flowId ?? "", value: event.target.value })
            }
          />
        </div>
        <Button variant="outline" type="submit" disabled={callback.submit.disabled}>
          {callback.submit.label}
        </Button>
      </form>
      {browserRetry ? (
        <div>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => void ensureLocalApi().shell.openExternal(browserRetry.url)}
          >
            {browserRetry.label}
            <ExternalLinkIcon className="size-3.5" />
          </Button>
        </div>
      ) : null}
      {callback.handoff ? (
        <details>
          <summary className="cursor-pointer">{callback.handoff.summary}</summary>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            render={<a href={callback.handoff.href} />}
          >
            {callback.handoff.label}
          </Button>
        </details>
      ) : null}
    </div>
  ) : null;
  const callbackHelpContent = model.callbackHelpVisible ? (
    <div id={callbackHelpId} className="w-full border-t border-border/50 pt-3">
      {callbackCompletion}
    </div>
  ) : null;
  const callbackFallback =
    model.callbackFallback?.kind === "inline" ? (
      callbackCompletion
    ) : model.callbackFallback?.kind === "help" ? (
      <div className="space-y-3 text-xs leading-relaxed text-muted-foreground">
        <CodexSignInDescription
          description={model.callbackFallback.description}
          controls={callbackHelpId}
          onToggle={toggleCallbackHelp}
        />
        {callbackHelpContent}
      </div>
    ) : null;

  const accountPicker = (
    <ChatGptAccountPicker
      open={accountPickerOpen}
      methods={auth?.methods ?? []}
      onClose={() => setAccountPickerOpen(false)}
      onSelect={(methodId) => {
        setAccountPickerOpen(false);
        execute(resolveCodexSetupChange({ kind: "select-account", methodId }, state));
      }}
    />
  );

  if (presentation === "onboarding") {
    const { onboarding } = model;
    const control = onboarding.control;
    const secondary = onboarding.secondary;
    return (
      <>
        {accountPicker}
        <CodexWelcomeCard
          title={onboarding.title}
          description={renderCodexDescription(onboarding.description, {
            emailClassName: "break-all",
            controls: callbackHelpId,
            onToggle: toggleCallbackHelp,
          })}
          control={
            control.kind === "waiting" ? (
              waitingControl
            ) : control.kind === "connect" ? (
              <ChatGptConnectionButton
                size="sm"
                disabled={control.disabled}
                onClick={() => execute(resolveCodexSetupChange({ kind: "connect" }, state))}
              >
                {control.label}
              </ChatGptConnectionButton>
            ) : (
              <CodexStatus control={control} />
            )
          }
          secondaryControl={
            secondary?.kind === "cancel" ? (
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={secondary.disabled}
                onClick={flow.cancelOnboarding}
              >
                {secondary.label}
              </Button>
            ) : secondary?.kind === "use-different-account" ? (
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={secondary.disabled}
                onClick={() =>
                  execute(resolveCodexSetupChange({ kind: "use-different-account" }, state))
                }
              >
                {secondary.label}
              </Button>
            ) : secondary?.kind === "use-existing-cli" ? (
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={secondary.disabled}
                onClick={() => onModeChange(secondary.mode)}
              >
                {secondary.label}
              </Button>
            ) : null
          }
        >
          {onboarding.footer === "callback-fallback" ? callbackFallback : callbackHelpContent}
          {onboarding.setupError ? (
            <p role="alert" className="text-xs text-destructive">
              {onboarding.setupError}
            </p>
          ) : null}
        </CodexWelcomeCard>
      </>
    );
  }

  const { settings } = model;
  const controls = settings.controls;
  return (
    <section aria-label={settings.ariaLabel} className="divide-y divide-border/50">
      {accountPicker}
      <SettingsRow
        title={settings.title}
        description={renderCodexDescription(model.accountDescription)}
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {controls.kind === "auth-active" ? (
              <>
                {waitingControl}
                {controls.cancel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={controls.cancel.disabled}
                    onClick={() => flow.cancelSignIn(onSignInCancelled)}
                  >
                    {controls.cancel.label}
                  </Button>
                )}
              </>
            ) : controls.kind === "install-active" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={controls.cancel.disabled}
                onClick={flow.cancelInstall}
              >
                {controls.cancel.label}
              </Button>
            ) : controls.kind === "authenticated" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={controls.changeAccount.disabled}
                  onClick={() =>
                    execute(resolveCodexSetupChange({ kind: "change-account" }, state))
                  }
                >
                  {controls.changeAccount.label}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={controls.disconnect.disabled}
                  onClick={() => execute(resolveCodexSetupChange({ kind: "disconnect" }, state))}
                >
                  {controls.disconnect.label}
                </Button>
              </>
            ) : (
              <>
                <ChatGptConnectionButton
                  size="sm"
                  disabled={controls.connect.disabled}
                  onClick={() => execute(resolveCodexSetupChange({ kind: "connect" }, state))}
                >
                  {controls.connect.label}
                </ChatGptConnectionButton>
                {controls.differentAccount ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={controls.differentAccount.disabled}
                    onClick={() =>
                      execute(resolveCodexSetupChange({ kind: "use-different-account" }, state))
                    }
                  >
                    {controls.differentAccount.label}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        }
      />
      {settings.showUsage ? (
        <div className="flex justify-end px-3 py-1 sm:px-4">
          <ChatGptUsageButton />
        </div>
      ) : null}
      {model.logoutWarning ? (
        <p role="alert" className="px-3 py-2 text-xs text-muted-foreground sm:px-4">
          {model.logoutWarning}
        </p>
      ) : null}
      {callbackFallback ? <div className="px-3 py-3 sm:px-4">{callbackFallback}</div> : null}
      {settings.errorAlert ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive sm:px-4">
          {settings.errorAlert.message}
        </p>
      ) : null}
    </section>
  );
}

/** The server selects the executable for managed instances; local config cannot override it. */
export function CodexManagedRuntimeFields({
  environmentId,
  instanceId,
  provider,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
}) {
  const installation = useEnvironmentQuery(
    serverEnvironment.providerInstallState({
      environmentId,
      input: { instanceId },
    }),
  );
  const model = buildCodexManagedRuntimeFieldsModel({
    executablePath: installation.data?.executablePath ?? null,
    installationFailed: Boolean(installation.error),
    runtimePaths: provider?.runtimePaths ?? null,
  });
  return (
    <>
      {model.rows.map((row) => (
        <SettingsRow
          key={row.id}
          title={row.title}
          description={row.description}
          control={
            <div className="w-full sm:w-80">
              <Input
                aria-label={row.inputLabel}
                value={row.value}
                title={row.tooltip ?? undefined}
                placeholder={row.placeholder}
                disabled={row.disabled}
              />
            </div>
          }
        />
      ))}
    </>
  );
}

function CodexSignInDescription({
  description,
  controls,
  onToggle,
}: {
  readonly description: CodexSignInHelpDescription;
  readonly controls?: string | undefined;
  readonly onToggle?: (() => void) | undefined;
}) {
  const toggle = description.toggle;
  if (!toggle || !onToggle) return <div className="leading-relaxed">{description.label}</div>;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-sm text-left leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={toggle.ariaLabel}
      aria-expanded={toggle.expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {description.label}
      <ChevronRightIcon
        aria-hidden
        className={`size-3 shrink-0 ${toggle.expanded ? "rotate-90" : ""}`}
      />
    </button>
  );
}

/** A single, calm setup row for the first-run welcome screen. */
function CodexWelcomeCard({
  title,
  description,
  control,
  secondaryControl,
  children,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly control?: ReactNode;
  readonly secondaryControl?: ReactNode;
  readonly children?: ReactNode;
}) {
  const footer = Children.toArray(children);
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <OpenAI className="size-5 shrink-0 fill-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
        </div>
        {control || secondaryControl ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 has-[button]:w-full has-[button]:flex-col-reverse has-[button]:items-end sm:has-[button]:w-auto sm:has-[button]:flex-row sm:has-[button]:items-center">
            {secondaryControl}
            {control}
          </div>
        ) : null}
      </div>
      {footer.length > 0 ? (
        <div className="ml-8 mt-2 flex flex-wrap items-center gap-2">{footer}</div>
      ) : null}
    </div>
  );
}
