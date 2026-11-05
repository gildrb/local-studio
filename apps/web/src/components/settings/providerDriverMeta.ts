import type { ProviderDriverKind } from "@t3tools/contracts";
import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  type Icon,
  OmpIcon,
  OpenAI,
  OpenCodeIcon,
  PiAgentIcon,
} from "../Icons";
import {
  PROVIDER_DRIVER_METAS,
  type ProviderDriverIconKey,
  type ProviderDriverMeta,
} from "./providerDriverMeta.logic";

export type ProviderClientDefinition = ProviderDriverMeta & {
  readonly icon: Icon;
};

export const PROVIDER_DRIVER_ICONS: Readonly<Record<ProviderDriverIconKey, Icon>> = {
  openai: OpenAI,
  claude: ClaudeAI,
  cursor: CursorIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  antigravity: AntigravityIcon,
  "pi-agent": PiAgentIcon,
  omp: OmpIcon,
};

const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = PROVIDER_DRIVER_METAS.map(
  (meta) => ({ ...meta, icon: PROVIDER_DRIVER_ICONS[meta.iconKey] }),
);

const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
  Record<ProviderDriverKind, ProviderClientDefinition>
> = Object.fromEntries(
  PROVIDER_CLIENT_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export const DRIVER_OPTIONS = PROVIDER_CLIENT_DEFINITIONS;
export const DRIVER_OPTION_BY_VALUE = PROVIDER_CLIENT_DEFINITION_BY_VALUE;
export type DriverOption = ProviderClientDefinition;

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(driver: ProviderDriverKind | undefined): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver];
}
