import { resolveThemeEditorToggle } from "@t3tools/web/src/components/settings/themeEditorStore.logic.ts";
import type { ThemeEditorSessionInput } from "@t3tools/web/src/components/settings/themeEditorStore.ts";
import {
  getCustomThemes,
  getEnvironmentThemes,
  getThemeDefinition,
} from "@t3tools/web/src/themePalette.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { FeatureContext } from "./feature.ts";
import { themePreferenceStore } from "./themePreference.ts";

export type ThemeEditorSession = ThemeEditorSessionInput & { readonly id: number };

export type ThemeEditorStore = {
  readonly sessionAtom: Atom.Atom<ThemeEditorSession | null>;
  readonly open: (session: ThemeEditorSessionInput) => void;
  readonly close: () => void;
  readonly toggle: () => void;
};

const stores = new WeakMap<AtomRegistry.AtomRegistry, ThemeEditorStore>();

function createThemeEditorStore(context: FeatureContext): ThemeEditorStore {
  const { registry } = context;
  const sessionAtom = Atom.make<ThemeEditorSession | null>(null).pipe(Atom.keepAlive);
  let nextSessionId = 0;
  const open = (session: ThemeEditorSessionInput) => {
    nextSessionId += 1;
    registry.set(sessionAtom, { ...session, id: nextSessionId });
  };
  const close = () => registry.set(sessionAtom, null);
  return {
    sessionAtom,
    open,
    close,
    toggle: () => {
      const snapshot = registry.get(themePreferenceStore(context).snapshotAtom);
      const decision = resolveThemeEditorToggle({
        isOpen: registry.get(sessionAtom) !== null,
        baseThemeId: getThemeDefinition(snapshot.theme)?.id ?? null,
        themeHalves: snapshot.themeHalves,
        initialAppearance: snapshot.resolvedTheme,
        catalog: { customThemes: getCustomThemes(), environmentThemes: getEnvironmentThemes() },
      });
      if (decision.kind === "close") close();
      else open(decision.session);
    },
  };
}

export function themeEditorStore(context: FeatureContext): ThemeEditorStore {
  const existing = stores.get(context.registry);
  if (existing !== undefined) return existing;
  const store = createThemeEditorStore(context);
  stores.set(context.registry, store);
  return store;
}
