export type ProjectIconColor =
  | "gray"
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose";

export type EnvironmentMachineKind =
  | "server"
  | "cloud"
  | "linux"
  | "desktop"
  | "laptop"
  | "mac-mini"
  | "mac-studio";

export type ProjectIconView =
  | { readonly kind: "monogram"; readonly text: string; readonly color: ProjectIconColor }
  | { readonly kind: "emoji"; readonly emoji: string }
  | { readonly kind: "lucide"; readonly name: string; readonly color: ProjectIconColor }
  | {
      readonly kind: "image";
      readonly url: string;
      readonly fallback: { readonly text: string; readonly color: ProjectIconColor } | null;
    }
  | { readonly kind: "folder" };

export interface SidebarView {
  readonly header: SidebarHeaderView;
  readonly items: ReadonlyArray<SidebarItemView>;
  readonly emptyState: SidebarEmptyStateView | null;
  readonly footer: SidebarFooterView;
}

export interface SidebarHeaderView {
  readonly brandLabel: string;
  readonly stageBackdrop: "dev" | "nightly" | null;
  readonly stagePill: "Dev" | "Nightly" | null;
  readonly search: {
    readonly placeholder: string;
    readonly query: string;
  };
  readonly hasProjects: boolean;
  readonly projectScope: {
    readonly label: string;
    readonly scopedProject: {
      readonly projectKey: string;
      readonly displayName: string;
      readonly icon: ProjectIconView;
    } | null;
  };
  readonly addProject: { readonly label: string };
  readonly newThread: {
    readonly label: string;
    readonly tooltip: string;
    readonly inProjectHint: string | null;
    readonly disabled: boolean;
  };
}

export type SidebarSection = "pinned" | "active" | "working" | "snoozed" | "settled";

export type SidebarItemView =
  | SidebarThreadRowView
  | SidebarDraftRowView
  | { readonly kind: "draft-divider" }
  | SidebarShelfHeaderView
  | { readonly kind: "show-more"; readonly label: string; readonly count: number };

export interface SidebarDraftRowView {
  readonly kind: "draft";
  readonly key: string;
  readonly draftId: string;
  readonly preview: string;
  readonly accessibilityLabel: string;
  readonly isActive: boolean;
  readonly project: {
    readonly displayName: string | null;
    readonly icon: ProjectIconView | null;
  };
}

export interface SidebarSnoozeMenuView {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly shortcut: string;
  }>;
  readonly customLabel: string;
}

export interface SidebarShelfHeaderView {
  readonly kind: "shelf-header";
  readonly shelf: "working" | "snoozed" | "settled";
  readonly label: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly pushToBottom: boolean;
}

export type SidebarThreadStatusKind =
  | "working"
  | "monitoring"
  | "approval"
  | "input"
  | "failed"
  | "woke"
  | "done";

export type SidebarRowSurface = "active" | "selected" | "draft" | "recede" | "default";

export type SidebarTitleTone =
  | "foreground"
  | "foreground-95"
  | "foreground-90"
  | "secondary"
  | "secondary-70"
  | "muted";

export type PullRequestGlyphKind = "pull-request" | "draft" | "closed" | "merged" | "stack";

export type PullRequestTone = "open" | "draft" | "closed" | "merged" | "muted";

export interface SidebarThreadRowView {
  readonly kind: "thread";
  readonly key: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly section: SidebarSection;
  readonly variant: "card" | "slim";
  readonly action: "settle" | "unsettle" | "unsnooze";
  readonly title: string;
  readonly titleTone: SidebarTitleTone;
  readonly titleWeight: "normal" | "medium";
  readonly regeneratingTitle: boolean;
  readonly renaming: boolean;
  readonly accessibilityLabel: string;
  readonly isActive: boolean;
  readonly surface: SidebarRowSurface;
  readonly hasUnsentDraft: boolean;
  readonly fadeRow: boolean;
  readonly settledDim: boolean;
  readonly project: {
    readonly displayName: string | null;
    readonly icon: ProjectIconView | null;
    readonly dimmed: boolean;
  };
  readonly status: {
    readonly kind: SidebarThreadStatusKind;
    readonly label: string;
    readonly workingStartedAt: string | null;
  } | null;
  readonly timeLabel: string;
  readonly snoozeWakeLabel: string | null;
  readonly wokeAt: string | null;
  readonly pin: { readonly canUnpin: boolean } | null;
  readonly actions: {
    readonly settle: boolean;
    readonly unsettle: boolean;
    readonly unsnooze: boolean;
    readonly snooze: boolean;
  };
  readonly snoozeMenu: SidebarSnoozeMenuView | null;
  readonly branch: string | null;
  readonly worktree: { readonly displayPath: string; readonly tooltip: string } | null;
  readonly terminal: {
    readonly count: number;
    readonly label: string;
    readonly pulse: boolean;
  } | null;
  readonly pullRequest: {
    readonly glyph: PullRequestGlyphKind;
    readonly tone: PullRequestTone;
    readonly text: string;
    readonly label: string;
    readonly opensList: boolean;
    readonly url: string | null;
  } | null;
  readonly remoteMachine: EnvironmentMachineKind | null;
  readonly provider: {
    readonly driverKind: string;
    readonly displayName: string;
    readonly accentColor: string | null;
    readonly showBadge: boolean;
    readonly initials: string;
  } | null;
  readonly jumpLabel: string | null;
}

export type SidebarEmptyStateView =
  | { readonly kind: "no-projects"; readonly label: string; readonly actionLabel: string }
  | { readonly kind: "no-threads"; readonly label: string };

export interface SidebarFooterView {
  readonly undoNotice: { readonly text: string; readonly actionLabel: string } | null;
  readonly back: { readonly label: string } | null;
  readonly items: ReadonlyArray<{
    readonly id: "settings" | "pull-requests" | "usage";
    readonly label: string;
  }>;
}
