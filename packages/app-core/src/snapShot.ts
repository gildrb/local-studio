import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as Path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DesktopSnapShotSetupAction,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  SnapShotShortcut,
  type DesktopCaptureConfigApplied,
  type DesktopCaptureConfigPreview,
  type DesktopCaptureConfigRequest,
  type DesktopPendingSnapShot,
  type DesktopSnapShotEvent,
  type DesktopSnapShotShortcutAvailability,
  type DesktopSnapShotState,
  type ScopedThreadRef,
  type SnapShotSound,
} from "@t3tools/contracts";
import { macActiveWindow } from "@t3tools/shared/snapShot/ActiveWindow";
import { startMacModifierPairShortcutProcess } from "@t3tools/shared/snapShot/MacModifierPairShortcutProcess";
import {
  makeSnapShotEngine,
  type SnapShotEngine,
  type SnapShotFlashFeedback,
  type SnapShotTransitionFeedback,
} from "@t3tools/shared/snapShot/SnapShotEngine";
import {
  setSnapShotImageCodec,
  type SnapShotRectangle,
} from "@t3tools/shared/snapShot/snapShotImage";
import {
  SNAP_SHOT_ANIMATION_TIMEOUT_MS,
  snapShotAnimationDurationMs,
  type SnapShotAnimationDestination,
  type SnapShotAnimationDetails,
} from "@t3tools/shared/snapShot/snapShotTransitionGeometry";
import {
  beginSnapShotAnimationWhenReady,
  resolveExistingSnapShotTargetWith,
  resolveSnapShotDeliveryTarget,
  resolveSnapShotTargetOnce,
  type SnapShotCaptureTarget,
} from "@t3tools/web/src/components/desktop/SnapShotCoordinator.logic.ts";
import {
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "@t3tools/web/src/composerDraftStore.ts";
import { resolveThreadActionProjectRef } from "@t3tools/web/src/lib/chatThreadActions.ts";
import {
  dismissAllSnapShotAnimations,
  dismissSnapShotAnimation,
  finishSnapShotAnimation,
  getPendingSnapShotAnimations,
  pendingSnapShotAnimationIdsForTarget,
  trackSnapShotAnimationDestination,
  updateSnapShotAnimationSource,
  waitForSnapShotAnimationDestination,
} from "@t3tools/web/src/lib/snapShotAnimation.ts";
import { resizeSnapShotSource } from "@t3tools/web/src/lib/snapShotSource.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext, ThreadInput } from "./feature.ts";
import { composerInputService } from "./features/composerInput.ts";
import { defaultNewThreadProjectRef } from "./features/drafts.ts";
import {
  macAppIconDataUrl,
  macSnapShotImageCodec,
  openMacUrl,
  playMacSound,
  promptMacAccessibility,
  readMacSnapShotEnvironment,
  requestMacScreenRecording,
  type MacSnapShotEnvironment,
} from "./snapShotMac.ts";
import {
  cleanUpSnapShotPreviews,
  snapShotStateDirectory,
  writeSnapShotPreview,
} from "./snapShotPreviews.ts";
import { snapShotIconPath } from "./timelineUserRow.ts";

const FLASH_ANIMATION_DURATION_MS = 180;
const FLASH_STATIC_DURATION_MS = 60;
const LANDING_GRACE_MS = 500;
const MAC_PERMISSION_SETTINGS_URLS = {
  "screen-recording":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
} as const;
const REPO_ROOT = Path.resolve(import.meta.dirname, "../../..");
const SOUND_FILES: Record<SnapShotSound, string> = {
  "camera-shutter": Path.join(REPO_ROOT, "apps/web/src/assets/snap-shot-click.mp3"),
  "soft-pop": Path.join(REPO_ROOT, "apps/web/src/assets/snap-shot-whoosh.mp3"),
};

export type SnapShotFlashView = {
  readonly seq: number;
  readonly bounds: SnapShotRectangle;
  readonly animated: boolean;
  readonly durationMs: number;
};

export type SnapShotTransitionDetailsView = {
  readonly appName: string;
  readonly appInitial: string;
  readonly windowTitle: string;
  readonly appIconPath: string | null;
};

export type SnapShotTransitionDestinationView = {
  readonly frame: SnapShotRectangle;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderWidth: number;
  readonly cornerRadius: number;
  readonly scaleFactor: number;
  readonly durationMs: number;
};

export type SnapShotTransitionView = {
  readonly id: string;
  readonly source: SnapShotRectangle;
  readonly imagePath: string;
  readonly flash: boolean;
  readonly details: SnapShotTransitionDetailsView | null;
  readonly destination: SnapShotTransitionDestinationView | null;
};

/** What the native shell renders and registers on the core's behalf. */
export type SnapShotHostView = {
  readonly hotkey: string | null;
  readonly activateSeq: number;
  readonly flash: SnapShotFlashView | null;
  readonly transition: SnapShotTransitionView | null;
};

export type SnapShotService = {
  readonly stateAtom: Atom.Atom<DesktopSnapShotState | null>;
  readonly state: () => Promise<DesktopSnapShotState>;
  readonly previewSound: (sound: SnapShotSound) => void;
  readonly whenConfigured: () => Promise<void>;
  readonly requestPermissions: (includeAccessibility: boolean) => Promise<void>;
  readonly setup: (action: DesktopSnapShotSetupAction) => Promise<void>;
  readonly previewConfig: (
    request: DesktopCaptureConfigRequest,
  ) => Promise<DesktopCaptureConfigPreview | null>;
  readonly applyConfig: (previewId: string) => Promise<DesktopCaptureConfigApplied>;
  readonly checkShortcut: (
    shortcut: SnapShotShortcut,
  ) => Promise<DesktopSnapShotShortcutAvailability>;
  readonly setShortcutSuppressed: (suppressed: boolean) => Promise<void>;
  readonly capture: () => Promise<void>;
  readonly feature: CoreFeature;
};

const Rectangle = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const IncludeAccessibilityParams = Schema.decodeUnknownSync(
  Schema.Struct({ includeAccessibility: Schema.Boolean }),
);
const SetupParams = Schema.decodeUnknownSync(Schema.Struct({ action: DesktopSnapShotSetupAction }));
const ShortcutParams = Schema.decodeUnknownSync(Schema.Struct({ shortcut: SnapShotShortcut }));
const SuppressedParams = Schema.decodeUnknownSync(Schema.Struct({ suppressed: Schema.Boolean }));
const HotkeyParams = Schema.decodeUnknownSync(Schema.Struct({ accelerator: Schema.String }));
const IdParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const FocusParams = Schema.decodeUnknownSync(Schema.Struct({ focused: Schema.Boolean }));
const DestinationParams = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.String,
    frame: Rectangle,
    backgroundColor: Schema.String,
    borderColor: Schema.String,
    borderWidth: Schema.Number,
    cornerRadius: Schema.Number,
    scaleFactor: Schema.Number,
  }),
);

async function runEngine<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
}

function transitionDetails(details: SnapShotAnimationDetails): SnapShotTransitionDetailsView {
  return {
    appName: details.appName,
    appInitial: details.appName.slice(0, 1),
    windowTitle: details.windowTitle || "Captured window",
    appIconPath: snapShotIconPath(details.appIconDataUrl),
  };
}

const services = new WeakMap<FeatureContext, SnapShotService>();

/** The native app's snapshot host: the shared engine plus the composer delivery the web runs. */
export function snapShotService(context: FeatureContext): SnapShotService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const { registry } = context;
  const platform = process.platform;
  const captureDirectory = Path.join(snapShotStateDirectory(context), "native-snap-shots");
  const dataHome =
    process.env.XDG_DATA_HOME ?? Path.join(process.env.HOME ?? tmpdir(), ".local/share");

  const stateAtom = Atom.make<DesktopSnapShotState | null>(null).pipe(Atom.keepAlive);
  const hostAtom = Atom.make<SnapShotHostView>({
    hotkey: null,
    activateSeq: 0,
    flash: null,
    transition: null,
  }).pipe(Atom.keepAlive);
  const updateHost = (update: (current: SnapShotHostView) => SnapShotHostView) =>
    registry.set(hostAtom, update(registry.get(hostAtom)));

  let environment: MacSnapShotEnvironment | undefined;
  const refreshEnvironment = async () => {
    if (platform !== "darwin") return;
    environment = await readMacSnapShotEnvironment().catch(() => environment);
  };

  let flashSeq = 0;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const flash: SnapShotFlashFeedback = {
    showAnimated: async (bounds) => showFlash(bounds, true, FLASH_ANIMATION_DURATION_MS),
    showStatic: async (bounds) => showFlash(bounds, false, FLASH_STATIC_DURATION_MS),
    dispose: () => {
      clearTimeout(flashTimer);
      if (registry.get(hostAtom).flash !== null) updateHost((host) => ({ ...host, flash: null }));
    },
  };
  function showFlash(bounds: SnapShotRectangle, animated: boolean, durationMs: number) {
    flash.dispose();
    const seq = ++flashSeq;
    updateHost((host) => ({ ...host, flash: { seq, bounds, animated, durationMs } }));
    flashTimer = setTimeout(() => {
      if (registry.get(hostAtom).flash?.seq === seq) flash.dispose();
    }, durationMs);
  }

  type ActiveTransition = {
    readonly id: string;
    readonly source: SnapShotRectangle;
    readonly imagePath: string;
    readonly timer: ReturnType<typeof setTimeout>;
    details?: SnapShotAnimationDetails | undefined;
    flight?: Promise<void> | undefined;
    land?: (() => void) | undefined;
  };
  let activeTransition: ActiveTransition | undefined;
  const transition: SnapShotTransitionFeedback = {
    begin: async (id, source, snapshotDataUrl, showFlashOverlay) => {
      transition.dispose();
      const imagePath = Path.join(tmpdir(), `t3-snapshot-transition-${id}.png`);
      await writeFile(
        imagePath,
        Buffer.from(snapshotDataUrl.slice(snapshotDataUrl.indexOf(",") + 1), "base64"),
      );
      const active: ActiveTransition = {
        id,
        source,
        imagePath,
        timer: setTimeout(() => {
          if (activeTransition === active) transition.dispose();
        }, SNAP_SHOT_ANIMATION_TIMEOUT_MS),
      };
      activeTransition = active;
      updateHost((host) => ({
        ...host,
        transition: {
          id,
          source,
          imagePath,
          flash: showFlashOverlay,
          details: null,
          destination: null,
        },
      }));
    },
    animateTo: (id, destination) => {
      const active = activeTransition;
      if (!active || active.id !== id) return;
      if (destination.details) active.details = destination.details;
      const details = active.details ? transitionDetails(active.details) : null;
      if (active.flight) {
        if (destination.details) {
          updateHost((host) =>
            host.transition?.id === id
              ? { ...host, transition: { ...host.transition, details } }
              : host,
          );
        }
        return;
      }
      const durationMs = snapShotAnimationDurationMs(active.source, destination.frame);
      const landed = Promise.withResolvers<void>();
      active.land = landed.resolve;
      const fallback = setTimeout(landed.resolve, durationMs + LANDING_GRACE_MS);
      active.flight = landed.promise.finally(() => clearTimeout(fallback));
      updateHost((host) =>
        host.transition?.id === id
          ? {
              ...host,
              transition: {
                ...host.transition,
                details,
                destination: {
                  frame: destination.frame,
                  backgroundColor: destination.backgroundColor,
                  borderColor: destination.borderColor,
                  borderWidth: Math.max(0, destination.borderWidth),
                  cornerRadius: Math.max(0, destination.cornerRadius),
                  scaleFactor: Math.max(0.1, destination.scaleFactor),
                  durationMs,
                },
              },
            }
          : host,
      );
    },
    waitForLanding: async (id) => {
      const active = activeTransition;
      if (!active || active.id !== id) return;
      await active.flight;
    },
    complete: async (id) => {
      const active = activeTransition;
      if (!active || active.id !== id) return;
      await active.flight;
      if (activeTransition === active) transition.dispose();
    },
    dismiss: (id) => {
      if (activeTransition?.id === id) transition.dispose();
    },
    dispose: () => {
      const active = activeTransition;
      activeTransition = undefined;
      if (!active) return;
      clearTimeout(active.timer);
      active.land?.();
      updateHost((host) => ({ ...host, transition: null }));
      void rm(active.imagePath, { force: true });
    },
  };

  let hotkeyTrigger: (() => void) | undefined;

  const enginePromise: Promise<SnapShotEngine> = (async () => {
    setSnapShotImageCodec(macSnapShotImageCodec);
    await refreshEnvironment();
    const scope = await Effect.runPromise(Scope.make());
    return Effect.runPromise(
      makeSnapShotEngine<never>({
        platform,
        isPackaged: true,
        captureDirectory,
        linuxAppId: "com.t3tools.T3Code",
        gnomeSetupPaths: { bundle: Path.join(REPO_ROOT, "apps/desktop/gnome-extension"), dataHome },
        kdeCapturePaths: {
          bundle: Path.join(REPO_ROOT, "native/kde-snap-shot/target/release/t3-kde-snap-shot"),
          dataHome,
        },
        hyprlandCapturePaths: {
          bundle: Path.join(
            REPO_ROOT,
            "native/hyprland-snap-shot/target/release/t3-hyprland-snap-shot",
          ),
          dataHome,
        },
        accessibilityWorkerPath: Path.join(
          REPO_ROOT,
          "packages/shared/src/snapShot/SnapShotAccessibilityWorker.ts",
        ),
        regionWorkerPath: Path.join(
          REPO_ROOT,
          "packages/shared/src/snapShot/RegionSnapShotWorker.ts",
        ),
        flash,
        transition,
        activeWindow: (target) =>
          target === "darwin" ? macActiveWindow() : Promise.resolve(undefined),
        startPairShortcutProcess: (modifier, onTrigger, onFailure) =>
          platform === "darwin"
            ? startMacModifierPairShortcutProcess(modifier, onTrigger, onFailure)
            : Promise.reject(
                new Error("Modifier-pair shortcuts are not available in the native app yet."),
              ),
        registerGlobalShortcut: (accelerator, onTrigger) => {
          hotkeyTrigger = onTrigger;
          updateHost((host) => ({ ...host, hotkey: accelerator }));
          return true;
        },
        unregisterGlobalShortcut: (accelerator) => {
          if (registry.get(hostAtom).hotkey !== accelerator) return;
          hotkeyTrigger = undefined;
          updateHost((host) => ({ ...host, hotkey: null }));
        },
        systemAnimationsEnabled: () => environment?.reduceMotion !== true,
        captureBounds: (active) =>
          active?.bounds ?? environment?.primary ?? { x: 0, y: 0, width: 1, height: 1 },
        destinationWindow: () => undefined,
        pickSource: () =>
          Promise.reject(new Error("Choosing a window is not available in the native app yet.")),
        appIconDataUrl: async (_source, active) =>
          active?.owner.path ? macAppIconDataUrl(active.owner.path) : undefined,
        screenRecordingStatus: () =>
          environment?.screenRecording === true ? "granted" : "not-determined",
        accessibilityTrusted: (prompt) => {
          if (prompt) void promptMacAccessibility().then(refreshEnvironment, () => undefined);
          return environment?.accessibility === true;
        },
        promptScreenRecording: async () => {
          await requestMacScreenRecording();
          await refreshEnvironment();
        },
        openPermissionSettings: (permission) =>
          openMacUrl(MAC_PERMISSION_SETTINGS_URLS[permission]),
        permissionHelper: () => () => Effect.void,
        emit: (event) => Effect.sync(() => handleEvent(event)),
        activate: Effect.sync(() =>
          updateHost((host) => ({ ...host, activateSeq: host.activateSeq + 1 })),
        ),
        prepareCaptureReveal: Effect.void,
      }).pipe(Effect.provide(NodeServices.layer), Effect.provideService(Scope.Scope, scope)),
    );
  })();

  const withEngine = async <A, E>(
    operation: (engine: SnapShotEngine) => Effect.Effect<A, E>,
  ): Promise<A> => runEngine(operation(await enginePromise));

  const readState = async (): Promise<DesktopSnapShotState> => {
    const state = await withEngine((engine) => engine.state);
    registry.set(stateAtom, state);
    return state;
  };
  const refreshState = async (): Promise<DesktopSnapShotState> => {
    await refreshEnvironment();
    return readState();
  };

  const configure = async () => {
    await refreshEnvironment();
    await withEngine((engine) => engine.configure(registry.get(context.clientSettingsAtom)));
    await readState();
  };
  let configured = configure().catch(() => undefined);
  registry.subscribe(context.clientSettingsAtom, () => {
    configured = configured.then(configure).catch(() => undefined);
  });

  const routeThreadRef = (input: ThreadInput | null): ScopedThreadRef | null =>
    input !== null && input.isServerThread ? input.route : null;
  const routeTarget = (input: ThreadInput | null): SnapShotCaptureTarget | null =>
    routeThreadRef(input) ?? input?.draftId ?? null;
  const readThreadShell = (ref: ScopedThreadRef) =>
    registry.get(context.state.environmentThreadShells.threadShellAtom(ref));
  const resolveExisting = (target: SnapShotCaptureTarget) =>
    resolveExistingSnapShotTargetWith(
      target,
      routeThreadRef(registry.get(context.threadInputAtom)),
      readThreadShell,
    );

  let lastTarget: SnapShotCaptureTarget | null = routeTarget(registry.get(context.threadInputAtom));
  const landingIds = new Set<string>();
  registry.subscribe(context.threadInputAtom, (input) => {
    const current = routeTarget(input);
    if (current) lastTarget = current;
    const pending = getPendingSnapShotAnimations();
    const visible = new Set(current ? pendingSnapShotAnimationIdsForTarget(pending, current) : []);
    for (const id of landingIds) {
      landingIds.delete(id);
      if (!visible.has(id) && pending.some((animation) => animation.id === id)) {
        dismissNativeAnimation(id);
      }
    }
    for (const id of visible) landingIds.add(id);
  });
  const captureTargets = new Map<string, Promise<SnapShotCaptureTarget | null>>();
  const targetResolution: { current: Promise<SnapShotCaptureTarget | null> | null } = {
    current: null,
  };
  const soundedIds = new Set<string>();
  const pendingAnimationStarts = new Set<string>();
  let draining: Promise<void> | null = null;
  let rerunRequested = false;

  const resolveTarget = async (): Promise<SnapShotCaptureTarget | null> => {
    if (lastTarget) {
      const existingTarget = resolveExisting(lastTarget);
      if (existingTarget) {
        lastTarget = existingTarget;
        return existingTarget;
      }
      lastTarget = null;
    }
    const input = registry.get(context.threadInputAtom);
    const projectRef = resolveThreadActionProjectRef({
      activeDraftThread: input?.draftThread ?? null,
      activeThread: input !== null && input.isServerThread ? input.thread : undefined,
      defaultProjectRef: defaultNewThreadProjectRef(context),
    });
    if (!projectRef) return null;
    const created = await context.openNewThread(projectRef);
    if (!created) return null;
    lastTarget = created.draftId;
    return created.draftId;
  };
  const resolveCaptureTarget = () => resolveSnapShotTargetOnce(targetResolution, resolveTarget);

  const playCaptureSound = (id: string) => {
    const settings = registry.get(context.clientSettingsAtom);
    if (!settings.snapShotPlaySound || soundedIds.has(id) || platform !== "darwin") return;
    soundedIds.add(id);
    playMacSound(SOUND_FILES[settings.snapShotSound]);
  };

  const dismissNativeAnimation = (id: string) => {
    void dismissSnapShotAnimation(id);
    void withEngine((engine) => engine.dismissAnimation(id)).catch(() => undefined);
  };
  const dismissAllNativeAnimations = () => {
    const ids = getPendingSnapShotAnimations().map((animation) => animation.id);
    dismissAllSnapShotAnimations();
    for (const id of ids) {
      void withEngine((engine) => engine.dismissAnimation(id)).catch(() => undefined);
    }
  };

  const failureToast = (description: string) =>
    context.addToast({ layout: "stacked", type: "error", title: "Snapshot failed", description });

  const deliver = async (
    engine: SnapShotEngine,
    item: DesktopPendingSnapShot,
    target: SnapShotCaptureTarget,
  ) => {
    const store = useComposerDraftStore.getState();
    updateSnapShotAnimationSource(item.id, item.source);
    const capture = await runEngine(engine.read(item.id));
    const bytes = Buffer.from(capture.dataUrl.slice(capture.dataUrl.indexOf(",") + 1), "base64");
    if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      finishSnapShotAnimation(item.id);
      throw new Error(
        "The captured window needs compression, which is not available in the native app yet.",
      );
    }
    const file = new File([bytes], capture.name, { type: capture.mimeType });
    const source = resizeSnapShotSource(capture.source);
    const previewUrl = writeSnapShotPreview(context, capture.id, bytes);
    const alreadyAttached =
      store.getComposerDraft(target)?.images.some(({ id }) => id === capture.id) ?? false;
    if (
      !alreadyAttached &&
      !store.addImage(target, {
        type: "image",
        id: capture.id,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl,
        file,
        source,
      })
    ) {
      throw new Error("Remove an attachment, then try this capture again.");
    }
    const persisted: PersistedComposerImageAttachment = {
      id: capture.id,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      dataUrl: capture.dataUrl,
      source,
    };
    const persistedAttachments =
      store
        .getComposerDraft(target)
        ?.persistedAttachments.filter((attachment) => attachment.id !== capture.id) ?? [];
    await store.syncPersistedAttachments(target, [...persistedAttachments, persisted]);
    if (!store.getComposerDraft(target)?.persistedAttachments.some(({ id }) => id === capture.id)) {
      throw new Error("The captured window could not be saved to the draft.");
    }
    const current = routeTarget(registry.get(context.threadInputAtom));
    if (
      current !== null &&
      (typeof current === "string" || typeof target === "string"
        ? current === target
        : current.environmentId === target.environmentId && current.threadId === target.threadId)
    ) {
      composerInputService(context).startUploads();
    }
    if (getPendingSnapShotAnimations().some((animation) => animation.id === capture.id)) {
      await waitForSnapShotAnimationDestination(capture.id).catch(() => undefined);
      finishSnapShotAnimation(capture.id);
    }
    await runEngine(engine.acknowledge(capture.id));
    composerInputService(context).focus();
  };

  const drain = (): Promise<void> => {
    if (draining) {
      rerunRequested = true;
      return draining;
    }
    const operation = (async () => {
      const engine = await enginePromise;
      do {
        rerunRequested = false;
        const pending = await runEngine(engine.listPending);
        for (const item of pending) {
          playCaptureSound(item.id);
          const capturedTarget = await resolveSnapShotDeliveryTarget(
            captureTargets,
            item.id,
            resolveCaptureTarget,
          );
          const target = capturedTarget ? resolveExisting(capturedTarget) : null;
          if (!target) {
            dismissNativeAnimation(item.id);
            soundedIds.delete(item.id);
            context.addToast({
              layout: "stacked",
              type: "error",
              title: "Snapshot taken, but no project is available",
              description: "Add a project, then capture the window again.",
            });
            continue;
          }
          try {
            await deliver(engine, item, target);
            captureTargets.delete(item.id);
            soundedIds.delete(item.id);
          } catch (error) {
            dismissNativeAnimation(item.id);
            soundedIds.delete(item.id);
            failureToast(
              `Capture ${item.id}: ${error instanceof Error ? error.message : "Try the capture again."}`,
            );
          }
        }
      } while (rerunRequested);
    })()
      .catch((error: unknown) => {
        dismissAllNativeAnimations();
        failureToast(error instanceof Error ? error.message : "Try the capture again.");
      })
      .finally(() => {
        draining = null;
      });
    draining = operation;
    return operation;
  };

  function handleEvent(event: DesktopSnapShotEvent) {
    switch (event.type) {
      case "requested": {
        const current = lastTarget;
        const target = current ? resolveExisting(current) : null;
        if (target) {
          void resolveSnapShotDeliveryTarget(captureTargets, event.id, () =>
            Promise.resolve(target),
          );
        }
        return;
      }
      case "started": {
        playCaptureSound(event.id);
        if (
          registry.get(context.clientSettingsAtom).snapShotAnimations &&
          environment?.reduceMotion !== true
        ) {
          void beginSnapShotAnimationWhenReady(
            event.id,
            resolveSnapShotDeliveryTarget(captureTargets, event.id, resolveCaptureTarget),
            pendingAnimationStarts,
          );
        }
        return;
      }
      case "ready":
        void drain();
        return;
      case "failed": {
        if (event.id) {
          captureTargets.delete(event.id);
          pendingAnimationStarts.delete(event.id);
          soundedIds.delete(event.id);
          dismissNativeAnimation(event.id);
        } else {
          pendingAnimationStarts.clear();
          soundedIds.clear();
          dismissAllNativeAnimations();
        }
        void refreshState().then(
          (state) => failureToast(state.message ?? "Try the capture again."),
          () => failureToast("Try the capture again."),
        );
        return;
      }
      case "shortcut-changed":
        void refreshState().catch(() => undefined);
        return;
    }
  }

  cleanUpSnapShotPreviews(context);
  void configured.then(drain);

  const service: SnapShotService = {
    stateAtom,
    state: refreshState,
    previewSound: (sound) => {
      if (platform === "darwin") playMacSound(SOUND_FILES[sound]);
    },
    whenConfigured: () => configured,
    requestPermissions: async (includeAccessibility) => {
      await withEngine((engine) => engine.requestPermissions(includeAccessibility));
      await refreshState();
    },
    setup: async (action) => {
      await refreshEnvironment();
      try {
        await withEngine((engine) => engine.setup(action));
      } finally {
        await refreshState().catch(() => undefined);
      }
    },
    previewConfig: (request) => withEngine((engine) => engine.previewConfig(request)),
    applyConfig: (previewId) => withEngine((engine) => engine.applyConfig(previewId)),
    checkShortcut: (shortcut) => withEngine((engine) => engine.checkShortcut(shortcut)),
    setShortcutSuppressed: (suppressed) =>
      withEngine((engine) => engine.setShortcutSuppressed(suppressed)),
    capture: () => withEngine((engine) => engine.capture),
    feature: {
      views: {
        snapShotHost: hostAtom,
        snapShotState: stateAtom,
      },
      actions: {
        snapShotState: async () => refreshState(),
        snapShotRequestPermissions: async (params) =>
          service.requestPermissions(IncludeAccessibilityParams(params).includeAccessibility),
        snapShotSetup: async (params) => service.setup(SetupParams(params).action),
        snapShotCheckShortcut: async (params) =>
          service.checkShortcut(ShortcutParams(params).shortcut),
        snapShotSetShortcutSuppressed: async (params) =>
          service.setShortcutSuppressed(SuppressedParams(params).suppressed),
        snapShotCapture: async () => {
          await service.capture().catch(() => undefined);
          return null;
        },
        snapShotHotkeyPressed: async (params) => {
          const { accelerator } = HotkeyParams(params);
          if (registry.get(hostAtom).hotkey === accelerator) hotkeyTrigger?.();
          return null;
        },
        snapShotTransitionLanded: async (params) => {
          const { id } = IdParams(params);
          if (activeTransition?.id === id) activeTransition.land?.();
          return null;
        },
        snapShotAnimationDestination: async (params) => {
          const destination = DestinationParams(params);
          if (
            destination.frame.width <= 0 ||
            destination.frame.height <= 0 ||
            destination.borderWidth < 0 ||
            destination.cornerRadius < 0
          ) {
            return null;
          }
          const source = getPendingSnapShotAnimations().find(
            (animation) => animation.id === destination.id,
          )?.source;
          const animationDestination: SnapShotAnimationDestination = {
            frame: destination.frame,
            backgroundColor: destination.backgroundColor,
            borderColor: destination.borderColor,
            borderWidth: destination.borderWidth,
            cornerRadius: destination.cornerRadius,
            scaleFactor: destination.scaleFactor,
            ...(source
              ? {
                  details: {
                    appName: source.appName,
                    windowTitle: source.windowTitle,
                    ...(source.appIconDataUrl ? { appIconDataUrl: source.appIconDataUrl } : {}),
                  },
                }
              : {}),
          };
          landingIds.add(destination.id);
          trackSnapShotAnimationDestination(
            destination.id,
            withEngine((engine) =>
              engine.setAnimationDestination(destination.id, animationDestination),
            ).catch(() => undefined),
          );
          return null;
        },
        snapShotWindowFocus: async (params) => {
          if (FocusParams(params).focused) {
            void drain();
          } else {
            pendingAnimationStarts.clear();
            dismissAllNativeAnimations();
          }
          return null;
        },
      },
    },
  };
  services.set(context, service);
  return service;
}

export function createSnapShotFeature(context: FeatureContext): CoreFeature {
  return snapShotService(context).feature;
}
