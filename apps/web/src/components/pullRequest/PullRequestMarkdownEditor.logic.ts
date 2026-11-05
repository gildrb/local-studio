export type PullRequestMarkdownEditorModel = {
  readonly modeLabel: string;
  readonly modes: ReadonlyArray<{ readonly value: "write" | "preview"; readonly label: string }>;
  readonly mode: "write" | "preview";
  readonly modeDisabled: boolean;
  readonly empty: boolean;
  readonly emptyPreviewLabel: string;
  readonly cancelLabel: string;
  readonly cancelDisabled: boolean;
  readonly saveLabel: string;
  readonly saveDisabled: boolean;
};

export function buildPullRequestMarkdownEditorModel(input: {
  readonly draft: string;
  readonly preview: boolean;
  readonly saving: boolean;
  readonly allowEmpty: boolean;
}): PullRequestMarkdownEditorModel {
  const empty = input.draft.trim().length === 0;
  return {
    modeLabel: "Markdown editor mode",
    modes: [
      { value: "write", label: "Write" },
      { value: "preview", label: "Preview" },
    ],
    mode: input.preview ? "preview" : "write",
    modeDisabled: input.saving,
    empty,
    emptyPreviewLabel: "Nothing to preview.",
    cancelLabel: "Cancel",
    cancelDisabled: input.saving,
    saveLabel: input.saving ? "Saving..." : "Save",
    saveDisabled: input.saving || (empty && !input.allowEmpty),
  };
}

export type PullRequestMarkdownEditorKey = "save" | "cancel" | "none";

export function resolvePullRequestMarkdownEditorKey(input: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly saving: boolean;
}): PullRequestMarkdownEditorKey {
  if (
    input.key === "Enter" &&
    (input.metaKey || input.ctrlKey) &&
    !input.shiftKey &&
    !input.altKey
  ) {
    return "save";
  }
  if (input.key !== "Escape" || input.saving) return "none";
  return "cancel";
}
