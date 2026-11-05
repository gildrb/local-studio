import { changeRequestUrlFor, parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  pullRequestHostOf,
  SourceControlProviderKind,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { parsePullRequestReference } from "~/pullRequestReference";

export { changeRequestUrlFor as changeRequestWebUrl } from "@t3tools/shared/changeRequestUrl";

export type ResolvedPullRequestLink = {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
};

export type LinkPullRequestProject = {
  readonly host: string;
  readonly repository: string;
  readonly webUrl: (number: number) => string | null;
};

export type LinkPullRequestInputResolution =
  | { readonly link: ResolvedPullRequestLink }
  | { readonly error: string }
  | null;

const isSourceControlProviderKind = Schema.is(SourceControlProviderKind);

export function resolveLinkPullRequestProject(
  identity: RepositoryIdentity | null | undefined,
): LinkPullRequestProject | null {
  if (!identity) return null;
  const repository =
    identity.displayName ??
    (identity.owner && identity.name ? `${identity.owner}/${identity.name}` : null);
  if (repository === null) return null;
  const provider = identity.provider;
  const host = pullRequestHostOf(
    identity,
    isSourceControlProviderKind(provider) ? provider : "unknown",
  );
  return {
    host,
    repository,
    webUrl: (number: number) =>
      provider === "forgejo" && identity.webUrl
        ? `${identity.webUrl.replace(/\/+$/, "")}/pulls/${number}`
        : changeRequestUrlFor(provider, host, repository, number, identity.locator.remoteUrl),
  };
}

export function resolveLinkPullRequestInput(input: {
  readonly reference: string;
  readonly project: LinkPullRequestProject | null;
  readonly hasProject: (reference: ResolvedPullRequestLink) => boolean;
}): LinkPullRequestInputResolution {
  const parsed =
    parseChangeRequestUrl(input.reference.trim()) !== null
      ? input.reference.trim()
      : parsePullRequestReference(input.reference);
  if (parsed === null) return null;
  const url = parseChangeRequestUrl(parsed);
  if (url !== null) {
    if (!input.hasProject({ ...url, url: parsed })) {
      return { error: `No project in this environment can read ${url.host}/${url.repository}.` };
    }
    return {
      link: { host: url.host, repository: url.repository, number: url.number, url: parsed },
    };
  }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  if (input.project === null) {
    return { error: "Paste a full URL to link a pull request from another repository." };
  }
  const webUrl = input.project.webUrl(number);
  const webReference = webUrl === null ? null : parseChangeRequestUrl(webUrl);
  if (webUrl === null || webReference === null) {
    return { error: "Paste a full URL; this project's host has no known pull request URL." };
  }
  return {
    link: { ...webReference, url: webUrl },
  };
}

export type LinkPullRequestDialogInput = {
  readonly reference: string;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly submitError: string | null;
  readonly resolution: LinkPullRequestInputResolution;
};

export type LinkPullRequestDialogModel = {
  readonly title: string;
  readonly description: string;
  readonly inputPlaceholder: string;
  readonly preview: string | null;
  readonly error: string | null;
  readonly cancelLabel: string;
  readonly cancelDisabled: boolean;
  readonly submitLabel: string;
  readonly submitDisabled: boolean;
  readonly dismissible: boolean;
};

function linkPullRequestValidation(input: LinkPullRequestDialogInput): string | null {
  if (!input.dirty) return null;
  if (input.reference.trim().length === 0) return "Paste a pull request URL or enter 123 / #123.";
  if (input.resolution === null) return "Use a pull request URL, 123, or #123.";
  return "error" in input.resolution ? input.resolution.error : null;
}

export function buildLinkPullRequestDialogModel(
  input: LinkPullRequestDialogInput,
): LinkPullRequestDialogModel {
  const resolution = input.resolution;
  const link = resolution !== null && "link" in resolution ? resolution.link : null;
  return {
    title: "Link pull request",
    description:
      "Attach a pull request to this thread. A full URL can point at any repository on a host this environment has a project for.",
    inputPlaceholder: "Pull request URL or #42",
    preview: link === null ? null : `${link.host}/${link.repository} #${link.number}`,
    error: linkPullRequestValidation(input) ?? input.submitError,
    cancelLabel: "Cancel",
    cancelDisabled: input.pending,
    submitLabel: input.pending ? "Linking..." : "Link",
    submitDisabled: input.pending || link === null,
    dismissible: !input.pending,
  };
}

export type LinkPullRequestSubmitDecision =
  | { readonly kind: "invalid" }
  | { readonly kind: "link"; readonly url: string };

export function resolveLinkPullRequestSubmit(
  resolution: LinkPullRequestInputResolution,
): LinkPullRequestSubmitDecision {
  if (resolution === null || "error" in resolution) return { kind: "invalid" };
  return { kind: "link", url: resolution.link.url };
}

export function linkPullRequestSubmitFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not link the pull request.";
}
