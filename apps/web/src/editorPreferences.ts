import { EditorId, type EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import {
  LAST_EDITOR_KEY,
  openInPreferredEditor,
  resolveEffectivePreferredEditor,
} from "./editorPreferences.logic";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";

export function usePreferredEditor(availableEditors: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage(LAST_EDITOR_KEY, null, EditorId);

  const effectiveEditor = useMemo(
    () => resolveEffectivePreferredEditor(lastEditor, availableEditors),
    [lastEditor, availableEditors],
  );

  return [effectiveEditor, setLastEditor] as const;
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });

  return useCallback(
    (targetPath: string) =>
      openInPreferredEditor({ environmentId, availableEditors, targetPath, openInEditor }),
    [availableEditors, environmentId, openInEditor],
  );
}
