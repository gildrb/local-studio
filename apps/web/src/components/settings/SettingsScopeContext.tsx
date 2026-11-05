import { T3_PROJECT_FILE_NAME, type T3ProjectFile } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { getProjectFileQueryAtom, optimisticFileAtom } from "../files/projectFilesQueryState";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";
import {
  resolveSettingsScopeSearch,
  resolveSettingsScopeSelection,
  settingsScopeProjectFile,
  type SettingsScopeSelection,
} from "./SettingsScopeContext.logic";
import {
  resolveSettingsScope,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "./settingsScope";

export type SettingsScopeContextValue = SettingsScopeSelection<EnvironmentPresentation> & {
  readonly scope: ResolvedSettingsScope;
  readonly groups: readonly SidebarProjectSnapshot[];
  readonly search: SettingsScopeSearch;
  readonly singleEnvironment: boolean;
  readonly selectScope: (next: SettingsScopeSearch) => void;
};

/**
 * Each member's decoded t3.json, so file-backed settings show the file as a
 * layer in the inheritance chain. A member is only present once its read has
 * settled; the query atom caches per (environment, cwd).
 */
function useMemberProjectFiles(scope: ResolvedSettingsScope) {
  const members = scope.kind === "project" || scope.kind === "checkout" ? scope.members : [];
  return useAtomValue(
    useMemo(
      () =>
        Atom.make((get) => {
          const files = new Map<string, T3ProjectFile | null>();
          for (const member of members) {
            const result = get(
              getProjectFileQueryAtom(
                member.environmentId,
                member.workspaceRoot,
                T3_PROJECT_FILE_NAME,
              ),
            );
            if (result.waiting) continue;
            // A pending in-app save overlays the query, like useProjectFileQuery.
            const data =
              get(
                optimisticFileAtom(
                  member.environmentId,
                  member.workspaceRoot,
                  T3_PROJECT_FILE_NAME,
                ),
              )?.data ?? Option.getOrNull(AsyncResult.value(result));
            files.set(member.physicalProjectKey, settingsScopeProjectFile(data));
          }
          return files;
        }),
      [members],
    ),
  );
}

function useResolvedSettingsScope(rawSearch: SettingsScopeSearch, singleEnvironment: boolean) {
  const groups = useSettingsProjectGroups();
  const { environments: availableEnvironments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const search = useMemo(
    () =>
      resolveSettingsScopeSearch({
        rawSearch,
        singleEnvironment,
        groups,
        environments: availableEnvironments,
        primaryEnvironmentId,
      }),
    [availableEnvironments, groups, primaryEnvironmentId, rawSearch, singleEnvironment],
  );
  const scope = useMemo(
    () => resolveSettingsScope(search, groups, availableEnvironments),
    [availableEnvironments, groups, search],
  );
  const projectFiles = useMemberProjectFiles(scope);
  return useMemo(
    () => ({
      scope,
      groups,
      search,
      ...resolveSettingsScopeSelection({
        scope,
        environments: availableEnvironments,
        primaryEnvironmentId,
        projectFiles,
      }),
    }),
    [availableEnvironments, groups, primaryEnvironmentId, projectFiles, scope, search],
  );
}

const SettingsScopeContext = createContext<SettingsScopeContextValue | null>(null);

export function SettingsScopeProvider({
  search,
  onChange,
  children,
  singleEnvironment = false,
}: {
  singleEnvironment?: boolean;
  search: SettingsScopeSearch;
  onChange: (next: SettingsScopeSearch) => void;
  children: ReactNode;
}) {
  const resolved = useResolvedSettingsScope(search, singleEnvironment);
  const value = useMemo(
    (): SettingsScopeContextValue => ({ ...resolved, singleEnvironment, selectScope: onChange }),
    [onChange, resolved, singleEnvironment],
  );
  return <SettingsScopeContext value={value}>{children}</SettingsScopeContext>;
}

export function useOptionalSettingsScope() {
  return useContext(SettingsScopeContext);
}

export function useSettingsScope() {
  const scope = useOptionalSettingsScope();
  if (scope === null) throw new Error("Settings scope must be read inside SettingsScopeProvider.");
  return scope;
}
