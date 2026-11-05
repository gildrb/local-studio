import {
  formatProviderSkillDisplayName,
  getProviderSkillsForSlashMenu,
  getProviderSlashCommandsForSlashMenu,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type {
  ProjectEntry,
  ProjectId,
  ProviderDriverKind,
  PullRequestContextMetadata,
  PullRequestDetail,
  PullRequestListEntry,
  PullRequestListInput,
  PullRequestListResult,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { filterComposerPullRequestMatches } from "@t3tools/shared/composerPullRequestMatches";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { USAGE_LIMITS_COMMAND } from "@t3tools/shared/usageLimits";

import type {
  ComposerSlashCommand,
  ComposerTrigger,
  ComposerTriggerKind,
} from "../../composer-logic";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { reviewCommentContextReference } from "../../lib/composerContextRecords";
import { searchProviderSkills } from "../../providerSkillSearch";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { buildPullRequestReferenceContext } from "../pullRequest/pullRequestDetail.logic";
import {
  matchesPullRequestQuery,
  rankPullRequestMatches,
} from "../pullRequest/pullRequestList.logic";
import {
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
} from "./composerSlashCommandSearch";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "provider-slash-command";
      provider: ProviderDriverKind;
      command: ServerProviderSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      provider: ProviderDriverKind;
      skill: ServerProviderSkill;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "pull-request";
      pullRequest: PullRequestContextMetadata;
      label: string;
      description: string;
    };

export const COMPOSER_TRIGGER_LIST_LABELS: Record<ComposerTriggerKind, string> = {
  path: "Files and folders",
  "pull-request": "Pull requests",
  "slash-command": "Commands",
  skill: "Skills",
};

export const SKILL_SOURCE_LABEL_BY_KIND: Record<ProviderSkillSourceKind, string> = {
  app: "App",
  repo: "Repo",
  project: "Project",
  personal: "Personal",
  system: "System",
  other: "Provider",
};

export function composerSkillSourceBadgeLabel(
  kind: ProviderSkillSourceKind,
  showSkillSuffix: boolean,
): string {
  const label = SKILL_SOURCE_LABEL_BY_KIND[kind];
  return showSkillSuffix ? `${label} Skill` : label;
}

export function composerCommandMenuStatusText(input: {
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  emptyStateText?: string | undefined;
}): string {
  if (input.isLoading) {
    return input.triggerKind === "skill"
      ? "Searching workspace skills..."
      : input.triggerKind === "pull-request"
        ? "Finding pull request..."
        : "Searching workspace files...";
  }
  return (
    input.emptyStateText ??
    (input.triggerKind === "skill"
      ? "No skills found. Try / to browse provider commands."
      : input.triggerKind === "path"
        ? "No matching files or folders."
        : "No matching command.")
  );
}

export function extendReplacementRangeForTrailingSpace(
  text: string,
  rangeEnd: number,
  replacement: string,
): number {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
}

/** Whether the composer refuses text inserted from elsewhere (file tree, diff, palette). */
export function isComposerTextInsertionBlocked(input: {
  readonly text: string;
  readonly isConnecting: boolean;
  readonly approvalPending: boolean;
  readonly pendingUserInputCount: number;
  readonly projectSelectionRequired: boolean;
}): boolean {
  return (
    input.text.length === 0 ||
    input.isConnecting ||
    input.approvalPending ||
    input.pendingUserInputCount > 0 ||
    input.projectSelectionRequired
  );
}

export type ComposerTextInsertion = {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly replacement: string;
  readonly leadingSpace: boolean;
};

/** Where inserted text lands in the prompt, with a word boundary before it when asked. */
export function resolveComposerTextInsertion(input: {
  readonly prompt: string;
  readonly cursor: number;
  readonly text: string;
  readonly ensureLeadingBoundary: boolean;
}): ComposerTextInsertion {
  const { prompt, cursor, text } = input;
  const leadingSpace =
    input.ensureLeadingBoundary && cursor > 0 && !/\s/.test(prompt[cursor - 1] ?? "");
  return {
    rangeStart: cursor,
    rangeEnd: extendReplacementRangeForTrailingSpace(prompt, cursor, text),
    replacement: leadingSpace ? ` ${text}` : text,
    leadingSpace,
  };
}

export function isComposerCompactSlashCommandAvailable(input: {
  trigger: ComposerTrigger | null;
  prompt: string;
  compactThreadUnavailable: boolean;
  attachmentCount: number;
}): boolean {
  const { trigger, prompt } = input;
  return (
    trigger?.kind === "slash-command" &&
    prompt.slice(0, trigger.rangeStart).trim() === "" &&
    !input.compactThreadUnavailable &&
    prompt.slice(trigger.rangeEnd).trim() === "" &&
    input.attachmentCount === 0
  );
}

export const COMPOSER_PULL_REQUEST_RESULT_LIMIT = 12;

export interface ComposerMenuItemsInput {
  trigger: ComposerTrigger | null;
  pathEntries: ReadonlyArray<{ path: string; kind: ProjectEntry["kind"] }>;
  planModeUiEnabled: boolean;
  selectedProvider: ProviderDriverKind;
  selectedProviderSkills: ReadonlyArray<ServerProviderSkill>;
  selectedProviderSlashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  showSkillsInSlashMenu: boolean;
  compactSlashCommandAvailable: boolean;
  pullRequest: {
    projectId: ProjectId;
    repository: string;
    triggerNumber: number | null;
    exactPullRequest: PullRequestDetail | null;
    listEntries: ReadonlyArray<PullRequestListEntry>;
    listProviders: ReadonlyArray<PullRequestListResult["providers"][number]>;
  } | null;
}

function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf("/");
  return slashIndex === -1 ? pathValue : pathValue.slice(slashIndex + 1);
}

export function buildComposerMenuItems(input: ComposerMenuItemsInput): ComposerCommandItem[] {
  const composerTrigger = input.trigger;
  const { selectedProvider } = input;
  if (!composerTrigger) return [];
  if (composerTrigger.kind === "path") {
    return input.pathEntries.map((entry) => ({
      id: `path:${entry.kind}:${entry.path}`,
      type: "path",
      path: entry.path,
      pathKind: entry.kind,
      label: basenameOfPath(entry.path),
      description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
    }));
  }
  if (composerTrigger.kind === "slash-command") {
    const builtInSlashCommandItems = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        label: "/model",
        description: "Switch response model for this thread",
      },
      ...(input.planModeUiEnabled
        ? ([
            {
              id: "slash:plan",
              type: "slash-command",
              command: "plan",
              label: "/plan",
              description: "Switch this thread into plan mode",
            },
            {
              id: "slash:default",
              type: "slash-command",
              command: "default",
              label: "/default",
              description: "Switch this thread back to normal build mode",
            },
          ] as const)
        : []),
    ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
    const slashMenuSkills = getProviderSkillsForSlashMenu(
      input.selectedProviderSkills,
      input.showSkillsInSlashMenu,
    );
    const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
      input.selectedProviderSlashCommands,
      slashMenuSkills,
    ).map((command) => ({
      id: `provider-slash-command:${selectedProvider}:${command.name}`,
      type: "provider-slash-command" as const,
      provider: selectedProvider,
      command,
      label: `/${command.name}`,
      description: command.description ?? command.input?.hint ?? "Run provider command",
    }));
    const query = composerTrigger.query.trim().toLowerCase();
    const skillItems = slashMenuSkills.map((skill) => ({
      id: `skill:${selectedProvider}:${skill.name}`,
      type: "skill" as const,
      provider: selectedProvider,
      skill,
      label: `/skill:${skill.name}`,
      description:
        skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : ""),
    }));
    const visibleProviderSlashCommandItems = providerSlashCommandItems.filter(
      (item) => item.command.name !== "compact" || input.compactSlashCommandAvailable,
    );
    const slashCommandItems = slashCommandItemsForPromptPosition(
      [...builtInSlashCommandItems, ...visibleProviderSlashCommandItems, ...skillItems],
      composerTrigger.rangeStart === 0,
    );
    return searchSlashCommandItems(slashCommandItems, query);
  }
  if (composerTrigger.kind === "skill") {
    return searchProviderSkills(input.selectedProviderSkills, composerTrigger.query).map(
      (skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }),
    );
  }
  const pullRequestInput = input.pullRequest;
  if (composerTrigger.kind === "pull-request" && pullRequestInput !== null) {
    const { projectId, repository } = pullRequestInput;
    const exactPullRequest =
      pullRequestInput.exactPullRequest?.number === pullRequestInput.triggerNumber &&
      pullRequestInput.exactPullRequest
        ? [pullRequestInput.exactPullRequest]
        : [];
    const matches = /^\d*$/u.test(composerTrigger.query)
      ? filterComposerPullRequestMatches({
          entries: [...exactPullRequest, ...pullRequestInput.listEntries],
          projectId,
          repository,
          query: composerTrigger.query,
          limit: COMPOSER_PULL_REQUEST_RESULT_LIMIT,
        })
      : rankPullRequestMatches(
          pullRequestInput.listEntries.filter((entry) => {
            if (
              entry.projectId !== projectId ||
              entry.repository.trim().toLowerCase() !== repository.trim().toLowerCase()
            ) {
              return false;
            }
            const provider = pullRequestInput.listProviders.find(
              (candidate) => candidate.host === entry.host,
            );
            return (
              provider?.searchesOnHost === true ||
              matchesPullRequestQuery(entry, composerTrigger.query)
            );
          }),
          composerTrigger.query,
        ).slice(0, COMPOSER_PULL_REQUEST_RESULT_LIMIT);
    return matches.map((pullRequest) => ({
      id: `pull-request:${pullRequest.projectId}:${pullRequest.repository}:${pullRequest.number}`,
      type: "pull-request",
      pullRequest: {
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        headBranch: pullRequest.headBranch,
        baseBranch: pullRequest.baseBranch,
        state: pullRequest.state,
        isDraft: pullRequest.isDraft,
      },
      label: `#${pullRequest.number}`,
      description: pullRequest.title,
    }));
  }
  return [];
}

export function composerMenuSearchKey(
  listId: string,
  trigger: ComposerTrigger | null,
): string | null {
  return trigger ? `${listId}:${trigger.kind}:${trigger.query.trim().toLowerCase()}` : null;
}

export function nextComposerMenuHighlightId(
  items: ReadonlyArray<{ id: string }>,
  highlightedItemId: string | null,
  key: "ArrowDown" | "ArrowUp",
): string | null {
  if (items.length === 0) return null;
  const highlightedIndex = items.findIndex((item) => item.id === highlightedItemId);
  const normalizedIndex = highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
  const offset = key === "ArrowDown" ? 1 : -1;
  const nextIndex = (normalizedIndex + offset + items.length) % items.length;
  return items[nextIndex]?.id ?? null;
}

export type ComposerItemSelectionEffect =
  | null
  | { kind: "open-model-picker" }
  | { kind: "usage-limits" }
  | { kind: "interaction-mode"; mode: "plan" | "default" }
  | { kind: "review-comment"; comment: ReviewCommentContext };

export interface ComposerItemSelectionPlan {
  rangeStart: number;
  rangeEnd: number;
  replacement: string;
  expectedText: string;
  focusEditor: boolean;
  effect: ComposerItemSelectionEffect;
}

function selectionPlan(
  trigger: ComposerTrigger,
  text: string,
  replacement: string,
  focusEditor: boolean,
  effect: ComposerItemSelectionEffect,
): ComposerItemSelectionPlan {
  const rangeEnd = extendReplacementRangeForTrailingSpace(text, trigger.rangeEnd, replacement);
  return {
    rangeStart: trigger.rangeStart,
    rangeEnd,
    replacement,
    expectedText: text.slice(trigger.rangeStart, rangeEnd),
    focusEditor,
    effect,
  };
}

export function planComposerItemSelection(input: {
  item: ComposerCommandItem;
  trigger: ComposerTrigger;
  text: string;
  planModeUiEnabled: boolean;
  usageLimitsCommandAvailable: boolean;
  menuItemIds: ReadonlyArray<string>;
}): ComposerItemSelectionPlan | null {
  const { item, trigger, text } = input;
  switch (item.type) {
    case "path":
      return selectionPlan(trigger, text, `${serializeComposerFileLink(item.path)} `, true, null);
    case "slash-command":
      if (item.command === "model") {
        return selectionPlan(trigger, text, "", false, { kind: "open-model-picker" });
      }
      if (!input.planModeUiEnabled) return null;
      return selectionPlan(trigger, text, "", true, {
        kind: "interaction-mode",
        mode: item.command === "plan" ? "plan" : "default",
      });
    case "provider-slash-command":
      if (item.command.name === USAGE_LIMITS_COMMAND.name && input.usageLimitsCommandAvailable) {
        return selectionPlan(trigger, text, "", false, { kind: "usage-limits" });
      }
      return selectionPlan(trigger, text, `/${item.command.name} `, true, null);
    case "skill":
      return selectionPlan(trigger, text, `$${item.skill.name} `, true, null);
    case "pull-request": {
      if (trigger.kind !== "pull-request" || !input.menuItemIds.includes(item.id)) {
        return null;
      }
      const comment = buildPullRequestReferenceContext(item.pullRequest);
      return selectionPlan(
        trigger,
        text,
        `${formatInlineContextReference(reviewCommentContextReference(comment))} `,
        true,
        { kind: "review-comment", comment },
      );
    }
  }
}

export function resolveComposerTriggerAfterDismissal(
  candidate: ComposerTrigger | null,
  dismissed: ComposerTrigger | null,
): ComposerTrigger | null {
  return candidate &&
    dismissed &&
    candidate.kind === dismissed.kind &&
    candidate.rangeStart === dismissed.rangeStart
    ? null
    : candidate;
}

export type ComposerSkillMeta = { label: string; description: string | null };

export function resolveComposerSkillMeta(
  name: string,
  skills: ReadonlyArray<ServerProviderSkill>,
): ComposerSkillMeta {
  const normalized = name.startsWith("$") ? name.slice(1) : name;
  const skill = skills.find((candidate) => candidate.name === normalized);
  if (!skill) {
    return { label: formatProviderSkillDisplayName({ name: normalized }), description: null };
  }
  const shortDescription = skill.shortDescription?.trim();
  return {
    label: formatProviderSkillDisplayName(skill),
    description: shortDescription || skill.description?.trim() || null,
  };
}

export const COMPOSER_PULL_REQUEST_LIST_LIMIT = 99;
export const COMPOSER_PULL_REQUEST_QUERY_DEBOUNCE_MS = 180;

export function composerPullRequestTextQuery(trigger: ComposerTrigger | null): string | null {
  return trigger?.kind === "pull-request" &&
    trigger.query.length > 0 &&
    !/^\d+$/u.test(trigger.query)
    ? trigger.query
    : null;
}

export function composerPullRequestTriggerNumber(trigger: ComposerTrigger | null): number | null {
  if (trigger?.kind !== "pull-request" || trigger.query.length === 0) {
    return null;
  }
  const number = Number(trigger.query);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function composerPullRequestListInput(
  projectId: ProjectId,
  settledTextQuery: string | null,
): PullRequestListInput {
  return {
    state: "all",
    projectId,
    limit: COMPOSER_PULL_REQUEST_LIST_LIMIT,
    ...(settledTextQuery === null ? {} : { query: settledTextQuery }),
  };
}

export function composerPullRequestListHasNumber(input: {
  entries: ReadonlyArray<PullRequestListEntry>;
  projectId: ProjectId | null;
  repository: string | null;
  number: number | null;
}): boolean {
  return (
    input.number !== null &&
    input.entries.some(
      (entry) =>
        entry.projectId === input.projectId &&
        entry.repository.trim().toLowerCase() === input.repository?.trim().toLowerCase() &&
        entry.number === input.number,
    )
  );
}

export function composerMenuEmptyStateText(input: {
  triggerKind: ComposerTriggerKind | null;
  query: string;
  pullRequestScopeAvailable: boolean;
  pullRequestReadFailed: boolean;
}): string {
  if (input.triggerKind === "skill") {
    return "No skills found. Try / to browse provider commands.";
  }
  if (input.triggerKind === "pull-request") {
    if (!input.pullRequestScopeAvailable) {
      return "Pull requests are not available for this project.";
    }
    if (input.pullRequestReadFailed) {
      return "Pull requests could not be read for this project.";
    }
    return input.query
      ? `No pull request matches ${input.query}.`
      : "No pull requests found in this repository.";
  }
  return input.triggerKind === "path" ? "No matching files or folders." : "No matching command.";
}
