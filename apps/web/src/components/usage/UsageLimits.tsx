import {
  type EnvironmentId,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { GaugeIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildLimitWindowsModel,
  buildResetCreditsModel,
  RESET_CREDIT_DIALOG_COPY,
  resetCreditResultOf,
  resolveResetCreditStatus,
  type UsageLimitPaceIcon,
  type UsageLimitPaceModel,
  type UsageLimitWindowBarModel,
} from "./UsageLimits.logic";

const PACE_ICONS: Record<UsageLimitPaceIcon, typeof GaugeIcon> = {
  gauge: GaugeIcon,
  "trending-up": TrendingUpIcon,
  "trending-down": TrendingDownIcon,
};

/** Pace as a glyph with the words on hover. */
export function PaceIcon({ pace }: { readonly pace: UsageLimitPaceModel }) {
  const Icon = PACE_ICONS[pace.icon];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span role="img" aria-label={pace.label} className="inline-flex text-muted-foreground" />
        }
      >
        <Icon className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="top">{pace.label}</TooltipPopup>
    </Tooltip>
  );
}

function WindowBar({
  color,
  bar,
}: {
  readonly color: string;
  readonly bar: UsageLimitWindowBarModel;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="img"
            aria-label={bar.ariaLabel}
            tabIndex={0}
            className="relative h-6 cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        }
      >
        <div className="absolute inset-x-0 inset-y-1.5 rounded-full bg-muted" />
        {bar.fillWidth !== null ? (
          <div
            className="absolute inset-y-1.5 left-0 rounded-full"
            style={{ width: bar.fillWidth, backgroundColor: color }}
          />
        ) : null}
        {bar.markerLeft !== null ? (
          <span
            aria-hidden
            className="absolute inset-y-0.5 w-px -translate-x-1/2 bg-foreground/60"
            style={{ left: bar.markerLeft }}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">{bar.tooltipTitle}</span>
          {bar.tooltipHint !== null ? (
            <span className="text-muted-foreground">{bar.tooltipHint}</span>
          ) : null}
          {bar.tooltipResets !== null ? (
            <span className="text-muted-foreground">{bar.tooltipResets}</span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * One account's windows as rows: label and percent, bar, pace and countdown.
 * Compact rows fit the composer panel with narrower columns.
 */
export function LimitWindows({
  driver,
  windows,
  now,
  compact = false,
}: {
  readonly driver: ServerProvider["driver"];
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
  readonly compact?: boolean;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const model = buildLimitWindowsModel({ driver, windows, nowMs: now, timestampFormat });
  return (
    <div
      className={
        compact
          ? "grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] gap-x-3 gap-y-0.5"
          : "grid grid-cols-[11rem_minmax(0,1fr)_7rem] gap-x-4 gap-y-1"
      }
    >
      {model.rows.map((row) => (
        <Fragment key={row.id}>
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground">{row.label}</span>
            <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
              {row.remainingLabel}
            </span>
          </span>
          <WindowBar color={model.color} bar={row.bar} />
          <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {row.pace ? <PaceIcon pace={row.pace} /> : null}
            <span className="ms-auto shrink-0">{row.resetsIn}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export type ResetCreditState = {
  readonly confirming: boolean;
  readonly setConfirming: (confirming: boolean) => void;
  readonly busy: boolean;
  readonly status: string | null;
  readonly redeem: () => Promise<void>;
};

/** Everything a redeem needs: where to send it and what to say afterwards. */
export function useResetCredit(
  environmentId: EnvironmentId,
  input: ProviderConsumeResetCreditInput,
): ResetCreditState {
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const redeem = async () => {
    setConfirming(false);
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input });
    setBusy(false);
    setStatus(resolveResetCreditStatus(resetCreditResultOf(result)));
  };

  return { confirming, setConfirming, busy, status, redeem };
}

/**
 * The confirm for a redeem. Redeeming spends a credit the provider granted the
 * user, so it never fires on a bare click. Mount it outside any popover that
 * holds the button: dialogs stack under popovers, and closing the popover
 * would unmount a dialog rendered inside it.
 */
export function ResetCreditDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{RESET_CREDIT_DIALOG_COPY.title}</AlertDialogTitle>
          <AlertDialogDescription>{RESET_CREDIT_DIALOG_COPY.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {RESET_CREDIT_DIALOG_COPY.cancelLabel}
          </AlertDialogClose>
          <Button onClick={onConfirm}>{RESET_CREDIT_DIALOG_COPY.confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** Banked reset credits with the redeem button and its confirm, self-contained. */
export function ResetCredits({
  environmentId,
  input,
  credits,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
}) {
  const { confirming, setConfirming, busy, status, redeem } = useResetCredit(environmentId, input);
  const model = buildResetCreditsModel({ credits, nowMs: now, busy, status });
  if (!model.visible) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="tabular-nums">{model.summary}</span>
      {model.button ? (
        <Button
          size="xs"
          variant="outline"
          disabled={model.button.disabled}
          onClick={() => setConfirming(true)}
        >
          {model.button.label}
        </Button>
      ) : null}
      {model.status ? <span className="text-foreground">{model.status}</span> : null}
      <ResetCreditDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void redeem()}
      />
    </div>
  );
}
