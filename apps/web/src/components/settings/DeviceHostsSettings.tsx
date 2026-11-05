import { DeviceToolVersions } from "../device/DeviceToolVersions";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { AppleIcon, AndroidIcon } from "../Icons";
import { Spinner } from "../ui/spinner";
import type { EnvironmentId, SshDeviceHostConfig } from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";
import { useState } from "react";
import { deviceEnvironment, useDeviceState } from "../../state/device";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { MoreVertical, PlusIcon } from "lucide-react";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import { SettingsRow } from "./settingsLayout";

import { useSettingsScope } from "./SettingsScopeContext";
import { toastManager } from "../ui/toast";
import {
  buildDeviceHostListModel,
  buildDeviceHostsSettingsModel,
  canSaveDeviceHosts,
  deviceHostTestToast,
  deviceHostsSaveFailureToast,
  newDeviceHostDraft,
  updateDeviceHosts,
  type DeviceHostChecks,
} from "./deviceHostsSettings.logic";
import { DeviceHostEditor } from "./DeviceHostEditor";
import { useHostConnectionChecks } from "./useHostConnectionChecks";

export function DeviceHostsSettings(props: { environmentId: EnvironmentId | null }) {
  const { scope, environments, connectedEnvironments } = useSettingsScope();
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [editing, setEditing] = useState<SshDeviceHostConfig | null>(null);
  const [originalHost, setOriginalHost] = useState<SshDeviceHostConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    connected: environment.connection.phase === "connected",
  }));
  const { checks, testConnection } = useHostConnectionChecks(targets);
  const model = buildDeviceHostsSettingsModel({
    environmentId: props.environmentId,
    projectScope,
    busy,
    editing: editing !== null,
    connectedEnvironments,
  });
  const save = async (host: SshDeviceHostConfig, remove = false, original = host) => {
    if (!canSaveDeviceHosts({ environmentId: props.environmentId, projectScope })) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        environments.map(async (environment) => {
          if (environment.connection.phase !== "connected" || !environment.serverConfig) {
            throw new Error("Environment disconnected");
          }
          return update({
            environmentId: environment.environmentId,
            input: {
              patch: {
                deviceHosts: updateDeviceHosts(
                  environment.serverConfig.settings.deviceHosts,
                  host,
                  remove,
                  original,
                ),
              },
            },
          });
        }),
      );
      const failed = environments.filter((_, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value._tag === "Failure";
      });
      if (failed.length === 0) {
        setEditing(null);
      } else {
        toastManager.add(
          deviceHostsSaveFailureToast(failed.map((environment) => environment.label)),
        );
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsRow
      id={model.id}
      title={model.title}
      serverScoped
      settingKeys={model.settingKeys}
      description={model.description}
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={model.addButton.disabled}
          onClick={() => {
            setOriginalHost(null);
            setEditing(newDeviceHostDraft(randomUUID()));
          }}
        >
          <PlusIcon className="size-3.5" /> {model.addButton.label}
        </Button>
      }
    >
      <div className="pt-3 pb-2">
        {model.unavailableMessage !== null ? (
          <p className="text-sm text-muted-foreground">{model.unavailableMessage}</p>
        ) : (
          <>
            {connectedEnvironments.map((environment, index) => (
              <div key={environment.environmentId}>
                {model.groups[index]?.heading ? (
                  <p className="pt-3 pb-1 text-xs font-medium text-muted-foreground">
                    {model.groups[index]?.heading}
                  </p>
                ) : null}
                <DeviceHostList
                  environmentLabel={environment.label}
                  environmentId={environment.environmentId}
                  hosts={environment.serverConfig?.settings.deviceHosts ?? []}
                  busy={model.listBusy}
                  checks={checks}
                  testConnection={async (host) => {
                    const results = await testConnection(host);
                    if (!results) return;
                    toastManager.add(
                      deviceHostTestToast({ hostLabel: host.label, targets, results }),
                    );
                    return results;
                  }}
                  onEdit={(host) => {
                    setOriginalHost(host);
                    setEditing(host);
                  }}
                  onRemove={(host) => void save(host, true)}
                />
              </div>
            ))}
            {editing ? (
              <DeviceHostEditor
                key={editing.id}
                host={editing}
                isNew={originalHost === null}
                targets={targets}
                busy={busy}
                onSave={(host) => void save(host, false, originalHost ?? host)}
                onClose={() => setEditing(null)}
              />
            ) : null}
          </>
        )}
      </div>
    </SettingsRow>
  );
}

function DeviceHostList({
  environmentLabel,
  environmentId,
  hosts,
  busy,
  onEdit,
  onRemove,
  checks,
  testConnection,
}: {
  environmentLabel: string;
  environmentId: EnvironmentId;
  hosts: ReadonlyArray<SshDeviceHostConfig>;
  busy: boolean;
  onEdit: (host: SshDeviceHostConfig) => void;
  onRemove: (host: SshDeviceHostConfig) => void;
  checks: DeviceHostChecks;
  testConnection: (host: SshDeviceHostConfig) => Promise<unknown>;
}) {
  const { state } = useDeviceState(environmentId);
  const retry = useAtomCommand(deviceEnvironment.list);
  const [retrying, setRetrying] = useState<string | null>(null);
  const model = buildDeviceHostListModel({
    environmentId,
    hosts,
    busy,
    deviceState: state,
    checks,
    retryingHostId: retrying,
  });
  return (
    <>
      {model.emptyMessage !== null ? (
        <p className="py-2 text-sm text-muted-foreground">{model.emptyMessage}</p>
      ) : null}
      {hosts.map((host, index) => {
        const row = model.hosts[index];
        if (!row) return null;
        return (
          <div key={host.id} className="flex items-center gap-2 border-t border-border/50 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{row.label}</p>
                {row.platformBadges.map((badge) => (
                  <Tooltip key={badge.platform}>
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          role="img"
                          aria-label={badge.label}
                          className="shrink-0 text-muted-foreground"
                        />
                      }
                    >
                      {badge.icon === "apple" ? (
                        <AppleIcon className="size-3.5" />
                      ) : (
                        <AndroidIcon className="size-3.5" />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup>{badge.label}</TooltipPopup>
                  </Tooltip>
                ))}
              </div>
              <p className="truncate text-xs text-muted-foreground">{row.target}</p>
              <DeviceToolVersions
                owner={environmentLabel}
                error={row.toolInspectionError ?? undefined}
                tools={row.tools ?? undefined}
              />
              {row.localNotice !== null ? (
                <p className="mt-1 text-xs text-muted-foreground">{row.localNotice}</p>
              ) : null}
              {row.error ? (
                <div className="mt-1" role="status">
                  <details className="text-xs text-destructive">
                    <summary>{row.error.summary}</summary>
                    <p className="mt-1 whitespace-pre-wrap break-words">{row.error.detail}</p>
                  </details>
                </div>
              ) : null}
            </div>
            {row.progress ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Spinner size="xs" />
                {row.progress}
              </span>
            ) : null}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost-muted"
                    disabled={row.menu.disabled}
                    aria-label={row.menu.ariaLabel}
                  />
                }
              >
                <MoreVertical />
              </MenuTrigger>
              <MenuPopup align="end">
                {row.menu.items.map((item) => (
                  <MenuItem
                    key={item.action}
                    {...(item.destructive ? { variant: "destructive" as const } : {})}
                    onClick={() => {
                      if (item.action === "edit") onEdit(host);
                      else onRemove(host);
                    }}
                  >
                    {item.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            {row.action.kind === "retry" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={row.action.disabled}
                onClick={() => {
                  setRetrying(host.id);
                  void retry({ environmentId, input: { retryHostId: host.id } }).finally(() =>
                    setRetrying(null),
                  );
                }}
              >
                {row.action.label}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={row.action.disabled}
                onClick={() => void testConnection(host)}
              >
                {row.action.label}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
