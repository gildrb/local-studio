import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  GrokSettings,
  OmpSettings,
  OpenCodeSettings,
  PiAgentSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import type * as Schema from "effect/Schema";

export type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

export type ProviderDriverIconKey =
  | "openai"
  | "claude"
  | "cursor"
  | "grok"
  | "opencode"
  | "antigravity"
  | "pi-agent"
  | "omp";

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema with
 * field annotations plus provider-level presentation metadata, then renders
 * settings generically.
 */
export type ProviderDriverMeta = {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly iconKey: ProviderDriverIconKey;
  readonly settingsSchema: ProviderSettingsSchema;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
};

export const PROVIDER_DRIVER_METAS: readonly ProviderDriverMeta[] = [
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    iconKey: "openai",
    settingsSchema: CodexSettings,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    iconKey: "claude",
    settingsSchema: ClaudeSettings,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    iconKey: "cursor",
    badgeLabel: "Early Access",
    settingsSchema: CursorSettings,
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    iconKey: "grok",
    badgeLabel: "Early Access",
    settingsSchema: GrokSettings,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    iconKey: "opencode",
    settingsSchema: OpenCodeSettings,
  },
  {
    value: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    iconKey: "antigravity",
    settingsSchema: AntigravitySettings,
  },
  {
    value: ProviderDriverKind.make("piAgent"),
    label: "Pi",
    iconKey: "pi-agent",
    badgeLabel: "Early Access",
    settingsSchema: PiAgentSettings,
  },
  {
    value: ProviderDriverKind.make("omp"),
    label: "Oh My Pi",
    iconKey: "omp",
    badgeLabel: "Early Access",
    settingsSchema: OmpSettings,
  },
];

const PROVIDER_DRIVER_META_BY_VALUE: Partial<Record<ProviderDriverKind, ProviderDriverMeta>> =
  Object.fromEntries(PROVIDER_DRIVER_METAS.map((meta) => [meta.value, meta]));

export function getDriverMeta(
  driver: ProviderDriverKind | undefined,
): ProviderDriverMeta | undefined {
  if (driver === undefined) return undefined;
  return PROVIDER_DRIVER_META_BY_VALUE[driver];
}

export function getDriverLabel(driver: ProviderDriverKind): string | undefined {
  return PROVIDER_DRIVER_META_BY_VALUE[driver]?.label;
}
