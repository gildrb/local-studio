import type { ProviderApprovalOption, ProviderRequestKind } from "@t3tools/contracts";

export const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export function splitApprovalOptions(options: ReadonlyArray<ProviderApprovalOption>): {
  readonly primaryOptions: ReadonlyArray<ProviderApprovalOption>;
  readonly moreOptions: ReadonlyArray<ProviderApprovalOption>;
} {
  return {
    primaryOptions: options.filter(
      (option) => option.decision === "decline" || option.decision === "accept",
    ),
    moreOptions: options.filter(
      (option) => option.decision !== "decline" && option.decision !== "accept",
    ),
  };
}

export interface PendingApprovalCopy {
  readonly label: string;
  readonly detailAriaLabel: string;
  readonly detailFormat: "prose" | "code";
}

export function describePendingApproval(requestKind: ProviderRequestKind): PendingApprovalCopy {
  const label =
    requestKind === "mcp-elicitation"
      ? "App access approval"
      : requestKind === "command"
        ? "Command approval"
        : requestKind === "file-read"
          ? "File read approval"
          : requestKind === "permission"
            ? "App permission approval"
            : "File change approval";
  const detailAriaLabel =
    requestKind === "mcp-elicitation"
      ? "App access request"
      : requestKind === "command"
        ? "Command"
        : requestKind === "file-read"
          ? "File to read"
          : requestKind === "permission"
            ? "Permission request"
            : "File change";
  return {
    label,
    detailAriaLabel,
    detailFormat: requestKind === "mcp-elicitation" ? "prose" : "code",
  };
}
