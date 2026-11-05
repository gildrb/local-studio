import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ModelSelection,
  resolveEnvironmentMachineKind,
  type ResolvedKeybindingsConfig,
  type ScopedProjectRef,
  type ServerConfig,
} from "@t3tools/contracts";
import type { SidebarProjectSortOrder } from "@t3tools/contracts/settings";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import type { ComposerThreadDraftState, DraftId } from "../../composerDraftStore";
import { scratchEnvironmentIdFor, scratchWorkspaceRootFor } from "../../hooks/scratchProject.logic";
import type { ScratchProjectEnvironment } from "../../hooks/scratchProject.logic";
import { shortcutLabelForCommand } from "../../keybindings";
import { hasExplicitComposerModelSelection } from "../../lib/chatThreadActions";
import type { ProjectGroupingSettings } from "../../logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
  type SidebarProjectPickerEntry,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";

export type DraftHeroEnvironment = ScratchProjectEnvironment & {
  readonly label: string;
  readonly serverConfig: ServerConfig | null;
};

export interface DraftHeroHeadlineInput {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environments: ReadonlyArray<DraftHeroEnvironment>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly projectGroupingSettings: ProjectGroupingSettings;
  readonly projectSortOrder: SidebarProjectSortOrder;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export interface DraftHeroHeadlineModel {
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly showProjectEnvironments: boolean;
  readonly environmentMachineById: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  readonly projectEntryByKey: ReadonlyMap<string, SidebarProjectPickerEntry>;
  readonly projectPickerEntries: ReadonlyArray<SidebarProjectPickerEntry>;
  readonly menuEntries: ReadonlyArray<SidebarProjectPickerEntry>;
  readonly activeProjectKey: string;
  readonly activeProjectDisplayName: string | null;
  readonly hasResolvedProject: boolean;
  readonly canChooseProject: boolean;
  readonly scratchTargetEnvironmentId: EnvironmentId | null;
  readonly scratchWorkspaceRoot: string | null;
  readonly isScratchDraft: boolean;
  readonly headingLabel: string;
  readonly noProjectShortcut: string | null;
  readonly showStartWithoutProject: boolean;
}

// Menu value for "No project"; real entries are keyed by logical project key.
export const NO_PROJECT_VALUE = "no-project";

export function buildDraftHeroHeadlineModel(input: DraftHeroHeadlineInput): DraftHeroHeadlineModel {
  const environmentLabelById = new Map(
    input.environments.map(
      (environment) => [environment.environmentId, environment.label] as const,
    ),
  );
  const projectGroups = sortLogicalProjectsForSidebar(
    buildSidebarProjectSnapshots({
      projects: input.projects,
      settings: input.projectGroupingSettings,
      primaryEnvironmentId: input.primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
    }),
    input.threads,
    input.projectSortOrder,
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const environmentMachineById = new Map(
    input.environments.map(
      (environment) =>
        [
          environment.environmentId,
          resolveEnvironmentMachineKind(environment.serverConfig),
        ] as const,
    ),
  );
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: projectGroups,
    preferredProjectRef: input.activeProjectRef,
  });
  const projectEntryByKey = new Map(
    projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const),
  );
  const activeProjectRef = input.activeProjectRef;
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? input.activeProjectTitle;
  const hasResolvedProject = input.activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  // The project that hosts threads without a project appears once, as the
  // "No project" item, not as a project row.
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(
        targetProject,
        scratchWorkspaceRootFor(input.environments, targetProject.environmentId),
      ),
  );
  const activeProject =
    activeProjectRef === null
      ? null
      : (input.projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentIdFor(
    input.environments,
    activeProjectRef?.environmentId ?? input.primaryEnvironmentId,
  );
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(
    input.environments,
    scratchTargetEnvironmentId,
  );
  const isScratchDraft =
    activeProject !== null && isScratchProject(activeProject, scratchWorkspaceRoot);
  // The composer hero is a sentence, so the heading's accessible name must be
  // a complete sentence too. The project picker is a control rendered inline
  // in the h1; without an explicit label its widget state bleeds into the
  // announced phrase.
  const headingLabel = isScratchDraft
    ? "What should we work on?"
    : hasResolvedProject
      ? `What should we build in ${activeProjectDisplayName}?`
      : canChooseProject
        ? `${activeProjectDisplayName ?? "Choose a project"} to start`
        : "Add a project to start";
  return {
    projectGroups,
    showProjectEnvironments,
    environmentMachineById,
    projectEntryByKey,
    projectPickerEntries,
    menuEntries,
    activeProjectKey,
    activeProjectDisplayName,
    hasResolvedProject,
    canChooseProject,
    scratchTargetEnvironmentId,
    scratchWorkspaceRoot,
    isScratchDraft,
    headingLabel,
    noProjectShortcut: shortcutLabelForCommand(input.keybindings, "chat.newWithoutProject"),
    // One click out of the project, phrased as the alternative to the question
    // above it.
    showStartWithoutProject:
      scratchWorkspaceRoot !== null && !isScratchDraft && (hasResolvedProject || canChooseProject),
  };
}

export interface DraftHeroProjectSelectionDeps {
  readonly getComposerDraft: (draftId: DraftId) => ComposerThreadDraftState | null;
  readonly setLogicalProjectDraftThreadId: (
    logicalProjectKey: string,
    projectRef: ScopedProjectRef,
    draftId: DraftId,
  ) => void;
  readonly applyStickyState: (draftId: DraftId) => void;
  readonly setModelSelection: (
    draftId: DraftId,
    modelSelection: ModelSelection,
    options: { readonly replaceOptions: boolean },
  ) => void;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly serverConfig: Pick<ServerConfig, "settings"> | null;
  }>;
}

// Project selection changes the target of the open draft in place. The
// prompt stays in the same composer session, so the sidebar only gets a
// draft row if the user later navigates away.
export function selectDraftHeroProject(
  deps: DraftHeroProjectSelectionDeps,
  draftId: DraftId,
  project: Project,
  logicalProjectKey: string,
): void {
  const currentDraft = deps.getComposerDraft(draftId);
  deps.setLogicalProjectDraftThreadId(
    logicalProjectKey,
    scopeProjectRef(project.environmentId, project.id),
    draftId,
  );
  if (!hasExplicitComposerModelSelection(currentDraft)) {
    deps.applyStickyState(draftId);
    const environmentSettings = deps.environments.find(
      (environment) => environment.environmentId === project.environmentId,
    )?.serverConfig?.settings;
    const defaultModelSelection = environmentSettings
      ? resolveProjectSettings(environmentSettings, project.id, project).settings
          .defaultModelSelection
      : project.defaultModelSelection;
    if (defaultModelSelection) {
      deps.setModelSelection(draftId, defaultModelSelection, {
        replaceOptions: true,
      });
    }
  }
}
