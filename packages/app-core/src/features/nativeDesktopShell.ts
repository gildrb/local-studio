import type { DesktopSshPasswordPromptRequest } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";

export type AppRelaunchView = { readonly revision: number };

export type SshPasswordPromptView = DesktopSshPasswordPromptRequest & {
  readonly expiresInMs: number;
};

const ResolveParams = Schema.decodeUnknownSync(
  Schema.Struct({ requestId: Schema.String, password: Schema.NullOr(Schema.String) }),
);

export function createNativeDesktopShellFeature(context: FeatureContext): CoreFeature {
  const { desktop } = context;
  const relaunchAtom = Atom.make((get): AppRelaunchView => ({
    revision: get(desktop.relaunchRevisionAtom),
  }));
  const quitForUpdateAtom = Atom.make((get): AppRelaunchView => ({
    revision: get(desktop.updates.quitForInstallRevisionAtom),
  }));
  const promptAtom = Atom.make((get): SshPasswordPromptView | null => {
    const request = get(desktop.sshPasswordPromptsAtom)[0];
    if (request === undefined) return null;
    return { ...request, expiresInMs: Math.max(0, Date.parse(request.expiresAt) - Date.now()) };
  });
  return {
    views: {
      appRelaunch: relaunchAtom,
      appQuitForUpdate: quitForUpdateAtom,
      sshPasswordPrompt: promptAtom,
    },
    actions: {
      sshPasswordPromptResolve: async (params) => {
        const { requestId, password } = ResolveParams(params);
        await desktop.resolveSshPasswordPrompt(requestId, password);
        return null;
      },
    },
  };
}
