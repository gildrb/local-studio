import type { TraitsMenuModel } from "@t3tools/web/src/components/chat/TraitsPicker.logic.ts";

export type ComposerView = {
  readonly threadKey: string | null;
  readonly placeholder: string;
  readonly prompt: string;
  readonly promptRevision: number;
  readonly threadError: string | null;
  readonly providerInputError: string | null;
  readonly approvalPending: boolean;
  readonly editorDisabled: boolean;
  readonly pendingAction: {
    readonly compact: boolean;
    readonly showPrevious: boolean;
    readonly previousDisabled: boolean;
    readonly label: string;
    readonly disabled: boolean;
  } | null;
  readonly planAction: {
    readonly compact: boolean;
    readonly kind: "refine" | "implement";
    readonly label: string;
    readonly disabled: boolean;
  } | null;
  readonly hasSendableContent: boolean;
  readonly running: boolean;
  readonly canInterrupt: boolean;
  readonly working: boolean;
  readonly model: {
    readonly label: string;
    readonly driverKind: string | null;
    readonly initials: string;
    readonly accentColor: string | null;
    readonly showInstanceBadge: boolean;
  } | null;
  readonly traits: string | null;
  readonly traitsMenu: TraitsMenuModel | null;
  readonly access: { readonly mode: string; readonly label: string };
  readonly accessOptions: ReadonlyArray<{
    readonly mode: string;
    readonly label: string;
    readonly description: string;
  }>;
};
