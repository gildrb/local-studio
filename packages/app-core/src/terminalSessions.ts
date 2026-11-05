import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ScopedThreadRef,
  TerminalAttachInput,
  TerminalOpenInput,
  TerminalSummary,
  ThreadId,
} from "@t3tools/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import {
  getTerminalLabel,
  nextTerminalId,
  resolveTerminalSessionLabel,
} from "@t3tools/shared/terminalLabels";
import {
  SCRIPT_TERMINAL_COLS,
  SCRIPT_TERMINAL_ROWS,
  resolveTerminalCloseRequest,
  terminalCloseConfirmMessage,
  type TerminalCloseReason,
  type TerminalSplitDirection,
} from "@t3tools/web/src/components/ThreadTerminalDrawer.logic.ts";
import { resolveTerminalToggleIntent } from "@t3tools/web/src/components/chat/PanelLayoutControls.logic.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
} from "@t3tools/web/src/rightPanelStore.ts";
import { sortTerminalSummaries } from "@t3tools/web/src/state/terminalSessions.logic.ts";
import { useTerminalUiStateStore } from "@t3tools/web/src/terminalUiStateStore.ts";
import { DEFAULT_THREAD_TERMINAL_ID, MAX_TERMINALS_PER_GROUP } from "@t3tools/web/src/types.ts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "./feature.ts";
import { rightPanelStoreAtom } from "./rightPanelState.ts";
import { routeTerminalUiState } from "./terminalState.ts";

export type Get = <A>(atom: Atom.Atom<A>) => A;

export type TerminalLaunchContext = {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly worktreePath: string | null;
};

export type TerminalThread = {
  readonly route: ScopedThreadRef;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly gitCwd: string | null;
};

export const terminalLaunchContextAtom = Atom.make<TerminalLaunchContext | null>(null).pipe(
  Atom.keepAlive,
);

export type ExternalTerminalSession = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly input: TerminalAttachInput;
  readonly onExit: () => void;
};

export const externalTerminalSessionsAtom = Atom.make<ReadonlyMap<string, ExternalTerminalSession>>(
  new Map(),
).pipe(Atom.keepAlive);

export function terminalSessionKey(
  environmentId: string,
  threadId: string,
  terminalId: string,
): string {
  return JSON.stringify([environmentId, threadId, terminalId]);
}

export function registerExternalTerminalSession(
  context: FeatureContext,
  session: ExternalTerminalSession,
): { readonly sessionKey: string; readonly dispose: () => void } {
  const { registry } = context;
  const sessionKey = terminalSessionKey(
    session.environmentId,
    session.threadId,
    session.input.terminalId,
  );
  registry.set(
    externalTerminalSessionsAtom,
    new Map(registry.get(externalTerminalSessionsAtom)).set(sessionKey, session),
  );
  return {
    sessionKey,
    dispose: () => {
      const current = registry.get(externalTerminalSessionsAtom);
      if (current.get(sessionKey) !== session) return;
      const next = new Map(current);
      next.delete(sessionKey);
      registry.set(externalTerminalSessionsAtom, next);
    },
  };
}

export function readTerminalThread(get: Get, context: FeatureContext): TerminalThread | null {
  const input = get(context.threadInputAtom);
  if (input === null || input.project === undefined) return null;
  return {
    route: input.route,
    environmentId: input.route.environmentId,
    threadId: input.route.threadId,
    workspaceRoot: input.project.workspaceRoot,
    worktreePath: input.thread.worktreePath ?? null,
    gitCwd: get(context.gitStatusAtom)?.gitCwd ?? null,
  };
}

export function threadTerminalSummaries(
  get: Get,
  context: FeatureContext,
  route: ScopedThreadRef,
): ReadonlyArray<TerminalSummary> {
  const metadata = Option.getOrNull(
    AsyncResult.value(
      get(
        context.state.terminalEnvironment.metadata({
          environmentId: route.environmentId,
          input: null,
        }),
      ),
    ),
  );
  if (metadata === null) return [];
  return sortTerminalSummaries(metadata).filter((summary) => summary.threadId === route.threadId);
}

export function panelTerminalIds(get: Get, route: ScopedThreadRef): ReadonlySet<string> {
  const { surfaces } = selectThreadRightPanelState(get(rightPanelStoreAtom).byThreadKey, route);
  return new Set(
    surfaces.flatMap((surface) => (surface.kind === "terminal" ? surface.terminalIds : [])),
  );
}

export function allocatableTerminalIds(
  get: Get,
  context: FeatureContext,
  route: ScopedThreadRef,
): ReadonlyArray<string> {
  const known = threadTerminalSummaries(get, context, route).map((summary) => summary.terminalId);
  return [
    ...new Set([
      ...known,
      ...routeTerminalUiState(get, route).terminalIds,
      ...panelTerminalIds(get, route),
    ]),
  ];
}

export function terminalLabelsForThread(
  get: Get,
  context: FeatureContext,
  route: ScopedThreadRef,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const summary of threadTerminalSummaries(get, context, route)) {
    labels.set(summary.terminalId, resolveTerminalSessionLabel(summary.terminalId, summary));
  }
  return labels;
}

export function createTerminalLabelsAtom(
  context: FeatureContext,
): Atom.Atom<ReadonlyMap<string, string>> {
  return Atom.make((get): ReadonlyMap<string, string> => {
    const route = get(context.routeAtom);
    return route === null ? new Map() : terminalLabelsForThread(get, context, route);
  });
}

export function activeTerminalLaunchContext(
  get: Get,
  threadId: ThreadId,
): TerminalLaunchContext | null {
  const launchContext = get(terminalLaunchContextAtom);
  return launchContext?.threadId === threadId ? launchContext : null;
}

function registryGet(context: FeatureContext): Get {
  return (atom) => context.registry.get(atom);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

export function openTerminalSession(
  context: FeatureContext,
  environmentId: EnvironmentId,
  input: TerminalOpenInput,
) {
  return runAtomCommand(
    context.registry,
    context.state.terminalEnvironment.open,
    { environmentId, input },
    { label: "terminal open" },
  );
}

export function writeTerminalSession(
  context: FeatureContext,
  target: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly terminalId: string;
  },
  data: string,
  label = "terminal write",
) {
  return runAtomCommand(
    context.registry,
    context.state.terminalEnvironment.write,
    {
      environmentId: target.environmentId,
      input: { threadId: target.threadId, terminalId: target.terminalId, data },
    },
    { label },
  );
}

function closeTerminalSession(context: FeatureContext, route: ScopedThreadRef, terminalId: string) {
  return runAtomCommand(
    context.registry,
    context.state.terminalEnvironment.close,
    {
      environmentId: route.environmentId,
      input: { threadId: route.threadId, terminalId, deleteHistory: true },
    },
    { label: "terminal close" },
  );
}

function openInput(
  thread: TerminalThread,
  terminalId: string,
  cwd: string,
  worktreePath: string | null,
): TerminalOpenInput {
  return {
    threadId: thread.threadId,
    terminalId,
    cwd,
    ...(worktreePath != null ? { worktreePath } : {}),
    env: projectScriptRuntimeEnv({ project: { cwd: thread.workspaceRoot }, worktreePath }),
  };
}

export function drawerLaunch(
  get: Get,
  thread: TerminalThread,
): { readonly cwd: string; readonly worktreePath: string | null } {
  const launchContext = activeTerminalLaunchContext(get, thread.threadId);
  const worktreePath = launchContext !== null ? launchContext.worktreePath : thread.worktreePath;
  return {
    cwd:
      launchContext?.cwd ??
      projectScriptCwd({ project: { cwd: thread.workspaceRoot }, worktreePath }),
    worktreePath,
  };
}

export function toggleTerminalDrawer(context: FeatureContext): void {
  const get = registryGet(context);
  const route = get(context.routeAtom);
  if (route === null) return;
  const thread = readTerminalThread(get, context);
  const uiState = routeTerminalUiState(get, route);
  const intent = resolveTerminalToggleIntent({
    hasThread: true,
    threadId: route.threadId,
    terminalOpen: uiState.terminalOpen,
    terminalCount: uiState.terminalIds.length,
    projectWorkspaceRoot: thread?.workspaceRoot ?? null,
    gitCwd: thread?.gitCwd ?? null,
    worktreePath: thread?.worktreePath ?? null,
    allocatableTerminalIds: allocatableTerminalIds(get, context, route),
  });
  if (intent.kind === "none") return;
  if (intent.kind === "open-first-terminal") {
    useTerminalUiStateStore.getState().ensureTerminal(route, intent.terminalId, { open: true });
    void openTerminalSession(context, route.environmentId, intent.input);
    return;
  }
  useTerminalUiStateStore.getState().setTerminalOpen(route, intent.open);
}

export type TerminalCreateOrigin = "drawer" | "shortcut";

export function createDrawerTerminal(
  context: FeatureContext,
  mode:
    | { readonly kind: "new" }
    | { readonly kind: "split"; readonly direction: TerminalSplitDirection },
  origin: TerminalCreateOrigin,
): void {
  const get = registryGet(context);
  const thread = readTerminalThread(get, context);
  if (thread === null) return;
  const launch =
    origin === "drawer"
      ? drawerLaunch(get, thread)
      : { cwd: thread.gitCwd ?? thread.workspaceRoot, worktreePath: thread.worktreePath };
  const terminalId = nextTerminalId(allocatableTerminalIds(get, context, thread.route));
  const store = useTerminalUiStateStore.getState();
  if (mode.kind === "new") store.newTerminal(thread.route, terminalId);
  else if (mode.direction === "vertical") store.splitTerminalVertical(thread.route, terminalId);
  else store.splitTerminal(thread.route, terminalId);
  void openTerminalSession(
    context,
    thread.environmentId,
    openInput(thread, terminalId, launch.cwd, launch.worktreePath),
  );
}

export function closeDrawerTerminal(
  context: FeatureContext,
  route: ScopedThreadRef,
  terminalId: string,
) {
  void (async () => {
    const closeResult = await closeTerminalSession(context, route, terminalId);
    if (closeResult._tag === "Failure" && !isAtomCommandInterrupted(closeResult)) {
      await writeTerminalSession(
        context,
        { environmentId: route.environmentId, threadId: route.threadId, terminalId },
        "exit\n",
      );
    }
  })();
  useTerminalUiStateStore.getState().closeTerminal(route, terminalId);
}

async function confirmClose(labels: readonly [string, ...string[]]): Promise<boolean> {
  return (
    (await requestConfirmDialog(terminalCloseConfirmMessage(labels), { variant: "destructive" })) ??
    false
  );
}

export async function requestTerminalClose(
  context: FeatureContext,
  terminalId: string,
  reason: TerminalCloseReason,
  close: (terminalId: string) => void,
): Promise<void> {
  const get = registryGet(context);
  const route = get(context.routeAtom);
  const labels = route === null ? undefined : terminalLabelsForThread(get, context, route);
  const intent = resolveTerminalCloseRequest({ terminalId, reason, terminalLabelsById: labels });
  if (intent.kind === "close") {
    close(intent.terminalId);
    return;
  }
  if (await confirmClose(intent.confirmLabels)) close(intent.terminalId);
}

export async function runCommandInThreadTerminal(
  context: FeatureContext,
  input: {
    readonly cwd: string;
    readonly worktreePath: string | null;
    readonly extraEnv?: Record<string, string>;
    readonly command: string;
    readonly preferNewTerminal?: boolean;
    readonly failureMessage: string;
  },
): Promise<void> {
  const get = registryGet(context);
  const thread = readTerminalThread(get, context);
  if (thread === null) return;
  const { route } = thread;
  const uiState = routeTerminalUiState(get, route);
  const summaries = threadTerminalSummaries(get, context, route);
  const knownTerminalIds = [
    ...new Set([...summaries.map((summary) => summary.terminalId), ...uiState.terminalIds]),
  ];
  const runningTerminalIds = summaries
    .filter((summary) => summary.hasRunningSubprocess)
    .map((summary) => summary.terminalId);
  const baseTerminalId =
    uiState.activeTerminalId || knownTerminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
  const shouldCreateNewTerminal =
    Boolean(input.preferNewTerminal) || runningTerminalIds.includes(baseTerminalId);
  context.registry.set(terminalLaunchContextAtom, {
    threadId: thread.threadId,
    cwd: input.cwd,
    worktreePath: input.worktreePath,
  });
  const store = useTerminalUiStateStore.getState();
  store.setTerminalOpen(route, true);
  const env = projectScriptRuntimeEnv({
    project: { cwd: thread.workspaceRoot },
    worktreePath: input.worktreePath,
    ...(input.extraEnv ? { extraEnv: input.extraEnv } : {}),
  });
  const terminalId = shouldCreateNewTerminal
    ? nextTerminalId(allocatableTerminalIds(get, context, route))
    : baseTerminalId;
  const openTerminalInput: TerminalOpenInput = {
    threadId: thread.threadId,
    terminalId,
    cwd: input.cwd,
    ...(input.worktreePath !== null ? { worktreePath: input.worktreePath } : {}),
    env,
    ...(shouldCreateNewTerminal ? { cols: SCRIPT_TERMINAL_COLS, rows: SCRIPT_TERMINAL_ROWS } : {}),
  };
  if (shouldCreateNewTerminal) store.newTerminal(route, terminalId);
  else store.setActiveTerminal(route, terminalId);

  const openResult = await openTerminalSession(context, thread.environmentId, openTerminalInput);
  if (openResult._tag === "Failure") {
    if (!isAtomCommandInterrupted(openResult)) {
      context.setThreadError(
        thread.threadId,
        errorMessage(squashAtomCommandFailure(openResult)) || input.failureMessage,
      );
    }
    return;
  }
  const writeResult = await writeTerminalSession(
    context,
    { environmentId: thread.environmentId, threadId: thread.threadId, terminalId },
    `${input.command}\r`,
  );
  if (writeResult._tag === "Failure" && !isAtomCommandInterrupted(writeResult)) {
    context.setThreadError(
      thread.threadId,
      errorMessage(squashAtomCommandFailure(writeResult)) || input.failureMessage,
    );
  }
}

export function openPanelTerminal(context: FeatureContext): Promise<void> {
  const get = registryGet(context);
  const thread = readTerminalThread(get, context);
  if (thread === null) return Promise.resolve();
  const cwd = thread.gitCwd ?? thread.workspaceRoot;
  const terminalId = nextTerminalId(allocatableTerminalIds(get, context, thread.route));
  useRightPanelStore.getState().openTerminal(thread.route, terminalId);
  return openTerminalSession(
    context,
    thread.environmentId,
    openInput(thread, terminalId, cwd, thread.worktreePath),
  ).then(() => undefined);
}

function panelSurface(get: Get, route: ScopedThreadRef, surfaceId: string) {
  const surface = selectThreadRightPanelState(
    get(rightPanelStoreAtom).byThreadKey,
    route,
  ).surfaces.find((candidate) => candidate.id === surfaceId);
  return surface?.kind === "terminal" ? surface : null;
}

export function splitPanelTerminal(
  context: FeatureContext,
  surfaceId: string,
  direction: TerminalSplitDirection,
): void {
  const get = registryGet(context);
  const thread = readTerminalThread(get, context);
  if (thread === null) return;
  const surface = panelSurface(get, thread.route, surfaceId);
  if (surface === null || surface.terminalIds.length >= MAX_TERMINALS_PER_GROUP) return;
  const terminalId = nextTerminalId(allocatableTerminalIds(get, context, thread.route));
  const cwd = thread.gitCwd ?? thread.workspaceRoot;
  useRightPanelStore.getState().splitTerminal(thread.route, surface.id, terminalId, direction);
  void openTerminalSession(
    context,
    thread.environmentId,
    openInput(thread, terminalId, cwd, thread.worktreePath),
  );
}

export function activatePanelTerminal(
  context: FeatureContext,
  surfaceId: string,
  terminalId: string,
): void {
  const route = context.registry.get(context.routeAtom);
  if (route === null) return;
  useRightPanelStore.getState().activateTerminal(route, surfaceId, terminalId);
}

export function closePanelTerminal(
  context: FeatureContext,
  surfaceId: string,
  terminalId: string,
): void {
  const route = context.registry.get(context.routeAtom);
  if (route === null) return;
  void closeTerminalSession(context, route, terminalId);
  useTerminalUiStateStore.getState().closeTerminal(route, terminalId);
  useRightPanelStore.getState().closeTerminal(route, surfaceId, terminalId);
}

export async function closePanelTerminalSessions(
  context: FeatureContext,
  route: ScopedThreadRef,
  terminalIds: ReadonlyArray<string>,
): Promise<void> {
  const closes = terminalIds.map((terminalId) => {
    useTerminalUiStateStore.getState().closeTerminal(route, terminalId);
    return closeTerminalSession(context, route, terminalId);
  });
  await Promise.all(closes);
}

export async function closePanelTerminalSurface(
  context: FeatureContext,
  surfaceId: string,
): Promise<void> {
  const get = registryGet(context);
  const route = get(context.routeAtom);
  if (route === null) return;
  const surface = panelSurface(get, route, surfaceId);
  if (surface === null) return;
  const labels = terminalLabelsForThread(get, context, route);
  const labelOf = (terminalId: string) => labels.get(terminalId) ?? getTerminalLabel(terminalId);
  const confirmed = await confirmClose([
    labelOf(surface.activeTerminalId),
    ...surface.terminalIds
      .filter((terminalId) => terminalId !== surface.activeTerminalId)
      .map(labelOf),
  ]);
  if (!confirmed) return;
  void closePanelTerminalSessions(context, route, surface.terminalIds);
  useRightPanelStore.getState().closeSurface(route, surface.id);
}
