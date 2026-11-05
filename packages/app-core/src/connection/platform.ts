import {
  ClientPresentation,
  CloudSession,
  PlatformConnectionSource,
  PrimaryEnvironmentAuth,
  RelayDeviceIdentity,
  SshEnvironmentGateway,
} from "@t3tools/client-runtime/platform";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  Connectivity,
  mapRemoteEnvironmentError,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  Wakeups,
} from "@t3tools/client-runtime/connection";
import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import { fetchRemoteEnvironmentDescriptor } from "@t3tools/client-runtime/environment";
import { managedRelayAccountChanges } from "@t3tools/client-runtime/relay";
import { AuthStandardClientScopes } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { clientPresentationMetadata } from "@t3tools/web/src/connection/clientMetadata.ts";
import {
  makeDesktopSshEnvironmentGateway,
  type DesktopSshGatewayBridge,
} from "@t3tools/web/src/connection/sshGateway.ts";

import { makeConnectionStorageLayer } from "./storage.ts";

export interface PrimaryServerEndpoint {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly bootstrapToken: string;
}

export interface ConnectionPlatformOptions {
  readonly server: PrimaryServerEndpoint | null;
  readonly sshGateway: DesktopSshGatewayBridge;
  readonly platform: string;
  readonly dataDirectory: string;
  readonly registry: AtomRegistry.AtomRegistry;
}

const PLATFORM_POLL_INTERVAL = "3 seconds";

const DESKTOP_BEARER_CLIENT_METADATA = {
  label: "Local Studio Desktop",
  deviceType: "desktop",
} as const;

export function makeConnectionPlatformLayer(options: ConnectionPlatformOptions) {
  const connectivityLayer = Connectivity.layer({
    status: Effect.succeed("unknown"),
    changes: Stream.never,
  });

  const wakeupsLayer = Wakeups.layer({
    changes: managedRelayAccountChanges(options.registry).pipe(
      Stream.map(() => "credentials-changed" as const),
    ),
  });

  const capabilitiesLayer = Layer.effectContext(
    Effect.gen(function* () {
      const bearerTokenRef = yield* Ref.make(Option.none<string>());
      const bearerLock = yield* Semaphore.make(1);
      const server = options.server;
      const exchangeBearerToken =
        server === null
          ? Effect.succeedNone
          : bearerLock.withPermits(1)(
              Effect.gen(function* () {
                const cached = yield* Ref.get(bearerTokenRef);
                if (Option.isSome(cached)) return cached;
                const session = yield* bootstrapRemoteBearerSession({
                  httpBaseUrl: server.httpBaseUrl,
                  credential: server.bootstrapToken,
                  clientMetadata: DESKTOP_BEARER_CLIENT_METADATA,
                }).pipe(
                  Effect.provide(FetchHttpClient.layer),
                  Effect.mapError(
                    (cause) =>
                      new ConnectionTransientError({
                        reason: "remote-unavailable",
                        detail: `Could not load the desktop primary credential: ${String(cause)}`,
                      }),
                  ),
                );
                const token = Option.some(session.access_token);
                yield* Ref.set(bearerTokenRef, token);
                return token;
              }),
            );
      return Context.make(
        CloudSession,
        CloudSession.of({
          identity: Effect.succeedNone,
          clerkToken: Effect.fail(
            new ConnectionBlockedError({
              reason: "authentication",
              detail: "Sign in to T3 Connect to connect this environment.",
            }),
          ),
        }),
      ).pipe(
        Context.add(
          PrimaryEnvironmentAuth,
          PrimaryEnvironmentAuth.of({ bearerToken: exchangeBearerToken }),
        ),
        Context.add(RelayDeviceIdentity, RelayDeviceIdentity.of({ deviceId: Effect.succeedNone })),
        Context.add(
          ClientPresentation,
          ClientPresentation.of({
            metadata: clientPresentationMetadata({
              appVersion: "0.0.0",
              hosted: false,
              identity: { userAgent: "", platform: options.platform, maxTouchPoints: 0 },
              desktopBridge: { getClientPlatform: () => options.platform },
            }),
            scopes: AuthStandardClientScopes,
          }),
        ),
        Context.add(
          SshEnvironmentGateway,
          makeDesktopSshEnvironmentGateway(() => options.sshGateway),
        ),
      );
    }),
  );

  const platformConnectionSourceLayer = Layer.effect(
    PlatformConnectionSource,
    Effect.gen(function* () {
      const server = options.server;
      if (server === null) return PlatformConnectionSource.of({ registrations: Stream.empty });
      const registrationRef = yield* Ref.make(Option.none<PrimaryConnectionRegistration>());
      const loadPrimaryRegistration = Effect.gen(function* () {
        const cached = yield* Ref.get(registrationRef);
        if (Option.isSome(cached)) return [cached.value];
        const built = yield* fetchRemoteEnvironmentDescriptor({
          httpBaseUrl: server.httpBaseUrl,
        }).pipe(
          Effect.mapError(mapRemoteEnvironmentError),
          Effect.map(
            (descriptor) =>
              new PrimaryConnectionRegistration({
                target: new PrimaryConnectionTarget({
                  environmentId: descriptor.environmentId,
                  label: descriptor.label,
                  httpBaseUrl: server.httpBaseUrl,
                  wsBaseUrl: server.wsBaseUrl,
                }),
              }),
          ),
          Effect.tapError((error) =>
            Effect.logWarning("Could not discover the primary environment.", { error }),
          ),
          Effect.option,
        );
        if (Option.isNone(built)) return [];
        yield* Ref.set(registrationRef, built);
        return [built.value];
      }).pipe(Effect.provide(FetchHttpClient.layer));
      return PlatformConnectionSource.of({
        registrations: Stream.tick(PLATFORM_POLL_INTERVAL).pipe(
          Stream.mapEffect(() => loadPrimaryRegistration),
        ),
      });
    }),
  );

  return Layer.mergeAll(
    makeConnectionStorageLayer(options.dataDirectory),
    connectivityLayer,
    wakeupsLayer,
    capabilitiesLayer,
    platformConnectionSourceLayer,
  );
}
