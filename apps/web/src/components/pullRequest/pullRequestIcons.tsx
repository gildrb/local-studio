import {
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  LayersIcon,
  Link2Icon,
  Unlink2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import type { PullRequestState } from "@t3tools/contracts";

import {
  PULL_REQUEST_STATE_MODELS,
  type PullRequestGlyphId,
  type PullRequestStateModel,
} from "./pullRequestPresentation.logic";

export const PullRequestGlyph = {
  pullRequest: GitPullRequestArrowIcon,
  reopen: GitPullRequestArrowIcon,
  draft: GitPullRequestDraftIcon,
  closed: GitPullRequestClosedIcon,
  merged: GitMergeIcon,
  conflicting: TriangleAlertIcon,
  stack: LayersIcon,
  link: Link2Icon,
  unlink: Unlink2Icon,
} as const satisfies Record<PullRequestGlyphId, unknown>;

export type PullRequestGlyphIcon = (typeof PullRequestGlyph)[keyof typeof PullRequestGlyph];

export interface PullRequestStatePresentation {
  readonly label: string;
  readonly toneClassName: string;
  readonly Icon: PullRequestGlyphIcon;
}

function statePresentation(model: PullRequestStateModel): PullRequestStatePresentation {
  return {
    label: model.label,
    toneClassName: model.toneClassName,
    Icon: PullRequestGlyph[model.icon],
  };
}

export const PULL_REQUEST_STATE_PRESENTATION = {
  open: statePresentation(PULL_REQUEST_STATE_MODELS.open),
  draft: statePresentation(PULL_REQUEST_STATE_MODELS.draft),
  closed: statePresentation(PULL_REQUEST_STATE_MODELS.closed),
  merged: statePresentation(PULL_REQUEST_STATE_MODELS.merged),
} as const satisfies Record<PullRequestState | "draft", PullRequestStatePresentation>;
