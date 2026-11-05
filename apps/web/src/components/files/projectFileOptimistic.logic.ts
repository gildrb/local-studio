import type { OptimisticProjectFile } from "@t3tools/client-runtime/state/projects";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { ProjectReadFileResult } from "@t3tools/contracts";
import { type AsyncResult, type Atom, type AtomRegistry } from "effect/unstable/reactivity";

export type OptimisticProjectFileAtoms<E> = {
  readonly optimistic: Atom.Writable<OptimisticProjectFile | null>;
  readonly query: Atom.Atom<AsyncResult.AsyncResult<ProjectReadFileResult, E>>;
};

/** Overlay a pending in-app write on the file query until the server confirms it. */
export function writeOptimisticProjectFile<E>(
  registry: AtomRegistry.AtomRegistry,
  atoms: OptimisticProjectFileAtoms<E>,
  relativePath: string,
  contents: string,
): void {
  registry.set(atoms.optimistic, {
    confirmedAgainst: undefined,
    data: {
      relativePath,
      contents,
      byteLength: new TextEncoder().encode(contents).byteLength,
      truncated: false,
    },
  });
}

/**
 * After a write lands, re-read the file and drop the overlay once the fresh
 * read succeeds. Returns false when a newer local edit replaced the overlay.
 */
export function confirmOptimisticProjectFile<E>(
  registry: AtomRegistry.AtomRegistry,
  atoms: OptimisticProjectFileAtoms<E>,
  contents: string,
): boolean {
  const optimisticFile = registry.get(atoms.optimistic);
  if (optimisticFile?.data.contents !== contents) return false;

  const confirmed = {
    ...optimisticFile,
    confirmedAgainst: registry.get(atoms.query),
  };
  registry.set(atoms.optimistic, confirmed);
  registry.refresh(atoms.query);
  void executeAtomQuery(registry, atoms.query, {
    reportDefect: false,
    reportFailure: false,
  }).then((result) => {
    if (result._tag === "Success" && registry.get(atoms.optimistic) === confirmed) {
      registry.set(atoms.optimistic, null);
    }
  });
  return true;
}
