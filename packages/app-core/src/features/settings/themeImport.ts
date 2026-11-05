import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import {
  buildThemeImportModel,
  describeOversizedThemeFile,
  isThemeInstalled,
  parseThemeImportValue,
  resolveThemeImportBatchOutcome,
  resolveThemeImportCopy,
  resolveThemeImportPreferredName,
  resolveThemeImportSubmit,
  resolveThemeImportUpdate,
  themeImportErrorMessage,
  themeImportFailure,
  THEME_IMPORT_ACTIVATION_FAILURE_MESSAGE,
  THEME_IMPORT_READ_FAILURE_MESSAGE,
  type ThemeImportModel,
} from "@t3tools/web/src/components/settings/ThemeImportDialog.logic.ts";
import {
  buildThemeSearchModel,
  resolveThemeInstallStart,
  resolveThemeSearchSort,
  resolveThemeSearchSuggestion,
  themeSearchErrorMessage,
  themeSearchKey,
  THEME_SEARCH_DEBOUNCE_MS,
  THEME_SEARCH_DEFAULT_SORT,
  THEME_SEARCH_FAILURE_FALLBACK,
  THEME_SEARCH_INSTALL_FAILURE_FALLBACK,
  THEME_SEARCH_READ_INSTALLED_FALLBACK,
  type ThemeSearchModel,
} from "@t3tools/web/src/components/settings/ThemeSearchSection.logic.ts";
import {
  buildThemesImportedToast,
  resolveThemeImportedActivation,
} from "@t3tools/web/src/components/settings/ThemeSettings.logic.ts";
import {
  importOpenVsxThemeExtension,
  searchOpenVsxThemes,
  type OpenVsxThemeExtension,
  type OpenVsxThemeSort,
} from "@t3tools/web/src/openVsxThemes.ts";
import {
  getCustomThemes,
  getStoredCustomThemeCollection,
  installCustomTheme,
  removeCustomTheme,
  replaceCustomThemeCollection,
  updateCustomTheme,
  type ThemeAppearance,
  type ThemeDefinition,
} from "@t3tools/web/src/themePalette.ts";
import {
  pairVsCodeThemes,
  resolveThemeLabelCollisions,
} from "@t3tools/web/src/vscodeThemeImport.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import { openExternal } from "../../openExternal.ts";
import type { ThemePreferenceStore } from "../../themePreference.ts";
import type { SettingsSection } from "./scope.ts";

type ImportState = {
  readonly open: boolean;
  readonly json: string;
  readonly fileName: string | null;
  readonly error: string | null;
  readonly isReading: boolean;
  readonly conflicts: ReadonlyArray<ThemeDefinition> | null;
};

type SearchState = {
  readonly query: string;
  readonly sortBy: OpenVsxThemeSort;
  readonly results: ReadonlyArray<OpenVsxThemeExtension> | null;
  readonly error: string | null;
  readonly isSearching: boolean;
  readonly installingId: string | null;
  readonly pendingUpdate: OpenVsxThemeExtension | null;
};

export type ThemeImportView = {
  readonly model: ThemeImportModel;
  readonly search: ThemeSearchModel;
};

type ImportableThemeFile = {
  readonly name: string;
  readonly size: number;
  readonly text: () => Promise<string>;
};

const CLOSED: ImportState = {
  open: false,
  json: "",
  fileName: null,
  error: null,
  isReading: false,
  conflicts: null,
};

const SEARCH_RESET: SearchState = {
  query: "",
  sortBy: THEME_SEARCH_DEFAULT_SORT,
  results: null,
  error: null,
  isSearching: false,
  installingId: null,
  pendingUpdate: null,
};

const decodeValue = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const decodePaths = Schema.decodeUnknownSync(Schema.Struct({ paths: Schema.Array(Schema.String) }));
const decodeMode = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["update", "copy"]) }),
);
const decodeId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const decodeUrl = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

export function createThemeImport(
  context: FeatureContext,
  store: ThemePreferenceStore,
  activation: {
    readonly persistTheme: (theme: string) => boolean;
    readonly assignHalf: (appearance: ThemeAppearance, themeId: string) => void;
  },
): SettingsSection {
  const { registry } = context;
  const importAtom = Atom.make<ImportState>(CLOSED).pipe(Atom.keepAlive);
  const searchAtom = Atom.make<SearchState>(SEARCH_RESET).pipe(Atom.keepAlive);
  let importRequest = 0;
  let searchController: AbortController | null = null;
  let lastSearchKey: string | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const stackedToast = (toast: {
    readonly type: "error" | "success" | "info" | "warning";
    readonly title: string;
    readonly description?: string;
  }) => context.addToast({ layout: "stacked", ...toast });

  const setImport = (patch: Partial<ImportState>) =>
    registry.set(importAtom, { ...registry.get(importAtom), ...patch });
  const setSearch = (patch: Partial<SearchState>) =>
    registry.set(searchAtom, { ...registry.get(searchAtom), ...patch });

  const abortSearch = () => {
    searchController?.abort();
    searchController = null;
  };

  const clearDebounce = () => {
    clearTimeout(debounce ?? undefined);
    debounce = null;
  };

  const close = () => {
    importRequest += 1;
    abortSearch();
    clearDebounce();
    registry.set(importAtom, CLOSED);
  };

  const onImportedMany = (themes: ReadonlyArray<ThemeDefinition>, updated: boolean) => {
    if (updated) store.refreshLibrary();
    stackedToast(buildThemesImportedToast(themes, updated));
  };

  const onImported = (theme: ThemeDefinition): boolean => {
    const plan = resolveThemeImportedActivation(theme);
    if (plan.kind === "assign-half") {
      activation.assignHalf(plan.appearance, plan.themeId);
      stackedToast(plan.toast);
      return true;
    }
    if (!activation.persistTheme(plan.themeId)) return false;
    stackedToast(plan.toast);
    return true;
  };

  const readThemeFile = async (file: ImportableThemeFile) => {
    const oversized = describeOversizedThemeFile(file.size);
    if (oversized) {
      setImport({ error: oversized });
      return;
    }
    importRequest += 1;
    const requestId = importRequest;
    setImport({ isReading: true });
    try {
      const text = await file.text();
      if (requestId !== importRequest) return;
      setImport({ json: text, fileName: file.name, error: null });
    } catch {
      if (requestId !== importRequest) return;
      setImport({ error: THEME_IMPORT_READ_FAILURE_MESSAGE });
    } finally {
      if (requestId === importRequest) setImport({ isReading: false });
    }
  };

  const readThemeBatch = async (files: ReadonlyArray<ImportableThemeFile>) => {
    importRequest += 1;
    const requestId = importRequest;
    setImport({ isReading: true });
    const failures: string[] = [];
    const parsed: Array<{ theme: ThemeDefinition; sourceName: string }> = [];
    try {
      for (const file of files) {
        if (describeOversizedThemeFile(file.size)) {
          failures.push(`${file.name}: too large`);
          continue;
        }
        try {
          const value: unknown = JSON.parse(await file.text());
          parsed.push({ sourceName: file.name, theme: parseThemeImportValue(value) });
        } catch (cause) {
          failures.push(themeImportFailure(file.name, cause, "not a theme file"));
        }
      }
      if (requestId !== importRequest) return;
      const installed: ThemeDefinition[] = [];
      const conflicting: ThemeDefinition[] = [];
      for (const theme of pairVsCodeThemes(resolveThemeLabelCollisions(parsed))) {
        if (isThemeInstalled(theme, getCustomThemes())) {
          conflicting.push(theme);
          continue;
        }
        try {
          installed.push(installCustomTheme(theme));
        } catch (cause) {
          failures.push(themeImportFailure(theme.label, cause, "could not install"));
        }
      }
      if (installed.length > 0) onImportedMany(installed, false);
      const outcome = resolveThemeImportBatchOutcome({
        installedCount: installed.length,
        failures,
        conflicting,
      });
      if (outcome.kind === "error") setImport({ error: outcome.message });
      else if (outcome.kind === "conflicts") setImport({ conflicts: outcome.themes });
      else if (outcome.kind === "close") close();
    } finally {
      if (requestId === importRequest) setImport({ isReading: false });
    }
  };

  const readPaths = async (paths: ReadonlyArray<string>) => {
    const files = await Promise.all(
      paths.map(async (path): Promise<ImportableThemeFile> => {
        const name = basename(path);
        try {
          const info = await stat(path);
          return { name, size: Number(info.size), text: () => readFile(path, "utf8") };
        } catch {
          return { name, size: 0, text: () => Promise.reject(new Error("unreadable")) };
        }
      }),
    );
    const [first] = files;
    if (first === undefined) return;
    if (files.length === 1) await readThemeFile(first);
    else await readThemeBatch(files);
  };

  const runSearch = async (searchText: string, sortBy: OpenVsxThemeSort) => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    abortSearch();
    const controller = new AbortController();
    searchController = controller;
    setSearch({ error: null, isSearching: true });
    try {
      const results = await searchOpenVsxThemes(trimmed, { signal: controller.signal, sortBy });
      if (!controller.signal.aborted) {
        setSearch({ results });
        lastSearchKey = themeSearchKey(trimmed, sortBy);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        lastSearchKey = null;
        setSearch({
          results: null,
          error: themeSearchErrorMessage(cause, THEME_SEARCH_FAILURE_FALLBACK),
        });
      }
    }
    if (searchController === controller) {
      searchController = null;
      setSearch({ isSearching: false });
    }
  };

  const settleSearch = (keyChanged: boolean) => {
    const search = registry.get(searchAtom);
    if (!registry.get(importAtom).open || search.installingId !== null) return;
    const trimmed = search.query.trim();
    if (!trimmed) {
      lastSearchKey = null;
      abortSearch();
      setSearch({ results: null, error: null, isSearching: false });
      return;
    }
    const key = themeSearchKey(trimmed, search.sortBy);
    if (lastSearchKey === key) {
      abortSearch();
      setSearch({ isSearching: false, ...(keyChanged ? { error: null } : {}) });
      return;
    }
    void runSearch(trimmed, search.sortBy);
  };

  const install = async (extension: OpenVsxThemeExtension, allowUpdate: boolean) => {
    setSearch({ error: null });
    let installedCollection: ReadonlyArray<ThemeDefinition>;
    try {
      installedCollection = getStoredCustomThemeCollection(extension.collectionId);
    } catch (cause) {
      setSearch({ error: themeSearchErrorMessage(cause, THEME_SEARCH_READ_INSTALLED_FALLBACK) });
      return;
    }
    const decision = resolveThemeInstallStart({ installedCollection, allowUpdate });
    if (decision.kind === "confirm-update") {
      setSearch({ pendingUpdate: extension });
      return;
    }
    abortSearch();
    const controller = new AbortController();
    searchController = controller;
    setSearch({ isSearching: false, installingId: extension.id });
    try {
      const themes = await importOpenVsxThemeExtension(extension, controller.signal);
      if (!controller.signal.aborted) {
        const imported = replaceCustomThemeCollection(extension.collectionId, themes, {
          expectedCollection: installedCollection,
        });
        onImportedMany(imported, decision.updated);
        close();
        return;
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSearch({ error: themeSearchErrorMessage(cause, THEME_SEARCH_INSTALL_FAILURE_FALLBACK) });
      }
    }
    if (searchController === controller) {
      searchController = null;
      setSearch({ installingId: null });
      settleSearch(false);
    }
  };

  const viewAtom = Atom.make((get): ThemeImportView | null => {
    const state = get(importAtom);
    if (!state.open) return null;
    get(store.snapshotAtom);
    const search = get(searchAtom);
    const model = buildThemeImportModel({
      json: state.json,
      fileName: state.fileName,
      error: state.error,
      isReading: state.isReading,
      isDropTarget: false,
      conflicts: state.conflicts,
    });
    return {
      model,
      search: buildThemeSearchModel({ ...search, customThemes: getCustomThemes() }),
    };
  });

  const action =
    (run: (params: unknown) => void | Promise<void>) =>
    async (params: unknown): Promise<null> => {
      await run(params);
      return null;
    };

  return {
    views: { settingsThemeImport: viewAtom },
    actions: {
      settingsThemeImportOpen: action(() => {
        close();
        registry.set(searchAtom, SEARCH_RESET);
        lastSearchKey = null;
        setImport({ open: true });
      }),
      settingsThemeImportClose: action(close),
      settingsThemeImportJson: action((params) => setImport({ json: decodeValue(params).value })),
      settingsThemeImportFiles: action((params) => readPaths(decodePaths(params).paths)),
      settingsThemeImportBack: action(() => setImport({ conflicts: null })),
      settingsThemeImportResolve: action((params) => {
        const { mode } = decodeMode(params);
        const state = registry.get(importAtom);
        const conflicts = state.conflicts;
        if (conflicts === null) return;
        const resolved: ThemeDefinition[] = [];
        const failures: string[] = [];
        const preferredName = resolveThemeImportPreferredName(conflicts, state.fileName);
        for (const theme of conflicts) {
          try {
            resolved.push(
              mode === "update"
                ? updateCustomTheme(resolveThemeImportUpdate(theme, getCustomThemes()))
                : installCustomTheme(
                    resolveThemeImportCopy(theme, preferredName, getCustomThemes()),
                  ),
            );
          } catch (cause) {
            failures.push(themeImportFailure(theme.label, cause, "failed"));
          }
        }
        if (resolved.length > 0) onImportedMany(resolved, mode === "update");
        setImport({ conflicts: null });
        if (failures.length > 0) setImport({ error: failures.join(" — ") });
        else close();
      }),
      settingsThemeImportSubmit: action(() => {
        const decision = resolveThemeImportSubmit({
          json: registry.get(importAtom).json,
          customThemes: getCustomThemes(),
        });
        if (decision.kind === "error") {
          setImport({ error: decision.message });
          return;
        }
        if (decision.kind === "conflict") {
          setImport({ error: null, conflicts: [decision.theme] });
          return;
        }
        try {
          const installed = installCustomTheme(decision.theme);
          if (!onImported(installed)) {
            try {
              removeCustomTheme(installed.id);
            } catch {
              void 0;
            }
            setImport({ error: THEME_IMPORT_ACTIVATION_FAILURE_MESSAGE });
            return;
          }
          close();
        } catch (cause) {
          setImport({ error: themeImportErrorMessage(cause) });
        }
      }),
      settingsThemeSearchQuery: action((params) => {
        const { value } = decodeValue(params);
        const previousKey = themeSearchKey(
          registry.get(searchAtom).query.trim(),
          registry.get(searchAtom).sortBy,
        );
        setSearch({ query: value });
        clearDebounce();
        if (!value.trim()) {
          if (registry.get(searchAtom).installingId !== null) return;
          settleSearch(true);
          return;
        }
        debounce = setTimeout(() => {
          debounce = null;
          const search = registry.get(searchAtom);
          settleSearch(themeSearchKey(search.query.trim(), search.sortBy) !== previousKey);
        }, THEME_SEARCH_DEBOUNCE_MS);
      }),
      settingsThemeSearchSubmit: action(() => {
        const search = registry.get(searchAtom);
        if (search.isSearching || search.installingId !== null) return;
        clearDebounce();
        void runSearch(search.query.trim(), search.sortBy);
      }),
      settingsThemeSearchSuggestion: action((params) => {
        const { value } = decodeValue(params);
        const search = registry.get(searchAtom);
        const intent = resolveThemeSearchSuggestion(search.query, value);
        if (intent.kind === "search") {
          clearDebounce();
          void runSearch(intent.query, search.sortBy);
          return;
        }
        setSearch({ query: intent.query });
        clearDebounce();
        debounce = setTimeout(() => {
          debounce = null;
          settleSearch(true);
        }, THEME_SEARCH_DEBOUNCE_MS);
      }),
      settingsThemeSearchSort: action((params) => {
        const sortBy = resolveThemeSearchSort(decodeValue(params).value);
        if (sortBy === null) return;
        setSearch({ sortBy });
        if (debounce === null) settleSearch(true);
      }),
      settingsThemeSearchInstall: action((params) => {
        const { id } = decodeId(params);
        const extension = registry
          .get(searchAtom)
          .results?.find((candidate) => candidate.id === id);
        if (extension) void install(extension, false);
      }),
      settingsThemeSearchUpdateCancel: action(() => setSearch({ pendingUpdate: null })),
      settingsThemeSearchUpdateConfirm: action(() => {
        const extension = registry.get(searchAtom).pendingUpdate;
        setSearch({ pendingUpdate: null });
        if (extension) void install(extension, true);
      }),
      settingsThemeSearchSource: action((params) => openExternal(decodeUrl(params).url)),
    },
  };
}
