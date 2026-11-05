import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";
import { useTheme } from "~/hooks/useTheme";
import { CommandPaletteContent } from "../CommandPaletteContent";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { PROJECT_FILE_PICKER_RESULT_LIMIT } from "../files/ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "../files/projectFilesQueryState";
import { CommandDialog, CommandDialogPopup, CommandFooterAction } from "../ui/command";
import { toastManager } from "../ui/toast";
import {
  buildProjectFaviconPickerModel,
  resolveProjectFaviconPickerFailure,
} from "./ProjectFaviconPickerDialog.logic";

export function ProjectFaviconPickerDialog(props: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPickExternal?: () => Promise<string | null>;
  readonly onSelect: (path: string) => void;
  readonly open: boolean;
  readonly projectName: string;
}) {
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const [isPickingExternal, setIsPickingExternal] = useState(false);
  const result = useProjectFilePickerQuery(
    props.environmentId,
    props.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
    { imageOnly: true },
  );
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const pickExternal = props.onPickExternal;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const model = useMemo(
    () =>
      buildProjectFaviconPickerModel({
        query,
        entries: result.entries,
        matchedQuery: result.matchedQuery,
        error: result.error,
        isPending: result.isPending,
        platform,
        hasExternalPicker: pickExternal !== undefined,
        isPickingExternal,
        projectName: props.projectName,
      }),
    [
      query,
      result.entries,
      result.matchedQuery,
      result.error,
      result.isPending,
      platform,
      pickExternal,
      isPickingExternal,
      props.projectName,
    ],
  );
  const items = useMemo<CommandPaletteActionItem[]>(
    () =>
      model.files.map((file) => ({
        kind: "action",
        value: file.value,
        searchTerms: [...file.searchTerms],
        title: file.title,
        description: file.description,
        icon: <PierreEntryIcon pathValue={file.path} kind="file" theme={resolvedTheme} />,
        run: async () => props.onSelect(file.path),
      })),
    [props.onSelect, resolvedTheme, model.files],
  );

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <CommandDialogPopup
          aria-label={model.title}
          className="overflow-hidden"
          onBackdropPointerDown={() => props.onOpenChange(false)}
        >
          <CommandPaletteContent
            aria-label={model.title}
            autoHighlight="always"
            escapeLabel={model.escapeLabel}
            footerActionLabel={model.footerActionLabel}
            footerTrailing={
              pickExternal && model.externalAction ? (
                <CommandFooterAction
                  disabled={model.externalAction.disabled}
                  onClick={() => {
                    setIsPickingExternal(true);
                    void pickExternal()
                      .then((path) => {
                        if (!path) return;
                        props.onOpenChange(false);
                        props.onSelect(path);
                      })
                      .catch((error: unknown) => {
                        toastManager.add(resolveProjectFaviconPickerFailure(error));
                      })
                      .finally(() => setIsPickingExternal(false));
                  }}
                >
                  {model.externalAction.label}
                </CommandFooterAction>
              ) : null
            }
            inputProps={{ placeholder: model.placeholder }}
            mode="none"
            onItemHighlighted={(value) => {
              setHighlightedItemValue(typeof value === "string" ? value : null);
            }}
            onValueChange={(value) => {
              setHighlightedItemValue(null);
              setQuery(value);
            }}
            panelSize="tall-list"
            testId="project-favicon-picker"
            value={query}
          >
            <CommandPaletteResults
              groups={
                items.length > 0
                  ? [{ value: model.groupValue, label: model.groupLabel, items }]
                  : []
              }
              highlightedItemValue={highlightedItemValue}
              isActionsOnly={false}
              keybindings={keybindings}
              onExecuteItem={(item) => {
                if (item.kind !== "action") return;
                props.onOpenChange(false);
                void item.run();
              }}
              emptyStateMessage={model.emptyStateMessage}
            />
          </CommandPaletteContent>
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}
