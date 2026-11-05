import type { UsageProviderKind } from "@t3tools/contracts";

import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  type Icon,
  OpenAI,
  OpenCodeIcon,
} from "../Icons";
import { USAGE_PROVIDER_STYLES, type UsageProviderStyle } from "./usageProviders.logic";

type UsageProviderPresentation = UsageProviderStyle & {
  readonly mark: Icon;
};

export const PROVIDER_PRESENTATION = {
  codex: { ...USAGE_PROVIDER_STYLES.codex, mark: OpenAI },
  claude: { ...USAGE_PROVIDER_STYLES.claude, mark: ClaudeAI },
  grok: { ...USAGE_PROVIDER_STYLES.grok, mark: GrokIcon },
  cursor: { ...USAGE_PROVIDER_STYLES.cursor, mark: CursorIcon },
  opencode: { ...USAGE_PROVIDER_STYLES.opencode, mark: OpenCodeIcon },
  antigravity: { ...USAGE_PROVIDER_STYLES.antigravity, mark: AntigravityIcon },
} satisfies Record<UsageProviderKind, UsageProviderPresentation>;
