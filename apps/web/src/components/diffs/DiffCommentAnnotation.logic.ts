export const DIFF_COMMENT_COPY = {
  placeholder: "Add a comment…",
  submitLabel: "Comment",
  cancelLabel: "Cancel",
  sendHint: "⌘/Ctrl Enter to send",
  deleteLabel: "Delete comment",
} as const;

export function diffCommentAriaLabel(rangeLabel: string): string {
  return `Comment on lines ${rangeLabel}`;
}
