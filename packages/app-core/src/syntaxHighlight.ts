import { resolveDiffThemeName } from "@t3tools/web/src/lib/diffRendering.ts";
import { getSyntaxHighlighterPromise } from "@t3tools/web/src/lib/syntaxHighlighting.ts";
import { Atom } from "effect/unstable/reactivity";

type SyntaxHighlighter = Awaited<ReturnType<typeof getSyntaxHighlighterPromise>>;

export type SyntaxToken = {
  readonly text: string;
  readonly dark: string | null;
  readonly light: string | null;
  readonly fontStyle?: number;
};

export type SyntaxLine = ReadonlyArray<SyntaxToken>;

const TOKENIZE_MAX_LINE_LENGTH = 1000;
const TOKENIZE_MAX_LENGTH = 100_000;
const PLAIN_LANGUAGE = "text";

const loadedHighlighters = new Map<string, SyntaxHighlighter>();
const loadingLanguages = new Set<string>();
const revisionListeners = new Set<(revision: number) => void>();
let highlighterRevision = 0;

function loadedHighlighter(language: string): SyntaxHighlighter | null {
  const loaded = loadedHighlighters.get(language);
  if (loaded !== undefined) return loaded;
  if (!loadingLanguages.has(language)) {
    loadingLanguages.add(language);
    getSyntaxHighlighterPromise(language).then(
      (highlighter) => {
        loadedHighlighters.set(language, highlighter);
        highlighterRevision += 1;
        for (const listener of revisionListeners) listener(highlighterRevision);
      },
      () => {
        loadingLanguages.delete(language);
      },
    );
  }
  return null;
}

export const syntaxHighlighterRevisionAtom = Atom.make((get) => {
  const listener = (revision: number) => get.setSelf(revision);
  revisionListeners.add(listener);
  get.addFinalizer(() => {
    revisionListeners.delete(listener);
  });
  return highlighterRevision;
});

function plainLines(lines: ReadonlyArray<string>): ReadonlyArray<SyntaxLine> {
  return lines.map((text) => [{ text, dark: null, light: null }]);
}

export function highlightLinesSync(
  lines: ReadonlyArray<string>,
  language: string,
): ReadonlyArray<SyntaxLine> | null {
  const totalLength = lines.reduce((total, line) => total + line.length + 1, 0);
  const requested = totalLength > TOKENIZE_MAX_LENGTH ? PLAIN_LANGUAGE : language;
  const highlighter = loadedHighlighter(requested);
  if (highlighter === null) return null;
  const lang = highlighter.getLoadedLanguages().includes(requested) ? requested : PLAIN_LANGUAGE;
  try {
    const tokens = highlighter.codeToTokensWithThemes(lines.join("\n"), {
      lang,
      themes: { dark: resolveDiffThemeName("dark"), light: resolveDiffThemeName("light") },
      tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
    });
    return lines.map((text, index) => {
      const line = tokens[index];
      if (line === undefined) return [{ text, dark: null, light: null }];
      return line.map((token): SyntaxToken => {
        const dark = token.variants["dark"];
        const light = token.variants["light"];
        const fontStyle = dark?.fontStyle ?? 0;
        return {
          text: token.content,
          dark: dark?.color ?? null,
          light: light?.color ?? null,
          ...(fontStyle > 0 ? { fontStyle } : {}),
        };
      });
    });
  } catch {
    return plainLines(lines);
  }
}
