import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import type { BrowserImportSource } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowRightIcon, CheckIcon, HardDriveIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import {
  buildBrowserImportWizardModel,
  buildFullDiskAccessStatusModel,
  initialWizardStep,
  initialTargetSelection,
  isImportSourceReadable,
  fullDiskAccessRecheckStep,
  outcomeToStep,
  refreshedSourceProfileDirectory,
  refreshedSourceStep,
  resolveWizardImport,
  FULL_DISK_ACCESS_OPEN_FAILED_MESSAGE,
  WIZARD_FAILED_STEP,
  type ImportOutcome,
  type WizardBlockedStepModel,
  type WizardConfigureStepModel,
  type WizardDoneStepModel,
  type WizardFullDiskAccessStepModel,
  type WizardProgressStepModel,
  type WizardQuitStepModel,
  type WizardTarget,
  type WizardTargetProfile,
  type WizardTargetSelection,
  type WizardStep,
} from "./browserImportWizard.logic";

export type { WizardTarget } from "./browserImportWizard.logic";

interface BrowserImportWizardProps {
  readonly source: BrowserImportSource;
  /** Captured when the wizard opens so destination copy and writes stay stable. */
  readonly destinationEnvironmentName: string;
  /** Existing profiles the import can go into. Incognito is excluded upstream. */
  readonly targetProfiles: ReadonlyArray<WizardTargetProfile>;
  /** Whether a new profile can still be created (profile cap). */
  readonly canCreateProfile: boolean;
  /**
   * Runs the import and returns how it went. For a new target the caller only
   * registers the profile once the import succeeds, so a blocked attempt never
   * leaves an empty profile behind.
   */
  readonly onImport: (input: {
    readonly sourceProfileDirectory: string;
    readonly target: WizardTarget;
  }) => Promise<ImportOutcome>;
  /** Re-checks the source's availability after the user quits the browser. */
  readonly onRefreshSource: () => Promise<BrowserImportSource | undefined>;
  /** Opens the OS setting that grants access to a protected cookie store. */
  readonly onOpenFullDiskAccessSettings: () => void | Promise<void>;
  readonly onCheckFullDiskAccess?: (() => Promise<boolean>) | undefined;
  readonly onClose: () => void;
}

/**
 * Guides one browser's cookies into a profile.
 *
 * Every state the import can be in — the browser is open, a profile has to be
 * chosen, the read failed — is a screen the user can move forward from, rather
 * than a disabled row that only says no.
 */
export function BrowserImportWizard({
  source: initialSource,
  destinationEnvironmentName,
  targetProfiles,
  canCreateProfile,
  onImport,
  onRefreshSource,
  onOpenFullDiskAccessSettings,
  onCheckFullDiskAccess,
  onClose,
}: BrowserImportWizardProps) {
  const [source, setSource] = useState(initialSource);
  const [step, setStep] = useState<WizardStep>(() => initialWizardStep(initialSource));
  const [sourceProfileDirectory, setSourceProfileDirectory] = useState(
    () => initialSource.profiles[0]?.directory ?? "",
  );
  const [target, setTarget] = useState<WizardTargetSelection>(() =>
    initialTargetSelection(canCreateProfile, targetProfiles),
  );
  const [targetError, setTargetError] = useState<string | null>(null);
  // Stable across retries so a keychain re-approval lands in one profile, not
  // a new one each time.
  const newProfileId = useRef(`profile-${randomUUID()}`);
  // A second Import click before React has left the configure screen would
  // start a second run; the parent refuses it, and applying that refusal here
  // would drop the wizard out of the importing step while the first write is
  // still going. The ref settles synchronously where state does not.
  const importInFlight = useRef(false);
  const model = buildBrowserImportWizardModel({
    step,
    source,
    destinationEnvironmentName,
    targetProfiles,
    canCreateProfile,
    sourceProfileDirectory,
    target,
    targetError,
  });

  const runImport = () => {
    const decision = resolveWizardImport({
      importInFlight: importInFlight.current,
      selection: target,
      newProfileId: newProfileId.current,
      targetProfiles,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "targetUnavailable") {
      setTargetError(decision.targetError);
      setStep(decision.step);
      return;
    }
    setTargetError(null);
    importInFlight.current = true;
    setStep(decision.step);
    void onImport({ sourceProfileDirectory, target: decision.target })
      .then((outcome) => setStep(outcomeToStep(outcome)))
      .catch(() => setStep(WIZARD_FAILED_STEP))
      .finally(() => {
        importInFlight.current = false;
      });
  };

  // Re-lists the source after the user did something outside the app (quit the
  // browser, granted access) and routes to wherever the refreshed source says.
  const recheckSource = (
    check: "browser" | "fullDiskAccess",
    nextStep: (refreshed: BrowserImportSource | undefined) => WizardStep,
  ) => {
    setStep({ step: "checking", check });
    void onRefreshSource()
      .then((refreshed) => {
        if (refreshed) {
          setSource(refreshed);
          setSourceProfileDirectory((current) =>
            refreshedSourceProfileDirectory(current, refreshed),
          );
        }
        setStep(nextStep(refreshed));
      })
      .catch(() => setStep(WIZARD_FAILED_STEP));
  };
  const recheckAfterQuit = () => recheckSource("browser", refreshedSourceStep);
  const recheckFullDiskAccess = () => recheckSource("fullDiskAccess", fullDiskAccessRecheckStep);
  const stepModel = model.step;

  return (
    <Dialog open onOpenChange={(open) => (open || !model.closeable ? undefined : onClose())}>
      <DialogPopup className="max-w-lg" showCloseButton={model.closeable}>
        {stepModel.kind === "quit" ? (
          <QuitStep model={stepModel} onCancel={onClose} onRechecked={recheckAfterQuit} />
        ) : stepModel.kind === "fullDiskAccess" ? (
          <FullDiskAccessStep
            model={stepModel}
            onCancel={onClose}
            onOpenSettings={onOpenFullDiskAccessSettings}
            onCheck={
              onCheckFullDiskAccess ?? (async () => isImportSourceReadable(await onRefreshSource()))
            }
            onGranted={stepModel.onGranted === "import" ? runImport : recheckFullDiskAccess}
          />
        ) : stepModel.kind === "importing" || stepModel.kind === "checking" ? (
          <ProgressStep model={stepModel} />
        ) : stepModel.kind === "done" ? (
          <DoneStep model={stepModel} onClose={onClose} />
        ) : stepModel.kind === "blocked" ? (
          <BlockedStep
            model={stepModel}
            onClose={onClose}
            onRetry={stepModel.retryLabel !== null ? runImport : undefined}
          />
        ) : (
          <ConfigureStep
            model={stepModel}
            onSourceProfileChange={setSourceProfileDirectory}
            onTargetChange={(selection) => {
              setTarget(selection);
              setTargetError(null);
            }}
            onCancel={onClose}
            onImport={runImport}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function QuitStep({
  model,
  onCancel,
  onRechecked,
}: {
  readonly model: WizardQuitStepModel;
  readonly onCancel: () => void;
  readonly onRechecked: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription>{model.description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {model.cancelLabel}
        </Button>
        <Button onClick={onRechecked}>{model.confirmLabel}</Button>
      </DialogFooter>
    </>
  );
}

function FullDiskAccessStep({
  model,
  onCancel,
  onOpenSettings,
  onGranted,
  onCheck,
}: {
  readonly model: WizardFullDiskAccessStepModel;
  readonly onCancel: () => void;
  readonly onOpenSettings: () => void | Promise<void>;
  readonly onCheck: () => Promise<boolean>;
  readonly onGranted: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [openingError, setOpeningError] = useState<string | null>(null);
  const permission = usePermissionStatus(async () => ({ fullDiskAccess: await onCheck() }), {
    fullDiskAccess: false,
  });
  const ready = permission.isReady(["fullDiskAccess"]);
  const status = buildFullDiskAccessStatusModel({
    ready,
    stillRequired: model.stillRequired,
    openingError,
    permissionError: permission.error,
  });
  const allow = () => {
    if (opening) return;
    setOpening(true);
    setOpeningError(null);
    void Promise.resolve()
      .then(onOpenSettings)
      .catch(() => setOpeningError(FULL_DISK_ACCESS_OPEN_FAILED_MESSAGE))
      .finally(() => setOpening(false));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription>{model.description}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <PermissionChecklist
          busy={opening}
          permissions={[
            {
              id: model.permission.id,
              icon: (
                <HardDriveIcon
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ),
              title: model.permission.title,
              description: model.permission.description,
              granted: permission.status.fullDiskAccess,
              onAllow: () => void allow(),
            },
          ]}
        />
        {status.notice !== null ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {status.notice}
          </p>
        ) : null}
        {status.hint !== null ? (
          <p className="mt-3 text-xs text-muted-foreground">{status.hint}</p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {model.cancelLabel}
        </Button>
        <PermissionContinueButton ready={ready} busy={opening} onClick={onGranted}>
          {model.continueLabel}
        </PermissionContinueButton>
      </DialogFooter>
    </>
  );
}

function ConfigureStep({
  model,
  onSourceProfileChange,
  onTargetChange,
  onCancel,
  onImport,
}: {
  readonly model: WizardConfigureStepModel;
  readonly onSourceProfileChange: (directory: string) => void;
  readonly onTargetChange: (target: WizardTargetSelection) => void;
  readonly onCancel: () => void;
  readonly onImport: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription>{model.description}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {/* Side by side when the dialog has room, stacked when it doesn't. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <section className="flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {model.fromLabel}
            </p>
            {model.sourceProfiles.map((profile) => (
              <SelectableTile
                key={profile.id}
                selected={profile.selected}
                title={profile.title}
                subtitle={profile.subtitle ?? undefined}
                onSelect={() => onSourceProfileChange(profile.id)}
              />
            ))}
          </section>
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <ArrowDownIcon className="size-4 sm:hidden" />
            <ArrowRightIcon className="hidden size-4 sm:block" />
          </div>
          <section className="flex-1 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {model.intoLabel}
            </p>
            {model.targets.map((tile) => (
              <SelectableTile
                key={tile.id}
                selected={tile.selected}
                title={tile.title}
                subtitle={tile.subtitle ?? undefined}
                onSelect={() => onTargetChange(tile.selection)}
              />
            ))}
          </section>
        </div>
        {model.feedback ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {model.feedback}
          </p>
        ) : null}
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {model.cancelLabel}
        </Button>
        <Button disabled={model.importDisabled} onClick={onImport}>
          {model.importLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

/** One selectable option: a name, an optional detail line, and a check. */
function SelectableTile({
  selected,
  title,
  subtitle,
  onSelect,
}: {
  readonly selected: boolean;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/8"
          : "border-border/60 hover:border-border hover:bg-muted/40",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs tabular-nums text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {selected ? <CheckIcon className="size-2.5" /> : null}
      </span>
    </button>
  );
}

function ProgressStep({ model }: { readonly model: WizardProgressStepModel }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription>{model.description}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex items-center gap-3 py-2">
          <Spinner size="md" tone="muted" />
          <span className="text-sm text-muted-foreground">{model.progressLabel}</span>
        </div>
      </DialogPanel>
    </>
  );
}

function DoneStep({
  model,
  onClose,
}: {
  readonly model: WizardDoneStepModel;
  readonly onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription>{model.description}</DialogDescription>
      </DialogHeader>
      {model.skipped ? (
        <DialogPanel>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {model.skipped.label}
          </p>
          <p className="mt-1 text-sm text-foreground">{model.skipped.domains}</p>
        </DialogPanel>
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button />} onClick={onClose}>
          {model.doneLabel}
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function BlockedStep({
  model,
  onClose,
  onRetry,
}: {
  readonly model: WizardBlockedStepModel;
  readonly onClose: () => void;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription>{model.description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {model.closeLabel}
        </Button>
        {onRetry ? <Button onClick={onRetry}>{model.retryLabel}</Button> : null}
      </DialogFooter>
    </>
  );
}
