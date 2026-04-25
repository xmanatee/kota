/**
 * Core contract for the notification hub provider.
 *
 * The implementation lives in the `scheduler` module. Core only holds the
 * contract so the HTTP server (which owns the scheduler timer/bus wiring)
 * and any other consumer can reach the live hub through the provider
 * registry without importing module code.
 */

import type { ScheduledItem } from "#core/daemon/scheduler.js";
import type { SseTransport } from "./session-pool.js";

export type NotificationHubProvider = {
  addClient(client: SseTransport): void;
  removeClient(client: SseTransport): void;
  broadcast(data: Record<string, unknown>): void;
  handleDueItems(dueItems: ScheduledItem[]): void;
};

/** Provider-registry key used to look up the active notification hub. */
export const NOTIFICATION_HUB_PROVIDER_TYPE = "notification-hub";
