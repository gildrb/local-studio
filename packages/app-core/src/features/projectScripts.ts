import {
  DEFAULT_SERVER_SETTINGS,
  ProjectScriptIcon,
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ServerSettings,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import {
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LastInvokedScriptByProject,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  buildProjectScriptsSettingsPatch,
  PROJECT_SCRIPT_DELETE_FAILED_DESCRIPTION,
  PROJECT_SCRIPT_DELETE_FAILED_TITLE,
  PROJECT_SCRIPT_NOT_FOUND_MESSAGE,
  projectScriptRunFailedMessage,
  rememberLastInvokedScript,
  resolveAddedProjectScripts,
  resolveDeletedProjectScripts,
  resolveProjectScriptKeybindingUpsert,
  resolveUpdatedProjectScripts,
  type ProjectScriptsPersistRequest,
} from "@t3tools/web/src/components/chatProjectScripts.logic.ts";
import {
  buildProjectScriptsToolbarModel,
  type ProjectScriptsToolbarModel,
} from "@t3tools/web/src/components/ProjectScriptsControl.logic.ts";
import {
  buildProjectScriptEditorDialogCopy,
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  errorMessageOr,
  PROJECT_SCRIPT_ICON_OPTIONS,
  PROJECT_SCRIPT_SAVE_FAILED_MESSAGE,
  projectScriptEditorFormFromInput,
  projectScriptInputFromFileScript,
  resolveFileScriptImportFailure,
  resolveProjectScriptEditorToggles,
  resolveProjectScriptKeybindingCapture,
  resolveProjectScriptSaveOutcome,
  resolveProjectScriptSubmission,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorDialogCopy,
  type ProjectScriptEditorForm,
  type ProjectScriptEditorRequest,
  type ProjectScriptEditorToggles,
} from "@t3tools/web/src/components/projectScriptEditor.logic.ts";
import { getLocalStorageItem, setLocalStorageItem } from "@t3tools/web/src/lib/localStorageItem.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";
import { runCommandInThreadTerminal } from "../terminalSessions.ts";

type ScriptsContext = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly settings: ServerSettings;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly fileScripts: ReadonlyArray<T3ProjectFileScript>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly supportsProjectSettingsOverrides: boolean;
};

export type ProjectScriptEditorHandlers = {
  readonly scripts: () => readonly ProjectScript[];
  readonly submit: (
    scriptId: string | null,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  readonly remove: (scriptId: string) => Promise<void>;
};

type EditorSession = {
  readonly id: number;
  readonly scriptId: string | null;
  readonly form: ProjectScriptEditorForm;
  readonly validationError: string | null;
  readonly saving: boolean;
  readonly iconPickerOpen: boolean;
  readonly deleteConfirmOpen: boolean;
  readonly handlers: ProjectScriptEditorHandlers;
};

const editorOpeners = new WeakMap<
  FeatureContext["registry"],
  (request: ProjectScriptEditorRequest, handlers: ProjectScriptEditorHandlers) => void
>();

export function openProjectScriptEditor(
  context: FeatureContext,
  request: ProjectScriptEditorRequest,
  handlers: ProjectScriptEditorHandlers,
): void {
  const open = editorOpeners.get(context.registry);
  if (open === undefined)
    throw new Error("Project actions are not available in the native app yet.");
  open(request, handlers);
}

export type ProjectScriptEditorView = {
  readonly id: number;
  readonly isEditing: boolean;
  readonly isSaving: boolean;
  readonly copy: ProjectScriptEditorDialogCopy;
  readonly form: ProjectScriptEditorForm;
  readonly toggles: ProjectScriptEditorToggles;
  readonly iconOptions: typeof PROJECT_SCRIPT_ICON_OPTIONS;
  readonly iconPickerOpen: boolean;
  readonly validationError: string | null;
  readonly deleteConfirmOpen: boolean;
};

export type ProjectScriptsView = {
  readonly toolbar: ProjectScriptsToolbarModel | null;
  readonly editor: ProjectScriptEditorView | null;
};

const ScriptIdParams = Schema.decodeUnknownSync(Schema.Struct({ scriptId: Schema.String }));
const ImportParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const EditorUpdateParams = Schema.decodeUnknownSync(
  Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    command: Schema.optionalKey(Schema.String),
    previewUrl: Schema.optionalKey(Schema.String),
    icon: Schema.optionalKey(ProjectScriptIcon),
    runOnWorktreeCreate: Schema.optionalKey(Schema.Boolean),
    waitForSetup: Schema.optionalKey(Schema.Boolean),
    autoOpenPreview: Schema.optionalKey(Schema.Boolean),
  }),
);
const IconPickerParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const KeyParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    code: Schema.String,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    altKey: Schema.Boolean,
    shiftKey: Schema.Boolean,
  }),
);

export function createProjectScriptsFeature(context: FeatureContext): CoreFeature {
  const { registry, state, platform } = context;
  const lastInvokedAtom = Atom.make<LastInvokedScriptByProject>(
    getLocalStorageItem(LAST_INVOKED_SCRIPT_BY_PROJECT_KEY, LastInvokedScriptByProjectSchema) ?? {},
  ).pipe(Atom.keepAlive);
  const editorAtom = Atom.make<EditorSession | null>(null).pipe(Atom.keepAlive);
  let nextEditorId = 1;

  const contextAtom = Atom.make((get): ScriptsContext | null => {
    const input = get(context.threadInputAtom);
    if (input === null || input.project === undefined) return null;
    const { thread, project, serverConfig } = input;
    const settings = mergeEnvironmentSettings(
      serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      input.clientSettings,
    );
    const file = Option.getOrNull(
      AsyncResult.value(
        get(
          state.projectEnvironment.readFile({
            environmentId: thread.environmentId,
            input: { cwd: project.workspaceRoot, relativePath: T3_PROJECT_FILE_NAME },
          }),
        ),
      ),
    );
    return {
      environmentId: thread.environmentId,
      projectId: project.id,
      workspaceRoot: project.workspaceRoot,
      worktreePath: thread.worktreePath ?? null,
      settings,
      scripts: resolveProjectScripts(settings, project),
      fileScripts:
        file === null || file.truncated ? [] : (parseT3ProjectFile(file.contents)?.scripts ?? []),
      keybindings: serverConfig?.keybindings ?? [],
      supportsProjectSettingsOverrides:
        serverConfig?.environment.capabilities.projectSettingsOverrides === true,
    };
  });

  const toolbarModel = (current: ScriptsContext, lastInvoked: LastInvokedScriptByProject) =>
    buildProjectScriptsToolbarModel({
      scripts: current.scripts,
      fileScripts: current.fileScripts,
      keybindings: current.keybindings,
      preferredScriptId: lastInvoked[current.projectId] ?? null,
      platform,
    });

  const projectScriptsAtom = Atom.make((get): ProjectScriptsView => {
    const current = get(contextAtom);
    const session = get(editorAtom);
    return {
      toolbar: current === null ? null : toolbarModel(current, get(lastInvokedAtom)),
      editor:
        session === null
          ? null
          : {
              id: session.id,
              isEditing: session.scriptId !== null,
              isSaving: session.saving,
              copy: buildProjectScriptEditorDialogCopy({
                isEditing: session.scriptId !== null,
                isSaving: session.saving,
                name: session.form.name,
              }),
              form: session.form,
              toggles: resolveProjectScriptEditorToggles(session.form),
              iconOptions: PROJECT_SCRIPT_ICON_OPTIONS,
              iconPickerOpen: session.iconPickerOpen,
              validationError: session.validationError,
              deleteConfirmOpen: session.deleteConfirmOpen,
            },
    };
  });

  const requireContext = (): ScriptsContext => {
    const current = registry.get(contextAtom);
    if (current === null) throw new Error("Project actions need an open project thread.");
    return current;
  };

  const openSession = (
    request: ProjectScriptEditorRequest,
    handlers: ProjectScriptEditorHandlers,
  ) => {
    registry.set(editorAtom, {
      id: nextEditorId++,
      scriptId: request.scriptId,
      form: projectScriptEditorFormFromInput(request.initial),
      validationError: request.error ?? null,
      saving: false,
      iconPickerOpen: false,
      deleteConfirmOpen: false,
      handlers,
    });
  };
  editorOpeners.set(registry, openSession);

  const threadHandlers: ProjectScriptEditorHandlers = {
    scripts: () => requireContext().scripts,
    submit: (scriptId, input) => submitScript(requireContext(), scriptId, input),
    remove: (scriptId) => deleteScript(requireContext(), scriptId),
  };

  const openEditor = (request: ProjectScriptEditorRequest) => openSession(request, threadHandlers);

  const updateSession = (id: number, update: (session: EditorSession) => EditorSession) => {
    const session = registry.get(editorAtom);
    if (session === null || session.id !== id) return;
    registry.set(editorAtom, update(session));
  };

  const persist = async (
    current: ScriptsContext,
    request: ProjectScriptsPersistRequest,
  ): Promise<ProjectScriptActionResult> => {
    const updateResult = mapAtomCommandResult(
      await runAtomCommand(
        registry,
        state.serverEnvironment.updateSettings,
        {
          environmentId: current.environmentId,
          input: {
            patch: buildProjectScriptsSettingsPatch({
              projectId: current.projectId,
              nextScripts: request.nextScripts,
              supportsProjectSettingsOverrides: current.supportsProjectSettingsOverrides,
              projectSettingsOverrides: current.settings.projectSettingsOverrides,
            }),
          },
        },
        { label: "project actions update", reportFailure: false },
      ),
      () => undefined,
    );
    if (updateResult._tag === "Failure") return updateResult;
    const keybindingRule = resolveProjectScriptKeybindingUpsert({
      keybinding: request.keybinding,
      keybindingCommand: request.keybindingCommand,
      isDesktop: true,
    });
    if (keybindingRule) {
      return mapAtomCommandResult(
        await runAtomCommand(
          registry,
          state.serverEnvironment.upsertKeybinding,
          { environmentId: current.environmentId, input: keybindingRule },
          { label: "action shortcut update", reportFailure: false },
        ),
        () => undefined,
      );
    }
    return updateResult;
  };

  const submitScript = (
    current: ScriptsContext,
    scriptId: string | null,
    input: NewProjectScriptInput,
  ): Promise<ProjectScriptActionResult> => {
    if (scriptId === null)
      return persist(current, resolveAddedProjectScripts(current.scripts, input));
    const request = resolveUpdatedProjectScripts(current.scripts, scriptId, input);
    if (request === null) {
      return Promise.resolve(
        AsyncResult.failure(Cause.fail(new Error(PROJECT_SCRIPT_NOT_FOUND_MESSAGE))),
      );
    }
    return persist(current, request);
  };

  const deleteScript = async (current: ScriptsContext, scriptId: string) => {
    const request = resolveDeletedProjectScripts(current.scripts, scriptId);
    const result = await persist(current, request);
    if (result._tag === "Success") {
      context.addToast({ layout: "plain", type: "success", title: request.deletedTitle });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      context.addToast({
        layout: "stacked",
        type: "error",
        title: PROJECT_SCRIPT_DELETE_FAILED_TITLE,
        description:
          error instanceof Error ? error.message : PROJECT_SCRIPT_DELETE_FAILED_DESCRIPTION,
      });
    }
  };

  return {
    views: { projectScripts: projectScriptsAtom },
    actions: {
      projectScriptsRun: async (params) => {
        const { scriptId } = ScriptIdParams(params);
        const current = requireContext();
        const script = current.scripts.find((candidate) => candidate.id === scriptId);
        if (script === undefined) throw new Error(PROJECT_SCRIPT_NOT_FOUND_MESSAGE);
        const lastInvoked = rememberLastInvokedScript(
          registry.get(lastInvokedAtom),
          current.projectId,
          script.id,
        );
        setLocalStorageItem(
          LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
          lastInvoked,
          LastInvokedScriptByProjectSchema,
        );
        registry.set(lastInvokedAtom, lastInvoked);
        await runCommandInThreadTerminal(context, {
          cwd: registry.get(context.gitStatusAtom)?.gitCwd ?? current.workspaceRoot,
          worktreePath: current.worktreePath,
          command: script.command,
          failureMessage: projectScriptRunFailedMessage(script.name),
        });
        return null;
      },
      projectScriptsAdd: async () => {
        openEditor({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });
        return null;
      },
      projectScriptsEdit: async (params) => {
        const { scriptId } = ScriptIdParams(params);
        const current = requireContext();
        const script = current.scripts.find((candidate) => candidate.id === scriptId);
        if (script === undefined) throw new Error(PROJECT_SCRIPT_NOT_FOUND_MESSAGE);
        openEditor(editorRequestForScript(script, current.keybindings));
        return null;
      },
      projectScriptsImport: async (params) => {
        const { key } = ImportParams(params);
        const current = requireContext();
        const item = toolbarModel(current, registry.get(lastInvokedAtom)).importItems.find(
          (candidate) => candidate.key === key,
        );
        if (item === undefined) return null;
        const payload = projectScriptInputFromFileScript(item.fileScript);
        const result = await submitScript(current, null, payload);
        const failedRequest = resolveFileScriptImportFailure(payload, result);
        if (failedRequest) openEditor(failedRequest);
        return null;
      },
      projectScriptEditorUpdate: async (params) => {
        const patch = EditorUpdateParams(params);
        const session = registry.get(editorAtom);
        if (session === null || session.saving) return null;
        updateSession(session.id, (current) => ({
          ...current,
          form: { ...current.form, ...patch },
          iconPickerOpen: patch.icon === undefined ? current.iconPickerOpen : false,
        }));
        return null;
      },
      projectScriptEditorKey: async (params) => {
        const session = registry.get(editorAtom);
        if (session === null || session.saving) return null;
        const capture = resolveProjectScriptKeybindingCapture(KeyParams(params), platform);
        if (capture.kind !== "set") return null;
        updateSession(session.id, (current) => ({
          ...current,
          form: { ...current.form, keybinding: capture.keybinding },
        }));
        return null;
      },
      projectScriptEditorIconPicker: async (params) => {
        const { open } = IconPickerParams(params);
        const session = registry.get(editorAtom);
        if (session === null) return null;
        updateSession(session.id, (current) => ({ ...current, iconPickerOpen: open }));
        return null;
      },
      projectScriptEditorClose: async () => {
        registry.set(editorAtom, null);
        return null;
      },
      projectScriptEditorSubmit: async () => {
        const session = registry.get(editorAtom);
        if (session === null || session.saving) return null;
        const submission = resolveProjectScriptSubmission({
          scriptId: session.scriptId,
          scripts: session.handlers.scripts(),
          form: session.form,
        });
        if (submission.kind === "invalid") {
          updateSession(session.id, (value) => ({ ...value, validationError: submission.error }));
          return null;
        }
        updateSession(session.id, (value) => ({
          ...value,
          validationError: null,
          saving: true,
          iconPickerOpen: false,
        }));
        const isPending = () => {
          const latest = registry.get(editorAtom);
          return latest !== null && latest.id === session.id && latest.saving;
        };
        try {
          const result = await session.handlers.submit(session.scriptId, submission.payload);
          if (isPending()) {
            const outcome = resolveProjectScriptSaveOutcome(result);
            if (outcome.kind === "close") {
              registry.set(editorAtom, null);
            } else if (outcome.kind === "error") {
              updateSession(session.id, (value) => ({
                ...value,
                validationError: outcome.message,
              }));
            }
          }
        } catch (error) {
          if (isPending()) {
            updateSession(session.id, (value) => ({
              ...value,
              validationError: errorMessageOr(error, PROJECT_SCRIPT_SAVE_FAILED_MESSAGE),
            }));
          }
        }
        updateSession(session.id, (value) => ({ ...value, saving: false }));
        return null;
      },
      projectScriptEditorRequestDelete: async () => {
        const session = registry.get(editorAtom);
        if (session === null || session.scriptId === null) return null;
        updateSession(session.id, (value) => ({ ...value, deleteConfirmOpen: true }));
        return null;
      },
      projectScriptEditorCancelDelete: async () => {
        const session = registry.get(editorAtom);
        if (session === null) return null;
        updateSession(session.id, (value) => ({ ...value, deleteConfirmOpen: false }));
        return null;
      },
      projectScriptEditorConfirmDelete: async () => {
        const session = registry.get(editorAtom);
        if (session === null || session.scriptId === null || session.saving) return null;
        registry.set(editorAtom, null);
        await session.handlers.remove(session.scriptId);
        return null;
      },
    },
  };
}
