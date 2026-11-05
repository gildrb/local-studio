import type { DeviceToolVersions } from "@t3tools/contracts";

export type DeviceToolVersionsRowModel = {
  readonly name: string | null;
  readonly running: string;
  readonly required: string;
  readonly installed: string;
};

export type DeviceToolVersionsModel = {
  readonly triggerLabel: string;
  readonly ariaLabel: string | null;
  readonly title: string;
  readonly rows: ReadonlyArray<DeviceToolVersionsRowModel> | null;
  readonly emptyMessage: string;
  readonly footer: string;
  readonly error: string | null;
};

export function buildDeviceToolVersionsModel(input: {
  readonly tools: DeviceToolVersions | undefined;
  readonly kind?: keyof DeviceToolVersions | undefined;
  readonly owner?: string | undefined;
  readonly error?: string | undefined;
}): DeviceToolVersionsModel {
  const { tools, kind, owner, error } = input;
  const selected = kind ? tools?.[kind] : undefined;
  const version =
    selected?.runningVersion ??
    (selected?.installedVersions.includes(selected.requiredVersion)
      ? selected.requiredVersion
      : selected?.installedVersions
          .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1));
  const label = kind === "hub" ? "Device hub" : "Agent device";
  return {
    triggerLabel: kind
      ? version
        ? `v${version}`
        : selected
          ? "Not installed"
          : "Version unknown"
      : error
        ? "Versions unavailable"
        : "Versions",
    ariaLabel: kind
      ? `${label}: ${version ? `version ${version}` : selected ? "not installed" : "version unknown"}. Show details`
      : null,
    title: kind ? label : "Device tools",
    rows: tools
      ? (
          [
            ["Device hub", tools.hub],
            ["Agent device", tools.agent],
          ] as const
        )
          .filter(([name]) => !kind || name === label)
          .map(([name, tool]) => ({
            name: kind ? null : name,
            running: tool.runningVersion ?? "Not running",
            required: tool.requiredVersion,
            installed: tool.installedVersions.join(", ") || "None",
          }))
      : null,
    emptyMessage: "Versions have not been checked.",
    footer: `${owner ? `Managed by ${owner}. ` : ""}Tools update automatically on this host when needed.`,
    error: error ?? null,
  };
}
