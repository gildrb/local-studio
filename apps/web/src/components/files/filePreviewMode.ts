import { workspaceRelativeFilePath } from "@t3tools/client-runtime/markdown-links";
import {
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";
import { isAbsolutePath } from "~/terminal-links";

/** Resolve workspace links before choosing between the explorer and a file preview. */
export function resolveFilePreviewPath(path: string | null, cwd: string): string | null {
  if (path === null) return null;
  return path === "." || workspaceRelativeFilePath(path, cwd) === "." ? null : path;
}

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export function shouldShowFileExplorer(input: {
  readonly relativePath: string | null;
  readonly explorerOpen: boolean;
  readonly attachmentOpen: boolean;
}): boolean {
  if (input.attachmentOpen || (input.relativePath && isAbsolutePath(input.relativePath))) {
    return false;
  }
  return input.explorerOpen || input.relativePath === null;
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}

export const isPdfPreviewFile = (path: string): boolean =>
  /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export const isBrowserPreviewFile = (path: string): boolean =>
  /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export type FilePreviewRenderedMode = "markdown" | "table" | "html";

export type FilePreviewBody =
  | { readonly kind: "none" }
  | { readonly kind: "attachment" }
  | { readonly kind: "video" }
  | { readonly kind: "audio" }
  | { readonly kind: "image" }
  | { readonly kind: "browser" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "loading" }
  | { readonly kind: "markdown"; readonly readOnly: boolean }
  | { readonly kind: "table"; readonly delimiter: "," | "\t" }
  | { readonly kind: "source" }
  | { readonly kind: "editor" };

export type FilePreviewModelInput = {
  readonly requestedPath: string | null;
  readonly cwd: string;
  readonly attachmentOpen: boolean;
  readonly explorerOpen: boolean;
  readonly renderMarkdownPreferred: boolean;
  readonly renderBrowserFilePreferred: boolean;
  readonly renderTablePreferred: boolean;
  readonly revealLine: number | null;
  readonly revealRequestId: number;
  readonly handledReveal: { readonly path: string; readonly requestId: number } | null;
  readonly file: {
    readonly data: { readonly truncated: boolean; readonly byteLength: number } | null;
    readonly error: string | null;
    readonly isNotFile: boolean;
  };
  readonly previewSupported: boolean;
  readonly tableDelimiter: "," | "\t" | null;
};

export type FilePreviewModel = {
  readonly relativePath: string | null;
  readonly previewPath: string | null;
  readonly isDirectory: boolean;
  readonly isHostFile: boolean;
  readonly isMedia: boolean;
  readonly isPdf: boolean;
  readonly isMarkdown: boolean;
  readonly readsFile: boolean;
  readonly refreshesOnMutation: boolean;
  readonly showExplorer: boolean;
  readonly renderedMode: FilePreviewRenderedMode | null;
  readonly rendered: boolean;
  readonly canToggleRendered: boolean;
  readonly renderedToggleLabel: string | null;
  readonly renderedToggleIcon: "code" | "table" | "eye" | null;
  readonly showsRawText: boolean;
  readonly canOpenInBrowser: boolean;
  readonly canToggleExplorer: boolean;
  readonly explorerToggleLabel: string;
  readonly truncatedNotice: string | null;
  readonly body: FilePreviewBody;
};

export function renderedToggleLabel(mode: FilePreviewRenderedMode, rendered: boolean): string {
  if (mode === "markdown") return rendered ? "Show markdown source" : "Show rendered markdown";
  if (mode === "table") return rendered ? "Show source" : "Show table";
  return rendered ? "Show HTML source" : "Show rendered page";
}

export function buildFilePreviewModel(input: FilePreviewModelInput): FilePreviewModel {
  const relativePath = input.attachmentOpen
    ? input.requestedPath
    : resolveFilePreviewPath(input.requestedPath, input.cwd);
  const isVideo = relativePath !== null && isWorkspaceVideoPreviewPath(relativePath);
  const isAudio = relativePath !== null && !isVideo && isWorkspaceAudioPreviewPath(relativePath);
  const isImage = relativePath !== null && !isVideo && isWorkspaceImagePreviewPath(relativePath);
  const isMedia = isImage || isVideo || isAudio;
  const isPdf = relativePath !== null && isPdfPreviewFile(relativePath);
  const isHtml = relativePath !== null && !isPdf && isBrowserPreviewFile(relativePath);
  const isHostFile =
    input.attachmentOpen || (relativePath !== null && isAbsolutePath(relativePath));
  const isDirectory = input.file.isNotFile && !isHostFile;
  const previewPath = isDirectory ? null : relativePath;
  const showExplorer = shouldShowFileExplorer({
    relativePath: previewPath,
    explorerOpen: input.explorerOpen,
    attachmentOpen: input.attachmentOpen,
  });
  const isMarkdown = previewPath ? isMarkdownPreviewFile(previewPath) : false;
  const tableDelimiter = previewPath && !input.attachmentOpen ? input.tableDelimiter : null;
  const revealHandled =
    input.revealLine === null ||
    (input.handledReveal?.path === relativePath &&
      input.handledReveal.requestId === input.revealRequestId);
  const renderMarkdown = isMarkdown && input.renderMarkdownPreferred && revealHandled;
  const renderBrowserFile = isPdf || (isHtml && input.renderBrowserFilePreferred && revealHandled);
  const renderTable = tableDelimiter !== null && input.renderTablePreferred && revealHandled;
  const renderedMode: FilePreviewRenderedMode | null = isMarkdown
    ? "markdown"
    : tableDelimiter
      ? "table"
      : isHtml
        ? "html"
        : null;
  const canToggleRendered = previewPath !== null && !input.attachmentOpen && renderedMode !== null;
  const showsRawText =
    previewPath !== null &&
    input.file.data !== null &&
    !(isMarkdown && renderMarkdown) &&
    !(tableDelimiter && renderTable) &&
    !renderBrowserFile;
  const rendered = isMarkdown ? renderMarkdown : tableDelimiter ? renderTable : renderBrowserFile;
  const canOpenInBrowser =
    previewPath !== null &&
    !input.attachmentOpen &&
    !isVideo &&
    input.previewSupported &&
    isBrowserPreviewFile(previewPath);
  const data = input.file.data;
  const body: FilePreviewBody = isDirectory
    ? { kind: "none" }
    : relativePath && input.attachmentOpen
      ? { kind: "attachment" }
      : relativePath && isVideo
        ? { kind: "video" }
        : relativePath && isAudio
          ? { kind: "audio" }
          : relativePath && isImage
            ? { kind: "image" }
            : relativePath && renderBrowserFile
              ? { kind: "browser" }
              : relativePath && input.file.error && data === null
                ? { kind: "error", message: input.file.error }
                : relativePath && data === null
                  ? { kind: "loading" }
                  : relativePath && data
                    ? isMarkdown && renderMarkdown
                      ? { kind: "markdown", readOnly: isHostFile }
                      : tableDelimiter && renderTable
                        ? { kind: "table", delimiter: tableDelimiter }
                        : data.truncated || isHostFile
                          ? { kind: "source" }
                          : { kind: "editor" }
                    : { kind: "none" };
  return {
    relativePath,
    previewPath,
    isDirectory,
    isHostFile,
    isMedia,
    isPdf,
    isMarkdown,
    readsFile: !input.attachmentOpen && relativePath !== null,
    refreshesOnMutation:
      !input.attachmentOpen && relativePath !== null && (isDirectory || (!isMedia && !isPdf)),
    showExplorer,
    renderedMode,
    rendered,
    canToggleRendered,
    renderedToggleLabel:
      canToggleRendered && renderedMode ? renderedToggleLabel(renderedMode, rendered) : null,
    renderedToggleIcon: !canToggleRendered
      ? null
      : rendered
        ? "code"
        : renderedMode === "table"
          ? "table"
          : "eye",
    showsRawText,
    canOpenInBrowser,
    canToggleExplorer: !isHostFile && previewPath !== null,
    explorerToggleLabel: input.explorerOpen ? "Hide file explorer" : "Show file explorer",
    truncatedNotice:
      previewPath && !input.attachmentOpen && !isMedia && !renderBrowserFile && data?.truncated
        ? `Preview limited to the first 1 MB of a ${data.byteLength.toLocaleString()} byte file.`
        : null,
    body,
  };
}
