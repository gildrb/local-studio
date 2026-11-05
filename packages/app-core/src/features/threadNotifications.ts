import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  resolveThreadNotificationEvents,
  type ThreadNotificationKind,
  type ThreadNotificationMemory,
} from "@t3tools/web/src/threadNotifications.logic.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "../feature.ts";

export type NativeNotificationPermission = "granted" | "denied" | "default" | "error";

export type ThreadNotificationRequest = {
  readonly id: number;
  readonly tag: string;
  readonly title: string;
  readonly body: string;
};

export type ThreadNotificationsView = {
  readonly notifications: ReadonlyArray<ThreadNotificationRequest>;
  readonly closed: ReadonlyArray<{ readonly id: number; readonly tag: string }>;
  readonly badge: number;
  readonly sound: { readonly id: number; readonly kind: ThreadNotificationKind } | null;
  readonly permissionRequest: number | null;
};

type PendingNotification = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
};

export type ThreadNotificationsService = {
  readonly permissionAtom: Atom.Atom<NativeNotificationPermission>;
  readonly requestPermission: () => Promise<NativeNotificationPermission>;
};

const PermissionSchema = Schema.Literals(["granted", "denied", "default", "error"]);
const decodePermission = Schema.decodeUnknownSync(Schema.Struct({ permission: PermissionSchema }));
const decodeFocused = Schema.decodeUnknownSync(Schema.Struct({ focused: Schema.Boolean }));
const decodeTag = Schema.decodeUnknownSync(Schema.Struct({ tag: Schema.String }));

const RETAINED_REQUESTS = 32;

type Internals = ThreadNotificationsService & {
  readonly viewAtom: Atom.Writable<ThreadNotificationsView>;
  readonly windowFocusedAtom: Atom.Writable<boolean>;
  readonly setPermission: (permission: NativeNotificationPermission) => void;
};

const services = new WeakMap<AtomRegistry.AtomRegistry, Internals>();

function internals(context: FeatureContext): Internals {
  const existing = services.get(context.registry);
  if (existing !== undefined) return existing;
  const { registry } = context;
  const permissionAtom = Atom.make<NativeNotificationPermission>("default").pipe(Atom.keepAlive);
  const viewAtom = Atom.make<ThreadNotificationsView>({
    notifications: [],
    closed: [],
    badge: 0,
    sound: null,
    permissionRequest: null,
  }).pipe(Atom.keepAlive);
  const windowFocusedAtom = Atom.make(true).pipe(Atom.keepAlive);
  const waiters: Array<(permission: NativeNotificationPermission) => void> = [];
  let requestId = 0;
  const service: Internals = {
    permissionAtom,
    viewAtom,
    windowFocusedAtom,
    setPermission: (permission) => {
      registry.set(permissionAtom, permission);
      const view = registry.get(viewAtom);
      if (view.permissionRequest !== null)
        registry.set(viewAtom, { ...view, permissionRequest: null });
      for (const resolve of waiters.splice(0)) resolve(permission);
    },
    requestPermission: () => {
      requestId += 1;
      registry.set(viewAtom, { ...registry.get(viewAtom), permissionRequest: requestId });
      const { promise, resolve } = Promise.withResolvers<NativeNotificationPermission>();
      waiters.push(resolve);
      return promise;
    },
  };
  services.set(registry, service);
  return service;
}

export function threadNotificationsService(context: FeatureContext): ThreadNotificationsService {
  return internals(context);
}

export function createThreadNotificationsFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const service = internals(context);
  const pending = new Map<string, PendingNotification>();
  const memories = new Map<EnvironmentId, ReadonlyMap<ThreadId, ThreadNotificationMemory>>();
  const unsubscribes = new Map<EnvironmentId, () => void>();
  let nextId = 0;

  const publish = (patch: Partial<ThreadNotificationsView>) =>
    registry.set(service.viewAtom, { ...registry.get(service.viewAtom), ...patch });

  const closeTags = (tags: ReadonlyArray<string>) => {
    if (tags.length === 0) return;
    for (const tag of tags) pending.delete(tag);
    const view = registry.get(service.viewAtom);
    const closed = tags.map((tag) => {
      nextId += 1;
      return { id: nextId, tag };
    });
    publish({
      notifications: view.notifications.filter((request) => !tags.includes(request.tag)),
      closed: [...view.closed, ...closed].slice(-RETAINED_REQUESTS),
      badge: pending.size,
    });
  };

  const clearAll = () => closeTags([...pending.keys()]);

  const mode = () => registry.get(context.clientSettingsAtom).notificationMode;

  const handleEnvironment = (environmentId: EnvironmentId) => {
    const shell = registry.get(state.environmentShell.stateValueAtom(environmentId));
    if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
      memories.set(environmentId, new Map());
      return;
    }
    const settings = registry.get(context.clientSettingsAtom);
    if (settings.notificationMode === "off" && !settings.inAppNotificationsEnabled) {
      memories.delete(environmentId);
      return;
    }
    const { next, events } = resolveThreadNotificationEvents(
      memories.get(environmentId) ?? new Map(),
      shell.snapshot.value.threads,
    );
    memories.set(environmentId, next);
    const focused = registry.get(service.windowFocusedAtom);
    const route = registry.get(context.routeAtom);
    for (const event of events) {
      if (hasNotificationSound(settings.notificationMode)) {
        nextId += 1;
        publish({ sound: { id: nextId, kind: event.kind } });
      }
      if (
        settings.inAppNotificationsEnabled &&
        focused &&
        (route?.environmentId !== environmentId || route.threadId !== event.threadId)
      ) {
        const toastId = context.addToast({
          layout: "plain",
          type: event.toastType,
          title: event.title,
          description: event.threadTitle,
          action: {
            label: "Open thread",
            onClick: () => {
              context.closeToast(toastId);
              context.navigateToThread({ environmentId, threadId: event.threadId });
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(settings.notificationMode) ||
        focused ||
        registry.get(service.permissionAtom) !== "granted"
      ) {
        continue;
      }
      const tag = `${environmentId}:${event.threadId}`;
      nextId += 1;
      pending.set(tag, { environmentId, threadId: event.threadId });
      const view = registry.get(service.viewAtom);
      publish({
        notifications: [
          ...view.notifications.filter((request) => request.tag !== tag),
          { id: nextId, tag, title: event.title, body: event.threadTitle },
        ].slice(-RETAINED_REQUESTS),
        badge: pending.size,
      });
    }
  };

  const syncEnvironments = (environmentIds: ReadonlyArray<EnvironmentId>) => {
    const active = new Set(environmentIds);
    for (const [environmentId, unsubscribe] of unsubscribes) {
      if (active.has(environmentId)) continue;
      unsubscribe();
      unsubscribes.delete(environmentId);
      memories.delete(environmentId);
    }
    closeTags(
      [...pending.entries()]
        .filter(([, notification]) => !active.has(notification.environmentId))
        .map(([tag]) => tag),
    );
    for (const environmentId of environmentIds) {
      if (unsubscribes.has(environmentId)) continue;
      unsubscribes.set(
        environmentId,
        registry.subscribe(
          state.environmentShell.stateValueAtom(environmentId),
          () => handleEnvironment(environmentId),
          { immediate: true },
        ),
      );
    }
  };

  registry.subscribe(
    Atom.make((get) => [...get(state.environmentPresentations.presentationsAtom).keys()]),
    syncEnvironments,
    { immediate: true },
  );

  let lastMode = mode();
  registry.subscribe(context.clientSettingsAtom, (settings) => {
    if (settings.notificationMode === lastMode) return;
    lastMode = settings.notificationMode;
    clearAll();
  });

  return {
    views: { threadNotifications: service.viewAtom },
    actions: {
      threadNotificationsPermission: async (params) => {
        service.setPermission(decodePermission(params).permission);
        return null;
      },
      threadNotificationsWindowFocus: async (params) => {
        const { focused } = decodeFocused(params);
        registry.set(service.windowFocusedAtom, focused);
        if (focused && hasDesktopNotifications(mode())) clearAll();
        return null;
      },
      threadNotificationsClear: async () => {
        clearAll();
        return null;
      },
      threadNotificationsOpen: async (params) => {
        const { tag } = decodeTag(params);
        const notification = pending.get(tag);
        closeTags([tag]);
        if (notification !== undefined) {
          context.navigateToThread({
            environmentId: notification.environmentId,
            threadId: notification.threadId,
          });
        }
        return null;
      },
    },
  };
}
