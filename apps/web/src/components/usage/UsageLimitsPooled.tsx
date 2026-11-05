import { AlertTriangleIcon, ExternalLinkIcon, TicketIcon } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { Button } from "../ui/button";
import { OpenAI } from "../Icons";
import { Alert, AlertTitle } from "../ui/alert";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PaceIcon, ResetCreditDialog, type ResetCreditState, useResetCredit } from "./UsageLimits";
import {
  buildResetCreditButtonModel,
  type UsageLimitAccountChipModel,
  type UsageLimitAccountModel,
  type UsageLimitPoolSectionModel,
  type UsageLimitPoolWindowModel,
  type UsageLimitPopoverRow,
  type UsageLimitSegmentModel,
  type UsageLimitsModel,
} from "./UsageLimits.logic";

function AccountChip({ chip }: { readonly chip: UsageLimitAccountChipModel }) {
  return (
    <span
      role="img"
      aria-label={chip.ariaLabel}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-3xs leading-none font-semibold"
      style={{ backgroundColor: chip.background, color: chip.foreground }}
    >
      {chip.initials}
    </span>
  );
}

/**
 * The same mark the model picker uses for a native instance (provider glyph,
 * initials badge, accent); hub accounts have no instance, so they get the chip.
 */
function AccountAvatar({ account }: { readonly account: UsageLimitAccountModel }) {
  if (account.avatar.kind === "instance") {
    return (
      <ProviderInstanceIcon
        driverKind={account.driver}
        displayName={account.avatar.displayName}
        accentColor={account.avatar.accentColor ?? undefined}
        showBadge={account.avatar.showBadge}
        indicatorBackground="var(--popover)"
        className="size-5"
        iconClassName="size-4 text-foreground/80"
      />
    );
  }
  return account.avatar.kind === "chip" && account.chip ? (
    <AccountChip chip={account.chip} />
  ) : null;
}

/**
 * Who an account is, without printing the email: the instance name when there
 * is one, else a two-letter chip. The address itself is revealed on demand in
 * the segment's popover.
 */
function AccountName({
  account,
  className,
}: {
  readonly account: UsageLimitAccountModel;
  readonly className?: string;
}) {
  if (account.name.kind === "text") return <span className={className}>{account.name.text}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center", className)}>
      {account.chip ? <AccountChip chip={account.chip} /> : null}
    </span>
  );
}

function Row({ row }: { readonly row: UsageLimitPopoverRow }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{row.label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{row.value}</span>
    </div>
  );
}

/**
 * Everything about one account in one window: plan, where it is signed in,
 * the email on request, reset time and share of the pool it restores, and the
 * reset-credit action. Opens on hover for a glance, on click to act.
 */
function SegmentPopover({
  segment,
  redeem,
  onRedeem,
}: {
  readonly segment: UsageLimitSegmentModel;
  readonly redeem: ResetCreditState | null;
  readonly onRedeem: () => void;
}) {
  const button = redeem ? buildResetCreditButtonModel(redeem.busy) : null;
  return (
    <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AccountAvatar account={segment.account} />
          <span className="truncate">{segment.account.title}</span>
        </span>
        {segment.account.email ? (
          <RedactedSensitiveText
            value={segment.account.email}
            ariaLabel="Toggle account email visibility"
            revealTooltip="Click to reveal email"
            hideTooltip="Click to hide email"
            className="w-fit"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {segment.popover.identityRows.map((row) => (
          <Row key={row.label} row={row} />
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {segment.popover.statusRows.map((row) => (
          <Row key={row.label} row={row} />
        ))}
      </div>
      {segment.popover.creditsSummary !== null && button ? (
        <div className="border-t border-border/60 pt-2.5 text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="tabular-nums">{segment.popover.creditsSummary}</span>
            <Button
              size="xs"
              variant="outline"
              disabled={button.disabled}
              className="ms-auto"
              onClick={onRedeem}
            >
              {button.label}
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One account's share of one pooled window: the segment, its popover, and the
 * reset confirm. The confirm is a sibling of the popover, not a child: dialogs
 * stack under popovers, and the popover closes as the confirm opens.
 */
function PoolSegment({
  segment,
  color,
}: {
  readonly segment: UsageLimitSegmentModel;
  readonly color: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        render={
          <button
            type="button"
            style={{ gridColumn: segment.index, gridRow: 1 }}
            aria-label={segment.ariaLabel}
            className="relative h-5 min-w-0 cursor-pointer overflow-hidden rounded-md bg-muted text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[popup-open]:ring-1 data-[popup-open]:ring-border @2xl/pool:h-8"
          />
        }
      >
        {/* Translucent so the label reads over the fill for any provider colour and theme. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-md opacity-35"
          style={{ width: segment.fillWidth, backgroundColor: color }}
        />
        {/* The spent share is hatched, not blank: it is what the countdown restores. */}
        {segment.hatchWidth !== null ? (
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 opacity-20"
            style={{
              width: segment.hatchWidth,
              backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px 5px)`,
            }}
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-3xs leading-none font-semibold text-foreground/80 tabular-nums @2xl/pool:hidden"
        >
          {segment.index}
        </span>
        <div className="relative hidden h-full min-w-0 items-center gap-1.5 px-2 text-xs @2xl/pool:flex">
          {segment.showAccountName ? (
            <AccountName
              account={segment.account}
              className="min-w-0 truncate font-medium text-foreground"
            />
          ) : null}
          <span className="shrink-0 font-semibold text-foreground tabular-nums">
            {segment.remainingLabel}
          </span>
          {/* Countdown and badge get their own plate: fill and hatching run under them otherwise. */}
          <span className="ms-auto flex shrink-0 items-center gap-1.5 rounded-sm bg-background/85 px-1.5 py-0.5 text-2xs text-foreground tabular-nums">
            {segment.countdown}
            {segment.credits ? (
              <>
                {segment.countdown ? (
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                ) : null}
                <span aria-hidden className="inline-flex items-center gap-0.5 font-semibold">
                  <TicketIcon className="size-3" aria-hidden />
                  {segment.credits}
                </span>
              </>
            ) : null}
          </span>
        </div>
      </PopoverTrigger>
      <LegendRow segment={segment} color={color} />
      {segment.redeem ? (
        <RedeemableSegmentPopup
          segment={segment}
          redeemAt={segment.redeem}
          closePopover={() => setOpen(false)}
        />
      ) : (
        <PopoverPopup side="top" sideOffset={6}>
          <SegmentPopover segment={segment} redeem={null} onRedeem={() => {}} />
        </PopoverPopup>
      )}
    </Popover>
  );
}

/**
 * Below the strip at narrow widths: one row per account in bar order, carrying
 * the text the segment has no room for. Tapping a row opens the same popover
 * as its segment, so the two are one control with two handles.
 */
function LegendRow({
  segment,
  color,
}: {
  readonly segment: UsageLimitSegmentModel;
  readonly color: string;
}) {
  return (
    <PopoverTrigger
      style={{ gridColumn: "1 / -1", gridRow: segment.index + 1 }}
      render={<Button variant="ghost" size="compact" />}
      className="min-w-0 @2xl/pool:hidden"
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-3xs leading-none font-semibold text-foreground/80 tabular-nums">
        <span
          aria-hidden
          className="absolute inset-0 rounded-sm opacity-35"
          style={{ backgroundColor: color }}
        />
        <span className="sr-only">Segment </span>
        <span className="relative">{segment.index}</span>
      </span>
      <AccountName
        account={segment.account}
        className="min-w-0 truncate font-medium text-foreground"
      />
      <span className="shrink-0 font-semibold text-foreground tabular-nums">
        {segment.remainingLabel}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
        {segment.countdown}
        {segment.credits ? (
          <>
            {segment.countdown ? <span aria-hidden>·</span> : null}
            <span
              aria-hidden
              className="inline-flex items-center gap-0.5 font-semibold text-foreground"
            >
              <TicketIcon className="size-3" aria-hidden />
              {segment.credits}
            </span>
            <span className="sr-only">{segment.creditsLabel}</span>
          </>
        ) : null}
      </span>
    </PopoverTrigger>
  );
}

/** Split out so the redeem hook only runs for accounts that can redeem. */
function RedeemableSegmentPopup({
  segment,
  redeemAt,
  closePopover,
}: {
  readonly segment: UsageLimitSegmentModel;
  readonly redeemAt: NonNullable<UsageLimitSegmentModel["redeem"]>;
  readonly closePopover: () => void;
}) {
  const redeem = useResetCredit(redeemAt.environmentId, redeemAt.input);
  return (
    <>
      <PopoverPopup side="top" sideOffset={6}>
        <SegmentPopover
          segment={segment}
          redeem={redeem}
          onRedeem={() => {
            closePopover();
            redeem.setConfirming(true);
          }}
        />
      </PopoverPopup>
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        onConfirm={() => void redeem.redeem()}
      />
      {/* The popover closed before the confirm, so the outcome needs a home outside it. */}
      {redeem.status ? (
        <span role="status" className="col-span-full text-xs text-muted-foreground">
          <AccountName account={segment.account} className="font-medium text-foreground" />{" "}
          {redeem.status}
        </span>
      ) : null}
    </>
  );
}

/**
 * One pooled window as equal-width segments, one per account, each filled by
 * the share of that account's quota still open. Equal widths are honest: every
 * account contributes the same share of the pool, whatever its plan.
 *
 * Wide, each segment carries its own label. Narrow, the bar is a bare strip
 * and a legend below lists the accounts in the same order; both open the
 * same popover.
 */
function PoolWindowCard({
  window,
  color,
}: {
  readonly window: UsageLimitPoolWindowModel;
  readonly color: string;
}) {
  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{window.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {window.remainingLabel}
          </span>
          <span className="text-sm text-muted-foreground">{window.leftLabel}</span>
          {window.pace ? <PaceIcon pace={window.pace} /> : null}
        </span>
        {window.nextRefillLabel !== null ? (
          <span className="text-xs font-medium text-foreground tabular-nums">
            {window.nextRefillLabel}
          </span>
        ) : null}
      </div>
      <div className="@container/pool min-w-0">
        <div
          className="grid gap-x-1 gap-y-1"
          style={{ gridTemplateColumns: window.gridTemplateColumns }}
        >
          {window.segments.map((segment) => (
            <PoolSegment key={segment.key} segment={segment} color={color} />
          ))}
        </div>
      </div>
      {window.description ? (
        <p className="text-xs text-muted-foreground md:col-span-2">{window.description}</p>
      ) : null}
    </div>
  );
}

function PoolSection({ section }: { readonly section: UsageLimitPoolSectionModel }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ProviderInstanceIcon
          driverKind={section.driver}
          displayName={section.label}
          indicatorBackground="var(--background)"
          className="size-5"
          iconClassName="size-4 text-foreground/80"
        />
        {section.label}
      </h2>
      {section.windows.map((window) => (
        <PoolWindowCard key={window.key} window={window} color={section.color} />
      ))}
    </section>
  );
}

/**
 * Subscription quota across every connected environment's providers and hubs,
 * pooled per provider. The page advances `now` on explicit refresh rather than
 * ticking: a live clock would repaint the page for no decision-changing gain.
 */
export function UsageLimitsPooled({
  model,
  cursorPrompt,
}: {
  readonly model: UsageLimitsModel;
  readonly cursorPrompt?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      {model.emptyMessage !== null ? (
        <p className="text-sm text-muted-foreground">{model.emptyMessage}</p>
      ) : null}
      {model.sections.map((section, index) => (
        <Fragment key={section.driver}>
          {index === model.cursorPromptIndex ? cursorPrompt : null}
          <PoolSection section={section} />
        </Fragment>
      ))}
      {model.cursorPromptIndex === model.sections.length ? cursorPrompt : null}
      {model.externalLinks.map((link) => (
        <section
          key={link.url}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {link.icon === "openai" ? (
              <OpenAI className="size-5 shrink-0" aria-hidden="true" />
            ) : null}
            <div className="min-w-0 space-y-1">
              <h2 className="text-sm font-medium">{link.label}</h2>
              {link.description !== null ? (
                <p
                  className={
                    link.icon === "openai"
                      ? "text-xs text-muted-foreground"
                      : "max-w-xl text-xs text-muted-foreground"
                  }
                >
                  {link.description}
                </p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => void ensureLocalApi().shell.openExternal(link.url)}
          >
            {link.buttonLabel}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </section>
      ))}
      <LimitNotices notices={model.notices} />
    </div>
  );
}

/** Sources and providers that could not be read, so a missing bar is not mistaken for a full one. */
function LimitNotices({ notices }: { readonly notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <Alert variant="warning" controlAlignment="first-line">
      <AlertTriangleIcon />
      {notices.map((notice) => (
        <AlertTitle key={notice} className="break-words">
          {notice}
        </AlertTitle>
      ))}
    </Alert>
  );
}
