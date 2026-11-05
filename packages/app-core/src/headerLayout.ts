import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";

/** Width of the chat header row (breadcrumb plus actions), as the web `@container/header-actions`. */
export const headerActionsWidthAtom = Atom.make<number | null>(null).pipe(Atom.keepAlive);

const WidthParams = Schema.decodeUnknownSync(Schema.Struct({ width: Schema.Number }));

export function createHeaderLayoutFeature(context: FeatureContext): CoreFeature {
  const { registry } = context;
  return {
    views: {},
    actions: {
      headerSetActionsWidth: async (params) => {
        const width = Math.floor(WidthParams(params).width);
        if (registry.get(headerActionsWidthAtom) !== width) {
          registry.set(headerActionsWidthAtom, width);
        }
        return null;
      },
    },
  };
}
