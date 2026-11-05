import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ReviewDiffPreviewSource } from "@t3tools/contracts";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RenderablePatch } from "~/lib/diffRendering";
import { reviewEnvironment } from "~/state/review";
import {
  addRequestedReviewFileIndices,
  buildReviewFilePatchRequests,
  buildReviewFilePatchScope,
  buildReviewFileStates,
  buildReviewReadyFilePaths,
  buildReviewRenderableFiles,
  INITIAL_REVIEW_FILE_INDICES,
  isReviewFilePatchPending,
  nextReviewFileIndices,
  parseReviewFilePatch,
  resolveRequestedReviewFileIndices,
  resolveReviewSettledFileCount,
  sortReviewSourceFiles,
} from "./reviewFilePatches.logic";

export function useReviewFilePatches({
  environmentId,
  cwd,
  source,
  baseRef,
  ignoreWhitespace,
  theme,
  revision,
  preview,
}: {
  environmentId: EnvironmentId | undefined;
  cwd: string | undefined;
  source: ReviewDiffPreviewSource | null;
  baseRef: string | null;
  ignoreWhitespace: boolean;
  theme: "light" | "dark";
  revision: string | undefined;
  preview: RenderablePatch | null;
}) {
  const registry = useContext(RegistryContext);
  const scope = buildReviewFilePatchScope({
    environmentId,
    cwd,
    source,
    baseRef,
    ignoreWhitespace,
  });
  const [requested, setRequested] = useState({ scope, indices: INITIAL_REVIEW_FILE_INDICES });
  const indices = useMemo(
    () => resolveRequestedReviewFileIndices(requested, scope),
    [requested, scope],
  );
  const files = useMemo(() => sortReviewSourceFiles(source?.files), [source?.files]);
  const queries = useMemo(
    () =>
      buildReviewFilePatchRequests({
        environmentId,
        cwd,
        source,
        files,
        indices,
        scope,
        baseRef,
        ignoreWhitespace,
      }).map(({ index, environmentId: requestEnvironmentId, input }) => ({
        index,
        query: reviewEnvironment.diffFilePatch({ environmentId: requestEnvironmentId, input }),
      })),
    [environmentId, cwd, source, files, indices, scope, baseRef, ignoreWhitespace],
  );
  const previousPreview = useRef({ scope, revision, queries: [] as typeof queries });
  useEffect(() => {
    const previous = previousPreview.current;
    previousPreview.current = { scope, revision, queries };
    for (const { query } of queries) {
      const changed = previous.scope === scope && previous.revision !== revision;
      const cached =
        !previous.queries.some((entry) => entry.query === query) &&
        registry.get(query)._tag !== "Initial" &&
        !registry.get(query).waiting;
      if (changed || cached) registry.refresh(query);
    }
  }, [scope, revision, queries, registry]);
  // Derived atoms parse each query result once, even when another file finishes loading.
  const parsedQuery = useMemo(
    () =>
      Atom.family((query: ReturnType<typeof reviewEnvironment.diffFilePatch>) =>
        Atom.map(query, (result) =>
          AsyncResult.map(result, (source) => parseReviewFilePatch(source, theme)),
        ),
      ),
    [theme],
  );
  const patches = useAtomValue(
    useMemo(
      () =>
        Atom.make(
          (get) => new Map(queries.map(({ index, query }) => [index, get(parsedQuery(query))])),
        ),
      [queries, parsedQuery],
    ),
  );
  const settledFileCount = resolveReviewSettledFileCount({ source, files, patches, preview });
  const requestFiles = useCallback(
    (indices: ReadonlyArray<number>) =>
      setRequested((current) => addRequestedReviewFileIndices(current, scope, indices)),
    [scope],
  );
  const loadNextFiles = useCallback(
    () => requestFiles(nextReviewFileIndices(settledFileCount)),
    [requestFiles, settledFileCount],
  );
  const requestFile = useCallback((index: number) => requestFiles([index]), [requestFiles]);
  const retry = useCallback(
    (path: string) => {
      const query = queries.find(({ index }) => files[index]?.path === path)?.query;
      if (query) registry.refresh(query);
    },
    [queries, files, registry],
  );
  const renderableFiles = useMemo(
    () => buildReviewRenderableFiles({ source, files, patches, scope, preview }),
    [source, files, patches, scope, preview],
  );
  const fileStates = useMemo(() => buildReviewFileStates(files, patches), [files, patches]);
  const readyFilePaths = useMemo(() => buildReviewReadyFilePaths(files, patches), [files, patches]);
  return {
    scope,
    fileStates,
    isPending: isReviewFilePatchPending(patches),
    retry,
    requestFile,
    readyFilePaths,
    renderableFiles,
    settledFileCount,
    loadNextFiles,
  };
}
