import type { TerminalSessionState } from "@t3tools/client-runtime/state/terminal";
import type { ContextMenuItem, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  isDiffToggleShortcut,
  isTerminalClearShortcut,
  isTerminalCloseShortcut,
  isTerminalNewShortcut,
  isTerminalSplitShortcut,
  isTerminalSplitVerticalShortcut,
  isTerminalToggleShortcut,
  terminalDeleteShortcutData,
  terminalNavigationShortcutData,
  type ShortcutEventLike,
} from "../keybindings";
import {
  normalizeTerminalGroups,
  normalizeTerminalIds,
  type TerminalGroupLike,
} from "../terminalUiState.logic";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from "../types";

export type TerminalSplitDirection = "horizontal" | "vertical";
export type TerminalChromeMode = "drawer" | "panel";
export type TerminalChromeOwner = "right-panel" | "drawer";
export type TerminalActionId = "split-horizontal" | "split-vertical" | "new" | "close";
export type TerminalActionIcon = "split-horizontal" | "split-vertical" | "plus" | "trash";
export type TerminalGroupKind = "single" | "side-by-side" | "stacked";
export type TerminalGroupIcon = "square" | "split-horizontal" | "split-vertical";

export type TerminalTabsModelInput = {
  readonly mode: TerminalChromeMode;
  readonly terminalIds: readonly string[];
  readonly activeTerminalId: string;
  readonly terminalGroups: readonly TerminalGroupLike[];
  readonly activeTerminalGroupId: string;
  readonly terminalLabelsById?: ReadonlyMap<string, string> | undefined;
  readonly splitShortcutLabel?: string | null | undefined;
  readonly splitVerticalShortcutLabel?: string | null | undefined;
  readonly newShortcutLabel?: string | null | undefined;
  readonly closeShortcutLabel?: string | null | undefined;
};

export type TerminalActionModel = {
  readonly id: TerminalActionId;
  readonly label: string;
  readonly icon: TerminalActionIcon;
  readonly disabled: boolean;
};

export type TerminalTabModel = {
  readonly terminalId: string;
  readonly label: string;
  readonly active: boolean;
  readonly closeLabel: string;
  readonly icon: "terminal";
};

export type TerminalGroupModel = {
  readonly id: string;
  readonly kind: TerminalGroupKind;
  readonly label: string;
  readonly icon: TerminalGroupIcon;
  readonly active: boolean;
  readonly terminalCount: number;
  readonly activateTerminalId: string;
  readonly splitDirection: TerminalSplitDirection;
  readonly tabs: TerminalTabModel[];
};

export type TerminalViewportModel = {
  readonly terminalId: string;
  readonly label: string;
  readonly active: boolean;
  readonly autoFocus: boolean;
};

export type TerminalTabsEmptyModel = {
  readonly kind: "empty";
  readonly mode: TerminalChromeMode;
  readonly owner: TerminalChromeOwner;
  readonly resizable: boolean;
  readonly message: string;
  readonly newAction: TerminalActionModel;
};

export type TerminalTabsReadyModel = {
  readonly kind: "ready";
  readonly mode: TerminalChromeMode;
  readonly owner: TerminalChromeOwner;
  readonly resizable: boolean;
  readonly terminalIds: string[];
  readonly activeTerminalId: string;
  readonly activeGroupId: string | null;
  readonly visibleTerminalIds: string[];
  readonly splitDirection: TerminalSplitDirection;
  readonly isSplitView: boolean;
  readonly showSidebar: boolean;
  readonly showGroupHeaders: boolean;
  readonly splitLimitReached: boolean;
  readonly maxTerminalsPerGroup: number;
  readonly actions: TerminalActionModel[];
  readonly viewports: TerminalViewportModel[];
  readonly groups: TerminalGroupModel[];
};

export type TerminalTabsModel = TerminalTabsEmptyModel | TerminalTabsReadyModel;

export type TerminalLaunchLocation = {
  readonly cwd: string;
  readonly worktreePath?: string | null;
  readonly runtimeEnv?: Record<string, string>;
};

export type TerminalLaunchLocationInput = {
  readonly terminalId: string;
  readonly launchLocationsById?: ReadonlyMap<string, TerminalLaunchLocation> | undefined;
  readonly cwd: string;
  readonly worktreePath?: string | null | undefined;
  readonly runtimeEnv?: Record<string, string> | undefined;
};

export type TerminalActionIntent =
  | { readonly kind: "split"; readonly direction: TerminalSplitDirection }
  | { readonly kind: "new" }
  | { readonly kind: "request-close"; readonly terminalId: string }
  | { readonly kind: "none" };

export type TerminalActionInput = {
  readonly action: TerminalActionId;
  readonly splitLimitReached: boolean;
  readonly activeTerminalId: string;
};

export type TerminalSelectSource = "tab" | "group" | "pane";

export type TerminalSelectInput = {
  readonly source: TerminalSelectSource;
  readonly terminalId: string;
  readonly activeTerminalId: string;
};

export type TerminalSelectIntent =
  | { readonly kind: "activate"; readonly terminalId: string }
  | { readonly kind: "none" };

export type TerminalCloseReason = "user" | "session-exited";

export type TerminalCloseRequestInput = {
  readonly terminalId: string;
  readonly reason: TerminalCloseReason;
  readonly terminalLabelsById?: ReadonlyMap<string, string> | undefined;
};

export type TerminalCloseIntent =
  | {
      readonly kind: "confirm-close";
      readonly terminalId: string;
      readonly confirmLabels: readonly [string];
      readonly confirmMessage: string;
    }
  | { readonly kind: "close"; readonly terminalId: string };

export type TerminalKeyInput = {
  readonly event: ShortcutEventLike;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
};

export type TerminalKeyIntent =
  | { readonly kind: "block-close-shortcut" }
  | { readonly kind: "defer-to-app" }
  | { readonly kind: "send-input"; readonly data: string; readonly failureMessage: string }
  | { readonly kind: "pass-through" };

export type TerminalSurfaceTerminals = {
  readonly terminalIds: string[];
  readonly activeTerminalId: string;
};

export type TerminalSurfaceSplitPatch = {
  terminalIds: string[];
  activeTerminalId: string;
  splitDirection?: "vertical";
};

export type TerminalSurfaceCloseIntent =
  | { readonly kind: "close-surface" }
  | {
      readonly kind: "update-terminals";
      readonly terminalIds: string[];
      readonly activeTerminalId: string;
    };

export type TerminalSessionStatus = TerminalSessionState["status"];

export type TerminalContextMenuAction = "add-to-chat" | "copy" | "paste";

export const TERMINAL_EMPTY_MESSAGE = "No terminal sessions for this thread yet.";
export const TERMINAL_MIN_DRAWER_HEIGHT = 180;
export const TERMINAL_MAX_DRAWER_HEIGHT_RATIO = 0.75;
export const SCRIPT_TERMINAL_COLS = 120;
export const SCRIPT_TERMINAL_ROWS = 30;

/** Same terminal ids (order ignored) — avoids reconcile when only server session ordering differs. */
export function terminalIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 0) {
    return true;
  }
  const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
  const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Server knows about fewer sessions than the client, but every server id still exists locally.
 * Typical right after `terminal.open`: known-session list lags; reconciling would drop the new id
 * and later re-add it as a separate group (no split layout).
 */
export function serverTerminalIdsStrictSubsetOfClient(
  serverIds: readonly string[],
  clientIds: readonly string[],
): boolean {
  if (serverIds.length >= clientIds.length || clientIds.length === 0) {
    return false;
  }
  const clientSet = new Set(clientIds);
  for (const id of serverIds) {
    if (!clientSet.has(id)) {
      return false;
    }
  }
  return true;
}

export function clampTerminalDrawerHeight(height: number, viewportHeight: number | null): number {
  const safeHeight = Number.isFinite(height) ? height : DEFAULT_THREAD_TERMINAL_HEIGHT;
  const maxHeight =
    viewportHeight === null
      ? DEFAULT_THREAD_TERMINAL_HEIGHT
      : Math.max(
          TERMINAL_MIN_DRAWER_HEIGHT,
          Math.floor(viewportHeight * TERMINAL_MAX_DRAWER_HEIGHT_RATIO),
        );
  return Math.min(Math.max(Math.round(safeHeight), TERMINAL_MIN_DRAWER_HEIGHT), maxHeight);
}

export function formatTerminalSystemMessage(message: string): string {
  return `\r\n[terminal] ${message}\r\n`;
}

export function terminalExitMessage(status: TerminalSessionStatus): string {
  return status === "closed" ? "Terminal closed" : "Process exited";
}

export function terminalInitFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unable to initialize libghostty-vt";
  return `${message} — close and reopen the terminal to retry.`;
}

export function terminalCloseConfirmMessage(labels: readonly [string, ...string[]]): string {
  return labels.length === 1
    ? [
        `Close terminal "${labels[0]}"?`,
        "This stops the running process and clears its history.",
      ].join("\n")
    : [
        `Close ${labels.length} terminals?`,
        `This stops their running processes and clears their histories: ${labels
          .map((label) => `"${label}"`)
          .join(", ")}.`,
      ].join("\n");
}

export function terminalSelectionLineRange(position: {
  start: { y: number };
  end: { y: number };
}): { lineStart: number; lineEnd: number } {
  const lineStart = position.start.y + 1;
  return {
    lineStart,
    lineEnd: Math.max(lineStart, position.end.y + 1),
  };
}

/** Post-selection popup: available selection actions, always enabled. */
export function terminalSelectionMenuItems(options?: {
  canAddToChat?: boolean;
}): ContextMenuItem<"add-to-chat" | "copy">[] {
  return [
    ...(options?.canAddToChat === false
      ? []
      : ([{ id: "add-to-chat", label: "Add to chat" }] satisfies ContextMenuItem<"add-to-chat">[])),
    { id: "copy", label: "Copy" },
  ];
}

/**
 * Right-click menu for the terminal canvas: the selection actions (disabled
 * until a selection exists) plus Paste. Paste is always offered: the browser
 * (and Electron's default editing menu) can only paste into an editable
 * element, so a canvas terminal never gets a usable entry from them.
 */
export function terminalContextMenuItems(options: {
  hasSelection: boolean;
  canAddToChat?: boolean;
}): ContextMenuItem<TerminalContextMenuAction>[] {
  const { hasSelection, canAddToChat = true } = options;
  return [
    ...terminalSelectionMenuItems({ canAddToChat }).map((item) => ({
      ...item,
      disabled: !hasSelection,
    })),
    { id: "paste", label: "Paste" },
  ];
}

/**
 * An empty selection change may only cancel a selection-action flow that is
 * still current: a pending popup timer, or an open popup whose request id has
 * not been superseded. A popup already superseded by a right-click keeps its
 * menu promise unsettled for a moment; treating it as active would cancel the
 * newer context-menu flow instead.
 */
export function shouldClearTerminalSelectionAction(options: {
  actionPending: boolean;
  openMenuRequestId: number | null;
  currentRequestId: number;
}): boolean {
  return options.actionPending || options.openMenuRequestId === options.currentRequestId;
}

export function shouldHandleTerminalExit(
  current: TerminalSessionState["status"],
  synchronized: TerminalSessionState["status"],
  alreadyHandled: boolean,
): boolean {
  return (
    (current === "closed" || current === "exited") && current !== synchronized && !alreadyHandled
  );
}

export function resolveTerminalLaunchLocation(
  input: TerminalLaunchLocationInput,
): TerminalLaunchLocation {
  return (
    input.launchLocationsById?.get(input.terminalId) ?? {
      cwd: input.cwd,
      ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
      ...(input.runtimeEnv ? { runtimeEnv: input.runtimeEnv } : {}),
    }
  );
}

function resolveTerminalDisplayLabel(
  terminalId: string,
  terminalLabelsById: ReadonlyMap<string, string> | undefined,
): string {
  return terminalLabelsById?.get(terminalId) ?? getTerminalLabel(terminalId);
}

function withShortcut(label: string, shortcutLabel: string | null | undefined): string {
  return shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

function splitActionLabel(
  label: string,
  splitLimitReached: boolean,
  shortcutLabel: string | null | undefined,
): string {
  return splitLimitReached
    ? `${label} (max ${MAX_TERMINALS_PER_GROUP} per group)`
    : withShortcut(label, shortcutLabel);
}

function sortTerminalGroups(
  groups: ThreadTerminalGroup[],
  terminalIds: readonly string[],
): ThreadTerminalGroup[] {
  const terminalOrderIndex = new Map(terminalIds.map((id, index) => [id, index] as const));
  const rank = (ids: readonly string[]) =>
    Math.min(...ids.map((id) => terminalOrderIndex.get(id) ?? Number.POSITIVE_INFINITY));
  return groups.toSorted((left, right) => rank(left.terminalIds) - rank(right.terminalIds));
}

export function buildTerminalTabsModel(input: TerminalTabsModelInput): TerminalTabsModel {
  const owner: TerminalChromeOwner = input.mode === "panel" ? "right-panel" : "drawer";
  const resizable = input.mode !== "panel";
  const newAction: TerminalActionModel = {
    id: "new",
    label: withShortcut("New Terminal", input.newShortcutLabel),
    icon: "plus",
    disabled: false,
  };
  const terminalIds = normalizeTerminalIds(input.terminalIds);
  if (terminalIds.length === 0) {
    return {
      kind: "empty",
      mode: input.mode,
      owner,
      resizable,
      message: TERMINAL_EMPTY_MESSAGE,
      newAction,
    };
  }

  const activeTerminalId = terminalIds.includes(input.activeTerminalId)
    ? input.activeTerminalId
    : (terminalIds[0] ?? "");
  const groups = sortTerminalGroups(
    normalizeTerminalGroups(input.terminalGroups, terminalIds),
    terminalIds,
  );
  const indexById = groups.findIndex((group) => group.id === input.activeTerminalGroupId);
  const indexByTerminal = groups.findIndex((group) => group.terminalIds.includes(activeTerminalId));
  const activeGroupIndex = indexById >= 0 ? indexById : indexByTerminal >= 0 ? indexByTerminal : 0;
  const activeGroup = groups[activeGroupIndex];
  const visibleTerminalIds = activeGroup?.terminalIds ?? [activeTerminalId];
  const splitDirection = activeGroup?.splitDirection ?? "horizontal";
  const isSplitView = visibleTerminalIds.length > 1;
  const splitLimitReached = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP;
  const labelOf = (terminalId: string) =>
    resolveTerminalDisplayLabel(terminalId, input.terminalLabelsById);

  return {
    kind: "ready",
    mode: input.mode,
    owner,
    resizable,
    terminalIds,
    activeTerminalId,
    activeGroupId: activeGroup?.id ?? null,
    visibleTerminalIds,
    splitDirection,
    isSplitView,
    showSidebar: terminalIds.length > 1,
    showGroupHeaders: groups.length > 1 || groups.some((group) => group.terminalIds.length > 1),
    splitLimitReached,
    maxTerminalsPerGroup: MAX_TERMINALS_PER_GROUP,
    actions: [
      {
        id: "split-horizontal",
        label: splitActionLabel(
          "Split Terminal Horizontally",
          splitLimitReached,
          input.splitShortcutLabel,
        ),
        icon: "split-horizontal",
        disabled: splitLimitReached,
      },
      {
        id: "split-vertical",
        label: splitActionLabel(
          "Split Terminal Vertically",
          splitLimitReached,
          input.splitVerticalShortcutLabel,
        ),
        icon: "split-vertical",
        disabled: splitLimitReached,
      },
      newAction,
      {
        id: "close",
        label: withShortcut("Close Terminal", input.closeShortcutLabel),
        icon: "trash",
        disabled: false,
      },
    ],
    viewports: (isSplitView ? visibleTerminalIds : [activeTerminalId]).map((terminalId) => ({
      terminalId,
      label: labelOf(terminalId),
      active: terminalId === activeTerminalId,
      autoFocus: !isSplitView || terminalId === activeTerminalId,
    })),
    groups: groups.map((group) => {
      const active = group.terminalIds.includes(activeTerminalId);
      const terminalCount = group.terminalIds.length;
      const groupSplitDirection = group.splitDirection ?? "horizontal";
      const kind: TerminalGroupKind =
        terminalCount <= 1
          ? "single"
          : groupSplitDirection === "vertical"
            ? "stacked"
            : "side-by-side";
      return {
        id: group.id,
        kind,
        label: kind === "single" ? "Single" : kind === "stacked" ? "Stacked" : "Side by side",
        icon:
          kind === "single" ? "square" : kind === "stacked" ? "split-vertical" : "split-horizontal",
        active,
        terminalCount,
        activateTerminalId: active ? activeTerminalId : (group.terminalIds[0] ?? activeTerminalId),
        splitDirection: groupSplitDirection,
        tabs: group.terminalIds.map((terminalId) => {
          const tabActive = terminalId === activeTerminalId;
          const label = labelOf(terminalId);
          return {
            terminalId,
            label,
            active: tabActive,
            closeLabel: `Close ${label}${
              tabActive && input.closeShortcutLabel ? ` (${input.closeShortcutLabel})` : ""
            }`,
            icon: "terminal",
          };
        }),
      };
    }),
  };
}

export function resolveTerminalAction(input: TerminalActionInput): TerminalActionIntent {
  switch (input.action) {
    case "split-horizontal":
      return input.splitLimitReached
        ? { kind: "none" }
        : { kind: "split", direction: "horizontal" };
    case "split-vertical":
      return input.splitLimitReached ? { kind: "none" } : { kind: "split", direction: "vertical" };
    case "new":
      return { kind: "new" };
    case "close":
      return { kind: "request-close", terminalId: input.activeTerminalId };
  }
}

export function resolveTerminalSelect(input: TerminalSelectInput): TerminalSelectIntent {
  if (input.source === "pane" && input.terminalId === input.activeTerminalId) {
    return { kind: "none" };
  }
  return { kind: "activate", terminalId: input.terminalId };
}

export function resolveTerminalCloseRequest(input: TerminalCloseRequestInput): TerminalCloseIntent {
  if (input.reason === "session-exited") {
    return { kind: "close", terminalId: input.terminalId };
  }
  const label = resolveTerminalDisplayLabel(input.terminalId, input.terminalLabelsById);
  return {
    kind: "confirm-close",
    terminalId: input.terminalId,
    confirmLabels: [label],
    confirmMessage: terminalCloseConfirmMessage([label]),
  };
}

export function resolveTerminalKeyDown(input: TerminalKeyInput): TerminalKeyIntent {
  const { event, keybindings, platform } = input;
  const options = { platform, context: { terminalFocus: true, terminalOpen: true } };
  if (isTerminalCloseShortcut(event, keybindings, options)) {
    return { kind: "block-close-shortcut" };
  }
  if (
    isTerminalToggleShortcut(event, keybindings, options) ||
    isTerminalSplitShortcut(event, keybindings, options) ||
    isTerminalSplitVerticalShortcut(event, keybindings, options) ||
    isTerminalNewShortcut(event, keybindings, options) ||
    isDiffToggleShortcut(event, keybindings, options)
  ) {
    return { kind: "defer-to-app" };
  }
  const navigationData = terminalNavigationShortcutData(event, platform);
  if (navigationData !== null) {
    return { kind: "send-input", data: navigationData, failureMessage: "Failed to move cursor" };
  }
  const deleteData = terminalDeleteShortcutData(event, platform);
  if (deleteData !== null) {
    return {
      kind: "send-input",
      data: deleteData,
      failureMessage: "Failed to delete terminal input",
    };
  }
  if (isTerminalClearShortcut(event, platform)) {
    return { kind: "send-input", data: "\u000c", failureMessage: "Failed to clear terminal" };
  }
  return { kind: "pass-through" };
}

export function resolveTerminalSurfaceSplit(
  surface: TerminalSurfaceTerminals,
  terminalId: string,
  direction: TerminalSplitDirection,
): TerminalSurfaceSplitPatch {
  return {
    terminalIds: surface.terminalIds.includes(terminalId)
      ? surface.terminalIds
      : [...surface.terminalIds, terminalId],
    activeTerminalId: terminalId,
    ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
  };
}

export function resolveTerminalSurfaceClose(
  surface: TerminalSurfaceTerminals,
  terminalId: string,
): TerminalSurfaceCloseIntent {
  const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
  const lastTerminalId = terminalIds.at(-1);
  if (lastTerminalId === undefined) {
    return { kind: "close-surface" };
  }
  return {
    kind: "update-terminals",
    terminalIds,
    activeTerminalId:
      surface.activeTerminalId === terminalId ? lastTerminalId : surface.activeTerminalId,
  };
}
