import type {
  ContextMenuItem,
  EnvironmentId,
  PreviewSessionSnapshot,
  PullRequestState,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";

import type { DesktopPreviewOverlay } from "../previewState.logic";
import type { DeviceTabTarget, RightPanelKind, RightPanelSurface } from "../rightPanelStore";

export type RightPanelSurfaceActionKey =
  | "browser"
  | "terminal"
  | "files"
  | "diff"
  | "pullRequest"
  | "pullRequests"
  | "agents"
  | "device";

export type RightPanelSurfaceActionModel = {
  readonly key: RightPanelSurfaceActionKey;
  readonly label: string;
  readonly description: string | null;
  readonly shortcut: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly badgeCount: number;
};

export type RightPanelSurfaceAvailability = {
  readonly browserAvailable: boolean;
  readonly terminalAvailable: boolean;
  readonly diffAvailable: boolean;
  readonly filesAvailable: boolean;
  readonly pullRequestAvailable: boolean;
  readonly pullRequestsAvailable: boolean;
  readonly agentsAvailable: boolean;
  readonly deviceAvailable: boolean;
};

export type RightPanelBrowserProfile = {
  readonly id: string;
  readonly name: string;
};

export type RightPanelTabAudioState = "none" | "audible" | "muted";

export type RightPanelTabAudioModel = {
  readonly state: "audible" | "muted";
  readonly runtimeTabId: string;
  readonly toggleLabel: string;
  readonly tooltip: string;
  readonly nextMuted: boolean;
};

export type RightPanelPullRequestTabStatus = {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
};

export type RightPanelSurfaceIconModel =
  | {
      readonly kind: "preview";
      readonly url: string | null;
      readonly capturedFaviconUrl: string | null;
    }
  | { readonly kind: "diff" }
  | { readonly kind: "files" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "terminal" }
  | { readonly kind: "pull-request"; readonly status: RightPanelPullRequestTabStatus | null }
  | { readonly kind: "pull-requests" }
  | { readonly kind: "agents" }
  | { readonly kind: "device"; readonly platform: DeviceTabTarget["platform"] | null };

export type RightPanelTabModel = {
  readonly id: string;
  readonly kind: RightPanelKind;
  readonly title: string;
  readonly closeLabel: string;
  readonly tooltip: string;
  readonly active: boolean;
  readonly pending: boolean;
  readonly renamable: boolean;
  readonly icon: RightPanelSurfaceIconModel;
  readonly audio: RightPanelTabAudioModel | null;
};

export type RightPanelLauncherModel = {
  readonly title: string;
  readonly ariaLabel: string;
  readonly actions: readonly RightPanelSurfaceActionModel[];
  readonly availableActionKeys: readonly RightPanelSurfaceActionKey[];
  readonly shortcutKeys: string;
  readonly showBrowserProfileChooser: boolean;
  readonly browserProfiles: readonly RightPanelBrowserProfile[];
};

export type RightPanelTabsModel = {
  readonly tabs: readonly RightPanelTabModel[];
  readonly activeSurfaceId: string | null;
  readonly showAddSurfaceMenu: boolean;
  readonly addSurfaceActions: readonly RightPanelSurfaceActionModel[];
  readonly launcher: RightPanelLauncherModel | null;
};

export type RightPanelTabsInput = RightPanelSurfaceAvailability & {
  readonly surfaces: readonly RightPanelSurface[];
  readonly activeSurfaceId: string | null;
  readonly pendingSurfaceIds: ReadonlySet<string>;
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  readonly previewRuntimeTabId: ((tabId: string) => string) | null;
  readonly terminalLabelsById: ReadonlyMap<string, string>;
  readonly canRenameDevice: boolean;
  readonly browserProfiles: readonly RightPanelBrowserProfile[];
  readonly liveAgentCount: number;
  readonly pullRequestStatusBySurfaceId: Readonly<Record<string, RightPanelPullRequestTabStatus>>;
};

const SURFACE_DISABLED_REASONS: Readonly<Record<RightPanelSurfaceActionKey, string>> = {
  browser: "Browser previews are only available in the T3 Code desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  pullRequest: "This thread's branch has no pull request yet.",
  pullRequests: "No linked pull requests are available for this thread.",
  agents: "Agents are only available from a thread.",
  device: "Devices are only available from a thread.",
};

const SURFACE_UNAVAILABLE_HINTS: Readonly<Record<RightPanelSurfaceActionKey, string>> = {
  browser: "Only available in the desktop app.",
  terminal: "Available when a project is open.",
  files: "Available when a project is open.",
  diff: "Available for Git repositories.",
  pullRequest: "No pull request on this branch yet.",
  pullRequests: "No linked pull requests available.",
  agents: "Available from a thread.",
  device: "Available from a thread.",
};

const SURFACE_ACTION_DEFINITIONS: readonly {
  readonly key: RightPanelSurfaceActionKey;
  readonly label: string;
  readonly shortcut: string;
  readonly launcherDescription: string | null;
}[] = [
  { key: "browser", label: "Browser", shortcut: "B", launcherDescription: null },
  { key: "terminal", label: "Terminal", shortcut: "T", launcherDescription: null },
  { key: "files", label: "Files", shortcut: "F", launcherDescription: null },
  { key: "diff", label: "Diff", shortcut: "D", launcherDescription: null },
  { key: "pullRequest", label: "Pull request", shortcut: "P", launcherDescription: null },
  {
    key: "pullRequests",
    label: "Linked pull requests",
    shortcut: "L",
    launcherDescription: null,
  },
  { key: "agents", label: "Agents", shortcut: "A", launcherDescription: null },
  {
    key: "device",
    label: "Device",
    shortcut: "M",
    launcherDescription: "Watch an iOS Simulator or Android Emulator.",
  },
];

function surfaceActionAvailable(
  key: RightPanelSurfaceActionKey,
  availability: RightPanelSurfaceAvailability,
): boolean {
  switch (key) {
    case "browser":
      return availability.browserAvailable;
    case "terminal":
      return availability.terminalAvailable;
    case "files":
      return availability.filesAvailable;
    case "diff":
      return availability.diffAvailable;
    case "pullRequest":
      return availability.pullRequestAvailable;
    case "pullRequests":
      return availability.pullRequestsAvailable;
    case "agents":
      return availability.agentsAvailable;
    case "device":
      return availability.deviceAvailable;
  }
}

export function buildAddSurfaceActions(
  availability: RightPanelSurfaceAvailability,
): RightPanelSurfaceActionModel[] {
  return SURFACE_ACTION_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    description: null,
    shortcut: definition.shortcut,
    available: surfaceActionAvailable(definition.key, availability),
    disabledReason: SURFACE_DISABLED_REASONS[definition.key],
    badgeCount: 0,
  }));
}

export function buildLauncherSurfaceActions(
  input: RightPanelSurfaceAvailability & { readonly liveAgentCount: number },
): RightPanelSurfaceActionModel[] {
  return SURFACE_ACTION_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    description: definition.launcherDescription,
    shortcut: definition.shortcut,
    available: surfaceActionAvailable(definition.key, input),
    disabledReason: SURFACE_UNAVAILABLE_HINTS[definition.key],
    badgeCount: definition.key === "agents" ? input.liveAgentCount : 0,
  }));
}

export function buildRightPanelLauncherModel(
  input: RightPanelSurfaceAvailability & {
    readonly liveAgentCount: number;
    readonly browserProfiles: readonly RightPanelBrowserProfile[];
  },
): RightPanelLauncherModel {
  const actions = buildLauncherSurfaceActions(input);
  const available = actions.filter((action) => action.available);
  return {
    title: "Open a surface",
    ariaLabel: "Open a surface",
    actions,
    availableActionKeys: available.map((action) => action.key),
    shortcutKeys: available.map((action) => action.shortcut).join(""),
    showBrowserProfileChooser: input.browserProfiles.length > 1,
    browserProfiles: input.browserProfiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    })),
  };
}

export function previewTabIdOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  if (surface.kind !== "preview" || !surface.resourceId) return null;
  return sessions[surface.resourceId]?.tabId ?? null;
}

export function tabMuteMenuItem(input: {
  overlay: DesktopPreviewOverlay | null;
  canResolveRuntimeTabId: boolean;
}): { label: string; disabled: boolean } {
  const muted = input.overlay?.audioMuted ?? false;
  return {
    label: muted ? "Unmute tab" : "Mute tab",
    disabled: input.overlay === null || !input.canResolveRuntimeTabId,
  };
}

export function tabAudioState(overlay: DesktopPreviewOverlay | null): RightPanelTabAudioState {
  if (!overlay?.audible) return "none";
  return overlay.audioMuted ? "muted" : "audible";
}

export function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "pull-requests":
      return "Pull requests";
    case "agents":
      return "Agents";
    case "device":
      return surface.title ?? surface.target?.name ?? "Device";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export function buildSurfaceIconModel(input: {
  readonly surface: RightPanelSurface;
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  readonly pullRequestStatus: RightPanelPullRequestTabStatus | null;
}): RightPanelSurfaceIconModel {
  const surface = input.surface;
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? input.previewSessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      const favicon = snapshot ? (input.desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
      const capturedFaviconUrl =
        favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
      return { kind: "preview", url, capturedFaviconUrl };
    }
    case "diff":
      return { kind: "diff" };
    case "files":
      return { kind: "files" };
    case "file":
      return { kind: "file", path: surface.relativePath };
    case "terminal":
      return { kind: "terminal" };
    case "pull-request":
      return { kind: "pull-request", status: input.pullRequestStatus };
    case "pull-requests":
      return { kind: "pull-requests" };
    case "agents":
      return { kind: "agents" };
    case "device":
      return { kind: "device", platform: surface.target?.platform ?? null };
  }
}

function buildTabAudioModel(input: {
  readonly surface: RightPanelSurface;
  readonly title: string;
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  readonly previewRuntimeTabId: ((tabId: string) => string) | null;
}): RightPanelTabAudioModel | null {
  const previewTabId = previewTabIdOf(input.surface, input.previewSessions);
  if (!previewTabId) return null;
  const state = tabAudioState(input.desktopByTabId[previewTabId] ?? null);
  const runtimeTabId = input.previewRuntimeTabId?.(previewTabId) ?? null;
  if (state === "none" || !runtimeTabId) return null;
  const muted = state === "muted";
  return {
    state,
    runtimeTabId,
    toggleLabel: muted ? `Unmute ${input.title}` : `Mute ${input.title}`,
    tooltip: muted ? "Unmute tab" : "Mute tab",
    nextMuted: !muted,
  };
}

export function buildRightPanelTabsModel(input: RightPanelTabsInput): RightPanelTabsModel {
  const tabs = input.surfaces.map((surface): RightPanelTabModel => {
    const title = surfaceTitle(surface, input.previewSessions, input.terminalLabelsById);
    return {
      id: surface.id,
      kind: surface.kind,
      title,
      closeLabel: `Close ${title}`,
      tooltip: title,
      active: surface.id === input.activeSurfaceId,
      pending: input.pendingSurfaceIds.has(surface.id),
      renamable: surface.kind === "device" && input.canRenameDevice,
      icon: buildSurfaceIconModel({
        surface,
        previewSessions: input.previewSessions,
        desktopByTabId: input.desktopByTabId,
        pullRequestStatus: input.pullRequestStatusBySurfaceId[surface.id] ?? null,
      }),
      audio: buildTabAudioModel({
        surface,
        title,
        previewSessions: input.previewSessions,
        desktopByTabId: input.desktopByTabId,
        previewRuntimeTabId: input.previewRuntimeTabId,
      }),
    };
  });
  return {
    tabs,
    activeSurfaceId: input.activeSurfaceId,
    showAddSurfaceMenu: input.surfaces.length > 0,
    addSurfaceActions: buildAddSurfaceActions(input),
    launcher: input.activeSurfaceId === null ? buildRightPanelLauncherModel(input) : null,
  };
}

export type RightPanelPullRequestStatusSource = {
  readonly state: PullRequestState;
  readonly isDraft?: boolean | undefined;
};

export function resolveRightPanelPullRequestTabStatus(input: {
  readonly linkedSnapshot: RightPanelPullRequestStatusSource | null;
  readonly summary: RightPanelPullRequestStatusSource | null;
  readonly seed: RightPanelPullRequestTabStatus | undefined;
  readonly detailIsDraft: boolean | undefined;
}): RightPanelPullRequestTabStatus | null {
  const status = input.linkedSnapshot ?? input.summary ?? input.seed ?? null;
  if (status === null) return null;
  return {
    state: status.state,
    isDraft: status.isDraft ?? input.detailIsDraft ?? input.seed?.isDraft ?? false,
  };
}

export type RightPanelDeviceTabTooltipModel = {
  readonly title: string;
  readonly subtitle: string | null;
};

export function buildDeviceTabTooltipModel(input: {
  readonly title: string;
  readonly target: DeviceTabTarget | undefined;
  readonly hostLabel: string | undefined;
  readonly deviceVersion: string | undefined;
}): RightPanelDeviceTabTooltipModel {
  if (!input.target) return { title: input.title, subtitle: null };
  return {
    title: input.title,
    subtitle: `${input.hostLabel ?? "Device host"} · ${
      input.deviceVersion ?? (input.target.platform === "ios" ? "iOS" : "Android")
    }`,
  };
}

export function resolvePullRequestTabLink(
  threads: readonly {
    readonly environmentId: EnvironmentId;
    readonly pullRequests: readonly ThreadPullRequestLink[];
  }[],
  environmentId: EnvironmentId | null,
  host: string | null,
  reference: { repository: string; number: number },
): ThreadPullRequestLink | undefined {
  if (environmentId === null || host === null) return undefined;
  let newest: ThreadPullRequestLink | undefined;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      if (
        !threadPullRequestKeysEqual(link, {
          host,
          repository: reference.repository,
          number: reference.number,
        })
      )
        continue;
      if (
        newest === undefined ||
        (link.snapshot?.syncedAt ?? "") > (newest.snapshot?.syncedAt ?? "")
      )
        newest = link;
    }
  }
  return newest;
}

export function shouldOpenDefaultBrowserProfileFromMenuClick(
  pointerType: string | undefined,
): boolean {
  return pointerType !== "touch";
}

export type SurfaceShortcutEvent = {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly metaKey: boolean;
};

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return (
    actions.find(
      (action) => action.available && action.shortcut.toLowerCase() === event.key.toLowerCase(),
    ) ?? null
  );
}

export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

export const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="command-dialog-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

export type SurfaceLauncherKeyIntent =
  | { readonly kind: "none" }
  | { readonly kind: "highlight"; readonly index: number }
  | { readonly kind: "activate"; readonly index: number };

export function resolveLauncherHighlightIndex(highlight: number, availableCount: number): number {
  return availableCount === 0 ? -1 : Math.min(highlight, availableCount - 1);
}

export function resolveSurfaceLauncherKey(input: {
  readonly key: string;
  readonly defaultPrevented: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly highlightIndex: number;
  readonly availableCount: number;
  readonly targetIsLauncher: boolean;
}): SurfaceLauncherKeyIntent {
  if (input.defaultPrevented || input.metaKey || input.ctrlKey || input.altKey) {
    return { kind: "none" };
  }
  if (input.availableCount === 0) return { kind: "none" };
  if (input.key === "ArrowDown" || input.key === "ArrowRight") {
    return { kind: "highlight", index: (input.highlightIndex + 1) % input.availableCount };
  }
  if (input.key === "ArrowUp" || input.key === "ArrowLeft") {
    return {
      kind: "highlight",
      index:
        input.highlightIndex === -1
          ? input.availableCount - 1
          : (input.highlightIndex - 1 + input.availableCount) % input.availableCount,
    };
  }
  if (input.key === "Enter") {
    if (!input.targetIsLauncher) return { kind: "none" };
    if (input.highlightIndex < 0 || input.highlightIndex >= input.availableCount) {
      return { kind: "none" };
    }
    return { kind: "activate", index: input.highlightIndex };
  }
  return { kind: "none" };
}

export type RightPanelTabContextMenuAction =
  | "rename"
  | "copy-path"
  | "toggle-mute"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

export type RightPanelTabContextMenuInput = {
  readonly surface: RightPanelSurface;
  readonly surfaces: readonly RightPanelSurface[];
  readonly previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  readonly desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  readonly previewRuntimeTabId: ((tabId: string) => string) | null;
  readonly canRenameDevice: boolean;
};

export function buildTabContextMenuItems(
  input: RightPanelTabContextMenuInput,
): ContextMenuItem<RightPanelTabContextMenuAction>[] | null {
  const { surface, surfaces } = input;
  const surfaceIndex = surfaces.findIndex((entry) => entry.id === surface.id);
  if (surfaceIndex < 0) return null;
  const items: ContextMenuItem<RightPanelTabContextMenuAction>[] = [];
  if (surface.kind === "device" && input.canRenameDevice) {
    items.push({ id: "rename", label: "Rename" });
  }
  if (surface.kind === "file" && surface.attachment === undefined) {
    items.push({ id: "copy-path", label: "Copy path" });
  }
  if (surface.kind === "preview") {
    const previewTabId = previewTabIdOf(surface, input.previewSessions);
    items.push({
      id: "toggle-mute",
      ...tabMuteMenuItem({
        overlay: previewTabId ? (input.desktopByTabId[previewTabId] ?? null) : null,
        canResolveRuntimeTabId: input.previewRuntimeTabId !== null,
      }),
    });
  }
  items.push(
    { id: "close", label: "Close" },
    { id: "close-others", label: "Close others", disabled: surfaces.length <= 1 },
    {
      id: "close-to-right",
      label: "Close to the right",
      disabled: surfaceIndex >= surfaces.length - 1,
    },
    { id: "close-all", label: "Close all", disabled: surfaces.length === 0 },
  );
  return items;
}

export type RightPanelTabIntent =
  | { readonly kind: "none" }
  | { readonly kind: "rename"; readonly surfaceId: string }
  | { readonly kind: "copy-path"; readonly relativePath: string }
  | { readonly kind: "set-audio-muted"; readonly runtimeTabId: string; readonly muted: boolean }
  | { readonly kind: "close"; readonly surface: RightPanelSurface }
  | { readonly kind: "close-others"; readonly surface: RightPanelSurface }
  | { readonly kind: "close-to-right"; readonly surface: RightPanelSurface }
  | { readonly kind: "close-all" }
  | { readonly kind: "activate"; readonly surface: RightPanelSurface };

export function resolveTabContextMenuAction(
  action: RightPanelTabContextMenuAction | null,
  input: RightPanelTabContextMenuInput,
): RightPanelTabIntent {
  const { surface } = input;
  switch (action) {
    case "rename":
      return { kind: "rename", surfaceId: surface.id };
    case "copy-path":
      return surface.kind === "file" && surface.attachment === undefined
        ? { kind: "copy-path", relativePath: surface.relativePath }
        : { kind: "none" };
    case "toggle-mute": {
      const previewTabId = previewTabIdOf(surface, input.previewSessions);
      const overlay = previewTabId ? (input.desktopByTabId[previewTabId] ?? null) : null;
      const runtimeTabId =
        previewTabId && overlay ? (input.previewRuntimeTabId?.(previewTabId) ?? null) : null;
      return runtimeTabId
        ? { kind: "set-audio-muted", runtimeTabId, muted: !(overlay?.audioMuted ?? false) }
        : { kind: "none" };
    }
    case "close":
      return { kind: "close", surface };
    case "close-others":
      return { kind: "close-others", surface };
    case "close-to-right":
      return { kind: "close-to-right", surface };
    case "close-all":
      return { kind: "close-all" };
    case null:
      return { kind: "none" };
  }
}

export function resolveTabActivate(surface: RightPanelSurface): RightPanelTabIntent {
  return { kind: "activate", surface };
}

export function resolveTabAuxClick(
  button: number,
  surface: RightPanelSurface,
): RightPanelTabIntent {
  return button === 1 ? { kind: "close", surface } : { kind: "none" };
}

export function resolveTabDoubleClick(
  surface: RightPanelSurface,
  canRenameDevice: boolean,
): RightPanelTabIntent {
  return surface.kind === "device" && canRenameDevice
    ? { kind: "rename", surfaceId: surface.id }
    : { kind: "none" };
}

export type RightPanelTabRenameKeyIntent = "commit" | "revert" | "none";

export function resolveTabRenameKey(key: string): RightPanelTabRenameKeyIntent {
  if (key === "Enter") return "commit";
  if (key === "Escape") return "revert";
  return "none";
}

export type RightPanelTabScrollState = {
  readonly hasOverflow: boolean;
  readonly canScrollLeft: boolean;
  readonly canScrollRight: boolean;
};

const TAB_SCROLL_EDGE_TOLERANCE = 1;

export function resolveTabScrollState(metrics: {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollLeft: number;
}): RightPanelTabScrollState {
  const hasOverflow = metrics.scrollWidth - metrics.clientWidth > TAB_SCROLL_EDGE_TOLERANCE;
  return {
    hasOverflow,
    canScrollLeft: hasOverflow && metrics.scrollLeft > TAB_SCROLL_EDGE_TOLERANCE,
    canScrollRight:
      hasOverflow &&
      metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - TAB_SCROLL_EDGE_TOLERANCE,
  };
}

export function resolveTabScrollStep(direction: -1 | 1, clientWidth: number): number {
  return direction * Math.max(120, clientWidth * 0.75);
}

export type TabWheelDeltaMode = "pixel" | "line" | "page";

export function resolveTabWheelDelta(input: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: TabWheelDeltaMode;
  readonly ctrlKey: boolean;
  readonly clientWidth: number;
}): number {
  if (input.ctrlKey) return 0;
  let delta = Math.abs(input.deltaX) > Math.abs(input.deltaY) ? input.deltaX : input.deltaY;
  if (input.deltaMode === "line") delta *= 16;
  if (input.deltaMode === "page") delta *= input.clientWidth;
  return delta;
}
