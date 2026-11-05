import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { usePreviewMiniPlayerStore } from "../../previewMiniPlayerStore";
import { useRightPanelStore } from "../../rightPanelStore";
import type { OpenedDeviceSession } from "./DevicePanel.logic";

/**
 * A device the agent opens floats over chat like an agent-driven browser, or
 * becomes a panel tab when floating previews are off. A device that already
 * has a tab keeps it.
 */
export function showOpenedDeviceSession(
  ref: ScopedThreadRef,
  target: OpenedDeviceSession,
  floating: boolean,
): void {
  if (floating) {
    usePreviewMiniPlayerStore.getState().open(ref, { kind: "device", ...target });
    return;
  }
  const existing = useRightPanelStore
    .getState()
    .byThreadKey[scopedThreadKey(ref)]?.surfaces.some(
      (surface) =>
        surface.kind === "device" &&
        surface.target?.hostId === target.hostId &&
        surface.target.deviceId === target.deviceId,
    );
  if (existing) return;
  useRightPanelStore.getState().openDevice(ref, target, true);
}

/** A floating device follows its session: once it closes there is nothing left to stream. */
export function closeOrphanedDeviceMiniPlayer(
  ref: ScopedThreadRef,
  sessions: ReadonlyArray<{
    readonly threadId: string;
    readonly hostId: string;
    readonly deviceId: string;
  }>,
): void {
  const source = usePreviewMiniPlayerStore.getState().byThreadKey[scopedThreadKey(ref)]?.source;
  if (source?.kind !== "device") return;
  const sessionStillExists = sessions.some(
    (session) =>
      session.threadId === ref.threadId &&
      session.hostId === source.hostId &&
      session.deviceId === source.deviceId,
  );
  if (!sessionStillExists) usePreviewMiniPlayerStore.getState().close(ref);
}
