import { useAtomValue } from "@effect/atom-react";
import { type ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  GitActionProgressEvent,
  SourceControlCloneProtocol,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryVisibility,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  CheckIcon,
  ChevronDownIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  GitBranchPlusIcon,
  GitCommitIcon,
  InfoIcon,
  LockIcon,
  GlobeIcon,
} from "lucide-react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import {
  AzureDevOpsIcon,
  BitbucketIcon,
  GitHubIcon,
  GitLabIcon,
  ForgejoIcon,
} from "~/components/Icons";
import { RadioGroup } from "~/components/ui/radio-group";
import { Spinner } from "~/components/ui/spinner";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import {
  applyGitActionProgressEvent,
  buildDefaultBranchConfirmationModel,
  buildGitActionsToolbarModel,
  buildGitCommitDialogModel,
  GIT_ACTION_COPY,
  initialGitActionProgressState,
  resolveCommitDialogRunRequest,
  resolveDefaultBranchContinuation,
  resolveGitActionProgressDescription,
  resolveGitActionRunPlan,
  resolveGitMenuItemIntent,
  resolveGitPullSuccessToast,
  resolveGitQuickActionIntent,
  resolveLiveThreadBranchUpdate,
  resolveOpenExistingPrIntent,
  resolveThreadBranchMetadataPatch,
  resolveThreadBranchUpdate,
  toggleCommitDialogFileExclusion,
  toggleCommitDialogSelectAll,
  type GitActionMenuItem,
  type GitActionProgressState,
  type GitActionRunRequest,
  type GitToolbarIconId,
  type PendingDefaultBranchAction,
} from "./GitActionsControl.logic";
import {
  buildPublishRepositoryInput,
  isPublishWizardStepDisabled,
  PUBLISH_VISIBILITY_OPTIONS,
  PUBLISH_WIZARD_STEPS,
  resolvePublishRepositoryState,
  resolvePublishResultCopy,
  type PublishProviderKind,
} from "./publishRepository.logic";
import { WizardPopup, WizardHeader, WizardSteps, WizardPanel, WizardFooter } from "./ui/wizard";
import { StartTruncatedPath } from "./StartTruncatedPath";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Input } from "~/components/ui/input";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { stackedThreadToast, toastManager, type ThreadToastData } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useOpenInPreferredEditor } from "~/editorPreferences";
import {
  useGitStackedAction,
  useSourceControlActionRunning,
  useSourceControlPublishRepositoryAction,
  useVcsInitAction,
  useVcsPullAction,
} from "~/lib/sourceControlActions";
import { RUNNING_SOURCE_CONTROL_ACTIONS } from "~/state/sourceControlActions.logic";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { randomUUID } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import {
  getSourceControlPresentation,
  type SourceControlPresentation,
} from "~/sourceControlPresentation";
import { useOpenLink } from "~/browser/useOpenLink";
import { useOpenPrLink } from "~/lib/openPullRequestLink";

interface GitActionsControlProps {
  presentation?: "toolbar" | "menu";
  gitCwd: string | null;
  activeThreadRef: ScopedThreadRef | null;
  draftId?: DraftId;
  /**
   * Opens the thread's own change request beside it. Absent when the thread has no project to
   * place it against, in which case it still opens in the browser.
   */
  onOpenPullRequest?: ((number: number) => void) | undefined;
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress extends GitActionProgressState {
  readonly toastId: GitActionToastId;
  readonly toastData: ThreadToastData | undefined;
}

const GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS = 250;

type RefreshVcsStatus = (target: {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly input: { readonly cwd: string };
}) => Promise<unknown>;

function requestVcsStatusRefresh(
  refresh: RefreshVcsStatus,
  environmentId: ScopedThreadRef["environmentId"] | null,
  cwd: string | null,
): void {
  if (environmentId === null || cwd === null) {
    return;
  }
  void refresh({ environmentId, input: { cwd } });
}

const PUBLISH_PROVIDER_ICONS: Record<PublishProviderKind, typeof GitHubIcon> = {
  forgejo: ForgejoIcon,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  bitbucket: BitbucketIcon,
  "azure-devops": AzureDevOpsIcon,
};

type SourceControlIconComponent = SourceControlPresentation["Icon"];

function GitToolbarIcon({
  icon,
  SourceControlIcon,
  className,
}: {
  icon: GitToolbarIconId;
  SourceControlIcon: SourceControlIconComponent;
  className?: string | undefined;
}) {
  if (icon === "git-commit") return <GitCommitIcon className={className} />;
  if (icon === "cloud-upload") return <CloudUploadIcon className={className} />;
  if (icon === "cloud-download") return <CloudDownloadIcon className={className} />;
  if (icon === "git-branch-plus") return <GitBranchPlusIcon className={className} />;
  if (icon === "info") return <InfoIcon className={className} />;
  return className === undefined ? (
    <SourceControlIcon />
  ) : (
    <SourceControlIcon className={className} />
  );
}

interface PublishRepositoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: ScopedThreadRef["environmentId"] | null;
  /** Thread the dialog was opened from, so the new repository can open beside it. */
  readonly threadRef: ScopedThreadRef | null;
  readonly gitCwd: string;
}

function PublishRepositoryDialog(props: PublishRepositoryDialogProps) {
  const openLink = useOpenLink(props.threadRef);
  const navigate = useNavigate();
  const sourceControlDiscovery = useEnvironmentQuery(
    props.environmentId === null
      ? null
      : sourceControlEnvironment.discovery({
          environmentId: props.environmentId,
          input: {},
        }),
  );
  const [selectedPublishProvider, setSelectedPublishProvider] =
    useState<PublishProviderKind | null>(null);
  const [publishRepositoryOverride, setPublishRepositoryOverride] = useState<string | null>(null);
  const [publishVisibility, setPublishVisibility] =
    useState<SourceControlRepositoryVisibility>("private");
  const [publishRemoteName, setPublishRemoteName] = useState("origin");
  const [publishProtocol, setPublishProtocol] = useState<SourceControlCloneProtocol>("ssh");
  const [publishWizardStep, setPublishWizardStep] = useState(0);
  const [publishAdvancedOpen, setPublishAdvancedOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<SourceControlPublishRepositoryResult | null>(
    null,
  );
  const sourceControlScope = useMemo(
    () => ({
      environmentId: props.environmentId,
      cwd: props.gitCwd,
    }),
    [props.environmentId, props.gitCwd],
  );
  const publishRepositoryAction = useSourceControlPublishRepositoryAction(sourceControlScope);
  const publishState = useMemo(
    () =>
      resolvePublishRepositoryState({
        sourceControlProviders: sourceControlDiscovery.data?.sourceControlProviders ?? [],
        selectedProvider: selectedPublishProvider,
        repositoryOverride: publishRepositoryOverride,
        isPending: publishRepositoryAction.isPending,
        result: publishResult,
      }),
    [
      publishRepositoryAction.isPending,
      publishRepositoryOverride,
      publishResult,
      selectedPublishProvider,
      sourceControlDiscovery.data,
    ],
  );
  const publishProviderReadiness = publishState.readiness;
  const hasReadyPublishProvider = publishState.hasReadyProvider;
  const sortedPublishProviderOptions = publishState.sortedOptions;
  const publishProvider = publishState.provider;
  const selectedPublishProviderReadiness = publishState.providerReadiness;
  const publishRepository = publishState.repository;
  const CurrentPublishProviderIcon = PUBLISH_PROVIDER_ICONS[publishProvider];
  const publishHost = publishState.host;
  const publishPathPlaceholder = publishState.providerOption.pathPlaceholder;
  const publishProviderLabel = publishState.providerOption.label;
  const canSubmitPublishRepository = publishState.canSubmit;

  const submitPublishRepository = useCallback(() => {
    if (!canSubmitPublishRepository) {
      return;
    }

    setPublishError(null);

    void (async () => {
      const result = await publishRepositoryAction.run(
        buildPublishRepositoryInput({
          provider: publishProvider,
          repository: publishRepository,
          visibility: publishVisibility,
          remoteName: publishRemoteName,
          protocol: publishProtocol,
        }),
      );

      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setPublishError(error instanceof Error ? error.message : GIT_ACTION_COPY.genericError);
        }
        return;
      }

      flushSync(() => {
        setPublishResult(result.value);
        setPublishWizardStep(2);
      });
    })();
  }, [
    canSubmitPublishRepository,
    publishProtocol,
    publishProvider,
    publishRemoteName,
    publishRepository,
    publishRepositoryAction,
    publishVisibility,
  ]);

  const resetState = useCallback(() => {
    setPublishRemoteName("origin");
    setPublishRepositoryOverride(null);
    setPublishWizardStep(0);
    setPublishAdvancedOpen(false);
    setPublishError(null);
    setPublishResult(null);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      props.onOpenChange(open);
      if (!open) {
        resetState();
      }
    },
    [props, resetState],
  );

  const openSourceControlSettings = useCallback(() => {
    handleOpenChange(false);
    void navigate({ to: "/settings/source-control" });
  }, [handleOpenChange, navigate]);

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <WizardPopup>
        <WizardHeader
          title="Publish repository"
          description="Pick where to host it, then point us at a repo to push to."
        >
          <WizardSteps
            steps={PUBLISH_WIZARD_STEPS}
            currentStep={publishWizardStep}
            summaries={publishState.stepSummaries}
            showSummaries
            isStepDisabled={(index) => isPublishWizardStepDisabled(index, publishWizardStep)}
            onStepChange={setPublishWizardStep}
          />
        </WizardHeader>

        <WizardPanel>
          <div className={cn("space-y-2", publishWizardStep !== 0 && "hidden")}>
            <span id="publish-provider-cards-label" className="text-xs font-medium text-foreground">
              Provider
            </span>
            <RadioGroup
              value={publishProvider}
              onValueChange={(value) => {
                setSelectedPublishProvider(value as PublishProviderKind);
                setPublishRepositoryOverride(null);
              }}
              aria-labelledby="publish-provider-cards-label"
              className="grid grid-cols-2"
            >
              {sortedPublishProviderOptions.map((option) => {
                const readiness = publishProviderReadiness[option.value];
                const ProviderIcon = PUBLISH_PROVIDER_ICONS[option.value];
                const isSelected = publishProvider === option.value && readiness.ready;
                if (!readiness.ready) {
                  return (
                    <div
                      key={option.value}
                      className="relative flex cursor-not-allowed items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left opacity-64 dark:border-transparent dark:bg-white/[0.035]"
                    >
                      <ProviderIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="warning-outline"
                              size="micro"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openSourceControlSettings();
                              }}
                            >
                              Setup Required
                            </Button>
                          }
                        />
                        <TooltipPopup side="top" align="end">
                          {readiness.hint ??
                            "Open Settings -> Source Control to configure this provider."}
                        </TooltipPopup>
                      </Tooltip>
                    </div>
                  );
                }

                return (
                  <RadioPrimitive.Root
                    key={option.value}
                    value={option.value}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-left outline-none transition-[background-color,border-color,box-shadow]",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      isSelected
                        ? "border-primary bg-background shadow-sm ring-2 ring-primary/35 dark:border-transparent dark:bg-primary/10 dark:shadow-none dark:ring-1 dark:ring-primary/30"
                        : "border-border bg-background hover:border-foreground/20 hover:bg-muted/50 dark:border-transparent dark:bg-white/[0.035] dark:hover:bg-accent",
                    )}
                  >
                    <ProviderIcon className="size-5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                  </RadioPrimitive.Root>
                );
              })}
            </RadioGroup>
          </div>

          <div className={cn("space-y-5", publishWizardStep !== 1 && "hidden")}>
            <div className="space-y-2">
              <label
                htmlFor="publish-repository-path"
                className="text-xs font-medium text-foreground"
              >
                Repository
              </label>
              <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-ring">
                <span className="flex shrink-0 items-center gap-1.5 border-r border-input bg-muted/50 px-2.5 font-mono text-xs text-muted-foreground">
                  <CurrentPublishProviderIcon className="size-3.5" />
                  {publishHost}/
                </span>
                <input
                  id="publish-repository-path"
                  name="publish-repository-path"
                  value={publishRepository}
                  onChange={(event) => {
                    setPublishRepositoryOverride(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitPublishRepository();
                    }
                  }}
                  placeholder={publishPathPlaceholder}
                  disabled={publishRepositoryAction.isPending}
                  className="w-full bg-transparent px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <span
                id="publish-visibility-cards-label"
                className="text-xs font-medium text-foreground"
              >
                Visibility
              </span>
              <RadioGroup
                value={publishVisibility}
                onValueChange={(value) =>
                  setPublishVisibility(value as SourceControlRepositoryVisibility)
                }
                aria-labelledby="publish-visibility-cards-label"
                disabled={publishRepositoryAction.isPending}
                className="grid grid-cols-2"
              >
                {PUBLISH_VISIBILITY_OPTIONS.map((option) => {
                  const isSelected = publishVisibility === option.value;
                  const VisibilityIcon = option.icon === "lock" ? LockIcon : GlobeIcon;
                  return (
                    <RadioPrimitive.Root
                      key={option.value}
                      value={option.value}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        isSelected
                          ? "border-primary bg-background shadow-sm ring-2 ring-primary/35 dark:border-transparent dark:bg-primary/10 dark:shadow-none dark:ring-1 dark:ring-primary/30"
                          : "border-border bg-background hover:border-foreground/20 hover:bg-muted/50 dark:border-transparent dark:bg-white/[0.035] dark:hover:bg-accent",
                      )}
                    >
                      <VisibilityIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {option.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </RadioPrimitive.Root>
                  );
                })}
              </RadioGroup>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setPublishAdvancedOpen((prev) => !prev)}
                aria-expanded={publishAdvancedOpen}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-3.5 transition-transform",
                    publishAdvancedOpen ? "" : "-rotate-90",
                  )}
                />
                Advanced
              </button>
              {publishAdvancedOpen ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5" htmlFor="publish-remote-name">
                    <span className="text-xs font-medium text-foreground">Remote</span>
                    <Input
                      id="publish-remote-name"
                      value={publishRemoteName}
                      onChange={(event) => setPublishRemoteName(event.target.value)}
                      placeholder="origin"
                      disabled={publishRepositoryAction.isPending}
                    />
                  </label>
                  <div className="space-y-1.5">
                    <span
                      id="publish-protocol-label"
                      className="text-xs font-medium text-foreground"
                    >
                      Protocol
                    </span>
                    <ToggleGroup
                      value={[publishProtocol]}
                      onValueChange={(next) => {
                        const protocol = next[0];
                        if (protocol === "ssh" || protocol === "https") {
                          setPublishProtocol(protocol);
                        }
                      }}
                      aria-labelledby="publish-protocol-label"
                      disabled={publishRepositoryAction.isPending}
                    >
                      <Toggle value="ssh">SSH</Toggle>
                      <Toggle value="https">HTTPS</Toggle>
                    </ToggleGroup>
                  </div>
                </div>
              ) : null}
            </div>

            {publishRepositoryAction.isPending ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground dark:border-transparent dark:bg-white/[0.035]"
              >
                <Spinner size="sm" aria-hidden />
                Publishing repository to {publishProviderLabel}...
              </div>
            ) : null}
            {publishError && !publishRepositoryAction.isPending ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <p className="font-medium">Publish failed</p>
                <p className="mt-0.5 text-destructive/90">{publishError}</p>
              </div>
            ) : null}
          </div>

          <div className={cn("space-y-4", publishWizardStep !== 2 && "hidden")}>
            {publishResult ? (
              <>
                <div className="flex flex-col items-center gap-2 py-1 text-center">
                  <span className="grid size-8 place-items-center rounded-full bg-success/15 text-success">
                    <CheckIcon className="size-4" aria-hidden />
                  </span>
                  <h3 className="text-sm font-semibold text-foreground">
                    {resolvePublishResultCopy(publishResult, publishProviderLabel).title}
                  </h3>
                  <p className="max-w-xs text-pretty text-xs text-muted-foreground">
                    {resolvePublishResultCopy(publishResult, publishProviderLabel).description}
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2 dark:border-transparent dark:bg-white/[0.035]">
                  <CurrentPublishProviderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {publishResult.repository.nameWithOwner}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    void openLink(publishResult.repository.url).catch(() => undefined);
                  }}
                >
                  Open on {publishProviderLabel}
                </Button>
              </>
            ) : (
              <div className="rounded-md border border-input bg-background px-3 py-2 text-xs text-muted-foreground dark:border-transparent dark:bg-white/[0.035]">
                Publish result unavailable.
              </div>
            )}
          </div>
        </WizardPanel>

        <WizardFooter>
          {publishWizardStep === 2 ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={publishRepositoryAction.isPending}
                onClick={() => {
                  if (publishWizardStep === 0) {
                    handleOpenChange(false);
                    return;
                  }
                  setPublishWizardStep((step) => Math.max(0, step - 1));
                }}
              >
                {publishWizardStep === 0 ? "Cancel" : "Back"}
              </Button>
              {publishWizardStep < 1 ? (
                <Button
                  disabled={!hasReadyPublishProvider || !selectedPublishProviderReadiness.ready}
                  onClick={() => setPublishWizardStep((step) => Math.min(1, step + 1))}
                >
                  Next
                </Button>
              ) : (
                <Button disabled={!canSubmitPublishRepository} onClick={submitPublishRepository}>
                  {publishRepositoryAction.isPending ? (
                    <>
                      <Spinner size="sm" aria-hidden />
                      Publishing...
                    </>
                  ) : (
                    "Publish"
                  )}
                </Button>
              )}
            </>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

export default function GitActionsControl({
  presentation = "toolbar",
  gitCwd,
  activeThreadRef,
  draftId,
  onOpenPullRequest,
}: GitActionsControlProps) {
  const updateThreadMetadata = useAtomCommand(
    threadEnvironment.updateMetadata,
    "thread branch metadata update",
  );
  const activeEnvironmentId = activeThreadRef?.environmentId ?? null;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(activeEnvironmentId));
  const openInPreferredEditor = useOpenInPreferredEditor(
    activeEnvironmentId,
    serverConfig?.availableEditors ?? [],
  );
  const threadToastData = useMemo(
    () => (activeThreadRef ? { threadRef: activeThreadRef } : undefined),
    [activeThreadRef],
  );
  const openPrLink = useOpenPrLink(activeThreadRef ?? undefined);
  const openLink = useOpenLink(activeThreadRef);
  const activeDraftThread = useComposerDraftStore((store) =>
    draftId
      ? store.getDraftSession(draftId)
      : activeThreadRef
        ? store.getDraftThreadByRef(activeThreadRef)
        : null,
  );
  const activeServerThread = useThreadShell(activeThreadRef);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [dialogCommitMessage, setDialogCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);
  const sourceControlScope = useMemo(
    () => ({ environmentId: activeEnvironmentId, cwd: gitCwd }),
    [activeEnvironmentId, gitCwd],
  );
  let runGitActionWithToast: (request: GitActionRunRequest) => Promise<void>;

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) {
      return;
    }
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveGitActionProgressDescription(progress, Date.now()),
      timeout: 0,
      data: progress.toastData,
    });
  }, []);

  const persistThreadBranchSync = useCallback(
    (branch: string | null, manualSelection = false) => {
      if (!activeThreadRef) {
        return;
      }

      if (activeServerThread) {
        if (activeServerThread.branch === branch) {
          return;
        }

        void updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: {
            threadId: activeThreadRef.threadId,
            ...resolveThreadBranchMetadataPatch(branch, activeServerThread.branch),
          },
        });

        return;
      }

      if (!activeDraftThread || activeDraftThread.branch === branch) {
        return;
      }

      setDraftThreadContext(draftId ?? activeThreadRef, {
        branch,
        worktreePath: activeDraftThread.worktreePath,
        environmentSelection: manualSelection
          ? "manual"
          : (activeDraftThread.environmentSelection ??
            (activeDraftThread.branch ? "manual" : "auto")),
      });
    },
    [
      activeDraftThread,
      activeServerThread,
      activeThreadRef,
      draftId,
      setDraftThreadContext,
      updateThreadMetadata,
    ],
  );

  const gitStatusQuery = useEnvironmentQuery(
    activeEnvironmentId !== null && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: activeEnvironmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const { data: gitStatus, error: gitStatusError } = gitStatusQuery;
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(gitStatus?.sourceControlProvider),
    [gitStatus?.sourceControlProvider],
  );
  const changeRequestTerminology = sourceControlPresentation.terminology;
  const SourceControlIcon = sourceControlPresentation.Icon;
  const gitStatusForActions = gitStatus;

  const initAction = useVcsInitAction(sourceControlScope);
  const runImmediateGitAction = useGitStackedAction(sourceControlScope);
  const pullAction = useVcsPullAction(sourceControlScope);
  const isGitActionRunning = useSourceControlActionRunning(
    sourceControlScope,
    RUNNING_SOURCE_CONTROL_ACTIONS,
  );
  const isSelectingWorktreeBase =
    !activeServerThread &&
    activeDraftThread?.envMode === "worktree" &&
    activeDraftThread.worktreePath === null;

  useEffect(() => {
    if (isGitActionRunning || isSelectingWorktreeBase || activeServerThread) {
      return;
    }

    const branchUpdate = resolveLiveThreadBranchUpdate({
      threadBranch: activeDraftThread?.branch ?? null,
      gitStatus: gitStatusForActions,
    });
    if (!branchUpdate) {
      return;
    }

    persistThreadBranchSync(branchUpdate.branch);
  }, [
    activeServerThread,
    activeDraftThread?.branch,
    gitStatusForActions,
    isGitActionRunning,
    isSelectingWorktreeBase,
    persistThreadBranchSync,
  ]);

  const isDefaultRef = gitStatusForActions?.isDefaultRef ?? false;
  const toolbarModel = useMemo(
    () =>
      buildGitActionsToolbarModel({
        gitCwd,
        gitStatus: gitStatusForActions,
        gitStatusError,
        isGitActionRunning,
        isInitPending: initAction.isPending,
      }),
    [gitCwd, gitStatusError, gitStatusForActions, initAction.isPending, isGitActionRunning],
  );
  const commitDialogModel = buildGitCommitDialogModel({
    gitStatus: gitStatusForActions,
    excludedFiles,
    isEditingFiles,
  });
  const defaultBranchConfirmation = buildDefaultBranchConfirmationModel(
    pendingDefaultBranchAction,
    changeRequestTerminology,
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) {
        return;
      }
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  useEffect(() => {
    if (gitCwd === null) {
      return;
    }

    let refreshTimeout: number | null = null;
    const scheduleRefreshCurrentGitStatus = () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
      }, GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefreshCurrentGitStatus();
      }
    };

    window.addEventListener("focus", scheduleRefreshCurrentGitStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      window.removeEventListener("focus", scheduleRefreshCurrentGitStatus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeEnvironmentId, gitCwd, refreshVcsStatus]);

  const openExistingPr = useCallback(async () => {
    const intent = resolveOpenExistingPrIntent({
      gitStatus: gitStatusForActions,
      canOpenInApp: onOpenPullRequest !== undefined,
    });
    if (intent.kind === "open_in_app") {
      onOpenPullRequest?.(intent.number);
      return;
    }
    if (intent.kind === "missing") {
      toastManager.add({
        type: "error",
        title: GIT_ACTION_COPY.noOpenPr,
        data: threadToastData,
      });
      return;
    }
    void openLink(intent.url).catch((err: unknown) => {
      console.error(err);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: GIT_ACTION_COPY.openPrLinkFailed,
          description: err instanceof Error ? err.message : GIT_ACTION_COPY.genericError,
          ...(threadToastData !== undefined ? { data: threadToastData } : {}),
        }),
      );
    });
  }, [gitStatusForActions, onOpenPullRequest, openLink, threadToastData]);

  runGitActionWithToast = useEffectEvent(async (request: GitActionRunRequest) => {
    const plan = resolveGitActionRunPlan({
      request,
      gitStatus: gitStatusForActions,
      isDefaultRef,
      terminology: changeRequestTerminology,
    });
    if (plan.kind === "confirm_default_branch") {
      setPendingDefaultBranchAction(plan.pending);
      return;
    }

    const scopedToastData = threadToastData ? { ...threadToastData } : undefined;
    const actionId = randomUUID();
    const progressToastId = toastManager.add({
      type: "loading",
      title: plan.initialTitle,
      description: GIT_ACTION_COPY.waitingForGit,
      timeout: 0,
      data: scopedToastData,
    });

    activeGitActionProgressRef.current = {
      ...initialGitActionProgressState(actionId, plan.initialTitle),
      toastId: progressToastId,
      toastData: scopedToastData,
    };

    const applyProgressEvent = (event: GitActionProgressEvent) => {
      const progress = activeGitActionProgressRef.current;
      if (!progress) {
        return;
      }
      const next = applyGitActionProgressEvent({
        progress,
        event,
        gitCwd,
        nowMs: Date.now(),
      });
      if (!next) {
        return;
      }
      activeGitActionProgressRef.current = next;
      updateActiveProgressToast();
    };

    const result = await runImmediateGitAction.run({
      actionId,
      ...plan.command,
      // A pull request the action opens is linked to the thread it ran beside. Drafts
      // have no server thread yet, so there is nothing to link to.
      ...(activeServerThread ? { threadId: activeServerThread.id } : {}),
      onProgress: applyProgressEvent,
    });

    activeGitActionProgressRef.current = null;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        toastManager.close(progressToastId);
        return;
      }

      const error = squashAtomCommandFailure(result);
      toastManager.update(
        progressToastId,
        stackedThreadToast({
          type: "error",
          title: GIT_ACTION_COPY.actionFailed,
          description: error instanceof Error ? error.message : GIT_ACTION_COPY.genericError,
          ...(scopedToastData !== undefined ? { data: scopedToastData } : {}),
        }),
      );
      return;
    }

    const actionResult = result.value;
    const branchUpdate = resolveThreadBranchUpdate(actionResult);
    if (branchUpdate) {
      persistThreadBranchSync(branchUpdate.branch, true);
    }
    const closeResultToast = () => {
      toastManager.close(progressToastId);
    };

    const toastCta = actionResult.toast.cta;
    let toastActionProps: {
      children: string;
      onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    } | null = null;
    if (toastCta.kind === "run_action") {
      toastActionProps = {
        children: toastCta.label,
        onClick: () => {
          closeResultToast();
          void runGitActionWithToast({
            action: toastCta.action.kind,
          });
        },
      };
    } else if (toastCta.kind === "open_pr") {
      toastActionProps = {
        children: toastCta.label,
        onClick: (event) => {
          closeResultToast();
          openPrLink(event, toastCta.url);
        },
      };
    }

    const successToastData = {
      ...scopedToastData,
      dismissAfterVisibleMs: 10_000,
    };

    if (toastActionProps) {
      toastManager.update(
        progressToastId,
        stackedThreadToast({
          type: "success",
          title: actionResult.toast.title,
          description: actionResult.toast.description,
          timeout: 0,
          actionProps: toastActionProps,
          data: successToastData,
        }),
      );
    } else {
      toastManager.update(progressToastId, {
        type: "success",
        title: actionResult.toast.title,
        description: actionResult.toast.description,
        timeout: 0,
        data: successToastData,
      });
    }
  });

  const continuePendingDefaultBranchAction = (mode: "continue" | "feature_branch") => {
    if (!pendingDefaultBranchAction) return;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast(resolveDefaultBranchContinuation(pendingDefaultBranchAction, mode));
  };

  const resetCommitDialog = () => {
    setIsCommitDialogOpen(false);
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
  };

  const runCommitDialogAction = (onNewBranch: boolean) => {
    if (!isCommitDialogOpen) return;
    const request = resolveCommitDialogRunRequest({
      commitMessage: dialogCommitMessage,
      model: commitDialogModel,
      onNewBranch,
    });
    resetCommitDialog();
    void runGitActionWithToast(request);
  };

  const runPull = () => {
    const toastId = toastManager.add({
      type: "loading",
      title: GIT_ACTION_COPY.pulling,
      timeout: 0,
      data: threadToastData,
    });
    void (async () => {
      const result = await pullAction.run();
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) {
          toastManager.close(toastId);
          return;
        }
        const error = squashAtomCommandFailure(result);
        toastManager.update(
          toastId,
          stackedThreadToast({
            type: "error",
            title: GIT_ACTION_COPY.pullFailed,
            description: error instanceof Error ? error.message : GIT_ACTION_COPY.genericError,
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
        return;
      }

      toastManager.update(toastId, {
        type: "success",
        ...resolveGitPullSuccessToast(result.value),
        data: threadToastData,
      });
    })();
  };

  const runQuickAction = () => {
    if (toolbarModel.kind !== "repo") return;
    const intent = resolveGitQuickActionIntent(toolbarModel.quickAction);
    switch (intent.kind) {
      case "open_pr":
        void openExistingPr();
        return;
      case "open_publish":
        setIsPublishDialogOpen(true);
        return;
      case "run_pull":
        runPull();
        return;
      case "show_hint":
        toastManager.add({
          type: "info",
          title: intent.title,
          description: intent.description,
          data: threadToastData,
        });
        return;
      case "run_action":
        void runGitActionWithToast({ action: intent.action });
        return;
      case "none":
        return;
    }
  };

  const openDialogForMenuItem = (item: GitActionMenuItem) => {
    const intent = resolveGitMenuItemIntent(item);
    switch (intent.kind) {
      case "open_pr":
        void openExistingPr();
        return;
      case "run_action":
        void runGitActionWithToast({ action: intent.action });
        return;
      case "open_commit_dialog":
        setExcludedFiles(new Set());
        setIsEditingFiles(false);
        setIsCommitDialogOpen(true);
        return;
      case "none":
        return;
    }
  };

  const openChangedFileInEditor = useCallback(
    (filePath: string) => {
      if (!gitCwd) {
        toastManager.add({
          type: "error",
          title: GIT_ACTION_COPY.editorUnavailable,
          data: threadToastData,
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, gitCwd);
      void (async () => {
        const result = await openInPreferredEditor(target);
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
          return;
        }
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: GIT_ACTION_COPY.openFileFailed,
            description: error instanceof Error ? error.message : GIT_ACTION_COPY.genericError,
            ...(threadToastData !== undefined ? { data: threadToastData } : {}),
          }),
        );
      })();
    },
    [gitCwd, openInPreferredEditor, threadToastData],
  );

  const initializeGit = () => {
    void (async () => {
      const result = await initAction.run();
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
        return;
      }
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: GIT_ACTION_COPY.initFailed,
          description: error instanceof Error ? error.message : GIT_ACTION_COPY.genericError,
          ...(threadToastData !== undefined ? { data: threadToastData } : {}),
        }),
      );
    })();
  };

  if (toolbarModel.kind === "hidden" || !gitCwd) return null;

  const gitItems =
    toolbarModel.kind === "repo" ? (
      <>
        {toolbarModel.menuItems.map((item) => {
          if (item.disabled && item.disabledReason && presentation === "menu") {
            return (
              <div key={item.key}>
                <MenuItem density={presentation === "menu" ? "touch" : "default"} disabled>
                  <GitToolbarIcon icon={item.iconId} SourceControlIcon={SourceControlIcon} />
                  <MenuItemLabel>{item.label}</MenuItemLabel>
                </MenuItem>
                <p className="max-w-64 px-2 pb-2 text-xs text-muted-foreground">
                  {item.disabledReason}
                </p>
              </div>
            );
          }
          if (item.disabled && item.disabledReason) {
            return (
              <Popover key={item.key}>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  render={<span className="block w-max cursor-not-allowed" />}
                >
                  <MenuItem
                    density={presentation === "menu" ? "touch" : "default"}
                    className="w-full"
                    disabled
                  >
                    <GitToolbarIcon icon={item.iconId} SourceControlIcon={SourceControlIcon} />
                    <MenuItemLabel>{item.label}</MenuItemLabel>
                  </MenuItem>
                </PopoverTrigger>
                <PopoverPopup tooltipStyle side="left" align="center">
                  {item.disabledReason}
                </PopoverPopup>
              </Popover>
            );
          }

          return (
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              key={item.key}
              disabled={item.disabled}
              onClick={() => {
                openDialogForMenuItem(item);
              }}
            >
              <GitToolbarIcon icon={item.iconId} SourceControlIcon={SourceControlIcon} />
              <MenuItemLabel>{item.label}</MenuItemLabel>
            </MenuItem>
          );
        })}
        {toolbarModel.publishItem ? (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            disabled={toolbarModel.publishItem.disabled}
            onClick={() => {
              setIsPublishDialogOpen(true);
            }}
          >
            <GitToolbarIcon
              icon={toolbarModel.publishItem.icon}
              SourceControlIcon={SourceControlIcon}
            />
            <MenuItemLabel>{toolbarModel.publishItem.label}</MenuItemLabel>
          </MenuItem>
        ) : null}
        {toolbarModel.notices.map((notice) => (
          <p
            key={notice.id}
            className={cn(
              "px-2 py-1.5 text-xs",
              notice.tone === "warning" ? "text-warning" : "text-destructive",
            )}
          >
            {notice.text}
          </p>
        ))}
      </>
    ) : null;

  return (
    <>
      {presentation === "menu" ? (
        toolbarModel.kind === "init" ? (
          <MenuItem
            density={presentation === "menu" ? "touch" : "default"}
            disabled={toolbarModel.disabled}
            onClick={initializeGit}
          >
            <GitToolbarIcon
              icon={toolbarModel.icon}
              SourceControlIcon={SourceControlIcon}
              className="size-4"
            />
            <MenuItemLabel>{toolbarModel.label}</MenuItemLabel>
          </MenuItem>
        ) : (
          <>
            <MenuItem
              density={presentation === "menu" ? "touch" : "default"}
              disabled={toolbarModel.quickActionMenuItemDisabled}
              onClick={runQuickAction}
            >
              <GitToolbarIcon
                className="size-4"
                icon={toolbarModel.quickActionIcon}
                SourceControlIcon={SourceControlIcon}
              />
              <MenuItemLabel>{toolbarModel.quickAction.label}</MenuItemLabel>
            </MenuItem>
            {toolbarModel.quickActionDisabledReason && (
              <p className="max-w-64 px-2 py-1.5 text-xs text-warning">
                {toolbarModel.quickActionDisabledReason}
              </p>
            )}
            <MenuSub
              onOpenChange={(open) => {
                if (open) requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
              }}
            >
              <MenuSubTrigger density="touch" disabled={toolbarModel.menuTriggerDisabled}>
                <SourceControlIcon className="size-4" />
                <MenuItemLabel>{toolbarModel.submenuLabel}</MenuItemLabel>
              </MenuSubTrigger>
              <MenuSubPopup>{gitItems}</MenuSubPopup>
            </MenuSub>
          </>
        )
      ) : toolbarModel.kind === "init" ? (
        <Button
          variant="outline"
          size="xs"
          disabled={toolbarModel.disabled}
          onClick={initializeGit}
        >
          <GitBranchPlusIcon className="size-3.5" aria-hidden />
          <span className="ml-0.5">{toolbarModel.label}</span>
        </Button>
      ) : (
        <Group aria-label={toolbarModel.groupAriaLabel} className="shrink-0">
          {toolbarModel.quickActionDisabledReason ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={<Button aria-disabled="true" size="xs" variant="outline" />}
              >
                <GitToolbarIcon
                  icon={toolbarModel.quickActionIcon}
                  SourceControlIcon={SourceControlIcon}
                  className="size-3.5"
                />
                <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                  {toolbarModel.quickAction.label}
                </span>
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {toolbarModel.quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={toolbarModel.quickActionButtonDisabled}
              onClick={runQuickAction}
            >
              <GitToolbarIcon
                icon={toolbarModel.quickActionIcon}
                SourceControlIcon={SourceControlIcon}
                className="size-3.5"
              />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                {toolbarModel.quickAction.label}
              </span>
            </Button>
          )}
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            onOpenChange={(open) => {
              if (open) {
                requestVcsStatusRefresh(refreshVcsStatus, activeEnvironmentId, gitCwd);
              }
            }}
          >
            <MenuTrigger
              render={
                <Button
                  aria-label={toolbarModel.menuTriggerAriaLabel}
                  size="icon-xs"
                  variant="outline"
                />
              }
              disabled={toolbarModel.menuTriggerDisabled}
            >
              <ChevronDownIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">{gitItems}</MenuPopup>
          </Menu>
        </Group>
      )}

      <Dialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetCommitDialog();
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{commitDialogModel.title}</DialogTitle>
            <DialogDescription>{commitDialogModel.description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-3 rounded-xl bg-zinc-25 p-3 text-sm ring-1 ring-black/5 dark:bg-white/[0.035] dark:ring-white/5">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">{commitDialogModel.branchLabel}</span>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{commitDialogModel.branchCaption}</span>
                  {commitDialogModel.isDefaultRef && (
                    <span className="text-right text-warning">
                      {commitDialogModel.defaultBranchLabel}
                    </span>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isEditingFiles && commitDialogModel.files.length > 0 && (
                      <Checkbox
                        checked={commitDialogModel.allSelected}
                        indeterminate={
                          !commitDialogModel.allSelected && !commitDialogModel.noneSelected
                        }
                        onCheckedChange={() => {
                          setExcludedFiles(toggleCommitDialogSelectAll(commitDialogModel));
                        }}
                      />
                    )}
                    <span className="text-muted-foreground">{commitDialogModel.filesLabel}</span>
                    {commitDialogModel.selectionSummary !== null && (
                      <span className="text-muted-foreground">
                        {commitDialogModel.selectionSummary}
                      </span>
                    )}
                  </div>
                  {commitDialogModel.files.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setIsEditingFiles((prev) => !prev)}
                    >
                      {commitDialogModel.editFilesLabel}
                    </Button>
                  )}
                </div>
                {commitDialogModel.showEmpty ? (
                  <p className="font-medium">{commitDialogModel.emptyLabel}</p>
                ) : (
                  <div className="space-y-2">
                    <div className="h-44 rounded-lg bg-card ring-1 ring-black/5 dark:bg-white/[0.025] dark:ring-white/5">
                      <ScrollArea>
                        <div className="space-y-1 p-1">
                          {commitDialogModel.files.map((file) => (
                            <div
                              key={file.path}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono hover:bg-accent/50"
                            >
                              {isEditingFiles && (
                                <Checkbox
                                  checked={!file.excluded}
                                  onCheckedChange={() => {
                                    setExcludedFiles((prev) =>
                                      toggleCommitDialogFileExclusion(prev, file.path),
                                    );
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                                onClick={() => openChangedFileInEditor(file.path)}
                              >
                                <StartTruncatedPath
                                  path={file.path}
                                  className={`flex-1${file.excluded ? " text-muted-foreground" : ""}`}
                                />
                                <span className="shrink-0">
                                  {file.excluded ? (
                                    <span className="text-muted-foreground">
                                      {commitDialogModel.excludedLabel}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-diff-addition">+{file.insertions}</span>
                                      <span className="text-muted-foreground"> / </span>
                                      <span className="text-diff-deletion">-{file.deletions}</span>
                                    </>
                                  )}
                                </span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                    <div className="flex justify-end font-mono">
                      <span className="text-diff-addition">
                        +{commitDialogModel.totals.insertions}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-diff-deletion">
                        -{commitDialogModel.totals.deletions}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{commitDialogModel.messageLabel}</p>
              <Textarea
                value={dialogCommitMessage}
                onChange={(event) => setDialogCommitMessage(event.target.value)}
                placeholder={commitDialogModel.messagePlaceholder}
                size="sm"
              />
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button variant="outline" size="sm" onClick={resetCommitDialog}>
              {commitDialogModel.cancelLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={commitDialogModel.noneSelected}
              onClick={() => runCommitDialogAction(true)}
            >
              {commitDialogModel.commitOnNewBranchLabel}
            </Button>
            <Button
              size="sm"
              disabled={commitDialogModel.noneSelected}
              onClick={() => runCommitDialogAction(false)}
            >
              {commitDialogModel.commitLabel}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <PublishRepositoryDialog
        open={isPublishDialogOpen}
        onOpenChange={setIsPublishDialogOpen}
        environmentId={activeEnvironmentId}
        threadRef={activeThreadRef}
        gitCwd={gitCwd}
      />

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{defaultBranchConfirmation.title}</DialogTitle>
            <DialogDescription>{defaultBranchConfirmation.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter variant="bare" className="sm:flex-wrap sm:items-center">
            <Button
              className="w-full sm:mr-auto sm:w-auto"
              variant="outline"
              size="sm"
              onClick={() => setPendingDefaultBranchAction(null)}
            >
              {defaultBranchConfirmation.abortLabel}
            </Button>
            <Button
              className="w-full max-w-full sm:w-auto"
              variant="outline"
              size="sm-multiline"
              onClick={() => continuePendingDefaultBranchAction("continue")}
            >
              {defaultBranchConfirmation.continueLabel}
            </Button>
            <Button
              className="w-full max-w-full sm:w-auto"
              size="sm-multiline"
              onClick={() => continuePendingDefaultBranchAction("feature_branch")}
            >
              {defaultBranchConfirmation.featureBranchLabel}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
