import type { UnifiedSettings } from "@t3tools/contracts";
import type { ServerSettingsPatch } from "@t3tools/contracts/settings";

import { searchableSetting } from "./settingsSearch";

export type UsageProviderSettingsModelInput = {
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly cursorKeychainUsageEnabled: boolean;
  readonly platformOs: string | null;
  readonly readOnly: boolean;
  readonly updatingCursor: boolean;
  readonly adding: boolean;
};

export type UsageProviderCursorKeychainRow = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly value: boolean;
  readonly disabled: boolean;
};

export type UsageProviderRemoveConfirmation = {
  readonly title: string;
  readonly description: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
};

export type UsageProviderHubRow = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly removable: boolean;
  readonly removeLabel: string;
  readonly removeConfirmation: UsageProviderRemoveConfirmation;
};

export type UsageProviderSettingsModel = {
  readonly section: { readonly id: string; readonly title: string };
  readonly addAction: { readonly label: string; readonly icon: "plus" } | null;
  readonly cursorKeychainRow: UsageProviderCursorKeychainRow | null;
  readonly emptyLabel: string | null;
  readonly hubs: ReadonlyArray<UsageProviderHubRow>;
  readonly showAddDialog: boolean;
};

export function buildUsageProviderSettingsModel(
  input: UsageProviderSettingsModelInput,
): UsageProviderSettingsModel {
  const entries = Object.entries(input.sources);
  const cursorKeychainSetting = searchableSetting("cursor-keychain-usage");
  return {
    section: searchableSetting("usage-providers"),
    addAction: input.readOnly ? null : { label: "Add hub", icon: "plus" },
    cursorKeychainRow:
      input.platformOs === "darwin"
        ? {
            id: cursorKeychainSetting.id,
            title: cursorKeychainSetting.title,
            description:
              "Read your existing Cursor CLI login from macOS Keychain to show account history and monthly limits. macOS may ask you to allow access.",
            ariaLabel: "Cursor account usage",
            value: input.cursorKeychainUsageEnabled,
            disabled: input.readOnly || input.updatingCursor,
          }
        : null,
    emptyLabel: entries.length === 0 ? "No hubs configured." : null,
    hubs: entries.map(([id, source]) => {
      const label = source.label?.trim() || source.url;
      return {
        id,
        label,
        description: `CLI Proxy${source.enabled ? "" : " · Disabled"}${label !== source.url ? ` · ${source.url}` : ""}`,
        removable: !input.readOnly,
        removeLabel: "Remove",
        removeConfirmation: {
          title: `Remove ${label}?`,
          description:
            "The hub's management key is deleted from this server. Its accounts leave the Limits view; the hub itself is untouched. Add it again with the URL and key to bring them back.",
          cancelLabel: "Cancel",
          confirmLabel: "Remove hub",
        },
      };
    }),
    showAddDialog: input.adding && !input.readOnly,
  };
}

export type UsageProviderSettingsChange =
  | { readonly kind: "remove-hub"; readonly id: string }
  | { readonly kind: "set-cursor-keychain-usage"; readonly enabled: boolean };

export type UsageProviderSettingsDecision =
  | { readonly kind: "update-settings"; readonly patch: ServerSettingsPatch }
  | { readonly kind: "update-cursor-keychain-usage"; readonly patch: ServerSettingsPatch };

export function resolveUsageProviderSettingsChange(
  change: UsageProviderSettingsChange,
): UsageProviderSettingsDecision {
  if (change.kind === "remove-hub") {
    return { kind: "update-settings", patch: { usageLimitSources: { [change.id]: null } } };
  }
  return {
    kind: "update-cursor-keychain-usage",
    patch: { cursorKeychainUsageEnabled: change.enabled },
  };
}
