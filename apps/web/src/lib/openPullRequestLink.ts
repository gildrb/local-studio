import type { EnvironmentId, PullRequestRef, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useCallback, useMemo } from "react";

import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { sourceControlRepositorySelector } from "@t3tools/shared/sourceControl";

import { useOpenLink } from "../browser/useOpenLink";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useRightPanelStore } from "../rightPanelStore";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { useProjects, useServerConfigs } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { usePrimaryEnvironmentId } from "../state/environments";
import { findProjectForChangeRequest } from "./changeRequestProjects";
import { resolveChangeRequestLinkTarget } from "./changeRequestLinkTarget.logic";

export {
  parseChangeRequestUrl,
  type ChangeRequestLink,
  gitHubPullRequestBrowserUrl,
  pullRequestCandidateUrlFromReferenceAutolink,
  matchesLinkedPullRequestUrl,
  changeRequestRepositoryUrl,
} from "@t3tools/shared/changeRequestUrl";

export function resolvePullRequestPreviewTarget({
  environmentId,
  projects,
  pullRequestsEnabled,
  url,
}: {
  environmentId: EnvironmentId | null;
  projects: ReadonlyArray<EnvironmentProject>;
  pullRequestsEnabled: boolean;
  url: string;
}): { environmentId: EnvironmentId; input: PullRequestRef } | null {
  if (!pullRequestsEnabled || environmentId === null) return null;
  const parsed = parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const project = findProjectForChangeRequest(
    projects.filter((candidate) => candidate.environmentId === environmentId),
    parsed,
  );
  if (project === undefined) return null;
  return {
    environmentId,
    input: {
      projectId: project.id,
      host: parsed.authority ?? parsed.host,
      repository: sourceControlRepositorySelector(project.repositoryIdentity) ?? parsed.repository,
      number: parsed.number,
    },
  };
}

export function usePullRequestPreviewTarget(environmentId: EnvironmentId | null, url: string) {
  const projects = useProjects();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return useMemo(
    () =>
      resolvePullRequestPreviewTarget({
        environmentId,
        projects,
        pullRequestsEnabled: serverConfig?.environment.capabilities.pullRequests === true,
        url,
      }),
    [environmentId, projects, serverConfig, url],
  );
}

/**
 * Opens a change request link on the page, and says whether it did. Anything else — another
 * organisation's repository, a host nothing here is checked out from, a link that merely looks
 * like one — is left alone for the caller to handle as the ordinary link it is.
 *
 * Resolving the project here rather than on the page is what makes recognising a URL safe: a
 * lookalike hostname matches no project and stays a link, and the page is handed the project
 * rather than a host to narrow its whole list by.
 *
 * Given a thread, the link opens beside it in the right panel instead of taking the whole app to
 * the pull requests page: a reader following a link the agent wrote is reading the thread, and
 * should still be reading it afterwards. Any change request opens there, not only the thread's
 * own, since the panel is told which one to show.
 */
export function shouldOpenPullRequestExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey">,
): boolean {
  return event.metaKey || event.ctrlKey;
}

export function useOpenChangeRequestLink(
  threadRef?: ScopedThreadRef,
  panelRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  >,
  targetUrl: string,
  targetThreadRef?: ScopedThreadRef,
  targetEnvironmentId?: EnvironmentId,
) => boolean {
  const navigate = useNavigate();
  const allProjects = useProjects();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useCallback(
    (event, targetUrl, targetThreadRef, targetEnvironmentId) => {
      if (shouldOpenPullRequestExternally(event)) return false;
      const resolvedThreadRef = targetThreadRef ?? threadRef;
      const target = resolveChangeRequestLinkTarget({
        url: targetUrl,
        threadRef: resolvedThreadRef,
        panelRef: panelRef ?? resolvedThreadRef,
        targetEnvironmentId,
        projects: allProjects,
        capabilitiesOf: (environmentId) =>
          serverConfigs.get(environmentId)?.environment.capabilities,
        primaryEnvironmentId: primaryEnvironmentId ?? null,
      });
      if (target === null) return false;
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "panel") {
        useRightPanelStore.getState().openPullRequest(target.panelRef, target.surface);
        const page = target.page;
        if (page !== null) {
          void navigate({
            to: "/pull-requests",
            search: (previous) => ({
              ...previous,
              involvement: previous.involvement ?? "all",
              state: previous.state ?? "all",
              ...page,
            }),
            replace: true,
          });
        }
        return true;
      }
      void navigate({
        to: "/pull-requests",
        search: {
          involvement: "all",
          // Every state, so the pull request being opened is also in the list behind it whether
          // it is open, merged or closed.
          state: "all",
          ...target.search,
        },
      });
      return true;
    },
    [allProjects, navigate, panelRef, primaryEnvironmentId, serverConfigs, threadRef],
  );
}

export function useOpenPrLink(threadRef?: ScopedThreadRef) {
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  return useCallback(
    (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
      event.stopPropagation();
      const openInBrowser = shouldOpenPullRequestExternally(event);
      const isAnchor =
        event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
      // A real link already knows how to cmd/ctrl+click. Leave its default
      // action alone so the browser (or Electron's window-open handler) opens
      // the host. Buttons have no href, so they still go through openExternal.
      if (openInBrowser && isAnchor) return false;

      event.preventDefault();
      if (!openInBrowser && openChangeRequest(event, prUrl, targetThreadRef)) return true;

      // No project to show it in, so it is an ordinary link and follows the
      // "Open links in" setting; the modifier still forces the system browser.
      void openLink(prUrl, { event, threadRef: targetThreadRef }).catch((error: unknown) => {
        console.error(error);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open pull request link",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
      return false;
    },
    [openChangeRequest, openLink],
  );
}
