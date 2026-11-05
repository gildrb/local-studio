import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import type { EnvironmentId, PullRequestRef, PullRequestStackMembership } from "@t3tools/contracts";
import { useState } from "react";
import { usePullRequestStack } from "~/state/usePullRequestStack";
import { Menu, MenuTrigger, MenuPopup, MenuGroup, MenuGroupLabel, MenuItem } from "../ui/menu";
import { PullRequestStackLayers } from "./PullRequestStackLayers";
import { PullRequestStackHeader } from "./PullRequestStackHeader";
import { PullRequestGlyph } from "./pullRequestIcons";
import {
  buildPullRequestStackBodyModel,
  buildPullRequestStackPopoverModel,
} from "./PullRequestStackMenu.logic";

/** Mounted only while the menu is open, so list rows do not each fetch a stack. */
function StackBody({
  environmentId,
  reference,
  onSelect,
  stackNumber,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  onSelect: (reference: PullRequestRef) => void;
  stackNumber: number;
}) {
  const query = usePullRequestStack(environmentId, reference);
  const body = buildPullRequestStackBodyModel({
    stackNumber,
    stack: query.data,
    isPending: query.isPending,
    error: query.error,
  });
  if (query.data !== null && body.kind === "stack") {
    return (
      <>
        <PullRequestStackHeader number={body.number} notice={query.notice} stale={!!query.error} />
        {body.retryLabel !== null ? (
          <MenuItem onClick={query.refresh}>{body.retryLabel}</MenuItem>
        ) : null}
        <PullRequestStackLayers stack={query.data} reference={reference} onSelect={onSelect} />
      </>
    );
  }
  return (
    <>
      <PullRequestStackHeader number={body.number} />
      {body.kind === "message" ? <MenuGroupLabel>{body.message}</MenuGroupLabel> : null}
    </>
  );
}

export function PullRequestStackPopover({
  environmentId,
  reference,
  membership,
  onSelect,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  membership: PullRequestStackMembership;
  onSelect: (reference: PullRequestRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const model = buildPullRequestStackPopoverModel(membership);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              nativeButton={false}
              render={
                <span
                  role="button"
                  tabIndex={0}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-normal text-muted-foreground"
                />
              }
              aria-label={model.ariaLabel}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <PullRequestGlyph.stack aria-hidden className="size-3" />
              {model.positionLabel}
            </MenuTrigger>
          }
        />
        <TooltipPopup>{model.tooltip}</TooltipPopup>
      </Tooltip>
      <MenuPopup
        align="start"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <MenuGroup>
          {open ? (
            <StackBody
              environmentId={environmentId}
              reference={reference}
              stackNumber={membership.number}
              onSelect={(target) => {
                setOpen(false);
                onSelect(target);
              }}
            />
          ) : null}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
