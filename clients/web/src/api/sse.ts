import { getAuthToken } from "./client";
import type { DaemonSseEventType } from "./types";

type SseHandler = (data: Record<string, unknown>) => void;

export class DaemonEventSource {
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<SseHandler>>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEventTimestamp: string | null = null;
  private onStatusChange?: (
    status: "connected" | "reconnecting" | "disconnected",
  ) => void;

  constructor(opts?: {
    onStatusChange?: (
      status: "connected" | "reconnecting" | "disconnected",
    ) => void;
  }) {
    this.onStatusChange = opts?.onStatusChange;
  }

  on(event: DaemonSseEventType | string, handler: SseHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);

    if (this.source) {
      this.source.addEventListener(event, this.makeSseListener(event));
    }

    return () => {
      set?.delete(handler);
      if (set?.size === 0) this.handlers.delete(event);
    };
  }

  connect(): void {
    if (this.source) return;

    const params = new URLSearchParams();
    const token = getAuthToken();
    if (token) params.set("token", token);
    if (this.lastEventTimestamp) params.set("since", this.lastEventTimestamp);

    const url = `/api/daemon/events${params.size ? `?${params}` : ""}`;
    const src = new EventSource(url);
    this.source = src;

    src.onopen = () => {
      this.onStatusChange?.("connected");
    };

    for (const event of this.handlers.keys()) {
      src.addEventListener(event, this.makeSseListener(event));
    }

    src.onerror = () => {
      src.close();
      this.source = null;
      this.onStatusChange?.("reconnecting");
      this.retryTimer = setTimeout(() => this.connect(), 10000);
    };
  }

  disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.onStatusChange?.("disconnected");
  }

  private makeSseListener(event: string) {
    return (e: Event) => {
      this.lastEventTimestamp = new Date().toISOString();
      const messageEvent = e as MessageEvent;
      try {
        const data = JSON.parse(messageEvent.data) as Record<string, unknown>;
        const handlers = this.handlers.get(event);
        if (handlers) {
          for (const handler of handlers) handler(data);
        }
      } catch {
        // ignore parse errors
      }
    };
  }
}
