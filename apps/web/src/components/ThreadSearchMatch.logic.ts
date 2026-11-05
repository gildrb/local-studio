export type SearchHighlightPart = {
  readonly text: string;
  readonly highlighted: boolean;
  readonly start: number;
};

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function splitSearchHighlights(
  text: string,
  rawQuery: string,
): ReadonlyArray<SearchHighlightPart> {
  const query = rawQuery.trim();
  if (query.length === 0) return [{ text, highlighted: false, start: 0 }];

  const normalizedText = foldAsciiCase(text);
  const normalizedQuery = foldAsciiCase(query);
  const parts: SearchHighlightPart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
    if (matchIndex === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false, start: cursor });
      break;
    }
    if (matchIndex > cursor) {
      parts.push({ text: text.slice(cursor, matchIndex), highlighted: false, start: cursor });
    }
    parts.push({
      text: text.slice(matchIndex, matchIndex + query.length),
      highlighted: true,
      start: matchIndex,
    });
    cursor = matchIndex + query.length;
  }

  return parts;
}
