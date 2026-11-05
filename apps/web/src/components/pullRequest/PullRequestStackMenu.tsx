import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestStack,
  PullRequestMergeMethod,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { useAtomCommand } from "~/state/use-atom-command";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger, MenuItem, MenuGroup, MenuSeparator } from "../ui/menu";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { PullRequestStackLayers } from "./PullRequestStackLayers";
import { PullRequestStackHeader } from "./PullRequestStackHeader";
import { PullRequestStackLayerContent } from "./PullRequestStackLayerContent";
import { PullRequestGlyph } from "./pullRequestIcons";
import {
  buildPullRequestStackMenuModel,
  pullRequestStackActionToast,
  resolvePullRequestStackAction,
  type PullRequestStackConfirmation,
} from "./PullRequestStackMenu.logic";

export function PullRequestStackMenu({
  stack,
  reference,
  environmentId,
  canMerge,
  canRebase,
  mergeMethod,
  onSelect,
  onActed,
  notice,
  onRetry,
}: {
  notice?: string | null;
  onRetry?: (() => void) | undefined;
  stack: PullRequestStack;
  reference: PullRequestRef;
  environmentId: EnvironmentId;
  canMerge: boolean;
  canRebase: boolean;
  mergeMethod: PullRequestMergeMethod;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  onActed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<PullRequestStackConfirmation | null>(null);
  const [pending, setPending] = useState(false);
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const model = buildPullRequestStackMenuModel({
    stack,
    referenceNumber: reference.number,
    canMerge,
    canRebase,
    mergeMethod,
    pending,
    notice: notice ?? null,
    stale: !!onRetry,
    confirmation,
  });
  const run = async () => {
    const decision = resolvePullRequestStackAction({
      stack,
      referenceNumber: reference.number,
      canMerge,
      canRebase,
      mergeMethod,
      pending,
      confirmation,
    });
    if (decision.kind === "ignore") return;
    setPending(true);
    const result = await runAction({
      environmentId,
      input: {
        ...reference,
        number: decision.number,
        stackNumber: decision.stackNumber,
        expectedStackHeads: decision.expectedStackHeads,
        action: decision.action,
        ...(decision.mergeMethod !== null
          ? { mergeMethod: decision.mergeMethod }
          : { updateMethod: "rebase" }),
      },
    });
    setPending(false);
    setConfirmation(null);
    onActed();
    toastManager.add(
      pullRequestStackActionToast({
        action: decision.action,
        failure: result._tag === "Failure" ? String(squashAtomCommandFailure(result)) : null,
      }),
    );
  };
  const confirmationLayers = model.dialog.layerNumbers.flatMap(
    (number) => stack.layers.find((layer) => layer.number === number) ?? [],
  );
  return (
    <>
      <Menu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={<Button variant="ghost" size="xs" aria-label={model.trigger.ariaLabel} />}
              >
                <PullRequestGlyph.stack aria-hidden className="size-3.5" />{" "}
                {model.trigger.positionLabel}
                {model.trigger.warning ? (
                  <TriangleAlertIcon aria-hidden className="size-3 text-warning" />
                ) : null}
              </MenuTrigger>
            }
          />
          <TooltipPopup>{model.trigger.tooltip}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="start">
          <MenuGroup>
            <PullRequestStackHeader number={stack.number} notice={notice} stale={!!onRetry} />
            {onRetry && model.retryLabel !== null ? (
              <MenuItem onClick={onRetry}>{model.retryLabel}</MenuItem>
            ) : null}
            <PullRequestStackLayers
              stack={stack}
              reference={reference}
              pending={pending}
              onSelect={
                onSelect
                  ? (target) => {
                      setOpen(false);
                      onSelect(target);
                    }
                  : undefined
              }
            />
          </MenuGroup>
          {model.actionsVisible ? (
            <>
              <MenuSeparator />
              {model.mergeItem.visible ? (
                <MenuItem
                  disabled={model.mergeItem.disabled}
                  onClick={() => setConfirmation("merge")}
                >
                  <PullRequestGlyph.merged aria-hidden />
                  {model.mergeItem.label}
                </MenuItem>
              ) : null}
              {model.rebaseItem.visible ? (
                <MenuItem
                  disabled={model.rebaseItem.disabled}
                  onClick={() => setConfirmation("update-branch")}
                >
                  <RefreshCwIcon aria-hidden />
                  {model.rebaseItem.label}
                </MenuItem>
              ) : null}
              {model.blockedNote !== null ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">{model.blockedNote}</p>
              ) : null}
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {model.mergeButton.visible ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex">
                <Button
                  variant="default"
                  size="xs"
                  disabled={model.mergeButton.disabled}
                  onClick={() => setConfirmation("merge")}
                >
                  <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  {model.mergeButton.label}
                </Button>
              </span>
            }
          />
          <TooltipPopup>{model.mergeButton.tooltip}</TooltipPopup>
        </Tooltip>
      ) : null}
      <Dialog
        open={model.dialog.open}
        onOpenChange={(value) => {
          if (!value && model.dialog.dismissible) setConfirmation(null);
        }}
      >
        <DialogPopup className="max-w-md" showCloseButton={model.dialog.dismissible}>
          <DialogHeader>
            <DialogTitle>{model.dialog.title}</DialogTitle>
            <DialogDescription>{model.dialog.description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {confirmationLayers.map((layer) => (
                <li
                  key={layer.number}
                  className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2"
                >
                  <PullRequestStackLayerContent layer={layer} compact />
                </li>
              ))}
            </ul>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={model.dialog.buttonsDisabled}
              onClick={() => setConfirmation(null)}
            >
              {model.dialog.cancelLabel}
            </Button>
            <Button disabled={model.dialog.buttonsDisabled} onClick={() => void run()}>
              {model.dialog.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
