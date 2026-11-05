import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  buildChatHeaderModel,
  type ChatHeaderTitleModel,
  GENERIC_ERROR_DESCRIPTION,
  type HeaderContextMenuAction,
  PROJECT_SETTINGS_CONTEXT_MENU_ITEMS,
  RENAME_EMPTY_TITLE_WARNING,
  RENAME_FAILED_TITLE,
  resolveHeaderContextMenuAction,
  resolveRenameCommit,
  resolveTitleClickAction,
  shouldStartRenameFromDoubleClick,
  TITLE_MENU_OPEN_DELAY_MS,
} from "@t3tools/web/src/components/chat/ChatHeader.logic.ts";
import { requestCustomSnooze } from "@t3tools/web/src/components/CustomSnoozeDialog.logic.ts";
import {
  buildHeaderThreadActionMenu,
  resolveHeaderThreadMenuIntent,
} from "@t3tools/web/src/components/threadActionMenu.logic.ts";
import {
  resolveThreadProjectSettingsKey,
  runHeaderThreadMenuIntent,
} from "@t3tools/web/src/hooks/headerThreadMenu.logic.ts";
import { deriveLogicalProjectKeyFromSettings } from "@t3tools/web/src/logicalProject.ts";
import { markThreadUnread } from "@t3tools/web/src/uiState.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import { type ContextMenuPosition, contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext, ThreadInput } from "../feature.ts";
import { coreThreadActions } from "../threadActions.ts";

export type ThreadTitleView = {
  readonly threadKey: string;
  readonly title: ChatHeaderTitleModel;
  readonly renameRevision: number;
  readonly contextMenu: HeaderContextMenuAction;
};

type Renaming = { readonly threadKey: string; readonly title: string; readonly revision: number };

const Position = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const TitleClickParams = Schema.decodeUnknownSync(
  Schema.Struct({
    clickCount: Schema.Number,
    onChevron: Schema.Boolean,
    hasModifier: Schema.Boolean,
    anchor: Position,
  }),
);
const ContextMenuParams = Schema.decodeUnknownSync(Position);
const RenameCommitParams = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String }));

function threadKeyOf(input: ThreadInput): string {
  return input.isServerThread || input.draftId === null
    ? scopedThreadKey(input.route)
    : `draft:${input.draftId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : GENERIC_ERROR_DESCRIPTION;
}

export function createThreadHeaderFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const contextMenu = contextMenuService(context);
  const clipboard = clipboardService(context);
  const threadActions = coreThreadActions(context);
  const renamingAtom = Atom.make<Renaming | null>(null).pipe(Atom.keepAlive);
  let renameRevision = 0;
  let pendingMenu: ReturnType<typeof setTimeout> | null = null;

  const cancelPendingMenu = () => {
    if (pendingMenu === null) return;
    clearTimeout(pendingMenu);
    pendingMenu = null;
  };

  const draftProjectSettingsKey = (input: ThreadInput): string | null =>
    !input.isServerThread && input.project !== undefined
      ? deriveLogicalProjectKeyFromSettings(
          input.project,
          selectProjectGroupingSettings(input.clientSettings),
        )
      : null;

  const titleAtom = Atom.make((get): ThreadTitleView | null => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const threadKey = threadKeyOf(input);
    const renaming = get(renamingAtom);
    const renamingTitle = renaming?.threadKey === threadKey ? renaming.title : null;
    const model = buildChatHeaderModel({
      activeProject: input.project === undefined ? null : { title: input.project.title },
      activeThreadTitle: input.thread.title,
      isServerThread: input.isServerThread,
      renamingTitle,
      hasProjectScripts: false,
      showOpenInPicker: false,
      gitCwd: null,
      actionsCollapsed: false,
    });
    return {
      threadKey,
      title: model.title,
      renameRevision: renamingTitle === null ? 0 : (renaming?.revision ?? 0),
      contextMenu: resolveHeaderContextMenuAction({
        isRenaming: renamingTitle !== null,
        targetInActions: false,
        isServerThread: input.isServerThread,
        hasProjectSettings: draftProjectSettingsKey(input) !== null,
      }),
    };
  });

  let lastThreadKey: string | null = null;
  registry.subscribe(
    context.threadInputAtom,
    (input) => {
      const threadKey = input === null ? null : threadKeyOf(input);
      if (threadKey === lastThreadKey) return;
      lastThreadKey = threadKey;
      cancelPendingMenu();
      if (registry.get(renamingAtom) !== null) registry.set(renamingAtom, null);
    },
    { immediate: true },
  );

  const currentInput = () => registry.get(context.threadInputAtom);

  const startRename = (threadKey: string, title: string) => {
    renameRevision += 1;
    registry.set(renamingAtom, { threadKey, title, revision: renameRevision });
  };

  const navigateToProjectSettings = (projectKey: string) => {
    try {
      context.navigate({ kind: "project", projectKey });
    } catch (error) {
      context.addToast({ layout: "plain", type: "info", title: errorMessage(error) });
    }
  };

  const openThreadMenu = async (position: ContextMenuPosition) => {
    const input = currentInput();
    if (input === null || !input.isServerThread) return;
    const threadRef: ScopedThreadRef = input.route;
    const thread = registry.get(state.environmentThreadShells.threadShellAtom(threadRef));
    if (thread === null) return;
    const capabilities = registry
      .get(state.environmentServerConfigsAtom)
      .get(threadRef.environmentId)?.environment.capabilities;
    const clientSettings = registry.get(context.clientSettingsAtom);
    const menu = buildHeaderThreadActionMenu({
      thread,
      supports: {
        settlement: capabilities?.threadSettlement === true,
        autoSettleOptOut: capabilities?.threadAutoSettleOptOut === true,
        snooze: capabilities?.threadSnooze === true,
        pinning: capabilities?.threadPinning === true,
        titleRegeneration: capabilities?.threadTitleRegeneration === true,
      },
      now: new Date(),
      timestampFormat: clientSettings.timestampFormat,
    });
    const action = await contextMenu.show(menu.items, position);
    if (action === null) return;
    const intent = resolveHeaderThreadMenuIntent({
      action,
      thread,
      snoozePresets: menu.snoozePresets,
      isRegeneratingTitle: menu.isRegeneratingTitle,
      projectCwd: input.project?.workspaceRoot ?? null,
      confirmThreadArchive: clientSettings.confirmThreadArchive,
      confirmThreadDelete: clientSettings.confirmThreadDelete,
    });
    await runHeaderThreadMenuIntent(
      intent,
      { threadRef, thread },
      {
        actions: threadActions.actions,
        requestCustomSnooze,
        openProjectSettings: (current) => {
          const projectKey = resolveThreadProjectSettingsKey({
            thread: current,
            projects: registry.get(state.environmentProjects.projectsAtom),
            settings: selectProjectGroupingSettings(registry.get(context.clientSettingsAtom)),
            primaryEnvironmentId: registry.get(state.primaryEnvironmentIdAtom),
          });
          if (projectKey !== null) navigateToProjectSettings(projectKey);
        },
        openNewThread: (projectRef, options) => context.openNewThread(projectRef, options),
        startRename: () => startRename(scopedThreadKey(threadRef), thread.title),
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
        markThreadUnread: (threadKey, latestTurnCompletedAt) =>
          context.updateUiState((current) =>
            markThreadUnread(current, threadKey, latestTurnCompletedAt),
          ),
        writeClipboard: async (value) => {
          if (!value) return false;
          await clipboard.writeText(value);
          return true;
        },
        confirm: threadActions.confirm,
        readThreadShell: (ref) => registry.get(state.environmentThreadShells.threadShellAtom(ref)),
        addToast: (toast) => {
          context.addToast(toast);
        },
      },
    );
  };

  const openProjectSettingsMenu = async (position: ContextMenuPosition) => {
    const input = currentInput();
    if (input === null) return;
    const projectKey = draftProjectSettingsKey(input);
    if (projectKey === null) return;
    const action = await contextMenu.show(PROJECT_SETTINGS_CONTEXT_MENU_ITEMS, position);
    if (action === "project-settings") navigateToProjectSettings(projectKey);
  };

  return {
    views: { threadTitle: titleAtom },
    actions: {
      threadTitleClick: async (params) => {
        const { clickCount, onChevron, hasModifier, anchor } = TitleClickParams(params);
        const input = currentInput();
        if (input === null || !input.isServerThread) return null;
        if (
          clickCount === 2 &&
          shouldStartRenameFromDoubleClick({ hasModifier, clickedChevron: onChevron })
        ) {
          cancelPendingMenu();
          startRename(threadKeyOf(input), input.thread.title);
          return null;
        }
        const clickAction = resolveTitleClickAction({
          clickDetail: clickCount,
          clickedChevron: onChevron,
          hasDesktopBridge: true,
        });
        if (clickAction === "ignore") return null;
        cancelPendingMenu();
        if (clickAction === "open-now") {
          await openThreadMenu(anchor);
          return null;
        }
        pendingMenu = setTimeout(() => {
          pendingMenu = null;
          void openThreadMenu(anchor);
        }, TITLE_MENU_OPEN_DELAY_MS);
        return null;
      },
      threadTitleCancelPendingMenu: async () => {
        cancelPendingMenu();
        return null;
      },
      threadHeaderContextMenu: async (params) => {
        const position = ContextMenuParams(params);
        const view = registry.get(titleAtom);
        if (view === null || view.contextMenu === "ignore") return null;
        cancelPendingMenu();
        if (view.contextMenu === "project-settings-menu") {
          await openProjectSettingsMenu(position);
        } else {
          await openThreadMenu(position);
        }
        return null;
      },
      threadTitleRenameStart: async () => {
        const input = currentInput();
        if (input === null || !input.isServerThread) return null;
        cancelPendingMenu();
        startRename(threadKeyOf(input), input.thread.title);
        return null;
      },
      threadTitleRenameCancel: async () => {
        registry.set(renamingAtom, null);
        return null;
      },
      threadTitleRenameCommit: async (params) => {
        const { title } = RenameCommitParams(params);
        const input = currentInput();
        const renaming = registry.get(renamingAtom);
        registry.set(renamingAtom, null);
        if (input === null || renaming === null || renaming.threadKey !== threadKeyOf(input)) {
          return null;
        }
        const resolution = resolveRenameCommit({ title, originalTitle: input.thread.title });
        if (resolution.action === "reject-empty") {
          context.addToast({ layout: "plain", type: "warning", title: RENAME_EMPTY_TITLE_WARNING });
          return null;
        }
        if (resolution.action === "noop") return null;
        const result = await runAtomCommand(
          registry,
          state.threadEnvironment.updateMetadata,
          {
            environmentId: input.route.environmentId,
            input: { threadId: input.route.threadId, title: resolution.title },
          },
          { reportFailure: false },
        );
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          context.addToast({
            layout: "plain",
            type: "error",
            title: RENAME_FAILED_TITLE,
            description: errorMessage(squashAtomCommandFailure(result)),
          });
        }
        return null;
      },
    },
  };
}
