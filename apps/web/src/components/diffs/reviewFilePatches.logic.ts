import type { FileDiffMetadata } from "@pierre/diffs";
import type {
  EnvironmentId,
  ReviewDiffFileStat,
  ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import type { AsyncResult } from "effect/unstable/reactivity";

import { getRenderablePatch, resolveFileDiffPath, type RenderablePatch } from "~/lib/diffRendering";

import { compareDiffFilesByPath, compareDiffPaths } from "../DiffPanel.logic";
import type { DiffFileLoadState } from "./DiffFileStatus.logic";

export const INITIAL_REVIEW_FILE_INDICES: ReadonlyArray<number> = [0, 1, 2, 3];
const REVIEW_FILE_BATCH_SIZE = 4;

export type ReviewFilePatchScopeInput = {
  readonly environmentId: EnvironmentId | undefined;
  readonly cwd: string | undefined;
  readonly source: ReviewDiffPreviewSource | null;
  readonly baseRef: string | null;
  readonly ignoreWhitespace: boolean;
};

export function buildReviewFilePatchScope(input: ReviewFilePatchScopeInput): string {
  return JSON.stringify([
    input.environmentId,
    input.cwd,
    input.source?.kind,
    input.source?.diffHash,
    input.baseRef,
    input.ignoreWhitespace,
  ]);
}

export type ReviewFileRequestState = {
  readonly scope: string;
  readonly indices: ReadonlyArray<number>;
};

export function resolveRequestedReviewFileIndices(
  state: ReviewFileRequestState,
  scope: string,
): ReadonlyArray<number> {
  return state.scope === scope ? state.indices : INITIAL_REVIEW_FILE_INDICES;
}

export function addRequestedReviewFileIndices(
  state: ReviewFileRequestState,
  scope: string,
  indices: ReadonlyArray<number>,
): ReviewFileRequestState {
  const previous = resolveRequestedReviewFileIndices(state, scope);
  const added = indices.filter((index) => !previous.includes(index));
  return added.length === 0 ? state : { scope, indices: [...previous, ...added] };
}

export function nextReviewFileIndices(settledFileCount: number): ReadonlyArray<number> {
  return Array.from({ length: REVIEW_FILE_BATCH_SIZE }, (_, index) => settledFileCount + index);
}

export function sortReviewSourceFiles(
  files: ReadonlyArray<ReviewDiffFileStat> | undefined,
): ReadonlyArray<ReviewDiffFileStat> {
  return files?.toSorted((a, b) => compareDiffPaths(a.path, b.path)) ?? [];
}

export type ReviewFilePatchQueryInput = {
  readonly cacheKey: string;
  readonly request: {
    readonly cwd: string;
    readonly baseRef?: string;
    readonly ignoreWhitespace: boolean;
    readonly file: {
      readonly path: string;
      readonly previousPath: string | null;
      readonly sourceKind: ReviewDiffPreviewSource["kind"];
    };
  };
};

export type ReviewFilePatchRequest = {
  readonly index: number;
  readonly environmentId: EnvironmentId;
  readonly input: ReviewFilePatchQueryInput;
};

export type ReviewFilePatchRequestsInput = {
  readonly environmentId: EnvironmentId | undefined;
  readonly cwd: string | undefined;
  readonly source: ReviewDiffPreviewSource | null;
  readonly files: ReadonlyArray<ReviewDiffFileStat>;
  readonly indices: ReadonlyArray<number>;
  readonly scope: string;
  readonly baseRef: string | null;
  readonly ignoreWhitespace: boolean;
};

export function buildReviewFilePatchRequests(
  input: ReviewFilePatchRequestsInput,
): ReadonlyArray<ReviewFilePatchRequest> {
  const { environmentId, cwd, source, files, baseRef, ignoreWhitespace } = input;
  if (!environmentId || !cwd || !source) return [];
  return input.indices.flatMap((index) => {
    const file = files[index];
    if (!file) return [];
    return [
      {
        index,
        environmentId,
        input: {
          cacheKey: input.scope,
          request: {
            cwd,
            ...(baseRef ? { baseRef } : {}),
            ignoreWhitespace,
            file: {
              path: file.path,
              previousPath: file.previousPath,
              sourceKind: source.kind,
            },
          },
        },
      },
    ];
  });
}

export type ParsedReviewFilePatch = {
  readonly source: ReviewDiffPreviewSource;
  readonly patch: RenderablePatch | null;
};

export function parseReviewFilePatch(
  source: ReviewDiffPreviewSource,
  theme: "light" | "dark",
): ParsedReviewFilePatch {
  let patch = getRenderablePatch(source.diff, `diff-panel:${theme}`, {
    compactPartialHunkOffsets: true,
  });
  const loaded = patch?.kind === "files" && patch.files.length === 1 ? patch.files[0] : undefined;
  const stat = source.files?.length === 1 ? source.files[0] : undefined;
  if (patch?.kind === "files" && loaded && stat) {
    const file = { ...loaded, name: stat.path };
    if (stat.previousPath !== null) file.prevName = stat.previousPath;
    else delete file.prevName;
    patch = { ...patch, files: [file] };
  }
  return { source, patch };
}

export type ReviewFilePatchResults<E> = ReadonlyMap<
  number,
  AsyncResult.AsyncResult<ParsedReviewFilePatch, E>
>;

export type ReviewSettledFileCountInput<E> = {
  readonly source: ReviewDiffPreviewSource | null;
  readonly files: ReadonlyArray<ReviewDiffFileStat>;
  readonly patches: ReviewFilePatchResults<E>;
  readonly preview: RenderablePatch | null;
};

export function resolveReviewSettledFileCount<E>(input: ReviewSettledFileCountInput<E>): number {
  const pendingIndex = input.files.findIndex((_, index) => {
    const patch = input.patches.get(index);
    return !patch || patch._tag === "Initial";
  });
  return input.source
    ? pendingIndex < 0
      ? input.files.length
      : pendingIndex
    : input.preview?.kind === "files"
      ? input.preview.files.length
      : 0;
}

export type ReviewRenderableFilesInput<E> = ReviewSettledFileCountInput<E> & {
  readonly scope: string;
};

export function buildReviewRenderableFiles<E>(
  input: ReviewRenderableFilesInput<E>,
): ReadonlyArray<FileDiffMetadata> {
  const { source, files, patches, scope, preview } = input;
  if (!source) {
    return (preview?.kind === "files" ? preview.files : []).toSorted(compareDiffFilesByPath);
  }
  return files.map((file, index): FileDiffMetadata => {
    const result = patches.get(index);
    if (result?._tag === "Success" && result.value.patch?.kind === "files") {
      const loaded = result.value.patch.files.find(
        (candidate) => resolveFileDiffPath(candidate) === file.path,
      );
      if (loaded) return loaded;
    }
    return {
      name: file.path,
      ...(file.previousPath ? { prevName: file.previousPath } : {}),
      type: file.previousPath ? "rename-changed" : "change",
      hunks: [],
      additionLines: [],
      deletionLines: [],
      splitLineCount: 0,
      unifiedLineCount: 0,
      isPartial: true,
      cacheKey: `${scope}:${file.path}:pending`,
    };
  });
}

export function buildReviewFileStates<E>(
  files: ReadonlyArray<ReviewDiffFileStat>,
  patches: ReviewFilePatchResults<E>,
): ReadonlyMap<string, DiffFileLoadState> {
  return new Map(
    files.map((file, index): [string, DiffFileLoadState] => {
      const patch = patches.get(index);
      return [
        file.path,
        {
          error:
            patch?._tag === "Failure" ||
            (patch?._tag === "Success" &&
              (patch.value.patch?.kind !== "files" ||
                !patch.value.patch.files.some(
                  (candidate) => resolveFileDiffPath(candidate) === file.path,
                ))),
          truncated: patch?._tag === "Success" && patch.value.source.truncated,
        },
      ];
    }),
  );
}

export function buildReviewReadyFilePaths<E>(
  files: ReadonlyArray<ReviewDiffFileStat>,
  patches: ReviewFilePatchResults<E>,
): ReadonlySet<string> {
  return new Set(
    files
      .filter((_, index) => {
        const patch = patches.get(index);
        return patch && patch._tag !== "Initial";
      })
      .map((file) => file.path),
  );
}

export function isReviewFilePatchPending<E>(patches: ReviewFilePatchResults<E>): boolean {
  return [...patches.values()].some((patch) => patch._tag === "Initial" || patch.waiting);
}
