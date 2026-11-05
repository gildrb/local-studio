import { inlineCodeFilePathCandidate } from "@t3tools/client-runtime/markdown-links";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import { mediaKindFromPath } from "@t3tools/shared/filePreview";
import { resolveProtocolRelativeMediaUrl } from "@t3tools/web/src/components/media/mediaContent.ts";
import { normalizeMarkdownLinkDestination } from "@t3tools/web/src/markdown-links.ts";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import {
  formatComposerContextReference,
  parseComposerContextHref,
} from "@t3tools/shared/composerContextReferences";
import { faviconUrlForOrigin } from "@t3tools/shared/favicon";
import { citationChipView } from "./contextChips.ts";
import {
  buildFileLinkParentSuffixByPath,
  canRunMarkdownShellCommand,
  extractFenceLanguage,
  extractFenceTitle,
  markdownFileLinkLabel,
  markdownFileLinkPanelPath,
  markdownLinkBrandIcon,
  normalizeMarkdownLinkHrefKey,
  parseChatMarkdown,
  type ChatMarkdownNode,
} from "@t3tools/web/src/components/chatMarkdown.logic.ts";
import { resolveExternalWebLinkHost } from "@t3tools/web/src/components/chat/externalLinkContextMenu.ts";
import { markdownGalleryEntry } from "@t3tools/web/src/components/chat/markdownImageGallery.logic.ts";
import {
  resolveInlineCodeFileLinkMeta,
  resolveMarkdownFileLinkMeta,
  type MarkdownFileLinkMeta,
} from "@t3tools/web/src/markdown-links.ts";
import { remarkPullRequestAutolinks } from "@t3tools/web/src/components/pullRequest/pullRequestMarkdown.logic.ts";
import {
  hasSpecificPierreIconForFileName,
  syntheticFileNameForLanguageId,
} from "@t3tools/web/src/pierre-icons.ts";

import { resolvePierreFileIcon } from "./pierreIcon.ts";
import { highlightLinesSync, type SyntaxLine } from "./syntaxHighlight.ts";
import type {
  MarkdownBlockView,
  MarkdownDocView,
  MarkdownInlineView,
  MarkdownListItemView,
} from "./views/markdown.ts";

export type MarkdownDocumentOptions = {
  readonly cwd: string | undefined;
  readonly lineBreaks: boolean;
  readonly streaming: boolean;
  readonly wordWrap: boolean;
  readonly canRunShellCommands: boolean;
  readonly repositoryUrl?: string | null;
};

type InlineStyle = {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  readonly href: string | null;
};

const PLAIN_STYLE: InlineStyle = { bold: false, italic: false, strike: false, href: null };

type FileChipSource = { readonly meta: MarkdownFileLinkMeta };

type BuildContext = {
  readonly cwd: string | undefined;
  readonly streaming: boolean;
  readonly canRunShellCommands: boolean;
  readonly chips: Array<FileChipSource & { readonly view: { label: string } }>;
  highlighted: boolean;
};

function plainText(node: ChatMarkdownNode): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map((child: ChatMarkdownNode) => plainText(child)).join("");
  }
  return "";
}

function fileChip(
  context: BuildContext,
  meta: MarkdownFileLinkMeta,
  copyMarkdown: string,
): Extract<MarkdownInlineView, { kind: "file-chip" }> {
  const view: { kind: "file-chip"; label: string } & Omit<
    Extract<MarkdownInlineView, { kind: "file-chip" }>,
    "kind" | "label"
  > = {
    kind: "file-chip",
    label: meta.basename,
    icon: resolvePierreFileIcon(meta.filePath),
    targetPath: meta.targetPath,
    displayPath: meta.displayPath,
    panelPath: markdownFileLinkPanelPath(meta),
    line: meta.line ?? null,
    copyMarkdown,
  };
  context.chips.push({ meta, view });
  return view;
}

function textRun(text: string, style: InlineStyle, code: boolean): MarkdownInlineView {
  return { kind: "text", text, ...style, code };
}

function inlineText(cell: ReadonlyArray<MarkdownInlineView>): string {
  return cell
    .map((inline) => {
      switch (inline.kind) {
        case "text":
          return inline.text;
        case "file-chip":
        case "context-reference":
          return inline.label;
        case "context-chip":
          return inline.chip.label;
        default:
          return "";
      }
    })
    .join("");
}

function inlineMarkdown(inline: MarkdownInlineView): string {
  switch (inline.kind) {
    case "text": {
      let text = inline.code ? `\`${inline.text}\`` : inline.text;
      if (inline.strike) text = `~~${text}~~`;
      if (inline.italic) text = `*${text}*`;
      if (inline.bold) text = `**${text}**`;
      return inline.href === null ? text : `[${text}](${inline.href})`;
    }
    case "file-chip":
      return inline.copyMarkdown;
    case "break":
      return " ";
    case "favicon":
      return "";
    case "image":
      return `![${inline.alt}](${inline.url ?? inline.path ?? ""})`;
    case "context-reference":
      return inline.label;
    case "context-chip":
      return inline.chip.copyMarkdown;
  }
}

function tableMarkdown(
  align: ReadonlyArray<"left" | "center" | "right" | null>,
  rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<MarkdownInlineView>>>,
): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.length === 0) continue;
    const cells = row.map((cell) =>
      cell.map(inlineMarkdown).join("").replace(/\n+/g, " ").trim().replaceAll("|", "\\|"),
    );
    lines.push(`| ${cells.join(" | ")} |`);
    if (lines.length === 1) {
      const markers = row.map((_, index) =>
        align[index] === "center" ? ":---:" : align[index] === "right" ? "---:" : "---",
      );
      lines.push(`| ${markers.join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

function csvCell(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

function inlines(
  nodes: ReadonlyArray<ChatMarkdownNode>,
  style: InlineStyle,
  context: BuildContext,
): MarkdownInlineView[] {
  return nodes.flatMap((node) => inline(node, style, context));
}

function inline(
  node: ChatMarkdownNode,
  style: InlineStyle,
  context: BuildContext,
): MarkdownInlineView[] {
  switch (node.type) {
    case "text":
      return [textRun(node.value, style, false)];
    case "strong":
      return inlines(node.children, { ...style, bold: true }, context);
    case "emphasis":
      return inlines(node.children, { ...style, italic: true }, context);
    case "delete":
      return inlines(node.children, { ...style, strike: true }, context);
    case "break":
      return [{ kind: "break" }];
    case "inlineCode": {
      if (style.href === null) {
        const meta = resolveInlineCodeFileLinkMeta(node.value, context.cwd);
        if (meta && inlineCodeFilePathCandidate(node.value) !== null) {
          return [fileChip(context, meta, `\`${node.value}\``)];
        }
      }
      return [textRun(node.value, style, true)];
    }
    case "link": {
      const href = node.url;
      const citation = href ? parseAssistantCitationHref(href) : null;
      if (citation) return [{ kind: "context-chip", chip: citationChipView(citation) }];
      const contextReference = href ? parseComposerContextHref(href) : null;
      if (contextReference) {
        const label = plainText(node) || contextReference.contextId;
        return [
          {
            kind: "context-reference",
            contextKind: contextReference.kind,
            contextId: contextReference.contextId,
            label,
            copyMarkdown: formatComposerContextReference({ ...contextReference, label }),
          },
        ];
      }
      const normalizedHref = href ? normalizeMarkdownLinkHrefKey(href) : "";
      const meta = normalizedHref ? resolveMarkdownFileLinkMeta(normalizedHref, context.cwd) : null;
      if (meta) return [fileChip(context, meta, `[${meta.basename}](${normalizedHref})`)];
      const host = resolveExternalWebLinkHost(href);
      const children = inlines(node.children, { ...style, href }, context);
      if (host === null || plainText(node).length === 0) return children;
      const brand = markdownLinkBrandIcon(host);
      return [
        {
          kind: "favicon",
          host,
          brand,
          url: brand === null ? faviconUrlForOrigin(`https://${host}`) : null,
        },
        ...children,
      ];
    }
    case "image": {
      const src = normalizeMarkdownLinkDestination(node.url);
      const alt = node.alt ?? "";
      const contextReference = parseComposerContextHref(src);
      if (contextReference) {
        const label = alt || contextReference.contextId;
        return [
          {
            kind: "context-reference",
            contextKind: contextReference.kind,
            contextId: contextReference.contextId,
            label,
            copyMarkdown: formatComposerContextReference({ ...contextReference, label }),
          },
        ];
      }
      const source = classifyMarkdownImageSource(src, context.cwd);
      const media = mediaKindFromPath(src) === "video" ? "video" : "image";
      const entry = markdownGalleryEntry(style.href);
      const gallery =
        media === "image" && entry.included ? { linkedUrl: entry.linkedSource } : null;
      switch (source._tag) {
        case "Direct":
          return [
            {
              kind: "image",
              alt,
              media,
              source: "direct",
              path: null,
              url: resolveProtocolRelativeMediaUrl(source.uri),
              href: style.href,
              originalUrl: resolveExternalWebLinkHost(source.uri) !== null ? source.uri : null,
              gallery,
            },
          ];
        case "WorkspaceFile":
          return [
            {
              kind: "image",
              alt,
              media,
              source: "workspace",
              path: source.path,
              url: null,
              href: style.href,
              originalUrl: null,
              gallery,
            },
          ];
        case "Blocked":
          return [
            {
              kind: "image",
              alt,
              media,
              source: "blocked",
              path: null,
              url: null,
              href: style.href,
              originalUrl: null,
              gallery: null,
            },
          ];
      }
    }
    case "html":
      return [textRun(node.value, style, false)];
    default:
      if ("children" in node && Array.isArray(node.children)) {
        return inlines(node.children, style, context);
      }
      if ("value" in node && typeof node.value === "string") {
        return [textRun(node.value, style, false)];
      }
      return [];
  }
}

function codeBlock(
  lang: string | null | undefined,
  meta: string | null | undefined,
  value: string,
  context: BuildContext,
): MarkdownBlockView {
  const language = extractFenceLanguage(lang ? `language-${lang}` : undefined);
  const title = extractFenceTitle(meta ?? undefined);
  const code = value ? `${value}\n` : "";
  const sourceLines = value.split("\n");
  const highlighted = highlightLinesSync(sourceLines, language);
  if (highlighted === null) context.highlighted = false;
  const lines: ReadonlyArray<SyntaxLine> =
    highlighted ?? sourceLines.map((text) => [{ text, dark: null, light: null }]);
  const fileName = syntheticFileNameForLanguageId(language);
  const icon = title
    ? resolvePierreFileIcon(title)
    : hasSpecificPierreIconForFileName(fileName)
      ? resolvePierreFileIcon(fileName)
      : null;
  const canRun =
    context.canRunShellCommands && canRunMarkdownShellCommand(code, language, context.streaming);
  return {
    kind: "code",
    language,
    title,
    icon,
    code,
    canRun,
    lines,
    highlighted: highlighted !== null,
  };
}

function blocks(
  nodes: ReadonlyArray<ChatMarkdownNode>,
  context: BuildContext,
  listDepth: number,
): MarkdownBlockView[] {
  return nodes.flatMap((node) => block(node, context, listDepth));
}

function block(
  node: ChatMarkdownNode,
  context: BuildContext,
  listDepth: number,
): MarkdownBlockView[] {
  switch (node.type) {
    case "paragraph":
      return [{ kind: "paragraph", inlines: inlines(node.children, PLAIN_STYLE, context) }];
    case "heading":
      return [
        {
          kind: "heading",
          depth: node.depth,
          inlines: inlines(node.children, PLAIN_STYLE, context),
        },
      ];
    case "list": {
      const items: MarkdownListItemView[] = node.children.map((item) => ({
        checked: item.checked ?? null,
        blocks: blocks(item.children, context, listDepth + 1),
      }));
      return [
        {
          kind: "list",
          ordered: node.ordered === true,
          start: node.start ?? 1,
          spread: node.spread === true || node.children.some((item) => item.spread === true),
          depth: listDepth,
          items,
        },
      ];
    }
    case "blockquote": {
      const alert = node.data?.hProperties?.["dataAlert"];
      return [
        {
          kind: "blockquote",
          alert: typeof alert === "string" ? alert : null,
          blocks: blocks(node.children, context, listDepth),
        },
      ];
    }
    case "code":
      return [codeBlock(node.lang, node.meta, node.value, context)];
    case "table": {
      const [head, ...body] = node.children;
      const cells = (row: typeof head) =>
        row === undefined
          ? []
          : row.children.map((cell) => inlines(cell.children, PLAIN_STYLE, context));
      const align = node.align ?? [];
      const header = cells(head);
      const rows = body.map((row) => cells(row));
      return [
        {
          kind: "table",
          align,
          header,
          rows,
          copyMarkdown: tableMarkdown(align, [header, ...rows]),
          copyCsv: [header, ...rows]
            .filter((row) => row.length > 0)
            .map((row) => row.map((cell) => csvCell(inlineText(cell))).join(","))
            .join("\n"),
        },
      ];
    }
    case "thematicBreak":
      return [{ kind: "rule" }];
    case "html":
      return [{ kind: "paragraph", inlines: [textRun(node.value, PLAIN_STYLE, false)] }];
    case "definition":
    case "footnoteDefinition":
    case "yaml":
      return [];
    default:
      if ("children" in node && Array.isArray(node.children)) {
        const children: ReadonlyArray<ChatMarkdownNode> = node.children;
        const isPhrasing = children.every(
          (child) => child.type === "text" || child.type === "inlineCode",
        );
        return isPhrasing
          ? [{ kind: "paragraph", inlines: inlines(children, PLAIN_STYLE, context) }]
          : blocks(children, context, listDepth);
      }
      return [];
  }
}

function buildUncached(text: string, options: MarkdownDocumentOptions) {
  const context: BuildContext = {
    cwd: options.cwd,
    streaming: options.streaming,
    canRunShellCommands: options.canRunShellCommands,
    chips: [],
    highlighted: true,
  };
  const root = parseChatMarkdown(
    text,
    options.lineBreaks,
    options.repositoryUrl
      ? [[remarkPullRequestAutolinks, { repositoryUrl: options.repositoryUrl }]]
      : [],
  );
  const document: MarkdownDocView = {
    blocks: blocks(root.children, context, 0),
    wordWrap: options.wordWrap,
  };
  const suffixByPath = buildFileLinkParentSuffixByPath(
    context.chips.map((chip) => chip.meta.filePath),
  );
  for (const chip of context.chips) {
    chip.view.label = markdownFileLinkLabel(chip.meta, suffixByPath);
  }
  return { document, complete: context.highlighted };
}

const MAX_CACHED_DOCUMENTS = 400;
const documentCache = new Map<string, { document: MarkdownDocView; complete: boolean }>();

export type WorkspaceImageResolver = (path: string) => string | null;

function resolveInlineImages(
  inlines: ReadonlyArray<MarkdownInlineView>,
  resolve: WorkspaceImageResolver,
): ReadonlyArray<MarkdownInlineView> {
  return inlines.map((inline) =>
    inline.kind === "image" && inline.source === "workspace" && inline.path !== null
      ? { ...inline, url: resolve(inline.path) }
      : inline,
  );
}

function resolveBlockImages(
  block: MarkdownBlockView,
  resolve: WorkspaceImageResolver,
): MarkdownBlockView {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return { ...block, inlines: resolveInlineImages(block.inlines, resolve) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          blocks: item.blocks.map((child) => resolveBlockImages(child, resolve)),
        })),
      };
    case "blockquote":
      return { ...block, blocks: block.blocks.map((child) => resolveBlockImages(child, resolve)) };
    case "table":
      return {
        ...block,
        header: block.header.map((cell) => resolveInlineImages(cell, resolve)),
        rows: block.rows.map((row) => row.map((cell) => resolveInlineImages(cell, resolve))),
      };
    case "code":
    case "rule":
      return block;
  }
}

/** The Markdown tree ChatMarkdown renders, as plain JSON for the native renderer. Workspace
    images become signed asset URLs through `resolveImage`, outside the text cache because
    those URLs expire. */
export function buildMarkdownDocument(
  text: string,
  options: MarkdownDocumentOptions,
  resolveImage?: WorkspaceImageResolver,
): MarkdownDocView {
  const flags = [
    options.lineBreaks,
    options.streaming,
    options.wordWrap,
    options.canRunShellCommands,
  ].map((flag) => (flag ? 1 : 0));
  const key = `${options.cwd ?? ""}\u0000${flags.join("")}\u0000${options.repositoryUrl ?? ""}\u0000${text}`;
  const cached = documentCache.get(key);
  const entry = cached?.complete === true ? cached : buildUncached(text, options);
  documentCache.delete(key);
  documentCache.set(key, entry);
  if (documentCache.size > MAX_CACHED_DOCUMENTS) {
    const oldest = documentCache.keys().next().value;
    if (oldest !== undefined) documentCache.delete(oldest);
  }
  if (resolveImage === undefined || !text.includes("![")) return entry.document;
  return {
    ...entry.document,
    blocks: entry.document.blocks.map((block) => resolveBlockImages(block, resolveImage)),
  };
}
