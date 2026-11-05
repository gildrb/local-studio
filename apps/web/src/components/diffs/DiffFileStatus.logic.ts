export type DiffFileLoadState = {
  readonly error?: boolean | undefined;
  readonly truncated?: boolean | undefined;
};

export type DiffFileStatusModel = {
  readonly kind: "error" | "truncated";
  readonly icon: "rotate-cw" | "info";
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export function buildDiffFileStatusModel(state: DiffFileLoadState): DiffFileStatusModel | null {
  if (state.error) {
    return {
      kind: "error",
      icon: "rotate-cw",
      ariaLabel: "Retry loading diff",
      tooltip: "Retry loading diff",
    };
  }
  if (state.truncated) {
    return {
      kind: "truncated",
      icon: "info",
      ariaLabel: "Partial diff preview",
      tooltip: "This file is too large to show in full. Counts include all changes.",
    };
  }
  return null;
}

export type DiffFileStatusClickIntent = { readonly kind: "retry" } | { readonly kind: "none" };

export function resolveDiffFileStatusClick(
  model: DiffFileStatusModel | null,
): DiffFileStatusClickIntent {
  return model?.kind === "error" ? { kind: "retry" } : { kind: "none" };
}
