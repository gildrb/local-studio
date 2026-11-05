import { Atom } from "effect/unstable/reactivity";

export const composerFormWidthAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);
