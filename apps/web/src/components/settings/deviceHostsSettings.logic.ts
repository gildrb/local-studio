import type {
  DevicePlatform,
  DevicePlatformAvailability,
  DeviceServiceState,
  DeviceToolVersions,
  EnvironmentId,
  SshDeviceHostConfig,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  deviceHostConnectionKey,
  parseDeviceHostDraft,
  type DeviceHostCheck,
  type DeviceHostCheckTarget,
} from "./deviceHostConnectionChecks";

/** Apply one host change without replacing another environment's host list. */
export function updateDeviceHosts(
  hosts: ReadonlyArray<SshDeviceHostConfig>,
  host: SshDeviceHostConfig,
  remove: boolean,
  original = host,
): ReadonlyArray<SshDeviceHostConfig> {
  const sameDestination = (candidate: SshDeviceHostConfig, other: SshDeviceHostConfig) =>
    candidate.target === other.target &&
    candidate.port === other.port &&
    candidate.identityFile === other.identityFile;
  const findDestination = (destination: SshDeviceHostConfig) => {
    const matches = hosts.filter((candidate) => sameDestination(candidate, destination));
    if (matches.length > 1) {
      throw new Error(
        "Multiple hosts match this SSH destination. Select the environment to edit its hosts.",
      );
    }
    return matches[0];
  };
  // A retry can encounter the updated destination on an environment that
  // already saved, including one with a different environment-local host ID.
  const existing =
    hosts.find((candidate) => candidate.id === original.id) ??
    findDestination(original) ??
    (remove ? undefined : findDestination(host));
  if (remove) return hosts.filter((candidate) => candidate.id !== existing?.id);
  return existing
    ? hosts.map((candidate) =>
        candidate.id === existing.id ? { ...host, id: existing.id } : candidate,
      )
    : [...hosts, host];
}

export type DeviceHostChecks = Readonly<Record<string, Readonly<Record<string, DeviceHostCheck>>>>;

export type DeviceHostsToast = {
  readonly type: "error" | "success";
  readonly title: string;
  readonly description: string;
};

export type DeviceHostsEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
};

export type DeviceHostsSettingsModelInput = {
  readonly environmentId: EnvironmentId | null;
  readonly projectScope: boolean;
  readonly busy: boolean;
  readonly editing: boolean;
  readonly connectedEnvironments: ReadonlyArray<DeviceHostsEnvironment>;
};

export type DeviceHostsGroupModel = {
  readonly environmentId: EnvironmentId;
  readonly heading: string | null;
};

export type DeviceHostsSettingsModel = {
  readonly id: "device-hosts";
  readonly title: string;
  readonly description: string;
  readonly settingKeys: ReadonlyArray<"deviceHosts">;
  readonly addButton: {
    readonly label: string;
    readonly icon: "plus";
    readonly disabled: boolean;
  };
  readonly unavailableMessage: string | null;
  readonly groups: ReadonlyArray<DeviceHostsGroupModel>;
  readonly listBusy: boolean;
};

export function buildDeviceHostsSettingsModel(
  input: DeviceHostsSettingsModelInput,
): DeviceHostsSettingsModel {
  return {
    id: "device-hosts",
    title: "Device hosts",
    description:
      "Add remote machines with simulator or emulator runtimes installed, and the selected environments will connect over SSH and set up device tools automatically.",
    settingKeys: ["deviceHosts"],
    addButton: {
      label: "Add host",
      icon: "plus",
      disabled: input.projectScope || input.busy || !input.environmentId || input.editing,
    },
    unavailableMessage: input.environmentId
      ? null
      : "Connect a selected environment to manage device hosts.",
    groups: input.connectedEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      heading: input.connectedEnvironments.length > 1 ? environment.label : null,
    })),
    listBusy: input.projectScope || input.busy,
  };
}

export function canSaveDeviceHosts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectScope: boolean;
}): boolean {
  return input.environmentId !== null && !input.projectScope;
}

export function newDeviceHostDraft(id: string): SshDeviceHostConfig {
  return { id, label: "", target: "" };
}

export function deviceHostsSaveFailureToast(failedLabels: ReadonlyArray<string>): DeviceHostsToast {
  return {
    type: "error",
    title: "Device hosts not saved on all environments",
    description: `Could not update ${failedLabels.join(", ")}.`,
  };
}

export function deviceHostTestToast(input: {
  readonly hostLabel: string;
  readonly targets: ReadonlyArray<DeviceHostCheckTarget>;
  readonly results: Readonly<Record<string, DeviceHostCheck>>;
}): DeviceHostsToast {
  const failed = input.targets.filter(
    (target) => input.results[target.environmentId]?.status === "failed",
  );
  return {
    type: failed.length ? "error" : "success",
    title: failed.length
      ? `${input.hostLabel}: ${failed.length} of ${input.targets.length} environments failed`
      : `${input.hostLabel}: connection checks passed`,
    description: failed.length
      ? `Could not connect from ${failed.map((target) => target.label).join(", ")}.`
      : "Connected or already available locally on each selected environment.",
  };
}

export type DeviceHostListModelInput = {
  readonly environmentId: EnvironmentId;
  readonly hosts: ReadonlyArray<SshDeviceHostConfig>;
  readonly busy: boolean;
  readonly deviceState: Pick<
    DeviceServiceState,
    "hosts" | "hostStatus" | "hostStatuses" | "supportsHostRetry"
  >;
  readonly checks: DeviceHostChecks;
  readonly retryingHostId: string | null;
};

export type DeviceHostPlatformBadgeModel = {
  readonly platform: DevicePlatform;
  readonly icon: "apple" | "android";
  readonly label: string;
};

export type DeviceHostMenuItemModel = {
  readonly action: "edit" | "remove";
  readonly label: string;
  readonly destructive: boolean;
};

export type DeviceHostRowActionModel = {
  readonly kind: "retry" | "test";
  readonly label: string;
  readonly disabled: boolean;
};

export type DeviceHostRowModel = {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly platformBadges: ReadonlyArray<DeviceHostPlatformBadgeModel>;
  readonly tools: DeviceToolVersions | null;
  readonly toolInspectionError: string | null;
  readonly localNotice: string | null;
  readonly error: { readonly summary: string; readonly detail: string } | null;
  readonly progress: string | null;
  readonly menu: {
    readonly ariaLabel: string;
    readonly disabled: boolean;
    readonly items: ReadonlyArray<DeviceHostMenuItemModel>;
  };
  readonly action: DeviceHostRowActionModel;
};

export type DeviceHostListModel = {
  readonly emptyMessage: string | null;
  readonly hosts: ReadonlyArray<DeviceHostRowModel>;
};

export function buildDeviceHostListModel(input: DeviceHostListModelInput): DeviceHostListModel {
  const { deviceState } = input;
  return {
    emptyMessage: input.hosts.length === 0 ? "No device hosts." : null,
    hosts: input.hosts.map((host) => {
      const status = deviceState.hostStatuses[host.id];
      const check = input.checks[deviceHostConnectionKey(host)]?.[input.environmentId];
      const summary = deviceState.hosts.find((value) => value.id === host.id);
      const platforms =
        (check?.status === "connected" ? check.platforms : undefined) ?? summary?.platforms ?? [];
      const progress =
        check?.status === "pending"
          ? "Checking connection…"
          : status?.status === "installing"
            ? "Installing device support…"
            : status?.status === "starting"
              ? "Connecting…"
              : null;
      const error =
        check?.status === "failed"
          ? check.error
          : check?.status === "local"
            ? undefined
            : status?.status === "failed"
              ? status.detail
              : undefined;
      const canRetry =
        status?.status === "failed" &&
        deviceState.supportsHostRetry === true &&
        deviceState.hostStatus !== "disabled";
      return {
        id: host.id,
        label: host.label,
        target: host.target,
        platformBadges: platforms
          .filter((platform) => platform.available)
          .map((platform) => ({
            platform: platform.platform,
            icon: platform.platform === "ios" ? "apple" : "android",
            label: platform.platform === "ios" ? "iOS available" : "Android available",
          })),
        tools: summary?.tools ?? (check?.status === "connected" ? check.tools : undefined) ?? null,
        toolInspectionError: summary?.toolInspectionError ?? null,
        localNotice: check?.status === "local" ? "Already available locally" : null,
        error: error ? { summary: "Connection failed", detail: error } : null,
        progress,
        menu: {
          ariaLabel: host.label + " options",
          disabled: input.busy,
          items: [
            { action: "edit", label: "Edit", destructive: false },
            { action: "remove", label: "Remove", destructive: true },
          ],
        },
        action: canRetry
          ? {
              kind: "retry",
              label: input.retryingHostId === host.id ? "Retrying…" : "Retry",
              disabled: input.busy || input.retryingHostId !== null,
            }
          : {
              kind: "test",
              label: "Test connection",
              disabled: input.busy || progress !== null,
            },
      };
    }),
  };
}

export type DeviceHostEditorModelInput = {
  readonly host: SshDeviceHostConfig;
  readonly draft: SshDeviceHostConfig;
  readonly isNew: boolean;
  readonly targets: ReadonlyArray<DeviceHostCheckTarget>;
  readonly busy: boolean;
  readonly checks: DeviceHostChecks;
};

export type DeviceHostDraftField = "label" | "target" | "identityFile" | "port";

export type DeviceHostEditorFieldModel = {
  readonly id: DeviceHostDraftField;
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly inputType: "text" | "number";
  readonly min: number | null;
  readonly max: number | null;
};

export type DeviceHostEditorResultModel = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: DeviceHostCheck["status"];
  readonly statusLabel: string;
  readonly icon: "spinner" | "monitor" | "x" | "check";
  readonly platforms: ReadonlyArray<DevicePlatformAvailability> | null;
  readonly error: { readonly summary: string; readonly detail: string } | null;
};

export type DeviceHostEditorModel = {
  readonly title: string;
  readonly description: string;
  readonly closeable: boolean;
  readonly fields: {
    readonly label: DeviceHostEditorFieldModel;
    readonly target: DeviceHostEditorFieldModel;
    readonly identityFile: DeviceHostEditorFieldModel;
    readonly port: DeviceHostEditorFieldModel;
  };
  readonly sshOptions: {
    readonly summary: string;
    readonly open: boolean;
    readonly hint: string;
  };
  readonly connection: {
    readonly status: string;
    readonly checking: boolean;
    readonly testButton: { readonly label: string; readonly disabled: boolean };
    readonly results: ReadonlyArray<DeviceHostEditorResultModel> | null;
  };
  readonly cancel: { readonly label: string; readonly disabled: boolean };
  readonly save: { readonly label: string; readonly disabled: boolean; readonly busy: boolean };
};

function parseDeviceHostEditorDraft(draft: SshDeviceHostConfig) {
  return parseDeviceHostDraft({ ...draft, label: draft.label.trim() || draft.target });
}

function deviceHostEditorChecking(input: DeviceHostEditorModelInput): boolean {
  const results = input.checks[deviceHostConnectionKey(input.draft)];
  return Object.values(results ?? {}).some((check) => check.status === "pending");
}

const editorResultStatus = (
  check: DeviceHostCheck,
): Pick<DeviceHostEditorResultModel, "statusLabel" | "icon"> => {
  if (check.status === "pending") return { statusLabel: "Checking…", icon: "spinner" };
  if (check.status === "local")
    return { statusLabel: "Already available locally", icon: "monitor" };
  if (check.status === "failed") return { statusLabel: "Failed", icon: "x" };
  return { statusLabel: "Connected", icon: "check" };
};

export function buildDeviceHostEditorModel(
  input: DeviceHostEditorModelInput,
): DeviceHostEditorModel {
  const { draft, busy, targets } = input;
  const results = input.checks[deviceHostConnectionKey(draft)];
  const checking = deviceHostEditorChecking(input);
  const valid = Option.isSome(parseDeviceHostEditorDraft(draft));
  const failed = Object.values(results ?? {}).filter((check) => check.status === "failed").length;
  const field = (
    id: DeviceHostDraftField,
    label: string,
    value: string,
    placeholder: string,
    required: boolean,
  ): DeviceHostEditorFieldModel => ({
    id,
    label,
    value,
    placeholder,
    required,
    disabled: busy,
    inputType: id === "port" ? "number" : "text",
    min: id === "port" ? 1 : null,
    max: id === "port" ? 65535 : null,
  });
  return {
    title: input.isNew ? "Add device host" : "Edit device host",
    description: `${
      targets.length === 1
        ? `Connect from ${targets[0]?.label}.`
        : `Connect from ${targets.length} selected environments.`
    } Hosts on the same machine are skipped.`,
    closeable: !busy,
    fields: {
      label: field("label", "Name", draft.label, "Mac mini", true),
      target: field("target", "SSH target", draft.target, "user@host or SSH alias", true),
      identityFile: field(
        "identityFile",
        "Identity file",
        draft.identityFile ?? "",
        "SSH config default",
        false,
      ),
      port: field(
        "port",
        "Port",
        draft.port === undefined ? "" : String(draft.port),
        "Default",
        false,
      ),
    },
    sshOptions: {
      summary: "SSH options",
      open: input.host.port !== undefined || input.host.identityFile !== undefined,
      hint: "Optional. Resolved separately on each environment.",
    },
    connection: {
      status: checking
        ? "Checking environments…"
        : results
          ? failed
            ? `${failed} of ${targets.length} failed`
            : "Connection checks passed"
          : "Check access before saving",
      checking,
      testButton: { label: "Test connection", disabled: busy || checking || !valid },
      results: results
        ? targets.flatMap((target) => {
            const result = results[target.environmentId];
            if (!result) return [];
            return [
              {
                environmentId: target.environmentId,
                label: target.label,
                status: result.status,
                ...editorResultStatus(result),
                platforms: result.status === "connected" ? result.platforms : null,
                error:
                  result.status === "failed"
                    ? { summary: "Show error", detail: result.error }
                    : null,
              },
            ];
          })
        : null,
    },
    cancel: { label: "Cancel", disabled: busy },
    save: {
      label: "Save host",
      disabled: busy || checking || !valid || !draft.label.trim(),
      busy,
    },
  };
}

export function resolveDeviceHostDraftChange(
  draft: SshDeviceHostConfig,
  field: DeviceHostDraftField,
  value: string,
): SshDeviceHostConfig {
  if (field === "label") return { ...draft, label: value };
  if (field === "target") return { ...draft, target: value };
  if (field === "identityFile") {
    const { identityFile: _, ...rest } = draft;
    return value ? { ...rest, identityFile: value } : rest;
  }
  const { port: _, ...rest } = draft;
  return value ? { ...rest, port: Number(value) } : rest;
}

export type DeviceHostEditorSubmitDecision =
  | { readonly kind: "save"; readonly host: SshDeviceHostConfig }
  | { readonly kind: "ignore" };

export function resolveDeviceHostEditorSubmit(
  input: DeviceHostEditorModelInput,
): DeviceHostEditorSubmitDecision {
  const parsed = parseDeviceHostEditorDraft(input.draft);
  if (
    Option.isSome(parsed) &&
    input.draft.label.trim() &&
    !input.busy &&
    !deviceHostEditorChecking(input)
  ) {
    return { kind: "save", host: parsed.value };
  }
  return { kind: "ignore" };
}

export function resolveDeviceHostEditorTest(
  draft: SshDeviceHostConfig,
): SshDeviceHostConfig | null {
  return Option.getOrNull(parseDeviceHostEditorDraft(draft));
}
