import { fileURLToPath } from "node:url";

import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import type { PreviewAnnotationPayload, ServerProviderSkill } from "@t3tools/contracts";
import { resolveComposerSkillMeta } from "@t3tools/web/src/components/chat/composerTriggers.logic.ts";
import { splitPromptIntoComposerSegments } from "@t3tools/web/src/composer-editor-mentions.ts";
import {
  composerFileNeedsReattach,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "@t3tools/web/src/composerDraftStore.ts";
import {
  fileContextReference,
  imageContextReference,
  isPullRequestSummaryContext,
  pullRequestContextDisplayState,
  reviewCommentContextId,
  previewAnnotationContextId,
  previewAnnotationContextLabel,
  reviewCommentContextLabel,
  terminalContextReference,
} from "@t3tools/web/src/lib/composerContextRecords.ts";
import type { ReviewCommentContext } from "@t3tools/web/src/reviewCommentContext.ts";
import type { TerminalContextDraft } from "@t3tools/web/src/lib/terminalContext.ts";
import { basenameOfPath, inferEntryKindFromPath } from "@t3tools/web/src/pierre-icons.ts";
import { videoMimeType } from "@t3tools/web/src/types.ts";

import { pierreIconView, resolvePierreFileIcon } from "./pierreIcon.ts";
import type {
  ComposerChipKind,
  ComposerIconView,
  ComposerTokenView,
} from "./views/composerInput.ts";

export type ComposerTokenRecords = {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly terminalContexts: ReadonlyArray<TerminalContextDraft>;
  readonly previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
};

const FOLDER_ICON: ComposerIconView = { kind: "lucide", asset: "icons/folder.svg" };

const PULL_REQUEST_CHIPS = {
  open: { chip: "pr-open", asset: "icons/git-pull-request-arrow.svg" },
  draft: { chip: "pr-draft", asset: "icons/git-pull-request-draft.svg" },
  merged: { chip: "pr-merged", asset: "icons/git-merge.svg" },
  closed: { chip: "pr-closed", asset: "icons/git-pull-request-closed.svg" },
  unknown: { chip: "pull-request", asset: "icons/git-pull-request-arrow.svg" },
} as const satisfies Record<string, { chip: ComposerChipKind; asset: string }>;

export function composerPreviewPath(previewUrl: string): string | null {
  return previewUrl.startsWith("file:") ? fileURLToPath(previewUrl) : null;
}

export function composerPathIcon(path: string, kind: "file" | "directory"): ComposerIconView {
  return kind === "directory" ? FOLDER_ICON : { kind: "pierre", icon: resolvePierreFileIcon(path) };
}

function referenceToken(
  kind: string,
  contextId: string,
  label: string,
  records: ComposerTokenRecords,
): Omit<ComposerTokenView, "id" | "start" | "end" | "text"> {
  const image = records.images.find(
    (record) => imageContextReference(record).contextId === contextId,
  );
  if (kind === "image" && image !== undefined) {
    const path = composerPreviewPath(image.previewUrl);
    return {
      label: image.name,
      chip: "image",
      icon: path === null ? { kind: "lucide", asset: "icons/image.svg" } : { kind: "image", path },
      detail: formatAttachmentSize(image.sizeBytes),
      attachmentId: image.id,
    };
  }
  const file = records.files.find((record) => fileContextReference(record).contextId === contextId);
  if (kind === "file" && file !== undefined) {
    const isVideo = videoMimeType(file) !== null;
    const needsReattach = composerFileNeedsReattach(file);
    return {
      label: file.name,
      chip: needsReattach ? "unresolved" : isVideo ? "video" : "file",
      icon: {
        kind: "pierre",
        icon: isVideo
          ? pierreIconView("t3-file-icon-video", undefined)
          : resolvePierreFileIcon(file.name),
      },
      detail: formatAttachmentSize(file.sizeBytes),
      attachmentId: file.id,
    };
  }
  const comment = records.reviewComments.find(
    (record) => reviewCommentContextId(record.id) === contextId,
  );
  if (kind === "review-comment" && comment !== undefined) {
    const pullRequest = isPullRequestSummaryContext(comment)
      ? PULL_REQUEST_CHIPS[pullRequestContextDisplayState(comment) ?? "unknown"]
      : null;
    return {
      label: reviewCommentContextLabel(comment),
      chip: pullRequest?.chip ?? "review-comment",
      icon: { kind: "lucide", asset: pullRequest?.asset ?? "icons/message-circle.svg" },
      detail: null,
      attachmentId: null,
    };
  }
  const terminal = records.terminalContexts.find(
    (record) => terminalContextReference(record).contextId === contextId,
  );
  if (kind === "terminal" && terminal !== undefined) {
    return {
      label,
      chip: "terminal",
      icon: { kind: "lucide", asset: "icons/square-terminal.svg" },
      detail: null,
      attachmentId: null,
    };
  }
  const annotation = records.previewAnnotations.find(
    (record) => previewAnnotationContextId(record.id) === contextId,
  );
  if (kind === "preview-annotation" && annotation !== undefined) {
    return {
      label: previewAnnotationContextLabel(annotation),
      chip: "preview-annotation",
      icon: { kind: "lucide", asset: "icons/mouse-pointer-click.svg" },
      detail: null,
      attachmentId: null,
    };
  }
  return { label, chip: "unresolved", icon: null, detail: null, attachmentId: null };
}

export function buildComposerPromptTokens(
  prompt: string,
  records: ComposerTokenRecords,
): ComposerTokenView[] {
  const tokens: ComposerTokenView[] = [];
  let offset = 0;
  for (const segment of splitPromptIntoComposerSegments(prompt)) {
    if (segment.type === "text") {
      offset += segment.text.length;
      continue;
    }
    const start = offset;
    const end = start + segment.source.length;
    offset = end;
    if (segment.type === "mention") {
      const kind = inferEntryKindFromPath(segment.path);
      tokens.push({
        id: `mention:${segment.path}`,
        start,
        end,
        text: segment.source,
        label: basenameOfPath(segment.path),
        chip: "mention",
        icon: composerPathIcon(segment.path, kind),
        detail: null,
        attachmentId: null,
      });
    } else if (segment.type === "skill") {
      tokens.push({
        id: `skill:${segment.name}`,
        start,
        end,
        text: segment.source,
        label: resolveComposerSkillMeta(segment.name, records.skills).label,
        chip: "skill",
        icon: { kind: "lucide", asset: "icons/box.svg" },
        detail: null,
        attachmentId: null,
      });
    } else if (segment.type === "context-reference") {
      tokens.push({
        id: `context:${segment.contextId}`,
        start,
        end,
        text: segment.source,
        ...referenceToken(segment.kind, segment.contextId, segment.label, records),
      });
    }
  }
  return tokens;
}
