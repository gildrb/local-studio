import type { ComposerTriggerKind } from "@t3tools/web/src/composer-logic.ts";

import type { PierreIconView } from "../pierreIcon.ts";
import type { TimelineSnapShotView } from "./timeline.ts";

export type ComposerIconView =
  | { readonly kind: "pierre"; readonly icon: PierreIconView }
  | { readonly kind: "lucide"; readonly asset: string }
  | { readonly kind: "image"; readonly path: string }
  | {
      readonly kind: "pull-request";
      readonly state: "open" | "draft" | "closed" | "merged";
    };

export type ComposerChipKind =
  | "mention"
  | "skill"
  | "image"
  | "video"
  | "file"
  | "terminal"
  | "review-comment"
  | "preview-annotation"
  | "pr-open"
  | "pr-draft"
  | "pr-merged"
  | "pr-closed"
  | "pull-request"
  | "unresolved";

export type ComposerTokenView = {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly label: string;
  readonly chip: ComposerChipKind;
  readonly icon: ComposerIconView | null;
  readonly detail: string | null;
  readonly attachmentId: string | null;
};

export type ComposerMenuItemView = {
  readonly id: string;
  readonly label: string;
  readonly labelPrefix: string | null;
  readonly description: string;
  readonly icon: ComposerIconView | null;
  readonly badge: { readonly label: string; readonly asset: string } | null;
};

export type ComposerMenuView = {
  readonly triggerKind: ComposerTriggerKind;
  readonly listLabel: string;
  readonly items: ReadonlyArray<ComposerMenuItemView>;
  readonly activeItemId: string | null;
  readonly statusText: string | null;
};

export type ComposerEditView = {
  readonly seq: number;
  readonly threadKey: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly expectedText: string;
  readonly text: string;
  readonly tokens: ReadonlyArray<ComposerTokenView>;
  readonly focus: boolean;
  readonly caret: number | null;
  readonly followUpAction: "openModelPicker" | null;
};

export type ComposerImageUploadView =
  | { readonly kind: "uploading"; readonly label: string }
  | { readonly kind: "failed"; readonly reason: string; readonly retryAriaLabel: string };

export type ComposerImageView = {
  readonly id: string;
  readonly name: string;
  readonly path: string | null;
  readonly snapShot: TimelineSnapShotView | null;
  readonly animationPending: boolean;
  readonly animateArrival: boolean;
  readonly upload: ComposerImageUploadView | null;
};

export type ComposerFooterLayoutView = {
  readonly hiddenCount: number;
  readonly iconOnlyCount: number;
  readonly visible: boolean;
  readonly compact: boolean;
};

export type ComposerInputView = {
  readonly threadKey: string;
  readonly prompt: string;
  readonly tokens: ReadonlyArray<ComposerTokenView>;
  readonly uploadSuffixes: Readonly<Record<string, string>>;
  readonly menu: ComposerMenuView | null;
  readonly edit: ComposerEditView | null;
  readonly images: ReadonlyArray<ComposerImageView>;
  readonly pendingSnapShots: ReadonlyArray<string>;
  readonly snapShotShelf: boolean;
  readonly interactionMode: {
    readonly mode: "plan" | "default";
    readonly label: string;
    readonly tooltip: string;
  } | null;
  readonly canAttach: boolean;
  readonly footer: ComposerFooterLayoutView;
  readonly focusSeq: number;
};
