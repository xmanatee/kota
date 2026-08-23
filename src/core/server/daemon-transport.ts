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
 * `events()` opens the shared SSE stream and yields decoded events. Transport
 * failures are surfaced to the stream consumer.
 */
import type {
  DaemonControlAddress,
  DaemonSseStreamEvent,
} from "#core/daemon/daemon-control.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import {
  OUTBOUND_HTTP_PROFILES,
  type OutboundHttpMethod,
  outboundHttp,
} from "#core/outbound-http/index.js";
import { readLiveDaemonControlAddress } from "./daemon-control-address.js";

const DEFAULT_FETCH_TIMEOUT_MS = 2_000;
const MAX_SSE_FRAME_CHARS = 1_000_000;

export type DaemonRawRequestInit = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
};

function daemonHttpMethod(method: string | undefined): OutboundHttpMethod {
  const normalized = method?.toUpperCase() ?? "GET";
  switch (normalized) {
    case "GET":
    case "HEAD":
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
    case "OPTIONS":
      return normalized;
    default:
      throw new TypeError(`Unsupported daemon HTTP method: ${method}`);
  }
}

function daemonHeaders(
  authorization: Record<string, string>,
  supplied?: HeadersInit,
): Headers {
  const headers = new Headers(authorization);
  if (supplied !== undefined) {
    new Headers(supplied).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function parseDaemonSseFrame(frame: string): DaemonSseStreamEvent | null {
  const lines = frame.split("\n");
  if (lines.every((line) => line.length === 0 || line.startsWith(":"))) {
    return null;
  }
  let id = "";
  let eventType = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("id:")) id = line.slice(3).trimStart();
    else if (line.startsWith("event:")) eventType = line.slice(6).trimStart();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (id.length === 0 || eventType.length === 0 || dataLines.length === 0) {
    throw new Error("Daemon SSE frame is missing id, event, or data");
  }
  return {
    id,
    type: eventType,
    payload: JSON.parse(dataLines.join("\n")),
  } as DaemonSseStreamEvent;
}

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
   * Open the daemon SSE stream and yield decoded events.
   */
  events(init?: { signal?: AbortSignal }): AsyncGenerator<DaemonSseStreamEvent>;

  /**
   * Issue a raw fetch against the daemon. Used by callers that need the
   * full Response (status code, multipart body, custom decoding).
   */
  fetchRaw(path: string, init?: DaemonRawRequestInit): Promise<Response>;
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

  async fetchRaw(path: string, init?: DaemonRawRequestInit): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const { response } = await outboundHttp.requestStream({
      profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
      operation: "daemon-transport.raw",
      url,
      method: daemonHttpMethod(init?.method),
      headers: daemonHeaders(this.authHeaders(), init?.headers),
      ...(init?.body !== undefined && init.body !== null && { body: init.body }),
      ...(init?.signal != null && { signal: init.signal }),
    });
    return response;
  }

  async *events(init?: { signal?: AbortSignal }): AsyncGenerator<DaemonSseStreamEvent> {
    const { response: res } = await outboundHttp.requestStream(
      {
        profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
        operation: "daemon-transport.events",
        url: `${this.baseUrl}/events`,
        headers: this.authHeaders(),
        ...(init?.signal !== undefined && { signal: init.signal }),
      },
      { responseBodyLimit: "caller-managed" },
    );
    if (!res.ok) {
      throw new Error(`Daemon SSE stream failed with HTTP ${res.status}`);
    }
    if (!res.body) throw new Error("Daemon SSE response has no body");

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
        if (buffer.length > MAX_SSE_FRAME_CHARS) {
          throw new Error(`Daemon SSE frame exceeds ${MAX_SSE_FRAME_CHARS} characters`);
        }

        for (const message of messages) {
          if (!message.trim()) continue;
          if (message.length > MAX_SSE_FRAME_CHARS) {
            throw new Error(`Daemon SSE frame exceeds ${MAX_SSE_FRAME_CHARS} characters`);
          }
          const event = parseDaemonSseFrame(message);
          if (event !== null) yield event;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        const event = parseDaemonSseFrame(buffer);
        if (event !== null) yield event;
      }
    } finally {
      try {
        await reader.cancel();
      } catch (err) {
        printTerminalDiagnostic(
          "[kota-daemon-transport] Failed to cancel daemon SSE reader:",
          "warn",
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
    const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const headers = daemonHeaders(this.authHeaders(), init?.headers);
    let payload: BodyInit | undefined;

    if (init?.raw === true) {
      payload = body as BodyInit | undefined;
    } else if (body !== undefined && body !== null) {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }

    const { response } = await outboundHttp.requestStream({
      profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
      operation: "daemon-transport.request",
      url,
      method: daemonHttpMethod(method),
      headers,
      ...(payload !== undefined && { body: payload }),
      ...(init?.signal !== undefined && { signal: init.signal }),
      limits: { timeoutMs },
    });
    return response;
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
