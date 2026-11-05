const SKILL_TOKEN_REGEX =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;

export type SkillInlineSegment<Skill> =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "skill";
      readonly skill: Skill;
      readonly rawText: string;
      readonly start: number;
    };

export function splitSkillInlineText<Skill extends { readonly name: string }>(
  text: string,
  skills: ReadonlyArray<Skill>,
): ReadonlyArray<SkillInlineSegment<Skill>> {
  const segments: SkillInlineSegment<Skill>[] = [];
  let cursor = 0;

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const skill = skills.find((candidate) => candidate.name === name);
    if (!skill) {
      continue;
    }

    if (start > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, start) });
    }
    segments.push({ type: "skill", skill, rawText: `$${name}`, start });
    cursor = (match.index ?? 0) + match[0].length;
  }

  if (cursor === 0) {
    return [{ type: "text", text }];
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments;
}
