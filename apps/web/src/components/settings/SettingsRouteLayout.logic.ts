import type { EnvironmentId } from "@t3tools/contracts";

import { SETTINGS_DEVICE_ONLY_PATHS } from "./SettingsScopeSentence.logic";
import type { ResolvedSettingsScope, SettingsScopeSearch } from "./settingsScope";
import {
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  type AutoSettlementSearchEnvironment,
} from "./settingsSearch";

export type SettingsScopeBoundaryEnvironment = AutoSettlementSearchEnvironment;
export type SettingsScopeBoundaryScope =
  | {
      readonly kind: "all" | "project" | "checkout";
      readonly environmentIds: readonly EnvironmentId[];
    }
  | {
      readonly kind: "environment";
      readonly label: string;
      readonly environmentIds: readonly EnvironmentId[];
    }
  | {
      readonly kind: "unavailable";
      readonly message: string;
      readonly environmentIds: readonly EnvironmentId[];
    };

export type SettingsScopeBoundaryInput = {
  readonly pathname: string;
  readonly hash: string;
  readonly scope: SettingsScopeBoundaryScope;
  readonly connectedEnvironmentCount: number;
  readonly environments: ReadonlyArray<SettingsScopeBoundaryEnvironment>;
};

export type SettingsScopeNoticeTarget = "all" | "environment" | "project" | "checkout";

export type SettingsScopeBoundaryDecision =
  | { readonly kind: "content" }
  | {
      readonly kind: "notice";
      readonly target: SettingsScopeNoticeTarget;
      readonly targetId: string;
      readonly eligibleEnvironmentIds: ReadonlyArray<EnvironmentId> | null;
      readonly message: string;
    }
  | { readonly kind: "message"; readonly message: string };

export function resolveSettingsScopeBoundary(
  input: SettingsScopeBoundaryInput,
): SettingsScopeBoundaryDecision {
  const { scope } = input;
  const searchTarget = getSettingsSearchTargetScope(input.hash);
  const autoSettlementAvailability = searchTarget?.requiresThreadAutoSettlement
    ? getThreadAutoSettlementSearchAvailability(input.environments, scope)
    : null;
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    autoSettlementAvailability &&
    !autoSettlementAvailability.isTargetAvailable
  ) {
    return {
      kind: "notice",
      target: "environment",
      targetId: input.hash,
      eligibleEnvironmentIds: autoSettlementAvailability.eligibleEnvironmentIds,
      message:
        autoSettlementAvailability.eligibleEnvironmentIds.length > 0
          ? `${searchTarget.title} requires a supporting environment. Choose one to continue.`
          : `${searchTarget.title} requires a supporting environment. Connect or update an environment to continue.`,
    };
  }
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    !isSettingsSearchScopeAvailable(searchTarget.scope, scope.kind)
  ) {
    return {
      kind: "notice",
      target:
        searchTarget.scope === "environment" ||
        searchTarget.scope === "project" ||
        searchTarget.scope === "checkout"
          ? searchTarget.scope
          : "all",
      targetId: input.hash,
      eligibleEnvironmentIds: null,
      message: `${searchTarget.title} is not available for the selected target. Choose its owning scope to continue.`,
    };
  }
  if (SETTINGS_DEVICE_ONLY_PATHS.has(input.pathname) || input.pathname === "/settings/projects") {
    return { kind: "content" };
  }
  if (scope.kind === "unavailable") return { kind: "message", message: scope.message };
  if (scope.kind === "environment" && input.connectedEnvironmentCount === 0) {
    return { kind: "message", message: `Reconnect ${scope.label} to change its settings.` };
  }
  return { kind: "content" };
}

export function toSettingsScopeBoundaryScope(
  scope: ResolvedSettingsScope,
): SettingsScopeBoundaryScope {
  switch (scope.kind) {
    case "unavailable":
      return { kind: "unavailable", message: scope.message, environmentIds: scope.environmentIds };
    case "environment":
      return { kind: "environment", label: scope.label, environmentIds: scope.environmentIds };
    default:
      return { kind: scope.kind, environmentIds: scope.environmentIds };
  }
}

export type SettingsHeaderModel = {
  readonly showRestoreDeviceDefaults: boolean;
};

export function buildSettingsHeaderModel(pathname: string): SettingsHeaderModel {
  return {
    showRestoreDeviceDefaults: pathname === "/settings/general",
  };
}

export function isSettingsSingleEnvironmentPath(pathname: string): boolean {
  return pathname === "/settings/providers";
}

export function resolveSettingsScopeNavigationSearch(next: SettingsScopeSearch): {
  readonly project: string | undefined;
  readonly machine: string | undefined;
  readonly checkout: string | undefined;
} {
  return { project: next.project, machine: next.machine, checkout: next.checkout };
}

export type SettingsRouteRedirect =
  | { readonly kind: "none" }
  | { readonly kind: "redirect"; readonly to: "/pair" | "/settings/general" };

export function resolveSettingsRouteRedirect(input: {
  readonly authStatus: string;
  readonly pathname: string;
}): SettingsRouteRedirect {
  if (input.authStatus !== "authenticated" && input.authStatus !== "hosted-static") {
    return { kind: "redirect", to: "/pair" };
  }
  if (input.pathname === "/settings") return { kind: "redirect", to: "/settings/general" };
  return { kind: "none" };
}
