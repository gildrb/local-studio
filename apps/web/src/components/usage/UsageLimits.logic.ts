import type {
  EnvironmentId,
  ProviderConsumeResetCreditInput,
  ProviderConsumeResetCreditOutcome,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  CHATGPT_USAGE_URL,
  collectExternalUsageLinks,
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  elapsedShare,
  formatDuration,
  formatResetsIn,
  type LimitAccount,
  type LimitPace,
  type LimitPool,
  type LimitPoolWindow,
  type LimitPresentations,
  paceOf,
  remainingPercent,
} from "@t3tools/shared/usageLimits";

import { formatUpcomingTimestamp } from "../../timestampFormat";
import { getDriverLabel } from "../settings/providerDriverMeta.logic";
import { USAGE_PROVIDER_STYLES } from "./usageProviders.logic";

export type UsageLimitPaceIcon = "gauge" | "trending-up" | "trending-down";

export type UsageLimitPaceModel = {
  readonly pace: LimitPace;
  readonly label: string;
  readonly icon: UsageLimitPaceIcon;
};

const PACE: Record<LimitPace, { readonly label: string; readonly icon: UsageLimitPaceIcon }> = {
  ahead: {
    label: "Ahead of pace: spending faster than the window elapses",
    icon: "trending-up",
  },
  on: { label: "On pace with the window", icon: "gauge" },
  under: {
    label: "Under pace: headroom left for the rest of the window",
    icon: "trending-down",
  },
};

export function buildLimitPaceModel(pace: LimitPace | null): UsageLimitPaceModel | null {
  return pace === null ? null : { pace, ...PACE[pace] };
}

/** The series colour the cost chart uses for this driver, so the two views read as one. */
export function barColor(driver: ServerProvider["driver"]): string {
  const kind: UsageProviderKind | undefined =
    driver === "codex" ? "codex" : driver === "claudeAgent" ? "claude" : undefined;
  return kind ? USAGE_PROVIDER_STYLES[kind].color : "var(--foreground)";
}

export type UsageLimitWindowBarModel = {
  readonly ariaLabel: string;
  readonly remainingPercent: number;
  readonly fillWidth: string | null;
  readonly timeLeftPercent: number | null;
  readonly markerLeft: string | null;
  readonly tooltipTitle: string;
  readonly tooltipHint: string | null;
  readonly tooltipResets: string | null;
};

export type UsageLimitWindowRowModel = {
  readonly id: string;
  readonly label: string;
  readonly remainingLabel: string;
  readonly bar: UsageLimitWindowBarModel;
  readonly pace: UsageLimitPaceModel | null;
  readonly resetsIn: string;
};

export type UsageLimitWindowsInput = {
  readonly driver: ServerProvider["driver"];
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly nowMs: number;
  readonly timestampFormat: TimestampFormat;
};

export type UsageLimitWindowsModel = {
  readonly color: string;
  readonly rows: readonly UsageLimitWindowRowModel[];
};

/**
 * One window as a full-width bar from the moment it opened to its reset.
 * The fill is the share of quota spent; the hairline is how far into the
 * window the clock is, which is also where even spending would have put the
 * fill. Hover for the exact figures and reset time.
 */
export function buildLimitWindowBarModel(
  window: ServerProviderUsageWindow,
  nowMs: number,
  timestampFormat: TimestampFormat,
): UsageLimitWindowBarModel {
  const remaining = remainingPercent(window);
  const elapsed = elapsedShare(window, nowMs);
  // The fill is quota left, so the even-spending mark is the time left.
  const timeLeft = elapsed === null ? null : Math.round((1 - elapsed) * 100);
  const resetsIn = formatResetsIn(window, nowMs);
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, nowMs)
    : null;
  return {
    ariaLabel: `${window.label}: ${remaining}% left${
      timeLeft === null ? "" : `, ${timeLeft}% of the window left`
    }${resetsIn ? `, ${resetsIn}` : ""}`,
    remainingPercent: remaining,
    fillWidth: remaining > 0 ? `${remaining}%` : null,
    timeLeftPercent: timeLeft,
    markerLeft: timeLeft === null ? null : `${timeLeft}%`,
    tooltipTitle: `${remaining}% left${timeLeft !== null ? ` · ${timeLeft}% of the window left` : ""}`,
    tooltipHint: timeLeft !== null ? "The line is where even spending would be." : null,
    tooltipResets: resetsAt ? `Resets ${resetsAt}${resetsIn ? ` · ${resetsIn}` : ""}` : null,
  };
}

/** One account's windows as rows: label and percent, bar, pace and countdown. */
export function buildLimitWindowsModel(input: UsageLimitWindowsInput): UsageLimitWindowsModel {
  return {
    color: barColor(input.driver),
    rows: input.windows.map((window) => ({
      id: window.id,
      label: window.label,
      remainingLabel: `${remainingPercent(window)}% left`,
      bar: buildLimitWindowBarModel(window, input.nowMs, input.timestampFormat),
      pace: buildLimitPaceModel(paceOf(window, input.nowMs)),
      resetsIn: formatResetsIn(window, input.nowMs) ?? "",
    })),
  };
}

export const RESET_CREDIT_OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

export const RESET_CREDIT_DIALOG_COPY: {
  readonly title: string;
  readonly description: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
} = {
  title: "Use a reset credit?",
  description:
    "This redeems one credit on your account and clears the current rate-limit windows. It cannot be undone.",
  cancelLabel: "Cancel",
  confirmLabel: "Use credit",
};

export type ResetCreditResult =
  | {
      readonly kind: "success";
      readonly outcome: ProviderConsumeResetCreditOutcome;
      readonly warning: string | null | undefined;
    }
  | { readonly kind: "failure"; readonly errorMessage: string | null };

export function resolveResetCreditStatus(result: ResetCreditResult): string {
  if (result.kind === "success") return result.warning ?? RESET_CREDIT_OUTCOME_TEXT[result.outcome];
  return result.errorMessage ?? "Could not use the reset credit.";
}

export type ResetCreditCommandResult =
  | {
      readonly _tag: "Success";
      readonly value: {
        readonly outcome: ProviderConsumeResetCreditOutcome;
        readonly warning?: string | null | undefined;
      };
    }
  | { readonly _tag: "Failure"; readonly cause: object };

export function resetCreditResultOf(result: ResetCreditCommandResult): ResetCreditResult {
  return result._tag === "Success"
    ? { kind: "success", outcome: result.value.outcome, warning: result.value.warning }
    : {
        kind: "failure",
        errorMessage:
          "error" in result.cause && result.cause.error instanceof Error
            ? result.cause.error.message
            : null,
      };
}

/** `2 reset credits banked · next expires in 27d 23h`, or the short form for a popover. */
export function resetCreditsSummary(
  credits: ServerProviderResetCredits,
  now: number,
  compact = false,
): string {
  const expiresIn = credits.nextExpiresAt
    ? formatDuration(Date.parse(credits.nextExpiresAt) - now)
    : null;
  if (credits.availableCount === 0) return "No reset credits banked";
  if (compact)
    return `${credits.availableCount} banked${expiresIn ? ` · expires in ${expiresIn}` : ""}`;
  return `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${
    expiresIn ? ` · next expires in ${expiresIn}` : ""
  }`;
}

export type ResetCreditButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
};

export function buildResetCreditButtonModel(busy: boolean): ResetCreditButtonModel {
  return { label: busy ? "Using…" : "Use reset", disabled: busy };
}

export type ResetCreditsInput = {
  readonly credits: ServerProviderResetCredits;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly status: string | null;
};

export type ResetCreditsModel = {
  readonly visible: boolean;
  readonly summary: string;
  readonly button: ResetCreditButtonModel | null;
  readonly status: string | null;
};

export function buildResetCreditsModel(input: ResetCreditsInput): ResetCreditsModel {
  return {
    visible: input.credits.availableCount > 0 || input.status !== null,
    summary: resetCreditsSummary(input.credits, input.nowMs),
    button: input.credits.availableCount > 0 ? buildResetCreditButtonModel(input.busy) : null,
    status: input.status,
  };
}

/** `someone@example.com` → `SE`: enough to tell accounts apart, too little to identify one. */
export function accountInitials(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
}

/** A stable hue per email, so the same account gets the same chip on every visit. */
export function accountHue(email: string): number {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) {
    hash = (hash * 31 + email.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

export type UsageLimitAccountChipModel = {
  readonly initials: string;
  readonly ariaLabel: string;
  readonly background: string;
  readonly foreground: string;
};

export type UsageLimitAccountModel = {
  readonly key: string;
  readonly driver: ServerProvider["driver"];
  readonly title: string;
  readonly name: { readonly kind: "text"; readonly text: string } | { readonly kind: "chip" };
  readonly avatar:
    | {
        readonly kind: "instance";
        readonly displayName: string;
        readonly accentColor: string | null;
        readonly showBadge: boolean;
      }
    | { readonly kind: "chip" }
    | { readonly kind: "none" };
  readonly chip: UsageLimitAccountChipModel | null;
  readonly email: string | null;
};

export function buildUsageLimitAccountModel(account: LimitAccount): UsageLimitAccountModel {
  const driverLabel = getDriverLabel(account.driver) ?? String(account.driver);
  const title = account.displayName ?? driverLabel;
  const hue = account.email ? accountHue(account.email) : null;
  return {
    key: account.key,
    driver: account.driver,
    title,
    name: account.displayName
      ? { kind: "text", text: account.displayName }
      : account.email
        ? { kind: "chip" }
        : { kind: "text", text: driverLabel },
    avatar: account.redeem
      ? {
          kind: "instance",
          displayName: title,
          accentColor: account.accentColor ?? null,
          showBadge: Boolean(account.displayName),
        }
      : account.email
        ? { kind: "chip" }
        : { kind: "none" },
    chip:
      account.email && hue !== null
        ? {
            initials: accountInitials(account.email),
            ariaLabel: `Account ${accountInitials(account.email)}`,
            background: `oklch(0.85 0.08 ${hue})`,
            foreground: `oklch(0.35 0.1 ${hue})`,
          }
        : null,
    email: account.email ?? null,
  };
}

export type UsageLimitPopoverRow = {
  readonly label: string;
  readonly value: string;
};

export type UsageLimitSegmentModel = {
  readonly key: string;
  readonly index: number;
  readonly account: UsageLimitAccountModel;
  readonly ariaLabel: string;
  readonly remainingPercent: number;
  readonly remainingLabel: string;
  readonly fillWidth: string;
  readonly hatchWidth: string | null;
  readonly showAccountName: boolean;
  readonly countdown: string;
  readonly credits: number;
  readonly creditsLabel: string | null;
  readonly popover: {
    readonly identityRows: readonly UsageLimitPopoverRow[];
    readonly statusRows: readonly UsageLimitPopoverRow[];
    readonly creditsSummary: string | null;
  };
  readonly redeem: {
    readonly environmentId: EnvironmentId;
    readonly input: ProviderConsumeResetCreditInput;
  } | null;
};

export type UsageLimitPoolWindowModel = {
  readonly key: string;
  readonly label: string;
  readonly remainingLabel: string;
  readonly leftLabel: string;
  readonly pace: UsageLimitPaceModel | null;
  readonly nextRefillLabel: string | null;
  readonly description: string | null;
  readonly columnCount: number;
  readonly gridTemplateColumns: string;
  readonly segments: readonly UsageLimitSegmentModel[];
};

export type UsageLimitPoolSectionModel = {
  readonly driver: ServerProvider["driver"];
  readonly label: string;
  readonly color: string;
  readonly windows: readonly UsageLimitPoolWindowModel[];
};

export type UsageLimitExternalLinkModel = {
  readonly url: string;
  readonly label: string;
  readonly icon: "openai" | null;
  readonly description: string | null;
  readonly buttonLabel: string;
};

export type UsageLimitsInput = {
  readonly presentations: LimitPresentations;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly nowMs: number;
  readonly timestampFormat: TimestampFormat;
  readonly hasCursorPrompt: boolean;
};

export type UsageLimitsModel = {
  readonly emptyMessage: string | null;
  readonly sections: readonly UsageLimitPoolSectionModel[];
  readonly cursorPromptIndex: number;
  readonly externalLinks: readonly UsageLimitExternalLinkModel[];
  readonly notices: readonly string[];
};

function countdownOf(resetsIn: string | null): string {
  return resetsIn?.replace("resets in ", "↻ ") ?? "";
}

function creditsPhrase(credits: number): string {
  return `${credits} reset ${credits === 1 ? "credit" : "credits"} banked`;
}

function buildSegmentModel(
  account: LimitAccount,
  window: ServerProviderUsageWindow,
  reset: LimitPoolWindow["resets"][number] | undefined,
  index: number,
  showAccountName: boolean,
  nowMs: number,
  timestampFormat: TimestampFormat,
): UsageLimitSegmentModel {
  const remaining = remainingPercent(window);
  const resetsIn = formatResetsIn(window, nowMs);
  const credits = account.limits.resetCredits?.availableCount ?? 0;
  const where =
    account.environments.length > 0
      ? account.environments.map((environment) => environment.label).join(", ")
      : account.sourceLabel;
  const identityRows: UsageLimitPopoverRow[] = [];
  if (account.plan) identityRows.push({ label: "Plan", value: account.plan });
  if (where)
    identityRows.push({
      label: account.environments.length > 0 ? "Signed in" : "Via",
      value: where,
    });
  const statusRows: UsageLimitPopoverRow[] = [{ label: "Left", value: `${remaining}%` }];
  if (window.resetsAt)
    statusRows.push({
      label: "Resets",
      value: `${formatUpcomingTimestamp(window.resetsAt, timestampFormat, nowMs)}${
        resetsIn ? ` · ${resetsIn.replace("resets in ", "in ")}` : ""
      }`,
    });
  if (reset && reset.restoresPercent > 0)
    statusRows.push({ label: "Restores", value: `+${reset.restoresPercent}% of pool` });
  const bankedCredits =
    account.redeem && account.limits.resetCredits?.availableCount
      ? account.limits.resetCredits
      : null;
  return {
    key: account.key,
    index,
    account: buildUsageLimitAccountModel(account),
    ariaLabel: `${account.displayName ?? (account.email ? accountInitials(account.email) : account.driver)}: ${remaining}% left${resetsIn ? `, ${resetsIn}` : ""}${credits ? `, ${creditsPhrase(credits)}` : ""}`,
    remainingPercent: remaining,
    remainingLabel: `${remaining}%`,
    fillWidth: `${remaining}%`,
    hatchWidth: remaining < 100 && reset ? `${100 - remaining}%` : null,
    showAccountName,
    countdown: countdownOf(resetsIn),
    credits,
    creditsLabel: credits ? creditsPhrase(credits) : null,
    popover: {
      identityRows,
      statusRows,
      creditsSummary: bankedCredits ? resetCreditsSummary(bankedCredits, nowMs, true) : null,
    },
    redeem: account.redeem,
  };
}

/**
 * Big pooled number and the segment bar. Accounts keep the same column across
 * windows; each segment's popover shows its own reset time and share restored.
 */
function buildPoolWindowModel(
  pool: LimitPool,
  window: LimitPoolWindow,
  nowMs: number,
  timestampFormat: TimestampFormat,
): UsageLimitPoolWindowModel {
  const details = pool.driver === "cursor" ? cursorUsageWindowDetails(window.id) : undefined;
  // The soonest reset that hands anything back; an untouched account resets to no effect.
  const nextRefill = window.resets.find((reset) => reset.restoresPercent > 0);
  const restores = new Map(window.resets.map((reset) => [reset.member.account.key, reset]));
  return {
    key: `${window.kind}:${window.id}`,
    label: details?.label ?? window.label,
    remainingLabel: `${window.remainingPercent}%`,
    leftLabel: "left",
    pace: buildLimitPaceModel(window.pace),
    nextRefillLabel:
      nextRefill && window.columns.length > 1 ? `↻ +${nextRefill.restoresPercent}%` : null,
    description: details?.description ?? null,
    columnCount: window.columns.length,
    gridTemplateColumns: `repeat(${window.columns.length}, minmax(0, 1fr))`,
    segments: window.columns.flatMap((member, position) =>
      member.window
        ? [
            buildSegmentModel(
              member.account,
              member.window,
              restores.get(member.account.key),
              position + 1,
              window.columns.length > 1,
              nowMs,
              timestampFormat,
            ),
          ]
        : [],
    ),
  };
}

export function selectLimitPresentations<T>(
  presentations: ReadonlyMap<EnvironmentId, T>,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
): ReadonlyMap<EnvironmentId, T> {
  return selectedEnvironmentIds === null
    ? presentations
    : new Map([...presentations].filter(([id]) => selectedEnvironmentIds.has(id)));
}

/**
 * Accounts pooled per provider: what is open across all of them, who resets
 * next, and how much of the pool that hands back. Answers "can I keep going"
 * before "on which account".
 */
export function buildUsageLimitsModel(input: UsageLimitsInput): UsageLimitsModel {
  const presentations = selectLimitPresentations(input.presentations, input.selectedEnvironmentIds);
  const pools = collectLimitPools(collectLimitAccounts(presentations), input.nowMs);
  const notices = collectLimitNotices(presentations);
  const externalLinks = collectExternalUsageLinks(presentations);
  return {
    emptyMessage:
      pools.length === 0 &&
      notices.length === 0 &&
      !input.hasCursorPrompt &&
      externalLinks.length === 0
        ? "No provider on the selected environments reports subscription limits."
        : null,
    sections: pools.map((pool) => ({
      driver: pool.driver,
      label: getDriverLabel(pool.driver) ?? String(pool.driver),
      color: barColor(pool.driver),
      windows: displayLimitWindows(pool).map((window) =>
        buildPoolWindowModel(pool, window, input.nowMs, input.timestampFormat),
      ),
    })),
    cursorPromptIndex:
      Math.max(
        pools.findIndex((pool) => pool.driver === "codex"),
        pools.findIndex((pool) => pool.driver === "claudeAgent"),
      ) + 1,
    externalLinks: externalLinks.map((link) => ({
      url: link.url,
      label: link.label,
      icon: link.url === CHATGPT_USAGE_URL ? "openai" : null,
      description:
        link.url === CHATGPT_USAGE_URL
          ? "View usage in ChatGPT with your connected account."
          : link.message
            ? link.message
            : null,
      buttonLabel: "Manage usage",
    })),
    notices,
  };
}
