import type { AppPage } from "../page.ts";
import type { ProjectIconView } from "./sidebar.ts";

export type AppShellConnectionPhase = "connecting" | "ready" | "reconnecting" | "failed";

export interface AppShellView {
  readonly connection: {
    readonly phase: AppShellConnectionPhase;
    readonly detail: string | null;
  };
  readonly activeEnvironment: {
    readonly environmentId: string;
    readonly label: string;
  } | null;
  readonly primaryServerVersion: string | null;
  readonly route: AppShellRoute;
  readonly threadHeader: AppShellThreadHeaderView | null;
}

export type AppShellRoute =
  | { readonly kind: "home" }
  | {
      readonly kind: "thread";
      readonly environmentId: string;
      readonly threadId: string;
    }
  | { readonly kind: "draft"; readonly draftId: string }
  | Exclude<AppPage, { readonly kind: "chat" }>;

export interface AppShellThreadHeaderView {
  readonly project: {
    readonly name: string;
    readonly icon: ProjectIconView;
  } | null;
  readonly title: string;
}
