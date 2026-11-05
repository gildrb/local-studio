import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "@t3tools/web/src/appearanceFonts.ts";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

export type TypographyAdvancedStore = {
  readonly atom: Atom.Atom<boolean>;
  readonly set: (advanced: boolean) => void;
};

const AdvancedJson = Schema.fromJsonString(Schema.Boolean);
const decodeAdvanced = Schema.decodeUnknownSync(AdvancedJson);
const encodeAdvanced = Schema.encodeSync(AdvancedJson);

const stores = new WeakMap<Storage, TypographyAdvancedStore>();

function readAdvanced(storage: Storage): boolean {
  try {
    const stored = storage.getItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY);
    return stored === null ? false : decodeAdvanced(stored);
  } catch {
    return false;
  }
}

export function typographyAdvancedStore(
  storage: Storage,
  registry: AtomRegistry.AtomRegistry,
): TypographyAdvancedStore {
  const existing = stores.get(storage);
  if (existing !== undefined) return existing;
  const atom = Atom.make(readAdvanced(storage)).pipe(Atom.keepAlive);
  const store: TypographyAdvancedStore = {
    atom,
    set: (advanced) => {
      try {
        storage.setItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY, encodeAdvanced(advanced));
      } catch {
        return;
      }
      registry.set(atom, advanced);
    },
  };
  stores.set(storage, store);
  return store;
}
