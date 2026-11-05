import type { TerminalSummary } from "@t3tools/contracts";

/** Terminal summaries in display order: numeric-aware by terminal id. */
export function sortTerminalSummaries(
  metadata: ReadonlyArray<TerminalSummary>,
): ReadonlyArray<TerminalSummary> {
  const compare = new Intl.Collator(undefined, { numeric: true }).compare;
  return metadata.toSorted((left, right) => compare(left.terminalId, right.terminalId));
}
