"use client";

import { useMemo, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  buildProviderSettingsFormModel,
  resolveProviderSettingsFormChange,
  type ProviderSettingsFormDefinition,
  type ProviderSettingsFormFieldRow,
} from "./ProviderSettingsForm.logic";
import { SettingsRow } from "./settingsLayout";

interface ProviderSettingsFormProps {
  readonly definition: ProviderSettingsFormDefinition;
  readonly value: unknown;
  readonly idPrefix: string;
  /**
   * `card` stacks label over control, `dialog` is the compact wizard layout,
   * and `settings` renders the shared settings row treatment.
   */
  readonly variant: "card" | "dialog" | "settings";
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

/** Stores the default choice as an omitted key so unchanged configs stay small. */
function ProviderSettingsSelect({
  field,
  value,
  size,
  className,
  onChange,
}: {
  readonly field: ProviderSettingsFormFieldRow;
  readonly value: unknown;
  readonly size: "sm" | "xs";
  readonly className?: string | undefined;
  readonly onChange: ProviderSettingsFormProps["onChange"];
}) {
  return (
    <Select
      value={field.textValue}
      onValueChange={(next) => {
        if (typeof next !== "string") return;
        onChange(
          resolveProviderSettingsFormChange({
            config: value,
            field,
            change: { kind: "select", value: next },
          }),
        );
      }}
    >
      <SelectTrigger id={field.inputId} size={size} className={className} aria-label={field.label}>
        <SelectValue>{field.selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        {(field.options ?? []).map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function FieldFrame(props: {
  readonly variant: ProviderSettingsFormProps["variant"];
  readonly children: ReactNode;
}) {
  if (props.variant === "card") {
    return <div>{props.children}</div>;
  }
  return <div className="grid gap-1.5">{props.children}</div>;
}

interface ProviderSettingsFieldRowProps {
  readonly field: ProviderSettingsFormFieldRow;
  readonly value: unknown;
  readonly variant: ProviderSettingsFormProps["variant"];
  readonly onChange: ProviderSettingsFormProps["onChange"];
}

function ProviderSettingsFieldRow({
  field,
  value,
  variant,
  onChange,
}: ProviderSettingsFieldRowProps) {
  const inputId = field.inputId;
  const commitText = (next: string) =>
    onChange(
      resolveProviderSettingsFormChange({
        config: value,
        field,
        change: { kind: "text", value: next },
      }),
    );
  const commitSwitch = (checked: boolean) =>
    onChange(
      resolveProviderSettingsFormChange({
        config: value,
        field,
        change: { kind: "switch", value: checked },
      }),
    );
  const descriptionClassName =
    variant === "dialog"
      ? "text-2xs text-muted-foreground"
      : "mt-1 block text-xs text-muted-foreground";
  const label = <span className="text-xs font-medium text-foreground">{field.label}</span>;
  const description = field.description ? (
    <span className={descriptionClassName}>{field.description}</span>
  ) : null;

  if (variant === "settings") {
    const descriptionId = field.descriptionId ?? undefined;
    const control =
      field.control === "switch" ? (
        <Switch
          checked={field.checked}
          onCheckedChange={(checked) => commitSwitch(Boolean(checked))}
          aria-label={field.label}
          aria-describedby={descriptionId}
        />
      ) : field.control === "select" ? (
        <ProviderSettingsSelect
          field={field}
          value={value}
          size="sm"
          className="w-full max-w-full @min-[32rem]/settings-row:w-56"
          onChange={onChange}
        />
      ) : field.control === "textarea" ? (
        <Textarea
          id={inputId}
          aria-describedby={descriptionId}
          className="w-full max-w-full @min-[32rem]/settings-row:w-[min(24rem,50cqw)]"
          value={field.textValue}
          onChange={(event) => commitText(event.target.value)}
          placeholder={field.placeholder}
          spellCheck={false}
        />
      ) : (
        <DraftInput
          id={inputId}
          aria-describedby={descriptionId}
          size="sm"
          className="w-full max-w-full @min-[32rem]/settings-row:w-56"
          type={field.inputType ?? undefined}
          autoComplete={field.autoComplete ?? undefined}
          value={field.textValue}
          onCommit={commitText}
          placeholder={field.placeholder}
          spellCheck={false}
        />
      );

    return (
      <SettingsRow
        title={
          field.control === "switch" ? field.label : <label htmlFor={inputId}>{field.label}</label>
        }
        description={
          field.description ? <span id={descriptionId}>{field.description}</span> : undefined
        }
        control={control}
      />
    );
  }

  if (field.control === "switch") {
    return (
      <FieldFrame variant={variant}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {label}
            {description}
          </div>
          <Switch
            checked={field.checked}
            onCheckedChange={(checked) => commitSwitch(Boolean(checked))}
            aria-label={field.label}
          />
        </div>
      </FieldFrame>
    );
  }

  if (field.control === "select") {
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <ProviderSettingsSelect
            field={field}
            value={value}
            size="sm"
            className={cn("w-full", variant === "card" && "mt-1.5")}
            onChange={onChange}
          />
          {description}
        </label>
      </FieldFrame>
    );
  }

  if (field.control === "textarea") {
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <Textarea
            id={inputId}
            className={cn(variant === "card" && "mt-1.5")}
            value={field.textValue}
            onChange={(event) => commitText(event.target.value)}
            placeholder={field.placeholder}
            spellCheck={false}
          />
          {description}
        </label>
      </FieldFrame>
    );
  }

  const type = field.inputType ?? undefined;
  return (
    <FieldFrame variant={variant}>
      <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
        {label}
        {variant === "card" ? (
          <DraftInput
            id={inputId}
            size="sm"
            className="mt-1.5"
            type={type}
            autoComplete={field.autoComplete ?? undefined}
            value={field.textValue}
            onCommit={commitText}
            placeholder={field.placeholder}
            spellCheck={false}
          />
        ) : (
          <Input
            id={inputId}
            type={type}
            autoComplete={field.autoComplete ?? undefined}
            value={field.textValue}
            onChange={(event) => commitText(event.target.value)}
            placeholder={field.placeholder}
            spellCheck={false}
          />
        )}
        {description}
      </label>
    </FieldFrame>
  );
}

export function ProviderSettingsForm({
  definition,
  value,
  idPrefix,
  variant,
  onChange,
}: ProviderSettingsFormProps) {
  const model = useMemo(
    () => buildProviderSettingsFormModel({ definition, config: value, idPrefix }),
    [definition, value, idPrefix],
  );

  if (model.fields.length === 0) {
    return null;
  }

  return (
    <>
      {model.fields.map((field) => (
        <ProviderSettingsFieldRow
          key={field.key}
          field={field}
          value={value}
          variant={variant}
          onChange={onChange}
        />
      ))}
    </>
  );
}
