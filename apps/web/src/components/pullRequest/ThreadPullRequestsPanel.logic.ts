import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { resolveThreadPullRequestChains } from "@t3tools/shared/threadPullRequests";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import { pullRequestListLines, type PullRequestListLine } from "./pullRequestListLines";

export const THREAD_PULL_REQUEST_SOURCE_LABELS: Record<ThreadPullRequestLink["source"], string> = {
  manual: "Linked by you",
  created: "Created from this thread",
  agent: "Linked by the agent",
  stack: "Found in the stack",
  "stack-dismissed": "Dismissed",
};

export const THREAD_PULL_REQUESTS_UNSUPPORTED = {
  title: "Linked pull requests unavailable",
  error: "This environment does not support multiple linked pull requests.",
} as const;

export type ThreadPullRequestRowModel = {
  readonly key: string;
  readonly depth: number;
  readonly indentRem: number;
  readonly showsConnector: boolean;
  readonly waitingAriaLabel: string | null;
  readonly numberLabel: string;
  readonly numberTooltip: string;
  readonly title: string;
  readonly showsSignals: boolean;
  readonly stack: { readonly sizeLabel: string; readonly tooltip: string } | null;
  readonly repository: string;
  readonly hostRepositoryLabel: string;
  readonly actionsAriaLabel: string;
  readonly copyLabel: string;
  readonly openLabel: string;
  readonly unlinkLabel: string;
};

export type ThreadPullRequestsPanelModel =
  | {
      readonly kind: "empty";
      readonly title: string;
      readonly description: string;
      readonly actionLabel: string;
    }
  | {
      readonly kind: "list";
      readonly rows: ReadonlyArray<ThreadPullRequestRowModel>;
      readonly footerSummary: string;
      readonly actionLabel: string;
    };

export function threadPullRequestLines(
  links: ReadonlyArray<ThreadPullRequestLink>,
): ReadonlyArray<PullRequestListLine> {
  return pullRequestListLines(resolveThreadPullRequestChains(links));
}

export function threadPullRequestLineKey(line: PullRequestListLine): string {
  return `${line.link.host}/${line.link.repository}#${line.link.number}`;
}

export function buildThreadPullRequestRowModel(
  line: PullRequestListLine,
  nowMs: number,
): ThreadPullRequestRowModel {
  const { link, depth, stack } = line;
  const snapshot = link.snapshot;
  return {
    key: threadPullRequestLineKey(line),
    depth,
    indentRem: 0.5 + Math.min(depth, 3) * 1.25,
    showsConnector: depth > 0,
    waitingAriaLabel: snapshot === null ? "Waiting for host state" : null,
    numberLabel: `#${link.number}`,
    numberTooltip: `${THREAD_PULL_REQUEST_SOURCE_LABELS[link.source]} · ${formatRelativeTimeLabel(
      link.linkedAt,
      nowMs,
    )}`,
    title: snapshot?.title ?? link.repository,
    showsSignals: snapshot?.state === "open",
    stack: stack
      ? {
          sizeLabel: String(stack.size),
          tooltip:
            stack.kind === "native"
              ? `GitHub stack of ${stack.size}: merging a layer lands the ones below it.`
              : `${stack.size} pull requests chained by base branch.`,
        }
      : null,
    repository: link.repository,
    hostRepositoryLabel: `${link.host}/${link.repository}`,
    actionsAriaLabel: `Actions for #${link.number}`,
    copyLabel: "Copy link",
    openLabel: "Open",
    unlinkLabel: link.source === "stack" ? "Dismiss from thread" : "Unlink from thread",
  };
}

export function buildThreadPullRequestsPanelModel(input: {
  readonly links: ReadonlyArray<ThreadPullRequestLink>;
  readonly lines: ReadonlyArray<PullRequestListLine>;
  readonly nowMs: number;
}): ThreadPullRequestsPanelModel {
  if (input.links.length === 0) {
    return {
      kind: "empty",
      title: "No linked pull requests",
      description:
        "Pull requests the agent opens from this thread land here. Link one yourself from a URL or a number.",
      actionLabel: "Link pull request",
    };
  }
  const openCount = input.links.filter(
    (link) => link.snapshot === null || link.snapshot.state === "open",
  ).length;
  let lastSynced: string | null = null;
  for (const link of input.links) {
    const at = link.snapshot?.syncedAt;
    if (at !== undefined && (lastSynced === null || at > lastSynced)) lastSynced = at;
  }
  return {
    kind: "list",
    rows: input.lines.map((line) => buildThreadPullRequestRowModel(line, input.nowMs)),
    footerSummary: `${openCount} open · ${input.links.length} linked${
      lastSynced ? ` · synced ${formatRelativeTimeLabel(lastSynced, input.nowMs)}` : ""
    }`,
    actionLabel: "Link",
  };
}
