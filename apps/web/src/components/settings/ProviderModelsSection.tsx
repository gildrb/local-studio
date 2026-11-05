"use client";

import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, StarIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProviderModel,
} from "@t3tools/contracts";
import type { CustomModelDefinition } from "@t3tools/shared/model";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CustomModelEditor } from "./CustomModelEditor";
import {
  type ProviderModelRow,
  type ProviderModelsIntent,
  buildProviderModelsSectionModel,
  resolveProviderModelsChange,
} from "./ProviderModelsSection.logic";

interface ProviderModelsSectionProps {
  /** Identifier used to namespace input ids within the DOM. */
  readonly instanceId: ProviderInstanceId;
  /**
   * Driver kind for slug normalization + input placeholder. `null` when
   * the section is rendered without enough provider metadata.
   */
  readonly driverKind: ProviderDriverKind | null;
  /**
   * The live model list to display. Includes both built-in (probe-reported)
   * and custom entries, distinguished by `isCustom`.
   */
  readonly models: ReadonlyArray<ServerProviderModel>;
  /**
   * The persisted custom-model list for this instance, resolved. Drives
   * dedup, and is the list we hand back (with an entry appended / replaced /
   * removed) via `onChange`.
   */
  readonly customModels: ReadonlyArray<CustomModelDefinition>;
  /** Server-returned model slugs hidden from the model picker. */
  readonly hiddenModels: ReadonlyArray<string>;
  /** Model slugs favorited for this provider instance. */
  readonly favoriteModels: ReadonlyArray<string>;
  /** Explicit user-authored model ordering for this provider instance. */
  readonly modelOrder: ReadonlyArray<string>;
  /**
   * Commit the new custom-model list. Caller is responsible for routing the
   * write to the correct storage (legacy `settings.providers[kind]` vs.
   * `providerInstances[id].config`).
   */
  readonly onChange: (next: ReadonlyArray<CustomModelDefinition>) => void;
  readonly onHiddenModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onFavoriteModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onModelOrderChange: (next: ReadonlyArray<string>) => void;
}

/**
 * Shared "Models" section rendered on both the built-in default and custom
 * provider-instance cards. Owns its own input + error local state so two
 * cards on screen don't fight over the input value.
 *
 * Validation mirrors the pre-consolidation logic in `SettingsPanels`:
 *   - empty / whitespace → "Enter a model slug."
 *   - duplicate of a non-custom (probe-reported) slug → "already built in"
 *   - exceeds `MAX_CUSTOM_MODEL_LENGTH` → length error
 *   - duplicate of an already-saved custom slug → already-saved error
 */
export function ProviderModelsSection({
  instanceId,
  driverKind,
  models,
  customModels,
  hiddenModels,
  favoriteModels,
  modelOrder,
  onChange,
  onHiddenModelsChange,
  onFavoriteModelsChange,
  onModelOrderChange,
}: ProviderModelsSectionProps) {
  const [input, setInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Slug of the custom model whose inline editor is open, if any.
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Slug of a just-added custom model, scrolled into view once its row exists.
  const scrollToSlugRef = useRef<string | null>(null);
  const state = useMemo(
    () => ({ driverKind, models, customModels, hiddenModels, favoriteModels, modelOrder }),
    [customModels, driverKind, favoriteModels, hiddenModels, modelOrder, models],
  );
  const sectionModel = useMemo(
    () =>
      buildProviderModelsSectionModel({
        ...state,
        instanceId,
        filter,
        isAdding,
        error,
        editingSlug,
      }),
    [editingSlug, error, filter, instanceId, isAdding, state],
  );
  const builtInModels = useMemo(() => models.filter((model) => !model.isCustom), [models]);

  // The parent commits the new custom model and hands back an updated
  // `models` list, so the row can only be scrolled to after that render.
  useEffect(() => {
    const slug = scrollToSlugRef.current;
    if (slug === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-model-slug="${CSS.escape(slug)}"]`,
    );
    if (!row) return;
    scrollToSlugRef.current = null;
    row.scrollIntoView({ block: "nearest" });
  }, [sectionModel.rows]);

  const applyChange = (intent: ProviderModelsIntent) => {
    const decision = resolveProviderModelsChange(state, intent);
    if (decision.kind !== "apply") return decision;
    const { patch } = decision;
    if (patch.customModels) onChange(patch.customModels);
    if (patch.modelOrder) onModelOrderChange(patch.modelOrder);
    if (patch.favoriteModels) onFavoriteModelsChange(patch.favoriteModels);
    if (patch.hiddenModels) onHiddenModelsChange(patch.hiddenModels);
    return decision;
  };

  const handleAdd = () => {
    const decision = resolveProviderModelsChange(state, { kind: "add-custom-model", input });
    if (decision.kind === "none") return;
    if (decision.kind === "invalid") {
      setError(decision.error);
      return;
    }

    // Clear the filter so the new row renders even when it does not match,
    // which is also what lets the pending scroll target resolve and clear.
    scrollToSlugRef.current = decision.addedSlug;
    setFilter("");
    if (decision.patch.customModels) onChange(decision.patch.customModels);
    setInput("");
    setError(null);
    setIsAdding(false);
  };

  const cancelAdd = () => {
    setInput("");
    setError(null);
    setIsAdding(false);
  };

  const handleRemove = (slug: string) => {
    if (editingSlug === slug) setEditingSlug(null);
    applyChange({ kind: "remove-custom-model", slug });
    setError(null);
  };

  const handleSaveEdit = (next: CustomModelDefinition) => {
    applyChange({ kind: "save-custom-model", definition: next });
    setEditingSlug(null);
  };

  const starButton = (row: ProviderModelRow) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            onClick={() => applyChange({ kind: "toggle-favorite", slug: row.slug })}
            aria-label={row.favorite.ariaLabel}
          />
        }
      >
        <StarIcon className={cn("size-3", row.favorite.active && "fill-current text-warning")} />
      </TooltipTrigger>
      <TooltipPopup side="top">{row.favorite.tooltip}</TooltipPopup>
    </Tooltip>
  );

  // Reorder and remove stay in the row at all times (dimmed when unavailable)
  // so ordering is discoverable without hovering.
  const rowActions = (row: ProviderModelRow) => (
    <span className="flex shrink-0 items-center justify-end gap-0.5">
      {row.moveUp && row.moveDown ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  disabled={row.moveUp.disabled}
                  onClick={() => applyChange({ kind: "move", slug: row.slug, direction: -1 })}
                  aria-label={row.moveUp.ariaLabel}
                />
              }
            >
              <ArrowUpIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{row.moveUp.tooltip}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  disabled={row.moveDown.disabled}
                  onClick={() => applyChange({ kind: "move", slug: row.slug, direction: 1 })}
                  aria-label={row.moveDown.ariaLabel}
                />
              }
            >
              <ArrowDownIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{row.moveDown.tooltip}</TooltipPopup>
          </Tooltip>
        </>
      ) : null}
      {row.edit && row.remove ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={row.edit.ariaLabel}
                  onClick={() =>
                    setEditingSlug((current) => (current === row.slug ? null : row.slug))
                  }
                />
              }
            >
              <PencilIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{row.edit.tooltip}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={row.remove.ariaLabel}
                  onClick={() => handleRemove(row.slug)}
                />
              }
            >
              <XIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">{row.remove.tooltip}</TooltipPopup>
          </Tooltip>
        </>
      ) : null}
    </span>
  );

  // The trigger is a wrapper span: a disabled switch gets no pointer events,
  // so it could not open the tooltip itself.
  const pickerSwitch = (row: ProviderModelRow) => (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
        <Switch
          size="sm"
          checked={row.pickerSwitch.checked}
          disabled={row.pickerSwitch.disabled}
          onCheckedChange={(checked) =>
            applyChange({ kind: "set-hidden", slug: row.slug, hidden: !checked })
          }
          aria-label={row.pickerSwitch.ariaLabel}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{row.pickerSwitch.tooltip}</TooltipPopup>
    </Tooltip>
  );

  const renderRow = (row: ProviderModelRow) => {
    const nameClassName = cn(
      "text-xs",
      row.isHidden ? "text-muted-foreground" : "text-foreground/90",
    );

    return (
      <div
        key={`${instanceId}:${row.slug}`}
        data-model-slug={row.slug}
        className={cn(
          // Actions column is at least wide enough for the four custom-row
          // buttons so capability labels line up across built-in and custom rows.
          "grid h-7 grid-cols-[1.5rem_minmax(0,1fr)_auto_minmax(5.5rem,auto)_auto] items-center gap-2 rounded-md px-2 transition-colors hover:bg-muted/30",
          row.isHidden && "opacity-50",
        )}
      >
        {starButton(row)}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn(nameClassName, "truncate")}>{row.name}</span>
          {row.showSlug ? (
            <code className="truncate font-mono text-2xs text-muted-foreground/70">{row.slug}</code>
          ) : null}
          {row.customBadge ? (
            <span className="text-2xs text-muted-foreground/70">{row.customBadge}</span>
          ) : null}
        </span>
        {/*
          Always a grid item so the columns line up across rows; the text
          itself drops out on phone widths where it would starve the name.
        */}
        <span className="text-2xs text-muted-foreground/70">
          {row.capabilitySummary ? (
            <span className="hidden sm:inline">{row.capabilitySummary}</span>
          ) : null}
        </span>
        {rowActions(row)}
        {pickerSwitch(row)}
      </div>
    );
  };

  const groupLabel = (label: string, isFirst: boolean) => (
    <div className={cn("px-2 pb-1.5 text-2xs text-muted-foreground", isFirst ? "pt-1" : "pt-5")}>
      {label}
    </div>
  );

  const { addCustomModel } = sectionModel;

  return (
    <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {sectionModel.filter.visible ? (
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={sectionModel.filter.placeholder}
            size="sm"
            className="w-56 max-w-full"
            spellCheck={false}
            aria-label={sectionModel.filter.ariaLabel}
          />
        ) : null}
        <div className="flex items-center gap-2">
          {sectionModel.bulkToggle ? (
            <Button
              type="button"
              size="xs"
              variant="ghost-muted"
              onClick={() => applyChange({ kind: "bulk-toggle-hidden" })}
            >
              {sectionModel.bulkToggle.label}
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">{sectionModel.summary}</span>
        </div>
        {addCustomModel.showAddButton ? (
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            className="ml-auto"
            onClick={() => setIsAdding(true)}
          >
            <PlusIcon className="size-3" />
            {addCustomModel.addButtonLabel}
          </Button>
        ) : null}
      </div>
      <div
        ref={listRef}
        className="mt-2 -mx-2 max-h-64 overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1"
      >
        {sectionModel.emptyMessage ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{sectionModel.emptyMessage}</p>
        ) : null}
        {sectionModel.rows.map((row) => (
          <div key={`${instanceId}:${row.slug}:group`}>
            {row.groupLabel ? groupLabel(row.groupLabel, row.groupLabelIsFirst) : null}
            {renderRow(row)}
            {row.editingEntry ? (
              <CustomModelEditor
                key={`${instanceId}:${row.slug}:editor`}
                instanceId={instanceId}
                driverKind={driverKind}
                entry={row.editingEntry}
                builtInModels={builtInModels}
                onSave={handleSaveEdit}
                onCancel={() => setEditingSlug(null)}
              />
            ) : null}
          </div>
        ))}
      </div>

      {addCustomModel.showForm ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            id={addCustomModel.inputId}
            size="sm"
            autoFocus
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelAdd();
                return;
              }
              if (event.key !== "Enter") return;
              event.preventDefault();
              handleAdd();
            }}
            placeholder={addCustomModel.placeholder ?? undefined}
            spellCheck={false}
          />
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={handleAdd}>
              {addCustomModel.submitLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelAdd}>
              {addCustomModel.cancelLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {addCustomModel.error ? (
        <p className="mt-2 text-xs text-destructive">{addCustomModel.error}</p>
      ) : null}
    </div>
  );
}
