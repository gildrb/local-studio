export type DiffFilePathCopyModel = {
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly icon: "check" | "copy";
  readonly tone: "success" | "default";
};

export function buildDiffFilePathCopyModel(isCopied: boolean): DiffFilePathCopyModel {
  return {
    ariaLabel: "Copy file path",
    tooltip: isCopied ? "Copied" : "Copy path",
    icon: isCopied ? "check" : "copy",
    tone: isCopied ? "success" : "default",
  };
}

export type DiffFilePathCopyIntent = { readonly kind: "copy-to-clipboard"; readonly text: string };

export function resolveDiffFilePathCopy(filePath: string): DiffFilePathCopyIntent {
  return { kind: "copy-to-clipboard", text: filePath };
}
