import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";

export const runtimeModeLabels: Record<RuntimeMode, { label: string; description: string }> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
};

export const interactionModeControlLabels: Record<
  ProviderInteractionMode,
  { label: string; tooltip: string }
> = {
  plan: { label: "Plan", tooltip: "Plan mode — click to return to normal build mode" },
  default: { label: "Build", tooltip: "Default mode — click to enter plan mode" },
};
