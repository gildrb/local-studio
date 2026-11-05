import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";

import {
  buildDiffReviewComment,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
} from "~/reviewCommentContext";

export interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment";
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

export interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
}

export type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;

export function annotationSide(range: SelectedLineRange): AnnotationSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

export function appendAnnotationEntry(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  range: SelectedLineRange,
  entry: DiffCommentAnnotationEntry,
): DiffCommentLineAnnotation[] {
  const side = annotationSide(range);
  const annotationIndex = annotations.findIndex(
    (annotation) => annotation.side === side && annotation.lineNumber === range.end,
  );
  if (annotationIndex < 0) {
    return [
      ...annotations,
      {
        side,
        lineNumber: range.end,
        metadata: { entries: [entry] },
      },
    ];
  }
  return annotations.map((annotation, index) =>
    index === annotationIndex
      ? {
          ...annotation,
          metadata: { entries: [...annotation.metadata.entries, entry] },
        }
      : annotation,
  );
}

export function buildPersistedDiffCommentAnnotations(input: {
  readonly reviewComments: ReadonlyArray<ReviewCommentContext>;
  readonly sectionId: string;
  readonly filePath: string;
  readonly fileDiff: FileDiffMetadata;
}): DiffCommentLineAnnotation[] {
  return input.reviewComments
    .filter(
      (comment) =>
        comment.sectionId === input.sectionId &&
        comment.filePath === input.filePath &&
        (comment.fenceLanguage ?? "diff") === "diff",
    )
    .reduce<DiffCommentLineAnnotation[]>((annotations, comment) => {
      const range = restoreDiffReviewCommentRange(input.fileDiff, comment);
      if (!range) return annotations;
      return appendAnnotationEntry(annotations, range, {
        id: comment.id,
        kind: "comment",
        range,
        rangeLabel: comment.rangeLabel,
        text: comment.text,
      });
    }, []);
}

export function buildDiffCommentDraftAnnotation(input: {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly fileDiff: FileDiffMetadata;
  readonly range: SelectedLineRange;
}): DiffCommentLineAnnotation | null {
  const comment = buildDiffReviewComment({ ...input, text: "" });
  if (!comment) return null;
  return {
    side: annotationSide(input.range),
    lineNumber: input.range.end,
    metadata: {
      entries: [
        {
          id: input.id,
          kind: "draft",
          range: input.range,
          rangeLabel: comment.rangeLabel,
          text: "",
        },
      ],
    },
  };
}
