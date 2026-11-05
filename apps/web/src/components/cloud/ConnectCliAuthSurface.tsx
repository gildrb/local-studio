import { useAuth, useClerk } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliSignInRedirectUrl,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { AuthSurfaceShell } from "../auth/AuthSurfaceShell";
import { resolveClerkSignInProps } from "../clerk/authRedirect";
import { Button } from "../ui/button";
import {
  buildConnectCliAuthModel,
  resolveConnectCliAuthEffect,
} from "./ConnectCliAuthSurface.logic";

function ConnectCliAuthMessage({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <>
      {eyebrow ? (
        <p className="text-3xs font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>
      ) : null}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </>
  );
}

/**
 * /connect: the URL the CLI prints for the loopback flow. Waits for a Clerk
 * session, then forwards the CLI's PKCE request to Clerk's authorize endpoint
 * with the loopback redirect URI so the code returns straight to the waiting
 * CLI. Headless hosts use Clerk's device authorization page instead.
 */
export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const signInOpened = useRef(false);
  const redirecting = useRef(false);

  const openSignIn = useCallback(() => {
    if (!request) {
      return;
    }
    clerk.openSignIn(
      resolveClerkSignInProps(
        connectCliSignInRedirectUrl(request, window.location.href),
        isElectron,
      ),
    );
  }, [clerk, request]);

  useEffect(() => {
    const effect = resolveConnectCliAuthEffect({
      hasRequest: Boolean(request),
      isLoaded,
      isSignedIn: isSignedIn === true,
      signInOpened: signInOpened.current,
      redirecting: redirecting.current,
    });
    if (effect.kind === "openSignIn") {
      signInOpened.current = true;
      openSignIn();
      return;
    }
    if (effect.kind !== "redirect" || !request) {
      return;
    }
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) {
      return;
    }
    redirecting.current = true;
    window.location.assign(authorizeUrl);
  }, [isLoaded, isSignedIn, openSignIn, request]);

  const model = buildConnectCliAuthModel({
    hasRequest: Boolean(request),
    isLoaded,
    isSignedIn: isSignedIn === true,
  });

  return (
    <AuthSurfaceShell>
      <ConnectCliAuthMessage
        eyebrow={model.eyebrow}
        title={model.title}
        description={model.description}
      />
      {model.signIn !== null ? (
        <div className="mt-6">
          <Button type="button" onClick={openSignIn}>
            {model.signIn.label}
          </Button>
        </div>
      ) : null}
    </AuthSurfaceShell>
  );
}
