import {
  gitHubRoutingConnectionKey,
  gitHubRoutingPermissionFor,
  type GitHubRoutingPermission,
  type StoredGitHubRoutingPermission,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

import type { EnvironmentPresentation } from "../../state/environments";
import { buildEnvironmentRowModel, type EnvironmentRowModel } from "./EnvironmentRow.logic";
import { searchableSetting } from "./settingsSearch";

export type GitHubRoutingOption = {
  readonly value: GitHubRoutingPermission;
  readonly label: string;
};

export const GITHUB_ROUTING_OPTIONS: ReadonlyArray<GitHubRoutingOption> = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read PRs" },
  { value: "read-write", label: "Read and act" },
];

const summaryLabels = { "read-write": "read and act", read: "read PRs" } as const;

export type GitHubRoutingSummaryEntry = {
  readonly label: string;
  readonly permission: GitHubRoutingPermission;
};

export function summarizeGitHubRouting(
  entries: ReadonlyArray<GitHubRoutingSummaryEntry>,
): string | null {
  const groups = (["read-write", "read"] as const).flatMap((permission) => {
    const labels = entries.filter((entry) => entry.permission === permission);
    return labels.length === 0
      ? []
      : [`${labels.map((entry) => entry.label).join(", ")} ${summaryLabels[permission]}`];
  });
  return groups.length === 0 ? null : groups.join(" · ");
}

export type GitHubRoutingSettingsModelInput = {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly permissions: ReadonlyArray<StoredGitHubRoutingPermission>;
  readonly catalogReady: boolean;
  readonly saving: boolean;
};

export type GitHubRoutingRow = EnvironmentRowModel & {
  readonly value: GitHubRoutingPermission;
  readonly options: ReadonlyArray<GitHubRoutingOption>;
  readonly disabled: boolean;
  readonly ariaLabel: string;
};

export type GitHubRoutingSettingsModel = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly rows: ReadonlyArray<GitHubRoutingRow>;
};

export function buildGitHubRoutingSettingsModel(
  input: GitHubRoutingSettingsModelInput,
): GitHubRoutingSettingsModel | null {
  if (input.environments.length < 2) return null;
  const { id, title } = searchableSetting("github-routing");
  const rows = input.environments.map((environment): GitHubRoutingRow => ({
    ...buildEnvironmentRowModel({ environment }),
    value: gitHubRoutingPermissionFor(environment.entry, input.permissions),
    options: GITHUB_ROUTING_OPTIONS,
    disabled:
      !input.catalogReady || input.saving || gitHubRoutingConnectionKey(environment.entry) === null,
    ariaLabel: `${environment.label} GitHub routing`,
  }));
  return {
    id,
    title,
    summary:
      summarizeGitHubRouting(rows.map((row) => ({ label: row.label, permission: row.value }))) ??
      "Off",
    description:
      "Machines you trust here can read PR data through each other's GitHub access. Enable both machines. Read and act may use broader permissions than the machine that owns them. This applies only to this device.",
    rows,
  };
}

export type GitHubRoutingChange =
  | { readonly kind: "none" }
  | {
      readonly kind: "save";
      readonly environmentId: EnvironmentId;
      readonly permission: GitHubRoutingPermission;
      readonly failureToastTitle: string;
    };

export function resolveGitHubRoutingChange(input: {
  readonly environmentId: EnvironmentId;
  readonly permission: GitHubRoutingPermission | null;
}): GitHubRoutingChange {
  if (input.permission === null) return { kind: "none" };
  return {
    kind: "save",
    environmentId: input.environmentId,
    permission: input.permission,
    failureToastTitle: "Could not save GitHub routing permission",
  };
}
