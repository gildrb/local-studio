import {
  filterThirdPartyLicenseEntries,
  formatLicenseBundles,
  thirdPartyLicenseEntryKey,
  type ThirdPartyLicenseEntry,
} from "@t3tools/shared/thirdPartyLicenses";

export type OpenSourceLicensesManifestState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly entries: ReadonlyArray<ThirdPartyLicenseEntry> };

export type OpenSourceLicensesModelInput = {
  readonly manifest: OpenSourceLicensesManifestState;
  readonly query: string;
  readonly searchOpen: boolean;
  readonly openEntryKey: string | null;
};

export type OpenSourceLicenseRow = {
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
  readonly summary: string;
  readonly sourceUrl: string | null;
  readonly sourceLabel: string;
  readonly sourceTitle: string;
  readonly open: boolean;
  readonly noticeText: string | null;
};

export type OpenSourceLicensesHeaderModel = {
  readonly countLabel: string;
  readonly query: string;
  readonly searchOpen: boolean;
  readonly searchLabel: string;
  readonly searchTooltip: string;
  readonly searchPlaceholder: string;
};

export type OpenSourceLicensesBody =
  | { readonly kind: "loading"; readonly message: string }
  | {
      readonly kind: "error";
      readonly title: string;
      readonly message: string;
      readonly retryLabel: string;
    }
  | {
      readonly kind: "ready";
      readonly rows: readonly OpenSourceLicenseRow[];
      readonly emptyMessage: string | null;
    };

export type OpenSourceLicensesModel = {
  readonly title: string;
  readonly header: OpenSourceLicensesHeaderModel | null;
  readonly body: OpenSourceLicensesBody;
};

export type OpenSourceLicensesIntent =
  | { readonly kind: "search-blur"; readonly query: string }
  | { readonly kind: "search-key"; readonly key: string }
  | { readonly kind: "toggle-entry"; readonly entryKey: string; readonly open: boolean };

export type OpenSourceLicensesDecision =
  | { readonly kind: "none" }
  | { readonly kind: "close-search"; readonly clearQuery: boolean }
  | { readonly kind: "set-open-entry"; readonly entryKey: string | null };

export function licenseManifestRequestFailedMessage(status: number): string {
  return `The license manifest request failed with status ${String(status)}.`;
}

export function licenseManifestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The license manifest could not load.";
}

export function buildOpenSourceLicensesModel(
  input: OpenSourceLicensesModelInput,
): OpenSourceLicensesModel {
  const title = "Third-party notices";
  const { manifest } = input;
  if (manifest.status === "loading") {
    return {
      title,
      header: null,
      body: { kind: "loading", message: "Loading open-source notices…" },
    };
  }
  if (manifest.status === "error") {
    return {
      title,
      header: null,
      body: {
        kind: "error",
        title: "Open-source notices are unavailable",
        message: manifest.message,
        retryLabel: "Try again",
      },
    };
  }
  const filteredEntries = filterThirdPartyLicenseEntries(manifest.entries, input.query);
  const totalCount = manifest.entries.length;
  const filteredCount = filteredEntries.length;
  return {
    title,
    header: {
      countLabel:
        filteredCount === totalCount
          ? `${String(totalCount)} notices`
          : `${String(filteredCount)} of ${String(totalCount)}`,
      query: input.query,
      searchOpen: input.searchOpen,
      searchLabel: "Search open-source licenses",
      searchTooltip: "Search licenses",
      searchPlaceholder: "Search licenses",
    },
    body: {
      kind: "ready",
      rows: filteredEntries.map((entry) => {
        const id = thirdPartyLicenseEntryKey(entry);
        const open = input.openEntryKey === id;
        return {
          id,
          name: entry.name,
          version: entry.version,
          summary: `${entry.license} · ${formatLicenseBundles(entry.bundles)}`,
          sourceUrl: entry.sourceUrl,
          sourceLabel: `View project source for ${entry.name}`,
          sourceTitle: "Project source",
          open,
          noticeText: open ? entry.noticeText : null,
        };
      }),
      emptyMessage: filteredCount > 0 ? null : "No licenses match that search.",
    },
  };
}

export function resolveOpenSourceLicensesAction(
  intent: OpenSourceLicensesIntent,
): OpenSourceLicensesDecision {
  switch (intent.kind) {
    case "search-blur":
      return intent.query.length === 0
        ? { kind: "close-search", clearQuery: false }
        : { kind: "none" };
    case "search-key":
      return intent.key === "Escape"
        ? { kind: "close-search", clearQuery: true }
        : { kind: "none" };
    case "toggle-entry":
      return { kind: "set-open-entry", entryKey: intent.open ? intent.entryKey : null };
  }
}
