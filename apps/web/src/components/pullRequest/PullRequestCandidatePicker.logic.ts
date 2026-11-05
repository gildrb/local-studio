export type PullRequestCandidatePickerIcon = "user-plus" | "tag";

export type PullRequestCandidatePickerCopy = {
  readonly icon: PullRequestCandidatePickerIcon;
  readonly label: string;
  readonly disabledReason: string;
  readonly searchLabel: string;
  readonly emptyLabel: string;
  readonly noMatchLabel: string;
  readonly errorLabel: string;
  readonly truncatedLabel: string;
};

export type PullRequestCandidatePickerInput<Row> = {
  readonly copy: PullRequestCandidatePickerCopy;
  readonly allowed: boolean;
  readonly query: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly rows: ReadonlyArray<Row>;
  readonly truncated: boolean;
  readonly changePending: boolean;
};

export type PullRequestCandidatePickerBody =
  | { readonly kind: "loading" }
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "rows" };

export type PullRequestCandidatePickerModel<Row> =
  | {
      readonly kind: "disabled";
      readonly icon: PullRequestCandidatePickerIcon;
      readonly label: string;
      readonly tooltip: string;
    }
  | {
      readonly kind: "enabled";
      readonly icon: PullRequestCandidatePickerIcon;
      readonly label: string;
      readonly searchLabel: string;
      readonly body: PullRequestCandidatePickerBody;
      readonly rows: ReadonlyArray<Row>;
      readonly rowsDisabled: boolean;
      readonly truncatedNotice: string | null;
    };

export function buildPullRequestCandidatePickerModel<Row>(
  input: PullRequestCandidatePickerInput<Row>,
): PullRequestCandidatePickerModel<Row> {
  const { copy } = input;
  if (!input.allowed) {
    return { kind: "disabled", icon: copy.icon, label: copy.label, tooltip: copy.disabledReason };
  }
  const body: PullRequestCandidatePickerBody = input.isPending
    ? { kind: "loading" }
    : input.error !== null
      ? { kind: "message", message: `${copy.errorLabel} ${input.error}` }
      : input.rows.length === 0
        ? {
            kind: "message",
            message: input.query.length > 0 ? copy.noMatchLabel : copy.emptyLabel,
          }
        : { kind: "rows" };
  return {
    kind: "enabled",
    icon: copy.icon,
    label: copy.label,
    searchLabel: copy.searchLabel,
    body,
    rows: input.rows,
    rowsDisabled: input.changePending,
    truncatedNotice: input.truncated ? copy.truncatedLabel : null,
  };
}

export type PullRequestCandidateToastModel = {
  readonly type: "success" | "error";
  readonly title: string;
  readonly description?: string;
};
