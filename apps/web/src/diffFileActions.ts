import type { ScopedThreadRef } from "@t3tools/contracts";

import { resolveDiffFilePrimaryAction } from "./diffFileActions.logic";
import { useRightPanelStore } from "./rightPanelStore";

interface OpenDiffFilePrimaryActionInput {
  readonly threadRef: ScopedThreadRef | null;
  readonly filePath: string;
  readonly activeCwd: string | undefined;
  readonly repositoryRoot?: string | undefined;
  readonly openInEditor: (targetPath: string) => void;
}

export function openDiffFilePrimaryAction({
  threadRef,
  filePath,
  activeCwd,
  repositoryRoot,
  openInEditor,
}: OpenDiffFilePrimaryActionInput): void {
  const action = resolveDiffFilePrimaryAction({ threadRef, filePath, activeCwd, repositoryRoot });
  switch (action.kind) {
    case "none":
      return;
    case "open-in-files-panel":
      useRightPanelStore.getState().openFile(action.threadRef, action.filePath);
      return;
    case "open-in-editor":
      openInEditor(action.targetPath);
      return;
  }
}
