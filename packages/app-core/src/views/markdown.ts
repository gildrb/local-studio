import type { PierreIconView } from "../pierreIcon.ts";
import type { SyntaxLine } from "../syntaxHighlight.ts";
import type { ContextChipView } from "./contextChip.ts";

export type MarkdownInlineView =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly bold: boolean;
      readonly italic: boolean;
      readonly strike: boolean;
      readonly code: boolean;
      readonly href: string | null;
    }
  | { readonly kind: "break" }
  | {
      readonly kind: "file-chip";
      readonly label: string;
      readonly icon: PierreIconView;
      readonly targetPath: string;
      readonly displayPath: string;
      readonly panelPath: string | null;
      readonly line: number | null;
      readonly copyMarkdown: string;
    }
  | {
      readonly kind: "image";
      readonly alt: string;
      readonly media: "image" | "video";
      readonly source: "direct" | "workspace" | "blocked";
      readonly path: string | null;
      readonly url: string | null;
      readonly href: string | null;
      readonly originalUrl: string | null;
      readonly gallery: { readonly linkedUrl: string | null } | null;
    }
  | {
      readonly kind: "favicon";
      readonly host: string;
      readonly brand: "github" | null;
      readonly url: string | null;
    }
  | {
      readonly kind: "context-reference";
      readonly contextKind: string;
      readonly contextId: string;
      readonly label: string;
      readonly copyMarkdown: string;
    }
  | { readonly kind: "context-chip"; readonly chip: ContextChipView };

export type MarkdownListItemView = {
  readonly checked: boolean | null;
  readonly blocks: ReadonlyArray<MarkdownBlockView>;
};

export type MarkdownBlockView =
  | { readonly kind: "paragraph"; readonly inlines: ReadonlyArray<MarkdownInlineView> }
  | {
      readonly kind: "heading";
      readonly depth: number;
      readonly inlines: ReadonlyArray<MarkdownInlineView>;
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start: number;
      readonly spread: boolean;
      readonly depth: number;
      readonly items: ReadonlyArray<MarkdownListItemView>;
    }
  | {
      readonly kind: "blockquote";
      readonly alert: string | null;
      readonly blocks: ReadonlyArray<MarkdownBlockView>;
    }
  | {
      readonly kind: "code";
      readonly language: string;
      readonly title: string | null;
      readonly icon: PierreIconView | null;
      readonly code: string;
      readonly canRun: boolean;
      readonly lines: ReadonlyArray<SyntaxLine>;
      readonly highlighted: boolean;
    }
  | {
      readonly kind: "table";
      readonly align: ReadonlyArray<"left" | "center" | "right" | null>;
      readonly header: ReadonlyArray<ReadonlyArray<MarkdownInlineView>>;
      readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<MarkdownInlineView>>>;
      readonly copyMarkdown: string;
      readonly copyCsv: string;
    }
  | { readonly kind: "rule" };

export type MarkdownDocView = {
  readonly blocks: ReadonlyArray<MarkdownBlockView>;
  readonly wordWrap: boolean;
};
