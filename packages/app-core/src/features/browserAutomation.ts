import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewAutomationClickInput,
  PreviewAutomationEvaluateInput,
  type PreviewAutomationHost,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationPressInput,
  type PreviewAutomationRequest,
  PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  PreviewAutomationScrollInput,
  PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationSetColorSchemeResult,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
  type PreviewRenderedViewportSize,
  type PreviewViewportSetting,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { parseRuntimeTabId } from "../browserPreview.ts";
import { playwrightInjectedRuntimeInstallExpression } from "@t3tools/desktop/src/preview/PlaywrightInjectedRuntime.ts";
import { makePreviewAutomationKeySequence } from "@t3tools/desktop/src/preview/PreviewKeyboard.ts";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { toBrowserDefaults } from "@t3tools/web/src/browser/browserDefaults.logic.ts";
import { resolveBrowserNavigationTargetWith } from "@t3tools/web/src/browser/browserTargetResolver.logic.ts";
import { browserViewportSettingKey } from "@t3tools/web/src/browser/browserViewportLayout.ts";
import { isCurrentPreviewRuntimeTab } from "@t3tools/web/src/browser/previewRuntimeTabId.ts";
import { createPreviewAutomationClientId } from "@t3tools/web/src/components/preview/previewAutomationClientId.ts";
import {
  PreviewAutomationOperationError,
  PreviewAutomationOverlayTimeoutError,
  PreviewAutomationTargetUnavailableError,
  PreviewAutomationViewportTimeoutError,
} from "@t3tools/web/src/components/preview/previewAutomationErrors.ts";
import {
  resolveHostWaitBudgetMs,
  waitForHostReadiness,
} from "@t3tools/web/src/components/preview/previewAutomationHostBudget.ts";
import {
  explicitlySuppressesPreviewMiniPlayer,
  previewAutomationDefaultViewport,
  previewAutomationOpenNeedsOverlay,
  shouldAutoShowPreviewForAutomationUse,
  shouldOpenPreviewMiniPlayer,
} from "@t3tools/web/src/components/preview/previewAutomationOpenReadiness.ts";
import { createPreviewAutomationRequestConsumerAtom } from "@t3tools/web/src/components/preview/previewAutomationRequestConsumer.ts";
import {
  needsPreviewAutomationSessionSync,
  resolvePreviewAutomationOpenTab,
  resolvePreviewAutomationTarget,
} from "@t3tools/web/src/components/preview/previewAutomationTarget.ts";
import { waitForNavigationReadinessWith } from "@t3tools/web/src/components/preview/previewNavigationReadiness.logic.ts";
import { isPreviewViewportReady } from "@t3tools/web/src/components/preview/previewViewportReadiness.ts";
import { shouldRollbackPreviewViewport } from "@t3tools/web/src/components/preview/previewViewportRollback.ts";
import {
  browserMiniPlayerSource,
  selectThreadPreviewMiniPlayerTabId,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { browserPreviewService, type BrowserPreviewService } from "../browserPreview.ts";
import {
  clickDispatchScript,
  clickPointScript,
  keyDispatchScript,
  cursorScript,
  documentReadyStateScript,
  pageInfoScript,
  playwrightInstalledProbe,
  scrollScript,
  typeScript,
  userExpressionScript,
  viewportSizeScript,
  waitForScript,
} from "../browserPageScripts.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openBrowserSession } from "./browser.ts";

const AGENT_CURSOR_MOVE_MS = 160;
const AGENT_CURSOR_CLICK_LEAD_MS = 40;
const PRESENTATION_SETTLE_TIMEOUT_MS = 500;
const MAX_EVALUATION_BYTES = 64_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

const SUPPORTED_OPERATIONS = PREVIEW_AUTOMATION_OPERATIONS.filter(
  (operation) => operation !== "recordingStart" && operation !== "recordingStop",
);

const decodeOpen = Schema.decodeUnknownSync(PreviewAutomationOpenInput);
const decodeNavigate = Schema.decodeUnknownSync(PreviewAutomationNavigateInput);
const decodeResize = Schema.decodeUnknownSync(PreviewAutomationResizeInput);
const decodeColorScheme = Schema.decodeUnknownSync(PreviewAutomationSetColorSchemeInput);
const decodeClick = Schema.decodeUnknownSync(PreviewAutomationClickInput);
const decodeType = Schema.decodeUnknownSync(PreviewAutomationTypeInput);
const decodePress = Schema.decodeUnknownSync(PreviewAutomationPressInput);
const decodeScroll = Schema.decodeUnknownSync(PreviewAutomationScrollInput);
const decodeEvaluate = Schema.decodeUnknownSync(PreviewAutomationEvaluateInput);
const decodeWaitFor = Schema.decodeUnknownSync(PreviewAutomationWaitForInput);

const FocusParams = Schema.decodeUnknownSync(Schema.Struct({ focused: Schema.Boolean }));

const PointResult = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({ x: Schema.Number, y: Schema.Number }),
    Schema.Struct({ invalidSelector: Schema.Literal(true), message: Schema.String }),
    Schema.Struct({ notFound: Schema.Literal(true) }),
  ]),
);
const ActionResult = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true) }),
    Schema.Struct({ invalidSelector: Schema.Literal(true), message: Schema.String }),
    Schema.Struct({ notFound: Schema.Literal(true) }),
    Schema.Struct({ notEditable: Schema.Literal(true) }),
  ]),
);
const MatchResult = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({ matched: Schema.Boolean }),
    Schema.Struct({ invalidSelector: Schema.Literal(true), message: Schema.String }),
  ]),
);
const SizeResult = Schema.decodeUnknownSync(
  Schema.Struct({ width: Schema.Number, height: Schema.Number }),
);
const ScreenshotResult = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ data: Schema.String, width: Schema.Number, height: Schema.Number }),
  ),
);
const PageInfoResult = Schema.decodeUnknownSync(
  Schema.Struct({
    url: Schema.String,
    title: Schema.String,
    loading: Schema.Boolean,
    visibleText: Schema.String,
    interactiveElements: Schema.Array(
      Schema.Struct({
        tag: Schema.String,
        role: Schema.NullOr(Schema.String),
        name: Schema.String,
        selector: Schema.String,
        x: Schema.Number,
        y: Schema.Number,
        width: Schema.Number,
        height: Schema.Number,
      }),
    ),
    accessibilityTree: Schema.Unknown,
    consoleEntries: Schema.Array(
      Schema.Struct({
        level: Schema.String,
        text: Schema.String,
        timestamp: Schema.String,
        source: Schema.optional(Schema.String),
      }),
    ),
    networkEntries: Schema.Array(
      Schema.Struct({
        url: Schema.String,
        method: Schema.String,
        status: Schema.NullOr(Schema.Number),
        failed: Schema.Boolean,
        errorText: Schema.optional(Schema.String),
        timestamp: Schema.String,
      }),
    ),
  }),
);

class PreviewAutomationSelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewAutomationInvalidSelectorError";
  }
}

class PreviewAutomationTargetMissingError extends Error {
  constructor() {
    super("No element matched the selector.");
    this.name = "PreviewAutomationTargetNotFoundError";
  }
}

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const locatorOf = (input: {
  readonly selector?: string | undefined;
  readonly locator?: string | undefined;
}): string | null => input.locator ?? (input.selector ? `css=${input.selector}` : null);

const notEditable = (input: {
  readonly selector?: string | undefined;
  readonly locator?: string | undefined;
}) => ({
  _tag: "PreviewAutomationTargetNotEditableError" as const,
  selectorKind: input.locator ? "locator" : input.selector ? "selector" : "focused-element",
  selectorLength: (input.locator ?? input.selector ?? "").length,
});

const isRenderedSize = (value: { readonly width: number; readonly height: number }) =>
  Number.isInteger(value.width) &&
  value.width > 0 &&
  Number.isInteger(value.height) &&
  value.height > 0;

export function createBrowserAutomationFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const preview: BrowserPreviewService = browserPreviewService(context);
  const focusedAtom = Atom.make(true).pipe(Atom.keepAlive);
  const presentationSuppressed = new Map<string, Set<string>>();
  let playwrightExpression: Promise<string> | null = null;

  const installExpression = () => {
    playwrightExpression ??= Effect.runPromise(playwrightInjectedRuntimeInstallExpression());
    return playwrightExpression;
  };

  const ensurePlaywright = async (runtimeTabId: string) => {
    if ((await preview.evaluate(runtimeTabId, playwrightInstalledProbe)) === true) return;
    await preview.evaluate(runtimeTabId, await installExpression());
  };

  const environmentUrlReader = (environmentId: EnvironmentId) => (): URL => {
    const prepared = Option.getOrNull(
      registry.get(state.environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    if (prepared === null) throw new Error(`Environment ${environmentId} is not connected.`);
    return new URL(prepared.httpBaseUrl);
  };

  const assertCurrent = (
    threadRef: ScopedThreadRef,
    tabId: string,
    runtimeTabId: string,
    request: Pick<PreviewAutomationRequest, "operation" | "requestId">,
  ) => {
    const current = preview.read(threadRef);
    if (
      current.sessions[tabId] &&
      isCurrentPreviewRuntimeTab(threadRef, current.serverEpoch, tabId, runtimeTabId)
    ) {
      return current;
    }
    throw new PreviewAutomationTargetUnavailableError({
      requestId: request.requestId,
      operation: request.operation,
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      tabId,
      bridgeAvailable: true,
    });
  };

  const hostStatus = async (runtimeTabId: string) => {
    const report = preview.hostReport(runtimeTabId);
    if (report === null || !report.webviewReady) {
      return { available: false, url: null, title: null, loading: false };
    }
    const nav = report.navStatus;
    return {
      available: true,
      url: nav.kind === "Idle" ? null : nav.url,
      title: nav.kind === "Idle" ? null : nav.title || null,
      loading: nav.kind === "Loading",
    };
  };

  const readRenderedViewport = async (
    runtimeTabId: string,
  ): Promise<PreviewRenderedViewportSize | null> => {
    const report = preview.hostReport(runtimeTabId);
    if (report === null || !report.webviewReady) return null;
    const size = SizeResult(await preview.evaluate(runtimeTabId, viewportSizeScript));
    return isRenderedSize(size) ? size : null;
  };

  const declaredViewport = (runtimeTabId: string, setting: PreviewViewportSetting) => {
    const slot = registry.get(preview.slotAtom).get(runtimeTabId);
    const zoom = preview.tabOptions(runtimeTabId).zoomFactor;
    if (setting._tag !== "fill") return { width: setting.width, height: setting.height };
    if (slot === undefined) return null;
    return {
      width: Math.max(1, Math.round(slot.width / zoom)),
      height: Math.max(1, Math.round(slot.height / zoom)),
    };
  };

  const currentStatus = async (
    threadRef: ScopedThreadRef,
    requestedTabId: string | null,
  ): Promise<PreviewAutomationStatus> => {
    const current = preview.read(threadRef);
    const { snapshot, tabId } = resolvePreviewAutomationTarget(current, requestedTabId);
    const runtimeTabId = tabId ? preview.runtimeTabId(threadRef, tabId) : null;
    const visible = runtimeTabId ? registry.get(preview.slotAtom).has(runtimeTabId) : false;
    const viewportSetting = snapshot ? (snapshot.viewport ?? FILL_PREVIEW_VIEWPORT) : undefined;
    const viewport = runtimeTabId
      ? await readRenderedViewport(runtimeTabId).catch(() => null)
      : null;
    const viewportStatus = {
      ...(viewportSetting === undefined ? {} : { viewportSetting }),
      ...(viewport === null ? {} : { viewport }),
    };
    if (runtimeTabId && tabId && current.desktopByTabId[tabId]) {
      const status = await hostStatus(runtimeTabId);
      return { ...status, tabId, visible, ...viewportStatus };
    }
    const navStatus = snapshot?.navStatus;
    return {
      available: false,
      visible,
      tabId,
      url: navStatus && navStatus._tag !== "Idle" ? navStatus.url : null,
      title: navStatus && navStatus._tag !== "Idle" ? navStatus.title : null,
      loading: navStatus?._tag === "Loading",
      ...viewportStatus,
    };
  };

  const waitForOverlay = async (
    threadRef: ScopedThreadRef,
    request: PreviewAutomationRequest,
    tabId: string,
    runtimeTabId: string,
    deadlineMs: number,
  ) => {
    const waitBudgetMs = Math.max(0, deadlineMs - Date.now());
    const ready = await waitForHostReadiness(deadlineMs, async () => {
      const current = assertCurrent(threadRef, tabId, runtimeTabId, request);
      if (!current.desktopByTabId[tabId]) return false;
      return (await hostStatus(runtimeTabId)).available;
    });
    if (ready) return;
    throw new PreviewAutomationOverlayTimeoutError({
      requestId: request.requestId,
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      timeoutMs: waitBudgetMs,
    });
  };

  const waitForPresentation = async (runtimeTabId: string) => {
    const deadline = Date.now() + PRESENTATION_SETTLE_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      if (registry.get(preview.slotAtom).has(runtimeTabId)) return;
      await sleep(16);
    }
  };

  const withAgentControl = async <A>(runtimeTabId: string, run: () => Promise<A>): Promise<A> => {
    preview.setTabOptions(runtimeTabId, (current) => ({ ...current, controller: "agent" }));
    try {
      return await run();
    } finally {
      preview.setTabOptions(runtimeTabId, (current) => ({ ...current, controller: "none" }));
    }
  };

  const resize = (threadRef: ScopedThreadRef, tabId: string, viewport: PreviewViewportSetting) =>
    runAtomCommand(
      registry,
      state.previewEnvironment.resize,
      {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, tabId, viewport },
      },
      { reportFailure: false },
    );

  const waitForRenderedViewport = async (
    threadRef: ScopedThreadRef,
    request: PreviewAutomationRequest,
    tabId: string,
    runtimeTabId: string,
    setting: PreviewViewportSetting,
    timeoutMs: number,
  ): Promise<PreviewRenderedViewportSize> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const current = assertCurrent(threadRef, tabId, runtimeTabId, request);
      try {
        const applied = current.sessions[tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
        const rendered = await readRenderedViewport(runtimeTabId);
        if (
          rendered &&
          isPreviewViewportReady({
            setting,
            appliedSettingKey: browserViewportSettingKey(applied),
            declaredViewport: declaredViewport(runtimeTabId, applied),
            renderedViewport: rendered,
          })
        ) {
          return rendered;
        }
      } catch {
        await sleep(50);
        continue;
      }
      await sleep(50);
    }
    throw new PreviewAutomationViewportTimeoutError({
      requestId: request.requestId,
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      tabId,
      timeoutMs,
    });
  };

  const snapshot = async (runtimeTabId: string): Promise<PreviewAutomationSnapshot> => {
    await ensurePlaywright(runtimeTabId).catch(() => undefined);
    const page = PageInfoResult(await preview.evaluate(runtimeTabId, pageInfoScript));
    const raw = await preview.send(runtimeTabId, { kind: "screenshot", path: null });
    if (raw === null) throw new Error("The browser did not return a screenshot.");
    const image = ScreenshotResult(raw);
    return {
      url: page.url,
      title: page.title,
      loading: page.loading,
      visibleText: page.visibleText,
      interactiveElements: page.interactiveElements,
      accessibilityTree: page.accessibilityTree,
      consoleEntries: page.consoleEntries,
      networkEntries: page.networkEntries,
      actionTimeline: [],
      screenshot: {
        mimeType: "image/png",
        data: image.data,
        width: Math.round(image.width),
        height: Math.round(image.height),
      },
    };
  };

  const click = async (runtimeTabId: string, input: PreviewAutomationClickInput) => {
    const locator = locatorOf(input);
    let point: { readonly x: number; readonly y: number };
    if (locator === null) {
      point = { x: input.x ?? 0, y: input.y ?? 0 };
    } else {
      await ensurePlaywright(runtimeTabId);
      const result = PointResult(await preview.evaluate(runtimeTabId, clickPointScript(locator)));
      if ("invalidSelector" in result) throw new PreviewAutomationSelectorError(result.message);
      if ("notFound" in result) throw new PreviewAutomationTargetMissingError();
      point = result;
    }
    const viewport = SizeResult(await preview.evaluate(runtimeTabId, viewportSizeScript));
    if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
      throw new Error(
        `Coordinates (${point.x}, ${point.y}) are outside the ${viewport.width}×${viewport.height} viewport.`,
      );
    }
    await preview.evaluate(runtimeTabId, cursorScript(point.x, point.y, "move"));
    await sleep(AGENT_CURSOR_MOVE_MS);
    await preview.evaluate(runtimeTabId, cursorScript(point.x, point.y, "click"));
    await sleep(AGENT_CURSOR_CLICK_LEAD_MS);
    await preview.evaluate(runtimeTabId, clickDispatchScript(point.x, point.y));
  };

  const type = async (runtimeTabId: string, input: PreviewAutomationTypeInput) => {
    const locator = locatorOf(input);
    if (locator) await ensurePlaywright(runtimeTabId);
    const result = ActionResult(
      await preview.evaluate(
        runtimeTabId,
        typeScript({ locator, text: input.text, clear: input.clear ?? false }),
      ),
    );
    if ("invalidSelector" in result) throw new PreviewAutomationSelectorError(result.message);
    if ("notFound" in result) throw new PreviewAutomationTargetMissingError();
    if ("notEditable" in result) throw notEditable(input);
  };

  const press = async (runtimeTabId: string, input: PreviewAutomationPressInput) => {
    const sequence = makePreviewAutomationKeySequence(input, {
      isMac: process.platform === "darwin",
    });
    await preview.evaluate(
      runtimeTabId,
      keyDispatchScript({
        key: sequence.keyDown.key,
        code: sequence.keyDown.code,
        text: typeof sequence.keyDown.text === "string" ? sequence.keyDown.text : "",
        keyCode: sequence.keyDown.windowsVirtualKeyCode,
        modifiers: input.modifiers ?? [],
      }),
    );
  };

  const scroll = async (runtimeTabId: string, input: PreviewAutomationScrollInput) => {
    const locator = locatorOf(input);
    if (locator) await ensurePlaywright(runtimeTabId);
    const result = ActionResult(
      await preview.evaluate(
        runtimeTabId,
        scrollScript({ locator, deltaX: input.deltaX ?? 0, deltaY: input.deltaY ?? 0 }),
      ),
    );
    if ("invalidSelector" in result) throw new PreviewAutomationSelectorError(result.message);
    if ("notFound" in result) throw new PreviewAutomationTargetMissingError();
  };

  const evaluate = async (runtimeTabId: string, input: PreviewAutomationEvaluateInput) => {
    const value = await preview.evaluate(
      runtimeTabId,
      userExpressionScript(input.expression, input.awaitPromise ?? true),
    );
    const serialized = JSON.stringify(value) ?? "null";
    const actualBytes = Buffer.byteLength(serialized, "utf8");
    if (actualBytes > MAX_EVALUATION_BYTES) {
      throw new Error(
        `Evaluation result is ${actualBytes} bytes, above the ${MAX_EVALUATION_BYTES}-byte limit.`,
      );
    }
    return value;
  };

  const waitFor = async (runtimeTabId: string, input: PreviewAutomationWaitForInput) => {
    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const locator = locatorOf(input);
    if (locator) await ensurePlaywright(runtimeTabId);
    const script = waitForScript({
      locator,
      text: input.text ?? null,
      urlIncludes: input.urlIncludes ?? null,
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const result = MatchResult(await preview.evaluate(runtimeTabId, script));
      if ("invalidSelector" in result) throw new PreviewAutomationSelectorError(result.message);
      if (result.matched) return;
      await sleep(100);
    }
    throw new Error(`Wait conditions did not match within ${timeoutMs}ms.`);
  };

  const openMiniPlayer = (threadRef: ScopedThreadRef, tabId: string) => {
    usePreviewMiniPlayerStore.getState().open(threadRef, browserMiniPlayerSource(tabId));
  };

  const handleRequest = async (
    environmentId: EnvironmentId,
    request: PreviewAutomationRequest,
  ): Promise<unknown> => {
    const hostDeadlineMs = Date.now() + resolveHostWaitBudgetMs(request.timeoutMs);
    const threadRef: ScopedThreadRef = { environmentId, threadId: request.threadId };
    let tabId = request.tabId ?? null;
    try {
      let current = preview.read(threadRef);
      if (needsPreviewAutomationSessionSync(current, request.tabId)) {
        await preview.syncThread(threadRef);
        current = preview.read(threadRef);
      }
      tabId = request.tabId ?? current.snapshot?.tabId ?? null;
      const defaults = () => toBrowserDefaults(registry.get(context.clientSettingsAtom));
      const requireReadyTab = async () => {
        const readyTabId = tabId;
        if (!readyTabId) {
          throw new PreviewAutomationTargetUnavailableError({
            requestId: request.requestId,
            operation: request.operation,
            environmentId,
            threadId: request.threadId,
            tabId,
            bridgeAvailable: true,
          });
        }
        const runtimeTabId = preview.runtimeTabId(threadRef, readyTabId);
        if (
          request.operation !== "open" &&
          shouldAutoShowPreviewForAutomationUse({
            operation: request.operation,
            autoShowFloatingPreview: defaults().autoShowFloatingPreview,
            presentationSuppressed:
              presentationSuppressed.get(request.threadId)?.has(runtimeTabId) ?? false,
          })
        ) {
          openMiniPlayer(threadRef, readyTabId);
        }
        await waitForOverlay(threadRef, request, readyTabId, runtimeTabId, hostDeadlineMs);
        return { tabId: readyTabId, runtimeTabId };
      };
      switch (request.operation) {
        case "status":
          return await currentStatus(threadRef, tabId);
        case "open": {
          const input = decodeOpen(request.input);
          const resolvedInputUrl = input.url
            ? resolveBrowserNavigationTargetWith(
                environmentId,
                { kind: "url", url: input.url },
                environmentUrlReader(environmentId),
              ).resolvedUrl
            : undefined;
          let activeTabId = resolvePreviewAutomationOpenTab(
            current,
            request.tabId,
            input.reuseExistingTab ?? true,
          );
          let activeSnapshot = activeTabId
            ? (current.sessions[activeTabId] ?? current.snapshot ?? undefined)
            : undefined;
          const reusedExistingTab = activeTabId !== null;
          tabId = activeTabId;
          if (!activeTabId) {
            const snapshot = await openBrowserSession(context, preview, {
              threadRef,
              ...(resolvedInputUrl ? { url: resolvedInputUrl } : {}),
            });
            if (snapshot === null) throw new Error("The browser tab could not be opened.");
            activeTabId = snapshot.tabId;
            activeSnapshot = snapshot;
            tabId = activeTabId;
          }
          const openedTabId = activeTabId;
          const activeRuntimeTabId = preview.runtimeTabId(threadRef, openedTabId);
          if (activeSnapshot) {
            const defaultViewport = previewAutomationDefaultViewport(
              reusedExistingTab,
              activeSnapshot,
            );
            if (defaultViewport) {
              assertCurrent(threadRef, openedTabId, activeRuntimeTabId, request);
              const resizeResult = await resize(threadRef, openedTabId, defaultViewport);
              if (resizeResult._tag === "Failure") throw squashAtomCommandFailure(resizeResult);
              activeSnapshot = resizeResult.value;
              preview.mergeSnapshot(threadRef, resizeResult.value);
            }
          }
          const shouldPresent = shouldOpenPreviewMiniPlayer(
            input,
            defaults().autoShowFloatingPreview,
          );
          const suppressedTabs = presentationSuppressed.get(request.threadId);
          if (explicitlySuppressesPreviewMiniPlayer(input)) {
            if (suppressedTabs) suppressedTabs.add(activeRuntimeTabId);
            else presentationSuppressed.set(request.threadId, new Set([activeRuntimeTabId]));
            const miniPlayerTabId = selectThreadPreviewMiniPlayerTabId(
              usePreviewMiniPlayerStore.getState().byThreadKey,
              threadRef,
            );
            if (miniPlayerTabId === openedTabId)
              usePreviewMiniPlayerStore.getState().close(threadRef);
          } else if (shouldPresent) {
            suppressedTabs?.delete(activeRuntimeTabId);
            if (suppressedTabs?.size === 0) presentationSuppressed.delete(request.threadId);
          }
          if (shouldPresent) openMiniPlayer(threadRef, openedTabId);
          if (activeSnapshot && previewAutomationOpenNeedsOverlay(input, activeSnapshot)) {
            await requireReadyTab();
          }
          if (shouldPresent) await waitForPresentation(activeRuntimeTabId);
          if (reusedExistingTab && resolvedInputUrl) {
            assertCurrent(threadRef, openedTabId, activeRuntimeTabId, request);
            await preview.send(activeRuntimeTabId, { kind: "navigate", url: resolvedInputUrl });
            await waitForNavigation(
              threadRef,
              request,
              openedTabId,
              activeRuntimeTabId,
              "load",
              request.timeoutMs,
            );
          }
          return await currentStatus(threadRef, openedTabId);
        }
        case "navigate": {
          const ready = await requireReadyTab();
          const input = decodeNavigate(request.input);
          const resolution = resolveBrowserNavigationTargetWith(
            environmentId,
            input.target ?? { kind: "url", url: input.url ?? "" },
            environmentUrlReader(environmentId),
          );
          await withAgentControl(ready.runtimeTabId, () =>
            preview.send(ready.runtimeTabId, { kind: "navigate", url: resolution.resolvedUrl }),
          );
          await waitForNavigation(
            threadRef,
            request,
            ready.tabId,
            ready.runtimeTabId,
            input.readiness ?? "load",
            input.timeoutMs ?? request.timeoutMs,
          );
          return await currentStatus(threadRef, ready.tabId);
        }
        case "resize": {
          const ready = await requireReadyTab();
          const input = decodeResize(request.input);
          const setting = resolvePreviewViewport(input);
          const operationState = assertCurrent(threadRef, ready.tabId, ready.runtimeTabId, request);
          const previousSetting =
            operationState.sessions[ready.tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
          const result = await resize(threadRef, ready.tabId, setting);
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          preview.mergeSnapshot(threadRef, result.value);
          try {
            const viewport = await waitForRenderedViewport(
              threadRef,
              request,
              ready.tabId,
              ready.runtimeTabId,
              setting,
              input.timeoutMs ?? request.timeoutMs,
            );
            return {
              tabId: ready.tabId,
              setting,
              viewport,
            } satisfies PreviewAutomationResizeResult;
          } catch (cause) {
            const latestState = preview.read(threadRef);
            const latestSetting =
              latestState.sessions[ready.tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
            if (
              shouldRollbackPreviewViewport(
                previousSetting,
                setting,
                latestSetting,
                operationState.serverEpoch,
                latestState.serverEpoch,
              )
            ) {
              const rollback = await resize(threadRef, ready.tabId, previousSetting);
              if (rollback._tag !== "Failure") preview.mergeSnapshot(threadRef, rollback.value);
            }
            throw cause;
          }
        }
        case "setColorScheme": {
          const ready = await requireReadyTab();
          const input = decodeColorScheme(request.input);
          preview.setTabOptions(ready.runtimeTabId, (existing) => ({
            ...existing,
            colorScheme: input.colorScheme,
          }));
          return {
            tabId: ready.tabId,
            colorScheme: input.colorScheme,
          } satisfies PreviewAutomationSetColorSchemeResult;
        }
        case "snapshot": {
          const ready = await requireReadyTab();
          return await withAgentControl(ready.runtimeTabId, () => snapshot(ready.runtimeTabId));
        }
        case "click": {
          const ready = await requireReadyTab();
          const input = decodeClick(request.input);
          return await withAgentControl(ready.runtimeTabId, () => click(ready.runtimeTabId, input));
        }
        case "type": {
          const ready = await requireReadyTab();
          const input = decodeType(request.input);
          return await withAgentControl(ready.runtimeTabId, () => type(ready.runtimeTabId, input));
        }
        case "press": {
          const ready = await requireReadyTab();
          const input = decodePress(request.input);
          return await withAgentControl(ready.runtimeTabId, () => press(ready.runtimeTabId, input));
        }
        case "scroll": {
          const ready = await requireReadyTab();
          const input = decodeScroll(request.input);
          return await withAgentControl(ready.runtimeTabId, () =>
            scroll(ready.runtimeTabId, input),
          );
        }
        case "evaluate": {
          const ready = await requireReadyTab();
          const input = decodeEvaluate(request.input);
          return await withAgentControl(ready.runtimeTabId, () =>
            evaluate(ready.runtimeTabId, input),
          );
        }
        case "waitFor": {
          const ready = await requireReadyTab();
          const input = decodeWaitFor(request.input);
          return await withAgentControl(ready.runtimeTabId, () =>
            waitFor(ready.runtimeTabId, input),
          );
        }
        case "recordingStart":
        case "recordingStop":
          throw new Error("Browser recording is not available in the native app yet.");
      }
    } catch (cause) {
      throw PreviewAutomationOperationError.fromCause({
        requestId: request.requestId,
        operation: request.operation,
        environmentId,
        threadId: request.threadId,
        tabId,
        cause,
      });
    }
  };

  const waitForNavigation = (
    threadRef: ScopedThreadRef,
    request: PreviewAutomationRequest,
    tabId: string,
    runtimeTabId: string,
    readiness: PreviewAutomationNavigateInput["readiness"],
    timeoutMs: number,
  ) =>
    waitForNavigationReadinessWith(
      {
        assertCurrent: () => {
          assertCurrent(threadRef, tabId, runtimeTabId, request);
        },
        documentReadyState: () => preview.evaluate(runtimeTabId, documentReadyStateScript),
        status: () => hostStatus(runtimeTabId),
        sleep,
      },
      {
        threadRef,
        requestId: request.requestId,
        tabId,
        operation: request.operation,
        readiness,
        timeoutMs,
      },
    );

  type Host = {
    readonly unsubscribe: () => void;
  };
  const hosts = new Map<string, Host>();

  const startHost = (environmentId: EnvironmentId): Host => {
    const clientId = createPreviewAutomationClientId();
    const hostInput: PreviewAutomationHost = {
      clientId,
      environmentId,
      supportedOperations: [...SUPPORTED_OPERATIONS],
    };
    const connectionAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
    const requestHandlerAtom = Atom.make({
      handle: (request: PreviewAutomationRequest) => handleRequest(environmentId, request),
    }).pipe(Atom.keepAlive);
    const consumerAtom = createPreviewAutomationRequestConsumerAtom({
      requestsAtom: state.previewEnvironment.automationRequests({
        environmentId,
        input: hostInput,
      }),
      clientId,
      connectionAtom,
      environmentId,
      requestHandlerAtom,
      respond: (response) =>
        runAtomCommand(
          registry,
          state.previewEnvironment.respondToAutomation,
          { environmentId, input: response },
          { label: "preview automation response" },
        ),
      label: `preview:automation-host:${environmentId}:${clientId}`,
    });
    const stopConsumer = registry.subscribe(consumerAtom, () => undefined, { immediate: true });
    const focusAtom = Atom.make((get) => {
      const connectionId = get(connectionAtom);
      if (connectionId === null) return null;
      const slots = get(preview.slotAtom);
      const focused = get(focusedAtom);
      const liveTabs: Array<{
        readonly threadId: ScopedThreadRef["threadId"];
        readonly tabId: string;
        readonly visible: boolean;
      }> = [];
      for (const report of get(preview.hostReportsAtom).keys()) {
        const parsed = parseRuntimeTabId(report);
        if (parsed === null || parsed.threadRef.environmentId !== environmentId) continue;
        const current = get(preview.previewStateAtom(scopedThreadKey(parsed.threadRef)));
        if (!current.desktopByTabId[parsed.tabId]?.hasWebContents) continue;
        liveTabs.push({
          threadId: parsed.threadRef.threadId,
          tabId: parsed.tabId,
          visible: slots.has(report) && focused,
        });
      }
      return { clientId, environmentId, connectionId, focused, liveTabs };
    });
    let lastReport: string | null = null;
    const stopFocus = registry.subscribe(
      focusAtom,
      (input) => {
        if (input === null) return;
        const key = JSON.stringify(input);
        if (key === lastReport) return;
        lastReport = key;
        void runAtomCommand(
          registry,
          state.previewEnvironment.focusAutomationHost,
          { environmentId, input },
          { label: "preview automation host focus" },
        ).then((result) => {
          if (result._tag === "Failure" && lastReport === key) lastReport = null;
        });
      },
      { immediate: true },
    );
    return {
      unsubscribe: () => {
        stopConsumer();
        stopFocus();
      },
    };
  };

  registry.subscribe(
    Atom.make((get) => [...get(state.environmentCatalog.catalogValueAtom).entries.keys()]),
    (environmentIds) => {
      const live = new Set<string>(environmentIds);
      for (const [environmentId, host] of hosts) {
        if (live.has(environmentId)) continue;
        host.unsubscribe();
        hosts.delete(environmentId);
      }
      for (const environmentId of environmentIds) {
        if (!hosts.has(environmentId)) hosts.set(environmentId, startHost(environmentId));
      }
    },
    { immediate: true },
  );

  return {
    views: {},
    actions: {
      browserHostWindowFocus: async (params) => {
        const { focused } = FocusParams(params);
        if (registry.get(focusedAtom) !== focused) registry.set(focusedAtom, focused);
        return null;
      },
    },
  };
}
