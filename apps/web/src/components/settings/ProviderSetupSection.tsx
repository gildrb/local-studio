import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AntigravityAuthMethod,
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsRow } from "./settingsLayout";
import {
  buildProviderSetupModel,
  buildProviderSetupSectionModel,
  PROVIDER_SETUP_UNEXPECTED_FAILURE_MESSAGE,
  resolveProviderSetupAction,
  resolveProviderSetupCallbackUrl,
  resolveProviderSetupFailureMessage,
  type ProviderSetupCommand,
  type ProviderSetupIntent,
} from "./ProviderSetupSection.logic";

interface ProviderSetupSectionProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly binaryPath?: string | undefined;
  readonly authMethod?: AntigravityAuthMethod | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly onEnable: () => void;
}

/** Setup state belongs to the selected environment and is never saved in client settings. */
export function ProviderSetupSection(props: ProviderSetupSectionProps) {
  const model = buildProviderSetupSectionModel({
    environmentLabel: props.environmentLabel,
    enabled: props.enabled,
    readOnly: props.readOnly,
    hasSetup: props.provider?.setup !== undefined,
  });
  return (
    <section
      aria-label={model.ariaLabel}
      className="@container/setup divide-y divide-border/50 text-xs"
    >
      <SettingsRow
        className="@max-lg/setup:[&>div:first-child]:flex @max-lg/setup:[&>div:first-child]:items-stretch @max-lg/setup:[&>div:first-child]:gap-3"
        title={model.environment.title}
        description={model.environment.description}
        control={
          <div className="flex min-w-0 flex-col gap-2 sm:items-end">
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {model.environment.value}
            </span>
            {model.environment.enableLabel ? (
              <Button size="sm" variant="outline" onClick={props.onEnable}>
                {model.environment.enableLabel}
              </Button>
            ) : null}
          </div>
        }
      />
      {model.body.kind === "notice" ? (
        <SettingsRow title={model.body.title} description={model.body.description} />
      ) : props.provider ? (
        <ProviderSetupActions
          key={`${props.environmentId}:${props.instanceId}`}
          environmentId={props.environmentId}
          environmentLabel={props.environmentLabel}
          instanceId={props.instanceId}
          provider={props.provider}
          binaryPath={props.binaryPath}
          authMethod={props.authMethod ?? "oauth-personal"}
          enabled={props.enabled}
        />
      ) : null}
    </section>
  );
}

function ProviderSetupActions({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  enabled,
  binaryPath,
  authMethod,
}: Pick<
  ProviderSetupSectionProps,
  "environmentId" | "environmentLabel" | "instanceId" | "enabled" | "binaryPath"
> & {
  readonly provider: ServerProvider;
  readonly authMethod: AntigravityAuthMethod;
}) {
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const auth = authQuery.data;
  const installation = installQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startAuth = useAtomCommand(serverEnvironment.startProviderAuth, commandOptions);
  const completeAuth = useAtomCommand(serverEnvironment.completeProviderAuth, commandOptions);
  const cancelAuth = useAtomCommand(serverEnvironment.cancelProviderAuth, commandOptions);
  const logoutAuth = useAtomCommand(serverEnvironment.logoutProviderAuth, commandOptions);
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, commandOptions);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, commandOptions);
  const removeInstall = useAtomCommand(
    serverEnvironment.removeProviderInstallation,
    commandOptions,
  );
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [callbackDraft, setCallbackDraft] = useState({ flowId: null as string | null, value: "" });
  const [copiedFlowId, setCopiedFlowId] = useState<string | null>(null);
  const callbackUrl = resolveProviderSetupCallbackUrl(callbackDraft, auth);
  const queryError = authQuery.error ?? installQuery.error;
  const model = buildProviderSetupModel({
    instanceId,
    provider,
    authMethod,
    binaryPath,
    enabled,
    auth,
    installation,
    queryError,
    error,
    pendingLabel,
    callbackDraft,
    copiedFlowId,
  });
  const { runtime, auth: authModel } = model;
  const runtimeControl = runtime.primaryControl;
  const authControl = authModel.primaryControl;

  async function runCommand<A, E>(
    label: string,
    request: () => Promise<AtomCommandResult<A, E>>,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingLabel(label);
    setError(null);
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setError(resolveProviderSetupFailureMessage(squashAtomCommandFailure(result)));
        }
        return false;
      }
      return true;
    } catch {
      setError(PROVIDER_SETUP_UNEXPECTED_FAILURE_MESSAGE);
      return false;
    } finally {
      pendingRef.current = false;
      setPendingLabel(null);
    }
  }

  function runSetupCommand(label: string, command: ProviderSetupCommand): Promise<boolean> {
    switch (command.type) {
      case "start-install":
        return runCommand(label, () => startInstall(target));
      case "cancel-install":
        return runCommand(label, () =>
          cancelInstall({ environmentId, input: { instanceId, operationId: command.operationId } }),
        );
      case "remove-install":
        return runCommand(label, () => removeInstall(target));
      case "start-auth":
        return runCommand(label, () => startAuth(target));
      case "complete-auth":
        return runCommand(label, () =>
          completeAuth({
            environmentId,
            input: { instanceId, flowId: command.flowId, callbackUrl: command.callbackUrl },
          }),
        );
      case "cancel-auth":
        return runCommand(label, () =>
          cancelAuth({ environmentId, input: { instanceId, flowId: command.flowId } }),
        );
      case "logout":
        return runCommand(label, () => logoutAuth(target));
    }
  }

  async function perform(intent: ProviderSetupIntent): Promise<boolean> {
    const decision = resolveProviderSetupAction(intent, {
      authMethod,
      providerDisplayName: provider.displayName,
      environmentLabel,
      auth,
      installation,
      callbackUrl,
    });
    switch (decision.kind) {
      case "none":
        return false;
      case "run":
        return runSetupCommand(decision.label, decision.command);
      case "confirm-then-run": {
        const confirmed = await ensureLocalApi().dialogs.confirm(decision.message);
        if (!confirmed) return false;
        return runSetupCommand(decision.label, decision.command);
      }
      case "open-external":
        try {
          await ensureLocalApi().shell.openExternal(decision.url);
          setError(null);
          return true;
        } catch {
          setError(decision.failureMessage);
          return false;
        }
      case "copy":
        try {
          await writeTextToClipboard(decision.text, decision.label);
          setCopiedFlowId(decision.flowId);
          setError(null);
          return true;
        } catch {
          setError(decision.failureMessage);
          return false;
        }
    }
  }

  async function submitCallback() {
    if (await perform({ kind: "submit-callback" })) {
      setCallbackDraft({ flowId: null, value: "" });
    }
  }

  return (
    <div className="divide-y divide-border/50">
      <SettingsRow
        title={runtime.title}
        className="@max-lg/setup:[&>div:first-child]:flex @max-lg/setup:[&>div:first-child]:items-stretch @max-lg/setup:[&>div:first-child]:gap-3"
        description={runtime.description}
        status={
          <div className="space-y-2">
            {runtime.notices.map((notice) => (
              <p key={notice} className="text-muted-foreground">
                {notice}
              </p>
            ))}
          </div>
        }
        control={
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-56 sm:text-right">
            <p role="status" className="min-h-4 text-muted-foreground tabular-nums">
              {runtime.statusMessage}
            </p>
            <div className="h-1">
              {runtime.progress ? (
                <progress
                  aria-label={runtime.progress.label}
                  className="block h-1 w-full accent-foreground"
                  value={runtime.progress.value}
                  max={runtime.progress.max}
                />
              ) : null}
            </div>
            {runtime.detailMessage ? (
              <p className="text-muted-foreground [overflow-wrap:anywhere]">
                {runtime.detailMessage}
              </p>
            ) : null}
            <div className="grid min-h-7 grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
              <div className="col-start-2 row-start-1 grid">
                {runtimeControl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runtimeControl.disabled}
                    onClick={() => void perform({ kind: runtimeControl.kind })}
                  >
                    {runtimeControl.label}
                  </Button>
                ) : null}
              </div>
              {runtime.remove ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="col-start-1 row-start-1"
                        aria-label={runtime.remove.label}
                        disabled={runtime.remove.disabled}
                        onClick={() => void perform({ kind: "remove-runtime" })}
                      />
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup>{runtime.remove.label}</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
        }
      />

      <SettingsRow
        title={authModel.title}
        className="@max-lg/setup:[&>div:first-child]:flex @max-lg/setup:[&>div:first-child]:items-stretch @max-lg/setup:[&>div:first-child]:gap-3"
        description={authModel.description}
        control={
          <div className="flex min-w-0 flex-col gap-2 sm:max-w-56 sm:items-end sm:text-right xl:max-w-72">
            <p
              role="status"
              className={
                authModel.statusVisuallyHidden
                  ? "sr-only"
                  : "text-muted-foreground [overflow-wrap:anywhere]"
              }
            >
              {authModel.statusMessage}
            </p>
            {authModel.signInLinks ? (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void perform({ kind: "open-sign-in-page" })}
                >
                  {authModel.signInLinks.openLabel}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void perform({ kind: "copy-sign-in-link" })}
                >
                  {authModel.signInLinks.copyLabel}
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {authControl ? (
                <Button
                  size="sm"
                  variant={authControl.kind === "cancel-sign-in" ? "ghost" : "outline"}
                  disabled={authControl.disabled}
                  onClick={() => void perform({ kind: authControl.kind })}
                >
                  {authControl.label}
                </Button>
              ) : null}
              {authModel.signOut ? (
                <Button
                  size="sm"
                  variant={authModel.signOut.variant}
                  disabled={authModel.signOut.disabled}
                  onClick={() => void perform({ kind: "sign-out" })}
                >
                  {authModel.signOut.label}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        {authModel.callback ? (
          <div className="space-y-2 pb-2">
            {authModel.callback.kind === "form" ? (
              <>
                {authModel.callback.expiry ? (
                  <p className="text-muted-foreground">
                    {authModel.callback.expiry.prefix}{" "}
                    <time dateTime={authModel.callback.expiry.dateTime}>
                      {authModel.callback.expiry.timeLabel}
                    </time>
                    .
                  </p>
                ) : null}
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitCallback();
                  }}
                >
                  <label htmlFor={authModel.callback.inputId}>{authModel.callback.prompt}</label>
                  <Input
                    id={authModel.callback.inputId}
                    size="sm"
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={authModel.callback.placeholder}
                    value={authModel.callback.value}
                    maxLength={authModel.callback.maxLength}
                    disabled={authModel.callback.disabled}
                    onChange={(event) =>
                      setCallbackDraft({ flowId: auth?.flowId ?? null, value: event.target.value })
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    type="submit"
                    className="w-fit"
                    disabled={authModel.callback.submit.disabled}
                  >
                    {authModel.callback.submit.label}
                  </Button>
                </form>
              </>
            ) : (
              <p className="text-muted-foreground">{authModel.callback.message}</p>
            )}
          </div>
        ) : null}
      </SettingsRow>

      <p className="sr-only" role="status">
        {model.pendingStatus}
      </p>
      {model.alert ? (
        <div className="grid gap-2 px-3 py-3 sm:px-4">
          <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
            {model.alert.message}
          </p>
          {model.alert.retryLabel ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                authQuery.refresh();
                installQuery.refresh();
              }}
            >
              {model.alert.retryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
