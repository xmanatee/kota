/**
 * Typed daemon-link transport surface.
 *
 * Modules consume this interface (or a module-owned wrapper built on top
 * of it) to call daemon HTTP routes. They do not import
 * `DaemonControlClient` for non-namespace transport methods. The
 * underlying `node:fetch` plumbing, bearer token, and
 * `.kota/daemon-control.json` reads stay inside `src/core/server/`.
 *
 * Two request shapes:
 *  - `request<T>` returns null on transport failures (network error,
 *    aborted fetch, non-OK HTTP status). Use this when the caller wants to
 *    fall back gracefully on daemon-down (e.g. web/api proxy handlers).
 *  - `requestStrict<T>` throws on transport failures. Use this for typed
 *    namespace handlers that surface daemon failures via thrown errors.
 *
 * `events()` opens the shared SSE stream and yields decoded events. It
 * returns immediately if the stream cannot be opened.
 */
import type {
  DaemonControlAddress,
  DaemonSseStreamEvent,
} from "#core/daemon/daemon-control.js";
import { readLiveDaemonControlAddress } from "./daemon-control-address.js";

const DEFAULT_FETCH_TIMEOUT_MS = 2_000;

export type DaemonRequestInit = {
  /** Abort signal for long-running calls. */
  signal?: AbortSignal;
  /** Override the default 2s timeout (ms). */
  timeoutMs?: number;
  /** Skip the default JSON content-type/body encoding. The caller supplies
   * a fully formed body and headers (used for binary uploads such as the
   * voice transcription endpoint). */
  raw?: boolean;
  /** Extra headers merged after the bearer token. */
  headers?: Record<string, string>;
};

export interface DaemonTransport {
  /** Daemon base URL (`http://127.0.0.1:<port>`). Exposed for callers that
   * need to construct fully qualified URLs (e.g. SSE consumers under test). */
  readonly baseUrl: string;

  /** Bearer authorization headers, or empty when the daemon was started with `noAuth`. */
  authHeaders(): Record<string, string>;

  /**
   * Send an HTTP request to the daemon. Returns null when the daemon is
   * unreachable or returns a non-OK status.
   */
  request<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: DaemonRequestInit,
  ): Promise<T | null>;

  /**
   * Send an HTTP request to the daemon and throw on transport or non-OK
   * status. Decodes the response body as JSON.
   */
  requestStrict<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: DaemonRequestInit,
  ): Promise<T>;

  /**
   * Open the daemon SSE stream and yield decoded events. Returns
   * immediately if the stream cannot be opened.
   */
  events(init?: { signal?: AbortSignal }): AsyncGenerator<DaemonSseStreamEvent>;

  /**
   * Issue a raw fetch against the daemon. Used by callers that need the
   * full Response (status code, multipart body, custom decoding).
   */
  fetchRaw(path: string, init?: RequestInit): Promise<Response>;
}

class HttpDaemonTransport implements DaemonTransport {
  constructor(
    public readonly baseUrl: string,
    private readonly token: string | undefined,
  ) {}

  authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: DaemonRequestInit,
  ): Promise<T | null> {
    try {
      const res = await this.send(method, path, body, init);
      if (!res.ok) return null;
      if (res.status === 204) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async requestStrict<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: DaemonRequestInit,
  ): Promise<T> {
    const res = await this.send(method, path, body, init);
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (typeof errBody.error === "string") detail = errBody.error;
      } catch {
        // body is not JSON; use HTTP status as the detail.
      }
      throw new Error(detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    return fetch(url, {
      ...init,
      headers: { ...this.authHeaders(), ...(init?.headers as Record<string, string>) },
    });
  }

  async *events(init?: { signal?: AbortSignal }): AsyncGenerator<DaemonSseStreamEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/events`, {
        headers: this.authHeaders(),
        ...(init?.signal !== undefined && { signal: init.signal }),
      });
      if (!res.ok || !res.body) return;
    } catch {
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          if (!message.trim()) continue;
          const lines = message.split("\n");
          let id = "";
          let eventType = "";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("id: ")) id = line.slice(4).trim();
            else if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          if (id && eventType && data) {
            try {
              yield {
                id,
                type: eventType,
                payload: JSON.parse(data),
              } as DaemonSseStreamEvent;
            } catch (err) {
              console.warn(
                "[kota-daemon-transport] Failed to parse daemon SSE event:",
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch (err) {
        console.warn(
          "[kota-daemon-transport] Failed to cancel daemon SSE reader:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    init?: DaemonRequestInit,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (init?.signal) {
      if (init.signal.aborted) controller.abort();
      else
        init.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const headers: Record<string, string> = { ...this.authHeaders() };
    let payload: BodyInit | undefined;

    if (init?.raw === true) {
      payload = body as BodyInit | undefined;
      Object.assign(headers, init?.headers ?? {});
    } else if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
      Object.assign(headers, init?.headers ?? {});
    } else {
      Object.assign(headers, init?.headers ?? {});
    }

    try {
      return await fetch(url, {
        method,
        headers,
        ...(payload !== undefined && { body: payload }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function daemonTransportFromAddress(
  address: DaemonControlAddress,
): DaemonTransport {
  return new HttpDaemonTransport(
    `http://127.0.0.1:${address.port}`,
    typeof address.token === "string" ? address.token : undefined,
  );
}

/**
 * Resolve the live daemon transport from `<stateDir>/daemon-control.json`,
 * or null when no daemon is reachable.
 */
export function getDaemonTransport(stateDir?: string): DaemonTransport | null {
  const address = readLiveDaemonControlAddress(stateDir);
  if (!address) return null;
  return daemonTransportFromAddress(address);
}
