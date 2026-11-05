import {
  EDITORS,
  type ContextMenuItem,
  type EditorId,
  type EnvironmentId,
  type ServerConfig,
} from "@t3tools/contracts";

import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "./components/preview/fileExplorerLabel";
import { resolveDiffPathForWorkspace } from "./diffFileActions.logic";
import { resolvePathLinkTarget } from "./terminal-links";

export type FileContextMenuAction =
  | "reveal-in-folder"
  | "open"
  /** Submenu parent; never the activated id. */
  | "open-with"
  | `editor:${EditorId}`;

export interface FileContextMenuTarget {
  readonly environmentId: EnvironmentId | null;
  /** Repo- or workspace-relative file path, as shown in diffs. */
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot?: string | undefined;
}

/**
 * Absolute path on the environment host for a diff-style target, resolving
 * repo-relative paths through the workspace root like every other diff
 * surface. Returns null when the path cannot be resolved, which callers must
 * treat as "no file actions available".
 */
export function resolveFileContextMenuAbsolutePath(target: FileContextMenuTarget): string | null {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath: target.filePath,
    workspaceRoot: target.workspaceRoot,
    repositoryRoot: target.repositoryRoot,
  });
  if (workspaceFilePath === null) return null;
  if (target.workspaceRoot === undefined) {
    return workspaceFilePath.startsWith("/") || /^[a-zA-Z]:/.test(workspaceFilePath)
      ? workspaceFilePath
      : null;
  }
  return resolvePathLinkTarget(workspaceFilePath, target.workspaceRoot);
}

const EDITOR_LABEL_BY_ID = new Map(EDITORS.map((editor) => [editor.id, editor.label]));

export interface FileContextMenuCapabilities {
  readonly revealLabel: string | undefined;
  readonly canOpenDefault: boolean;
  readonly editorIds: ReadonlyArray<EditorId>;
}

/**
 * What the environment's config advertises for file actions. The reveal wording comes from the
 * server because on WSL the reveal can run through Windows File Explorer even though the host
 * reports Linux.
 */
export function resolveFileContextMenuCapabilities(
  environmentId: EnvironmentId | null,
  serverConfig: ServerConfig | null | undefined,
): FileContextMenuCapabilities {
  const availableEditors = serverConfig?.availableEditors ?? [];
  return {
    revealLabel:
      environmentId !== null &&
      serverConfig?.shellRevealInFileManager === true &&
      serverConfig.availableEditors.includes("file-manager")
        ? serverConfig.shellRevealInFileManagerKind === undefined
          ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os)
          : revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind)
        : undefined,
    canOpenDefault: availableEditors.includes("file-manager"),
    editorIds: availableEditors,
  };
}

/**
 * Menu items for a resolved file, offering only what the environment's config
 * advertises: default-app open, reveal (with server-provided wording), and an
 * "Open with" submenu of detected editors. Empty when nothing can act.
 */
export function buildFileContextMenuItems(input: {
  readonly hasAbsolutePath: boolean;
  readonly capabilities: FileContextMenuCapabilities;
}): readonly ContextMenuItem<FileContextMenuAction>[] {
  // Without a resolvable absolute path nothing here can act on the file.
  if (!input.hasAbsolutePath) return [];
  const items: ContextMenuItem<FileContextMenuAction>[] = [];
  if (input.capabilities.canOpenDefault) {
    items.push({ id: "open", label: "Open", icon: "pencil" });
  }
  if (input.capabilities.revealLabel !== undefined) {
    items.push({
      id: "reveal-in-folder",
      label: input.capabilities.revealLabel,
      icon: "folder-tree",
    });
  }
  const editorIds = input.capabilities.editorIds.filter((id) => id !== "file-manager");
  if (editorIds.length > 0) {
    items.push({
      id: "open-with",
      label: "Open with",
      children: editorIds.map((editorId): ContextMenuItem<FileContextMenuAction> => ({
        id: `editor:${editorId}`,
        label: EDITOR_LABEL_BY_ID.get(editorId) ?? editorId,
      })),
    });
  }
  return items;
}

export type FileContextMenuActivation = {
  readonly environmentId: EnvironmentId;
  readonly input: {
    readonly cwd: string;
    readonly editor: EditorId;
    readonly reveal?: true;
  };
  readonly failureTitle: string;
  readonly failureDescription: string;
};

function editorForAction(action: FileContextMenuAction): EditorId | null {
  if (action === "open" || action === "reveal-in-folder") return "file-manager";
  if (!action.startsWith("editor:")) return null;
  const editorId = action.slice("editor:".length);
  return EDITORS.find((editor) => editor.id === editorId)?.id ?? null;
}

/** The open-in-editor request a picked menu action makes, or null when it cannot act. */
export function resolveFileContextMenuActivation(input: {
  readonly action: FileContextMenuAction;
  readonly target: FileContextMenuTarget;
  readonly capabilities: FileContextMenuCapabilities;
  readonly environmentId: EnvironmentId | null;
}): FileContextMenuActivation | null {
  const absolutePath = resolveFileContextMenuAbsolutePath(input.target);
  if (absolutePath === null || input.environmentId === null) return null;
  const reveal = input.action === "reveal-in-folder";
  const editor = editorForAction(input.action);
  if (editor === null) return null;
  if (input.action !== "open" && !reveal && !input.capabilities.editorIds.includes(editor)) {
    return null;
  }
  return {
    environmentId: input.environmentId,
    input: { cwd: absolutePath, editor, ...(reveal ? { reveal: true } : {}) },
    failureTitle:
      input.action === "open"
        ? "Could not open file"
        : reveal
          ? "Unable to reveal file"
          : `Could not open in ${EDITOR_LABEL_BY_ID.get(editor) ?? editor}`,
    failureDescription: absolutePath,
  };
}
