import {
  ChevronDownIcon,
  CircleXIcon,
  EllipsisIcon,
  FileJsonIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type KeybindingCommand,
  type KeybindingWhenNode,
  type ServerRemoveKeybindingInput,
  type ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { isElectron } from "../../env";
import { useOpenInPreferredEditor } from "../../editorPreferences";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useSettingsScope } from "./SettingsScopeContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle } from "../ui/toggle";
import { toastManager } from "../ui/toast";
import {
  buildKeybindingRowEditorModel,
  buildKeybindingsSettingsModel,
  buildNewKeybindingModel,
  buildWhenExpressionBuilderModel,
  createKeybindingDraft,
  EMPTY_KEYBINDING_DRAFT,
  isKeybindingsSearchShortcut,
  parseWhenExpressionDraft,
  resolveKeybindingCapture,
  resolveKeybindingCommandSelection,
  resolveKeybindingDraftChange,
  resolveKeybindingsChange,
  resolveKeybindingsSearchTargetChange,
  resolveWhenExpressionEdit,
  resolveWhenNodeEdit,
  resolveWhenOperatorSelection,
  type KeybindingDraft,
  type KeybindingDraftIntent,
  type KeybindingRowEditorModel,
  type NewKeybindingModel,
  type KeybindingCommandOptionModel,
  type KeybindingRow,
  type KeybindingRowModel,
  type KeybindingPillPart,
  type KeybindingsChangeIntent,
  type KeybindingsSettingsModel,
  type KeybindingWhenTriggerModel,
  type WhenExpressionEdit,
  type WhenNodeEdit,
  type WhenNodeModel,
  type WhenVariableOption,
  type WhenWarningModel,
  whenAstToExpression,
} from "./KeybindingsSettings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { keybindingSearchAnchorId, searchableSetting } from "./settingsSearch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useAtomCommand } from "../../state/use-atom-command";

function KeybindingPill({ parts }: { parts: ReadonlyArray<KeybindingPillPart> }) {
  return (
    <KbdGroup>
      {parts.map(({ key, label }) => (
        <Kbd key={key}>{label}</Kbd>
      ))}
    </KbdGroup>
  );
}

function ExpandableHeaderSearch({
  query,
  label,
  closeOnBlur,
  onChange,
  isOpen,
  onOpenChange,
  inputRef,
  collapsedAccessory,
}: {
  query: string;
  label: string;
  closeOnBlur: boolean;
  onChange: (next: string) => void;
  isOpen: boolean;
  onOpenChange: (next: boolean) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  collapsedAccessory?: ReactNode;
}) {
  if (!isOpen) {
    return (
      <>
        {collapsedAccessory}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                onClick={() => onOpenChange(true)}
                aria-label={label}
              >
                <SearchIcon />
              </Button>
            }
          />
          <TooltipPopup side="top">{label}</TooltipPopup>
        </Tooltip>
      </>
    );
  }

  return (
    <InputGroup className="w-44">
      <InputGroupAddon>
        <SearchIcon aria-hidden className="size-3" />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        autoFocus
        type="search"
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={() => {
          if (closeOnBlur) onOpenChange(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange("");
            onOpenChange(false);
          }
        }}
        placeholder={label}
        aria-label={label}
        size="sm"
      />
    </InputGroup>
  );
}

/** Warning glyph whose explanation lives in a tooltip; the one owner of that affordance here. */
function WarningTooltipIcon({
  label,
  focusable = true,
  className,
  children,
}: {
  label: string;
  focusable?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={focusable ? 0 : undefined}
            aria-label={label}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-warning outline-none transition-colors hover:bg-warning/10 focus-visible:ring-3 focus-visible:ring-warning/25",
              className,
            )}
          />
        }
      >
        <TriangleAlertIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{children}</TooltipPopup>
    </Tooltip>
  );
}

function UnknownWhenVariableWarning({
  warning,
  focusable = true,
}: {
  warning: WhenWarningModel | null;
  focusable?: boolean;
}) {
  if (!warning) return null;

  return (
    <WarningTooltipIcon label={warning.label} focusable={focusable} className="size-4.5">
      {warning.tooltip}
    </WarningTooltipIcon>
  );
}

function KeybindingConflictWarning({ warning }: { warning: WhenWarningModel | null }) {
  if (!warning) return null;

  return <WarningTooltipIcon label={warning.label}>{warning.tooltip}</WarningTooltipIcon>;
}

function WhenVariableSelect({
  value,
  options,
  placeholder,
  unknownWarning,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<WhenVariableOption>;
  placeholder: string;
  unknownWarning: WhenWarningModel | null;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => nextValue && onChange(nextValue)}>
      <SelectTrigger size="compact" className="min-w-0 flex-1">
        <SelectValue placeholder={placeholder} />
        <UnknownWhenVariableWarning warning={unknownWarning} focusable={false} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} matchTriggerWidth={false} className="max-h-72">
        {options.map((option) => (
          <SelectItem key={option} value={option} className="w-full">
            <span className="truncate">{option}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WhenExpressionRemoveButton({
  label,
  className,
  onRemove,
}: {
  label: string;
  className?: string | undefined;
  onRemove: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("size-7", className)}
            aria-label={label}
            onClick={onRemove}
          />
        }
      >
        <MinusIcon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function WhenExpressionNodeEditor({
  model,
  onChange,
  onRemove,
}: {
  model: WhenNodeModel;
  onChange: (node: KeybindingWhenNode) => void;
  onRemove?: () => void;
}) {
  const applyEdit = (edit: WhenNodeEdit) => {
    const next = resolveWhenNodeEdit(model.node, edit);
    if (next) onChange(next);
  };

  if (model.kind === "condition") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 py-2">
        <Toggle
          pressed={model.negated}
          onPressedChange={(pressed) => applyEdit({ kind: "setNegated", negated: pressed })}
          aria-label={model.negateLabel}
          variant="outline"
          size="compact"
          className="min-w-10"
        >
          {model.negateText}
        </Toggle>
        <WhenVariableSelect
          value={model.identifier}
          options={model.options}
          placeholder={model.placeholder}
          unknownWarning={model.unknownWarning}
          onChange={(identifier) => applyEdit({ kind: "setIdentifier", identifier })}
        />
        {onRemove && model.remove ? (
          <WhenExpressionRemoveButton label={model.remove.label} onRemove={onRemove} />
        ) : null}
      </div>
    );
  }

  if (model.kind === "not") {
    return (
      <div
        className={cn(
          "space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2",
          model.depth > 0 && "border-border/50 bg-background/50",
        )}
      >
        <div className="flex items-center gap-2">
          <Toggle
            pressed
            onPressedChange={(pressed) => applyEdit({ kind: "setNegated", negated: pressed })}
            aria-label={model.negateLabel}
            variant="outline"
            size="compact"
            className="min-w-10"
          >
            {model.negateText}
          </Toggle>
          {onRemove && model.remove ? (
            <WhenExpressionRemoveButton
              label={model.remove.label}
              className="ml-auto"
              onRemove={onRemove}
            />
          ) : null}
        </div>
        <div className="relative pl-4">
          <span className="absolute top-0 bottom-0 left-1.5 w-px bg-border/70" aria-hidden />
          <span className="absolute top-4 left-1.5 h-px w-2.5 bg-border/70" aria-hidden />
          <WhenExpressionNodeEditor
            model={model.child}
            onChange={(next) => applyEdit({ kind: "replaceChild", index: 0, next })}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60 bg-muted/10 p-2",
        model.depth > 0 && "border-border/70 bg-background/55",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={model.operator}
          onValueChange={(value) => {
            const operator = resolveWhenOperatorSelection(value);
            if (operator) applyEdit({ kind: "setOperator", operator });
          }}
        >
          <SelectTrigger size="compact" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} matchTriggerWidth={false}>
            {model.operatorOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="compact"
          onClick={() => applyEdit({ kind: "addCondition" })}
        >
          <PlusIcon className="size-3.5" />
          {model.addConditionLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="compact"
          onClick={() => applyEdit({ kind: "addGroup" })}
        >
          <PlusIcon className="size-3.5" />
          {model.addGroupLabel}
        </Button>
        {onRemove && model.remove ? (
          <WhenExpressionRemoveButton
            label={model.remove.label}
            className="ml-auto"
            onRemove={onRemove}
          />
        ) : null}
      </div>
      <div className="space-y-2">
        {model.children.map(({ key, model: child }, index) => (
          <div key={key} className="relative pl-4">
            <span
              className={cn(
                "absolute top-0 bottom-0 left-1.5 w-px",
                model.depth === 0 ? "bg-border" : "bg-border/70",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "absolute top-4 left-1.5 h-px w-2.5",
                model.depth === 0 ? "bg-border" : "bg-border/70",
              )}
              aria-hidden
            />
            <WhenExpressionNodeEditor
              model={child}
              onChange={(next) => applyEdit({ kind: "replaceChild", index, next })}
              onRemove={() => applyEdit({ kind: "removeChild", index })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function WhenExpressionBuilder({
  value,
  variables,
  onChange,
  onValidityChange,
}: {
  value: KeybindingWhenNode | undefined;
  variables: ReadonlyArray<WhenVariableOption>;
  onChange: (value: KeybindingWhenNode | undefined) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [expressionDraft, setExpressionDraft] = useState(() => whenAstToExpression(value));
  const model = useMemo(
    () => buildWhenExpressionBuilderModel({ value, expressionDraft, variables }),
    [value, expressionDraft, variables],
  );

  const updateExpressionDraft = (nextExpression: string) => {
    setExpressionDraft(nextExpression);
    const nextResult = parseWhenExpressionDraft(nextExpression);
    onValidityChange?.(nextResult.ok);
    if (nextResult.ok) {
      onChange(nextResult.value);
    }
  };

  const updateExpressionValue = (nextValue: KeybindingWhenNode | undefined) => {
    setExpressionDraft(whenAstToExpression(nextValue));
    onValidityChange?.(true);
    onChange(nextValue);
  };

  const applyRootEdit = (edit: WhenExpressionEdit) => {
    const result = resolveWhenExpressionEdit(value, edit);
    if (result.kind === "changed") updateExpressionValue(result.value);
  };

  return (
    <div className="w-[min(34rem,calc(100vw-2rem))] space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{model.title}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() => applyRootEdit({ kind: "addRootCondition" })}
          >
            <PlusIcon className="size-3.5" />
            {model.addConditionLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() => applyRootEdit({ kind: "addRootGroup" })}
          >
            <PlusIcon className="size-3.5" />
            {model.addGroupLabel}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <InputGroup>
          <InputGroupInput
            value={model.expressionInput.value}
            onChange={(event) => updateExpressionDraft(event.currentTarget.value)}
            placeholder={model.expressionInput.placeholder}
            aria-invalid={model.expressionInput.invalid}
            aria-label={model.expressionInput.ariaLabel}
            size="compact"
            font="mono"
          />
          {model.unknownWarning ? (
            <InputGroupAddon align="inline-end">
              <UnknownWhenVariableWarning warning={model.unknownWarning} />
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        {model.parseError ? (
          <div className="flex items-center gap-1.5 text-2xs text-destructive">
            <CircleXIcon className="size-3.5" />
            {model.parseError}
          </div>
        ) : null}
      </div>

      <div className="relative">
        {model.tree ? (
          <WhenExpressionNodeEditor
            model={model.tree}
            onChange={updateExpressionValue}
            onRemove={() => applyRootEdit({ kind: "clear" })}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border/80 bg-muted/15 p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="compact"
                onClick={() => applyRootEdit({ kind: "addRootCondition" })}
              >
                <PlusIcon className="size-3.5" />
                {model.addConditionLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="compact"
                onClick={() => applyRootEdit({ kind: "addRootGroup" })}
              >
                <PlusIcon className="size-3.5" />
                {model.addGroupLabel}
              </Button>
            </div>
          </div>
        )}
        {model.invalidOverlay ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-destructive/30 bg-background/75 p-4 text-center text-xs text-destructive backdrop-blur-xs">
            {model.invalidOverlay}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type KeybindingRowEditor = {
  draft: KeybindingDraft;
  model: KeybindingRowEditorModel;
  dispatch: (intent: KeybindingDraftIntent) => void;
  save: () => void;
  captureKeybinding: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/** Draft state and actions for editing one existing binding; layouts decide how to render it. */
function useKeybindingRowEditor({
  row,
  allRows,
  onChange,
}: {
  row: KeybindingRowModel;
  allRows: ReadonlyArray<KeybindingRow>;
  onChange: (intent: KeybindingsChangeIntent) => void;
}): KeybindingRowEditor {
  const [draft, dispatch] = useReducer(resolveKeybindingDraftChange, row, createKeybindingDraft);
  const model = buildKeybindingRowEditorModel({
    row,
    allRows,
    draft,
    platform: navigator.platform,
    isSaving: row.isSaving,
  });

  const save = () => onChange({ kind: "save", row, draft });

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    const decision = resolveKeybindingCapture({
      event: event.nativeEvent,
      isRecording: draft.isRecording,
      platform: navigator.platform,
      resetKey: row.key,
    });
    if (decision.kind === "passThrough") return;
    event.preventDefault();
    if (decision.intent) dispatch(decision.intent);
  };

  return { draft, model, dispatch, save, captureKeybinding };
}

type KeybindingRowProps = {
  row: KeybindingRowModel;
  allRows: ReadonlyArray<KeybindingRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  anchorId?: string | undefined;
  onChange: (intent: KeybindingsChangeIntent) => void;
};

/** Shortcut pill that turns into a capture input when clicked, plus Save once the draft changes. */
function KeybindingKeyControl({
  editor,
  pillClassName,
}: {
  editor: KeybindingRowEditor;
  pillClassName?: string | undefined;
}) {
  const { model, dispatch, save, captureKeybinding } = editor;

  return (
    <>
      {model.saveButton ? (
        <Button size="sm" disabled={model.saveButton.disabled} onClick={save}>
          {model.saveButton.label}
        </Button>
      ) : null}
      {model.pill ? (
        <button
          type="button"
          onClick={() => dispatch({ kind: "startRecording" })}
          aria-label={model.pill.ariaLabel}
          className={cn(
            "inline-flex h-8 cursor-pointer items-center rounded-md border border-transparent px-1.5 sm:h-7 outline-none transition-colors hover:border-border/70 hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24",
            pillClassName,
          )}
        >
          <KeybindingPill parts={model.pill.parts} />
        </button>
      ) : (
        <Input
          data-keybinding-capture=""
          autoFocus={model.isRecording}
          aria-label={model.keyInput.ariaLabel}
          value={model.keyInput.value}
          placeholder={model.keyInput.placeholder}
          size="sm"
          font="mono"
          className="w-44"
          onFocus={() => dispatch({ kind: "startRecording" })}
          onBlur={() => dispatch({ kind: "stopRecording" })}
          onChange={(event) => dispatch({ kind: "typeKey", key: event.currentTarget.value })}
          onKeyDown={captureKeybinding}
        />
      )}
    </>
  );
}

/** Quiet inline trigger showing the when clause; opens the expression builder. */
function WhenClauseControl({
  trigger,
  value,
  variables,
  onChange,
  onValidityChange,
}: {
  trigger: KeybindingWhenTriggerModel;
  value: KeybindingWhenNode | undefined;
  variables: ReadonlyArray<WhenVariableOption>;
  onChange: (value: KeybindingWhenNode | undefined) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={trigger.isSet ? "ghost" : "ghost-muted"}
            size="micro"
            className="min-w-0 shrink"
          />
        }
        aria-label={trigger.ariaLabel}
      >
        <span className="truncate font-mono">{trigger.display}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6}>
        <WhenExpressionBuilder
          value={value}
          variables={variables}
          onChange={onChange}
          onValidityChange={onValidityChange}
        />
      </PopoverContent>
    </Popover>
  );
}

function KeybindingRowMenu({
  row,
  onChange,
}: {
  row: KeybindingRowModel;
  onChange: (intent: KeybindingsChangeIntent) => void;
}) {
  const { menu } = row;
  if (!menu) return null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-sm"
            disabled={menu.disabled}
            aria-label={menu.triggerLabel}
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {menu.reset ? (
          <MenuItem disabled={menu.reset.disabled} onClick={() => onChange({ kind: "reset", row })}>
            {menu.reset.label}
          </MenuItem>
        ) : null}
        {menu.remove ? (
          <MenuItem
            variant="destructive"
            disabled={menu.remove.disabled}
            onClick={() => onChange({ kind: "remove", row })}
          >
            {menu.remove.label}
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function KeybindingSourceBadge({ badge }: { badge: KeybindingRowModel["sourceBadge"] }) {
  if (!badge) return null;
  return (
    <Badge variant="outline" size="sm">
      {badge}
    </Badge>
  );
}

function KeybindingRowTitle({ row }: { row: KeybindingRowModel }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex items-center gap-2" />}>
        {row.label}
        <KeybindingSourceBadge badge={row.sourceBadge} />
      </TooltipTrigger>
      <TooltipPopup side="top">{row.commandTooltip}</TooltipPopup>
    </Tooltip>
  );
}

function KeybindingRowWhen({
  editor,
  variables,
}: {
  editor: KeybindingRowEditor;
  variables: ReadonlyArray<WhenVariableOption>;
}) {
  return (
    <span className="flex h-6 items-center gap-1.5">
      <span className="text-xs leading-none text-muted-foreground/70">
        {editor.model.when.prefix}
      </span>
      <WhenClauseControl
        trigger={editor.model.when}
        value={editor.draft.whenDraft}
        variables={variables}
        onChange={(when) => editor.dispatch({ kind: "setWhen", when })}
        onValidityChange={(valid) => editor.dispatch({ kind: "setWhenValidity", valid })}
      />
    </span>
  );
}

/** Row actions that stay hidden until the row is hovered or holds focus. */
function KeybindingHoverRowMenu(props: {
  row: KeybindingRowModel;
  onChange: (intent: KeybindingsChangeIntent) => void;
}) {
  return (
    <span className="flex items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
      <KeybindingRowMenu {...props} />
    </span>
  );
}

/** One binding as a settings row: pills flush right, actions fading in beside them on hover. */
function KeybindingSettingsRow(props: KeybindingRowProps) {
  const { row, anchorId, allRows, variables, onChange } = props;
  const editor = useKeybindingRowEditor({ row, allRows, onChange });

  return (
    <SettingsRow
      id={anchorId}
      className="group/row rounded-none"
      title={<KeybindingRowTitle row={row} />}
      description={<KeybindingRowWhen editor={editor} variables={variables} />}
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <KeybindingConflictWarning warning={editor.model.conflictWarning} />
          <KeybindingHoverRowMenu row={row} onChange={onChange} />
          <KeybindingKeyControl editor={editor} pillClassName="-mr-1.5" />
        </div>
      }
    />
  );
}

type NewKeybindingDraftEditor = {
  draft: KeybindingDraft;
  model: NewKeybindingModel;
  dispatch: (intent: KeybindingDraftIntent) => void;
  save: () => void;
  selectCommand: (value: unknown) => void;
  captureKeybinding: (event: KeyboardEvent<HTMLInputElement>) => void;
};

/** Draft state for a binding that does not exist yet. */
function useNewKeybindingDraft({
  allRows,
  commandOptions,
  isSaving,
  onChange,
}: {
  allRows: ReadonlyArray<KeybindingRow>;
  commandOptions: ReadonlyArray<KeybindingCommandOptionModel>;
  isSaving: boolean;
  onChange: (intent: KeybindingsChangeIntent) => void;
}): NewKeybindingDraftEditor {
  const [command, setCommand] = useState<KeybindingCommand | "">("");
  const [draft, dispatch] = useReducer(resolveKeybindingDraftChange, EMPTY_KEYBINDING_DRAFT);
  const newBinding = { command, draft };
  const model = buildNewKeybindingModel({ newBinding, allRows, commandOptions, isSaving });

  const save = () => onChange({ kind: "saveNew", newBinding });

  const selectCommand = (value: unknown) => {
    const next = resolveKeybindingCommandSelection(commandOptions, value);
    if (next) setCommand(next);
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    const decision = resolveKeybindingCapture({
      event: event.nativeEvent,
      isRecording: draft.isRecording,
      platform: navigator.platform,
      resetKey: "",
    });
    if (decision.kind === "passThrough") return;
    event.preventDefault();
    if (decision.intent) dispatch(decision.intent);
  };

  return { draft, model, dispatch, save, selectCommand, captureKeybinding };
}

type NewKeybindingProps = {
  commandOptions: ReadonlyArray<KeybindingCommandOptionModel>;
  allRows: ReadonlyArray<KeybindingRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  isSaving: boolean;
  onChange: (intent: KeybindingsChangeIntent) => void;
  onCancel: () => void;
};

function NewKeybindingCommandSelect({
  draft,
  className,
}: {
  draft: NewKeybindingDraftEditor;
  className?: string | undefined;
}) {
  const { commandSelect } = draft.model;
  return (
    <Select value={commandSelect.value} onValueChange={draft.selectCommand}>
      <SelectTrigger size="sm" className={className}>
        <SelectValue placeholder={commandSelect.placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} matchTriggerWidth={false} className="max-h-72">
        {commandSelect.options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="w-full">
            <span className="truncate">{option.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NewKeybindingKeyInput({
  draft,
  autoFocus = false,
  className,
}: {
  draft: NewKeybindingDraftEditor;
  autoFocus?: boolean;
  className?: string | undefined;
}) {
  const { keyInput } = draft.model;
  return (
    <Input
      data-keybinding-capture=""
      autoFocus={autoFocus}
      aria-label={keyInput.ariaLabel}
      value={keyInput.value}
      placeholder={keyInput.placeholder}
      size="sm"
      font="mono"
      className={className}
      onFocus={() => draft.dispatch({ kind: "startRecording" })}
      onBlur={() => draft.dispatch({ kind: "stopRecording" })}
      onChange={(event) => draft.dispatch({ kind: "typeKey", key: event.currentTarget.value })}
      onKeyDown={draft.captureKeybinding}
    />
  );
}

function NewKeybindingWhen({
  draft,
  variables,
}: {
  draft: NewKeybindingDraftEditor;
  variables: ReadonlyArray<WhenVariableOption>;
}) {
  return (
    <WhenClauseControl
      trigger={draft.model.when}
      value={draft.draft.whenDraft}
      variables={variables}
      onChange={(when) => draft.dispatch({ kind: "setWhen", when })}
      onValidityChange={(valid) => draft.dispatch({ kind: "setWhenValidity", valid })}
    />
  );
}

function NewKeybindingCancelIcon({
  button,
  onCancel,
}: {
  button: { ariaLabel: string; tooltip: string; disabled: boolean };
  onCancel: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-sm"
            disabled={button.disabled}
            aria-label={button.ariaLabel}
            onClick={onCancel}
          />
        }
      >
        <XIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{button.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

/** Add-binding form shaped like the binding rows below it. */
function NewKeybindingSettingsRow(props: NewKeybindingProps) {
  const { commandOptions, allRows, variables, isSaving, onChange, onCancel } = props;
  const draft = useNewKeybindingDraft({ allRows, commandOptions, isSaving, onChange });
  const { model } = draft;

  return (
    <SettingsRow
      className="rounded-none bg-muted/15"
      title={model.title}
      description={
        <span className="flex h-6 items-center gap-1.5">
          <span className="text-xs leading-none text-muted-foreground/70">{model.when.prefix}</span>
          <NewKeybindingWhen draft={draft} variables={variables} />
        </span>
      }
      control={
        <div className="flex flex-wrap items-center gap-2">
          <NewKeybindingCommandSelect draft={draft} className="w-56" />
          <KeybindingConflictWarning warning={model.conflictWarning} />
          <NewKeybindingKeyInput draft={draft} className="w-44" />
          <Button size="sm" disabled={model.saveButton.disabled} onClick={draft.save}>
            {model.saveButton.label}
          </Button>
          <NewKeybindingCancelIcon button={model.cancelButton} onCancel={onCancel} />
        </div>
      }
    />
  );
}

type KeybindingsListProps = {
  model: KeybindingsSettingsModel;
  onChange: (intent: KeybindingsChangeIntent) => void;
  onCancelAdd: () => void;
};

/** The add-binding row, one settings row per binding, and the empty state. */
function KeybindingsList(props: KeybindingsListProps) {
  const { model, onChange, onCancelAdd } = props;
  const newProps: NewKeybindingProps = {
    commandOptions: model.commandOptions,
    allRows: model.rows,
    variables: model.whenVariables,
    isSaving: model.isSaving,
    onChange,
    onCancel: onCancelAdd,
  };
  return (
    <div>
      {model.newBinding ? <NewKeybindingSettingsRow {...newProps} /> : null}
      {model.rows.map((row) => (
        <KeybindingSettingsRow
          key={row.id}
          row={row}
          anchorId={row.isSearchAnchor ? keybindingSearchAnchorId(row.command) : undefined}
          allRows={model.rows}
          variables={model.whenVariables}
          onChange={onChange}
        />
      ))}
      {model.emptyState ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          {model.emptyState}
        </div>
      ) : null}
    </div>
  );
}

/** Shown in the browser build only; the desktop app receives every shortcut. */
function BrowserKeybindingNotice({ notice }: { notice: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 text-xs leading-normal text-muted-foreground sm:px-4">
      <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden />
      <span>{notice}</span>
    </div>
  );
}

export function KeybindingsSettingsPanel() {
  // The representative environment supplies the displayed bindings; edits
  // fan out to every connected environment in the selection, so one
  // shortcut change reaches each machine the user runs T3 Code on.
  const { environment: primaryEnvironment, connectedEnvironments } = useSettingsScope();
  const serverKeybindings = primaryEnvironment?.serverConfig?.keybindings ?? null;
  const keybindingsConfigPath = primaryEnvironment?.serverConfig?.keybindingsConfigPath ?? null;
  const availableEditors = primaryEnvironment?.serverConfig?.availableEditors ?? [];
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });
  const removeKeybindingMutation = useAtomCommand(serverEnvironment.removeKeybinding, {
    reportFailure: false,
  });
  const openInPreferredEditor = useOpenInPreferredEditor(
    primaryEnvironment?.environmentId ?? null,
    availableEditors,
  );
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [savingCommand, setSavingCommand] = useState<KeybindingCommand | null>(null);
  const [isAddingBinding, setIsAddingBinding] = useState(false);
  const model = useMemo(
    () =>
      buildKeybindingsSettingsModel({
        serverKeybindings,
        keybindingsConfigPath,
        query,
        isSearchOpen,
        isAddingBinding,
        savingCommand,
        platform: navigator.platform,
        isElectron,
        rowDrafts: {},
        newBinding: null,
      }),
    [serverKeybindings, keybindingsConfigPath, query, isSearchOpen, isAddingBinding, savingCommand],
  );
  // The search-target context is provided by this panel's own page container,
  // so the jump target is read from the route hash here.
  const searchTargetId = useLocation({ select: (location) => location.hash.replace(/^#/, "") });
  const [handledSearchTargetId, setHandledSearchTargetId] = useState(searchTargetId);

  // A settings-search jump must not be hidden by the page's own filter.
  if (searchTargetId !== handledSearchTargetId) {
    setHandledSearchTargetId(searchTargetId);
    if (resolveKeybindingsSearchTargetChange(searchTargetId).clearQuery) setQuery("");
  }

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isKeybindingsSearchShortcut(event)) return;

      const target = event.target;
      if (
        target !== searchInputRef.current &&
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      setIsSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    void (async () => {
      const result = await openInPreferredEditor(keybindingsConfigPath);
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        title: "Unable to open keybindings file",
        description:
          error instanceof Error ? error.message : "The keybindings file was not opened.",
        type: "error",
      });
    })();
  }, [keybindingsConfigPath, openInPreferredEditor]);

  const saveKeybinding = useCallback(
    (payload: ServerUpsertKeybindingInput) => {
      if (!primaryEnvironment) return;
      setSavingCommand(payload.command);
      void (async () => {
        const results = await Promise.all(
          connectedEnvironments.map((target) =>
            upsertKeybinding({ environmentId: target.environmentId, input: payload }),
          ),
        );
        setSavingCommand(null);
        const failed = results.find((result) => result._tag === "Failure");
        if (!failed) {
          setIsAddingBinding(false);
          return;
        }
        if (!isAtomCommandInterrupted(failed)) {
          const error = squashAtomCommandFailure(failed);
          toastManager.add({
            title: "Unable to save keybinding",
            description: error instanceof Error ? error.message : "The keybinding was not saved.",
            type: "error",
          });
        }
      })();
    },
    [connectedEnvironments, primaryEnvironment, upsertKeybinding],
  );

  const removeKeybinding = useCallback(
    (input: ServerRemoveKeybindingInput) => {
      if (!primaryEnvironment) return;
      setSavingCommand(input.command);
      void (async () => {
        const results = await Promise.all(
          connectedEnvironments.map((target) =>
            removeKeybindingMutation({
              environmentId: target.environmentId,
              input,
            }),
          ),
        );
        setSavingCommand(null);
        const result = results.find((entry) => entry._tag === "Failure") ?? results[0];
        if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            title: "Unable to remove keybinding",
            description: error instanceof Error ? error.message : "The keybinding was not removed.",
            type: "error",
          });
        }
      })();
    },
    [connectedEnvironments, primaryEnvironment, removeKeybindingMutation],
  );

  const applyKeybindingsChange = useCallback(
    (intent: KeybindingsChangeIntent) => {
      const decision = resolveKeybindingsChange(intent);
      if (decision.kind === "upsert") saveKeybinding(decision.input);
      if (decision.kind === "remove") removeKeybinding(decision.input);
    },
    [removeKeybinding, saveKeybinding],
  );

  const cancelAdd = useCallback(() => setIsAddingBinding(false), []);

  const bindingsCount = (
    <span className="text-2xs text-muted-foreground">{model.bindingsCountLabel}</span>
  );

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("keybindings")}
        headerAction={
          <div className="flex items-center gap-1.5">
            <ExpandableHeaderSearch
              query={model.search.query}
              label={model.search.label}
              closeOnBlur={model.search.closeOnBlur}
              onChange={setQuery}
              isOpen={model.search.isOpen}
              onOpenChange={setIsSearchOpen}
              inputRef={searchInputRef}
              collapsedAccessory={bindingsCount}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    onClick={() => setIsAddingBinding(true)}
                    aria-label={model.addButtonLabel}
                  >
                    <PlusIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">{model.addButtonLabel}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={model.openFileButton.disabled}
                    onClick={openKeybindingsFile}
                    aria-label={model.openFileButton.label}
                  >
                    <FileJsonIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">{model.openFileButton.label}</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {model.browserNotice ? <BrowserKeybindingNotice notice={model.browserNotice} /> : null}

        <KeybindingsList model={model} onChange={applyKeybindingsChange} onCancelAdd={cancelAdd} />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
