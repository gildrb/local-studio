import {
  STATIC_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
  type ServerRemoveKeybindingInput,
  type ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  mergeWithDefaultKeybindings,
  parseKeybindingWhenExpression,
} from "@t3tools/shared/keybindings";

import { formatShortcutLabel, shortcutKeyFromEvent } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";
import { METRIC_OPTIONS, WINDOW_OPTIONS } from "../usage/usageShortcuts";

const usageCommandOrder = new Map<KeybindingCommand, number>(
  [...METRIC_OPTIONS, ...WINDOW_OPTIONS].map((option, index) => [option.command, index]),
);

const firstUsageCommand = METRIC_OPTIONS[0].command;

/**
 * Orders commands by `key`, except Usage page commands, which sort as one
 * block in page order where the first of them would sort. A total order, so
 * adding a binding elsewhere cannot reshuffle the Usage rows.
 */
function compareCommands(
  left: KeybindingCommand,
  right: KeybindingCommand,
  key: (command: KeybindingCommand) => string,
): number {
  const leftRank = usageCommandOrder.get(left);
  const rightRank = usageCommandOrder.get(right);
  if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
  return key(leftRank === undefined ? left : firstUsageCommand).localeCompare(
    key(rightRank === undefined ? right : firstUsageCommand),
  );
}

export type KeybindingSource = "Default" | "Custom" | "Project";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule;
  readonly conflicts: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = [
  "terminalFocus",
  "terminalOpen",
  "isWeb",
  "isDesktop",
  "true",
  "false",
] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

export const DEFAULT_WHEN_VARIABLE =
  [...DEFAULT_WHEN_VARIABLES].find(
    (identifier) => identifier !== "true" && identifier !== "false",
  ) ?? "terminalFocus";
const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

export function whenNodeRemoveLabel(node: KeybindingWhenNode, depth: number): string {
  if (depth === 0) return "Clear all conditions";
  if (node.type === "identifier" || (node.type === "not" && node.node.type === "identifier")) {
    return "Remove condition";
  }
  return "Remove group and its conditions";
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  if (String(binding.command).startsWith("script.")) {
    return "Project";
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  return isDefault ? "Default" : "Custom";
}

function defaultBindingForBinding(
  binding: ResolvedKeybindingRule,
): ResolvedKeybindingRule | undefined {
  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);

  return (
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command &&
        shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
        whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command && whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => entry.command === binding.command)
  );
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

function conflictsWithWhen(leftWhen: string, rightWhen: string): boolean {
  return leftWhen.length === 0 || rightWhen.length === 0 || leftWhen === rightWhen;
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const conflicts: Array<string> = [];
  for (const candidate of rows) {
    if (
      candidate.id !== input.rowId &&
      candidate.key === input.key &&
      conflictsWithWhen(candidate.when, input.when)
    ) {
      conflicts.push(commandLabel(candidate.command));
    }
  }
  return [...new Set(conflicts)].toSorted();
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  query: string,
): ReadonlyArray<KeybindingRow> {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = keybindings.map((binding, index) => {
    const defaultBinding = defaultBindingForBinding(binding);
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);
    return {
      id: `${keybindingRowId(binding.command, key, when)}\u0000${index}`,
      command: binding.command,
      key,
      when,
      source: sourceForBinding(binding),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding,
      conflicts: [],
    } satisfies KeybindingRow;
  });

  const rowsWithConflicts = rows.map((row) => {
    const conflicts = keybindingConflictLabels(rows, {
      rowId: row.id,
      key: row.key,
      when: row.when,
    });
    return conflicts.length > 0
      ? Object.assign({}, row, { conflicts: [...new Set(conflicts)].toSorted() })
      : row;
  });

  rowsWithConflicts.sort((left, right) => {
    const commandCompare = compareCommands(left.command, right.command, (command) => command);
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });

  if (normalizedQuery.length === 0) {
    return rowsWithConflicts;
  }

  return rowsWithConflicts.filter((row) => {
    return (
      row.command.toLowerCase().includes(normalizedQuery) ||
      commandLabel(row.command).toLowerCase().includes(normalizedQuery) ||
      row.key.toLowerCase().includes(normalizedQuery) ||
      row.when.toLowerCase().includes(normalizedQuery) ||
      row.source.toLowerCase().includes(normalizedQuery)
    );
  });
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function isKnownWhenVariable(identifier: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(identifier);
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !isKnownWhenVariable(identifier)).toSorted();
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>(STATIC_KEYBINDING_COMMANDS);
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) => compareCommands(left, right, commandLabel));
}

export function commandLabel(command: KeybindingCommand): string {
  if (command === "thread.copyReference") return "Pull Request: Copy Link or Thread ID";
  const usageMetric = METRIC_OPTIONS.find((option) => option.command === command);
  if (usageMetric) return `Usage: ${usageMetric.label}`;
  const usagePeriod = WINDOW_OPTIONS.find((option) => option.command === command);
  if (usagePeriod) return `Usage: Period: ${usagePeriod.label}`;
  const raw = String(command);
  if (raw.startsWith("script.") && raw.endsWith(".run")) {
    return `Run Script: ${titleCaseCommandSegment(raw.slice("script.".length, -".run".length))}`;
  }
  return raw.split(".").map(titleCaseCommandSegment).join(": ");
}

function titleCaseCommandSegment(segment: string): string {
  const words: Array<string> = [];
  for (const part of segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/)) {
    if (part.length > 0) {
      words.push(part.slice(0, 1).toUpperCase() + part.slice(1));
    }
  }
  return words.join(" ");
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

/** Turns a keydown into a binding such as `mod+shift+k` or `tab`. Null for modifier-only presses. */
export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
): string | null {
  const keyToken = normalizeShortcutKeyToken(shortcutKeyFromEvent(event));
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);
  return parts.join("+");
}

export type WhenBooleanOperator = "and" | "or";

type WhenConditionParts = { readonly identifier: string; readonly negated: boolean };

function whenConditionParts(node: KeybindingWhenNode): WhenConditionParts | null {
  if (node.type === "identifier") return { identifier: node.name, negated: false };
  if (node.type === "not" && node.node.type === "identifier") {
    return { identifier: node.node.name, negated: true };
  }
  return null;
}

function flattenWhenChildren(
  node: KeybindingWhenNode,
  operator: WhenBooleanOperator,
): KeybindingWhenNode[] {
  if (node.type !== operator) return [node];
  return [
    ...flattenWhenChildren(node.left, operator),
    ...flattenWhenChildren(node.right, operator),
  ];
}

function buildWhenExpressionGroup(
  children: readonly KeybindingWhenNode[],
  operator: WhenBooleanOperator,
): KeybindingWhenNode | undefined {
  const first = children[0];
  if (!first) return undefined;
  return children.slice(1).reduce<KeybindingWhenNode>(
    (left, right) => ({
      type: operator,
      left,
      right,
    }),
    first,
  );
}

function defaultWhenCondition(): KeybindingWhenNode {
  return { type: "identifier", name: DEFAULT_WHEN_VARIABLE };
}

function defaultWhenGroup(operator: WhenBooleanOperator): KeybindingWhenNode {
  return {
    type: operator,
    left: defaultWhenCondition(),
    right: { type: "not", node: defaultWhenCondition() },
  };
}

function whenGroupOperator(node: KeybindingWhenNode): WhenBooleanOperator | null {
  if (node.type === "not" || node.type === "identifier") return null;
  return node.type;
}

function whenNodeChildren(node: KeybindingWhenNode): KeybindingWhenNode[] {
  if (whenConditionParts(node)) return [];
  if (node.type === "not") return [node.node];
  const operator = whenGroupOperator(node);
  return operator ? flattenWhenChildren(node, operator) : [];
}

export type WhenNodeEdit =
  | { readonly kind: "setNegated"; readonly negated: boolean }
  | { readonly kind: "setIdentifier"; readonly identifier: string }
  | { readonly kind: "setOperator"; readonly operator: WhenBooleanOperator }
  | { readonly kind: "addCondition" }
  | { readonly kind: "addGroup" }
  | { readonly kind: "replaceChild"; readonly index: number; readonly next: KeybindingWhenNode }
  | { readonly kind: "removeChild"; readonly index: number };

function negateWhenNode(node: KeybindingWhenNode, negated: boolean): KeybindingWhenNode {
  const parts = whenConditionParts(node);
  if (parts) {
    const identifier: KeybindingWhenNode = { type: "identifier", name: parts.identifier };
    return negated ? { type: "not", node: identifier } : identifier;
  }
  if (node.type === "not") return negated ? node : node.node;
  return negated ? { type: "not", node } : node;
}

function editWhenGroup(
  node: KeybindingWhenNode,
  operator: WhenBooleanOperator,
  edit: WhenNodeEdit,
): KeybindingWhenNode | null {
  const children = flattenWhenChildren(node, operator);
  switch (edit.kind) {
    case "setOperator":
      if (edit.operator === operator) return null;
      return buildWhenExpressionGroup(children, edit.operator) ?? null;
    case "addCondition":
      return buildWhenExpressionGroup([...children, defaultWhenCondition()], operator) ?? null;
    case "addGroup":
      return (
        buildWhenExpressionGroup(
          [...children, defaultWhenGroup(operator === "and" ? "or" : "and")],
          operator,
        ) ?? null
      );
    case "replaceChild":
      return (
        buildWhenExpressionGroup(
          children.map((child, index) => (index === edit.index ? edit.next : child)),
          operator,
        ) ?? null
      );
    case "removeChild":
      return (
        buildWhenExpressionGroup(
          children.filter((_child, index) => index !== edit.index),
          operator,
        ) ?? defaultWhenCondition()
      );
    case "setNegated":
      return negateWhenNode(node, edit.negated);
    case "setIdentifier":
      return null;
  }
}

export function resolveWhenNodeEdit(
  node: KeybindingWhenNode,
  edit: WhenNodeEdit,
): KeybindingWhenNode | null {
  const condition = whenConditionParts(node);
  if (condition) {
    if (edit.kind === "setNegated") return negateWhenNode(node, edit.negated);
    if (edit.kind !== "setIdentifier") return null;
    const next: KeybindingWhenNode = { type: "identifier", name: edit.identifier };
    return condition.negated ? { type: "not", node: next } : next;
  }
  if (node.type === "not") {
    if (edit.kind === "setNegated") return negateWhenNode(node, edit.negated);
    if (edit.kind === "replaceChild" && edit.index === 0) return { type: "not", node: edit.next };
    return null;
  }
  const operator = whenGroupOperator(node);
  return operator ? editWhenGroup(node, operator, edit) : null;
}

export type WhenExpressionEdit =
  | { readonly kind: "addRootCondition" }
  | { readonly kind: "addRootGroup" }
  | { readonly kind: "clear" }
  | { readonly kind: "editNode"; readonly path: ReadonlyArray<number>; readonly edit: WhenNodeEdit }
  | { readonly kind: "removeNode"; readonly path: ReadonlyArray<number> };

export type WhenExpressionEditResult =
  | { readonly kind: "unchanged" }
  | { readonly kind: "changed"; readonly value: KeybindingWhenNode | undefined };

function editWhenNodeAtPath(
  node: KeybindingWhenNode,
  path: ReadonlyArray<number>,
  edit: WhenNodeEdit,
): KeybindingWhenNode | null {
  const [index, ...rest] = path;
  if (index === undefined) return resolveWhenNodeEdit(node, edit);
  const child = whenNodeChildren(node)[index];
  if (!child) return null;
  const next = editWhenNodeAtPath(child, rest, edit);
  return next ? resolveWhenNodeEdit(node, { kind: "replaceChild", index, next }) : null;
}

function removeWhenNodeAtPath(
  node: KeybindingWhenNode,
  path: ReadonlyArray<number>,
): KeybindingWhenNode | null {
  const parentPath = path.slice(0, -1);
  const index = path.at(-1);
  if (index === undefined) return null;
  return editWhenNodeAtPath(node, parentPath, { kind: "removeChild", index });
}

export function resolveWhenExpressionEdit(
  value: KeybindingWhenNode | undefined,
  edit: WhenExpressionEdit,
): WhenExpressionEditResult {
  switch (edit.kind) {
    case "addRootCondition":
      return {
        kind: "changed",
        value: value
          ? { type: "and", left: value, right: defaultWhenCondition() }
          : defaultWhenCondition(),
      };
    case "addRootGroup": {
      const group = defaultWhenGroup("or");
      return {
        kind: "changed",
        value: value ? { type: "and", left: value, right: group } : group,
      };
    }
    case "clear":
      return { kind: "changed", value: undefined };
    case "editNode": {
      const next = value ? editWhenNodeAtPath(value, edit.path, edit.edit) : null;
      return next ? { kind: "changed", value: next } : { kind: "unchanged" };
    }
    case "removeNode": {
      if (edit.path.length === 0) return { kind: "changed", value: undefined };
      const next = value ? removeWhenNodeAtPath(value, edit.path) : null;
      return next ? { kind: "changed", value: next } : { kind: "unchanged" };
    }
  }
}

export type WhenWarningModel = {
  readonly label: string;
  readonly tooltip: string;
};

export function buildUnknownWhenVariableWarning(
  identifiers: ReadonlyArray<string>,
): WhenWarningModel | null {
  if (identifiers.length === 0) return null;
  return {
    label:
      identifiers.length === 1
        ? `Unknown condition: ${identifiers[0]}`
        : `Unknown conditions: ${identifiers.join(", ")}`,
    tooltip:
      "T3 Code does not recognize this condition yet. It can still be saved, but it may not match unless the runtime provides it.",
  };
}

export function buildKeybindingConflictWarning(
  labels: ReadonlyArray<string>,
): WhenWarningModel | null {
  if (labels.length === 0) return null;
  const description =
    labels.length === 1
      ? `Conflicts with ${labels[0]}.`
      : `Conflicts with ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", and more" : ""}.`;
  return {
    label: description,
    tooltip: `${description} The most recent matching binding wins when both conditions can apply.`,
  };
}

export type WhenNodeRemoveModel = { readonly label: string };

export type WhenConditionNodeModel = {
  readonly kind: "condition";
  readonly node: KeybindingWhenNode;
  readonly path: ReadonlyArray<number>;
  readonly depth: number;
  readonly identifier: string;
  readonly negated: boolean;
  readonly negateText: string;
  readonly negateLabel: string;
  readonly placeholder: string;
  readonly options: ReadonlyArray<WhenVariableOption>;
  readonly unknownWarning: WhenWarningModel | null;
  readonly remove: WhenNodeRemoveModel | null;
};

export type WhenNotNodeModel = {
  readonly kind: "not";
  readonly node: KeybindingWhenNode;
  readonly path: ReadonlyArray<number>;
  readonly depth: number;
  readonly negateText: string;
  readonly negateLabel: string;
  readonly remove: WhenNodeRemoveModel | null;
  readonly child: WhenNodeModel;
};

export type WhenOperatorOption = {
  readonly value: WhenBooleanOperator;
  readonly label: string;
};

export type WhenGroupChildModel = {
  readonly key: string;
  readonly model: WhenNodeModel;
};

export type WhenGroupNodeModel = {
  readonly kind: "group";
  readonly node: KeybindingWhenNode;
  readonly path: ReadonlyArray<number>;
  readonly depth: number;
  readonly operator: WhenBooleanOperator;
  readonly operatorOptions: ReadonlyArray<WhenOperatorOption>;
  readonly addConditionLabel: string;
  readonly addGroupLabel: string;
  readonly remove: WhenNodeRemoveModel | null;
  readonly children: ReadonlyArray<WhenGroupChildModel>;
};

export type WhenNodeModel = WhenConditionNodeModel | WhenNotNodeModel | WhenGroupNodeModel;

export type WhenNodeModelInput = {
  readonly node: KeybindingWhenNode;
  readonly variables: ReadonlyArray<WhenVariableOption>;
  readonly path: ReadonlyArray<number>;
  readonly removable: boolean;
};

const WHEN_OPERATOR_OPTIONS: ReadonlyArray<WhenOperatorOption> = [
  { value: "and", label: "and" },
  { value: "or", label: "or" },
];

export function resolveWhenOperatorSelection(value: unknown): WhenBooleanOperator | null {
  return WHEN_OPERATOR_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

export function buildWhenNodeModel(input: WhenNodeModelInput): WhenNodeModel {
  const { node, variables, path, removable } = input;
  const depth = path.length;
  const remove = removable ? { label: whenNodeRemoveLabel(node, depth) } : null;
  const condition = whenConditionParts(node);
  if (condition) {
    return {
      kind: "condition",
      node,
      path,
      depth,
      identifier: condition.identifier,
      negated: condition.negated,
      negateText: "Not",
      negateLabel: `Negate ${condition.identifier}`,
      placeholder: "Condition",
      options: variables.includes(condition.identifier)
        ? variables
        : [condition.identifier, ...variables],
      unknownWarning: buildUnknownWhenVariableWarning(
        isKnownWhenVariable(condition.identifier) ? [] : [condition.identifier],
      ),
      remove,
    };
  }

  if (node.type === "not") {
    return {
      kind: "not",
      node,
      path,
      depth,
      negateText: "Not",
      negateLabel: "Negate group",
      remove,
      child: buildWhenNodeModel({
        node: node.node,
        variables,
        path: [...path, 0],
        removable: false,
      }),
    };
  }

  const operator: WhenBooleanOperator = node.type === "or" ? "or" : "and";
  const childKeyCounts = new Map<string, number>();
  const children = flattenWhenChildren(node, operator).map((child, index) => {
    const baseKey = `${child.type}-${whenAstToExpression(child)}`;
    const count = childKeyCounts.get(baseKey) ?? 0;
    childKeyCounts.set(baseKey, count + 1);
    return {
      key: count === 0 ? baseKey : `${baseKey}-${count}`,
      model: buildWhenNodeModel({
        node: child,
        variables,
        path: [...path, index],
        removable: true,
      }),
    };
  });

  return {
    kind: "group",
    node,
    path,
    depth,
    operator,
    operatorOptions: WHEN_OPERATOR_OPTIONS,
    addConditionLabel: "Condition",
    addGroupLabel: "Group",
    remove,
    children,
  };
}

export type WhenExpressionBuilderModelInput = {
  readonly value: KeybindingWhenNode | undefined;
  readonly expressionDraft: string;
  readonly variables: ReadonlyArray<WhenVariableOption>;
};

export type WhenExpressionBuilderModel = {
  readonly title: string;
  readonly addConditionLabel: string;
  readonly addGroupLabel: string;
  readonly expressionInput: {
    readonly value: string;
    readonly placeholder: string;
    readonly ariaLabel: string;
    readonly invalid: boolean;
  };
  readonly unknownWarning: WhenWarningModel | null;
  readonly parseError: string | null;
  readonly tree: WhenNodeModel | null;
  readonly invalidOverlay: string | null;
};

export function buildWhenExpressionBuilderModel(
  input: WhenExpressionBuilderModelInput,
): WhenExpressionBuilderModel {
  const parseResult = parseWhenExpressionDraft(input.expressionDraft);
  const parseError = parseResult.ok ? null : parseResult.message;
  return {
    title: "When",
    addConditionLabel: "Condition",
    addGroupLabel: "Group",
    expressionInput: {
      value: input.expressionDraft,
      placeholder: "Always",
      ariaLabel: "When expression",
      invalid: parseError !== null,
    },
    unknownWarning: buildUnknownWhenVariableWarning(
      parseResult.ok ? unknownWhenVariables(parseResult.value) : [],
    ),
    parseError,
    tree: input.value
      ? buildWhenNodeModel({
          node: input.value,
          variables: input.variables,
          path: [],
          removable: true,
        })
      : null,
    invalidOverlay: parseError ? "Fix the expression above to continue editing visually." : null,
  };
}

export type KeybindingDraft = {
  readonly keyDraft: string;
  readonly whenDraft: KeybindingWhenNode | undefined;
  readonly isRecording: boolean;
  readonly isWhenDraftValid: boolean;
};

export const EMPTY_KEYBINDING_DRAFT: KeybindingDraft = {
  keyDraft: "",
  whenDraft: undefined,
  isRecording: false,
  isWhenDraftValid: true,
};

export function createKeybindingDraft(row: KeybindingRow): KeybindingDraft {
  return {
    keyDraft: row.key,
    whenDraft: row.binding.whenAst,
    isRecording: false,
    isWhenDraftValid: true,
  };
}

export type KeybindingDraftIntent =
  | { readonly kind: "startRecording" }
  | { readonly kind: "stopRecording" }
  | { readonly kind: "typeKey"; readonly key: string }
  | { readonly kind: "captureKey"; readonly key: string }
  | { readonly kind: "cancelRecording"; readonly resetKey: string }
  | { readonly kind: "setWhen"; readonly when: KeybindingWhenNode | undefined }
  | { readonly kind: "setWhenValidity"; readonly valid: boolean };

export function resolveKeybindingDraftChange(
  draft: KeybindingDraft,
  intent: KeybindingDraftIntent,
): KeybindingDraft {
  switch (intent.kind) {
    case "startRecording":
      return { ...draft, isRecording: true };
    case "stopRecording":
      return { ...draft, isRecording: false };
    case "typeKey":
      return { ...draft, keyDraft: intent.key };
    case "captureKey":
      return { ...draft, keyDraft: intent.key, isRecording: false };
    case "cancelRecording":
      return { ...draft, keyDraft: intent.resetKey, isRecording: false };
    case "setWhen":
      return { ...draft, whenDraft: intent.when };
    case "setWhenValidity":
      return { ...draft, isWhenDraftValid: intent.valid };
  }
}

export type KeybindingCaptureEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export type KeybindingCaptureInput = {
  readonly event: KeybindingCaptureEvent;
  readonly isRecording: boolean;
  readonly platform: string;
  readonly resetKey: string;
};

export type KeybindingCaptureDecision =
  | { readonly kind: "passThrough" }
  | { readonly kind: "consume"; readonly intent: KeybindingDraftIntent | null };

export function resolveKeybindingCapture(input: KeybindingCaptureInput): KeybindingCaptureDecision {
  const { event } = input;
  if (event.key === "Tab" && !input.isRecording) return { kind: "passThrough" };
  if (event.key === "Escape") {
    return { kind: "consume", intent: { kind: "cancelRecording", resetKey: input.resetKey } };
  }
  const next = keybindingFromKeyboardEvent(event, input.platform);
  return { kind: "consume", intent: next ? { kind: "captureKey", key: next } : null };
}

export type KeybindingPillPart = {
  readonly key: string;
  readonly label: string;
};

export function buildKeybindingPillParts(
  value: string,
  platform: string,
): ReadonlyArray<KeybindingPillPart> {
  const isMac = platform.toLowerCase().includes("mac");
  const seenParts = new Map<string, number>();
  return value.split("+").map((part) => {
    const seen = seenParts.get(part) ?? 0;
    seenParts.set(part, seen + 1);
    return {
      key: seen === 0 ? part : `${part}-${seen}`,
      label:
        part === "mod"
          ? isMac
            ? "⌘"
            : "Ctrl"
          : part === "shift"
            ? "⇧"
            : part === "alt"
              ? isMac
                ? "⌥"
                : "Alt"
              : part === "ctrl"
                ? "⌃"
                : part.length === 1
                  ? part.toUpperCase()
                  : part,
    };
  });
}

export type KeybindingWhenTriggerModel = {
  readonly prefix: string;
  readonly ariaLabel: string;
  readonly expression: string;
  readonly display: string;
  readonly isSet: boolean;
};

export type KeybindingKeyInputModel = {
  readonly ariaLabel: string;
  readonly value: string;
  readonly placeholder: string;
};

export type KeybindingButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
};

function buildWhenTriggerModel(label: string, whenDraft: KeybindingWhenNode | undefined) {
  const expression = whenAstToExpression(whenDraft);
  return {
    prefix: "When",
    ariaLabel: `Edit when clause for ${label}`,
    expression,
    display: expression || "Always",
    isSet: expression.length > 0,
  } satisfies KeybindingWhenTriggerModel;
}

function buildKeyInputModel(label: string, draft: KeybindingDraft): KeybindingKeyInputModel {
  return {
    ariaLabel: `Keybinding for ${label}`,
    value: draft.isRecording ? "" : draft.keyDraft,
    placeholder: draft.isRecording ? "Press shortcut" : "Unassigned",
  };
}

export type KeybindingRowEditorModelInput = {
  readonly row: KeybindingRow;
  readonly allRows: ReadonlyArray<KeybindingRow>;
  readonly draft: KeybindingDraft;
  readonly platform: string;
  readonly isSaving: boolean;
};

export type KeybindingRowEditorModel = {
  readonly keyDraft: string;
  readonly isRecording: boolean;
  readonly isDirty: boolean;
  readonly when: KeybindingWhenTriggerModel;
  readonly conflictLabels: ReadonlyArray<string>;
  readonly conflictWarning: WhenWarningModel | null;
  readonly pill: {
    readonly ariaLabel: string;
    readonly parts: ReadonlyArray<KeybindingPillPart>;
  } | null;
  readonly keyInput: KeybindingKeyInputModel;
  readonly saveButton: KeybindingButtonModel | null;
};

export function buildKeybindingRowEditorModel(
  input: KeybindingRowEditorModelInput,
): KeybindingRowEditorModel {
  const { row, draft } = input;
  const label = commandLabel(row.command);
  const when = buildWhenTriggerModel(label, draft.whenDraft);
  const isDirty = draft.keyDraft !== row.key || when.expression !== row.when;
  const conflictLabels = keybindingConflictLabels(input.allRows, {
    rowId: row.id,
    key: draft.keyDraft,
    when: when.expression,
  });
  const showPill =
    !draft.isRecording && draft.keyDraft === row.key && row.key.length > 0 && !isDirty;
  return {
    keyDraft: draft.keyDraft,
    isRecording: draft.isRecording,
    isDirty,
    when,
    conflictLabels,
    conflictWarning: buildKeybindingConflictWarning(conflictLabels),
    pill: showPill
      ? {
          ariaLabel: `Edit shortcut for ${label}: ${formatShortcutLabel(row.binding.shortcut, input.platform)}`,
          parts: buildKeybindingPillParts(row.key, input.platform),
        }
      : null,
    keyInput: buildKeyInputModel(label, draft),
    saveButton: isDirty
      ? {
          label: input.isSaving ? "Saving" : "Save",
          disabled: input.isSaving || draft.keyDraft.trim().length === 0 || !draft.isWhenDraftValid,
        }
      : null,
  };
}

export type KeybindingCommandOptionModel = {
  readonly value: KeybindingCommand;
  readonly label: string;
};

export function resolveKeybindingCommandSelection(
  options: ReadonlyArray<KeybindingCommandOptionModel>,
  value: unknown,
): KeybindingCommand | null {
  return options.find((option) => option.value === value)?.value ?? null;
}

export type NewKeybindingDraft = {
  readonly command: KeybindingCommand | "";
  readonly draft: KeybindingDraft;
};

export const EMPTY_NEW_KEYBINDING_DRAFT: NewKeybindingDraft = {
  command: "",
  draft: EMPTY_KEYBINDING_DRAFT,
};

export type NewKeybindingModelInput = {
  readonly newBinding: NewKeybindingDraft;
  readonly allRows: ReadonlyArray<KeybindingRow>;
  readonly commandOptions: ReadonlyArray<KeybindingCommandOptionModel>;
  readonly isSaving: boolean;
};

export type NewKeybindingModel = {
  readonly title: string;
  readonly commandLabelText: string;
  readonly commandSelect: {
    readonly value: KeybindingCommand | "";
    readonly placeholder: string;
    readonly options: ReadonlyArray<KeybindingCommandOptionModel>;
  };
  readonly when: KeybindingWhenTriggerModel;
  readonly isRecording: boolean;
  readonly conflictLabels: ReadonlyArray<string>;
  readonly conflictWarning: WhenWarningModel | null;
  readonly keyInput: KeybindingKeyInputModel;
  readonly saveButton: KeybindingButtonModel;
  readonly cancelButton: {
    readonly ariaLabel: string;
    readonly tooltip: string;
    readonly disabled: boolean;
  };
};

export function buildNewKeybindingModel(input: NewKeybindingModelInput): NewKeybindingModel {
  const { command, draft } = input.newBinding;
  const commandLabelText = command ? commandLabel(command) : "new keybinding";
  const when = buildWhenTriggerModel(commandLabelText, draft.whenDraft);
  const conflictLabels = keybindingConflictLabels(input.allRows, {
    rowId: "new",
    key: draft.keyDraft,
    when: when.expression,
  });
  const canSave = Boolean(command) && draft.keyDraft.trim().length > 0 && draft.isWhenDraftValid;
  return {
    title: "New keybinding",
    commandLabelText,
    commandSelect: { value: command, placeholder: "Command", options: input.commandOptions },
    when,
    isRecording: draft.isRecording,
    conflictLabels,
    conflictWarning: buildKeybindingConflictWarning(conflictLabels),
    keyInput: buildKeyInputModel(commandLabelText, draft),
    saveButton: {
      label: input.isSaving ? "Saving" : "Save",
      disabled: input.isSaving || !canSave,
    },
    cancelButton: {
      ariaLabel: "Cancel new keybinding",
      tooltip: "Cancel",
      disabled: input.isSaving,
    },
  };
}

export type KeybindingRowMenuModel = {
  readonly triggerLabel: string;
  readonly disabled: boolean;
  readonly reset: KeybindingButtonModel | null;
  readonly remove: KeybindingButtonModel | null;
};

export type KeybindingRowModel = KeybindingRow & {
  readonly label: string;
  readonly commandTooltip: string;
  readonly sourceBadge: Exclude<KeybindingSource, "Default"> | null;
  readonly isSearchAnchor: boolean;
  readonly isSaving: boolean;
  readonly menu: KeybindingRowMenuModel | null;
  readonly editor: KeybindingRowEditorModel;
};

function buildKeybindingRowMenuModel(
  row: KeybindingRow,
  isSaving: boolean,
): KeybindingRowMenuModel | null {
  const canReset = row.source === "Custom" && row.defaultKey !== null;
  const canRemove = row.source !== "Default";
  if (!canReset && !canRemove) return null;
  return {
    triggerLabel: `Actions for ${commandLabel(row.command)}`,
    disabled: isSaving,
    reset: canReset ? { label: "Reset to default", disabled: isSaving } : null,
    remove: canRemove ? { label: "Remove", disabled: isSaving } : null,
  };
}

export type KeybindingsSettingsModelInput = {
  readonly serverKeybindings: ResolvedKeybindingsConfig | null;
  readonly keybindingsConfigPath: string | null;
  readonly query: string;
  readonly isSearchOpen: boolean;
  readonly isAddingBinding: boolean;
  readonly savingCommand: KeybindingCommand | null;
  readonly platform: string;
  readonly isElectron: boolean;
  readonly rowDrafts: Readonly<Record<string, KeybindingDraft>>;
  readonly newBinding: NewKeybindingDraft | null;
};

export type KeybindingsSettingsModel = {
  readonly sectionId: "keybindings";
  readonly bindingsCountLabel: string;
  readonly isSaving: boolean;
  readonly search: {
    readonly isOpen: boolean;
    readonly query: string;
    readonly label: string;
    readonly closeOnBlur: boolean;
  };
  readonly addButtonLabel: string;
  readonly openFileButton: {
    readonly label: string;
    readonly disabled: boolean;
    readonly path: string | null;
  };
  readonly browserNotice: string | null;
  readonly commandOptions: ReadonlyArray<KeybindingCommandOptionModel>;
  readonly whenVariables: ReadonlyArray<WhenVariableOption>;
  readonly rows: ReadonlyArray<KeybindingRowModel>;
  readonly newBinding: NewKeybindingModel | null;
  readonly emptyState: string | null;
};

export function buildKeybindingsSettingsModel(
  input: KeybindingsSettingsModelInput,
): KeybindingsSettingsModel {
  const keybindings = mergeWithDefaultKeybindings(input.serverKeybindings ?? []);
  const rows = buildKeybindingRows(keybindings, input.query);
  const commandOptions = buildKeybindingCommandOptions(keybindings).map((command) => ({
    value: command,
    label: commandLabel(command),
  }));
  const anchoredCommands = new Set<KeybindingCommand>();
  const rowModels = rows.map((row) => {
    const isSearchAnchor = !anchoredCommands.has(row.command);
    anchoredCommands.add(row.command);
    const isSaving = input.savingCommand === row.command;
    return {
      ...row,
      label: commandLabel(row.command),
      commandTooltip: row.command,
      sourceBadge: row.source === "Default" ? null : row.source,
      isSearchAnchor,
      isSaving,
      menu: buildKeybindingRowMenuModel(row, isSaving),
      editor: buildKeybindingRowEditorModel({
        row,
        allRows: rows,
        draft: input.rowDrafts[row.id] ?? createKeybindingDraft(row),
        platform: input.platform,
        isSaving,
      }),
    } satisfies KeybindingRowModel;
  });
  const count = rows.length + (input.isAddingBinding ? 1 : 0);
  return {
    sectionId: "keybindings",
    bindingsCountLabel: `${count} ${count === 1 ? "binding" : "bindings"}`,
    search: {
      isOpen: input.isSearchOpen,
      query: input.query,
      label: "Search keybindings",
      closeOnBlur: input.query.length === 0,
    },
    addButtonLabel: "Add keybinding",
    openFileButton: {
      label: "Open keybindings.json",
      disabled: !input.keybindingsConfigPath,
      path: input.keybindingsConfigPath,
    },
    browserNotice: input.isElectron
      ? null
      : "Some shortcuts may be claimed by the browser before T3 Code sees them. Use the desktop app for better keybinding support.",
    commandOptions,
    whenVariables: buildWhenVariableOptions(),
    rows: rowModels,
    newBinding: input.isAddingBinding
      ? buildNewKeybindingModel({
          newBinding: input.newBinding ?? EMPTY_NEW_KEYBINDING_DRAFT,
          allRows: rows,
          commandOptions,
          isSaving: input.savingCommand !== null,
        })
      : null,
    emptyState:
      rows.length === 0 && !input.isAddingBinding ? "No keybindings match your search." : null,
    isSaving: input.savingCommand !== null,
  };
}

export function resolveKeybindingsSearchTargetChange(targetId: string): {
  readonly clearQuery: boolean;
} {
  return { clearQuery: targetId.startsWith("keybinding-") };
}

export function isKeybindingsSearchShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  const isMod = event.metaKey || event.ctrlKey;
  return isMod && !event.altKey && event.key.toLowerCase() === "f";
}

export type KeybindingsChangeIntent =
  | { readonly kind: "save"; readonly row: KeybindingRow; readonly draft: KeybindingDraft }
  | { readonly kind: "saveNew"; readonly newBinding: NewKeybindingDraft }
  | { readonly kind: "reset"; readonly row: KeybindingRow }
  | { readonly kind: "remove"; readonly row: KeybindingRow };

export type KeybindingsChangeDecision =
  | { readonly kind: "none" }
  | { readonly kind: "upsert"; readonly input: ServerUpsertKeybindingInput }
  | { readonly kind: "remove"; readonly input: ServerRemoveKeybindingInput };

function keybindingRowTarget(row: KeybindingRow): ServerRemoveKeybindingInput {
  return {
    command: row.command,
    key: row.key,
    ...(row.when.trim().length > 0 ? { when: row.when } : {}),
  };
}

function keybindingUpsertInput(
  command: KeybindingCommand,
  key: string,
  when: string,
  replace: ServerRemoveKeybindingInput | null,
): ServerUpsertKeybindingInput {
  return {
    command,
    key: key.trim(),
    ...(when.trim() ? { when: when.trim() } : {}),
    ...(replace ? { replace } : {}),
  };
}

export function resolveKeybindingsChange(
  intent: KeybindingsChangeIntent,
): KeybindingsChangeDecision {
  switch (intent.kind) {
    case "save":
      return {
        kind: "upsert",
        input: keybindingUpsertInput(
          intent.row.command,
          intent.draft.keyDraft,
          whenAstToExpression(intent.draft.whenDraft),
          keybindingRowTarget(intent.row),
        ),
      };
    case "saveNew": {
      const { command, draft } = intent.newBinding;
      if (!command) return { kind: "none" };
      return {
        kind: "upsert",
        input: keybindingUpsertInput(
          command,
          draft.keyDraft,
          whenAstToExpression(draft.whenDraft),
          null,
        ),
      };
    }
    case "reset":
      if (!intent.row.defaultKey) return { kind: "none" };
      return {
        kind: "upsert",
        input: keybindingUpsertInput(
          intent.row.command,
          intent.row.defaultKey,
          intent.row.defaultWhen,
          keybindingRowTarget(intent.row),
        ),
      };
    case "remove":
      return { kind: "remove", input: keybindingRowTarget(intent.row) };
  }
}
