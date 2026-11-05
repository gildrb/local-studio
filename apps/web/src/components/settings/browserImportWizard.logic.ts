import {
  BROWSER_IMPORT_FAILURE_COPY,
  type BrowserImportFailureReason,
  type BrowserImportSource,
} from "@t3tools/contracts";

export interface WizardTargetProfile {
  readonly id: string;
  readonly name: string;
}

export type WizardTarget =
  | { readonly kind: "new"; readonly profileId: string }
  | { readonly kind: "existing"; readonly profileId: string; readonly name: string };

export type WizardTargetSelection =
  | { readonly kind: "new" }
  | { readonly kind: "existing"; readonly profileId: string };

export function initialTargetSelection(
  canCreateProfile: boolean,
  targetProfiles: ReadonlyArray<WizardTargetProfile>,
): WizardTargetSelection {
  if (canCreateProfile) return { kind: "new" };
  const first = targetProfiles[0];
  return first ? { kind: "existing", profileId: first.id } : { kind: "new" };
}

export function resolveWizardTarget(
  selection: WizardTargetSelection,
  newProfileId: string,
  targetProfiles: ReadonlyArray<WizardTargetProfile>,
): WizardTarget | undefined {
  if (selection.kind === "new") return { kind: "new", profileId: newProfileId };
  const profile = targetProfiles.find((candidate) => candidate.id === selection.profileId);
  if (profile === undefined) return undefined;
  return {
    kind: "existing",
    profileId: selection.profileId,
    name: profile.name,
  };
}

/**
 * What the import wizard produces once it has actually tried to import. The
 * parent runs the import and classifies the result; the wizard only reacts to
 * it, which keeps the step transitions pure and testable.
 */
export type ImportOutcome =
  | {
      readonly kind: "imported";
      readonly imported: number;
      readonly skipped: number;
      readonly skippedDomains: ReadonlyArray<string>;
      readonly targetName: string;
    }
  | { readonly kind: "blocked"; readonly reason: BrowserImportFailureReason };

/**
 * The wizard's screens. Every one is a place the user can act from — there are
 * no dead ends. `blocked` covers the reasons no local step recovers.
 */
export type WizardStep =
  | { readonly step: "quit" }
  | {
      readonly step: "fullDiskAccess";
      readonly resume: "configure" | "import";
      readonly checked?: boolean;
    }
  | { readonly step: "configure" }
  | { readonly step: "checking"; readonly check: "browser" | "fullDiskAccess" }
  | { readonly step: "importing" }
  | {
      readonly step: "done";
      readonly imported: number;
      readonly skipped: number;
      readonly skippedDomains: ReadonlyArray<string>;
      readonly targetName: string;
    }
  | { readonly step: "blocked"; readonly reason: BrowserImportFailureReason };

/** The import owns its target partition until the write finishes. */
export function canCloseWizard(step: WizardStep): boolean {
  return step.step !== "importing";
}

/**
 * Where the wizard opens for a source. A running browser is the one thing we
 * know up front, from the source listing; everything else is discovered by
 * trying, so the wizard starts by letting the user choose what to import.
 */
export function initialWizardStep(source: BrowserImportSource): WizardStep {
  if (source.unavailable === "browserRunning") return { step: "quit" };
  if (source.unavailable === "needsFullDiskAccess") {
    return { step: "fullDiskAccess", resume: "configure" };
  }
  if (source.unavailable !== undefined) return { step: "blocked", reason: source.unavailable };
  if (source.profiles.length === 0) return { step: "blocked", reason: "unknownSourceProfile" };
  return { step: "configure" };
}

/** Where an attempted import lands the wizard, by how it turned out. */
export function outcomeToStep(outcome: ImportOutcome): WizardStep {
  if (outcome.kind === "imported") {
    return {
      step: "done",
      imported: outcome.imported,
      skipped: outcome.skipped,
      skippedDomains: outcome.skippedDomains,
      targetName: outcome.targetName,
    };
  }
  // A browser that reopened mid-import routes back to the quit screen; every
  // other failure surfaces on the blocked screen, which offers a retry when
  // one could help.
  if (outcome.reason === "browserRunning") return { step: "quit" };
  if (outcome.reason === "needsFullDiskAccess") {
    // The failed import already checked access, so explain that it is still
    // denied instead of returning to an indistinguishable permission screen.
    return { step: "fullDiskAccess", resume: "import", checked: true };
  }
  return { step: "blocked", reason: outcome.reason };
}

/** Where a fresh availability check lands the wizard after the user quits. */
export function refreshedSourceStep(source: BrowserImportSource | undefined): WizardStep {
  if (source === undefined) return { step: "blocked", reason: "unknownSource" };
  return initialWizardStep(source);
}

/** A denied FDA recheck returns to the permission step with visible feedback. */
export function fullDiskAccessRecheckStep(source: BrowserImportSource | undefined): WizardStep {
  const next = refreshedSourceStep(source);
  return next.step === "fullDiskAccess" ? { ...next, checked: true } : next;
}

/** Preserve the chosen source profile when a post-quit refresh still lists it. */
export function refreshedSourceProfileDirectory(
  currentDirectory: string,
  source: BrowserImportSource,
): string {
  if (source.profiles.some((profile) => profile.directory === currentDirectory)) {
    return currentDirectory;
  }
  return source.profiles[0]?.directory ?? "";
}

/**
 * Whether retrying could clear a failure. The keychain prompt can be approved
 * on a second try, a missing key appears once the user signs in to the
 * browser (which is what its copy asks for), and a read or session error may
 * be transient; an unsupported browser will not change, so it gets no retry
 * button.
 */
export function isRetryableReason(reason: BrowserImportFailureReason): boolean {
  switch (reason) {
    case "needsKeychainApproval":
    case "keychainItemMissing":
    case "keychainUnavailable":
    case "readFailed":
    case "sessionUnavailable":
    case "profileNotSaved":
      return true;
    default:
      return false;
  }
}

/**
 * Names the sites whose cookies were skipped: "example.com and google.com",
 * or "a, b, c and 4 more" past a few, so the line stays short.
 */
export function formatSkippedDomains(domains: ReadonlyArray<string>): string {
  if (domains.length === 0) return "";
  if (domains.length === 1) return domains[0]!;
  if (domains.length <= 3) return `${domains.slice(0, -1).join(", ")} and ${domains.at(-1)}`;
  return `${domains.slice(0, 3).join(", ")} and ${domains.length - 3} more`;
}

export const WIZARD_TARGET_UNAVAILABLE_MESSAGE =
  "That profile is no longer available. Choose where to import these cookies.";

export const WIZARD_FAILED_STEP: WizardStep = { step: "blocked", reason: "readFailed" };

export const FULL_DISK_ACCESS_OPEN_FAILED_MESSAGE =
  "Could not open System Settings. Try Allow again.";

export type WizardImportDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "targetUnavailable";
      readonly targetError: string;
      readonly step: WizardStep;
    }
  | { readonly kind: "start"; readonly target: WizardTarget; readonly step: WizardStep };

export function resolveWizardImport(input: {
  readonly importInFlight: boolean;
  readonly selection: WizardTargetSelection;
  readonly newProfileId: string;
  readonly targetProfiles: ReadonlyArray<WizardTargetProfile>;
}): WizardImportDecision {
  if (input.importInFlight) return { kind: "ignore" };
  const target = resolveWizardTarget(input.selection, input.newProfileId, input.targetProfiles);
  if (target === undefined) {
    return {
      kind: "targetUnavailable",
      targetError: WIZARD_TARGET_UNAVAILABLE_MESSAGE,
      step: { step: "configure" },
    };
  }
  return { kind: "start", target, step: { step: "importing" } };
}

export function isImportSourceReadable(source: BrowserImportSource | undefined): boolean {
  return source !== undefined && source.unavailable === undefined;
}

export type WizardTileModel = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly selected: boolean;
};

export type WizardTargetTileModel = WizardTileModel & {
  readonly selection: WizardTargetSelection;
};

export type WizardQuitStepModel = {
  readonly kind: "quit";
  readonly title: string;
  readonly description: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
};

export type WizardFullDiskAccessStepModel = {
  readonly kind: "fullDiskAccess";
  readonly title: string;
  readonly description: string;
  readonly permission: {
    readonly id: "fullDiskAccess";
    readonly icon: "hard-drive";
    readonly title: string;
    readonly description: string;
  };
  readonly stillRequired: boolean;
  readonly onGranted: "import" | "recheck";
  readonly cancelLabel: string;
  readonly continueLabel: string;
};

export type WizardConfigureStepModel = {
  readonly kind: "configure";
  readonly title: string;
  readonly description: string;
  readonly fromLabel: string;
  readonly intoLabel: string;
  readonly sourceProfiles: ReadonlyArray<WizardTileModel>;
  readonly targets: ReadonlyArray<WizardTargetTileModel>;
  readonly feedback: string | null;
  readonly cancelLabel: string;
  readonly importLabel: string;
  readonly importDisabled: boolean;
};

export type WizardImportingStepModel = {
  readonly kind: "importing";
  readonly title: string;
  readonly description: string;
  readonly progressLabel: string;
};

export type WizardCheckingStepModel = {
  readonly kind: "checking";
  readonly title: string;
  readonly description: string;
  readonly progressLabel: string;
};

export type WizardDoneStepModel = {
  readonly kind: "done";
  readonly title: string;
  readonly description: string;
  readonly skipped: { readonly label: string; readonly domains: string } | null;
  readonly doneLabel: string;
};

export type WizardBlockedStepModel = {
  readonly kind: "blocked";
  readonly title: string;
  readonly description: string;
  readonly closeLabel: string;
  readonly retryLabel: string | null;
};

export type WizardProgressStepModel = WizardImportingStepModel | WizardCheckingStepModel;

export type WizardStepModel =
  | WizardQuitStepModel
  | WizardFullDiskAccessStepModel
  | WizardConfigureStepModel
  | WizardImportingStepModel
  | WizardCheckingStepModel
  | WizardDoneStepModel
  | WizardBlockedStepModel;

export type BrowserImportWizardModelInput = {
  readonly step: WizardStep;
  readonly source: BrowserImportSource;
  readonly destinationEnvironmentName: string;
  readonly targetProfiles: ReadonlyArray<WizardTargetProfile>;
  readonly canCreateProfile: boolean;
  readonly sourceProfileDirectory: string;
  readonly target: WizardTargetSelection;
  readonly targetError: string | null;
};

export type BrowserImportWizardModel = {
  readonly closeable: boolean;
  readonly step: WizardStepModel;
};

function cookieCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "cookie" : "cookies"}`;
}

function buildConfigureStepModel(input: BrowserImportWizardModelInput): WizardConfigureStepModel {
  const { source, target, targetProfiles, canCreateProfile } = input;
  const targetMissing =
    target.kind === "existing" &&
    !targetProfiles.some((profile) => profile.id === target.profileId);
  const targetUncreatable = target.kind === "new" && !canCreateProfile;
  const newTarget: ReadonlyArray<WizardTargetTileModel> = canCreateProfile
    ? [
        {
          id: "new",
          title: "New profile",
          subtitle: "Created for these cookies",
          selected: target.kind === "new",
          selection: { kind: "new" },
        },
      ]
    : [];
  return {
    kind: "configure",
    title: `Import from ${source.name}`,
    description: `Choose which cookies to import for ${input.destinationEnvironmentName}.`,
    fromLabel: "From",
    intoLabel: "Into",
    sourceProfiles: source.profiles.map((profile) => ({
      id: profile.directory,
      title: profile.name,
      subtitle:
        profile.cookieCount === undefined
          ? null
          : profile.cookieCount === 0
            ? "no cookies"
            : cookieCount(profile.cookieCount),
      selected: input.sourceProfileDirectory === profile.directory,
    })),
    targets: [
      ...newTarget,
      ...targetProfiles.map((profile) => ({
        id: profile.id,
        title: profile.name,
        subtitle: "Existing profile",
        selected: target.kind === "existing" && target.profileId === profile.id,
        selection: { kind: "existing" as const, profileId: profile.id },
      })),
    ],
    feedback:
      input.targetError ??
      (targetMissing
        ? WIZARD_TARGET_UNAVAILABLE_MESSAGE
        : targetUncreatable
          ? "You've reached the profile limit. Choose an existing profile to import into."
          : null),
    cancelLabel: "Cancel",
    importLabel: "Import",
    importDisabled: input.sourceProfileDirectory === "" || targetMissing || targetUncreatable,
  };
}

function buildStepModel(input: BrowserImportWizardModelInput): WizardStepModel {
  const { step, source, destinationEnvironmentName } = input;
  switch (step.step) {
    case "quit":
      return {
        kind: "quit",
        title: `Quit ${source.name} to import`,
        description: `${source.name} is open, so its cookies can’t be read yet. Quit it, then continue.`,
        cancelLabel: "Cancel",
        confirmLabel: "I’ve quit it",
      };
    case "fullDiskAccess":
      return {
        kind: "fullDiskAccess",
        title: `Let T3 Code read ${source.name}’s cookies`,
        description: `To import cookies from ${source.name}, T3 Code needs Full Disk Access. Turn it on in System Settings, then come back to finish the import — you can revoke it again once the import is done.`,
        permission: {
          id: "fullDiskAccess",
          icon: "hard-drive",
          title: "Full Disk Access",
          description: `Read ${source.name}'s cookies for this import.`,
        },
        stillRequired: step.checked === true,
        onGranted: step.resume === "import" ? "import" : "recheck",
        cancelLabel: "Cancel",
        continueLabel: "Continue",
      };
    case "importing":
      return {
        kind: "importing",
        title: "Importing cookies",
        description: "This may take a moment.",
        progressLabel: "Importing…",
      };
    case "checking":
      return {
        kind: "checking",
        title: `Checking ${source.name}`,
        description:
          step.check === "fullDiskAccess"
            ? "Checking Full Disk Access."
            : "Checking whether the browser has closed.",
        progressLabel: step.check === "fullDiskAccess" ? "Checking access…" : "Checking…",
      };
    case "done":
      return {
        kind: "done",
        title:
          step.imported > 0
            ? `Imported ${cookieCount(step.imported)}`
            : step.skipped > 0
              ? `Skipped ${cookieCount(step.skipped)}`
              : "No cookies found",
        description:
          step.imported > 0
            ? `Added to ${step.targetName} for ${destinationEnvironmentName}.${step.skipped > 0 ? ` ${cookieCount(step.skipped)} skipped.` : ""}`
            : step.skipped > 0
              ? `No cookies were imported for ${destinationEnvironmentName}.`
              : `There were no cookies to import for ${destinationEnvironmentName}.`,
        skipped:
          step.skippedDomains.length > 0
            ? { label: "Skipped", domains: formatSkippedDomains(step.skippedDomains) }
            : null,
        doneLabel: "Done",
      };
    case "blocked":
      return {
        kind: "blocked",
        title: `Couldn’t import from ${source.name}`,
        description: BROWSER_IMPORT_FAILURE_COPY[step.reason],
        closeLabel: "Close",
        retryLabel: isRetryableReason(step.reason) ? "Try again" : null,
      };
    case "configure":
      return buildConfigureStepModel(input);
  }
}

export function buildBrowserImportWizardModel(
  input: BrowserImportWizardModelInput,
): BrowserImportWizardModel {
  return { closeable: canCloseWizard(input.step), step: buildStepModel(input) };
}

export type FullDiskAccessStatusModelInput = {
  readonly ready: boolean;
  readonly stillRequired: boolean;
  readonly openingError: string | null;
  readonly permissionError: string | null;
};

export type FullDiskAccessStatusModel = {
  readonly notice: string | null;
  readonly hint: string | null;
};

export function buildFullDiskAccessStatusModel(
  input: FullDiskAccessStatusModelInput,
): FullDiskAccessStatusModel {
  return {
    notice:
      input.openingError || input.permissionError
        ? (input.openingError ?? input.permissionError)
        : null,
    hint: input.ready
      ? null
      : input.stillRequired
        ? "Access is still required. Quit and reopen T3 Code if you just allowed it, then retry the import."
        : "If access doesn't update after you allow it, quit and reopen T3 Code, then retry the import.",
  };
}
