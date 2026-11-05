import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import type { EnvironmentUsageStatus } from "../../state/usage.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuCheckboxItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import type { UsagePriceDraft } from "./usagePriceTable";
import { writeUsagePrices } from "./usagePriceTargets";
import { resolveEnvironmentSelection } from "./UsagePage.logic";
import {
  buildUsagePriceOverridesModel,
  createUsagePriceTargetsAtom,
  resolveUsagePriceCellEdit,
  resolveUsagePriceRowAction,
  resolveUsagePriceSave,
  startUsagePriceSaveAttempt,
  type UsagePriceDraftAction,
  type UsagePriceSaveAttempt,
} from "./UsagePriceOverrides.logic";

const priceTargetsAtom = createUsagePriceTargetsAtom({
  presentationsAtom: environmentPresentations.presentationsAtom,
  settingsValueAtom: serverEnvironment.settingsValueAtom,
  sessionStateAtom: environmentSession.sessionStateAtom,
  hasDesktopBridge: isElectron,
});

export function UsagePriceOverrides({
  usage,
  initialSelectedEnvironmentIds,
  onOpenChange,
}: {
  readonly usage: readonly EnvironmentUsageStatus[];
  readonly initialSelectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const environments = useAtomValue(priceTargetsAtom);
  const [selectedIds, setSelectedIds] = useState(initialSelectedEnvironmentIds);
  const [drafts, setDrafts] = useState<readonly UsagePriceDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState<UsagePriceSaveAttempt | null>(null);
  const focusRowRef = useRef<string | null>(null);
  const nextRowId = useRef(0);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const model = buildUsagePriceOverridesModel({
    environments,
    selectedIds,
    usage,
    drafts,
    pending,
    attempt,
  });
  const discard = () => {
    setDrafts([]);
    setAttempt(null);
  };
  const selectEnvironments = (ids: ReadonlySet<EnvironmentId> | null) => {
    setSelectedIds(ids);
    setAttempt(null);
  };
  const updateDraft = (draft: UsagePriceDraft) => {
    setDrafts((previous) =>
      previous.some((entry) => entry.id === draft.id)
        ? previous.map((entry) => (entry.id === draft.id ? draft : entry))
        : [...previous, draft],
    );
    setAttempt(null);
  };
  const applyDraftAction = (action: UsagePriceDraftAction) => {
    if (action.kind === "remove-draft")
      setDrafts((previous) => previous.filter((entry) => entry.id !== action.id));
    else updateDraft(action.draft);
  };
  const save = async () => {
    const plan = resolveUsagePriceSave({ environments, selectedIds, drafts, pending, attempt });
    if (plan.kind === "none") return;
    setPending(true);
    setAttempt((previous) => startUsagePriceSaveAttempt(previous, plan));
    let failed = false;
    await writeUsagePrices({
      targets: plan.writeTargets,
      changes: plan.changes,
      write: updateSettings,
      onResult: (environmentId, result) => {
        if (result.status === "failed") failed = true;
        setAttempt((previous) =>
          previous === null
            ? null
            : { ...previous, results: new Map(previous.results).set(environmentId, result) },
        );
      },
    });
    setPending(false);
    if (!failed) setDrafts([]);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (model.closeAllowed) onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Label id="usage-prices-apply-label" className="shrink-0">
                {model.applyLabel}
              </Label>
              <Menu>
                <MenuTrigger
                  render={<Button variant="outline" size="sm" className="min-w-0" />}
                  aria-labelledby="usage-prices-apply-label usage-prices-selection"
                  disabled={model.selection.disabled}
                >
                  <span id="usage-prices-selection" className="truncate">
                    {model.selection.label}
                  </span>
                  <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
                </MenuTrigger>
                <MenuPopup align="start">
                  <MenuCheckboxItem
                    checked={model.selection.allSelected}
                    closeOnClick={false}
                    onCheckedChange={(checked) => selectEnvironments(checked ? null : new Set())}
                  >
                    {model.selection.allLabel}
                  </MenuCheckboxItem>
                  <MenuSeparator />
                  {model.selection.options.map((option) => (
                    <MenuCheckboxItem
                      key={option.environmentId}
                      checked={option.checked}
                      closeOnClick={false}
                      onCheckedChange={(checked) =>
                        selectEnvironments(
                          resolveEnvironmentSelection({
                            environmentIds: environments.map((target) => target.environmentId),
                            selectedIds,
                            environmentId: option.environmentId,
                            checked,
                          }),
                        )
                      }
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        {option.unavailable ? (
                          <span className="text-xs text-muted-foreground">
                            {option.unavailable}
                          </span>
                        ) : null}
                      </span>
                    </MenuCheckboxItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
            <span className="text-xs text-muted-foreground">{model.unitLabel}</span>
          </div>
          {model.emptyMessage !== null ? (
            <p className="text-sm text-muted-foreground">{model.emptyMessage}</p>
          ) : (
            <>
              <div className="min-w-0 overflow-hidden rounded-lg border border-border">
                <Table className="min-w-160 table-fixed" aria-label={model.table.ariaLabel}>
                  <colgroup>
                    <col className="w-[34%]" />
                    {model.table.fieldHeadings.map((field) => (
                      <col key={field.key} />
                    ))}
                    <col className="w-10" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{model.table.modelHeading}</TableHead>
                      {model.table.fieldHeadings.map((field) => (
                        <TableHead key={field.key}>{field.label}</TableHead>
                      ))}
                      <TableHead>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={model.table.addButton.ariaLabel}
                          disabled={model.table.addButton.disabled}
                          onClick={() => {
                            const id = `new:${nextRowId.current++}`;
                            focusRowRef.current = id;
                            updateDraft({ id, model: "", isNew: true, values: {} });
                          }}
                        >
                          <PlusIcon aria-hidden />
                        </Button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.table.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center whitespace-normal">
                          <p className="py-6 text-muted-foreground">{model.table.emptyMessage}</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      model.table.rows.map((row) => (
                        <TableRow key={row.id} data-row-id={row.id}>
                          <TableCell className="whitespace-normal">
                            {row.isNew ? (
                              <Input
                                size="compact"
                                value={row.model}
                                ref={(node) => {
                                  if (node && focusRowRef.current === row.id) {
                                    node.focus();
                                    focusRowRef.current = null;
                                  }
                                }}
                                aria-label="New model ID"
                                aria-invalid={row.modelInvalid || undefined}
                                list="usage-price-models"
                                placeholder="Model ID"
                                autoComplete="off"
                                spellCheck={false}
                                disabled={model.table.locked}
                                onChange={(event) =>
                                  updateDraft({ ...row.draft, model: event.target.value })
                                }
                              />
                            ) : (
                              <span
                                className={cn(
                                  "block break-all",
                                  row.removed && "text-muted-foreground line-through",
                                )}
                              >
                                {row.model}
                              </span>
                            )}
                            {row.error !== null ? (
                              <p role="alert" className="mt-1 text-xs text-destructive">
                                {row.error}
                              </p>
                            ) : null}
                          </TableCell>
                          {row.removedMessage !== null ? (
                            <TableCell colSpan={4}>
                              <span className="text-muted-foreground">{row.removedMessage}</span>
                            </TableCell>
                          ) : (
                            row.cells.map((cell) => (
                              <TableCell key={cell.field}>
                                <Input
                                  size="compact"
                                  inputMode="decimal"
                                  aria-label={cell.ariaLabel}
                                  value={cell.value}
                                  placeholder={cell.placeholder}
                                  autoComplete="off"
                                  disabled={model.table.locked}
                                  font="mono"
                                  onChange={(event) =>
                                    applyDraftAction(
                                      resolveUsagePriceCellEdit({
                                        row: row.draft,
                                        field: cell.field,
                                        value: event.target.value,
                                        environments,
                                        selectedIds,
                                      }),
                                    )
                                  }
                                />
                              </TableCell>
                            ))
                          )}
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger
                                render={<Button size="icon-xs" variant="ghost" />}
                                disabled={model.table.locked}
                                aria-label={row.action.ariaLabel}
                                onClick={() =>
                                  applyDraftAction(resolveUsagePriceRowAction(row.draft))
                                }
                              >
                                {row.action.icon === "remove" ? (
                                  <XIcon aria-hidden />
                                ) : (
                                  <RotateCcwIcon aria-hidden />
                                )}
                              </TooltipTrigger>
                              <TooltipPopup>{row.action.tooltip}</TooltipPopup>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <datalist id="usage-price-models">
                {model.table.suggestedModels.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">{model.table.footnote}</p>
            </>
          )}
          {model.saveStatuses !== null ? (
            <div role="status" className="grid gap-1 text-xs">
              {model.saveStatuses.map((status) => (
                <div key={status.environmentId} className="flex justify-between gap-3">
                  <span className="truncate text-muted-foreground">{status.label}</span>
                  <span
                    className={
                      status.failed ? "text-right text-destructive" : "text-muted-foreground"
                    }
                  >
                    {status.statusLabel}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter variant="bare" className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{model.footer.destinationNote}</span>
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            {model.footer.discardButton !== null ? (
              <Button
                variant="ghost"
                disabled={model.footer.discardButton.disabled}
                onClick={discard}
              >
                {model.footer.discardButton.label}
              </Button>
            ) : null}
            <Button disabled={model.footer.saveButton.disabled} onClick={() => void save()}>
              {model.footer.saveButton.label}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
