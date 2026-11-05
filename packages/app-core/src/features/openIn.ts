import * as NodeServices from "@effect/platform-node/NodeServices";
import { EditorId } from "@t3tools/contracts";
import { probeRemoteCapableEditors } from "@t3tools/shared/editor";
import {
  buildOpenInToolbarModel,
  resolveOpenInEditorIntent,
  resolveOpenInEffectiveEditors,
  runOpenInEditorIntent,
  type OpenInToolbarModel,
} from "@t3tools/web/src/components/chat/OpenInPicker.logic.ts";
import {
  readLastEditor,
  resolveEffectivePreferredEditor,
  writeLastEditor,
} from "@t3tools/web/src/editorPreferences.logic.ts";
import { setLocalStorageItem } from "@t3tools/web/src/lib/localStorageItem.ts";
import {
  readRemoteOpenHintSeen,
  REMOTE_FALLBACK_EDITORS,
  REMOTE_OPEN_HINT_KEY,
  resolveProbedRemoteEditors,
  resolveRemoteOpenResolution,
} from "@t3tools/web/src/remoteOpen.logic.ts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";

export type OpenInUrlRequest = {
  readonly id: number;
  readonly url: string;
};

export type OpenInView = {
  readonly picker: OpenInToolbarModel | null;
  readonly urlRequest: OpenInUrlRequest | null;
};

const OpenInEditorParams = Schema.decodeUnknownSync(
  Schema.Struct({ editorId: Schema.NullOr(EditorId), cwd: Schema.optional(Schema.String) }),
);
const UrlOpenedParams = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.Number, opened: Schema.Boolean }),
);

export function createOpenInFeature(context: FeatureContext): CoreFeature {
  const { registry, state, platform } = context;
  const lastEditorAtom = Atom.make(readLastEditor()).pipe(Atom.keepAlive);
  const hintSeenAtom = Atom.make(readRemoteOpenHintSeen()).pipe(Atom.keepAlive);
  const remoteCapableAtom = Atom.make(REMOTE_FALLBACK_EDITORS).pipe(Atom.keepAlive);
  const urlRequestAtom = Atom.make<OpenInUrlRequest | null>(null).pipe(Atom.keepAlive);
  const pendingUrls = new Map<number, (opened: boolean) => void>();
  let nextUrlRequestId = 1;

  void Effect.runPromise(
    probeRemoteCapableEditors(process.env).pipe(Effect.provide(NodeServices.layer)),
  ).then(
    (ids) => registry.set(remoteCapableAtom, resolveProbedRemoteEditors(ids)),
    () => undefined,
  );

  const contextAtom = Atom.make((get) => {
    const input = get(context.threadInputAtom);
    if (input === null) return null;
    const environmentId = input.thread.environmentId;
    const presentation =
      get(state.environmentPresentations.presentationsAtom).get(environmentId) ?? null;
    const remote = resolveRemoteOpenResolution(presentation, true).state;
    const effectiveEditors = resolveOpenInEffectiveEditors({
      remoteMode: remote.mode,
      availableEditors: input.serverConfig?.availableEditors ?? [],
      remoteCapableEditors: get(remoteCapableAtom),
    });
    return {
      environmentId,
      openInCwd: get(context.gitStatusAtom)?.gitCwd ?? null,
      remote,
      effectiveEditors,
      preferredEditor: resolveEffectivePreferredEditor(get(lastEditorAtom), effectiveEditors),
      environmentLabel: presentation?.entry.target.label ?? null,
      keybindings: input.serverConfig?.keybindings ?? [],
    };
  });

  const openInAtom = Atom.make((get): OpenInView => {
    const current = get(contextAtom);
    return {
      picker:
        current === null
          ? null
          : buildOpenInToolbarModel({
              platform,
              effectiveEditors: current.effectiveEditors,
              preferredEditor: current.preferredEditor,
              openInCwd: current.openInCwd,
              remoteMode: current.remote.mode,
              remoteHintSeen: get(hintSeenAtom),
              environmentLabel: current.environmentLabel,
              keybindings: current.keybindings,
            }),
      urlRequest: get(urlRequestAtom),
    };
  });

  const openRemoteUrl = (url: string) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const id = nextUrlRequestId++;
    pendingUrls.set(id, resolve);
    registry.set(urlRequestAtom, { id, url });
    return promise;
  };

  return {
    views: { openIn: openInAtom },
    actions: {
      openInEditor: async (params) => {
        const { editorId, cwd: targetCwd } = OpenInEditorParams(params);
        const current = registry.get(contextAtom);
        if (current === null) return null;
        await runOpenInEditorIntent(
          resolveOpenInEditorIntent({
            editorId,
            preferredEditor: current.preferredEditor,
            openInCwd: targetCwd ?? current.openInCwd,
            remote: current.remote,
          }),
          {
            openRemoteUrl,
            openLocal: ({ editor, cwd }) =>
              runAtomCommand(
                registry,
                state.shellEnvironment.openInEditor,
                { environmentId: current.environmentId, input: { cwd, editor } },
                { label: "open in editor" },
              ),
            markRemoteHintSeen: () => {
              setLocalStorageItem(REMOTE_OPEN_HINT_KEY, true, Schema.Boolean);
              registry.set(hintSeenAtom, true);
            },
            setPreferredEditor: (editor) => {
              writeLastEditor(editor);
              registry.set(lastEditorAtom, editor);
            },
          },
        );
        return null;
      },
      openInUrlOpened: async (params) => {
        const { id, opened } = UrlOpenedParams(params);
        const resolve = pendingUrls.get(id);
        pendingUrls.delete(id);
        if (registry.get(urlRequestAtom)?.id === id) registry.set(urlRequestAtom, null);
        resolve?.(opened);
        return null;
      },
    },
  };
}
