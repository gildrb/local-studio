import type {
  PullRequestMergeMethod,
  PullRequestStack,
  PullRequestStackHead,
  PullRequestStackMembership,
} from "@t3tools/contracts";

export type PullRequestStackLayer = PullRequestStack["layers"][number];

export type PullRequestStackConfirmation = "merge" | "update-branch";

type PullRequestStackPlan = {
  readonly position: number;
  readonly top: PullRequestStackLayer | undefined;
  readonly selectedLayer: PullRequestStackLayer | undefined;
  readonly unmerged: ReadonlyArray<PullRequestStackLayer>;
  readonly mergeLayers: ReadonlyArray<PullRequestStackLayer>;
  readonly mergeBlockedByState: boolean;
  readonly mergeDisabled: boolean;
  readonly rebaseDisabled: boolean;
};

function stackHeads(layers: ReadonlyArray<PullRequestStackLayer>): PullRequestStackHead[] {
  return layers.flatMap((layer) =>
    layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
  );
}

function planPullRequestStack(input: {
  readonly stack: PullRequestStack;
  readonly referenceNumber: number;
  readonly pending: boolean;
}): PullRequestStackPlan {
  const { stack } = input;
  const unmerged = stack.layers.filter((layer) => layer.state !== "merged");
  const hasClosed = unmerged.some((layer) => layer.state !== "open");
  const position = stack.layers.findIndex((layer) => layer.number === input.referenceNumber) + 1;
  const mergeLayers = stack.layers.slice(0, position).filter((layer) => layer.state !== "merged");
  const selectedLayer = stack.layers[position - 1];
  const mergeHasClosed = mergeLayers.some((layer) => layer.state !== "open");
  const mergeHasDraft = mergeLayers.some((layer) => layer.isDraft);
  const hasUnknownHead = stackHeads(unmerged).length !== unmerged.length;
  return {
    position,
    top: stack.layers.at(-1),
    selectedLayer,
    unmerged,
    mergeLayers,
    mergeBlockedByState: mergeHasClosed || mergeHasDraft,
    mergeDisabled:
      input.pending ||
      selectedLayer?.state !== "open" ||
      mergeLayers.some((layer) => !layer.headSha) ||
      mergeHasClosed ||
      mergeLayers.length === 0 ||
      mergeHasDraft,
    rebaseDisabled: input.pending || hasUnknownHead || hasClosed || unmerged.length === 0,
  };
}

export type PullRequestStackMenuInput = {
  readonly stack: PullRequestStack;
  readonly referenceNumber: number;
  readonly canMerge: boolean;
  readonly canRebase: boolean;
  readonly mergeMethod: PullRequestMergeMethod;
  readonly pending: boolean;
  readonly notice: string | null;
  readonly stale: boolean;
  readonly confirmation: PullRequestStackConfirmation | null;
};

export type PullRequestStackMenuItemModel = {
  readonly visible: boolean;
  readonly label: string;
  readonly disabled: boolean;
};

export type PullRequestStackMenuModel = {
  readonly trigger: {
    readonly ariaLabel: string;
    readonly positionLabel: string;
    readonly warning: boolean;
    readonly tooltip: string;
  };
  readonly retryLabel: string | null;
  readonly actionsVisible: boolean;
  readonly mergeItem: PullRequestStackMenuItemModel;
  readonly rebaseItem: PullRequestStackMenuItemModel;
  readonly blockedNote: string | null;
  readonly mergeButton: PullRequestStackMenuItemModel & { readonly tooltip: string };
  readonly dialog: {
    readonly open: boolean;
    readonly title: string;
    readonly description: string;
    readonly layerNumbers: ReadonlyArray<number>;
    readonly dismissible: boolean;
    readonly cancelLabel: string;
    readonly confirmLabel: string;
    readonly buttonsDisabled: boolean;
  };
};

export function buildPullRequestStackMenuModel(
  input: PullRequestStackMenuInput,
): PullRequestStackMenuModel {
  const { stack } = input;
  const plan = planPullRequestStack(input);
  const size = stack.layers.length;
  const mergeCount = plan.mergeLayers.length;
  const confirmationLayers = input.confirmation === "merge" ? plan.mergeLayers : plan.unmerged;
  return {
    trigger: {
      ariaLabel: `Stack ${stack.number}, layer ${plan.position} of ${size}`,
      positionLabel: `${plan.position}/${size}`,
      warning: input.stale,
      tooltip: `View stack #${stack.number}, layer ${plan.position} of ${size}${
        input.notice ? ` · ${input.notice}` : ""
      }`,
    },
    retryLabel: input.stale ? "Retry stack refresh" : null,
    actionsVisible: input.canMerge || input.canRebase,
    mergeItem: {
      visible: input.canMerge,
      label: `Merge stack (${mergeCount})`,
      disabled: plan.mergeDisabled,
    },
    rebaseItem: { visible: input.canRebase, label: "Rebase stack", disabled: plan.rebaseDisabled },
    blockedNote:
      (input.canMerge || input.canRebase) && plan.mergeBlockedByState
        ? "Every layer being merged must be open and ready for review."
        : null,
    mergeButton: {
      visible: input.canMerge && plan.selectedLayer?.state === "open",
      label: "Merge stack",
      disabled: plan.mergeDisabled,
      tooltip: `Merge stack through #${input.referenceNumber} into ${stack.base} (${mergeCount} ${
        mergeCount === 1 ? "pull request" : "pull requests"
      })`,
    },
    dialog: {
      open: input.confirmation !== null,
      title:
        input.confirmation === "merge"
          ? `Merge ${mergeCount} pull requests?`
          : `Rebase ${plan.unmerged.length} pull requests?`,
      description:
        input.confirmation === "merge"
          ? `Merge #${input.referenceNumber} and its unmerged layers below into ${stack.base} using ${input.mergeMethod}. GitHub checks their rules before merging or queueing them and rebases the remaining stack after merging.`
          : `Rebase the remote branches from bottom to top onto ${stack.base}. This rewrites branch history and may restart checks. If a layer fails, earlier updates remain.`,
      layerNumbers: confirmationLayers.map((layer) => layer.number),
      dismissible: !input.pending,
      cancelLabel: "Cancel",
      confirmLabel: input.pending
        ? "Working…"
        : input.confirmation === "merge"
          ? "Merge stack"
          : "Rebase stack",
      buttonsDisabled: input.pending,
    },
  };
}

export type PullRequestStackActionDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "run";
      readonly action: PullRequestStackConfirmation;
      readonly number: number;
      readonly stackNumber: number;
      readonly expectedStackHeads: ReadonlyArray<PullRequestStackHead>;
      readonly mergeMethod: PullRequestMergeMethod | null;
    };

export function resolvePullRequestStackAction(input: {
  readonly stack: PullRequestStack;
  readonly referenceNumber: number;
  readonly canMerge: boolean;
  readonly canRebase: boolean;
  readonly mergeMethod: PullRequestMergeMethod;
  readonly pending: boolean;
  readonly confirmation: PullRequestStackConfirmation | null;
}): PullRequestStackActionDecision {
  const plan = planPullRequestStack(input);
  const action = input.confirmation;
  if (
    input.pending ||
    action === null ||
    (action === "merge"
      ? !input.canMerge || plan.mergeDisabled
      : !input.canRebase || plan.rebaseDisabled)
  ) {
    return { kind: "ignore" };
  }
  const target = action === "merge" ? plan.selectedLayer : plan.top;
  if (!target?.headSha) return { kind: "ignore" };
  return {
    kind: "run",
    action,
    number: target.number,
    stackNumber: input.stack.number,
    expectedStackHeads: stackHeads(action === "merge" ? plan.mergeLayers : plan.unmerged),
    mergeMethod: action === "merge" ? input.mergeMethod : null,
  };
}

export type PullRequestStackActionToast = {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description: string | undefined;
};

export function pullRequestStackActionToast(input: {
  readonly action: PullRequestStackConfirmation;
  readonly failure: string | null;
}): PullRequestStackActionToast {
  if (input.failure !== null) {
    return {
      type: "error",
      title: "Stack operation did not complete",
      description: input.failure,
    };
  }
  return {
    type: "success",
    title: input.action === "merge" ? "Stack merge request completed" : "Stack rebased",
    description:
      input.action === "merge"
        ? "GitHub merged the stack or added it to its merge queue."
        : undefined,
  };
}

export type PullRequestStackPopoverModel = {
  readonly ariaLabel: string;
  readonly positionLabel: string;
  readonly tooltip: string;
};

export function buildPullRequestStackPopoverModel(
  membership: PullRequestStackMembership,
): PullRequestStackPopoverModel {
  return {
    ariaLabel: `Stack ${membership.number}, layer ${membership.position} of ${membership.size}`,
    positionLabel: `${membership.position}/${membership.size}`,
    tooltip: `View stack #${membership.number}, layer ${membership.position} of ${membership.size}`,
  };
}

export type PullRequestStackBodyModel =
  | { readonly kind: "stack"; readonly number: number; readonly retryLabel: string | null }
  | { readonly kind: "message"; readonly number: number; readonly message: string };

export function buildPullRequestStackBodyModel(input: {
  readonly stackNumber: number;
  readonly stack: PullRequestStack | null;
  readonly isPending: boolean;
  readonly error: string | null;
}): PullRequestStackBodyModel {
  if (input.stack !== null) {
    return {
      kind: "stack",
      number: input.stack.number,
      retryLabel: input.error ? "Retry stack refresh" : null,
    };
  }
  return {
    kind: "message",
    number: input.stackNumber,
    message:
      input.error ??
      (input.isPending ? "Loading stack…" : "This pull request is no longer in a stack."),
  };
}
