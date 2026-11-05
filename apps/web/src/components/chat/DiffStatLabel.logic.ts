export type DiffStat = {
  readonly additions: number;
  readonly deletions: number;
};

export type DiffStatLabelModel = {
  readonly additions: number;
  readonly deletions: number;
  readonly additionsText: string;
  readonly deletionsText: string;
  readonly ariaLabel: string;
};

export function hasNonZeroStat(stat: DiffStat): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

export function formatCompactDiffCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  if (value < 1_000_000_000) {
    const m = value / 1_000_000;
    return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
  }
  const b = value / 1_000_000_000;
  return `${b < 10 ? b.toFixed(1).replace(/\.0$/, "") : Math.round(b)}b`;
}

export function buildDiffStatLabelModel(stat: DiffStat): DiffStatLabelModel {
  return {
    additions: stat.additions,
    deletions: stat.deletions,
    additionsText: `+${formatCompactDiffCount(stat.additions)}`,
    deletionsText: `-${formatCompactDiffCount(stat.deletions)}`,
    ariaLabel: `${stat.additions} additions, ${stat.deletions} deletions`,
  };
}
