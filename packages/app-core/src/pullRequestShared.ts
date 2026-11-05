import type { PullRequestAction, PullRequestState, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentPullRequestEntry } from "@t3tools/web/src/components/pullRequest/pullRequestList.logic.ts";
import {
  LIVE_REFRESH_INTERVAL_MS,
  shouldRefreshOnArrival,
  shouldRefreshOnInterval,
} from "@t3tools/web/src/hooks/useLiveRefresh.ts";
import { PULL_REQUESTS_PANEL_REF, pullRequestSurfaceId } from "@t3tools/web/src/rightPanelStore.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Schema from "effect/Schema";

import type { CoreFeature, FeatureContext } from "./feature.ts";

export type QueryRead = <A>(atom: Atom.Atom<A>) => A;

export type QueryView<A> = {
  readonly data: A | null;
  readonly dataUpdatedAt: number | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
};

const EMPTY_QUERY: QueryView<never> = {
  data: null,
  dataUpdatedAt: null,
  error: null,
  isPending: false,
  isSuccess: false,
};

export function readQuery<A, E>(
  get: QueryRead,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): QueryView<A> {
  if (atom === null) return EMPTY_QUERY;
  const result = get(atom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    dataUpdatedAt: result._tag === "Success" ? result.timestamp : null,
    error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    isPending: result.waiting,
    isSuccess: result._tag === "Success",
  };
}

export function pullRequestListEntryId(target: {
  readonly environmentId?: string;
  readonly projectId: string;
  readonly host?: string;
  readonly repository: string;
  readonly number: number;
}): string {
  return pullRequestSurfaceId({ ...target, repository: target.repository.toLowerCase() });
}

export type PullRequestActedPhase = "sent" | "done" | "failed";

export type PullRequestActedListener = (
  action: PullRequestAction | undefined,
  phase: PullRequestActedPhase,
) => void;

export type PullRequestTabStatusSeeds = Readonly<
  Record<string, { readonly state: PullRequestState; readonly isDraft: boolean }>
>;

export type PullRequestPageBridge = {
  readonly listedEntriesAtom: Atom.Writable<ReadonlyMap<string, EnvironmentPullRequestEntry>>;
  readonly tabStatusSeedsAtom: Atom.Writable<PullRequestTabStatusSeeds>;
  readonly detailRefreshTokenAtom: Atom.Writable<number>;
  readonly setActedListener: (listener: PullRequestActedListener | null) => void;
  readonly notifyActed: PullRequestActedListener;
};

const bridges = new WeakMap<FeatureContext, PullRequestPageBridge>();

export function pullRequestPageBridge(context: FeatureContext): PullRequestPageBridge {
  const existing = bridges.get(context);
  if (existing !== undefined) return existing;
  let listener: PullRequestActedListener | null = null;
  const bridge: PullRequestPageBridge = {
    listedEntriesAtom: Atom.make<ReadonlyMap<string, EnvironmentPullRequestEntry>>(new Map()).pipe(
      Atom.keepAlive,
    ),
    tabStatusSeedsAtom: Atom.make<PullRequestTabStatusSeeds>({}).pipe(Atom.keepAlive),
    detailRefreshTokenAtom: Atom.make(0).pipe(Atom.keepAlive),
    setActedListener: (next) => {
      listener = next;
    },
    notifyActed: (action, phase) => listener?.(action, phase),
  };
  bridges.set(context, bridge);
  return bridge;
}

const panelRouteAtoms = new WeakMap<FeatureContext, Atom.Atom<ScopedThreadRef | null>>();

export function panelRouteAtom(context: FeatureContext): Atom.Atom<ScopedThreadRef | null> {
  const existing = panelRouteAtoms.get(context);
  if (existing !== undefined) return existing;
  const atom = Atom.make((get): ScopedThreadRef | null => {
    if (get(context.pageAtom).kind !== "pull-requests") return get(context.routeAtom);
    const capable = [
      ...get(context.state.environmentPresentations.presentationsAtom).values(),
    ].some(
      (presentation) => presentation.serverConfig?.environment.capabilities.pullRequests === true,
    );
    return capable ? PULL_REQUESTS_PANEL_REF : null;
  });
  panelRouteAtoms.set(context, atom);
  return atom;
}

export type EffectRunner = {
  readonly run: (name: string, deps: ReadonlyArray<unknown>, effect: () => void) => void;
  readonly reset: () => void;
};

export function createEffectRunner(): EffectRunner {
  const deps = new Map<string, ReadonlyArray<unknown>>();
  return {
    run: (name, next, effect) => {
      const previous = deps.get(name);
      if (
        previous !== undefined &&
        previous.length === next.length &&
        previous.every((value, index) => Object.is(value, next[index]))
      ) {
        return;
      }
      deps.set(name, next);
      effect();
    },
    reset: () => deps.clear(),
  };
}

export type LiveRefreshHandle = {
  readonly mount: () => void;
  readonly unmount: () => void;
};

type LiveRefreshView = {
  readonly key: string;
  readonly read: () => void;
};

type WindowActivity = {
  readonly register: (view: LiveRefreshView) => () => void;
  readonly feature: CoreFeature;
};

const ActivationParams = Schema.decodeUnknownSync(Schema.Struct({ active: Schema.Boolean }));

const activities = new WeakMap<FeatureContext, WindowActivity>();

function windowActivity(context: FeatureContext): WindowActivity {
  const existing = activities.get(context);
  if (existing !== undefined) return existing;
  const lastRefreshedAtByView = new Map<string, number>();
  const views = new Set<LiveRefreshView>();
  let visible = true;
  let lastInteractedAt = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;

  const read = (view: LiveRefreshView, now: number) => {
    lastRefreshedAtByView.set(view.key, now);
    view.read();
  };
  const arrive = (view: LiveRefreshView) => {
    const now = Date.now();
    const lastRefreshedAt = lastRefreshedAtByView.get(view.key);
    if (lastRefreshedAt === undefined) {
      lastRefreshedAtByView.set(view.key, now);
      return;
    }
    if (shouldRefreshOnArrival({ visible, now, lastRefreshedAt })) read(view, now);
  };
  const tick = () => {
    const now = Date.now();
    for (const view of views) {
      const lastRefreshedAt = lastRefreshedAtByView.get(view.key) ?? now;
      if (shouldRefreshOnInterval({ visible, now, lastRefreshedAt, lastInteractedAt })) {
        read(view, now);
      }
    }
  };
  const syncTimer = () => {
    clearInterval(timer);
    timer = visible && views.size > 0 ? setInterval(tick, LIVE_REFRESH_INTERVAL_MS) : undefined;
  };

  const activity: WindowActivity = {
    register: (view) => {
      if (views.size === 0) lastInteractedAt = Date.now();
      views.add(view);
      arrive(view);
      syncTimer();
      return () => {
        views.delete(view);
        syncTimer();
      };
    },
    feature: {
      views: {},
      actions: {
        liveRefreshWindowActivation: async (params) => {
          const { active } = ActivationParams(params);
          visible = active;
          if (active) {
            lastInteractedAt = Date.now();
            for (const view of views) arrive(view);
          }
          syncTimer();
          return null;
        },
        liveRefreshInteraction: async () => {
          lastInteractedAt = Date.now();
          return null;
        },
      },
    },
  };
  activities.set(context, activity);
  return activity;
}

export function createWindowActivityFeature(context: FeatureContext): CoreFeature {
  return windowActivity(context).feature;
}

export function createLiveRefresh(
  context: FeatureContext,
  key: () => string,
  refresh: () => void,
): LiveRefreshHandle {
  let unregister: (() => void) | null = null;
  return {
    mount: () => {
      if (unregister !== null) return;
      unregister = windowActivity(context).register({
        get key() {
          return key();
        },
        read: refresh,
      });
    },
    unmount: () => {
      unregister?.();
      unregister = null;
    },
  };
}
