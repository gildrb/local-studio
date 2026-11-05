/**
 * Right-click actions for a workspace file: reveal it in the environment's
 * file manager and open it in an editor. Reuse the chat file-chip menu's
 * machinery: reveal rides `shell.openInEditor` with `reveal: true`, which the
 * server only honors when its `shellRevealInFileManager` config flag is set,
 * so both actions work for every client and connection mode.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import {
  buildFileContextMenuItems,
  resolveFileContextMenuAbsolutePath,
  resolveFileContextMenuActivation,
  resolveFileContextMenuCapabilities,
  type FileContextMenuAction,
  type FileContextMenuTarget,
} from "./fileContextMenu.logic";
import { readLocalApi } from "./localApi";
import { serverEnvironment } from "./state/server";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { toastManager } from "./components/ui/toast";
import { useAtomValue } from "@effect/atom-react";

/**
 * Context-menu actions for files. The environment id is fixed per component
 * (a thread's environment, a file browser's environment), so capabilities
 * resolve once per hook call.
 */
/** Builds and dispatches the file context menu for one environment's files. */
export function useFileContextMenu(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));

  return useMemo(() => {
    const capabilities = resolveFileContextMenuCapabilities(environmentId, serverConfig);

    const activate = async (
      action: FileContextMenuAction,
      target: FileContextMenuTarget,
    ): Promise<void> => {
      const activation = resolveFileContextMenuActivation({
        action,
        target,
        capabilities,
        environmentId,
      });
      if (activation === null) return;

      const result = await openInEditor({
        environmentId: activation.environmentId,
        input: activation.input,
      });
      if (result._tag !== "Failure") return;
      toastManager.add({
        type: "error",
        title: activation.failureTitle,
        description: activation.failureDescription,
      });
    };

    const show = async (
      target: FileContextMenuTarget,
      position?: { x: number; y: number },
    ): Promise<void> => {
      const api = readLocalApi();
      const items = buildFileContextMenuItems({
        hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
        capabilities,
      });
      if (items.length === 0 || api === undefined) return;
      const clicked = await api.contextMenu.show(items, position);
      if (clicked === null) return;
      await activate(clicked, target);
    };

    return {
      buildItems: (target: FileContextMenuTarget) =>
        buildFileContextMenuItems({
          hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
          capabilities,
        }),
      capabilities,
      activate,
      show,
    };
  }, [environmentId, openInEditor, serverConfig]);
}

/** Convenience callback for onContextMenu handlers. */
/** Returns an onContextMenu callback that shows the menu at the pointer. */
export function useFileContextMenuHandler(environmentId: EnvironmentId | null) {
  const contextMenu = useFileContextMenu(environmentId);
  return useCallback(
    (target: FileContextMenuTarget, event?: { clientX: number; clientY: number }) => {
      void contextMenu.show(target, event ? { x: event.clientX, y: event.clientY } : undefined);
    },
    [contextMenu],
  );
}
