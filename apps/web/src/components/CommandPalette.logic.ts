import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  addProjectRemoteSourceLabel,
  addProjectRemoteSourcePathHint,
  canCreateProjectInEnvironment,
  getCloneDestinationBrowsePath,
  getCloneDestinationPath,
  getNewProjectGitHubRepository,
  getNewProjectPathPreview,
  type AddProjectCloneFlow,
  type AddProjectRemoteProviderKind,
  type AddProjectRemoteSource,
  type AddProjectRemoteSourceReadiness,
} from "@t3tools/client-runtime/operations/projects";
import { filterFilesystemBrowseEntries } from "@t3tools/client-runtime/state/filesystem";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  threadSearchMatchKey,
  type EnvironmentThreadSearchMatch,
} from "@t3tools/client-runtime/state/thread-search";
import {
  threadPullRequestSearchTerms,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import type { ThreadReferenceCopyTarget } from "@t3tools/shared/threadReference";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import {
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ExecutionEnvironmentCapabilities,
  type FilesystemBrowseEntry,
  type KeybindingCommand,
  type ProjectId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
  type ScopedProjectRef,
  type SourceControlDiscoveryResult,
  type ThreadId,
  type ThreadPullRequestLink,
} from "@t3tools/contracts";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type { ReactNode } from "react";
import type { CommandPaletteLinkedThreads } from "../commandPaletteBus";
import { shortcutLabelForCommand } from "../keybindings";
import {
  appendBrowsePathSegment,
  getBrowseDirectoryPath,
  hasTrailingPathSeparator,
} from "../lib/projectPaths";
import { getThreadSortTimestamp, sortThreads } from "../lib/threadSort";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "../lib/utils";
import {
  getThemeDefinition,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemeHalves,
  type ThemePreference,
  type ThemePreferenceMode,
} from "../themePalette";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { Project, SidebarThreadSummary } from "../types";
import { resolveEnvironmentOptionLabel } from "./BranchToolbar.logic";
import {
  SETTINGS_SECTION_LABELS,
  searchSettings,
  type SettingsPath,
  type SettingsSearchItem,
  type SettingsSearchPlatform,
} from "./settings/settingsSearch";
import {
  STANDARD_THEME_CARDS,
  getThemeCardDefinition,
  type ThemeCardPreview,
} from "./settings/ThemePreviewCircles.logic";

export const RECENT_THREAD_LIMIT = 12;
export const NEW_PROJECT_GITHUB_TOGGLE_VALUE = "new-project:github";

/**
 * The global search overlay hosts three mutually exclusive surfaces: the
 * command palette (⌘K), the project file picker (⌘P), and project content
 * search (⇧⌘F). One reducer owns open/mode state so the surfaces can never
 * stack and re-triggering a mode's shortcut toggles it closed.
 */
export type SearchOverlayMode = "command" | "files" | "content";

export type CommandPaletteOpenIntent =
  | { readonly kind: "add-project" | "new-thread-in" | "change-theme" }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly linkedThreads?: CommandPaletteLinkedThreads;
    };

export type CommandPaletteUiState = {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
};

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | {
      readonly _tag: "OpenSearch";
      readonly query: string;
      readonly linkedThreads?: CommandPaletteLinkedThreads;
    }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "OpenChangeTheme" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return action.open
        ? { open: true, mode: "command", openIntent: state.openIntent }
        : { ...state, open: false, openIntent: null };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { ...state, open: false, openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenSearch":
      return {
        open: true,
        mode: "command",
        openIntent: {
          kind: "search",
          query: action.query,
          ...(action.linkedThreads ? { linkedThreads: action.linkedThreads } : {}),
        },
      };
    case "OpenAddProject":
      return { open: true, mode: "command", openIntent: { kind: "add-project" } };
    case "OpenNewThreadIn":
      return { open: true, mode: "command", openIntent: { kind: "new-thread-in" } };
    case "OpenChangeTheme":
      return { open: true, mode: "command", openIntent: { kind: "change-theme" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export type CommandPaletteThreadContentMatch = {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
};

export type CommandPaletteItem = {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  readonly searchRecency?: number;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly titleLeadingContent?: ReactNode;
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
  readonly secondary?: boolean;
};

export type CommandPaletteActionItem = CommandPaletteItem & {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
};

export type CommandPaletteSubmenuItem = CommandPaletteItem & {
  readonly kind: "submenu";
};

export type CommandPaletteGroupOf<TItem> = {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<TItem>;
};

export type CommandPaletteGroup = CommandPaletteGroupOf<
  CommandPaletteActionItem | CommandPaletteSubmenuItem
>;

export type CommandPaletteSearchable = {
  readonly searchTerms: ReadonlyArray<string>;
  readonly searchRecency?: number;
  readonly secondary?: boolean;
};

export type CommandPaletteGlyph =
  | "square-pen"
  | "message-square"
  | "message-square-dashed"
  | "link"
  | "pull-request"
  | "pull-request-link"
  | "rotate-ccw"
  | "file-search"
  | "text-search"
  | "folder-git"
  | "folder-plus"
  | "folder"
  | "palette"
  | "monitor"
  | "sun"
  | "moon"
  | "chart"
  | "settings"
  | "corner-left-up"
  | AddProjectRemoteProviderKind;

export type CommandPaletteProjectIcon = Pick<
  Project,
  "environmentId" | "id" | "title" | "workspaceRoot" | "faviconPath" | "projectIcon"
>;

export type CommandPaletteIcon =
  | { readonly kind: "glyph"; readonly glyph: CommandPaletteGlyph }
  | { readonly kind: "project"; readonly project: CommandPaletteProjectIcon }
  | { readonly kind: "machine"; readonly machine: EnvironmentMachineKind };

export type CommandPaletteEnvironmentLocation = {
  readonly kind: "local" | "remote";
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
};

export type CommandPaletteThreadSubtitle = {
  readonly kind: "thread";
  readonly project: CommandPaletteProjectIcon | null;
  readonly projectTitle: string | null;
  readonly environmentLabel: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly isCurrent: boolean;
  readonly driverKind: ProviderDriverKind | null;
  readonly providerDisplayName: string;
};

export type CommandPaletteSubtitle =
  | CommandPaletteThreadSubtitle
  | {
      readonly kind: "location";
      readonly location: CommandPaletteEnvironmentLocation;
      readonly workspaceRoot: string;
    }
  | { readonly kind: "environment-labels"; readonly labels: ReadonlyArray<string> };

export type CommandPaletteAccessory =
  | { readonly kind: "current" }
  | {
      readonly kind: "theme-previews";
      readonly current: boolean;
      readonly previews: ReadonlyArray<ThemeCardPreview>;
    }
  | { readonly kind: "setup-required"; readonly hint: string }
  | { readonly kind: "selected" }
  | { readonly kind: "chevron" }
  | { readonly kind: "checkbox"; readonly checked: boolean };

export type CommandPaletteThreadRef = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
};

export type CommandPaletteDirectCommand =
  | {
      readonly kind: "navigate-thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | { readonly kind: "new-thread-without-project"; readonly environmentId: EnvironmentId }
  | { readonly kind: "new-thread-from-context" }
  | { readonly kind: "copy-thread-reference" }
  | {
      readonly kind: "link-pull-request";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | {
      readonly kind: "open-thread-pull-requests";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | {
      readonly kind: "restart-agent-session";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | { readonly kind: "open-overlay"; readonly mode: "files" | "content" }
  | { readonly kind: "start-new-project" }
  | { readonly kind: "start-add-project" }
  | { readonly kind: "browse-add-project"; readonly environmentId: EnvironmentId }
  | { readonly kind: "set-appearance"; readonly mode: ThemePreferenceMode }
  | { readonly kind: "toggle-theme-editor" }
  | { readonly kind: "open-pull-requests" }
  | { readonly kind: "open-usage" }
  | { readonly kind: "open-settings" }
  | { readonly kind: "open-project-settings"; readonly projectKey: string }
  | { readonly kind: "open-source-control-settings" }
  | { readonly kind: "select-add-project-environment"; readonly environmentId: EnvironmentId }
  | {
      readonly kind: "start-new-project-in";
      readonly environmentId: EnvironmentId;
      readonly sourcesEnvironmentId: EnvironmentId | null;
    }
  | {
      readonly kind: "start-clone";
      readonly environmentId: EnvironmentId;
      readonly source: AddProjectRemoteSource;
    }
  | { readonly kind: "switch-new-project-environment"; readonly environmentId: EnvironmentId }
  | { readonly kind: "show-existing-project-sources"; readonly environmentId: EnvironmentId }
  | { readonly kind: "toggle-new-project-github" };

export type CommandPaletteIntent =
  | CommandPaletteDirectCommand
  | {
      readonly kind: "open-project";
      readonly projectRef: ScopedProjectRef;
      readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
    }
  | {
      readonly kind: "new-thread-in-project";
      readonly projectRef: ScopedProjectRef;
      readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
    }
  | {
      readonly kind: "select-theme";
      readonly themeId: string | null;
      readonly singleMode: ThemeAppearance | null;
    }
  | { readonly kind: "open-setting-section"; readonly to: SettingsPath; readonly hash: string }
  | { readonly kind: "browse-up" }
  | { readonly kind: "browse-to"; readonly name: string };

export type CommandPaletteCommand =
  | CommandPaletteDirectCommand
  | { readonly kind: "new-thread"; readonly projectRef: ScopedProjectRef }
  | { readonly kind: "set-theme"; readonly theme: ThemePreference }
  | { readonly kind: "set-theme-half"; readonly mode: ThemeAppearance; readonly themeId: string }
  | {
      readonly kind: "open-setting";
      readonly to: SettingsPath;
      readonly hash: string;
      readonly replace: boolean;
    }
  | { readonly kind: "browse"; readonly nextQuery: string; readonly prefetchPath: string };

export type CommandPaletteEntryBase = {
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: string;
  readonly titleEmphasis?: string;
  readonly description?: string;
  readonly subtitle?: CommandPaletteSubtitle;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  readonly searchRecency?: number;
  readonly icon: CommandPaletteIcon;
  readonly disabled?: boolean;
  readonly thread?: CommandPaletteThreadRef;
  readonly accessory?: CommandPaletteAccessory;
  readonly shortcutCommand?: KeybindingCommand;
  readonly secondary?: boolean;
};

export type CommandPaletteActionEntry = CommandPaletteEntryBase & {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly intent: CommandPaletteIntent;
};

export type CommandPaletteSubmenuEntry = CommandPaletteEntryBase & {
  readonly kind: "submenu";
  readonly view: CommandPaletteView;
};

export type CommandPaletteEntry = CommandPaletteActionEntry | CommandPaletteSubmenuEntry;

export type CommandPaletteEntryGroup = CommandPaletteGroupOf<CommandPaletteEntry>;

export type CommandPaletteView = {
  readonly addonIcon: CommandPaletteIcon;
  readonly groups: ReadonlyArray<CommandPaletteEntryGroup>;
  readonly initialQuery: string | null;
};

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export type CommandPaletteProject = Project & { readonly displayName: string };

export type CommandPaletteProjectPickerEntry = {
  readonly group: {
    readonly displayName: string;
    readonly memberProjects: ReadonlyArray<
      Pick<Project, "environmentId" | "title" | "workspaceRoot">
    >;
    readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
  };
  readonly targetProject: Project;
};

export type CommandPaletteProviderEntry = {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
};

export type CommandPaletteThreadInput = Pick<
  SidebarThreadSummary,
  | "archivedAt"
  | "branch"
  | "createdAt"
  | "environmentId"
  | "id"
  | "modelSelection"
  | "projectId"
  | "session"
  | "title"
  | "worktreePath"
> & {
  readonly pullRequests?: SidebarThreadSummary["pullRequests"];
  readonly updatedAt: string;
  readonly latestUserMessageAt?: string | null;
};

export type CommandPaletteThreadEntriesInput = {
  readonly threads: ReadonlyArray<CommandPaletteThreadInput>;
  readonly activeThreadId?: ThreadId;
  readonly projectTitleById: ReadonlyMap<ProjectId, string>;
  readonly sortOrder: SidebarThreadSortOrder;
  readonly projectByKey?: ReadonlyMap<string, CommandPaletteProjectIcon>;
  readonly locationByEnvironmentId?: ReadonlyMap<EnvironmentId, { readonly label: string }>;
  readonly providerByKey?: ReadonlyMap<string, CommandPaletteProviderEntry>;
  readonly contentMatchByKey?: ReadonlyMap<string, CommandPaletteThreadContentMatch>;
  readonly limit?: number;
};

export type CommandPaletteProjectMetadata = {
  readonly searchTerms: ReadonlyArray<string>;
  readonly environmentLabels: ReadonlyArray<string>;
};

export type CommandPaletteThemeCard = {
  readonly id: string | null;
  readonly label: string;
  readonly previews: ReadonlyArray<ThemeCardPreview>;
};

export type CommandPaletteThemeGroupsInput = {
  readonly cards: ReadonlyArray<CommandPaletteThemeCard>;
  readonly theme: ThemePreference;
  readonly themeHalves: ThemeHalves | null;
  readonly resolvedTheme: ThemeAppearance;
};

export type CommandPaletteActiveThread = {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly capabilities: Pick<
    ExecutionEnvironmentCapabilities,
    "threadPullRequests" | "threadPullRequestLinking"
  > | null;
};

export type CommandPaletteActionsInput = {
  readonly hasProjects: boolean;
  readonly activeProjectTitle: string | null;
  readonly newThreadInEntries: ReadonlyArray<CommandPaletteActionEntry>;
  readonly scratchTargetEnvironmentId: EnvironmentId | null;
  readonly copyThreadReferenceTarget: Pick<ThreadReferenceCopyTarget, "kind" | "value"> | null;
  readonly activeThread: CommandPaletteActiveThread | null;
  readonly canCreateNewProject: boolean;
  readonly wslFolderEnvironment: AddProjectEnvironmentOption | null;
  readonly themeGroups: ReadonlyArray<CommandPaletteEntryGroup>;
  readonly appearanceMode: ThemePreferenceMode;
  readonly pullRequestsAvailable: boolean;
  readonly projectSettingsTarget: {
    readonly projectKey: string;
    readonly displayName: string;
  } | null;
};

export type CommandPaletteEnvironmentSummary = {
  readonly environmentId: EnvironmentId;
  readonly runtimeLabel: string;
  readonly isPrimary: boolean;
  readonly machine: EnvironmentMachineKind;
  readonly connection: EnvironmentConnectionPresentation;
};

export type AddProjectEnvironmentOption = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
  readonly isPrimary: boolean;
  readonly isConnected: boolean;
  readonly status: string;
};

export type CommandPaletteAddProjectSourcesInput = {
  readonly environmentId: EnvironmentId;
  readonly readiness: AddProjectRemoteSourceReadiness;
  readonly canCreateNewProject: boolean;
};

export type CommandPaletteBrowseInput = {
  readonly isBrowsing: boolean;
  readonly entries: ReadonlyArray<FilesystemBrowseEntry>;
  readonly canBrowseUp: boolean;
  readonly relativePathNeedsActiveProject: boolean;
  readonly isPending: boolean;
  readonly hasResult: boolean;
  readonly hasExactEntry: boolean;
};

export type CommandPaletteNewProjectInput = {
  readonly environmentId: EnvironmentId;
  readonly root: string | null;
  readonly githubTarget: { readonly account: string | null } | null;
  readonly publishesToGitHub: boolean;
  readonly isCreating: boolean;
  readonly machineOptions: ReadonlyArray<AddProjectEnvironmentOption>;
  readonly environmentLabelFallback: string | null;
};

export type CommandPaletteLinkedThreadSearch = {
  readonly query: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
};

export type CommandPaletteModelInput = {
  readonly query: string;
  readonly deferredQuery: string;
  readonly platform: string;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly currentView: CommandPaletteView | null;
  readonly highlightedItemValue: string | null;
  readonly actionEntries: ReadonlyArray<CommandPaletteEntry>;
  readonly threadEntries: ReadonlyArray<CommandPaletteActionEntry>;
  readonly linkedThreadSearch: CommandPaletteLinkedThreadSearch | null;
  readonly projectSearchEntries: ReadonlyArray<CommandPaletteActionEntry>;
  readonly availableSettingsSearchItems: ReadonlyArray<SettingsSearchItem>;
  readonly settingsSearchPlatform: SettingsSearchPlatform;
  readonly addProjectSources: CommandPaletteAddProjectSourcesInput | null;
  readonly threadSearchPending: boolean;
  readonly environmentConnected: boolean;
  readonly browse: CommandPaletteBrowseInput;
  readonly cloneFlow: AddProjectCloneFlow | null;
  readonly remoteProjectPending: boolean;
  readonly newProject: CommandPaletteNewProjectInput | null;
};

export type CommandPaletteRow = CommandPaletteEntry & { readonly shortcutLabel: string | null };

export type CommandPaletteRowGroup = CommandPaletteGroupOf<CommandPaletteRow>;

export type CommandPaletteSubmit = {
  readonly action: "create-project" | "lookup-repository" | "add-path";
  readonly label: string;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly shortcutLabel: string;
  readonly disabled: boolean;
};

export type CommandPaletteNewProjectHeader = {
  readonly title: string;
  readonly detail: string;
};

export type CommandPaletteRepositoryHeader = {
  readonly title: string;
  readonly description: string;
  readonly icon: CommandPaletteIcon;
};

export type CommandPaletteModel = {
  readonly mode: CommandPaletteMode;
  readonly isSubmenu: boolean;
  readonly isActionsOnly: boolean;
  readonly autoHighlight: boolean;
  readonly inputPlaceholder: string;
  readonly groups: ReadonlyArray<CommandPaletteRowGroup>;
  readonly emptyStateMessage: string;
  readonly newProjectHeader: CommandPaletteNewProjectHeader | null;
  readonly repositoryHeader: CommandPaletteRepositoryHeader | null;
  readonly footerActionLabel: string | null;
  readonly submit: CommandPaletteSubmit | null;
  readonly canSubmitBrowsePath: boolean;
  readonly willCreateProjectPath: boolean;
  readonly hasHighlightedBrowseItem: boolean;
  readonly isCloneDestinationStep: boolean;
  readonly canSubmitNewProject: boolean;
  readonly newProjectName: string;
};

export type CommandPaletteResolveContext = {
  readonly threads: ReadonlyArray<
    Pick<SidebarThreadSummary, "archivedAt" | "environmentId" | "id" | "projectId"> & {
      readonly createdAt: string;
      readonly updatedAt: string;
      readonly latestUserMessageAt?: string | null;
    }
  >;
  readonly sidebarThreadSortOrder: SidebarThreadSortOrder;
  readonly contextualProjectRef: ScopedProjectRef | null;
  readonly appearanceMode: ThemePreferenceMode;
  readonly pathname: string;
  readonly browse: {
    readonly query: string;
    readonly directoryPath: string;
    readonly parentPath: string | null;
    readonly pinnedCloneDirectoryName: string;
    readonly platform: string;
  };
};

export type CommandPaletteResolution =
  | { readonly kind: "ignore" }
  | { readonly kind: "open-view"; readonly view: CommandPaletteView }
  | { readonly kind: "run"; readonly keepOpen: boolean; readonly command: CommandPaletteCommand };

function glyph(name: CommandPaletteGlyph): CommandPaletteIcon {
  return { kind: "glyph", glyph: name };
}

function projectIconOf(project: CommandPaletteProjectIcon): CommandPaletteProjectIcon {
  return {
    environmentId: project.environmentId,
    id: project.id,
    title: project.title,
    workspaceRoot: project.workspaceRoot,
    ...(project.faviconPath !== undefined ? { faviconPath: project.faviconPath } : {}),
    ...(project.projectIcon !== undefined ? { projectIcon: project.projectIcon } : {}),
  };
}

const REMOTE_LOCATION: CommandPaletteEnvironmentLocation = {
  kind: "remote",
  label: "Remote",
  machine: "server",
};

const APPEARANCE_OPTIONS: ReadonlyArray<{
  readonly mode: ThemePreferenceMode;
  readonly label: string;
  readonly glyph: CommandPaletteGlyph;
}> = [
  { mode: "system", label: "System", glyph: "monitor" },
  { mode: "light", label: "Light", glyph: "sun" },
  { mode: "dark", label: "Dark", glyph: "moon" },
];

const REMOTE_PROJECT_PROVIDER_SOURCES: ReadonlyArray<AddProjectRemoteProviderKind> = [
  "github",
  "gitlab",
  "forgejo",
  "bitbucket",
  "azure-devops",
];

export function appearanceModeLabel(mode: ThemePreferenceMode): string {
  return APPEARANCE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

export function nextAppearanceMode(mode: ThemePreferenceMode): ThemePreferenceMode {
  return mode === "system" ? "light" : mode === "light" ? "dark" : "system";
}

export function remoteProjectSourceGlyph(source: AddProjectRemoteSource): CommandPaletteGlyph {
  return source === "url" ? "link" : source;
}

export function remoteProjectInputPlaceholder(flow: AddProjectCloneFlow | null): string | null {
  if (!flow) return null;
  if (flow.step === "confirm") return null;
  if (flow.source === "url") {
    return "Enter Git clone URL";
  }
  return `Enter ${addProjectRemoteSourceLabel(flow.source)} repository (${addProjectRemoteSourcePathHint(flow.source)})`;
}

export function sortAddProjectProviderSources(
  readinessBySource: AddProjectRemoteSourceReadiness,
): ReadonlyArray<AddProjectRemoteProviderKind> {
  return REMOTE_PROJECT_PROVIDER_SOURCES.toSorted((left, right) => {
    const leftReady = readinessBySource[left].ready;
    const rightReady = readinessBySource[right].ready;
    if (leftReady !== rightReady) {
      return leftReady ? -1 : 1;
    }
    return addProjectRemoteSourceLabel(left).localeCompare(addProjectRemoteSourceLabel(right));
  });
}

export function buildAddProjectRemoteSourceReadiness(
  discovery: SourceControlDiscoveryResult | null,
): AddProjectRemoteSourceReadiness {
  const unavailable = {
    ready: false,
    hint: "Provider status unavailable. Open Settings -> Source Control and rescan.",
  } as const;
  const readiness: AddProjectRemoteSourceReadiness = {
    url: { ready: true, hint: null },
    github: unavailable,
    gitlab: unavailable,
    forgejo: unavailable,
    bitbucket: unavailable,
    "azure-devops": unavailable,
  };

  if (!discovery) {
    return readiness;
  }

  const providerByKind = new Map(
    discovery.sourceControlProviders.map((provider) => [provider.kind, provider]),
  );

  for (const source of REMOTE_PROJECT_PROVIDER_SOURCES) {
    const provider = providerByKind.get(source);
    if (!provider) {
      readiness[source] = unavailable;
      continue;
    }
    if (provider.status !== "available") {
      readiness[source] = { ready: false, hint: provider.installHint };
      continue;
    }
    if (provider.auth.status === "unauthenticated") {
      readiness[source] = {
        ready: false,
        hint:
          Option.getOrNull(provider.auth.detail) ??
          `${provider.label} is not authenticated. Open Settings -> Source Control for setup guidance.`,
      };
      continue;
    }
    readiness[source] = { ready: true, hint: null };
  }

  return readiness;
}

export function buildAddProjectEnvironmentOptions(
  environments: ReadonlyArray<CommandPaletteEnvironmentSummary>,
): AddProjectEnvironmentOption[] {
  return environments
    .filter((environment) => canCreateProjectInEnvironment(environment.connection.phase))
    .map((environment): AddProjectEnvironmentOption => ({
      environmentId: environment.environmentId,
      label: resolveEnvironmentOptionLabel({
        isPrimary: environment.isPrimary,
        environmentId: environment.environmentId,
        runtimeLabel: environment.runtimeLabel,
      }),
      isPrimary: environment.isPrimary,
      machine: environment.machine,
      isConnected: canCreateProjectInEnvironment(environment.connection.phase),
      status: connectionStatusText(environment.connection),
    }))
    .toSorted((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });
}

export function buildThreadContentMatchByKey(
  matches: ReadonlyArray<EnvironmentThreadSearchMatch>,
  query: string,
): ReadonlyMap<string, CommandPaletteThreadContentMatch> {
  return new Map(
    matches.flatMap((match) =>
      match.source === "user" || match.source === "assistant"
        ? [
            [
              threadSearchMatchKey(match),
              { source: match.source, snippet: match.snippet, query },
            ] as const,
          ]
        : [],
    ),
  );
}

export function buildLinkedThreadEntries(
  input: CommandPaletteLinkedThreads & { readonly query: string },
): CommandPaletteActionEntry[] {
  return input.threads.map((thread) => ({
    kind: "action",
    value: `thread:${input.environmentId}:${thread.id}`,
    title: thread.title || "Untitled thread",
    description: thread.archivedAt === null ? "Linked thread" : "Archived thread",
    searchTerms: [input.query, thread.title],
    icon: glyph("message-square"),
    intent: { kind: "navigate-thread", environmentId: input.environmentId, threadId: thread.id },
  }));
}

export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionEntry>,
): CommandPaletteActionEntry[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand) return { ...item, shortcutCommand };

    const { shortcutCommand: _shortcutCommand, ...itemWithoutShortcut } = item;
    return itemWithoutShortcut;
  });
}

export function buildCommandPaletteProjectMetadata(input: {
  readonly projects: ReadonlyArray<Pick<Project, "environmentId" | "title" | "workspaceRoot">>;
  readonly locationByEnvironmentId: ReadonlyMap<EnvironmentId, { readonly label: string }>;
}): CommandPaletteProjectMetadata {
  const searchTerms: string[] = [];
  const environmentLabels = new Set<string>();

  for (const project of input.projects) {
    const label = input.locationByEnvironmentId.get(project.environmentId)?.label ?? "Remote";
    searchTerms.push(project.title, project.workspaceRoot, label);
    environmentLabels.add(label);
  }

  return { searchTerms, environmentLabels: [...environmentLabels] };
}

export function buildProjectSearchEntries(input: {
  readonly pickerEntries: ReadonlyArray<CommandPaletteProjectPickerEntry>;
  readonly locationByEnvironmentId: ReadonlyMap<EnvironmentId, CommandPaletteEnvironmentLocation>;
}): CommandPaletteActionEntry[] {
  return input.pickerEntries.map(({ group, targetProject: project }) => {
    const members = group.memberProjects;
    const metadata = buildCommandPaletteProjectMetadata({
      projects: members,
      locationByEnvironmentId: input.locationByEnvironmentId,
    });
    const location = input.locationByEnvironmentId.get(project.environmentId) ?? REMOTE_LOCATION;
    const grouped = members.length > 1;
    return {
      kind: "action",
      value: `project:${project.environmentId}:${project.id}`,
      searchTerms: [
        group.displayName,
        project.title,
        project.workspaceRoot,
        ...metadata.searchTerms,
      ],
      title: group.displayName,
      description: grouped
        ? metadata.environmentLabels.join(" · ")
        : `${location.label} · ${project.workspaceRoot}`,
      subtitle: grouped
        ? { kind: "environment-labels", labels: metadata.environmentLabels }
        : { kind: "location", location, workspaceRoot: project.workspaceRoot },
      icon: { kind: "project", project: projectIconOf(project) },
      intent: {
        kind: "open-project",
        projectRef: { environmentId: project.environmentId, projectId: project.id },
        memberProjectRefs: group.memberProjectRefs,
      },
    };
  });
}

export function buildNewThreadInEntries(input: {
  readonly pickerEntries: ReadonlyArray<CommandPaletteProjectPickerEntry>;
  readonly locationByEnvironmentId: ReadonlyMap<EnvironmentId, CommandPaletteEnvironmentLocation>;
  readonly scratchWorkspaceRootByEnvironmentId: ReadonlyMap<EnvironmentId, string | null>;
  readonly scratchTargetEnvironmentId: EnvironmentId | null;
}): CommandPaletteActionEntry[] {
  const projectEntries = input.pickerEntries
    .filter(
      ({ targetProject }) =>
        !isScratchProject(
          targetProject,
          input.scratchWorkspaceRootByEnvironmentId.get(targetProject.environmentId),
        ),
    )
    .map(({ group, targetProject: project }): CommandPaletteActionEntry => {
      const knownLocation = input.locationByEnvironmentId.get(project.environmentId);
      const location = knownLocation ?? REMOTE_LOCATION;
      return {
        kind: "action",
        value: `new-thread-in:${project.environmentId}:${project.id}`,
        searchTerms: [
          group.displayName,
          project.title,
          project.workspaceRoot,
          ...group.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]),
          ...(knownLocation ? [knownLocation.label] : []),
        ],
        title: group.displayName,
        description: `${location.label} · ${project.workspaceRoot}`,
        subtitle: { kind: "location", location, workspaceRoot: project.workspaceRoot },
        icon: { kind: "project", project: projectIconOf(project) },
        intent: {
          kind: "new-thread-in-project",
          projectRef: { environmentId: project.environmentId, projectId: project.id },
          memberProjectRefs: group.memberProjectRefs,
        },
      };
    });
  const scratchTargetEnvironmentId = input.scratchTargetEnvironmentId;
  return enumerateCommandPaletteItems([
    ...projectEntries,
    ...(scratchTargetEnvironmentId === null
      ? []
      : [
          {
            kind: "action" as const,
            value: "new-thread-in:no-project",
            searchTerms: ["no project", "without project", "none"],
            title: "No project",
            icon: glyph("message-square-dashed"),
            shortcutCommand: "chat.newWithoutProject" as const,
            intent: {
              kind: "new-thread-without-project" as const,
              environmentId: scratchTargetEnvironmentId,
            },
          },
        ]),
  ]);
}

export function buildNewThreadInView(input: {
  readonly entries: ReadonlyArray<CommandPaletteActionEntry>;
  readonly currentProjectRef: ScopedProjectRef | null;
}): CommandPaletteView {
  const currentRef = input.currentProjectRef;
  const currentValue = currentRef
    ? `new-thread-in:${currentRef.environmentId}:${currentRef.projectId}`
    : null;
  const prioritized = currentValue
    ? [
        ...input.entries.filter((entry) => entry.value === currentValue),
        ...input.entries.filter((entry) => entry.value !== currentValue),
      ]
    : input.entries;
  return {
    addonIcon: glyph("square-pen"),
    groups: [
      { value: "projects", label: "Projects", items: enumerateCommandPaletteItems(prioritized) },
    ],
    initialQuery: null,
  };
}

export function buildThreadEntries(
  input: CommandPaletteThreadEntriesInput,
): CommandPaletteActionEntry[] {
  const sortedThreads = sortThreads(
    input.threads.filter((thread) => thread.archivedAt === null),
    input.sortOrder,
  );
  const visibleThreads =
    input.limit === undefined ? sortedThreads : sortedThreads.slice(0, input.limit);

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push("Current thread");
    }

    const contentMatch = input.contentMatchByKey?.get(
      threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
    );
    const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
    const providerEntry =
      input.providerByKey?.get(`${thread.environmentId}:${modelInstanceId}`) ?? null;
    const project = input.projectByKey?.get(`${thread.environmentId}:${thread.projectId}`);

    return {
      kind: "action",
      value: `thread:${thread.id}`,
      searchTerms: [
        thread.title,
        ...threadPullRequestSearchTerms(thread),
        projectTitle ?? ``,
        thread.branch ?? ``,
        contentMatch?.snippet ?? ``,
        // Last so pasted IDs never outrank title matches for shared substrings.
        thread.id,
      ],
      title: thread.title,
      description: descriptionParts.join(` · `),
      subtitle: {
        kind: "thread",
        project: project ? projectIconOf(project) : null,
        projectTitle: projectTitle ?? null,
        environmentLabel:
          input.locationByEnvironmentId?.get(thread.environmentId)?.label ?? "Remote",
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        isCurrent: thread.id === input.activeThreadId,
        driverKind: providerEntry?.driverKind ?? null,
        providerDisplayName:
          thread.session?.providerName ?? providerEntry?.displayName ?? modelInstanceId,
      },
      timestamp: formatRelativeTimeLabel(
        thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
      ),
      searchRecency: getThreadSortTimestamp(thread, "updated_at"),
      icon: glyph("message-square"),
      thread: { environmentId: thread.environmentId, threadId: thread.id },
      ...(contentMatch ? { threadContentMatch: contentMatch } : {}),
      intent: { kind: "navigate-thread", environmentId: thread.environmentId, threadId: thread.id },
    };
  });
}

export function buildSettingsSearchEntries(input: {
  readonly query: string;
  readonly items: ReadonlyArray<SettingsSearchItem>;
  readonly platform: SettingsSearchPlatform;
}): CommandPaletteActionEntry[] {
  return searchSettings(input.query, input.items, input.platform).map((item) => ({
    kind: "action",
    value: `setting:${item.id}`,
    searchTerms: [item.title, SETTINGS_SECTION_LABELS[item.to], ...(item.searchTerms ?? [])],
    title: item.title,
    description: `Settings · ${SETTINGS_SECTION_LABELS[item.to]}`,
    ...(item.secondary ? { secondary: true } : {}),
    icon: glyph("settings"),
    intent: { kind: "open-setting-section", to: item.to, hash: item.targetId ?? item.id },
  }));
}

export function buildThemeCards(input: {
  readonly customThemes: ReadonlyArray<ThemeDefinition>;
  readonly environmentThemes: ReadonlyArray<ThemeDefinition>;
}): CommandPaletteThemeCard[] {
  const seen = new Set<string>();
  return [
    ...STANDARD_THEME_CARDS.map((card) => ({ ...card, id: null })),
    ...[...BUILT_IN_THEMES, ...input.customThemes, ...input.environmentThemes]
      .filter((definition) => {
        if (seen.has(definition.id)) return false;
        seen.add(definition.id);
        return true;
      })
      .map(getThemeCardDefinition),
  ];
}

export function buildThemeGroups(
  input: CommandPaletteThemeGroupsInput,
): CommandPaletteEntryGroup[] {
  const currentThemeId =
    input.themeHalves?.[input.resolvedTheme] ?? getThemeDefinition(input.theme)?.id ?? null;
  return [
    {
      value: "themes",
      label: "Change theme",
      items: input.cards.map(({ id, label, previews }): CommandPaletteActionEntry => {
        const [onlyPreview] = previews;
        const singlePreview = previews.length === 1 ? (onlyPreview ?? null) : null;
        return {
          kind: "action",
          value: id === null ? "theme:standard" : `theme:palette:${id}`,
          title: label,
          ...(singlePreview ? { description: `For ${singlePreview.mode} mode` } : {}),
          searchTerms: [label, "theme", "appearance"],
          icon: glyph("palette"),
          accessory: { kind: "theme-previews", current: currentThemeId === id, previews },
          intent: {
            kind: "select-theme",
            themeId: id,
            singleMode: singlePreview && id !== null ? singlePreview.mode : null,
          },
        };
      }),
    },
  ];
}

export function buildAppearanceGroups(
  appearanceMode: ThemePreferenceMode,
): CommandPaletteEntryGroup[] {
  return [
    {
      value: "appearance",
      label: "Change appearance",
      items: APPEARANCE_OPTIONS.map(({ mode, label, glyph: name }): CommandPaletteActionEntry => ({
        kind: "action",
        value: `appearance:${mode}`,
        title: label,
        searchTerms: [label, "appearance", "mode"],
        icon: glyph(name),
        ...(appearanceMode === mode ? { accessory: { kind: "current" as const } } : {}),
        intent: { kind: "set-appearance", mode },
      })),
    },
  ];
}

export function buildActionEntries(input: CommandPaletteActionsInput): CommandPaletteEntry[] {
  const entries: CommandPaletteEntry[] = [];

  if (input.hasProjects) {
    if (input.activeProjectTitle) {
      entries.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: "New thread in ",
        titleEmphasis: input.activeProjectTitle,
        icon: glyph("square-pen"),
        shortcutCommand: "chat.new",
        intent: { kind: "new-thread-from-context" },
      });
    }

    entries.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: glyph("square-pen"),
      view: {
        addonIcon: glyph("square-pen"),
        groups: [{ value: "projects", label: "Projects", items: input.newThreadInEntries }],
        initialQuery: null,
      },
    });
  }

  if (input.scratchTargetEnvironmentId !== null) {
    entries.push({
      kind: "action",
      value: "action:new-thread-without-project",
      searchTerms: ["new thread", "no project", "without project", "none", "chat"],
      title: "New thread without a project",
      icon: glyph("message-square-dashed"),
      shortcutCommand: "chat.newWithoutProject",
      intent: {
        kind: "new-thread-without-project",
        environmentId: input.scratchTargetEnvironmentId,
      },
    });
  }

  if (input.copyThreadReferenceTarget !== null) {
    entries.push({
      kind: "action",
      value: "action:copy-thread-reference",
      searchTerms: ["copy", "pull request", "pr link", "thread id", "reference"],
      title:
        input.copyThreadReferenceTarget.kind === "pull-request" ? "Copy PR link" : "Copy thread ID",
      description: input.copyThreadReferenceTarget.value,
      icon: glyph("link"),
      shortcutCommand: "thread.copyReference",
      intent: { kind: "copy-thread-reference" },
    });
  }

  const activeThread = input.activeThread;
  if (
    activeThread !== null &&
    threadPullRequestLinkMode(activeThread.capabilities) !== "unsupported"
  ) {
    entries.push({
      kind: "action",
      value: "action:link-pull-request",
      searchTerms: ["link", "pull request", "pr", "attach", "stack"],
      title: "Link pull request to thread",
      icon: glyph("pull-request-link"),
      intent: {
        kind: "link-pull-request",
        environmentId: activeThread.environmentId,
        threadId: activeThread.id,
      },
    });
    if (activeThread.capabilities?.threadPullRequests === true) {
      entries.push({
        kind: "action",
        value: "action:open-thread-pull-requests",
        searchTerms: ["pull requests", "linked", "stack", "prs"],
        title: "Show linked pull requests",
        disabled: visibleThreadPullRequests(activeThread.pullRequests).length === 0,
        icon: glyph("pull-request-link"),
        intent: {
          kind: "open-thread-pull-requests",
          environmentId: activeThread.environmentId,
          threadId: activeThread.id,
        },
      });
    }
  }

  if (activeThread !== null) {
    entries.push({
      kind: "action",
      value: "action:restart-agent-session",
      searchTerms: ["restart", "reset", "reload", "agent", "session", "skills", "plugins", "mcp"],
      title: "Restart agent session",
      icon: glyph("rotate-ccw"),
      intent: {
        kind: "restart-agent-session",
        environmentId: activeThread.environmentId,
        threadId: activeThread.id,
      },
    });
  }

  entries.push({
    kind: "action",
    value: "action:open-file-picker",
    searchTerms: ["go to file", "open file", "file picker", "find file", "quick open"],
    title: "Go to file",
    icon: glyph("file-search"),
    keepOpen: true,
    shortcutCommand: "filePicker.toggle",
    intent: { kind: "open-overlay", mode: "files" },
  });

  entries.push({
    kind: "action",
    value: "action:search-project-contents",
    searchTerms: ["search project", "find in files", "grep", "content search", "text search"],
    title: "Search project contents",
    icon: glyph("text-search"),
    keepOpen: true,
    shortcutCommand: "projectSearch.toggle",
    intent: { kind: "open-overlay", mode: "content" },
  });

  if (input.canCreateNewProject) {
    entries.push({
      kind: "action",
      value: "action:new-project",
      searchTerms: ["new project", "create project", "empty", "repository", "repo", "git init"],
      title: "New project",
      icon: glyph("folder-git"),
      keepOpen: true,
      intent: { kind: "start-new-project" },
    });
  }

  entries.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: [
      "add project",
      "folder",
      "directory",
      "browse",
      "clone",
      "remote",
      "repository",
      "repo",
      "git",
      "github",
      "gitlab",
      "forgejo",
      "bitbucket",
      "azure",
      "devops",
      "url",
      "environment",
    ],
    title: "Add project",
    icon: glyph("folder-plus"),
    keepOpen: true,
    intent: { kind: "start-add-project" },
  });

  if (input.wslFolderEnvironment) {
    entries.push({
      kind: "action",
      value: "action:add-project:wsl-folder",
      searchTerms: ["add project", "open", "wsl", "linux", "folder", "directory"],
      title: "Open WSL folder",
      description: input.wslFolderEnvironment.label,
      icon: glyph("folder-plus"),
      keepOpen: true,
      intent: {
        kind: "browse-add-project",
        environmentId: input.wslFolderEnvironment.environmentId,
      },
    });
  }

  entries.push({
    kind: "submenu",
    value: "action:change-theme",
    searchTerms: ["change theme", "appearance", "colors", "palette"],
    title: "Change theme",
    icon: glyph("palette"),
    shortcutCommand: "theme.select",
    view: { addonIcon: glyph("palette"), groups: input.themeGroups, initialQuery: null },
  });

  entries.push({
    kind: "submenu",
    value: "action:change-appearance",
    searchTerms: ["change appearance", "light", "dark", "system", "mode", "toggle"],
    title: "Change appearance",
    icon: glyph("monitor"),
    shortcutCommand: "appearance.cycle",
    view: {
      addonIcon: glyph("monitor"),
      groups: buildAppearanceGroups(input.appearanceMode),
      initialQuery: null,
    },
  });

  entries.push({
    kind: "action",
    value: "action:theme-editor",
    searchTerms: ["theme", "appearance", "colors", "palette", "customize"],
    title: "Toggle theme editor",
    icon: glyph("palette"),
    shortcutCommand: "themeEditor.toggle",
    intent: { kind: "toggle-theme-editor" },
  });

  if (input.pullRequestsAvailable) {
    entries.push({
      kind: "action",
      value: "action:pull-requests",
      searchTerms: ["pull requests", "prs", "pr", "github", "review", "merge", "branch"],
      title: "Open pull requests",
      icon: glyph("pull-request"),
      intent: { kind: "open-pull-requests" },
    });
  }

  entries.push({
    kind: "action",
    value: "action:usage",
    searchTerms: ["usage", "use", "tokens", "cost", "spend", "limits", "stats", "analytics"],
    title: "Open usage",
    icon: glyph("chart"),
    shortcutCommand: "usage.open",
    intent: { kind: "open-usage" },
  });

  entries.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: glyph("settings"),
    intent: { kind: "open-settings" },
  });

  if (input.projectSettingsTarget) {
    entries.push({
      kind: "action",
      value: "action:project-settings",
      searchTerms: [
        "project",
        "settings",
        "name",
        "icon",
        "scripts",
        "model",
        "workspace",
        "grouping",
        "checkout",
        "remove",
        "t3.json",
      ],
      title: "Project settings",
      description: input.projectSettingsTarget.displayName,
      icon: glyph("folder"),
      intent: { kind: "open-project-settings", projectKey: input.projectSettingsTarget.projectKey },
    });
  }

  return entries;
}

export function buildChangeThemeView(): CommandPaletteView {
  return {
    addonIcon: glyph("palette"),
    groups: [{ value: "themes", label: "Change theme", items: [] }],
    initialQuery: null,
  };
}

function buildEnvironmentEntry(
  option: AddProjectEnvironmentOption,
  value: string,
  intent: CommandPaletteIntent,
): CommandPaletteActionEntry {
  return {
    kind: "action",
    value,
    searchTerms: [option.label, option.environmentId, option.isPrimary ? "this device" : ""],
    title: option.label,
    description: option.isConnected
      ? option.isPrimary
        ? "This device"
        : option.environmentId
      : option.status,
    disabled: !option.isConnected,
    icon: { kind: "machine", machine: option.machine },
    keepOpen: true,
    intent,
  };
}

export function buildAddProjectEnvironmentGroups(
  options: ReadonlyArray<AddProjectEnvironmentOption>,
): CommandPaletteEntryGroup[] {
  return [
    {
      value: "environments",
      label: "Environments",
      items: options.map((option) =>
        buildEnvironmentEntry(option, `action:add-project:environment:${option.environmentId}`, {
          kind: "select-add-project-environment",
          environmentId: option.environmentId,
        }),
      ),
    },
  ];
}

export function buildAddProjectSourceGroups(
  input: CommandPaletteAddProjectSourcesInput,
): CommandPaletteEntryGroup[] {
  const environmentId = input.environmentId;
  const sourceItems: CommandPaletteActionEntry[] = [];

  if (input.canCreateNewProject) {
    sourceItems.push({
      kind: "action",
      value: `action:add-project:${environmentId}:new`,
      searchTerms: ["new project", "create", "empty", "repository", "git init"],
      title: "New project",
      description: "Start a new Git repository from a name",
      icon: glyph("folder-git"),
      keepOpen: true,
      intent: {
        kind: "start-new-project-in",
        environmentId,
        sourcesEnvironmentId: environmentId,
      },
    });
  }

  sourceItems.push({
    kind: "action",
    value: `action:add-project:${environmentId}:local`,
    searchTerms: ["local", "folder", "directory", "browse"],
    title: "Local folder",
    description: "Browse a folder on disk",
    icon: glyph("folder-plus"),
    keepOpen: true,
    intent: { kind: "browse-add-project", environmentId },
  });

  const orderedSources: ReadonlyArray<AddProjectRemoteSource> = [
    "url",
    ...sortAddProjectProviderSources(input.readiness),
  ];

  for (const source of orderedSources) {
    const label = addProjectRemoteSourceLabel(source);
    const title = source === "url" ? "Git URL" : `${label} repository`;
    const description =
      source === "url"
        ? "Clone from a remote URL"
        : `Clone ${label} ${addProjectRemoteSourcePathHint(source)}`;
    const readiness = input.readiness[source];

    if (!readiness.ready) {
      sourceItems.push({
        kind: "action",
        value: `action:add-project:${environmentId}:${source}:not-ready`,
        searchTerms: ["clone", "remote", "repository", "repo", "git", label, "setup required"],
        title,
        description,
        disabled: true,
        icon: glyph(remoteProjectSourceGlyph(source)),
        accessory: {
          kind: "setup-required",
          hint: readiness.hint ?? "Open Settings -> Source Control to configure this provider.",
        },
        intent: { kind: "open-source-control-settings" },
      });
      continue;
    }

    sourceItems.push({
      kind: "action",
      value: `action:add-project:${environmentId}:${source}`,
      searchTerms: ["clone", "remote", "repository", "repo", "git", label],
      title,
      description,
      icon: glyph(remoteProjectSourceGlyph(source)),
      keepOpen: true,
      intent: { kind: "start-clone", environmentId, source },
    });
  }

  return [{ value: `sources:${environmentId}`, label: "Sources", items: sourceItems }];
}

export function buildBrowseGroups(input: {
  readonly browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  readonly browseQuery: string;
  readonly canBrowseUp: boolean;
}): CommandPaletteEntryGroup[] {
  const items: CommandPaletteActionEntry[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: glyph("corner-left-up"),
      keepOpen: true,
      intent: { kind: "browse-up" },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: glyph("folder"),
      keepOpen: true,
      intent: { kind: "browse-to", name: entry.name },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export type CommandPaletteBrowseEntries = {
  readonly visibleEntries: ReadonlyArray<FilesystemBrowseEntry>;
  readonly exactEntry: FilesystemBrowseEntry | null;
};

export function filterPinnedBrowseEntries(input: {
  readonly browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  readonly filterQuery: string;
  readonly pinnedDirectoryName: string;
  readonly caseSensitive: boolean;
}): CommandPaletteBrowseEntries {
  const namesMatch = (left: string, right: string) =>
    input.caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
  const visibleFilterQuery = namesMatch(input.filterQuery, input.pinnedDirectoryName)
    ? ""
    : input.filterQuery;
  const { visibleEntries } = filterFilesystemBrowseEntries(input.browseEntries, visibleFilterQuery);
  const exactEntry =
    input.filterQuery.length > 0
      ? (input.browseEntries.find((entry) => namesMatch(entry.name, input.filterQuery)) ?? null)
      : null;
  return { visibleEntries, exactEntry };
}

function rankSearchFieldMatch(
  field: string,
  normalizedQuery: string,
  queryTokens: ReadonlyArray<string>,
): number {
  const normalizedField = normalizeSearchText(field);
  if (
    normalizedField.length === 0 ||
    !queryTokens.every((token) => normalizedField.includes(token))
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) {
    return 3;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 2;
  }
  if (normalizedField.includes(normalizedQuery)) {
    return 1;
  }
  return 0;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteSearchable,
  normalizedQuery: string,
  queryTokens: ReadonlyArray<string>,
): number {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  if (terms.length === 0) {
    return 0;
  }

  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery, queryTokens);
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      if (index === 0 && item.searchRecency !== undefined) {
        // All non-exact thread title matches share a tier so recency breaks the tie.
        return 1_000 + Number(fieldRank === 3);
      }
      return 1_000 - index * 100 + fieldRank;
    }
  }

  return 0;
}

export function filterCommandPaletteGroups<TItem extends CommandPaletteSearchable>(input: {
  readonly activeGroups: ReadonlyArray<CommandPaletteGroupOf<TItem>>;
  readonly query: string;
  readonly isInSubmenu: boolean;
  readonly projectSearchItems: ReadonlyArray<TItem>;
  readonly settingsSearchItems?: ReadonlyArray<TItem>;
  readonly threadSearchItems: ReadonlyArray<TItem>;
}): CommandPaletteGroupOf<TItem>[] {
  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }
  const queryTokens = normalizedQuery.split(" ");

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  if (!input.isInSubmenu && !isActionsFilter) {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
    if (input.settingsSearchItems && input.settingsSearchItems.length > 0) {
      searchableGroups.push({
        value: "settings-search",
        label: "Settings",
        items: input.settingsSearchItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
  }

  return searchableGroups.flatMap((group) => {
    const items = Arr.filterMap(group.items, (item, index) => {
      const haystack = normalizeSearchText(item.searchTerms.join(" "));
      if (!queryTokens.every((token) => haystack.includes(token))) {
        return Result.failVoid;
      }

      return Result.succeed({
        item,
        index,
        rank: rankCommandPaletteItemMatch(item, normalizedQuery, queryTokens),
      });
    })
      .toSorted(
        (left, right) =>
          Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
          right.rank - left.rank ||
          (right.item.searchRecency ?? 0) - (left.item.searchRecency ?? 0) ||
          left.index - right.index,
      )
      .map((entry) => entry.item);

    if (items.length === 0) {
      return [];
    }

    return [{ value: group.value, label: group.label, items }];
  });
}

export function getCommandPaletteMode(input: {
  readonly currentView: CommandPaletteView | null;
  readonly isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  readonly actionItems: ReadonlyArray<CommandPaletteEntry>;
  readonly recentThreadItems: ReadonlyArray<CommandPaletteEntry>;
}): CommandPaletteEntryGroup[] {
  const groups: CommandPaletteEntryGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}

function submenuGroups(
  entries: ReadonlyArray<CommandPaletteEntry>,
  value: string,
): ReadonlyArray<CommandPaletteEntryGroup> {
  for (const entry of entries) {
    if (entry.kind === "submenu" && entry.value === value) return entry.view.groups;
  }
  return [];
}

function buildNewProjectGroups(input: {
  readonly newProject: CommandPaletteNewProjectInput;
  readonly name: string;
  readonly pathPreview: string | null;
  readonly showMachines: boolean;
}): CommandPaletteEntryGroup[] {
  const { newProject } = input;
  const groups: CommandPaletteEntryGroup[] = [];
  if (input.showMachines) {
    groups.push({
      value: "new-project-machines",
      label: "Environments",
      items: newProject.machineOptions.map((option) => ({
        ...buildEnvironmentEntry(option, `new-project:environment:${option.environmentId}`, {
          kind: "switch-new-project-environment",
          environmentId: option.environmentId,
        }),
        ...(newProject.isCreating ? { disabled: true } : {}),
        ...(option.environmentId === newProject.environmentId
          ? { accessory: { kind: "selected" as const } }
          : {}),
      })),
    });
  }
  if (newProject.githubTarget !== null && input.pathPreview !== null) {
    groups.push({
      value: "new-project-options",
      label: "Options",
      items: [
        {
          kind: "action",
          value: NEW_PROJECT_GITHUB_TOGGLE_VALUE,
          searchTerms: [],
          title: "Create private repository on GitHub",
          description:
            input.name.length > 0
              ? getNewProjectGitHubRepository(newProject.githubTarget, input.pathPreview)
              : (newProject.githubTarget.account ?? "Your GitHub account"),
          icon: glyph("github"),
          accessory: { kind: "checkbox", checked: newProject.publishesToGitHub },
          keepOpen: true,
          intent: { kind: "toggle-new-project-github" },
        },
      ],
    });
  }
  groups.push({
    value: "new-project-existing",
    label: "",
    items: [
      {
        kind: "action",
        value: "new-project:existing",
        searchTerms: [],
        title: "Add existing project",
        description: "Open a folder or clone a repository",
        icon: glyph("folder-plus"),
        accessory: { kind: "chevron" },
        keepOpen: true,
        intent: { kind: "show-existing-project-sources", environmentId: newProject.environmentId },
      },
    ],
  });
  return groups;
}

function toRowGroups(
  groups: ReadonlyArray<CommandPaletteEntryGroup>,
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
): CommandPaletteRowGroup[] {
  return groups.map((group) => ({
    value: group.value,
    label: group.label,
    items: group.items.map((item): CommandPaletteRow => ({
      ...item,
      shortcutLabel: item.shortcutCommand
        ? shortcutLabelForCommand(keybindings, item.shortcutCommand, platform)
        : null,
    })),
  }));
}

export function buildCommandPaletteModel(input: CommandPaletteModelInput): CommandPaletteModel {
  const { browse, cloneFlow, currentView, newProject } = input;
  const isActionsOnly = input.deferredQuery.startsWith(">");
  const mode = getCommandPaletteMode({ currentView, isBrowsing: browse.isBrowsing });
  const isSubmenu = mode === "submenu" || mode === "submenu-browse";

  const rootGroups = buildRootGroups({
    actionItems: input.actionEntries,
    recentThreadItems: input.threadEntries.slice(0, RECENT_THREAD_LIMIT),
  });
  const firstViewGroupValue = currentView?.groups[0]?.value;
  const activeGroups: ReadonlyArray<CommandPaletteEntryGroup> =
    input.addProjectSources !== null &&
    currentView !== null &&
    firstViewGroupValue === `sources:${input.addProjectSources.environmentId}`
      ? buildAddProjectSourceGroups(input.addProjectSources)
      : firstViewGroupValue === "themes"
        ? submenuGroups(input.actionEntries, "action:change-theme")
        : firstViewGroupValue === "appearance"
          ? submenuGroups(input.actionEntries, "action:change-appearance")
          : (currentView?.groups ?? rootGroups);

  const linkedThreadSearch = input.linkedThreadSearch;
  const filteredGroups = filterCommandPaletteGroups<CommandPaletteEntry>({
    activeGroups,
    query: input.deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: input.projectSearchEntries,
    settingsSearchItems: buildSettingsSearchEntries({
      query: input.deferredQuery,
      items: input.availableSettingsSearchItems,
      platform: input.settingsSearchPlatform,
    }),
    threadSearchItems:
      linkedThreadSearch?.linkedThreads && input.deferredQuery === linkedThreadSearch.query
        ? buildLinkedThreadEntries({
            ...linkedThreadSearch.linkedThreads,
            query: linkedThreadSearch.query,
          })
        : input.threadEntries,
  });

  const relativePathNeedsActiveProject = browse.relativePathNeedsActiveProject;
  const browseGroups = buildBrowseGroups({
    browseEntries: browse.entries,
    browseQuery: input.query,
    canBrowseUp: !relativePathNeedsActiveProject && browse.canBrowseUp,
  });

  const newProjectName = input.query.trim();
  const pathPreview =
    newProject === null || newProject.root === null
      ? null
      : getNewProjectPathPreview(newProject.root, newProjectName);
  const selectedNewProjectEnvironment =
    newProject === null
      ? undefined
      : newProject.machineOptions.find(
          (option) => option.environmentId === newProject.environmentId,
        );
  const showNewProjectMachines =
    newProject !== null &&
    (newProject.machineOptions.length > 1 ||
      (selectedNewProjectEnvironment === undefined && newProject.machineOptions.length > 0));
  const newProjectEnvironmentLabel =
    showNewProjectMachines && newProject !== null
      ? (selectedNewProjectEnvironment?.label ?? newProject.environmentLabelFallback)
      : null;

  let displayedGroups: ReadonlyArray<CommandPaletteEntryGroup> = filteredGroups;
  if (newProject !== null) {
    displayedGroups = buildNewProjectGroups({
      newProject,
      name: newProjectName,
      pathPreview,
      showMachines: showNewProjectMachines,
    });
  } else if (cloneFlow?.step === "repository") {
    displayedGroups = [];
  } else if (cloneFlow?.step === "confirm") {
    displayedGroups = relativePathNeedsActiveProject
      ? []
      : browseGroups.map((group) =>
          group.value === "directories" ? { ...group, label: "Select where to clone" } : group,
        );
  } else if (browse.isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }

  const hasHighlightedBrowseItem = input.highlightedItemValue?.startsWith("browse:") ?? false;
  const canSubmitBrowsePath =
    browse.isBrowsing && !relativePathNeedsActiveProject && input.environmentConnected;
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !browse.isPending &&
    input.query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(input.query) ? !browse.hasResult : !browse.hasExactEntry);
  const submitModifierLabel = isMacPlatform(input.platform) ? "\u2318" : "Ctrl";
  const isCloneDestinationStep = cloneFlow?.step === "confirm";
  const submitActionLabel = isCloneDestinationStep
    ? willCreateProjectPath
      ? "Create & Clone"
      : "Clone"
    : willCreateProjectPath
      ? "Create & Add"
      : "Add";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const remoteProjectButtonLabel = cloneFlow
    ? cloneFlow.source === "url"
      ? "Continue"
      : "Lookup"
    : null;
  const canSubmitRemoteProjectFlow =
    cloneFlow?.step === "repository" &&
    input.query.trim().length > 0 &&
    input.environmentConnected &&
    !input.remoteProjectPending;
  const canSubmitNewProject =
    newProject !== null &&
    newProjectName.length > 0 &&
    !newProject.isCreating &&
    input.environmentConnected;

  const submit: CommandPaletteSubmit | null =
    newProject !== null
      ? {
          action: "create-project",
          label: newProject.isCreating ? "Creating" : "Create",
          ariaLabel: "Create (Enter)",
          tooltip: "Create (Enter)",
          shortcutLabel: "Enter",
          disabled: !canSubmitNewProject,
        }
      : cloneFlow?.step === "repository"
        ? {
            action: "lookup-repository",
            label: input.remoteProjectPending
              ? "Working"
              : cloneFlow.source === "url"
                ? "Continue"
                : "Lookup",
            ariaLabel: `${cloneFlow.source === "url" ? "Continue" : "Lookup"} (Enter)`,
            tooltip: `${cloneFlow.source === "url" ? "Continue" : "Lookup"} (Enter)`,
            shortcutLabel: "Enter",
            disabled: !canSubmitRemoteProjectFlow,
          }
        : browse.isBrowsing
          ? {
              action: "add-path",
              label:
                isCloneDestinationStep && input.remoteProjectPending
                  ? "Cloning"
                  : submitActionLabel,
              ariaLabel: `${submitActionLabel} (${addShortcutLabel})`,
              tooltip: `${submitActionLabel} (${addShortcutLabel})`,
              shortcutLabel: addShortcutLabel,
              disabled:
                !input.environmentConnected ||
                relativePathNeedsActiveProject ||
                (isCloneDestinationStep && input.remoteProjectPending),
            }
          : null;

  const footerActionLabel =
    newProject !== null
      ? input.highlightedItemValue === null
        ? "Create"
        : input.highlightedItemValue === NEW_PROJECT_GITHUB_TOGGLE_VALUE
          ? "Toggle"
          : "Select"
      : cloneFlow?.step === "repository"
        ? (remoteProjectButtonLabel ?? "Continue")
        : !canSubmitBrowsePath || hasHighlightedBrowseItem
          ? "Select"
          : null;

  const emptyStateMessage =
    cloneFlow?.step === "repository"
      ? cloneFlow.source === "url"
        ? "Enter a Git clone URL and press Enter to continue."
        : "Enter a repository path and press Enter to look it up."
      : cloneFlow?.step === "confirm"
        ? "Choose a destination path and press Enter to clone."
        : relativePathNeedsActiveProject
          ? "Relative paths require an active project."
          : willCreateProjectPath
            ? "Press Enter to create this folder and add it as a project."
            : input.threadSearchPending
              ? "Searching thread messages…"
              : isActionsOnly
                ? "No matching actions."
                : "No matching commands, projects, or threads.";

  return {
    mode,
    isSubmenu,
    isActionsOnly,
    autoHighlight: !(browse.isBrowsing || cloneFlow !== null || newProject !== null),
    inputPlaceholder:
      newProject !== null
        ? "Project name"
        : (remoteProjectInputPlaceholder(cloneFlow) ?? getCommandPaletteInputPlaceholder(mode)),
    groups: toRowGroups(displayedGroups, input.keybindings, input.platform),
    emptyStateMessage,
    newProjectHeader:
      newProject !== null && pathPreview !== null
        ? {
            title: newProjectName.length > 0 ? newProjectName : "New project",
            detail: `${newProjectName.length > 0 ? `Creates ${pathPreview}` : `Goes in ${newProject.root}`}${newProjectEnvironmentLabel === null ? "" : ` on ${newProjectEnvironmentLabel}`}`,
          }
        : null,
    repositoryHeader:
      cloneFlow?.step === "confirm"
        ? {
            title: cloneFlow.repository?.nameWithOwner ?? cloneFlow.repositoryInput,
            description: cloneFlow.repository?.url ?? cloneFlow.remoteUrl,
            icon: glyph(remoteProjectSourceGlyph(cloneFlow.source)),
          }
        : null,
    footerActionLabel,
    submit,
    canSubmitBrowsePath,
    willCreateProjectPath,
    hasHighlightedBrowseItem,
    isCloneDestinationStep,
    canSubmitNewProject,
    newProjectName,
  };
}

export function resolveCommandPaletteItem(
  item: CommandPaletteEntry,
  ctx: CommandPaletteResolveContext,
): CommandPaletteResolution {
  if (item.disabled) {
    return { kind: "ignore" };
  }
  if (item.kind === "submenu") {
    return { kind: "open-view", view: item.view };
  }
  const keepOpen = item.keepOpen ?? false;
  const intent = item.intent;
  switch (intent.kind) {
    case "open-project": {
      const memberKeys = new Set(
        intent.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
      );
      const latestThread =
        sortThreads(
          ctx.threads.filter(
            (thread) =>
              thread.archivedAt === null &&
              memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
          ),
          ctx.sidebarThreadSortOrder,
        )[0] ?? null;
      return {
        kind: "run",
        keepOpen,
        command: latestThread
          ? {
              kind: "navigate-thread",
              environmentId: latestThread.environmentId,
              threadId: latestThread.id,
            }
          : { kind: "new-thread", projectRef: intent.projectRef },
      };
    }
    case "new-thread-in-project": {
      const contextual = ctx.contextualProjectRef;
      const contextualBelongsToGroup =
        contextual !== null &&
        intent.memberProjectRefs.some(
          (ref) =>
            ref.environmentId === contextual.environmentId &&
            ref.projectId === contextual.projectId,
        );
      return {
        kind: "run",
        keepOpen,
        command: {
          kind: "new-thread",
          projectRef:
            contextual !== null && contextualBelongsToGroup ? contextual : intent.projectRef,
        },
      };
    }
    case "select-theme":
      return {
        kind: "run",
        keepOpen,
        command:
          intent.singleMode !== null && intent.themeId !== null
            ? { kind: "set-theme-half", mode: intent.singleMode, themeId: intent.themeId }
            : { kind: "set-theme", theme: intent.themeId ?? ctx.appearanceMode },
      };
    case "open-setting-section":
      return {
        kind: "run",
        keepOpen,
        command: {
          kind: "open-setting",
          to: intent.to,
          hash: intent.hash,
          replace: ctx.pathname === intent.to,
        },
      };
    case "browse-up": {
      const parentPath = ctx.browse.parentPath;
      if (parentPath === null) {
        return { kind: "ignore" };
      }
      return {
        kind: "run",
        keepOpen,
        command: {
          kind: "browse",
          nextQuery: getCloneDestinationPath(parentPath, ctx.browse.pinnedCloneDirectoryName),
          prefetchPath: parentPath,
        },
      };
    }
    case "browse-to": {
      const nextQuery = ctx.browse.pinnedCloneDirectoryName
        ? getCloneDestinationBrowsePath({
            browseDirectoryPath: ctx.browse.directoryPath,
            selectedDirectoryName: intent.name,
            cloneDirectoryName: ctx.browse.pinnedCloneDirectoryName,
            caseSensitive: !isWindowsPlatform(ctx.browse.platform),
          })
        : appendBrowsePathSegment(ctx.browse.query, intent.name);
      return {
        kind: "run",
        keepOpen,
        command: { kind: "browse", nextQuery, prefetchPath: getBrowseDirectoryPath(nextQuery) },
      };
    }
    default:
      return { kind: "run", keepOpen, command: intent };
  }
}

export function getEnvironmentBrowsePlatform(os: string | null | undefined): string {
  if (os === "windows") {
    return "Win32";
  }
  if (os === "darwin") {
    return "MacIntel";
  }
  if (os === "linux") {
    return "Linux";
  }
  return typeof navigator === "undefined" ? "" : navigator.platform;
}
