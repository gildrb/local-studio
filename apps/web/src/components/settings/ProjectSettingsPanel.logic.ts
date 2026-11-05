import type { EnvironmentId, ProjectIconOverride } from "@t3tools/contracts";

import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type { Project } from "../../types";
import { canPickExternalProjectFavicon } from "./ProjectFaviconPickerDialog.logic";

export type ProjectSettingsEnvironmentStatus = {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly hasServerConfig: boolean;
};

export type ProjectSettingsPanelModelInput = {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly projectKey: string;
  readonly environmentId: EnvironmentId | null;
  readonly checkoutKey: string | null;
};

export type ProjectSettingsPanelModel =
  | { readonly kind: "no-projects"; readonly message: string }
  | { readonly kind: "project-missing"; readonly message: string }
  | { readonly kind: "checkout-missing"; readonly message: string }
  | {
      readonly kind: "detail";
      readonly detailKey: string;
      readonly group: SidebarProjectSnapshot;
      readonly hasOtherMembers: boolean;
      readonly memberKeys: readonly string[];
    };

export type ProjectSettingsLastSelection = {
  readonly key: string;
  readonly environmentId: EnvironmentId | null;
  readonly checkoutKey: string | null;
  readonly memberKeys: readonly string[];
};

export type ProjectSettingsRedirectInput = {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly last: ProjectSettingsLastSelection | null;
  readonly projectKey: string;
  readonly environmentId: EnvironmentId | null;
  readonly checkoutKey: string | null;
};

export type ProjectSettingsRedirect = {
  readonly project: string;
  readonly machine: EnvironmentId | null;
  readonly checkout: string | null;
};

export type ProjectDetailModelInput = {
  readonly group: SidebarProjectSnapshot;
  readonly hasOtherMembers: boolean;
  readonly environments: ReadonlyArray<ProjectSettingsEnvironmentStatus>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly platform: string;
  readonly hasExternalFaviconPicker: boolean;
  readonly isSavingIcon: boolean;
};

export type ProjectDetailButton = {
  readonly label: string;
  readonly ariaLabel: string;
};

export type ProjectDetailCheckoutRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly removeLabel: string;
  readonly removeAriaLabel: string;
};

export type ProjectDetailModel = {
  readonly notice: string;
  readonly overviewSectionId: string;
  readonly overviewTitle: string;
  readonly representative: Project;
  readonly name: {
    readonly title: string;
    readonly description: string;
    readonly value: string;
    readonly inputKey: string;
    readonly ariaLabel: string;
  };
  readonly icon: {
    readonly title: string;
    readonly description: string;
    readonly current: ProjectIconOverride | null;
    readonly resettable: boolean;
    readonly resetLabel: string;
    readonly disabled: boolean;
    readonly chooseIcon: ProjectDetailButton;
    readonly chooseFile: ProjectDetailButton;
    readonly canPickExternalFavicon: boolean;
  };
  readonly checkouts: {
    readonly title: string;
    readonly rows: readonly ProjectDetailCheckoutRow[];
  } | null;
  readonly danger: {
    readonly sectionTitle: string;
    readonly title: string;
    readonly description: string;
    readonly actionLabel: string;
    readonly actionIcon: string;
  };
};

export type ProjectMemberPatch = Partial<{
  title: string;
  faviconPath: string | null;
  projectIcon: ProjectIconOverride | null;
}>;

export type ProjectRenameDecision =
  | {
      readonly kind: "reject";
      readonly toast: { readonly type: "warning"; readonly title: string };
    }
  | { readonly kind: "skip" }
  | { readonly kind: "update"; readonly patch: ProjectMemberPatch; readonly failureTitle: string };

export type ProjectIconIntent =
  | { readonly kind: "reset" }
  | { readonly kind: "favicon"; readonly path: string }
  | { readonly kind: "icon"; readonly icon: ProjectIconOverride };

export type ProjectIconChange = {
  readonly patch: {
    readonly faviconPath: string | null;
    readonly projectIcon: ProjectIconOverride | null;
  };
  readonly failureTitle: string;
};

export type ProjectMembersUpdateDecision =
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "update" };

export type ProjectRemovalThread = {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
};

export type ProjectRemovalPlan<Thread extends ProjectRemovalThread> = {
  readonly confirmation: string;
  readonly members: ReadonlyArray<{
    readonly member: SidebarProjectGroupMember;
    readonly threads: readonly Thread[];
    readonly failureTitle: string;
  }>;
  readonly navigateHome: boolean;
};

export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

function memberKey(member: { environmentId: string; id: string }): string {
  return `${member.environmentId}:${member.id}`;
}

export function buildProjectSettingsPanelModel(
  input: ProjectSettingsPanelModelInput,
): ProjectSettingsPanelModel {
  const { groups, projectKey, environmentId, checkoutKey } = input;
  const selected = groups.find((group) => group.projectKey === projectKey) ?? null;
  if (!selected) {
    return groups.length === 0
      ? { kind: "no-projects", message: "Add a project from the sidebar to configure it here." }
      : { kind: "project-missing", message: "This project is no longer available." };
  }
  const members = selected.memberProjects.filter(
    (member) =>
      (environmentId === null || member.environmentId === environmentId) &&
      (checkoutKey === null || member.physicalProjectKey === checkoutKey),
  );
  const first = members[0];
  if (!first) {
    return {
      kind: "checkout-missing",
      message: "This checkout is no longer available in the selected project and environment.",
    };
  }
  return {
    kind: "detail",
    detailKey: `${selected.projectKey}:${environmentId ?? "all"}:${checkoutKey ?? "all"}`,
    group: {
      ...selected,
      memberProjects: members,
      environmentId: first.environmentId,
      id: first.id,
    },
    hasOtherMembers: members.length < selected.memberProjects.length,
    memberKeys: members.map((member) => member.physicalProjectKey),
  };
}

export function resolveProjectSettingsRedirect(
  input: ProjectSettingsRedirectInput,
): ProjectSettingsRedirect | null {
  const { last } = input;
  if (
    last?.key !== input.projectKey ||
    last.environmentId !== input.environmentId ||
    last.checkoutKey !== input.checkoutKey
  ) {
    return null;
  }
  const successor = input.groups.find((group) =>
    group.memberProjects.some((member) => last.memberKeys.includes(member.physicalProjectKey)),
  );
  return successor
    ? {
        project: successor.projectKey,
        machine: input.environmentId,
        checkout: input.checkoutKey,
      }
    : null;
}

export function resolveProjectRepresentative(
  group: SidebarProjectSnapshot,
  environments: ReadonlyArray<ProjectSettingsEnvironmentStatus>,
): Project {
  return (
    group.memberProjects.find(
      (member) =>
        environments.find((environment) => environment.environmentId === member.environmentId)
          ?.hasServerConfig === true,
    ) ??
    group.memberProjects[0] ??
    group
  );
}

function projectIconDescription(
  projectIcon: ProjectIconOverride | null,
  faviconPath: string | null,
): string {
  return projectIcon?.kind === "lucide"
    ? `${projectIcon.name} · ${projectIcon.color}`
    : projectIcon?.kind === "monogram"
      ? `${projectIcon.text} · ${projectIcon.color}`
      : projectIcon?.kind === "emoji"
        ? projectIcon.emoji
        : (faviconPath ?? "Automatic");
}

export function buildProjectDetailModel(input: ProjectDetailModelInput): ProjectDetailModel {
  const { group, hasOtherMembers } = input;
  const representative = resolveProjectRepresentative(group, input.environments);
  const projectIcon = representative.projectIcon ?? null;
  const faviconPath = representative.faviconPath ?? null;
  const memberCount = group.memberProjects.length;
  return {
    notice:
      "Can't find a setting? Keep this project picked above and hop to any other settings page.",
    overviewSectionId: "project-overview",
    overviewTitle: "Project",
    representative,
    name: {
      title: "Name",
      description: "The shared name for this project group in the sidebar and thread lists.",
      value: group.displayName,
      inputKey: `${group.projectKey}:${group.displayName}`,
      ariaLabel: "Project name",
    },
    icon: {
      title: "Project icon",
      description: projectIconDescription(projectIcon, faviconPath),
      current: projectIcon,
      resettable: group.memberProjects.some(
        (member) => member.faviconPath != null || member.projectIcon != null,
      ),
      resetLabel: "project icon",
      disabled: input.isSavingIcon,
      chooseIcon: { label: "Choose icon", ariaLabel: "Choose a project icon" },
      chooseFile: { label: "Choose file", ariaLabel: "Choose a project icon file" },
      canPickExternalFavicon:
        input.hasExternalFaviconPicker &&
        group.memberProjects.every(
          (member) =>
            member.environmentId === input.primaryEnvironmentId &&
            canPickExternalProjectFavicon(member.workspaceRoot, input.platform),
        ),
    },
    checkouts:
      memberCount > 1
        ? {
            title: "Checkouts",
            rows: group.memberProjects.map((member) => ({
              id: member.physicalProjectKey,
              title: member.environmentLabel ?? "Environment",
              description: member.workspaceRoot,
              removeLabel: "Remove",
              removeAriaLabel: `Remove checkout ${member.workspaceRoot}`,
            })),
          }
        : null,
    danger: {
      sectionTitle: "Danger",
      title: hasOtherMembers
        ? "Remove checkout"
        : memberCount > 1
          ? "Remove this project everywhere"
          : "Remove project",
      description: hasOtherMembers
        ? "Deletes the selected machine's checkout entries and their threads. Other machines and files on disk are not touched."
        : memberCount > 1
          ? `Deletes all ${memberCount} checkout entries and their threads on every machine. Files on disk are not touched.`
          : "Deletes the project entry and its threads. Files on disk are not touched.",
      actionLabel: hasOtherMembers
        ? "Remove checkout"
        : memberCount > 1
          ? "Remove all entries"
          : "Remove project",
      actionIcon: "trash-2",
    },
  };
}

export function resolveProjectRename(input: {
  readonly memberTitles: ReadonlyArray<string>;
  readonly nextTitle: string;
  readonly wasEdited: boolean;
}): ProjectRenameDecision {
  const title = input.nextTitle.trim();
  if (!title) {
    return { kind: "reject", toast: { type: "warning", title: "Project title cannot be empty" } };
  }
  if (!projectGroupTitleNeedsUpdate(input.memberTitles, title, input.wasEdited)) {
    return { kind: "skip" };
  }
  return { kind: "update", patch: { title }, failureTitle: "Failed to rename project" };
}

export function resolveProjectIconChange(intent: ProjectIconIntent): ProjectIconChange {
  return {
    patch:
      intent.kind === "favicon"
        ? { faviconPath: intent.path, projectIcon: null }
        : intent.kind === "icon"
          ? { faviconPath: null, projectIcon: intent.icon }
          : { faviconPath: null, projectIcon: null },
    failureTitle: "Failed to update project icon",
  };
}

export function resolveProjectMembersUpdate(input: {
  readonly members: ReadonlyArray<
    Pick<SidebarProjectGroupMember, "environmentId" | "environmentLabel">
  >;
  readonly environments: ReadonlyArray<ProjectSettingsEnvironmentStatus>;
}): ProjectMembersUpdateDecision {
  const unavailable = input.members.find((member) => {
    const environment = input.environments.find(
      (entry) => entry.environmentId === member.environmentId,
    );
    return !environment?.connected || !environment.hasServerConfig;
  });
  return unavailable
    ? {
        kind: "blocked",
        message: `Connect ${unavailable.environmentLabel ?? "the selected environment"} and try again.`,
      }
    : { kind: "update" };
}

export function projectMemberUpdateFailureTitle(input: {
  readonly failureTitle: string;
  readonly memberCount: number;
  readonly environmentLabel: string | null;
}): string {
  return input.memberCount > 1
    ? `${input.failureTitle} on ${input.environmentLabel ?? "the current environment"}`
    : input.failureTitle;
}

export function resolveProjectRemoval<Thread extends ProjectRemovalThread>(input: {
  readonly members: ReadonlyArray<SidebarProjectGroupMember>;
  readonly group: Pick<SidebarProjectSnapshot, "displayName" | "memberProjects">;
  readonly hasOtherMembers: boolean;
  readonly threads: ReadonlyArray<Thread>;
}): ProjectRemovalPlan<Thread> {
  const { members, hasOtherMembers } = input;
  const memberKeys = new Set(members.map(memberKey));
  const projectThreads = input.threads.filter((thread) =>
    memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
  );
  const isWholeGroup = members.length === input.group.memberProjects.length;
  const targetKind = hasOtherMembers || !isWholeGroup ? "checkout" : "project";
  const singleMember = members.length === 1 ? (members[0] ?? null) : null;
  const targetLabel = singleMember?.title ?? input.group.displayName;
  const confirmation = [
    projectThreads.length > 0
      ? `Remove ${targetKind} "${targetLabel}" and delete its ${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}?`
      : `Remove ${targetKind} "${targetLabel}"?`,
    ...(singleMember
      ? [
          `Path: ${singleMember.workspaceRoot}`,
          ...(singleMember.environmentLabel
            ? [`Environment: ${singleMember.environmentLabel}`]
            : []),
        ]
      : [`This removes ${members.length} grouped project entries.`]),
    ...(projectThreads.length > 0
      ? ["This permanently clears conversation history for those threads and any archived threads."]
      : ["This permanently clears any archived conversation history."]),
    isWholeGroup && !hasOtherMembers
      ? "This removes only the project entries, not the files on disk."
      : "Other entries in this grouped project are unaffected.",
    "This action cannot be undone.",
  ].join("\n");
  return {
    confirmation,
    members: members.map((member) => ({
      member,
      threads: projectThreads.filter(
        (thread) => thread.environmentId === member.environmentId && thread.projectId === member.id,
      ),
      failureTitle: `Failed to remove "${member.title}"`,
    })),
    navigateHome: isWholeGroup && !hasOtherMembers,
  };
}
