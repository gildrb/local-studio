import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";

/** Resolves when the project event reaches the live client store. */
export function waitForProjectIn(
  registry: AtomRegistry.AtomRegistry,
  projectAtom: Atom.Atom<EnvironmentProject | null>,
  timeoutMs = 10_000,
): Promise<EnvironmentProject> {
  const current = registry.get(projectAtom);
  if (current !== null) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The project did not appear in the desktop app."));
    }, timeoutMs);
    const finish = (project: EnvironmentProject | null) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    };
    unsubscribe = registry.subscribe(projectAtom, finish);
    finish(registry.get(projectAtom));
  });
}
