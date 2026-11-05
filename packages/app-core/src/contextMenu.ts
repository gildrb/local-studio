import type { ContextMenuItem } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";

export type ContextMenuPosition = { readonly x: number; readonly y: number };

export type ContextMenuRequestView = {
  readonly id: number;
  readonly position: ContextMenuPosition;
  readonly items: ReadonlyArray<ContextMenuItem>;
};

export interface ContextMenuService {
  /** Same contract as the desktop bridge's `contextMenu.show`: the picked id, or null. */
  readonly show: <T extends string>(
    items: ReadonlyArray<ContextMenuItem<T>>,
    position: ContextMenuPosition,
  ) => Promise<T | null>;
  readonly feature: CoreFeature;
}

const ShownParams = Schema.decodeUnknownSync(Schema.Struct({ requestId: Schema.Number }));
const SelectParams = Schema.decodeUnknownSync(
  Schema.Struct({ requestId: Schema.Number, itemId: Schema.NullOr(Schema.String) }),
);

function findItemId<T extends string>(
  items: ReadonlyArray<ContextMenuItem<T>>,
  id: string,
): T | null {
  for (const item of items) {
    if (item.children !== undefined && item.children.length > 0) {
      const nested = findItemId(item.children, id);
      if (nested !== null) return nested;
    } else if (item.id === id && item.disabled !== true) {
      return item.id;
    }
  }
  return null;
}

const services = new WeakMap<FeatureContext, ContextMenuService>();

/** One native menu at a time; opening another settles the previous one as dismissed. */
export function contextMenuService(context: FeatureContext): ContextMenuService {
  const existing = services.get(context);
  if (existing !== undefined) return existing;
  const { registry } = context;
  const requestAtom = Atom.make<ContextMenuRequestView | null>(null).pipe(Atom.keepAlive);
  let nextId = 1;
  let pending: { readonly id: number; readonly resolve: (itemId: string | null) => void } | null =
    null;

  const show: ContextMenuService["show"] = (items, position) => {
    pending?.resolve(null);
    const id = nextId++;
    const { promise, resolve } = Promise.withResolvers<string | null>();
    pending = { id, resolve };
    registry.set(requestAtom, { id, position, items });
    return promise.then((itemId) => (itemId === null ? null : findItemId(items, itemId)));
  };

  const service: ContextMenuService = {
    show,
    feature: {
      views: { contextMenu: requestAtom },
      actions: {
        contextMenuShown: async (params) => {
          const { requestId } = ShownParams(params);
          if (registry.get(requestAtom)?.id === requestId) registry.set(requestAtom, null);
          return null;
        },
        contextMenuSelect: async (params) => {
          const { requestId, itemId } = SelectParams(params);
          if (registry.get(requestAtom)?.id === requestId) registry.set(requestAtom, null);
          if (pending?.id !== requestId) return null;
          const { resolve } = pending;
          pending = null;
          resolve(itemId);
          return null;
        },
      },
    },
  };
  services.set(context, service);
  return service;
}

export function createContextMenuFeature(context: FeatureContext): CoreFeature {
  return contextMenuService(context).feature;
}
