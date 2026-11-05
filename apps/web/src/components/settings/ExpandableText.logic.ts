const EXPANDABLE_TEXT_MAX_COLLAPSED_LENGTH = 180;

export const DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL = "Show full error";

export type ExpandableTextModelInput = {
  readonly text: string;
  readonly expanded: boolean;
  readonly expandLabel: string;
};

export type ExpandableTextModel = {
  readonly text: string;
  readonly canExpand: boolean;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly toggleLabel: string | null;
};

export function buildExpandableTextModel(input: ExpandableTextModelInput): ExpandableTextModel {
  const canExpand =
    input.text.length > EXPANDABLE_TEXT_MAX_COLLAPSED_LENGTH || input.text.includes("\n");
  return {
    text: input.text,
    canExpand,
    collapsed: !input.expanded && canExpand,
    expanded: input.expanded,
    toggleLabel: canExpand ? (input.expanded ? "Show less" : input.expandLabel) : null,
  };
}
