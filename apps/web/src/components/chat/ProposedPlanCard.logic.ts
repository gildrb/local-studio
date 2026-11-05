import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";

import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from "../../proposedPlan";

export interface ProposedPlanCardModel {
  readonly title: string;
  readonly canCollapse: boolean;
  readonly displayedMarkdown: string;
  readonly collapsedPreview: string | null;
  readonly downloadFilename: string;
  readonly saveContents: string;
}

export function resolveProposedPlanCardModel(planMarkdown: string): ProposedPlanCardModel {
  const lineCount = planMarkdown.split("\n").length;
  const canCollapse = planMarkdown.length > 900 || lineCount > 20;
  return {
    title: proposedPlanTitle(planMarkdown) ?? "Proposed plan",
    canCollapse,
    displayedMarkdown: stripDisplayedPlanMarkdown(planMarkdown),
    collapsedPreview: canCollapse
      ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 })
      : null,
    downloadFilename: buildProposedPlanMarkdownFilename(planMarkdown),
    saveContents: normalizePlanMarkdownForExport(planMarkdown),
  };
}

export interface ProposedPlanToast {
  readonly layout: "stacked" | "plain";
  readonly type: "error" | "warning" | "success";
  readonly title: string;
  readonly description?: string;
}

export const PLAN_WORKSPACE_UNAVAILABLE_TOAST: ProposedPlanToast = {
  layout: "stacked",
  type: "error",
  title: "Workspace path is unavailable",
  description: "This thread does not have a workspace path to save into.",
};

export function resolveInitialPlanSavePath(existing: string, downloadFilename: string): string {
  return existing.length > 0 ? existing : downloadFilename;
}

export function copyPlanFailureToast(error: unknown): ProposedPlanToast {
  return {
    layout: "stacked",
    type: "error",
    title: "Could not copy plan",
    description: error instanceof Error ? error.message : "An error occurred while copying.",
  };
}

export function savePlanToWorkspace(
  input: {
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string | undefined;
    readonly savePath: string;
    readonly contents: string;
  },
  deps: {
    readonly setSaving: (saving: boolean) => void;
    readonly writeFile: (input: {
      readonly environmentId: EnvironmentId;
      readonly input: ProjectWriteFileInput;
    }) => Promise<AtomCommandResult<ProjectWriteFileResult, unknown>>;
    readonly onSaved: () => void;
    readonly toast: (toast: ProposedPlanToast) => void;
  },
): Promise<void> | null {
  const relativePath = input.savePath.trim();
  const workspaceRoot = input.workspaceRoot;
  if (!workspaceRoot) {
    return null;
  }
  if (!relativePath) {
    deps.toast({ layout: "plain", type: "warning", title: "Enter a workspace path" });
    return null;
  }

  deps.setSaving(true);
  return (async () => {
    const result = await deps.writeFile({
      environmentId: input.environmentId,
      input: {
        cwd: workspaceRoot,
        relativePath,
        contents: input.contents,
      },
    });
    deps.setSaving(false);
    if (result._tag === "Success") {
      deps.onSaved();
      deps.toast({
        layout: "plain",
        type: "success",
        title: "Plan saved to workspace",
        description: result.value.relativePath,
      });
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      deps.toast({
        layout: "stacked",
        type: "error",
        title: "Could not save plan",
        description: error instanceof Error ? error.message : "An error occurred while saving.",
      });
    }
  })();
}
