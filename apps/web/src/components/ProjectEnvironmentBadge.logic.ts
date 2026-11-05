import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";

export interface ProjectEnvironmentBadgeModel {
  readonly kind: EnvironmentMachineKind;
  readonly description: string;
}

/**
 * Machine icon for a project picker row whose group has a member on another
 * environment, with the environment names in a tooltip. Projects that only
 * live on this device get nothing, the rule thread rows use for their
 * machine icon.
 */
export function resolveProjectEnvironmentBadge(input: {
  readonly group: Pick<SidebarProjectSnapshot, "memberProjects">;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
}): ProjectEnvironmentBadgeModel | null {
  // Member order follows registration order and can differ between sessions,
  // so sort by label to keep the icon and tooltip stable.
  const remoteMembers = input.group.memberProjects
    .filter((member) => member.environmentId !== input.primaryEnvironmentId)
    .map((member) => ({ ...member, environmentLabel: member.environmentLabel ?? "Remote" }))
    .sort((a, b) => a.environmentLabel.localeCompare(b.environmentLabel));
  const first = remoteMembers[0];
  if (!first) return null;
  const labels = remoteMembers
    .map((member) => member.environmentLabel)
    .filter((label, index, all) => all.indexOf(label) === index)
    .join(", ");
  const alsoHere = remoteMembers.length < input.group.memberProjects.length;
  return {
    kind: input.machineByEnvironmentId.get(first.environmentId) ?? "server",
    description: `${alsoHere ? "Also on" : "On"} ${labels}`,
  };
}
