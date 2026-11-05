import { remarkCodexDirectives } from "@t3tools/client-runtime/codex-markdown-directives";
import { parseMarkdownTree } from "@t3tools/client-runtime/markdown-parse";
import type { Root, RootContent } from "mdast";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";

import { remarkGithubAlerts } from "../markdown-github-alerts";
import { remarkNormalizeListItemIndentation } from "../markdown-list-indentation";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  normalizeMarkdownLinkDestination,
  rewriteMarkdownFileUriHref,
  shouldOpenMarkdownFileLinkInBrowserByDefault,
  type MarkdownFileLinkMeta,
} from "../markdown-links";
import type { RemoteOpenMode } from "../remoteOpen.logic";
import { isAbsolutePath } from "../terminal-links";

export function canUseMarkdownFileShellActions(
  environmentId: EnvironmentId | null,
  remoteOpenMode: RemoteOpenMode,
  isRemoteOpenResolved: boolean,
): boolean {
  return environmentId !== null && isRemoteOpenResolved && remoteOpenMode === "local-exec";
}

export function hasMarkdownFilePrimaryAction(input: {
  canOpenInEditor: boolean;
  canOpenInBrowser: boolean;
  canOpenInPanel: boolean;
  canOpenMedia?: boolean;
}): boolean {
  return (
    input.canOpenInEditor ||
    input.canOpenInBrowser ||
    input.canOpenInPanel ||
    input.canOpenMedia === true
  );
}

export function shouldUseMarkdownFileBrowserPrimaryAction(input: {
  iconPath: string;
  canOpenInEditor: boolean;
  canOpenInBrowser: boolean;
  canOpenInPanel: boolean;
}): boolean {
  return (
    input.canOpenInBrowser &&
    (shouldOpenMarkdownFileLinkInBrowserByDefault(input.iconPath) ||
      (!input.canOpenInEditor && !input.canOpenInPanel))
  );
}

/** Sites whose brand mark (drawn in `currentColor`) replaces the fetched favicon so it follows the theme. */
export function markdownLinkBrandIcon(host: string): "github" | null {
  const hostname = host.toLowerCase();
  return hostname === "github.com" || hostname.endsWith(".github.com") ? "github" : null;
}

/** The visible text a link keeps on the favicon's line: its protocol, or else its first character. */
export function leadingExternalLinkTextLength(text: string): number {
  const protocol = /^(?:https?:\/\/)/i.exec(text)?.[0];
  if (protocol) return protocol.length;
  return Math.min(text.length, 1);
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
export const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;

export function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  return raw === "gitignore" ? "ini" : raw;
}

const FENCE_TITLE_ATTR_REGEX = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i;
const FENCE_FILENAME_TOKEN_REGEX = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/;

/** Pulls a filename out of fence meta: ```ts title="x.ts" / ```ts src/main.ts */
export function extractFenceTitle(meta: string | undefined): string | null {
  if (!meta) return null;
  const attrMatch = FENCE_TITLE_ATTR_REGEX.exec(meta);
  const attrTitle = attrMatch?.[1] ?? attrMatch?.[2] ?? attrMatch?.[3];
  if (attrTitle) return attrTitle;
  return meta.split(/\s+/).find((candidate) => FENCE_FILENAME_TOKEN_REGEX.test(candidate)) ?? null;
}

const SHELL_FENCE_LANGUAGE_REGEX = /^(?:sh|bash|zsh|fish|shell|powershell|pwsh)$/;

/** A finished shell fence that can run as-is. Control and invisible format characters (bidi
    overrides, zero-width) can make the rendered command differ from what the terminal would
    receive. */
export function canRunMarkdownShellCommand(
  code: string,
  language: string,
  isStreaming: boolean,
): boolean {
  const command = code.trim();
  return (
    !isStreaming &&
    SHELL_FENCE_LANGUAGE_REGEX.test(language) &&
    code.endsWith("\n") &&
    command.length > 0 &&
    !command.endsWith("\\") &&
    !/[\p{Cc}\p{Cf}]/u.test(code.slice(0, -1))
  );
}

type MarkdownAstNode = {
  type?: string;
  meta?: unknown;
  url?: string;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
};

function remarkPreserveCodeMeta() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      if (node.type === "code" && typeof node.meta === "string" && node.meta.trim().length > 0) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataCodeMeta: node.meta.trim(),
          },
        };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

/**
 * Preserve Windows drive links as allowed `file:` URLs before sanitization.
 * The same traversal tags inline code while it can still be distinguished
 * from fenced code. Code inside links stays untagged to avoid nested anchors.
 */
function remarkNormalizeLinksAndTagInlineCode() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode, insideLink: boolean) => {
      if (
        (node.type === "link" || node.type === "definition") &&
        typeof node.url === "string" &&
        WINDOWS_DRIVE_PATH_REGEX.test(node.url)
      ) {
        node.url = `file:///${node.url.replaceAll("\\", "/")}`;
      }
      if (node.type === "inlineCode" && !insideLink) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataInlineCode: "",
          },
        };
      }
      const childInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
      node.children?.forEach((child) => visit(child, childInsideLink));
    };

    visit(tree, false);
  };
}

export const CHAT_MARKDOWN_REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkGithubAlerts,
  remarkNormalizeListItemIndentation,
  remarkCodexDirectives,
  remarkPreserveCodeMeta,
  remarkNormalizeLinksAndTagInlineCode,
];

export const CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS: PluggableList = [
  remarkGfm,
  remarkGithubAlerts,
  remarkNormalizeListItemIndentation,
  remarkCodexDirectives,
  remarkBreaks,
  remarkPreserveCodeMeta,
  remarkNormalizeLinksAndTagInlineCode,
];

export type ChatMarkdownRoot = Root;
export type ChatMarkdownNode = RootContent;

/** The tree ChatMarkdown renders, for renderers that cannot host react-markdown. */
export function parseChatMarkdown(
  text: string,
  lineBreaks: boolean,
  extraPlugins: PluggableList = [],
): ChatMarkdownRoot {
  return parseMarkdownTree(text, [
    ...(lineBreaks ? CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS : CHAT_MARKDOWN_REMARK_PLUGINS),
    ...extraPlugins,
  ]);
}

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

export function buildFileLinkParentSuffixByPath(
  filePaths: ReadonlyArray<string>,
): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const normalizedPath = filePath.replaceAll("\\", "/");
    const pathSegments = normalizedPath.split("/").filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(normalizedPath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

const FENCED_CODE_SEGMENT_PATTERN = /(```[\s\S]*?(?:```|$))/;
const INLINE_CODE_SPAN_PATTERN = /`([^`\n]+)`/g;

export function extractInlineCodeSpans(text: string): string[] {
  const spans: string[] = [];
  const segments = text.split(FENCED_CODE_SEGMENT_PATTERN);
  for (let index = 0; index < segments.length; index += 2) {
    for (const match of (segments[index] ?? "").matchAll(INLINE_CODE_SPAN_PATTERN)) {
      const span = match[1]?.trim();
      if (span) spans.push(span);
    }
  }
  return spans;
}

export function normalizeMarkdownLinkHrefKey(href: string): string {
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  const rewrittenHref = rewriteMarkdownFileUriHref(normalizedHref) ?? normalizedHref;
  return WINDOWS_DRIVE_PATH_REGEX.test(rewrittenHref)
    ? rewrittenHref.replaceAll("\\", "/")
    : rewrittenHref;
}

export function markdownFileLinkLabel(
  fileLinkMeta: MarkdownFileLinkMeta,
  parentSuffixByPath: ReadonlyMap<string, string>,
): string {
  const parentSuffix = parentSuffixByPath.get(fileLinkMeta.filePath.replaceAll("\\", "/"));
  const labelParts = [fileLinkMeta.basename];
  if (typeof parentSuffix === "string" && parentSuffix.length > 0) {
    labelParts.push(parentSuffix);
  }
  if (fileLinkMeta.line) {
    labelParts.push(
      `L${fileLinkMeta.line}${fileLinkMeta.column ? `:C${fileLinkMeta.column}` : ""}`,
    );
  }
  return labelParts.join(" · ");
}

export function markdownFileLinkCanPreviewMedia(fileLinkMeta: MarkdownFileLinkMeta): boolean {
  return (
    mediaMimeTypeFromExtension(
      fileLinkMeta.basename.slice(fileLinkMeta.basename.lastIndexOf(".")),
    ) !== null
  );
}

/** What the files panel opens: workspace-relative inside the workspace, the absolute host
    path outside it, null when the panel cannot show the file. */
export function markdownFileLinkPanelPath(fileLinkMeta: MarkdownFileLinkMeta): string | null {
  // Media outside the workspace keeps the expanded preview; other host
  // files (a report in a temp dir) open read-only in the files panel.
  return (
    fileLinkMeta.workspaceRelativePath ??
    (!markdownFileLinkCanPreviewMedia(fileLinkMeta) && isAbsolutePath(fileLinkMeta.filePath)
      ? fileLinkMeta.filePath
      : null)
  );
}
