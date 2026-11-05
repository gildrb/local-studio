import {
  buildOpenSourceLicensesModel,
  licenseManifestErrorMessage,
  resolveOpenSourceLicensesAction,
  type OpenSourceLicensesManifestState,
  type OpenSourceLicensesModel,
} from "@t3tools/web/src/components/settings/OpenSourceLicenses.logic.ts";
import { generateThirdPartyLicenseManifest } from "../../../../../scripts/lib/third-party-licenses.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import { openExternal } from "../../openExternal.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

type LicensesUiState = {
  readonly query: string;
  readonly searchOpen: boolean;
  readonly openEntryKey: string | null;
};

const INITIAL_UI: LicensesUiState = { query: "", searchOpen: false, openEntryKey: null };

const QueryParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const SearchOpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const KeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));
const ToggleParams = Schema.decodeUnknownSync(
  Schema.Struct({ entryKey: Schema.String, open: Schema.Boolean }),
);
const UrlParams = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

function loadLicenseManifest() {
  return generateThirdPartyLicenseManifest({
    bundleName: "web",
    allowMissingGeneratedNotices: true,
    configFile: new URL("../../../../../third-party-licenses.config.json", import.meta.url),
    packageManifests: [
      { bundle: "web", path: new URL("../../../../../apps/web/package.json", import.meta.url) },
      {
        bundle: "server",
        path: new URL("../../../../../apps/server/package.json", import.meta.url),
      },
      {
        bundle: "desktop",
        path: new URL("../../../../../apps/desktop/package.json", import.meta.url),
      },
    ],
  });
}

export function createLicensesSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry } = context;
  const manifestAtom = Atom.make<OpenSourceLicensesManifestState>({ status: "loading" }).pipe(
    Atom.keepAlive,
  );
  const uiAtom = Atom.make<LicensesUiState>(INITIAL_UI).pipe(Atom.keepAlive);
  let request = 0;

  const load = () => {
    request += 1;
    const current = request;
    registry.set(manifestAtom, { status: "loading" });
    void loadLicenseManifest().then(
      (manifest) => {
        if (current === request)
          registry.set(manifestAtom, { status: "ready", entries: manifest.entries });
      },
      (error: unknown) => {
        if (current === request) {
          registry.set(manifestAtom, {
            status: "error",
            message: licenseManifestErrorMessage(error),
          });
        }
      },
    );
  };

  const viewAtom = Atom.make((get): OpenSourceLicensesModel | null => {
    if (get(scope.sectionAtom) !== "open-source-licenses") return null;
    const ui = get(uiAtom);
    return buildOpenSourceLicensesModel({
      manifest: get(manifestAtom),
      query: ui.query,
      searchOpen: ui.searchOpen,
      openEntryKey: ui.openEntryKey,
    });
  });

  const update = (patch: Partial<LicensesUiState>) =>
    registry.set(uiAtom, { ...registry.get(uiAtom), ...patch });

  return {
    views: { settingsLicenses: viewAtom },
    actions: {
      settingsLicensesMount: async () => {
        registry.set(uiAtom, INITIAL_UI);
        load();
        return null;
      },
      settingsLicensesRetry: async () => {
        load();
        return null;
      },
      settingsLicensesQuery: async (params) => {
        update({ query: QueryParams(params).query });
        return null;
      },
      settingsLicensesSearchOpen: async (params) => {
        update({ searchOpen: SearchOpenParams(params).open });
        return null;
      },
      settingsLicensesSearchBlur: async () => {
        const decision = resolveOpenSourceLicensesAction({
          kind: "search-blur",
          query: registry.get(uiAtom).query,
        });
        if (decision.kind === "close-search") update({ searchOpen: false });
        return null;
      },
      settingsLicensesSearchKey: async (params) => {
        const decision = resolveOpenSourceLicensesAction({
          kind: "search-key",
          key: KeyParams(params).key,
        });
        if (decision.kind === "close-search") {
          update(decision.clearQuery ? { query: "", searchOpen: false } : { searchOpen: false });
          return true;
        }
        return false;
      },
      settingsLicensesToggle: async (params) => {
        const { entryKey, open } = ToggleParams(params);
        const decision = resolveOpenSourceLicensesAction({ kind: "toggle-entry", entryKey, open });
        if (decision.kind === "set-open-entry") update({ openEntryKey: decision.entryKey });
        return null;
      },
      settingsLicensesOpenSource: async (params) => {
        await openExternal(UrlParams(params).url);
        return null;
      },
    },
  };
}
