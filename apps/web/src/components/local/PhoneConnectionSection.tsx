import { useCallback, useEffect, useRef, useState } from "react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react";

import type { EnvironmentId, PhoneConnectionPairing } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { requestConfirmDialog } from "../../confirmDialog";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  disablePhoneConnection,
  enablePhoneConnection,
  phoneConnectionStatus,
  rotatePhoneConnection,
} from "../../state/phoneConnection";
import { useEnvironmentQuery } from "../../state/query";
import { usePrimaryEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";

type PhoneCommandTarget = { environmentId: EnvironmentId; input: Record<string, never> };

type PhoneBusy = "enable" | "rotate" | "disable" | null;

const QR_BOX_CLASSNAME = "flex justify-center rounded-xl border border-border/60 bg-muted/30 p-4";

const describeFailure = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return "The phone connection request failed.";
};

export function PhoneConnectionSection() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId: EnvironmentId | null = primaryEnvironment?.environmentId ?? null;
  const status = useEnvironmentQuery(
    environmentId === null ? null : phoneConnectionStatus({ environmentId, input: {} }),
  );
  const [pairing, setPairing] = useState<PhoneConnectionPairing | null>(null);
  const [busy, setBusy] = useState<PhoneBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const pairingFetchAttempted = useRef(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "text" });
  const runEnable = useAtomCommand(enablePhoneConnection, { reportFailure: false });
  const runRotate = useAtomCommand(rotatePhoneConnection, { reportFailure: false });
  const runDisable = useAtomCommand(disablePhoneConnection, { reportFailure: false });

  const enabled = status.data?.enabled === true;
  const running = status.data?.running === true;

  useEffect(() => {
    if (environmentId === null || !enabled || pairing !== null || pairingFetchAttempted.current) {
      return;
    }
    pairingFetchAttempted.current = true;
    void runEnable({ environmentId, input: {} } satisfies PhoneCommandTarget).then((result) => {
      if (result._tag === "Failure") return;
      setPairing(Option.getOrNull(AsyncResult.value(result)));
    });
  }, [environmentId, enabled, pairing, runEnable]);

  const applyPairing = useCallback(
    (next: PhoneConnectionPairing | null) => {
      setPairing(next);
      setBusy(null);
      setError(null);
      status.refresh();
    },
    [status],
  );

  const fail = useCallback((cause: unknown) => {
    const message = describeFailure(cause);
    setError(message);
    setBusy(null);
    toastManager.add({
      type: "error",
      title: "Phone connection change failed",
      description: message,
    });
  }, []);

  const runPhone = useCallback(
    async <A,>(
      run: (target: PhoneCommandTarget) => Promise<AtomCommandResult<A, unknown>>,
      busyKind: Exclude<PhoneBusy, null>,
      successTitle: string,
    ): Promise<A | null | undefined> => {
      if (environmentId === null) return undefined;
      setBusy(busyKind);
      setError(null);
      const result = await run({ environmentId, input: {} });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) fail(squashAtomCommandFailure(result));
        else setBusy(null);
        return undefined;
      }
      const next = Option.getOrNull(AsyncResult.value(result));
      toastManager.add({ type: "success", title: successTitle });
      return next;
    },
    [environmentId, fail],
  );

  const handleEnable = useCallback(() => {
    void runPhone(runEnable, "enable", "Phone connection enabled").then((next) => {
      if (next !== undefined) applyPairing(next);
    });
  }, [applyPairing, runPhone]);

  const handleRotate = useCallback(async () => {
    const confirmed = await requestConfirmDialog(
      "Rotate the phone pairing token? Phones paired with the current code stop working until they scan the new one.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const next = await runPhone(runRotate, "rotate", "Phone pairing token rotated");
    if (next !== undefined) applyPairing(next);
  }, [applyPairing, runPhone]);

  const handleDisable = useCallback(async () => {
    const confirmed = await requestConfirmDialog(
      "Disable the phone connection? Paired phones lose access and the pairing token is removed.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const next = await runPhone(runDisable, "disable", "Phone connection disabled");
    if (next === undefined) return;
    pairingFetchAttempted.current = false;
    applyPairing(null);
  }, [applyPairing, runPhone]);

  const handleCopy = useCallback(() => {
    if (pairing === null) return;
    copyToClipboard(pairing.connectionJson);
    toastManager.add({ type: "success", title: "Connection JSON copied" });
  }, [copyToClipboard, pairing]);

  const nodeId = status.data?.nodeId ?? "";
  const statusLabel = !enabled ? "Off" : running ? "Live" : "Starting";
  const statusDescription = !enabled
    ? "Pair a phone with this server over the Alleycat wire. Enabling mints a pairing token and starts the host."
    : running
      ? `Accepting phone dials for node ${nodeId}`
      : "Waiting for the Alleycat host to come up";
  const dotClassName = !enabled ? "bg-muted-foreground/40" : running ? "bg-success" : "bg-warning";

  return (
    <SettingsSection title="Phone connection">
      {status.error !== null && (
        <p role="alert" className="px-3 pb-2 text-sm break-all text-destructive sm:px-4">
          {status.error}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="px-3 pb-2 text-sm break-all text-destructive sm:px-4">
          {error}
        </p>
      )}
      <SettingsRow
        title={statusLabel}
        description={statusDescription}
        control={
          <div className="flex items-center gap-2">
            <ConnectionStatusDot dotClassName={dotClassName} tooltipText={statusLabel} />
            {enabled ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== null || pairing === null}
                  onClick={handleCopy}
                >
                  {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                  Copy
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void handleRotate()}
                >
                  <RefreshCwIcon aria-hidden />
                  Rotate
                </Button>
                <Button
                  size="xs"
                  variant="destructive-outline"
                  disabled={busy !== null}
                  onClick={() => void handleDisable()}
                >
                  Disable
                </Button>
              </>
            ) : (
              <Button size="xs" variant="outline" disabled={busy !== null} onClick={handleEnable}>
                Enable
              </Button>
            )}
          </div>
        }
      />
      {pairing !== null && (
        <div className="flex flex-col items-center gap-3 px-3 pb-4 sm:px-4">
          <div className={QR_BOX_CLASSNAME}>
            <QRCodeSvg
              value={pairing.connectionJson}
              size={132}
              level="M"
              marginSize={2}
              title="Phone connection pairing code"
            />
          </div>
          <p className="text-2xs max-w-sm text-center break-all text-muted-foreground">
            In the phone app, scan this code or paste the connection JSON from the copy button. The
            code contains the node id {pairing.nodeId} and its pairing token.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
