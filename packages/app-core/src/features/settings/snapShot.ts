import {
  DesktopSnapShotSetupAction,
  SnapShotShortcut,
  SnapShotSound,
  type ClientSettingsPatch,
  type DesktopCaptureConfigApplied,
  type DesktopCaptureConfigPreview,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  buildDiffFileHunksModel,
  type DiffFileHunksModel,
} from "@t3tools/web/src/components/DiffPanel.logic.ts";
import {
  buildCaptureShortcutConfigModel,
  captureConfigApplyError,
  captureConfigPreviewDiff,
  captureConfigPreviewError,
  resolveCaptureConfigApplied,
  resolveCaptureConfigPreviewRequest,
  resolveCaptureShortcutRecordedKeys,
  resolveCaptureShortcutRecorder,
  type CaptureShortcutConfigError,
  type CaptureShortcutConfigModel,
  type CaptureShortcutConfigOperation,
  type CaptureShortcutConfigWorking,
} from "@t3tools/web/src/components/settings/CaptureShortcutConfig.logic.ts";
import {
  buildSnapShotSettingsModel,
  createRecordingRequestTracker,
  resolveSnapShotCloseSetup,
  resolveSnapShotEnabledChange,
  resolveSnapShotEnableForSetup,
  resolveSnapShotIncludeAccessibilityChange,
  resolveSnapShotOpenSetup,
  resolveSnapShotSetupAction,
  resolveSnapShotSetupResume,
  resolveSnapShotShortcutDraft,
  resolveSnapShotSoundChange,
  snapShotSettingsError,
  snapShotSetupReady,
  snapShotShortcutCheckFailed,
  snapShotShortcutSaved,
  snapShotShortcutUnavailable,
  type SnapShotSettingsError,
  type SnapShotSettingsModel,
  type SnapShotShortcutCheck,
  type SnapShotWizard,
} from "@t3tools/web/src/components/settings/SnapShotSettings.logic.ts";
import {
  buildSnapShotSetupDialogModel,
  captureSetupInitialMacPermissions,
  captureSetupInitialStep,
  captureSetupPollsMacPermissions,
  resolveCaptureSetupStepChange,
  type CaptureSetupMacPermissions,
  type CaptureSetupStep,
  type SnapShotSetupDialogModel,
} from "@t3tools/web/src/components/settings/SnapShotSetupDialog.logic.ts";
import {
  buildSnapShotShortcutRecorderModel,
  resolveSnapShotShortcutKeyDown,
  snapShotShortcutRecordingErrorMessage,
  type SnapShotShortcutRecorderModel,
} from "@t3tools/web/src/components/settings/useSnapShotShortcutRecorder.logic.ts";
import {
  clearSnapShotSetupResume,
  readSnapShotSetupResume,
  saveSnapShotSetupResume,
  shouldResumeSnapShotSetupOnStartup,
} from "@t3tools/web/src/lib/snapShotSetupResume.ts";
import { searchableSetting } from "@t3tools/web/src/components/settings/settingsSearch.ts";
import { snapShotKeybindingConflict } from "@t3tools/web/src/lib/snapShotShortcut.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../../clipboard.ts";
import type { FeatureContext } from "../../feature.ts";
import { snapShotService } from "../../snapShot.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

const SECTION = "snap-shot";
const PERMISSION_POLL_MS = 1_500;
const COPY_FEEDBACK_MS = 2_000;
const PERMISSION_CHECK_FAILED = "Could not check permissions. We'll try again automatically.";

type RecorderTarget = "inline" | "config";

type DialogUi = {
  readonly step: CaptureSetupStep;
  readonly checking: boolean;
  readonly checked: boolean;
  readonly configBusy: boolean;
  readonly permissions: CaptureSetupMacPermissions;
  readonly permissionError: string | null;
};

type ConfigUi = {
  readonly preview: DesktopCaptureConfigPreview | null;
  readonly result: DesktopCaptureConfigApplied | null;
  readonly error: CaptureShortcutConfigError | null;
  readonly working: CaptureShortcutConfigWorking | null;
  readonly keys: string | null;
  readonly customFile: boolean;
  readonly copied: boolean;
};

type Ui = {
  readonly setupBusy: boolean;
  readonly setupError: SnapShotSettingsError | null;
  readonly wizard: SnapShotWizard | null;
  readonly candidate: SnapShotShortcut;
  readonly shortcutCheck: SnapShotShortcutCheck;
  readonly recording: RecorderTarget | null;
  readonly heldModifierCodes: ReadonlyArray<string>;
  readonly dialog: DialogUi | null;
  readonly config: ConfigUi;
};

export type SettingsSnapShotConfigView = {
  readonly model: CaptureShortcutConfigModel;
  readonly recorder: SnapShotShortcutRecorderModel;
  readonly diff: DiffFileHunksModel | null;
};

export type SettingsSnapShotDialogView = {
  readonly model: SnapShotSetupDialogModel;
  readonly config: SettingsSnapShotConfigView | null;
};

export type SettingsSnapShotTitles = {
  readonly enabled: string;
  readonly accessibility: string;
  readonly shortcut: string;
  readonly sound: string;
  readonly flash: string;
  readonly animations: string;
};

export type SettingsSnapShotView = {
  readonly model: SnapShotSettingsModel;
  readonly titles: SettingsSnapShotTitles;
  readonly dialog: SettingsSnapShotDialogView | null;
};

const TITLES: SettingsSnapShotTitles = {
  enabled: searchableSetting("snap-shot-enabled").title,
  accessibility: searchableSetting("snap-shot-accessibility").title,
  shortcut: searchableSetting("snap-shot-shortcut").title,
  sound: searchableSetting("snap-shot-sound").title,
  flash: searchableSetting("snap-shot-flash").title,
  animations: searchableSetting("snap-shot-animations").title,
};

const IDLE_CHECK: SnapShotShortcutCheck = { status: "idle", availability: null };
const INITIAL_CONFIG: ConfigUi = {
  preview: null,
  result: null,
  error: null,
  working: null,
  keys: null,
  customFile: false,
  copied: false,
};

const CheckedParams = Schema.decodeUnknownSync(Schema.Struct({ checked: Schema.Boolean }));
const OpenSetupParams = Schema.decodeUnknownSync(
  Schema.Struct({ requested: Schema.Literals(["resume", "access", "shortcut"]) }),
);
const ActionParams = Schema.decodeUnknownSync(
  Schema.Struct({ action: DesktopSnapShotSetupAction }),
);
const SoundParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const SoundPreviewParams = Schema.decodeUnknownSync(Schema.Struct({ sound: SnapShotSound }));
const TargetParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.Literals(["inline", "config"]) }),
);
const KeyDownParams = Schema.decodeUnknownSync(
  Schema.Struct({
    target: Schema.Literals(["inline", "config"]),
    key: Schema.String,
    code: Schema.String,
    repeat: Schema.Boolean,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    altKey: Schema.Boolean,
    shiftKey: Schema.Boolean,
  }),
);
const KeyUpParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.Literals(["inline", "config"]), code: Schema.String }),
);
const StepParams = Schema.decodeUnknownSync(Schema.Struct({ index: Schema.Number }));
const CloseParams = Schema.decodeUnknownSync(Schema.Struct({ completed: Schema.Boolean }));
const ConfigReadParams = Schema.decodeUnknownSync(
  Schema.Struct({
    chooseFile: Schema.optional(Schema.Boolean),
    operation: Schema.Literals(["install", "remove"]),
  }),
);

export function createSnapShotSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry } = context;
  const service = snapShotService(context);
  const platform = context.platform;
  const initialUi = (): Ui => ({
    setupBusy: false,
    setupError: null,
    wizard: null,
    candidate: registry.get(context.clientSettingsAtom).snapShotShortcut,
    shortcutCheck: IDLE_CHECK,
    recording: null,
    heldModifierCodes: [],
    dialog: null,
    config: INITIAL_CONFIG,
  });
  const uiAtom = Atom.make<Ui>(initialUi()).pipe(Atom.keepAlive);
  const ui = () => registry.get(uiAtom);
  const patchUi = (patch: Partial<Ui>) => registry.set(uiAtom, { ...ui(), ...patch });
  const patchDialog = (patch: Partial<DialogUi>) => {
    const dialog = ui().dialog;
    if (dialog !== null) patchUi({ dialog: { ...dialog, ...patch } });
  };
  const patchConfig = (patch: Partial<ConfigUi>) =>
    patchUi({ config: { ...ui().config, ...patch } });
  const settings = () => registry.get(context.clientSettingsAtom);
  const snapShotState = () => registry.get(service.stateAtom);
  const keybindingsAtom = Atom.make((get) =>
    mergeWithDefaultKeybindings(get(context.state.primaryServerConfigAtom)?.keybindings ?? []),
  );

  let shortcutCheckId = 0;
  let stateRequestId = 0;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const requests = createRecordingRequestTracker();

  const fail = (error: SnapShotSettingsError) => {
    if (ui().wizard !== null) {
      patchUi({ setupError: error });
      return;
    }
    patchUi({ setupError: null });
    context.addToast({
      layout: "stacked",
      type: "error",
      title: error.title,
      description: error.message,
    });
  };

  const refreshState = async (): Promise<DesktopSnapShotState | undefined> => {
    const requestId = ++stateRequestId;
    try {
      return await service.state();
    } catch (error) {
      if (requestId === stateRequestId) {
        fail(snapShotSettingsError("Couldn't check capture setup", error));
      }
      return undefined;
    }
  };

  const save = async (patch: ClientSettingsPatch): Promise<DesktopSnapShotState | undefined> => {
    patchUi({ setupError: null });
    try {
      await context.updateClientSettings((current) => ({ ...current, ...patch }));
      await service.whenConfigured();
      return await refreshState();
    } catch (error) {
      fail(snapShotSettingsError("Couldn't save capture settings", error));
      return undefined;
    }
  };

  const resetShortcut = () => {
    shortcutCheckId++;
    patchUi({ candidate: settings().snapShotShortcut, shortcutCheck: IDLE_CHECK });
  };

  let savedShortcut = JSON.stringify(settings().snapShotShortcut);
  registry.subscribe(context.clientSettingsAtom, (next) => {
    const shortcut = JSON.stringify(next.snapShotShortcut);
    if (shortcut === savedShortcut) return;
    savedShortcut = shortcut;
    resetShortcut();
  });

  const checkShortcut = async (shortcut: SnapShotShortcut) => {
    const checkId = ++shortcutCheckId;
    patchUi({ candidate: shortcut });
    if (snapShotKeybindingConflict(shortcut, registry.get(keybindingsAtom), platform)) return;
    patchUi({ shortcutCheck: { status: "checking", availability: null } });
    try {
      const availability = await service.checkShortcut(shortcut);
      if (checkId === shortcutCheckId)
        patchUi({ shortcutCheck: { status: "checked", availability } });
    } catch (error) {
      if (checkId === shortcutCheckId)
        patchUi({ shortcutCheck: snapShotShortcutCheckFailed(error) });
    }
  };

  const draft = () =>
    resolveSnapShotShortcutDraft({
      state: snapShotState(),
      savedShortcut: settings().snapShotShortcut,
      candidate: ui().candidate,
      platform,
    });

  const configRecorder = () =>
    resolveCaptureShortcutRecorder({
      disabled: configDisabled(),
      working: ui().config.working,
      keys: ui().config.keys,
      preview: ui().config.preview,
    });

  const configDisabled = () => {
    const state = snapShotState();
    const current = ui();
    if (state === null || current.dialog === null) return true;
    const shortcut = buildDialogModel(state, current, current.dialog).shortcut;
    return shortcut?.kind === "config" ? shortcut.disabled : true;
  };

  const recorderDisabled = (target: RecorderTarget) =>
    target === "inline" ? ui().setupBusy : configRecorder().disabled;

  const stopRecording = () => {
    requests.clear();
    patchUi({ recording: null, heldModifierCodes: [] });
    void service.setShortcutSuppressed(false).catch(() => undefined);
  };

  const recorderError = (target: RecorderTarget, message: string) => {
    if (target === "inline") patchUi({ shortcutCheck: snapShotShortcutUnavailable(message) });
    else patchConfig({ error: { message } });
  };

  const startRecording = async (target: RecorderTarget) => {
    if (recorderDisabled(target)) return;
    const request = requests.tryBegin();
    if (!request) return;
    patchUi({ heldModifierCodes: [] });
    if (target === "inline") {
      shortcutCheckId++;
      patchUi({ shortcutCheck: IDLE_CHECK });
    } else {
      patchConfig({ error: null });
    }
    try {
      await service.setShortcutSuppressed(true);
      if (requests.owns(request)) patchUi({ recording: target });
    } catch (error) {
      if (!requests.owns(request)) return;
      requests.clear();
      recorderError(target, snapShotShortcutRecordingErrorMessage(error));
    }
  };

  const recordShortcut = (target: RecorderTarget, shortcut: SnapShotShortcut) => {
    if (target === "inline") {
      void checkShortcut(shortcut);
      return;
    }
    const recordedKeys = resolveCaptureShortcutRecordedKeys(shortcut);
    if (recordedKeys === null) return;
    patchConfig({ keys: recordedKeys, preview: null, error: null });
  };

  const buildDialogModel = (state: DesktopSnapShotState, current: Ui, dialog: DialogUi) => {
    const model = buildSnapShotSettingsModel(settingsModelInput(state, current));
    return buildSnapShotSetupDialogModel({
      state,
      step: dialog.step,
      wasEnabled: current.wizard?.wasEnabled ?? false,
      includeAccessibility: settings().snapShotIncludeAccessibility,
      actionBusy: current.setupBusy,
      checking: dialog.checking,
      checked: dialog.checked,
      configBusy: dialog.configBusy,
      error: current.setupError?.message ?? null,
      permissionStatus: dialog.permissions,
      permissionError: dialog.permissionError,
      shortcutStatus: model.shortcutStatus,
      shortcutChanged: model.shortcutChanged,
      canSaveShortcut: model.canSaveShortcut,
    });
  };

  const settingsModelInput = (state: DesktopSnapShotState | null, current: Ui) => ({
    hasSnapShotBridge: true,
    hasDesktopBridge: true,
    state,
    settings: registry.get(context.clientSettingsAtom),
    keybindings: registry.get(keybindingsAtom),
    platform,
    candidateShortcut: current.candidate,
    shortcutCheck: current.shortcutCheck,
    recording: current.recording === "inline",
    setupBusy: current.setupBusy,
    wizardOpen: current.wizard !== null,
  });

  const openWizard = (wizard: SnapShotWizard, state: DesktopSnapShotState) => {
    patchUi({
      wizard,
      dialog: {
        step: captureSetupInitialStep(state, wizard.initialStep),
        checking: false,
        checked: false,
        configBusy: false,
        permissions: captureSetupInitialMacPermissions(state),
        permissionError: null,
      },
      config: INITIAL_CONFIG,
    });
  };

  const setup = async (action: DesktopSnapShotSetupAction) => {
    const current = ui();
    if (current.setupBusy) return;
    patchUi({ setupBusy: true, setupError: null });
    const plan = resolveSnapShotSetupAction({
      action,
      state: snapShotState(),
      wizardOpen: current.wizard !== null,
    });
    try {
      if (plan.saveResume && current.wizard) {
        saveSnapShotSetupResume(current.wizard.wasEnabled, context.storage);
      }
      await service.setup(action);
      await refreshState();
    } catch (error) {
      fail(snapShotSettingsError(plan.errorTitle, error));
    } finally {
      patchUi({ setupBusy: false });
    }
  };

  const saveIncludeAccessibility = async (includeAccessibility: boolean) => {
    const change = resolveSnapShotIncludeAccessibilityChange(
      includeAccessibility,
      settings().snapShotEnabled,
    );
    try {
      if (change.requestPermissions) await service.requestPermissions(true);
      await save(change.patch);
    } catch (error) {
      fail(snapShotSettingsError("Couldn't allow app text capture", error));
    }
  };

  const openSetup = async (requested: "resume" | CaptureSetupStep) => {
    if (snapShotState() === null || ui().setupBusy) return;
    stopRecording();
    resetShortcut();
    patchUi({ setupError: null, setupBusy: true });
    const wasEnabled = settings().snapShotEnabled;
    try {
      let current = await refreshState();
      if (!current) return;
      const plan = resolveSnapShotOpenSetup({ state: current, requested, enabled: wasEnabled });
      if (plan.enableFirst) {
        current = await save({ snapShotEnabled: true });
        if (!current) {
          const state = snapShotState();
          if (state !== null) openWizard({ initialStep: "access", wasEnabled: false }, state);
          return;
        }
      }
      openWizard(
        { initialStep: captureSetupInitialStep(current, plan.requested), wasEnabled },
        current,
      );
    } finally {
      patchUi({ setupBusy: false });
    }
  };

  const enableForSetup = async (): Promise<boolean> => {
    if (ui().setupBusy) return false;
    patchUi({ setupBusy: true, setupError: null });
    const plan = resolveSnapShotEnableForSetup({
      state: snapShotState(),
      enabled: settings().snapShotEnabled,
      includeAccessibility: settings().snapShotIncludeAccessibility,
      wizardWasEnabled: ui().wizard?.wasEnabled ?? null,
    });
    try {
      if (plan.macCaptureTest) {
        saveSnapShotSetupResume(plan.macCaptureTest.resumeWasEnabled, context.storage);
        await service.setup("test-mac-capture");
      }
      if (plan.requestPermissions) {
        await service.requestPermissions(plan.requestPermissions.includeAccessibility);
      }
      const nextState =
        plan.finish.kind === "refresh" ? await refreshState() : await save(plan.finish.patch);
      return snapShotSetupReady(nextState);
    } catch (error) {
      fail(snapShotSettingsError("Couldn't verify capture access", error));
      return false;
    } finally {
      patchUi({ setupBusy: false });
    }
  };

  const closeSetup = async (completed: boolean) => {
    const wizard = ui().wizard;
    if (!wizard || ui().setupBusy) return;
    patchUi({ setupBusy: true });
    try {
      const plan = resolveSnapShotCloseSetup({
        enabled: settings().snapShotEnabled,
        wasEnabled: wizard.wasEnabled,
        completed,
      });
      if (plan.disableCapture && !(await save({ snapShotEnabled: false }))) return;
      stopRecording();
      clearSnapShotSetupResume(context.storage);
      patchUi({ setupError: null, wizard: null, dialog: null, config: INITIAL_CONFIG });
    } catch (error) {
      fail(snapShotSettingsError("Couldn't close capture setup", error));
    } finally {
      patchUi({ setupBusy: false });
    }
  };

  const saveShortcut = async (): Promise<boolean> => {
    const current = ui();
    const model = buildSnapShotSettingsModel(settingsModelInput(snapShotState(), current));
    if (!model.canSaveShortcut || current.setupBusy) return false;
    patchUi({ setupBusy: true });
    try {
      return snapShotShortcutSaved(await save({ snapShotShortcut: current.candidate }));
    } finally {
      patchUi({ setupBusy: false });
    }
  };

  const changeStep = (step: CaptureSetupStep) => {
    stopRecording();
    patchDialog({ checked: false, step });
  };

  const dialogBusy = () => {
    const current = ui();
    return (
      current.setupBusy ||
      (current.dialog?.checking ?? false) ||
      (current.dialog?.configBusy ?? false)
    );
  };

  const checkAgain = async () => {
    if (dialogBusy()) return;
    patchDialog({ checking: true, checked: false });
    try {
      patchDialog({ checked: (await refreshState()) !== undefined });
    } finally {
      patchDialog({ checking: false });
    }
  };

  let permissionTimer: ReturnType<typeof setInterval> | undefined;
  let permissionChecking = false;
  const refreshPermissions = async () => {
    if (permissionChecking || permissionTimer === undefined) return;
    permissionChecking = true;
    try {
      const refreshed = await refreshState();
      if (!refreshed?.macPermissions) throw new Error("Permission status unavailable");
      patchDialog({ permissions: refreshed.macPermissions, permissionError: null });
    } catch {
      patchDialog({ permissionError: PERMISSION_CHECK_FAILED });
    }
    permissionChecking = false;
  };
  const syncPermissionPolling = () => {
    const state = snapShotState();
    const dialog = ui().dialog;
    const poll =
      state !== null &&
      dialog !== null &&
      captureSetupPollsMacPermissions(state, dialog.step, dialogBusy());
    if (poll && permissionTimer === undefined) {
      permissionTimer = setInterval(() => void refreshPermissions(), PERMISSION_POLL_MS);
      void refreshPermissions();
    } else if (!poll && permissionTimer !== undefined) {
      clearInterval(permissionTimer);
      permissionTimer = undefined;
    }
  };
  registry.subscribe(uiAtom, syncPermissionPolling);
  registry.subscribe(service.stateAtom, syncPermissionPolling);

  const beginConfig = (phase: CaptureShortcutConfigWorking) => {
    patchConfig({ working: phase, error: null });
    patchDialog({ configBusy: true });
  };
  const endConfig = () => {
    patchConfig({ working: null });
    patchDialog({ configBusy: false });
  };

  const configActionBusy = () => configRecorder().disabled || ui().recording === "config";

  const readConfig = async (chooseFile: boolean, operation: CaptureShortcutConfigOperation) => {
    if (configActionBusy()) return;
    const keys = ui().config.keys;
    beginConfig("reading");
    patchConfig({ preview: null, result: null, customFile: chooseFile });
    try {
      patchConfig({
        preview: await service.previewConfig(
          resolveCaptureConfigPreviewRequest({ operation, chooseFile, keys }),
        ),
      });
    } catch (cause) {
      patchConfig({ error: captureConfigPreviewError(cause) });
    } finally {
      endConfig();
    }
  };

  const applyConfig = async () => {
    const preview = ui().config.preview;
    if (configActionBusy() || !preview) return;
    beginConfig("writing");
    try {
      const applied = await service.applyConfig(preview.id);
      patchConfig({ result: applied });
      await refreshState();
      const outcome = resolveCaptureConfigApplied({ preview, applied, canComplete: true });
      if (outcome.kind === "complete") {
        context.addToast({ layout: "stacked", type: "success", ...outcome.toast });
        await closeSetup(true);
      }
    } catch (cause) {
      patchConfig({ error: captureConfigApplyError(cause), preview: null });
    } finally {
      endConfig();
    }
  };

  const resume = shouldResumeSnapShotSetupOnStartup(context.storage);
  if (resume) {
    setTimeout(() => context.navigate({ kind: "settings", section: SECTION }), 0);
  }

  const viewAtom = Atom.make((get): SettingsSnapShotView | null => {
    if (get(scope.sectionAtom) !== SECTION) return null;
    const current = get(uiAtom);
    const state = get(service.stateAtom);
    get(context.clientSettingsAtom);
    get(keybindingsAtom);
    const model = buildSnapShotSettingsModel(settingsModelInput(state, current));
    if (current.wizard === null || current.dialog === null || state === null) {
      return { model, titles: TITLES, dialog: null };
    }
    const dialogModel = buildDialogModel(state, current, current.dialog);
    const config = current.config;
    const recorderSetup = resolveCaptureShortcutRecorder({
      disabled: dialogModel.shortcut?.kind === "config" ? dialogModel.shortcut.disabled : true,
      working: config.working,
      keys: config.keys,
      preview: config.preview,
    });
    const configModel = buildCaptureShortcutConfigModel({
      state,
      supported: true,
      disabled: dialogModel.shortcut?.kind === "config" ? dialogModel.shortcut.disabled : true,
      recording: current.recording === "config",
      working: config.working,
      preview: config.preview,
      result: config.result,
      error: config.error,
      copied: config.copied,
      canComplete: true,
    });
    const diff =
      configModel.preview?.changed === true ? captureConfigPreviewDiff(config.preview) : null;
    return {
      model,
      titles: TITLES,
      dialog: {
        model: dialogModel,
        config:
          dialogModel.shortcut?.kind === "config"
            ? {
                model: configModel,
                recorder: buildSnapShotShortcutRecorderModel({
                  shortcut: recorderSetup.shortcut,
                  shortcutLabel: null,
                  recording: current.recording === "config",
                  disabled: recorderSetup.disabled,
                  allowModifierPairs: false,
                  platform,
                }),
                diff: diff === null ? null : buildDiffFileHunksModel(diff),
              }
            : null,
      },
    };
  });

  return {
    views: { settingsSnapShot: viewAtom },
    actions: {
      settingsSnapShotMount: async () => {
        stopRecording();
        clearInterval(permissionTimer);
        permissionTimer = undefined;
        registry.set(uiAtom, initialUi());
        const current = await refreshState();
        const resumed = resolveSnapShotSetupResume(
          current,
          readSnapShotSetupResume(context.storage),
        );
        if (resumed && current && ui().wizard === null) openWizard(resumed, current);
        return null;
      },
      settingsSnapShotRefresh: async () => {
        if (permissionTimer !== undefined) await refreshPermissions();
        else await refreshState();
        return null;
      },
      settingsSnapShotEnabled: async (params) => {
        const intent = resolveSnapShotEnabledChange(CheckedParams(params).checked, snapShotState());
        if (intent.kind === "save") await save(intent.patch);
        else await openSetup("resume");
        return null;
      },
      settingsSnapShotOpenSetup: async (params) => {
        await openSetup(OpenSetupParams(params).requested);
        return null;
      },
      settingsSnapShotIncludeAccessibility: async (params) => {
        await saveIncludeAccessibility(CheckedParams(params).checked);
        return null;
      },
      settingsSnapShotSetup: async (params) => {
        await setup(ActionParams(params).action);
        return null;
      },
      settingsSnapShotSound: async (params) => {
        const patch = resolveSnapShotSoundChange(SoundParams(params).value);
        if (patch) await save(patch);
        return null;
      },
      settingsSnapShotSoundPreview: async (params) => {
        service.previewSound(SoundPreviewParams(params).sound);
        return null;
      },
      settingsSnapShotFlash: async (params) => {
        await save({ snapShotFlash: CheckedParams(params).checked });
        return null;
      },
      settingsSnapShotAnimations: async (params) => {
        await save({ snapShotAnimations: CheckedParams(params).checked });
        return null;
      },
      settingsSnapShotShortcutSave: async () => saveShortcut(),
      settingsSnapShotShortcutCancel: async () => {
        stopRecording();
        resetShortcut();
        return null;
      },
      settingsSnapShotRecorderStart: async (params) => {
        await startRecording(TargetParams(params).target);
        return null;
      },
      settingsSnapShotRecorderStop: async (params) => {
        if (ui().recording === TargetParams(params).target || ui().recording === null) {
          stopRecording();
        }
        return null;
      },
      settingsSnapShotRecorderKeyDown: async (params) => {
        const event = KeyDownParams(params);
        const current = ui();
        const decision = resolveSnapShotShortcutKeyDown({
          ...event,
          recording: current.recording === event.target,
          heldModifierCodes: current.heldModifierCodes,
          allowModifierPairs: event.target === "inline" ? draft().allowModifierPairs : false,
          platform,
        });
        if (!decision.handled) return { handled: false };
        if (decision.holdModifierCode !== null) {
          patchUi({ heldModifierCodes: [...current.heldModifierCodes, decision.holdModifierCode] });
        }
        const outcome = decision.outcome;
        if (outcome.kind === "cancel") {
          stopRecording();
        } else if (outcome.kind === "error") {
          recorderError(event.target, outcome.message);
        } else if (outcome.kind === "record") {
          stopRecording();
          recordShortcut(event.target, outcome.shortcut);
        }
        return { handled: true };
      },
      settingsSnapShotRecorderKeyUp: async (params) => {
        const { code } = KeyUpParams(params);
        patchUi({ heldModifierCodes: ui().heldModifierCodes.filter((held) => held !== code) });
        return null;
      },
      settingsSnapShotDialogStep: async (params) => {
        const dialog = ui().dialog;
        if (dialog === null) return null;
        const next = resolveCaptureSetupStepChange(StepParams(params).index, dialog.step);
        if (next) changeStep(next);
        return null;
      },
      settingsSnapShotDialogBack: async () => {
        changeStep("access");
        return null;
      },
      settingsSnapShotDialogClose: async (params) => {
        await closeSetup(CloseParams(params).completed);
        return null;
      },
      settingsSnapShotDialogPrimary: async () => {
        const state = snapShotState();
        const current = ui();
        if (state === null || current.dialog === null) return null;
        const primary = buildDialogModel(state, current, current.dialog).primaryButton;
        if (primary === null || primary.disabled) return null;
        const intent = primary.intent;
        switch (intent.kind) {
          case "action":
            await setup(intent.action);
            return null;
          case "check-again":
            await checkAgain();
            return null;
          case "enable-and-continue":
            if (await enableForSetup()) changeStep("shortcut");
            return null;
          case "finish":
            if (!intent.saveShortcut || (await saveShortcut())) await closeSetup(true);
            return null;
        }
        return null;
      },
      settingsSnapShotConfigRead: async (params) => {
        const { chooseFile, operation } = ConfigReadParams(params);
        await readConfig(chooseFile ?? ui().config.customFile, operation);
        return null;
      },
      settingsSnapShotConfigApply: async () => {
        await applyConfig();
        return null;
      },
      settingsSnapShotConfigCancel: async () => {
        patchConfig({ preview: null });
        return null;
      },
      settingsSnapShotConfigCopy: async () => {
        const binding = snapShotState()?.shortcutBinding;
        if (!binding) return null;
        await clipboardService(context).writeText(binding);
        patchConfig({ copied: true });
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => patchConfig({ copied: false }), COPY_FEEDBACK_MS);
        return null;
      },
      settingsSnapShotConfigComplete: async () => {
        await closeSetup(true);
        return null;
      },
    },
  };
}
