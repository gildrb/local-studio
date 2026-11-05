import type { ScopedProjectRef } from "@t3tools/contracts";
import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import {
  canCreateProjectInEnvironment,
  getCloneDirectoryName,
  getNewProjectGitHubTarget,
  type AddProjectCloneFlow,
} from "@t3tools/client-runtime/operations/projects";
import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
} from "@t3tools/client-runtime/state/thread-search";
import {
  type EnvironmentId,
  type EnvironmentMachineKind,
  type KeybindingCommand,
  type KeybindingShortcut,
  resolveEnvironmentMachineKind,
  type ServerConfig,
  type SourceControlDiscoveryResult,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  resolveThreadReferenceCopyTarget,
  type ThreadReferenceCopyTarget,
} from "@t3tools/shared/threadReference";
import {
  appearanceModeLabel,
  buildActionEntries,
  buildAddProjectEnvironmentGroups,
  buildAddProjectEnvironmentOptions,
  buildAddProjectRemoteSourceReadiness,
  buildAddProjectSourceGroups,
  buildCommandPaletteModel,
  filterPinnedBrowseEntries,
  nextAppearanceMode,
  remoteProjectSourceGlyph,
  type AddProjectEnvironmentOption,
  buildChangeThemeView,
  buildNewThreadInEntries,
  buildNewThreadInView,
  type CommandPaletteActionEntry,
  buildProjectSearchEntries,
  buildThemeCards,
  buildThemeGroups,
  buildThreadContentMatchByKey,
  buildThreadEntries,
  getEnvironmentBrowsePlatform,
  resolveCommandPaletteItem,
  type CommandPaletteAccessory,
  type CommandPaletteCommand,
  type CommandPaletteEnvironmentLocation,
  type CommandPaletteIcon,
  type CommandPaletteModel,
  type CommandPaletteProviderEntry,
  type CommandPaletteResolveContext,
  type CommandPaletteRow,
  type CommandPaletteSubtitle,
  type CommandPaletteView,
} from "@t3tools/web/src/components/CommandPalette.logic.ts";
import { resolveThreadStatusPill } from "@t3tools/web/src/components/Sidebar.logic.ts";
import { orderSidebarProjects } from "@t3tools/web/src/components/sidebar/sidebarList.logic.ts";
import { isProviderSettingsEnvironmentAvailable } from "@t3tools/web/src/components/settings/ProviderSettingsPanel.logic.ts";
import {
  filterAvailableSettingsSearchItems,
  getThreadAutoSettlementSearchAvailability,
} from "@t3tools/web/src/components/settings/settingsSearch.ts";
import { splitSearchHighlights } from "@t3tools/web/src/components/ThreadSearchMatch.logic.ts";
import {
  desktopLocalBackendId,
  isDesktopLocalConnectionTarget,
} from "@t3tools/web/src/connection/desktopLocal.ts";
import {
  openScratchProject,
  scratchEnvironmentIdFor,
  scratchWorkspaceRootFor,
} from "@t3tools/web/src/hooks/scratchProject.logic.ts";
import {
  findEffectiveShortcutForCommand,
  threadJumpIndexFromCommand,
} from "@t3tools/web/src/keybindings.ts";
import { resolveThreadActionProjectRef } from "@t3tools/web/src/lib/chatThreadActions.ts";
import {
  ensureBrowseDirectoryPath,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
} from "@t3tools/web/src/lib/projectPaths.ts";
import {
  getLocalFileManagerName,
  isWindowsPlatform,
  newProjectId,
} from "@t3tools/web/src/lib/utils.ts";
import { addProjectFromPath } from "@t3tools/web/src/components/addProject.logic.ts";
import { submitAddProjectClone } from "@t3tools/web/src/components/addProjectClone.logic.ts";
import { createNewProject } from "@t3tools/web/src/hooks/newProject.logic.ts";
import { waitForProjectIn } from "@t3tools/web/src/state/waitForProject.logic.ts";
import { addProjectService } from "../addProject.ts";
import { deriveProviderInstanceEntries } from "@t3tools/web/src/providerInstances.ts";
import { buildSidebarProjectPickerEntries } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import {
  EMPTY_THREAD_SEARCH_MATCHES,
  resolveThreadSearchRequest,
  resolveThreadSearchState,
  THREAD_SEARCH_DEBOUNCE_MS,
} from "@t3tools/web/src/state/threadSearch.logic.ts";
import {
  getCustomThemes,
  getEnvironmentThemes,
  themeColorToHex,
} from "@t3tools/web/src/themePalette.ts";
import { themePreferenceStore } from "../themePreference.ts";
import { themeEditorStore } from "../themeEditorStore.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { appPagePath, type AppPage } from "../page.ts";
import { buildProjectDisplayNames, projectIconView } from "../sidebarView.ts";
import { clipboardService } from "../clipboard.ts";
import type { ProjectIconView } from "../views/sidebar.ts";

type PaletteState = {
  readonly open: boolean;
  readonly query: string;
  readonly queryRevision: number;
  readonly viewStack: ReadonlyArray<CommandPaletteView>;
  readonly highlighted: string | null;
  readonly addProjectEnvironmentId: EnvironmentId | null;
  readonly cloneFlow: AddProjectCloneFlow | null;
  readonly newProjectFlow: {
    readonly environmentId: EnvironmentId;
    readonly sourcesEnvironmentId: EnvironmentId | null;
  } | null;
  readonly newProjectPublishesToGitHub: boolean;
  readonly isCreatingNewProject: boolean;
  readonly isRemoteProjectLookingUp: boolean;
  readonly isRemoteProjectCloning: boolean;
};

type PaletteEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly entry: EnvironmentPresentation["entry"];
  readonly connection: EnvironmentPresentation["connection"];
  readonly serverConfig: ServerConfig | null;
};

type Derived = {
  readonly model: CommandPaletteModel;
  readonly rows: ReadonlyArray<CommandPaletteRow>;
  readonly highlighted: string | null;
  readonly resolveContext: CommandPaletteResolveContext;
  readonly inputAddon: "search" | "back" | "folder-plus";
  readonly statusByThreadKey: ReadonlyMap<string, PaletteThreadStatusView>;
  readonly remoteMachineByThreadKey: ReadonlyMap<string, EnvironmentMachineKind>;
  readonly projectIconByKey: ReadonlyMap<string, ProjectIconView>;
  readonly newThreadInEntries: ReadonlyArray<CommandPaletteActionEntry>;
  readonly currentProjectRef: ScopedProjectRef | null;
  readonly copyTarget: ThreadReferenceCopyTarget | null;
  readonly addProjectPath: string;
  readonly addProject: AddProjectContext;
};

type AddProjectContext = {
  readonly environments: ReadonlyArray<PaletteEnvironment>;
  readonly options: ReadonlyArray<AddProjectEnvironmentOption>;
  readonly newProjectOptions: ReadonlyArray<AddProjectEnvironmentOption>;
  readonly defaultEnvironmentId: EnvironmentId | null;
  readonly browseEnvironmentId: EnvironmentId | null;
  readonly browseEnvironment: PaletteEnvironment | null;
  readonly browsePlatform: string;
  readonly currentProjectCwdForBrowse: string | null;
  readonly discovery: SourceControlDiscoveryResult | null;
  readonly newProjectGitHubTarget: { readonly account: string | null } | null;
  readonly relativePathNeedsActiveProject: boolean;
  readonly canOpenFileManager: boolean;
};

export type CommandPaletteOpenRequest = {
  readonly query?: string | undefined;
  readonly open?: "new-thread-in" | "add-project" | "change-theme" | undefined;
};

export interface CommandPaletteService {
  readonly open: (request: CommandPaletteOpenRequest) => void;
  readonly feature: CoreFeature;
}

export type PaletteThreadStatusView = {
  readonly label: string;
  readonly tone: string;
  readonly pulse: boolean;
};

export type PaletteIconView =
  | { readonly kind: "glyph"; readonly glyph: string }
  | { readonly kind: "project"; readonly icon: ProjectIconView }
  | { readonly kind: "machine"; readonly machine: EnvironmentMachineKind };

export type PaletteSubtitleView =
  | {
      readonly kind: "thread";
      readonly project: ProjectIconView | null;
      readonly projectLabel: string | null;
      readonly environmentLabel: string | null;
      readonly branchLabel: string | null;
      readonly isWorktree: boolean;
      readonly harness: {
        readonly driverKind: string;
        readonly initials: string;
      } | null;
      readonly isCurrent: boolean;
    }
  | {
      readonly kind: "location";
      readonly remoteMachine: EnvironmentMachineKind | null;
      readonly label: string;
      readonly workspaceRoot: string;
    }
  | { readonly kind: "labels"; readonly text: string };

export type PaletteAccessoryView =
  | { readonly kind: "current" }
  | {
      readonly kind: "theme-previews";
      readonly current: boolean;
      readonly previews: ReadonlyArray<{
        readonly mode: string;
        readonly color: string | null;
      }>;
    }
  | { readonly kind: "setup-required"; readonly hint: string }
  | { readonly kind: "selected" }
  | { readonly kind: "chevron" }
  | { readonly kind: "checkbox"; readonly checked: boolean };

export type PaletteRowView = {
  readonly value: string;
  readonly kind: "action" | "submenu";
  readonly title: string;
  readonly titleEmphasis: string | null;
  readonly description: string | null;
  readonly subtitle: PaletteSubtitleView | null;
  readonly icon: PaletteIconView;
  readonly disabled: boolean;
  readonly accessory: PaletteAccessoryView | null;
  readonly shortcutLabel: string | null;
  readonly timestamp: string | null;
  readonly contentMatch: {
    readonly source: "user" | "assistant";
    readonly parts: ReadonlyArray<{
      readonly text: string;
      readonly highlighted: boolean;
    }>;
  } | null;
  readonly status: PaletteThreadStatusView | null;
  readonly remoteMachine: EnvironmentMachineKind | null;
};

export type CommandPaletteViewModel = {
  readonly query: string;
  readonly queryRevision: number;
  readonly placeholder: string;
  readonly inputAddon: "search" | "back" | "folder-plus";
  readonly isSubmenu: boolean;
  readonly groups: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly rows: ReadonlyArray<PaletteRowView>;
  }>;
  readonly highlighted: string | null;
  readonly emptyStateMessage: string;
  readonly footerActionLabel: string | null;
  readonly showBackHint: boolean;
  readonly submit: {
    readonly label: string;
    readonly shortcutLabel: string;
    readonly disabled: boolean;
  } | null;
  readonly inputPaddingEnd: number;
  readonly newProjectHeader: {
    readonly title: string;
    readonly detail: string;
  } | null;
  readonly repositoryHeader: {
    readonly title: string;
    readonly description: string;
    readonly icon: PaletteIconView;
  } | null;
  readonly fileManagerLabel: string | null;
};

export type CommandPaletteBindingView = {
  readonly bindings: ReadonlyArray<{
    readonly command: string;
    readonly keystroke: string;
    readonly scope: "global" | "palette";
    readonly outsideTerminal: boolean;
  }>;
};

const CLOSED_STATE: PaletteState = {
  open: false,
  query: "",
  queryRevision: 0,
  viewStack: [],
  highlighted: null,
  addProjectEnvironmentId: null,
  cloneFlow: null,
  newProjectFlow: null,
  newProjectPublishesToGitHub: false,
  isCreatingNewProject: false,
  isRemoteProjectLookingUp: false,
  isRemoteProjectCloning: false,
};

const OpenParams = Schema.decodeUnknownSync(
  Schema.Struct({
    query: Schema.optional(Schema.String),
    open: Schema.optional(Schema.Literals(["new-thread-in", "add-project", "change-theme"])),
  }),
);
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const MoveParams = Schema.decodeUnknownSync(Schema.Struct({ delta: Schema.Number }));
const HighlightParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const ActivateParams = Schema.decodeUnknownSync(
  Schema.Struct({
    value: Schema.optional(Schema.String),
    modifier: Schema.optional(Schema.Boolean),
  }),
);
const ShortcutParams = Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }));

const GLOBAL_SHORTCUT_COMMANDS: ReadonlyArray<KeybindingCommand> = [
  "commandPalette.toggle",
  "filePicker.toggle",
  "projectSearch.toggle",
  "appearance.cycle",
  "theme.select",
  "themeEditor.toggle",
  "usage.open",
];

const PALETTE_SHORTCUT_COMMANDS: ReadonlyArray<KeybindingCommand> = [
  ...THREAD_JUMP_KEYBINDING_COMMANDS,
  "thread.copyReference",
];

const INPUT_PADDING_END = {
  default: 11,
  browse: 96,
  highlighted: 120,
  create: 152,
  flow: 128,
} as const;

const GPUI_KEY_NAMES: Readonly<Record<string, string>> = {
  " ": "space",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  escape: "escape",
  enter: "enter",
  backspace: "backspace",
  delete: "delete",
  tab: "tab",
};

function gpuiKeystroke(shortcut: KeybindingShortcut, macPlatform: boolean): string {
  const metaKey = shortcut.metaKey || (shortcut.modKey && macPlatform);
  const ctrlKey = shortcut.ctrlKey || (shortcut.modKey && !macPlatform);
  return [
    ctrlKey ? "ctrl" : null,
    shortcut.altKey ? "alt" : null,
    shortcut.shiftKey ? "shift" : null,
    metaKey ? "cmd" : null,
    GPUI_KEY_NAMES[shortcut.key] ?? shortcut.key,
  ]
    .filter((part) => part !== null)
    .join("-");
}

function settingsSection(path: string): string {
  const section = path.replace(/^\/settings\/?/, "");
  return section.length === 0 ? "general" : section;
}

function iconView(
  icon: CommandPaletteIcon,
  projectIconByKey: ReadonlyMap<string, ProjectIconView>,
): PaletteIconView {
  switch (icon.kind) {
    case "glyph":
      return { kind: "glyph", glyph: icon.glyph };
    case "project":
      return {
        kind: "project",
        icon:
          projectIconByKey.get(`${icon.project.environmentId}:${icon.project.id}`) ??
          projectIconView(icon.project),
      };
    case "machine":
      return { kind: "machine", machine: icon.machine };
  }
}

function subtitleView(
  subtitle: CommandPaletteSubtitle,
  projectIconByKey: ReadonlyMap<string, ProjectIconView>,
): PaletteSubtitleView | null {
  switch (subtitle.kind) {
    case "thread": {
      const projectLabel = subtitle.projectTitle?.trim() || null;
      const branchLabel = subtitle.branch?.trim() || null;
      const harness =
        subtitle.driverKind !== null && subtitle.providerDisplayName
          ? {
              driverKind: subtitle.driverKind,
              initials: providerInstanceInitials(subtitle.providerDisplayName),
            }
          : null;
      if (!projectLabel && !branchLabel && !subtitle.isCurrent && harness === null) return null;
      return {
        kind: "thread",
        project:
          subtitle.project === null
            ? null
            : (projectIconByKey.get(`${subtitle.project.environmentId}:${subtitle.project.id}`) ??
              projectIconView(subtitle.project)),
        projectLabel,
        environmentLabel: subtitle.environmentLabel || null,
        branchLabel,
        isWorktree: subtitle.worktreePath != null && subtitle.worktreePath.trim().length > 0,
        harness,
        isCurrent: subtitle.isCurrent,
      };
    }
    case "location":
      return {
        kind: "location",
        remoteMachine: subtitle.location.kind === "remote" ? subtitle.location.machine : null,
        label: subtitle.location.label,
        workspaceRoot: subtitle.workspaceRoot,
      };
    case "environment-labels":
      return { kind: "labels", text: subtitle.labels.join(" · ") };
  }
}

function accessoryView(accessory: CommandPaletteAccessory): PaletteAccessoryView {
  if (accessory.kind !== "theme-previews") return accessory;
  return {
    kind: "theme-previews",
    current: accessory.current,
    previews: accessory.previews.map((preview) => ({
      mode: preview.mode,
      color: themeColorToHex(preview.colors.canvas),
    })),
  };
}

const services = new WeakMap<FeatureContext, CommandPaletteService>();

export function commandPaletteService(context: FeatureContext): CommandPaletteService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const service = createCommandPaletteService(context);
  services.set(context, service);
  return service;
}

function createCommandPaletteService(context: FeatureContext): CommandPaletteService {
  const { registry, state } = context;
  const stateAtom = Atom.make<PaletteState>(CLOSED_STATE).pipe(Atom.keepAlive);
  const debouncedSearchAtom = Atom.make("").pipe(Atom.keepAlive);
  const themeStore = themePreferenceStore(context);
  const threadSearchResultsAtom = createThreadSearchResultsAtomFamily({
    getSearchAtom: (environmentId, query) =>
      state.orchestrationEnvironment.threadSearch({
        environmentId,
        input: { query },
      }),
    labelPrefix: "gpui:thread-search",
  });
  const macPlatform = context.platform.startsWith("Mac");

  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(state.primaryServerConfigAtom)?.keybindings ?? []),
  );

  const environmentsAtom = Atom.make((get): ReadonlyArray<PaletteEnvironment> =>
    [...get(state.environmentPresentations.presentationsAtom)].map(
      ([environmentId, presentation]) => ({
        environmentId,
        label: presentation.entry.target.label,
        entry: presentation.entry,
        connection: presentation.connection,
        serverConfig: presentation.serverConfig,
      }),
    ),
  );

  const searchQueryAtom = Atom.make((get) => {
    const palette = get(stateAtom);
    const isActionsOnly = palette.query.startsWith(">");
    return palette.open && palette.viewStack.length === 0 && !isActionsOnly ? palette.query : "";
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  registry.subscribe(searchQueryAtom, (query) => {
    clearTimeout(debounceTimer ?? undefined);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      registry.set(debouncedSearchAtom, query.trim());
    }, THREAD_SEARCH_DEBOUNCE_MS);
  });

  const derive = (get: Atom.AtomContext, palette: PaletteState): Derived => {
    const environments = get(environmentsAtom);
    const environmentById = new Map(environments.map((env) => [env.environmentId, env]));
    const presentations = get(state.environmentPresentations.presentationsAtom);
    const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
    const primaryConfig = get(state.primaryServerConfigAtom);
    const keybindings = get(keybindingsAtom);
    const clientSettings = get(context.clientSettingsAtom);
    const uiState = get(context.uiStateAtom);
    const projects = get(state.environmentProjects.projectsAtom);
    const threads = get(state.environmentThreadShells.threadShellsAtom);
    const page = get(context.pageAtom);
    const themeSnapshot = get(themeStore.snapshotAtom);
    const appearanceMode = themeSnapshot.appearanceMode;
    const threadInput = page.kind === "chat" ? get(context.threadInputAtom) : null;
    const activeThread = threadInput?.isServerThread ? threadInput.thread : null;
    const activeDraftThread = threadInput?.isServerThread
      ? null
      : (threadInput?.draftThread ?? null);
    const currentView = palette.viewStack.at(-1) ?? null;
    const query = palette.query;

    const projectIconByKey = new Map(
      projects.map((project) => [
        `${project.environmentId}:${project.id}`,
        projectIconView(project),
      ]),
    );
    const { projectGroups } = buildProjectDisplayNames({
      projects,
      threads,
      environments: presentations,
      primaryEnvironmentId,
      clientSettings,
      projectOrder: uiState.projectOrder,
    });
    const orderedProjects = orderSidebarProjects(projects, uiState.projectOrder);
    const firstProject = orderedProjects[0];
    const contextualProjectRef = resolveThreadActionProjectRef({
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef:
        firstProject === undefined
          ? null
          : scopeProjectRef(firstProject.environmentId, firstProject.id),
    });

    const locationByEnvironmentId = new Map(
      environments.map((environment): [EnvironmentId, CommandPaletteEnvironmentLocation] => {
        const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
        const isLocal = isPrimary || isDesktopLocalConnectionTarget(environment.entry.target);
        return [
          environment.environmentId,
          {
            kind: isLocal ? "local" : "remote",
            label: isPrimary
              ? "Local"
              : isLocal
                ? `${environment.label} (Local)`
                : environment.label,
            machine: resolveEnvironmentMachineKind(environment.serverConfig),
          },
        ];
      }),
    );

    const providerByKey = new Map<string, CommandPaletteProviderEntry>();
    for (const environment of environments) {
      const environmentProviders =
        environment.serverConfig?.providers ??
        (environment.environmentId === primaryEnvironmentId
          ? (primaryConfig?.providers ?? [])
          : []);
      for (const entry of deriveProviderInstanceEntries(environmentProviders)) {
        providerByKey.set(`${environment.environmentId}:${entry.instanceId}`, entry);
      }
    }

    const connectedEnvironmentIds = environments
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => environment.environmentId);
    const isActionsOnly = query.startsWith(">");
    const threadSearchQuery = currentView === null && !isActionsOnly ? query : "";
    const searchRequest = resolveThreadSearchRequest({
      environmentIds: connectedEnvironmentIds,
      normalizedQuery: threadSearchQuery.trim(),
      debouncedQuery: get(debouncedSearchAtom),
    });
    const settledQuery = searchRequest.settledQuery;
    const threadSearch = resolveThreadSearchState(
      searchRequest,
      settledQuery === null
        ? { matches: EMPTY_THREAD_SEARCH_MATCHES, isLoading: false }
        : get(threadSearchResultsAtom(makeThreadSearchKey(connectedEnvironmentIds, settledQuery))),
    );
    const contentMatchByKey = buildThreadContentMatchByKey(threadSearch.matches, threadSearchQuery);

    const addProjectEnvironmentOptions = buildAddProjectEnvironmentOptions(
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        runtimeLabel: environment.label,
        isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
        machine: resolveEnvironmentMachineKind(environment.serverConfig),
        connection: environment.connection,
      })),
    );
    const defaultAddProjectEnvironmentId =
      addProjectEnvironmentOptions.find((option) => option.isConnected)?.environmentId ?? null;
    const browseEnvironmentId = palette.addProjectEnvironmentId ?? defaultAddProjectEnvironmentId;
    const browseEnvironment =
      browseEnvironmentId === null ? null : (environmentById.get(browseEnvironmentId) ?? null);
    const wslFolderEnvironment =
      addProjectEnvironmentOptions.find((option) => {
        if (!option.isConnected) return false;
        const environment = environmentById.get(option.environmentId);
        return environment
          ? desktopLocalBackendId(environment.entry.target)?.startsWith("wsl:") === true
          : false;
      }) ?? null;
    const newProjectEnvironmentOptions = addProjectEnvironmentOptions.filter(
      (option) =>
        option.isConnected &&
        (environmentById.get(option.environmentId)?.serverConfig?.newProjectsRoot ?? null) !== null,
    );

    const browsePlatform = getEnvironmentBrowsePlatform(
      browseEnvironment?.serverConfig?.environment.platform.os,
    );
    const cloneFlow = palette.cloneFlow;
    const pinnedCloneDirectoryName =
      cloneFlow?.step === "confirm"
        ? getCloneDirectoryName(cloneFlow.repository?.nameWithOwner ?? cloneFlow.remoteUrl)
        : "";
    const browsePath = getFilesystemBrowsePath(
      query,
      browsePlatform,
      browseEnvironmentId !== null &&
        cloneFlow?.step !== "repository" &&
        palette.newProjectFlow === null,
    );
    const currentProjectEnvironmentId =
      activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
    const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
    const currentProjectCwd =
      currentProjectId === null
        ? null
        : (projects.find((project) => project.id === currentProjectId)?.workspaceRoot ?? null);
    const currentProjectCwdForBrowse =
      browseEnvironmentId !== null && currentProjectEnvironmentId === browseEnvironmentId
        ? currentProjectCwd
        : null;
    const relativePathNeedsActiveProject =
      isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
    const browseResult =
      browsePath.isBrowsing &&
      browsePath.directoryPath.length > 0 &&
      browseEnvironmentId !== null &&
      !relativePathNeedsActiveProject
        ? get(
            state.filesystemEnvironment.browse({
              environmentId: browseEnvironmentId,
              input: {
                partialPath: browsePath.directoryPath,
                ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
              },
            }),
          )
        : null;
    const browseData =
      browseResult === null ? null : Option.getOrNull(AsyncResult.value(browseResult));
    const browseEntries = browseData?.entries ?? [];
    const { visibleEntries, exactEntry } = pinnedCloneDirectoryName
      ? filterPinnedBrowseEntries({
          browseEntries,
          filterQuery: browsePath.filterQuery,
          pinnedDirectoryName: pinnedCloneDirectoryName,
          caseSensitive: !isWindowsPlatform(browsePlatform),
        })
      : filterFilesystemBrowseEntries(browseEntries, browsePath.filterQuery);
    const discoveryResult =
      browseEnvironmentId === null
        ? null
        : get(
            state.sourceControlEnvironment.discovery({
              environmentId: browseEnvironmentId,
              input: {},
            }),
          );
    const discovery =
      discoveryResult === null ? null : Option.getOrNull(AsyncResult.value(discoveryResult));
    const newProjectFlow = palette.newProjectFlow;
    const newProjectGitHubTarget =
      newProjectFlow === null ? null : getNewProjectGitHubTarget(discovery);
    const newProjectsRootFor = (environmentId: EnvironmentId | null) =>
      environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
        ?.newProjectsRoot ?? null;

    const scratchTargetEnvironmentId = scratchEnvironmentIdFor(
      environments,
      currentProjectEnvironmentId ?? primaryEnvironmentId,
    );
    const projectTitleById = new Map(projects.map((project) => [project.id, project.title]));
    const projectByKey = new Map(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project]),
    );
    const pickerEntries = buildSidebarProjectPickerEntries({
      groups: projectGroups,
      preferredProjectRef: contextualProjectRef,
    });
    const projectGroupByTargetKey = new Map(
      pickerEntries.map(({ group, targetProject }) => [
        `${targetProject.environmentId}:${targetProject.id}`,
        group,
      ]),
    );
    const contextualProjectGroup =
      (contextualProjectRef === null
        ? null
        : projectGroupByTargetKey.get(
            `${contextualProjectRef.environmentId}:${contextualProjectRef.projectId}`,
          )) ??
      projectGroups[0] ??
      null;
    const newThreadInEntries = buildNewThreadInEntries({
      pickerEntries,
      locationByEnvironmentId,
      scratchWorkspaceRootByEnvironmentId: new Map(
        environments.map((environment) => [
          environment.environmentId,
          scratchWorkspaceRootFor(environments, environment.environmentId),
        ]),
      ),
      scratchTargetEnvironmentId,
    });
    const threadEntries = buildThreadEntries({
      threads,
      ...(activeThread ? { activeThreadId: activeThread.id } : {}),
      projectTitleById,
      sortOrder: clientSettings.sidebarThreadSortOrder,
      projectByKey,
      locationByEnvironmentId,
      providerByKey,
      contentMatchByKey,
    });
    const copyThreadReferenceTarget =
      activeThread === null
        ? null
        : resolveThreadReferenceCopyTarget({
            threadId: activeThread.id,
            pullRequests: activeThread.pullRequests,
            linkedPullRequestUrl:
              activeThread.linkedPullRequest?.url ?? activeThread.branchPullRequest?.url ?? null,
          });
    const actionEntries = buildActionEntries({
      hasProjects: projects.length > 0,
      activeProjectTitle:
        pickerEntries.find((entry) => entry.isPreferred)?.group.displayName ??
        (currentProjectId ? (projectTitleById.get(currentProjectId) ?? null) : null),
      newThreadInEntries,
      scratchTargetEnvironmentId,
      copyThreadReferenceTarget,
      activeThread:
        activeThread === null
          ? null
          : {
              environmentId: activeThread.environmentId,
              id: activeThread.id,
              pullRequests: activeThread.pullRequests,
              capabilities:
                environmentById.get(activeThread.environmentId)?.serverConfig?.environment
                  .capabilities ?? null,
            },
      canCreateNewProject: newProjectEnvironmentOptions.length > 0,
      wslFolderEnvironment,
      themeGroups: buildThemeGroups({
        cards: buildThemeCards({
          customThemes: getCustomThemes(),
          environmentThemes: getEnvironmentThemes(),
        }),
        theme: themeSnapshot.theme,
        themeHalves: themeSnapshot.themeHalves,
        resolvedTheme: themeSnapshot.resolvedTheme,
      }),
      appearanceMode,
      pullRequestsAvailable: environments.some(
        (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
      ),
      projectSettingsTarget:
        contextualProjectGroup === null
          ? null
          : {
              projectKey: contextualProjectGroup.projectKey,
              displayName: contextualProjectGroup.displayName,
            },
    });
    const availableSettingsSearchItems = filterAvailableSettingsSearchItems({
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
          environment.serverConfig?.environment.platform.os === "darwin" &&
          isProviderSettingsEnvironmentAvailable({
            connectionPhase: environment.connection.phase,
            hasServerConfig: true,
          }),
      ),
      canManageLocalBackend: true,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement:
        getThreadAutoSettlementSearchAvailability(environments).eligibleEnvironmentIds.length > 0,
    });

    const buildModel = (highlightedItemValue: string | null) =>
      buildCommandPaletteModel({
        query,
        deferredQuery: query,
        platform: context.platform,
        keybindings,
        currentView,
        highlightedItemValue,
        actionEntries,
        threadEntries,
        linkedThreadSearch: null,
        projectSearchEntries: buildProjectSearchEntries({
          pickerEntries,
          locationByEnvironmentId,
        }),
        availableSettingsSearchItems,
        settingsSearchPlatform: {
          isElectron: true,
          platform: context.platform,
        },
        addProjectSources:
          palette.addProjectEnvironmentId === null
            ? null
            : {
                environmentId: palette.addProjectEnvironmentId,
                readiness: buildAddProjectRemoteSourceReadiness(discovery),
                canCreateNewProject: newProjectsRootFor(palette.addProjectEnvironmentId) !== null,
              },
        threadSearchPending: threadSearch.isPending,
        environmentConnected: canCreateProjectInEnvironment(browseEnvironment?.connection.phase),
        browse: {
          isBrowsing: browsePath.isBrowsing,
          entries: visibleEntries,
          canBrowseUp: browsePath.canBrowseUp,
          relativePathNeedsActiveProject,
          isPending: browseResult !== null && browseResult.waiting,
          hasResult: browseData !== null,
          hasExactEntry: exactEntry !== null,
        },
        cloneFlow,
        remoteProjectPending: palette.isRemoteProjectLookingUp || palette.isRemoteProjectCloning,
        newProject:
          newProjectFlow === null
            ? null
            : {
                environmentId: newProjectFlow.environmentId,
                root: newProjectsRootFor(newProjectFlow.environmentId),
                githubTarget: newProjectGitHubTarget,
                publishesToGitHub: palette.newProjectPublishesToGitHub,
                isCreating: palette.isCreatingNewProject,
                machineOptions: newProjectEnvironmentOptions,
                environmentLabelFallback:
                  environmentById.get(newProjectFlow.environmentId)?.label ?? null,
              },
      });

    const firstModel = buildModel(palette.highlighted);
    const rows = firstModel.groups.flatMap((group) => group.items);
    const navigable = rows.filter((row) => !row.disabled);
    const highlighted = navigable.some((row) => row.value === palette.highlighted)
      ? palette.highlighted
      : firstModel.autoHighlight
        ? (navigable[0]?.value ?? null)
        : null;
    const model = highlighted === palette.highlighted ? firstModel : buildModel(highlighted);

    const statusByThreadKey = new Map<string, PaletteThreadStatusView>();
    const remoteMachineByThreadKey = new Map<string, EnvironmentMachineKind>();
    for (const thread of threads) {
      const key = `${thread.environmentId}:${thread.id}`;
      const pill = resolveThreadStatusPill({
        thread: {
          ...thread,
          lastVisitedAt:
            uiState.threadLastVisitedAtById[
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
            ],
        },
      });
      const tone = pill === null ? null : (/^bg-([a-z]+)-/.exec(pill.dotClass)?.[1] ?? null);
      if (pill !== null && tone !== null) {
        statusByThreadKey.set(key, {
          label: pill.label,
          tone,
          pulse: pill.pulse,
        });
      }
      if (thread.environmentId !== primaryEnvironmentId) {
        remoteMachineByThreadKey.set(
          key,
          resolveEnvironmentMachineKind(
            environmentById.get(thread.environmentId)?.serverConfig ?? null,
          ),
        );
      }
    }

    return {
      model,
      rows,
      highlighted,
      resolveContext: {
        threads,
        sidebarThreadSortOrder: clientSettings.sidebarThreadSortOrder,
        contextualProjectRef,
        appearanceMode,
        pathname: appPagePath(page),
        browse: {
          query,
          directoryPath: browsePath.directoryPath,
          parentPath: browsePath.parentPath,
          pinnedCloneDirectoryName,
          platform: browsePlatform,
        },
      },
      inputAddon: model.isSubmenu ? "back" : browsePath.isBrowsing ? "folder-plus" : "search",
      addProjectPath: hasTrailingPathSeparator(query)
        ? (browseData?.parentPath ?? query.trim())
        : (exactEntry?.fullPath ?? query.trim()),
      statusByThreadKey,
      remoteMachineByThreadKey,
      projectIconByKey,
      newThreadInEntries,
      copyTarget: copyThreadReferenceTarget,
      addProject: {
        environments,
        options: addProjectEnvironmentOptions,
        newProjectOptions: newProjectEnvironmentOptions,
        defaultEnvironmentId: defaultAddProjectEnvironmentId,
        browseEnvironmentId,
        browseEnvironment,
        browsePlatform,
        currentProjectCwdForBrowse,
        discovery,
        newProjectGitHubTarget,
        relativePathNeedsActiveProject,
        canOpenFileManager:
          browsePath.isBrowsing &&
          browseEnvironmentId !== null &&
          browseEnvironmentId === primaryEnvironmentId,
      },
      currentProjectRef:
        currentProjectEnvironmentId !== null && currentProjectId !== null
          ? scopeProjectRef(currentProjectEnvironmentId, currentProjectId)
          : null,
    };
  };

  const derivedAtom = Atom.make((get): Derived | null => {
    const palette = get(stateAtom);
    return palette.open ? derive(get, palette) : null;
  });

  const rowView = (row: CommandPaletteRow, derived: Derived): PaletteRowView => {
    const threadKey = row.thread ? `${row.thread.environmentId}:${row.thread.threadId}` : null;
    const subtitle =
      row.subtitle === undefined ? null : subtitleView(row.subtitle, derived.projectIconByKey);
    return {
      value: row.value,
      kind: row.kind,
      title: row.title,
      titleEmphasis: row.titleEmphasis ?? null,
      description: row.subtitle === undefined ? row.description || null : null,
      subtitle,
      icon: iconView(row.icon, derived.projectIconByKey),
      disabled: row.disabled ?? false,
      accessory: threadKey === null && row.accessory ? accessoryView(row.accessory) : null,
      shortcutLabel: row.shortcutLabel,
      timestamp: row.timestamp ?? null,
      contentMatch: row.threadContentMatch
        ? {
            source: row.threadContentMatch.source,
            parts: splitSearchHighlights(
              row.threadContentMatch.snippet,
              row.threadContentMatch.query,
            ).map((part) => ({
              text: part.text,
              highlighted: part.highlighted,
            })),
          }
        : null,
      status: threadKey === null ? null : (derived.statusByThreadKey.get(threadKey) ?? null),
      remoteMachine:
        threadKey === null ? null : (derived.remoteMachineByThreadKey.get(threadKey) ?? null),
    };
  };

  const viewAtom = Atom.make((get): CommandPaletteViewModel | null => {
    const palette = get(stateAtom);
    const derived = get(derivedAtom);
    if (derived === null) return null;
    const { model } = derived;
    return {
      query: palette.query,
      queryRevision: palette.queryRevision,
      placeholder: model.inputPlaceholder,
      inputAddon: derived.inputAddon,
      isSubmenu: model.isSubmenu,
      groups: model.groups.map((group) => ({
        value: group.value,
        label: group.label,
        rows: group.items.map((row) => rowView(row, derived)),
      })),
      highlighted: derived.highlighted,
      emptyStateMessage: model.emptyStateMessage,
      footerActionLabel: model.footerActionLabel,
      showBackHint: model.isSubmenu,
      submit:
        model.submit === null
          ? null
          : {
              label: model.submit.label,
              shortcutLabel: model.submit.shortcutLabel,
              disabled: model.submit.disabled,
            },
      inputPaddingEnd:
        palette.cloneFlow?.step === "repository" || palette.newProjectFlow !== null
          ? INPUT_PADDING_END.flow
          : model.mode === "root-browse" || model.mode === "submenu-browse"
            ? model.willCreateProjectPath
              ? INPUT_PADDING_END.create
              : model.hasHighlightedBrowseItem
                ? INPUT_PADDING_END.highlighted
                : INPUT_PADDING_END.browse
            : INPUT_PADDING_END.default,
      newProjectHeader: model.newProjectHeader,
      repositoryHeader:
        model.repositoryHeader === null
          ? null
          : {
              title: model.repositoryHeader.title,
              description: model.repositoryHeader.description,
              icon: iconView(model.repositoryHeader.icon, derived.projectIconByKey),
            },
      fileManagerLabel: derived.addProject.canOpenFileManager
        ? `Open in ${getLocalFileManagerName(context.platform)}`
        : null,
    };
  });

  const bindingAtom = Atom.make((get): CommandPaletteBindingView => {
    const keybindings = get(keybindingsAtom);
    const resolve = (command: KeybindingCommand, terminalFocus: boolean) => {
      const shortcut = findEffectiveShortcutForCommand(keybindings, command, {
        platform: context.platform,
        context: { terminalFocus, modelPickerOpen: false },
      });
      return shortcut === null ? null : gpuiKeystroke(shortcut, macPlatform);
    };
    const bindings: Array<CommandPaletteBindingView["bindings"][number]> = [];
    for (const command of GLOBAL_SHORTCUT_COMMANDS) {
      const keystroke = resolve(command, false);
      if (keystroke === null) continue;
      bindings.push({
        command,
        keystroke,
        scope: "global",
        outsideTerminal: resolve(command, true) !== keystroke,
      });
    }
    for (const command of PALETTE_SHORTCUT_COMMANDS) {
      const keystroke = resolve(command, false);
      if (keystroke === null) continue;
      bindings.push({
        command,
        keystroke,
        scope: "palette",
        outsideTerminal: false,
      });
    }
    return { bindings };
  });

  const update = (change: (current: PaletteState) => PaletteState) =>
    registry.set(stateAtom, change(registry.get(stateAtom)));

  const openFresh = (query: string) => {
    registry.set(debouncedSearchAtom, query.trim());
    update((current) => ({
      ...CLOSED_STATE,
      open: true,
      query,
      queryRevision: current.queryRevision + 1,
    }));
  };

  const close = () =>
    update((current) => ({
      ...CLOSED_STATE,
      queryRevision: current.queryRevision + 1,
    }));

  const setQuery = (query: string) =>
    update((current) => ({
      ...current,
      query,
      queryRevision: current.queryRevision + 1,
      highlighted: null,
    }));

  const pushView = (view: CommandPaletteView) =>
    update((current) => ({
      ...current,
      viewStack: [...current.viewStack, view],
      highlighted: null,
      query: view.initialQuery ?? "",
      queryRevision: current.queryRevision + 1,
    }));

  const popView = () =>
    update((current) => ({
      ...current,
      cloneFlow: null,
      newProjectFlow: null,
      addProjectEnvironmentId:
        current.viewStack.length <= 1
          ? null
          : (current.newProjectFlow?.sourcesEnvironmentId ?? current.addProjectEnvironmentId),
      viewStack: current.viewStack.slice(0, -1),
      highlighted: null,
      query: "",
      queryRevision: current.queryRevision + 1,
    }));

  const notifyThemeSaveFailure = () => {
    context.addToast({
      layout: "stacked",
      type: "error",
      title: "Couldn't save theme selection",
      description: "Try again.",
    });
  };

  const unavailable = (feature: string): never => {
    throw new Error(`${feature} is not available in the native app yet.`);
  };

  const notAvailableToast = (feature: string) => {
    context.addToast({
      layout: "plain",
      type: "info",
      title: `${feature} is not available in the native app yet.`,
    });
  };

  const runOrToast = (run: () => Promise<unknown>) => {
    void run().catch((error: unknown) => {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: "Unable to run command",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  };

  let cloneLookupGeneration = 0;
  let newProjectSubmitting = false;

  const showStackedError = ({ title, description }: { title: string; description: string }) => {
    context.addToast({ layout: "stacked", type: "error", title, description });
  };

  const waitForProject = (ref: ScopedProjectRef, timeoutMs?: number) =>
    waitForProjectIn(registry, state.environmentProjects.projectAtom(ref), timeoutMs);

  const startScratchThread = async (environmentId: EnvironmentId) => {
    const reportFailure = (error: unknown) =>
      showStackedError({
        title: "Could not start without a project",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    const project = await openScratchProject(
      {
        ensureScratch: (target) =>
          runAtomCommand(registry, state.projectEnvironment.ensureScratch, target, {
            reportFailure: false,
          }),
        waitForProject: (ref) => waitForProject(ref),
        reportFailure,
      },
      environmentId,
    );
    if (project) {
      await context
        .openNewThread(scopeProjectRef(project.environmentId, project.id))
        .catch(reportFailure);
    }
  };

  const addProjectInitialQuery = (environmentId: EnvironmentId | null): string => {
    const environment = registry
      .get(environmentsAtom)
      .find((candidate) => candidate.environmentId === environmentId);
    const baseDirectory =
      environment?.serverConfig?.settings?.addProjectBaseDirectory?.trim() ?? "";
    return baseDirectory.length === 0 ? "~/" : ensureBrowseDirectoryPath(baseDirectory);
  };

  const startAddProjectSourceSelection = (environmentId: EnvironmentId) => {
    const derived = registry.get(derivedAtom);
    if (derived === null) return;
    const environment = derived.addProject.environments.find(
      (candidate) => candidate.environmentId === environmentId,
    );
    if (!canCreateProjectInEnvironment(environment?.connection.phase)) {
      showStackedError({
        title: "Environment unavailable",
        description: `${environment?.label ?? "The selected environment"} is not connected.`,
      });
      return;
    }
    const discovery =
      derived.addProject.browseEnvironmentId === environmentId
        ? derived.addProject.discovery
        : null;
    update((current) => ({
      ...current,
      addProjectEnvironmentId: environmentId,
      cloneFlow: null,
    }));
    pushView({
      addonIcon: { kind: "glyph", glyph: "folder-plus" },
      groups: buildAddProjectSourceGroups({
        environmentId,
        readiness: buildAddProjectRemoteSourceReadiness(discovery),
        canCreateNewProject: (environment?.serverConfig?.newProjectsRoot ?? null) !== null,
      }),
      initialQuery: null,
    });
  };

  const openAddProjectFlow = () => {
    const derived = registry.get(derivedAtom);
    if (derived === null) return;
    const { options, defaultEnvironmentId } = derived.addProject;
    if (options.length === 0) {
      close();
      runOrToast(async () => context.navigate({ kind: "settings", section: "connections" }));
      return;
    }
    if (options.length > 1 || defaultEnvironmentId === null) {
      pushView({
        addonIcon: { kind: "glyph", glyph: "folder-plus" },
        groups: buildAddProjectEnvironmentGroups(options),
        initialQuery: null,
      });
      return;
    }
    startAddProjectSourceSelection(defaultEnvironmentId);
  };

  const startAddProjectBrowse = (environmentId: EnvironmentId) => {
    const initialQuery = addProjectInitialQuery(environmentId);
    update((current) => ({
      ...current,
      addProjectEnvironmentId: environmentId,
      cloneFlow: null,
    }));
    pushView({
      addonIcon: { kind: "glyph", glyph: "folder-plus" },
      groups: [],
      initialQuery,
    });
  };

  const startNewProject = (
    environmentId: EnvironmentId,
    sourcesEnvironmentId: EnvironmentId | null,
  ) => {
    update((current) => ({
      ...current,
      addProjectEnvironmentId: environmentId,
      cloneFlow: null,
      newProjectFlow: { environmentId, sourcesEnvironmentId },
      newProjectPublishesToGitHub: false,
    }));
    pushView({
      addonIcon: { kind: "glyph", glyph: "folder-git" },
      groups: [],
      initialQuery: null,
    });
  };

  const addProjectAt = async (environmentId: EnvironmentId, rawCwd: string) => {
    const derived = registry.get(derivedAtom);
    if (derived === null) return;
    const added = await addProjectFromPath(
      {
        environments: derived.addProject.environments,
        projects: registry.get(state.environmentProjects.projectsAtom),
        threads: registry.get(state.environmentThreadShells.threadShellsAtom),
        threadSortOrder: registry.get(context.clientSettingsAtom).sidebarThreadSortOrder,
        createProject: (target) =>
          runAtomCommand(registry, state.projectEnvironment.create, target, {
            reportFailure: false,
          }),
        navigateToThread: async (threadRef) => context.navigateToThread(threadRef),
        openNewThread: (projectRef) => context.openNewThread(projectRef),
        showError: showStackedError,
      },
      {
        environmentId,
        rawCwd,
        platform: derived.addProject.browsePlatform,
        currentProjectCwd: derived.addProject.currentProjectCwdForBrowse,
      },
    );
    if (added) close();
  };

  const submitClone = async (destinationPathInput?: string) => {
    const derived = registry.get(derivedAtom);
    const palette = registry.get(stateAtom);
    const flow = palette.cloneFlow;
    if (derived === null || flow === null) return;
    const environment = derived.addProject.browseEnvironment;
    const next = await submitAddProjectClone(
      {
        lookupRepository: (target) =>
          executeAtomQuery(registry, state.sourceControlEnvironment.repository(target), {
            reportFailure: false,
          }),
        cloneRepository: (target) =>
          runAtomCommand(registry, state.sourceControlEnvironment.cloneRepository, target, {
            reportFailure: false,
          }),
        startProjectClone: (target) =>
          runAtomCommand(registry, state.sourceControlEnvironment.startProjectClone, target, {
            reportFailure: false,
          }),
        addProject: (cwd) => addProjectAt(flow.environmentId, cwd),
        waitForProject: (ref) => waitForProject(ref, 3_000),
        openNewThread: (ref) => context.openNewThread(ref),
        newProjectId,
        showError: showStackedError,
        close,
        startLookup: () => {
          update((current) => ({ ...current, isRemoteProjectLookingUp: true }));
          cloneLookupGeneration += 1;
          return cloneLookupGeneration;
        },
        isCurrentLookup: (generation) => generation === cloneLookupGeneration,
        finishLookup: () =>
          update((current) => ({
            ...current,
            isRemoteProjectLookingUp: false,
          })),
        setCloning: (cloning) =>
          update((current) => ({
            ...current,
            isRemoteProjectCloning: cloning,
          })),
      },
      {
        flow,
        query: palette.query,
        destinationPathInput,
        environment: {
          connected: canCreateProjectInEnvironment(environment?.connection.phase),
          label: environment?.label ?? null,
        },
        isLookingUp: palette.isRemoteProjectLookingUp,
        isCloning: palette.isRemoteProjectCloning,
        defaultCloneParentPath: addProjectInitialQuery(flow.environmentId),
        platform: derived.addProject.browsePlatform,
        currentProjectCwd: derived.addProject.currentProjectCwdForBrowse,
        cloneTracking:
          environment?.serverConfig?.environment.capabilities.projectCloneTracking === true,
      },
    );
    if (next === null) return;
    update((current) => ({
      ...current,
      cloneFlow: next.flow,
      highlighted: null,
      query: next.query,
      queryRevision: current.queryRevision + 1,
    }));
  };

  const submitNewProject = async () => {
    const derived = registry.get(derivedAtom);
    const flow = registry.get(stateAtom).newProjectFlow;
    if (
      derived === null ||
      flow === null ||
      !derived.model.canSubmitNewProject ||
      newProjectSubmitting
    ) {
      return;
    }
    newProjectSubmitting = true;
    update((current) => ({ ...current, isCreatingNewProject: true }));
    try {
      const created = await createNewProject(
        {
          createNew: (target) =>
            runAtomCommand(registry, state.projectEnvironment.createNew, target, {
              reportFailure: false,
            }),
          publishRepository: (target) =>
            runAtomCommand(registry, state.sourceControlEnvironment.publishRepository, target, {
              reportFailure: false,
            }),
          waitForProject: (ref) => waitForProject(ref),
          openNewThread: (ref) => context.openNewThread(ref),
          showToast: (toast) => context.addToast({ layout: "stacked", ...toast }),
        },
        {
          environmentId: flow.environmentId,
          name: derived.model.newProjectName,
          github: registry.get(stateAtom).newProjectPublishesToGitHub
            ? derived.addProject.newProjectGitHubTarget
            : null,
        },
      );
      if (created) close();
    } finally {
      newProjectSubmitting = false;
      update((current) => ({ ...current, isCreatingNewProject: false }));
    }
  };

  const submitBrowsePath = async () => {
    const derived = registry.get(derivedAtom);
    if (derived === null) return;
    if (derived.model.isCloneDestinationStep) {
      await submitClone(derived.addProjectPath);
      return;
    }
    const environmentId = derived.addProject.browseEnvironmentId;
    if (environmentId === null) return;
    await addProjectAt(environmentId, derived.addProjectPath);
  };

  const restartAgentSession = async (environmentId: EnvironmentId, threadId: string) => {
    const thread = registry.get(context.threadInputAtom)?.thread ?? null;
    if (thread === null || thread.environmentId !== environmentId || thread.id !== threadId) {
      return;
    }
    if (thread.session && thread.session.status !== "stopped") {
      const stopped = await runAtomCommand(
        registry,
        state.threadEnvironment.stopSession,
        { environmentId, input: { threadId: thread.id } },
        { reportFailure: false },
      );
      if (stopped._tag === "Failure") throw squashAtomCommandFailure(stopped);
    }
    context.addToast({
      layout: "plain",
      type: "success",
      title: "Agent session will restart",
      description: "Your next message starts a fresh session.",
    });
    const project = registry
      .get(state.environmentProjects.projectsAtom)
      .find(
        (candidate) =>
          candidate.environmentId === environmentId && candidate.id === thread.projectId,
      );
    if (project === undefined) return;
    const refreshed = await runAtomCommand(
      registry,
      state.serverEnvironment.refreshProviders,
      {
        environmentId,
        input: {
          instanceId: thread.session?.providerInstanceId ?? thread.modelSelection.instanceId,
          cwd: thread.worktreePath ?? project.workspaceRoot,
          fresh: true,
        },
      },
      { reportFailure: false },
    );
    if (refreshed._tag === "Failure") throw squashAtomCommandFailure(refreshed);
  };

  const runCommand = async (command: CommandPaletteCommand, snapshot: Derived): Promise<void> => {
    switch (command.kind) {
      case "navigate-thread":
        context.navigateToThread(scopeThreadRef(command.environmentId, command.threadId));
        return;
      case "set-appearance":
        if (!themeStore.setAppearanceMode(command.mode)) notifyThemeSaveFailure();
        return;
      case "set-theme":
        if (!themeStore.setTheme(command.theme)) notifyThemeSaveFailure();
        return;
      case "set-theme-half":
        if (!themeStore.setThemeHalf(command.mode, command.themeId)) notifyThemeSaveFailure();
        return;
      case "open-settings":
        context.navigate({ kind: "settings", section: "general" });
        return;
      case "open-setting":
        context.navigate({
          kind: "settings",
          section: settingsSection(command.to),
        });
        return;
      case "open-source-control-settings":
        context.navigate({ kind: "settings", section: "source-control" });
        return;
      case "open-usage":
        context.navigate({ kind: "usage" });
        return;
      case "open-pull-requests":
        context.navigate({ kind: "pull-requests" });
        return;
      case "open-project-settings":
        context.navigate({ kind: "project", projectKey: command.projectKey });
        return;
      case "browse":
        setQuery(command.nextQuery);
        return;
      case "restart-agent-session":
        await restartAgentSession(command.environmentId, command.threadId);
        return;
      case "new-thread":
        await context.openNewThread(command.projectRef);
        return;
      case "new-thread-from-context": {
        const projectRef = snapshot.resolveContext.contextualProjectRef;
        if (projectRef !== null) await context.openNewThread(projectRef);
        return;
      }
      case "new-thread-without-project":
        await startScratchThread(command.environmentId);
        return;
      case "copy-thread-reference": {
        const target = snapshot.copyTarget;
        if (target === null) return;
        try {
          await clipboardService(context).writeText(target.value);
          context.addToast({
            layout: "plain",
            type: "success",
            title: target.successTitle,
            description: target.value,
          });
        } catch (error) {
          context.addToast({
            layout: "stacked",
            type: "error",
            title: target.failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      case "link-pull-request":
      case "open-thread-pull-requests":
        return unavailable("Linked pull requests");
      case "open-overlay":
        return unavailable(command.mode === "files" ? "Go to file" : "Project content search");
      case "toggle-theme-editor":
        themeEditorStore(context).toggle();
        return;
      case "start-new-project": {
        const first = snapshot.addProject.newProjectOptions[0];
        if (first) startNewProject(first.environmentId, null);
        return;
      }
      case "start-new-project-in":
        startNewProject(command.environmentId, command.sourcesEnvironmentId);
        return;
      case "switch-new-project-environment":
        update((current) => ({
          ...current,
          newProjectFlow:
            current.newProjectFlow === null
              ? null
              : {
                  ...current.newProjectFlow,
                  environmentId: command.environmentId,
                },
          addProjectEnvironmentId: command.environmentId,
        }));
        return;
      case "toggle-new-project-github":
        update((current) => ({
          ...current,
          newProjectPublishesToGitHub: !current.newProjectPublishesToGitHub,
        }));
        return;
      case "start-add-project":
        openAddProjectFlow();
        return;
      case "browse-add-project":
        startAddProjectBrowse(command.environmentId);
        return;
      case "select-add-project-environment":
        startAddProjectSourceSelection(command.environmentId);
        return;
      case "start-clone":
        update((current) => ({
          ...current,
          addProjectEnvironmentId: command.environmentId,
          cloneFlow: {
            step: "repository",
            environmentId: command.environmentId,
            source: command.source,
          },
        }));
        pushView({
          addonIcon: {
            kind: "glyph",
            glyph: remoteProjectSourceGlyph(command.source),
          },
          groups: [],
          initialQuery: null,
        });
        return;
      case "show-existing-project-sources": {
        const sourcesEnvironmentId =
          registry.get(stateAtom).newProjectFlow?.sourcesEnvironmentId ?? null;
        if (sourcesEnvironmentId === command.environmentId) {
          popView();
          return;
        }
        if (sourcesEnvironmentId !== null) {
          update((current) => ({
            ...current,
            viewStack: current.viewStack.slice(0, -1),
          }));
        }
        popView();
        startAddProjectSourceSelection(command.environmentId);
        return;
      }
    }
  };

  const activate = (value: string) => {
    const derived = registry.get(derivedAtom);
    if (derived === null) return;
    const row = derived.rows.find((candidate) => candidate.value === value);
    if (row === undefined) return;
    const resolution = resolveCommandPaletteItem(row, derived.resolveContext);
    if (resolution.kind === "ignore") return;
    if (resolution.kind === "open-view") {
      pushView(resolution.view);
      return;
    }
    if (!resolution.keepOpen) close();
    void runCommand(resolution.command, derived).catch((error: unknown) => {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: "Unable to run command",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  };

  const open = (request: CommandPaletteOpenRequest) => {
    openFresh(request.query ?? "");
    if (request.open === "change-theme") pushView(buildChangeThemeView());
    if (request.open === "new-thread-in") {
      const derived = registry.get(derivedAtom);
      if (derived !== null && derived.newThreadInEntries.length > 0) {
        pushView(
          buildNewThreadInView({
            entries: derived.newThreadInEntries,
            currentProjectRef: derived.currentProjectRef,
          }),
        );
      }
    }
    if (request.open === "add-project") openAddProjectFlow();
  };

  const runShortcut = async (command: string) => {
    const palette = registry.get(stateAtom);
    switch (command) {
      case "commandPalette.toggle":
        if (palette.open) close();
        else openFresh("");
        return;
      case "filePicker.toggle":
        notAvailableToast("Go to file");
        return;
      case "projectSearch.toggle":
        notAvailableToast("Project content search");
        return;
      case "themeEditor.toggle":
        themeEditorStore(context).toggle();
        return;
      case "theme.select":
        open({ open: "change-theme" });
        return;
      case "usage.open":
        close();
        runOrToast(async () => context.navigate({ kind: "usage" }));
        return;
      case "appearance.cycle": {
        const nextMode = nextAppearanceMode(registry.get(themeStore.snapshotAtom).appearanceMode);
        if (!themeStore.setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
          return;
        }
        context.addToast({
          layout: "plain",
          type: "info",
          id: "appearance-cycle",
          title: `Appearance: ${appearanceModeLabel(nextMode)}`,
          timeout: 1500,
        });
        return;
      }
    }
    if (!palette.open) return;
    const derived = registry.get(derivedAtom);
    if (derived === null) return;
    if (threadJumpIndexFromCommand(command) !== null) {
      const row = derived.rows.find((candidate) => candidate.shortcutCommand === command);
      if (row !== undefined) activate(row.value);
      return;
    }
    if (command === "thread.copyReference") {
      if (derived.copyTarget === null) return;
      close();
      runOrToast(() => runCommand({ kind: "copy-thread-reference" }, derived));
    }
  };

  return {
    open,
    feature: {
      views: {
        commandPalette: viewAtom,
        commandPaletteBinding: bindingAtom,
      },
      actions: {
        commandPaletteOpen: async (params) => {
          open(OpenParams(params ?? {}));
          return null;
        },
        commandPaletteToggle: async () => {
          if (registry.get(stateAtom).open) close();
          else openFresh("");
          return null;
        },
        commandPaletteClose: async () => {
          close();
          return null;
        },
        commandPaletteSetQuery: async (params) => {
          const { query } = QueryParams(params);
          const current = registry.get(stateAtom);
          if (!current.open || query === current.query) return null;
          update((palette) => ({ ...palette, query, highlighted: null }));
          if (query === "" && current.viewStack.at(-1)?.initialQuery) popView();
          return null;
        },
        commandPaletteMove: async (params) => {
          const { delta } = MoveParams(params);
          const derived = registry.get(derivedAtom);
          if (derived === null) return null;
          const navigable = derived.rows.filter((row) => !row.disabled);
          if (navigable.length === 0) return null;
          const index = navigable.findIndex((row) => row.value === derived.highlighted);
          const next =
            index === -1
              ? delta > 0
                ? 0
                : navigable.length - 1
              : (index + delta + navigable.length) % navigable.length;
          const value = navigable[next]?.value ?? null;
          update((palette) => ({ ...palette, highlighted: value }));
          return null;
        },
        commandPaletteHighlight: async (params) => {
          const { value } = HighlightParams(params);
          update((palette) => ({ ...palette, highlighted: value }));
          return null;
        },
        commandPaletteActivate: async (params) => {
          const { value, modifier } = ActivateParams(params ?? {});
          const derived = registry.get(derivedAtom);
          if (derived === null) return null;
          if (value !== undefined) {
            activate(value);
            return null;
          }
          const palette = registry.get(stateAtom);
          if (palette.cloneFlow?.step === "repository") {
            await submitClone();
            return null;
          }
          if (palette.newProjectFlow !== null && derived.highlighted === null) {
            await submitNewProject();
            return null;
          }
          if (
            derived.model.canSubmitBrowsePath &&
            (!derived.model.hasHighlightedBrowseItem || modifier === true)
          ) {
            await submitBrowsePath();
            return null;
          }
          if (derived.highlighted !== null) activate(derived.highlighted);
          return null;
        },
        commandPaletteSubmit: async () => {
          const derived = registry.get(derivedAtom);
          const submit = derived?.model.submit ?? null;
          if (derived === null || submit === null || submit.disabled) return null;
          switch (submit.action) {
            case "create-project":
              await submitNewProject();
              return null;
            case "lookup-repository":
              await submitClone();
              return null;
            case "add-path":
              if (derived.addProject.relativePathNeedsActiveProject) return null;
              await submitBrowsePath();
              return null;
          }
          return null;
        },
        commandPaletteOpenFileManager: async () => {
          if (registry.get(derivedAtom)?.addProject.canOpenFileManager !== true) return null;
          close();
          addProjectService(context).browse();
          return null;
        },
        commandPaletteOpenSourceControlSettings: async () => {
          close();
          runOrToast(async () => context.navigate({ kind: "settings", section: "source-control" }));
          return null;
        },
        commandPaletteShortcut: async (params) => {
          await runShortcut(ShortcutParams(params).command);
          return null;
        },
        commandPaletteBack: async () => {
          const palette = registry.get(stateAtom);
          const derived = registry.get(derivedAtom);
          if (derived !== null && palette.query === "" && derived.model.isSubmenu) popView();
          return null;
        },
      },
    },
  };
}

export function commandPaletteFeature(context: FeatureContext): CoreFeature {
  return commandPaletteService(context).feature;
}
