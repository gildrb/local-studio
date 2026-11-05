import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { providerInstanceInitials } from "@t3tools/client-runtime/state/provider-instance-display";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { canonicalProjectIconName } from "@t3tools/web/src/projectIconCatalog.ts";
import {
  canSnooze,
  snoozeWakeLabel,
  type SnoozePreset,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import type {
  EnvironmentId,
  EnvironmentMachineKind,
  ResolvedKeybindingsConfig,
  ServerConfig,
} from "@t3tools/contracts";
import type { ClientSettings, EnvironmentIdentificationMode } from "@t3tools/contracts/settings";
import { resolveServerBackedAppStageLabel } from "@t3tools/web/src/branding.logic.ts";
import {
  resolveSidebarRowAccessibility,
  resolveWorkingStartedAt,
  type SidebarListItem,
  sortLogicalProjectsForSidebar,
} from "@t3tools/web/src/components/Sidebar.logic.ts";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
} from "@t3tools/web/src/components/SidebarStageBackdrop.logic.ts";
import {
  collectSidebarDraftRows,
  countVisibleSidebarDraftSessions,
  type SidebarDraftRowData,
  sidebarDraftRowPreview,
  type SidebarDraftStoreSnapshot,
} from "@t3tools/web/src/components/sidebar/sidebarDraftRows.logic.ts";
import {
  buildSidebarEnvironmentMaps,
  buildSidebarListItems,
  buildSidebarProjectByKey,
  buildSidebarProjectDisplayNameByKey,
  buildSidebarThreadJumpLabels,
  buildUnsortedSidebarProjectGroups,
  orderSidebarProjects,
  partitionSidebarThreads,
  resolveScopedSidebarProjectGroup,
  resolveShelfThreads,
  resolveSidebarEmptyState,
  resolveSidebarNewThreadShortcutLabels,
  resolveSidebarNewThreadTooltip,
  resolveSidebarRowSurface,
  resolveSidebarThreadRowState,
  resolveSidebarThreadTitleTone,
  resolveVisibleSettledThreads,
  scopedSidebarProjectKeys,
  settledTimeLabel,
  shouldFadeSidebarRow,
  type SidebarThreadPartition,
  sidebarRowAction,
  sidebarRowVariant,
  sidebarShelfHeaderLabel,
  sidebarShowMoreSettledCount,
  threadTimeLabel,
} from "@t3tools/web/src/components/sidebar/sidebarList.logic.ts";
import {
  getComposerDraftState,
  composerDraftHasUserContent,
} from "@t3tools/web/src/composerDraftStore.ts";
import type { ThreadUndoAction } from "@t3tools/web/src/hooks/showThreadUndoNotice.logic.ts";
import { shortcutLabelForCommand } from "@t3tools/web/src/keybindings.ts";
import { selectProjectGroupingSettings } from "@t3tools/web/src/logicalProject.ts";
import { deriveProjectIdentity } from "@t3tools/web/src/projectIdentity.ts";
import {
  deriveProviderEntriesByEnvironment,
  normalizeProviderAccentColor,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "@t3tools/web/src/providerInstances.ts";
import type { SidebarProjectSnapshot } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import type { UiState } from "@t3tools/web/src/uiState.logic.ts";
import { formatWorktreePathForDisplay } from "@t3tools/web/src/worktreeCleanup.ts";

import type {
  ProjectIconView,
  SidebarDraftRowView,
  SidebarItemView,
  SidebarThreadRowView,
  SidebarView,
} from "./views/sidebar.ts";

export interface SidebarShelfState {
  readonly settled: boolean;
  readonly snoozed: boolean;
  readonly working: boolean;
}

export interface SidebarModelInput {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environments: ReadonlyMap<EnvironmentId, EnvironmentPresentation>;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly clientSettings: ClientSettings;
  readonly uiState: UiState;
  readonly shelves: SidebarShelfState;
  readonly settledVisibleCount: number;
  readonly routeThreadKey: string | null;
}

export interface SidebarModel {
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly machineById: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly projectDisplayNameByKey: ReadonlyMap<string, string>;
  readonly providerEntriesByEnvironment: ReadonlyMap<
    string,
    ReadonlyMap<string, ProviderInstanceEntry>
  >;
  readonly scopedProjectGroup: SidebarProjectSnapshot | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly partition: SidebarThreadPartition;
  readonly visibleSettledThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly listItems: ReadonlyArray<SidebarListItem>;
  readonly threadByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly orderedThreadKeys: ReadonlyArray<string>;
  readonly settledThreadKeys: ReadonlySet<string>;
  readonly snoozedThreadKeys: ReadonlySet<string>;
}

export interface SidebarRowInteractions {
  readonly renamingThreadKey: string | null;
  readonly snoozeMenu: {
    readonly threadKey: string;
    readonly presets: ReadonlyArray<SnoozePreset>;
  } | null;
  readonly showJumpHints: boolean;
}

export interface SidebarViewInput {
  readonly primaryServerVersion: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly fallbackStageLabel: string;
  readonly shortcutPlatform: string;
  readonly draftStore: SidebarDraftStoreSnapshot;
  readonly routeDraftId: string | null;
  readonly frozenDraftRow: {
    readonly routeDraftId: string | null;
    readonly row: SidebarDraftRowData | null;
  };
  readonly interactions: SidebarRowInteractions;
  readonly undoNotice: {
    readonly action: ThreadUndoAction;
    readonly count: number;
  } | null;
  readonly utilityPage: boolean;
  readonly identificationMode: EnvironmentIdentificationMode;
}

export function projectIconView(
  project: Pick<EnvironmentProject, "title" | "projectIcon">,
): ProjectIconView {
  const icon = project.projectIcon;
  if (icon?.kind === "monogram") return { kind: "monogram", text: icon.text, color: icon.color };
  if (icon?.kind === "emoji") return { kind: "emoji", emoji: icon.emoji };
  if (icon?.kind === "lucide")
    return { kind: "lucide", name: canonicalProjectIconName(icon.name), color: icon.color };
  if (project.title.trim().length > 0) {
    const identity = deriveProjectIdentity(project.title);
    return { kind: "monogram", text: identity.monogram, color: identity.color };
  }
  return { kind: "folder" };
}

function environmentInputs(environments: ReadonlyMap<EnvironmentId, EnvironmentPresentation>) {
  return [...environments].map(([environmentId, presentation]) => ({
    environmentId,
    label: presentation.entry.target.label,
    serverConfig: presentation.serverConfig,
  }));
}

export function buildProjectDisplayNames(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environments: ReadonlyMap<EnvironmentId, EnvironmentPresentation>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly clientSettings: ClientSettings;
  readonly projectOrder: readonly string[];
}) {
  const environmentMaps = buildSidebarEnvironmentMaps(environmentInputs(input.environments));
  const projectGroups = sortLogicalProjectsForSidebar(
    buildUnsortedSidebarProjectGroups({
      projects: input.projects,
      orderedProjects: orderSidebarProjects(input.projects, input.projectOrder),
      sortOrder: input.clientSettings.sidebarProjectSortOrder,
      settings: selectProjectGroupingSettings(input.clientSettings),
      primaryEnvironmentId: input.primaryEnvironmentId,
      environmentLabelById: environmentMaps.labelById,
    }),
    input.threads,
    input.clientSettings.sidebarProjectSortOrder,
  );
  return { environmentMaps, projectGroups };
}

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, ProviderInstanceEntry> = new Map();

function threadKeyOf(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

export function buildSidebarModel(input: SidebarModelInput): SidebarModel {
  const { environmentMaps, projectGroups } = buildProjectDisplayNames({
    projects: input.projects,
    threads: input.threads,
    environments: input.environments,
    primaryEnvironmentId: input.primaryEnvironmentId,
    clientSettings: input.clientSettings,
    projectOrder: input.uiState.projectOrder,
  });
  const scopedProjectGroup = resolveScopedSidebarProjectGroup(
    projectGroups,
    input.uiState.sidebarProjectScopeKey,
  );
  const scopedProjectKeys = scopedSidebarProjectKeys(scopedProjectGroup);
  const partition = partitionSidebarThreads({
    threads: input.threads,
    scopedProjectKeys,
    serverConfigs: input.serverConfigs,
    workingShelfEnabled: input.clientSettings.sidebarWorkingShelfEnabled,
    optimisticDrop: null,
  });
  const visibleSettledThreads = resolveVisibleSettledThreads(
    partition.settledThreads,
    input.settledVisibleCount,
    input.routeThreadKey,
  );
  const renderedSettledThreads = resolveShelfThreads(
    visibleSettledThreads,
    input.shelves.settled,
    input.routeThreadKey,
  );
  const visibleSnoozedThreads = resolveShelfThreads(
    partition.snoozedThreads,
    input.shelves.snoozed,
    input.routeThreadKey,
  );
  const visibleWorkingThreads = resolveShelfThreads(
    partition.workingThreads,
    input.shelves.working,
    input.routeThreadKey,
  );
  const listItems = buildSidebarListItems({
    pinnedThreads: partition.pinnedThreads,
    activeThreads: partition.activeThreads,
    workingThreadCount: partition.workingThreads.length,
    visibleWorkingThreads,
    snoozedThreadCount: partition.snoozedThreads.length,
    visibleSnoozedThreads,
    settledThreadCount: partition.settledThreads.length,
    renderedSettledThreads,
  });
  const orderedThreads = [
    ...partition.pinnedThreads,
    ...partition.activeThreads,
    ...visibleWorkingThreads,
    ...visibleSnoozedThreads,
    ...renderedSettledThreads,
  ];
  return {
    projectGroups,
    machineById: environmentMaps.machineById,
    projectByKey: buildSidebarProjectByKey(input.projects),
    projectDisplayNameByKey: buildSidebarProjectDisplayNameByKey(projectGroups),
    providerEntriesByEnvironment: deriveProviderEntriesByEnvironment(
      [...input.serverConfigs].map(
        ([environmentId, config]) => [environmentId, config.providers] as const,
      ),
    ),
    scopedProjectGroup,
    scopedProjectKeys,
    partition,
    visibleSettledThreads,
    listItems,
    threadByKey: new Map(orderedThreads.map((thread) => [threadKeyOf(thread), thread])),
    orderedThreadKeys: orderedThreads.map(threadKeyOf),
    settledThreadKeys: new Set(partition.settledThreads.map(threadKeyOf)),
    snoozedThreadKeys: new Set(partition.snoozedThreads.map(threadKeyOf)),
  };
}

function buildDraftRows(model: SidebarModel, input: SidebarViewInput): SidebarItemView[] {
  const rows = collectSidebarDraftRows({
    store: input.draftStore,
    scopedProjectKeys: model.scopedProjectKeys,
    routeDraftId: input.routeDraftId,
    frozenActive: input.frozenDraftRow,
  });
  if (rows.length === 0) return [];
  const items: SidebarItemView[] = rows.map(
    ({ composer, draftId, session }): SidebarDraftRowView => {
      const projectKey = `${session.environmentId}:${session.projectId}`;
      const project = model.projectByKey.get(projectKey) ?? null;
      const projectDisplayName = model.projectDisplayNameByKey.get(projectKey) ?? null;
      const preview = sidebarDraftRowPreview(composer);
      const isActive = draftId === input.routeDraftId;
      return {
        kind: "draft",
        key: `draft:${draftId}`,
        draftId,
        preview,
        accessibilityLabel: resolveSidebarRowAccessibility({
          title: preview,
          statusLabel: "Unsent draft",
          projectDisplayName,
          isActive,
        }).label,
        isActive,
        project: {
          displayName: projectDisplayName,
          icon: project === null ? null : projectIconView(project),
        },
      };
    },
  );
  items.push({ kind: "draft-divider" });
  return items;
}

export function buildSidebarView(
  model: SidebarModel,
  modelInput: SidebarModelInput,
  input: SidebarViewInput,
): SidebarView {
  const { partition, projectGroups, scopedProjectGroup } = model;
  const jumpLabels = input.interactions.showJumpHints
    ? buildSidebarThreadJumpLabels(
        model.orderedThreadKeys,
        input.keybindings,
        input.shortcutPlatform,
      )
    : new Map<string, string>();

  const items: SidebarItemView[] = buildDraftRows(model, input);
  for (const item of model.listItems) {
    if (item.kind === "thread") {
      const thread = model.threadByKey.get(item.key);
      if (thread === undefined) continue;
      items.push(
        buildThreadRow({
          thread,
          key: item.key,
          section: item.section,
          model,
          modelInput,
          input,
          providerEntries:
            model.providerEntriesByEnvironment.get(thread.environmentId) ?? EMPTY_PROVIDER_ENTRIES,
          jumpLabel: jumpLabels.get(item.key) ?? null,
        }),
      );
      continue;
    }
    if (item.marker === "working-header") {
      items.push({
        kind: "shelf-header",
        shelf: "working",
        label: sidebarShelfHeaderLabel(
          "working",
          modelInput.shelves.working,
          partition.workingThreads.length,
        ),
        count: partition.workingThreads.length,
        expanded: modelInput.shelves.working,
        pushToBottom: true,
      });
    } else if (item.marker === "snoozed-header") {
      items.push({
        kind: "shelf-header",
        shelf: "snoozed",
        label: sidebarShelfHeaderLabel(
          "snoozed",
          modelInput.shelves.snoozed,
          partition.snoozedThreads.length,
        ),
        count: partition.snoozedThreads.length,
        expanded: modelInput.shelves.snoozed,
        pushToBottom: partition.workingThreads.length === 0,
      });
    } else if (item.marker === "settled-header") {
      items.push({
        kind: "shelf-header",
        shelf: "settled",
        label: sidebarShelfHeaderLabel(
          "settled",
          modelInput.shelves.settled,
          partition.settledThreads.length,
        ),
        count: partition.settledThreads.length,
        expanded: modelInput.shelves.settled,
        pushToBottom: partition.workingThreads.length + partition.snoozedThreads.length === 0,
      });
    }
  }
  const hiddenSettledCount = partition.settledThreads.length - model.visibleSettledThreads.length;
  if (modelInput.shelves.settled && hiddenSettledCount > 0) {
    const count = sidebarShowMoreSettledCount(hiddenSettledCount);
    items.push({ kind: "show-more", label: `Show ${count} more`, count });
  }

  const stageLabel = resolveServerBackedAppStageLabel({
    primaryServerVersion: input.primaryServerVersion,
    fallbackStageLabel: input.fallbackStageLabel,
  });
  const identificationMode = input.identificationMode;
  const shortcutLabels = resolveSidebarNewThreadShortcutLabels(
    input.keybindings,
    projectGroups.length,
    input.shortcutPlatform,
  );
  const newThreadTooltip = resolveSidebarNewThreadTooltip({
    ...shortcutLabels,
    showNewThreadInProjectHint: projectGroups.length > 1,
  });
  const emptyState = resolveSidebarEmptyState({
    isSearching: false,
    visibleDraftSessionCount: countVisibleSidebarDraftSessions(
      input.draftStore,
      model.scopedProjectKeys,
    ),
    threadCount:
      partition.pinnedThreads.length +
      partition.activeThreads.length +
      partition.workingThreads.length +
      partition.snoozedThreads.length +
      partition.settledThreads.length,
    projectCount: modelInput.projects.length,
    scopedProjectGroup,
  });
  const pullRequestsSupported = [...modelInput.environments.values()].some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const undoShortcut =
    input.undoNotice === null
      ? null
      : shortcutLabelForCommand(input.keybindings, "thread.undo", input.shortcutPlatform);

  return {
    header: {
      brandLabel: "Local Studio",
      stageBackdrop: resolveSidebarStageBackdropVariant(
        stageLabel,
        identificationMode === "artwork",
      ),
      stagePill:
        identificationMode === "pill"
          ? resolveEnvironmentIdentificationPillLabel(stageLabel)
          : null,
      search: { placeholder: "Search", query: "" },
      hasProjects: projectGroups.length > 0,
      projectScope: {
        label: scopedProjectGroup
          ? `Filter threads by project: ${scopedProjectGroup.displayName}`
          : "Filter threads by project",
        scopedProject: scopedProjectGroup
          ? {
              projectKey: scopedProjectGroup.projectKey,
              displayName: scopedProjectGroup.displayName,
              icon: projectIconView(scopedProjectGroup),
            }
          : null,
      },
      addProject: { label: "Add project" },
      newThread: {
        label: "New thread",
        tooltip: newThreadTooltip.label,
        inProjectHint: newThreadTooltip.inProjectHint,
        disabled: modelInput.projects.length === 0,
      },
    },
    items,
    emptyState:
      emptyState === null
        ? null
        : emptyState.kind === "no-projects"
          ? {
              kind: "no-projects",
              label: "No projects yet",
              actionLabel: "Add project",
            }
          : { kind: "no-threads", label: emptyState.label },
    footer: {
      undoNotice:
        input.undoNotice === null
          ? null
          : {
              text: `${input.undoNotice.action} ${input.undoNotice.count} thread${
                input.undoNotice.count === 1 ? "" : "s"
              },`,
              actionLabel: undoShortcut ? `${undoShortcut} to undo` : "Undo",
            },
      back: input.utilityPage ? { label: "Back" } : null,
      items: [
        { id: "settings", label: "Settings" },
        ...(pullRequestsSupported
          ? [{ id: "pull-requests" as const, label: "Pull Requests" }]
          : []),
        { id: "usage", label: "Usage" },
      ],
    },
  };
}

function buildThreadRow(args: {
  readonly thread: EnvironmentThreadShell;
  readonly key: string;
  readonly section: SidebarThreadRowView["section"];
  readonly model: SidebarModel;
  readonly modelInput: SidebarModelInput;
  readonly input: SidebarViewInput;
  readonly providerEntries: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly jumpLabel: string | null;
}): SidebarThreadRowView {
  const { thread, section, model, modelInput, input } = args;
  const variant = sidebarRowVariant(section);
  const action = sidebarRowAction(section);
  const isActive = modelInput.routeThreadKey === args.key;
  const capabilities = modelInput.serverConfigs.get(thread.environmentId)?.environment.capabilities;
  const settlementSupported = capabilities?.threadSettlement === true;
  const snoozeSupported = capabilities?.threadSnooze === true;
  const pinningSupported = capabilities?.threadPinning === true;
  const now = new Date().toISOString();
  const wokeAt = threadWokeAt(thread, { now: model.partition.snoozeNow });
  const rowState = resolveSidebarThreadRowState({
    thread,
    lastVisitedAt: modelInput.uiState.threadLastVisitedAtById[args.key],
    wokeAt,
    isActive,
    isSelected: false,
  });
  const hasUnsentDraft =
    !isActive &&
    composerDraftHasUserContent(
      getComposerDraftState(input.draftStore, scopeThreadRef(thread.environmentId, thread.id)),
    );
  const projectKey = `${thread.environmentId}:${thread.projectId}`;
  const project = model.projectByKey.get(projectKey) ?? null;
  const projectDisplayName = model.projectDisplayNameByKey.get(projectKey) ?? null;
  const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = args.providerEntries.get(modelInstanceId) ?? null;
  const providerDisplayName =
    providerEntry?.displayName ?? thread.session?.providerName ?? modelInstanceId;
  const worktreePath = thread.worktreePath?.trim();
  const worktreeDisplayPath = worktreePath ? formatWorktreePathForDisplay(worktreePath) : null;
  const showSnooze = snoozeSupported && canSnooze(thread, { now });
  const snoozeMenu =
    showSnooze && input.interactions.snoozeMenu?.threadKey === args.key
      ? input.interactions.snoozeMenu.presets
      : null;
  return {
    kind: "thread",
    key: args.key,
    environmentId: thread.environmentId,
    threadId: thread.id,
    section,
    variant,
    action,
    title: thread.title,
    titleTone: resolveSidebarThreadTitleTone({
      variant,
      shouldRecede: rowState.shouldRecede,
      isUnread: rowState.isUnread,
      isWoke: rowState.isWoke,
      isActive,
      status: rowState.status,
    }),
    titleWeight: rowState.shouldRecede ? "normal" : "medium",
    regeneratingTitle: thread.titleRegeneration != null,
    renaming: input.interactions.renamingThreadKey === args.key,
    accessibilityLabel: resolveSidebarRowAccessibility({
      title: thread.title,
      statusLabel: rowState.topStatus?.label ?? null,
      projectDisplayName,
      isActive,
    }).label,
    isActive,
    surface: resolveSidebarRowSurface({
      isActive,
      isSelected: false,
      hasUnsentDraft,
      shouldRecede: rowState.shouldRecede,
    }),
    hasUnsentDraft,
    fadeRow: shouldFadeSidebarRow({
      shouldRecede: rowState.shouldRecede,
      status: rowState.status,
    }),
    settledDim: action === "unsettle",
    project: {
      displayName: projectDisplayName,
      icon: project === null ? null : projectIconView(project),
      dimmed: variant === "slim" && (!isActive || action === "unsettle"),
    },
    status:
      rowState.topStatus === null
        ? null
        : {
            kind: rowState.topStatus.icon,
            label: rowState.topStatus.label,
            workingStartedAt:
              rowState.status === "working" ? resolveWorkingStartedAt(thread) : null,
          },
    timeLabel: action === "unsettle" ? settledTimeLabel(thread) : threadTimeLabel(thread),
    snoozeWakeLabel:
      section === "snoozed" && thread.snoozedUntil != null
        ? snoozeWakeLabel(thread.snoozedUntil, { now })
        : null,
    wokeAt: rowState.isWoke ? wokeAt : null,
    pin: thread.pinnedAt != null ? { canUnpin: pinningSupported } : null,
    actions: {
      settle: settlementSupported && action === "settle",
      unsettle: settlementSupported && action === "unsettle",
      unsnooze: snoozeSupported && action === "unsnooze",
      snooze: variant === "card" && showSnooze,
    },
    snoozeMenu:
      snoozeMenu === null
        ? null
        : {
            items: snoozeMenu.map((preset) => ({
              id: preset.id,
              label: preset.label,
              shortcut: preset.whenLabel,
            })),
            customLabel: "Custom…",
          },
    branch: thread.branch ?? null,
    worktree:
      worktreeDisplayPath === null
        ? null
        : {
            displayPath: worktreeDisplayPath,
            tooltip: thread.branch
              ? `Worktree: ${worktreeDisplayPath} (${thread.branch})`
              : `Worktree: ${worktreeDisplayPath}`,
          },
    terminal: null,
    pullRequest: null,
    remoteMachine:
      thread.environmentId !== modelInput.primaryEnvironmentId
        ? (model.machineById.get(thread.environmentId) ?? "server")
        : null,
    provider:
      providerEntry === null
        ? null
        : {
            driverKind: providerEntry.driverKind,
            displayName: providerDisplayName,
            accentColor: normalizeProviderAccentColor(providerEntry.accentColor) ?? null,
            showBadge: shouldShowInstanceBadge(providerEntry, args.providerEntries.values()),
            initials: providerInstanceInitials(providerDisplayName),
          },
    jumpLabel: args.jumpLabel,
  };
}
