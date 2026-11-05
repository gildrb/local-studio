import type { ConfirmDialogVariant } from "@t3tools/contracts";
import { resolveConfirmDialogCopy } from "@t3tools/web/src/components/ConfirmDialogHost.logic.ts";
import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  respondToConfirmDialog,
  subscribeConfirmDialog,
} from "@t3tools/web/src/confirmDialog.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature } from "../feature.ts";

export type ConfirmDialogView = {
  readonly title: string;
  readonly description: string | null;
  readonly variant: ConfirmDialogVariant;
};

const RespondParams = Schema.decodeUnknownSync(Schema.Struct({ confirmed: Schema.Boolean }));

export function createConfirmDialogFeature(): CoreFeature {
  registerConfirmDialogHost();
  const confirmDialogAtom = Atom.make((get): ConfirmDialogView | null => {
    get.addFinalizer(subscribeConfirmDialog(() => get.setSelf(viewOf())));
    return viewOf();
  });
  return {
    views: { confirmDialog: confirmDialogAtom },
    actions: {
      confirmDialogRespond: async (params) => {
        const { confirmed } = RespondParams(params);
        respondToConfirmDialog(confirmed);
        completeConfirmDialogClose();
        return null;
      },
    },
  };
}

function viewOf(): ConfirmDialogView | null {
  const state = readConfirmDialogState();
  if (state.status !== "confirming") return null;
  const copy = resolveConfirmDialogCopy(state.message);
  return { title: copy.title, description: copy.description, variant: state.variant };
}
