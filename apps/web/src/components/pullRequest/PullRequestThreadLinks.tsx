import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, PullRequestRef, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";

import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { normalizeThreadPullRequestKey } from "@t3tools/shared/threadPullRequests";
import { useProjects, useServerConfigs, useThreadShell, useThreadShells } from "~/state/entities";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { openCommandPalette } from "~/commandPaletteBus";
import { Button } from "../ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "./pullRequestIcons";
import {
  buildPullRequestThreadLinksModel,
  buildPullRequestThreadPickerModel,
  pullRequestThreadLinkFailureToast,
  resolvePullRequestThreadLinkMenuAction,
} from "./PullRequestThreadLinks.logic";

interface PullRequestThreadLinksProps {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  url: string;
  threadRef: ScopedThreadRef | null;
  display: "count" | "menu-item" | "picker";
  onPickerOpenChange?: (open: boolean) => void;
}

/** Thread relations belong to the detail environment, including when another environment is active. */
export function PullRequestThreadLinks(props: PullRequestThreadLinksProps) {
  const configs = useServerConfigs();
  if (
    threadPullRequestLinkMode(configs.get(props.environmentId)?.environment.capabilities) ===
    "unsupported"
  ) {
    return null;
  }
  return <EnabledPullRequestThreadLinks key={`${props.environmentId}:${props.url}`} {...props} />;
}

function EnabledPullRequestThreadLinks({
  environmentId,
  reference,
  url,
  threadRef,
  display,
  onPickerOpenChange,
}: PullRequestThreadLinksProps) {
  const parsed = parseChangeRequestUrl(url);
  const currentThreadRef = threadRef?.environmentId === environmentId ? threadRef : null;
  const thread = useThreadShell(currentThreadRef);
  const linking = usePullRequestLinking(environmentId);
  const linkedHere = linking.isLinked(thread, url);
  const relations = useEnvironmentQuery(
    linking.mode === "multiple" && display !== "menu-item"
      ? pullRequestEnvironment.linkedThreads({
          environmentId,
          input:
            parsed === null
              ? reference
              : { ...reference, ...normalizeThreadPullRequestKey(parsed) },
        })
      : null,
  );
  // Refreshes can briefly clear the query value. Keep the last response so polling
  // does not hide the linked-thread count between responses.
  const [lastRelations, setLastRelations] = useState(relations.data);
  if (relations.data !== null && relations.data !== lastRelations) {
    setLastRelations(relations.data);
  }
  const [pending, setPending] = useState(false);

  const changeLink = async (threadId: ThreadId, remove: boolean) => {
    if (parsed === null || pending) return;
    setPending(true);
    try {
      await linking.changeLink(scopeThreadRef(environmentId, threadId), url, !remove);
    } catch (error) {
      toastManager.add(pullRequestThreadLinkFailureToast({ remove, error }));
      return;
    } finally {
      setPending(false);
    }
    if (linking.mode === "multiple") {
      appAtomRegistry.refresh(
        pullRequestEnvironment.linkedThreads({
          environmentId,
          input: { ...reference, ...normalizeThreadPullRequestKey(parsed) },
        }),
      );
    }
    onPickerOpenChange?.(false);
  };

  if (parsed === null || (!linkedHere && !linking.canLink(url))) return null;
  const linkedThreads =
    linking.mode === "multiple" ? ((relations.data ?? lastRelations)?.threads ?? []) : [];
  const model = buildPullRequestThreadLinksModel({
    linkedHere,
    hasCurrentThread: currentThreadRef !== null,
    linkedThreadCount: linkedThreads.length,
    relationsError: relations.error !== null,
    pending,
  });
  return (
    <>
      {display === "count" && model.count.visible ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                aria-label={model.count.ariaLabel}
                onClick={() =>
                  openCommandPalette({
                    query: url,
                    ...((relations.data ?? lastRelations) === null
                      ? {}
                      : { linkedThreads: { environmentId, threads: linkedThreads } }),
                  })
                }
              >
                <MessageSquareIcon aria-hidden className="size-3.5" />
                <span aria-hidden>{model.count.countLabel}</span>
              </Button>
            }
          />
          <TooltipPopup>{model.count.tooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
      {display === "menu-item" ? (
        <MenuItem
          disabled={model.menuItem.disabled}
          onClick={() => {
            const action = resolvePullRequestThreadLinkMenuAction({
              currentThreadId: currentThreadRef?.threadId ?? null,
              linkedHere,
            });
            if (action.kind === "change") {
              void changeLink(action.threadId, action.remove);
            } else {
              onPickerOpenChange?.(true);
            }
          }}
        >
          {model.menuItem.icon === "unlink" ? (
            <PullRequestGlyph.unlink aria-hidden className="size-3.5" />
          ) : (
            <PullRequestGlyph.link aria-hidden className="size-3.5" />
          )}
          {model.menuItem.label}
        </MenuItem>
      ) : null}
      {display === "picker" ? (
        <Dialog open onOpenChange={onPickerOpenChange}>
          <DialogPopup className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">{model.pickerTitle}</DialogTitle>
            <ThreadPicker
              environmentId={environmentId}
              url={url}
              pending={pending}
              onSelect={(threadId) => void changeLink(threadId, false)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function ThreadPicker({
  environmentId,
  url,
  pending,
  onSelect,
}: {
  environmentId: EnvironmentId;
  url: string;
  pending: boolean;
  onSelect: (threadId: ThreadId) => void;
}) {
  const threads = useThreadShells();
  const linking = usePullRequestLinking(environmentId);
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const model = buildPullRequestThreadPickerModel({
    environmentId,
    threads,
    projects,
    query,
    pending,
    isLinked: (thread) => linking.isLinked(thread, url),
  });
  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label={model.ariaLabel}>
      <CommandInput placeholder={model.searchPlaceholder} disabled={model.searchDisabled} />
      <CommandList className="max-h-80 overflow-y-auto">
        {model.emptyLabel !== null ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {model.emptyLabel}
          </div>
        ) : (
          model.rows.map((row) => (
            <CommandItem
              key={row.id}
              value={row.id}
              disabled={row.disabled}
              onClick={() => onSelect(row.id)}
            >
              <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{row.title}</span>
                <span className="truncate text-xs text-muted-foreground">{row.projectTitle}</span>
              </span>
              {row.linked ? (
                <>
                  <CheckIcon aria-hidden className="size-3.5" />
                  <span className="text-xs text-muted-foreground">{row.linkedLabel}</span>
                </>
              ) : null}
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
}
