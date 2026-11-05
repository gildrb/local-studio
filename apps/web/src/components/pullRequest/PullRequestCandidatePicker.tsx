/**
 * The menu shell the reviewer and label pickers share: an icon trigger, a search box, and a
 * scrolling body that says when the list is loading, could not be read, is empty, or is not all
 * of it. The rows and the words are the caller's; the frame is the same either way.
 *
 * The same combobox as the project and branch pickers, and dressed the same, rather than a menu:
 * a menu's typeahead claims every keypress to jump between rows, which a search box cannot share.
 */
import { TagIcon, UserPlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type {
  PullRequestCandidatePickerIcon,
  PullRequestCandidatePickerModel,
} from "./PullRequestCandidatePicker.logic";
import { PullRequestPeopleGhost } from "./PullRequestGhosts";

function CandidatePickerIcon({ icon }: { icon: PullRequestCandidatePickerIcon }) {
  return icon === "tag" ? <TagIcon className="size-3.5" /> : <UserPlusIcon className="size-3.5" />;
}

export function PullRequestCandidatePicker<Row extends { readonly key: string }>({
  model,
  open,
  onOpenChange,
  query,
  onQueryChange,
  onSelect,
  children,
}: {
  model: PullRequestCandidatePickerModel<Row>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (row: Row) => void;
  children: (row: Row) => ReactNode;
}) {
  if (model.kind === "disabled") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button size="icon-xs" variant="ghost" disabled aria-label={model.label}>
              <CandidatePickerIcon icon={model.icon} />
            </Button>
          }
        />
        <TooltipPopup side="bottom">{model.tooltip}</TooltipPopup>
      </Tooltip>
    );
  }

  const keys = model.rows.map((row) => row.key);

  return (
    <Combobox
      items={keys}
      // The caller narrows the list, so the combobox does no filtering of its own.
      filteredItems={keys}
      filter={null}
      autoHighlight
      value={null}
      onValueChange={(key) => {
        const row = model.rows.find((entry) => entry.key === key);
        if (row) onSelect(row);
      }}
      open={open}
      onOpenChange={(nextOpen, details) => {
        // Stays open on a pick: a change is confirmed by the row's own check turning over, and a
        // second label or reviewer is usually wanted right after the first. Cancelled rather than
        // ignored, so the combobox also skips its own close work: freezing the query and returning
        // focus to the trigger, either of which would take the next keystroke away from the box.
        if (!nextOpen && details.reason === "item-press") {
          details.cancel();
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <ComboboxTrigger
        render={
          <Button size="icon-xs" variant="ghost" aria-label={model.label}>
            <CandidatePickerIcon icon={model.icon} />
          </Button>
        }
      />
      <ComboboxPopup align="start" side="bottom" className="w-72">
        <ComboboxSearchInput
          aria-label={model.searchLabel}
          placeholder={model.searchLabel}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <ComboboxList className="max-h-72">
          {model.body.kind === "loading" ? (
            <PullRequestPeopleGhost rows={4} />
          ) : model.body.kind === "message" ? (
            <p className="p-2 text-xs text-muted-foreground">{model.body.message}</p>
          ) : (
            model.rows.map((row, index) => (
              <ComboboxItem
                key={row.key}
                hideIndicator
                index={index}
                value={row.key}
                disabled={model.rowsDisabled}
              >
                {children(row)}
              </ComboboxItem>
            ))
          )}
          {model.truncatedNotice !== null ? (
            // Typing filters what arrived; it does not ask the host again, so this says what the
            // list is rather than offering a search that would find nothing further.
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{model.truncatedNotice}</p>
          ) : null}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
