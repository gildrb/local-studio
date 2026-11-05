import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";

export type ClipboardWriteView = { readonly id: number; readonly text: string };

export interface ClipboardService {
  /** Writes plain text through the native clipboard; rejects when the host reports a failure. */
  readonly writeText: (text: string) => Promise<void>;
  readonly feature: CoreFeature;
}

const WrittenParams = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.Number,
    ok: Schema.Boolean,
    error: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

const services = new WeakMap<FeatureContext, ClipboardService>();

export function clipboardService(context: FeatureContext): ClipboardService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const { registry } = context;
  const writesAtom = Atom.make<ReadonlyArray<ClipboardWriteView>>([]).pipe(Atom.keepAlive);
  const waiting = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let nextId = 1;

  const service: ClipboardService = {
    writeText: (text) => {
      const id = nextId++;
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      waiting.set(id, { resolve, reject });
      registry.set(writesAtom, [...registry.get(writesAtom), { id, text }]);
      return promise;
    },
    feature: {
      views: { clipboardWrites: writesAtom },
      actions: {
        clipboardWritten: async (params) => {
          const { id, ok, error } = WrittenParams(params);
          registry.set(
            writesAtom,
            registry.get(writesAtom).filter((write) => write.id !== id),
          );
          const entry = waiting.get(id);
          waiting.delete(id);
          if (entry === undefined) return null;
          if (ok) entry.resolve();
          else entry.reject(new Error(error ?? "The clipboard rejected the write."));
          return null;
        },
      },
    },
  };
  services.set(context, service);
  return service;
}

export function createClipboardFeature(context: FeatureContext): CoreFeature {
  return clipboardService(context).feature;
}
