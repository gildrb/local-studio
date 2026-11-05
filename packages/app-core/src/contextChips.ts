import type { AssistantCitation, ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";
import {
  formatAssistantCitationHref,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { splitSkillInlineText } from "@t3tools/web/src/components/chat/SkillInlineText.logic.ts";

import type {
  ContextChipIconView,
  ContextChipView,
  SkillTextSegmentView,
} from "./views/contextChip.ts";
import type { MarkdownBlockView, MarkdownDocView, MarkdownInlineView } from "./views/markdown.ts";

export type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName">;

export const SKILL_CHIP_ICON: ContextChipIconView = {
  kind: "lucide",
  asset: "icons/skill-chip.svg",
};

const CITATION_LABEL_MAX_CHARS = 64;

export function citationChipView(citation: AssistantCitation): ContextChipView {
  const preview = (citation.comment?.trim() || citation.text).replace(/\s+/g, " ");
  const label =
    preview.length > CITATION_LABEL_MAX_CHARS
      ? `${preview.slice(0, CITATION_LABEL_MAX_CHARS)}…`
      : preview;
  const href = formatAssistantCitationHref(citation);
  return {
    key: "citation",
    tone: "citation",
    state: "normal",
    icon: { kind: "lucide", asset: "icons/quote.svg" },
    label,
    labelWidth: "citation",
    size: null,
    tooltip: { kind: "text", text: "View source", code: false },
    copyMarkdown: serializeAssistantCitation(citation),
    action: { kind: "open-citation", href },
    disabled: false,
    details: null,
  };
}

export function skillChipView(skill: InlineSkill, rawText: string, start: number): ContextChipView {
  return {
    key: `skill:${start}:${skill.name}`,
    tone: "skill",
    state: "normal",
    icon: SKILL_CHIP_ICON,
    label: formatProviderSkillDisplayName(skill),
    labelWidth: null,
    size: null,
    tooltip: null,
    copyMarkdown: rawText,
    action: { kind: "none" },
    disabled: false,
    details: null,
  };
}

export function skillTextSegments(
  text: string,
  skills: ReadonlyArray<InlineSkill>,
): ReadonlyArray<SkillTextSegmentView> {
  return splitSkillInlineText(text, skills).map((segment) =>
    segment.type === "text"
      ? { kind: "text", text: segment.text }
      : { kind: "skill", label: formatProviderSkillDisplayName(segment.skill) },
  );
}

export type ContextReferenceResolver = (
  reference: Extract<MarkdownInlineView, { kind: "context-reference" }>,
) => ContextChipView;

type ChipPass = {
  readonly skills: ReadonlyArray<InlineSkill>;
  readonly resolveReference: ContextReferenceResolver | null;
};

function chipInlines(
  inlines: ReadonlyArray<MarkdownInlineView>,
  pass: ChipPass,
  splitSkills: boolean,
): ReadonlyArray<MarkdownInlineView> {
  return inlines.flatMap((inline): ReadonlyArray<MarkdownInlineView> => {
    if (inline.kind === "context-reference") {
      return pass.resolveReference === null
        ? [inline]
        : [{ kind: "context-chip", chip: pass.resolveReference(inline) }];
    }
    if (
      !splitSkills ||
      pass.skills.length === 0 ||
      inline.kind !== "text" ||
      inline.code ||
      inline.href !== null
    ) {
      return [inline];
    }
    const segments = splitSkillInlineText(inline.text, pass.skills);
    if (segments.length === 1 && segments[0]?.type === "text") return [inline];
    return segments.map((segment): MarkdownInlineView =>
      segment.type === "text"
        ? { ...inline, text: segment.text }
        : {
            kind: "context-chip",
            chip: skillChipView(segment.skill, segment.rawText, segment.start),
          },
    );
  });
}

function chipBlock(
  block: MarkdownBlockView,
  pass: ChipPass,
  inListItem: boolean,
): MarkdownBlockView {
  switch (block.kind) {
    case "paragraph":
      return { ...block, inlines: chipInlines(block.inlines, pass, true) };
    case "heading":
      return { ...block, inlines: chipInlines(block.inlines, pass, inListItem) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          blocks: item.blocks.map((child) => chipBlock(child, pass, true)),
        })),
      };
    case "blockquote":
      return { ...block, blocks: block.blocks.map((child) => chipBlock(child, pass, inListItem)) };
    case "table":
      return {
        ...block,
        header: block.header.map((cell) => chipInlines(cell, pass, inListItem)),
        rows: block.rows.map((row) => row.map((cell) => chipInlines(cell, pass, inListItem))),
      };
    case "code":
    case "rule":
      return block;
  }
}

export function applyMarkdownChips(document: MarkdownDocView, pass: ChipPass): MarkdownDocView {
  if (pass.skills.length === 0 && pass.resolveReference === null) return document;
  return { ...document, blocks: document.blocks.map((block) => chipBlock(block, pass, false)) };
}
