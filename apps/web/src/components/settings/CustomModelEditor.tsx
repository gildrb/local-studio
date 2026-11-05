"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProviderDriverKind, ServerProviderModel } from "@t3tools/contracts";
import type { CustomModelDefinition } from "@t3tools/shared/model";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  type CustomModelDraft,
  type CustomModelEditorChoiceRow,
  type CustomModelEditorDescriptorRow,
  type CustomModelEditorIntent,
  buildCustomModelEditorModel,
  draftFromDefinition,
  resolveCustomModelEditorChange,
  resolveCustomModelEditorSubmit,
} from "./customModelEditor.logic";

interface CustomModelEditorProps {
  readonly instanceId: string;
  readonly driverKind: ProviderDriverKind | null;
  readonly entry: CustomModelDefinition;
  /** Built-in models whose descriptors can be copied as a starting point. */
  readonly builtInModels: ReadonlyArray<ServerProviderModel>;
  readonly onSave: (next: CustomModelDefinition) => void;
  readonly onCancel: () => void;
}

/**
 * Inline editor for one custom model: display name plus the option
 * descriptors the composer should offer for it (Reasoning effort, Fast
 * mode, ...). Draft state is local; nothing is persisted until Save.
 */
export function CustomModelEditor({
  instanceId,
  driverKind,
  entry,
  builtInModels,
  onSave,
  onCancel,
}: CustomModelEditorProps) {
  const [draft, setDraft] = useState<CustomModelDraft>(() => draftFromDefinition(entry));
  const [error, setError] = useState<string | null>(null);
  const model = useMemo(
    () => buildCustomModelEditorModel({ instanceId, driverKind, builtInModels, draft, error }),
    [builtInModels, draft, driverKind, error, instanceId],
  );

  const dispatch = (intent: CustomModelEditorIntent) => {
    const change = resolveCustomModelEditorChange({ driverKind, builtInModels, draft }, intent);
    if (change.kind === "none") return;
    if (change.clearError) setError(null);
    setDraft(change.draft);
  };

  const handleSave = () => {
    const submit = resolveCustomModelEditorSubmit(draft);
    if (submit.kind === "invalid") {
      setError(submit.error);
      return;
    }
    onSave(submit.definition);
  };

  const renderChoice = (
    descriptor: CustomModelEditorDescriptorRow,
    choice: CustomModelEditorChoiceRow,
  ) => (
    <div key={choice.key} className="flex items-center gap-2">
      <Input
        size="compact"
        value={choice.value}
        onChange={(event) =>
          dispatch({
            kind: "set-choice-id",
            descriptorKey: descriptor.key,
            choiceKey: choice.key,
            id: event.target.value,
          })
        }
        placeholder={choice.valuePlaceholder}
        font="mono"
        className="w-28"
        spellCheck={false}
        aria-label={choice.valueAriaLabel}
      />
      <Input
        size="compact"
        value={choice.label}
        onChange={(event) =>
          dispatch({
            kind: "set-choice-label",
            descriptorKey: descriptor.key,
            choiceKey: choice.key,
            label: event.target.value,
          })
        }
        placeholder={choice.labelPlaceholder}
        className="min-w-0 flex-1"
        aria-label={choice.labelAriaLabel}
      />
      <label className="flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <Switch
          size="sm"
          checked={choice.isDefault}
          onCheckedChange={(checked) =>
            dispatch({
              kind: "set-choice-default",
              descriptorKey: descriptor.key,
              choiceKey: choice.key,
              isDefault: checked,
            })
          }
          aria-label={choice.defaultAriaLabel}
        />
        {choice.defaultLabel}
      </label>
      <Button
        size="icon-micro"
        variant="ghost-muted"
        aria-label={choice.removeAriaLabel}
        onClick={() =>
          dispatch({ kind: "remove-choice", descriptorKey: descriptor.key, choiceKey: choice.key })
        }
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );

  const renderDescriptor = (descriptor: CustomModelEditorDescriptorRow) => (
    <div
      key={descriptor.key}
      className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 shrink-0 text-2xs text-muted-foreground">
          {descriptor.positionLabel}
        </span>
        {descriptor.idSelect.visible ? (
          <Select
            value={descriptor.idSelect.value}
            onValueChange={(value) =>
              dispatch({ kind: "select-descriptor-preset", descriptorKey: descriptor.key, value })
            }
          >
            <SelectTrigger
              size="compact"
              className="w-40"
              aria-label={descriptor.idSelect.ariaLabel}
            >
              <SelectValue>{descriptor.idSelect.displayLabel}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {descriptor.idSelect.presetOptions.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  <span className="flex items-baseline gap-2">
                    <code className="font-mono text-xs">{preset.value}</code>
                    <span className="text-muted-foreground">{preset.label}</span>
                  </span>
                </SelectItem>
              ))}
              <SelectItem value={descriptor.idSelect.customOption.value}>
                {descriptor.idSelect.customOption.label}
              </SelectItem>
            </SelectPopup>
          </Select>
        ) : null}
        {descriptor.idInput.visible ? (
          <Input
            size="compact"
            value={descriptor.idInput.value}
            onChange={(event) =>
              dispatch({
                kind: "set-descriptor-id",
                descriptorKey: descriptor.key,
                id: event.target.value,
              })
            }
            placeholder={descriptor.idInput.placeholder}
            font="mono"
            className="w-36"
            spellCheck={false}
            aria-label={descriptor.idInput.ariaLabel}
          />
        ) : null}
        <Input
          size="compact"
          value={descriptor.label.value}
          onChange={(event) =>
            dispatch({
              kind: "set-descriptor-label",
              descriptorKey: descriptor.key,
              label: event.target.value,
            })
          }
          placeholder={descriptor.label.placeholder}
          className="min-w-0 flex-1"
          aria-label={descriptor.label.ariaLabel}
        />
        <Select
          value={descriptor.type.value}
          onValueChange={(value) =>
            dispatch({ kind: "set-descriptor-type", descriptorKey: descriptor.key, value })
          }
        >
          <SelectTrigger size="compact" className="w-24" aria-label={descriptor.type.ariaLabel}>
            <SelectValue>{descriptor.type.displayLabel}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {descriptor.type.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={descriptor.removeAriaLabel}
          onClick={() => dispatch({ kind: "remove-descriptor", descriptorKey: descriptor.key })}
        >
          <XIcon className="size-3" />
        </Button>
      </div>
      {descriptor.choices ? (
        <div className="flex flex-col gap-1.5 pl-16">
          {descriptor.choices.map((choice) => renderChoice(descriptor, choice))}
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            className="-ml-2 self-start"
            onClick={() => dispatch({ kind: "add-choice", descriptorKey: descriptor.key })}
          >
            <PlusIcon className="size-3" />
            {descriptor.addChoiceLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="mx-2 mt-1 mb-2 flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={model.name.id} className="text-xs text-muted-foreground">
          {model.name.label}
        </label>
        <Input
          id={model.name.id}
          size="sm"
          autoFocus
          value={model.name.value}
          onChange={(event) => dispatch({ kind: "set-name", name: event.target.value })}
          placeholder={model.name.placeholder}
          className="sm:w-72"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{model.optionsHeading}</span>
          {model.copyFrom ? (
            <Select
              value={model.copyFrom.value}
              onValueChange={(slug) => dispatch({ kind: "copy-from-model", slug })}
            >
              <SelectTrigger size="compact" className="w-44" aria-label={model.copyFrom.ariaLabel}>
                <SelectValue>{model.copyFrom.placeholder}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {model.copyFrom.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </div>
        {model.emptyMessage ? (
          <p className="text-xs text-muted-foreground/70">{model.emptyMessage}</p>
        ) : null}
        {model.descriptors.map(renderDescriptor)}
        <div className="flex flex-wrap gap-1">
          {model.presetButtons.map((preset) => (
            <Button
              key={preset.value}
              type="button"
              size="xs"
              variant="ghost-muted"
              className={cn("-ml-2 first:ml-0")}
              onClick={() => dispatch({ kind: "add-preset-descriptor", presetId: preset.value })}
            >
              <PlusIcon className="size-3" />
              {preset.label}
            </Button>
          ))}
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            onClick={() => dispatch({ kind: "add-custom-descriptor" })}
          >
            <PlusIcon className="size-3" />
            {model.customOptionLabel}
          </Button>
        </div>
      </div>

      {model.error ? <p className="text-xs text-destructive">{model.error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleSave}>
          {model.saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {model.cancelLabel}
        </Button>
      </div>
    </div>
  );
}
