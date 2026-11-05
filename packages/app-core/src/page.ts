import * as Schema from "effect/Schema";

export const AppPage = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("chat") }),
  Schema.Struct({ kind: Schema.Literal("settings"), section: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("usage") }),
  Schema.Struct({ kind: Schema.Literal("pull-requests") }),
  Schema.Struct({ kind: Schema.Literal("project"), projectKey: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("welcome") }),
  Schema.Struct({ kind: Schema.Literal("pair") }),
  Schema.Struct({ kind: Schema.Literal("connect") }),
]);
export type AppPage = typeof AppPage.Type;

export type AppPageKind = AppPage["kind"];

export const CHAT_PAGE: AppPage = { kind: "chat" };

export function appPagePath(page: AppPage): string {
  switch (page.kind) {
    case "settings":
      return `/settings/${page.section}`;
    case "usage":
      return "/usage";
    case "pull-requests":
      return "/pull-requests";
    case "project":
      return `/projects/${page.projectKey}`;
    default:
      return "/";
  }
}

export const decodeNavigateParams = Schema.decodeUnknownSync(Schema.Struct({ page: AppPage }));
