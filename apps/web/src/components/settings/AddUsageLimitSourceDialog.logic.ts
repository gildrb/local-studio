import { UsageLimitSourceId } from "@t3tools/contracts";
import type { ServerSettingsPatch } from "@t3tools/contracts/settings";

/**
 * Stable per hub and readable in settings.json. Dots and dashes in the host
 * are kept so `foo-bar.com` and `foo.bar.com` do not collide; anything else
 * (a port's colon, a path) is folded to a dash.
 */
export function sourceIdFromUrl(url: string): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw text; the server reports the bad URL on its row.
  }
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`cliproxy-${slug || "hub"}`);
}

export type AddUsageLimitSourceDraft = {
  readonly label: string;
  readonly url: string;
  readonly managementKey: string;
};

export type AddUsageLimitSourceFieldKey = keyof AddUsageLimitSourceDraft;

export type AddUsageLimitSourceField = {
  readonly key: AddUsageLimitSourceFieldKey;
  readonly id: string;
  readonly label: string;
  readonly placeholder: string | null;
  readonly type: "password" | null;
  readonly autoComplete: "off" | null;
  readonly autoFocus: boolean;
  readonly value: string;
};

export type AddUsageLimitSourceDialogModelInput = {
  readonly environmentLabel: string;
  readonly draft: AddUsageLimitSourceDraft;
};

export type AddUsageLimitSourceDialogModel = {
  readonly title: string;
  readonly description: string;
  readonly fields: ReadonlyArray<AddUsageLimitSourceField>;
  readonly cancelLabel: string;
  readonly saveLabel: string;
  readonly canSave: boolean;
};

export const EMPTY_ADD_USAGE_LIMIT_SOURCE_DRAFT: AddUsageLimitSourceDraft = {
  label: "",
  url: "",
  managementKey: "",
};

export function buildAddUsageLimitSourceDialogModel(
  input: AddUsageLimitSourceDialogModelInput,
): AddUsageLimitSourceDialogModel {
  return {
    title: "Add a CLIProxyAPI hub",
    description: `Show the quota of every account the hub pools, next to the providers on ${input.environmentLabel}. The key stays on that server.`,
    fields: [
      {
        key: "url",
        id: "usage-source-url",
        label: "Hub URL",
        placeholder: "https://hub.example.ts.net:8318",
        type: null,
        autoComplete: null,
        autoFocus: true,
        value: input.draft.url,
      },
      {
        key: "managementKey",
        id: "usage-source-key",
        label: "Management key",
        placeholder: null,
        type: "password",
        autoComplete: "off",
        autoFocus: false,
        value: input.draft.managementKey,
      },
      {
        key: "label",
        id: "usage-source-label",
        label: "Label (optional)",
        placeholder: "Defaults to the hub's host name",
        type: null,
        autoComplete: null,
        autoFocus: false,
        value: input.draft.label,
      },
    ],
    cancelLabel: "Cancel",
    saveLabel: "Add hub",
    canSave: input.draft.url.trim().length > 0 && input.draft.managementKey.trim().length > 0,
  };
}

export type AddUsageLimitSourceDecision =
  | { readonly kind: "invalid" }
  | { readonly kind: "save"; readonly id: UsageLimitSourceId; readonly patch: ServerSettingsPatch };

export function resolveAddUsageLimitSource(
  draft: AddUsageLimitSourceDraft,
): AddUsageLimitSourceDecision {
  const url = draft.url.trim();
  const managementKey = draft.managementKey.trim();
  if (url.length === 0 || managementKey.length === 0) return { kind: "invalid" };
  const id = sourceIdFromUrl(url);
  const label = draft.label.trim();
  return {
    kind: "save",
    id,
    patch: {
      usageLimitSources: {
        [id]: {
          kind: "cliproxy",
          ...(label ? { label } : {}),
          url,
          managementKey,
          enabled: true,
        },
      },
    },
  };
}
