import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProjectIconColor,
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectIconOverride,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import { PROJECT_FILE_PICKER_RESULT_LIMIT } from "@t3tools/web/src/components/files/ProjectFilePicker.logic.ts";
import {
  buildProjectActionsModel,
  collectProjectScriptIds,
  PROJECT_ACTIONS_BUSY_MESSAGE,
  PROJECT_ACTIONS_NOT_SAVED_TITLE,
  PROJECT_ACTIONS_SAVE_FAILED_TITLE,
  resolveProjectActionsIntent,
  resolveProjectActionsSource,
  resolveProjectScriptKeybindingSteps,
  resolveProjectScriptsPersistStep,
  resolveProjectScriptSubmit,
  type ProjectActionsIntent,
  type ProjectActionsModel,
  type ProjectActionsSource,
  type ProjectScriptsChange,
} from "@t3tools/web/src/components/settings/ProjectActionsSettings.logic.ts";
import {
  buildProjectFaviconPickerModel,
  resolveProjectFaviconPickerFailure,
  type ProjectFaviconPickerModel,
} from "@t3tools/web/src/components/settings/ProjectFaviconPickerDialog.logic.ts";
import {
  buildProjectIconPickerModel,
  resolveProjectIconPickerInitialState,
  resolveProjectIconPickerMode,
  resolveProjectIconPickerSave,
  type ProjectIconPickerIconOption,
  type ProjectIconPickerModel,
  type ProjectIconPickerState,
} from "@t3tools/web/src/components/settings/ProjectIconPickerDialog.logic.ts";
import {
  buildProjectDetailModel,
  buildProjectSettingsPanelModel,
  projectMemberUpdateFailureTitle,
  resolveProjectIconChange,
  resolveProjectMembersUpdate,
  resolveProjectRemoval,
  resolveProjectRename,
  resolveProjectSettingsRedirect,
  type ProjectDetailModel,
  type ProjectIconIntent,
  type ProjectMemberPatch,
  type ProjectSettingsEnvironmentStatus,
  type ProjectSettingsLastSelection,
  type ProjectSettingsPanelModel,
} from "@t3tools/web/src/components/settings/ProjectSettingsPanel.logic.ts";
import { buildProjectsSettingsModel } from "@t3tools/web/src/components/settings/ProjectsSettings.logic.ts";
import {
  buildSettingsScopeNoticeModel,
  type SettingsScopeNoticeChoice,
} from "@t3tools/web/src/components/settings/SettingsScopeNotice.logic.ts";
import {
  resolveFileScriptImportFailure,
  type NewProjectScriptInput,
  type ProjectScriptEditorRequest,
} from "@t3tools/web/src/components/projectScriptEditor.logic.ts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import { collectProjectDraftUploads } from "@t3tools/web/src/lib/projectDraftUploads.logic.ts";
import {
  canonicalProjectIconName,
  PROJECT_ICON_CATALOG,
} from "@t3tools/web/src/projectIconCatalog.ts";
import { firstEmoji } from "@t3tools/web/src/projectIconOptions.ts";
import type { SidebarProjectGroupMember } from "@t3tools/web/src/sidebarProjectGrouping.ts";
import { PROJECT_PATH_SEARCH_DEBOUNCE_MS } from "@t3tools/web/src/state/pathSearch.logic.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import { resolvePierreFileIcon, type PierreIconView } from "../../pierreIcon.ts";
import { projectIconView } from "../../sidebarView.ts";
import type { ProjectIconView } from "../../views/sidebar.ts";
import { openProjectScriptEditor } from "../projectScripts.ts";
import type { SettingsModelPickerPopupView } from "./modelPickers.ts";
import {
  createProjectDefaults,
  PROJECT_DEFAULTS_PICKER,
  type ProjectDefaultsView,
} from "./projectDefaults.ts";
import type {
  SettingsRowScope,
  SettingsScopeContextSnapshot,
  SettingsScopeRuntime,
  SettingsSection,
} from "./scope.ts";
import { createSectionPickers } from "./sectionPickers.ts";

type IconPickerUi = ProjectIconPickerState & {
  readonly query: string;
  readonly customEmoji: string;
};

type FaviconPickerUi = {
  readonly query: string;
  readonly searchedQuery: string;
  readonly highlighted: string | null;
  readonly pickingExternal: boolean;
};

type ProjectsUi = {
  readonly savingIcon: boolean;
  readonly actionsSaving: boolean;
  readonly iconPicker: IconPickerUi | null;
  readonly faviconPicker: FaviconPickerUi | null;
  readonly externalRequest: { readonly id: number; readonly prompt: string } | null;
};

const INITIAL_UI: ProjectsUi = {
  savingIcon: false,
  actionsSaving: false,
  iconPicker: null,
  faviconPicker: null,
  externalRequest: null,
};

export type ProjectActionsView = ProjectActionsModel & {
  readonly headerRowScope: SettingsRowScope;
};

export type ProjectIconPickerIconView = ProjectIconPickerIconOption & { readonly asset: string };

export type ProjectIconPickerView = Omit<ProjectIconPickerModel, "icons" | "monogram"> & {
  readonly icons:
    | (Omit<NonNullable<ProjectIconPickerModel["icons"]>, "icons"> & {
        readonly query: string;
        readonly icons: readonly ProjectIconPickerIconView[];
        readonly color: ProjectIconColor;
      })
    | null;
  readonly monogram:
    | (NonNullable<ProjectIconPickerModel["monogram"]> & { readonly letters: string })
    | null;
  readonly customEmoji: string;
};

export type ProjectFaviconPickerFileView = ProjectFaviconPickerModel["files"][number] & {
  readonly icon: PierreIconView;
};

export type ProjectFaviconPickerView = Omit<ProjectFaviconPickerModel, "files"> & {
  readonly query: string;
  readonly highlighted: string | null;
  readonly files: readonly ProjectFaviconPickerFileView[];
};

export type ProjectDetailView = Omit<ProjectDetailModel, "representative"> & {
  readonly detailKey: string;
  readonly iconPreview: ProjectIconView;
  readonly defaults: ProjectDefaultsView;
  readonly actions: ProjectActionsView;
  readonly modelPicker: SettingsModelPickerPopupView | null;
  readonly iconPicker: ProjectIconPickerView | null;
  readonly faviconPicker: ProjectFaviconPickerView | null;
  readonly externalRequest: { readonly id: number; readonly prompt: string } | null;
};

export type SettingsProjectsView =
  | {
      readonly kind: "choose-project";
      readonly message: string;
      readonly choices: readonly SettingsScopeNoticeChoice[];
    }
  | { readonly kind: "unavailable"; readonly message: string }
  | {
      readonly kind: "empty";
      readonly centered: boolean;
      readonly message: string;
    }
  | ({ readonly kind: "detail" } & ProjectDetailView);

const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const RenameParams = Schema.decodeUnknownSync(
  Schema.Struct({ value: Schema.String, edited: Schema.Boolean }),
);
const CheckoutParams = Schema.decodeUnknownSync(Schema.Struct({ checkoutKey: Schema.String }));
const ScriptParams = Schema.decodeUnknownSync(Schema.Struct({ scriptId: Schema.String }));
const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const DeltaParams = Schema.decodeUnknownSync(Schema.Struct({ delta: Schema.Number }));
const PathParams = Schema.decodeUnknownSync(
  Schema.Struct({
    requestId: Schema.Number,
    path: Schema.NullOr(Schema.String),
    error: Schema.NullOr(Schema.String),
  }),
);
const ColorParams = Schema.decodeUnknownSync(Schema.Struct({ value: ProjectIconColor }));

type T3FileState = {
  readonly status: "loading" | "missing" | "invalid" | "valid";
  readonly scripts: ReadonlyArray<T3ProjectFileScript>;
};

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

export function createProjectsSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const uiAtom = Atom.make<ProjectsUi>(INITIAL_UI).pipe(Atom.keepAlive);
  const ui = () => registry.get(uiAtom);
  const patchUi = (patch: Partial<ProjectsUi>) => registry.set(uiAtom, { ...ui(), ...patch });
  const defaults = createProjectDefaults(context, scope, "project");
  const pickers = createSectionPickers(context, "settingsProjects", {
    [PROJECT_DEFAULTS_PICKER]: defaults.binding,
  });
  let nextRequestId = 1;
  let faviconTimer: NodeJS.Timeout | undefined;

  const environmentStatuses = (
    scopeContext: SettingsScopeContextSnapshot,
  ): ProjectSettingsEnvironmentStatus[] =>
    scopeContext.environments.map((environment) => ({
      environmentId: environment.environmentId,
      connected: environment.connection.phase === "connected",
      hasServerConfig: environment.serverConfig != null,
    }));

  const panelAtom = Atom.make((get): ProjectSettingsPanelModel | null => {
    if (get(scope.sectionAtom) !== "projects") return null;
    const scopeContext = get(scope.scopeContextAtom);
    const model = buildProjectsSettingsModel({
      search: scopeContext.search,
      scope: scopeContext.scope,
    });
    if (model.kind !== "project") return null;
    return buildProjectSettingsPanelModel({
      groups: scopeContext.groups,
      projectKey: model.projectKey,
      environmentId: model.environmentId,
      checkoutKey: model.checkoutKey,
    });
  });

  const currentDetail = () => {
    const panel = registry.get(panelAtom);
    if (panel === null || panel.kind !== "detail") return null;
    const scopeContext = registry.get(scope.scopeContextAtom);
    const statuses = environmentStatuses(scopeContext);
    return {
      panel,
      statuses,
      model: buildProjectDetailModel({
        group: panel.group,
        hasOtherMembers: panel.hasOtherMembers,
        environments: statuses,
        primaryEnvironmentId: registry.get(state.primaryEnvironmentIdAtom),
        platform: context.platform,
        hasExternalFaviconPicker: true,
        isSavingIcon: ui().savingIcon,
      }),
    };
  };

  let lastSelection: ProjectSettingsLastSelection | null = null;
  registry.subscribe(
    panelAtom,
    (panel) => {
      if (panel === null) return;
      const search = registry.get(scope.scopeContextAtom).search;
      const projectKey = search.project ?? null;
      if (projectKey === null) return;
      const model = buildProjectsSettingsModel({
        search,
        scope: registry.get(scope.scopeContextAtom).scope,
      });
      if (model.kind !== "project") return;
      if (panel.kind === "detail") {
        lastSelection = {
          key: panel.group.projectKey,
          environmentId: model.environmentId,
          checkoutKey: model.checkoutKey,
          memberKeys: panel.memberKeys,
        };
        return;
      }
      const redirect = resolveProjectSettingsRedirect({
        groups: registry.get(scope.groupsAtom),
        last: lastSelection,
        projectKey: model.projectKey,
        environmentId: model.environmentId,
        checkoutKey: model.checkoutKey,
      });
      if (redirect === null) return;
      queueMicrotask(() =>
        scope.selectScope({
          project: redirect.project,
          ...(redirect.machine === null ? {} : { machine: redirect.machine }),
          ...(redirect.checkout === null ? {} : { checkout: redirect.checkout }),
        }),
      );
    },
    { immediate: true },
  );

  const t3FileState = (
    read: <A>(atom: Atom.Atom<A>) => A,
    environmentId: EnvironmentId,
    cwd: string | null,
  ): T3FileState => {
    if (cwd === null) return { status: "missing", scripts: NO_FILE_SCRIPTS };
    const ref = { environmentId, cwd, relativePath: T3_PROJECT_FILE_NAME };
    const result = read(
      state.projectEnvironment.readFile({
        environmentId,
        input: { cwd, relativePath: T3_PROJECT_FILE_NAME },
      }),
    );
    const data =
      read(state.projectEnvironment.optimisticFile(ref))?.data ??
      Option.getOrNull(AsyncResult.value(result));
    const contents = data && !data.truncated ? data.contents : null;
    if (contents === null) {
      return { status: result.waiting ? "loading" : "missing", scripts: NO_FILE_SCRIPTS };
    }
    const file = parseT3ProjectFile(contents);
    if (file === null) return { status: "invalid", scripts: NO_FILE_SCRIPTS };
    return { status: "valid", scripts: file.scripts ?? NO_FILE_SCRIPTS };
  };

  const actionsSource = (
    read: <A>(atom: Atom.Atom<A>) => A,
  ): { readonly source: ProjectActionsSource; readonly file: T3FileState } => {
    const scopeContext = read(scope.scopeContextAtom);
    const source = resolveProjectActionsSource({
      scopeKind: scopeContext.scope.kind,
      members: scopeContext.scope.members,
      target: scopeContext.target,
      targets: scopeContext.targets,
      environments: read(scope.environmentsAtom),
    });
    return {
      source,
      file: t3FileState(read, source.fileSource.environmentId, source.fileSource.workspaceRoot),
    };
  };

  const reportFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    context.addToast({
      layout: "stacked",
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };

  const updateAllMembers = async (
    input: ProjectMemberPatch,
    failureTitle: string,
  ): Promise<AtomCommandResult<void, unknown>> => {
    const detail = currentDetail();
    if (detail === null) return AsyncResult.success(undefined);
    const members = detail.panel.group.memberProjects;
    const decision = resolveProjectMembersUpdate({ members, environments: detail.statuses });
    if (decision.kind === "blocked") {
      const result: AtomCommandResult<void, unknown> = AsyncResult.failure(
        Cause.fail(new Error(decision.message)),
      );
      reportFailure(failureTitle, result);
      return result;
    }
    for (const member of members) {
      const result = mapAtomCommandResult(
        await runAtomCommand(
          registry,
          state.projectEnvironment.update,
          { environmentId: member.environmentId, input: { projectId: member.id, ...input } },
          { label: "project update", reportFailure: false },
        ),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportFailure(
          projectMemberUpdateFailureTitle({
            failureTitle,
            memberCount: members.length,
            environmentLabel: member.environmentLabel,
          }),
          result,
        );
        return result;
      }
    }
    return AsyncResult.success(undefined);
  };

  const setProjectIcon = async (intent: ProjectIconIntent) => {
    if (ui().savingIcon) return;
    patchUi({ savingIcon: true });
    try {
      const change = resolveProjectIconChange(intent);
      await updateAllMembers(change.patch, change.failureTitle);
    } finally {
      patchUi({ savingIcon: false });
    }
  };

  const removeMembers = async (members: ReadonlyArray<SidebarProjectGroupMember>) => {
    const detail = currentDetail();
    if (detail === null) return;
    const plan = resolveProjectRemoval({
      members,
      group: detail.panel.group,
      hasOtherMembers: detail.panel.hasOtherMembers,
      threads: registry.get(state.environmentThreadShells.threadShellsAtom),
    });
    const pending = requestConfirmDialog(plan.confirmation, { variant: "destructive" });
    if (pending === undefined) {
      throw new Error("Confirmations are not available in the native app yet.");
    }
    const confirmed = await pending.catch(() => false);
    if (!confirmed) return;
    const draftStore = useComposerDraftStore.getState();
    for (const { member, threads, failureTitle } of plan.members) {
      const result = mapAtomCommandResult(
        await runAtomCommand(
          registry,
          state.projectEnvironment.delete,
          { environmentId: member.environmentId, input: { projectId: member.id, force: true } },
          { label: "project removal", reportFailure: false },
        ),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportFailure(failureTitle, result);
        return;
      }
      const projectRef = scopeProjectRef(member.environmentId, member.id);
      context.attachmentUploads.releaseDraftAttachments(
        collectProjectDraftUploads(
          useComposerDraftStore.getState(),
          projectRef,
          threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
      if (projectDraftThread) draftStore.clearDraftThread(projectDraftThread.draftId);
      draftStore.clearProjectDraftThreadId(projectRef);
    }
    if (plan.navigateHome) context.navigateHome();
  };

  const persistScripts = async (
    change: ProjectScriptsChange,
  ): Promise<AtomCommandResult<void, unknown>> => {
    const { source } = actionsSource((atom) => registry.get(atom));
    const targets = source.scriptTargets;
    if (ui().actionsSaving || targets.length === 0) {
      context.addToast({
        layout: "stacked",
        type: "error",
        title: PROJECT_ACTIONS_NOT_SAVED_TITLE,
        description: PROJECT_ACTIONS_BUSY_MESSAGE,
      });
      return AsyncResult.failure(Cause.fail(new Error(PROJECT_ACTIONS_BUSY_MESSAGE)));
    }
    const report = (result: AtomCommandResult<unknown, unknown>) => {
      reportFailure(PROJECT_ACTIONS_SAVE_FAILED_TITLE, result);
      return mapAtomCommandResult(result, () => undefined);
    };
    patchUi({ actionsSaving: true });
    try {
      const projects = registry.get(state.environmentProjects.projectsAtom);
      for (const target of targets) {
        const step = resolveProjectScriptsPersistStep(target, change.transform);
        const result = await runAtomCommand(
          registry,
          state.serverEnvironment.updateSettings,
          { environmentId: target.environmentId, input: { patch: step.patch } },
          { label: "project actions update", reportFailure: false },
        );
        if (result._tag === "Failure") return report(result);
        for (const binding of resolveProjectScriptKeybindingSteps({
          target,
          step,
          change,
          projects,
        })) {
          const bindingResult =
            binding.kind === "upsert"
              ? await runAtomCommand(
                  registry,
                  state.serverEnvironment.upsertKeybinding,
                  { environmentId: target.environmentId, input: binding.rule },
                  { label: "action shortcut update", reportFailure: false },
                )
              : await runAtomCommand(
                  registry,
                  state.serverEnvironment.removeKeybinding,
                  { environmentId: target.environmentId, input: binding.rule },
                  { label: "action shortcut removal", reportFailure: false },
                );
          if (bindingResult._tag === "Failure") return report(bindingResult);
        }
      }
      return AsyncResult.success(undefined);
    } finally {
      patchUi({ actionsSaving: false });
    }
  };

  const submitScript = (scriptId: string | null, input: NewProjectScriptInput) => {
    const { source } = actionsSource((atom) => registry.get(atom));
    return persistScripts(
      resolveProjectScriptSubmit({
        scriptId,
        script: input,
        existingIds: collectProjectScriptIds({
          projects: registry.get(state.environmentProjects.projectsAtom),
          targets: source.scriptTargets,
        }),
      }),
    );
  };

  const openEditor = (request: ProjectScriptEditorRequest) =>
    openProjectScriptEditor(context, request, {
      scripts: () => actionsSource((atom) => registry.get(atom)).source.scripts,
      submit: submitScript,
      remove: async (scriptId) => {
        await runActionsIntent({ kind: "remove", scriptId });
      },
    });

  const runActionsIntent = async (intent: ProjectActionsIntent) => {
    const { source, file } = actionsSource((atom) => registry.get(atom));
    const decision = resolveProjectActionsIntent(intent, {
      scripts: source.scripts,
      keybindings: source.keybindings,
      fileScripts: file.scripts,
    });
    switch (decision.kind) {
      case "open-editor":
        openEditor(decision.request);
        return;
      case "import": {
        const result = await submitScript(null, decision.payload);
        const failedRequest = resolveFileScriptImportFailure(decision.payload, result);
        if (failedRequest) openEditor(failedRequest);
        return;
      }
      case "persist":
        await persistScripts(decision.change);
        return;
      case "none":
        return;
    }
  };

  const faviconSearchAtom = (environmentId: EnvironmentId, cwd: string, query: string) =>
    state.projectEnvironment.searchEntries({
      environmentId,
      input: {
        cwd,
        query,
        limit: PROJECT_FILE_PICKER_RESULT_LIMIT,
        kind: "file",
        imageOnly: true,
      },
    });

  const iconPickerView = (picker: IconPickerUi, projectName: string): ProjectIconPickerView => {
    const model = buildProjectIconPickerModel({
      projectName,
      state: picker,
      query: picker.query,
      iconCatalog: PROJECT_ICON_CATALOG,
    });
    return {
      ...model,
      icons:
        model.icons === null
          ? null
          : {
              ...model.icons,
              query: picker.query,
              color: picker.color,
              icons: model.icons.icons.map((icon) => ({
                ...icon,
                asset: canonicalProjectIconName(icon.name),
              })),
            },
      monogram: model.monogram === null ? null : { ...model.monogram, letters: picker.letters },
      customEmoji: picker.customEmoji,
    };
  };

  const viewAtom = Atom.make((get): SettingsProjectsView | null => {
    if (get(scope.sectionAtom) !== "projects") return null;
    const scopeContext = get(scope.scopeContextAtom);
    const top = buildProjectsSettingsModel({
      search: scopeContext.search,
      scope: scopeContext.scope,
    });
    if (top.kind === "unavailable") return { kind: "unavailable", message: top.message };
    if (top.kind === "choose-project") {
      return {
        kind: "choose-project",
        message: top.message,
        choices: buildSettingsScopeNoticeModel({
          message: top.message,
          target: top.target,
          eligibleEnvironmentIds: null,
          search: scopeContext.search,
          groups: scopeContext.groups,
          environments: scopeContext.environments,
        }).choices,
      };
    }
    const panel = get(panelAtom);
    if (panel === null) return null;
    if (panel.kind !== "detail") {
      return { kind: "empty", centered: panel.kind !== "checkout-missing", message: panel.message };
    }
    const current = get(uiAtom);
    const statuses = environmentStatuses(scopeContext);
    const { representative, ...model } = buildProjectDetailModel({
      group: panel.group,
      hasOtherMembers: panel.hasOtherMembers,
      environments: statuses,
      primaryEnvironmentId: get(state.primaryEnvironmentIdAtom),
      platform: context.platform,
      hasExternalFaviconPicker: true,
      isSavingIcon: current.savingIcon,
    });
    const defaultsView = defaults.view(get);
    const { source, file } = actionsSource(get);
    const actionsModel = buildProjectActionsModel({
      source,
      saving: current.actionsSaving,
      platform: context.platform,
      fileScripts: file.scripts,
      fileStatus: file.status,
    });
    const favicon = current.faviconPicker;
    const faviconView = ((): ProjectFaviconPickerView | null => {
      if (favicon === null) return null;
      const result = get(
        faviconSearchAtom(
          representative.environmentId,
          representative.workspaceRoot,
          favicon.searchedQuery,
        ),
      );
      const isPending = favicon.query.trim() !== favicon.searchedQuery || result.waiting;
      const data = Option.getOrNull(AsyncResult.value(result));
      const pickerModel = buildProjectFaviconPickerModel({
        query: favicon.query,
        entries: isPending ? [] : (data?.entries ?? []),
        matchedQuery: favicon.searchedQuery,
        error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
        isPending,
        platform: context.platform,
        hasExternalPicker: model.icon.canPickExternalFavicon,
        isPickingExternal: favicon.pickingExternal,
        projectName: panel.group.displayName,
      });
      const highlighted =
        pickerModel.files.find((entry) => entry.value === favicon.highlighted)?.value ??
        pickerModel.files[0]?.value ??
        null;
      return {
        ...pickerModel,
        query: favicon.query,
        highlighted,
        files: pickerModel.files.map((entry) => ({
          ...entry,
          icon: resolvePierreFileIcon(entry.path),
        })),
      };
    })();
    return {
      kind: "detail",
      ...model,
      detailKey: panel.detailKey,
      iconPreview: projectIconView(representative),
      defaults: defaultsView.view,
      actions: {
        ...actionsModel,
        headerRowScope: scope.rowScope(get, {
          serverScoped: true,
          settingKeys: actionsModel.header.settingKeys,
          mixed: actionsModel.header.mixed,
        }),
      },
      modelPicker: pickers.popup(get, { [PROJECT_DEFAULTS_PICKER]: defaultsView.source }),
      iconPicker:
        current.iconPicker === null
          ? null
          : iconPickerView(current.iconPicker, representative.title),
      faviconPicker: faviconView,
      externalRequest: current.externalRequest,
    };
  });

  const patchIconPicker = (patch: Partial<IconPickerUi>) => {
    const picker = ui().iconPicker;
    if (picker !== null) patchUi({ iconPicker: { ...picker, ...patch } });
  };

  const patchFavicon = (patch: Partial<FaviconPickerUi>) => {
    const picker = ui().faviconPicker;
    if (picker !== null) patchUi({ faviconPicker: { ...picker, ...patch } });
  };

  const closeFavicon = () => {
    clearTimeout(faviconTimer);
    faviconTimer = undefined;
    patchUi({ faviconPicker: null });
  };

  const faviconFiles = () => {
    const view = registry.get(viewAtom);
    return view !== null && view.kind === "detail" && view.faviconPicker !== null
      ? view.faviconPicker
      : null;
  };

  const selectFavicon = (path: string) => {
    closeFavicon();
    void setProjectIcon({ kind: "favicon", path });
  };

  return {
    views: { settingsProjects: viewAtom },
    actions: {
      ...pickers.actions,
      settingsProjectsMount: async () => {
        closeFavicon();
        registry.set(uiAtom, INITIAL_UI);
        pickers.reset();
        return null;
      },
      settingsProjectsDefaults: defaults.changeAction,
      settingsProjectsRename: async (params) => {
        const { value, edited } = RenameParams(params);
        const detail = currentDetail();
        if (detail === null) return null;
        const decision = resolveProjectRename({
          memberTitles: detail.panel.group.memberProjects.map((member) => member.title),
          nextTitle: value,
          wasEdited: edited,
        });
        if (decision.kind === "reject") {
          context.addToast({ layout: "stacked", ...decision.toast });
          return null;
        }
        if (decision.kind === "skip") return null;
        await updateAllMembers(decision.patch, decision.failureTitle);
        return null;
      },
      settingsProjectsIconReset: async () => {
        await setProjectIcon({ kind: "reset" });
        return null;
      },
      settingsProjectsIconPickerOpen: async () => {
        const detail = currentDetail();
        if (detail === null) return null;
        patchUi({
          iconPicker: {
            ...resolveProjectIconPickerInitialState(
              detail.model.icon.current,
              detail.model.representative.title,
            ),
            query: "",
            customEmoji: "",
          },
        });
        return null;
      },
      settingsProjectsIconPickerClose: async () => {
        patchUi({ iconPicker: null });
        return null;
      },
      settingsProjectsIconPickerMode: async (params) => {
        const mode = resolveProjectIconPickerMode(ValueParams(params).value);
        if (mode !== null) patchIconPicker({ mode });
        return null;
      },
      settingsProjectsIconPickerColor: async (params) => {
        patchIconPicker({ color: ColorParams(params).value });
        return null;
      },
      settingsProjectsIconPickerIcon: async (params) => {
        patchIconPicker({ iconName: ValueParams(params).value });
        return null;
      },
      settingsProjectsIconPickerQuery: async (params) => {
        patchIconPicker({ query: ValueParams(params).value });
        return null;
      },
      settingsProjectsIconPickerLetters: async (params) => {
        patchIconPicker({ letters: ValueParams(params).value });
        return null;
      },
      settingsProjectsIconPickerEmoji: async (params) => {
        patchIconPicker({ emoji: ValueParams(params).value });
        return null;
      },
      settingsProjectsIconPickerCustomEmoji: async (params) => {
        const { value } = ValueParams(params);
        const emoji = firstEmoji(value);
        patchIconPicker(emoji === null ? { customEmoji: value } : { customEmoji: value, emoji });
        return null;
      },
      settingsProjectsIconPickerSave: async () => {
        const picker = ui().iconPicker;
        if (picker === null) return null;
        const decision = resolveProjectIconPickerSave(picker);
        if (decision.kind === "invalid") return null;
        const icon: ProjectIconOverride = decision.icon;
        patchUi({ iconPicker: null });
        await setProjectIcon({ kind: "icon", icon });
        return null;
      },
      settingsProjectsFaviconOpen: async () => {
        if (currentDetail() === null) return null;
        closeFavicon();
        patchUi({
          faviconPicker: {
            query: "",
            searchedQuery: "",
            highlighted: null,
            pickingExternal: false,
          },
        });
        return null;
      },
      settingsProjectsFaviconClose: async () => {
        closeFavicon();
        return null;
      },
      settingsProjectsFaviconQuery: async (params) => {
        const { value } = ValueParams(params);
        patchFavicon({ query: value, highlighted: null });
        clearTimeout(faviconTimer);
        faviconTimer = setTimeout(() => {
          faviconTimer = undefined;
          patchFavicon({ searchedQuery: value.trim() });
        }, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
        return null;
      },
      settingsProjectsFaviconHighlight: async (params) => {
        patchFavicon({ highlighted: ValueParams(params).value });
        return null;
      },
      settingsProjectsFaviconMove: async (params) => {
        const view = faviconFiles();
        if (view === null || view.files.length === 0) return null;
        const index = view.files.findIndex((entry) => entry.value === view.highlighted);
        const count = view.files.length;
        const next =
          ((((index < 0 ? 0 : index) + DeltaParams(params).delta) % count) + count) % count;
        patchFavicon({ highlighted: view.files[next]?.value ?? null });
        return null;
      },
      settingsProjectsFaviconSelect: async (params) => {
        const view = faviconFiles();
        const { value } = ValueParams(params);
        const entry = view?.files.find((candidate) => candidate.value === value);
        if (entry !== undefined) selectFavicon(entry.path);
        return null;
      },
      settingsProjectsFaviconSubmit: async () => {
        const view = faviconFiles();
        const entry = view?.files.find((candidate) => candidate.value === view.highlighted);
        if (entry !== undefined) selectFavicon(entry.path);
        return null;
      },
      settingsProjectsFaviconPickExternal: async () => {
        const detail = currentDetail();
        const picker = ui().faviconPicker;
        if (detail === null || picker === null || picker.pickingExternal) return null;
        if (!detail.model.icon.canPickExternalFavicon) return null;
        patchUi({
          faviconPicker: { ...picker, pickingExternal: true },
          externalRequest: { id: nextRequestId++, prompt: "Select icon" },
        });
        return null;
      },
      settingsProjectsFaviconPicked: async (params) => {
        const { requestId, path, error } = PathParams(params);
        const request = ui().externalRequest;
        if (request === null || request.id !== requestId) return null;
        patchUi({ externalRequest: null });
        patchFavicon({ pickingExternal: false });
        if (error !== null) {
          context.addToast({
            layout: "stacked",
            ...resolveProjectFaviconPickerFailure(new Error(error)),
          });
          return null;
        }
        if (path !== null) selectFavicon(path);
        return null;
      },
      settingsProjectsRemoveCheckout: async (params) => {
        const { checkoutKey } = CheckoutParams(params);
        const detail = currentDetail();
        const member = detail?.panel.group.memberProjects.find(
          (candidate) => candidate.physicalProjectKey === checkoutKey,
        );
        if (member !== undefined) await removeMembers([member]);
        return null;
      },
      settingsProjectsRemoveAll: async () => {
        const detail = currentDetail();
        if (detail !== null) await removeMembers(detail.panel.group.memberProjects);
        return null;
      },
      settingsProjectsActionAdd: async () => {
        await runActionsIntent({ kind: "add" });
        return null;
      },
      settingsProjectsActionEdit: async (params) => {
        await runActionsIntent({ kind: "edit", scriptId: ScriptParams(params).scriptId });
        return null;
      },
      settingsProjectsActionImport: async (params) => {
        await runActionsIntent({ kind: "import", key: KeyParams(params).key });
        return null;
      },
      settingsProjectsActionsReset: async () => {
        await runActionsIntent({ kind: "reset-override" });
        return null;
      },
    },
  };
}
