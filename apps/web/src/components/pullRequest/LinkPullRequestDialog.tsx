import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useProjects, useThreadShell } from "~/state/entities";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Atom } from "effect/unstable/reactivity";
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
import {
  buildLinkPullRequestDialogModel,
  linkPullRequestSubmitFailureMessage,
  resolveLinkPullRequestInput,
  resolveLinkPullRequestProject,
  resolveLinkPullRequestSubmit,
} from "./LinkPullRequestDialog.logic";

/**
 * Which thread has the link dialog open, set by whichever entry point asked (command palette,
 * pull-requests surface, detail panel) and rendered once by the chat view so the dialog outlives
 * a palette that closes the moment its command runs.
 */
const linkPullRequestDialogThreadAtom = Atom.make<ScopedThreadRef | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("pull-requests:link-dialog-thread"),
);

export function openLinkPullRequestDialog(threadRef: ScopedThreadRef): void {
  appAtomRegistry.set(linkPullRequestDialogThreadAtom, threadRef);
}

interface LinkPullRequestDialogProps {
  open: boolean;
  threadRef: ScopedThreadRef;
  /** The thread's own project: bare numbers resolve against its repository. */
  projectId: string | null;
  onOpenChange: (open: boolean) => void;
}

/** Mounted once per chat view; shows the dialog for whichever thread asked for it. */
export function LinkPullRequestDialogHost() {
  const threadRef = useAtomValue(linkPullRequestDialogThreadAtom);
  const thread = useThreadShell(threadRef);
  const linking = usePullRequestLinking(threadRef?.environmentId);
  if (threadRef === null || linking.mode === "unsupported") return null;
  return (
    <LinkPullRequestDialog
      open
      threadRef={threadRef}
      projectId={thread?.projectId ?? null}
      onOpenChange={(open) => {
        if (!open) appAtomRegistry.set(linkPullRequestDialogThreadAtom, null);
      }}
    />
  );
}

function LinkPullRequestDialog({
  open,
  threadRef,
  projectId,
  onOpenChange,
}: LinkPullRequestDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const projects = useProjects();
  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === threadRef.environmentId),
    [projects, threadRef.environmentId],
  );
  const ownProject = useMemo(
    () =>
      resolveLinkPullRequestProject(
        environmentProjects.find((candidate) => candidate.id === projectId)?.repositoryIdentity,
      ),
    [environmentProjects, projectId],
  );
  const linking = usePullRequestLinking(threadRef.environmentId);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReference("");
    setDirty(false);
    setSubmitError(null);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const resolved = useMemo(
    () =>
      resolveLinkPullRequestInput({
        reference,
        project: ownProject,
        hasProject: (reference) => linking.canLink(reference.url),
      }),
    [linking, ownProject, reference],
  );

  const submit = useCallback(async () => {
    setDirty(true);
    const decision = resolveLinkPullRequestSubmit(resolved);
    if (decision.kind === "invalid") return;
    setSubmitError(null);
    setPending(true);
    try {
      await linking.changeLink(threadRef, decision.url, true);
    } catch (error) {
      setSubmitError(linkPullRequestSubmitFailureMessage(error));
      return;
    } finally {
      setPending(false);
    }
    onOpenChange(false);
  }, [linking, onOpenChange, resolved, threadRef]);

  const model = buildLinkPullRequestDialogModel({
    reference,
    dirty,
    pending,
    submitError,
    resolution: resolved,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (model.dismissible ? onOpenChange(next) : undefined)}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            ref={inputRef}
            placeholder={model.inputPlaceholder}
            value={reference}
            onChange={(event) => {
              setDirty(true);
              setReference(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void submit();
            }}
          />
          {model.preview !== null ? (
            <p className="truncate text-muted-foreground text-xs">{model.preview}</p>
          ) : null}
          {model.error ? <p className="text-destructive text-xs">{model.error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={model.cancelDisabled}
          >
            {model.cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={model.submitDisabled}
          >
            {model.submitLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
