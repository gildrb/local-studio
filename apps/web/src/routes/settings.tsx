import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { useSettingsRestore } from "../components/settings/SettingsPanels";

import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SidebarInset } from "../components/ui/sidebar";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "../components/settings/SettingsScopeContext";
import { useEnvironments } from "../state/environments";
import { SettingsScopeNotice } from "../components/settings/SettingsScopeNotice";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "../components/settings/settingsScopeNavigation";
import {
  buildSettingsHeaderModel,
  isSettingsSingleEnvironmentPath,
  resolveSettingsRouteRedirect,
  resolveSettingsScopeBoundary,
  resolveSettingsScopeNavigationSearch,
  toSettingsScopeBoundaryScope,
} from "../components/settings/SettingsRouteLayout.logic";

function RestoreDeviceDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { model, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={!model.canRestore}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      {model.actionLabel}
    </Button>
  );
}

function SettingsScopeBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const { environments } = useEnvironments();
  const hash = useLocation({ select: (location) => location.hash });
  const decision = resolveSettingsScopeBoundary({
    pathname,
    hash,
    scope: toSettingsScopeBoundaryScope(scope),
    connectedEnvironmentCount: connectedEnvironments.length,
    environments,
  });
  switch (decision.kind) {
    case "notice":
      return (
        <SettingsScopeNotice
          target={decision.target}
          targetId={decision.targetId}
          {...(decision.eligibleEnvironmentIds === null
            ? {}
            : { eligibleEnvironmentIds: decision.eligibleEnvironmentIds })}
        >
          {decision.message}
        </SettingsScopeNotice>
      );
    case "message":
      return (
        <SettingsPageContainer>
          <p className="text-sm text-muted-foreground">{decision.message}</p>
        </SettingsPageContainer>
      );
    case "content":
      return children;
  }
}

function SettingsContentLayout() {
  const location = useLocation();
  const navigateToMainApp = useNavigateToMainApp();
  useEscapeToGoBack(navigateToMainApp);
  const { search } = useSettingsScope();
  const [restoreSignal, setRestoreSignal] = useState(0);
  const header = buildSettingsHeaderModel(location.pathname);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <div className="flex w-full items-center gap-3">
            <SettingsBreadcrumb pathname={location.pathname} />
            {header.showRestoreDeviceDefaults ? (
              <div className="ms-auto flex shrink-0 items-center">
                <RestoreDeviceDefaultsButton
                  onRestored={() => setRestoreSignal((value) => value + 1)}
                />
              </div>
            ) : null}
          </div>
        </WorkspacePageHeader>

        <div
          key={`${JSON.stringify(search)}:${restoreSignal}`}
          className="min-h-0 flex flex-1 flex-col"
        >
          <SettingsScopeBoundary pathname={location.pathname}>
            <Outlet />
          </SettingsScopeBoundary>
        </div>
      </div>
    </SidebarInset>
  );
}

function SettingsRouteLayout() {
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SettingsScopeProvider
      search={rawSearch}
      singleEnvironment={isSettingsSingleEnvironmentPath(pathname)}
      onChange={(next) => {
        // Send every axis so the retain middleware sees an explicit target
        // even when the choice is "all", which is the absence of a key.
        void navigate({
          to: pathname,
          search: () => resolveSettingsScopeNavigationSearch(next),
          hash: "",
          resetScroll: false,
        });
      }}
    >
      <SettingsContentLayout />
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/settings")({
  validateSearch: validateSettingsRouteSearch,
  search: { middlewares: [retainSettingsScope] },
  beforeLoad: async ({ context, location }) => {
    const redirectDecision = resolveSettingsRouteRedirect({
      authStatus: context.authGateState.status,
      pathname: location.pathname,
    });
    if (redirectDecision.kind === "redirect") {
      throw redirect({ to: redirectDecision.to, replace: true });
    }
  },
  component: SettingsRouteLayout,
});
