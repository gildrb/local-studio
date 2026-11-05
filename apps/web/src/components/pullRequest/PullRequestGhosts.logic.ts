import type {
  PullRequestActor,
  PullRequestChecksState,
  PullRequestListEntry,
  PullRequestSummary,
} from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  buildPullRequestActorModel,
  buildPullRequestLabelChipModel,
  pullRequestChecksStateModel,
  resolvePullRequestStateModel,
  type PullRequestActorModel,
  type PullRequestChecksStateModel,
  type PullRequestLabelChipModel,
  type PullRequestStateModel,
} from "./pullRequestPresentation.logic";

export const PULL_REQUEST_DETAIL_GHOST_TABS = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
] as const;

export type PullRequestDetailGhostTabModel = {
  readonly value: string;
  readonly label: string;
};

export type PullRequestDetailGhostSeedModel = {
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly openAriaLabel: string;
  readonly state: PullRequestStateModel;
  readonly title: string;
  readonly author: PullRequestActorModel;
  readonly authorActor: PullRequestActor | null;
  readonly updatedLabel: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly additions: number;
  readonly deletions: number;
};

export type PullRequestDetailGhostModel = {
  readonly seed: PullRequestDetailGhostSeedModel | null;
  readonly numberLabel: string;
  readonly checksState: Extract<PullRequestChecksState, "failing" | "pending"> | null;
  readonly checks: PullRequestChecksStateModel | null;
  readonly checkoutCommand: string | null;
  readonly changedFilesLabel: string | null;
  readonly tabs: ReadonlyArray<PullRequestDetailGhostTabModel>;
  readonly selectedTab: string;
  readonly labels: ReadonlyArray<PullRequestLabelChipModel> | null;
};

export function buildPullRequestDetailGhostModel(input: {
  readonly seed: PullRequestListEntry | null;
  readonly summary: PullRequestSummary | null;
  readonly checkoutCommand: string | null;
  readonly tabs: ReadonlyArray<PullRequestDetailGhostTabModel>;
  readonly activeTab: string | undefined;
  readonly number: number | undefined;
  readonly nowMs: number;
}): PullRequestDetailGhostModel {
  const entry = input.seed;
  const summary = input.summary;
  const seed =
    summary !== null
      ? {
          repository: summary.repository,
          number: summary.number,
          url: summary.url,
          state: summary.state,
          isDraft: summary.isDraft ?? entry?.isDraft ?? false,
          title: summary.title,
          author: ("author" in summary ? summary.author : entry?.author) ?? null,
          updatedAt: summary.updatedAt,
          baseBranch: summary.baseBranch,
          headBranch: summary.headBranch,
          additions: ("additions" in summary ? summary.additions : entry?.additions) ?? 0,
          deletions: ("deletions" in summary ? summary.deletions : entry?.deletions) ?? 0,
          checksState: "checksState" in summary ? summary.checksState : entry?.checksState,
        }
      : entry !== null
        ? {
            repository: entry.repository,
            number: entry.number,
            url: entry.url,
            state: entry.state,
            isDraft: entry.isDraft,
            title: entry.title,
            author: entry.author ?? null,
            updatedAt: entry.updatedAt,
            baseBranch: entry.baseBranch,
            headBranch: entry.headBranch,
            additions: entry.additions,
            deletions: entry.deletions,
            checksState: entry.checksState,
          }
        : null;
  const changedFiles = summary?.changedFiles ?? null;
  return {
    seed:
      seed === null
        ? null
        : {
            repository: seed.repository,
            number: seed.number,
            url: seed.url,
            openAriaLabel: `Open pull request #${seed.number} on host`,
            state: resolvePullRequestStateModel({ state: seed.state, isDraft: seed.isDraft }),
            title: seed.title,
            author: buildPullRequestActorModel(seed.author),
            authorActor: seed.author,
            updatedLabel: `updated ${formatRelativeTimeLabel(seed.updatedAt, input.nowMs)}`,
            baseBranch: seed.baseBranch,
            headBranch: seed.headBranch,
            additions: seed.additions,
            deletions: seed.deletions,
          },
    numberLabel: `#${input.number ?? "…"}`,
    checksState:
      seed?.checksState === "failing" || seed?.checksState === "pending" ? seed.checksState : null,
    checks:
      seed?.checksState === "failing" || seed?.checksState === "pending"
        ? pullRequestChecksStateModel(seed.checksState)
        : null,
    checkoutCommand: input.checkoutCommand,
    changedFilesLabel:
      changedFiles === null
        ? null
        : `${changedFiles.toLocaleString()} ${changedFiles === 1 ? "file" : "files"}`,
    tabs: input.tabs,
    selectedTab:
      input.tabs.find((item) => item.value === input.activeTab)?.value ??
      input.tabs[0]?.value ??
      "summary",
    labels: entry?.labels ? entry.labels.map(buildPullRequestLabelChipModel) : null,
  };
}
