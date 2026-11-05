import {
  ChevronsLeftRightEllipsisIcon,
  EllipsisIcon,
  PlusIcon,
  QrCodeIcon,
  TerminalIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import {
  type KeyboardEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AuthClientSession,
  type AuthEnvironmentScope,
  type AuthPairingLink,
  type AuthPairingCredentialResult,
  type AdvertisedEndpoint,
  type DesktopDiscoveredSshHost,
  type DesktopSshEnvironmentTarget,
  type DesktopWslState,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { cn } from "../../lib/utils";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import {
  applyWslEnableSelection,
  BACKEND_VALUE_WSL_OFF,
  DEFAULT_TAILSCALE_SERVE_PORT,
  endpointDefaultPreferenceKey,
  formatDesktopSshConnectionError,
  sortDesktopClientSessions,
  sortDesktopPairingLinks,
  summarizeAuthorizedClients,
  toDesktopClientSessionRecord,
  toDesktopPairingLinkRecord,
} from "./ConnectionsSettings.logic";
import {
  ADMINISTRATIVE_ACCESS_ROW,
  BACKEND_ADDED_TOAST,
  CONNECTIONS_ENVIRONMENT_SETTING,
  REMOTE_ENVIRONMENTS_SETTING,
  REMOTE_ENVIRONMENTS_TITLE,
  buildAddEnvironmentDialogModel,
  buildAdvertisedEndpointRowModel,
  buildAuthorizedClientsHeaderModel,
  buildClientSessionRowModel,
  buildCloudLinkModel,
  buildCreatePairingLinkDialogModel,
  buildNetworkAccessRowModel,
  buildNetworkExposureDialogModel,
  buildPairingLinkRowModel,
  buildPrimaryEnvironmentHeaderModel,
  buildRemoteEnvironmentsEmptyStateModel,
  buildSavedBackendRowModel,
  buildTailscaleRowModel,
  buildTailscaleServeDisableDialogModel,
  buildTailscaleServeSetupDialogModel,
  buildVersionRowModel,
  buildWslConfirmDialogModel,
  buildWslSettingsModel,
  defaultPairingScopes,
  resolveAddSavedBackend,
  resolveAuthorizedClientsEmptyMessage,
  resolveConnectionsAccess,
  resolveConnectionsEndpointSelection,
  resolveConnectionsFailure,
  resolveConnectionsFailureTitle,
  resolveHasWslRegistrationToLose,
  resolveListedEnvironments,
  resolveLoadBalancingEnvironments,
  resolveManagedTunnelToast,
  resolveNetworkExposureConfirm,
  resolveNetworkExposureToggle,
  resolvePairingCopyErrorToast,
  resolvePairingCopyToast,
  resolvePairingScopePreset,
  resolvePairingScopeToggle,
  resolvePairingUrlCopyKind,
  resolvePublishAgentActivityToast,
  resolveRemoteEnvironmentsEmptyMode,
  resolveRemoveSavedBackend,
  resolveRevokeOtherClientsToast,
  resolveSavedBackendHostInput,
  resolveSavedEnvironments,
  resolveSavedServerUpdateTargets,
  resolveSshConnectedToast,
  resolveSshHostShortcutTarget,
  resolveTailscaleServeDisablePort,
  resolveTailscaleServePort,
  resolveTailscaleServeStartPortInput,
  resolveTailscaleSwitchChange,
  resolveTraceIdCopyToast,
  resolveUnsavedDiscoveredSshHosts,
  resolveWslConfirm,
  resolveWslModeSelection,
  resolveWslOnlyToggle,
  type AccessScopeSummaryModel,
  type CloudLinkSwitchModel,
  type ConnectionModeCardModel,
  type ConnectionsSwitchModel,
  type NetworkAccessDescriptionModel,
  type NetworkAccessRowModel,
  type NetworkExposureMode,
  type PairingCopyKind,
  type PendingWslChange,
  type RemoteEnvironmentsEmptyStateModel,
  type SavedBackendMode,
  resolveServerUpdateFacts,
  type WslChangeDecision,
  type WslOperation,
} from "./ConnectionsSettingsSections.logic";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { LocalEnvironmentSetting } from "./LocalEnvironmentSetting";
import { EnvironmentIconMenu } from "./EnvironmentIconPicker";
import { EnvironmentRow } from "./EnvironmentRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { LoadBalancingSettings } from "./LoadBalancingSettings";
import { GitHubRoutingSettings } from "./GitHubRoutingSettings";
import { Input } from "../ui/input";
import { CommandShortcut } from "../ui/command";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "../ui/autocomplete";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { QRCodeSvg } from "../ui/qr-code";
import { Spinner } from "../ui/spinner";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { AnimatedHeight } from "../AnimatedHeight";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Textarea } from "../ui/textarea";
import {
  createServerPairingCredential,
  revokeOtherServerClientSessions,
  revokeServerClientSession,
  revokeServerPairingLink,
  usePrimarySessionState,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
} from "~/environments/primary";
import { useUiStateStore } from "~/uiStateStore";
import { APP_VERSION } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { RemoveT3ConnectEnvironmentDialog } from "../clerk/RemoveT3ConnectEnvironmentDialog";
import { useCloudLinkController } from "~/cloud/useCloudLinkController";
import { authEnvironment } from "~/state/auth";
import { environmentCatalog } from "~/connection/catalog";
import {
  connectPairing as connectPairingAtom,
  connectSshEnvironment as connectSshEnvironmentAtom,
} from "~/connection/onboarding";
import { useEnvironmentQuery } from "~/state/query";
import {
  desktopNetworkAccessStateAtom,
  refreshDesktopNetworkAccessState,
} from "~/state/desktopNetworkAccess";
import { desktopSshHostsStateAtom, filterDiscoveredSshHosts } from "~/state/desktopSshHosts";
import { desktopWslStateAtom, refreshDesktopWslState } from "~/state/desktopWslState";
import {
  type EnvironmentPresentation,
  useEnvironments,
  usePrimaryEnvironment,
  useRelayEnvironmentDiscovery,
} from "~/state/environments";
import { requestConfirmDialog } from "~/confirmDialog";
import { useAtomCommand } from "../../state/use-atom-command";
import { primaryServerKeybindingsAtom, serverEnvironment } from "~/state/server";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import {
  ServerUpdateAction,
  ServerUpdateProgress,
  ServerUpdatesAction,
} from "../ServerUpdateAction";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { resolveShortcutCommand } from "../../keybindings";

const EMPTY_ADVERTISED_ENDPOINTS: ReadonlyArray<AdvertisedEndpoint> = [];
const EMPTY_DISCOVERED_SSH_HOSTS: ReadonlyArray<DesktopDiscoveredSshHost> = [];

function AccessScopeSummary({ model }: { readonly model: AccessScopeSummaryModel }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={250}
        closeDelay={100}
        render={
          <button
            type="button"
            aria-label={model.ariaLabel}
            className="cursor-help underline decoration-border underline-offset-2 outline-hidden hover:text-foreground focus-visible:text-foreground"
          />
        }
      >
        {model.countLabel}
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="start"
        tooltipStyle
        className="w-max max-w-80 whitespace-normal"
      >
        <p className="mb-1 font-medium">{model.heading}</p>
        <div className="flex flex-col gap-0.5">
          {model.scopes.map((scope) => (
            <code key={scope} className="font-mono text-foreground/85">
              {scope}
            </code>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const ENDPOINT_ROW_CLASSNAME = "first:rounded-t-xl last:rounded-b-xl px-3 py-2.5 sm:px-4";

type AccessSectionPresentation = "current" | "endpoint-rail";

function accessRowClassName(_presentation: AccessSectionPresentation) {
  return ITEM_ROW_CLASSNAME;
}

function endpointRowClassName(presentation: AccessSectionPresentation, isAvailable: boolean) {
  if (presentation === "endpoint-rail") {
    return cn(
      "relative first:rounded-t-xl last:rounded-b-xl px-3 py-3 sm:px-4",
      !isAvailable && "bg-muted/15",
    );
  }

  return cn(ENDPOINT_ROW_CLASSNAME, !isAvailable && "bg-muted/24");
}

type PairingLinkListRowProps = {
  pairingLink: ServerPairingLinkRecord;
  credential: string | undefined;
  endpointUrl: string | null | undefined;
  endpoints: ReadonlyArray<AdvertisedEndpoint>;
  defaultEndpointKey: string | null;
  presentation?: AccessSectionPresentation;
  revokingPairingLinkId: string | null;
  onRevoke: (id: string) => void;
};

const PairingLinkListRow = memo(function PairingLinkListRow({
  pairingLink,
  credential,
  endpointUrl,
  endpoints,
  defaultEndpointKey,
  presentation = "current",
  revokingPairingLinkId,
  onRevoke,
}: PairingLinkListRowProps) {
  const nowMs = useRelativeTimeTick(1_000);
  const [isRevealDialogOpen, setIsRevealDialogOpen] = useState(false);
  const [isQrPanelOpen, setIsQrPanelOpen] = useState(false);
  // Ephemeral per-row choice of which endpoint the QR encodes (AdvertisedEndpoint.id);
  // null falls back to the saved default endpoint.
  const [qrEndpointId, setQrEndpointId] = useState<string | null>(null);
  const qrPanelId = useId();
  // Value of the copy attempt that last failed. The clipboard-failure reveal
  // dialog must show exactly what failed to copy, not the row's default URL.
  const [failedCopyValue, setFailedCopyValue] = useState<string | null>(null);
  const canCopyToClipboard =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText != null;
  const model = useMemo(
    () =>
      buildPairingLinkRowModel({
        pairingLink,
        credential,
        endpointUrl,
        endpoints,
        defaultEndpointKey,
        revokingPairingLinkId,
        nowMs,
        currentHref: window.location.href,
        canCopyToClipboard,
        qrEndpointId,
        failedCopyValue,
        isQrPanelOpen,
      }),
    [
      canCopyToClipboard,
      credential,
      defaultEndpointKey,
      endpointUrl,
      endpoints,
      failedCopyValue,
      isQrPanelOpen,
      nowMs,
      pairingLink,
      qrEndpointId,
      revokingPairingLinkId,
    ],
  );

  const { copyToClipboard } = useCopyToClipboard<{
    value: string;
    kind: PairingCopyKind;
  }>({
    onCopy: ({ kind }) => {
      toastManager.add({ type: "success", ...resolvePairingCopyToast(kind) });
    },
    onError: (error, { value, kind }) => {
      // Captured per attempt so concurrent copies cannot make the dialog
      // reveal a different value than the one that failed.
      setFailedCopyValue(value);
      setIsRevealDialogOpen(true);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          ...resolvePairingCopyErrorToast({
            kind,
            canCopyToClipboard,
            errorMessage: error.message,
          }),
        }),
      );
    },
  });

  const copyPairingValue = useCallback(
    (value: string, kind: PairingCopyKind) => {
      copyToClipboard(value, { value, kind });
    },
    [copyToClipboard],
  );

  const handleCopyCode = useCallback(() => {
    if (credential) copyPairingValue(credential, "code");
  }, [copyPairingValue, credential]);

  const qrPairingUrl = model.qrPanel.url;
  if (model.expired) {
    return null;
  }

  return (
    <div className={accessRowClassName(presentation)}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <ConnectionStatusDot tooltipText={model.createdTooltip} dotClassName="bg-warning" />
            <h3 className="text-sm font-medium text-foreground">{model.title}</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<span />}>{model.expiresLabel}</TooltipTrigger>
              <TooltipPopup side="top">{model.expiresTooltip}</TooltipPopup>
            </Tooltip>
            <span aria-hidden> · </span>
            <AccessScopeSummary model={model.scopeSummary} />
          </p>
          {model.hint ? <p className="text-2xs text-muted-foreground/70">{model.hint}</p> : null}
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          {model.shareButtonLabel ? (
            <Button
              size="xs"
              variant="outline"
              aria-expanded={isQrPanelOpen}
              aria-controls={qrPanelId}
              onClick={() => setIsQrPanelOpen((open) => !open)}
            >
              <QrCodeIcon aria-hidden />
              {model.shareButtonLabel}
            </Button>
          ) : null}
          <Dialog
            open={model.reveal.available && isRevealDialogOpen}
            onOpenChange={(open) => {
              setIsRevealDialogOpen(open);
              if (!open) setFailedCopyValue(null);
            }}
          >
            {model.codeAction === "copy-code" ? (
              <Button size="xs" variant="outline" onClick={handleCopyCode}>
                {model.codeActionLabel}
              </Button>
            ) : model.codeAction === "show-dialog" ? (
              <DialogTrigger render={<Button size="xs" variant="outline" />}>
                {model.codeActionLabel}
              </DialogTrigger>
            ) : null}
            <DialogPopup className="max-w-md">
              <DialogHeader>
                <DialogTitle>{model.reveal.title}</DialogTitle>
                <DialogDescription>{model.reveal.description}</DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <Textarea
                  readOnly
                  value={model.reveal.value}
                  rows={model.reveal.rows}
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                />
                {model.reveal.showQr ? (
                  <div className="flex justify-center rounded-xl border border-border/60 bg-muted/30 p-4">
                    <QRCodeSvg
                      value={model.reveal.value}
                      size={132}
                      level="M"
                      marginSize={2}
                      title={model.reveal.qrTitle}
                    />
                  </div>
                ) : null}
              </DialogPanel>
              <DialogFooter variant="bare">
                <Button variant="outline" onClick={() => setIsRevealDialogOpen(false)}>
                  {model.reveal.doneLabel}
                </Button>
                {model.reveal.copyCodeLabel ? (
                  <Button variant="outline" onClick={handleCopyCode}>
                    {model.reveal.copyCodeLabel}
                  </Button>
                ) : null}
              </DialogFooter>
            </DialogPopup>
          </Dialog>
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={model.revoke.disabled}
            onClick={() => void onRevoke(pairingLink.id)}
          >
            {model.revoke.label}
          </Button>
        </div>
      </div>
      {model.qrPanel.visible && qrPairingUrl !== null ? (
        <div
          id={qrPanelId}
          className="mt-3 flex flex-col gap-4 border-t border-border/50 pt-3 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0 flex-1 space-y-3">
            {model.qrPanel.endpointPickerVisible ? (
              <div
                className="space-y-1.5"
                role="radiogroup"
                aria-label={model.qrPanel.endpointPickerAriaLabel}
              >
                <p className="text-2xs text-muted-foreground/70">
                  {model.qrPanel.endpointPickerLabel}
                </p>
                {model.endpointOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={option.selected}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      option.selected
                        ? "border-foreground/60 bg-muted/30"
                        : "border-border/50 hover:bg-muted/20",
                    )}
                    onClick={() => setQrEndpointId(option.id)}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium",
                        option.selected ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="min-w-0 truncate text-2xs text-muted-foreground/70">
                      {option.detail}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <code className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
                      {qrPairingUrl}
                    </code>
                  }
                />
                <TooltipPopup side="top">{qrPairingUrl}</TooltipPopup>
              </Tooltip>
              <Button
                size="xs"
                variant="ghost"
                className="shrink-0"
                onClick={() =>
                  copyPairingValue(qrPairingUrl, resolvePairingUrlCopyKind(qrPairingUrl))
                }
              >
                {model.qrPanel.copyLinkLabel}
              </Button>
            </div>
            <Button size="xs" variant="ghost" onClick={handleCopyCode}>
              {model.qrPanel.copyCodeLabel}
            </Button>
          </div>
          {model.qrPanel.canRenderQr ? (
            <div className="w-fit shrink-0 self-center rounded-xl bg-white p-3 sm:self-start">
              <QRCodeSvg
                value={qrPairingUrl}
                size={168}
                level="M"
                marginSize={1}
                title={model.qrPanel.qrTitle}
              />
            </div>
          ) : (
            <div className="flex size-[192px] shrink-0 items-center justify-center self-center rounded-xl border border-border/50 p-4 sm:self-start">
              <p className="text-center text-2xs text-muted-foreground/70">
                {model.qrPanel.noQrMessage}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

type ConnectedClientListRowProps = {
  clientSession: ServerClientSessionRecord;
  presentation?: AccessSectionPresentation;
  revokingClientSessionId: string | null;
  onRevokeSession: (sessionId: ServerClientSessionRecord["sessionId"]) => void;
};

const ConnectedClientListRow = memo(function ConnectedClientListRow({
  clientSession,
  presentation = "current",
  revokingClientSessionId,
  onRevokeSession,
}: ConnectedClientListRowProps) {
  const nowMs = useRelativeTimeTick(1_000);
  const model = buildClientSessionRowModel({ clientSession, revokingClientSessionId, nowMs });

  return (
    <div className={accessRowClassName(presentation)}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <ConnectionStatusDot
              tooltipText={model.statusTooltip}
              dotClassName={model.isLive ? "bg-success" : "bg-muted-foreground/30"}
              pingClassName={model.isLive ? "bg-success/60 duration-2000" : null}
            />
            <h3 className="text-sm font-medium text-foreground">{model.title}</h3>
            {model.currentBadgeLabel ? (
              <span className="text-3xs text-muted-foreground/80 rounded-md border border-border/50 bg-muted/50 px-1 py-0.5">
                {model.currentBadgeLabel}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {model.deviceInfo !== null ? (
              <>
                {model.deviceInfo}
                <span aria-hidden> · </span>
              </>
            ) : null}
            <AccessScopeSummary model={model.scopeSummary} />
          </p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          {model.revoke ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={model.revoke.disabled}
              onClick={() => void onRevokeSession(clientSession.sessionId)}
            >
              {model.revoke.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
});

type AuthorizedClientsHeaderActionProps = {
  onPairingLinkCreated: (result: AuthPairingCredentialResult) => void;
  clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  isRevokingOtherClients: boolean;
  onRevokeOtherClients: () => void;
};

const AuthorizedClientsHeaderAction = memo(function AuthorizedClientsHeaderAction({
  onPairingLinkCreated,
  clientSessions,
  isRevokingOtherClients,
  onRevokeOtherClients,
}: AuthorizedClientsHeaderActionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pairingLabel, setPairingLabel] = useState("");
  const [pairingScopes, setPairingScopes] =
    useState<ReadonlyArray<AuthEnvironmentScope>>(defaultPairingScopes);
  const [isCreatingPairingLink, setIsCreatingPairingLink] = useState(false);
  const headerModel = buildAuthorizedClientsHeaderModel({
    clientSessions,
    isRevokingOtherClients,
  });
  const dialogModel = buildCreatePairingLinkDialogModel({
    label: pairingLabel,
    scopes: pairingScopes,
    isCreating: isCreatingPairingLink,
  });

  const handleCreatePairingLink = useCallback(async () => {
    setIsCreatingPairingLink(true);
    try {
      const created = await createServerPairingCredential({
        label: pairingLabel,
        scopes: pairingScopes,
      });
      onPairingLinkCreated(created);
      setPairingLabel("");
      setPairingScopes(defaultPairingScopes());
      setDialogOpen(false);
    } catch (error) {
      const failure = resolveConnectionsFailure({ kind: "create-pairing-link" }, error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failure.title,
          description: failure.message,
        }),
      );
    } finally {
      setIsCreatingPairingLink(false);
    }
  }, [onPairingLinkCreated, pairingLabel, pairingScopes]);

  const togglePairingScope = useCallback((scope: AuthEnvironmentScope, checked: boolean) => {
    setPairingScopes((current) => resolvePairingScopeToggle(current, scope, checked));
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="xs"
        variant="destructive-outline"
        disabled={headerModel.revokeOthers.disabled}
        onClick={() => void onRevokeOtherClients()}
      >
        {headerModel.revokeOthers.label}
      </Button>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setPairingLabel("");
            setPairingScopes(defaultPairingScopes());
          }
        }}
      >
        <DialogTrigger
          render={
            <Button size="xs" variant="default">
              <PlusIcon className="size-3" />
              {headerModel.createLabel}
            </Button>
          }
        />
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogModel.title}</DialogTitle>
            <DialogDescription>{dialogModel.description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">
                {dialogModel.labelField.label}
              </span>
              <Input
                value={dialogModel.labelField.value}
                onChange={(event) => setPairingLabel(event.target.value)}
                placeholder={dialogModel.labelField.placeholder}
                disabled={dialogModel.labelField.disabled}
                autoFocus
              />
            </label>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-medium text-foreground">
                    {dialogModel.permissionsTitle}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {dialogModel.permissionsDescription}
                  </p>
                </div>
                <div className="flex gap-1">
                  {dialogModel.presets.map((preset) => (
                    <Button
                      key={preset.id}
                      size="xs"
                      variant="outline"
                      disabled={preset.disabled}
                      onClick={() => setPairingScopes(resolvePairingScopePreset(preset.id))}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-border/60 rounded-lg border border-input bg-muted/25">
                {dialogModel.scopeOptions.map((option) => (
                  <label
                    key={option.scope}
                    className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={option.checked}
                      disabled={option.disabled}
                      onCheckedChange={(checked) =>
                        togglePairingScope(option.scope, checked === true)
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground">
                        {option.title}
                      </span>
                      <span className="block text-xs leading-snug text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {dialogModel.validation ? (
                <p
                  className={
                    dialogModel.validation.tone === "error"
                      ? "text-xs text-destructive"
                      : "text-xs text-warning"
                  }
                >
                  {dialogModel.validation.message}
                </p>
              ) : null}
            </section>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              variant="outline"
              disabled={dialogModel.cancel.disabled}
              onClick={() => setDialogOpen(false)}
            >
              {dialogModel.cancel.label}
            </Button>
            <Button
              disabled={dialogModel.create.disabled}
              onClick={() => void handleCreatePairingLink()}
            >
              {dialogModel.create.label}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
});

type PairingClientsListProps = {
  endpointUrl: string | null | undefined;
  endpoints: ReadonlyArray<AdvertisedEndpoint>;
  defaultEndpointKey: string | null;
  presentation?: AccessSectionPresentation;
  isLoading: boolean;
  pairingLinks: ReadonlyArray<ServerPairingLinkRecord>;
  createdPairingCredentials: ReadonlyMap<string, string>;
  clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  revokingPairingLinkId: string | null;
  revokingClientSessionId: string | null;
  onRevokePairingLink: (id: string) => void;
  onRevokeClientSession: (sessionId: ServerClientSessionRecord["sessionId"]) => void;
};

const PairingClientsList = memo(function PairingClientsList({
  endpointUrl,
  endpoints,
  defaultEndpointKey,
  presentation = "current",
  isLoading,
  pairingLinks,
  createdPairingCredentials,
  clientSessions,
  revokingPairingLinkId,
  revokingClientSessionId,
  onRevokePairingLink,
  onRevokeClientSession,
}: PairingClientsListProps) {
  const emptyMessage = resolveAuthorizedClientsEmptyMessage({
    pairingLinkCount: pairingLinks.length,
    clientSessionCount: clientSessions.length,
    isLoading,
  });
  return (
    <>
      {pairingLinks.map((pairingLink) => (
        <PairingLinkListRow
          key={pairingLink.id}
          pairingLink={pairingLink}
          credential={createdPairingCredentials.get(pairingLink.id)}
          endpointUrl={endpointUrl}
          endpoints={endpoints}
          defaultEndpointKey={defaultEndpointKey}
          presentation={presentation}
          revokingPairingLinkId={revokingPairingLinkId}
          onRevoke={onRevokePairingLink}
        />
      ))}

      {clientSessions.map((clientSession) => (
        <ConnectedClientListRow
          key={clientSession.sessionId}
          clientSession={clientSession}
          presentation={presentation}
          revokingClientSessionId={revokingClientSessionId}
          onRevokeSession={onRevokeClientSession}
        />
      ))}

      {emptyMessage !== null ? (
        <div className={accessRowClassName(presentation)}>
          <p className="text-xs text-muted-foreground/60">{emptyMessage}</p>
        </div>
      ) : null}
    </>
  );
});

type AdvertisedEndpointListRowProps = {
  endpoint: AdvertisedEndpoint;
  defaultEndpointKey: string | null;
  presentation?: AccessSectionPresentation;
  onSetDefault: (endpoint: AdvertisedEndpoint) => void;
  onSetupTailscaleServe: (endpoint: AdvertisedEndpoint) => void;
  onDisableTailscaleServe: (endpoint: AdvertisedEndpoint) => void;
  isUpdatingTailscaleServe: boolean;
};

const AdvertisedEndpointListRow = memo(function AdvertisedEndpointListRow({
  endpoint,
  defaultEndpointKey,
  presentation = "current",
  onSetDefault,
  onSetupTailscaleServe,
  onDisableTailscaleServe,
  isUpdatingTailscaleServe,
}: AdvertisedEndpointListRowProps) {
  const model = buildAdvertisedEndpointRowModel({
    endpoint,
    defaultEndpointKey,
    isUpdatingTailscaleServe,
  });
  const isEndpointRail = presentation === "endpoint-rail";
  return (
    <div className={endpointRowClassName(presentation, model.available)}>
      {isEndpointRail && model.isDefault ? (
        <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" aria-hidden />
      ) : null}
      <div className="flex min-h-6 min-w-0 flex-col gap-2 sm:-my-0.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-baseline gap-3">
          <h3 className="shrink-0 text-sm leading-5 font-medium text-foreground">{model.label}</h3>
          {model.showUrl ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <p className="min-w-0 truncate text-xs leading-5 text-muted-foreground">
                    {model.url}
                  </p>
                }
              />
              <TooltipPopup side="top">{model.url}</TooltipPopup>
            </Tooltip>
          ) : null}
          {model.setupRequiredLabel ? (
            <span className="shrink-0 rounded-md border border-border/70 px-1 py-0.5 text-3xs text-muted-foreground">
              {model.setupRequiredLabel}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex min-h-6 shrink-0 items-center justify-end gap-2">
          {model.defaultBadgeLabel ? (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-1 py-0.5 text-3xs text-primary">
              {model.defaultBadgeLabel}
            </span>
          ) : null}
          {model.setupAction ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => onSetupTailscaleServe(endpoint)}
              disabled={model.setupAction.disabled}
            >
              {model.setupAction.label}
            </Button>
          ) : null}
          {model.disableAction ? (
            <Button
              size="xs"
              variant="destructive-outline"
              onClick={() => onDisableTailscaleServe(endpoint)}
              disabled={model.disableAction.disabled}
            >
              {model.disableAction.label}
            </Button>
          ) : null}
          {model.setDefaultLabel ? (
            <Button size="xs" variant="outline" onClick={() => onSetDefault(endpoint)}>
              {model.setDefaultLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
});

function NetworkAccessDescription({
  model,
  onToggleExpanded,
}: {
  model: NetworkAccessDescriptionModel;
  onToggleExpanded: () => void;
}) {
  if (model.kind === "text") {
    return model.text;
  }

  const summary = (
    <>
      <span className="min-w-0 truncate">{model.url}</span>
      {model.toggleLabel !== null ? (
        <span className="shrink-0 text-xs font-medium">{model.toggleLabel}</span>
      ) : null}
    </>
  );

  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1">
      <span className="shrink-0">{model.prefix}</span>
      {model.expandable ? (
        <button
          type="button"
          className="inline-flex min-w-0 max-w-full items-baseline gap-2 border-b border-dotted border-muted-foreground/60 text-left text-muted-foreground underline-offset-4 hover:border-foreground hover:text-foreground"
          onClick={onToggleExpanded}
          aria-expanded={model.expanded}
        >
          {summary}
        </button>
      ) : (
        <span className="inline-flex min-w-0 max-w-full items-baseline gap-2">{summary}</span>
      )}
    </span>
  );
}

type SavedBackendListRowProps = {
  environment: EnvironmentPresentation;
  removingEnvironmentId: EnvironmentId | null;
  onSetEnabled: (environmentId: EnvironmentId, enabled: boolean) => void;
  onRemove: (environment: EnvironmentPresentation) => void;
};

/**
 * One added machine in the Environments list. The switch is the main action;
 * the update icon appears only when that machine can take an update; the
 * row menu holds the icon override, trace ID, and removal.
 */
function SavedBackendListRow({
  environment,
  removingEnvironmentId,
  onSetEnabled,
  onRemove,
}: SavedBackendListRowProps) {
  const environmentId = environment.environmentId;
  const { copyToClipboard: copyTraceIdToClipboard } = useCopyToClipboard<{ traceId: string }>({
    target: "trace ID",
    onCopy: ({ traceId }) => {
      toastManager.add({ type: "success", ...resolveTraceIdCopyToast(traceId) });
    },
    onError: (error) => {
      const failure = resolveConnectionsFailure({ kind: "copy-trace-id" }, error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failure.title,
          description: failure.message,
        }),
      );
    },
  });
  const copyTraceId = useCallback(
    (traceId: string) => {
      copyTraceIdToClipboard(traceId, { traceId });
    },
    [copyTraceIdToClipboard],
  );
  const serverUpdateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  // A saved T3 Connect machine this device has never reached (unsupported,
  // or not yet connected) still has a descriptor from relay discovery, so
  // it can wear its detected glyph instead of the generic server. Discovery
  // empties its map on every refresh, so hold the last descriptor seen or
  // the glyph would blink back to the generic one each time.
  const relayDiscovery = useRelayEnvironmentDiscovery();
  const discoveredDescriptor = Option.getOrNull(
    relayDiscovery.environments.get(environmentId)?.status ?? Option.none(),
  )?.descriptor;
  const [lastDescriptor, setLastDescriptor] = useState(discoveredDescriptor);
  if (discoveredDescriptor !== undefined && discoveredDescriptor !== lastDescriptor) {
    setLastDescriptor(discoveredDescriptor);
  }
  const model = buildSavedBackendRowModel({
    environment,
    removingEnvironmentId,
    serverUpdateState,
    updateFacts: resolveServerUpdateFacts(environment.serverConfig, APP_VERSION),
    discoveredDescriptor: lastDescriptor,
  });
  const copyTraceIdAction = model.menu.copyTraceId;

  return (
    <EnvironmentRow
      kind={model.machineKind}
      label={model.label}
      dimmed={model.dimmed}
      subtitle={
        <Tooltip>
          {/* The status can change while the tooltip is open, and base-ui only
              re-measures the popup when the trigger's payload changes. */}
          <TooltipTrigger
            payload={model.statusTooltip}
            render={
              <span
                className={cn(
                  "block truncate",
                  model.subtitleTone === "error" && "text-destructive",
                )}
              />
            }
          >
            {model.subtitle}
          </TooltipTrigger>
          <TooltipPopup side="top" className="whitespace-pre-wrap">
            {model.statusTooltip}
          </TooltipPopup>
        </Tooltip>
      }
      below={
        model.showUpdateProgress && serverUpdateState.status !== "idle" ? (
          <div className="mt-1 max-w-md">
            <ServerUpdateProgress state={serverUpdateState} />
          </div>
        ) : null
      }
    >
      {model.update ? (
        <ServerUpdateAction
          environmentId={environmentId}
          serverLabel={model.update.serverLabel}
          selfUpdate={model.update.selfUpdate}
          desktopAppUpdate={model.update.desktopAppUpdate}
          threadContinuation={model.update.threadContinuation}
          targetVersion={model.update.targetVersion}
          label={model.update.label}
          appearance="icon"
        />
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Switch
              size="sm"
              checked={model.toggle.checked}
              disabled={model.toggle.disabled}
              aria-label={model.toggle.ariaLabel}
              onCheckedChange={(checked) => onSetEnabled(environmentId, checked)}
            />
          }
        />
        <TooltipPopup side="top">{model.toggle.tooltip}</TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              disabled={model.menu.disabled}
              aria-label={model.menu.ariaLabel}
            />
          }
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <EnvironmentIconMenu
            environmentId={environmentId}
            serverConfig={environment.serverConfig}
          />
          {copyTraceIdAction ? (
            <MenuItem onClick={() => copyTraceId(copyTraceIdAction.traceId)}>
              {copyTraceIdAction.label}
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => onRemove(environment)}>
            {model.menu.removeLabel}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </EnvironmentRow>
  );
}

function CloudLinkSwitch({
  model,
  onCheckedChange,
}: {
  readonly model: CloudLinkSwitchModel;
  readonly onCheckedChange?: (enabled: boolean) => void;
}) {
  const control = (
    <Switch
      aria-label={model.ariaLabel}
      checked={model.checked}
      disabled={model.disabled}
      {...(onCheckedChange ? { onCheckedChange } : {})}
    />
  );
  return model.disabledReason ? (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{control}</span>} />
      <TooltipPopup side="top">{model.disabledReason}</TooltipPopup>
    </Tooltip>
  ) : (
    control
  );
}

function ConfiguredCloudLinkRow({ canManageRelay }: { readonly canManageRelay: boolean }) {
  const {
    isSignedIn,
    linkState: primaryCloudLinkState,
    managedTunnelActive,
    publishAgentActivity,
    operationError,
    reconcileCloudState,
  } = useCloudLinkController();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUpdatingPreference, setIsUpdatingPreference] = useState(false);
  const model = buildCloudLinkModel({
    isDesktop: window.desktopBridge !== undefined,
    canManageRelay,
    isSignedIn: isSignedIn === true,
    isPending: primaryCloudLinkState.isPending,
    isUpdatingTunnel: isUpdating,
    isUpdatingPreference,
    managedTunnelActive,
    publishAgentActivity,
    operationError,
    linkError: primaryCloudLinkState.error,
  });

  const updateManagedTunnel = async (enabled: boolean) => {
    setIsUpdating(true);
    const ok = await reconcileCloudState({ managedTunnel: enabled, publish: publishAgentActivity });
    if (ok) {
      // Turning the tunnel off while publishing stays on downgrades the link
      // rather than removing it — say so instead of claiming an unlink.
      toastManager.add({
        type: "success",
        ...resolveManagedTunnelToast({ enabled, publishAgentActivity }),
      });
    }
    setIsUpdating(false);
  };

  const updatePublishAgentActivity = async (enabled: boolean) => {
    setIsUpdatingPreference(true);
    const ok = await reconcileCloudState({ managedTunnel: managedTunnelActive, publish: enabled });
    if (ok) {
      toastManager.add({ type: "success", ...resolvePublishAgentActivityToast(enabled) });
    }
    setIsUpdatingPreference(false);
  };

  return (
    <>
      {model.managedTunnel ? (
        <SettingsRow
          title={model.managedTunnel.title}
          description={model.managedTunnel.description}
          status={model.managedTunnel.status}
          control={
            <CloudLinkSwitch
              model={model.managedTunnel.switch}
              onCheckedChange={(enabled) => void updateManagedTunnel(enabled)}
            />
          }
        />
      ) : null}
      <SettingsRow
        title={model.publishAgentActivity.title}
        description={model.publishAgentActivity.description}
        control={
          <CloudLinkSwitch
            model={model.publishAgentActivity.switch}
            onCheckedChange={(enabled) => void updatePublishAgentActivity(enabled)}
          />
        }
      />
    </>
  );
}

function CloudLinkRow({ canManageRelay }: { readonly canManageRelay: boolean }) {
  return hasCloudPublicConfig() ? <ConfiguredCloudLinkRow canManageRelay={canManageRelay} /> : null;
}

function EmptyRemoteEnvironments({ model }: { readonly model: RemoteEnvironmentsEmptyStateModel }) {
  return (
    <Empty className="min-h-52">
      <EmptyMedia variant="icon">
        <ChevronsLeftRightEllipsisIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{model.title}</EmptyTitle>
        <EmptyDescription>{model.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function CloudRemoteEnvironmentRows({
  primaryEnvironmentId,
  savedEnvironments,
}: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly savedEnvironments: ReadonlyArray<EnvironmentPresentation>;
}) {
  const cloudEnabled = hasCloudPublicConfig();
  const emptyMode = resolveRemoteEnvironmentsEmptyMode({
    cloudEnabled,
    savedEnvironmentCount: savedEnvironments.length,
  });
  const emptyState = buildRemoteEnvironmentsEmptyStateModel(cloudEnabled);
  return emptyMode === "cloud-rows" ? (
    <CloudEnvironmentConnectRows
      primaryEnvironmentId={primaryEnvironmentId}
      savedEnvironments={savedEnvironments}
      empty={<EmptyRemoteEnvironments model={emptyState} />}
    />
  ) : emptyMode === "empty" ? (
    <EmptyRemoteEnvironments model={emptyState} />
  ) : null;
}

const CONNECTION_MODE_ICONS: Record<ConnectionModeCardModel["icon"], ReactNode> = {
  "chevrons-left-right-ellipsis": <ChevronsLeftRightEllipsisIcon aria-hidden className="size-4" />,
  terminal: <TerminalIcon aria-hidden className="size-4" />,
};

export function ConnectionsSettings() {
  const desktopBridge = window.desktopBridge;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const connectPairing = useAtomCommand(connectPairingAtom, { reportFailure: false });
  const connectSshEnvironment = useAtomCommand(connectSshEnvironmentAtom, {
    reportFailure: false,
  });
  const removeEnvironment = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const setEnvironmentEnabled = useAtomCommand(environmentCatalog.setEnabled, {
    reportFailure: false,
  });
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const primarySessionState = usePrimarySessionState();
  const sessionAuthenticated = primarySessionState.data?.authenticated === true;
  const sessionScopes = primarySessionState.data?.scopes ?? null;
  const sessionAuthPolicy = primarySessionState.data?.auth.policy ?? null;
  const localEnvironmentDisabled = isLocalEnvironmentDisabled();
  const access = useMemo(
    () =>
      resolveConnectionsAccess({
        isDesktop: desktopBridge !== undefined,
        localEnvironmentDisabled,
        sessionAuthenticated,
        sessionScopes,
        sessionAuthPolicy,
      }),
    [
      desktopBridge,
      localEnvironmentDisabled,
      sessionAuthPolicy,
      sessionAuthenticated,
      sessionScopes,
    ],
  );
  const currentAuthPolicy = access.authPolicy;
  // Catalog order is the order the machines were added; rows never jump when
  // one is switched off.
  const savedEnvironments = useMemo(() => resolveSavedEnvironments(environments), [environments]);
  // The WSL backend is managed from the WSL row under this machine, so it has
  // no row of its own in the list.
  const listedEnvironments = useMemo(
    () => resolveListedEnvironments(savedEnvironments),
    [savedEnvironments],
  );
  // Machines "Update all" can reach: switched on, connected, behind the client
  // version, remotely updatable, and not already mid-update. The button only
  // renders when this list is non-empty.
  const savedServerUpdateStatesAtom = useMemo(
    () =>
      Atom.make((get) =>
        savedEnvironments.map((environment) => ({
          environment,
          updateStatus: get(serverEnvironment.updateStateAtom(environment.environmentId)).status,
        })),
      ),
    [savedEnvironments],
  );
  const savedServerUpdateStates = useAtomValue(savedServerUpdateStatesAtom);
  const savedServerUpdateTargets = useMemo(
    () =>
      resolveSavedServerUpdateTargets(
        savedServerUpdateStates.map(({ environment, updateStatus }) => ({
          environment,
          updateStatus,
          updateFacts: resolveServerUpdateFacts(environment.serverConfig, APP_VERSION),
        })),
      ),
    [savedServerUpdateStates],
  );
  // Switched-off machines never receive threads, so they stay out of the
  // load balancing and GitHub sharing lists. The WSL backend has no row in
  // the Environments list but does take threads, so it stays in here. This
  // machine leads the list.
  const loadBalancingEnvironments = useMemo(
    () => resolveLoadBalancingEnvironments(primaryEnvironment, savedEnvironments),
    [primaryEnvironment, savedEnvironments],
  );
  const [desktopServerExposureMutationError, setDesktopServerExposureMutationError] = useState<
    string | null
  >(null);
  const [desktopAccessManagementMutationError, setDesktopAccessManagementMutationError] = useState<
    string | null
  >(null);
  // Only this client's creation response can supply a shareable credential.
  const [createdPairingCredentials, setCreatedPairingCredentials] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const handlePairingLinkCreated = useCallback((created: AuthPairingCredentialResult) => {
    setCreatedPairingCredentials((current) => new Map(current).set(created.id, created.credential));
  }, []);
  const [revokingDesktopPairingLinkId, setRevokingDesktopPairingLinkId] = useState<string | null>(
    null,
  );
  const [revokingDesktopClientSessionId, setRevokingDesktopClientSessionId] = useState<
    string | null
  >(null);
  const [isRevokingOtherDesktopClients, setIsRevokingOtherDesktopClients] = useState(false);
  const [addBackendDialogOpen, setAddBackendDialogOpen] = useState(false);
  const [savedBackendMode, setSavedBackendMode] = useState<SavedBackendMode>("remote");
  const [savedBackendHost, setSavedBackendHost] = useState("");
  const [savedBackendPairingCode, setSavedBackendPairingCode] = useState("");
  const [savedBackendSshHost, setSavedBackendSshHost] = useState("");
  const [savedBackendSshUsername, setSavedBackendSshUsername] = useState("");
  const [savedBackendSshPort, setSavedBackendSshPort] = useState("");
  const [sshHostSuggestionsOpen, setSshHostSuggestionsOpen] = useState(false);
  // Tracks the arrow-key/hover highlight so Enter selects it instead of submitting the typed text.
  const highlightedSshHostRef = useRef<DesktopDiscoveredSshHost | undefined>(undefined);
  const [savedBackendError, setSavedBackendError] = useState<string | null>(null);
  const [isAddingSavedBackend, setIsAddingSavedBackend] = useState(false);
  const [removingSavedEnvironmentId, setRemovingSavedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const [isUpdatingDesktopServerExposure, setIsUpdatingDesktopServerExposure] = useState(false);
  const [isDesktopServerExposureDialogOpen, setIsDesktopServerExposureDialogOpen] = useState(false);
  const [isUpdatingTailscaleServe, setIsUpdatingTailscaleServe] = useState(false);
  const [isUpdatingWslBackend, setIsUpdatingWslBackend] = useState(false);
  const [desktopWslMutationError, setDesktopWslMutationError] = useState<string | null>(null);
  // Pending WSL setting change waiting on user confirmation. Set when
  // the user tries a destructive change (disable, switch distro,
  // toggle wsl-only) while the WSL backend has saved-env state on this
  // machine. Confirming applies the change; cancelling drops it
  // without touching the persisted setting. Null when nothing is
  // pending.
  const [pendingWslChange, setPendingWslChange] = useState<PendingWslChange | null>(null);
  const [pendingTailscaleServeEndpoint, setPendingTailscaleServeEndpoint] =
    useState<AdvertisedEndpoint | null>(null);
  const [disableTailscaleServeDialogOpen, setDisableTailscaleServeDialogOpen] = useState(false);
  const [tailscaleServePortInput, setTailscaleServePortInput] = useState(
    String(DEFAULT_TAILSCALE_SERVE_PORT),
  );
  const [pendingDesktopServerExposureMode, setPendingDesktopServerExposureMode] =
    useState<NetworkExposureMode | null>(null);
  const primaryServerConfig = primaryEnvironment?.serverConfig ?? null;
  const primaryServerUpdateState = useAtomValue(
    serverEnvironment.updateStateAtom(primaryEnvironmentId),
  );
  const [isAdvertisedEndpointListExpanded, setIsAdvertisedEndpointListExpanded] = useState(false);
  const defaultAdvertisedEndpointKey = useUiStateStore(
    (state) => state.defaultAdvertisedEndpointKey,
  );
  const setDefaultAdvertisedEndpointKey = useUiStateStore(
    (state) => state.setDefaultAdvertisedEndpointKey,
  );
  const canManageLocalBackend = access.canManageLocalBackend;
  const canManageRelay = access.canManageRelay;
  const authAccessChanges = useEnvironmentQuery(
    canManageLocalBackend && primaryEnvironmentId !== null
      ? authEnvironment.accessChanges({
          environmentId: primaryEnvironmentId,
          input: null,
        })
      : null,
  );
  const desktopNetworkAccess = useEnvironmentQuery(
    canManageLocalBackend && desktopBridge ? desktopNetworkAccessStateAtom : null,
  );
  const isSshDiscoveryActive =
    desktopBridge !== undefined && addBackendDialogOpen && savedBackendMode === "ssh";
  const desktopSshHosts = useEnvironmentQuery(
    isSshDiscoveryActive ? desktopSshHostsStateAtom : null,
  );
  // The discovery atom is kept alive across dialog opens, so re-read SSH config
  // each time the SSH tab is shown; stale hosts stay visible while it refreshes.
  const refreshDesktopSshHosts = desktopSshHosts.refresh;
  useEffect(() => {
    if (isSshDiscoveryActive) refreshDesktopSshHosts();
  }, [isSshDiscoveryActive, refreshDesktopSshHosts]);
  const desktopWsl = useEnvironmentQuery(
    canManageLocalBackend && desktopBridge ? desktopWslStateAtom : null,
  );
  const desktopWslState = desktopWsl.data;
  const desktopWslError = desktopWslMutationError ?? desktopWsl.error;
  const isLoadingWslState = desktopWsl.isPending && desktopWsl.data === null;
  const discoveredSshHosts = desktopSshHosts.data ?? EMPTY_DISCOVERED_SSH_HOSTS;
  const unsavedDiscoveredSshHosts = useMemo(
    () => resolveUnsavedDiscoveredSshHosts(discoveredSshHosts, savedEnvironments),
    [discoveredSshHosts, savedEnvironments],
  );
  const filteredDiscoveredSshHosts = useMemo(
    () => filterDiscoveredSshHosts(unsavedDiscoveredSshHosts, savedBackendSshHost),
    [savedBackendSshHost, unsavedDiscoveredSshHosts],
  );
  const isLoadingDiscoveredSshHosts = desktopSshHosts.isPending && desktopSshHosts.data === null;
  const discoveredSshHostsError = desktopSshHosts.error;
  const addEnvironmentModel = useMemo(
    () =>
      buildAddEnvironmentDialogModel({
        isDesktop: desktopBridge !== undefined,
        mode: savedBackendMode,
        isAdding: isAddingSavedBackend,
        error: savedBackendError,
        host: savedBackendHost,
        pairingCode: savedBackendPairingCode,
        sshHost: savedBackendSshHost,
        sshUsername: savedBackendSshUsername,
        sshPort: savedBackendSshPort,
        discoveredHostsError: discoveredSshHostsError,
        isLoadingDiscoveredHosts: isLoadingDiscoveredSshHosts,
        unsavedDiscoveredHosts: unsavedDiscoveredSshHosts,
        keybindings,
        platform: navigator.platform,
      }),
    [
      desktopBridge,
      discoveredSshHostsError,
      isAddingSavedBackend,
      isLoadingDiscoveredSshHosts,
      keybindings,
      savedBackendError,
      savedBackendHost,
      savedBackendMode,
      savedBackendPairingCode,
      savedBackendSshHost,
      savedBackendSshPort,
      savedBackendSshUsername,
      unsavedDiscoveredSshHosts,
    ],
  );
  const sshSuggestions = addEnvironmentModel.ssh.suggestions;
  const hasSshHostSuggestionContent = sshSuggestions.hasContent;
  const desktopServerExposureState = desktopNetworkAccess.data?.serverExposureState ?? null;
  const desktopAdvertisedEndpoints =
    desktopNetworkAccess.data?.advertisedEndpoints ?? EMPTY_ADVERTISED_ENDPOINTS;
  const desktopServerExposureError =
    desktopServerExposureMutationError ?? desktopNetworkAccess.error;
  const desktopAccessManagementError =
    desktopAccessManagementMutationError ?? authAccessChanges.error;
  const isLoadingDesktopAccessManagement =
    authAccessChanges.isPending && authAccessChanges.data === null;
  const desktopPairingLinks = useMemo(() => {
    const event = authAccessChanges.data;
    if (event?.type !== "snapshot") return [];
    return sortDesktopPairingLinks(
      event.payload.pairingLinks.map((pairingLink: AuthPairingLink) =>
        toDesktopPairingLinkRecord(pairingLink),
      ),
    );
  }, [authAccessChanges.data]);
  const desktopClientSessions = useMemo(() => {
    const event = authAccessChanges.data;
    if (event?.type !== "snapshot") return [];
    return sortDesktopClientSessions(
      event.payload.clientSessions.map((clientSession: AuthClientSession) =>
        toDesktopClientSessionRecord(clientSession),
      ),
    );
  }, [authAccessChanges.data]);
  const endpointSelection = useMemo(
    () =>
      resolveConnectionsEndpointSelection({
        isDesktop: desktopBridge !== undefined,
        serverExposureState: desktopServerExposureState,
        authPolicy: currentAuthPolicy,
        advertisedEndpoints: desktopAdvertisedEndpoints,
        savedDefaultEndpointKey: defaultAdvertisedEndpointKey,
      }),
    [
      currentAuthPolicy,
      defaultAdvertisedEndpointKey,
      desktopAdvertisedEndpoints,
      desktopBridge,
      desktopServerExposureState,
    ],
  );
  const tailscaleServePort = resolveTailscaleServePort(tailscaleServePortInput);
  const tailscaleServePortValue =
    tailscaleServePort.kind === "valid" ? tailscaleServePort.port : null;

  const handleDesktopServerExposureChange = useCallback(
    async (mode: NetworkExposureMode) => {
      if (!desktopBridge) return;
      setIsUpdatingDesktopServerExposure(true);
      setDesktopServerExposureMutationError(null);
      try {
        await desktopBridge.setServerExposureMode(mode);
        refreshDesktopNetworkAccessState();
        setIsDesktopServerExposureDialogOpen(false);
        setIsUpdatingDesktopServerExposure(false);
      } catch (error) {
        const failure = resolveConnectionsFailure({ kind: "network-exposure" }, error);
        setIsDesktopServerExposureDialogOpen(false);
        setDesktopServerExposureMutationError(failure.message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failure.title,
            description: failure.message,
          }),
        );
        setIsUpdatingDesktopServerExposure(false);
      }
    },
    [desktopBridge],
  );

  const handleConfirmDesktopServerExposureChange = useCallback(() => {
    const decision = resolveNetworkExposureConfirm(pendingDesktopServerExposureMode);
    if (decision.kind === "ignore") return;
    void handleDesktopServerExposureChange(decision.mode);
  }, [handleDesktopServerExposureChange, pendingDesktopServerExposureMode]);

  const handleConfirmTailscaleServeSetup = useCallback(async () => {
    if (!desktopBridge) return;
    if (tailscaleServePortValue === null) return;
    setIsUpdatingTailscaleServe(true);
    setDesktopServerExposureMutationError(null);
    try {
      await desktopBridge.setTailscaleServeEnabled({
        enabled: true,
        port: tailscaleServePortValue,
      });
      refreshDesktopNetworkAccessState();
      setPendingTailscaleServeEndpoint(null);
    } catch (error) {
      const failure = resolveConnectionsFailure({ kind: "tailscale-setup" }, error);
      setDesktopServerExposureMutationError(failure.message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failure.title,
          description: failure.message,
        }),
      );
    } finally {
      setIsUpdatingTailscaleServe(false);
    }
  }, [desktopBridge, tailscaleServePortValue]);

  const handleStartTailscaleServeSetup = useCallback(
    (endpoint: AdvertisedEndpoint) => {
      setTailscaleServePortInput(resolveTailscaleServeStartPortInput(desktopServerExposureState));
      setPendingTailscaleServeEndpoint(endpoint);
    },
    [desktopServerExposureState],
  );

  const handleConfirmTailscaleServeDisable = useCallback(async () => {
    if (!desktopBridge) return;
    setIsUpdatingTailscaleServe(true);
    setDesktopServerExposureMutationError(null);
    try {
      await desktopBridge.setTailscaleServeEnabled({
        enabled: false,
        port: resolveTailscaleServeDisablePort(desktopServerExposureState),
      });
      refreshDesktopNetworkAccessState();
      setDisableTailscaleServeDialogOpen(false);
    } catch (error) {
      const failure = resolveConnectionsFailure({ kind: "tailscale-disable" }, error);
      setDesktopServerExposureMutationError(failure.message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failure.title,
          description: failure.message,
        }),
      );
    } finally {
      setIsUpdatingTailscaleServe(false);
    }
  }, [desktopBridge, desktopServerExposureState]);

  const handleStartTailscaleServeDisable = useCallback((_endpoint: AdvertisedEndpoint) => {
    setDisableTailscaleServeDialogOpen(true);
  }, []);

  const handleRevokeDesktopPairingLink = useCallback(async (id: string) => {
    setRevokingDesktopPairingLinkId(id);
    setDesktopAccessManagementMutationError(null);
    try {
      await revokeServerPairingLink(id);
    } catch (error) {
      const failure = resolveConnectionsFailure({ kind: "revoke-pairing-link" }, error);
      setDesktopAccessManagementMutationError(failure.message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failure.title,
          description: failure.message,
        }),
      );
    } finally {
      setRevokingDesktopPairingLinkId(null);
    }
  }, []);

  const handleRevokeDesktopClientSession = useCallback(
    async (sessionId: ServerClientSessionRecord["sessionId"]) => {
      setRevokingDesktopClientSessionId(sessionId);
      setDesktopAccessManagementMutationError(null);
      try {
        await revokeServerClientSession(sessionId);
      } catch (error) {
        const failure = resolveConnectionsFailure({ kind: "revoke-client" }, error);
        setDesktopAccessManagementMutationError(failure.message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failure.title,
            description: failure.message,
          }),
        );
      } finally {
        setRevokingDesktopClientSessionId(null);
      }
    },
    [],
  );

  const handleRevokeOtherDesktopClients = useCallback(async () => {
    setIsRevokingOtherDesktopClients(true);
    setDesktopAccessManagementMutationError(null);
    try {
      const revokedCount = await revokeOtherServerClientSessions();
      toastManager.add({ type: "success", ...resolveRevokeOtherClientsToast(revokedCount) });
    } catch (error) {
      const failure = resolveConnectionsFailure({ kind: "revoke-other-clients" }, error);
      setDesktopAccessManagementMutationError(failure.message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failure.title,
          description: failure.message,
        }),
      );
    } finally {
      setIsRevokingOtherDesktopClients(false);
    }
  }, []);

  // Shared by manual SSH submission and discovered-host selection.
  const connectSavedBackendSshTarget = useCallback(
    async (target: DesktopSshEnvironmentTarget) => {
      setIsAddingSavedBackend(true);
      setSavedBackendError(null);
      const result = await connectSshEnvironment({ target, label: "" });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setSavedBackendError(formatDesktopSshConnectionError(squashAtomCommandFailure(result)));
        }
        setIsAddingSavedBackend(false);
        return;
      }

      setSavedBackendHost("");
      setSavedBackendPairingCode("");
      setSavedBackendSshHost("");
      setSavedBackendSshUsername("");
      setSavedBackendSshPort("");
      setAddBackendDialogOpen(false);
      toastManager.add({ type: "success", ...resolveSshConnectedToast(target.alias) });
      setIsAddingSavedBackend(false);
    },
    [connectSshEnvironment],
  );

  const handleAddSavedBackend = useCallback(async () => {
    const decision = resolveAddSavedBackend({
      mode: savedBackendMode,
      host: savedBackendHost,
      pairingCode: savedBackendPairingCode,
      sshHost: savedBackendSshHost,
      sshUsername: savedBackendSshUsername,
      sshPort: savedBackendSshPort,
      baseOrigin: window.location.origin,
    });
    if (decision.kind === "ssh-invalid") {
      setSavedBackendError(decision.message);
      return;
    }
    if (decision.kind === "connect-ssh") {
      await connectSavedBackendSshTarget(decision.target);
      return;
    }

    setIsAddingSavedBackend(true);
    setSavedBackendError(null);
    if (decision.kind === "remote-invalid") {
      setSavedBackendError(decision.message);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: resolveConnectionsFailureTitle({ kind: "add-backend" }),
          description: decision.message,
        }),
      );
      setIsAddingSavedBackend(false);
      return;
    }

    const result = await connectPairing({
      host: decision.host,
      pairingCode: decision.pairingCode,
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = resolveConnectionsFailure(
          { kind: "add-backend" },
          squashAtomCommandFailure(result),
        );
        setSavedBackendError(failure.message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failure.title,
            description: failure.message,
          }),
        );
      }
      setIsAddingSavedBackend(false);
      return;
    }

    setSavedBackendHost("");
    setSavedBackendPairingCode("");
    setSavedBackendSshHost("");
    setSavedBackendSshUsername("");
    setSavedBackendSshPort("");
    setAddBackendDialogOpen(false);
    toastManager.add({ type: "success", ...BACKEND_ADDED_TOAST });
    setIsAddingSavedBackend(false);
  }, [
    connectPairing,
    connectSavedBackendSshTarget,
    savedBackendHost,
    savedBackendMode,
    savedBackendPairingCode,
    savedBackendSshHost,
    savedBackendSshPort,
    savedBackendSshUsername,
  ]);

  const handleSavedBackendSshFieldKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && savedBackendSshHost.trim().length > 0) {
        event.preventDefault();
        void handleAddSavedBackend();
      }
    },
    [handleAddSavedBackend, savedBackendSshHost],
  );

  // Resolves a picked alias before connecting it through the manual SSH flow.
  const handleSelectSshHostSuggestion = useCallback(
    async (target: DesktopDiscoveredSshHost) => {
      if (isAddingSavedBackend || !desktopBridge) return;

      setIsAddingSavedBackend(true);
      setSavedBackendError(null);
      setSavedBackendSshHost(target.alias);
      let resolved: DesktopSshEnvironmentTarget;
      try {
        resolved = await desktopBridge.resolveSshHost(target.alias);
      } catch (error) {
        setSavedBackendError(formatDesktopSshConnectionError(error));
        setIsAddingSavedBackend(false);
        return;
      }
      setSavedBackendSshUsername(resolved.username ?? "");
      setSavedBackendSshPort(resolved.port === null ? "" : String(resolved.port));
      await connectSavedBackendSshTarget(resolved);
    },
    [connectSavedBackendSshTarget, desktopBridge, isAddingSavedBackend],
  );

  const handleSavedBackendSshHostKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;

      // The popup only renders when there is content, so an "open" flag alone is not enough.
      const isSshHostPopupVisible = sshHostSuggestionsOpen && hasSshHostSuggestionContent;
      if (isSshHostPopupVisible) {
        const command = resolveShortcutCommand(event, keybindings, {
          platform: navigator.platform,
          context: { modelPickerOpen: false },
        });
        const target = resolveSshHostShortcutTarget(command ?? null, filteredDiscoveredSshHosts);
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          setSshHostSuggestionsOpen(false);
          void handleSelectSshHostSuggestion(target);
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      // A highlighted row means Enter belongs to the autocomplete, which selects it.
      const hasHighlightedSshHost =
        isSshHostPopupVisible && highlightedSshHostRef.current !== undefined;
      if (
        !event.defaultPrevented &&
        !hasHighlightedSshHost &&
        event.key === "Enter" &&
        savedBackendSshHost.trim().length > 0
      ) {
        event.preventDefault();
        void handleAddSavedBackend();
      }
    },
    [
      filteredDiscoveredSshHosts,
      handleAddSavedBackend,
      handleSelectSshHostSuggestion,
      hasSshHostSuggestionContent,
      keybindings,
      savedBackendSshHost,
      sshHostSuggestionsOpen,
    ],
  );

  const handleSetSavedBackendEnabled = useCallback(
    async (environmentId: EnvironmentId, enabled: boolean) => {
      setSavedBackendError(null);
      const result = await setEnvironmentEnabled({ environmentId, enabled });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const failure = resolveConnectionsFailure(
          { kind: "set-backend-enabled", enabled },
          squashAtomCommandFailure(result),
        );
        setSavedBackendError(failure.message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failure.title,
            description: failure.message,
          }),
        );
      }
    },
    [setEnvironmentEnabled],
  );

  const removeSavedBackend = useCallback(
    async (environment: EnvironmentPresentation) => {
      const environmentId = environment.environmentId;
      setRemovingSavedEnvironmentId(environmentId);
      setSavedBackendError(null);
      const result = await removeEnvironment(environmentId);
      setRemovingSavedEnvironmentId(null);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const failure = resolveConnectionsFailure(
          { kind: "remove-backend" },
          squashAtomCommandFailure(result),
        );
        setSavedBackendError(failure.message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failure.title,
            description: failure.message,
          }),
        );
      }
    },
    [removeEnvironment],
  );

  // Removing forgets the pairing, credentials, and cached threads on this
  // device. Switching off is the reversible path, so removal always confirms.
  // T3 Connect environments get their own dialog: removing one here leaves its
  // account registration, so it points to where that can be deregistered.
  const [pendingT3ConnectRemoval, setPendingT3ConnectRemoval] =
    useState<EnvironmentPresentation | null>(null);
  const handleRemoveSavedBackend = useCallback(
    async (environment: EnvironmentPresentation) => {
      const decision = resolveRemoveSavedBackend({
        environment,
        cloudEnabled: hasCloudPublicConfig(),
      });
      if (decision.kind === "t3-connect-dialog") {
        setPendingT3ConnectRemoval(environment);
        return;
      }
      // Fail closed: no mounted confirm host means no removal.
      const confirmed = await requestConfirmDialog(decision.message, { variant: "destructive" });
      if (confirmed === true) await removeSavedBackend(environment);
    },
    [removeSavedBackend, setPendingT3ConnectRemoval],
  );

  const tailscaleHttpsEndpoint = endpointSelection.tailscaleHttpsEndpoint;
  const handleSetDefaultAdvertisedEndpoint = useCallback(
    (endpoint: AdvertisedEndpoint) => {
      setDefaultAdvertisedEndpointKey(endpointDefaultPreferenceKey(endpoint));
    },
    [setDefaultAdvertisedEndpointKey],
  );
  const handleSavedBackendHostChange = useCallback((value: string) => {
    const decision = resolveSavedBackendHostInput(value, window.location.origin);
    if (decision.kind === "pairing-url") {
      setSavedBackendHost(decision.host);
      setSavedBackendPairingCode(decision.pairingCode);
      return;
    }
    setSavedBackendHost(decision.host);
  }, []);

  const renderConnectionModeCard = (card: ConnectionModeCardModel) => (
    <button
      key={card.mode}
      type="button"
      aria-pressed={card.selected}
      className={cn(
        "group flex min-h-24 items-start gap-3 rounded-lg border p-4 text-left",
        card.selected ? "border-primary/50 bg-primary/5" : "border-border/60 hover:bg-muted/40",
      )}
      disabled={card.disabled}
      onClick={() => {
        setSavedBackendMode(card.mode);
      }}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
          card.selected
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border/70 bg-background text-muted-foreground group-hover:text-foreground",
        )}
      >
        {CONNECTION_MODE_ICONS[card.icon]}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{card.title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {card.description}
        </span>
      </span>
    </button>
  );

  const remoteFields = addEnvironmentModel.remote;
  const sshFields = addEnvironmentModel.ssh;
  const renderRemoteFields = () => (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">
            {remoteFields.hostLabel}
          </span>
          <Input
            value={remoteFields.hostValue}
            onChange={(event) => handleSavedBackendHostChange(event.target.value)}
            placeholder={remoteFields.hostPlaceholder}
            disabled={addEnvironmentModel.fieldsDisabled}
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">
            {remoteFields.pairingCodeLabel}
          </span>
          <Input
            value={remoteFields.pairingCodeValue}
            onChange={(event) => setSavedBackendPairingCode(event.target.value)}
            placeholder={remoteFields.pairingCodePlaceholder}
            disabled={addEnvironmentModel.fieldsDisabled}
            spellCheck={false}
          />
        </label>
      </div>
      <div>
        <span className="mt-1 block text-2xs text-muted-foreground">{remoteFields.hint}</span>
      </div>
    </div>
  );
  const renderRemoteModeBody = () => (
    <div className="space-y-4">
      {renderRemoteFields()}
      {remoteFields.error ? <p className="text-xs text-destructive">{remoteFields.error}</p> : null}
      <Button
        variant="outline"
        className="w-full"
        disabled={addEnvironmentModel.submit.disabled}
        onClick={() => void handleAddSavedBackend()}
      >
        <PlusIcon className="size-3.5" />
        {addEnvironmentModel.submit.label}
      </Button>
    </div>
  );
  const renderSshFields = () => (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="block">
          <label
            htmlFor="saved-backend-ssh-host"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            {sshFields.hostLabel}
          </label>
          <Autocomplete
            items={filteredDiscoveredSshHosts}
            itemToStringValue={(target) => target.alias}
            mode="none"
            openOnInputClick
            open={sshHostSuggestionsOpen}
            onOpenChange={setSshHostSuggestionsOpen}
            onItemHighlighted={(target) => {
              highlightedSshHostRef.current = target;
            }}
            value={sshFields.hostValue}
            onValueChange={(value, eventDetails) => {
              setSavedBackendSshHost(value);
              if (eventDetails.reason !== "item-press") return;

              const target = filteredDiscoveredSshHosts.find((host) => host.alias === value);
              if (target) void handleSelectSshHostSuggestion(target);
            }}
          >
            <AutocompleteInput
              id="saved-backend-ssh-host"
              onKeyDown={handleSavedBackendSshHostKeyDown}
              placeholder={sshFields.hostPlaceholder}
              disabled={addEnvironmentModel.fieldsDisabled}
              spellCheck={false}
            />
            {sshSuggestions.hasContent ? (
              <AutocompletePopup>
                {sshSuggestions.state === "loading" ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {sshSuggestions.loadingLabel}
                  </div>
                ) : sshSuggestions.state === "list" ? (
                  <AutocompleteList className="max-h-72">
                    {filteredDiscoveredSshHosts.map((target, index) => {
                      const item = sshSuggestions.items[index];
                      if (!item) return null;
                      return (
                        <AutocompleteItem
                          key={item.key}
                          value={target}
                          className="h-8 min-h-8 whitespace-nowrap"
                        >
                          <span className="min-w-0 truncate text-sm font-medium">{item.alias}</span>
                          {item.address !== null ? (
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {item.address}
                            </span>
                          ) : (
                            <span className="flex-1" />
                          )}
                          {item.shortcutLabel ? (
                            <CommandShortcut className="shrink-0">
                              {item.shortcutLabel}
                            </CommandShortcut>
                          ) : null}
                        </AutocompleteItem>
                      );
                    })}
                  </AutocompleteList>
                ) : (
                  <AutocompleteEmpty className="break-all">
                    {sshSuggestions.emptyLabel}
                  </AutocompleteEmpty>
                )}
              </AutocompletePopup>
            ) : null}
          </Autocomplete>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">
              {sshFields.usernameLabel}
            </span>
            <Input
              value={sshFields.usernameValue}
              onChange={(event) => setSavedBackendSshUsername(event.target.value)}
              onKeyDown={handleSavedBackendSshFieldKeyDown}
              placeholder={sshFields.usernamePlaceholder}
              disabled={addEnvironmentModel.fieldsDisabled}
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">
              {sshFields.portLabel}
            </span>
            <Input
              value={sshFields.portValue}
              onChange={(event) => setSavedBackendSshPort(event.target.value)}
              onKeyDown={handleSavedBackendSshFieldKeyDown}
              placeholder={sshFields.portPlaceholder}
              inputMode="numeric"
              disabled={addEnvironmentModel.fieldsDisabled}
              spellCheck={false}
            />
          </label>
        </div>
        {sshFields.error !== null ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {sshFields.error}
          </div>
        ) : null}
        <Button
          variant="outline"
          className="w-full"
          disabled={addEnvironmentModel.submit.disabled}
          onClick={() => void handleAddSavedBackend()}
        >
          <PlusIcon className="size-3.5" />
          {addEnvironmentModel.submit.label}
        </Button>
      </div>
    </div>
  );
  const renderNetworkAccessToggle = (model: ConnectionsSwitchModel) => (
    <Switch
      checked={model.checked}
      disabled={model.disabled}
      onCheckedChange={(checked) => {
        setPendingDesktopServerExposureMode(resolveNetworkExposureToggle(checked));
        setIsDesktopServerExposureDialogOpen(true);
      }}
      aria-label={model.ariaLabel}
    />
  );
  const renderEndpointRows = (presentation: AccessSectionPresentation) =>
    isAdvertisedEndpointListExpanded
      ? endpointSelection.visibleNetworkEndpoints.map((endpoint) => (
          <AdvertisedEndpointListRow
            key={endpoint.id}
            endpoint={endpoint}
            defaultEndpointKey={endpointSelection.defaultEndpointKey}
            presentation={presentation}
            onSetDefault={handleSetDefaultAdvertisedEndpoint}
            onSetupTailscaleServe={handleStartTailscaleServeSetup}
            onDisableTailscaleServe={handleStartTailscaleServeDisable}
            isUpdatingTailscaleServe={isUpdatingTailscaleServe}
          />
        ))
      : null;
  // Apply a setting change immediately. The orchestrator reconciles the
  // pool in the background and the primary backend is untouched, so we
  // don't gate this behind a confirmation dialog. After the desktop
  // side persists the change and nudges its orchestrator, we trigger
  // the renderer's reconciler so the WSL backend's saved-env-shaped
  // entry catches up (registers/unregisters) without a reload.
  const applyWslSettingChange = useCallback(
    async (apply: () => Promise<DesktopWslState>) => {
      if (!desktopBridge) return;
      setIsUpdatingWslBackend(true);
      setDesktopWslMutationError(null);
      try {
        await apply();
        refreshDesktopWslState();
        // The connection platform source polls the desktop bootstrap list and
        // reconciles the environment catalog automatically, so toggling the WSL
        // backend on/off or switching distros is picked up here without an
        // explicit renderer reconcile.
      } catch (error) {
        const failure = resolveConnectionsFailure({ kind: "wsl" }, error);
        setDesktopWslMutationError(failure.message);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failure.title,
            description: failure.message,
          }),
        );
        refreshDesktopWslState();
      } finally {
        setIsUpdatingWslBackend(false);
      }
    },
    [desktopBridge],
  );

  // Reload the keep-alive WSL state atom. Clearing the mutation error before
  // refresh lets the atom-owned load error become the visible retry state.
  const loadWslState = useCallback(() => {
    setDesktopWslMutationError(null);
    refreshDesktopWslState();
  }, []);

  // True when a desktop-local WSL backend is currently registered as an
  // environment on this machine. We use this as a proxy for "the user has work
  // that lives on the WSL side": if WSL has connected in a way that registered
  // the env, disabling or switching distros could disrupt open threads/projects.
  // If WSL never connected (fresh install, toggled on then immediately off,
  // etc.) there's no local environment, so we skip the confirmation dialog.
  const hasWslRegistrationToLose = useMemo(
    () => resolveHasWslRegistrationToLose(environments),
    [environments],
  );

  const runWslOperation = useCallback(
    (operation: WslOperation) => {
      if (!desktopBridge) return;
      switch (operation.kind) {
        case "disable":
          void applyWslSettingChange(async () => {
            const next = await desktopBridge.setWslBackendEnabled(false);
            if (operation.clearWslOnly) {
              // Clearing wsl-only relaunches onto the Windows backend.
              return await desktopBridge.setWslOnly(false);
            }
            return next;
          });
          return;
        case "set-distro":
          void applyWslSettingChange(() => desktopBridge.setWslDistro(operation.distro));
          return;
        case "set-wsl-only":
          void applyWslSettingChange(() => desktopBridge.setWslOnly(operation.value));
          return;
      }
    },
    [applyWslSettingChange, desktopBridge],
  );

  const applyWslDecision = useCallback(
    (decision: WslChangeDecision) => {
      if (decision.kind === "confirm") {
        setPendingWslChange(decision.change);
        return;
      }
      if (decision.kind === "apply") {
        runWslOperation(decision.operation);
      }
    },
    [runWslOperation],
  );

  // Single picker for "WSL backend off" vs "running on distro X". The
  // dropdown maps "Off" to disable and any distro entry to enable +
  // run on that distro. Splitting these into a separate switch and
  // dropdown was confusing — they're the same decision.
  const handleSelectWslMode = useCallback(
    (value: string) => {
      if (!desktopBridge || !desktopWslState) return;
      applyWslDecision(
        resolveWslModeSelection({ value, state: desktopWslState, hasWslRegistrationToLose }),
      );
    },
    [applyWslDecision, desktopBridge, desktopWslState, hasWslRegistrationToLose],
  );

  // Dispatched from the enable modal's two action buttons.
  const handleConfirmEnableWsl = useCallback(
    (mode: "both" | "wsl-only") => {
      if (!desktopBridge || !pendingWslChange || pendingWslChange.kind !== "enable") return;
      const nextDistro = pendingWslChange.nextDistro;
      setPendingWslChange(null);
      const persistedDistro = desktopWslState?.distro ?? null;
      void applyWslSettingChange(() =>
        applyWslEnableSelection({
          bridge: desktopBridge,
          mode,
          nextDistro,
          persistedDistro,
        }),
      );
    },
    [applyWslSettingChange, desktopBridge, desktopWslState, pendingWslChange],
  );

  const handleToggleWslOnly = useCallback(
    (enabled: boolean) => {
      if (!desktopBridge) return;
      applyWslDecision(resolveWslOnlyToggle({ enabled, state: desktopWslState }));
    },
    [applyWslDecision, desktopBridge, desktopWslState],
  );

  const handleConfirmWslChange = useCallback(() => {
    if (!desktopBridge || !pendingWslChange) return;
    const decision = resolveWslConfirm(pendingWslChange);
    if (decision.kind !== "apply") return;
    setPendingWslChange(null);
    runWslOperation(decision.operation);
  }, [desktopBridge, pendingWslChange, runWslOperation]);

  const handleWslConfirmAction = (actionId: "wsl-only" | "both" | "confirm") => {
    if (actionId === "confirm") {
      handleConfirmWslChange();
      return;
    }
    handleConfirmEnableWsl(actionId);
  };

  const wslModel = buildWslSettingsModel({
    state: desktopWslState,
    error: desktopWslError,
    canManageLocalBackend,
    isLoading: isLoadingWslState,
    isUpdating: isUpdatingWslBackend,
  });
  const renderWslRow = () => {
    switch (wslModel.kind) {
      case "hidden":
        return null;
      case "load-error":
        return (
          <SettingsRow
            id={wslModel.id}
            title={wslModel.title}
            description={wslModel.description}
            status={<span className="block text-destructive">{wslModel.error}</span>}
            control={
              <Button
                size="sm"
                variant="outline"
                onClick={loadWslState}
                disabled={wslModel.retry.disabled}
              >
                {wslModel.retry.label}
              </Button>
            }
          />
        );
      case "unavailable":
        return (
          <SettingsRow
            id={wslModel.id}
            title={wslModel.title}
            description={wslModel.description}
            status={
              wslModel.error ? (
                <span className="block text-destructive">{wslModel.error}</span>
              ) : null
            }
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={wslModel.switchToWindows.disabled}
                onClick={() => handleSelectWslMode(BACKEND_VALUE_WSL_OFF)}
              >
                {wslModel.switchToWindows.label}
              </Button>
            }
          />
        );
      case "picker":
        return (
          <>
            <SettingsRow
              id={wslModel.id}
              title={wslModel.title}
              description={wslModel.description}
              status={
                wslModel.status ? (
                  <span className="block text-destructive">{wslModel.status}</span>
                ) : null
              }
              control={
                <Select
                  value={wslModel.select.value}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    handleSelectWslMode(value);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full sm:w-56"
                    aria-label={wslModel.select.ariaLabel}
                    disabled={wslModel.select.disabled}
                  >
                    <SelectValue>{wslModel.select.label}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {wslModel.select.options.map((option) => (
                      <SelectItem hideIndicator key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            {wslModel.wslOnly ? (
              <SettingsRow
                title={wslModel.wslOnly.title}
                description={wslModel.wslOnly.description}
                className="bg-muted/20 pl-7 sm:pl-8"
                control={
                  <Switch
                    checked={wslModel.wslOnly.switch.checked}
                    disabled={wslModel.wslOnly.switch.disabled}
                    onCheckedChange={(checked) => handleToggleWslOnly(checked)}
                    aria-label={wslModel.wslOnly.switch.ariaLabel}
                  />
                }
              />
            ) : null}
          </>
        );
    }
  };

  const tailscaleRowModel = buildTailscaleRowModel({
    endpoint: tailscaleHttpsEndpoint,
    isUpdating: isUpdatingTailscaleServe,
  });
  const renderTailscaleRow = () => (
    <SettingsRow
      title={tailscaleRowModel.title}
      description={tailscaleRowModel.description}
      control={
        tailscaleHttpsEndpoint && tailscaleRowModel.switch ? (
          <Switch
            checked={tailscaleRowModel.switch.checked}
            disabled={tailscaleRowModel.switch.disabled}
            onCheckedChange={(checked) => {
              if (resolveTailscaleSwitchChange(checked) === "setup") {
                handleStartTailscaleServeSetup(tailscaleHttpsEndpoint);
                return;
              }
              handleStartTailscaleServeDisable(tailscaleHttpsEndpoint);
            }}
            aria-label={tailscaleRowModel.switch.ariaLabel}
          />
        ) : null
      }
    />
  );
  const renderAuthorizedClients = (presentation: AccessSectionPresentation) => (
    <>
      {desktopAccessManagementError ? (
        <div className={accessRowClassName(presentation)}>
          <p className="text-xs text-destructive">{desktopAccessManagementError}</p>
        </div>
      ) : null}
      <PairingClientsList
        endpointUrl={desktopServerExposureState?.endpointUrl}
        endpoints={endpointSelection.visibleEndpoints}
        defaultEndpointKey={endpointSelection.defaultEndpointKey}
        presentation={presentation}
        isLoading={isLoadingDesktopAccessManagement}
        pairingLinks={desktopPairingLinks}
        createdPairingCredentials={createdPairingCredentials}
        clientSessions={desktopClientSessions}
        revokingPairingLinkId={revokingDesktopPairingLinkId}
        revokingClientSessionId={revokingDesktopClientSessionId}
        onRevokePairingLink={handleRevokeDesktopPairingLink}
        onRevokeClientSession={handleRevokeDesktopClientSession}
      />
    </>
  );
  const networkAccessRowModel = buildNetworkAccessRowModel({
    isDesktop: desktopBridge !== undefined,
    selection: endpointSelection,
    serverExposureState: desktopServerExposureState,
    serverExposureError: desktopServerExposureError,
    authPolicy: currentAuthPolicy,
    isUpdatingServerExposure: isUpdatingDesktopServerExposure,
    endpointListExpanded: isAdvertisedEndpointListExpanded,
  });
  const renderNetworkAccessRow = (model: NetworkAccessRowModel) =>
    model.kind === "toggle" ? (
      <SettingsRow
        title={model.title}
        description={
          <NetworkAccessDescription
            model={model.description}
            onToggleExpanded={() => setIsAdvertisedEndpointListExpanded((expanded) => !expanded)}
          />
        }
        status={
          model.status ? <span className="block text-destructive">{model.status}</span> : null
        }
        control={renderNetworkAccessToggle(model.switch)}
      />
    ) : (
      <SettingsRow
        title={model.title}
        description={model.description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Switch
                    checked={model.switch.checked}
                    disabled={model.switch.disabled}
                    aria-label={model.switch.ariaLabel}
                  />
                </span>
              }
            />
            <TooltipPopup side="top">{model.tooltip}</TooltipPopup>
          </Tooltip>
        }
      />
    );

  const primaryHeaderModel = buildPrimaryEnvironmentHeaderModel({
    isDesktop: desktopBridge !== undefined,
    environment: primaryEnvironment,
  });
  const versionRowModel = buildVersionRowModel({
    environment: primaryEnvironment,
    updateState: primaryServerUpdateState,
    updateFacts: resolveServerUpdateFacts(primaryServerConfig, APP_VERSION),
  });
  const versionControl = versionRowModel.control;
  const versionDescription = versionRowModel.description;
  const networkExposureDialogModel = buildNetworkExposureDialogModel({
    open: isDesktopServerExposureDialogOpen,
    pendingMode: pendingDesktopServerExposureMode,
    isUpdating: isUpdatingDesktopServerExposure,
  });
  const wslConfirmDialogModel = buildWslConfirmDialogModel({
    pending: pendingWslChange,
    isUpdating: isUpdatingWslBackend,
  });
  const tailscaleDisableDialogModel = buildTailscaleServeDisableDialogModel({
    open: disableTailscaleServeDialogOpen,
    isUpdating: isUpdatingTailscaleServe,
  });
  const tailscaleSetupDialogModel = buildTailscaleServeSetupDialogModel({
    pendingEndpoint: pendingTailscaleServeEndpoint,
    portInput: tailscaleServePortInput,
    isUpdating: isUpdatingTailscaleServe,
  });

  const primarySettings = (
    <>
      {desktopBridge || canManageLocalBackend ? (
        <>
          <SettingsSection
            id={primaryHeaderModel.id}
            title={primaryHeaderModel.title}
            icon={
              <EnvironmentMachineIcon
                aria-hidden
                kind={primaryHeaderModel.iconKind}
                className="size-4"
              />
            }
            headerAction={
              primaryEnvironmentId !== null && primaryHeaderModel.menuAriaLabel !== null ? (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost-muted"
                        size="icon-xs"
                        aria-label={primaryHeaderModel.menuAriaLabel}
                      />
                    }
                  >
                    <EllipsisIcon className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <EnvironmentIconMenu
                      environmentId={primaryEnvironmentId}
                      serverConfig={primaryServerConfig}
                    />
                  </MenuPopup>
                </Menu>
              ) : null
            }
          >
            <LocalEnvironmentSetting />
            {canManageLocalBackend ? (
              <SettingsRow
                title={versionRowModel.title}
                description={
                  versionDescription.kind === "progress" &&
                  primaryServerUpdateState.status !== "idle" ? (
                    <ServerUpdateProgress state={primaryServerUpdateState} />
                  ) : versionDescription.kind === "text" ? (
                    versionDescription.text
                  ) : null
                }
                control={
                  versionControl?.kind === "update" && primaryEnvironmentId !== null ? (
                    <ServerUpdateAction
                      size="sm"
                      environmentId={primaryEnvironmentId}
                      serverLabel={versionControl.serverLabel}
                      selfUpdate={versionControl.selfUpdate}
                      desktopAppUpdate={versionControl.desktopAppUpdate}
                      threadContinuation={versionControl.threadContinuation}
                      targetVersion={versionControl.targetVersion}
                      label={versionControl.label}
                    />
                  ) : versionControl?.kind === "up-to-date" ? (
                    <span className="text-xs text-muted-foreground">{versionControl.text}</span>
                  ) : undefined
                }
              />
            ) : null}
            {canManageLocalBackend && desktopBridge ? (
              <>
                {renderNetworkAccessRow(networkAccessRowModel)}
                {renderEndpointRows("endpoint-rail")}
                {renderTailscaleRow()}
                {renderWslRow()}
                <CloudLinkRow canManageRelay={canManageRelay} />
              </>
            ) : canManageLocalBackend ? (
              <>
                {renderNetworkAccessRow(networkAccessRowModel)}
                <CloudLinkRow canManageRelay={canManageRelay} />
              </>
            ) : null}
          </SettingsSection>

          {endpointSelection.remotelyReachable ? (
            <FoldedSettingsSection
              id="authorized-clients"
              title="Authorized clients"
              summary={summarizeAuthorizedClients(desktopClientSessions, desktopPairingLinks)}
              control={
                <AuthorizedClientsHeaderAction
                  onPairingLinkCreated={handlePairingLinkCreated}
                  clientSessions={desktopClientSessions}
                  isRevokingOtherClients={isRevokingOtherDesktopClients}
                  onRevokeOtherClients={handleRevokeOtherDesktopClients}
                />
              }
            >
              <ScrollArea
                scrollFade
                chainVerticalScroll
                className="max-h-[22.5rem]"
                data-testid="authorized-clients-scroll-area"
              >
                {renderAuthorizedClients("current")}
              </ScrollArea>
            </FoldedSettingsSection>
          ) : null}
          <AlertDialog
            open={networkExposureDialogModel.open}
            onOpenChange={(open) => {
              if (isUpdatingDesktopServerExposure) return;
              setIsDesktopServerExposureDialogOpen(open);
            }}
            onOpenChangeComplete={(open) => {
              if (!open) setPendingDesktopServerExposureMode(null);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>{networkExposureDialogModel.title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {networkExposureDialogModel.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose
                  disabled={networkExposureDialogModel.cancel.disabled}
                  render={
                    <Button
                      variant="outline"
                      disabled={networkExposureDialogModel.cancel.disabled}
                    />
                  }
                >
                  <span className="[text-box:trim-both_cap_alphabetic]">
                    {networkExposureDialogModel.cancel.label}
                  </span>
                </AlertDialogClose>
                <Button
                  variant={networkExposureDialogModel.confirmVariant}
                  onClick={handleConfirmDesktopServerExposureChange}
                  disabled={networkExposureDialogModel.confirm.disabled}
                >
                  {networkExposureDialogModel.confirm.busy && <Spinner size="sm" />}
                  <span className="[text-box:trim-both_cap_alphabetic]">
                    {networkExposureDialogModel.confirm.label}
                  </span>
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
          <AlertDialog
            open={wslConfirmDialogModel.open}
            onOpenChange={(open) => {
              if (isUpdatingWslBackend) return;
              if (!open) setPendingWslChange(null);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>{wslConfirmDialogModel.title}</AlertDialogTitle>
                <AlertDialogDescription>{wslConfirmDialogModel.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose
                  disabled={wslConfirmDialogModel.cancel.disabled}
                  render={
                    <Button variant="outline" disabled={wslConfirmDialogModel.cancel.disabled} />
                  }
                >
                  {wslConfirmDialogModel.cancel.label}
                </AlertDialogClose>
                {wslConfirmDialogModel.actions.map((action) => (
                  <Button
                    key={action.id}
                    variant={action.variant}
                    onClick={() => handleWslConfirmAction(action.id)}
                    disabled={action.disabled}
                  >
                    {action.busy ? (
                      <>
                        <Spinner size="sm" />
                        {action.label}
                      </>
                    ) : (
                      action.label
                    )}
                  </Button>
                ))}
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
          <AlertDialog
            open={tailscaleDisableDialogModel.open}
            onOpenChange={(open) => {
              if (isUpdatingTailscaleServe) return;
              setDisableTailscaleServeDialogOpen(open);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>{tailscaleDisableDialogModel.title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tailscaleDisableDialogModel.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose
                  disabled={tailscaleDisableDialogModel.cancel.disabled}
                  render={
                    <Button
                      variant="outline"
                      disabled={tailscaleDisableDialogModel.cancel.disabled}
                    />
                  }
                >
                  {tailscaleDisableDialogModel.cancel.label}
                </AlertDialogClose>
                <Button
                  variant={tailscaleDisableDialogModel.confirmVariant}
                  onClick={() => void handleConfirmTailscaleServeDisable()}
                  disabled={tailscaleDisableDialogModel.confirm.disabled}
                >
                  {tailscaleDisableDialogModel.confirm.busy ? (
                    <>
                      <Spinner size="sm" />
                      {tailscaleDisableDialogModel.confirm.label}
                    </>
                  ) : (
                    tailscaleDisableDialogModel.confirm.label
                  )}
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
          <Dialog
            open={tailscaleSetupDialogModel.open}
            onOpenChange={(open) => {
              if (isUpdatingTailscaleServe) return;
              if (!open) setPendingTailscaleServeEndpoint(null);
            }}
          >
            <DialogPopup className="max-w-md">
              <DialogHeader>
                <DialogTitle>{tailscaleSetupDialogModel.title}</DialogTitle>
                <DialogDescription>{tailscaleSetupDialogModel.description}</DialogDescription>
              </DialogHeader>
              <DialogPanel>
                <label className="block">
                  <span className="text-sm font-medium text-foreground">
                    {tailscaleSetupDialogModel.portLabel}
                  </span>
                  <Input
                    className="mt-2"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65_535}
                    step={1}
                    value={tailscaleSetupDialogModel.portValue}
                    onChange={(event) => setTailscaleServePortInput(event.target.value)}
                    disabled={tailscaleSetupDialogModel.portDisabled}
                  />
                </label>
                {tailscaleSetupDialogModel.validationMessage ? (
                  <p className="mt-2 text-xs text-destructive">
                    {tailscaleSetupDialogModel.validationMessage}
                  </p>
                ) : null}
                <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {tailscaleSetupDialogModel.endpointLabel}
                  </p>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <p className="mt-1 truncate text-sm text-foreground">
                          {tailscaleSetupDialogModel.baseUrlText}
                        </p>
                      }
                    />
                    {tailscaleSetupDialogModel.baseUrl ? (
                      <TooltipPopup side="top">{tailscaleSetupDialogModel.baseUrl}</TooltipPopup>
                    ) : null}
                  </Tooltip>
                </div>
              </DialogPanel>
              <DialogFooter>
                <DialogClose
                  disabled={tailscaleSetupDialogModel.cancel.disabled}
                  render={
                    <Button
                      variant="outline"
                      disabled={tailscaleSetupDialogModel.cancel.disabled}
                    />
                  }
                >
                  {tailscaleSetupDialogModel.cancel.label}
                </DialogClose>
                <Button
                  onClick={() => void handleConfirmTailscaleServeSetup()}
                  disabled={tailscaleSetupDialogModel.confirm.disabled}
                >
                  {tailscaleSetupDialogModel.confirm.busy ? (
                    <>
                      <Spinner size="sm" />
                      {tailscaleSetupDialogModel.confirm.label}
                    </>
                  ) : (
                    tailscaleSetupDialogModel.confirm.label
                  )}
                </Button>
              </DialogFooter>
            </DialogPopup>
          </Dialog>
        </>
      ) : (
        <SettingsSection
          id={CONNECTIONS_ENVIRONMENT_SETTING.id}
          title={CONNECTIONS_ENVIRONMENT_SETTING.title}
        >
          <SettingsRow
            title={ADMINISTRATIVE_ACCESS_ROW.title}
            description={ADMINISTRATIVE_ACCESS_ROW.description}
          />
          <CloudLinkRow canManageRelay={canManageRelay} />
        </SettingsSection>
      )}
    </>
  );

  return (
    <SettingsPageContainer width="wide">
      {primarySettings}
      <SettingsSection
        id={REMOTE_ENVIRONMENTS_SETTING.id}
        title={REMOTE_ENVIRONMENTS_TITLE}
        headerAction={
          <div className="flex items-center gap-1">
            {savedServerUpdateTargets.length > 0 ? (
              <ServerUpdatesAction targets={savedServerUpdateTargets} variant="ghost-muted" />
            ) : null}
            <Dialog
              open={addBackendDialogOpen}
              onOpenChange={(open) => {
                setAddBackendDialogOpen(open);
                if (!open) {
                  setSavedBackendError(null);
                }
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DialogTrigger
                      render={
                        <Button
                          size="xs"
                          variant="ghost-muted"
                          aria-label={addEnvironmentModel.triggerLabel}
                        >
                          <PlusIcon className="size-3" />
                          <span>{addEnvironmentModel.triggerLabel}</span>
                        </Button>
                      }
                    />
                  }
                />
                <TooltipPopup side="top">{addEnvironmentModel.triggerLabel}</TooltipPopup>
              </Tooltip>
              <DialogPopup className="max-h-[80dvh] sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>{addEnvironmentModel.title}</DialogTitle>
                  <DialogDescription>{addEnvironmentModel.description}</DialogDescription>
                </DialogHeader>
                <DialogPanel>
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {addEnvironmentModel.modeCards.map(renderConnectionModeCard)}
                    </div>
                    <AnimatedHeight>
                      {addEnvironmentModel.mode === "ssh"
                        ? renderSshFields()
                        : renderRemoteModeBody()}
                    </AnimatedHeight>
                  </div>
                </DialogPanel>
              </DialogPopup>
            </Dialog>
          </div>
        }
      >
        {listedEnvironments.map((environment) => (
          <SavedBackendListRow
            key={environment.environmentId}
            environment={environment}
            removingEnvironmentId={removingSavedEnvironmentId}
            onSetEnabled={handleSetSavedBackendEnabled}
            onRemove={handleRemoveSavedBackend}
          />
        ))}
        <CloudRemoteEnvironmentRows
          primaryEnvironmentId={primaryEnvironmentId}
          savedEnvironments={savedEnvironments}
        />
      </SettingsSection>
      {hasCloudPublicConfig() ? (
        <RemoveT3ConnectEnvironmentDialog
          environmentLabel={pendingT3ConnectRemoval?.label ?? null}
          onCancel={() => setPendingT3ConnectRemoval(null)}
          onConfirm={() => {
            if (!pendingT3ConnectRemoval) return;
            setPendingT3ConnectRemoval(null);
            void removeSavedBackend(pendingT3ConnectRemoval);
          }}
        />
      ) : null}
      <LoadBalancingSettings environments={loadBalancingEnvironments} />
      <GitHubRoutingSettings environments={loadBalancingEnvironments} />
    </SettingsPageContainer>
  );
}
