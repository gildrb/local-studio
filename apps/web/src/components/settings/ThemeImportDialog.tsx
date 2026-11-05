import { DownloadIcon, PlusIcon } from "lucide-react";
import type { ChangeEvent, DragEvent, UIEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import {
  getCustomThemes,
  installCustomTheme,
  removeCustomTheme,
  updateCustomTheme,
  type ThemeDefinition,
} from "../../themePalette";
import { pairVsCodeThemes, resolveThemeLabelCollisions } from "../../vscodeThemeImport";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { ThemeSearchSection } from "./ThemeSearchSection";
import {
  buildThemeImportModel,
  describeOversizedThemeFile,
  highlightJson,
  isThemeInstalled,
  MAX_HIGHLIGHTED_JSON_LENGTH,
  parseThemeImportValue,
  resolveThemeImportBatchOutcome,
  resolveThemeImportCopy,
  resolveThemeImportPreferredName,
  resolveThemeImportSubmit,
  resolveThemeImportUpdate,
  themeImportErrorMessage,
  themeImportFailure,
  THEME_IMPORT_ACTIVATION_FAILURE_MESSAGE,
  THEME_IMPORT_READ_FAILURE_MESSAGE,
  type ThemeImportConflictMode,
} from "./ThemeImportDialog.logic";

function ThemeJsonEditor({
  id,
  value,
  ariaLabel,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  ariaLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const isPlainText = value.length > MAX_HIGHLIGHTED_JSON_LENGTH;
  const highlightedJson = useMemo(
    () => (value.length > MAX_HIGHLIGHTED_JSON_LENGTH ? "" : highlightJson(value)),
    [value],
  );

  const syncScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    const highlightElement = highlightRef.current;
    if (!highlightElement) return;
    highlightElement.scrollTop = event.currentTarget.scrollTop;
    highlightElement.scrollLeft = event.currentTarget.scrollLeft;
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-input bg-background shadow-xs/5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/24">
      {isPlainText ? null : (
        <pre
          ref={highlightRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground"
        >
          <code dangerouslySetInnerHTML={{ __html: highlightedJson }} />
        </pre>
      )}
      <textarea
        aria-label={ariaLabel}
        className={cn(
          "relative z-10 block min-h-44 w-full resize-y overflow-auto bg-transparent p-3 font-mono text-xs leading-5 caret-foreground outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
          isPlainText ? "text-foreground" : "text-transparent",
        )}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}

/** What the import pipeline needs from a file; DOM File satisfies it. */
type ImportableThemeFile = { name: string; size: number; text: () => Promise<string> };

export function ThemeImportDialog({
  open,
  onOpenChange,
  onImported,
  onImportedMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (theme: ThemeDefinition) => boolean;
  /** Batch imports install without activating; the caller reports them. */
  onImportedMany: (themes: ReadonlyArray<ThemeDefinition>, context: { updated: boolean }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  // Imports whose id is already installed wait here for an update-or-copy
  // decision instead of failing.
  const [conflicts, setConflicts] = useState<ReadonlyArray<ThemeDefinition> | null>(null);
  const importRequestRef = useRef(0);

  useEffect(() => {
    importRequestRef.current += 1;
    // Reset on close too: a dialog dismissed mid-drag would otherwise reopen
    // still wearing the drop highlight.
    setIsDropTarget(false);
    if (!open) return;
    setJson("");
    setFileName(null);
    setError(null);
    setIsReading(false);
    setConflicts(null);
  }, [open]);

  const readThemeFile = useCallback(async (file: ImportableThemeFile) => {
    // Check the size first: reading a large file is what locks the UI, so it
    // never gets read at all.
    const oversized = describeOversizedThemeFile(file.size);
    if (oversized) {
      setError(oversized);
      return;
    }

    const requestId = ++importRequestRef.current;
    setIsReading(true);
    try {
      const fileText = await file.text();
      if (requestId !== importRequestRef.current) return;
      setJson(fileText);
      setFileName(file.name);
      setError(null);
    } catch {
      if (requestId !== importRequestRef.current) return;
      setError(THEME_IMPORT_READ_FAILURE_MESSAGE);
    } finally {
      if (requestId === importRequestRef.current) setIsReading(false);
    }
  }, []);

  // Several files at once import as a batch: VS Code families pair their
  // light and dark variants, everything installs without activating, and the
  // single-file flow keeps filling the editor for review.
  const readThemeBatch = useCallback(
    async (files: ReadonlyArray<ImportableThemeFile>) => {
      const requestId = ++importRequestRef.current;
      setIsReading(true);
      const failures: string[] = [];
      const parsed: Array<{ theme: ThemeDefinition; sourceName: string }> = [];
      try {
        for (const file of files) {
          const oversized = describeOversizedThemeFile(file.size);
          if (oversized) {
            failures.push(`${file.name}: too large`);
            continue;
          }
          try {
            const value: unknown = JSON.parse(await file.text());
            parsed.push({ sourceName: file.name, theme: parseThemeImportValue(value) });
          } catch (cause) {
            failures.push(themeImportFailure(file.name, cause, "not a theme file"));
          }
        }
        if (requestId !== importRequestRef.current) return;
        const installed: ThemeDefinition[] = [];
        const conflicting: ThemeDefinition[] = [];
        for (const theme of pairVsCodeThemes(resolveThemeLabelCollisions(parsed))) {
          if (isThemeInstalled(theme, getCustomThemes())) {
            conflicting.push(theme);
            continue;
          }
          try {
            installed.push(installCustomTheme(theme));
          } catch (cause) {
            failures.push(themeImportFailure(theme.label, cause, "could not install"));
          }
        }
        if (installed.length > 0) onImportedMany(installed, { updated: false });
        const outcome = resolveThemeImportBatchOutcome({
          installedCount: installed.length,
          failures,
          conflicting,
        });
        if (outcome.kind === "error") setError(outcome.message);
        else if (outcome.kind === "conflicts") setConflicts(outcome.themes);
        else if (outcome.kind === "close") onOpenChange(false);
      } finally {
        if (requestId === importRequestRef.current) setIsReading(false);
      }
    },
    [onImportedMany, onOpenChange],
  );

  const readThemeFiles = useCallback(
    (files: ReadonlyArray<ImportableThemeFile>) => {
      if (files.length === 0) return;
      if (files.length === 1) void readThemeFile(files[0]!);
      else void readThemeBatch(files);
    },
    [readThemeBatch, readThemeFile],
  );

  // On desktop the native picker opens in ~/.vscode/extensions (when it
  // exists) and reads the files in the main process; the browser input is
  // the fallback everywhere else.
  const openFilePicker = useCallback(() => {
    const bridge = window.desktopBridge;
    if (bridge?.pickThemeFiles) {
      void bridge.pickThemeFiles().then((picked) => {
        if (!picked || picked.length === 0) return;
        readThemeFiles(
          picked.map((file) => ({
            name: file.name,
            size: file.size,
            text: () => Promise.resolve(file.text),
          })),
        );
      });
      return;
    }
    fileInputRef.current?.click();
  }, [readThemeFiles]);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = [...(event.currentTarget.files ?? [])];
      event.currentTarget.value = "";
      readThemeFiles(files);
    },
    [readThemeFiles],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDropTarget(false);
      readThemeFiles([...event.dataTransfer.files]);
    },
    [readThemeFiles],
  );

  const resolveConflicts = useCallback(
    (mode: ThemeImportConflictMode) => {
      if (!conflicts) return;
      const resolved: ThemeDefinition[] = [];
      const failures: string[] = [];
      const preferredName = resolveThemeImportPreferredName(conflicts, fileName);
      for (const theme of conflicts) {
        try {
          resolved.push(
            mode === "update"
              ? updateCustomTheme(resolveThemeImportUpdate(theme, getCustomThemes()))
              : installCustomTheme(resolveThemeImportCopy(theme, preferredName, getCustomThemes())),
          );
        } catch (cause) {
          failures.push(themeImportFailure(theme.label, cause, "failed"));
        }
      }
      if (resolved.length > 0) onImportedMany(resolved, { updated: mode === "update" });
      setConflicts(null);
      if (failures.length > 0) setError(failures.join(" — "));
      else onOpenChange(false);
    },
    [conflicts, fileName, onImportedMany, onOpenChange],
  );

  const handleSubmit = useCallback(() => {
    const decision = resolveThemeImportSubmit({ json, customThemes: getCustomThemes() });
    if (decision.kind === "error") {
      setError(decision.message);
      return;
    }
    if (decision.kind === "conflict") {
      setError(null);
      setConflicts([decision.theme]);
      return;
    }
    try {
      const installedTheme = installCustomTheme(decision.theme);
      if (!onImported(installedTheme)) {
        // Roll the install back so a retry can run it again instead of
        // failing on the already-taken theme id.
        try {
          removeCustomTheme(installedTheme.id);
        } catch {
          // Storage is failing wholesale; the error below covers it.
        }
        setError(THEME_IMPORT_ACTIVATION_FAILURE_MESSAGE);
        return;
      }
      onOpenChange(false);
    } catch (cause) {
      setError(themeImportErrorMessage(cause));
    }
  }, [json, onImported, onOpenChange]);

  const model = buildThemeImportModel({
    json,
    fileName,
    error,
    isReading,
    isDropTarget,
    conflicts,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setError(null);
        onOpenChange(nextOpen);
      }}
    >
      <DialogPopup className="max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <ThemeSearchSection
            onInstalled={(themes, context) => {
              onImportedMany(themes, context);
              onOpenChange(false);
            }}
            open={open}
          />

          <div className="flex items-center gap-3" aria-hidden>
            <div className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground text-2xs uppercase tracking-wider">
              {model.dividerLabel}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {(() => {
            const view = model.view;
            const dropHandlers = {
              onDragEnter: (event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setIsDropTarget(true);
              },
              onDragOver: (event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setIsDropTarget(true);
              },
              onDragLeave: (event: DragEvent<HTMLDivElement>) => {
                // Ignore moves between children of the drop zone.
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setIsDropTarget(false);
              },
              onDrop: handleDrop,
            };
            const fileInput = (
              <input
                ref={fileInputRef}
                accept=".json,application/json"
                className="sr-only"
                onChange={handleFileChange}
                multiple
                type="file"
              />
            );
            if (view.kind === "conflicts") {
              return (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <p className="text-sm font-medium">{view.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{view.themeLabels}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => resolveConflicts("update")}>
                      {view.updateLabel}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolveConflicts("copy")}>
                      {view.copyLabel}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConflicts(null)}>
                      {view.backLabel}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                      {view.cancelLabel}
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <div className="space-y-4">
                <div
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3 transition-colors",
                    view.dropActive ? "border-ring bg-accent/20" : "border-border/80 bg-muted/20",
                  )}
                  {...dropHandlers}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{view.fileTitle}</p>
                    <p className="truncate text-xs text-muted-foreground">{view.fileSubtitle}</p>
                  </div>
                  <Button
                    disabled={view.chooseDisabled}
                    size="sm"
                    variant="outline"
                    onClick={openFilePicker}
                  >
                    <DownloadIcon />
                    {view.chooseLabel}
                  </Button>
                  {fileInput}
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <label className="text-sm font-medium" htmlFor="theme-json-editor">
                      {view.editorLabel}
                    </label>
                  </div>
                  <ThemeJsonEditor
                    ariaLabel={view.editorAriaLabel}
                    id="theme-json-editor"
                    onChange={setJson}
                    placeholder={view.editorPlaceholder}
                    value={view.editorValue}
                  />
                </div>
                {/* The actions live with the import section, not in a DialogFooter,
                    because Add theme only applies to the file in this section. Pinning
                    them at the modal bottom would read as a modal-scoped action when
                    the dialog also has the search and conflict views. */}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>
                    {view.cancelLabel}
                  </Button>
                  <Button disabled={view.submitDisabled} onClick={handleSubmit}>
                    <PlusIcon />
                    {view.submitLabel}
                  </Button>
                </div>
              </div>
            );
          })()}

          {model.error ? (
            <Alert aria-live="polite" variant="error">
              {model.error}
            </Alert>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
