import type {
  EnvironmentId,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestRef,
  PullRequestStack,
} from "@t3tools/contracts";
import {
  buildPullRequestChecksPopoverModel,
  buildPullRequestLazyChecksBodyModel,
  PULL_REQUEST_CHECK_OPEN_FAILURE_TITLE,
} from "@t3tools/web/src/components/pullRequest/PullRequestChecksPopover.logic.ts";
import { buildPullRequestStackBodyModel } from "@t3tools/web/src/components/pullRequest/PullRequestStackMenu.logic.ts";
import {
  pullRequestStackView,
  savedPullRequestStack,
} from "@t3tools/web/src/components/pullRequest/pullRequestStackSnapshot.ts";
import { resolvePullRequestStateModel } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import { readQuery, type QueryRead, type QueryView } from "../pullRequestShared.ts";
import type { PullRequestPopoverView, PullRequestStackLayerView } from "../views/pullRequests.ts";

export type PullRequestChecksPopoverTarget = {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly checksState: PullRequestChecksState;
  readonly checks: ReadonlyArray<PullRequestCheck> | null;
  readonly stale: boolean;
};

export type PullRequestStackPopoverTarget = {
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly stackNumber: number;
  readonly pending: boolean;
  readonly onSelect: ((reference: PullRequestRef) => void) | null;
};

type OpenPopover =
  | {
      readonly kind: "checks";
      readonly anchor: string;
      readonly target: PullRequestChecksPopoverTarget;
    }
  | {
      readonly kind: "stack";
      readonly anchor: string;
      readonly target: PullRequestStackPopoverTarget;
    };

export type PullRequestStackQuery = QueryView<PullRequestStack> & {
  readonly notice: string | null;
};

export interface PullRequestPopoverService {
  readonly openChecks: (anchor: string, target: PullRequestChecksPopoverTarget) => void;
  readonly openStack: (anchor: string, target: PullRequestStackPopoverTarget) => void;
  readonly close: () => void;
  readonly readStack: (
    get: QueryRead,
    environmentId: EnvironmentId,
    reference: PullRequestRef | null,
  ) => PullRequestStackQuery;
  readonly refreshStack: (environmentId: EnvironmentId, reference: PullRequestRef) => void;
  readonly feature: CoreFeature;
}

const OpenCheckParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));
const SelectLayerParams = Schema.decodeUnknownSync(Schema.Struct({ number: Schema.Number }));

export function pullRequestStackLayerViews(
  layers: PullRequestStack["layers"],
  reference: PullRequestRef,
  options: { readonly selectable: boolean; readonly compact: boolean },
): ReadonlyArray<PullRequestStackLayerView> {
  return layers.map((layer) => {
    const state = resolvePullRequestStateModel({
      state: layer.state,
      isDraft: layer.isDraft ?? false,
    });
    return {
      number: layer.number,
      title: layer.title || layer.headBranch,
      subtitle: options.compact
        ? `#${layer.number} · ${state.label}`
        : `#${layer.number} · ${layer.headBranch} · ${state.label}`,
      state,
      current: layer.number === reference.number,
      disabled: !options.selectable,
    };
  });
}

const services = new WeakMap<FeatureContext, PullRequestPopoverService>();

export function pullRequestPopoverService(context: FeatureContext): PullRequestPopoverService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const { registry, state } = context;
  const openAtom = Atom.make<OpenPopover | null>(null).pipe(Atom.keepAlive);

  const readStack: PullRequestPopoverService["readStack"] = (get, environmentId, reference) => {
    const saved =
      reference === null
        ? null
        : savedPullRequestStack(
            get(state.environmentThreadShells.threadShellsAtom)
              .filter((thread) => thread.environmentId === environmentId)
              .flatMap((thread) => thread.pullRequests ?? []),
            reference,
          );
    const query = readQuery(
      get,
      reference === null ? null : state.pullRequestStack({ environmentId, input: reference }),
    );
    return { ...query, ...pullRequestStackView(query, saved) };
  };

  const viewAtom = Atom.make((get): PullRequestPopoverView | null => {
    const open = get(openAtom);
    if (open === null) return null;
    if (open.kind === "checks") {
      const { target } = open;
      const model = buildPullRequestChecksPopoverModel({
        checksState: target.checksState,
        checks: target.checks,
        stale: target.stale,
        canReadLazily: true,
      });
      if (model.body.kind !== "lazy") return { kind: "checks", anchor: open.anchor, model };
      const detail = readQuery(
        get,
        state.pullRequestEnvironment.detail({
          environmentId: target.environmentId,
          input: target.reference,
        }),
      );
      return {
        kind: "checks",
        anchor: open.anchor,
        model: {
          ...model,
          body: buildPullRequestLazyChecksBodyModel({
            checks: detail.data?.checks ?? null,
            isPending: detail.isPending,
            error: detail.error,
          }),
        },
      };
    }
    const { target } = open;
    const query = readStack(get, target.environmentId, target.reference);
    const body = buildPullRequestStackBodyModel({
      stackNumber: target.stackNumber,
      stack: query.data,
      isPending: query.isPending,
      error: query.error,
    });
    const stack = query.data;
    if (stack !== null && body.kind === "stack") {
      return {
        kind: "stack",
        anchor: open.anchor,
        number: body.number,
        notice: query.notice,
        stale: query.error !== null,
        retryLabel: body.retryLabel,
        message: null,
        layers: pullRequestStackLayerViews(stack.layers.toReversed(), target.reference, {
          selectable: target.onSelect !== null && !target.pending,
          compact: false,
        }),
        base: stack.base,
      };
    }
    return {
      kind: "stack",
      anchor: open.anchor,
      number: body.number,
      notice: null,
      stale: false,
      retryLabel: null,
      message: body.kind === "message" ? body.message : null,
      layers: [],
      base: null,
    };
  });

  const refreshStack: PullRequestPopoverService["refreshStack"] = (environmentId, reference) => {
    registry.refresh(state.pullRequestStack({ environmentId, input: reference }));
  };

  const service: PullRequestPopoverService = {
    openChecks: (anchor, target) => registry.set(openAtom, { kind: "checks", anchor, target }),
    openStack: (anchor, target) => registry.set(openAtom, { kind: "stack", anchor, target }),
    close: () => registry.set(openAtom, null),
    readStack,
    refreshStack,
    feature: {
      views: { pullRequestPopover: viewAtom },
      actions: {
        pullRequestPopoverClose: async () => {
          registry.set(openAtom, null);
          return null;
        },
        pullRequestPopoverOpenCheck: async (params) => {
          const { url } = OpenCheckParams(params);
          await openExternal(url).catch((error: unknown) => {
            console.error(error);
            context.addToast({
              layout: "plain",
              type: "error",
              title: PULL_REQUEST_CHECK_OPEN_FAILURE_TITLE,
            });
          });
          return null;
        },
        pullRequestPopoverSelectLayer: async (params) => {
          const { number } = SelectLayerParams(params);
          const open = registry.get(openAtom);
          if (open?.kind !== "stack" || open.target.onSelect === null || open.target.pending) {
            return null;
          }
          registry.set(openAtom, null);
          open.target.onSelect({ ...open.target.reference, number });
          return null;
        },
        pullRequestPopoverRetry: async () => {
          const open = registry.get(openAtom);
          if (open?.kind === "stack")
            refreshStack(open.target.environmentId, open.target.reference);
          return null;
        },
      },
    },
  };
  services.set(context, service);
  return service;
}

export function createPullRequestPopoverFeature(context: FeatureContext): CoreFeature {
  return pullRequestPopoverService(context).feature;
}
