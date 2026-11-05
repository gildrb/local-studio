import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  KeybindingCommand,
  ServerRemoveKeybindingInput,
  ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import {
  buildKeybindingRows,
  buildKeybindingsSettingsModel,
  buildWhenExpressionBuilderModel,
  createKeybindingDraft,
  EMPTY_NEW_KEYBINDING_DRAFT,
  isKeybindingsSearchShortcut,
  parseWhenExpressionDraft,
  resolveKeybindingCapture,
  resolveKeybindingCommandSelection,
  resolveKeybindingDraftChange,
  resolveKeybindingsChange,
  resolveKeybindingsSearchTargetChange,
  resolveWhenExpressionEdit,
  resolveWhenOperatorSelection,
  whenAstToExpression,
  type KeybindingDraft,
  type KeybindingDraftIntent,
  type KeybindingRow,
  type KeybindingRowModel,
  type KeybindingsChangeIntent,
  type KeybindingsSettingsModel,
  type NewKeybindingDraft,
  type NewKeybindingModel,
  type WhenExpressionBuilderModel,
  type WhenExpressionEdit,
  type WhenNodeEdit,
} from "@t3tools/web/src/components/settings/KeybindingsSettings.logic.ts";
import { keybindingSearchAnchorId } from "@t3tools/web/src/components/settings/settingsSearch.ts";
import { openInPreferredEditor } from "@t3tools/web/src/editorPreferences.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

const NEW_TARGET = "new";

type KeybindingsUi = {
  readonly query: string;
  readonly isSearchOpen: boolean;
  readonly searchFocusRevision: number;
  readonly isAddingBinding: boolean;
  readonly savingCommand: KeybindingCommand | null;
  readonly rowDrafts: Readonly<Record<string, KeybindingDraft>>;
  readonly newBinding: NewKeybindingDraft;
  readonly when: { readonly target: string; readonly expressionDraft: string } | null;
  readonly menuRowId: string | null;
};

const INITIAL_UI: KeybindingsUi = {
  query: "",
  isSearchOpen: false,
  searchFocusRevision: 0,
  isAddingBinding: false,
  savingCommand: null,
  rowDrafts: {},
  newBinding: EMPTY_NEW_KEYBINDING_DRAFT,
  when: null,
  menuRowId: null,
};

export type KeybindingRowView = Omit<KeybindingRowModel, "binding" | "conflicts"> & {
  readonly anchorId: string | null;
  readonly passTab: boolean;
  readonly menuOpen: boolean;
  readonly whenOpen: boolean;
};

export type NewKeybindingView = NewKeybindingModel & {
  readonly passTab: boolean;
  readonly whenOpen: boolean;
};

export type KeybindingsSettingsView = Omit<KeybindingsSettingsModel, "rows" | "newBinding"> & {
  readonly searchFocusRevision: number;
  readonly rows: readonly KeybindingRowView[];
  readonly newBinding: NewKeybindingView | null;
  readonly whenBuilder: (WhenExpressionBuilderModel & { readonly target: string }) | null;
};

const DraftIntentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("startRecording") }),
  Schema.Struct({ kind: Schema.Literal("stopRecording") }),
]);

const KeyEventSchema = Schema.Struct({
  key: Schema.String,
  code: Schema.String,
  metaKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
  altKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
});

const DraftParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.String, intent: DraftIntentSchema }),
);
const CaptureParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.String, event: KeyEventSchema }),
);
const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const TargetParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.NullOr(Schema.String) }),
);
const RowParams = Schema.decodeUnknownSync(Schema.Struct({ rowId: Schema.String }));
const MenuParams = Schema.decodeUnknownSync(Schema.Struct({ rowId: Schema.NullOr(Schema.String) }));
const RowActionParams = Schema.decodeUnknownSync(
  Schema.Struct({ rowId: Schema.String, action: Schema.Literals(["reset", "remove"]) }),
);
const ShortcutParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    altKey: Schema.Boolean,
  }),
);
const RootEditParams = Schema.decodeUnknownSync(
  Schema.Struct({ kind: Schema.Literals(["addRootCondition", "addRootGroup", "clear"]) }),
);
const NodeEditSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("setNegated"), negated: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("setIdentifier"), identifier: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("setOperator"), operator: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("addCondition") }),
  Schema.Struct({ kind: Schema.Literal("addGroup") }),
]);
const NodeEditParams = Schema.decodeUnknownSync(
  Schema.Struct({ path: Schema.Array(Schema.Number), edit: NodeEditSchema }),
);
const NodeRemoveParams = Schema.decodeUnknownSync(
  Schema.Struct({ path: Schema.Array(Schema.Number) }),
);

function errorDescription(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createKeybindingsSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const uiAtom = Atom.make<KeybindingsUi>(INITIAL_UI).pipe(Atom.keepAlive);

  const ui = () => registry.get(uiAtom);
  const patchUi = (patch: Partial<KeybindingsUi>) => registry.set(uiAtom, { ...ui(), ...patch });

  registry.subscribe(scope.searchTargetAtom, (target) => {
    if (target.targetId === null) return;
    if (resolveKeybindingsSearchTargetChange(target.targetId).clearQuery) patchUi({ query: "" });
  });

  const environment = () => registry.get(scope.scopeContextAtom).environment;

  const allRows = (): readonly KeybindingRow[] =>
    buildKeybindingRows(
      mergeWithDefaultKeybindings(environment()?.serverConfig?.keybindings ?? []),
      "",
    );

  const findRow = (rowId: string): KeybindingRow | null =>
    allRows().find((row) => row.id === rowId) ?? null;

  const rowDraft = (row: KeybindingRow): KeybindingDraft =>
    ui().rowDrafts[row.id] ?? createKeybindingDraft(row);

  const currentDraft = (target: string): KeybindingDraft | null => {
    if (target === NEW_TARGET) return ui().newBinding.draft;
    const row = findRow(target);
    return row === null ? null : rowDraft(row);
  };

  const setDraft = (target: string, draft: KeybindingDraft) => {
    const current = ui();
    if (target === NEW_TARGET) {
      patchUi({ newBinding: { ...current.newBinding, draft } });
      return;
    }
    patchUi({ rowDrafts: { ...current.rowDrafts, [target]: draft } });
  };

  const dispatch = (target: string, intent: KeybindingDraftIntent) => {
    const draft = currentDraft(target);
    if (draft === null) return;
    setDraft(target, resolveKeybindingDraftChange(draft, intent));
  };

  const dropDraft = (rowId: string | null) => {
    if (rowId === null) return;
    const { [rowId]: _dropped, ...rest } = ui().rowDrafts;
    patchUi({ rowDrafts: rest });
  };

  const viewAtom = Atom.make((get): KeybindingsSettingsView | null => {
    if (get(scope.sectionAtom) !== "keybindings") return null;
    const current = get(uiAtom);
    const primary = get(scope.scopeContextAtom).environment;
    const model = buildKeybindingsSettingsModel({
      serverKeybindings: primary?.serverConfig?.keybindings ?? null,
      keybindingsConfigPath: primary?.serverConfig?.keybindingsConfigPath ?? null,
      query: current.query,
      isSearchOpen: current.isSearchOpen,
      isAddingBinding: current.isAddingBinding,
      savingCommand: current.savingCommand,
      platform: context.platform,
      isElectron: true,
      rowDrafts: current.rowDrafts,
      newBinding: current.newBinding,
    });
    const whenTarget = current.when?.target ?? null;
    const rows = model.rows.map(({ binding: _binding, conflicts: _conflicts, ...row }) => ({
      ...row,
      anchorId: row.isSearchAnchor ? keybindingSearchAnchorId(row.command) : null,
      passTab: !(current.rowDrafts[row.id]?.isRecording ?? false),
      menuOpen: current.menuRowId === row.id,
      whenOpen: whenTarget === row.id,
    }));
    const whenDraft =
      current.when === null
        ? null
        : current.when.target === NEW_TARGET
          ? current.newBinding.draft
          : (() => {
              const row = model.rows.find((candidate) => candidate.id === current.when?.target);
              return row === undefined
                ? null
                : (current.rowDrafts[row.id] ?? createKeybindingDraft(row));
            })();
    return {
      ...model,
      searchFocusRevision: current.searchFocusRevision,
      rows,
      newBinding:
        model.newBinding === null
          ? null
          : {
              ...model.newBinding,
              passTab: !current.newBinding.draft.isRecording,
              whenOpen: whenTarget === NEW_TARGET,
            },
      whenBuilder:
        current.when === null || whenDraft === null
          ? null
          : {
              ...buildWhenExpressionBuilderModel({
                value: whenDraft.whenDraft,
                expressionDraft: current.when.expressionDraft,
                variables: model.whenVariables,
              }),
              target: current.when.target,
            },
    };
  });

  const showError = (title: string, description: string) => {
    context.addToast({ layout: "stacked", type: "error", title, description });
  };

  const saveKeybinding = async (payload: ServerUpsertKeybindingInput, rowId: string | null) => {
    const scopeContext = registry.get(scope.scopeContextAtom);
    if (scopeContext.environment === null) return;
    patchUi({ savingCommand: payload.command });
    const results = await Promise.all(
      scopeContext.connectedEnvironments.map((target) =>
        runAtomCommand(
          registry,
          state.serverEnvironment.upsertKeybinding,
          { environmentId: target.environmentId, input: payload },
          { reportFailure: false },
        ),
      ),
    );
    patchUi({ savingCommand: null });
    const failed = results.find((result) => result._tag === "Failure");
    if (failed === undefined) {
      dropDraft(rowId);
      patchUi({ isAddingBinding: false, menuRowId: null });
      return;
    }
    if (!isAtomCommandInterrupted(failed)) {
      showError(
        "Unable to save keybinding",
        errorDescription(squashAtomCommandFailure(failed), "The keybinding was not saved."),
      );
    }
  };

  const removeKeybinding = async (input: ServerRemoveKeybindingInput, rowId: string) => {
    const scopeContext = registry.get(scope.scopeContextAtom);
    if (scopeContext.environment === null) return;
    patchUi({ savingCommand: input.command });
    const results = await Promise.all(
      scopeContext.connectedEnvironments.map((target) =>
        runAtomCommand(
          registry,
          state.serverEnvironment.removeKeybinding,
          { environmentId: target.environmentId, input },
          { reportFailure: false },
        ),
      ),
    );
    patchUi({ savingCommand: null });
    const result = results.find((entry) => entry._tag === "Failure") ?? results[0];
    if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      showError(
        "Unable to remove keybinding",
        errorDescription(squashAtomCommandFailure(result), "The keybinding was not removed."),
      );
      return;
    }
    dropDraft(rowId);
  };

  const applyChange = async (intent: KeybindingsChangeIntent, rowId: string | null) => {
    const decision = resolveKeybindingsChange(intent);
    if (decision.kind === "upsert") await saveKeybinding(decision.input, rowId);
    if (decision.kind === "remove" && rowId !== null) await removeKeybinding(decision.input, rowId);
  };

  const applyWhenValue = (
    target: string,
    value: KeybindingDraft["whenDraft"],
    expressionDraft: string,
  ) => {
    const draft = currentDraft(target);
    if (draft === null) return;
    setDraft(target, { ...draft, whenDraft: value, isWhenDraftValid: true });
    patchUi({ when: { target, expressionDraft } });
  };

  const applyWhenEdit = (edit: WhenExpressionEdit) => {
    const when = ui().when;
    if (when === null) return;
    const draft = currentDraft(when.target);
    if (draft === null) return;
    const result = resolveWhenExpressionEdit(draft.whenDraft, edit);
    if (result.kind === "changed") {
      applyWhenValue(when.target, result.value, whenAstToExpression(result.value));
    }
  };

  const toNodeEdit = (edit: typeof NodeEditSchema.Type): WhenNodeEdit | null => {
    if (edit.kind !== "setOperator") return edit;
    const operator = resolveWhenOperatorSelection(edit.operator);
    return operator === null ? null : { kind: "setOperator", operator };
  };

  return {
    views: { settingsKeybindings: viewAtom },
    actions: {
      settingsKeybindingsMount: async () => {
        registry.set(uiAtom, INITIAL_UI);
        const targetId = registry.get(scope.searchTargetAtom).targetId;
        if (targetId !== null && resolveKeybindingsSearchTargetChange(targetId).clearQuery) {
          patchUi({ query: "" });
        }
        return null;
      },
      settingsKeybindingsSearch: async (params) => {
        patchUi({ query: QueryParams(params).query });
        return null;
      },
      settingsKeybindingsSearchOpen: async (params) => {
        const { open } = OpenParams(params);
        patchUi(
          open
            ? { isSearchOpen: true, searchFocusRevision: ui().searchFocusRevision + 1 }
            : { isSearchOpen: false },
        );
        return null;
      },
      settingsKeybindingsSearchEscape: async () => {
        patchUi({ query: "", isSearchOpen: false });
        return null;
      },
      settingsKeybindingsSearchShortcut: async (params) => {
        if (registry.get(scope.sectionAtom) !== "keybindings") return false;
        if (!isKeybindingsSearchShortcut(ShortcutParams(params))) return false;
        patchUi({ isSearchOpen: true, searchFocusRevision: ui().searchFocusRevision + 1 });
        return true;
      },
      settingsKeybindingsAdd: async () => {
        if (ui().isAddingBinding) return null;
        patchUi({
          isAddingBinding: true,
          newBinding: EMPTY_NEW_KEYBINDING_DRAFT,
          when: ui().when?.target === NEW_TARGET ? null : ui().when,
        });
        return null;
      },
      settingsKeybindingsCancelAdd: async () => {
        patchUi({
          isAddingBinding: false,
          newBinding: EMPTY_NEW_KEYBINDING_DRAFT,
          when: ui().when?.target === NEW_TARGET ? null : ui().when,
        });
        return null;
      },
      settingsKeybindingsCommand: async (params) => {
        const { value } = ValueParams(params);
        const model = registry.get(viewAtom);
        if (model === null) return null;
        const command = resolveKeybindingCommandSelection(model.commandOptions, value);
        if (command !== null) patchUi({ newBinding: { ...ui().newBinding, command } });
        return null;
      },
      settingsKeybindingsDraft: async (params) => {
        const { target, intent } = DraftParams(params);
        dispatch(target, intent);
        return null;
      },
      settingsKeybindingsCapture: async (params) => {
        const { target, event } = CaptureParams(params);
        const draft = currentDraft(target);
        if (draft === null) return false;
        const row = target === NEW_TARGET ? null : findRow(target);
        const decision = resolveKeybindingCapture({
          event,
          isRecording: draft.isRecording,
          platform: context.platform,
          resetKey: row?.key ?? "",
        });
        if (decision.kind === "passThrough") return false;
        if (decision.intent !== null) dispatch(target, decision.intent);
        return true;
      },
      settingsKeybindingsSave: async (params) => {
        const { rowId } = RowParams(params);
        if (rowId === NEW_TARGET) {
          await applyChange({ kind: "saveNew", newBinding: ui().newBinding }, null);
          return null;
        }
        const row = findRow(rowId);
        if (row === null) return null;
        await applyChange({ kind: "save", row, draft: rowDraft(row) }, rowId);
        return null;
      },
      settingsKeybindingsMenu: async (params) => {
        patchUi({ menuRowId: MenuParams(params).rowId });
        return null;
      },
      settingsKeybindingsRowAction: async (params) => {
        const { rowId, action } = RowActionParams(params);
        patchUi({ menuRowId: null });
        const row = findRow(rowId);
        if (row === null) return null;
        await applyChange({ kind: action, row }, rowId);
        return null;
      },
      settingsKeybindingsOpenFile: async () => {
        const primary = environment();
        const path = primary?.serverConfig?.keybindingsConfigPath ?? null;
        if (!path) return null;
        const result = await openInPreferredEditor({
          environmentId: primary?.environmentId ?? null,
          availableEditors: primary?.serverConfig?.availableEditors ?? [],
          targetPath: path,
          openInEditor: (target) =>
            runAtomCommand(registry, state.shellEnvironment.openInEditor, target, {
              reportFailure: false,
            }),
        });
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
        showError(
          "Unable to open keybindings file",
          errorDescription(
            squashAtomCommandFailure(result),
            "The keybindings file was not opened.",
          ),
        );
        return null;
      },
      settingsKeybindingsWhenOpen: async (params) => {
        const { target } = TargetParams(params);
        if (target === null) {
          patchUi({ when: null });
          return null;
        }
        const draft = currentDraft(target);
        if (draft === null) return null;
        patchUi({
          when: { target, expressionDraft: whenAstToExpression(draft.whenDraft) },
          menuRowId: null,
        });
        return null;
      },
      settingsKeybindingsWhenExpression: async (params) => {
        const when = ui().when;
        if (when === null) return null;
        const { value } = ValueParams(params);
        const draft = currentDraft(when.target);
        if (draft === null) return null;
        const parsed = parseWhenExpressionDraft(value);
        setDraft(
          when.target,
          parsed.ok
            ? { ...draft, whenDraft: parsed.value, isWhenDraftValid: true }
            : { ...draft, isWhenDraftValid: false },
        );
        patchUi({ when: { target: when.target, expressionDraft: value } });
        return null;
      },
      settingsKeybindingsWhenRootEdit: async (params) => {
        applyWhenEdit(RootEditParams(params));
        return null;
      },
      settingsKeybindingsWhenNodeEdit: async (params) => {
        const { path, edit } = NodeEditParams(params);
        const nodeEdit = toNodeEdit(edit);
        if (nodeEdit !== null) applyWhenEdit({ kind: "editNode", path, edit: nodeEdit });
        return null;
      },
      settingsKeybindingsWhenNodeRemove: async (params) => {
        const { path } = NodeRemoveParams(params);
        applyWhenEdit(path.length === 0 ? { kind: "clear" } : { kind: "removeNode", path });
        return null;
      },
    },
  };
}
