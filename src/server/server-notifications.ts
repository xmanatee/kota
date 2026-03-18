/**
 * Notification hub — manages SSE notification clients and due-item dispatching.
 *
 * Extracted from server.ts to:
 * 1. Deduplicate the due-item callback (was copy-pasted for bus and timer)
 * 2. Make notification broadcasting independently testable
 */

import type { ActionExecutor, ActionResult } from "../scheduler/action-executor.js";
import { partitionDueItems } from "../scheduler/action-executor.js";
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

  broadcastActionResult(result: ActionResult): void {
    this.broadcast({
      type: "action_result",
      id: result.item.id,
      description: result.item.description,
      action: result.item.action,
      result: result.result,
      error: result.error || null,
      durationMs: result.durationMs,
    });
  }

  /** Handle due items from scheduler timer or event-bus triggers. */
  handleDueItems(dueItems: ScheduledItem[], actionExecutor: ActionExecutor): void {
    const { actions, notifications } = partitionDueItems(dueItems);

    for (const item of notifications) {
      this.broadcast({
        type: "reminder",
        id: item.id,
        description: item.description,
        scheduledFor: item.triggerAt,
        repeat: item.repeatLabel || null,
      });
    }

    for (const item of actions) {
      if (!actionExecutor.canExecute()) {
        this.broadcast({
          type: "action_skipped",
          id: item.id,
          description: item.description,
          reason: "Too many concurrent actions",
        });
        continue;
      }

      this.broadcast({
        type: "action_started",
        id: item.id,
        description: item.description,
        action: item.action,
      });

      actionExecutor
        .execute(item)
        .then((result) => this.broadcastActionResult(result))
        .catch((err) => {
          console.error(`[kota] Action "${item.description}" error:`, (err as Error).message);
        });
    }
  }
}
