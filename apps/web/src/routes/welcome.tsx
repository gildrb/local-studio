import { createFileRoute, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { NoProjectsHero } from "../components/NoProjectsHero";
import { WelcomeWizard } from "../components/onboarding/WelcomeWizard";
import {
  resolveWelcomeResumeEnvironmentId,
  resolveWelcomeRouteAccess,
  resolveWelcomeWizardVisible,
} from "../components/onboarding/WelcomeWizard.logic";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";

/** Onboarding overlays the workspace. Visiting /welcome reopens setup. */
export const Route = createFileRoute("/welcome")({
  beforeLoad: ({ context }) => {
    const access = resolveWelcomeRouteAccess(context.authGateState);
    if (access.kind === "redirect") {
      throw redirect({ to: access.to, replace: true });
    }
  },
  component: WelcomeRouteView,
});

function WelcomeRouteView() {
  const { authGateState } = Route.useRouteContext();
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const resumeEnvironmentId = resolveWelcomeResumeEnvironmentId(hash);
  // The root shell can remount this pending outlet after the location changes.
  // Never reopen setup while the destination route is still loading.
  const isWelcomeRoute = useLocation({ select: (location) => location.pathname === "/welcome" });
  const [dismissed, setDismissed] = useState(false);
  const openNewThread = useNewThreadHandler();
  // An authenticated gate means a primary server is serving this app —
  // desktop, `npx t3`, or a dev server — and that server is "this machine"
  // no matter what hostname the browser used. Only hosted-static has no
  // local server to offer.
  const access = resolveWelcomeRouteAccess(authGateState);
  const localAvailable = access.kind === "render" && access.localAvailable;
  return (
    <>
      <NoProjectsHero />
      {resolveWelcomeWizardVisible({ isWelcomeRoute, dismissed }) ? (
        <WelcomeWizard
          localAvailable={localAvailable}
          resumeEnvironmentId={resumeEnvironmentId}
          onDone={async (projectRef) => {
            setDismissed(true);
            if (projectRef !== undefined) {
              await openNewThread(projectRef, { replace: true }).catch(() =>
                navigate({ to: "/", replace: true }),
              );
              return;
            }
            await navigate({ to: "/", replace: true });
          }}
        />
      ) : null}
    </>
  );
}
