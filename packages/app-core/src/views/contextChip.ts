import type { PierreIconView } from "../pierreIcon.ts";
import type { SyntaxLine } from "../syntaxHighlight.ts";
import type { MarkdownDocView } from "./markdown.ts";

export type ContextChipTone =
  | "neutral"
  | "image"
  | "video"
  | "file"
  | "mention"
  | "terminal"
  | "element"
  | "preview-annotation"
  | "review-comment"
  | "pull-request"
  | "pr-open"
  | "pr-draft"
  | "pr-merged"
  | "pr-closed"
  | "skill"
  | "citation";

export type ContextChipState = "normal" | "unresolved" | "invalid";

export type ContextChipIconView =
  | { readonly kind: "pierre"; readonly icon: PierreIconView }
  | { readonly kind: "lucide"; readonly asset: string }
  | { readonly kind: "image"; readonly url: string };

export type PullRequestDisplayState = "open" | "draft" | "closed" | "merged";

export type ContextChipTooltipView =
  | { readonly kind: "text"; readonly text: string; readonly code: boolean }
  | {
      readonly kind: "pull-request";
      readonly number: number;
      readonly title: string;
      readonly state: PullRequestDisplayState;
      readonly stateLabel: string;
      readonly headBranch: string;
      readonly baseBranch: string;
    };

export type ContextChipActionView =
  | { readonly kind: "none" }
  | { readonly kind: "popover" }
  | { readonly kind: "open-mention"; readonly path: string }
  | { readonly kind: "expand-image"; readonly messageId: string; readonly attachmentId: string }
  | { readonly kind: "open-attachment"; readonly messageId: string; readonly attachmentId: string }
  | { readonly kind: "expand-video"; readonly messageId: string; readonly attachmentId: string }
  | { readonly kind: "open-pull-request"; readonly url: string }
  | { readonly kind: "open-citation"; readonly href: string };

export type SkillTextSegmentView =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "skill"; readonly label: string };

export type SourcePreviewView = {
  readonly lines: ReadonlyArray<SyntaxLine>;
};

export type PreviewAnnotationElementView = {
  readonly key: string;
  readonly selector: string;
  readonly sourceLabel: string | null;
  readonly htmlPreview: string | null;
};

export type ContextChipDetailsView =
  | {
      readonly kind: "terminal";
      readonly terminalLabel: string;
      readonly rangeLabel: string;
      readonly text: string;
    }
  | {
      readonly kind: "element";
      readonly title: string;
      readonly pageUrl: string;
      readonly selector: string;
      readonly sourceLabel: string | null;
      readonly html: SourcePreviewView | null;
      readonly styles: SourcePreviewView | null;
    }
  | {
      readonly kind: "preview-annotation";
      readonly image: { readonly url: string | null; readonly name: string } | null;
      readonly title: string;
      readonly comment: string | null;
      readonly targetSummary: string | null;
      readonly styleChangeCount: number;
      readonly elements: ReadonlyArray<PreviewAnnotationElementView>;
    }
  | {
      readonly kind: "review-comment";
      readonly filePath: string;
      readonly sectionLabel: string;
      readonly text: ReadonlyArray<SkillTextSegmentView> | null;
      readonly fence: MarkdownDocView | null;
      readonly patch: MarkdownDocView | null;
    };

export type ContextChipView = {
  readonly key: string;
  readonly tone: ContextChipTone;
  readonly state: ContextChipState;
  readonly icon: ContextChipIconView | null;
  readonly label: string;
  readonly labelWidth: "attachment" | "citation" | null;
  readonly size: string | null;
  readonly tooltip: ContextChipTooltipView | null;
  readonly copyMarkdown: string;
  readonly action: ContextChipActionView;
  readonly disabled: boolean;
  readonly details: ContextChipDetailsView | null;
};
