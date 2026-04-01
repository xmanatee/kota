import type { DaemonSseEvent } from "./daemon-control-types.js";

export type BufferedEvent = { event: DaemonSseEvent; timestamp: number };

/**
 * Fixed-capacity circular buffer for recent daemon SSE events.
 * When full, new events overwrite the oldest entry.
 */
export class EventRingBuffer {
  private readonly buf: BufferedEvent[];
  private head = 0;
  private size = 0;

  constructor(private readonly maxSize: number = 500) {
    this.buf = new Array(maxSize);
  }

  push(event: DaemonSseEvent, timestamp = Date.now()): void {
    this.buf[this.head] = { event, timestamp };
    this.head = (this.head + 1) % this.maxSize;
    if (this.size < this.maxSize) this.size++;
  }

  /**
   * Returns buffered events in chronological order (oldest first).
   * @param sinceMs - Only return events with timestamp > sinceMs. Omit for all.
   * @param limit - Maximum number of events to return (from the newest end).
   */
  query(sinceMs?: number, limit?: number): BufferedEvent[] {
    if (this.size === 0) return [];

    const startIdx = this.size < this.maxSize ? 0 : this.head;
    let result: BufferedEvent[] = [];
    for (let i = 0; i < this.size; i++) {
      const entry = this.buf[(startIdx + i) % this.maxSize];
      if (sinceMs == null || entry.timestamp > sinceMs) {
        result.push(entry);
      }
    }
    if (limit != null && result.length > limit) {
      result = result.slice(result.length - limit);
    }
    return result;
  }
}
