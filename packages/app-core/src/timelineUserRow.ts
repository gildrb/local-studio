import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KnownComposerContextRecord, SnapShotSource } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import {
  deriveUserMessageAttachments,
  resolvePreviewAnnotationImage,
  shouldCollapseUserMessage,
} from "@t3tools/web/src/components/chat/userMessage.logic.ts";
import {
  snapShotAccessibilityDetails,
  snapShotIncludesAccessibility,
} from "@t3tools/web/src/components/chat/SnapShotAttachmentDetails.logic.ts";
import { PULL_REQUEST_STATE_MODELS } from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import { middleTruncateAttachmentName } from "@t3tools/web/src/components/composerInlineChip.ts";
import { formatWorkspaceRelativePath } from "@t3tools/web/src/filePathDisplay.ts";
import {
  asKnownContextRecord,
  isPullRequestSummaryContext,
  pullRequestContextDisplayState,
  resolveUserMessageContext,
  reviewCommentContextLabel,
  type ResolvedUserMessageContext,
} from "@t3tools/web/src/lib/composerContextRecords.ts";
import { inferEntryKindFromPath } from "@t3tools/web/src/pierre-icons.ts";
import {
  buildReviewCommentRenderablePatch,
  formatReviewCommentFence,
  type ReviewCommentContext,
} from "@t3tools/web/src/reviewCommentContext.ts";
import {
  isImageAttachment,
  isVideoAttachment,
  type ChatAttachment,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type ChatMessage,
} from "@t3tools/web/src/types.ts";

import {
  applyMarkdownChips,
  skillTextSegments,
  SKILL_CHIP_ICON,
  type InlineSkill,
} from "./contextChips.ts";
import { buildMarkdownDocument, type WorkspaceImageResolver } from "./markdownDocument.ts";
import { resolvePierreFileIcon } from "./pierreIcon.ts";
import { highlightLinesSync, type SyntaxLine } from "./syntaxHighlight.ts";
import type {
  ContextChipDetailsView,
  ContextChipIconView,
  ContextChipTone,
  ContextChipView,
  SourcePreviewView,
} from "./views/contextChip.ts";
import type { MarkdownDocView, MarkdownInlineView } from "./views/markdown.ts";
import type {
  TimelineSnapShotView,
  TimelineUserFileView,
  TimelineUserGridImageView,
  TimelineUserImageView,
  TimelineUserVideoView,
} from "./views/timeline.ts";
import type { MediaVideoView } from "./views/media.ts";

export type UserRowInput = {
  readonly message: ChatMessage;
  readonly imageUrls: ReadonlyArray<TimelineUserImageView>;
  readonly videoView: (file: ChatFileAttachment) => MediaVideoView | null;
  readonly workspaceRoot: string | undefined;
  readonly wordWrap: boolean;
  readonly resolveImage: WorkspaceImageResolver;
  readonly skills: ReadonlyArray<InlineSkill>;
  readonly expanded: boolean;
};

export type UserRowParts = {
  readonly text: string;
  readonly document: MarkdownDocView | null;
  readonly images: ReadonlyArray<TimelineUserGridImageView>;
  readonly videos: ReadonlyArray<TimelineUserVideoView>;
  readonly files: ReadonlyArray<TimelineUserFileView>;
  readonly unknownAttachments: ReadonlyArray<TimelineUserFileView>;
  readonly collapsible: boolean;
  readonly expanded: boolean;
  readonly copyText: string | null;
};

type ContextReference = Extract<MarkdownInlineView, { kind: "context-reference" }>;

const PULL_REQUEST_CHIP_TONES = {
  open: "pr-open",
  draft: "pr-draft",
  merged: "pr-merged",
  closed: "pr-closed",
  unknown: "pull-request",
} satisfies Record<string, ContextChipTone>;

const PULL_REQUEST_GLYPH_ASSETS = {
  pullRequest: "icons/git-pull-request-arrow.svg",
  reopen: "icons/git-pull-request-arrow.svg",
  draft: "icons/git-pull-request-draft.svg",
  closed: "icons/git-pull-request-closed.svg",
  merged: "icons/git-merge.svg",
  conflicting: "icons/triangle-alert.svg",
  stack: "icons/layers.svg",
  link: "icons/link-2.svg",
  unlink: "icons/unlink-2.svg",
} satisfies Record<string, string>;

function lucide(asset: string): ContextChipIconView {
  return { kind: "lucide", asset };
}

function sourcePreview(text: string, language: string): SourcePreviewView {
  const lines = text.split("\n");
  const highlighted: ReadonlyArray<SyntaxLine> | null = highlightLinesSync(lines, language);
  return { lines: highlighted ?? lines.map((line) => [{ text: line, dark: null, light: null }]) };
}

function sourceLabel(
  source: { readonly fileName: string | null; readonly lineNumber: number | null } | null,
): string | null {
  if (!source?.fileName) return null;
  return `${source.fileName}${source.lineNumber === null ? "" : `:${source.lineNumber}`}`;
}

const SNAP_SHOT_ICON_DIRECTORY = join(tmpdir(), "local-studio-gpui-snapshot-icons");

export function snapShotIconPath(dataUrl: string | undefined): string | null {
  if (dataUrl === undefined) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const path = join(
    SNAP_SHOT_ICON_DIRECTORY,
    `${createHash("sha256").update(dataUrl).digest("hex")}.png`,
  );
  if (existsSync(path)) return path;
  try {
    mkdirSync(SNAP_SHOT_ICON_DIRECTORY, { recursive: true });
    writeFileSync(path, Buffer.from(dataUrl.slice(comma + 1), "base64"));
    return path;
  } catch {
    return null;
  }
}

export function snapShotView(source: SnapShotSource): TimelineSnapShotView {
  const details = snapShotAccessibilityDetails(source);
  const includesAccessibility = snapShotIncludesAccessibility(source);
  return {
    appName: source.appName,
    appInitial: source.appName.slice(0, 1).toUpperCase(),
    appIconPath: snapShotIconPath(source.appIconDataUrl),
    windowTitle: source.windowTitle || "Captured window",
    includesAccessibility,
    accessibility:
      details === undefined
        ? { kind: includesAccessibility ? "unnamed" : "none" }
        : details.format === "json"
          ? { kind: "json", lines: sourcePreview(details.content, "json").lines }
          : { kind: "text", text: details.content },
  };
}

function baseChip(
  reference: ContextReference,
  fields: Partial<ContextChipView> & Pick<ContextChipView, "tone" | "icon" | "label">,
): ContextChipView {
  return {
    key: reference.contextId,
    state: "normal",
    labelWidth: null,
    size: null,
    tooltip: null,
    copyMarkdown: reference.copyMarkdown,
    action: { kind: "none" },
    disabled: false,
    details: null,
    ...fields,
  };
}

function unavailableChip(reference: ContextReference): ContextChipView {
  return baseChip(reference, {
    tone: "neutral",
    state: "unresolved",
    icon: lucide("icons/circle-dashed.svg"),
    label: reference.label,
    tooltip: { kind: "text", text: "This context is no longer available.", code: false },
  });
}

type ChipContext = {
  readonly messageId: string;
  readonly workspaceRoot: string | undefined;
  readonly wordWrap: boolean;
  readonly resolveImage: WorkspaceImageResolver;
  readonly skills: ReadonlyArray<InlineSkill>;
  readonly recordsById: ResolvedUserMessageContext["recordsById"];
  readonly userImages: ReadonlyArray<ChatImageAttachment>;
  readonly userFiles: ReadonlyArray<ChatFileAttachment>;
  readonly previewImages: ReadonlyArray<ChatImageAttachment>;
  readonly annotationRecordIds: ReadonlyArray<string>;
};

function fenceDocument(language: string, contents: string, context: ChipContext): MarkdownDocView {
  return applyMarkdownChips(
    buildMarkdownDocument(
      formatReviewCommentFence(language, contents),
      {
        cwd: context.workspaceRoot,
        lineBreaks: false,
        streaming: false,
        wordWrap: context.wordWrap,
        canRunShellCommands: false,
      },
      context.resolveImage,
    ),
    { skills: context.skills, resolveReference: null },
  );
}

function reviewCommentDetails(
  record: Extract<KnownComposerContextRecord, { kind: "review-comment" }>,
  context: ChipContext,
): ContextChipDetailsView {
  const comment: ReviewCommentContext = {
    id: record.contextId,
    sectionId: record.sectionId,
    sectionTitle: record.sectionTitle,
    filePath: record.filePath,
    startIndex: record.startIndex,
    endIndex: record.endIndex,
    rangeLabel: record.rangeLabel,
    text: record.text,
    diff: record.diff,
    ...(record.fenceLanguage !== undefined ? { fenceLanguage: record.fenceLanguage } : {}),
    ...(record.pullRequest !== undefined ? { pullRequest: record.pullRequest } : {}),
  };
  const fenceLanguage = comment.fenceLanguage ?? "diff";
  const patch = buildReviewCommentRenderablePatch(comment);
  return {
    kind: "review-comment",
    filePath: formatWorkspaceRelativePath(comment.filePath, context.workspaceRoot),
    sectionLabel: `${comment.sectionTitle} · ${comment.rangeLabel}`,
    text: comment.text.length > 0 ? skillTextSegments(comment.text, context.skills) : null,
    fence:
      fenceLanguage !== "diff" && comment.diff.trim().length > 0
        ? fenceDocument(fenceLanguage, comment.diff, context)
        : null,
    patch: patch.trim().length > 0 ? fenceDocument("diff", patch, context) : null,
  };
}

function resolveChip(reference: ContextReference, context: ChipContext): ContextChipView {
  const record = asKnownContextRecord(context.recordsById.get(reference.contextId));
  if (record === undefined || record.kind !== reference.contextKind) {
    return unavailableChip(reference);
  }
  switch (record.kind) {
    case "mention":
      return baseChip(reference, {
        tone: "mention",
        icon:
          inferEntryKindFromPath(record.path) === "directory"
            ? lucide("icons/folder.svg")
            : { kind: "pierre", icon: resolvePierreFileIcon(record.path) },
        label: record.label,
        tooltip: { kind: "text", text: record.path, code: false },
        action: { kind: "open-mention", path: record.path },
      });
    case "skill":
      return baseChip(reference, {
        tone: "skill",
        icon: SKILL_CHIP_ICON,
        label: record.label || record.name,
        tooltip: { kind: "text", text: `$${record.name}`, code: false },
      });
    case "image": {
      const attachment = context.userImages.find((image) => image.id === record.attachmentId);
      if (attachment === undefined) return unavailableChip(reference);
      return baseChip(reference, {
        tone: "image",
        icon:
          attachment.previewUrl === undefined
            ? lucide("icons/image.svg")
            : { kind: "image", url: attachment.previewUrl },
        label: middleTruncateAttachmentName(record.name),
        labelWidth: "attachment",
        size: formatAttachmentSize(record.sizeBytes),
        action: { kind: "expand-image", messageId: context.messageId, attachmentId: attachment.id },
      });
    }
    case "file": {
      const attachment = context.userFiles.find((file) => file.id === record.attachmentId);
      if (attachment === undefined) return unavailableChip(reference);
      const isVideo = isVideoAttachment(attachment);
      const size = formatAttachmentSize(record.sizeBytes);
      return baseChip(reference, {
        tone: isVideo ? "video" : "file",
        icon: isVideo
          ? lucide("icons/film.svg")
          : { kind: "pierre", icon: resolvePierreFileIcon(record.name) },
        label: middleTruncateAttachmentName(record.name),
        labelWidth: "attachment",
        size,
        tooltip: { kind: "text", text: `${record.name}\n${size}`, code: false },
        action: {
          kind: isVideo ? "expand-video" : "open-attachment",
          messageId: context.messageId,
          attachmentId: attachment.id,
        },
        disabled:
          attachment.downloadable === false && (!isVideo || attachment.previewUrl === undefined),
      });
    }
    case "terminal": {
      const popover = record.text.length > 0;
      return baseChip(reference, {
        tone: "terminal",
        icon: lucide("icons/terminal.svg"),
        label: record.label,
        action: popover ? { kind: "popover" } : { kind: "none" },
        details: popover
          ? {
              kind: "terminal",
              terminalLabel: record.terminalLabel,
              rangeLabel:
                record.lineStart === record.lineEnd
                  ? `Line ${record.lineStart}`
                  : `Lines ${record.lineStart}–${record.lineEnd}`,
              text: record.text,
            }
          : null,
      });
    }
    case "element":
      return baseChip(reference, {
        tone: "element",
        icon: lucide("icons/mouse-pointer-click.svg"),
        label: record.label,
        action: { kind: "popover" },
        details: {
          kind: "element",
          title: record.pageTitle?.trim() || record.pageUrl,
          pageUrl: record.pageUrl,
          selector: record.selector || `<${record.tagName}>`,
          sourceLabel: sourceLabel(record.source),
          html: record.htmlPreview?.trim() ? sourcePreview(record.htmlPreview, "html") : null,
          styles: record.styles?.trim() ? sourcePreview(record.styles, "css") : null,
        },
      });
    case "review-comment": {
      const isPullRequest = isPullRequestSummaryContext(record);
      const label = reviewCommentContextLabel(record);
      const tone = PULL_REQUEST_CHIP_TONES[pullRequestContextDisplayState(record) ?? "unknown"];
      const metadata = record.pullRequest;
      if (isPullRequest && metadata !== undefined) {
        const displayState =
          metadata.state === "open" && metadata.isDraft ? "draft" : metadata.state;
        const model = PULL_REQUEST_STATE_MODELS[displayState];
        return baseChip(reference, {
          tone,
          icon: lucide(PULL_REQUEST_GLYPH_ASSETS[model.icon]),
          label,
          tooltip: {
            kind: "pull-request",
            number: metadata.number,
            title: metadata.title,
            state: displayState,
            stateLabel: model.label,
            headBranch: metadata.headBranch,
            baseBranch: metadata.baseBranch,
          },
          action: { kind: "open-pull-request", url: metadata.url },
        });
      }
      return baseChip(reference, {
        tone: isPullRequest ? tone : "review-comment",
        icon: lucide(
          isPullRequest ? PULL_REQUEST_GLYPH_ASSETS.pullRequest : "icons/message-circle.svg",
        ),
        label,
        action: { kind: "popover" },
        details: reviewCommentDetails(record, context),
      });
    }
    case "preview-annotation": {
      const image = resolvePreviewAnnotationImage({
        record,
        recordsById: context.recordsById,
        userImages: context.userImages,
        previewImages: context.previewImages,
        annotationRecordIds: context.annotationRecordIds,
      });
      return baseChip(reference, {
        tone: "preview-annotation",
        icon: lucide("icons/mouse-pointer-click.svg"),
        label: record.label,
        action: { kind: "popover" },
        details: {
          kind: "preview-annotation",
          image:
            image?.previewUrl === undefined || image === null
              ? null
              : { url: image.previewUrl, name: image.name },
          title: record.pageTitle?.trim() || record.pageUrl || "Preview annotation",
          comment: record.comment || null,
          targetSummary: record.targetSummary || null,
          styleChangeCount: record.styleChanges?.length ?? 0,
          elements: (record.elements ?? []).map((element) => {
            const label = sourceLabel(element.source);
            return {
              key: `${element.selector}\u0000${element.tagName}\u0000${label ?? ""}\u0000${element.htmlPreview}`,
              selector: element.selector || `<${element.tagName}>`,
              sourceLabel: label,
              htmlPreview: element.htmlPreview?.trim() || null,
            };
          }),
        },
      });
    }
  }
}

function withPreviewUrl(
  attachment: ChatAttachment,
  urlById: ReadonlyMap<string, string>,
): ChatAttachment {
  if (!isImageAttachment(attachment)) return attachment;
  const url = urlById.get(attachment.id);
  return url === undefined ? attachment : { ...attachment, previewUrl: url };
}

export function buildUserRowParts(input: UserRowInput): UserRowParts {
  const { message } = input;
  const resolved = resolveUserMessageContext(message);
  const urlById = new Map<string, string>();
  for (const image of input.imageUrls) {
    if (image.url !== null) urlById.set(image.id, image.url);
  }
  const parts = deriveUserMessageAttachments({
    attachments: message.attachments,
    previewAttachments: message.attachments?.map((attachment) =>
      withPreviewUrl(attachment, urlById),
    ),
    context: resolved,
  });
  const chipContext: ChipContext = {
    messageId: message.id,
    workspaceRoot: input.workspaceRoot,
    wordWrap: input.wordWrap,
    resolveImage: input.resolveImage,
    skills: input.skills,
    recordsById: resolved.recordsById,
    userImages: parts.userImages,
    userFiles: parts.userFiles,
    previewImages: parts.previewImages,
    annotationRecordIds: parts.annotationRecordIds,
  };
  const hasVisibleBody = resolved.text.trim().length > 0;
  const text = replaceComposerContextReferences(resolved.text, (reference) => reference.label);
  return {
    text,
    document: hasVisibleBody
      ? applyMarkdownChips(
          buildMarkdownDocument(
            resolved.text,
            {
              cwd: input.workspaceRoot,
              lineBreaks: true,
              streaming: false,
              wordWrap: input.wordWrap,
              canRunShellCommands: false,
            },
            input.resolveImage,
          ),
          {
            skills: input.skills,
            resolveReference: (reference) => resolveChip(reference, chipContext),
          },
        )
      : null,
    images: parts.regularImages.map((image) => ({
      id: image.id,
      name: image.name,
      url: image.previewUrl ?? null,
      snapShot:
        image.source?.kind === "snap-shot" && image.previewUrl !== undefined
          ? snapShotView(image.source)
          : null,
    })),
    videos: parts.userVideos.map((file) => ({
      id: file.id,
      name: file.name,
      video: input.videoView(file),
    })),
    files: parts.unchippedFiles.map((file) => ({
      id: file.id,
      name: file.name,
      icon: resolvePierreFileIcon(file.name),
      downloadable: file.downloadable !== false,
    })),
    unknownAttachments: parts.unknownAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      icon: resolvePierreFileIcon(attachment.name),
      downloadable: false,
    })),
    collapsible: hasVisibleBody && shouldCollapseUserMessage(resolved.text),
    expanded: input.expanded,
    copyText: resolved.text ? (resolved.records.length > 0 ? resolved.text : text) : null,
  };
}
