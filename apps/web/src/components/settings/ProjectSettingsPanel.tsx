import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/unstable/reactivity";
import { type EnvironmentId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { InfoIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { releaseProjectDraftUploads } from "../../lib/composerDraftUploads";
import { readLocalApi } from "../../localApi";
import {
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { ProjectFaviconPickerDialog } from "./ProjectFaviconPickerDialog";
import { ProjectActionsSettings } from "./ProjectActionsSettings";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import {
  buildProjectDetailModel,
  buildProjectSettingsPanelModel,
  projectMemberUpdateFailureTitle,
  resolveProjectIconChange,
  resolveProjectMembersUpdate,
  resolveProjectRemoval,
  resolveProjectRename,
  resolveProjectSettingsRedirect,
  type ProjectIconIntent,
  type ProjectMemberPatch,
  type ProjectSettingsLastSelection,
} from "./ProjectSettingsPanel.logic";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";

const ProjectIconPickerDialog = lazy(() =>
  import("./ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

export function ProjectSettingsPanel({
  projectKey,
  environmentId = null,
  checkoutKey = null,
}: {
  projectKey: string;
  environmentId?: EnvironmentId | null;
  checkoutKey?: string | null;
}) {
  const groups = useSettingsProjectGroups();
  const navigate = useNavigate({ from: "/settings" });
  const pathname = useLocation({ select: (location) => location.pathname });

  const model = useMemo(
    () => buildProjectSettingsPanelModel({ groups, projectKey, environmentId, checkoutKey }),
    [groups, projectKey, environmentId, checkoutKey],
  );
  const isDetail = model.kind === "detail";

  // Remember the members of the last rendered group so a grouping-rule change
  // (which changes the group key) can follow the project to its new group.
  const lastSelectionRef = useRef<ProjectSettingsLastSelection | null>(null);
  useEffect(() => {
    if (model.kind !== "detail") return;
    lastSelectionRef.current = {
      key: model.group.projectKey,
      environmentId,
      checkoutKey,
      memberKeys: model.memberKeys,
    };
  }, [model, environmentId, checkoutKey]);

  // A grouping-rule change replaces the group key mid-visit; follow the
  // project to its new key instead of parking on the not-found state.
  useEffect(() => {
    if (isDetail) return;
    const redirect = resolveProjectSettingsRedirect({
      groups,
      last: lastSelectionRef.current,
      projectKey,
      environmentId,
      checkoutKey,
    });
    if (redirect) {
      void navigate({
        to: pathname,
        search: () => ({
          project: redirect.project,
          machine: redirect.machine ?? undefined,
          checkout: redirect.checkout ?? undefined,
        }),
        replace: true,
        hashScrollIntoView: false,
      });
    }
  }, [groups, navigate, pathname, projectKey, isDetail, environmentId, checkoutKey]);

  if (model.kind === "no-projects" || model.kind === "project-missing") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {model.message}
      </div>
    );
  }
  if (model.kind === "checkout-missing")
    return <p className="p-8 text-sm text-muted-foreground">{model.message}</p>;
  return (
    <ProjectDetail
      key={model.detailKey}
      group={model.group}
      hasOtherMembers={model.hasOtherMembers}
    />
  );
}

function ProjectDetail({
  group,
  hasOtherMembers,
}: {
  group: SidebarProjectSnapshot;
  hasOtherMembers: boolean;
}) {
  const navigate = useNavigate({ from: "/settings" });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentStatuses = useMemo(
    () =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        connected: environment.connection.phase === "connected",
        hasServerConfig: environment.serverConfig != null,
      })),
    [environments],
  );
  const threads = useThreadShells();
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const projectNameEditedRef = useRef(false);

  // ----- project icon -----
  const [faviconPickerOpen, setFaviconPickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [isSavingFavicon, setIsSavingFavicon] = useState(false);
  const savingFaviconRef = useRef(false);

  const desktopFaviconPicker =
    typeof window !== "undefined" ? window.desktopBridge?.pickProjectFavicon : undefined;
  const model = buildProjectDetailModel({
    group,
    hasOtherMembers,
    environments: environmentStatuses,
    primaryEnvironmentId,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
    hasExternalFaviconPicker: desktopFaviconPicker !== undefined,
    isSavingIcon: isSavingFavicon,
  });
  const { representative } = model;
  const pickProjectFavicon = model.icon.canPickExternalFavicon ? desktopFaviconPicker : undefined;

  const reportFailure = useCallback((title: string, result: AtomCommandResult<void, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }, []);

  // Group-shared fields live on each physical project record, so a
  // group-level edit fans out to every member.
  const updateAllMembers = useCallback(
    async (
      input: ProjectMemberPatch,
      failureTitle: string,
    ): Promise<AtomCommandResult<void, unknown>> => {
      const decision = resolveProjectMembersUpdate({
        members: group.memberProjects,
        environments: environmentStatuses,
      });
      if (decision.kind === "blocked") {
        const error = new Error(decision.message);
        const result: AtomCommandResult<void, unknown> = AsyncResult.failure(Cause.fail(error));
        reportFailure(failureTitle, result);
        return result;
      }
      for (const member of group.memberProjects) {
        const result = mapAtomCommandResult(
          await updateProject({
            environmentId: member.environmentId,
            input: { projectId: member.id, ...input },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          // A partial fan-out is possible: earlier members already took the
          // write. Name the environment so the user knows where it stopped.
          reportFailure(
            projectMemberUpdateFailureTitle({
              failureTitle,
              memberCount: group.memberProjects.length,
              environmentLabel: member.environmentLabel,
            }),
            result,
          );
          return result;
        }
      }
      return AsyncResult.success(undefined);
    },
    [environmentStatuses, group.memberProjects, reportFailure, updateProject],
  );

  const renameGroup = useCallback(
    async (nextTitle: string, wasEdited: boolean) => {
      const decision = resolveProjectRename({
        memberTitles: group.memberProjects.map((member) => member.title),
        nextTitle,
        wasEdited,
      });
      if (decision.kind === "reject") {
        toastManager.add(decision.toast);
        return;
      }
      if (decision.kind === "skip") return;
      await updateAllMembers(decision.patch, decision.failureTitle);
    },
    [group.memberProjects, updateAllMembers],
  );

  const setProjectIcon = useCallback(
    async (intent: ProjectIconIntent) => {
      if (savingFaviconRef.current) return;
      savingFaviconRef.current = true;
      setIsSavingFavicon(true);
      try {
        const change = resolveProjectIconChange(intent);
        await updateAllMembers(change.patch, change.failureTitle);
      } finally {
        savingFaviconRef.current = false;
        setIsSavingFavicon(false);
      }
    },
    [updateAllMembers],
  );

  const removeMembers = useCallback(
    async (members: ReadonlyArray<SidebarProjectGroupMember>) => {
      const api = readLocalApi();
      if (!api) return;

      const plan = resolveProjectRemoval({ members, group, hasOtherMembers, threads });
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(plan.confirmation, { variant: "destructive" }),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;

      const draftStore = useComposerDraftStore.getState();
      for (const { member, threads: memberThreads, failureTitle } of plan.members) {
        const result = mapAtomCommandResult(
          await deleteProject({
            environmentId: member.environmentId,
            input: {
              projectId: member.id,
              force: true,
            },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          reportFailure(failureTitle, result);
          return;
        }
        const projectRef = scopeProjectRef(member.environmentId, member.id);
        releaseProjectDraftUploads(
          projectRef,
          memberThreads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
        );
        const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
        if (projectDraftThread) {
          draftStore.clearDraftThread(projectDraftThread.draftId);
        }
        draftStore.clearProjectDraftThreadId(projectRef);
      }

      if (plan.navigateHome) {
        void navigate({ to: "/", replace: true });
      }
    },
    [deleteProject, group, hasOtherMembers, navigate, reportFailure, threads],
  );

  const checkoutChoices = model.checkouts ? (
    <SettingsSection title={model.checkouts.title}>
      {model.checkouts.rows.map((row) => (
        <SettingsRow
          key={row.id}
          title={row.title}
          description={row.description}
          control={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const member = group.memberProjects.find(
                  (candidate) => candidate.physicalProjectKey === row.id,
                );
                if (member) void removeMembers([member]);
              }}
              aria-label={row.removeAriaLabel}
            >
              {row.removeLabel}
            </Button>
          }
        />
      ))}
    </SettingsSection>
  ) : null;

  return (
    <>
      <SettingsPageContainer className="gap-6">
        <Alert variant="info">
          <InfoIcon aria-hidden />
          <AlertDescription>{model.notice}</AlertDescription>
        </Alert>
        <SettingsSection id={model.overviewSectionId} title={model.overviewTitle} hideTitle>
          <SettingsRow
            title={model.name.title}
            description={model.name.description}
            control={
              <Input
                key={model.name.inputKey}
                size="sm"
                className="w-full sm:w-64"
                aria-label={model.name.ariaLabel}
                defaultValue={model.name.value}
                onChange={() => {
                  projectNameEditedRef.current = true;
                }}
                onBlur={(event) => {
                  const wasEdited = projectNameEditedRef.current;
                  projectNameEditedRef.current = false;
                  void renameGroup(event.currentTarget.value, wasEdited);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            }
          />
          <SettingsRow
            title={model.icon.title}
            description={model.icon.description}
            resetAction={
              model.icon.resettable ? (
                <SettingResetButton
                  label={model.icon.resetLabel}
                  disabled={model.icon.disabled}
                  onClick={() => void setProjectIcon({ kind: "reset" })}
                />
              ) : null
            }
            control={
              <div className="flex items-center gap-2">
                <ProjectFavicon project={representative} className="size-6" />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  aria-label={model.icon.chooseIcon.ariaLabel}
                  disabled={model.icon.disabled}
                  onClick={() => setIconPickerOpen(true)}
                >
                  {model.icon.chooseIcon.label}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  aria-label={model.icon.chooseFile.ariaLabel}
                  disabled={model.icon.disabled}
                  onClick={() => setFaviconPickerOpen(true)}
                >
                  {model.icon.chooseFile.label}
                </Button>
              </div>
            }
          />
        </SettingsSection>
        <ProjectDefaultsSettings category="project" />
        <ProjectActionsSettings />
        {checkoutChoices}
        <SettingsSection title={model.danger.sectionTitle}>
          <SettingsRow
            title={model.danger.title}
            description={model.danger.description}
            control={
              <Button
                size="sm"
                variant="destructive-outline"
                onClick={() => void removeMembers(group.memberProjects)}
              >
                <Trash2Icon />
                {model.danger.actionLabel}
              </Button>
            }
          />
        </SettingsSection>
      </SettingsPageContainer>

      <ProjectFaviconPickerDialog
        key={`${representative.environmentId}:${representative.workspaceRoot}:${faviconPickerOpen}`}
        cwd={representative.workspaceRoot}
        environmentId={representative.environmentId}
        onOpenChange={setFaviconPickerOpen}
        {...(pickProjectFavicon
          ? { onPickExternal: () => pickProjectFavicon(representative.workspaceRoot) }
          : {})}
        onSelect={(path) => void setProjectIcon({ kind: "favicon", path })}
        open={faviconPickerOpen}
        projectName={group.displayName}
      />
      {iconPickerOpen ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            current={model.icon.current}
            projectName={representative.title}
            open
            onOpenChange={setIconPickerOpen}
            onSelect={(icon) => void setProjectIcon({ kind: "icon", icon })}
          />
        </Suspense>
      ) : null}
    </>
  );
}
