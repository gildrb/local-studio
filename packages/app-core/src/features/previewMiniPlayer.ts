import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { previewRuntimeTabId } from "@t3tools/web/src/browser/previewRuntimeTabId.ts";
import type { BrowserViewportResizeDirection } from "@t3tools/web/src/browser/browserViewportLayout.ts";
import { shouldRenderPreviewMiniPlayer } from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  clampPreviewMiniPlayerPosition,
  NO_PREVIEW_MINI_PLAYER_OBSTACLES,
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  type PreviewMiniPlayerFrame,
  type PreviewMiniPlayerObstacles,
  resizePreviewMiniPlayer,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerFrame,
  resolvePreviewMiniPlayerSourceSize,
} from "@t3tools/web/src/components/preview/previewMiniPlayerLayout.ts";
import {
  type PreviewMiniPlayerSize,
  type PreviewMiniPlayerSource,
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { browserPreviewService } from "../browserPreview.ts";
import {
  deviceScreenAtom,
  deviceSourceDetails,
  deviceSourceKey,
  readDeviceState,
} from "../deviceState.ts";
import { deviceStreamService, type DeviceStreamView } from "../deviceStreams.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { makeRouteRightPanelStateAtom } from "../rightPanelState.ts";

export type PreviewMiniPlayerView = {
  readonly sourceKey: string;
  readonly label: string;
  readonly frame: PreviewMiniPlayerFrame | null;
  readonly radius: number;
  readonly pillInset: number;
  readonly recording: boolean;
  readonly source:
    | {
        readonly kind: "browser";
        readonly runtimeTabId: string;
        readonly reconnecting: boolean;
        readonly pictureInPicture: {
          readonly active: boolean;
          readonly disabled: boolean;
          readonly label: string;
          readonly tooltip: string;
        };
      }
    | {
        readonly kind: "device";
        readonly environmentId: string;
        readonly hostId: string;
        readonly deviceId: string;
        readonly platform: string;
        readonly name: string;
        readonly description: string;
        readonly stream: DeviceStreamView;
      };
};

type MiniPlayerLayout = {
  readonly container: PreviewMiniPlayerSize;
  readonly obstacles: PreviewMiniPlayerObstacles;
};

type Gesture = {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection | null;
  readonly sourceKey: string;
  readonly route: ScopedThreadRef;
};

const LayoutParams = Schema.decodeUnknownSync(
  Schema.Struct({
    width: Schema.Number,
    height: Schema.Number,
    composer: Schema.NullOr(
      Schema.Struct({ left: Schema.Number, right: Schema.Number, height: Schema.Number }),
    ),
  }),
);
const PointParams = Schema.decodeUnknownSync(Schema.Struct({ x: Schema.Number, y: Schema.Number }));
const GestureStartParams = Schema.decodeUnknownSync(
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    direction: Schema.NullOr(
      Schema.Literals([
        "north",
        "northeast",
        "east",
        "southeast",
        "south",
        "southwest",
        "west",
        "northwest",
      ]),
    ),
  }),
);

export function createPreviewMiniPlayerFeature(context: FeatureContext): CoreFeature {
  const { registry } = context;
  const preview = browserPreviewService(context);
  const streams = deviceStreamService(context);
  const miniPlayerStoreAtom = Atom.make((get) => {
    get.addFinalizer(usePreviewMiniPlayerStore.subscribe((value) => get.setSelf(value)));
    return usePreviewMiniPlayerStore.getState();
  });
  const routePanelAtom = makeRouteRightPanelStateAtom(context.routeAtom);
  const layoutAtom = Atom.make<MiniPlayerLayout | null>(null).pipe(Atom.keepAlive);
  let gesture: Gesture | null = null;

  const activeAtom = Atom.make((get) => {
    const panel = get(routePanelAtom);
    if (panel === null) return null;
    const miniPlayer = selectThreadPreviewMiniPlayer(
      get(miniPlayerStoreAtom).byThreadKey,
      panel.route,
    );
    if (miniPlayer === null) return null;
    const rendered = panel.state.isOpen ? panel.activeSurface : null;
    if (!shouldRenderPreviewMiniPlayer(miniPlayer.source, rendered)) return null;
    return { route: panel.route, miniPlayer };
  });

  const sourceSizeAtom = Atom.make((get): PreviewMiniPlayerSize | null => {
    const active = get(activeAtom);
    if (active === null) return null;
    const { route, miniPlayer } = active;
    const source = miniPlayer.source;
    if (source.kind === "device") {
      return resolveDeviceMiniPlayerSourceSize(
        source.platform,
        get(deviceScreenAtom(deviceSourceKey(route, source))),
      );
    }
    const state = get(preview.previewStateAtom(scopedThreadKey(route)));
    const snapshot = state.sessions[source.tabId] ?? null;
    if (snapshot === null) return null;
    const runtimeTabId = previewRuntimeTabId(route, state.serverEpoch, source.tabId);
    const slot = get(preview.slotAtom).get(runtimeTabId);
    return resolvePreviewMiniPlayerSourceSize(
      snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
      slot?.fitSource ? slot.fittedContent : null,
      state.desktopByTabId[source.tabId]?.zoomFactor ?? 1,
    );
  });

  const frameAtom = Atom.make((get): PreviewMiniPlayerFrame | null => {
    const active = get(activeAtom);
    const source = get(sourceSizeAtom);
    const layout = get(layoutAtom);
    if (active === null || source === null || layout === null) return null;
    return resolvePreviewMiniPlayerFrame({
      width: active.miniPlayer.width,
      position: active.miniPlayer.position,
      source,
      container: layout.container,
      obstacles: layout.obstacles,
    });
  });

  const viewAtom = Atom.make((get): PreviewMiniPlayerView | null => {
    const active = get(activeAtom);
    if (active === null) return null;
    const { route, miniPlayer } = active;
    const source = miniPlayer.source;
    const frame = get(frameAtom);
    const sourceKey = previewMiniPlayerSourceKey(source);
    if (source.kind === "device") {
      const radius =
        frame === null
          ? PREVIEW_MINI_PLAYER_CORNER_RADIUS
          : resolveDeviceMiniPlayerCornerRadius(source.platform, frame);
      const details = deviceSourceDetails(
        readDeviceState(get, context, route.environmentId).state,
        source,
      );
      return {
        sourceKey,
        label: "Floating device preview",
        frame,
        radius,
        pillInset: Math.max(8, Math.round(radius * 0.55)),
        recording: false,
        source: {
          kind: "device",
          environmentId: route.environmentId,
          hostId: source.hostId,
          deviceId: source.deviceId,
          platform: source.platform,
          name: details.name,
          description: details.description,
          stream: streams.view(
            get,
            {
              key: deviceSourceKey(route, source),
              environmentId: route.environmentId,
              hostId: source.hostId,
              deviceId: source.deviceId,
              platform: source.platform,
              name: details.name,
              description: details.description,
            },
            { visible: true, compact: true, controlsRail: false, axElements: [] },
          ),
        },
      };
    }
    const state = get(preview.previewStateAtom(scopedThreadKey(route)));
    if (state.sessions[source.tabId] === undefined) return null;
    const overlay = state.desktopByTabId[source.tabId] ?? null;
    const pictureInPicture = overlay?.pictureInPicture ?? false;
    const radius = PREVIEW_MINI_PLAYER_CORNER_RADIUS;
    return {
      sourceKey,
      label: "Floating browser preview",
      frame,
      radius,
      pillInset: Math.max(8, Math.round(radius * 0.55)),
      recording: false,
      source: {
        kind: "browser",
        runtimeTabId: previewRuntimeTabId(route, state.serverEpoch, source.tabId),
        reconnecting: !(overlay?.hasWebContents ?? false),
        pictureInPicture: {
          active: pictureInPicture,
          disabled: !(overlay?.hasWebContents ?? false),
          label: pictureInPicture ? "Close popped-out preview" : "Pop preview into separate window",
          tooltip: pictureInPicture ? "Close separate window" : "Pop into separate window",
        },
      },
    };
  });

  registry.subscribe(
    Atom.make((get) => {
      const route = get(context.routeAtom);
      if (route === null) return null;
      const miniPlayer = selectThreadPreviewMiniPlayer(get(miniPlayerStoreAtom).byThreadKey, route);
      if (miniPlayer?.source.kind !== "browser") return null;
      const sessions = get(preview.previewStateAtom(scopedThreadKey(route))).sessions;
      return sessions[miniPlayer.source.tabId] === undefined ? route : null;
    }),
    (orphaned) => {
      if (orphaned !== null) usePreviewMiniPlayerStore.getState().close(orphaned);
    },
    { immediate: true },
  );

  const currentActive = () => {
    const active = registry.get(activeAtom);
    if (active === null) throw new Error("No floating preview is open.");
    return active;
  };

  return {
    views: { previewMiniPlayer: viewAtom },
    actions: {
      previewMiniPlayerLayout: async (params) => {
        const { width, height, composer } = LayoutParams(params);
        const next: MiniPlayerLayout = {
          container: { width, height },
          obstacles: composer === null ? NO_PREVIEW_MINI_PLAYER_OBSTACLES : { composer },
        };
        const current = registry.get(layoutAtom);
        const same =
          current !== null &&
          current.container.width === width &&
          current.container.height === height &&
          (current.obstacles.composer === next.obstacles.composer ||
            (current.obstacles.composer !== null &&
              next.obstacles.composer !== null &&
              current.obstacles.composer.left === next.obstacles.composer.left &&
              current.obstacles.composer.right === next.obstacles.composer.right &&
              current.obstacles.composer.height === next.obstacles.composer.height));
        if (!same) registry.set(layoutAtom, next);
        return null;
      },
      previewMiniPlayerGestureStart: async (params) => {
        const { x, y, direction } = GestureStartParams(params);
        const { route, miniPlayer } = currentActive();
        const frame = registry.get(frameAtom);
        if (frame === null) return null;
        gesture = {
          pointerX: x,
          pointerY: y,
          frame,
          direction,
          sourceKey: previewMiniPlayerSourceKey(miniPlayer.source),
          route,
        };
        return null;
      },
      previewMiniPlayerGestureMove: async (params) => {
        const { x, y } = PointParams(params);
        const layout = registry.get(layoutAtom);
        const source = registry.get(sourceSizeAtom);
        if (gesture === null || layout === null || source === null) return null;
        const delta = { x: x - gesture.pointerX, y: y - gesture.pointerY };
        const store = usePreviewMiniPlayerStore.getState();
        if (gesture.direction === null) {
          store.move(
            gesture.route,
            gesture.sourceKey,
            clampPreviewMiniPlayerPosition(
              { x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y },
              layout.container,
              gesture.frame,
              layout.obstacles,
            ),
          );
          return null;
        }
        const next = resizePreviewMiniPlayer({
          start: gesture.frame,
          direction: gesture.direction,
          delta,
          source,
          container: layout.container,
          obstacles: layout.obstacles,
        });
        store.resize(gesture.route, gesture.sourceKey, next.width);
        store.move(gesture.route, gesture.sourceKey, { x: next.x, y: next.y });
        return null;
      },
      previewMiniPlayerGestureEnd: async () => {
        gesture = null;
        return null;
      },
      previewMiniPlayerClose: async () => {
        usePreviewMiniPlayerStore.getState().close(currentActive().route);
        return null;
      },
      previewMiniPlayerOpenInPanel: async () => {
        const { route, miniPlayer } = currentActive();
        const source: PreviewMiniPlayerSource = miniPlayer.source;
        usePreviewMiniPlayerStore.getState().close(route);
        if (source.kind === "browser") {
          useRightPanelStore.getState().openBrowser(route, source.tabId);
        } else {
          useRightPanelStore.getState().openDevice(route, {
            hostId: source.hostId,
            deviceId: source.deviceId,
            platform: source.platform,
            name: source.name,
          });
        }
        return null;
      },
      previewMiniPlayerTogglePictureInPicture: async () => {
        throw new Error("Popped-out previews are not available in the native app yet.");
      },
    },
  };
}
