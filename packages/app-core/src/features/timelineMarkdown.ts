import type { ContextMenuItem } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptRunFailedMessage } from "@t3tools/web/src/components/chatProjectScripts.logic.ts";
import {
  canUseMarkdownFileShellActions,
  hasMarkdownFilePrimaryAction,
} from "@t3tools/web/src/components/chatMarkdown.logic.ts";
import { showExternalLinkContextMenu } from "@t3tools/web/src/components/chat/externalLinkContextMenu.ts";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "@t3tools/web/src/components/preview/fileExplorerLabel.ts";
import { openInEditorMenuLabel } from "@t3tools/web/src/editorLabels.ts";
import {
  openInPreferredEditor,
  readLastEditor,
  resolveEffectivePreferredEditor,
} from "@t3tools/web/src/editorPreferences.logic.ts";
import { shouldOpenMarkdownFileLinkInEditor } from "@t3tools/web/src/markdown-links.ts";
import { resolveRemoteOpenResolution } from "@t3tools/web/src/remoteOpen.logic.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import * as Schema from "effect/Schema";

import { clipboardService } from "../clipboard.ts";
import { contextMenuService } from "../contextMenu.ts";
import type { CoreFeature, FeatureContext, ThreadInput } from "../feature.ts";
import { openExternal } from "../openExternal.ts";
import { runCommandInThreadTerminal } from "../terminalSessions.ts";

const Position = { x: Schema.Number, y: Schema.Number };

const FileParams = Schema.decodeUnknownSync(
  Schema.Struct({
    targetPath: Schema.String,
    displayPath: Schema.String,
    panelPath: Schema.NullOr(Schema.String),
    line: Schema.NullOr(Schema.Number),
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    ...Position,
  }),
);
const LinkParams = Schema.decodeUnknownSync(Schema.Struct({ href: Schema.String }));
const LinkMenuParams = Schema.decodeUnknownSync(
  Schema.Struct({ href: Schema.String, ...Position }),
);
const CommandParams = Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }));

type FileTarget = {
  readonly targetPath: string;
  readonly displayPath: string;
  readonly panelPath: string | null;
  readonly line: number | null;
};

type FileMenuAction = "open" | "reveal" | "copy-relative" | "copy-full";

/** File chips, links and code blocks in chat Markdown (ChatMarkdown's MarkdownFileLink,
    MarkdownAnchor and MarkdownCodeBlock). */
export function createTimelineMarkdownFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;

  const canUseShellActions = (input: ThreadInput | null) => {
    if (input === null) return false;
    const environmentId = input.thread.environmentId;
    const presentation =
      registry.get(state.environmentPresentations.presentationsAtom).get(environmentId) ?? null;
    const remote = resolveRemoteOpenResolution(presentation, true);
    return canUseMarkdownFileShellActions(environmentId, remote.state.mode, remote.isResolved);
  };

  const fileFailure = (title: string, error: unknown) =>
    context.addToast({
      layout: "stacked",
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    });

  const openInEditor = async (input: ThreadInput | null, targetPath: string) => {
    const result = await openInPreferredEditor({
      environmentId: input?.thread.environmentId ?? null,
      availableEditors: input?.serverConfig?.availableEditors ?? [],
      targetPath,
      openInEditor: (target) =>
        runAtomCommand(registry, state.shellEnvironment.openInEditor, target, {
          reportFailure: false,
        }),
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      fileFailure("Unable to open file", squashAtomCommandFailure(result));
    }
  };

  const reveal = async (input: ThreadInput, targetPath: string) => {
    const result = await runAtomCommand(
      registry,
      state.shellEnvironment.openInEditor,
      {
        environmentId: input.thread.environmentId,
        input: { cwd: targetPath, editor: "file-manager", reveal: true },
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      fileFailure("Unable to reveal file", squashAtomCommandFailure(result));
    }
  };

  const copy = (value: string, title: string) =>
    clipboardService(context)
      .writeText(value)
      .then(
        () => {
          context.addToast({
            layout: "plain",
            type: "success",
            title: `${title} copied`,
            description: value,
          });
        },
        (error: unknown) => {
          fileFailure(`Failed to copy ${title.toLowerCase()}`, error);
        },
      );

  const revealLabel = (input: ThreadInput) => {
    const config = input.serverConfig;
    if (
      config === null ||
      config === undefined ||
      config.shellRevealInFileManager !== true ||
      !config.availableEditors.includes("file-manager")
    ) {
      return undefined;
    }
    return config.shellRevealInFileManagerKind === undefined
      ? revealInFileExplorerLabelForOs(config.environment.platform.os)
      : revealInFileExplorerLabelForKind(config.shellRevealInFileManagerKind);
  };

  const showFileMenu = async (
    input: ThreadInput | null,
    file: FileTarget,
    position: { readonly x: number; readonly y: number },
  ) => {
    const shell = canUseShellActions(input);
    const availableEditors = input?.serverConfig?.availableEditors ?? [];
    const items: Array<ContextMenuItem<FileMenuAction>> = [];
    if (shell) {
      items.push({
        id: "open",
        label: openInEditorMenuLabel(
          resolveEffectivePreferredEditor(readLastEditor(), availableEditors),
        ),
      });
    }
    const revealMenuLabel = shell && input !== null ? revealLabel(input) : undefined;
    if (revealMenuLabel !== undefined) items.push({ id: "reveal", label: revealMenuLabel });
    items.push({ id: "copy-relative", label: "Copy relative path" });
    items.push({ id: "copy-full", label: "Copy full path" });
    const clicked = await contextMenuService(context).show(items, position);
    switch (clicked) {
      case "open":
        await openInEditor(input, file.targetPath);
        return;
      case "reveal":
        if (input !== null) await reveal(input, file.targetPath);
        return;
      case "copy-relative":
        await copy(file.displayPath, "Relative path");
        return;
      case "copy-full":
        await copy(file.targetPath, "Full path");
        return;
      case null:
        return;
    }
  };

  return {
    views: {},
    actions: {
      markdownFileClick: async (params) => {
        const { metaKey, ctrlKey, x, y, ...file } = FileParams(params);
        const input = registry.get(context.threadInputAtom);
        const shell = canUseShellActions(input);
        const canOpenInPanel = input !== null && file.panelPath !== null;
        if (
          !hasMarkdownFilePrimaryAction({
            canOpenInEditor: shell,
            canOpenInBrowser: false,
            canOpenInPanel,
          })
        ) {
          await showFileMenu(input, file, { x, y });
          return null;
        }
        if (shell && shouldOpenMarkdownFileLinkInEditor({ metaKey, ctrlKey }, context.platform)) {
          await openInEditor(input, file.targetPath);
          return null;
        }
        if (input !== null && file.panelPath !== null) {
          useRightPanelStore
            .getState()
            .openFile(input.route, file.panelPath, file.line ?? undefined);
          return null;
        }
        if (shell) await openInEditor(input, file.targetPath);
        return null;
      },
      markdownFileContextMenu: async (params) => {
        const { x, y, ...file } = FileParams(params);
        await showFileMenu(registry.get(context.threadInputAtom), file, { x, y });
        return null;
      },
      openMarkdownLink: async (params) => {
        const { href } = LinkParams(params);
        await openExternal(href);
        return null;
      },
      markdownLinkContextMenu: async (params) => {
        const { href, x, y } = LinkMenuParams(params);
        await showExternalLinkContextMenu({
          href,
          position: { x, y },
          canOpenInPreview: false,
          showContextMenu: (items, position) => contextMenuService(context).show(items, position),
          openInPreview: async () => undefined,
          openExternal: (target) => openExternal(target),
          copyLink: (target) => clipboardService(context).writeText(target),
          reportFailure: (operation, cause) => {
            console.error("[chat-markdown] action failed", { operation, target: href }, cause);
          },
        });
        return null;
      },
      runMarkdownShellCommand: async (params) => {
        const { command } = CommandParams(params);
        const input = registry.get(context.threadInputAtom);
        if (input === null || input.project === undefined) return null;
        await runCommandInThreadTerminal(context, {
          cwd: registry.get(context.gitStatusAtom)?.gitCwd ?? input.project.workspaceRoot,
          worktreePath: input.thread.worktreePath ?? null,
          command,
          failureMessage: projectScriptRunFailedMessage("Chat code block"),
        });
        return null;
      },
    },
  };
}
