import { EDITORS, EditorId, EnvironmentId } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";

import { getLocalStorageItem, setLocalStorageItem } from "./lib/localStorageItem";

export const LAST_EDITOR_KEY = "t3code:last-editor";

export class PreferredEditorEnvironmentRequiredError extends Schema.TaggedError<PreferredEditorEnvironmentRequiredError>()(
  "PreferredEditorEnvironmentRequiredError",
  {
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot open ${this.targetPath} because no environment is selected.`;
  }
}

export class PreferredEditorUnavailableError extends Schema.TaggedError<PreferredEditorUnavailableError>()(
  "PreferredEditorUnavailableError",
  {
    environmentId: EnvironmentId,
    targetPath: Schema.String,
    availableEditorIds: Schema.Array(EditorId),
  },
) {
  override get message(): string {
    return `No available editor can open ${this.targetPath} in environment ${this.environmentId}.`;
  }
}

export function resolveEffectivePreferredEditor(
  lastEditor: EditorId | null,
  availableEditors: ReadonlyArray<EditorId>,
): EditorId | null {
  if (lastEditor && availableEditors.includes(lastEditor)) return lastEditor;
  return EDITORS.find((editor) => availableEditors.includes(editor.id))?.id ?? null;
}

export function readLastEditor(): EditorId | null {
  return getLocalStorageItem(LAST_EDITOR_KEY, EditorId);
}

export function writeLastEditor(editor: EditorId): void {
  setLocalStorageItem(LAST_EDITOR_KEY, editor, EditorId);
}

export function resolveAndPersistPreferredEditor(
  availableEditors: ReadonlyArray<EditorId>,
): EditorId | null {
  const stored = readLastEditor();
  if (stored && availableEditors.includes(stored)) return stored;
  const editor = resolveEffectivePreferredEditor(null, availableEditors);
  if (editor) writeLastEditor(editor);
  return editor;
}

export interface OpenInEditorTarget {
  readonly environmentId: EnvironmentId;
  readonly input: { readonly cwd: string; readonly editor: EditorId };
}

export async function openInPreferredEditor<E>(input: {
  readonly environmentId: EnvironmentId | null;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly targetPath: string;
  readonly openInEditor: (target: OpenInEditorTarget) => Promise<AtomCommandResult<unknown, E>>;
}): Promise<
  AtomCommandResult<
    EditorId,
    E | PreferredEditorEnvironmentRequiredError | PreferredEditorUnavailableError
  >
> {
  const { environmentId, availableEditors, targetPath } = input;
  if (environmentId === null) {
    return AsyncResult.failure(
      Cause.fail(new PreferredEditorEnvironmentRequiredError({ targetPath })),
    );
  }
  const editor = resolveAndPersistPreferredEditor(availableEditors);
  if (!editor) {
    return AsyncResult.failure(
      Cause.fail(
        new PreferredEditorUnavailableError({
          environmentId,
          targetPath,
          availableEditorIds: availableEditors,
        }),
      ),
    );
  }
  const result = await input.openInEditor({
    environmentId,
    input: {
      cwd: targetPath,
      editor,
    },
  });
  return mapAtomCommandResult(result, () => editor);
}
