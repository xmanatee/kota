import { describe, expect, it, vi } from "vitest";
import type { ScheduledItem } from "#core/daemon/scheduler.js";
import type { SseTransport } from "#core/server/session-pool.js";
import { NotificationHub } from "./notification-hub.js";

function mockSseClient(closed = false): SseTransport & { sentEvents: Array<{ name: string; data: unknown }> } {
  const sentEvents: Array<{ name: string; data: unknown }> = [];
  return {
    isClosed: closed,
    send: (name: string, data: Record<string, unknown>) => sentEvents.push({ name, data }),
    emit: vi.fn(),
    end: vi.fn(),
    sentEvents,
  } as unknown as SseTransport & { sentEvents: Array<{ name: string; data: unknown }> };
}

function makeItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    id: 1,
    description: "Test item",
    triggerAt: "2026-01-01T00:00:00Z",
    status: "pending",
    created: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("NotificationHub", () => {
  describe("broadcast", () => {
    it("sends to all connected clients", () => {
      const hub = new NotificationHub();
      const c1 = mockSseClient();
      const c2 = mockSseClient();
      hub.addClient(c1);
      hub.addClient(c2);

      hub.broadcast({ type: "test", message: "hello" });

      expect(c1.sentEvents).toHaveLength(1);
      expect(c1.sentEvents[0]).toEqual({ name: "notification", data: { type: "test", message: "hello" } });
      expect(c2.sentEvents).toHaveLength(1);
    });

    it("removes closed clients during broadcast", () => {
      const hub = new NotificationHub();
      const alive = mockSseClient(false);
      const dead = mockSseClient(true);
      hub.addClient(alive);
      hub.addClient(dead);

      hub.broadcast({ type: "test" });

      expect(alive.sentEvents).toHaveLength(1);
      expect(dead.sentEvents).toHaveLength(0);
      expect(hub.clientCount).toBe(1);
    });

    it("handles zero clients without error", () => {
      const hub = new NotificationHub();
      expect(() => hub.broadcast({ type: "test" })).not.toThrow();
    });
  });

  describe("handleDueItems", () => {
    it("broadcasts reminders for notification-only items", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();
      hub.addClient(client);

      hub.handleDueItems([makeItem({ id: 5, description: "Meeting", repeatLabel: "daily" })]);

      expect(client.sentEvents).toHaveLength(1);
      const data = client.sentEvents[0].data as Record<string, unknown>;
      expect(data.type).toBe("reminder");
      expect(data.id).toBe(5);
      expect(data.description).toBe("Meeting");
      expect(data.repeat).toBe("daily");
    });

    it("handles empty due items without error", () => {
      const hub = new NotificationHub();

      expect(() => hub.handleDueItems([])).not.toThrow();
    });
  });

  describe("client management", () => {
    it("addClient / removeClient tracks correctly", () => {
      const hub = new NotificationHub();
      const client = mockSseClient();

      hub.addClient(client);
      expect(hub.clientCount).toBe(1);

      hub.removeClient(client);
      expect(hub.clientCount).toBe(0);
    });

    it("removeClient is safe for unknown client", () => {
      const hub = new NotificationHub();
      expect(() => hub.removeClient(mockSseClient())).not.toThrow();
    });
  });
});
