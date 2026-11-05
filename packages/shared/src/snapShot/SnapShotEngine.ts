// @effect-diagnostics globalTimers:off -- Capture timeouts run at native callback boundaries outside Effect fibers.

import {
  DEFAULT_CLIENT_SETTINGS,
  DesktopPendingSnapShot,
  isModifierPairShortcut,
  snapShotModifierPairLabel,
  snapShotShortcutModifierPair,
  type DesktopSnapShot as DesktopSnapShotValue,
  type DesktopSnapShotShortcutAvailability,
  type DesktopSnapShotState,
  DesktopSnapShotSetupAction,
  type DesktopCaptureConfigRequest,
  type DesktopCaptureConfigPreview,
  type DesktopCaptureConfigApplied,
  type ClientSettings,
  type SnapShotModifier,
  type SnapShotModifierPairShortcut,
  type SnapShotShortcut,
  type DesktopSnapShotEvent,
  type DesktopSnapShotId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import type { ActiveWindow } from "./ActiveWindow.ts";
import { captureMacWindowSnapshot } from "./MacSnapShot.ts";
import type { LinuxCaptureFeedback, LinuxWindowMetadata } from "./LinuxSnapShot.ts";
import { niriSocketPath } from "./NiriSnapShot.ts";
import { CaptureShortcutConfig, niriCaptureConfigPath } from "./CaptureShortcutConfig.ts";
import type { PortalCaptureShortcut } from "./PortalCaptureShortcut.ts";
import {
  isGnomeCaptureSession,
  niriCaptureBinding,
  portalShortcutTrigger,
} from "./linuxCaptureSession.ts";
import {
  HyprlandCaptureSetup,
  isHyprlandCaptureSession,
  hyprlandCaptureShortcut,
  type HyprlandCapturePaths,
} from "./HyprlandSnapShot.ts";
import { KdeCaptureSetup, isKdeCaptureSession, type KdeCapturePaths } from "./KdeSnapShot.ts";
import { captureRegionWindowSnapshot, makeRegionSnapShotPool } from "./RegionSnapShot.ts";
import type { SnapShotAnimationDestination } from "./snapShotTransitionGeometry.ts";
import { makeSnapShotAccessibilityProcessPool } from "./SnapShotAccessibilityProcess.ts";
import { snapShotImageCodec, type SnapShotRectangle, type SnapShotSize } from "./snapShotImage.ts";

import {
  boundedSnapShotString,
  isWaylandSession,
  sameSnapShotShortcut,
  toElectronAccelerator,
  snapShotShortcutRegistrationFailureMessage,
  snapShotShortcutSystemConflict,
} from "./snapShot.ts";

const MAX_CAPTURE_WIDTH = 2_560;
const MAX_CAPTURE_HEIGHT = 1_600;
const SHORTCUT_COOLDOWN_NS = 200_000_000n;
const WAYLAND_MODIFIER_PAIR_UNAVAILABLE_MESSAGE =
  "Modifier-pair shortcuts aren't available in this Wayland session. Choose another shortcut or use Take snapshot from the command palette.";
const MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE =
  "Allow Screen Recording in System Settings, then restart T3 Code.";
const MAC_ACCESSIBILITY_PERMISSION_MESSAGE =
  "Allow Accessibility in System Settings, then restart T3 Code.";
const MAC_BOTH_PERMISSIONS_MESSAGE =
  "Allow Accessibility and Screen Recording in System Settings, then restart T3 Code.";
const MAC_PERMISSION_MESSAGES = new Set([
  MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE,
  MAC_ACCESSIBILITY_PERMISSION_MESSAGE,
  MAC_BOTH_PERMISSIONS_MESSAGE,
]);

const decodePendingCapture = Schema.decodeUnknownEffect(DesktopPendingSnapShot);

const PendingCaptureJson = Schema.fromJsonString(DesktopPendingSnapShot);
const decodePendingCaptureJson = Schema.decodeEffect(PendingCaptureJson);
const encodePendingCaptureJson = Schema.encodeEffect(PendingCaptureJson);
const DesktopSnapShotOperation = Schema.Literals([
  "list-pending",
  "read",
  "acknowledge",
  "unsupported",
  "disabled",
  "no-window-selected",
  "window-unavailable",
  "capture",
]);

export class DesktopSnapShotError extends Schema.TaggedError<DesktopSnapShotError>()(
  "DesktopSnapShotError",
  {
    operation: DesktopSnapShotOperation,
    captureId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.operation) {
      case "list-pending":
        return "Could not list pending snapshots.";
      case "read":
        return "Could not read the snapshot.";
      case "acknowledge":
        return "Could not remove the snapshot.";
      case "unsupported":
        return "SnapShots are not supported here.";
      case "disabled":
        return "Enable SnapShots in Settings first.";
      case "no-window-selected":
        return "No window was selected.";
      case "window-unavailable":
        return "The active window is not available for capture.";
      case "capture":
        return "Could not capture the active window.";
    }
  }
}

const isDesktopSnapShotError = Schema.is(DesktopSnapShotError);

function captureFailure(cause: unknown, captureId?: string): DesktopSnapShotError {
  return isDesktopSnapShotError(cause)
    ? cause
    : new DesktopSnapShotError({ operation: "capture", captureId, cause });
}

export class DesktopSnapShotSetupError extends Schema.TaggedError<DesktopSnapShotSetupError>()(
  "DesktopSnapShotSetupError",
  {
    action: Schema.Union([
      DesktopSnapShotSetupAction,
      Schema.Literals(["preview-config", "apply-config"]),
    ]),
    reason: Schema.Literals(["unsupported-session", "setup-failed", "shortcut-permissions"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    if (this.action === "preview-config" || this.action === "apply-config") {
      if (this.reason === "unsupported-session")
        return "Config setup requires a Niri or Hyprland session.";
      return this.action === "preview-config"
        ? "Couldn't prepare your capture shortcut changes."
        : "Couldn't save your capture shortcut.";
    }
    const kde = this.action === "install-kde-helper" || this.action === "remove-kde-helper";
    const hyprland =
      this.action === "install-hyprland-helper" || this.action === "remove-hyprland-helper";
    if (this.reason === "unsupported-session")
      return hyprland
        ? "Helper setup requires a Hyprland Wayland session outside a sandbox."
        : kde
          ? "Helper setup requires a KDE Plasma Wayland session outside a sandbox."
          : "Extension setup requires a GNOME Wayland session outside a sandbox.";
    if (this.reason === "shortcut-permissions") return "Could not open shortcut permissions.";
    return hyprland
      ? "Could not set up Hyprland capture."
      : kde
        ? "Could not set up KDE capture."
        : "Could not set up the GNOME extension.";
  }
}

/** The snapshot service every host exposes; desktop and the native app share it. */
export type SnapShotEngine = {
  readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
  readonly requestPermissions: (includeAccessibility: boolean) => Effect.Effect<void>;
  readonly state: Effect.Effect<DesktopSnapShotState>;
  readonly setup: (
    action: DesktopSnapShotSetupAction,
  ) => Effect.Effect<void, DesktopSnapShotSetupError>;
  readonly previewConfig: (
    request: DesktopCaptureConfigRequest,
    selectedPath?: string,
  ) => Effect.Effect<DesktopCaptureConfigPreview, DesktopSnapShotSetupError>;
  readonly applyConfig: (
    previewId: string,
  ) => Effect.Effect<DesktopCaptureConfigApplied, DesktopSnapShotSetupError>;
  readonly checkShortcut: (
    shortcut: SnapShotShortcut,
  ) => Effect.Effect<DesktopSnapShotShortcutAvailability>;
  readonly setShortcutSuppressed: (suppressed: boolean) => Effect.Effect<void>;
  /** Capture the foreground window in place, including T3 Code itself. */
  readonly capture: Effect.Effect<void, DesktopSnapShotError>;
  readonly listPending: Effect.Effect<ReadonlyArray<DesktopPendingSnapShot>, DesktopSnapShotError>;
  readonly read: (id: string) => Effect.Effect<DesktopSnapShotValue, DesktopSnapShotError>;
  readonly setAnimationDestination: (
    id: string,
    destination: SnapShotAnimationDestination,
  ) => Effect.Effect<void>;
  readonly dismissAnimation: (id: string) => Effect.Effect<void>;
  readonly acknowledge: (id: string) => Effect.Effect<void, DesktopSnapShotError>;
};

export type SnapShotMacPermission = "screen-recording" | "accessibility";

export type SnapShotCapturedSource<Icon> = {
  readonly name: string;
  readonly appIcon?: Icon | null | undefined;
};

/** The white flash shown over a captured window when the flight animation does not run. */
export type SnapShotFlashFeedback = {
  readonly showAnimated: (bounds: SnapShotRectangle) => Promise<void>;
  readonly showStatic: (bounds: SnapShotRectangle) => Promise<void>;
  readonly dispose: () => void;
};

/** The overlay that flies a capture from its window into the composer. */
export type SnapShotTransitionFeedback = {
  readonly begin: (
    id: string,
    source: SnapShotRectangle,
    snapshotDataUrl: string,
    flash: boolean,
    destinationWindowBounds?: SnapShotRectangle,
  ) => Promise<void>;
  readonly animateTo: (id: string, destination: SnapShotAnimationDestination) => void;
  readonly waitForLanding: (id: string) => Promise<void>;
  readonly complete: (id: string) => Promise<void>;
  readonly dismiss: (id: string) => void;
  readonly dispose: () => void;
};

/** The app window a capture is delivered to. */
export type SnapShotDestinationWindow = {
  readonly bounds: SnapShotRectangle | undefined;
  /** Restore and show the window for compositor feedback; its title, or `undefined` once gone. */
  readonly reveal: () => string | undefined;
};

/** Everything the engine needs from the app shell it runs in. */
export type SnapShotHost<Icon> = {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly captureDirectory: string;
  readonly linuxAppId: string;
  readonly gnomeSetupPaths: { readonly bundle: string; readonly dataHome: string };
  readonly kdeCapturePaths: KdeCapturePaths;
  readonly hyprlandCapturePaths: HyprlandCapturePaths;
  readonly accessibilityWorkerPath: string;
  readonly regionWorkerPath: string;
  readonly flash: SnapShotFlashFeedback;
  readonly transition: SnapShotTransitionFeedback;
  readonly activeWindow: (platform: NodeJS.Platform) => Promise<ActiveWindow | undefined>;
  readonly startPairShortcutProcess: (
    modifier: SnapShotModifier,
    onTrigger: () => void,
    onFailure: (error: Error) => void,
  ) => Promise<() => void>;
  readonly registerGlobalShortcut: (accelerator: string, onTrigger: () => void) => boolean;
  readonly unregisterGlobalShortcut: (accelerator: string) => void;
  /** Whether the OS asks for rich motion (not reduced motion). */
  readonly systemAnimationsEnabled: () => boolean;
  /** Screen bounds the capture feedback covers; the primary display when nothing is active. */
  readonly captureBounds: (active: ActiveWindow | undefined) => SnapShotRectangle;
  readonly destinationWindow: () => SnapShotDestinationWindow | undefined;
  /** The OS window picker, used when no compositor capture backend is available. */
  readonly pickSource: (
    maxSize: SnapShotSize,
  ) => Promise<{ readonly source: SnapShotCapturedSource<Icon>; readonly png: Buffer } | undefined>;
  readonly appIconDataUrl: (
    source: SnapShotCapturedSource<Icon>,
    active: ActiveWindow | undefined,
  ) => Promise<string | undefined>;
  readonly screenRecordingStatus: () => string;
  readonly accessibilityTrusted: (prompt: boolean) => boolean;
  /** Ask the OS to show its Screen Recording prompt; settles once the prompt was requested. */
  readonly promptScreenRecording: () => Promise<void>;
  readonly openPermissionSettings: (permission: SnapShotMacPermission) => Promise<void>;
  /** Pins the window that owns a permission helper, then shows the helper for one permission. */
  readonly permissionHelper: () => (permission: SnapShotMacPermission) => Effect.Effect<void>;
  readonly emit: (event: DesktopSnapShotEvent) => Effect.Effect<void>;
  /** Bring the app window forward after a capture that did not animate into it. */
  readonly activate: Effect.Effect<void>;
  readonly prepareCaptureReveal: Effect.Effect<void>;
};

export function snapShotCaptureMode(platform: NodeJS.Platform): DesktopSnapShotState["mode"] {
  if (platform === "linux")
    return isWaylandSession(platform, process.env) ? "portal" : "unavailable";
  return platform === "darwin" || platform === "win32" ? "direct" : "unavailable";
}

export function snapShotThumbnailSize(active: ActiveWindow | undefined): SnapShotSize {
  if (!active) return { width: 2_560, height: 1_600 };
  return {
    width: Math.min(Math.max(active.bounds.width, 1), MAX_CAPTURE_WIDTH),
    height: Math.min(Math.max(active.bounds.height, 1), MAX_CAPTURE_HEIGHT),
  };
}

function snapShotAppName(
  active: ActiveWindow | undefined,
  linuxWindow: LinuxWindowMetadata | undefined,
  sourceName: string,
): string {
  const appName =
    active?.owner.name.trim() || linuxWindow?.appName.trim() || sourceName.trim() || "Window";
  if (active?.platform !== "windows") return appName;
  return appName.replace(/\.exe$/i, "").trim() || appName;
}

export function macSnapShotPermissionMessage(
  permissions: NonNullable<DesktopSnapShotState["macPermissions"]>,
  includeAccessibility: boolean,
): string | null {
  const accessibilityGranted = !includeAccessibility || permissions.accessibility;
  if (!accessibilityGranted && !permissions.screenRecording) {
    return MAC_BOTH_PERMISSIONS_MESSAGE;
  }
  if (!accessibilityGranted) {
    return MAC_ACCESSIBILITY_PERMISSION_MESSAGE;
  }
  return permissions.screenRecording ? null : MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE;
}

function snapShotImageSize(png: Buffer, fallback: SnapShotRectangle): SnapShotSize {
  try {
    const image = snapShotImageCodec().open(png);
    if (image && image.width > 0 && image.height > 0) {
      return { width: image.width, height: image.height };
    }
  } catch {}
  return {
    width: Math.max(1, Math.round(fallback.width)),
    height: Math.max(1, Math.round(fallback.height)),
  };
}

function observedPairMessage(
  shortcut: SnapShotModifierPairShortcut,
  platform: NodeJS.Platform,
): string {
  const modifier = snapShotShortcutModifierPair(shortcut);
  const label = snapShotModifierPairLabel(modifier, platform === "darwin");
  const base = `${label} is observed and cannot be reserved exclusively.`;
  if (modifier === "meta" && platform !== "darwin") {
    return `${base} This key can also open the system's own menu.`;
  }
  if (modifier === "alt" && platform === "win32") {
    return `${base} This key can also activate app menu bars.`;
  }
  return base;
}

export function makeSnapShotEngine<Icon>(
  host: SnapShotHost<Icon>,
): Effect.Effect<
  SnapShotEngine,
  never,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
> {
  return Effect.gen(function* () {
    const { platform, flash, transition, linuxAppId, captureDirectory } = host;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const settingsRef = yield* Ref.make(DEFAULT_CLIENT_SETTINGS);
    const stateRef = yield* Ref.make<DesktopSnapShotState>({
      mode: snapShotCaptureMode(platform),
      shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
      shortcutRegistered: false,
      shortcutMessage: null,
      message: null,
    });
    const snapshotMutex = yield* Semaphore.make(1);
    const configurationMutex = yield* Semaphore.make(1);
    const context = yield* Effect.context<FileSystem.FileSystem>();
    const runPromise = Effect.runPromiseWith(context);
    let shortcutVerified = false;
    const { gnomeSetupPaths, kdeCapturePaths, hyprlandCapturePaths } = host;
    const hasGnomeSetup = () =>
      snapShotCaptureMode(platform) === "portal" && isGnomeCaptureSession(process.env);
    const shortcutConfig = new CaptureShortcutConfig();
    const accessibilityProcessPool = makeSnapShotAccessibilityProcessPool(
      host.accessibilityWorkerPath,
    );
    const regionSnapShotPool = makeRegionSnapShotPool(host.regionWorkerPath);
    let registeredAccelerator: string | undefined;
    // False until the first applySettings; the first pass must always register.
    let initialized = false;
    let portalShortcut: PortalCaptureShortcut | undefined;
    let shortcutGeneration = 0;
    let shortcutSuppressed = false;
    let lastShortcutAt: bigint | undefined;
    let stopShiftShortcut: (() => void) | undefined;
    let linuxFeedback: { id: string; feedback: LinuxCaptureFeedback } | undefined;
    const closeLinuxFeedback = (id?: string) => {
      if (!linuxFeedback || (id !== undefined && linuxFeedback.id !== id)) return;
      linuxFeedback.feedback.close();
      linuxFeedback = undefined;
    };
    const completeLinuxFeedback = async (id: string) => {
      if (linuxFeedback?.id !== id) return;
      const pending = linuxFeedback;
      await pending.feedback.complete().catch(() => undefined);
      if (linuxFeedback === pending) linuxFeedback = undefined;
    };

    const animationsEnabled = (settings: ClientSettings) =>
      settings.snapShotAnimations && host.systemAnimationsEnabled();

    const requestMacScreenCapturePermission = async (): Promise<string | null> => {
      let status: string;
      try {
        status = host.screenRecordingStatus();
        if (status === "granted") return null;
        if (status === "not-determined") {
          try {
            await host.promptScreenRecording();
          } catch {}
          status = host.screenRecordingStatus();
          if (status === "granted") return null;
        }
      } catch {}
      await host.openPermissionSettings("screen-recording").catch(() => undefined);
      return MAC_SCREEN_CAPTURE_PERMISSION_MESSAGE;
    };

    const currentMacPermissions = (): NonNullable<DesktopSnapShotState["macPermissions"]> => ({
      screenRecording: host.screenRecordingStatus() === "granted",
      accessibility: host.accessibilityTrusted(false),
    });

    const currentMacSnapShotPermissionMessage = (includeAccessibility: boolean): string | null =>
      macSnapShotPermissionMessage(
        {
          screenRecording: host.screenRecordingStatus() === "granted",
          accessibility: !includeAccessibility || host.accessibilityTrusted(false),
        },
        includeAccessibility,
      );

    const requestMacSnapShotPermissions = async (
      includeAccessibility: boolean,
    ): Promise<string | null> => {
      const accessibilityGranted = !includeAccessibility || host.accessibilityTrusted(true);
      const screenMessage = await requestMacScreenCapturePermission();
      if (!accessibilityGranted && screenMessage) {
        return MAC_BOTH_PERMISSIONS_MESSAGE;
      }
      if (!accessibilityGranted) {
        return MAC_ACCESSIBILITY_PERMISSION_MESSAGE;
      }
      return screenMessage;
    };

    const showCaptureFeedback = async (
      captureId: string,
      snapshotDataUrl: string,
      settings: ClientSettings,
      active: ActiveWindow | undefined,
      destinationWindowBounds?: SnapShotRectangle,
    ): Promise<boolean> => {
      // Wayland does not let this client position overlays on another app's window.
      if (platform === "linux") return false;
      const bounds = host.captureBounds(active);
      const animated = animationsEnabled(settings);
      if (animated) {
        try {
          await transition.begin(
            captureId,
            bounds,
            snapshotDataUrl,
            settings.snapShotFlash,
            destinationWindowBounds,
          );
          return true;
        } catch {
          transition.dispose();
        }
      }
      if (!settings.snapShotFlash) return false;
      const playback = animated ? flash.showAnimated(bounds) : flash.showStatic(bounds);
      await playback.catch(() => undefined);
      return false;
    };

    const captureSource = async ({
      mode,
      captureId,
      settings,
      imageTempPath,
    }: {
      mode: DesktopSnapShotState["mode"];
      captureId: string;
      settings: ClientSettings;
      imageTempPath: string;
    }) => {
      let active: ActiveWindow | undefined;
      let linuxWindow: LinuxWindowMetadata | undefined;
      let capturedLinuxFeedback: LinuxCaptureFeedback | undefined;
      let linuxActivationFailure: { readonly cause: unknown } | undefined;
      const destinationWindow = host.destinationWindow();
      const destinationWindowBounds = destinationWindow?.bounds;
      const revealPreparation =
        platform === "win32"
          ? runPromise(host.prepareCaptureReveal).catch(() => undefined)
          : Promise.resolve();
      if (mode === "direct") {
        active = await host.activeWindow(platform);
      }

      let source: SnapShotCapturedSource<Icon>;
      let png: Buffer;
      let imageTempReady = false;
      if (platform === "darwin") {
        if (!active) {
          throw new DesktopSnapShotError({ operation: "window-unavailable", captureId });
        }
        ({ source, png } = await captureMacWindowSnapshot(
          active,
          imageTempPath,
          snapShotThumbnailSize(active),
        ));
        imageTempReady = true;
      } else if (mode === "direct") {
        if (!active) {
          throw new DesktopSnapShotError({ operation: "window-unavailable", captureId });
        }
        ({ source, png } = await captureRegionWindowSnapshot(
          regionSnapShotPool,
          active,
          host.captureBounds(active),
          snapShotThumbnailSize(active),
        ));
      } else {
        const { captureLinuxWindow } = await import("./LinuxSnapShot.ts");
        const snapshot = await captureLinuxWindow(
          linuxAppId,
          {
            flash: settings.snapShotFlash,
            animate: animationsEnabled(settings),
          },
          kdeCapturePaths,
          hyprlandCapturePaths,
        );
        if (snapshot) {
          capturedLinuxFeedback = snapshot.feedback;
          if (capturedLinuxFeedback)
            linuxFeedback = { id: captureId, feedback: capturedLinuxFeedback };
          linuxWindow = snapshot.window;
          source = { name: linuxWindow?.title || "Active window" };
          png = snapshot.png;
        } else {
          const selected = await host.pickSource(snapShotThumbnailSize(active));
          if (!selected) {
            throw new DesktopSnapShotError({
              operation: "no-window-selected",
              captureId,
            });
          }
          ({ source, png } = selected);
        }
      }
      const accessibleIdentity = active
        ? { ...active, bounds: host.captureBounds(active) }
        : linuxWindow?.processId
          ? {
              title: linuxWindow.title,
              bounds: linuxWindow.bounds,
              ...(linuxWindow.clientBounds ? { clientBounds: linuxWindow.clientBounds } : {}),
              owner: { processId: linuxWindow.processId },
              ...(linuxWindow.accessibilityBoundsReliable === false
                ? { accessibilityBoundsReliable: false }
                : {}),
            }
          : undefined;
      const accessibilityRead =
        accessibleIdentity && settings.snapShotIncludeAccessibility
          ? accessibilityProcessPool.read({
              active: accessibleIdentity,
              platform,
              sourceTitle: source.name,
              imageSize: snapShotImageSize(png, active?.bounds ?? accessibleIdentity.bounds),
            })
          : undefined;
      if (accessibilityRead) {
        await accessibilityRead.started;
      }
      const contextPromise = accessibilityRead?.result ?? Promise.resolve(undefined);
      await revealPreparation;
      if (capturedLinuxFeedback && destinationWindow) {
        const title = destinationWindow.reveal();
        if (title !== undefined) {
          await capturedLinuxFeedback.activate(title).catch((cause: unknown) => {
            linuxActivationFailure = { cause };
          });
        }
      }
      const animationStarted =
        capturedLinuxFeedback?.animationStarted ??
        (await showCaptureFeedback(
          captureId,
          `data:image/png;base64,${png.toString("base64")}`,
          settings,
          active,
          destinationWindowBounds,
        ));
      return {
        source,
        active,
        linuxWindow,
        linuxActivationFailure,
        contextPromise,
        animationStarted,
        png,
        imageTempReady,
      };
    };

    const startPairShortcutProcess = host.startPairShortcutProcess;

    const probeGlobalShortcut = (accelerator: string): DesktopSnapShotShortcutAvailability => {
      try {
        if (!host.registerGlobalShortcut(accelerator, () => undefined)) {
          return {
            available: false,
            message: "This shortcut is already used by the system or another app.",
          };
        }
        host.unregisterGlobalShortcut(accelerator);
        return { available: true, message: null };
      } catch {
        return { available: false, message: "The system could not register this shortcut." };
      }
    };

    const releaseShortcut = () => {
      shortcutGeneration++;
      portalShortcut?.close();
      portalShortcut = undefined;
      if (registeredAccelerator) {
        host.unregisterGlobalShortcut(registeredAccelerator);
        registeredAccelerator = undefined;
      }
      stopShiftShortcut?.();
      stopShiftShortcut = undefined;
    };

    const emit = (event: DesktopSnapShotEvent) => host.emit(event).pipe(Effect.ignoreCause);
    const setFailure = (message: string, captureId?: string) =>
      Ref.update(stateRef, (state) => ({ ...state, message })).pipe(
        Effect.andThen(
          emit(
            captureId ? { type: "failed", id: captureId as DesktopSnapShotId } : { type: "failed" },
          ),
        ),
      );
    const setShortcutFailure = (shortcutMessage: string) =>
      Effect.sync(() => {
        shortcutVerified = false;
      }).pipe(
        Effect.andThen(
          Ref.update(stateRef, (state) => ({
            ...state,
            shortcutRegistered: false,
            shortcutMessage,
          })),
        ),
        Effect.andThen(emit({ type: "failed" })),
      );

    const discardCapture = Effect.fn("snapShot.discardCapture")(function* (id: string) {
      closeLinuxFeedback(id);
      transition.dismiss(id);
      yield* Effect.forEach(
        [`${id}.png`, `${id}.tmp.png`, `${id}.json`, `${id}.json.tmp`],
        (name) => fileSystem.remove(path.join(captureDirectory, name), { force: true }),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.ignore);
    });

    const prepareCapture = Effect.fn("snapShot.prepareCapture")(function* (
      settings: ClientSettings,
    ) {
      const id = yield* crypto.randomUUIDv4.pipe(Effect.mapError((cause) => captureFailure(cause)));
      const mode = snapShotCaptureMode(platform);
      if (mode === "unavailable") {
        return yield* new DesktopSnapShotError({ operation: "unsupported", captureId: id });
      }
      const imageTempPath = path.join(captureDirectory, `${id}.tmp.png`);

      return yield* Effect.gen(function* () {
        // Retire feedback before reading screen pixels, so a rapid capture cannot
        // photograph the previous capture's overlay.
        closeLinuxFeedback();
        flash.dispose();
        transition.dispose();
        yield* fileSystem.makeDirectory(captureDirectory, { recursive: true });
        yield* emit({ type: "requested", id: id as DesktopSnapShotId });
        const snapshot = yield* Effect.tryPromise({
          try: () => captureSource({ mode, captureId: id, settings, imageTempPath }),
          catch: (cause) => captureFailure(cause, id),
        });
        const capturedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        if (snapshot.linuxActivationFailure) {
          yield* Effect.logWarning(
            "The compositor could not activate T3 Code after the snapshot",
            snapshot.linuxActivationFailure.cause,
          );
        }
        if (snapshot.animationStarted) {
          yield* emit({ type: "started", id: id as DesktopSnapShotId });
        } else {
          yield* host.activate.pipe(Effect.ignoreCause);
        }
        return { id, capturedAt, ...snapshot };
      }).pipe(Effect.mapError((cause) => captureFailure(cause, id)));
    });

    const persistCapture = Effect.fn("snapShot.persistCapture")(function* (
      capture: Effect.Success<ReturnType<typeof prepareCapture>>,
    ) {
      const { id, capturedAt, source, active, linuxWindow, contextPromise, png, imageTempReady } =
        capture;
      const imagePath = path.join(captureDirectory, `${id}.png`);
      const imageTempPath = path.join(captureDirectory, `${id}.tmp.png`);
      const metadataPath = path.join(captureDirectory, `${id}.json`);

      yield* Effect.gen(function* () {
        const accessibilityContext = yield* Effect.promise(() => contextPromise);
        const appIconDataUrl = yield* Effect.promise(() =>
          host.appIconDataUrl(source, active).catch(() => undefined),
        );
        // Native labels are unbounded; keep a valid screenshot when its metadata is too long.
        const appIdentifier = boundedSnapShotString(
          active?.platform === "macos" ? active.owner.bundleId : linuxWindow?.appIdentifier,
          255,
        );
        const pending = yield* decodePendingCapture({
          id,
          name: `window-${capturedAt.replaceAll(":", "-")}.png`,
          mimeType: "image/png",
          sizeBytes: png.byteLength,
          source: {
            kind: "snap-shot",
            capturedAt,
            appName:
              boundedSnapShotString(snapShotAppName(active, linuxWindow, source.name), 255) ??
              "Window",
            windowTitle:
              boundedSnapShotString(
                active?.title.trim() || linuxWindow?.title.trim() || source.name,
                1_000,
              ) ?? "",
            ...(accessibilityContext?.accessibleText
              ? { accessibleText: accessibilityContext.accessibleText }
              : {}),
            ...(accessibilityContext?.accessibility
              ? { accessibility: accessibilityContext.accessibility }
              : {}),
            ...(appIdentifier ? { appIdentifier } : {}),
            ...(appIconDataUrl ? { appIconDataUrl } : {}),
          },
        });
        if (!imageTempReady) yield* fileSystem.writeFile(imageTempPath, png);
        yield* fileSystem.rename(imageTempPath, imagePath);
        yield* fileSystem.writeFileString(
          metadataPath + ".tmp",
          yield* encodePendingCaptureJson(pending),
        );
        yield* fileSystem.rename(metadataPath + ".tmp", metadataPath);
      }).pipe(Effect.mapError((cause) => captureFailure(cause, id)));
    });

    const capture = Effect.gen(function* () {
      const settings = yield* Ref.get(settingsRef);
      if (!settings.snapShotEnabled) {
        return yield* new DesktopSnapShotError({ operation: "disabled" });
      }
      // Only source acquisition and the initial handoff require exclusive access.
      // Each captured image can finish its own accessibility read and persistence.
      const prepared = yield* prepareCapture(settings).pipe(
        Effect.tapError((error) =>
          (error.captureId ? discardCapture(error.captureId) : Effect.void).pipe(
            Effect.andThen(setFailure(error.message, error.captureId)),
          ),
        ),
        snapshotMutex.withPermitsIfAvailable(1),
      );
      if (Option.isNone(prepared)) return;
      const capture = prepared.value;
      yield* persistCapture(capture).pipe(
        Effect.tap(() =>
          Ref.update(stateRef, (state) => ({ ...state, message: null })).pipe(
            Effect.andThen(emit({ type: "ready", id: capture.id as DesktopSnapShotId })),
          ),
        ),
        Effect.tapError((error) =>
          discardCapture(capture.id).pipe(
            Effect.andThen(Ref.update(stateRef, (state) => ({ ...state, message: error.message }))),
            Effect.andThen(emit({ type: "failed", id: capture.id as DesktopSnapShotId })),
          ),
        ),
      );
    }).pipe(Effect.withSpan("snapShot.capture"));

    const captureFromShortcut = Effect.gen(function* () {
      if (shortcutSuppressed) return;
      shortcutVerified = true;
      const now = yield* Clock.currentTimeNanos;
      if (lastShortcutAt !== undefined && now - lastShortcutAt < SHORTCUT_COOLDOWN_NS) return;
      lastShortcutAt = now;
      yield* capture;
    }).pipe(Effect.withSpan("snapShot.shortcutActivated"));
    const onShortcut = () => runPromise(captureFromShortcut).catch(() => undefined);

    const checkShortcut = Effect.fn("snapShot.checkShortcut")(function* (
      shortcut: SnapShotShortcut,
    ) {
      const mode = snapShotCaptureMode(platform);
      if (mode === "unavailable") {
        return { available: false, message: "SnapShots are not supported on this platform." };
      }
      if (mode === "portal" && niriSocketPath()) {
        return {
          available: false,
          message: "Configure the capture shortcut in your Niri config, not in T3 Code.",
        };
      }
      if (mode === "portal" && isHyprlandCaptureSession()) {
        return {
          available: false,
          message: "Change the capture binding in your Hyprland config, then save it.",
        };
      }
      if (isModifierPairShortcut(shortcut)) {
        if (mode === "portal") {
          return { available: false, message: WAYLAND_MODIFIER_PAIR_UNAVAILABLE_MESSAGE };
        }
        const available = yield* Effect.tryPromise(() =>
          startPairShortcutProcess(
            snapShotShortcutModifierPair(shortcut),
            () => undefined,
            () => undefined,
          ),
        ).pipe(
          Effect.tap((stop) => Effect.sync(stop)),
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        return {
          available,
          message: available
            ? observedPairMessage(shortcut, platform)
            : snapShotShortcutRegistrationFailureMessage(shortcut, platform),
        };
      }
      const systemConflict = snapShotShortcutSystemConflict(shortcut);
      if (systemConflict) return { available: false, message: systemConflict };
      if (mode === "portal") {
        return yield* Effect.try(() => portalShortcutTrigger(shortcut)).pipe(
          Effect.match({
            onSuccess: () => ({
              available: true,
              message: "Your desktop will confirm this shortcut when you save it.",
            }),
            onFailure: (error) => ({
              available: false,
              message: error.cause instanceof Error ? error.cause.message : "Unsupported shortcut.",
            }),
          }),
        );
      }
      const accelerator = toElectronAccelerator(shortcut);
      const available =
        registeredAccelerator === accelerator
          ? { available: true, message: null }
          : probeGlobalShortcut(accelerator);
      return available;
    });

    const applySettings = Effect.fn("snapShot.applySettings")(function* (
      settings: ClientSettings,
      requestedPermissionMessage: string | null,
      forceShortcut = false,
    ) {
      const previousSettings = yield* Ref.get(settingsRef);
      yield* Ref.set(settingsRef, settings);

      const mode = snapShotCaptureMode(platform);
      const shortcut = settings.snapShotShortcut;
      if (
        settings.snapShotEnabled &&
        settings.snapShotIncludeAccessibility &&
        mode !== "unavailable"
      ) {
        accessibilityProcessPool.warm();
      } else {
        accessibilityProcessPool.cool();
      }
      if (settings.snapShotEnabled && platform === "win32") {
        regionSnapShotPool.warm();
      } else {
        regionSnapShotPool.cool();
      }
      if (!settings.snapShotEnabled || !settings.snapShotFlash || mode === "unavailable") {
        flash.dispose();
      }
      if (!settings.snapShotEnabled || !settings.snapShotAnimations || mode === "unavailable") {
        transition.dispose();
        closeLinuxFeedback();
      }
      // Every client-settings save lands here. Only the fields that decide which
      // shortcut listener runs may tear it down; a font-size change must not
      // uninstall a global keyboard hook or drop an approved portal session.
      const shortcutInputsChanged =
        settings.snapShotEnabled !== previousSettings.snapShotEnabled ||
        settings.snapShotIncludeAccessibility !== previousSettings.snapShotIncludeAccessibility ||
        !sameSnapShotShortcut(shortcut, previousSettings.snapShotShortcut);
      const portalShortcutUnchanged =
        portalShortcut !== undefined &&
        settings.snapShotEnabled &&
        previousSettings.snapShotEnabled &&
        (isHyprlandCaptureSession() ||
          (!isModifierPairShortcut(shortcut) &&
            !isModifierPairShortcut(previousSettings.snapShotShortcut) &&
            toElectronAccelerator(shortcut) ===
              toElectronAccelerator(previousSettings.snapShotShortcut)));
      if (!forceShortcut && (portalShortcutUnchanged || (initialized && !shortcutInputsChanged))) {
        yield* Ref.update(stateRef, (state) => ({ ...state, shortcut }));
        return;
      }
      initialized = true;
      releaseShortcut();
      shortcutVerified = false;
      const generation = shortcutGeneration;
      const onCurrentShortcut = () => {
        if (generation === shortcutGeneration) return onShortcut();
        return Promise.resolve();
      };
      if (!settings.snapShotEnabled || mode === "unavailable") {
        yield* Ref.set(stateRef, {
          mode,
          shortcut,
          shortcutRegistered: false,
          shortcutMessage: null,
          message:
            mode === "unavailable"
              ? platform === "linux"
                ? "SnapShots require a Wayland session. X11 capture is not supported."
                : "SnapShots are not supported on this platform."
              : null,
        });
        return;
      }

      const permissionMessage =
        requestedPermissionMessage ??
        (platform === "darwin"
          ? currentMacSnapShotPermissionMessage(settings.snapShotIncludeAccessibility)
          : null);
      if (permissionMessage) {
        yield* Ref.set(stateRef, {
          mode,
          shortcut,
          shortcutRegistered: false,
          shortcutMessage: null,
          message: permissionMessage,
        });
        return;
      }
      if (mode === "portal" && niriSocketPath()) {
        const registered = yield* Effect.tryPromise(async () => {
          const { startNiriCaptureShortcut } = await import("./NiriCaptureShortcut.ts");
          return startNiriCaptureShortcut(linuxAppId, onCurrentShortcut, () => {
            void runPromise(
              setShortcutFailure("The Niri capture endpoint disconnected. Restart T3 Code."),
            ).catch(() => undefined);
          });
        }).pipe(
          Effect.tap((stop) =>
            Effect.sync(() => {
              stopShiftShortcut = stop;
            }),
          ),
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        yield* Ref.set(stateRef, {
          mode,
          linuxBackend: "niri",
          shortcut,
          shortcutRegistered: false,
          shortcutBinding: niriCaptureBinding(linuxAppId),
          shortcutConfigPath: niriCaptureConfigPath(),
          shortcutActionRegistered: registered,
          shortcutMessage: registered
            ? "Set up the shortcut to add it to your Niri config."
            : "Could not start the Niri capture endpoint. Another T3 Code instance may be using it.",
          message: null,
        });
        return;
      }
      const hyprland = mode === "portal" && isHyprlandCaptureSession();
      if (mode === "portal" && isModifierPairShortcut(shortcut) && !hyprland) {
        yield* Ref.set(stateRef, {
          mode,
          shortcut,
          shortcutRegistered: false,
          shortcutMessage: WAYLAND_MODIFIER_PAIR_UNAVAILABLE_MESSAGE,
          message: null,
        });
        return;
      }
      if (mode === "portal" && (!isModifierPairShortcut(shortcut) || hyprland)) {
        yield* Ref.set(stateRef, {
          mode,
          shortcut,
          shortcutRegistered: false,
          shortcutMessage: null,
          message: null,
        });
        yield* Effect.tryPromise(async () => {
          const { PortalCaptureShortcut } = await import("./PortalCaptureShortcut.ts");
          return new PortalCaptureShortcut(
            linuxAppId,
            isModifierPairShortcut(shortcut)
              ? {
                  key: "2",
                  ctrlKey: true,
                  modKey: false,
                  altKey: false,
                  shiftKey: true,
                  metaKey: false,
                }
              : shortcut,
            onCurrentShortcut,
            () => {
              if (generation !== shortcutGeneration) return;
              shortcutVerified = false;
              void runPromise(emit({ type: "shortcut-changed" })).catch(() => undefined);
            },
            undefined,
            hyprland,
          );
        }).pipe(
          Effect.tap((registration) =>
            Effect.sync(() => {
              portalShortcut = registration;
            }),
          ),
          Effect.catch((error) =>
            Ref.update(stateRef, (state) => ({
              ...state,
              shortcutMessage:
                error.cause instanceof Error
                  ? error.cause.message
                  : "Could not connect to your desktop's shortcut service.",
            })),
          ),
        );
        return;
      }

      let registered = false;
      if (isModifierPairShortcut(shortcut)) {
        registered = yield* Effect.tryPromise(() =>
          startPairShortcutProcess(
            snapShotShortcutModifierPair(shortcut),
            onCurrentShortcut,
            () => {
              void runPromise(
                setShortcutFailure(snapShotShortcutRegistrationFailureMessage(shortcut, platform)),
              ).catch(() => undefined);
            },
          ),
        ).pipe(
          Effect.tap((stop) =>
            Effect.sync(() => {
              stopShiftShortcut = stop;
            }),
          ),
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      } else {
        const accelerator = toElectronAccelerator(shortcut);
        registered = host.registerGlobalShortcut(accelerator, onCurrentShortcut);
        if (registered) registeredAccelerator = accelerator;
      }

      yield* Ref.set(stateRef, {
        mode,
        shortcut,
        shortcutRegistered: registered,
        message: null,
        shortcutMessage: registered
          ? isModifierPairShortcut(shortcut)
            ? observedPairMessage(shortcut, platform)
            : null
          : snapShotShortcutRegistrationFailureMessage(shortcut, platform),
      });
    });

    const setShortcutSuppressed = (suppressed: boolean) =>
      Effect.sync(() => {
        shortcutSuppressed = suppressed;
      });

    const configure = Effect.fn("snapShot.configure")(function* (settings: ClientSettings) {
      yield* configurationMutex.withPermits(1)(applySettings(settings, null));
    });

    const requestPermissions = Effect.fn("snapShot.requestPermissions")(function* (
      includeAccessibility: boolean,
    ) {
      if (platform !== "darwin") return;
      const showHelper = host.permissionHelper();
      yield* Effect.promise(() => requestMacSnapShotPermissions(includeAccessibility));
      if (host.screenRecordingStatus() !== "granted") {
        yield* showHelper("screen-recording");
      } else if (includeAccessibility && !host.accessibilityTrusted(false)) {
        yield* Effect.promise(() =>
          host.openPermissionSettings("accessibility").catch(() => undefined),
        );
        yield* showHelper("accessibility");
      }
    }, configurationMutex.withPermits(1));

    const setup = Effect.fn("snapShot.setup")(function* (action: DesktopSnapShotSetupAction) {
      if (action === "test-mac-capture") {
        if (platform !== "darwin")
          return yield* new DesktopSnapShotSetupError({ action, reason: "unsupported-session" });
        // Exercise the real capture path during setup without attaching a snapshot
        // or running capture feedback. The temporary image is discarded on failure too.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* fileSystem.makeTempDirectoryScoped({
              prefix: "t3-snapshot-test-",
            });
            yield* Effect.tryPromise(async () => {
              const active = await host.activeWindow("darwin");
              if (!active) throw new Error("No window is available to test capture.");
              await captureMacWindowSnapshot(
                active,
                path.join(directory, "test.png"),
                snapShotThumbnailSize(active),
              );
            });
          }),
        ).pipe(
          Effect.mapError(
            (cause) => new DesktopSnapShotSetupError({ action, reason: "setup-failed", cause }),
          ),
        );
        return;
      } else if (action === "install-kde-helper" || action === "remove-kde-helper") {
        if (snapShotCaptureMode(platform) !== "portal" || !isKdeCaptureSession())
          return yield* new DesktopSnapShotSetupError({
            action,
            reason: "unsupported-session",
          });
        yield* Effect.tryPromise({
          try: () => new KdeCaptureSetup(kdeCapturePaths).perform(action),
          catch: (error) =>
            new DesktopSnapShotSetupError({
              action,
              reason: "setup-failed",
              cause: error,
            }),
        });
      } else if (action === "install-hyprland-helper" || action === "remove-hyprland-helper") {
        if (snapShotCaptureMode(platform) !== "portal" || !isHyprlandCaptureSession())
          return yield* new DesktopSnapShotSetupError({
            action,
            reason: "unsupported-session",
          });
        yield* Effect.tryPromise({
          try: () => new HyprlandCaptureSetup(hyprlandCapturePaths).perform(action),
          catch: (error) =>
            new DesktopSnapShotSetupError({
              action,
              reason: "setup-failed",
              cause: error,
            }),
        });
      } else if (action === "allow-screen-recording" || action === "allow-accessibility") {
        if (platform !== "darwin")
          return yield* new DesktopSnapShotSetupError({
            action,
            reason: "unsupported-session",
          });
        const showHelper = host.permissionHelper();
        if (action === "allow-accessibility") {
          const granted = host.accessibilityTrusted(true);
          if (!granted && host.isPackaged) {
            yield* Effect.promise(() =>
              host.openPermissionSettings("accessibility").catch(() => undefined),
            );
          }
        } else yield* Effect.promise(requestMacScreenCapturePermission);
        yield* showHelper(action === "allow-accessibility" ? "accessibility" : "screen-recording");
      } else if (action !== "retry-shortcut") {
        if (!hasGnomeSetup())
          return yield* new DesktopSnapShotSetupError({
            action,
            reason: "unsupported-session",
          });
        yield* Effect.tryPromise({
          try: async () => {
            const { GnomeCaptureSetup } = await import("./GnomeCaptureSetup.ts");
            const setup = new GnomeCaptureSetup(gnomeSetupPaths);
            try {
              await setup.perform(action);
            } finally {
              setup.close();
            }
          },
          catch: (error) =>
            new DesktopSnapShotSetupError({
              action,
              reason: "setup-failed",
              cause: error,
            }),
        });
      }
      if (action === "retry-shortcut") {
        const currentPortal = portalShortcut;
        if (currentPortal?.hasSession && !currentPortal.state.shortcutPending) {
          yield* Effect.tryPromise(() => currentPortal.configure()).pipe(
            Effect.mapError(
              (error) =>
                new DesktopSnapShotSetupError({
                  action,
                  reason: "shortcut-permissions",
                  cause: error.cause,
                }),
            ),
          );
        } else yield* applySettings(yield* Ref.get(settingsRef), null, true);
      }
    }, configurationMutex.withPermits(1));

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        releaseShortcut();
        flash.dispose();
        transition.dispose();
        closeLinuxFeedback();
        accessibilityProcessPool.close();
        regionSnapShotPool.close();
      }),
    );

    const configDesktop = Effect.fn("snapShot.configDesktop")(function* (
      action: "preview-config" | "apply-config",
    ) {
      if (snapShotCaptureMode(platform) === "portal") {
        if (niriSocketPath()) return "niri" as const;
        if (isHyprlandCaptureSession()) return "hyprland" as const;
      }
      return yield* new DesktopSnapShotSetupError({
        action,
        reason: "unsupported-session",
      });
    });
    const previewConfig = Effect.fn("snapShot.previewConfig")(function* (
      request: DesktopCaptureConfigRequest,
      selectedPath?: string,
    ) {
      const desktop = yield* configDesktop("preview-config");
      return yield* Effect.tryPromise({
        try: async () => {
          const configPath =
            selectedPath ??
            (desktop === "niri"
              ? niriCaptureConfigPath()
              : (await hyprlandCaptureShortcut(linuxAppId)).shortcutConfigPath);
          return shortcutConfig.preview({ desktop, path: configPath, appId: linuxAppId }, request);
        },
        catch: (cause) =>
          new DesktopSnapShotSetupError({
            action: "preview-config",
            reason: "setup-failed",
            cause,
          }),
      });
    });
    const applyConfig = Effect.fn("snapShot.applyConfig")(function* (previewId: string) {
      const desktop = yield* configDesktop("apply-config");
      const result = yield* Effect.tryPromise({
        try: () => shortcutConfig.apply(previewId, desktop),
        catch: (cause) =>
          new DesktopSnapShotSetupError({
            action: "apply-config",
            reason: "setup-failed",
            cause,
          }),
      });
      if (result.backupPath) shortcutVerified = false;
      return result;
    });

    const engine: SnapShotEngine = {
      configure,
      requestPermissions,
      setup,
      previewConfig,
      applyConfig,
      state: Ref.get(stateRef).pipe(
        Effect.flatMap((state) =>
          state.mode === "portal"
            ? Effect.tryPromise(async () => {
                const { getLinuxCaptureSupport } = await import("./LinuxSnapShot.ts");
                return getLinuxCaptureSupport(linuxAppId);
              }).pipe(
                Effect.map((support) => ({ ...state, ...support })),
                Effect.catch((error) =>
                  Effect.succeed({
                    ...state,
                    message:
                      error.cause instanceof Error
                        ? error.cause.message
                        : "Could not check desktop capture support. Check your desktop session and try again.",
                  }),
                ),
              )
            : platform === "darwin"
              ? Effect.gen(function* () {
                  // Permissions can change in System Settings at any time. Surface a
                  // revocation on every read, and re-register the shortcut once a
                  // previously missing permission is granted again.
                  const settings = yield* Ref.get(settingsRef);
                  const macPermissions = currentMacPermissions();
                  const message = settings.snapShotEnabled
                    ? macSnapShotPermissionMessage(
                        macPermissions,
                        settings.snapShotIncludeAccessibility,
                      )
                    : null;
                  const recovered =
                    message === null &&
                    state.message !== null &&
                    MAC_PERMISSION_MESSAGES.has(state.message)
                      ? yield* configurationMutex
                          .withPermits(1)(applySettings(settings, null, true))
                          .pipe(Effect.andThen(Ref.get(stateRef)))
                      : state;
                  return { ...recovered, macPermissions, ...(message ? { message } : {}) };
                })
              : Effect.succeed(platform === "win32" ? { ...state, windows: true } : state),
        ),
        Effect.flatMap((state) =>
          Effect.gen(function* () {
            // Keep the session identity available even when its capability probe fails.
            const linuxDesktop =
              state.mode === "portal"
                ? process.env.XDG_CURRENT_DESKTOP?.toLowerCase()
                    .split(":")
                    .find(
                      (name) =>
                        name === "gnome" ||
                        name === "kde" ||
                        name === "niri" ||
                        name === "hyprland",
                    )
                : undefined;
            const gnomeExtension = hasGnomeSetup()
              ? yield* Effect.promise(async () => {
                  const { GnomeCaptureSetup } = await import("./GnomeCaptureSetup.ts");
                  const setup = new GnomeCaptureSetup(gnomeSetupPaths);
                  try {
                    return await setup.state();
                  } finally {
                    setup.close();
                  }
                })
              : undefined;
            const kdeHelper =
              state.linuxBackend === "kde"
                ? yield* Effect.promise(() => new KdeCaptureSetup(kdeCapturePaths).state())
                : undefined;
            const hyprlandHelper =
              state.linuxBackend === "hyprland"
                ? yield* Effect.promise(() =>
                    new HyprlandCaptureSetup(hyprlandCapturePaths).state(),
                  )
                : undefined;
            const hyprlandShortcut =
              state.linuxBackend === "hyprland"
                ? yield* Effect.promise(() => hyprlandCaptureShortcut(linuxAppId))
                : undefined;
            return {
              ...state,
              ...portalShortcut?.state,
              ...(linuxDesktop ? { linuxDesktop } : {}),
              ...(gnomeExtension ? { gnomeExtension } : {}),
              ...(hyprlandHelper
                ? {
                    hyprlandHelper,
                    linuxFeedbackAvailable:
                      hyprlandHelper.status === "ready" &&
                      hyprlandHelper.feedbackAvailable === true,
                  }
                : {}),
              ...hyprlandShortcut,
              ...(state.linuxBackend === "niri"
                ? { shortcutConfigPath: niriCaptureConfigPath() }
                : {}),
              ...(kdeHelper
                ? {
                    kdeHelper,
                    linuxFeedbackAvailable:
                      kdeHelper.status === "ready" && kdeHelper.feedbackAvailable === true,
                  }
                : {}),
              shortcutVerified,
            };
          }),
        ),
      ),
      checkShortcut,
      setShortcutSuppressed,
      capture,
      listPending: fileSystem.readDirectory(captureDirectory).pipe(
        Effect.catchTags({
          PlatformError: (cause) =>
            cause.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(cause),
        }),
        Effect.flatMap((names) =>
          Effect.forEach(
            names.filter((name) => name.endsWith(".json") && !name.endsWith(".json.tmp")),
            (name) =>
              fileSystem.readFileString(path.join(captureDirectory, name)).pipe(
                Effect.flatMap(decodePendingCaptureJson),
                Effect.orElseSucceed(() => undefined),
              ),
            { concurrency: "unbounded" },
          ),
        ),
        Effect.map((captures) =>
          captures
            .filter((capture) => capture !== undefined)
            .sort((left, right) => left.source.capturedAt.localeCompare(right.source.capturedAt)),
        ),
        Effect.mapError((cause) => new DesktopSnapShotError({ operation: "list-pending", cause })),
      ),
      read: (id) =>
        Effect.gen(function* () {
          const metadata = yield* fileSystem
            .readFileString(path.join(captureDirectory, `${id}.json`))
            .pipe(Effect.flatMap(decodePendingCaptureJson));
          const png = yield* fileSystem.readFile(path.join(captureDirectory, `${id}.png`));
          return {
            ...metadata,
            dataUrl: `data:image/png;base64,${Encoding.encodeBase64(png)}`,
          };
        }).pipe(
          Effect.mapError(
            (cause) => new DesktopSnapShotError({ operation: "read", captureId: id, cause }),
          ),
        ),
      setAnimationDestination: (id, destination) =>
        Effect.promise(async () => {
          if (linuxFeedback?.id === id && destination.relativeFrame) {
            await linuxFeedback.feedback
              .animateTo(destination.relativeFrame)
              .catch(() => closeLinuxFeedback(id));
            return;
          }
          transition.animateTo(id, destination);
          await transition.waitForLanding(id);
        }),
      dismissAnimation: (id) =>
        Effect.sync(() => {
          closeLinuxFeedback(id);
          transition.dismiss(id);
        }),
      acknowledge: (id) =>
        Effect.promise(async () => {
          await completeLinuxFeedback(id);
          await transition.complete(id);
        }).pipe(
          Effect.andThen(
            Effect.all(
              [
                fileSystem.remove(path.join(captureDirectory, `${id}.json`), { force: true }),
                fileSystem.remove(path.join(captureDirectory, `${id}.png`), { force: true }),
              ],
              { concurrency: "unbounded", discard: true },
            ),
          ),
          Effect.mapError(
            (cause) => new DesktopSnapShotError({ operation: "acknowledge", captureId: id, cause }),
          ),
        ),
    };
    return engine;
  });
}
