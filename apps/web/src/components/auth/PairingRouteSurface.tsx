import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useRef, useState, useCallback } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { readHostedPairingRequest } from "../../hostedPairing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  buildPairingScreenModel,
  describePairingError,
  resolveHostedPairingFailure,
  resolveHostedPairingSubmit,
  resolveHostedPairingSuccess,
  resolveInitialHostedPairingState,
  resolvePairingAutoSubmit,
  type HostedPairingState,
} from "./PairingRouteSurface.logic";

export function PairingPendingSurface() {
  const model = buildPairingScreenModel({ variant: "pending", appName: APP_DISPLAY_NAME });
  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={model.eyebrow}
        title={model.title}
        description={model.description}
      />
    </StandalonePage>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => void;
}) {
  const autoPairTokenRef = useRef<string | null>(peekPairingTokenFromUrl());
  const [credential, setCredential] = useState(() => autoPairTokenRef.current ?? "");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = useCallback(
    async (nextCredential: string) => {
      setIsSubmitting(true);
      setErrorMessage("");

      const submitError = await submitServerAuthCredential(nextCredential).then(
        () => null,
        (error) => describePairingError(error),
      );

      setIsSubmitting(false);

      if (submitError) {
        setErrorMessage(submitError);
        return;
      }

      startTransition(() => {
        onAuthenticated();
      });
    },
    [onAuthenticated],
  );

  const handleSubmit = useCallback(
    async (event?: React.SubmitEvent<HTMLFormElement>) => {
      event?.preventDefault();
      await submitCredential(credential);
    },
    [submitCredential, credential],
  );

  useEffect(() => {
    const decision = resolvePairingAutoSubmit({
      token: autoPairTokenRef.current,
      attempted: autoSubmitAttemptedRef.current,
    });
    if (decision.kind === "none") {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    void submitCredential(decision.token);
  }, [submitCredential]);

  const model = buildPairingScreenModel({
    variant: "token",
    appName: APP_DISPLAY_NAME,
    bootstrapMethods: auth.bootstrapMethods,
    credential,
    errorMessage,
    isSubmitting,
  });
  if (model.variant !== "token") return null;

  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={model.eyebrow}
        title={model.title}
        description={model.description}
      />

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={model.input.id}>
            {model.input.label}
          </label>
          <Input
            id={model.input.id}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={model.input.disabled}
            nativeInput
            onChange={(event) => setCredential(event.currentTarget.value)}
            placeholder={model.input.placeholder}
            spellCheck={false}
            value={model.input.value}
          />
        </div>

        {model.errorMessage !== null ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive">
            {model.errorMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={!model.submit.enabled} size="sm" type="submit">
            {model.submit.label}
          </Button>
          <Button
            disabled={!model.reload.enabled}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            {model.reload.label}
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {model.supportedMethods}
      </div>
    </StandalonePage>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const hostedPairingRequestRef = useRef(readHostedPairingRequest());
  const [pairingState, setPairingState] = useState<HostedPairingState>(() =>
    resolveInitialHostedPairingState(hostedPairingRequestRef.current !== null),
  );
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = useCallback(async () => {
    const request = hostedPairingRequestRef.current;
    const decision = resolveHostedPairingSubmit({
      hasRequest: request !== null,
      tokenSubmitted: tokenSubmittedRef.current,
    });
    setPairingState(decision.state);
    if (decision.kind === "fail" || request === null) {
      return;
    }

    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setPairingState(resolveHostedPairingSuccess(request.label));
      return;
    }

    tokenSubmittedRef.current = false;
    setPairingState(resolveHostedPairingFailure(squashAtomCommandFailure(result)));
  }, [connectPairingEnvironment]);

  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    void submitHostedPairingRequest();
  }, [submitHostedPairingRequest]);

  const request = hostedPairingRequestRef.current;
  const model = buildPairingScreenModel({
    variant: "hosted",
    appName: APP_DISPLAY_NAME,
    state: pairingState,
    host: request ? request.host : null,
  });
  if (model.variant !== "hosted") return null;

  return (
    <StandalonePage tone="pairing">
      <StandalonePageHeader
        eyebrow={model.eyebrow}
        title={model.title}
        description={model.description}
      />

      {model.host !== null ? (
        <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          {model.hostLabel} <span className="font-mono text-foreground/80">{model.host}</span>
        </div>
      ) : null}

      {model.errorHelp !== null ? (
        <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive">
          {model.errorHelp}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {model.primary === null ? null : model.primary.kind === "pairing" ? (
          <Button disabled={!model.primary.enabled} size="sm">
            {model.primary.label}
          </Button>
        ) : (
          <Button
            disabled={!model.primary.enabled}
            size="sm"
            onClick={() => void submitHostedPairingRequest()}
          >
            {model.primary.label}
          </Button>
        )}
        {model.openApp !== null ? (
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
            {model.openApp.label}
          </Button>
        ) : null}
      </div>
    </StandalonePage>
  );
}
