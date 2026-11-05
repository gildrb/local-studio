import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  T3_PROJECT_FILE_NAME,
  type ProjectScopedServerSettingKey,
  type ServerSettings,
  type T3ProjectFile,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { buildSettingsProjectGroups } from "@t3tools/web/src/components/settings/ProjectsSettings.logic.ts";
import { isSettingsSingleEnvironmentPath } from "@t3tools/web/src/components/settings/SettingsRouteLayout.logic.ts";
import {
  buildSettingInheritanceModel,
  resolveSettingInheritanceReset,
  type SettingInheritanceChain,
  type SettingInheritanceModel,
  type SettingInheritanceOverridingProject,
  type SettingInheritanceReset,
} from "@t3tools/web/src/components/settings/SettingInheritance.logic.ts";
import {
  resolveSettingsScopeSearch,
  resolveSettingsScopeSelection,
  settingsScopeProjectFile,
  type SettingsScopeSelection,
} from "@t3tools/web/src/components/settings/SettingsScopeContext.logic.ts";
import {
  listProjectOverrides,
  persistScopedSettingsPatch,
  planProjectOverridesClear,
  planScopedSettingsClear,
  planScopedSettingsPatch,
  resolveScopedSettingsPersistToast,
  resolveScopedSettingsPlanToast,
  type ProjectOverrideEntry,
  type ScopedSettingsPatch,
  type ScopedSettingsPlan,
  type ScopedSettingsToast,
} from "@t3tools/web/src/components/settings/scopedSettings.ts";
import {
  resolveSettingsScope,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "@t3tools/web/src/components/settings/settingsScope.ts";
import {
  buildSettingsRowScopeModel,
  type SettingsRowScopeModel,
} from "@t3tools/web/src/components/settings/settingsLayout.logic.ts";
import { isMacPlatform } from "@t3tools/web/src/lib/utils.ts";
import { selectProjectGroupingSettings } from "@t3tools/web/src/logicalProject.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import type { SidebarProjectSnapshot } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import type { EnvironmentPresentation } from "@t3tools/web/src/state/environments.ts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { FeatureAction, FeatureContext } from "../../feature.ts";
import { themePreferenceStore, type ThemePreferenceStore } from "../../themePreference.ts";

export type SettingsSection = {
  readonly views: Readonly<Record<string, Atom.Atom<unknown>>>;
  readonly actions: Readonly<Record<string, FeatureAction>>;
};

export type SettingsRowScopeInput = {
  readonly serverScoped: boolean;
  readonly settingKeys: readonly (keyof ServerSettings)[];
  readonly mixed?: boolean;
};

export type SettingsScopeContextSnapshot = SettingsScopeSelection<EnvironmentPresentation> & {
  readonly scope: ResolvedSettingsScope;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly search: SettingsScopeSearch;
  readonly singleEnvironment: boolean;
};

export type SettingsRowOverridingProject = SettingInheritanceOverridingProject & {
  readonly projectKey: string;
};

export type SettingsRowInheritanceChain = SettingInheritanceChain & {
  readonly reset: SettingInheritanceReset;
};

export type SettingsRowInheritanceModel = Omit<SettingInheritanceModel, "chains"> & {
  readonly chains: readonly SettingsRowInheritanceChain[];
};

export type SettingsRowScope = SettingsRowScopeModel & {
  readonly settingKeys: readonly (keyof ServerSettings)[];
  readonly inheritanceModel: SettingsRowInheritanceModel | null;
  readonly overridingProjects: readonly SettingsRowOverridingProject[];
};

export type SettingsSearchTarget = {
  readonly targetId: string | null;
  readonly highlight: boolean;
  readonly revision: number;
};

export type SettingsScopeRuntime = {
  readonly sectionAtom: Atom.Atom<string | null>;
  readonly scopedSettingsAtom: Atom.Atom<UnifiedSettings>;
  readonly scopeContextAtom: Atom.Atom<SettingsScopeContextSnapshot>;
  readonly rowScope: (get: Atom.AtomContext, input: SettingsRowScopeInput) => SettingsRowScope;
  readonly updateScopedSettings: (patch: ScopedSettingsPatch) => Promise<void>;
  readonly isMac: boolean;
  readonly scopeSearchAtom: Atom.Writable<SettingsScopeSearch>;
  readonly environmentsAtom: Atom.Atom<readonly EnvironmentPresentation[]>;
  readonly groupsAtom: Atom.Atom<readonly SidebarProjectSnapshot[]>;
  readonly selectScope: (next: SettingsScopeSearch) => void;
  readonly clearScopedSettings: (keys: readonly ProjectScopedServerSettingKey[]) => Promise<void>;
  readonly clearProjectOverrides: (
    entries: readonly ProjectOverrideEntry[],
    keys: readonly ProjectScopedServerSettingKey[],
  ) => Promise<void>;
  readonly themePreference: ThemePreferenceStore;
  readonly searchTargetAtom: Atom.Writable<SettingsSearchTarget>;
};

export function createSettingsScopeRuntime(context: FeatureContext): SettingsScopeRuntime {
  const { registry, state } = context;
  const sectionAtom = Atom.make((get) => {
    const page = get(context.pageAtom);
    return page.kind === "settings" ? page.section : null;
  });
  const scopeSearchAtom = Atom.make<SettingsScopeSearch>({}).pipe(Atom.keepAlive);
  const searchTargetAtom = Atom.make<SettingsSearchTarget>({
    targetId: null,
    highlight: true,
    revision: 0,
  }).pipe(Atom.keepAlive);
  const environmentsAtom = Atom.make((get): readonly EnvironmentPresentation[] =>
    [...get(state.environmentPresentations.presentationsAtom).entries()].map(
      ([environmentId, presentation]) =>
        projectEnvironmentPresentation(environmentId, presentation),
    ),
  );
  const groupsAtom = Atom.make((get): readonly SidebarProjectSnapshot[] =>
    buildSettingsProjectGroups({
      projects: get(state.environmentProjects.projectsAtom),
      settings: selectProjectGroupingSettings(get(context.clientSettingsAtom)),
      primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
      environments: get(environmentsAtom),
    }),
  );
  const scopeContextAtom = Atom.make((get): SettingsScopeContextSnapshot => {
    const section = get(sectionAtom);
    const singleEnvironment =
      section !== null && isSettingsSingleEnvironmentPath(`/settings/${section}`);
    const groups = get(groupsAtom);
    const environments = get(environmentsAtom);
    const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
    const search = resolveSettingsScopeSearch({
      rawSearch: get(scopeSearchAtom),
      singleEnvironment,
      groups,
      environments,
      primaryEnvironmentId,
    });
    const scope = resolveSettingsScope(search, groups, environments);
    const projectFiles = new Map<string, T3ProjectFile | null>();
    if (scope.kind === "project" || scope.kind === "checkout") {
      for (const member of scope.members) {
        const fileRef = {
          environmentId: member.environmentId,
          cwd: member.workspaceRoot,
          relativePath: T3_PROJECT_FILE_NAME,
        };
        const result = get(
          state.projectEnvironment.readFile({
            environmentId: member.environmentId,
            input: { cwd: member.workspaceRoot, relativePath: T3_PROJECT_FILE_NAME },
          }),
        );
        if (result.waiting) continue;
        const data =
          get(state.projectEnvironment.optimisticFile(fileRef))?.data ??
          Option.getOrNull(AsyncResult.value(result));
        projectFiles.set(member.physicalProjectKey, settingsScopeProjectFile(data));
      }
    }
    return {
      scope,
      groups,
      search,
      singleEnvironment,
      ...resolveSettingsScopeSelection({
        scope,
        environments,
        primaryEnvironmentId,
        projectFiles,
      }),
    };
  });
  const scopedSettingsAtom = Atom.make((get) =>
    mergeEnvironmentSettings(
      get(scopeContextAtom).target?.settings ?? DEFAULT_SERVER_SETTINGS,
      get(context.clientSettingsAtom),
    ),
  );

  const rowScope = (get: Atom.AtomContext, input: SettingsRowScopeInput): SettingsRowScope => {
    const scopeContext = get(scopeContextAtom);
    const model = buildSettingsRowScopeModel({
      serverScoped: input.serverScoped,
      settingKeys: input.settingKeys,
      mixed: input.mixed,
      primarySettingsAvailable: true,
      context: {
        scopeKind: scopeContext.scope.kind,
        scopeEnvironmentIds: scopeContext.scope.environmentIds,
        targets: scopeContext.targets,
        connectedEnvironments: scopeContext.connectedEnvironments,
        environments: scopeContext.environments,
      },
    });
    const overridingProjects: readonly SettingsRowOverridingProject[] =
      model.isProjectScope || model.scopedKeys.length === 0
        ? []
        : listProjectOverrides(scopeContext.connectedEnvironments, model.scopedKeys).flatMap(
            (entry) => {
              const group = scopeContext.groups.find((candidate) =>
                candidate.memberProjects.some(
                  (member) =>
                    member.environmentId === entry.environmentId && member.id === entry.projectId,
                ),
              );
              return group
                ? [{ ...entry, label: group.displayName, projectKey: group.projectKey }]
                : [];
            },
          );
    const inheritance = model.inheritance;
    const inheritanceModel: SettingsRowInheritanceModel | null =
      inheritance === null
        ? null
        : (() => {
            const built = buildSettingInheritanceModel({
              state: inheritance.state,
              summary: inheritance.summary,
              targets: scopeContext.targets,
              environments: scopeContext.connectedEnvironments,
              keys: input.settingKeys,
              overridingProjects,
              canClearOverrides: true,
            });
            return {
              ...built,
              chains: built.chains.map((chain) => ({
                ...chain,
                reset: resolveSettingInheritanceReset({
                  environmentId: chain.environmentId,
                  overridingProjects,
                }),
              })),
            };
          })();
    return { ...model, settingKeys: input.settingKeys, inheritanceModel, overridingProjects };
  };

  const showToast = (toast: ScopedSettingsToast) => {
    context.addToast({
      layout: "plain",
      type: toast.type,
      title: toast.title,
      description: toast.description,
    });
  };

  const runPlan = async (plan: ScopedSettingsPlan) => {
    const unavailableToast = resolveScopedSettingsPlanToast(plan);
    if (unavailableToast) {
      showToast(unavailableToast);
      return;
    }
    const result = await persistScopedSettingsPatch(
      plan,
      (input) =>
        runAtomCommand(registry, state.serverEnvironment.updateSettings, input, {
          reportFailure: false,
        }),
      (patch) => {
        void context.updateClientSettings((current) => ({ ...current, ...patch }));
      },
    );
    const failureToast = resolveScopedSettingsPersistToast(result);
    if (failureToast) showToast(failureToast);
  };

  return {
    sectionAtom,
    scopedSettingsAtom,
    scopeContextAtom,
    rowScope,
    updateScopedSettings: (patch) => {
      const { scope, environments } = registry.get(scopeContextAtom);
      return runPlan(planScopedSettingsPatch(scope, environments, patch));
    },
    isMac: isMacPlatform(context.platform),
    scopeSearchAtom,
    environmentsAtom,
    groupsAtom,
    selectScope: (next) => registry.set(scopeSearchAtom, next),
    clearScopedSettings: (keys) => {
      const { scope, environments } = registry.get(scopeContextAtom);
      return runPlan(planScopedSettingsClear(scope, environments, keys));
    },
    clearProjectOverrides: (entries, keys) =>
      runPlan(
        planProjectOverridesClear(registry.get(scopeContextAtom).environments, entries, keys),
      ),
    themePreference: themePreferenceStore(context),
    searchTargetAtom,
  };
}
