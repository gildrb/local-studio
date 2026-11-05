import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type ServerProvider,
  type UsageSummary,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { needsCursorKeychainAccess } from "@t3tools/client-runtime/state/usage";
import { mergeUsage, type EnvironmentUsage, type MergedUsage } from "@t3tools/shared/usageMerge";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export interface EnvironmentUsageStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly summary: UsageSummary | null;
  readonly needsCursorKeychainAccess: boolean;
}

export type UsageWindowAtomSources<E> = {
  readonly label: string;
  readonly presentationsAtom: Atom.Atom<
    ReadonlyMap<EnvironmentId, { readonly entry: { readonly target: { readonly label: string } } }>
  >;
  readonly usageSummary: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: UsageSummaryInput;
  }) => Atom.Atom<AsyncResult.AsyncResult<UsageSummary, E>>;
  readonly providersValueAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<readonly ServerProvider[] | null>;
};

/**
 * Serialises a window so switching ranges does not thrash the atom cache, and
 * so each environment's query is shared with any other reader of the same window.
 */
export function usageWindowKey(input: UsageSummaryInput): string {
  return JSON.stringify({
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
    resolution: input.resolution,
    sinceTime: input.sinceTime,
    untilTime: input.untilTime,
  });
}

/** Reads every environment's summary for one window, keyed by `usageWindowKey`. */
export function createUsageByWindowAtom<E>(
  sources: UsageWindowAtomSources<E>,
): (windowKey: string) => Atom.Atom<readonly EnvironmentUsageStatus[]> {
  return Atom.family((windowKey: string) =>
    Atom.make((get): readonly EnvironmentUsageStatus[] => {
      const input: UsageSummaryInput = JSON.parse(windowKey);
      const presentations = get(sources.presentationsAtom);

      const statuses: EnvironmentUsageStatus[] = [];
      for (const [environmentId, presentation] of presentations) {
        const result = get(sources.usageSummary({ environmentId, input }));
        const summary = Option.getOrNull(AsyncResult.value(result));
        statuses.push({
          environmentId,
          label: presentation.entry.target.label,
          isPending: result.waiting,
          error: result._tag === "Failure" ? "This environment could not report usage." : null,
          summary,
          needsCursorKeychainAccess: needsCursorKeychainAccess(
            summary,
            get(sources.providersValueAtom(environmentId)),
          ),
        });
      }
      return statuses;
    }).pipe(Atom.withLabel(`${sources.label}:window:${windowKey}`)),
  );
}

export function selectUsageEnvironments(
  environments: readonly EnvironmentUsageStatus[],
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
): readonly EnvironmentUsageStatus[] {
  return selectedEnvironmentIds === null
    ? environments
    : environments.filter((environment) => selectedEnvironmentIds.has(environment.environmentId));
}

export function mergeSelectedUsage(
  selectedEnvironments: readonly EnvironmentUsageStatus[],
): MergedUsage {
  const answered: EnvironmentUsage[] = selectedEnvironments.flatMap((environment) =>
    environment.summary === null
      ? []
      : [
          {
            environmentId: environment.environmentId,
            label: environment.label,
            summary: environment.summary,
          },
        ],
  );
  return mergeUsage(answered, USAGE_CONTRACT_VERSION);
}

export type UsageReportingState = {
  /** True until at least one selected environment has answered. */
  readonly isPending: boolean;
  /**
   * True while environments that have not failed are still answering. Failed
   * environments are reported through their own error rows: totals will not
   * improve by waiting on them, so they must not read as "still reporting".
   */
  readonly isPartial: boolean;
};

export function resolveUsageReportingState(
  selectedEnvironments: readonly EnvironmentUsageStatus[],
): UsageReportingState {
  const answeredCount = selectedEnvironments.filter(
    (environment) => environment.summary !== null,
  ).length;
  const stillReporting = selectedEnvironments.filter(
    (environment) => environment.summary === null && environment.error === null,
  ).length;
  return {
    isPending: answeredCount === 0 && stillReporting > 0,
    isPartial: answeredCount > 0 && stillReporting > 0,
  };
}
