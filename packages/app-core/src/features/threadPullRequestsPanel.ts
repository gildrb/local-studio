import {
  runAtomCommand,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import {
  buildLinkPullRequestDialogModel,
  linkPullRequestSubmitFailureMessage,
  resolveLinkPullRequestInput,
  resolveLinkPullRequestProject,
  resolveLinkPullRequestSubmit,
  type LinkPullRequestDialogModel,
} from "@t3tools/web/src/components/pullRequest/LinkPullRequestDialog.logic.ts";
import {
  buildThreadPullRequestsPanelModel,
  THREAD_PULL_REQUESTS_UNSUPPORTED,
  threadPullRequestLineKey,
  threadPullRequestLines,
  type ThreadPullRequestRowModel,
} from "@t3tools/web/src/components/pullRequest/ThreadPullRequestsPanel.logic.ts";
import {
  buildPullRequestActorModel,
  formatPullRequestDiffStat,
  pullRequestChecksStateModel,
  pullRequestReviewDecisionModel,
  resolvePullRequestConflictModel,
  resolvePullRequestStateModel,
  type PullRequestActorModel,
  type PullRequestChecksStateModel,
  type PullRequestConflictModel,
  type PullRequestDiffStatModel,
  type PullRequestSignalModel,
  type PullRequestStateModel,
} from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import {
  splitForMiddleTruncate,
  type MiddleTruncateSplit,
} from "@t3tools/web/src/components/ui/middleTruncate.logic.ts";
import { createPullRequestLinkingRules } from "@t3tools/web/src/hooks/pullRequestLinking.logic.ts";
import { resolveChangeRequestLinkTarget } from "@t3tools/web/src/lib/changeRequestLinkTarget.logic.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { formatRelativeTimeLabel } from "@t3tools/web/src/timestampFormat.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../clipboard.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";

const REM = 16;

const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const OpenParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, external: Schema.Boolean }),
);
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

export type ThreadPullRequestRowView = {
  readonly key: string;
  readonly indent: number;
  readonly showsConnector: boolean;
  readonly waitingAriaLabel: string | null;
  readonly state: PullRequestStateModel | null;
  readonly conflict: PullRequestConflictModel | null;
  readonly numberLabel: string;
  readonly numberTooltip: string;
  readonly title: string;
  readonly checks: PullRequestChecksStateModel | null;
  readonly reviewDecision: PullRequestSignalModel | null;
  readonly diffStat: PullRequestDiffStatModel | null;
  readonly stack: { readonly sizeLabel: string; readonly tooltip: string } | null;
  readonly author: PullRequestActorModel | null;
  readonly repository: {
    readonly label: string;
    readonly split: MiddleTruncateSplit | null;
  } | null;
  readonly branches: {
    readonly head: string;
    readonly headSplit: MiddleTruncateSplit | null;
    readonly base: string;
    readonly baseSplit: MiddleTruncateSplit | null;
  } | null;
  readonly hostRepositoryLabel: string | null;
  readonly updatedLabel: string | null;
  readonly actionsAriaLabel: string;
  readonly copyLabel: string;
  readonly openLabel: string;
  readonly unlinkLabel: string;
};

export type ThreadPullRequestsPanelView =
  | { readonly kind: "unsupported"; readonly title: string; readonly description: string }
  | {
      readonly kind: "empty";
      readonly title: string;
      readonly description: string;
      readonly actionLabel: string;
    }
  | {
      readonly kind: "list";
      readonly rows: ReadonlyArray<ThreadPullRequestRowView>;
      readonly footerSummary: string;
      readonly actionLabel: string;
    };

export type LinkPullRequestDialogView = LinkPullRequestDialogModel & {
  readonly revision: number;
};

type DialogState = {
  readonly threadRef: ScopedThreadRef;
  readonly reference: string;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly submitError: string | null;
  readonly revision: number;
};

function buildRow(
  link: ThreadPullRequestLink,
  row: ThreadPullRequestRowModel,
): ThreadPullRequestRowView {
  const snapshot = link.snapshot;
  const open = row.showsSignals && snapshot !== null;
  return {
    key: row.key,
    indent: row.indentRem * REM,
    showsConnector: row.showsConnector,
    waitingAriaLabel: row.waitingAriaLabel,
    state:
      snapshot === null
        ? null
        : resolvePullRequestStateModel({ state: snapshot.state, isDraft: snapshot.isDraft }),
    conflict:
      snapshot === null
        ? null
        : resolvePullRequestConflictModel({
            state: snapshot.state,
            isDraft: snapshot.isDraft,
            ...(snapshot.mergeability === undefined ? {} : { mergeability: snapshot.mergeability }),
            baseBranch: snapshot.baseBranch,
          }),
    numberLabel: row.numberLabel,
    numberTooltip: row.numberTooltip,
    title: row.title,
    checks: open && snapshot.checksState ? pullRequestChecksStateModel(snapshot.checksState) : null,
    reviewDecision:
      open && snapshot.reviewDecision
        ? pullRequestReviewDecisionModel(snapshot.reviewDecision)
        : null,
    diffStat: formatPullRequestDiffStat(snapshot?.additions ?? 0, snapshot?.deletions ?? 0),
    stack: row.stack,
    author: snapshot?.author ? buildPullRequestActorModel(snapshot.author) : null,
    repository:
      snapshot === null
        ? null
        : { label: row.repository, split: splitForMiddleTruncate(row.repository) },
    branches:
      snapshot === null
        ? null
        : {
            head: snapshot.headBranch,
            headSplit: splitForMiddleTruncate(snapshot.headBranch),
            base: snapshot.baseBranch,
            baseSplit: splitForMiddleTruncate(snapshot.baseBranch),
          },
    hostRepositoryLabel: snapshot === null ? row.hostRepositoryLabel : null,
    updatedLabel: snapshot?.updatedAt ? formatRelativeTimeLabel(snapshot.updatedAt) : null,
    actionsAriaLabel: row.actionsAriaLabel,
    copyLabel: row.copyLabel,
    openLabel: row.openLabel,
    unlinkLabel: row.unlinkLabel,
  };
}

export function createThreadPullRequestsPanelFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const dialogAtom = Atom.make<DialogState | null>(null).pipe(Atom.keepAlive);
  let dialogRevision = 0;

  const linksAtom = Atom.make((get) => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const shell = get(state.environmentThreadShells.threadShellAtom(input.route)) ?? input.thread;
    return {
      route: input.route,
      supported: input.serverConfig?.environment.capabilities.threadPullRequests === true,
      links: visibleThreadPullRequests(shell?.pullRequests ?? []),
    };
  });

  const viewAtom = Atom.make((get): ThreadPullRequestsPanelView | null => {
    const current = get(linksAtom);
    if (current === null) return null;
    if (!current.supported) {
      return {
        kind: "unsupported",
        title: THREAD_PULL_REQUESTS_UNSUPPORTED.title,
        description: THREAD_PULL_REQUESTS_UNSUPPORTED.error,
      };
    }
    const lines = threadPullRequestLines(current.links);
    const model = buildThreadPullRequestsPanelModel({
      links: current.links,
      lines,
      nowMs: Date.now(),
    });
    if (model.kind === "empty") return model;
    const rows: ThreadPullRequestRowView[] = [];
    lines.forEach((line, index) => {
      const row = model.rows[index];
      if (row !== undefined) rows.push(buildRow(line.link, row));
    });
    return {
      kind: "list",
      rows,
      footerSummary: model.footerSummary,
      actionLabel: model.actionLabel,
    };
  });

  const linkingRules = (environmentId: EnvironmentId) =>
    createPullRequestLinkingRules({
      environmentId,
      capabilities: registry.get(state.serverEnvironment.configValueAtom(environmentId))
        ?.environment.capabilities,
      projects: registry.get(state.environmentProjects.projectsAtom),
    });

  const resolveDialog = (dialog: DialogState) => {
    const projects = registry.get(state.environmentProjects.projectsAtom);
    const shell = registry.get(state.environmentThreadShells.threadShellAtom(dialog.threadRef));
    const projectId = shell?.projectId ?? null;
    const ownProject = resolveLinkPullRequestProject(
      projects.find(
        (candidate) =>
          candidate.environmentId === dialog.threadRef.environmentId && candidate.id === projectId,
      )?.repositoryIdentity,
    );
    const rules = linkingRules(dialog.threadRef.environmentId);
    return resolveLinkPullRequestInput({
      reference: dialog.reference,
      project: ownProject,
      hasProject: (reference) => rules.canLink(reference.url),
    });
  };

  const dialogViewAtom = Atom.make((get): LinkPullRequestDialogView | null => {
    const dialog = get(dialogAtom);
    if (dialog === null) return null;
    get(state.environmentProjects.projectsAtom);
    get(state.environmentThreadShells.threadShellAtom(dialog.threadRef));
    if (linkingRules(dialog.threadRef.environmentId).mode === "unsupported") return null;
    return {
      ...buildLinkPullRequestDialogModel({
        reference: dialog.reference,
        dirty: dialog.dirty,
        pending: dialog.pending,
        submitError: dialog.submitError,
        resolution: resolveDialog(dialog),
      }),
      revision: dialog.revision,
    };
  });

  const linkByKey = (key: string) => {
    const current = registry.get(linksAtom);
    if (current === null) return null;
    const line = threadPullRequestLines(current.links).find(
      (candidate) => threadPullRequestLineKey(candidate) === key,
    );
    return line === undefined ? null : { route: current.route, link: line.link };
  };

  const updateDialog = (update: (dialog: DialogState) => DialogState) => {
    const dialog = registry.get(dialogAtom);
    if (dialog !== null) registry.set(dialogAtom, update(dialog));
  };

  return {
    views: { threadPullRequests: viewAtom, linkPullRequestDialog: dialogViewAtom },
    actions: {
      threadPullRequestsOpen: async (params) => {
        const { key, external } = OpenParams(params);
        const found = linkByKey(key);
        if (found === null) return null;
        if (!external) {
          const target = resolveChangeRequestLinkTarget({
            url: found.link.url,
            threadRef: found.route,
            panelRef: found.route,
            targetEnvironmentId: undefined,
            projects: registry.get(state.environmentProjects.projectsAtom),
            capabilitiesOf: (environmentId) =>
              registry.get(state.serverEnvironment.configValueAtom(environmentId))?.environment
                .capabilities,
            primaryEnvironmentId: registry.get(state.primaryEnvironmentIdAtom),
          });
          if (target !== null && target.kind === "panel") {
            useRightPanelStore.getState().openPullRequest(target.panelRef, target.surface);
            return null;
          }
        }
        await openExternal(found.link.url).catch((error: unknown) => {
          context.addToast({
            layout: "plain",
            type: "error",
            title: "Unable to open pull request link",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        });
        return null;
      },
      threadPullRequestsCopy: async (params) => {
        const found = linkByKey(KeyParams(params).key);
        if (found !== null) await clipboardService(context).writeText(found.link.url);
        return null;
      },
      threadPullRequestsUnlink: async (params) => {
        const found = linkByKey(KeyParams(params).key);
        if (found === null) return null;
        await runAtomCommand(registry, state.threadEnvironment.unlinkPullRequest, {
          environmentId: found.route.environmentId,
          input: {
            threadId: found.route.threadId,
            host: found.link.host,
            repository: found.link.repository,
            number: found.link.number,
          },
        });
        return null;
      },
      linkPullRequestDialogOpen: async () => {
        const input = registry.get(context.threadInputAtom);
        if (input === null) return null;
        dialogRevision += 1;
        registry.set(dialogAtom, {
          threadRef: input.route,
          reference: "",
          dirty: false,
          pending: false,
          submitError: null,
          revision: dialogRevision,
        });
        return null;
      },
      linkPullRequestDialogInput: async (params) => {
        const { text } = TextParams(params);
        updateDialog((dialog) => ({ ...dialog, reference: text, dirty: true }));
        return null;
      },
      linkPullRequestDialogClose: async () => {
        const dialog = registry.get(dialogAtom);
        if (dialog !== null && !dialog.pending) registry.set(dialogAtom, null);
        return null;
      },
      linkPullRequestDialogSubmit: async () => {
        const dialog = registry.get(dialogAtom);
        if (dialog === null || dialog.pending) return null;
        updateDialog((current) => ({ ...current, dirty: true }));
        const decision = resolveLinkPullRequestSubmit(resolveDialog(dialog));
        if (decision.kind === "invalid") return null;
        updateDialog((current) => ({ ...current, submitError: null, pending: true }));
        const threadRef = dialog.threadRef;
        try {
          const mutation = linkingRules(threadRef.environmentId).planChange(
            threadRef,
            decision.url,
            true,
          );
          const environmentId = threadRef.environmentId;
          const result =
            mutation.type === "thread.meta.update"
              ? await runAtomCommand(
                  registry,
                  state.threadEnvironment.updateMetadata,
                  { environmentId, input: mutation.input },
                  { reportFailure: false },
                )
              : mutation.type === "thread.pull-request.link"
                ? await runAtomCommand(
                    registry,
                    state.threadEnvironment.linkPullRequest,
                    { environmentId, input: mutation.input },
                    { reportFailure: false },
                  )
                : await runAtomCommand(
                    registry,
                    state.threadEnvironment.unlinkPullRequest,
                    { environmentId, input: mutation.input },
                    { reportFailure: false },
                  );
          if (result._tag === "Failure") {
            if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
            throw squashAtomCommandFailure(result);
          }
        } catch (error) {
          updateDialog((current) => ({
            ...current,
            pending: false,
            submitError: linkPullRequestSubmitFailureMessage(error),
          }));
          return null;
        }
        registry.set(dialogAtom, null);
        return null;
      },
    },
  };
}
