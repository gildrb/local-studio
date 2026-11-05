import type {
  EnvironmentId,
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestRef,
} from "@t3tools/contracts";
import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildPullRequestReactionBarModel,
  PULL_REQUEST_REACTION_FAILURE_TITLE,
  pullRequestReactionsSignature,
  resolvePullRequestReactionToggle,
} from "./pullRequestReactions.logic";

const PILL_CLASS =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

const EMPTY_PENDING: ReadonlyMap<PullRequestReactionContent, boolean> = new Map();

/** Reaction counts and an always-visible picker, routed to the supplied host subject. */
export function PullRequestReactionBar({
  reactions,
  canReact,
  subjectId,
  environmentId,
  reference,
  onRefresh,
  className,
}: {
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly canReact: boolean;
  /** Absent reacts to the change request itself, which is where its description's reactions live. */
  readonly subjectId?: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly onRefresh: () => void;
  readonly className?: string | undefined;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    readonly signature: string;
    readonly values: ReadonlyMap<PullRequestReactionContent, boolean>;
  }>({ signature: "", values: EMPTY_PENDING });
  const setReaction = useAtomCommand(pullRequestEnvironment.setReaction, { reportFailure: false });

  const signature = pullRequestReactionsSignature(reactions);
  const values = pending.signature === signature ? pending.values : EMPTY_PENDING;
  const model = buildPullRequestReactionBarModel({ reactions, pending: values, canReact });

  const toggle = async (content: PullRequestReactionContent) => {
    const { reacted } = resolvePullRequestReactionToggle(model, content);
    setPending({ signature, values: new Map([...values, [content, reacted]]) });
    const result = await setReaction({
      environmentId,
      input: {
        ...reference,
        ...(subjectId === undefined ? {} : { subjectId }),
        content,
        reacted,
      },
    });
    if (result._tag === "Failure") {
      setPending((current) => {
        const next = new Map(current.values);
        next.delete(content);
        return { signature: current.signature, values: next };
      });
      toastManager.add({ type: "error", title: PULL_REQUEST_REACTION_FAILURE_TITLE });
      return;
    }
    onRefresh();
  };

  if (!model.visible) return null;

  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}>
      {model.pills.map((pill) => (
        <Tooltip key={pill.content}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={pill.pressed}
                aria-label={pill.ariaLabel}
                disabled={pill.disabled}
                className={cn(
                  PILL_CLASS,
                  pill.pressed
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/70 bg-muted/40 text-muted-foreground",
                  pill.disabled ? "cursor-default" : "hover:border-primary/60",
                )}
                onClick={() => void toggle(pill.content)}
              />
            }
          >
            <span aria-hidden>{pill.emoji}</span>
            <span className="tabular-nums">{pill.count}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{pill.tooltip}</TooltipPopup>
        </Tooltip>
      ))}

      {model.picker.visible ? (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={model.picker.ariaLabel}
                className={cn(
                  PILL_CLASS,
                  "border-border/70 px-1.5 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              />
            }
          >
            <SmilePlusIcon aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverPopup align="start" side="top" padding="compact">
            <div className="flex items-center gap-0.5">
              {model.picker.options.map((option) => (
                <button
                  key={option.content}
                  type="button"
                  aria-pressed={option.pressed}
                  aria-label={option.ariaLabel}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    option.pressed && "bg-primary/10",
                  )}
                  onClick={() => {
                    setPickerOpen(false);
                    void toggle(option.content);
                  }}
                >
                  <span aria-hidden>{option.emoji}</span>
                </button>
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}
