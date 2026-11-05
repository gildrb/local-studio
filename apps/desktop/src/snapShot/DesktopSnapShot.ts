// @effect-diagnostics globalTimers:off -- Electron overlay animation timers run at native callback boundaries outside Effect fibers.

import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as Electron from "electron";

import type { ActiveWindow } from "@t3tools/shared/snapShot/ActiveWindow";
import { startGlobalShiftShortcutProcess } from "@t3tools/shared/snapShot/GlobalShiftShortcutProcess";
import { HYPRLAND_CAPTURE_EXECUTABLE } from "@t3tools/shared/snapShot/HyprlandSnapShot";
import { KDE_CAPTURE_EXECUTABLE } from "@t3tools/shared/snapShot/KdeSnapShot";
import { startMacModifierPairShortcutProcess } from "@t3tools/shared/snapShot/MacModifierPairShortcutProcess";
import { makeSnapShotEngine, type SnapShotEngine } from "@t3tools/shared/snapShot/SnapShotEngine";
import {
  setSnapShotImageCodec,
  snapShotImageCodecFromNativeImage,
} from "@t3tools/shared/snapShot/snapShotImage";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as MacPermissions from "../permissions/MacPermissions.ts";
import { MAC_PERMISSION_SETTINGS_URLS } from "../permissions/MacPermission.ts";
import { activeWindow } from "./ActiveWindow.ts";
import { SnapShotTransition } from "./SnapShotTransition.ts";
import { showWindowsCaptureOverlay } from "./WindowsCaptureFeedback.ts";

const FLASH_ANIMATION_DURATION_MS = 180;
const FLASH_STATIC_DURATION_MS = 60;
const FLASH_FRAME_INTERVAL_MS = 16;
const FLASH_PEAK_OPACITY = 0.08;

export class DesktopSnapShot extends Context.Service<
  DesktopSnapShot,
  SnapShotEngine & { readonly initialize: Effect.Effect<void> }
>()("@t3tools/desktop/snapShot/DesktopSnapShot") {}

type SnapShotSystemAnimationSettings = Pick<
  ReturnType<typeof Electron.systemPreferences.getAnimationSettings>,
  "prefersReducedMotion" | "shouldRenderRichAnimation"
>;

export function shouldAnimateSnapShot(settings: SnapShotSystemAnimationSettings): boolean {
  return settings.shouldRenderRichAnimation && !settings.prefersReducedMotion;
}

export function snapShotIconDataUrl(
  ...icons: ReadonlyArray<Electron.NativeImage | null | undefined>
): string | undefined {
  const icon = icons.find((candidate): candidate is Electron.NativeImage =>
    Boolean(candidate && !candidate.isEmpty()),
  );
  if (!icon) return undefined;
  return icon.resize({ width: 64, height: 64, quality: "best" }).toDataURL({ scaleFactor: 2 });
}

async function appFileIcon(
  path: string,
  platform: NodeJS.Platform,
): Promise<Electron.NativeImage | undefined> {
  if (platform === "darwin") {
    const thumbnail = await Electron.nativeImage
      .createThumbnailFromPath(path, { width: 64, height: 64 })
      .catch(() => undefined);
    if (thumbnail && !thumbnail.isEmpty()) return thumbnail;
  }
  return Electron.app.getFileIcon(path, { size: "normal" }).catch(() => undefined);
}

export async function iconDataUrl(
  source: { readonly appIcon?: Electron.NativeImage | null | undefined },
  active: ActiveWindow | undefined,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  try {
    const fileIcon = active?.owner.path
      ? await appFileIcon(active.owner.path, platform)
      : undefined;
    return snapShotIconDataUrl(fileIcon, source.appIcon);
  } catch {
    return undefined;
  }
}

function createSnapShotFlashWindow(bounds: Electron.Rectangle): Electron.BaseWindow {
  const window = new Electron.BaseWindow({
    ...bounds,
    alwaysOnTop: true,
    focusable: false,
    frame: false,
    hasShadow: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#ffffff",
    opacity: FLASH_PEAK_OPACITY,
    transparent: false,
  });
  window.setIgnoreMouseEvents(true);
  return window;
}

export class SnapShotFlash {
  private flashWindow: Electron.BaseWindow | undefined;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly showWindow: (window: Electron.BaseWindow) => void;

  constructor(
    showWindow: (window: Electron.BaseWindow) => void = (window) => window.showInactive(),
  ) {
    this.showWindow = showWindow;
  }

  showAnimated(bounds: Electron.Rectangle): Promise<void> {
    return this.show(bounds, true, FLASH_ANIMATION_DURATION_MS);
  }

  showStatic(bounds: Electron.Rectangle): Promise<void> {
    return this.show(bounds, false, FLASH_STATIC_DURATION_MS);
  }

  dispose(): void {
    if (this.animationTimer) clearInterval(this.animationTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.animationTimer = undefined;
    this.closeTimer = undefined;
    if (this.flashWindow && !this.flashWindow.isDestroyed()) this.flashWindow.destroy();
    this.flashWindow = undefined;
  }

  private async show(
    bounds: Electron.Rectangle,
    animated: boolean,
    durationMs: number,
  ): Promise<void> {
    this.dispose();
    const window = createSnapShotFlashWindow(bounds);
    this.flashWindow = window;
    if (window.isDestroyed()) return;
    this.showWindow(window);
    if (animated) {
      let opacity = FLASH_PEAK_OPACITY;
      this.animationTimer = setInterval(() => {
        if (window.isDestroyed()) return this.dispose();
        opacity = Math.max(
          0,
          opacity - (FLASH_PEAK_OPACITY * FLASH_FRAME_INTERVAL_MS) / durationMs,
        );
        window.setOpacity(opacity);
      }, FLASH_FRAME_INTERVAL_MS);
    }
    this.closeTimer = setTimeout(() => {
      if (this.flashWindow === window) this.dispose();
    }, durationMs);
  }
}

export function snapShotFlashBounds(
  active: ActiveWindow | undefined,
  platform: NodeJS.Platform,
): Electron.Rectangle {
  if (!active) return Electron.screen.getPrimaryDisplay().bounds;
  return platform === "win32"
    ? Electron.screen.screenToDipRect(null, active.bounds)
    : active.bounds;
}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const permissions = yield* MacPermissions.MacPermissions;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const path = yield* Path.Path;
  const { platform } = environment;
  setSnapShotImageCodec(
    snapShotImageCodecFromNativeImage((png) => Electron.nativeImage.createFromBuffer(png)),
  );
  const dataHome = path.dirname(environment.linuxApplicationsDir);
  const shiftShortcutWorkerPath = path.join(__dirname, "snapShot", "GlobalShiftShortcutWorker.cjs");
  const showCaptureWindow = platform === "win32" ? showWindowsCaptureOverlay : undefined;
  const engine = yield* makeSnapShotEngine<Electron.NativeImage>({
    platform,
    isPackaged: environment.isPackaged,
    captureDirectory: path.join(environment.stateDir, "snap-shots"),
    linuxAppId: environment.linuxDesktopEntryName.replace(/\.desktop$/, ""),
    gnomeSetupPaths: {
      bundle: environment.isPackaged
        ? path.join(environment.resourcesPath, "gnome-extension")
        : path.join(environment.appRoot, "apps/desktop/gnome-extension"),
      dataHome,
    },
    kdeCapturePaths: {
      bundle: environment.isPackaged
        ? path.join(environment.resourcesPath, "kde-capture", KDE_CAPTURE_EXECUTABLE)
        : path.join(
            environment.appRoot,
            "native/kde-snap-shot/target/release",
            KDE_CAPTURE_EXECUTABLE,
          ),
      dataHome,
    },
    hyprlandCapturePaths: {
      bundle: environment.isPackaged
        ? path.join(environment.resourcesPath, "hyprland-capture", HYPRLAND_CAPTURE_EXECUTABLE)
        : path.join(
            environment.appRoot,
            "native/hyprland-snap-shot/target/release",
            HYPRLAND_CAPTURE_EXECUTABLE,
          ),
      dataHome,
    },
    accessibilityWorkerPath: path.join(__dirname, "snapShot", "SnapShotAccessibilityWorker.cjs"),
    regionWorkerPath: path.join(__dirname, "snapShot", "RegionSnapShotWorker.cjs"),
    flash: new SnapShotFlash(showCaptureWindow),
    transition: new SnapShotTransition({
      showWindow: showCaptureWindow,
      waitForCompositorFrame: platform === "win32",
      // Transparent Windows surfaces must not resize while their compositor animation is running.
      boundOverlayToCaptureDisplays: platform !== "linux",
      alwaysOnTopLevel: platform === "linux" ? undefined : "pop-up-menu",
    }),
    activeWindow,
    startPairShortcutProcess: (modifier, onTrigger, onFailure) =>
      platform === "darwin"
        ? startMacModifierPairShortcutProcess(modifier, onTrigger, onFailure)
        : startGlobalShiftShortcutProcess(shiftShortcutWorkerPath, modifier, onTrigger, onFailure),
    registerGlobalShortcut: (accelerator, onTrigger) =>
      Electron.globalShortcut.register(accelerator, onTrigger),
    unregisterGlobalShortcut: (accelerator) => Electron.globalShortcut.unregister(accelerator),
    systemAnimationsEnabled: () =>
      shouldAnimateSnapShot(Electron.systemPreferences.getAnimationSettings()),
    captureBounds: (active) => snapShotFlashBounds(active, platform),
    destinationWindow: () => {
      const window =
        Electron.BrowserWindow.getFocusedWindow() ??
        Electron.BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!window) return undefined;
      return {
        bounds: window.getBounds(),
        reveal: () => {
          if (window.isDestroyed()) return undefined;
          if (window.isMinimized()) window.restore();
          if (!window.isVisible()) window.show();
          return window.getTitle();
        },
      };
    },
    pickSource: async (maxSize) => {
      const [selected] = await Electron.desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: maxSize,
        fetchWindowIcons: true,
      });
      if (!selected || selected.thumbnail.isEmpty()) return undefined;
      return { source: selected, png: selected.thumbnail.toPNG() };
    },
    appIconDataUrl: (source, active) => iconDataUrl(source, active, platform),
    screenRecordingStatus: () => Electron.systemPreferences.getMediaAccessStatus("screen"),
    accessibilityTrusted: (prompt) =>
      Electron.systemPreferences.isTrustedAccessibilityClient(prompt),
    promptScreenRecording: async () => {
      await Electron.desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });
    },
    openPermissionSettings: (permission) =>
      Electron.shell.openExternal(MAC_PERMISSION_SETTINGS_URLS[permission]),
    permissionHelper: () => {
      const owner = Electron.BrowserWindow.getFocusedWindow();
      return (permission) => permissions.showHelper(permission, owner);
    },
    emit: (event) => desktopWindow.dispatchSnapShotEvent(event).pipe(Effect.ignoreCause),
    activate: desktopWindow.activate.pipe(Effect.ignoreCause),
    prepareCaptureReveal: desktopWindow.prepareCaptureReveal.pipe(Effect.ignoreCause),
  });

  return DesktopSnapShot.of({
    ...engine,
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) =>
        engine.configure(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS)),
      ),
      Effect.ignore,
    ),
  });
});

export const layer = Layer.effect(DesktopSnapShot, make);
