import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  type DesktopPreviewColorScheme,
  type DesktopPreviewFavicon,
  type DesktopPreviewTabState,
  EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  type PreviewEvent,
  type PreviewListResult,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { toBrowserDefaults } from "@t3tools/web/src/browser/browserDefaults.logic.ts";
import {
  resolveBrowserDeviceViewportLayout,
  resolveBrowserViewportLayout,
  resolveFittedBrowserViewport,
} from "@t3tools/web/src/browser/browserViewportLayout.ts";
import type { BrowserSurfaceContentPresentation } from "@t3tools/web/src/browser/browserSurfaceStore.ts";
import { previewRuntimeTabId } from "@t3tools/web/src/browser/previewRuntimeTabId.ts";
import {
  buildReportInput,
  projectDesktopState,
} from "@t3tools/web/src/components/preview/previewBridge.logic.ts";
import {
  EMPTY_THREAD_PREVIEW_STATE,
  reduceActivePreviewTab,
  reduceBeginPreviewSessionClose,
  reduceCancelPreviewSessionClose,
  reducePreviewDesktopState,
  reducePreviewServerEvent,
  reducePreviewServerSessions,
  reducePreviewServerSnapshot,
  reduceRememberPreviewUrl,
  reduceUpdatePreviewServerSnapshot,
  type ThreadPreviewState,
} from "@t3tools/web/src/previewState.logic.ts";
import {
  selectThreadPreviewMiniPlayerTabId,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore.ts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";
import { type BrowserHostStore, browserProfileStore } from "./browserStores.ts";
import { BROWSER_HOST_INIT_SCRIPT } from "./browserPageScripts.ts";
import { panelRouteAtom } from "./pullRequestShared.ts";
import { makeRouteRightPanelStateAtom } from "./rightPanelState.ts";

const NAVIGATION_PROBE_TIMEOUT_MS = 8_000;

const HostMessageParams = Schema.decodeUnknownSync(
  Schema.Struct({ runtimeTabId: Schema.String, message: Schema.String }),
);
const HostMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("evaluate"),
    id: Schema.Number,
    ok: Schema.Boolean,
    value: Schema.optional(Schema.NullOr(Schema.String)),
    error: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("favicon"),
    dataUrl: Schema.String,
    pageUrl: Schema.String,
  }),
]);
const decodeHostMessageJson = Schema.decodeUnknownSync(Schema.fromJsonString(HostMessage));

function decodeHostMessage(message: string): typeof HostMessage.Type | null {
  try {
    return decodeHostMessageJson(message);
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

function netErrorFor(error: unknown): { readonly code: number; readonly description: string } {
  if (error instanceof Error && error.name === "AbortError") {
    return { code: -118, description: "ERR_CONNECTION_TIMED_OUT" };
  }
  switch (errorCode(error)) {
    case "ECONNREFUSED":
      return { code: -102, description: "ERR_CONNECTION_REFUSED" };
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return { code: -105, description: "ERR_NAME_NOT_RESOLVED" };
    case "ECONNRESET":
      return { code: -101, description: "ERR_CONNECTION_RESET" };
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return { code: -118, description: "ERR_CONNECTION_TIMED_OUT" };
    case "ENETUNREACH":
      return { code: -106, description: "ERR_INTERNET_DISCONNECTED" };
    case "CERT_HAS_EXPIRED":
      return { code: -201, description: "ERR_CERT_DATE_INVALID" };
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return { code: -200, description: "ERR_CERT_COMMON_NAME_INVALID" };
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return { code: -202, description: "ERR_CERT_AUTHORITY_INVALID" };
    default:
      return { code: -2, description: "ERR_FAILED" };
  }
}

export type BrowserHostCommand =
  | { readonly kind: "navigate"; readonly url: string }
  | { readonly kind: "back" }
  | { readonly kind: "forward" }
  | { readonly kind: "reload" }
  | { readonly kind: "hardReload" }
  | { readonly kind: "stop" }
  | { readonly kind: "openDevTools" }
  | { readonly kind: "evaluate"; readonly script: string }
  | { readonly kind: "screenshot"; readonly path: string | null }
  | { readonly kind: "focus" };

export type BrowserHostCommandEntry = {
  readonly id: number;
  readonly runtimeTabId: string;
  readonly command: BrowserHostCommand;
};

export type BrowserHostCookie = {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly expires: number | null;
  readonly sameSite: "lax" | "strict" | null;
};

export type BrowserStoreCommand =
  | { readonly kind: "clearCookies" }
  | { readonly kind: "clearCache" }
  | { readonly kind: "setCookies"; readonly cookies: ReadonlyArray<BrowserHostCookie> };

export type BrowserStoreCommandEntry = {
  readonly id: number;
  readonly store: BrowserHostStore;
  readonly command: BrowserStoreCommand;
};

type BrowserCommandKind = BrowserHostCommand["kind"] | BrowserStoreCommand["kind"];

export type BrowserHostLayoutView = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pageZoom: number;
  readonly fillsPanel: boolean;
};

export type BrowserHostTabView = {
  readonly runtimeTabId: string;
  readonly initialUrl: string | null;
  readonly zoomFactor: number;
  readonly colorScheme: DesktopPreviewColorScheme;
  readonly audioMuted: boolean;
  readonly store: BrowserHostStore;
  readonly layout: BrowserHostLayoutView | null;
  readonly visible: boolean;
};

export type BrowserHostView = {
  readonly initScript: string;
  readonly tabs: ReadonlyArray<BrowserHostTabView>;
  readonly commands: ReadonlyArray<BrowserHostCommandEntry>;
  readonly storeCommands: ReadonlyArray<BrowserStoreCommandEntry>;
};

export type BrowserTabOptions = {
  readonly zoomFactor: number;
  readonly colorScheme: DesktopPreviewColorScheme;
  readonly audioMuted: boolean;
  readonly controller: "human" | "agent" | "none";
};

type HostReport = {
  readonly webviewReady: boolean;
  readonly navStatus: DesktopPreviewTabState["navStatus"];
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly audible: boolean;
  readonly favicon: DesktopPreviewFavicon | null;
};

type HostSlotContent = BrowserSurfaceContentPresentation;

type HostSlot = {
  readonly width: number;
  readonly height: number;
  readonly deviceToolbar: boolean;
  readonly fitSource: boolean;
  readonly fittedContent: HostSlotContent | null;
};

const slotLayout = (slot: HostSlot, viewport: PreviewViewportSetting, zoomFactor: number) =>
  slot.fitSource
    ? resolveBrowserViewportLayout(
        slot,
        resolveFittedBrowserViewport(viewport, slot.fittedContent, zoomFactor),
        zoomFactor,
      )
    : viewport._tag !== "fill" && slot.deviceToolbar
      ? resolveBrowserDeviceViewportLayout(slot, viewport, zoomFactor)
      : resolveBrowserViewportLayout(slot, viewport, zoomFactor);

type RuntimeTabTarget = {
  readonly threadRef: ScopedThreadRef;
  readonly serverEpoch: string | null;
  readonly tabId: string;
};

const NavStatusSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("Idle") }),
  Schema.Struct({
    kind: Schema.Literals(["Loading", "Success"]),
    url: Schema.String,
    title: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("LoadFailed"),
    url: Schema.String,
    title: Schema.String,
    code: Schema.Number,
    description: Schema.String,
  }),
]);

const HostReportParams = Schema.decodeUnknownSync(
  Schema.Struct({
    runtimeTabId: Schema.String,
    webviewReady: Schema.Boolean,
    navStatus: NavStatusSchema,
    canGoBack: Schema.Boolean,
    canGoForward: Schema.Boolean,
    audible: Schema.Boolean,
    favicon: Schema.NullOr(
      Schema.Struct({ dataUrl: Schema.String, pageUrl: Schema.String, capturedAt: Schema.Number }),
    ),
  }),
);
const HostCommandResultParams = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.Number,
    ok: Schema.Boolean,
    value: Schema.optional(Schema.NullOr(Schema.String)),
    error: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);
const HostSlotsParams = Schema.decodeUnknownSync(
  Schema.Struct({
    slots: Schema.Array(
      Schema.Struct({
        runtimeTabId: Schema.String,
        width: Schema.Number,
        height: Schema.Number,
        deviceToolbar: Schema.Boolean,
        fitSource: Schema.Boolean,
      }),
    ),
  }),
);
const RuntimeTabKey = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Tuple([Schema.String, Schema.String, Schema.NullOr(Schema.String), Schema.String]),
  ),
);

const decodeJsonValue = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeWritten = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Boolean)));

export class BrowserHostCommandError extends Error {
  readonly command: BrowserCommandKind;

  constructor(command: BrowserCommandKind, message: string) {
    super(message);
    this.command = command;
    this.name = "BrowserHostCommandError";
  }
}

export function parseRuntimeTabId(runtimeTabId: string): RuntimeTabTarget | null {
  try {
    const [environmentId, threadId, serverEpoch, tabId] = RuntimeTabKey(runtimeTabId);
    return {
      threadRef: {
        environmentId: EnvironmentId.make(environmentId),
        threadId: ThreadId.make(threadId),
      },
      serverEpoch,
      tabId,
    };
  } catch {
    return null;
  }
}

export interface BrowserPreviewService {
  readonly previewStateAtom: (threadKey: string) => Atom.Writable<ThreadPreviewState>;
  readonly activeThreadKeysAtom: Atom.Atom<ReadonlySet<string>>;
  readonly read: (ref: ScopedThreadRef) => ThreadPreviewState;
  readonly update: (
    ref: ScopedThreadRef,
    reducer: (current: ThreadPreviewState) => ThreadPreviewState,
  ) => void;
  readonly applySnapshot: (ref: ScopedThreadRef, snapshot: PreviewSessionSnapshot | null) => void;
  readonly mergeSnapshot: (ref: ScopedThreadRef, snapshot: PreviewSessionSnapshot) => void;
  readonly reconcile: (ref: ScopedThreadRef, result: PreviewListResult) => void;
  readonly setActiveTab: (ref: ScopedThreadRef, tabId: string) => void;
  readonly rememberUrl: (ref: ScopedThreadRef, url: string) => void;
  readonly beginClose: (ref: ScopedThreadRef, tabId: string) => void;
  readonly cancelClose: (
    ref: ScopedThreadRef,
    snapshot: PreviewSessionSnapshot | null,
    tabId: string,
  ) => void;
  readonly runtimeTabId: (ref: ScopedThreadRef, tabId: string) => string;
  readonly tabOptions: (runtimeTabId: string) => BrowserTabOptions;
  readonly setTabOptions: (
    runtimeTabId: string,
    update: (current: BrowserTabOptions) => BrowserTabOptions,
  ) => void;
  readonly hostReport: (runtimeTabId: string) => HostReport | null;
  readonly visibleRuntimeTabIdsAtom: Atom.Atom<ReadonlySet<string>>;
  readonly slotAtom: Atom.Atom<ReadonlyMap<string, HostSlot>>;
  readonly hostReportsAtom: Atom.Atom<ReadonlyMap<string, HostReport>>;
  readonly tabOptionsAtom: Atom.Atom<ReadonlyMap<string, BrowserTabOptions>>;
  readonly send: (runtimeTabId: string, command: BrowserHostCommand) => Promise<string | null>;
  readonly clearCookies: (environmentId: EnvironmentId, profileId?: string) => Promise<void>;
  readonly clearCache: (environmentId: EnvironmentId, profileId?: string) => Promise<void>;
  readonly setCookies: (
    environmentId: EnvironmentId,
    profileId: string,
    cookies: ReadonlyArray<BrowserHostCookie>,
  ) => Promise<ReadonlyArray<boolean>>;
  readonly evaluate: (runtimeTabId: string, script: string) => Promise<unknown>;
  readonly syncThread: (ref: ScopedThreadRef) => Promise<void>;
  readonly feature: CoreFeature;
}

const services = new WeakMap<FeatureContext, BrowserPreviewService>();

const DEFAULT_OPTIONS: BrowserTabOptions = {
  zoomFactor: 1,
  colorScheme: "system",
  audioMuted: false,
  controller: "none",
};

function sameReport(a: HostReport | undefined, b: HostReport): boolean {
  return (
    a !== undefined &&
    a.webviewReady === b.webviewReady &&
    JSON.stringify(a.navStatus) === JSON.stringify(b.navStatus) &&
    a.canGoBack === b.canGoBack &&
    a.canGoForward === b.canGoForward &&
    a.audible === b.audible &&
    a.favicon?.dataUrl === b.favicon?.dataUrl &&
    a.favicon?.pageUrl === b.favicon?.pageUrl
  );
}

export function browserPreviewService(context: FeatureContext): BrowserPreviewService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const { registry, state } = context;

  const previewStateAtom = Atom.family((_threadKey: string) =>
    Atom.make<ThreadPreviewState>(EMPTY_THREAD_PREVIEW_STATE).pipe(Atom.keepAlive),
  );
  const activeThreadKeysAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
    Atom.keepAlive,
  );
  const tabOptionsAtom = Atom.make<ReadonlyMap<string, BrowserTabOptions>>(new Map()).pipe(
    Atom.keepAlive,
  );
  const hostReportsAtom = Atom.make<ReadonlyMap<string, HostReport>>(new Map()).pipe(
    Atom.keepAlive,
  );
  const slotAtom = Atom.make<ReadonlyMap<string, HostSlot>>(new Map()).pipe(Atom.keepAlive);
  const commandsAtom = Atom.make<ReadonlyArray<BrowserHostCommandEntry>>([]).pipe(Atom.keepAlive);
  const storeCommandsAtom = Atom.make<ReadonlyArray<BrowserStoreCommandEntry>>([]).pipe(
    Atom.keepAlive,
  );
  const visibleRuntimeTabIdsAtom = Atom.make((get): ReadonlySet<string> => {
    return new Set(get(slotAtom).keys());
  });

  const lastReported = new Map<
    string,
    { url: string | null; kind: DesktopPreviewTabState["navStatus"]["kind"] | null }
  >();
  const pending = new Map<
    number,
    {
      resolve: (value: string | null) => void;
      reject: (error: Error) => void;
      kind: BrowserCommandKind;
    }
  >();
  let nextCommandId = 1;

  const read = (ref: ScopedThreadRef) => registry.get(previewStateAtom(scopedThreadKey(ref)));

  const update = (
    ref: ScopedThreadRef,
    reducer: (current: ThreadPreviewState) => ThreadPreviewState,
  ) => {
    const threadKey = scopedThreadKey(ref);
    const atom = previewStateAtom(threadKey);
    const current = registry.get(atom);
    const next = reducer(current);
    if (next === current) return;
    registry.set(atom, next);
    const active = Object.keys(next.sessions).length > 0;
    const keys = registry.get(activeThreadKeysAtom);
    if (keys.has(threadKey) !== active) {
      const nextKeys = new Set(keys);
      if (active) nextKeys.add(threadKey);
      else nextKeys.delete(threadKey);
      registry.set(activeThreadKeysAtom, nextKeys);
    }
  };

  const runtimeTabIdFor = (ref: ScopedThreadRef, tabId: string) =>
    previewRuntimeTabId(ref, read(ref).serverEpoch, tabId);

  const clientDefaults = () => toBrowserDefaults(registry.get(context.clientSettingsAtom));

  const tabOptions = (runtimeTabId: string): BrowserTabOptions => {
    const existingOptions = registry.get(tabOptionsAtom).get(runtimeTabId);
    if (existingOptions !== undefined) return existingOptions;
    const defaults = clientDefaults();
    return {
      ...DEFAULT_OPTIONS,
      zoomFactor: defaults.zoomFactor,
      colorScheme: defaults.appearance,
    };
  };

  const publishDesktopState = (runtimeTabId: string) => {
    const target = parseRuntimeTabId(runtimeTabId);
    if (target === null) return;
    const report = registry.get(hostReportsAtom).get(runtimeTabId);
    if (report === undefined) return;
    const options = tabOptions(runtimeTabId);
    const desktopState: DesktopPreviewTabState = {
      tabId: runtimeTabId,
      webContentsId: report.webviewReady ? 1 : null,
      navStatus: report.navStatus,
      canGoBack: report.canGoBack,
      canGoForward: report.canGoForward,
      zoomFactor: options.zoomFactor,
      pictureInPicture: false,
      colorScheme: options.colorScheme,
      audioMuted: options.audioMuted,
      audible: report.audible,
      controller: options.controller,
      ...(report.favicon === null ? {} : { favicon: report.favicon }),
      updatedAt: new Date().toISOString(),
    };
    update(target.threadRef, (current) =>
      reducePreviewDesktopState(current, target.tabId, projectDesktopState(desktopState)),
    );
    const previous = lastReported.get(runtimeTabId) ?? { url: null, kind: null };
    const reported = buildReportInput({
      threadId: target.threadRef.threadId,
      tabId: target.tabId,
      state: desktopState,
      lastReportedUrl: previous.url,
      lastReportedKind: previous.kind,
    });
    if (reported === null) return;
    lastReported.set(runtimeTabId, {
      url: reported.lastReportedUrl,
      kind: reported.lastReportedKind,
    });
    void runAtomCommand(
      registry,
      state.previewEnvironment.reportStatus,
      { environmentId: target.threadRef.environmentId, input: reported.input },
      { reportFailure: false },
    );
  };

  const setTabOptions = (
    runtimeTabId: string,
    change: (current: BrowserTabOptions) => BrowserTabOptions,
  ) => {
    const current = tabOptions(runtimeTabId);
    const next = change(current);
    const map = new Map(registry.get(tabOptionsAtom));
    map.set(runtimeTabId, next);
    registry.set(tabOptionsAtom, map);
    publishDesktopState(runtimeTabId);
  };

  const send = (runtimeTabId: string, command: BrowserHostCommand): Promise<string | null> => {
    const id = nextCommandId++;
    const { promise, resolve, reject } = Promise.withResolvers<string | null>();
    pending.set(id, { resolve, reject, kind: command.kind });
    registry.set(commandsAtom, [...registry.get(commandsAtom), { id, runtimeTabId, command }]);
    return promise;
  };

  const sendStore = (
    environmentId: EnvironmentId,
    profileId: string | undefined,
    command: BrowserStoreCommand,
  ): Promise<string | null> => {
    const id = nextCommandId++;
    const { promise, resolve, reject } = Promise.withResolvers<string | null>();
    pending.set(id, { resolve, reject, kind: command.kind });
    const store = browserProfileStore(context.t3Home, environmentId, profileId);
    registry.set(storeCommandsAtom, [...registry.get(storeCommandsAtom), { id, store, command }]);
    return promise;
  };

  const clearCookies = async (environmentId: EnvironmentId, profileId?: string) => {
    await sendStore(environmentId, profileId, { kind: "clearCookies" });
  };

  const clearCache = async (environmentId: EnvironmentId, profileId?: string) => {
    await sendStore(environmentId, profileId, { kind: "clearCache" });
  };

  const setCookies = async (
    environmentId: EnvironmentId,
    profileId: string,
    cookies: ReadonlyArray<BrowserHostCookie>,
  ): Promise<ReadonlyArray<boolean>> => {
    const raw = await sendStore(environmentId, profileId, { kind: "setCookies", cookies });
    return raw === null ? [] : decodeWritten(raw);
  };

  const faviconByTab = new Map<string, DesktopPreviewFavicon>();

  const settle = (id: number, ok: boolean, value: string | null, error: string | null) => {
    registry.set(
      commandsAtom,
      registry.get(commandsAtom).filter((entry) => entry.id !== id),
    );
    const storeCommands = registry.get(storeCommandsAtom);
    if (storeCommands.some((entry) => entry.id === id)) {
      registry.set(
        storeCommandsAtom,
        storeCommands.filter((entry) => entry.id !== id),
      );
    }
    const waiter = pending.get(id);
    if (waiter === undefined) return;
    pending.delete(id);
    if (ok) waiter.resolve(value);
    else
      waiter.reject(
        new BrowserHostCommandError(
          waiter.kind,
          error ?? "The browser could not run this command.",
        ),
      );
  };

  const miniPlayerStoreAtom = Atom.make((get) => {
    get.addFinalizer(usePreviewMiniPlayerStore.subscribe((value) => get.setSelf(value)));
    return usePreviewMiniPlayerStore.getState();
  });
  const routePanelAtom = makeRouteRightPanelStateAtom(panelRouteAtom(context));
  const visibleTabsAtom = Atom.make((get): ReadonlySet<string> => {
    const visible = new Set<string>();
    const panel = get(routePanelAtom);
    if (panel === null) return visible;
    const preview = get(previewStateAtom(scopedThreadKey(panel.route)));
    if (panel.state.isOpen && panel.activeSurface?.kind === "preview") {
      const tabId = panel.activeSurface.resourceId ?? preview.activeTabId;
      if (tabId !== null) visible.add(previewRuntimeTabId(panel.route, preview.serverEpoch, tabId));
    }
    const miniTabId = selectThreadPreviewMiniPlayerTabId(
      get(miniPlayerStoreAtom).byThreadKey,
      panel.route,
    );
    if (miniTabId !== null) {
      visible.add(previewRuntimeTabId(panel.route, preview.serverEpoch, miniTabId));
    }
    return visible;
  });
  const evaluate = async (runtimeTabId: string, script: string): Promise<unknown> => {
    const id = nextCommandId;
    const wrapped = `Promise.resolve().then(() => (${script})).then((value) => globalThis.ipc.postMessage(JSON.stringify({ type: "evaluate", id: ${id}, ok: true, value: JSON.stringify(value === undefined ? null : value) })), (error) => globalThis.ipc.postMessage(JSON.stringify({ type: "evaluate", id: ${id}, ok: false, error: String((error && error.message) || error) })))`;
    const raw = await send(runtimeTabId, { kind: "evaluate", script: wrapped });
    return raw === null ? undefined : decodeJsonValue(raw);
  };

  const probeFailures = new Map<string, string>();
  const probeNavigation = (runtimeTabId: string, url: string) => {
    if (probeFailures.get(runtimeTabId) === url || !/^https?:/i.test(url)) return;
    probeFailures.set(runtimeTabId, url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAVIGATION_PROBE_TIMEOUT_MS);
    void fetch(url, { method: "GET", redirect: "manual", signal: controller.signal })
      .then((response) => response.body?.cancel())
      .catch((error: unknown) => {
        const failure = netErrorFor(error);
        const report = registry.get(hostReportsAtom).get(runtimeTabId);
        if (
          report === undefined ||
          report.navStatus.kind !== "Loading" ||
          report.navStatus.url !== url
        ) {
          return;
        }
        const next = new Map(registry.get(hostReportsAtom));
        next.set(runtimeTabId, {
          ...report,
          navStatus: { kind: "LoadFailed", url, title: report.navStatus.title, ...failure },
        });
        registry.set(hostReportsAtom, next);
        publishDesktopState(runtimeTabId);
      })
      .finally(() => clearTimeout(timer));
  };

  const listTarget = (ref: ScopedThreadRef) => ({
    environmentId: ref.environmentId,
    input: { threadId: ref.threadId },
  });

  const syncThread = async (ref: ScopedThreadRef): Promise<void> => {
    const atom = state.previewEnvironment.list(listTarget(ref));
    registry.refresh(atom);
    const { promise, resolve } = Promise.withResolvers<void>();
    const unsubscribe = registry.subscribe(
      atom,
      (result) => {
        if (AsyncResult.isSuccess(result) && !result.waiting) {
          update(ref, (current) => reducePreviewServerSessions(current, result.value));
          resolve();
        } else if (AsyncResult.isFailure(result)) {
          resolve();
        }
      },
      { immediate: true },
    );
    await promise;
    unsubscribe();
  };

  const applyEvent = (environmentId: EnvironmentId, event: PreviewEvent) => {
    const ref: ScopedThreadRef = { environmentId, threadId: ThreadId.make(event.threadId) };
    const currentEpoch = read(ref).serverEpoch;
    if (currentEpoch !== null && currentEpoch !== event.serverEpoch) {
      void syncThread(ref);
      return;
    }
    update(ref, (current) => reducePreviewServerEvent(current, event));
  };

  const environmentIdsAtom = Atom.make((get): ReadonlyArray<EnvironmentId> => [
    ...get(state.environmentCatalog.catalogValueAtom).entries.keys(),
  ]);
  const eventSubscriptions = new Map<string, () => void>();
  registry.subscribe(
    environmentIdsAtom,
    (environmentIds) => {
      const live = new Set<string>(environmentIds);
      for (const [environmentId, unsubscribe] of eventSubscriptions) {
        if (!live.has(environmentId)) {
          unsubscribe();
          eventSubscriptions.delete(environmentId);
        }
      }
      for (const environmentId of environmentIds) {
        if (eventSubscriptions.has(environmentId)) continue;
        eventSubscriptions.set(
          environmentId,
          registry.subscribe(
            state.previewEnvironment.events({ environmentId, input: {} }),
            (result) => {
              if (AsyncResult.isSuccess(result)) applyEvent(environmentId, result.value);
            },
            { immediate: true },
          ),
        );
      }
    },
    { immediate: true },
  );

  let routeListUnsubscribe: (() => void) | null = null;
  registry.subscribe(
    context.routeAtom,
    (route) => {
      routeListUnsubscribe?.();
      routeListUnsubscribe = null;
      if (route === null) return;
      const atom = state.previewEnvironment.list(listTarget(route));
      routeListUnsubscribe = registry.subscribe(
        atom,
        (result) => {
          if (AsyncResult.isSuccess(result)) {
            update(route, (current) => reducePreviewServerSessions(current, result.value));
          }
        },
        { immediate: false },
      );
      registry.refresh(atom);
    },
    { immediate: true },
  );

  const hostTabsAtom = Atom.make((get): ReadonlyArray<BrowserHostTabView> => {
    const tabs: BrowserHostTabView[] = [];
    const options = get(tabOptionsAtom);
    const slots = get(slotAtom);
    const defaults = toBrowserDefaults(get(context.clientSettingsAtom));
    for (const threadKey of get(activeThreadKeysAtom)) {
      const threadRef = parseScopedThreadKey(threadKey);
      if (threadRef === null) continue;
      const visibleTabs = get(visibleTabsAtom);
      const preview = get(previewStateAtom(threadKey));
      for (const snapshot of Object.values(preview.sessions)) {
        const runtimeTabId = previewRuntimeTabId(threadRef, preview.serverEpoch, snapshot.tabId);
        const tabOption = options.get(runtimeTabId) ?? {
          ...DEFAULT_OPTIONS,
          zoomFactor: defaults.zoomFactor,
          colorScheme: defaults.appearance,
        };
        const viewport: PreviewViewportSetting = snapshot.viewport ?? FILL_PREVIEW_VIEWPORT;
        const slot = slots.get(runtimeTabId);
        const layout = slot === undefined ? null : slotLayout(slot, viewport, tabOption.zoomFactor);
        tabs.push({
          runtimeTabId,
          initialUrl: snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url,
          zoomFactor: tabOption.zoomFactor,
          colorScheme: tabOption.colorScheme,
          audioMuted: tabOption.audioMuted,
          store: browserProfileStore(context.t3Home, threadRef.environmentId, snapshot.profileId),
          layout:
            layout === null
              ? null
              : {
                  x: layout.viewportX,
                  y: layout.viewportY,
                  width: layout.viewportWidth,
                  height: layout.viewportHeight,
                  pageZoom: tabOption.zoomFactor * layout.viewportScale,
                  fillsPanel: layout.fillsPanel,
                },
          visible: visibleTabs.has(runtimeTabId),
        });
      }
    }
    return tabs;
  });

  const hostViewAtom = Atom.make((get): BrowserHostView => ({
    initScript: BROWSER_HOST_INIT_SCRIPT,
    tabs: get(hostTabsAtom),
    commands: get(commandsAtom),
    storeCommands: get(storeCommandsAtom),
  }));

  registry.subscribe(
    hostTabsAtom,
    (tabs) => {
      const live = new Set(tabs.map((tab) => tab.runtimeTabId));
      for (const entry of registry.get(commandsAtom)) {
        if (live.has(entry.runtimeTabId)) continue;
        const waiter = pending.get(entry.id);
        pending.delete(entry.id);
        waiter?.reject(new BrowserHostCommandError(entry.command.kind, "The browser tab closed."));
      }
      const commands = registry.get(commandsAtom);
      const remaining = commands.filter((entry) => live.has(entry.runtimeTabId));
      if (remaining.length !== commands.length) registry.set(commandsAtom, remaining);
      const reports = registry.get(hostReportsAtom);
      if ([...reports.keys()].some((key) => !live.has(key))) {
        registry.set(hostReportsAtom, new Map([...reports].filter(([key]) => live.has(key))));
      }
      for (const key of lastReported.keys()) if (!live.has(key)) lastReported.delete(key);
    },
    { immediate: true },
  );

  const service: BrowserPreviewService = {
    previewStateAtom,
    activeThreadKeysAtom,
    read,
    update,
    applySnapshot: (ref, snapshot) =>
      update(ref, (current) => reducePreviewServerSnapshot(current, snapshot)),
    mergeSnapshot: (ref, snapshot) =>
      update(ref, (current) => reduceUpdatePreviewServerSnapshot(current, snapshot)),
    reconcile: (ref, result) =>
      update(ref, (current) => reducePreviewServerSessions(current, result)),
    setActiveTab: (ref, tabId) => update(ref, (current) => reduceActivePreviewTab(current, tabId)),
    rememberUrl: (ref, url) => update(ref, (current) => reduceRememberPreviewUrl(current, url)),
    beginClose: (ref, tabId) =>
      update(ref, (current) => reduceBeginPreviewSessionClose(current, tabId)),
    cancelClose: (ref, snapshot, tabId) =>
      update(ref, (current) => reduceCancelPreviewSessionClose(current, snapshot, tabId)),
    runtimeTabId: runtimeTabIdFor,
    tabOptions,
    setTabOptions,
    hostReport: (runtimeTabId) => registry.get(hostReportsAtom).get(runtimeTabId) ?? null,
    visibleRuntimeTabIdsAtom,
    slotAtom,
    hostReportsAtom,
    tabOptionsAtom,
    send,
    clearCookies,
    clearCache,
    setCookies,
    evaluate,
    syncThread,
    feature: {
      views: { browserHost: hostViewAtom },
      actions: {
        browserHostReport: async (params) => {
          const { runtimeTabId, ...incoming } = HostReportParams(params);
          const reports = registry.get(hostReportsAtom);
          const previous = reports.get(runtimeTabId);
          const report = {
            ...incoming,
            favicon: incoming.favicon ?? faviconByTab.get(runtimeTabId) ?? null,
            navStatus:
              previous?.navStatus.kind === "LoadFailed" &&
              incoming.navStatus.kind === "Loading" &&
              incoming.navStatus.url === previous.navStatus.url
                ? previous.navStatus
                : incoming.navStatus,
          };
          if (sameReport(previous, report)) return null;
          const next = new Map(reports);
          next.set(runtimeTabId, report);
          registry.set(hostReportsAtom, next);
          if (report.navStatus.kind === "Loading")
            probeNavigation(runtimeTabId, report.navStatus.url);
          else probeFailures.delete(runtimeTabId);
          publishDesktopState(runtimeTabId);
          return null;
        },
        browserHostMessage: async (params) => {
          const { runtimeTabId, message } = HostMessageParams(params);
          const decoded = decodeHostMessage(message);
          if (decoded === null) return null;
          if (decoded.type === "favicon") {
            faviconByTab.set(runtimeTabId, {
              dataUrl: decoded.dataUrl,
              pageUrl: decoded.pageUrl,
              capturedAt: Date.now(),
            });
            const report = registry.get(hostReportsAtom).get(runtimeTabId);
            if (report !== undefined) {
              const next = new Map(registry.get(hostReportsAtom));
              next.set(runtimeTabId, {
                ...report,
                favicon: faviconByTab.get(runtimeTabId) ?? null,
              });
              registry.set(hostReportsAtom, next);
              publishDesktopState(runtimeTabId);
            }
            return null;
          }
          settle(
            decoded.id,
            decoded.ok,
            decoded.ok ? (decoded.value ?? null) : null,
            decoded.ok ? null : (decoded.error ?? null),
          );
          return null;
        },
        browserHostCommandResult: async (params) => {
          const { id, ok, value, error } = HostCommandResultParams(params);
          settle(id, ok, value ?? null, error ?? null);
          return null;
        },
        browserHostSlots: async (params) => {
          const { slots } = HostSlotsParams(params);
          const current = registry.get(slotAtom);
          const fittedContentFor = (
            runtimeTabId: string,
            previous: HostSlot | undefined,
          ): HostSlotContent | null => {
            if (previous === undefined) return null;
            if (previous.fitSource) return previous.fittedContent;
            const target = parseRuntimeTabId(runtimeTabId);
            if (target === null) return null;
            const snapshot = read(target.threadRef).sessions[target.tabId];
            const layout = slotLayout(
              previous,
              snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
              tabOptions(runtimeTabId).zoomFactor,
            );
            return {
              x: layout.viewportX,
              y: layout.viewportY,
              width: layout.viewportWidth,
              height: layout.viewportHeight,
              scale: layout.viewportScale,
              scrollLeft: 0,
              scrollTop: 0,
            };
          };
          const next = new Map(
            slots.map((slot): [string, HostSlot] => [
              slot.runtimeTabId,
              {
                width: Math.round(slot.width),
                height: Math.round(slot.height),
                deviceToolbar: slot.deviceToolbar,
                fitSource: slot.fitSource,
                fittedContent: slot.fitSource
                  ? fittedContentFor(slot.runtimeTabId, current.get(slot.runtimeTabId))
                  : null,
              },
            ]),
          );
          const unchanged =
            current.size === next.size &&
            [...next].every(([key, slot]) => {
              const previous = current.get(key);
              return (
                previous !== undefined &&
                previous.width === slot.width &&
                previous.height === slot.height &&
                previous.deviceToolbar === slot.deviceToolbar &&
                previous.fitSource === slot.fitSource &&
                previous.fittedContent === slot.fittedContent
              );
            });
          if (!unchanged) registry.set(slotAtom, next);
          return null;
        },
      },
    },
  };
  services.set(context, service);
  return service;
}

export function createBrowserHostFeature(context: FeatureContext): CoreFeature {
  return browserPreviewService(context).feature;
}
