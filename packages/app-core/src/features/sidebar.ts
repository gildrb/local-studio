import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type SnoozePreset, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  RENAME_EMPTY_TITLE_WARNING,
  RENAME_FAILED_TITLE,
  resolveRenameCommit,
} from "@t3tools/web/src/components/chat/ChatHeader.logic.ts";
import { requestCustomSnooze } from "@t3tools/web/src/components/CustomSnoozeDialog.logic.ts";
import {
  createThreadJumpHintVisibilityController,
  resolveAdjacentThreadId,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
} from "@t3tools/web/src/components/Sidebar.logic.ts";
import { resolveSnoozePresets } from "@t3tools/web/src/components/Sidebar.snooze.ts";
import {
  buildSidebarThreadMenu,
  resolveSidebarThreadMenuIntent,
  runSidebarThreadMenuIntent,
} from "@t3tools/web/src/components/Sidebar.threadMenu.logic.ts";
import {
  resolveFrozenSidebarDraftRow,
  type SidebarDraftRowData,
} from "@t3tools/web/src/components/sidebar/sidebarDraftRows.logic.ts";
import {
  SETTLED_SHELF_EXPANDED_KEY,
  SETTLED_TAIL_INITIAL_COUNT,
  SETTLED_TAIL_PAGE_COUNT,
  SNOOZED_SHELF_EXPANDED_KEY,
  WORKING_SHELF_EXPANDED_KEY,
} from "@t3tools/web/src/components/sidebar/sidebarList.logic.ts";
import {
  createSidebarThreadLifecycle,
  resolveSidebarForwardNavigation,
} from "@t3tools/web/src/components/sidebar/sidebarThreadLifecycle.logic.ts";
import { isSidebarUtilityPage } from "@t3tools/web/src/components/sidebar/mainAppLocation.logic.ts";
import { THREAD_MENU_COPY_TOASTS } from "@t3tools/web/src/components/threadActionMenu.logic.ts";
import { DraftId, useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import type { ThreadActionToast } from "@t3tools/web/src/hooks/threadActions.logic.ts";
import {
  resolveShortcutCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "@t3tools/web/src/keybindings.ts";
import {
  markThreadUnread,
  markThreadVisited,
  setSidebarProjectScopeKey,
} from "@t3tools/web/src/uiState.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { CHAT_PAGE, appPagePath, type AppPage } from "../page.ts";
import {
  buildSidebarModel,
  buildSidebarView,
  type SidebarModelInput,
  type SidebarShelfState,
} from "../sidebarView.ts";
import { routeTerminalUiState } from "../terminalState.ts";
import { themePreferenceStore } from "../themePreference.ts";
import { coreThreadActions } from "../threadActions.ts";
import type { SidebarView } from "../views/sidebar.ts";

export type SidebarRenameView = {
  readonly threadKey: string;
  readonly title: string;
  readonly revision: number;
};

type SnoozeMenuState = {
  readonly threadKey: string;
  readonly presets: ReadonlyArray<SnoozePreset>;
};

const ShelfExpandedJson = Schema.fromJsonString(Schema.Boolean);
const decodeShelfExpanded = Schema.decodeUnknownSync(ShelfExpandedJson);
const encodeShelfExpanded = Schema.encodeSync(ShelfExpandedJson);

const SHELF_STORAGE_KEYS = {
  settled: SETTLED_SHELF_EXPANDED_KEY,
  snoozed: SNOOZED_SHELF_EXPANDED_KEY,
  working: WORKING_SHELF_EXPANDED_KEY,
} as const;

const ThreadFields = { environmentId: Schema.String, threadId: Schema.String };
const ToggleShelfParams = Schema.decodeUnknownSync(
  Schema.Struct({ shelf: Schema.Literals(["settled", "snoozed", "working"]) }),
);
const ThreadParams = Schema.decodeUnknownSync(Schema.Struct(ThreadFields));
const ContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ ...ThreadFields, x: Schema.Number, y: Schema.Number }),
);
const RowActionParams = Schema.decodeUnknownSync(
  Schema.Struct({
    ...ThreadFields,
    action: Schema.Literals([
      "settle",
      "unsettle",
      "unsnooze",
      "unpin",
      "acknowledge-woke",
      "discard-draft",
    ]),
  }),
);
const SnoozeMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ ...ThreadFields, open: Schema.Boolean }),
);
const SnoozePickParams = Schema.decodeUnknownSync(
  Schema.Struct({ ...ThreadFields, presetId: Schema.NullOr(Schema.String) }),
);
const RenameCommitParams = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String }));
const DraftParams = Schema.decodeUnknownSync(Schema.Struct({ draftId: Schema.String }));
const Modifiers = {
  metaKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
  altKey: Schema.Boolean,
};
const KeyDownParams = Schema.decodeUnknownSync(
  Schema.Struct({ ...Modifiers, key: Schema.String, repeat: Schema.Boolean }),
);
const ModifiersParams = Schema.decodeUnknownSync(Schema.Struct(Modifiers));
const FooterParams = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.Literals(["settings", "pull-requests", "usage"]),
  }),
);
const ProjectSettingsParams = Schema.decodeUnknownSync(
  Schema.Struct({ projectKey: Schema.String }),
);

const FOOTER_PAGES: Readonly<Record<"settings" | "pull-requests" | "usage", AppPage>> = {
  settings: { kind: "settings", section: "general" },
  "pull-requests": { kind: "pull-requests" },
  usage: { kind: "usage" },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

export function createSidebarFeature(context: FeatureContext): CoreFeature {
  const { registry, state, storage } = context;
  const contextMenu = contextMenuService(context);
  const clipboard = clipboardService(context);
  const threadActions = coreThreadActions(context);

  const readShelf = (key: string): boolean => {
    const raw = storage.getItem(key);
    if (raw === null) return false;
    try {
      return decodeShelfExpanded(raw);
    } catch {
      return false;
    }
  };
  const shelvesAtom = Atom.make<SidebarShelfState>({
    settled: readShelf(SETTLED_SHELF_EXPANDED_KEY),
    snoozed: readShelf(SNOOZED_SHELF_EXPANDED_KEY),
    working: readShelf(WORKING_SHELF_EXPANDED_KEY),
  }).pipe(Atom.keepAlive);
  const settledPageAtom = Atom.make<{
    readonly resetKey: string;
    readonly count: number;
  }>({
    resetKey: "all",
    count: SETTLED_TAIL_INITIAL_COUNT,
  }).pipe(Atom.keepAlive);
  const nowMinuteAtom = Atom.make((get) => {
    const timer = setInterval(() => get.setSelf(Date.now()), 60_000);
    get.addFinalizer(() => clearInterval(timer));
    return Date.now();
  });
  const draftStoreAtom = Atom.make((get) => {
    get.addFinalizer(useComposerDraftStore.subscribe((value) => get.setSelf(value)));
    return useComposerDraftStore.getState();
  });
  const undoNoticeAtom = Atom.make((get) => {
    const read = () => {
      const notice = threadActions.undoNotices.store.getState().notice;
      return notice === null ? null : { action: notice.action, count: notice.count };
    };
    get.addFinalizer(threadActions.undoNotices.store.subscribe(() => get.setSelf(read())));
    return read();
  });
  const renamingAtom = Atom.make<SidebarRenameView | null>(null).pipe(Atom.keepAlive);
  const snoozeMenuAtom = Atom.make<SnoozeMenuState | null>(null).pipe(Atom.keepAlive);
  const jumpHintsAtom = Atom.make(false).pipe(Atom.keepAlive);
  const jumpHints = createThreadJumpHintVisibilityController({
    delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
    onVisibilityChange: (visible) => registry.set(jumpHintsAtom, visible),
  });
  let renameRevision = 0;
  let frozenDraftRow: {
    readonly routeDraftId: string | null;
    readonly row: SidebarDraftRowData | null;
  } = { routeDraftId: null, row: null };

  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(state.primaryServerConfigAtom)?.keybindings ?? []),
  );
  const settledResetKey = (get: <A>(atom: Atom.Atom<A>) => A) =>
    get(context.uiStateAtom).sidebarProjectScopeKey ?? "all";

  const modelInputAtom = Atom.make((get): SidebarModelInput => {
    get(nowMinuteAtom);
    const route = get(context.routeAtom);
    const page = get(settledPageAtom);
    return {
      projects: get(state.environmentProjects.projectsAtom),
      threads: get(state.environmentThreadShells.threadShellsAtom),
      environments: get(state.environmentPresentations.presentationsAtom),
      serverConfigs: get(state.environmentServerConfigsAtom),
      primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
      clientSettings: get(context.clientSettingsAtom),
      uiState: get(context.uiStateAtom),
      shelves: get(shelvesAtom),
      settledVisibleCount:
        page.resetKey === settledResetKey(get) ? page.count : SETTLED_TAIL_INITIAL_COUNT,
      routeThreadKey: route === null ? null : scopedThreadKey(route),
    };
  });
  const modelAtom = Atom.make((get) => buildSidebarModel(get(modelInputAtom)));

  const sidebarAtom = Atom.make((get): SidebarView => {
    const modelInput = get(modelInputAtom);
    const draftStore = get(draftStoreAtom);
    const target = get(context.routeTargetAtom);
    const routeDraftId = target?.kind === "draft" ? target.draftId : null;
    if (frozenDraftRow.routeDraftId !== routeDraftId) {
      frozenDraftRow = {
        routeDraftId,
        row: resolveFrozenSidebarDraftRow(draftStore, routeDraftId),
      };
    }
    return buildSidebarView(get(modelAtom), modelInput, {
      primaryServerVersion: get(state.primaryServerConfigAtom)?.environment.serverVersion ?? null,
      keybindings: get(keybindingsAtom),
      fallbackStageLabel: context.stageLabel,
      shortcutPlatform: context.platform,
      draftStore,
      routeDraftId,
      frozenDraftRow,
      interactions: {
        renamingThreadKey: get(renamingAtom)?.threadKey ?? null,
        snoozeMenu: get(snoozeMenuAtom),
        showJumpHints: get(jumpHintsAtom),
      },
      undoNotice: get(undoNoticeAtom),
      utilityPage: isSidebarUtilityPage(appPagePath(get(context.pageAtom))),
      identificationMode: get(themePreferenceStore(context).identificationModeAtom),
    });
  });

  const currentRouteThreadKey = () => {
    const route = registry.get(context.routeAtom);
    return route === null ? null : scopedThreadKey(route);
  };
  const addToast = (toast: ThreadActionToast) => {
    context.addToast(toast);
  };
  const navigateOrToast = (page: AppPage) => {
    try {
      context.navigate(page);
    } catch (error) {
      context.addToast({
        layout: "plain",
        type: "info",
        title: errorMessage(error),
      });
    }
  };
  const readThreadShell = (ref: ScopedThreadRef) =>
    registry.get(state.environmentThreadShells.threadShellAtom(ref));

  const lifecycle = createSidebarThreadLifecycle({
    actions: threadActions.actions,
    settlingThreadKeys: new Set(),
    snoozingThreadKeys: new Set(),
    planForwardNavigation: (threadKey, coParkingKeys) => {
      const model = registry.get(modelAtom);
      const target = resolveSidebarForwardNavigation({
        threadKey,
        currentThreadKey: currentRouteThreadKey(),
        orderedKeys: model.orderedThreadKeys,
        settledKeys: model.settledThreadKeys,
        snoozedKeys: model.snoozedThreadKeys,
        coParkingKeys,
        threadByKey: model.threadByKey,
      });
      if (target === null) return null;
      switch (target.kind) {
        case "thread":
          return () => context.navigateToThread(target.threadRef);
        case "new-thread":
          return () => void context.openNewThread(target.projectRef);
        case "home":
          return () => context.navigateHome();
      }
    },
    currentRouteThreadKey,
    readThreadShell,
    addToast,
  });

  const copy = (value: string, toasts: { readonly success: string; readonly failure: string }) => {
    clipboard.writeText(value).then(
      () =>
        addToast({
          layout: "plain",
          type: "success",
          title: toasts.success,
          description: value,
        }),
      (error: unknown) =>
        addToast({
          layout: "stacked",
          type: "error",
          title: toasts.failure,
          description: errorMessage(error),
        }),
    );
  };

  const threadRefOf = (params: { readonly environmentId: string; readonly threadId: string }) =>
    scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId));

  const startRename = (threadRef: ScopedThreadRef, title: string) => {
    renameRevision += 1;
    registry.set(snoozeMenuAtom, null);
    registry.set(renamingAtom, {
      threadKey: scopedThreadKey(threadRef),
      title,
      revision: renameRevision,
    });
  };

  const openThreadMenu = async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
    const threadKey = scopedThreadKey(threadRef);
    const model = registry.get(modelAtom);
    const thread = model.threadByKey.get(threadKey);
    if (thread === undefined) return;
    const clientSettings = registry.get(context.clientSettingsAtom);
    const projectScopeKey = registry.get(context.uiStateAtom).sidebarProjectScopeKey;
    const menu = buildSidebarThreadMenu({
      thread,
      serverConfig: registry.get(state.environmentServerConfigsAtom).get(thread.environmentId),
      isSettled: model.settledThreadKeys.has(threadKey),
      isSnoozed: model.snoozedThreadKeys.has(threadKey),
      projectGroups: model.projectGroups,
      projectScopeKey,
      now: new Date(),
      timestampFormat: clientSettings.timestampFormat,
    });
    const action = await contextMenu.show(menu.items, position);
    if (action === null) return;
    const intent = resolveSidebarThreadMenuIntent({
      action,
      thread,
      menu,
      projectScopeKey,
      projectCwd:
        model.projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
        null,
      confirmThreadArchive: clientSettings.confirmThreadArchive,
      confirmThreadDelete: clientSettings.confirmThreadDelete,
    });
    await runSidebarThreadMenuIntent(
      intent,
      { threadRef, thread },
      {
        attemptSnooze: lifecycle.attemptSnooze,
        requestCustomSnooze,
        setProjectScopeKey: (projectKey) =>
          context.updateUiState((current) => setSidebarProjectScopeKey(current, projectKey)),
        openProjectSettings: (projectGroup) =>
          navigateOrToast({
            kind: "project",
            projectKey: projectGroup.projectKey,
          }),
        openNewThread: (projectRef, options) => context.openNewThread(projectRef, options),
        attemptSettle: lifecycle.attemptSettle,
        attemptUnsettle: lifecycle.attemptUnsettle,
        attemptUnsnooze: lifecycle.attemptUnsnooze,
        attemptPin: lifecycle.attemptPin,
        attemptUnpin: lifecycle.attemptUnpin,
        setThreadAutoSettle: threadActions.actions.setThreadAutoSettle,
        startRename,
        regenerateTitle: (ref) =>
          runAtomCommand(
            registry,
            state.threadEnvironment.updateMetadata,
            {
              environmentId: ref.environmentId,
              input: { threadId: ref.threadId, regenerateTitle: true },
            },
            { reportFailure: false },
          ),
        markThreadUnread: (key, latestTurnCompletedAt) =>
          context.updateUiState((current) => markThreadUnread(current, key, latestTurnCompletedAt)),
        copyPath: (path) => copy(path, THREAD_MENU_COPY_TOASTS.path),
        copyBranch: (branch) => copy(branch, THREAD_MENU_COPY_TOASTS.branch),
        copyThreadId: (threadId) => copy(threadId, THREAD_MENU_COPY_TOASTS.threadId),
        confirm: threadActions.confirm,
        archiveThread: threadActions.actions.archiveThread,
        deleteThread: threadActions.actions.deleteThread,
        addToast,
      },
    );
  };

  const navigateToThreadKey = (threadKey: string | null): boolean => {
    if (threadKey === null) return false;
    const thread = registry.get(modelAtom).threadByKey.get(threadKey);
    if (thread === undefined) return false;
    context.navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
    return true;
  };

  const shortcutContext = () => {
    const route = registry.get(context.routeAtom);
    return {
      platform: context.platform,
      context: {
        terminalFocus: false,
        terminalOpen:
          route === null ? false : routeTerminalUiState(registry.get, route).terminalOpen,
        modelPickerOpen: false,
      },
    };
  };

  return {
    views: { sidebar: sidebarAtom, sidebarRename: renamingAtom },
    actions: {
      toggleShelf: async (params) => {
        const { shelf } = ToggleShelfParams(params);
        const current = registry.get(shelvesAtom);
        const expanded = !current[shelf];
        registry.set(shelvesAtom, { ...current, [shelf]: expanded });
        storage.setItem(SHELF_STORAGE_KEYS[shelf], encodeShelfExpanded(expanded));
        return { shelf, expanded };
      },
      sidebarShowMoreSettled: async () => {
        const visible = registry.get(modelInputAtom).settledVisibleCount;
        registry.set(settledPageAtom, {
          resetKey: settledResetKey(registry.get),
          count: visible + SETTLED_TAIL_PAGE_COUNT,
        });
        return null;
      },
      sidebarThreadContextMenu: async (params) => {
        const { x, y, ...thread } = ContextMenuParams(params);
        await openThreadMenu(threadRefOf(thread), { x, y });
        return null;
      },
      sidebarThreadAction: async (params) => {
        const { action, ...target } = RowActionParams(params);
        const threadRef = threadRefOf(target);
        switch (action) {
          case "settle":
            lifecycle.attemptSettle(threadRef);
            return null;
          case "unsettle":
            lifecycle.attemptUnsettle(threadRef);
            return null;
          case "unsnooze":
            lifecycle.attemptUnsnooze(threadRef);
            return null;
          case "unpin":
            lifecycle.attemptUnpin(threadRef);
            return null;
          case "acknowledge-woke": {
            const thread = readThreadShell(threadRef);
            if (thread === null) return null;
            const wokeAt = threadWokeAt(thread, {
              now: registry.get(modelAtom).partition.snoozeNow,
            });
            if (wokeAt === null) return null;
            context.updateUiState((current) =>
              markThreadVisited(current, scopedThreadKey(threadRef), wokeAt),
            );
            return null;
          }
          case "discard-draft": {
            const store = useComposerDraftStore.getState();
            const draft = store.getComposerDraft(threadRef);
            if (draft) {
              context.attachmentUploads.releaseDraftAttachments([...draft.images, ...draft.files]);
            }
            store.clearComposerContent(threadRef);
            return null;
          }
        }
      },
      sidebarSnoozeMenu: async (params) => {
        const { open, ...target } = SnoozeMenuParams(params);
        const threadKey = scopedThreadKey(threadRefOf(target));
        if (!open) {
          if (registry.get(snoozeMenuAtom)?.threadKey === threadKey) {
            registry.set(snoozeMenuAtom, null);
          }
          return null;
        }
        registry.set(snoozeMenuAtom, {
          threadKey,
          presets: resolveSnoozePresets(
            new Date(),
            registry.get(context.clientSettingsAtom).timestampFormat,
          ),
        });
        return null;
      },
      sidebarSnoozePick: async (params) => {
        const { presetId, ...target } = SnoozePickParams(params);
        const threadRef = threadRefOf(target);
        const menu = registry.get(snoozeMenuAtom);
        registry.set(snoozeMenuAtom, null);
        if (presetId === null) {
          const choice = await requestCustomSnooze();
          if (choice) lifecycle.attemptSnooze(threadRef, choice);
          return null;
        }
        const preset = menu?.presets.find((candidate) => candidate.id === presetId);
        if (preset) lifecycle.attemptSnooze(threadRef, preset);
        return null;
      },
      sidebarRenameStart: async (params) => {
        const threadRef = threadRefOf(ThreadParams(params));
        const thread = readThreadShell(threadRef);
        if (thread === null || registry.get(renamingAtom) !== null) return null;
        startRename(threadRef, thread.title);
        return null;
      },
      sidebarRenameCancel: async () => {
        registry.set(renamingAtom, null);
        return null;
      },
      sidebarRenameCommit: async (params) => {
        const { title } = RenameCommitParams(params);
        const renaming = registry.get(renamingAtom);
        registry.set(renamingAtom, null);
        if (renaming === null) return null;
        const thread = registry.get(modelAtom).threadByKey.get(renaming.threadKey);
        if (thread === undefined) return null;
        const resolution = resolveRenameCommit({
          title,
          originalTitle: thread.title,
        });
        if (resolution.action === "reject-empty") {
          addToast({
            layout: "plain",
            type: "warning",
            title: RENAME_EMPTY_TITLE_WARNING,
          });
          return null;
        }
        if (resolution.action === "noop") return null;
        const result = await runAtomCommand(
          registry,
          state.threadEnvironment.updateMetadata,
          {
            environmentId: thread.environmentId,
            input: { threadId: thread.id, title: resolution.title },
          },
          { reportFailure: false },
        );
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          addToast({
            layout: "stacked",
            type: "error",
            title: RENAME_FAILED_TITLE,
            description: errorMessage(squashAtomCommandFailure(result)),
          });
        }
        return null;
      },
      sidebarDraftOpen: async (params) => {
        context.navigateToDraft(DraftId.make(DraftParams(params).draftId));
        return null;
      },
      sidebarDraftDiscard: async (params) => {
        const draftId = DraftId.make(DraftParams(params).draftId);
        const store = useComposerDraftStore.getState();
        const draft = store.getComposerDraft(draftId);
        if (draft) {
          context.attachmentUploads.releaseDraftAttachments([...draft.images, ...draft.files]);
        }
        store.clearDraftThread(draftId);
        return null;
      },
      sidebarKeyDown: async (params) => {
        const event = KeyDownParams(params);
        if (event.repeat) return false;
        const keybindings = registry.get(keybindingsAtom);
        const command = resolveShortcutCommand(event, keybindings, shortcutContext());
        const model = registry.get(modelAtom);
        const traversalDirection = threadTraversalDirectionFromCommand(command);
        if (traversalDirection !== null) {
          return navigateToThreadKey(
            resolveAdjacentThreadId({
              threadIds: [...model.orderedThreadKeys],
              currentThreadId: currentRouteThreadKey(),
              direction: traversalDirection,
            }),
          );
        }
        const jumpIndex = threadJumpIndexFromCommand(command ?? "");
        if (jumpIndex === null) return false;
        return navigateToThreadKey(model.orderedThreadKeys[jumpIndex] ?? null);
      },
      sidebarModifiers: async (params) => {
        jumpHints.sync(
          shouldShowThreadJumpHintsForModifiers(
            ModifiersParams(params),
            registry.get(keybindingsAtom),
            shortcutContext(),
          ),
        );
        return null;
      },
      sidebarFooterNavigate: async (params) => {
        navigateOrToast(FOOTER_PAGES[FooterParams(params).id]);
        return null;
      },
      sidebarFooterBack: async () => {
        navigateOrToast(CHAT_PAGE);
        return null;
      },
      sidebarOpenProjectSettings: async (params) => {
        navigateOrToast({
          kind: "project",
          projectKey: ProjectSettingsParams(params).projectKey,
        });
        return null;
      },
    },
  };
}
