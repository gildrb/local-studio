import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { getProjectOrderKey } from "@t3tools/client-runtime/state/project-grouping";
import {
  EnvironmentId,
  type EnvironmentMachineKind,
  resolveEnvironmentMachineKind,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { projectGroupsSpanEnvironments } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import type { Project } from "@t3tools/web/src/types.ts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  buildDraftStartErrorModel,
  buildNoProjectsHeroModel,
  resolveIndexDraftLandingView,
} from "@t3tools/web/src/components/NoProjectsHero.logic.ts";
import { resolveProjectEnvironmentBadge } from "@t3tools/web/src/components/ProjectEnvironmentBadge.logic.ts";
import {
  filterSidebarProjectScopeItems,
  orderItemsByPreferredIds,
  shouldCreateNewThreadInCurrentProject,
  sortScopedProjectsForSidebar,
} from "@t3tools/web/src/components/Sidebar.logic.ts";
import {
  buildDraftHeroHeadlineModel,
  NO_PROJECT_VALUE,
  selectDraftHeroProject,
} from "@t3tools/web/src/components/chat/DraftHeroHeadline.logic.ts";
import { type DraftId, useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import {
  openScratchProject,
  scratchEnvironmentIdFor,
} from "@t3tools/web/src/hooks/scratchProject.logic.ts";
import { startNewThreadFromContext } from "@t3tools/web/src/lib/chatThreadActions.ts";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/web/src/logicalProject.ts";
import { projectEnvironmentPresentation } from "@t3tools/web/src/state/environmentPresentation.logic.ts";
import {
  createAllEnvironmentProjectSnapshotsReadyAtom,
  createAllEnvironmentShellsBootstrappedAtom,
} from "@t3tools/web/src/state/shellBootstrap.logic.ts";
import { waitForProjectIn } from "@t3tools/web/src/state/waitForProject.logic.ts";
import { legacyProjectCwdPreferenceKey } from "@t3tools/web/src/uiState.logic.ts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { addProjectService } from "../addProject.ts";
import { commandPaletteService } from "./commandPalette.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { buildProjectDisplayNames, projectIconView } from "../sidebarView.ts";
import type { ProjectIconView } from "../views/sidebar.ts";

export type DraftHeroEntryView = {
  readonly value: string;
  readonly label: string;
  readonly icon: ProjectIconView | null;
  readonly selected: boolean;
  readonly environment: {
    readonly kind: EnvironmentMachineKind;
    readonly description: string;
  } | null;
};

export type DraftHeroView = {
  readonly headingLabel: string;
  readonly sentence: "scratch" | "build-in" | "choose" | "add";
  readonly projectTrigger: {
    readonly label: string;
    readonly tooltip: string | null;
    readonly picker: {
      readonly entries: ReadonlyArray<DraftHeroEntryView>;
      readonly showSeparator: boolean;
    } | null;
  };
  readonly subline: {
    readonly content: "picker" | "start-without" | "empty";
    readonly shortcut: string | null;
  } | null;
};

export type NoProjectsHeroView = {
  readonly title: string;
  readonly description: string;
  readonly addProjectLabel: string;
  readonly startWithoutProjectLabel: string | null;
};

export type HomeView =
  | { readonly kind: "none" }
  | ({ readonly kind: "no-projects" } & NoProjectsHeroView)
  | {
      readonly kind: "start-error";
      readonly title: string;
      readonly description: string;
      readonly retryLabel: string;
    };

export type ProjectScopeView = {
  readonly open: boolean;
  readonly query: string;
  readonly placeholder: string;
  readonly emptyLabel: string;
  readonly items: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly icon: ProjectIconView | null;
    readonly selected: boolean;
    readonly environment: {
      readonly kind: EnvironmentMachineKind;
      readonly description: string;
    } | null;
    readonly settingsTitle: string | null;
  }>;
};

const NewThreadParams = Schema.decodeUnknownSync(Schema.Struct({ shift: Schema.Boolean }));
const SelectProjectParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const ScopeOpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const ScopeQueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));

const ALL_PROJECTS_VALUE = "all";

function reportScratchFailure(context: FeatureContext) {
  return (error: unknown) => {
    context.addToast({
      layout: "stacked",
      type: "error",
      title: "Could not start without a project",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };
}

/** The project a context-free new thread lands in: the first project in sidebar order. */
export function defaultNewThreadProjectRef(context: FeatureContext): ScopedProjectRef | null {
  const projects = context.registry.get(context.state.environmentProjects.projectsAtom);
  const ordered = orderItemsByPreferredIds({
    items: projects,
    preferredIds: context.registry.get(context.uiStateAtom).projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  const first = ordered[0];
  return first ? scopeProjectRef(first.environmentId, first.id) : null;
}

export function createDraftsFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const addProject = addProjectService(context);

  const environmentsAtom = Atom.make((get) =>
    [...get(state.environmentPresentations.presentationsAtom).entries()].map(([id, presentation]) =>
      projectEnvironmentPresentation(id, presentation),
    ),
  );
  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(state.primaryServerConfigAtom)?.keybindings ?? []),
  );
  const bootstrappedAtom = createAllEnvironmentShellsBootstrappedAtom({
    catalogAtom: state.environmentCatalog.catalogAtom,
    connectionStateAtom: state.environmentCatalog.stateAtom,
    shellStateValueAtom: state.environmentShell.stateValueAtom,
  });
  const projectGroupsAtom = Atom.make(
    (get) =>
      buildProjectDisplayNames({
        projects: get(state.environmentProjects.projectsAtom),
        threads: get(state.environmentThreadShells.threadShellsAtom),
        environments: get(state.environmentPresentations.presentationsAtom),
        primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
        clientSettings: get(context.clientSettingsAtom),
        projectOrder: get(context.uiStateAtom).projectOrder,
      }).projectGroups,
  );

  const scratchDeps = {
    ensureScratch: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: Record<string, never>;
    }) =>
      runAtomCommand(registry, state.projectEnvironment.ensureScratch, target, {
        reportFailure: false,
      }),
    waitForProject: (ref: ScopedProjectRef) =>
      waitForProjectIn(registry, state.environmentProjects.projectAtom(ref)),
    reportFailure: reportScratchFailure(context),
  };

  const startScratchThread = async (environmentId: EnvironmentId) => {
    const project = await openScratchProject(scratchDeps, environmentId);
    if (project) {
      await context
        .openNewThread(scopeProjectRef(project.environmentId, project.id))
        .catch(reportScratchFailure(context));
    }
  };

  const landingAtom = Atom.make({ starting: false, failed: false }).pipe(Atom.keepAlive);

  const mostRecentProjectAtom = Atom.make((get) =>
    get(bootstrappedAtom)
      ? (sortScopedProjectsForSidebar(
          get(state.environmentProjects.projectsAtom),
          get(state.environmentThreadShells.threadShellsAtom),
          "updated_at",
        )[0] ?? null)
      : null,
  );

  const noProjectsHeroAtom = Atom.make((get): NoProjectsHeroView => {
    const scratchTarget = scratchEnvironmentIdFor(
      get(environmentsAtom),
      get(state.primaryEnvironmentIdAtom),
    );
    const model = buildNoProjectsHeroModel({
      scratchAvailable: scratchTarget !== null,
      electron: true,
    });
    return {
      title: model.title,
      description: model.description,
      addProjectLabel: model.addProject.label,
      startWithoutProjectLabel: model.startWithoutProject?.label ?? null,
    };
  });

  const homeAtom = Atom.make((get): HomeView => {
    const landing = get(landingAtom);
    const view = resolveIndexDraftLandingView({
      bootstrapped: get(bootstrappedAtom),
      hasProject: get(mostRecentProjectAtom) !== null,
      startFailed: landing.failed,
    });
    if (view.kind === "none") return { kind: "none" };
    if (view.kind === "startError") {
      const model = buildDraftStartErrorModel();
      return {
        kind: "start-error",
        title: model.title,
        description: model.description,
        retryLabel: model.retry.label,
      };
    }
    return { kind: "no-projects", ...get(noProjectsHeroAtom) };
  });

  const landingTriggerAtom = Atom.make((get) => {
    const onHome = get(context.routeTargetAtom) === null && get(context.pageAtom).kind === "chat";
    const landing = get(landingAtom);
    if (!onHome) return { project: null, reset: landing.starting || landing.failed };
    if (landing.starting || landing.failed) return { project: null, reset: false };
    return { project: get(mostRecentProjectAtom), reset: false };
  });

  registry.subscribe(
    landingTriggerAtom,
    ({ project, reset }) => {
      if (reset) {
        registry.set(landingAtom, { starting: false, failed: false });
        return;
      }
      if (project === null) return;
      registry.set(landingAtom, { starting: true, failed: false });
      context
        .openNewThread(scopeProjectRef(project.environmentId, project.id), { replace: true })
        .catch(() => registry.set(landingAtom, { starting: false, failed: true }));
    },
    { immediate: true },
  );

  const heroModelAtom = Atom.make((get) => {
    if (!get(context.draftHeroStateAtom)) return null;
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const activeProjectRef = scopeProjectRef(input.thread.environmentId, input.thread.projectId);
    return {
      draftId: input.draftId,
      model: buildDraftHeroHeadlineModel({
        projects: get(state.environmentProjects.projectsAtom),
        threads: get(state.environmentThreadShells.threadShellsAtom),
        environments: get(environmentsAtom),
        primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
        projectGroupingSettings: selectProjectGroupingSettings(get(context.clientSettingsAtom)),
        projectSortOrder: get(context.clientSettingsAtom).sidebarProjectSortOrder,
        keybindings: get(keybindingsAtom),
        activeProjectRef,
        activeProjectTitle: input.project?.title ?? null,
      }),
      activeProjectTitle: input.project?.title ?? null,
    };
  });

  const draftHeroAtom = Atom.make((get): DraftHeroView | null => {
    const hero = get(heroModelAtom);
    if (hero === null) return null;
    const { model } = hero;
    const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
    const entries: DraftHeroEntryView[] = [
      ...(model.scratchWorkspaceRoot === null
        ? []
        : [
            {
              value: NO_PROJECT_VALUE,
              label: "No project",
              icon: null,
              selected: model.isScratchDraft,
              environment: null,
            },
          ]),
      ...model.menuEntries.map(({ group }) => ({
        value: group.projectKey,
        label: group.displayName,
        icon: projectIconView(group),
        selected: !model.isScratchDraft && group.projectKey === model.activeProjectKey,
        environment: model.showProjectEnvironments
          ? resolveProjectEnvironmentBadge({
              group,
              primaryEnvironmentId,
              machineByEnvironmentId: model.environmentMachineById,
            })
          : null,
      })),
    ];
    const sentence = model.isScratchDraft
      ? "scratch"
      : model.hasResolvedProject
        ? "build-in"
        : model.canChooseProject
          ? "choose"
          : "add";
    return {
      headingLabel: model.headingLabel,
      sentence,
      projectTrigger: {
        label: model.canChooseProject
          ? model.isScratchDraft
            ? "No project"
            : (model.activeProjectDisplayName ?? "Choose a project")
          : (hero.activeProjectTitle ?? "Add a project"),
        tooltip:
          model.canChooseProject && model.activeProjectDisplayName && !model.isScratchDraft
            ? model.activeProjectDisplayName
            : null,
        picker: model.canChooseProject
          ? { entries, showSeparator: model.projectPickerEntries.length > 0 }
          : null,
      },
      subline:
        model.scratchWorkspaceRoot === null
          ? null
          : {
              content: model.isScratchDraft
                ? "picker"
                : model.showStartWithoutProject
                  ? "start-without"
                  : "empty",
              shortcut: model.noProjectShortcut,
            },
    };
  });

  const scopeMenuAtom = Atom.make({ open: false, query: "" }).pipe(Atom.keepAlive);
  const snapshotsReadyAtom = createAllEnvironmentProjectSnapshotsReadyAtom({
    catalogValueAtom: state.environmentCatalog.catalogValueAtom,
    shellStateValueAtom: state.environmentShell.stateValueAtom,
    requiresPrimaryEnvironment: true,
  });
  registry.subscribe(
    Atom.make((get) => {
      const scopeKey = get(context.uiStateAtom).sidebarProjectScopeKey;
      return (
        scopeKey !== null &&
        get(snapshotsReadyAtom) &&
        !get(projectGroupsAtom).some((group) => group.projectKey === scopeKey)
      );
    }),
    (stale) => {
      if (stale) {
        context.updateUiState((current) => ({ ...current, sidebarProjectScopeKey: null }));
      }
    },
    { immediate: true },
  );

  const projectScopeAtom = Atom.make((get): ProjectScopeView => {
    const menu = get(scopeMenuAtom);
    const projectGroups = get(projectGroupsAtom);
    const scopeKey = get(context.uiStateAtom).sidebarProjectScopeKey ?? ALL_PROJECTS_VALUE;
    const environments = get(environmentsAtom);
    const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
    const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
    const machineByEnvironmentId = new Map(
      environments.map(
        (environment) =>
          [
            environment.environmentId,
            resolveEnvironmentMachineKind(environment.serverConfig),
          ] as const,
      ),
    );
    const items = [
      { value: ALL_PROJECTS_VALUE, label: "All projects", group: null },
      ...projectGroups.map((group) => ({
        value: group.projectKey,
        label: group.displayName,
        group,
      })),
    ];
    const filtered = filterSidebarProjectScopeItems({
      items,
      query: menu.query,
      matches: (item, query) => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    });
    return {
      open: menu.open,
      query: menu.query,
      placeholder: "Search projects...",
      emptyLabel: "No matching projects.",
      items: filtered.map((item) => ({
        value: item.value,
        label: item.label,
        icon: item.group === null ? null : projectIconView(item.group),
        selected: item.value === scopeKey,
        environment:
          item.group !== null && showProjectEnvironments
            ? resolveProjectEnvironmentBadge({
                group: item.group,
                primaryEnvironmentId,
                machineByEnvironmentId,
              })
            : null,
        settingsTitle:
          item.group === null ? null : `Project settings for ${item.group.displayName}`,
      })),
    };
  });

  return {
    views: {
      draftHero: draftHeroAtom,
      home: homeAtom,
      noProjectsHero: noProjectsHeroAtom,
      sidebarProjectScope: projectScopeAtom,
      ...addProject.feature.views,
    },
    actions: {
      sidebarNewThread: async (params) => {
        const { shift } = NewThreadParams(params);
        if (!shouldCreateNewThreadInCurrentProject(shift, registry.get(projectGroupsAtom).length)) {
          commandPaletteService(context).open({ open: "new-thread-in" });
          return null;
        }
        const input = registry.get(context.threadInputAtom);
        await startNewThreadFromContext({
          activeDraftThread: input?.draftThread ?? null,
          activeThread: input !== null && input.isServerThread ? input.thread : undefined,
          defaultProjectRef: defaultNewThreadProjectRef(context),
          handleNewThread: context.openNewThread,
        });
        return null;
      },
      draftHeroSelectProject: async (params) => {
        const { value } = SelectProjectParams(params);
        const hero = registry.get(heroModelAtom);
        if (hero === null || hero.draftId === null) return null;
        const { model, draftId } = hero;
        if (value === NO_PROJECT_VALUE) {
          await startHeroScratch();
          return null;
        }
        const entry = model.projectEntryByKey.get(value);
        if (!entry || value === model.activeProjectKey) return null;
        selectHeroProject(draftId, entry.targetProject, entry.group.projectKey);
        return null;
      },
      draftHeroStartScratch: async () => {
        await startHeroScratch();
        return null;
      },
      homeRetry: async () => {
        registry.set(landingAtom, { starting: false, failed: false });
        return null;
      },
      homeStartScratch: async () => {
        const target = scratchEnvironmentIdFor(
          registry.get(environmentsAtom),
          registry.get(state.primaryEnvironmentIdAtom),
        );
        if (target !== null) await startScratchThread(target);
        return null;
      },
      projectScopeOpen: async (params) => {
        const { open } = ScopeOpenParams(params);
        registry.set(scopeMenuAtom, { open, query: open ? registry.get(scopeMenuAtom).query : "" });
        return null;
      },
      projectScopeQuery: async (params) => {
        registry.set(scopeMenuAtom, {
          ...registry.get(scopeMenuAtom),
          query: ScopeQueryParams(params).query,
        });
        return null;
      },
      projectScopeSelect: async (params) => {
        const { value } = SelectProjectParams(params);
        context.updateUiState((current) => ({
          ...current,
          sidebarProjectScopeKey: value === ALL_PROJECTS_VALUE ? null : value,
        }));
        registry.set(scopeMenuAtom, { open: false, query: "" });
        return null;
      },
      ...addProject.feature.actions,
    },
  };

  function selectHeroProject(draftId: DraftId, project: Project, logicalProjectKey: string) {
    const store = useComposerDraftStore.getState();
    selectDraftHeroProject(
      {
        getComposerDraft: store.getComposerDraft,
        setLogicalProjectDraftThreadId: store.setLogicalProjectDraftThreadId,
        applyStickyState: store.applyStickyState,
        setModelSelection: store.setModelSelection,
        environments: registry.get(environmentsAtom),
      },
      draftId,
      project,
      logicalProjectKey,
    );
  }

  async function startHeroScratch(): Promise<boolean> {
    const hero = registry.get(heroModelAtom);
    if (hero === null || hero.draftId === null) return false;
    const { model, draftId } = hero;
    if (model.scratchTargetEnvironmentId === null || model.isScratchDraft) return false;
    const requested = {
      draftId,
      activeProjectKey: model.activeProjectKey,
      scratchTargetEnvironmentId: model.scratchTargetEnvironmentId,
    };
    const project = await openScratchProject(scratchDeps, model.scratchTargetEnvironmentId);
    const latest = registry.get(heroModelAtom);
    if (
      !project ||
      latest === null ||
      latest.draftId !== requested.draftId ||
      latest.model.activeProjectKey !== requested.activeProjectKey ||
      latest.model.scratchTargetEnvironmentId !== requested.scratchTargetEnvironmentId
    ) {
      return false;
    }
    selectHeroProject(
      draftId,
      project,
      deriveLogicalProjectKeyFromSettings(
        project,
        selectProjectGroupingSettings(registry.get(context.clientSettingsAtom)),
      ),
    );
    return true;
  }
}
