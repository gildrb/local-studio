import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";

import { SKILL_CHIP_ICON_SVG } from "../composerInlineChip";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { splitSkillInlineText } from "./SkillInlineText.logic";

type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName">;

export function SkillInlineText(props: { text: string; skills: ReadonlyArray<InlineSkill> }) {
  const segments = splitSkillInlineText(props.text, props.skills);
  return (
    <>
      {segments.map((segment) =>
        segment.type === "text" ? (
          segment.text
        ) : (
          <SkillChip
            key={`${segment.start}:${segment.skill.name}`}
            skill={segment.skill}
            rawText={segment.rawText}
          />
        ),
      )}
    </>
  );
}

export function renderSkillInlineMarkdownChildren(
  children: ReactNode,
  skills: ReadonlyArray<InlineSkill>,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return <SkillInlineText text={child} skills={skills} />;
    }
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }
    // Custom react-markdown components replace the intrinsic type, so also
    // check the hast node they carry.
    const markdownTagName = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (markdownTagName === "code" || markdownTagName === "a") {
      return child;
    }
    if (!("children" in child.props)) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderSkillInlineMarkdownChildren(child.props.children, skills),
    );
  });
}

function SkillChip(props: { skill: InlineSkill; rawText: string }) {
  return (
    <ContextChip kind="skill" data-markdown-copy={props.rawText}>
      <SkillChipIcon />
      <ContextChipLabel>{formatProviderSkillDisplayName(props.skill)}</ContextChipLabel>
    </ContextChip>
  );
}

/** The skill glyph; the surrounding chip sizes its svg. */
export function SkillChipIcon() {
  return (
    <span
      aria-hidden="true"
      className="contents"
      dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
    />
  );
}
