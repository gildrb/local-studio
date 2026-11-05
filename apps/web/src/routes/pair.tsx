import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import {
  HostedPairingRouteSurface,
  PairingPendingSurface,
  PairingRouteSurface,
} from "../components/auth/PairingRouteSurface";
import {
  resolvePairRouteAccess,
  resolvePairRouteView,
} from "../components/auth/PairingRouteSurface.logic";

export const Route = createFileRoute("/pair")({
  beforeLoad: async ({ context }) => {
    const { authGateState } = context;
    const access = resolvePairRouteAccess(authGateState);
    if (access.kind === "redirect") {
      throw redirect({ to: access.to, replace: true });
    }
    return {
      authGateState,
    };
  },
  component: PairRouteView,
  pendingComponent: PairRoutePendingView,
});

function PairRouteView() {
  const { authGateState } = Route.useRouteContext();
  const navigate = useNavigate();
  const view = resolvePairRouteView(authGateState);

  if (view.kind === "none") {
    return null;
  }

  if (view.kind === "hosted") {
    return <HostedPairingRouteSurface />;
  }

  return (
    <PairingRouteSurface
      auth={view.auth}
      onAuthenticated={() => {
        void navigate({ to: "/", replace: true });
      }}
      {...(view.initialErrorMessage !== null
        ? { initialErrorMessage: view.initialErrorMessage }
        : {})}
    />
  );
}

function PairRoutePendingView() {
  return <PairingPendingSurface />;
}
