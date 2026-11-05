import { EnvironmentId } from "@t3tools/contracts";
import {
  resolveLoadBalancingEnvironments,
  resolveSavedEnvironments,
} from "@t3tools/web/src/components/settings/ConnectionsSettingsSections.logic.ts";
import {
  buildLoadBalancingSettingsModel,
  LOAD_PREFERENCE_OPTIONS,
  resolveLoadBalancingChange,
  type LoadBalancingSettingsModel,
} from "@t3tools/web/src/components/settings/LoadBalancingSettings.logic.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "../../feature.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

export type SettingsLoadBalancingView = LoadBalancingSettingsModel;

const ChangeParams = Schema.decodeUnknownSync(
  Schema.Struct({
    change: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("set-enabled"), enabled: Schema.Boolean }),
      Schema.Struct({
        kind: Schema.Literal("set-preference"),
        environmentId: EnvironmentId,
        preference: Schema.NullOr(Schema.String),
      }),
    ]),
  }),
);

export function createLoadBalancingSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;

  const environmentsAtom = Atom.make((get) => {
    const environments = get(scope.environmentsAtom);
    const primaryEnvironmentId = get(state.primaryEnvironmentIdAtom);
    return resolveLoadBalancingEnvironments(
      environments.find((environment) => environment.environmentId === primaryEnvironmentId) ??
        null,
      resolveSavedEnvironments(environments),
    );
  });

  const viewAtom = Atom.make((get): SettingsLoadBalancingView | null => {
    if (get(scope.sectionAtom) !== "connections") return null;
    const settings = get(context.clientSettingsAtom);
    const model = buildLoadBalancingSettingsModel({
      environments: get(environmentsAtom),
      loadBalancingEnabled: settings.loadBalancingEnabled,
      loadBalancingWeights: settings.loadBalancingWeights,
      settingsHydrated: true,
    });
    return model.visible ? model : null;
  });

  return {
    views: { settingsLoadBalancing: viewAtom },
    actions: {
      settingsLoadBalancingChange: async (params) => {
        const { change } = ChangeParams(params);
        const weights = registry.get(context.clientSettingsAtom).loadBalancingWeights;
        const patch =
          change.kind === "set-enabled"
            ? resolveLoadBalancingChange(change, weights)
            : resolveLoadBalancingChange(
                {
                  kind: "set-preference",
                  environmentId: change.environmentId,
                  preference:
                    LOAD_PREFERENCE_OPTIONS.find(
                      (option) => String(option.value) === change.preference,
                    )?.value ?? null,
                },
                weights,
              );
        if (patch !== null) {
          await context.updateClientSettings((current) => ({ ...current, ...patch }));
        }
        return null;
      },
    },
  };
}
