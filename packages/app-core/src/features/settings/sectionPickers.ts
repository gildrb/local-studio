import { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderOptions } from "@t3tools/web/src/components/chat/TraitsPicker.logic.ts";
import * as Schema from "effect/Schema";
import type { Atom } from "effect/unstable/reactivity";

import type { FeatureAction, FeatureContext } from "../../feature.ts";
import {
  createSettingsModelPickers,
  resolveSettingsTraitsSelection,
  type SettingsModelPickerPopupView,
  type SettingsModelPickerSource,
} from "./modelPickers.ts";

export type SectionPickerBinding = {
  readonly source: () => SettingsModelPickerSource | null;
  readonly select: (instanceId: ProviderInstanceId, model: string) => Promise<void>;
  readonly traits: (options: ProviderOptions | undefined) => Promise<void>;
};

export type SectionPickers = {
  readonly reset: () => void;
  readonly popup: (
    get: Atom.AtomContext,
    sources: Readonly<Record<string, SettingsModelPickerSource | null>>,
  ) => SettingsModelPickerPopupView | null;
  readonly actions: Readonly<Record<string, FeatureAction>>;
};

const PickerParams = Schema.decodeUnknownSync(Schema.Struct({ picker: Schema.String }));
const SearchParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const RailParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const InstanceParams = Schema.decodeUnknownSync(Schema.Struct({ instanceId: ProviderInstanceId }));
const ModelParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: ProviderInstanceId, slug: Schema.String }),
);
const TraitsParams = Schema.decodeUnknownSync(
  Schema.Struct({ picker: Schema.String, descriptorId: Schema.String, value: Schema.String }),
);

export function createSectionPickers(
  context: FeatureContext,
  prefix: string,
  bindings: Readonly<Record<string, SectionPickerBinding>>,
): SectionPickers {
  const { registry } = context;
  const pickers = createSettingsModelPickers({
    registry,
    platform: context.platform,
    updateClientSettings: context.updateClientSettings,
  });

  const openBinding = () => {
    const picker = pickers.openPicker();
    if (picker === null) return null;
    const binding = bindings[picker];
    return binding === undefined ? null : { picker, binding };
  };

  return {
    reset: () => pickers.close(),
    popup: (get, sources) => {
      const state = get(pickers.stateAtom);
      const keybindings = get(context.state.primaryServerConfigAtom)?.keybindings ?? [];
      for (const [picker, source] of Object.entries(sources)) {
        if (source === null) continue;
        const popup = pickers.popup(state, picker, source, keybindings);
        if (popup !== null) return popup;
      }
      return null;
    },
    actions: {
      [`${prefix}PickerOpen`]: async (params) => {
        const { picker } = PickerParams(params);
        if (pickers.openPicker() === picker) {
          pickers.close();
          return null;
        }
        const source = bindings[picker]?.source() ?? null;
        if (source !== null) pickers.open(picker, source);
        return null;
      },
      [`${prefix}PickerClose`]: async () => {
        pickers.close();
        return null;
      },
      [`${prefix}PickerSearch`]: async (params) => {
        pickers.setSearch(SearchParams(params).query);
        return null;
      },
      [`${prefix}PickerRail`]: async (params) => {
        const { id } = RailParams(params);
        pickers.setRail(id === "favorites" ? "favorites" : ProviderInstanceId.make(id));
        return null;
      },
      [`${prefix}PickerToggleLegacy`]: async (params) => {
        pickers.toggleLegacy(InstanceParams(params).instanceId);
        return null;
      },
      [`${prefix}PickerFavorite`]: async (params) => {
        const { instanceId, slug } = ModelParams(params);
        await pickers.toggleFavorite(instanceId, slug);
        return null;
      },
      [`${prefix}PickerSetup`]: async (params) => {
        InstanceParams(params);
        pickers.close();
        context.navigate({ kind: "settings", section: "providers" });
        return null;
      },
      [`${prefix}PickerSelect`]: async (params) => {
        const open = openBinding();
        if (open === null) return null;
        const source = open.binding.source();
        if (source === null) return null;
        const { instanceId, slug } = ModelParams(params);
        const selection = pickers.resolveSelection(source, instanceId, slug);
        if (selection === null) return null;
        pickers.close();
        await open.binding.select(selection.instanceId, selection.model);
        return null;
      },
      [`${prefix}TraitsSelect`]: async (params) => {
        const { picker, descriptorId, value } = TraitsParams(params);
        const binding = bindings[picker];
        if (binding === undefined) return null;
        const source = binding.source();
        if (source === null || source.traits === null) return null;
        const options = resolveSettingsTraitsSelection(source.traits, descriptorId, value);
        if (options === null) return null;
        await binding.traits(options.next);
        return null;
      },
    },
  };
}
