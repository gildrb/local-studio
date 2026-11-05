import type {
  DesktopCaptureConfigApplied,
  DesktopCaptureConfigPreview,
  DesktopSnapShotState,
} from "@t3tools/contracts";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo, useState } from "react";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import { resolveDiffThemeName } from "../../lib/diffRendering";
import { useTheme } from "../../hooks/useTheme";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import {
  buildCaptureShortcutConfigModel,
  captureConfigApplyError,
  captureConfigPreviewDiff,
  captureConfigPreviewError,
  resolveCaptureConfigApplied,
  resolveCaptureConfigPreviewRequest,
  resolveCaptureShortcutRecordedKeys,
  resolveCaptureShortcutRecorder,
  type CaptureShortcutConfigError,
  type CaptureShortcutConfigOperation,
  type CaptureShortcutConfigWorking,
} from "./CaptureShortcutConfig.logic";
import { useSnapShotShortcutRecorder } from "./useSnapShotShortcutRecorder";

/** Wizard-owned config review; config contents never leave the desktop bridge. */
export function CaptureShortcutConfig({
  state,
  disabled = false,
  onBusyChange,
  onSaved,
  onComplete,
}: {
  state: DesktopSnapShotState;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onSaved?: () => Promise<unknown>;
  onComplete?: () => Promise<void>;
}) {
  const bridge = getDesktopSnapShotBridge();
  const { resolvedTheme } = useTheme();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const [preview, setPreview] = useState<DesktopCaptureConfigPreview | null>(null);
  const [result, setResult] = useState<DesktopCaptureConfigApplied | null>(null);
  const [error, setError] = useState<CaptureShortcutConfigError | null>(null);
  const [working, setWorking] = useState<CaptureShortcutConfigWorking | null>(null);
  const [keys, setKeys] = useState<string | null>(null);
  const [customFile, setCustomFile] = useState(false);
  const supported = Boolean(bridge?.previewSnapShotConfig && bridge.applySnapShotConfig);
  const recorderSetup = resolveCaptureShortcutRecorder({ disabled, working, keys, preview });
  const recorder = useSnapShotShortcutRecorder({
    shortcut: recorderSetup.shortcut,
    disabled: recorderSetup.disabled,
    allowModifierPairs: false,
    onStart: () => setError(null),
    onError: (message) => setError({ message }),
    onRecord: (shortcut) => {
      const recordedKeys = resolveCaptureShortcutRecordedKeys(shortcut);
      if (recordedKeys === null) return;
      setKeys(recordedKeys);
      setPreview(null);
      setError(null);
    },
  });
  const model = buildCaptureShortcutConfigModel({
    state,
    supported,
    disabled,
    recording: recorder.recording,
    working,
    preview,
    result,
    error,
    copied: isCopied,
    canComplete: Boolean(onComplete),
  });
  const actionBusy = recorderSetup.disabled || recorder.recording;
  const changed = model.preview?.changed ?? false;
  const diff = useMemo(
    () => (changed ? captureConfigPreviewDiff(preview) : null),
    [preview, changed],
  );
  const begin = (phase: CaptureShortcutConfigWorking) => {
    setWorking(phase);
    onBusyChange?.(true);
    setError(null);
  };
  const end = () => {
    setWorking(null);
    onBusyChange?.(false);
  };
  const read = async (
    chooseFile = customFile,
    operation: CaptureShortcutConfigOperation = "install",
  ) => {
    if (actionBusy || !bridge?.previewSnapShotConfig) return;
    begin("reading");
    setPreview(null);
    setResult(null);
    setCustomFile(chooseFile);
    try {
      setPreview(
        await bridge.previewSnapShotConfig(
          resolveCaptureConfigPreviewRequest({ operation, chooseFile, keys }),
        ),
      );
    } catch (cause) {
      setError(captureConfigPreviewError(cause));
    } finally {
      end();
    }
  };
  const apply = async () => {
    if (actionBusy || !preview || !bridge?.applySnapShotConfig) return;
    begin("writing");
    try {
      const applied = await bridge.applySnapShotConfig(preview.id);
      setResult(applied);
      await onSaved?.();
      const outcome = resolveCaptureConfigApplied({
        preview,
        applied,
        canComplete: Boolean(onComplete),
      });
      if (outcome.kind === "complete" && onComplete) {
        toastManager.add({ type: "success", ...outcome.toast });
        await onComplete();
      }
    } catch (cause) {
      setError(captureConfigApplyError(cause));
      setPreview(null);
    } finally {
      end();
    }
  };
  const advanced = model.advanced;

  return (
    <div className="space-y-4 text-sm">
      {model.shortcutLabel !== null ? (
        <div className="flex items-center justify-between gap-3">
          <span>{model.shortcutLabel}</span>
          {recorder.input}
        </div>
      ) : null}
      {model.recordingStatus !== null ? (
        <p role="status" className="text-xs text-muted-foreground">
          {model.recordingStatus}
        </p>
      ) : null}
      {model.resultMessage !== null ? (
        <p role="status">{model.resultMessage}</p>
      ) : model.preview ? (
        <>
          <p className="text-muted-foreground">{model.preview.message}</p>
          {diff ? (
            <div
              className="max-h-80 overflow-auto rounded-lg border text-xs"
              aria-label={model.preview.diffAriaLabel}
            >
              <FileDiff
                fileDiff={diff}
                options={{
                  diffStyle: "unified",
                  theme: resolveDiffThemeName(resolvedTheme),
                  overflow: "wrap",
                }}
              />
            </div>
          ) : null}
          {model.preview.note !== null ? (
            <p className="text-xs text-muted-foreground">{model.preview.note}</p>
          ) : null}
          <div className="flex gap-2">
            {model.preview.primaryButton ? (
              <Button
                disabled={model.preview.primaryButton.disabled}
                aria-busy={model.preview.primaryButton.ariaBusy}
                onClick={() => void apply()}
              >
                {model.preview.primaryButton.label}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={model.preview.cancelButton.disabled}
              onClick={() => setPreview(null)}
            >
              {model.preview.cancelButton.label}
            </Button>
          </div>
        </>
      ) : model.review ? (
        <>
          <p className="text-muted-foreground">{model.review.intro}</p>
          <Button
            disabled={model.review.button.disabled}
            aria-busy={model.review.button.ariaBusy}
            onClick={() => void read()}
          >
            {model.review.button.label}
          </Button>
          {model.review.unsupportedNote !== null ? (
            <p className="text-xs text-muted-foreground">{model.review.unsupportedNote}</p>
          ) : null}
        </>
      ) : null}
      {model.errorMessage !== null ? (
        <p role="alert" className="text-destructive">
          {model.errorMessage}
        </p>
      ) : null}
      {model.connectionStatus !== null ? (
        <p role="status" className="text-muted-foreground">
          {model.connectionStatus}
        </p>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{advanced.summary}</summary>
        <div className="mt-3 space-y-3">
          {advanced.troubleshooting !== null ? (
            <div className="space-y-1">
              <p className="font-medium text-foreground">{advanced.troubleshootingTitle}</p>
              <p className="break-words">{advanced.troubleshooting}</p>
            </div>
          ) : null}
          <div className="space-y-1">
            <p className="font-medium text-foreground">{advanced.settingsFileTitle}</p>
            <p className="break-all font-mono">{advanced.settingsFilePath}</p>
            {advanced.includeNote !== null ? <p>{advanced.includeNote}</p> : null}
            {advanced.linkNote !== null ? <p className="break-all">{advanced.linkNote}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={advanced.chooseFileButton.disabled}
              onClick={() => void read(true)}
            >
              {advanced.chooseFileButton.label}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={advanced.removeButton.disabled}
              onClick={() => void read(customFile, "remove")}
            >
              {advanced.removeButton.label}
            </Button>
            {advanced.reviewButton ? (
              <Button
                size="sm"
                variant="outline"
                disabled={advanced.reviewButton.disabled}
                onClick={() => void read()}
              >
                {advanced.reviewButton.label}
              </Button>
            ) : null}
          </div>
          <p>
            {advanced.settingsFileHelp} {advanced.configLocationNote}
          </p>
          {advanced.backupLabel !== null ? (
            <p className="break-all">{advanced.backupLabel}</p>
          ) : null}
          <p className="font-medium text-foreground">{advanced.manualSetupTitle}</p>
          <p>{advanced.manualSetupInstructions}</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/50 p-3">
            {advanced.binding}
          </pre>
          <Button
            size="sm"
            variant="outline"
            disabled={advanced.copyButton.disabled}
            onClick={() => {
              if (advanced.binding) copyToClipboard(advanced.binding);
            }}
          >
            {advanced.copyButton.label}
          </Button>
          <p>{advanced.turnOffNote}</p>
          {advanced.registrationStatus ? (
            <p role="status">{advanced.registrationStatus.message}</p>
          ) : null}
          {advanced.completeButton && onComplete ? (
            <Button
              size="sm"
              variant="outline"
              disabled={advanced.completeButton.disabled}
              onClick={() => void onComplete()}
            >
              {advanced.completeButton.label}
            </Button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
