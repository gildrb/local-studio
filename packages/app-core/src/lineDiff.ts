import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";

type WordChange = { readonly value: string; readonly added?: boolean; readonly removed?: boolean };

type DiffLibrary = {
  readonly diffWordsWithSpace: (oldText: string, newText: string) => ReadonlyArray<WordChange>;
};

export type LineSpanRange = readonly [start: number, end: number];

export type LineDiffSpans = {
  readonly deletion: ReadonlyArray<LineSpanRange>;
  readonly addition: ReadonlyArray<LineSpanRange>;
};

const MAX_LINE_DIFF_LENGTH = 1000;
const WEB_DIFF_RENDERING = Path.resolve(
  Path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web/src/lib/diffRendering.ts",
);

function isDiffLibrary(value: unknown): value is DiffLibrary {
  return (
    typeof value === "object" &&
    value !== null &&
    "diffWordsWithSpace" in value &&
    typeof value.diffWordsWithSpace === "function"
  );
}

function loadDiffLibrary(): DiffLibrary | null {
  const fromWeb = createRequire(WEB_DIFF_RENDERING);
  for (const directory of fromWeb.resolve.paths("@pierre/diffs") ?? []) {
    const packageDirectory = Path.join(directory, "@pierre", "diffs");
    if (!existsSync(packageDirectory)) continue;
    const fromPierre = createRequire(Path.join(realpathSync(packageDirectory), "package.json"));
    const library: unknown = fromPierre("diff");
    return isDiffLibrary(library) ? library : null;
  }
  return null;
}

const library = loadDiffLibrary();

function cleanLastNewline(line: string): string {
  return line.replace(/\r?\n$/, "");
}

type Span = [neutral: boolean, value: string];

function pushOrJoinSpan(spans: Span[], value: string, neutral: boolean, isLastItem: boolean) {
  const last = spans.at(-1);
  if (last === undefined || isLastItem) {
    spans.push([neutral, value]);
    return;
  }
  const lastNeutral = last[0];
  if (neutral === lastNeutral || (neutral && value.length === 1 && !lastNeutral)) {
    last[1] += value;
    return;
  }
  spans.push([neutral, value]);
}

function changedRanges(spans: ReadonlyArray<Span>): ReadonlyArray<LineSpanRange> {
  const ranges: LineSpanRange[] = [];
  let offset = 0;
  for (const [neutral, value] of spans) {
    if (!neutral) ranges.push([offset, offset + value.length]);
    offset += value.length;
  }
  return ranges;
}

export function computeLineDiffSpans(
  deletionLine: string,
  additionLine: string,
): LineDiffSpans | null {
  if (library === null) return null;
  const deletion = cleanLastNewline(deletionLine);
  const addition = cleanLastNewline(additionLine);
  if (deletion.length > MAX_LINE_DIFF_LENGTH || addition.length > MAX_LINE_DIFF_LENGTH) return null;
  const changes = library.diffWordsWithSpace(deletion, addition);
  const deletionSpans: Span[] = [];
  const additionSpans: Span[] = [];
  const lastChange = changes.at(-1);
  for (const change of changes) {
    const isLastItem = change === lastChange;
    if (!change.added && !change.removed) {
      pushOrJoinSpan(deletionSpans, change.value, true, isLastItem);
      pushOrJoinSpan(additionSpans, change.value, true, isLastItem);
    } else if (change.removed) {
      pushOrJoinSpan(deletionSpans, change.value, false, isLastItem);
    } else {
      pushOrJoinSpan(additionSpans, change.value, false, isLastItem);
    }
  }
  return { deletion: changedRanges(deletionSpans), addition: changedRanges(additionSpans) };
}
