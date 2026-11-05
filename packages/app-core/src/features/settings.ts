import {
  EnvironmentId,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  ProjectId,
  type EnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  buildSettingsBreadcrumbModel,
  settingsBreadcrumbLabel,
  type SettingsBreadcrumbModel,
} from "@t3tools/web/src/components/settings/SettingsBreadcrumb.logic.ts";
import { isWslSettingsRowVisible } from "@t3tools/web/src/components/settings/ConnectionsSettings.logic.ts";
import { isProviderSettingsEnvironmentAvailable } from "@t3tools/web/src/components/settings/ProviderSettingsPanel.logic.ts";
import {
  buildSettingsRestoreModel,
  resolveSettingsRestorePatch,
  type SettingsRestoreModel,
} from "@t3tools/web/src/components/settings/SettingsRestore.logic.ts";
import {
  buildSettingsHeaderModel,
  resolveSettingsRouteRedirect,
  resolveSettingsScopeBoundary,
  toSettingsScopeBoundaryScope,
} from "@t3tools/web/src/components/settings/SettingsRouteLayout.logic.ts";
import {
  buildSettingsScopeNoticeModel,
  resolveSettingsScopeNoticeSelection,
  type SettingsScopeNoticeChoice,
} from "@t3tools/web/src/components/settings/SettingsScopeNotice.logic.ts";
import {
  buildSettingsScopeSentenceModel,
  resolveSettingsScopeChange,
  type SettingsScopeIcon,
  type SettingsScopeMenuModel,
  type SettingsScopeMenuOption,
} from "@t3tools/web/src/components/settings/SettingsScopeSentence.logic.ts";
import {
  buildSettingsNavModel,
  buildSettingsSearchResults,
  clampSettingsSearchResultIndex,
  resolveSettingsSearchKeyIntent,
  resolveSettingsSearchResultSelection,
  type SettingsNavModel,
  type SettingsNavSearchModel,
  type SettingsNavSection,
  type SettingsSearchResultRow,
} from "@t3tools/web/src/components/settings/SettingsSidebarNav.logic.ts";
import { validateSettingsScopeSearch } from "@t3tools/web/src/components/settings/settingsScope.ts";
import {
  filterAvailableSettingsSearchItems,
  getThreadAutoSettlementSearchAvailability,
  type SettingsPath,
} from "@t3tools/web/src/components/settings/settingsSearch.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { CHAT_PAGE, type AppPage } from "../page.ts";
import { projectIconView } from "../sidebarView.ts";
import type { ProjectIconView } from "../views/sidebar.ts";
import type { SidebarProjectSnapshot } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import {
  createSettingsScopeRuntime,
  type SettingsScopeRuntime,
  type SettingsSearchTarget,
  type SettingsSection,
} from "./settings/scope.ts";
import { createAppearanceSettings } from "./settings/appearance.ts";
import { createGeneralSettings } from "./settings/general.ts";
import { createKeybindingsSettings } from "./settings/keybindings.ts";
import { createThemeSettings } from "./settings/themes.ts";
import { createSourceControlSettings } from "./settings/sourceControl.ts";
import { createProviderSettings } from "./settings/providers.ts";
import { createLoadBalancingSettings } from "./settings/loadBalancing.ts";
import { createLicensesSettings } from "./settings/licenses.ts";
import { createStorageSettings } from "./settings/storage.ts";
import { createArchivedSettings } from "./settings/archived.ts";
import { createProjectsSettings } from "./settings/projects.ts";
import { createDiagnosticsSettings } from "./settings/diagnostics.ts";
import { createIntegrationsSettings } from "./settings/integrations.ts";
import { createConnectionsSettings } from "./settings/connections.ts";
import { createSnapShotSettings } from "./settings/snapShot.ts";

export const NATIVE_SETTINGS_SECTIONS: ReadonlyArray<string> = [
  "general",
  "appearance",
  "local",
  "integrations",
  "providers",
  "keybindings",
  "source-control",
  "open-source-licenses",
  "storage",
  "archived",
  "projects",
  "diagnostics",
  "connections",
  "snap-shot",
];

const SETTINGS_SECTIONS: ReadonlyArray<
  (context: FeatureContext, scope: SettingsScopeRuntime) => SettingsSection
> = [
  createGeneralSettings,
  createAppearanceSettings,
  createThemeSettings,
  createKeybindingsSettings,
  createSourceControlSettings,
  createProviderSettings,
  createLoadBalancingSettings,
  createLicensesSettings,
  createStorageSettings,
  createArchivedSettings,
  createProjectsSettings,
  createDiagnosticsSettings,
  createIntegrationsSettings,
  createConnectionsSettings,
  createSnapShotSettings,
];

const DEFAULT_SETTINGS_SECTION = "general";

export type SettingsNavSectionView = SettingsNavSection & { readonly section: string };

export type SettingsNavView = Omit<SettingsNavModel, "sections" | "search"> & {
  readonly sections: ReadonlyArray<SettingsNavSectionView>;
  readonly search: Omit<SettingsNavSearchModel, "results"> & {
    readonly results: ReadonlyArray<SettingsSearchResultRow & { readonly section: string }>;
  };
  readonly backLabel: string;
};

export type SettingsScopeIconView =
  | { readonly kind: "layers" }
  | { readonly kind: "environment-machine"; readonly machine: EnvironmentMachineKind }
  | {
      readonly kind: "project-favicon";
      readonly projectKey: string;
      readonly icon: ProjectIconView;
    };

export type SettingsScopeMenuView = Omit<SettingsScopeMenuModel, "icon" | "options"> & {
  readonly icon: SettingsScopeIconView | null;
  readonly options: ReadonlyArray<
    Omit<SettingsScopeMenuOption, "icon"> & { readonly icon: SettingsScopeIconView | null }
  >;
};

export type SettingsScopeSentenceView = {
  readonly lead: string;
  readonly connective: "on" | "across";
  readonly project: SettingsScopeMenuView;
  readonly environment: SettingsScopeMenuView;
};

export type SettingsBoundaryView =
  | { readonly kind: "content" }
  | {
      readonly kind: "notice";
      readonly message: string;
      readonly targetId: string;
      readonly choices: ReadonlyArray<SettingsScopeNoticeChoice>;
    }
  | { readonly kind: "message"; readonly message: string };

export type SettingsTargetView = SettingsSearchTarget;

export type SettingsChromeView = {
  readonly section: string;
  readonly pathname: string;
  readonly native: boolean;
  readonly breadcrumb: SettingsBreadcrumbModel;
  readonly restore: SettingsRestoreModel | null;
  readonly scopeSentence: SettingsScopeSentenceView | null;
  readonly boundary: SettingsBoundaryView;
  readonly target: SettingsTargetView;
  readonly contentKey: string;
};

const ScopeSearchSchema = Schema.Struct({
  project: Schema.optional(Schema.String),
  machine: Schema.optional(Schema.String),
  checkout: Schema.optional(Schema.String),
});

const OpenParams = Schema.decodeUnknownSync(
  Schema.Struct({
    section: Schema.optional(Schema.String),
    targetId: Schema.optional(Schema.String),
  }),
);
const SelectSectionParams = Schema.decodeUnknownSync(
  Schema.Struct({ section: Schema.String, targetId: Schema.optional(Schema.String) }),
);
const SearchParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const SearchMoveParams = Schema.decodeUnknownSync(Schema.Struct({ delta: Schema.Number }));
const SearchSelectParams = Schema.decodeUnknownSync(Schema.Struct({ index: Schema.Number }));
const SelectScopeParams = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({
      axis: Schema.Literals(["environment", "project"]),
      value: Schema.String,
    }),
    Schema.Struct({ search: ScopeSearchSchema, targetId: Schema.NullOr(Schema.String) }),
  ]),
);
const ScopedKeysSchema = Schema.Array(Schema.Literals(PROJECT_SCOPED_SERVER_SETTING_KEYS));
const ClearOverridesParams = Schema.decodeUnknownSync(Schema.Struct({ keys: ScopedKeysSchema }));
const ClearProjectOverridesParams = Schema.decodeUnknownSync(
  Schema.Struct({
    entries: Schema.Array(Schema.Struct({ environmentId: EnvironmentId, projectId: ProjectId })),
    keys: ScopedKeysSchema,
  }),
);
const TargetHandledParams = Schema.decodeUnknownSync(Schema.Struct({ revision: Schema.Number }));

function settingsPathname(section: string): string {
  return section.length === 0 ? "/settings" : `/settings/${section}`;
}

function sectionOfPath(path: SettingsPath): string {
  return path.slice("/settings/".length);
}

function resolveSettingsSection(section: string): string {
  const redirect = resolveSettingsRouteRedirect({
    authStatus: "authenticated",
    pathname: settingsPathname(section),
  });
  if (redirect.kind === "redirect") return DEFAULT_SETTINGS_SECTION;
  return settingsBreadcrumbLabel(settingsPathname(section)) === null
    ? DEFAULT_SETTINGS_SECTION
    : section;
}

export function createSettingsFeature(context: FeatureContext): CoreFeature {
  const { registry } = context;
  const scope = createSettingsScopeRuntime(context);
  const { themePreference } = scope;
  const sections = SETTINGS_SECTIONS.map((create) => create(context, scope));

  const queryAtom = Atom.make("").pipe(Atom.keepAlive);
  const activeResultIndexAtom = Atom.make(0).pipe(Atom.keepAlive);
  const targetAtom = scope.searchTargetAtom;
  const restoreSignalAtom = Atom.make(0).pipe(Atom.keepAlive);

  const searchItemsAtom = Atom.make((get) => {
    const environments = get(scope.environmentsAtom);
    const machine = get(scope.scopeSearchAtom).machine;
    return filterAvailableSettingsSearchItems({
      localEnvironmentDisabled: false,
      hasCloudPublicConfig: false,
      hasEnvironment: environments.some((environment) => environment.serverConfig !== null),
      hasProviderSettingsEnvironment: environments.some((environment) =>
        isProviderSettingsEnvironmentAvailable({
          connectionPhase: environment.connection.phase,
          hasServerConfig: environment.serverConfig !== null,
        }),
      ),
      hasMacProviderSettingsEnvironment: environments.some(
        (environment) =>
          (machine === undefined || environment.environmentId === machine) &&
          environment.serverConfig?.environment.platform.os === "darwin" &&
          isProviderSettingsEnvironmentAvailable({
            connectionPhase: environment.connection.phase,
            hasServerConfig: true,
          }),
      ),
      canManageLocalBackend: true,
      isWslSettingsRowVisible: isWslSettingsRowVisible({ state: null, error: null }),
      hasThreadAutoSettlement:
        getThreadAutoSettlementSearchAvailability(environments).eligibleEnvironmentIds.length > 0,
    });
  });

  const searchResultsAtom = Atom.make((get) =>
    buildSettingsSearchResults({
      query: get(queryAtom),
      items: get(searchItemsAtom),
      platform: { isElectron: true, platform: context.platform },
    }),
  );

  const navModelAtom = Atom.make((get): SettingsNavModel | null => {
    const section = get(scope.sectionAtom);
    if (section === null) return null;
    const results = get(searchResultsAtom);
    return buildSettingsNavModel({
      pathname: settingsPathname(section),
      scopeSearch: get(scope.scopeSearchAtom),
      query: get(queryAtom),
      results,
      activeResultIndex: clampSettingsSearchResultIndex(get(activeResultIndexAtom), results.length),
    });
  });

  const settingsNavAtom = Atom.make((get): SettingsNavView | null => {
    const model = get(navModelAtom);
    if (model === null) return null;
    return {
      ...model,
      sections: model.sections.map((entry) => ({ ...entry, section: sectionOfPath(entry.id) })),
      search: {
        ...model.search,
        results: model.search.results.map((row) => ({ ...row, section: sectionOfPath(row.to) })),
      },
      backLabel: "Back",
    };
  });

  const scopeIconView = (
    icon: SettingsScopeIcon | null,
    groups: ReadonlyArray<SidebarProjectSnapshot>,
  ): SettingsScopeIconView | null => {
    if (icon === null) return null;
    if (icon.kind !== "project-favicon") return icon;
    const group = groups.find((candidate) => candidate.projectKey === icon.projectKey);
    return group
      ? { kind: "project-favicon", projectKey: icon.projectKey, icon: projectIconView(group) }
      : null;
  };

  const settingsChromeAtom = Atom.make((get): SettingsChromeView | null => {
    const section = get(scope.sectionAtom);
    if (section === null) return null;
    const pathname = settingsPathname(section);
    const scopeContext = get(scope.scopeContextAtom);
    const environments = get(scope.environmentsAtom);
    const target = get(targetAtom);
    const header = buildSettingsHeaderModel(pathname);
    const theme = get(themePreference.snapshotAtom);
    const sentence = buildSettingsScopeSentenceModel({
      pathname,
      search: scopeContext.search,
      singleEnvironment: scopeContext.singleEnvironment,
      groups: scopeContext.groups,
      environments,
    });
    const menuView = (menu: SettingsScopeMenuModel): SettingsScopeMenuView => ({
      ...menu,
      icon: scopeIconView(menu.icon, scopeContext.groups),
      options: menu.options.map((option) => ({
        ...option,
        icon: scopeIconView(option.icon, scopeContext.groups),
      })),
    });
    const decision = resolveSettingsScopeBoundary({
      pathname,
      hash: target.targetId ?? "",
      scope: toSettingsScopeBoundaryScope(scopeContext.scope),
      connectedEnvironmentCount: scopeContext.connectedEnvironments.length,
      environments,
    });
    const boundary: SettingsBoundaryView =
      decision.kind === "notice"
        ? {
            kind: "notice",
            message: decision.message,
            targetId: decision.targetId,
            choices: buildSettingsScopeNoticeModel({
              message: decision.message,
              target: decision.target,
              eligibleEnvironmentIds: decision.eligibleEnvironmentIds,
              search: scopeContext.search,
              groups: scopeContext.groups,
              environments,
            }).choices,
          }
        : decision;
    return {
      section,
      pathname,
      native: NATIVE_SETTINGS_SECTIONS.includes(section),
      breadcrumb: buildSettingsBreadcrumbModel(pathname),
      restore: header.showRestoreDeviceDefaults
        ? buildSettingsRestoreModel({
            theme: theme.theme,
            followSystem: theme.followSystem,
            themeHalves: theme.themeHalves,
            settings: get(scope.scopedSettingsAtom),
          })
        : null,
      scopeSentence: sentence.visible
        ? {
            lead: sentence.lead,
            connective: sentence.connective,
            project: menuView(sentence.project),
            environment: menuView(sentence.environment),
          }
        : null,
      boundary,
      target,
      contentKey: `${JSON.stringify(scopeContext.search)}:${get(restoreSignalAtom)}`,
    };
  });

  const clearSearch = () => {
    registry.set(queryAtom, "");
    registry.set(activeResultIndexAtom, 0);
  };

  const setTarget = (targetId: string | null) => {
    const current = registry.get(targetAtom);
    registry.set(targetAtom, {
      targetId,
      highlight: true,
      revision: targetId === null ? current.revision : current.revision + 1,
    });
  };

  const unavailableSectionToast = (section: string) => {
    const label = settingsBreadcrumbLabel(settingsPathname(section)) ?? section;
    context.addToast({
      layout: "plain",
      type: "info",
      title: `${label} settings are not available in the native app yet.`,
    });
  };

  const openSection = (section: string, targetId: string | null) => {
    const resolved = resolveSettingsSection(section);
    if (!NATIVE_SETTINGS_SECTIONS.includes(resolved)) {
      unavailableSectionToast(resolved);
      return;
    }
    setTarget(targetId);
    context.navigate({ kind: "settings", section: resolved });
  };

  let previousPage: AppPage = registry.get(context.pageAtom);
  registry.subscribe(
    context.pageAtom,
    (page) => {
      const previous = previousPage;
      if (page.kind === "project") {
        queueMicrotask(() => {
          registry.set(context.pageAtom, { kind: "settings", section: "projects" });
          scope.selectScope({ project: page.projectKey });
        });
        return;
      }
      if (page.kind !== "settings") {
        previousPage = page;
        return;
      }
      const resolved = resolveSettingsSection(page.section);
      if (resolved !== page.section) {
        queueMicrotask(() =>
          registry.set(context.pageAtom, { kind: "settings", section: resolved }),
        );
        return;
      }
      if (!NATIVE_SETTINGS_SECTIONS.includes(resolved)) {
        unavailableSectionToast(resolved);
        queueMicrotask(() => registry.set(context.pageAtom, previous));
        return;
      }
      if (previous.kind !== "settings") {
        registry.set(scope.scopeSearchAtom, {});
        clearSearch();
      }
      previousPage = page;
    },
    { immediate: false },
  );

  const selectSearchResult = (index: number) => {
    const section = registry.get(scope.sectionAtom);
    const model = registry.get(navModelAtom);
    if (section === null || model === null) return;
    const result = model.search.results[index];
    if (result === undefined) return;
    clearSearch();
    const current = registry.get(targetAtom);
    const intent = resolveSettingsSearchResultSelection({
      to: result.to,
      targetId: result.targetId,
      pathname: settingsPathname(section),
      currentHash: current.targetId ?? "",
    });
    if (intent.kind === "scroll") {
      setTarget(intent.targetId);
      return;
    }
    openSection(sectionOfPath(intent.to), intent.hash);
  };

  const restoreDefaults = async () => {
    const theme = registry.get(themePreference.snapshotAtom);
    const model = buildSettingsRestoreModel({
      theme: theme.theme,
      followSystem: theme.followSystem,
      themeHalves: theme.themeHalves,
      settings: registry.get(scope.scopedSettingsAtom),
    });
    if (model.confirmDialog === null) return;
    const confirmed = await (requestConfirmDialog(model.confirmDialog.message, {
      variant: model.confirmDialog.variant,
    }) ?? Promise.reject(new Error("Confirmations are not available in the native app yet.")));
    if (!confirmed) return;
    const previousTheme = themePreference.readTheme();
    const previousHalves = themePreference.readThemeHalves();
    const plan = resolveSettingsRestorePatch({
      liveTheme: previousTheme,
      liveThemeHalves: previousHalves,
      liveAppearanceMode: themePreference.readAppearanceMode(previousTheme),
    });
    const notifyThemeRestoreFailure = () => {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: plan.themeFailureToast.title,
        description: plan.themeFailureToast.description,
      });
    };
    const rollbackThemeState = () => {
      if (plan.resetTheme) themePreference.setTheme(previousTheme);
      if (previousHalves?.light) themePreference.setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) themePreference.setThemeHalf("dark", previousHalves.dark);
    };
    if (plan.resetTheme && !themePreference.setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (plan.clearThemeMix && !themePreference.clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (plan.resetFollowSystem && !themePreference.setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    void scope.updateScopedSettings(plan.settingsPatch);
    registry.set(restoreSignalAtom, registry.get(restoreSignalAtom) + 1);
  };

  const sectionViews = Object.fromEntries(
    sections.flatMap((section) => Object.entries(section.views)),
  );
  const sectionActions = Object.fromEntries(
    sections.flatMap((section) => Object.entries(section.actions)),
  );

  return {
    pages: ["settings", "project"],
    views: {
      ...sectionViews,
      settingsNav: settingsNavAtom,
      settingsChrome: settingsChromeAtom,
    },
    actions: {
      ...sectionActions,
      settingsOpen: async (params) => {
        const { section, targetId } = OpenParams(params);
        const page = registry.get(context.pageAtom);
        if (page.kind === "settings" && section === undefined && targetId === undefined) {
          return null;
        }
        openSection(section ?? DEFAULT_SETTINGS_SECTION, targetId ?? null);
        return null;
      },
      settingsClose: async () => {
        context.navigate(CHAT_PAGE);
        return null;
      },
      settingsSelectSection: async (params) => {
        const { section, targetId } = SelectSectionParams(params);
        openSection(section, targetId ?? null);
        return null;
      },
      settingsSearch: async (params) => {
        registry.set(queryAtom, SearchParams(params).query);
        registry.set(activeResultIndexAtom, 0);
        return null;
      },
      settingsSearchMove: async (params) => {
        const { delta } = SearchMoveParams(params);
        const model = registry.get(navModelAtom);
        if (model === null || delta === 0) return null;
        const intent = resolveSettingsSearchKeyIntent({
          key: delta > 0 ? "ArrowDown" : "ArrowUp",
          isSearching: model.search.isSearching,
          resultCount: model.search.results.length,
          activeResultIndex: model.search.activeResultIndex,
        });
        if (intent.kind === "move") registry.set(activeResultIndexAtom, intent.index);
        return null;
      },
      settingsSearchSelect: async (params) => {
        selectSearchResult(SearchSelectParams(params).index);
        return null;
      },
      settingsSearchActivate: async (params) => {
        const model = registry.get(navModelAtom);
        const { index } = SearchSelectParams(params);
        if (model !== null && index >= 0 && index < model.search.results.length) {
          registry.set(activeResultIndexAtom, index);
        }
        return null;
      },
      settingsSearchClear: async () => {
        clearSearch();
        return null;
      },
      settingsSelectScope: async (params) => {
        const decoded = SelectScopeParams(params);
        if ("axis" in decoded) {
          const change = resolveSettingsScopeChange({
            axis: decoded.axis,
            search: registry.get(scope.scopeContextAtom).search,
            value: decoded.value,
          });
          if (change.kind === "select") {
            setTarget(null);
            scope.selectScope(change.search);
          }
          return null;
        }
        const section = registry.get(scope.sectionAtom);
        if (section === null) return null;
        const selection = resolveSettingsScopeNoticeSelection({
          search: validateSettingsScopeSearch(decoded.search),
          targetId: decoded.targetId,
          pathname: settingsPathname(section),
        });
        scope.selectScope(selection.search);
        setTarget(selection.kind === "navigate" ? selection.hash : null);
        return null;
      },
      settingsRestoreDefaults: async () => {
        await restoreDefaults();
        return null;
      },
      settingsClearOverrides: async (params) => {
        await scope.clearScopedSettings(ClearOverridesParams(params).keys);
        return null;
      },
      settingsClearProjectOverrides: async (params) => {
        const { entries, keys } = ClearProjectOverridesParams(params);
        await scope.clearProjectOverrides(entries, keys);
        return null;
      },
      settingsTargetHandled: async (params) => {
        const { revision } = TargetHandledParams(params);
        const current = registry.get(targetAtom);
        if (current.revision === revision && current.targetId !== null) {
          registry.set(targetAtom, { ...current, targetId: null });
        }
        return null;
      },
    },
  };
}
