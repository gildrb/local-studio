import type { RuntimeMode } from "@t3tools/contracts";
import { type LucideIcon, LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon } from "lucide-react";

import { runtimeModeLabels } from "./runtimeModeLabels";

const runtimeModeIcons: Record<RuntimeMode, LucideIcon> = {
  "approval-required": LockIcon,
  "auto-accept-edits": PenLineIcon,
  auto: SparklesIcon,
  "full-access": LockOpenIcon,
};

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    ...runtimeModeLabels["approval-required"],
    icon: runtimeModeIcons["approval-required"],
  },
  "auto-accept-edits": {
    ...runtimeModeLabels["auto-accept-edits"],
    icon: runtimeModeIcons["auto-accept-edits"],
  },
  auto: { ...runtimeModeLabels.auto, icon: runtimeModeIcons.auto },
  "full-access": { ...runtimeModeLabels["full-access"], icon: runtimeModeIcons["full-access"] },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
