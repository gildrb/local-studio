import * as Path from "node:path";

import { Connection } from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import { threadSnapshotLoaderLayer } from "@t3tools/client-runtime/state/threads";
import { pullRequestDiffLoaderLayer } from "@t3tools/client-runtime/state/pull-requests";
import { RelayWebClientId } from "@t3tools/contracts/relay";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Semaphore from "effect/Semaphore";
import * as Socket from "effect/unstable/socket/Socket";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import {
  browserCryptoLayer,
  createBrowserDpopProof,
  generateBrowserDpopKey,
  type BrowserDpopKey,
} from "@t3tools/web/src/cloud/dpop.ts";

import { makeConnectionPlatformLayer, type PrimaryServerEndpoint } from "./platform.ts";
import type { DesktopSshGatewayBridge } from "@t3tools/web/src/connection/sshGateway.ts";

const RELAY_URL_UNCONFIGURED = "http://relay.invalid";

const relayDpopSignerLayer = Layer.effect(
  ManagedRelay.ManagedRelayDpopSigner,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const keyLock = yield* Semaphore.make(1);
    let loadedKey: BrowserDpopKey | null = null;
    const loadKey = keyLock.withPermit(
      Effect.gen(function* () {
        if (loadedKey !== null) return loadedKey;
        loadedKey = yield* generateBrowserDpopKey;
        return loadedKey;
      }),
    );
    return ManagedRelay.ManagedRelayDpopSigner.of({
      thumbprint: loadKey.pipe(
        Effect.map((key) => key.thumbprint),
        Effect.mapError(
          (cause) =>
            new ManagedRelay.ManagedRelayDpopKeyLoadError({ keyStore: "indexed-db", cause }),
        ),
      ),
      createProof: Effect.fn("gpuiCore.managedRelayDpopSigner.createProof")(function* (input) {
        const proofKey = yield* loadKey.pipe(
          Effect.mapError(
            (cause) =>
              new ManagedRelay.ManagedRelayDpopProofCreationError({
                method: input.method,
                url: input.url,
                cause,
              }),
          ),
        );
        return yield* createBrowserDpopProof({ ...input, proofKey }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.map((proof) => proof.proof),
          Effect.mapError(
            (cause) =>
              new ManagedRelay.ManagedRelayDpopProofCreationError({
                method: input.method,
                url: input.url,
                cause,
              }),
          ),
        );
      }),
    });
  }),
);

export interface CoreConnectionOptions {
  readonly server: PrimaryServerEndpoint | null;
  readonly sshGateway: DesktopSshGatewayBridge;
  readonly platform: string;
  readonly t3Home: string;
  readonly registry: AtomRegistry.AtomRegistry;
}

export function makeConnectionAtomRuntime(options: CoreConnectionOptions) {
  const httpClientLayer = remoteHttpClientLayer((input, init) => globalThis.fetch(input, init));
  const foundationLayer = Layer.mergeAll(
    httpClientLayer,
    browserCryptoLayer,
    Socket.layerWebSocketConstructorGlobal,
    ManagedRelay.layer({ relayUrl: RELAY_URL_UNCONFIGURED, clientId: RelayWebClientId }).pipe(
      Layer.provideMerge(relayDpopSignerLayer),
      Layer.provide(Layer.mergeAll(httpClientLayer, browserCryptoLayer)),
    ),
  );
  const foundation = ManagedRuntime.make(foundationLayer);
  const runtimeContextLayer = Layer.effectContext(foundation.contextEffect);

  const platformLayer = makeConnectionPlatformLayer({
    server: options.server,
    sshGateway: options.sshGateway,
    platform: options.platform,
    dataDirectory: Path.join(options.t3Home, "gpui-core"),
    registry: options.registry,
  }).pipe(Layer.provide(runtimeContextLayer));

  const snapshotLoaderLayer = Layer.mergeAll(
    threadSnapshotLoaderLayer,
    shellSnapshotLoaderLayer,
    pullRequestDiffLoaderLayer,
  );

  const connectionLayer = snapshotLoaderLayer.pipe(
    Layer.provideMerge(
      Connection.layerWithOptions({
        environmentThemes: true,
        usageLimitSources: true,
        usageLimitsCommand: true,
      }),
    ),
    Layer.provideMerge(Layer.mergeAll(runtimeContextLayer, platformLayer)),
  );

  return {
    runtime: Atom.runtime(connectionLayer),
    dispose: () => foundation.dispose(),
  };
}
