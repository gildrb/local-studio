import { threadWorkspaceMutationId } from "@t3tools/web/src/hooks/useWorkspaceMutationRefresh.ts";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "./feature.ts";

const atoms = new WeakMap<FeatureContext, Atom.Atom<string | null>>();

/** The route thread's workspace mutation id (ChatView's `workspaceMutationId`), shared per core. */
export function makeWorkspaceMutationIdAtom(context: FeatureContext): Atom.Atom<string | null> {
  const existing = atoms.get(context);
  if (existing !== undefined) return existing;
  const atom = Atom.make((get) => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    return threadWorkspaceMutationId({
      activities: input.thread.activities,
      latestCheckpointCompletedAt: input.thread.checkpoints.at(-1)?.completedAt ?? null,
    });
  }).pipe(Atom.withLabel("gpui-workspace-mutation-id"));
  atoms.set(context, atom);
  return atom;
}
