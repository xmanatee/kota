/**
 * Notification hub — manages SSE notification clients for the scheduler
 * module's `/api/notifications` route and broadcasts due-item reminders.
 *
 * The HTTP server registers this hub as a provider (via the scheduler
 * module's `onLoad`) and looks it up to wire the scheduler bus and timer
 * callbacks. Module-local routes resolve the same hub through the
 * `getNotificationHub()` accessor.
 */

import type { ScheduledItem } from "#core/daemon/scheduler.js";
import type { NotificationHubProvider } from "#core/server/notification-hub-provider.js";
import type { SseTransport } from "#core/server/session-pool.js";

export class NotificationHub implements NotificationHubProvider {
  private clients = new Set<SseTransport>();

  addClient(client: SseTransport): void {
    this.clients.add(client);
  }

  removeClient(client: SseTransport): void {
    this.clients.delete(client);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  broadcast(data: Record<string, unknown>): void {
    for (const client of this.clients) {
      if (client.isClosed) {
        this.clients.delete(client);
        continue;
      }
      client.send("notification", data);
    }
  }

  /** Handle due items from the scheduler timer. */
  handleDueItems(dueItems: ScheduledItem[]): void {
    for (const item of dueItems) {
      this.broadcast({
        type: "reminder",
        id: item.id,
        description: item.description,
        scheduledFor: item.triggerAt,
        repeat: item.repeatLabel || null,
      });
    }
  }
}

let instance: NotificationHub | null = null;

export function getNotificationHub(): NotificationHub {
  if (!instance) instance = new NotificationHub();
  return instance;
}

export function resetNotificationHub(): void {
  instance = null;
}
