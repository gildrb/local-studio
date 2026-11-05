import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { formatEnvironmentQueryError } from "./query";

export interface EnvironmentQueryTarget<Input> {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}

export interface MergedEnvironmentQueryView<A> {
  /** One entry per query target that has answered, in the order the targets were given. */
  readonly values: ReadonlyArray<readonly [EnvironmentId, A]>;
  /** The first environment that failed. Others may still have answered — this is not fatal. */
  readonly error: string | null;
  readonly isPending: boolean;
  readonly observations: ReadonlyArray<readonly [EnvironmentId, A, number]>;
}

export interface MergedEnvironmentQueryAtoms<Input, A> {
  readonly atom: (
    targets: ReadonlyArray<EnvironmentQueryTarget<Input>>,
  ) => Atom.Atom<MergedEnvironmentQueryView<A>>;
  readonly atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>;
}

/**
 * The same per-environment query read across several environments at once. A subscriber cannot
 * follow a list of atoms whose length changes, so the fan-out happens inside one derived atom
 * keyed by the targets — the same shape the cross-environment thread search uses.
 *
 * An environment that fails contributes nothing rather than blanking the page: the pull request
 * list is a union, and one unreachable machine should not hide the others' rows.
 */
export function createMergedEnvironmentQueryAtoms<Input, A>(
  label: string,
  atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
): MergedEnvironmentQueryAtoms<Input, A> {
  const targetsByKey = new Map<string, ReadonlyArray<EnvironmentQueryTarget<Input>>>();
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedEnvironmentQueryView<A> => {
      const targets = targetsByKey.get(key) ?? [];
      const values: Array<readonly [EnvironmentId, A]> = [];
      const observations: Array<readonly [EnvironmentId, A, number]> = [];
      let error: string | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(atomFor(target));
        isPending ||= result.waiting;
        if (result._tag === "Failure" && error === null) {
          error = formatEnvironmentQueryError(result.cause);
        }
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) values.push([target.environmentId, value]);
        if (result._tag === "Success") {
          observations.push([target.environmentId, result.value, result.timestamp]);
        }
      }
      return { values, error, isPending, observations };
    }).pipe(Atom.withLabel(`${label}:${key}`)),
  );
  const empty = Atom.make<MergedEnvironmentQueryView<A>>({
    values: [],
    observations: [],
    error: null,
    isPending: false,
  }).pipe(Atom.withLabel(`${label}:empty`));
  return {
    atom: (targets) => {
      if (targets.length === 0) return empty;
      const key = JSON.stringify(targets);
      if (!targetsByKey.has(key)) targetsByKey.set(key, targets);
      return family(key);
    },
    atomFor,
  };
}
