import type { SnapShotShortcut } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import { SnapShotShortcutKeys } from "../desktop/SnapShotShortcutKeys";
import { Button } from "../ui/button";
import { createRecordingRequestTracker } from "./SnapShotSettings.logic";
import {
  buildSnapShotShortcutRecorderModel,
  resolveSnapShotShortcutKeyDown,
  snapShotShortcutRecordingErrorMessage,
} from "./useSnapShotShortcutRecorder.logic";

/** The same recorder for inline changes and config-backed setup, without saving either. */
export function useSnapShotShortcutRecorder({
  shortcut,
  shortcutLabel,
  disabled = false,
  allowModifierPairs = true,
  onRecord,
  onStart,
  onError,
}: {
  shortcut: SnapShotShortcut;
  shortcutLabel?: string | undefined;
  disabled?: boolean;
  allowModifierPairs?: boolean;
  onRecord: (shortcut: SnapShotShortcut) => void;
  onStart?: () => void;
  onError: (message: string) => void;
}) {
  const bridge = getDesktopSnapShotBridge();
  const [recording, setRecording] = useState(false);
  const [requests] = useState(createRecordingRequestTracker);
  const heldModifierCodes = useRef(new Set<string>());
  const model = buildSnapShotShortcutRecorderModel({
    shortcut,
    shortcutLabel: shortcutLabel ?? null,
    recording,
    disabled,
    allowModifierPairs,
    platform: navigator.platform,
  });
  const stopRecording = useCallback(() => {
    requests.clear();
    heldModifierCodes.current.clear();
    setRecording(false);
    void bridge?.setSnapShotShortcutSuppressed(false).catch(() => undefined);
  }, [bridge, requests]);
  const startRecording = async () => {
    if (!bridge || disabled) return;
    const request = requests.tryBegin();
    if (!request) return;
    heldModifierCodes.current.clear();
    onStart?.();
    try {
      await bridge.setSnapShotShortcutSuppressed(true);
      if (requests.owns(request)) setRecording(true);
    } catch (error) {
      if (!requests.owns(request)) return;
      requests.clear();
      onError(snapShotShortcutRecordingErrorMessage(error));
    }
  };
  useEffect(
    () => () => {
      requests.clear();
      void bridge?.setSnapShotShortcutSuppressed(false).catch(() => undefined);
    },
    [bridge, requests],
  );
  const recordShortcut = (event: KeyboardEvent<HTMLButtonElement>) => {
    const decision = resolveSnapShotShortcutKeyDown({
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      recording,
      heldModifierCodes: [...heldModifierCodes.current],
      allowModifierPairs,
      platform: navigator.platform,
    });
    if (!decision.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (decision.holdModifierCode !== null)
      heldModifierCodes.current.add(decision.holdModifierCode);
    const outcome = decision.outcome;
    if (outcome.kind === "cancel") {
      stopRecording();
    } else if (outcome.kind === "error") {
      onError(outcome.message);
    } else if (outcome.kind === "record") {
      stopRecording();
      onRecord(outcome.shortcut);
    }
  };

  return {
    recording,
    stopRecording,
    input: (
      <Button
        type="button"
        size="xs"
        variant={recording ? "secondary" : "outline"}
        disabled={model.disabled}
        aria-label={model.ariaLabel}
        aria-pressed={model.pressed}
        data-keybinding-capture=""
        onClick={() => void startRecording()}
        onKeyDown={recordShortcut}
        onKeyUp={(event) => heldModifierCodes.current.delete(event.code)}
        onBlur={stopRecording}
      >
        {model.content.kind === "text" ? (
          model.content.text
        ) : (
          <SnapShotShortcutKeys shortcut={model.content.shortcut} />
        )}
      </Button>
    ),
  };
}
