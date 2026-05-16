import type { DaemonSseEvent } from "./daemon-control-types.js";

export type BufferedEvent = {
  id: string;
  event: DaemonSseEvent;
  timestamp: number;
};

/**
 * Fixed-capacity circular buffer for recent daemon SSE events.
 * When full, new events overwrite the oldest entry.
 */
export class EventRingBuffer {
  private readonly buf: BufferedEvent[];
  private head = 0;
  private size = 0;
  private nextId = 1;

  constructor(private readonly maxSize: number = 500) {
    this.buf = new Array(maxSize);
  }

  push(event: DaemonSseEvent, timestamp = Date.now()): BufferedEvent {
    const entry = {
      id: `evt-${this.nextId++}`,
      event,
      timestamp,
    };
    this.buf[this.head] = entry;
    this.head = (this.head + 1) % this.maxSize;
    if (this.size < this.maxSize) this.size++;
    return entry;
  }

  /**
   * Returns buffered events in chronological order (oldest first).
   * @param sinceMs - Only return events with timestamp > sinceMs. Omit for all.
   * @param limit - Maximum number of events to return (from the newest end).
   * @param afterId - Only return events after this daemon-local event id.
   */
  query(sinceMs?: number, limit?: number, afterId?: string): BufferedEvent[] {
    if (this.size === 0) return [];

    const startIdx = this.size < this.maxSize ? 0 : this.head;
    const chronological: BufferedEvent[] = [];
    for (let i = 0; i < this.size; i++) {
      const entry = this.buf[(startIdx + i) % this.maxSize];
      chronological.push(entry);
    }

    let result = chronological;
    if (afterId) {
      const afterIndex = chronological.findIndex((entry) => entry.id === afterId);
      result = afterIndex >= 0 ? chronological.slice(afterIndex + 1) : [];
    }

    if (sinceMs != null) {
      result = result.filter((entry) => entry.timestamp > sinceMs);
    }
    if (limit != null && result.length > limit) {
      result = result.slice(result.length - limit);
    }
    return result;
  }
}
