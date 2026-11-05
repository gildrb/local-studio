import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import {
  EnvironmentId,
  ProviderInstanceId,
  RuntimeMode,
  type ServerConfig,
  ThreadId,
  TurnId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { mergeEnvironmentThread } from "@t3tools/client-runtime/state/threads";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { projectScriptCwd } from "@t3tools/shared/projectScripts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import {
  buildRunningThreadTurnInterruptInput,
  resolveDraftHeroState,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import { syntaxHighlighterRevisionAtom } from "./syntaxHighlight.ts";
import { userMessageImages, workspaceImageResolver } from "./timelineImages.ts";
import { attachmentVideoView } from "./features/mediaViewer.ts";
import { derivePhase } from "@t3tools/web/src/session-logic.ts";
import { resolveTraitsSelection } from "@t3tools/web/src/components/chat/TraitsPicker.logic.ts";
import { resolveSupportsConversationRollback } from "@t3tools/web/src/components/chat/threadRunState.logic.ts";
import { type DraftId, useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import {
  INITIAL_UI_STATE,
  markThreadVisited,
  PERSISTED_STATE_KEY,
  readPersistedUiState,
  serializePersistedUiState,
  type UiState,
} from "@t3tools/web/src/uiState.logic.ts";

import { makeConnectionAtomRuntime } from "./connection/runtime.ts";
import { createNativeDesktop } from "./nativeDesktop.ts";
import type { HelloMessage, InboundMessage, Send, StatusPhase } from "./protocol.ts";
import { buildProjectDisplayNames, projectIconView } from "./sidebarView.ts";
import { openClientSettingsStore } from "./clientSettings.ts";
import { createComposerSendRuntime } from "./composerSend.ts";
import { createCoreAttachmentUploads } from "./attachmentUploads.ts";
import { createModelPicker } from "./modelPicker.ts";
import type { CoreFeature, FeatureContext, GitStatusSnapshot, ThreadInput } from "./feature.ts";
import { createNewThreadOpener } from "./newThread.ts";
import { createThreadRoute, type ThreadRouteTarget } from "./threadRoute.ts";
import { FEATURES } from "./features.ts";
import { createThreadInteractions } from "./features/threadInteractions.ts";
import { createTimelineWorkFeature } from "./timelineWorkFeature.ts";
import { createTimelineUserFeature } from "./timelineUserFeature.ts";
import { routeTerminalUiState } from "./terminalState.ts";
import { type AppPage, type AppPageKind, CHAT_PAGE, decodeNavigateParams } from "./page.ts";
import { buildHeaderToolbarView, type HeaderToolbarView } from "./headerToolbar.ts";
import {
  isSourceControlActionPending,
  isSourceControlActionRunning,
  RUNNING_SOURCE_CONTROL_ACTIONS,
} from "@t3tools/web/src/state/sourceControlActions.logic.ts";
import {
  buildComposerView,
  deriveComposerModelContext,
  type ComposerGitStatus,
} from "./composerView.ts";
import { composerFormWidthAtom } from "./composerLayout.ts";
import { headerActionsWidthAtom } from "./headerLayout.ts";
import { readRightPanelToggleState } from "./rightPanelState.ts";
import { createCoreState } from "./state.ts";
import { buildTimelineRows, type TimelineExpansion } from "./timelineView.ts";
import type { AppShellView } from "./views/app-shell.ts";
import type { ComposerView } from "./views/composer.ts";
import type { TimelineView } from "./views/timeline.ts";

const VIEW_COALESCE_MS = 16;
const SelectThreadParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, threadId: Schema.String }),
);
const ToggleTurnFoldParams = Schema.decodeUnknownSync(Schema.Struct({ turnId: Schema.String }));
const ToggleWorkGroupParams = Schema.decodeUnknownSync(Schema.Struct({ groupId: Schema.String }));
const SetPromptParams = Schema.decodeUnknownSync(Schema.Struct({ prompt: Schema.String }));
const SetRuntimeModeParams = Schema.decodeUnknownSync(Schema.Struct({ mode: RuntimeMode }));
const ToastActionParams = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, key: Schema.Literals(["action", "secondaryAction"]) }),
);
const DismissToastParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const UnavailableParams = Schema.decodeUnknownSync(Schema.Struct({ feature: Schema.String }));
const ModelPickerSearchParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const ModelPickerRailParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const ModelPickerInstanceParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: Schema.String }),
);
const ModelPickerModelParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: Schema.String, slug: Schema.String }),
);
const SelectTraitParams = Schema.decodeUnknownSync(
  Schema.Struct({ descriptorId: Schema.String, value: Schema.String }),
);

function shortcutPlatform(platform: string): string {
  if (platform === "darwin") return "MacIntel";
  if (platform === "win32") return "Win32";
  return "Linux x86_64";
}

function readUiState(storage: Storage): UiState {
  try {
    return readPersistedUiState(storage);
  } catch {
    return INITIAL_UI_STATE;
  }
}

function connectionPhase(
  state: SupervisorConnectionState | null,
  everReady: boolean,
): { readonly phase: StatusPhase; readonly detail: string | null } {
  if (state === null) return { phase: everReady ? "reconnecting" : "connecting", detail: null };
  if (state.phase === "connected") return { phase: "ready", detail: null };
  if (state.phase === "blocked") {
    return { phase: "failed", detail: state.lastFailure?.message ?? "Connection blocked." };
  }
  return {
    phase: everReady ? "reconnecting" : "connecting",
    detail: state.lastFailure?.message ?? null,
  };
}

export async function startCore(hello: HelloMessage, send: Send) {
  const storage = globalThis.localStorage;
  const registry = AtomRegistry.make();
  const desktop = await createNativeDesktop({
    t3Home: hello.t3Home,
    serverHttpUrl: hello.server?.httpUrl ?? null,
    registry,
  });
  const connection = makeConnectionAtomRuntime({
    server:
      hello.server === null
        ? null
        : {
            httpBaseUrl: hello.server.httpUrl,
            wsBaseUrl: hello.server.wsUrl,
            bootstrapToken: hello.server.bootstrapToken,
          },
    sshGateway: desktop.sshGatewayBridge,
    platform: hello.platform ?? process.platform,
    t3Home: hello.t3Home,
    registry,
  });
  const state = createCoreState(connection.runtime);
  const clientSettingsStore = await openClientSettingsStore(hello.t3Home);
  const clientSettingsAtom = Atom.make<ClientSettings>(clientSettingsStore.initial).pipe(
    Atom.keepAlive,
  );
  const updateClientSettings = async (update: (current: ClientSettings) => ClientSettings) => {
    const next = update(registry.get(clientSettingsAtom));
    registry.set(clientSettingsAtom, next);
    await clientSettingsStore.save(next);
  };
  const fallbackStageLabel = hello.stageLabel ?? "Dev";
  const platform = shortcutPlatform(hello.platform ?? process.platform);

  const uiStateAtom = Atom.make(readUiState(storage)).pipe(Atom.keepAlive);
  const threadRoute = createThreadRoute(registry, state);
  const { routeAtom, routeTargetAtom, draftStoreAtom } = threadRoute;
  const pageAtom = Atom.make<AppPage>(CHAT_PAGE).pipe(Atom.keepAlive);

  const updateUiState = (update: (current: UiState) => UiState) => {
    const current = registry.get(uiStateAtom);
    const next = update(current);
    if (next === current) return;
    registry.set(uiStateAtom, next);
    storage.setItem(PERSISTED_STATE_KEY, serializePersistedUiState(next));
  };

  const primaryConnectionAtom = Atom.make((get) => {
    const environmentId = get(state.primaryEnvironmentIdAtom);
    if (environmentId === null) return null;
    return Option.getOrNull(
      AsyncResult.value(get(state.environmentCatalog.stateAtom(environmentId))),
    );
  });

  const routeThreadShellAtom = Atom.make((get) => {
    const route = get(routeAtom);
    return route === null ? null : get(state.environmentThreadShells.threadShellAtom(route));
  });

  const emptyExpansion: TimelineExpansion = {
    turnIds: new Set(),
    workGroupIds: new Set(),
    planIds: new Set(),
    userMessageIds: new Set(),
    workEntryIds: new Set(),
    reasoningMessageIds: new Set(),
    changedFilesDirectories: new Map(),
  };
  const expansionAtom = Atom.make<TimelineExpansion>(emptyExpansion).pipe(Atom.keepAlive);

  const supportsRollback = (get: Atom.AtomContext) => {
    const input = get(composerInputAtom);
    if (input === null) return false;
    return resolveSupportsConversationRollback({
      providers: input.serverConfig?.providers ?? [],
      sessionProviderInstanceId: input.thread.session?.providerInstanceId,
      activeProvider: deriveComposerModelContext(input).selectedProviderEntry?.snapshot ?? null,
    });
  };

  const timelineAtom = Atom.make((get): TimelineView => {
    const route = get(routeAtom);
    if (route === null) return { threadKey: null, loading: false, scrollRevision: 0, rows: [] };
    const thread = mergeEnvironmentThread(
      get(state.environmentThreadDetails.detailAtom(route)),
      get(state.environmentThreadShells.threadShellAtom(route)),
    );
    if (thread === null) {
      return {
        threadKey: scopedThreadKey(route),
        loading: get(threadRoute.routeDraftIdAtom) === null,
        scrollRevision: 0,
        rows: [],
      };
    }
    const project = get(state.environmentProjects.projectsAtom).find(
      (candidate) =>
        candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
    );
    const threadKey = scopedThreadKey(route);
    const input = get(composerInputAtom);
    const localDispatch = get(sendRuntime.localDispatchAtom)[threadKey] ?? null;
    get(sendRuntime.threadErrorsAtom);
    const isSendBusy = input === null ? false : sendRuntime.isSendBusy(input);
    get(syntaxHighlighterRevisionAtom);
    const providerSnapshot =
      input === null
        ? null
        : (deriveComposerModelContext(input).selectedProviderEntry?.snapshot ?? null);
    const skills =
      providerSnapshot === null
        ? []
        : resolveProviderSkillsForCwd(providerSnapshot, get(gitStatusAtom)?.gitCwd ?? null);
    return {
      threadKey,
      loading: false,
      scrollRevision: get(timelineScrollRevisionAtom),
      rows: buildTimelineRows({
        thread,
        optimisticUserMessages: get(sendRuntime.optimisticMessagesAtom)[threadKey] ?? [],
        isSendBusy,
        isRevertingCheckpoint: get(draftStoreAtom).rewindingThreadKeys.has(threadKey),
        localDispatchStartedAt: isSendBusy ? (localDispatch?.startedAt ?? null) : null,
        supportsConversationRollback: supportsRollback(get),
        workspaceRoot: thread.worktreePath ?? project?.workspaceRoot,
        timestampFormat: get(clientSettingsAtom).timestampFormat,
        expansion: get(expansionAtom),
        userImageUrls: (message) => userMessageImages(get, state, thread.environmentId, message),
        userVideo: (file) => attachmentVideoView(get, state, thread.environmentId, file),
        changedFilesExpandedByTurnId:
          get(uiStateAtom).threadChangedFilesExpandedById[threadKey] ?? {},
        wordWrap: get(clientSettingsAtom).wordWrap,
        canRunShellCommands: project !== undefined,
        resolveImage: workspaceImageResolver(get, state, thread.environmentId, thread.id),
        skills,
      }),
    };
  });

  const routeThreadAtom = Atom.make((get) => {
    const route = get(routeAtom);
    if (route === null) return null;
    const thread = mergeEnvironmentThread(
      get(state.environmentThreadDetails.detailAtom(route)),
      get(state.environmentThreadShells.threadShellAtom(route)),
    );
    return thread === null ? null : { route, thread };
  });

  const composerInputAtom = threadRoute.threadInputAtom({ clientSettingsAtom, routeThreadAtom });

  const promptRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);

  const writePromptFromCore = (route: ScopedThreadRef, prompt: string) => {
    useComposerDraftStore.getState().setPrompt(route, prompt);
    registry.set(promptRevisionAtom, registry.get(promptRevisionAtom) + 1);
  };

  const gitStatusAtom = Atom.make((get): GitStatusSnapshot | null => {
    const input = get(composerInputAtom);
    if (input === null || input.project === undefined) return null;
    const gitCwd = projectScriptCwd({
      project: { cwd: input.project.workspaceRoot },
      worktreePath: input.thread.worktreePath ?? null,
    });
    const result = get(
      state.vcsEnvironment.status({
        environmentId: input.thread.environmentId,
        input: { cwd: gitCwd },
      }),
    );
    return {
      gitCwd,
      status: Option.getOrNull(AsyncResult.value(result)),
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    };
  });

  const composerGitStatusAtom = Atom.make((get): ComposerGitStatus | null => {
    const status = get(gitStatusAtom)?.status ?? null;
    return status === null ? null : { isRepo: status.isRepo, refName: status.refName ?? null };
  });

  const headerToolbarAtom = Atom.make((get): HeaderToolbarView | null => {
    const input = get(composerInputAtom);
    if (input === null) return null;
    const { thread, project, serverConfig } = input;
    const git = get(gitStatusAtom);
    const gitActionState = get(
      state.vcsActionManager.stateAtom({
        environmentId: thread.environmentId,
        cwd: git?.gitCwd ?? null,
      }),
    );
    return buildHeaderToolbarView({
      platform,
      environmentId: thread.environmentId,
      primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
      presentation:
        get(state.environmentPresentations.presentationsAtom).get(thread.environmentId) ?? null,
      project: project === undefined ? null : { title: project.title },
      threadTitle: thread.title,
      keybindings: serverConfig?.keybindings ?? [],
      gitCwd: git?.gitCwd ?? null,
      gitStatus: git?.status ?? null,
      gitStatusError: git?.error ?? null,
      isGitActionRunning: isSourceControlActionRunning(
        gitActionState,
        RUNNING_SOURCE_CONTROL_ACTIONS,
      ),
      isInitPending: isSourceControlActionPending(gitActionState, "init"),
      terminalOpen: routeTerminalUiState(get, input.route).terminalOpen,
      ...readRightPanelToggleState(get, input.route, thread),
      actionsWidth: get(headerActionsWidthAtom),
      panelAnimationDurationMs: input.clientSettings.panelAnimationDurationMs,
    });
  });

  const timelineScrollRevisionAtom = Atom.make(0).pipe(Atom.keepAlive);

  const navigateToRouteTarget = (target: ThreadRouteTarget | null) => {
    registry.set(routeTargetAtom, target);
    registry.set(pageAtom, CHAT_PAGE);
    registry.set(expansionAtom, emptyExpansion);
  };
  const navigateToThread = (threadRef: ScopedThreadRef) =>
    navigateToRouteTarget({ kind: "server", threadRef });
  const navigateToDraft = (draftId: DraftId) => navigateToRouteTarget({ kind: "draft", draftId });
  const openNewThread = createNewThreadOpener({
    registry,
    state,
    clientSettingsAtom,
    routeTargetAtom,
    pageAtom,
    navigateToDraft,
  });

  const attachmentUploads = createCoreAttachmentUploads({ registry, state });
  const sendRuntime = createComposerSendRuntime({
    registry,
    state,
    attachmentUploads,
    navigateToThread,
    navigateToDraft,
    openNewThread,
    writePrompt: (route, prompt) => writePromptFromCore(route, prompt),
    markThreadVisited: (threadKey, visitedAt) =>
      updateUiState((current) => markThreadVisited(current, threadKey, visitedAt)),
    scrollTimelineToEnd: () =>
      registry.set(timelineScrollRevisionAtom, registry.get(timelineScrollRevisionAtom) + 1),
    currentRouteThreadKey: () => {
      const route = registry.get(routeAtom);
      return route === null ? null : scopedThreadKey(route);
    },
    advancePendingUserInput: () => threadInteractions.advancePendingUserInput(),
  });

  const environmentConnectionPhase = (
    presentations: ReadonlyMap<EnvironmentId, { readonly connection: { readonly phase: string } }>,
    input: ThreadInput,
  ) => presentations.get(input.thread.environmentId)?.connection.phase ?? null;

  const currentSendInput = (action: string) => {
    const input = registry.get(composerInputAtom);
    if (input === null) throw new Error(`${action} needs an open thread`);
    return {
      ...input,
      gitStatus: registry.get(composerGitStatusAtom),
      environmentConnectionPhase: environmentConnectionPhase(
        registry.get(state.environmentPresentations.presentationsAtom),
        input,
      ),
      isDraftHeroState: registry.get(draftHeroStateAtom),
    };
  };

  const threadInteractions = createThreadInteractions({
    registry,
    state,
    threadInputAtom: composerInputAtom,
    threadErrorsAtom: sendRuntime.threadErrorsAtom,
    setThreadError: (threadId, error) =>
      registry.set(sendRuntime.threadErrorsAtom, {
        ...registry.get(sendRuntime.threadErrorsAtom),
        [threadId]: error,
      }),
    isSendBusy: (input) => sendRuntime.isSendBusy(input),
    sendBusyDependencies: (get) => {
      get(sendRuntime.localDispatchAtom);
      get(draftStoreAtom);
    },
    supportsConversationRollback: (input) =>
      resolveSupportsConversationRollback({
        providers: input.serverConfig?.providers ?? [],
        sessionProviderInstanceId: input.thread.session?.providerInstanceId,
        activeProvider: deriveComposerModelContext(input).selectedProviderEntry?.snapshot ?? null,
      }),
    writePrompt: (route, prompt) => writePromptFromCore(route, prompt),
    bumpPromptRevision: () =>
      registry.set(promptRevisionAtom, registry.get(promptRevisionAtom) + 1),
    addToast: sendRuntime.addToast,
    expansionAtom,
    implementPlanInNewThread: () =>
      sendRuntime.implementPlan(currentSendInput("implementPlanInNewThread")),
  });

  const composerAtom = Atom.make((get): ComposerView | null => {
    const input = get(composerInputAtom);
    if (input === null) return null;
    const threadKey = scopedThreadKey(input.route);
    get(sendRuntime.localDispatchAtom);
    const threadError = get(sendRuntime.threadErrorsAtom)[input.thread.id] ?? null;
    const phase = environmentConnectionPhase(
      get(state.environmentPresentations.presentationsAtom),
      input,
    );
    return buildComposerView({
      ...input,
      threadKey,
      promptRevision: get(promptRevisionAtom),
      isSendBusy: sendRuntime.isSendBusy(input),
      optimisticUserMessages: get(sendRuntime.optimisticMessagesAtom)[threadKey] ?? [],
      threadError,
      providerInputError: get(sendRuntime.providerInputErrorsAtom)[threadKey] ?? null,
      pendingDraft: threadInteractions.pendingDraft(get, input),
      pendingUserInputResponding: threadInteractions.pendingUserInputResponding(get, input),
      environmentUnavailable: phase !== null && phase !== "connected",
      composerWidth: get(composerFormWidthAtom),
    });
  });

  const draftHeroStateAtom = Atom.make((get): boolean => {
    const input = get(composerInputAtom);
    if (input === null) return false;
    const threadKey = scopedThreadKey(input.route);
    return resolveDraftHeroState({
      isLocalDraftThread: !input.isServerThread && input.draftThread !== null,
      hasTimelineEntries:
        input.thread.messages.length > 0 ||
        (get(sendRuntime.optimisticMessagesAtom)[threadKey]?.length ?? 0) > 0,
      isWorking: get(composerAtom)?.working ?? false,
      draftHeroDockRequested: get(sendRuntime.draftHeroDockedThreadKeyAtom) === threadKey,
      backgroundSubmissionPending:
        get(draftStoreAtom).backgroundSubmissionThreadKeys[threadKey] === true,
    });
  });

  const toastsAtom = Atom.make((get) => ({ toasts: get(sendRuntime.toastsAtom) }));

  const modelPicker = createModelPicker({
    registry,
    updateClientSettings,
    warn: (title, description) =>
      sendRuntime.addToast({ layout: "plain", type: "warning", title, description }),
  });

  const toPickerInput = <I extends { readonly serverConfig: ServerConfig | null }>(input: I) => ({
    ...input,
    keybindings: input.serverConfig?.keybindings ?? [],
    shortcutPlatform: platform,
  });

  const modelPickerAtom = Atom.make((get) => {
    const input = get(composerInputAtom);
    return modelPicker.buildView(
      get(modelPicker.stateAtom),
      input === null ? null : toPickerInput(input),
    );
  });

  const currentPickerInput = () => {
    const input = registry.get(composerInputAtom);
    if (input === null) throw new Error("the model picker needs an open thread");
    return toPickerInput(input);
  };

  let everReady = false;
  const appShellAtom = Atom.make((get): AppShellView => {
    const connectionState = get(primaryConnectionAtom);
    const status = connectionPhase(connectionState, everReady);
    const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
    const presentations = get(state.environmentPresentations.presentationsAtom);
    const primaryPresentation =
      primaryEnvironmentId === null ? undefined : presentations.get(primaryEnvironmentId);
    const route = get(routeAtom);
    const shell = get(routeThreadShellAtom) ?? get(composerInputAtom)?.thread ?? null;
    let threadHeader: AppShellView["threadHeader"] = null;
    if (route !== null && shell !== null) {
      const projects = get(state.environmentProjects.projectsAtom);
      const project = projects.find(
        (candidate) =>
          candidate.environmentId === shell.environmentId && candidate.id === shell.projectId,
      );
      const { projectGroups } = buildProjectDisplayNames({
        projects,
        threads: get(state.environmentThreadShells.threadShellsAtom),
        environments: presentations,
        primaryEnvironmentId,
        clientSettings: get(clientSettingsAtom),
        projectOrder: get(uiStateAtom).projectOrder,
      });
      const group = projectGroups.find((candidate) =>
        candidate.memberProjects.some(
          (member) => member.environmentId === shell.environmentId && member.id === shell.projectId,
        ),
      );
      threadHeader = {
        project:
          project === undefined
            ? null
            : { name: group?.displayName ?? project.title, icon: projectIconView(project) },
        title: shell.title,
      };
    }
    return {
      connection: { phase: status.phase, detail: status.detail },
      activeEnvironment:
        primaryEnvironmentId === null || primaryPresentation === undefined
          ? null
          : { environmentId: primaryEnvironmentId, label: primaryPresentation.entry.target.label },
      primaryServerVersion: get(state.primaryServerConfigAtom)?.environment.serverVersion ?? null,
      route: (() => {
        const page = get(pageAtom);
        if (page.kind !== "chat") return page;
        return route === null
          ? { kind: "home" }
          : (() => {
              const target = get(routeTargetAtom);
              return target?.kind === "draft"
                ? { kind: "draft", draftId: target.draftId }
                : { kind: "thread", environmentId: route.environmentId, threadId: route.threadId };
            })();
      })(),
      threadHeader,
    };
  });

  const featureContext: FeatureContext = {
    registry,
    state,
    attachmentUploads,
    platform,
    stageLabel: fallbackStageLabel,
    t3Home: hello.t3Home,
    desktop,
    storage,
    routeAtom,
    routeTargetAtom,
    threadInputAtom: composerInputAtom,
    gitStatusAtom,
    clientSettingsAtom,
    updateClientSettings,
    addToast: sendRuntime.addToast,
    closeToast: sendRuntime.closeToast,
    send,
    setThreadError: (threadId, error) =>
      registry.set(sendRuntime.threadErrorsAtom, {
        ...registry.get(sendRuntime.threadErrorsAtom),
        [threadId]: error,
      }),
    pageAtom,
    uiStateAtom,
    navigateToThread,
    navigateHome: () => navigateToRouteTarget(null),
    updateUiState,
    navigateToDraft,
    openNewThread,
    draftHeroStateAtom,
    navigate: (page) => {
      if (!implementedPages.has(page.kind)) {
        throw new Error(`The ${page.kind} page is not available in the native app yet.`);
      }
      registry.set(pageAtom, page);
    },
    writePrompt: writePromptFromCore,
  };
  const features: ReadonlyArray<CoreFeature> = [
    ...FEATURES.map((create) => create(featureContext)),
    threadInteractions.feature,
    createTimelineWorkFeature(featureContext, { expansionAtom, timelineAtom }),
    createTimelineUserFeature(featureContext, { expansionAtom }),
  ];
  const featureActions = new Map(features.flatMap((feature) => Object.entries(feature.actions)));
  const implementedPages = new Set<AppPageKind>([
    "chat",
    ...features.flatMap((feature) => feature.pages ?? []),
  ]);

  const views: Record<string, Atom.Atom<unknown>> = {
    ...Object.fromEntries(features.flatMap((feature) => Object.entries(feature.views))),
    "app-shell": appShellAtom,
    timeline: timelineAtom,
    composer: composerAtom,
    toasts: toastsAtom,
    modelPicker: modelPickerAtom,
    headerToolbar: headerToolbarAtom,
  };

  registry.mount(state.environmentCatalog.catalogAtom);
  threadRoute.start((target) => registry.set(routeTargetAtom, target));

  let lastStatus = "";
  registry.subscribe(
    primaryConnectionAtom,
    (connectionState) => {
      const status = connectionPhase(connectionState, everReady);
      const key = `${status.phase}|${status.detail ?? ""}`;
      if (status.phase === "ready" && !everReady) {
        everReady = true;
        send({ t: "ready" });
      }
      if (key === lastStatus) return;
      lastStatus = key;
      send({ t: "status", phase: status.phase, detail: status.detail ?? "" });
    },
    { immediate: true },
  );

  registry.subscribe(
    routeThreadShellAtom,
    (shell) => {
      const completedAt = shell?.latestTurn?.completedAt;
      if (shell === null || !completedAt) return;
      updateUiState((current) =>
        markThreadVisited(
          current,
          scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
          completedAt,
        ),
      );
    },
    { immediate: true },
  );

  const subscriptions = new Map<number, () => void>();

  const subscribeView = (id: number, view: string) => {
    const atom = views[view];
    if (atom === undefined) {
      send({ t: "log", level: "error", msg: `Unknown view: ${view}` });
      return;
    }
    let lastSent: string | null = null;
    let pending: unknown;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const serialized = JSON.stringify(pending);
      if (serialized === lastSent) return;
      lastSent = serialized;
      process.stdout.write(`{"t":"view","id":${id},"data":${serialized}}\n`);
    };
    const unsubscribe = registry.subscribe(
      atom,
      (value) => {
        pending = value;
        timer ??= setTimeout(flush, VIEW_COALESCE_MS);
      },
      { immediate: true },
    );
    subscriptions.set(id, () => {
      clearTimeout(timer ?? undefined);
      unsubscribe();
    });
  };

  const act = async (action: string, params: unknown): Promise<unknown> => {
    switch (action) {
      case "toggleTurnFold": {
        const turnId = TurnId.make(ToggleTurnFoldParams(params).turnId);
        const current = registry.get(expansionAtom);
        const turnIds = new Set(current.turnIds);
        if (!turnIds.delete(turnId)) turnIds.add(turnId);
        registry.set(expansionAtom, { ...current, turnIds });
        return null;
      }
      case "toggleWorkGroup": {
        const { groupId } = ToggleWorkGroupParams(params);
        const current = registry.get(expansionAtom);
        const workGroupIds = new Set(current.workGroupIds);
        if (!workGroupIds.delete(groupId)) workGroupIds.add(groupId);
        registry.set(expansionAtom, { ...current, workGroupIds });
        return null;
      }
      case "selectThread": {
        const { environmentId, threadId } = SelectThreadParams(params);
        navigateToThread(
          scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId)),
        );
        return null;
      }
      case "navigate": {
        const { page } = decodeNavigateParams(params);
        if (!implementedPages.has(page.kind)) {
          throw new Error(`The ${page.kind} page is not available in the native app yet.`);
        }
        registry.set(pageAtom, page);
        return null;
      }
      case "setPrompt": {
        const input = registry.get(composerInputAtom);
        if (input === null) throw new Error("setPrompt needs an open thread");
        const { prompt } = SetPromptParams(params);
        if (threadInteractions.setCustomAnswer(input, prompt)) return null;
        useComposerDraftStore.getState().setPrompt(input.route, prompt);
        return null;
      }
      case "setRuntimeMode": {
        const route = registry.get(routeAtom);
        if (route === null) throw new Error("setRuntimeMode needs an open thread");
        const { mode } = SetRuntimeModeParams(params);
        useComposerDraftStore.getState().setRuntimeMode(route, mode);
        const input = registry.get(composerInputAtom);
        if (input !== null && !input.isServerThread && input.draftId !== null) {
          useComposerDraftStore
            .getState()
            .setDraftThreadContext(input.draftId, { runtimeMode: mode });
        }
        return null;
      }
      case "selectTrait": {
        const input = registry.get(composerInputAtom);
        if (input === null) throw new Error("selectTrait needs an open thread");
        const { selection, selectedProvider, prompt } = deriveComposerModelContext(input);
        if (selection === null) throw new Error("selectTrait needs an available provider");
        const { descriptorId, value } = SelectTraitParams(params);
        const result = resolveTraitsSelection({
          visibility: selection.traitsVisibility,
          prompt,
          descriptorId,
          value,
        });
        if (result.prompt !== null && result.prompt !== prompt) {
          writePromptFromCore(input.route, result.prompt);
        }
        if (result.modelOptions !== null) {
          useComposerDraftStore
            .getState()
            .setProviderModelOptions(input.route, selectedProvider, result.modelOptions.next, {
              instanceId: selection.instanceId,
              model: selection.selectedModel,
              persistSticky: true,
            });
        }
        return null;
      }
      case "send": {
        const outcome = await sendRuntime.send(currentSendInput("send"));
        return outcome._tag;
      }
      case "unavailable": {
        const { feature } = UnavailableParams(params);
        sendRuntime.addToast({
          layout: "plain",
          type: "info",
          title: `${feature} is not available in the native app yet.`,
        });
        return null;
      }
      case "openModelPicker": {
        modelPicker.open(currentPickerInput());
        return null;
      }
      case "closeModelPicker": {
        modelPicker.close();
        return null;
      }
      case "modelPickerSearch": {
        modelPicker.setSearch(ModelPickerSearchParams(params).query);
        return null;
      }
      case "modelPickerRail": {
        const { id } = ModelPickerRailParams(params);
        modelPicker.setRail(id === "favorites" ? "favorites" : ProviderInstanceId.make(id));
        return null;
      }
      case "modelPickerToggleLegacy": {
        modelPicker.toggleLegacy(
          ProviderInstanceId.make(ModelPickerInstanceParams(params).instanceId),
        );
        return null;
      }
      case "modelPickerSelect": {
        const { instanceId, slug } = ModelPickerModelParams(params);
        modelPicker.select(currentPickerInput(), ProviderInstanceId.make(instanceId), slug);
        return null;
      }
      case "modelPickerFavorite": {
        const { instanceId, slug } = ModelPickerModelParams(params);
        await modelPicker.toggleFavorite(ProviderInstanceId.make(instanceId), slug);
        return null;
      }
      case "toastAction": {
        const { id, key } = ToastActionParams(params);
        sendRuntime.runToastAction(id, key);
        return null;
      }
      case "dismissToast": {
        sendRuntime.closeToast(DismissToastParams(params).id);
        return null;
      }
      case "interrupt": {
        const current = registry.get(routeThreadAtom);
        if (current === null) return null;
        const { thread } = current;
        const input = buildRunningThreadTurnInterruptInput(
          thread,
          derivePhase(thread.session ?? null),
        );
        if (input === null) return null;
        const result = await runAtomCommand(
          registry,
          state.threadEnvironment.interruptTurn,
          { environmentId: thread.environmentId, input },
          { reportFailure: false },
        );
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          throw new Error(
            error instanceof Error ? error.message : "Failed to interrupt the current turn.",
          );
        }
        return null;
      }
      default: {
        const featureAction = featureActions.get(action);
        if (featureAction === undefined) throw new Error(`unknown action: ${action}`);
        return featureAction(params);
      }
    }
  };

  const handle = (message: InboundMessage) => {
    switch (message.t) {
      case "sub":
        subscriptions.get(message.id)?.();
        subscribeView(message.id, message.view);
        return;
      case "unsub":
        subscriptions.get(message.id)?.();
        subscriptions.delete(message.id);
        return;
      case "act":
        act(message.action, message.params).then(
          (value) => send({ t: "result", id: message.id, ok: true, value }),
          (error: unknown) =>
            send({
              t: "result",
              id: message.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
        return;
    }
  };

  return { handle };
}
