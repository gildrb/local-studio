/**
 * Multi-environment usage state.
 *
 * Every connected environment answers the same typed query; the client merges
 * the results. Raw transcripts never leave the machine that produced them.
 *
 * @module state/usage
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UsageSummaryInput } from "@t3tools/contracts";
import { refreshUsage } from "@t3tools/client-runtime/state/usage";
import { useCallback, useMemo } from "react";

import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";
import {
  createUsageByWindowAtom,
  mergeSelectedUsage,
  resolveUsageReportingState,
  selectUsageEnvironments,
  usageWindowKey,
  type EnvironmentUsageStatus,
  type UsageReportingState,
} from "./usage.logic";

const usageByWindowAtom = createUsageByWindowAtom({
  label: "web-usage",
  presentationsAtom: environmentPresentations.presentationsAtom,
  usageSummary: serverEnvironment.usageSummary,
  providersValueAtom: serverEnvironment.providersValueAtom,
});

export interface UsageView extends UsageReportingState {
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly refresh: (input?: UsageSummaryInput) => Promise<void>;
}

export function useUsage(
  input: UsageSummaryInput,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null = null,
): UsageView {
  const windowKey = useMemo(
    () =>
      usageWindowKey({
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        timeZone: input.timeZone,
        resolution: input.resolution,
        sinceTime: input.sinceTime,
        untilTime: input.untilTime,
      }),
    [
      input.sinceDay,
      input.untilDay,
      input.timeZone,
      input.resolution,
      input.sinceTime,
      input.untilTime,
    ],
  );
  const atom = usageByWindowAtom(windowKey);
  const environments = useAtomValue(atom);
  const selectedEnvironments = useMemo(
    () => selectUsageEnvironments(environments, selectedEnvironmentIds),
    [environments, selectedEnvironmentIds],
  );

  const refresh = useCallback(
    (nextInput?: UsageSummaryInput) =>
      refreshUsage({
        registry: appAtomRegistry,
        server: serverEnvironment,
        presentations: environmentPresentations,
        environmentIds: selectedEnvironments.map(({ environmentId }) => environmentId),
        input: nextInput ?? JSON.parse(windowKey),
      }),
    [selectedEnvironments, windowKey],
  );

  const merged = useMemo(() => mergeSelectedUsage(selectedEnvironments), [selectedEnvironments]);

  return {
    merged,
    environments,
    selectedEnvironments,
    ...resolveUsageReportingState(selectedEnvironments),
    refresh,
  };
}
