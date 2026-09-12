import { DAEMON_WIDE_EVENT_TYPES } from "../../../conformance/daemon-contract.generated";
import { getAuthToken } from "./client";

type SseHandler = (data: Record<string, unknown>) => void;
type MalformedSseHandler = (details: {
  event: string;
  raw: string;
  error: Error;
}) => void;

export class DaemonEventSource {
  private source: EventSource | null = null;
  private subscriptions = new Map<
    string,
    { handlers: Set<SseHandler>; listener: EventListener }
  >();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEventId: string | null = null;
  private readonly scopeId?: string;
  private onStatusChange?: (
    status: "connected" | "reconnecting" | "disconnected",
  ) => void;
  private onMalformedEvent?: MalformedSseHandler;

  constructor(opts?: {
    scopeId?: string;
    onStatusChange?: (
      status: "connected" | "reconnecting" | "disconnected",
    ) => void;
    onMalformedEvent?: MalformedSseHandler;
  }) {
    this.scopeId = opts?.scopeId;
    this.onStatusChange = opts?.onStatusChange;
    this.onMalformedEvent = opts?.onMalformedEvent;
  }

  on(event: string, handler: SseHandler): () => void {
    let subscription = this.subscriptions.get(event);
    if (!subscription) {
      subscription = {
        handlers: new Set(),
        listener: this.makeSseListener(event),
      };
      this.subscriptions.set(event, subscription);
      if (this.source) {
        subscription.listener = this.makeSseListener(event, this.source);
        this.source.addEventListener(event, subscription.listener);
      }
    }
    subscription.handlers.add(handler);
    return () => {
      subscription.handlers.delete(handler);
      if (
        subscription.handlers.size === 0 &&
        this.subscriptions.get(event) === subscription
      ) {
        this.source?.removeEventListener(event, subscription.listener);
        this.subscriptions.delete(event);
      }
    };
  }

  connect(): void {
    if (this.source) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const params = new URLSearchParams();
    const token = getAuthToken();
    if (token) params.set("token", token);
    if (this.scopeId !== undefined) params.set("scopeId", this.scopeId);
    if (this.lastEventId) params.set("after", this.lastEventId);

    const url = `/api/daemon/events${params.size ? `?${params}` : ""}`;
    const src = new EventSource(url);
    this.source = src;

    src.onopen = () => {
      if (this.source !== src) return;
      this.onStatusChange?.("connected");
    };

    for (const [event, subscription] of this.subscriptions) {
      subscription.listener = this.makeSseListener(event, src);
      src.addEventListener(event, subscription.listener);
    }

    src.onerror = () => {
      if (this.source !== src) return;
      src.close();
      this.source = null;
      this.retryTimer = setTimeout(() => this.connect(), 10000);
      this.onStatusChange?.("reconnecting");
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

  private makeSseListener(event: string, source: EventSource | null = null) {
    return (e: Event) => {
      if (source === null || this.source !== source) return;
      const messageEvent = e as MessageEvent;
      let data: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(messageEvent.data);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("Expected an event payload object");
        }
        data = parsed as Record<string, unknown>;
      } catch (err) {
        this.onMalformedEvent?.({
          event,
          raw: messageEvent.data,
          error: toError(err),
        });
        return;
      }
      if (this.scopeId !== undefined) {
        const matches =
          "scopeId" in data
            ? data.scopeId === this.scopeId
            : DAEMON_WIDE_EVENT_TYPES.some((type) => type === event);
        if (!matches) return;
      }
      if (messageEvent.lastEventId) this.lastEventId = messageEvent.lastEventId;
      const handlers = this.subscriptions.get(event)?.handlers;
      if (handlers) {
        for (const handler of handlers) handler(data);
      }
    };
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
