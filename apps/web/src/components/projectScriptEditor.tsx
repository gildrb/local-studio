import type { ProjectScript, ProjectScriptIcon } from "@t3tools/contracts";
import {
  BugIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  WrenchIcon,
} from "lucide-react";
import React, {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  buildProjectScriptEditorDialogCopy,
  errorMessageOr,
  projectScriptEditorFormFromInput,
  PROJECT_SCRIPT_ICON_OPTIONS,
  PROJECT_SCRIPT_SAVE_FAILED_MESSAGE,
  resolveProjectScriptEditorToggles,
  resolveProjectScriptKeybindingCapture,
  resolveProjectScriptSaveOutcome,
  resolveProjectScriptSubmission,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor.logic";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

export function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

/**
 * Add/edit dialog for a project script, shared by the chat-header scripts menu
 * and the project settings page. The parent owns which script (if any) is
 * being edited via `request`; the dialog owns the form state and validation.
 */
export function ProjectScriptEditorDialog({
  request,
  scripts,
  onSubmit,
  onDelete,
  onClose,
}: {
  request: ProjectScriptEditorRequest | null;
  /** Existing scripts, used to derive a unique id for new scripts. */
  scripts: ReadonlyArray<ProjectScript>;
  onSubmit: (
    scriptId: string | null,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDelete: (scriptId: string) => void;
  onClose: () => void;
}) {
  const formId = React.useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [savingRequest, setSavingRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const pendingSubmissionRef = useRef<{ request: ProjectScriptEditorRequest } | null>(null);

  const isOpen = request !== null;
  const isEditing = request?.scriptId != null;
  const isSaving = request !== null && savingRequest === request;

  // A save completion must not affect a replacement request or an unmounted editor.
  useLayoutEffect(
    () => () => {
      if (pendingSubmissionRef.current?.request === request) {
        pendingSubmissionRef.current = null;
      }
    },
    [request],
  );

  // Hydrate the form whenever a new request opens the dialog.
  useEffect(() => {
    if (!request) return;
    const form = projectScriptEditorFormFromInput(request.initial);
    setName(form.name);
    setCommand(form.command);
    setIcon(form.icon);
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(form.runOnWorktreeCreate);
    setWaitForSetup(form.waitForSetup);
    setKeybinding(form.keybinding);
    setPreviewUrl(form.previewUrl);
    setAutoOpenPreview(form.autoOpenPreview);
    setValidationError(request.error ?? null);
    setSavingRequest(null);
  }, [request]);

  const close = () => {
    pendingSubmissionRef.current = null;
    setSavingRequest(null);
    setIconPickerOpen(false);
    onClose();
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    const capture = resolveProjectScriptKeybindingCapture(event, navigator.platform);
    if (capture.kind === "pass-through") return;
    event.preventDefault();
    if (capture.kind === "set") setKeybinding(capture.keybinding);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || pendingSubmissionRef.current !== null) return;
    const submission = resolveProjectScriptSubmission({
      scriptId: request.scriptId,
      scripts,
      form: {
        name,
        command,
        icon,
        runOnWorktreeCreate,
        waitForSetup,
        keybinding,
        previewUrl,
        autoOpenPreview,
      },
    });
    if (submission.kind === "invalid") {
      setValidationError(submission.error);
      return;
    }
    setValidationError(null);

    const pending = { request };
    pendingSubmissionRef.current = pending;
    setSavingRequest(request);
    setIconPickerOpen(false);
    try {
      const result = await onSubmit(request.scriptId, submission.payload);
      if (pendingSubmissionRef.current === pending) {
        const outcome = resolveProjectScriptSaveOutcome(result);
        if (outcome.kind === "error") {
          setValidationError(outcome.message);
        } else if (outcome.kind === "close") {
          close();
        }
      }
    } catch (error) {
      if (pendingSubmissionRef.current === pending) {
        setValidationError(errorMessageOr(error, PROJECT_SCRIPT_SAVE_FAILED_MESSAGE));
      }
    }
    if (pendingSubmissionRef.current === pending) {
      pendingSubmissionRef.current = null;
      setSavingRequest(null);
    }
  };

  const copy = buildProjectScriptEditorDialogCopy({ isEditing, isSaving, name });
  const toggles = resolveProjectScriptEditorToggles({ runOnWorktreeCreate, previewUrl });

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} onSubmit={submit}>
              <fieldset className="space-y-4" disabled={isSaving}>
                <div className="space-y-1.5">
                  <Label htmlFor="script-name">Name</Label>
                  <div className="flex items-center gap-2">
                    <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            className="size-9 shrink-0"
                            aria-label="Choose icon"
                          />
                        }
                      >
                        <ScriptIcon icon={icon} className="size-4.5" />
                      </PopoverTrigger>
                      <PopoverPopup align="start">
                        <div className="grid grid-cols-3 gap-2">
                          {PROJECT_SCRIPT_ICON_OPTIONS.map((entry) => {
                            const isSelected = entry.id === icon;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs dark:border-transparent ${
                                  isSelected
                                    ? "border-primary/70 bg-primary/10 dark:ring-1 dark:ring-primary/30"
                                    : "border-border/70 hover:bg-accent/60 dark:bg-white/[0.035]"
                                }`}
                                onClick={() => {
                                  setIcon(entry.id);
                                  setIconPickerOpen(false);
                                }}
                              >
                                <ScriptIcon icon={entry.id} className="size-4" />
                                <span>{entry.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverPopup>
                    </Popover>
                    <Input
                      id="script-name"
                      autoFocus
                      placeholder="Test"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-keybinding">Keybinding</Label>
                  <Input
                    id="script-keybinding"
                    placeholder="Press shortcut"
                    value={keybinding}
                    readOnly
                    onKeyDown={captureKeybinding}
                  />
                  <p className="text-xs text-muted-foreground">
                    Press a shortcut. Use <code>Backspace</code> to clear. Shortcuts are
                    environment-wide. Projects using the same action share its shortcut.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-command">Command</Label>
                  <Textarea
                    id="script-command"
                    placeholder="bun test"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-preview-url">Preview URL (optional)</Label>
                  <Input
                    id="script-preview-url"
                    placeholder="http://localhost:5173"
                    value={previewUrl}
                    onChange={(event) => setPreviewUrl(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Open this URL in the in-app preview when this action runs.
                  </p>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
                  <span>Run automatically on worktree creation</span>
                  <Switch
                    checked={runOnWorktreeCreate}
                    onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                  />
                </label>
                <label
                  className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                    toggles.waitForSetupDisabled ? "opacity-60" : ""
                  }`}
                >
                  <span>Wait for it to finish before the agent starts</span>
                  <Switch
                    checked={waitForSetup}
                    disabled={toggles.waitForSetupDisabled}
                    onCheckedChange={(checked) => setWaitForSetup(Boolean(checked))}
                  />
                </label>
                <label
                  className={`flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035] ${
                    toggles.autoOpenPreviewDisabled ? "opacity-60" : ""
                  }`}
                >
                  <span>Open preview automatically when this action runs</span>
                  <Switch
                    checked={autoOpenPreview}
                    disabled={toggles.autoOpenPreviewDisabled}
                    onCheckedChange={(checked) => setAutoOpenPreview(Boolean(checked))}
                  />
                </label>
                {validationError && <p className="text-sm text-destructive">{validationError}</p>}
              </fieldset>
            </form>
          </DialogPanel>
          <DialogFooter variant="bare">
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                disabled={isSaving}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                {copy.deleteLabel}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={close}>
              {copy.cancelLabel}
            </Button>
            <Button form={formId} type="submit" disabled={isSaving}>
              {copy.submitLabel}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.deleteConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {copy.cancelLabel}
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={isSaving}
              onClick={() => {
                if (!request?.scriptId) return;
                setDeleteConfirmOpen(false);
                close();
                onDelete(request.scriptId);
              }}
            >
              {copy.deleteConfirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
