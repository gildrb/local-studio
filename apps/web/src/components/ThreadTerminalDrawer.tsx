import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  type TerminalOutputCursor,
  type TerminalOutputUpdate,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import {
  type LucideIcon,
  Plus,
  Square,
  SquareSplitHorizontal,
  SquareSplitVertical,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import {
  type ProviderInstanceId,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  Fragment,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { readTextFromClipboard, writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { type TerminalContextSelection } from "~/lib/terminalContext";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import {
  GhosttyTerminalSurface,
  type GhosttyTerminalSurfaceOptions,
} from "~/terminal/ghostty/surface";
import { type GhosttyColor, type GhosttyTheme } from "~/terminal/ghostty/core";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { isTerminalUrl, resolvePathLinkTarget } from "../terminal-links";
import { type ThreadTerminalGroup } from "../types";
import { readLocalApi } from "~/localApi";
import { confirmTerminalClose } from "~/lib/terminalCloseConfirm";
import { useClientSettings } from "../hooks/useSettings";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useAttachedTerminalSession } from "../state/terminalSessions";
import { serverEnvironment } from "../state/server";
import { previewEnvironment } from "../state/preview";
import { terminalEnvironment } from "../state/terminal";
import { openTerminalLinkInPreview } from "./preview/openTerminalLinkInPreview";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildTerminalTabsModel,
  clampTerminalDrawerHeight,
  formatTerminalSystemMessage,
  resolveTerminalAction,
  resolveTerminalCloseRequest,
  resolveTerminalKeyDown,
  resolveTerminalLaunchLocation,
  resolveTerminalSelect,
  shouldClearTerminalSelectionAction,
  shouldHandleTerminalExit,
  terminalContextMenuItems,
  terminalExitMessage,
  terminalInitFailureText,
  terminalSelectionLineRange,
  terminalSelectionMenuItems,
  type TerminalActionIcon,
  type TerminalActionId,
  type TerminalCloseReason,
  type TerminalContextMenuAction,
  type TerminalGroupIcon,
  type TerminalLaunchLocation,
  type TerminalSelectSource,
  type TerminalViewportModel,
} from "./ThreadTerminalDrawer.logic";
import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../appearanceFonts";

const TERMINAL_ACTION_ICONS: Record<TerminalActionIcon, LucideIcon> = {
  "split-horizontal": SquareSplitHorizontal,
  "split-vertical": SquareSplitVertical,
  plus: Plus,
  trash: Trash2,
};

const TERMINAL_GROUP_ICONS: Record<TerminalGroupIcon, LucideIcon> = {
  square: Square,
  "split-horizontal": SquareSplitHorizontal,
  "split-vertical": SquareSplitVertical,
};

function clampDrawerHeight(height: number): number {
  return clampTerminalDrawerHeight(
    height,
    typeof window === "undefined" ? null : window.innerHeight,
  );
}

function writeSystemMessage(terminal: GhosttyTerminalSurface, message: string): void {
  terminal.write(formatTerminalSystemMessage(message));
}

export function writeTerminalOutputUpdate(
  terminal: Pick<GhosttyTerminalSurface, "resetAndWrite" | "write">,
  update: TerminalOutputUpdate,
): void {
  if (update.type === "reset") {
    terminal.resetAndWrite(update.data);
  } else if (update.type === "append") {
    terminal.write(update.data);
  }
}

function parseTerminalColor(value: string, fallback: GhosttyColor): GhosttyColor {
  if (typeof document === "undefined") return fallback;

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return fallback;

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 0) return fallback;

  return {
    r: red ?? fallback.r,
    g: green ?? fallback.g,
    b: blue ?? fallback.b,
  };
}

function runtimeEnvSignature(runtimeEnv: Record<string, string> | undefined): string {
  if (!runtimeEnv) return "";
  return JSON.stringify(
    Object.entries(runtimeEnv)
      .filter(([key, value]) => key.length > 0 && typeof value === "string")
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

function normalizeComputedColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return fallback;
  }
  return value ?? fallback;
}

function readThemeColor(styles: CSSStyleDeclaration, variable: string, fallback: string): string {
  return normalizeComputedColor(styles.getPropertyValue(variable), fallback);
}

/** The surface treats an omitted family or size as "use the built-in default". */
function terminalFontOptions(family: string, size: number): { family?: string; size: number } {
  const trimmed = family.trim();
  return trimmed.length > 0 ? { family: trimmed, size } : { size };
}

export function terminalThemeFromApp(mountElement?: HTMLElement | null): GhosttyTheme {
  const drawerSurface =
    mountElement?.closest("[data-thread-terminal-drawer]") ??
    document.querySelector("[data-thread-terminal-drawer]") ??
    document.body;
  const drawerStyles = getComputedStyle(drawerSurface);
  const themeStyles = mountElement ? getComputedStyle(mountElement) : drawerStyles;
  const colorScheme = themeStyles.colorScheme;
  const isDark =
    colorScheme === "dark"
      ? true
      : colorScheme === "light"
        ? false
        : document.documentElement.classList.contains("dark");
  const fallbackBackground = isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)";
  const fallbackForeground = isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)";
  const bodyStyles = getComputedStyle(document.body);
  const rootThemeStyles = getComputedStyle(document.documentElement);
  const background = normalizeComputedColor(
    drawerStyles.backgroundColor,
    normalizeComputedColor(bodyStyles.backgroundColor, fallbackBackground),
  );
  const foreground = normalizeComputedColor(
    drawerStyles.color,
    normalizeComputedColor(bodyStyles.color, fallbackForeground),
  );
  const terminalBackground = readThemeColor(
    themeStyles,
    "--terminal-background",
    readThemeColor(rootThemeStyles, "--terminal-background", background),
  );
  const terminalForeground = readThemeColor(
    themeStyles,
    "--terminal-foreground",
    readThemeColor(rootThemeStyles, "--terminal-foreground", foreground),
  );
  const terminalCursor = readThemeColor(
    themeStyles,
    "--terminal-cursor",
    isDark ? "rgb(180, 203, 255)" : "rgb(38, 56, 78)",
  );
  const terminalSelection = readThemeColor(
    themeStyles,
    "--terminal-selection-background",
    isDark ? "rgba(180, 203, 255, 0.25)" : "rgba(37, 63, 99, 0.2)",
  );
  return {
    background: parseTerminalColor(
      terminalBackground,
      isDark ? { r: 14, g: 18, b: 24 } : { r: 255, g: 255, b: 255 },
    ),
    foreground: parseTerminalColor(
      terminalForeground,
      isDark ? { r: 237, g: 241, b: 247 } : { r: 28, g: 33, b: 41 },
    ),
    cursor: parseTerminalColor(
      terminalCursor,
      isDark ? { r: 180, g: 203, b: 255 } : { r: 38, g: 56, b: 78 },
    ),
    selectionBackground: terminalSelection,
  };
}

interface TerminalViewportProps {
  advancedTypography: boolean;
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  terminalId: string;
  terminalLabel: string;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  providerInstanceId?: ProviderInstanceId;
  onSessionExited: () => void;
  onAddTerminalContext?: (selection: TerminalContextSelection) => void;
  focusRequestId: number;
  autoFocus: boolean;
  visible: boolean;
  resizeEpoch: number;
  drawerHeight: number;
  keybindings: ResolvedKeybindingsConfig;
}

export function TerminalViewport({
  advancedTypography,
  threadRef,
  threadId,
  terminalId,
  terminalLabel,
  cwd,
  worktreePath,
  runtimeEnv,
  providerInstanceId,
  onSessionExited,
  onAddTerminalContext,
  focusRequestId,
  autoFocus,
  visible,
  resizeEpoch,
  drawerHeight,
  keybindings,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<GhosttyTerminalSurface | null>(null);
  const visibleRef = useRef(visible);
  const environmentId = threadRef.environmentId;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    environmentId,
    serverConfig?.availableEditors ?? [],
  );
  const openTerminalPath = useEffectEvent((target: string) => openInPreferredEditor(target));
  const openPreview = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const runTerminalWrite = useAtomCommand(terminalEnvironment.write, {
    reportFailure: false,
  });
  const runTerminalResize = useAtomCommand(terminalEnvironment.resize, {
    reportFailure: false,
  });
  const hasHandledExitRef = useRef(false);
  const selectionActionRequestIdRef = useRef(0);
  // Holds the request id of the selection popup currently on screen, so a
  // popup that was superseded (but whose menu promise has not settled yet)
  // cannot be mistaken for the active flow.
  const openSelectionMenuRequestIdRef = useRef<number | null>(null);
  const keybindingsRef = useRef(keybindings);
  const runtimeEnvKey = useMemo(() => runtimeEnvSignature(runtimeEnv), [runtimeEnv]);
  const handleSessionExited = useEffectEvent(() => {
    onSessionExited();
  });
  const handleAddTerminalContext = useEffectEvent((selection: TerminalContextSelection) => {
    onAddTerminalContext?.(selection);
  });
  const canAddSelectionToChat = useEffectEvent(() => onAddTerminalContext !== undefined);
  const readTerminalLabel = useEffectEvent(() => terminalLabel);
  const terminalFontFamily = useClientSettings((settings) =>
    resolveTerminalFontPreference({
      advanced: advancedTypography,
      code: settings.fontFamilyCode,
      terminal: settings.fontFamilyTerminal,
    }),
  );
  const terminalFontSize = useClientSettings((settings) =>
    resolveTerminalFontSizePreference({
      advanced: advancedTypography,
      code: settings.fontSizeCode,
      terminal: settings.fontSizeTerminal,
    }),
  );
  const terminalFontRef = useRef({ family: terminalFontFamily, size: terminalFontSize });
  const terminalSession = useAttachedTerminalSession({
    environmentId,
    terminal: {
      threadId,
      terminalId,
      cwd,
      ...(worktreePath !== undefined ? { worktreePath } : {}),
      ...(runtimeEnv ? { env: runtimeEnv } : {}),
      ...(providerInstanceId ? { providerInstanceId } : {}),
    },
  });
  const writeTerminal = useEffectEvent((data: string) =>
    runTerminalWrite({
      environmentId,
      input: { threadId, terminalId, data },
    }),
  );
  const resizeTerminal = useEffectEvent((cols: number, rows: number) =>
    runTerminalResize({
      environmentId,
      input: { threadId, terminalId, cols, rows },
    }),
  );
  const terminalOutput = terminalSession.output;
  const terminalError = terminalSession.error;
  const terminalStatus = terminalSession.status;
  const outputCursorRef = useRef<TerminalOutputCursor>(INITIAL_TERMINAL_OUTPUT_CURSOR);
  const synchronizedStatusRef = useRef<TerminalSessionState["status"]>("closed");
  const synchronizeTerminalStatus = useEffectEvent(
    (terminal: GhosttyTerminalSurface, status: TerminalSessionState["status"]) => {
      const synchronized = synchronizedStatusRef.current;
      if (status === "running") {
        hasHandledExitRef.current = false;
      } else if (shouldHandleTerminalExit(status, synchronized, hasHandledExitRef.current)) {
        hasHandledExitRef.current = true;
        writeSystemMessage(terminal, terminalExitMessage(status));
        window.setTimeout(() => {
          if (hasHandledExitRef.current) {
            handleSessionExited();
          }
        }, 0);
      }
      synchronizedStatusRef.current = status;
    },
  );
  const terminalVersion = terminalSession.version;
  const previousSessionRef = useRef({
    output: terminalOutput,
    error: terminalError,
    status: terminalStatus,
    version: terminalVersion,
  });
  const latestSessionRef = useRef(previousSessionRef.current);
  latestSessionRef.current = {
    output: terminalOutput,
    error: terminalError,
    status: terminalStatus,
    version: terminalVersion,
  };

  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    terminalRef.current?.setVisible(visible);
  }, [visible]);

  useEffect(() => {
    const current = terminalFontRef.current;
    if (current.family === terminalFontFamily && current.size === terminalFontSize) return;
    terminalFontRef.current = { family: terminalFontFamily, size: terminalFontSize };
    void terminalRef.current?.setFont(terminalFontOptions(terminalFontFamily, terminalFontSize));
  }, [terminalFontFamily, terminalFontSize]);

  useEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    const localApi = readLocalApi();
    let cancelled = false;
    let teardown: (() => void) | null = null;
    let setupTerminal: GhosttyTerminalSurface | null = null;
    let setupCleanups: Array<() => void> = [];
    let selectionActions: ReturnType<typeof observeSelectionActions> | null = null;

    const setup = async (): Promise<(() => void) | null> => {
      const setupFont = terminalFontRef.current;
      const terminalOptions: GhosttyTerminalSurfaceOptions = {
        theme: terminalThemeFromApp(mount),
        font: terminalFontOptions(setupFont.family, setupFont.size),
        get visible() {
          return visibleRef.current;
        },
        onData: (data) => handleData(data),
        onResize: (cols, rows) => void resizeTerminal(cols, rows),
        onSelectionChange: () => handleSelectionChange(),
        beforeKey: (event) => handleBeforeKey(event),
        onLinkActivate: (text, event) => handleLinkActivate(text, event),
        // The surface listens from construction, so a right-click can land
        // while `create` is still awaiting WASM — before the handler below it
        // exists. The ref is only assigned once that setup has run.
        onContextMenu: (event) => {
          if (terminalRef.current) void showTerminalContextMenu(event);
        },
      };
      const terminal = await GhosttyTerminalSurface.create(mount, terminalOptions);
      if (cancelled) {
        terminal.dispose();
        return null;
      }
      terminal.setVisible(visibleRef.current);
      // The theme observer is not installed yet, so re-read the theme in case
      // the app toggled light/dark while the WASM surface was loading.
      terminal.setTheme(terminalThemeFromApp(mount));
      setupTerminal = terminal;
      terminalRef.current = terminal;
      // Client settings hydrate asynchronously; a font preference that landed
      // while the surface was loading found terminalRef null, so its setFont
      // was dropped. Re-apply whatever is current once the terminal exists.
      const currentFont = terminalFontRef.current;
      if (currentFont.family !== setupFont.family || currentFont.size !== setupFont.size) {
        void terminal.setFont(terminalFontOptions(currentFont.family, currentFont.size));
      }
      const latestSession = latestSessionRef.current;
      previousSessionRef.current = latestSession;
      const initialOutput = readTerminalOutputUpdate(
        latestSession.output,
        INITIAL_TERMINAL_OUTPUT_CURSOR,
      );
      if (initialOutput.type === "reset" && initialOutput.data.length > 0) {
        writeTerminalOutputUpdate(terminal, initialOutput);
      }
      outputCursorRef.current = initialOutput.cursor;
      if (latestSession.error !== null) writeSystemMessage(terminal, latestSession.error);
      // Attaching to a session that already exited must still run exit handling
      // once, so mount synchronization starts from the empty "closed" state.
      // (A session that is "closed" at mount is indistinguishable from one that
      // never started, so only "exited" triggers the message — as with xterm.)
      synchronizedStatusRef.current = "closed";
      synchronizeTerminalStatus(terminal, latestSession.status);
      // Startup may finish after the user has returned to the composer.
      if (visibleRef.current && mount.contains(document.activeElement)) {
        terminal.focus();
      }

      const dismissSelectionAction = (supersede = false) => {
        const ownsMenu =
          openSelectionMenuRequestIdRef.current === selectionActionRequestIdRef.current;
        // Passive cancellation must not invalidate a newer right-click flow.
        if (supersede || ownsMenu) selectionActionRequestIdRef.current += 1;
        if (ownsMenu) void localApi?.contextMenu.close();
      };
      const clearSelectionAction = () => {
        selectionActions?.cancel();
        dismissSelectionAction(true);
      };
      setupCleanups.push(clearSelectionAction);

      const readSelectionAction = (
        pointer: SelectionActionPoint | null = null,
      ): {
        position: { x: number; y: number };
        clipboardText: string;
        selection: TerminalContextSelection;
      } | null => {
        const activeTerminal = terminalRef.current;
        const mountElement = containerRef.current;
        if (!activeTerminal || !mountElement || !activeTerminal.hasSelection()) {
          return null;
        }
        const selectionText = activeTerminal.getSelection();
        const selectionPosition = activeTerminal.getSelectionPosition();
        const normalizedText = selectionText.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
        if (!selectionPosition || normalizedText.length === 0) {
          return null;
        }
        const { lineStart, lineEnd } = terminalSelectionLineRange(selectionPosition);
        const bounds = mountElement.getBoundingClientRect();
        const position = resolveSelectionActionPosition({
          bounds,
          selectionRect: activeTerminal.getSelectionEndClientRect(),
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        });
        return {
          position,
          clipboardText: selectionText,
          selection: {
            terminalId,
            terminalLabel: readTerminalLabel(),
            lineStart,
            lineEnd,
            text: normalizedText,
          },
        };
      };

      const addSelectionToChat = (selection: TerminalContextSelection) => {
        handleAddTerminalContext(selection);
        terminalRef.current?.clearSelection();
        terminalRef.current?.focus();
      };

      // A selection-action flow that was superseded while its async work ran
      // must go silent: no error message, no focus steal.
      const reportIfCurrent = (requestId: number, error: unknown, fallback: string) => {
        if (requestId !== selectionActionRequestIdRef.current) return;
        const activeTerminal = terminalRef.current;
        if (activeTerminal) {
          writeSystemMessage(activeTerminal, error instanceof Error ? error.message : fallback);
        }
      };

      const focusIfCurrent = (requestId: number) => {
        if (requestId === selectionActionRequestIdRef.current) {
          terminalRef.current?.focus();
        }
      };

      const copySelection = async (text: string, requestId: number) => {
        try {
          await writeTextToClipboard(text, "terminal selection");
        } catch (error) {
          reportIfCurrent(requestId, error, "Unable to copy terminal selection");
        }
        focusIfCurrent(requestId);
      };

      const pasteFromClipboard = async (requestId: number) => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) return;
        try {
          // The surface owns the read so it can claim the paste race before it
          // starts: a paste shortcut fired while the menu read is in flight
          // supersedes this paste instead of landing alongside it.
          await activeTerminal.pasteFromClipboard(
            () => readTextFromClipboard("terminal input"),
            () => requestId === selectionActionRequestIdRef.current,
          );
        } catch (error) {
          reportIfCurrent(requestId, error, "Unable to read the clipboard");
          return;
        }
        focusIfCurrent(requestId);
      };

      const showTerminalContextMenu = async (event: MouseEvent) => {
        if (!localApi || !terminalRef.current) return;
        // Own the gesture before anything async: leaving the default alive lets
        // the browser (or Electron's editing menu) answer with a Paste entry
        // that is permanently disabled over the terminal canvas.
        event.preventDefault();
        // A right-click supersedes a selection popup that is pending or open.
        clearSelectionAction();
        const selectionAction = readSelectionAction();
        const requestId = selectionActionRequestIdRef.current;
        let clicked: TerminalContextMenuAction | null;
        try {
          clicked = await localApi.contextMenu.show(
            terminalContextMenuItems({
              hasSelection: selectionAction !== null,
              canAddToChat: canAddSelectionToChat(),
            }),
            { x: event.clientX, y: event.clientY },
          );
        } catch (error) {
          reportIfCurrent(requestId, error, "Unable to open the terminal context menu");
          focusIfCurrent(requestId);
          return;
        }
        if (requestId !== selectionActionRequestIdRef.current || clicked === null) {
          return;
        }
        switch (clicked) {
          case "add-to-chat":
            if (selectionAction && canAddSelectionToChat()) {
              addSelectionToChat(selectionAction.selection);
            }
            return;
          case "copy":
            if (selectionAction) await copySelection(selectionAction.clipboardText, requestId);
            return;
          case "paste":
            await pasteFromClipboard(requestId);
            return;
        }
      };

      const showSelectionAction = async (pointer: SelectionActionPoint | null) => {
        if (!localApi) {
          clearSelectionAction();
          return;
        }
        if (openSelectionMenuRequestIdRef.current === selectionActionRequestIdRef.current) {
          return;
        }
        const nextAction = readSelectionAction(pointer);
        if (!nextAction) {
          clearSelectionAction();
          return;
        }
        const requestId = ++selectionActionRequestIdRef.current;
        openSelectionMenuRequestIdRef.current = requestId;
        const clicked = await localApi.contextMenu
          .show(
            terminalSelectionMenuItems({ canAddToChat: canAddSelectionToChat() }),
            nextAction.position,
          )
          .finally(() => {
            if (openSelectionMenuRequestIdRef.current === requestId) {
              openSelectionMenuRequestIdRef.current = null;
            }
          });
        if (requestId !== selectionActionRequestIdRef.current || clicked === null) {
          return;
        }
        switch (clicked) {
          case "add-to-chat":
            if (canAddSelectionToChat()) addSelectionToChat(nextAction.selection);
            return;
          case "copy":
            await copySelection(nextAction.clipboardText, requestId);
            return;
        }
      };

      const sendTerminalInput = async (data: string, fallbackError: string) => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) return;
        const result = await writeTerminal(data);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          writeSystemMessage(
            activeTerminal,
            error instanceof Error ? error.message : fallbackError,
          );
        }
      };

      function handleBeforeKey(event: KeyboardEvent): boolean {
        const intent = resolveTerminalKeyDown({
          event,
          keybindings: keybindingsRef.current,
          platform: navigator.platform,
        });
        switch (intent.kind) {
          case "block-close-shortcut":
            event.preventDefault();
            return false;
          case "defer-to-app":
            return false;
          case "send-input":
            event.preventDefault();
            event.stopPropagation();
            void sendTerminalInput(intent.data, intent.failureMessage);
            return false;
          case "pass-through":
            return true;
        }
      }

      function handleLinkActivate(text: string, event: MouseEvent): void {
        const latestTerminal = terminalRef.current;
        if (!latestTerminal) return;
        if (isTerminalUrl(text)) {
          if (!localApi) {
            writeSystemMessage(latestTerminal, "Opening links is unavailable in this browser.");
            return;
          }
          const fallbackToBrowser = () => {
            void localApi.shell.openExternal(text).catch((error: unknown) => {
              writeSystemMessage(
                latestTerminal,
                error instanceof Error ? error.message : "Unable to open link",
              );
            });
          };
          void openTerminalLinkInPreview({
            url: text,
            threadRef,
            openPreview,
            fallbackToBrowser,
            forceBrowser: event.metaKey || event.ctrlKey,
          }).catch((error: unknown) => {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Unable to open link",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          });
          return;
        }
        const target = resolvePathLinkTarget(text, cwd);
        void (async () => {
          const result = await openTerminalPath(target);
          if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
            return;
          }
          const error = squashAtomCommandFailure(result);
          writeSystemMessage(
            latestTerminal,
            error instanceof Error ? error.message : "Unable to open path",
          );
        })();
      }

      function handleData(data: string): void {
        void (async () => {
          const result = await writeTerminal(data);
          if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          writeSystemMessage(
            terminal,
            error instanceof Error ? error.message : "Terminal write failed",
          );
        })();
      }

      function handleSelectionChange(): void {
        if (terminalRef.current?.hasSelection()) {
          return;
        }
        const shouldClear = shouldClearTerminalSelectionAction({
          actionPending: selectionActions?.pending ?? false,
          openMenuRequestId: openSelectionMenuRequestIdRef.current,
          currentRequestId: selectionActionRequestIdRef.current,
        });
        if (!shouldClear) return;
        clearSelectionAction();
      }

      selectionActions = observeSelectionActions({
        element: mount,
        onSelection: (pointer) => {
          void showSelectionAction(pointer);
        },
        onDismiss: (reason) => dismissSelectionAction(reason === "interaction"),
      });
      setupCleanups.push(() => selectionActions?.dispose());

      const themeObserver = new MutationObserver(() => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) return;
        activeTerminal.setTheme(terminalThemeFromApp(containerRef.current));
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      setupCleanups.push(() => themeObserver.disconnect());

      const fitTimer = window.setTimeout(() => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) return;
        const wasAtBottom = activeTerminal.isAtBottom();
        activeTerminal.fit();
        if (wasAtBottom) {
          activeTerminal.scrollToBottom();
        }
      }, 30);
      setupCleanups.push(() => window.clearTimeout(fitTimer));

      const cleanups = setupCleanups;
      setupCleanups = [];
      setupTerminal = null;
      return () => {
        for (const cleanup of cleanups.toReversed()) cleanup();
        if (terminalRef.current === terminal) terminalRef.current = null;
        terminal.dispose();
      };
    };

    void setup()
      .then((nextTeardown) => {
        if (cancelled) {
          nextTeardown?.();
          return;
        }
        teardown = nextTeardown;
      })
      .catch((error: unknown) => {
        for (const cleanup of setupCleanups.toReversed()) cleanup();
        setupCleanups = [];
        if (terminalRef.current === setupTerminal) terminalRef.current = null;
        setupTerminal?.dispose();
        setupTerminal = null;
        if (cancelled) return;
        mount.textContent = terminalInitFailureText(error);
      });

    return () => {
      cancelled = true;
      const hadFocus = mount.contains(document.activeElement);
      teardown?.();
      if (hadFocus && mount.isConnected) mount.focus({ preventScroll: true });
    };
  }, [cwd, environmentId, runtimeEnvKey, terminalId, threadId, worktreePath]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const current = {
      output: terminalOutput,
      error: terminalError,
      status: terminalStatus,
      version: terminalVersion,
    };
    if (!terminal) {
      previousSessionRef.current = current;
      return;
    }

    const previous = previousSessionRef.current;
    synchronizeTerminalStatus(terminal, current.status);
    if (current.version === previous.version && current.output === previous.output) {
      return;
    }

    const outputUpdate = readTerminalOutputUpdate(current.output, outputCursorRef.current);
    writeTerminalOutputUpdate(terminal, outputUpdate);
    outputCursorRef.current = outputUpdate.cursor;
    terminal.clearSelection();

    if (current.error !== null && current.error !== previous.error) {
      writeSystemMessage(terminal, current.error);
    }

    previousSessionRef.current = current;
  }, [terminalOutput, terminalError, terminalStatus, terminalVersion]);

  useEffect(() => {
    if (!autoFocus || !visible) return;
    // Claim focus when requested, then hand it to the terminal once ready only
    // if the user has not focused something else in the meantime.
    (terminalRef.current ?? containerRef.current)?.focus();
  }, [autoFocus, focusRequestId, visible]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !visibleRef.current) return;
    const wasAtBottom = terminal.isAtBottom();
    // The surface reports grid changes through onResize, which is the single
    // channel for PTY resize RPCs; fitting here only refreshes the layout.
    const frame = window.requestAnimationFrame(() => {
      if (!visibleRef.current) return;
      terminal.fit();
      if (wasAtBottom) {
        terminal.scrollToBottom();
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [drawerHeight, environmentId, resizeEpoch, terminalId, threadId]);
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="relative h-full w-full overflow-hidden bg-(--terminal-background)"
    />
  );
}

interface ThreadTerminalDrawerProps {
  mode?: "drawer" | "panel";
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  visible?: boolean;
  height: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
  focusRequestId: number;
  onSplitTerminal: () => void;
  onSplitTerminalVertical: () => void;
  onNewTerminal: () => void;
  splitShortcutLabel?: string | undefined;
  splitVerticalShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onHeightChange: (height: number) => void;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  keybindings: ResolvedKeybindingsConfig;
  /** Prefer server-provided tab titles when present (e.g. active subprocess name). */
  terminalLabelsById?: ReadonlyMap<string, string>;
  /** Prefer per-session launch locations when the server already knows a terminal. */
  terminalLaunchLocationsById?: ReadonlyMap<string, TerminalLaunchLocation>;
}

interface TerminalActionButtonProps {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}

function TerminalActionButton({ label, className, onClick, children }: TerminalActionButtonProps) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<button type="button" className={className} onClick={onClick} aria-label={label} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="bottom"
        sideOffset={6}
        align="center"
        className="pointer-events-none select-none"
      >
        {label}
      </PopoverPopup>
    </Popover>
  );
}

export default function ThreadTerminalDrawer({
  mode = "drawer",
  threadRef,
  threadId,
  cwd,
  worktreePath,
  runtimeEnv,
  visible = true,
  height,
  terminalIds,
  activeTerminalId,
  terminalGroups,
  activeTerminalGroupId,
  focusRequestId,
  onSplitTerminal,
  onSplitTerminalVertical,
  onNewTerminal,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  onActiveTerminalChange,
  onCloseTerminal,
  onHeightChange,
  onAddTerminalContext,
  keybindings,
  terminalLabelsById,
  terminalLaunchLocationsById,
}: ThreadTerminalDrawerProps) {
  const isPanel = mode === "panel";
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const controlledDrawerHeight = clampDrawerHeight(height);
  const [drawerHeightState, setDrawerHeightState] = useState(() => ({
    threadId,
    height: controlledDrawerHeight,
  }));
  const drawerHeight =
    drawerHeightState.threadId === threadId ? drawerHeightState.height : controlledDrawerHeight;
  const setDrawerHeight = useCallback(
    (update: SetStateAction<number>) => {
      setDrawerHeightState((current) => {
        const currentHeight =
          current.threadId === threadId ? current.height : controlledDrawerHeight;
        const nextHeight = typeof update === "function" ? update(currentHeight) : update;
        return nextHeight === currentHeight && current.threadId === threadId
          ? current
          : { threadId, height: nextHeight };
      });
    },
    [controlledDrawerHeight, threadId],
  );
  const setDrawerHeightFromWindowResize = useEffectEvent((nextHeight: number) => {
    setDrawerHeight(nextHeight);
  });
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const drawerHeightRef = useRef(drawerHeight);
  const lastSyncedHeightRef = useRef(controlledDrawerHeight);
  const onHeightChangeRef = useRef(onHeightChange);
  const resizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);

  const model = useMemo(
    () =>
      buildTerminalTabsModel({
        mode,
        terminalIds,
        activeTerminalId,
        terminalGroups,
        activeTerminalGroupId,
        terminalLabelsById,
        splitShortcutLabel,
        splitVerticalShortcutLabel,
        newShortcutLabel,
        closeShortcutLabel,
      }),
    [
      activeTerminalGroupId,
      activeTerminalId,
      closeShortcutLabel,
      mode,
      newShortcutLabel,
      splitShortcutLabel,
      splitVerticalShortcutLabel,
      terminalGroups,
      terminalIds,
      terminalLabelsById,
    ],
  );
  const resolvedActiveTerminalId = model.kind === "ready" ? model.activeTerminalId : "";
  const splitLimitReached = model.kind === "ready" && model.splitLimitReached;
  const closeTerminal = useCallback(
    (terminalId: string, reason: TerminalCloseReason) => {
      const intent = resolveTerminalCloseRequest({ terminalId, reason, terminalLabelsById });
      if (intent.kind === "close") {
        onCloseTerminal(intent.terminalId);
        return;
      }
      void confirmTerminalClose(intent.confirmLabels).then((confirmed) => {
        if (confirmed) onCloseTerminal(intent.terminalId);
      });
    },
    [onCloseTerminal, terminalLabelsById],
  );
  const runTerminalAction = useCallback(
    (action: TerminalActionId) => {
      const intent = resolveTerminalAction({
        action,
        splitLimitReached,
        activeTerminalId: resolvedActiveTerminalId,
      });
      switch (intent.kind) {
        case "split":
          if (intent.direction === "vertical") onSplitTerminalVertical();
          else onSplitTerminal();
          return;
        case "new":
          onNewTerminal();
          return;
        case "request-close":
          closeTerminal(intent.terminalId, "user");
          return;
        case "none":
          return;
      }
    },
    [
      closeTerminal,
      onNewTerminal,
      onSplitTerminal,
      onSplitTerminalVertical,
      resolvedActiveTerminalId,
      splitLimitReached,
    ],
  );
  const selectTerminal = (source: TerminalSelectSource, terminalId: string) => {
    const intent = resolveTerminalSelect({
      source,
      terminalId,
      activeTerminalId: resolvedActiveTerminalId,
    });
    if (intent.kind === "activate") onActiveTerminalChange(intent.terminalId);
  };

  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    drawerHeightRef.current = drawerHeight;
  }, [drawerHeight]);

  const syncHeight = useCallback((nextHeight: number) => {
    const clampedHeight = clampDrawerHeight(nextHeight);
    if (lastSyncedHeightRef.current === clampedHeight) return;
    lastSyncedHeightRef.current = clampedHeight;
    onHeightChangeRef.current(clampedHeight);
  }, []);

  useEffect(() => {
    lastSyncedHeightRef.current = controlledDrawerHeight;
  }, [controlledDrawerHeight, threadId]);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    didResizeDuringDragRef.current = false;
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: drawerHeightRef.current,
    };
  }, []);

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      event.preventDefault();
      const clampedHeight = clampDrawerHeight(
        resizeState.startHeight + (resizeState.startY - event.clientY),
      );
      if (clampedHeight === drawerHeightRef.current) {
        return;
      }
      didResizeDuringDragRef.current = true;
      drawerHeightRef.current = clampedHeight;
      setDrawerHeight(clampedHeight);
    },
    [setDrawerHeight],
  );

  const handleResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;
      resizeStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!didResizeDuringDragRef.current) {
        return;
      }
      syncHeight(drawerHeightRef.current);
      setResizeEpoch((value) => value + 1);
    },
    [syncHeight],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const onWindowResize = () => {
      const clampedHeight = clampDrawerHeight(drawerHeightRef.current);
      const changed = clampedHeight !== drawerHeightRef.current;
      if (changed) {
        setDrawerHeightFromWindowResize(clampedHeight);
        drawerHeightRef.current = clampedHeight;
      }
      if (!resizeStateRef.current) {
        syncHeight(clampedHeight);
      }
      setResizeEpoch((value) => value + 1);
    };
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [syncHeight, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setResizeEpoch((value) => value + 1);
  }, [visible]);

  useEffect(() => {
    return () => {
      syncHeight(drawerHeightRef.current);
    };
  }, [syncHeight]);

  const rootClassName = cn(
    "relative flex min-w-0 flex-col overflow-hidden bg-background",
    isPanel ? "h-full flex-1" : "shrink-0 border-t border-border/80",
  );
  const rootStyle = model.resizable ? { height: `${drawerHeight}px` } : undefined;
  const resizeHandle = model.resizable ? (
    <div
      className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
      onPointerDown={handleResizePointerDown}
      onPointerMove={handleResizePointerMove}
      onPointerUp={handleResizePointerEnd}
      onPointerCancel={handleResizePointerEnd}
    />
  ) : null;

  if (model.kind === "empty") {
    return (
      <aside
        data-thread-terminal-drawer
        data-terminal-owner={model.owner}
        className={rootClassName}
        style={rootStyle}
      >
        {resizeHandle}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center text-sm text-muted-foreground">
          <p>{model.message}</p>
          <Button size="xs" variant="outline" onClick={() => runTerminalAction(model.newAction.id)}>
            {model.newAction.label}
          </Button>
        </div>
      </aside>
    );
  }

  const renderTerminalViewport = (viewport: TerminalViewportModel) => {
    const launchLocation = resolveTerminalLaunchLocation({
      terminalId: viewport.terminalId,
      launchLocationsById: terminalLaunchLocationsById,
      cwd,
      worktreePath,
      runtimeEnv,
    });
    return (
      <TerminalViewport
        advancedTypography={advancedTypography}
        key={model.isSplitView ? undefined : viewport.terminalId}
        threadRef={threadRef}
        threadId={threadId}
        terminalId={viewport.terminalId}
        terminalLabel={viewport.label}
        cwd={launchLocation.cwd}
        {...(launchLocation.worktreePath !== undefined
          ? { worktreePath: launchLocation.worktreePath }
          : {})}
        {...(launchLocation.runtimeEnv ? { runtimeEnv: launchLocation.runtimeEnv } : {})}
        onSessionExited={() => closeTerminal(viewport.terminalId, "session-exited")}
        onAddTerminalContext={onAddTerminalContext}
        focusRequestId={focusRequestId}
        autoFocus={viewport.autoFocus}
        visible={visible}
        resizeEpoch={resizeEpoch}
        drawerHeight={drawerHeight}
        keybindings={keybindings}
      />
    );
  };

  return (
    <aside
      data-thread-terminal-drawer
      data-terminal-owner={model.owner}
      className={rootClassName}
      style={rootStyle}
    >
      {resizeHandle}

      {!model.showSidebar && (
        <div className="pointer-events-none absolute right-2 top-2 z-20">
          <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-border/80 bg-background shadow-xs">
            {model.actions.map((action, index) => {
              const ActionIcon = TERMINAL_ACTION_ICONS[action.icon];
              return (
                <Fragment key={action.id}>
                  {index > 0 ? <div className="h-4 w-px bg-border/80" /> : null}
                  <TerminalActionButton
                    className={`p-1 text-foreground/90 transition-colors ${
                      action.disabled
                        ? "cursor-not-allowed opacity-64 hover:bg-transparent"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => runTerminalAction(action.id)}
                    label={action.label}
                  >
                    <ActionIcon className="size-3.25" />
                  </TerminalActionButton>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      <div className="min-h-0 w-full flex-1">
        <div
          className={cn(
            "flex h-full min-h-0 bg-(--terminal-background)",
            model.showSidebar && "gap-1.5",
          )}
        >
          <div className="min-w-0 flex-1">
            {model.isSplitView ? (
              <div
                className="grid h-full w-full min-w-0 gap-0 overflow-hidden"
                style={
                  model.splitDirection === "vertical"
                    ? {
                        gridTemplateRows: `repeat(${model.viewports.length}, minmax(0, 1fr))`,
                      }
                    : {
                        gridTemplateColumns: `repeat(${model.viewports.length}, minmax(0, 1fr))`,
                      }
                }
              >
                {model.viewports.map((viewport) => (
                  <div
                    key={viewport.terminalId}
                    className={`min-h-0 min-w-0 ${
                      model.splitDirection === "vertical"
                        ? "border-t first:border-t-0"
                        : "border-l first:border-l-0"
                    } ${viewport.active ? "border-border" : "border-border/70"}`}
                    onMouseDown={() => selectTerminal("pane", viewport.terminalId)}
                  >
                    <div className="h-full">{renderTerminalViewport(viewport)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full">{model.viewports.map(renderTerminalViewport)}</div>
            )}
          </div>

          {model.showSidebar && (
            <aside className="flex w-36 min-w-36 flex-col border border-border/70 bg-muted/10">
              <div className="flex h-[22px] items-stretch justify-end border-b border-border/70">
                <div className="inline-flex h-full items-stretch">
                  {model.actions.map((action, index) => {
                    const ActionIcon = TERMINAL_ACTION_ICONS[action.icon];
                    return (
                      <TerminalActionButton
                        key={action.id}
                        className={`inline-flex h-full items-center ${
                          index > 0 ? "border-l border-border/70 " : ""
                        }px-1 text-foreground/90 transition-colors ${
                          action.disabled
                            ? "cursor-not-allowed opacity-64 hover:bg-transparent"
                            : "hover:bg-accent/70"
                        }`}
                        onClick={() => runTerminalAction(action.id)}
                        label={action.label}
                      >
                        <ActionIcon className="size-3.25" />
                      </TerminalActionButton>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {model.groups.map((group) => {
                  const GroupIcon = TERMINAL_GROUP_ICONS[group.icon];
                  return (
                    <div key={group.id} className="pb-0.5">
                      {model.showGroupHeaders && (
                        <button
                          type="button"
                          className={`flex h-[22px] w-full cursor-pointer items-center gap-1 rounded px-1.5 text-2xs ${
                            group.active
                              ? "bg-accent/50 text-foreground"
                              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                          }`}
                          onClick={() => selectTerminal("group", group.activateTerminalId)}
                        >
                          <GroupIcon className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                          <span className="text-muted-foreground/70 text-3xs tabular-nums">
                            {group.terminalCount}
                          </span>
                        </button>
                      )}

                      <div className="flex flex-col gap-0.5">
                        {group.tabs.map((tab) => (
                          <div
                            key={tab.terminalId}
                            className={cn(
                              "group/tab flex h-6 w-full items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs",
                              tab.active
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                            )}
                          >
                            <PanelTabCloseButton
                              label={tab.closeLabel}
                              onClick={() => closeTerminal(tab.terminalId, "user")}
                              tooltip={tab.closeLabel}
                            >
                              <TerminalSquare className="size-3 shrink-0" />
                            </PanelTabCloseButton>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
                              onClick={() => selectTerminal("tab", tab.terminalId)}
                            >
                              <span className="truncate">{tab.label}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
    </aside>
  );
}
