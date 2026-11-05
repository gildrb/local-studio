import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ChatGptHandoffInput,
  ChatGptHandoffState,
  ChatGptReconnectProfile,
  ChatGptTransferredProfile,
  EnvironmentId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  CODEX_SETUP_OPEN_PAGE_FAILURE_MESSAGE,
  CODEX_SETUP_UNEXPECTED_FAILURE_MESSAGE,
  resolveCodexAuthReturnUrl,
  resolveCodexAutoOpen,
  resolveCodexContinueAfterInstall,
  resolveCodexSetupChange,
  resolveCodexSetupFailureMessage,
  resolveCodexSetupStep,
  resolveCodexSignInRoute,
  shouldAutoStartCodexSetup,
  shouldClearCodexAwaitingProvider,
  type CodexAwaitingProvider,
  type CodexCallbackDraft,
  type CodexSetupDecision,
  type CodexSetupIntent,
  type CodexSetupState,
} from "./CodexSetupSection.logic";

export type CodexHandoffRequest = {
  readonly environmentId: EnvironmentId;
  readonly input: ChatGptHandoffInput;
};

type CodexSetupTarget<I> = { readonly environmentId: EnvironmentId; readonly input: I };

type CodexSetupCommand<I, A> = (
  value: CodexSetupTarget<I>,
) => Promise<AtomCommandResult<A, unknown>>;

type InstanceInput = { readonly instanceId: ProviderInstanceId };

export type CodexSetupFlowCommands = {
  readonly startAuth: CodexSetupCommand<
    InstanceInput & {
      readonly methodId: string;
      readonly returnUrl: string;
      readonly callbackMode: "client" | "server";
    },
    unknown
  >;
  readonly completeAuth: CodexSetupCommand<
    InstanceInput & { readonly flowId: string; readonly callbackUrl: string },
    unknown
  >;
  readonly cancelAuth: CodexSetupCommand<InstanceInput & { readonly flowId: string }, unknown>;
  readonly logoutAuth: CodexSetupCommand<InstanceInput, unknown>;
  readonly startInstall: CodexSetupCommand<InstanceInput, unknown>;
  readonly cancelInstall: CodexSetupCommand<
    InstanceInput & { readonly operationId: string },
    unknown
  >;
  readonly reconnectProfile: CodexSetupCommand<
    InstanceInput & { readonly methodId: string },
    ChatGptReconnectProfile | null
  >;
  readonly importProfile: CodexSetupCommand<
    InstanceInput & { readonly profile: ChatGptTransferredProfile },
    unknown
  >;
  readonly refreshProviders: CodexSetupCommand<InstanceInput, unknown>;
};

export type CodexSetupFlowSnapshot = {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly href: string;
  readonly state: CodexSetupState;
  readonly pending: boolean;
  readonly awaitingProvider: CodexAwaitingProvider | null;
  readonly autoStart: boolean;
  readonly autoStartHandled: boolean;
  readonly handoff: CodexHandoffRequest | null;
  readonly handoffState: ChatGptHandoffState | null;
};

export type CodexSetupFlowHost = {
  readonly snapshot: () => CodexSetupFlowSnapshot;
  readonly commands: CodexSetupFlowCommands;
  readonly handoffIdPrefix: string;
  readonly setPending: (pending: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly setAwaitingProvider: (awaiting: CodexAwaitingProvider | null) => void;
  readonly setHandoff: (handoff: CodexHandoffRequest | null) => void;
  readonly setTransferFailed: (failed: boolean) => void;
  readonly setRequestedMethodId: (methodId: string) => void;
  readonly setCallbackDraft: (draft: CodexCallbackDraft) => void;
  readonly setAccountPickerOpen: (open: boolean) => void;
  readonly setAutoStartHandled: (handled: boolean) => void;
  readonly onAutoStartConsumed: () => void;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly receiveCallback: ((authorizationUrl: string) => Promise<string>) | undefined;
  readonly cancelCallback: ((authorizationUrl: string) => Promise<unknown>) | undefined;
};

export type CodexSetupFlow = {
  readonly signIn: (methodId?: string) => Promise<void>;
  readonly setup: (methodId?: string) => Promise<void>;
  readonly execute: (decision: CodexSetupDecision) => void;
  readonly change: (intent: CodexSetupIntent) => void;
  readonly cancelOnboarding: () => void;
  readonly cancelSignIn: (onCancelled?: () => void) => void;
  readonly cancelInstall: () => void;
  readonly clearAwaitingProvider: () => void;
  readonly refreshAfterSignIn: () => void;
  readonly importFinishedHandoff: () => void;
  readonly applyHandoffFailure: (failure: string | null) => void;
  readonly autoStart: () => void;
  readonly continueAfterInstall: () => void;
  readonly watchCallback: () => (() => void) | undefined;
  readonly autoOpen: () => void;
};

/** The setup flow shared by the web section and the native core; hosts own state and rendering. */
export function createCodexSetupFlow(host: CodexSetupFlowHost): CodexSetupFlow {
  const { commands } = host;
  let pending = false;
  let continueWithSignIn: string | null = null;
  let openRequested = false;
  let openedFlow: string | null = null;
  let receivingCallback: string | null = null;
  let handoffSequence = 0;
  let importedAttempt: string | null = null;

  const run = async <A>(
    request: () => Promise<AtomCommandResult<A, unknown>>,
    onSuccess?: (value: A) => void,
  ) => {
    if (pending) return false;
    pending = true;
    host.setPending(true);
    host.setError(null);
    let succeeded = false;
    try {
      const result = await request();
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          host.setError(resolveCodexSetupFailureMessage(squashAtomCommandFailure(result)));
        }
      } else {
        succeeded = true;
        onSuccess?.(result.value);
      }
    } catch {
      host.setError(CODEX_SETUP_UNEXPECTED_FAILURE_MESSAGE);
    }
    pending = false;
    host.setPending(false);
    return succeeded;
  };

  const transferProfile = async (profile: ChatGptTransferredProfile) => {
    const { environmentId, instanceId } = host.snapshot();
    const succeeded = await run(() =>
      commands.importProfile({ environmentId, input: { instanceId, profile } }),
    );
    if (succeeded) {
      host.setAwaitingProvider("handoff");
      host.setHandoff(null);
    }
    host.setTransferFailed(!succeeded);
  };

  const signIn = async (methodId = "chatgpt") => {
    if (pending) return;
    openRequested = true;
    host.setTransferFailed(false);
    host.setRequestedMethodId(methodId);
    const { environmentId, instanceId, href, state } = host.snapshot();
    const signInReturnUrl = resolveCodexAuthReturnUrl({ href, environmentId, instanceId });
    const route = resolveCodexSignInRoute(state);
    if (route.kind === "handoff") {
      const attemptId = `${host.handoffIdPrefix}:${++handoffSequence}`;
      const succeeded = await run(
        () => commands.reconnectProfile({ environmentId, input: { instanceId, methodId } }),
        (profile) =>
          host.setHandoff({
            environmentId: route.primaryEnvironmentId,
            input: {
              instanceId,
              environmentId,
              attemptId,
              returnUrl: signInReturnUrl,
              profile,
            },
          }),
      );
      if (!succeeded) openRequested = false;
      return;
    }
    if (
      !(await run(
        () =>
          commands.startAuth({
            environmentId,
            input: {
              instanceId,
              methodId,
              returnUrl: signInReturnUrl,
              callbackMode: route.callbackMode,
            },
          }),
        () => host.setAwaitingProvider("sign-in"),
      ))
    ) {
      openRequested = false;
    }
  };

  const setup = async (methodId = "chatgpt") => {
    const { environmentId, instanceId, state } = host.snapshot();
    const step = resolveCodexSetupStep({
      methodId,
      unavailable: state.unavailable,
      busy: state.busy,
      installed: state.installed,
      updateAvailable: state.updateAvailable,
    });
    if (step.kind === "none") return;
    if (step.kind === "sign-in") {
      await signIn(step.methodId);
    } else {
      continueWithSignIn = step.methodId;
      if (!(await run(() => commands.startInstall({ environmentId, input: { instanceId } })))) {
        continueWithSignIn = null;
      }
    }
  };

  const openPage = async (authorizationUrl: string) => {
    try {
      const { environmentId, instanceId, state } = host.snapshot();
      const receive = host.receiveCallback;
      const flowId = state.flowId;
      if (receive && state.clientCallback && flowId) {
        if (receivingCallback === authorizationUrl) {
          await host.openExternal(authorizationUrl);
          return;
        }
        receivingCallback = authorizationUrl;
        const callbackUrl = await receive(authorizationUrl);
        if (receivingCallback !== authorizationUrl) return;
        receivingCallback = null;
        await run(() =>
          commands.completeAuth({ environmentId, input: { instanceId, flowId, callbackUrl } }),
        );
      } else {
        await host.openExternal(authorizationUrl);
      }
    } catch {
      host.setError(CODEX_SETUP_OPEN_PAGE_FAILURE_MESSAGE);
    }
  };

  const execute = (decision: CodexSetupDecision) => {
    const { environmentId, instanceId, handoffState } = host.snapshot();
    switch (decision.kind) {
      case "none":
        return;
      case "open-account-picker":
        host.setAccountPickerOpen(true);
        return;
      case "setup":
        void setup(decision.methodId);
        return;
      case "logout":
        void run(() => commands.logoutAuth({ environmentId, input: { instanceId } }));
        return;
      case "transfer-profile":
        if (handoffState?.phase === "finished") {
          void transferProfile(handoffState.profile);
        }
        return;
      case "open-page":
        void openPage(decision.url);
        return;
      case "complete-auth": {
        const submittedFlowId = decision.flowId;
        void run(() =>
          commands.completeAuth({
            environmentId,
            input: { instanceId, flowId: submittedFlowId, callbackUrl: decision.callbackUrl },
          }),
        ).then((connected) => {
          if (connected) host.setCallbackDraft({ flowId: submittedFlowId, value: "" });
        });
        return;
      }
      case "clear-handoff":
        host.setAwaitingProvider(null);
        host.setHandoff(null);
        return;
      case "cancel-auth": {
        host.setAwaitingProvider(null);
        const cancelledFlowId = decision.flowId;
        void run(() =>
          commands.cancelAuth({ environmentId, input: { instanceId, flowId: cancelledFlowId } }),
        );
        return;
      }
      case "cancel-install": {
        const operationId = decision.operationId;
        void run(() =>
          commands.cancelInstall({ environmentId, input: { instanceId, operationId } }),
        );
        return;
      }
    }
  };

  const change = (intent: CodexSetupIntent) =>
    execute(resolveCodexSetupChange(intent, host.snapshot().state));

  return {
    signIn,
    setup,
    execute,
    change,
    cancelOnboarding: () => {
      openRequested = false;
      continueWithSignIn = null;
      change({ kind: "cancel-onboarding" });
    },
    cancelSignIn: (onCancelled) => {
      const decision = resolveCodexSetupChange({ kind: "cancel-sign-in" }, host.snapshot().state);
      if (decision.kind === "none") return;
      openRequested = false;
      execute(decision);
      onCancelled?.();
    },
    cancelInstall: () => {
      const decision = resolveCodexSetupChange({ kind: "cancel-install" }, host.snapshot().state);
      if (decision.kind === "none") return;
      continueWithSignIn = null;
      execute(decision);
    },
    clearAwaitingProvider: () => {
      if (shouldClearCodexAwaitingProvider(host.snapshot().state)) {
        host.setAwaitingProvider(null);
      }
    },
    refreshAfterSignIn: () => {
      const { environmentId, instanceId, awaitingProvider, state } = host.snapshot();
      if (awaitingProvider && state.authPhase === "succeeded") {
        void commands.refreshProviders({ environmentId, input: { instanceId } });
      }
    },
    importFinishedHandoff: () => {
      const { handoff, handoffState } = host.snapshot();
      if (!handoff || handoffState?.phase !== "finished") return;
      const attemptId = handoff.input.attemptId;
      if (importedAttempt === attemptId) return;
      importedAttempt = attemptId;
      void transferProfile(handoffState.profile);
    },
    applyHandoffFailure: (failure) => {
      if (failure === null) return;
      host.setError(failure);
      host.setHandoff(null);
    },
    autoStart: () => {
      const snapshot = host.snapshot();
      if (
        !shouldAutoStartCodexSetup({
          autoStart: snapshot.autoStart,
          autoStartHandled: snapshot.autoStartHandled,
          unavailable: snapshot.state.unavailable,
          busy: snapshot.state.busy,
          installationLoaded: snapshot.state.installationLoaded,
          canInstall: snapshot.state.canInstall,
        })
      )
        return;
      host.setAutoStartHandled(true);
      host.onAutoStartConsumed();
      void setup();
    },
    continueAfterInstall: () => {
      const { pending: renderedPending, state } = host.snapshot();
      const next = resolveCodexContinueAfterInstall({
        pendingMethodId: continueWithSignIn,
        pending: renderedPending,
        installActive: state.installActive,
        installationPhase: state.installationPhase,
        installed: state.installed,
      });
      if (next.kind === "clear") {
        continueWithSignIn = null;
      } else if (next.kind === "sign-in") {
        continueWithSignIn = null;
        void signIn(next.methodId);
      }
    },
    watchCallback: () => {
      const { state } = host.snapshot();
      const url = state.url;
      const cancel = host.cancelCallback;
      if (!state.clientCallback || !url || !cancel) return undefined;
      return () => {
        if (receivingCallback === url) receivingCallback = null;
        void cancel(url).catch(() => undefined);
      };
    },
    autoOpen: () => {
      const { state } = host.snapshot();
      const decision = resolveCodexAutoOpen({
        openRequested,
        openedFlowId: openedFlow,
        authPhase: state.authPhase,
        flowId: state.flowId,
        url: state.url,
        remoteWeb: state.remoteWeb,
      });
      if (decision.kind === "none") return;
      openedFlow = decision.flowId;
      openRequested = false;
      if (decision.launch) void openPage(decision.url);
    },
  };
}
