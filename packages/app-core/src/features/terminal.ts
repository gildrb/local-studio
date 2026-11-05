import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  readTerminalOutputUpdate,
  type TerminalBufferState,
  type TerminalOutputCursor,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import type {
  EnvironmentId,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  TerminalAttachInput,
  TerminalSummary,
} from "@t3tools/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import {
  TERMINAL_MIN_DRAWER_HEIGHT,
  buildTerminalTabsModel,
  clampTerminalDrawerHeight,
  formatTerminalSystemMessage,
  resolveTerminalAction,
  resolveTerminalKeyDown,
  resolveTerminalLaunchLocation,
  resolveTerminalSelect,
  serverTerminalIdsStrictSubsetOfClient,
  shouldHandleTerminalExit,
  terminalContextMenuItems,
  terminalExitMessage,
  terminalIdListsEqual,
  terminalSelectionLineRange,
  terminalSelectionMenuItems,
  type TerminalActionId,
  type TerminalLaunchLocation,
  type TerminalTabsModel,
  type TerminalTabsReadyModel,
  type TerminalViewportModel,
} from "@t3tools/web/src/components/ThreadTerminalDrawer.logic.ts";
import { openInPreferredEditor } from "@t3tools/web/src/editorPreferences.logic.ts";
import { resolveSelectionActionPosition } from "@t3tools/web/src/lib/selectionActions.ts";
import {
  normalizeTerminalContextText,
  type TerminalContextSelection,
} from "@t3tools/web/src/lib/terminalContext.ts";
import { isTerminalUrl, resolvePathLinkTarget } from "@t3tools/web/src/terminal-links.ts";
import {
  terminalLinkAtPositionWithRange,
  type TerminalLinkWithRange,
} from "@t3tools/web/src/terminal/terminalLinkRange.logic.ts";
import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
} from "@t3tools/web/src/appearanceFonts.ts";
import { localTerminal } from "../localTerminals.ts";
import { typographyAdvancedStore } from "../typographyAdvanced.ts";
import { resolveShortcutCommand, shortcutLabelForCommand } from "@t3tools/web/src/keybindings.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
} from "@t3tools/web/src/rightPanelStore.ts";
import { useTerminalUiStateStore } from "@t3tools/web/src/terminalUiStateStore.ts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import { openExternal } from "../openExternal.ts";
import type { TerminalStreamOp } from "../protocol.ts";
import { rightPanelStoreAtom } from "../rightPanelState.ts";
import {
  activatePanelTerminal,
  activeTerminalLaunchContext,
  closeDrawerTerminal,
  closePanelTerminal,
  closePanelTerminalSurface,
  createDrawerTerminal,
  drawerLaunch,
  openPanelTerminal,
  readTerminalThread,
  requestTerminalClose,
  splitPanelTerminal,
  terminalLabelsForThread,
  terminalLaunchContextAtom,
  terminalSessionKey,
  externalTerminalSessionsAtom,
  threadTerminalSummaries,
  toggleTerminalDrawer,
  writeTerminalSession,
  type Get,
  type TerminalThread,
} from "../terminalSessions.ts";
import { composerInputService } from "./composerInput.ts";
import { persistTerminalUiStore, routeTerminalUiState } from "../terminalState.ts";

const MAX_WRITE_CHARS = 65_536;

export type TerminalViewportView = TerminalViewportModel & { readonly sessionKey: string };

export type TerminalChromeModelView =
  | Extract<TerminalTabsModel, { readonly kind: "empty" }>
  | (Omit<TerminalTabsReadyModel, "viewports"> & {
      readonly viewports: ReadonlyArray<TerminalViewportView>;
    });

export type TerminalChromeView = {
  readonly id: string;
  readonly visible: boolean;
  readonly height: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly fontSize: number;
  readonly fontFamily: string | null;
  readonly focusRevision: number;
  readonly model: TerminalChromeModelView;
};

type SessionOwner =
  | { readonly kind: "drawer" }
  | { readonly kind: "panel"; readonly surfaceId: string }
  | { readonly kind: "external"; readonly onExit: () => void };

type SessionTarget = {
  readonly key: string;
  readonly route: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly input: TerminalAttachInput;
  readonly owner: SessionOwner;
};

type BuiltChrome = {
  readonly view: TerminalChromeView;
  readonly sessions: ReadonlyArray<SessionTarget>;
};

type Attachment = {
  readonly signature: string;
  target: SessionTarget;
  cursor: TerminalOutputCursor;
  synchronizedStatus: TerminalSessionState["status"];
  handledExit: boolean;
  lastError: string | null;
  unsubscribe: () => void;
};

const ChromeParams = Schema.Struct({ surfaceId: Schema.NullOr(Schema.String) });
const ActionParams = Schema.decodeUnknownSync(
  Schema.Struct({
    ...ChromeParams.fields,
    action: Schema.Literals(["split-horizontal", "split-vertical", "new", "close"]),
  }),
);
const SelectParams = Schema.decodeUnknownSync(
  Schema.Struct({
    ...ChromeParams.fields,
    source: Schema.Literals(["tab", "group", "pane"]),
    terminalId: Schema.String,
  }),
);
const CloseParams = Schema.decodeUnknownSync(
  Schema.Struct({ ...ChromeParams.fields, terminalId: Schema.String }),
);
const HeightParams = Schema.decodeUnknownSync(Schema.Struct({ height: Schema.Number }));
const InputParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, data: Schema.String }),
);
const KeyParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    event: Schema.Struct({
      key: Schema.String,
      metaKey: Schema.Boolean,
      ctrlKey: Schema.Boolean,
      altKey: Schema.Boolean,
      shiftKey: Schema.Boolean,
    }),
    data: Schema.NullOr(Schema.String),
  }),
);
const ResizeParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, cols: Schema.Int, rows: Schema.Int }),
);
const SurfaceParams = Schema.decodeUnknownSync(Schema.Struct({ surfaceId: Schema.String }));
const PointSchema = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const SelectionSchema = Schema.Struct({
  text: Schema.String,
  startRow: Schema.Number,
  endRow: Schema.Number,
});
const ContextMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    position: PointSchema,
    selection: Schema.NullOr(SelectionSchema),
  }),
);
const SelectionActionSchema = Schema.Struct({
  key: Schema.String,
  pointer: Schema.NullOr(PointSchema),
  bounds: Schema.Struct({
    left: Schema.Number,
    top: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  selectionRect: Schema.NullOr(Schema.Struct({ right: Schema.Number, bottom: Schema.Number })),
  viewport: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  selection: SelectionSchema,
});
const SelectionActionParams = Schema.decodeUnknownSync(SelectionActionSchema);
const LinkProbeParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    probe: Schema.Number,
    row: Schema.Int,
    column: Schema.Int,
    firstRow: Schema.Int,
    rows: Schema.Array(
      Schema.Struct({
        cells: Schema.Array(Schema.String),
        isWrapContinuation: Schema.Boolean,
        wrapsToNext: Schema.Boolean,
      }),
    ),
  }),
);
const LinkActivateSchema = Schema.Struct({
  key: Schema.String,
  text: Schema.String,
  metaKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
});
const LinkActivateParams = Schema.decodeUnknownSync(LinkActivateSchema);

export type TerminalLinkHoverView = {
  readonly key: string;
  readonly probe: number;
  readonly link: TerminalLinkWithRange | null;
};

type SelectionPayload = typeof SelectionSchema.Type;
type SelectionActionInput = typeof SelectionActionSchema.Type;
type LinkActivateInput = typeof LinkActivateSchema.Type;

function attachInput(
  thread: TerminalThread,
  terminalId: string,
  location: TerminalLaunchLocation,
): TerminalAttachInput {
  return {
    threadId: thread.threadId,
    terminalId,
    cwd: location.cwd,
    ...(location.worktreePath !== undefined ? { worktreePath: location.worktreePath } : {}),
    ...(location.runtimeEnv ? { env: location.runtimeEnv } : {}),
  };
}

export function createTerminalFeature(context: FeatureContext): CoreFeature {
  const { registry, state, platform } = context;
  void persistTerminalUiStore(context.storage);

  const viewportHeightAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);
  const focusRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);
  const bumpFocus = () => registry.set(focusRevisionAtom, registry.get(focusRevisionAtom) + 1);
  const read: Get = (atom) => registry.get(atom);

  const keybindingsOf = (get: Get): ResolvedKeybindingsConfig =>
    get(context.threadInputAtom)?.serverConfig?.keybindings ?? [];

  const fontOf = (get: Get) => {
    const settings = get(context.clientSettingsAtom);
    const advanced = get(typographyAdvancedStore(context.storage, registry).atom);
    const family = resolveTerminalFontPreference({
      advanced,
      code: settings.fontFamilyCode,
      terminal: settings.fontFamilyTerminal,
    }).trim();
    return {
      fontSize: resolveTerminalFontSizePreference({
        advanced,
        code: settings.fontSizeCode,
        terminal: settings.fontSizeTerminal,
      }),
      fontFamily: family.length > 0 ? family : null,
    };
  };

  const shortcutLabels = (get: Get, terminalOpen: boolean) => {
    const keybindings = keybindingsOf(get);
    const options = { platform, context: { terminalFocus: true, terminalOpen } };
    return {
      splitShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.split", options),
      splitVerticalShortcutLabel: shortcutLabelForCommand(
        keybindings,
        "terminal.splitVertical",
        options,
      ),
      newShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.new", options),
      closeShortcutLabel: shortcutLabelForCommand(keybindings, "terminal.close", options),
    };
  };

  const withSessions = (
    thread: TerminalThread,
    model: TerminalTabsModel,
    locationOf: (terminalId: string) => TerminalLaunchLocation,
    owner: SessionOwner,
  ): {
    readonly model: TerminalChromeModelView;
    readonly sessions: ReadonlyArray<SessionTarget>;
  } => {
    if (model.kind === "empty") return { model, sessions: [] };
    const sessions = model.viewports.map((viewport) => ({
      key: terminalSessionKey(thread.environmentId, thread.threadId, viewport.terminalId),
      route: thread.route,
      environmentId: thread.environmentId,
      input: attachInput(thread, viewport.terminalId, locationOf(viewport.terminalId)),
      owner,
    }));
    return {
      model: {
        ...model,
        viewports: model.viewports.map((viewport, index) => ({
          ...viewport,
          sessionKey: sessions[index]?.key ?? "",
        })),
      },
      sessions,
    };
  };

  const heightBounds = (get: Get) => {
    const viewportHeight = get(viewportHeightAtom);
    return {
      minHeight: clampTerminalDrawerHeight(TERMINAL_MIN_DRAWER_HEIGHT, viewportHeight),
      maxHeight: clampTerminalDrawerHeight(Number.MAX_SAFE_INTEGER, viewportHeight),
      clamp: (height: number) => clampTerminalDrawerHeight(height, viewportHeight),
    };
  };

  const drawerSummaries = (get: Get, route: ScopedThreadRef): ReadonlyArray<TerminalSummary> => {
    const { surfaces } = selectThreadRightPanelState(get(rightPanelStoreAtom).byThreadKey, route);
    const panelIds = new Set(
      surfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : [])),
    );
    return threadTerminalSummaries(get, context, route).filter(
      (summary) => !panelIds.has(summary.terminalId),
    );
  };

  const buildDrawer = (get: Get): BuiltChrome | null => {
    const thread = readTerminalThread(get, context);
    if (thread === null) return null;
    const uiState = routeTerminalUiState(get, thread.route);
    const visible = uiState.terminalOpen;
    const launchContext = activeTerminalLaunchContext(get, thread.threadId);
    const launch = drawerLaunch(get, thread);
    const summaries = drawerSummaries(get, thread.route);
    const labels = terminalLabelsForThread(get, context, thread.route);
    const launchLocations = new Map<string, TerminalLaunchLocation>();
    for (const summary of summaries) {
      const worktreePath =
        launchContext !== null ? launchContext.worktreePath : summary.worktreePath;
      launchLocations.set(summary.terminalId, {
        cwd: launchContext?.cwd ?? summary.cwd,
        worktreePath,
        runtimeEnv: projectScriptRuntimeEnv({
          project: { cwd: thread.workspaceRoot },
          worktreePath,
        }),
      });
    }
    const labelsByShortcut = visible ? shortcutLabels(get, true) : {};
    const model = buildTerminalTabsModel({
      mode: "drawer",
      terminalIds: uiState.terminalIds,
      activeTerminalId: uiState.activeTerminalId,
      terminalGroups: uiState.terminalGroups,
      activeTerminalGroupId: uiState.activeTerminalGroupId,
      terminalLabelsById: labels,
      ...labelsByShortcut,
    });
    const runtimeEnv = projectScriptRuntimeEnv({
      project: { cwd: thread.workspaceRoot },
      worktreePath: launch.worktreePath,
    });
    const built = withSessions(
      thread,
      model,
      (terminalId) =>
        resolveTerminalLaunchLocation({
          terminalId,
          launchLocationsById: launchLocations,
          cwd: launch.cwd,
          worktreePath: launch.worktreePath,
          runtimeEnv,
        }),
      { kind: "drawer" },
    );
    const bounds = heightBounds(get);
    return {
      view: {
        id: "drawer",
        visible,
        height: bounds.clamp(uiState.terminalHeight),
        minHeight: bounds.minHeight,
        maxHeight: bounds.maxHeight,
        ...fontOf(get),
        focusRevision: get(focusRevisionAtom),
        model: built.model,
      },
      sessions: built.sessions,
    };
  };

  const buildPanels = (get: Get): ReadonlyArray<BuiltChrome> => {
    const thread = readTerminalThread(get, context);
    if (thread === null) return [];
    const { byThreadKey } = get(rightPanelStoreAtom);
    const activeSurface = selectActiveRightPanelSurface(byThreadKey, thread.route);
    const launchContext = activeTerminalLaunchContext(get, thread.threadId);
    const summaries = threadTerminalSummaries(get, context, thread.route);
    const labels = terminalLabelsForThread(get, context, thread.route);
    const labelsByShortcut = shortcutLabels(
      get,
      routeTerminalUiState(get, thread.route).terminalOpen,
    );
    const font = fontOf(get);
    const focusRevision = get(focusRevisionAtom);
    return selectThreadRightPanelState(byThreadKey, thread.route).surfaces.flatMap((surface) => {
      if (surface.kind !== "terminal") return [];
      const locationOf = (terminalId: string): TerminalLaunchLocation => {
        const summary = summaries.find((candidate) => candidate.terminalId === terminalId) ?? null;
        const worktreePath =
          launchContext?.worktreePath ?? summary?.worktreePath ?? thread.worktreePath;
        return {
          cwd:
            launchContext?.cwd ??
            summary?.cwd ??
            projectScriptCwd({ project: { cwd: thread.workspaceRoot }, worktreePath }),
          worktreePath,
          runtimeEnv: projectScriptRuntimeEnv({
            project: { cwd: thread.workspaceRoot },
            worktreePath,
          }),
        };
      };
      const model = buildTerminalTabsModel({
        mode: "panel",
        terminalIds: surface.terminalIds,
        activeTerminalId: surface.activeTerminalId,
        terminalGroups: [
          {
            id: surface.id,
            terminalIds: surface.terminalIds,
            ...(surface.splitDirection === "vertical"
              ? { splitDirection: "vertical" as const }
              : {}),
          },
        ],
        activeTerminalGroupId: surface.id,
        terminalLabelsById: labels,
        ...labelsByShortcut,
      });
      const visible = activeSurface?.id === surface.id;
      const built = withSessions(thread, model, locationOf, {
        kind: "panel",
        surfaceId: surface.id,
      });
      return [
        {
          view: {
            id: surface.id,
            visible,
            height: 0,
            minHeight: 0,
            maxHeight: 0,
            ...font,
            focusRevision,
            model: built.model,
          },
          sessions: visible ? built.sessions : [],
        },
      ];
    });
  };

  const drawerAtom = Atom.make((get) => buildDrawer(get));
  const panelsAtom = Atom.make((get) => buildPanels(get));
  const drawerViewAtom = Atom.make(
    (get): TerminalChromeView | null => get(drawerAtom)?.view ?? null,
  );
  const panelsViewAtom = Atom.make((get): Readonly<Record<string, TerminalChromeView>> =>
    Object.fromEntries(get(panelsAtom).map((panel) => [panel.view.id, panel.view])),
  );
  const desiredSessionsAtom = Atom.make((get): ReadonlyArray<SessionTarget> => [
    ...(get(drawerAtom)?.sessions ?? []),
    ...get(panelsAtom).flatMap((panel) => panel.sessions),
    ...[...get(externalTerminalSessionsAtom)].map(([key, session]) => ({
      key,
      route: scopeThreadRef(session.environmentId, session.threadId),
      environmentId: session.environmentId,
      input: session.input,
      owner: { kind: "external" as const, onExit: session.onExit },
    })),
  ]);
  const terminalFontAtom = Atom.make((get) => fontOf(get));

  const attachments = new Map<string, Attachment>();

  const emit = (key: string, op: TerminalStreamOp, data: string) =>
    context.send({ t: "term", key, op, data });

  const emitSystemMessage = (key: string, message: string) =>
    emit(key, "append", formatTerminalSystemMessage(message));

  const errorText = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const closeOwned = (target: SessionTarget, terminalId: string) => {
    switch (target.owner.kind) {
      case "drawer":
        closeDrawerTerminal(context, target.route, terminalId);
        return;
      case "panel":
        closePanelTerminal(context, target.owner.surfaceId, terminalId);
        return;
      case "external":
        target.owner.onExit();
        return;
    }
  };

  const onBuffer = (attachment: Attachment, buffer: TerminalBufferState) => {
    const { key } = attachment.target;
    const update = readTerminalOutputUpdate(buffer.output, attachment.cursor);
    if (update.type !== "none") emit(key, update.type, update.data);
    attachment.cursor = update.cursor;
    if (buffer.version > 0) {
      const status = buffer.status;
      if (status === "running") {
        attachment.handledExit = false;
      } else if (
        shouldHandleTerminalExit(status, attachment.synchronizedStatus, attachment.handledExit)
      ) {
        attachment.handledExit = true;
        emit(key, "append", formatTerminalSystemMessage(terminalExitMessage(status)));
        setTimeout(() => {
          if (!attachment.handledExit) return;
          void requestTerminalClose(
            context,
            attachment.target.input.terminalId,
            "session-exited",
            (terminalId) => closeOwned(attachment.target, terminalId),
          );
        }, 0);
      }
      attachment.synchronizedStatus = status;
    }
    if (buffer.error !== null && buffer.error !== attachment.lastError) {
      emit(key, "append", formatTerminalSystemMessage(buffer.error));
    }
    attachment.lastError = buffer.error;
  };

  const attach = (target: SessionTarget, signature: string): Attachment => {
    const attachment: Attachment = {
      signature,
      target,
      cursor: INITIAL_TERMINAL_OUTPUT_CURSOR,
      synchronizedStatus: "closed",
      handledExit: false,
      lastError: null,
      unsubscribe: () => undefined,
    };
    attachment.unsubscribe = registry.subscribe(
      state.terminalEnvironment.attach({
        environmentId: target.environmentId,
        input: target.input,
      }),
      (result) => {
        if (AsyncResult.isFailure(result)) {
          const message = formatEnvironmentQueryError(result.cause);
          if (message !== attachment.lastError) {
            attachment.lastError = message;
            emit(target.key, "append", formatTerminalSystemMessage(message));
          }
          return;
        }
        const buffer = Option.getOrNull(AsyncResult.value(result));
        if (buffer !== null) onBuffer(attachment, buffer);
      },
      { immediate: true },
    );
    return attachment;
  };

  registry.subscribe(
    desiredSessionsAtom,
    (targets) => {
      const desired = new Map(targets.map((target) => [target.key, target]));
      for (const [key, attachment] of attachments) {
        const target = desired.get(key);
        if (target === undefined || JSON.stringify(target.input) !== attachment.signature) {
          attachment.unsubscribe();
          attachments.delete(key);
        } else {
          attachment.target = target;
        }
      }
      for (const [key, target] of desired) {
        if (attachments.has(key)) continue;
        attachments.set(key, attach(target, JSON.stringify(target.input)));
      }
    },
    { immediate: true },
  );

  const terminalOpenByThreadKey = new Map<string, boolean>();
  registry.subscribe(
    Atom.make((get) => {
      const route = get(context.routeAtom);
      if (route === null) return null;
      return {
        threadKey: scopedThreadKey(route),
        open: routeTerminalUiState(get, route).terminalOpen,
      };
    }),
    (snapshot) => {
      if (snapshot === null) return;
      const previous = terminalOpenByThreadKey.get(snapshot.threadKey) ?? false;
      terminalOpenByThreadKey.set(snapshot.threadKey, snapshot.open);
      if (!previous && snapshot.open) bumpFocus();
      else if (previous && !snapshot.open) composerInputService(context).focus();
    },
    { immediate: true },
  );

  registry.subscribe(
    Atom.make((get) => {
      const thread = readTerminalThread(get, context);
      if (thread === null) return null;
      return {
        route: thread.route,
        serverIds: drawerSummaries(get, thread.route).map((summary) => summary.terminalId),
        clientIds: routeTerminalUiState(get, thread.route).terminalIds,
      };
    }),
    (snapshot) => {
      if (snapshot === null) return;
      const { route, serverIds, clientIds } = snapshot;
      if (terminalIdListsEqual(serverIds, clientIds)) return;
      if (serverTerminalIdsStrictSubsetOfClient(serverIds, clientIds)) return;
      useTerminalUiStateStore.getState().reconcileTerminalIds(route, [...serverIds]);
    },
    { immediate: true },
  );

  registry.subscribe(
    Atom.make((get) => {
      const launchContext = get(terminalLaunchContextAtom);
      const route = get(context.routeAtom);
      if (launchContext === null) return false;
      if (route === null || launchContext.threadId !== route.threadId) return true;
      if (!routeTerminalUiState(get, route).terminalOpen) return true;
      const thread = readTerminalThread(get, context);
      if (thread === null) return false;
      const settledCwd = projectScriptCwd({
        project: { cwd: thread.workspaceRoot },
        worktreePath: thread.worktreePath,
      });
      return settledCwd === launchContext.cwd && thread.worktreePath === launchContext.worktreePath;
    }),
    (shouldClear) => {
      if (shouldClear) registry.set(terminalLaunchContextAtom, null);
    },
    { immediate: true },
  );

  const drawerModel = () => registry.get(drawerAtom)?.view.model ?? null;
  const panelModel = (surfaceId: string) =>
    registry.get(panelsAtom).find((panel) => panel.view.id === surfaceId)?.view.model ?? null;

  const runChromeAction = (surfaceId: string | null, action: TerminalActionId) => {
    const model = surfaceId === null ? drawerModel() : panelModel(surfaceId);
    if (model === null) return;
    const ready = model.kind === "ready" ? model : null;
    const intent = resolveTerminalAction({
      action,
      splitLimitReached: ready?.splitLimitReached ?? false,
      activeTerminalId: ready?.activeTerminalId ?? "",
    });
    switch (intent.kind) {
      case "split":
        if (surfaceId === null) createDrawerTerminal(context, intent, "drawer");
        else splitPanelTerminal(context, surfaceId, intent.direction);
        bumpFocus();
        return;
      case "new":
        if (surfaceId === null) createDrawerTerminal(context, intent, "drawer");
        else void openPanelTerminal(context);
        bumpFocus();
        return;
      case "request-close":
        void closeFromChrome(surfaceId, intent.terminalId);
        return;
      case "none":
        return;
    }
  };

  const closeFromChrome = (surfaceId: string | null, terminalId: string) =>
    requestTerminalClose(context, terminalId, "user", (id) => {
      const route = registry.get(context.routeAtom);
      if (route === null) return;
      if (surfaceId === null) closeDrawerTerminal(context, route, id);
      else closePanelTerminal(context, surfaceId, id);
      bumpFocus();
    });

  const targetOf = (key: string) => {
    const attachment = attachments.get(key);
    if (attachment === undefined) {
      throw new Error("Terminal input is not available in the native app yet.");
    }
    const { environmentId, input, route } = attachment.target;
    return { environmentId, threadId: route.threadId, terminalId: input.terminalId };
  };

  const write = (key: string, data: string, failureMessage = "Terminal write failed") => {
    const local = localTerminal(key);
    if (local !== undefined) {
      local.input(data);
      return;
    }
    const target = targetOf(key);
    for (let offset = 0; offset < data.length; offset += MAX_WRITE_CHARS) {
      void writeTerminalSession(context, target, data.slice(offset, offset + MAX_WRITE_CHARS)).then(
        (result) => {
          if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
          emitSystemMessage(key, errorText(squashAtomCommandFailure(result), failureMessage));
        },
      );
    }
  };

  const attachmentOf = (key: string) => {
    const attachment = attachments.get(key);
    if (attachment === undefined) {
      throw new Error("This terminal is not available in the native app yet.");
    }
    return attachment;
  };

  const contextSelection = (
    attachment: Attachment,
    selection: SelectionPayload,
  ): TerminalContextSelection | null => {
    const text = normalizeTerminalContextText(selection.text);
    if (text.length === 0) return null;
    const { lineStart, lineEnd } = terminalSelectionLineRange({
      start: { y: selection.startRow },
      end: { y: selection.endRow },
    });
    const terminalId = attachment.target.input.terminalId;
    return {
      terminalId,
      terminalLabel:
        terminalLabelsForThread(read, context, attachment.target.route).get(terminalId) ??
        getTerminalLabel(terminalId),
      lineStart,
      lineEnd,
      text,
    };
  };

  const addSelectionToChat = (attachment: Attachment, selection: TerminalContextSelection) => {
    const drawerHidden =
      attachment.target.owner.kind === "drawer" && registry.get(drawerAtom)?.view.visible !== true;
    if (!drawerHidden) composerInputService(context).addTerminalContext(selection);
    emit(attachment.target.key, "clear-selection", "");
    emit(attachment.target.key, "focus", "");
  };

  const copySelection = async (key: string, text: string) => {
    try {
      await clipboardService(context).writeText(text);
    } catch (error) {
      emitSystemMessage(key, errorText(error, "Unable to copy terminal selection"));
    }
    emit(key, "focus", "");
  };

  const showContextMenu = async (
    key: string,
    position: { readonly x: number; readonly y: number },
    selection: SelectionPayload | null,
  ) => {
    const attachment = attachmentOf(key);
    const contextSelectionValue =
      selection === null ? null : contextSelection(attachment, selection);
    let clicked: "add-to-chat" | "copy" | "paste" | null;
    try {
      clicked = await contextMenuService(context).show(
        terminalContextMenuItems({
          hasSelection: contextSelectionValue !== null,
          canAddToChat: attachment.target.owner.kind !== "external",
        }),
        position,
      );
    } catch (error) {
      emitSystemMessage(key, errorText(error, "Unable to open the terminal context menu"));
      emit(key, "focus", "");
      return;
    }
    switch (clicked) {
      case "add-to-chat":
        if (contextSelectionValue !== null) addSelectionToChat(attachment, contextSelectionValue);
        return;
      case "copy":
        if (selection !== null && contextSelectionValue !== null) {
          await copySelection(key, selection.text);
        }
        return;
      case "paste":
        emit(key, "paste", "");
        return;
      case null:
        return;
    }
  };

  const showSelectionAction = async (params: SelectionActionInput) => {
    const attachment = attachmentOf(params.key);
    const selection = contextSelection(attachment, params.selection);
    if (selection === null) return;
    const position = resolveSelectionActionPosition({
      bounds: params.bounds,
      selectionRect: params.selectionRect,
      pointer: params.pointer,
      viewport: params.viewport,
    });
    const clicked = await contextMenuService(context).show(
      terminalSelectionMenuItems({ canAddToChat: attachment.target.owner.kind !== "external" }),
      position,
    );
    switch (clicked) {
      case "add-to-chat":
        addSelectionToChat(attachment, selection);
        return;
      case "copy":
        await copySelection(params.key, params.selection.text);
        return;
      case null:
        return;
    }
  };

  const activateLink = async (params: LinkActivateInput) => {
    const attachment = attachmentOf(params.key);
    const { key, text } = params;
    const { environmentId, input } = attachment.target;
    if (isTerminalUrl(text)) {
      await openExternal(text).catch((error: unknown) =>
        emitSystemMessage(key, errorText(error, "Unable to open link")),
      );
      return;
    }
    const result = await openInPreferredEditor({
      environmentId,
      availableEditors:
        registry.get(state.serverEnvironment.configValueAtom(environmentId))?.availableEditors ??
        [],
      targetPath: resolvePathLinkTarget(text, input.cwd ?? ""),
      openInEditor: (target) =>
        runAtomCommand(registry, state.shellEnvironment.openInEditor, target, {
          reportFailure: false,
        }),
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    emitSystemMessage(key, errorText(squashAtomCommandFailure(result), "Unable to open path"));
  };

  const linkHoverAtom = Atom.make<TerminalLinkHoverView | null>(null).pipe(Atom.keepAlive);

  const runShortcutCommand = (owner: SessionOwner, command: string) => {
    const route = registry.get(context.routeAtom);
    if (route === null) return;
    const uiState = routeTerminalUiState(read, route);
    const store = useTerminalUiStateStore.getState();
    const panelSurfaceId = owner.kind === "panel" ? owner.surfaceId : null;
    switch (command) {
      case "terminal.toggle":
        toggleTerminalDrawer(context);
        return;
      case "terminal.split":
      case "terminal.splitVertical": {
        const direction = command === "terminal.split" ? "horizontal" : "vertical";
        if (panelSurfaceId !== null) {
          splitPanelTerminal(context, panelSurfaceId, direction);
        } else {
          const model = drawerModel();
          if (model?.kind === "ready" && model.splitLimitReached) return;
          if (!uiState.terminalOpen) store.setTerminalOpen(route, true);
          createDrawerTerminal(context, { kind: "split", direction }, "shortcut");
        }
        bumpFocus();
        return;
      }
      case "terminal.new":
        if (panelSurfaceId !== null) {
          void openPanelTerminal(context);
        } else {
          if (!uiState.terminalOpen) store.setTerminalOpen(route, true);
          createDrawerTerminal(context, { kind: "new" }, "shortcut");
        }
        bumpFocus();
        return;
      case "terminal.close": {
        if (panelSurfaceId !== null) {
          const model = panelModel(panelSurfaceId);
          if (model?.kind === "ready") void closeFromChrome(panelSurfaceId, model.activeTerminalId);
          return;
        }
        if (!uiState.terminalOpen) return;
        void closeFromChrome(null, uiState.activeTerminalId);
        return;
      }
      default:
        return;
    }
  };

  return {
    views: {
      terminalDrawer: drawerViewAtom,
      terminalPanels: panelsViewAtom,
      terminalLinkHover: linkHoverAtom,
      terminalFont: terminalFontAtom,
    },
    actions: {
      terminalToggleDrawer: async () => {
        toggleTerminalDrawer(context);
        return null;
      },
      terminalAction: async (params) => {
        const { surfaceId, action } = ActionParams(params);
        runChromeAction(surfaceId, action);
        return null;
      },
      terminalSelect: async (params) => {
        const { surfaceId, source, terminalId } = SelectParams(params);
        const model = surfaceId === null ? drawerModel() : panelModel(surfaceId);
        const intent = resolveTerminalSelect({
          source,
          terminalId,
          activeTerminalId: model?.kind === "ready" ? model.activeTerminalId : "",
        });
        if (intent.kind !== "activate") return null;
        const route = registry.get(context.routeAtom);
        if (route === null) return null;
        if (surfaceId === null) {
          useTerminalUiStateStore.getState().setActiveTerminal(route, intent.terminalId);
        } else {
          activatePanelTerminal(context, surfaceId, intent.terminalId);
        }
        bumpFocus();
        return null;
      },
      terminalClose: async (params) => {
        const { surfaceId, terminalId } = CloseParams(params);
        await closeFromChrome(surfaceId, terminalId);
        return null;
      },
      terminalDrawerHeight: async (params) => {
        const route = registry.get(context.routeAtom);
        if (route === null) return null;
        const height = heightBounds(read).clamp(HeightParams(params).height);
        useTerminalUiStateStore.getState().setTerminalHeight(route, height);
        return height;
      },
      terminalWindowHeight: async (params) => {
        registry.set(viewportHeightAtom, HeightParams(params).height);
        return null;
      },
      terminalInput: async (params) => {
        const { key, data } = InputParams(params);
        if (data.length > 0) write(key, data);
        return null;
      },
      terminalKey: async (params) => {
        const { key, event, data } = KeyParams(params);
        const keybindings = keybindingsOf(read);
        const intent = resolveTerminalKeyDown({ event, keybindings, platform });
        switch (intent.kind) {
          case "send-input":
            write(key, intent.data, intent.failureMessage);
            return null;
          case "pass-through":
            if (data !== null && data.length > 0) write(key, data);
            return null;
          case "block-close-shortcut":
          case "defer-to-app": {
            const route = registry.get(context.routeAtom);
            const command = resolveShortcutCommand(event, keybindings, {
              platform,
              context: {
                terminalFocus: true,
                terminalOpen:
                  route === null ? false : routeTerminalUiState(read, route).terminalOpen,
              },
            });
            const attachment = attachments.get(key);
            if (
              command !== null &&
              attachment !== undefined &&
              attachment.target.owner.kind !== "external"
            ) {
              runShortcutCommand(attachment.target.owner, command);
            }
            return null;
          }
        }
      },
      terminalResize: async (params) => {
        const { key, cols, rows } = ResizeParams(params);
        if (localTerminal(key) !== undefined) return null;
        const target = targetOf(key);
        void runAtomCommand(
          registry,
          state.terminalEnvironment.resize,
          {
            environmentId: target.environmentId,
            input: { threadId: target.threadId, terminalId: target.terminalId, cols, rows },
          },
          { label: "terminal resize", reportFailure: false },
        );
        return null;
      },
      terminalPanelNew: async () => {
        await openPanelTerminal(context);
        bumpFocus();
        return null;
      },
      terminalPanelCloseSurface: async (params) => {
        await closePanelTerminalSurface(context, SurfaceParams(params).surfaceId);
        return null;
      },
      terminalContextMenu: async (params) => {
        const { key, position, selection } = ContextMenuParams(params);
        await showContextMenu(key, position, selection);
        return null;
      },
      terminalSelectionAction: async (params) => {
        await showSelectionAction(SelectionActionParams(params));
        return null;
      },
      terminalLinkProbe: async (params) => {
        const { key, probe, row, column, firstRow, rows } = LinkProbeParams(params);
        const link = terminalLinkAtPositionWithRange(
          rows.map((entry) => ({
            cells: entry.cells.map((text) => ({ text })),
            isWrapContinuation: entry.isWrapContinuation,
            wrapsToNext: entry.wrapsToNext,
          })),
          row - firstRow,
          column,
        );
        registry.set(linkHoverAtom, {
          key,
          probe,
          link:
            link === null
              ? null
              : {
                  text: link.text,
                  range: {
                    start: { x: link.range.start.x, y: link.range.start.y + firstRow },
                    end: { x: link.range.end.x, y: link.range.end.y + firstRow },
                  },
                },
        });
        return null;
      },
      terminalLinkActivate: async (params) => {
        await activateLink(LinkActivateParams(params));
        return null;
      },
    },
  };
}
