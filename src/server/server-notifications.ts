/**
 * Notification hub — manages SSE notification clients and due-item reminder dispatching.
 *
 * Extracted from server.ts to:
 * 1. Deduplicate the due-item callback (was copy-pasted for timers)
 * 2. Make notification broadcasting independently testable
 */

import type { ScheduledItem } from "../scheduler/scheduler.js";
import type { SseTransport } from "./session-pool.js";

export class NotificationHub {
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
