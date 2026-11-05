import type { ContextMenuItem, EnvironmentId } from "@t3tools/contracts";

import type { RemoteOpenMode } from "../../remoteOpen.logic";
import { isTrailingDoubleClick } from "../Sidebar.logic";

// How long a click on the thread title waits before opening the action menu,
// so a double-click-to-rename can cancel it first. Only the native desktop
// menu needs this: it swallows input while open, so the wait must cover the
// OS double-click interval. The browser fallback menu keeps seeing DOM
// events (the second click dismisses it and dblclick still fires), so it
// opens immediately.
export const TITLE_MENU_OPEN_DELAY_MS = 500;

export const RENAME_EMPTY_TITLE_WARNING = "Thread title cannot be empty";
export const RENAME_FAILED_TITLE = "Failed to rename thread";
export const GENERIC_ERROR_DESCRIPTION = "An error occurred.";

export const PROJECT_SETTINGS_CONTEXT_MENU_ITEMS: ReadonlyArray<
  ContextMenuItem<"project-settings">
> = [{ id: "project-settings", label: "Project settings", icon: "settings" }];

/** Below this width of the header row, the header actions move into the overflow menu. */
export const HEADER_ACTIONS_COLLAPSE_WIDTH_PX = 512;
// Matches the @3xl/header-actions container breakpoint owned by the chat header.
export const HEADER_ACTIONS_EXPANDED_BREAKPOINT_REM = 48;
const REM_PX = 16;

export type HeaderActionsLayout = {
  /** Side panels can leave a desktop header narrower than a phone. */
  readonly actionsCollapsed: boolean;
  /** At the @3xl container breakpoint the action buttons show their labels. */
  readonly actionsExpanded: boolean;
};

export function resolveHeaderActionsLayout(input: {
  readonly containerWidth: number;
  readonly isMobile: boolean;
}): HeaderActionsLayout {
  return {
    actionsCollapsed: input.isMobile || input.containerWidth < HEADER_ACTIONS_COLLAPSE_WIDTH_PX,
    actionsExpanded: input.containerWidth >= HEADER_ACTIONS_EXPANDED_BREAKPOINT_REM * REM_PX,
  };
}

/**
 * Rename commit rule shared with the sidebar's inline rename: trim, reject
 * empty (the caller toasts), and skip the mutation when nothing changed.
 */
export function resolveRenameCommit(input: {
  readonly title: string;
  readonly originalTitle: string;
}): { action: "commit"; title: string } | { action: "reject-empty" } | { action: "noop" } {
  const trimmed = input.title.trim();
  if (trimmed.length === 0) return { action: "reject-empty" };
  if (trimmed === input.originalTitle) return { action: "noop" };
  return { action: "commit", title: trimmed };
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.activeProjectName) return false;
  if (
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  ) {
    return true;
  }
  // Remote environments get the picker in deep-link mode (or its explicit
  // "no SSH route" state). Non-primary local backends (e.g. WSL) keep it
  // hidden, matching pre-remote behavior.
  return input.remoteOpenMode !== "local-exec";
}

export type ChatHeaderTitleModel =
  | { readonly kind: "renaming"; readonly draft: string; readonly ariaLabel: string }
  | {
      readonly kind: "menu";
      readonly text: string;
      readonly ariaLabel: string;
      readonly tooltip: string;
    }
  | {
      readonly kind: "static";
      readonly text: string;
      readonly ariaLabel: string;
      readonly tooltip: string;
    };

export interface ChatHeaderInput {
  readonly activeProject: { readonly title: string } | null;
  readonly activeThreadTitle: string;
  readonly isServerThread: boolean;
  readonly renamingTitle: string | null;
  readonly hasProjectScripts: boolean;
  readonly showOpenInPicker: boolean;
  readonly gitCwd: string | null;
  readonly actionsCollapsed: boolean;
}

export interface ChatHeaderModel {
  readonly breadcrumbAriaLabel: string;
  readonly projectCrumb: { readonly label: string; readonly newThreadLabel: string } | null;
  readonly title: ChatHeaderTitleModel;
  readonly actions: {
    readonly presentation: "toolbar" | "menu";
    readonly showProjectScripts: boolean;
    readonly showOpenInPicker: boolean;
    readonly showGitActions: boolean;
    readonly separatorBeforeOpenIn: boolean;
    readonly separatorBeforeGit: boolean;
    readonly overflowTriggerVisible: boolean;
    readonly overflowTriggerAriaLabel: string;
    readonly overflowMenuAriaLabel: string;
  };
}

export function buildChatHeaderModel(input: ChatHeaderInput): ChatHeaderModel {
  const projectName = input.activeProject?.title;
  const showGitActions = Boolean(projectName && input.gitCwd);
  const title: ChatHeaderTitleModel =
    input.renamingTitle !== null
      ? { kind: "renaming", draft: input.renamingTitle, ariaLabel: "Thread title" }
      : input.isServerThread
        ? {
            kind: "menu",
            text: input.activeThreadTitle,
            ariaLabel: `Thread actions for ${input.activeThreadTitle}`,
            tooltip: input.activeThreadTitle,
          }
        : {
            kind: "static",
            text: input.activeThreadTitle,
            ariaLabel: input.activeThreadTitle,
            tooltip: input.activeThreadTitle,
          };
  return {
    breadcrumbAriaLabel: "Thread breadcrumb",
    projectCrumb: input.activeProject
      ? {
          label: input.activeProject.title,
          newThreadLabel: `New thread in ${input.activeProject.title}`,
        }
      : null,
    title,
    actions: {
      presentation: input.actionsCollapsed ? "menu" : "toolbar",
      showProjectScripts: input.hasProjectScripts,
      showOpenInPicker: input.showOpenInPicker,
      showGitActions,
      separatorBeforeOpenIn: input.actionsCollapsed && input.hasProjectScripts,
      separatorBeforeGit:
        input.actionsCollapsed && (input.hasProjectScripts || input.showOpenInPicker),
      overflowTriggerVisible:
        input.actionsCollapsed &&
        (input.hasProjectScripts || input.showOpenInPicker || showGitActions),
      overflowTriggerAriaLabel: "More header actions",
      overflowMenuAriaLabel: "Header actions",
    },
  };
}

export type TitleClickAction = "ignore" | "open-now" | "open-delayed";

export function resolveTitleClickAction(input: {
  readonly clickDetail: number;
  readonly clickedChevron: boolean;
  readonly hasDesktopBridge: boolean;
}): TitleClickAction {
  // The trailing click of a double-click belongs to rename, not the menu.
  if (isTrailingDoubleClick(input.clickDetail)) return "ignore";
  // Keyboard activation and the explicit chevron affordance can never be
  // the first half of a double-click, so they open without waiting.
  if (input.clickDetail === 0 || input.clickedChevron || !input.hasDesktopBridge) {
    return "open-now";
  }
  return "open-delayed";
}

export function shouldStartRenameFromDoubleClick(input: {
  readonly hasModifier: boolean;
  readonly clickedChevron: boolean;
}): boolean {
  // The chevron is the explicit menu affordance; only the title text renames.
  return !input.hasModifier && !input.clickedChevron;
}

export type HeaderContextMenuAction = "ignore" | "project-settings-menu" | "thread-menu";

export function resolveHeaderContextMenuAction(input: {
  readonly isRenaming: boolean;
  readonly targetInActions: boolean;
  readonly isServerThread: boolean;
  readonly hasProjectSettings: boolean;
}): HeaderContextMenuAction {
  if (input.isRenaming) return "ignore";
  // The right-side controls (git, scripts, open-in) keep their own
  // behavior; only the breadcrumb area opens the thread menu.
  if (input.targetInActions) return "ignore";
  if (!input.isServerThread && !input.hasProjectSettings) return "ignore";
  return input.isServerThread ? "thread-menu" : "project-settings-menu";
}

export type RenameKeyAction = "none" | "commit" | "cancel";

export function resolveRenameKeyAction(input: {
  readonly key: string;
  readonly isComposing: boolean;
  readonly keyCode: number;
}): RenameKeyAction {
  if (input.isComposing || input.keyCode === 229) return "none";
  if (input.key === "Enter") return "commit";
  if (input.key === "Escape") return "cancel";
  return "none";
}
