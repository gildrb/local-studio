import type { ThemeColorRole } from "../../themePalette";

export type ThemePaintKind = "background" | "border" | "foreground";

export type ThemePaintSnapshot = Readonly<Record<ThemePaintKind, string>>;

export const THEME_PAINT_KIND_ORDER: ReadonlyArray<ThemePaintKind> = [
  "background",
  "border",
  "foreground",
];

const THEME_UTILITY_ROLES: Readonly<Partial<Record<string, ThemeColorRole>>> = {
  background: "canvas",
  foreground: "text",
  card: "surface",
  "card-foreground": "text",
  popover: "surfaceOverlay",
  "popover-foreground": "text",
  "surface-raised": "surfaceRaised",
  primary: "messageAction",
  "primary-foreground": "messageActionForeground",
  secondary: "secondary",
  "secondary-foreground": "secondaryForeground",
  muted: "muted",
  "muted-foreground": "mutedForeground",
  placeholder: "placeholder",
  "secondary-label": "secondaryLabel",
  "icon-muted": "iconMuted",
  accent: "accentSurface",
  "accent-foreground": "accentSurfaceForeground",
  destructive: "error",
  "destructive-foreground": "errorForeground",
  error: "error",
  "error-foreground": "errorForeground",
  "error-surface": "errorSurface",
  warning: "warning",
  "warning-foreground": "warningForeground",
  "warning-surface": "warningSurface",
  update: "update",
  "update-foreground": "updateForeground",
  "update-surface": "updateSurface",
  message: "messageSurface",
  "message-foreground": "messageForeground",
  "message-action": "messageAction",
  "message-action-foreground": "messageActionForeground",
  "message-action-hover": "messageActionHover",
  sidebar: "sidebar",
  "sidebar-foreground": "sidebarForeground",
  "sidebar-muted-foreground": "sidebarMutedForeground",
  "sidebar-control-surface": "sidebarControlSurface",
  "sidebar-row-hover": "sidebarRowHover",
  "sidebar-row-active": "sidebarRowActive",
  "sidebar-row-selected": "sidebarRowSelected",
  "sidebar-border": "sidebarBorder",
  border: "border",
  input: "input",
  ring: "focus",
};

const THEME_UTILITY_PREFIXES: Readonly<Record<ThemePaintKind, ReadonlyArray<string>>> = {
  background: ["bg-"],
  border: ["border-", "outline-", "ring-"],
  foreground: ["text-", "caret-", "fill-", "stroke-"],
};

export function changedThemePaintKinds(
  before: ThemePaintSnapshot,
  after: ThemePaintSnapshot,
): ReadonlyArray<ThemePaintKind> {
  return THEME_PAINT_KIND_ORDER.filter((kind) => before[kind] !== after[kind]);
}

export function themeRoleFromUtilityClass(
  className: string,
  kind: ThemePaintKind,
): ThemeColorRole | null {
  if (className.includes(":")) return null;
  for (const prefix of THEME_UTILITY_PREFIXES[kind]) {
    if (!className.startsWith(prefix)) continue;
    const colorName = className.slice(prefix.length).split("/", 1)[0] ?? "";
    return THEME_UTILITY_ROLES[colorName] ?? null;
  }
  return null;
}
