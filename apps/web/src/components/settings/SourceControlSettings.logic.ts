import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type {
  BackgroundActivityOverrides,
  BackgroundActivitySettings,
  EnvironmentId,
  ServerSettings,
  SourceControlDiscoveryResult,
  SourceControlProviderAuth,
  SourceControlProviderDiscoveryItem,
  SourceControlProviderKind,
  VcsDiscoveryItem,
  VcsDriverKind,
} from "@t3tools/contracts";
import {
  getBackgroundActivityBaseProfile,
  getBackgroundActivityPresetSettings,
  resolveServerBackgroundActivitySettings,
} from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import type { ScopedSettingsPatch } from "./scopedSettings";
import { searchableSetting } from "./settingsSearch";

export type SourceControlDiscoveryItem = VcsDiscoveryItem | SourceControlProviderDiscoveryItem;

export type SourceControlItemIcon = Exclude<SourceControlProviderKind | VcsDriverKind, "unknown">;

export type SourceControlStatusTone = "muted" | "warning" | "success";

export type SourceControlItemDetailsKind = "git-fetch-interval" | "bitbucket-credentials";

export type SourceControlItemDetails = {
  readonly kind: SourceControlItemDetailsKind;
  readonly searchTargetId: string;
};

export type SourceControlSectionKey = "version-control" | "providers";

export type SourceControlItemSummary =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "authenticated";
      readonly text: string;
      readonly accountPrefix: string;
      readonly account: string | null;
    }
  | {
      readonly kind: "cli-sign-in";
      readonly before: string;
      readonly executable: string;
      readonly after: string;
    };

export type SourceControlBadge = {
  readonly label: string;
  readonly variant: "warning";
};

export type SourceControlDiscoveryRowModel = {
  readonly id: string;
  readonly kind: SourceControlProviderKind | VcsDriverKind;
  readonly label: string;
  readonly version: string | null;
  readonly icon: SourceControlItemIcon | null;
  readonly statusTone: SourceControlStatusTone;
  readonly comingSoon: boolean;
  readonly badges: ReadonlyArray<SourceControlBadge>;
  readonly summary: SourceControlItemSummary;
  readonly enabled: boolean;
  readonly showAvailabilitySwitch: boolean;
  readonly availabilityAriaLabel: string;
  readonly toggleDetailsAriaLabel: string;
  readonly details: SourceControlItemDetails | null;
};

export type SourceControlDiscoverySectionModel = {
  readonly key: SourceControlSectionKey;
  readonly id: string | null;
  readonly title: string;
  readonly showScanButton: boolean;
  readonly rows: ReadonlyArray<SourceControlDiscoveryRowModel>;
};

export type SourceControlSkeletonSectionModel = {
  readonly key: SourceControlSectionKey;
  readonly title: string;
  readonly showScanButton: boolean;
  readonly rowKeys: ReadonlyArray<string>;
};

export type SourceControlEmptyDiscoveryModel = {
  readonly kind: "empty";
  readonly sectionId: string;
  readonly title: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly scanLabel: string;
  readonly scanDisabled: boolean;
  readonly scanning: boolean;
};

export type SourceControlDiscoveryViewModel =
  | {
      readonly kind: "disconnected";
      readonly sectionId: string;
      readonly title: string;
      readonly message: string;
    }
  | {
      readonly kind: "scanning";
      readonly sections: ReadonlyArray<SourceControlSkeletonSectionModel>;
    }
  | {
      readonly kind: "discovered";
      readonly sections: ReadonlyArray<SourceControlDiscoverySectionModel>;
    }
  | SourceControlEmptyDiscoveryModel;

export type SourceControlScanButtonModel = {
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly disabled: boolean;
  readonly refreshing: boolean;
};

export type SourceControlSettingsModel = {
  readonly environmentId: EnvironmentId | null;
  readonly scanButton: SourceControlScanButtonModel;
  readonly view: SourceControlDiscoveryViewModel;
};

export type SourceControlScopeEnvironment = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
};

export type SourceControlDiscoveryQueryState = {
  readonly data: SourceControlDiscoveryResult | null;
  readonly isPending: boolean;
  readonly error: string | null;
};

export type SourceControlSettingsModelInput = {
  readonly environment: SourceControlScopeEnvironment | null;
  readonly scopeEnvironmentCount: number;
  readonly connectedEnvironmentCount: number;
  readonly discovery: SourceControlDiscoveryQueryState;
};

export type GitFetchIntervalModel = {
  readonly id: string;
  readonly title: string;
  readonly policyTooltip: string;
  readonly description: string;
  readonly valueSeconds: number;
  readonly minSeconds: number;
  readonly stepSeconds: number;
  readonly canReset: boolean;
  readonly resetLabel: string;
  readonly unitLabel: string;
  readonly decrementAriaLabel: string;
  readonly inputAriaLabel: string;
  readonly incrementAriaLabel: string;
};

export type GitFetchIntervalModelInput = {
  readonly settings: ServerSettings;
};

export type SourceControlAccountRedactionModel = {
  readonly ariaLabel: string;
  readonly revealTooltip: string;
  readonly hideTooltip: string;
};

export const SOURCE_CONTROL_ACCOUNT_REDACTION: SourceControlAccountRedactionModel = {
  ariaLabel: "Toggle source control account visibility",
  revealTooltip: "Click to reveal account",
  hideTooltip: "Click to hide account",
};

const EMPTY_DISCOVERY_RESULT: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [],
};

const SOURCE_CONTROL_SKELETON_ROWS = ["primary", "secondary"] as const;
const GIT_FETCH_INTERVAL_STEP_SECONDS = 5;
const SERVER_ENVIRONMENT_TITLE = "Server environment";

function durationToSeconds(duration: Duration.Duration): number {
  return Math.round(Duration.toMillis(duration) / 1_000);
}

function normalizeFetchIntervalSeconds(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

function withGitFetchIntervalOverride(
  current: BackgroundActivitySettings,
  automaticGitFetchInterval: Duration.Duration | undefined,
): ScopedSettingsPatch {
  const { automaticGitFetchInterval: _previous, ...others } = current.overrides;
  const overrides: BackgroundActivityOverrides =
    automaticGitFetchInterval === undefined ? others : { ...others, automaticGitFetchInterval };
  return {
    backgroundActivity: {
      schemaVersion: 1,
      profile: "custom",
      baseProfile: getBackgroundActivityBaseProfile(current),
      overrides,
    },
  };
}

function isProviderDiscoveryItem(
  item: SourceControlDiscoveryItem,
): item is SourceControlProviderDiscoveryItem {
  return "auth" in item;
}

function isVcsNotReady(item: SourceControlDiscoveryItem): boolean {
  return !isProviderDiscoveryItem(item) && !item.implemented;
}

function authBadge(auth: SourceControlProviderAuth): SourceControlBadge | null {
  if (auth.status === "unauthenticated") {
    return { label: "Not authenticated", variant: "warning" };
  }
  return null;
}

function itemStatusTone(item: SourceControlDiscoveryItem): SourceControlStatusTone {
  if (isVcsNotReady(item)) return "muted";
  if (item.status !== "available") return "warning";
  if (isProviderDiscoveryItem(item) && item.auth.status !== "authenticated") return "warning";
  return "success";
}

function itemSummary(item: SourceControlDiscoveryItem): SourceControlItemSummary {
  if (isVcsNotReady(item)) {
    return { kind: "text", text: `Support for ${item.label} is coming soon.` };
  }

  if (item.status !== "available") {
    return { kind: "text", text: `Not available on this server: ${item.installHint}` };
  }

  if (!isProviderDiscoveryItem(item)) {
    return { kind: "text", text: "Available" };
  }

  const auth = item.auth;
  if (auth.status === "authenticated") {
    return {
      kind: "authenticated",
      text: "Authenticated",
      accountPrefix: "as",
      account: Option.getOrNull(auth.account),
    };
  }

  if (auth.status === "unauthenticated") {
    if (!item.executable) {
      return { kind: "text", text: `Available. ${item.installHint}` };
    }
    return {
      kind: "cli-sign-in",
      before: `${item.label} is not authenticated on this server. Sign in or configure credentials using the `,
      executable: item.executable,
      after: " tool on the server host to enable change request features.",
    };
  }

  return {
    kind: "text",
    text: `Could not verify ${item.label}. ${Option.getOrNull(auth.detail) ?? item.installHint}`,
  };
}

function itemDetailsKind(item: SourceControlDiscoveryItem): SourceControlItemDetailsKind | null {
  if (!isProviderDiscoveryItem(item)) {
    return item.kind === "git" ? "git-fetch-interval" : null;
  }
  return item.kind === "bitbucket" ? "bitbucket-credentials" : null;
}

function buildDiscoveryRow(item: SourceControlDiscoveryItem): SourceControlDiscoveryRowModel {
  const comingSoon = isVcsNotReady(item);
  const enabled = isProviderDiscoveryItem(item)
    ? item.status === "available" && item.auth.status === "authenticated"
    : item.status === "available" && item.implemented;
  const auth = isProviderDiscoveryItem(item) ? authBadge(item.auth) : null;
  const detailsKind = itemDetailsKind(item);
  return {
    id: isProviderDiscoveryItem(item) ? `provider:${item.kind}` : `vcs:${item.kind}`,
    kind: item.kind,
    label: item.label,
    version: Option.getOrNull(item.version),
    icon: item.kind === "unknown" ? null : item.kind,
    statusTone: itemStatusTone(item),
    comingSoon,
    badges: [
      ...(comingSoon ? [{ label: "Coming Soon", variant: "warning" as const }] : []),
      ...(auth ? [auth] : []),
    ],
    summary: itemSummary(item),
    enabled,
    showAvailabilitySwitch: !comingSoon,
    availabilityAriaLabel: `${item.label} availability`,
    toggleDetailsAriaLabel: `Toggle ${item.label} details`,
    details:
      detailsKind === null
        ? null
        : { kind: detailsKind, searchTargetId: searchableSetting(detailsKind).id },
  };
}

export function resolveSourceControlDiscoveryEnvironmentId(
  environment: SourceControlScopeEnvironment | null,
): EnvironmentId | null {
  return environment?.connection.phase === "connected" ? environment.environmentId : null;
}

export function shouldExpandSourceControlRowForSearchTarget(
  row: SourceControlDiscoveryRowModel,
  searchTargetId: string | null,
): boolean {
  return row.details !== null && searchTargetId === row.details.searchTargetId;
}

function buildDiscoveryView(
  input: SourceControlSettingsModelInput,
  environmentId: EnvironmentId | null,
): SourceControlDiscoveryViewModel {
  const sourceControlId = searchableSetting("source-control").id;
  if (environmentId === null) {
    return {
      kind: "disconnected",
      sectionId: sourceControlId,
      title: SERVER_ENVIRONMENT_TITLE,
      message:
        "Connect an environment to inspect its version control tools and hosting integrations.",
    };
  }

  const { discovery, environment } = input;
  const aggregate = input.scopeEnvironmentCount !== 1 && input.connectedEnvironmentCount > 1;
  const environmentSuffix = aggregate && environment ? ` · ${environment.label}` : "";
  const versionControlTitle = `Version Control${environmentSuffix}`;

  if (discovery.isPending && discovery.data === null) {
    return {
      kind: "scanning",
      sections: [
        {
          key: "version-control",
          title: versionControlTitle,
          showScanButton: true,
          rowKeys: SOURCE_CONTROL_SKELETON_ROWS,
        },
        {
          key: "providers",
          title: "Source Control Providers",
          showScanButton: false,
          rowKeys: SOURCE_CONTROL_SKELETON_ROWS,
        },
      ],
    };
  }

  const result = discovery.data ?? EMPTY_DISCOVERY_RESULT;
  const hasVersionControlSystems = result.versionControlSystems.length > 0;
  const hasProviders = result.sourceControlProviders.length > 0;

  if (!hasVersionControlSystems && !hasProviders) {
    const hasError = discovery.error !== null;
    return {
      kind: "empty",
      sectionId: sourceControlId,
      title: SERVER_ENVIRONMENT_TITLE,
      emptyTitle: hasError ? "Could not scan the server environment" : "Nothing detected yet",
      emptyDescription:
        discovery.error ??
        "Install Git on the server, add optional hosting integrations or credentials your workspace needs, then rescan.",
      scanLabel: "Scan",
      scanDisabled: discovery.isPending,
      scanning: discovery.isPending,
    };
  }

  const sections: SourceControlDiscoverySectionModel[] = [];
  if (hasVersionControlSystems) {
    sections.push({
      key: "version-control",
      id: sourceControlId,
      title: versionControlTitle,
      showScanButton: true,
      rows: result.versionControlSystems.map(buildDiscoveryRow),
    });
  }
  if (hasProviders) {
    sections.push({
      key: "providers",
      id: hasVersionControlSystems ? null : sourceControlId,
      title: hasVersionControlSystems
        ? "Source Control Providers"
        : `Source Control Providers${environmentSuffix}`,
      showScanButton: !hasVersionControlSystems,
      rows: result.sourceControlProviders.map(buildDiscoveryRow),
    });
  }
  return { kind: "discovered", sections };
}

export function buildSourceControlSettingsModel(
  input: SourceControlSettingsModelInput,
): SourceControlSettingsModel {
  const environmentId = resolveSourceControlDiscoveryEnvironmentId(input.environment);
  return {
    environmentId,
    scanButton: {
      ariaLabel: "Rescan server environment",
      tooltip: "Rescan Git and hosting integrations",
      disabled: input.discovery.isPending,
      refreshing: input.discovery.isPending,
    },
    view: buildDiscoveryView(input, environmentId),
  };
}

export function buildGitFetchIntervalModel(
  input: GitFetchIntervalModelInput,
): GitFetchIntervalModel {
  const { settings } = input;
  const valueSeconds = durationToSeconds(
    resolveServerBackgroundActivitySettings(settings).automaticGitFetchInterval,
  );
  const defaultSeconds = durationToSeconds(
    getBackgroundActivityPresetSettings(
      getBackgroundActivityBaseProfile(settings.backgroundActivity),
    ).automaticGitFetchInterval,
  );
  const setting = searchableSetting("git-fetch-interval");
  return {
    id: setting.id,
    title: setting.title,
    policyTooltip:
      "This interval is configured for Git only. The shared Background activity policy still decides whether Git refreshes may run when the timer fires. Custom intervals appear as Advanced in General settings.",
    description:
      "Refresh remote branches in the background. Set to 0 to avoid automatic Git prompts.",
    valueSeconds,
    minSeconds: 0,
    stepSeconds: GIT_FETCH_INTERVAL_STEP_SECONDS,
    canReset: valueSeconds !== defaultSeconds,
    resetLabel: "fetch interval",
    unitLabel: "seconds",
    decrementAriaLabel: "Decrease fetch interval",
    inputAriaLabel: "Automatic Git fetch interval in seconds",
    incrementAriaLabel: "Increase fetch interval",
  };
}

export function resolveGitFetchIntervalChange(
  backgroundActivity: BackgroundActivitySettings,
  seconds: number | null,
): ScopedSettingsPatch {
  return withGitFetchIntervalOverride(
    backgroundActivity,
    Duration.seconds(normalizeFetchIntervalSeconds(seconds)),
  );
}

export function resolveGitFetchIntervalReset(
  backgroundActivity: BackgroundActivitySettings,
): ScopedSettingsPatch {
  return withGitFetchIntervalOverride(backgroundActivity, undefined);
}
