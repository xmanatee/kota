import { join } from "node:path";
import type { ModuleContext } from "#core/modules/module-types.js";
import { getDaemonTransport } from "#core/server/daemon-transport.js";
import {
  type A2ABackend,
  DaemonA2ABackend,
} from "./daemon-session-client.js";
import type { CallbackAddressResolver } from "./push-notification-callback-hosts.js";
import { A2APushNotificationManager } from "./push-notifications.js";

export type A2ARouteOptions = {
  backendFactory?: () => A2ABackend | null;
  pushNotificationFetch?: typeof fetch;
  pushNotificationAddressResolver?: CallbackAddressResolver;
  pushNotifications?: A2APushNotificationManager;
};

const sharedPushNotificationManagers = new Map<string, A2APushNotificationManager>();

export function backendFactoryFor(
  ctx: ModuleContext,
  options: A2ARouteOptions,
): () => A2ABackend | null {
  return options.backendFactory ?? (() => {
    const transport = getDaemonTransport(join(ctx.cwd, ".kota"));
    return transport ? new DaemonA2ABackend(transport) : null;
  });
}

export function pushNotificationManagerFor(
  ctx: ModuleContext,
  options: A2ARouteOptions,
): A2APushNotificationManager {
  if (options.pushNotifications) return options.pushNotifications;
  if (
    options.backendFactory ||
    options.pushNotificationFetch ||
    options.pushNotificationAddressResolver
  ) {
    return new A2APushNotificationManager(
      ctx.storage,
      ctx.log,
      options.pushNotificationFetch,
      undefined,
      options.pushNotificationAddressResolver,
    );
  }

  const storageDir = ctx.storage.getDir();
  const existing = sharedPushNotificationManagers.get(storageDir);
  if (existing) return existing;

  const manager = new A2APushNotificationManager(ctx.storage, ctx.log);
  sharedPushNotificationManagers.set(storageDir, manager);
  return manager;
}

export function resumeStoredA2APushNotificationSubscriptions(
  ctx: ModuleContext,
  options: A2ARouteOptions = {},
): void {
  const pushNotifications = pushNotificationManagerFor(ctx, options);
  pushNotifications.startStoredTaskSubscriptions(backendFactoryFor(ctx, options));
}

export function stopSharedA2APushNotificationManagers(): void {
  for (const manager of sharedPushNotificationManagers.values()) {
    manager.stop();
  }
  sharedPushNotificationManagers.clear();
}
