import * as http from "node:http";
import httpDefault from "node:http";
import httpsDefault from "node:https";
import { EventEmitter } from "node:events";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeader,
  OutgoingHttpHeaders,
  RequestOptions,
  ServerResponse,
} from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";

type ListenOptions = {
  port?: number;
  host?: string;
  path?: string;
};

type ListenArg = ListenOptions | number | string | (() => void);
type ListenArgs = ListenArg[];

type LoopbackEntry = {
  server: http.Server;
  port: number;
};

type LoopbackState = {
  nextPort: number;
  readonly serversByPort: Map<number, LoopbackEntry>;
  readonly portsByServer: WeakMap<http.Server, number>;
  readonly originalFetch: typeof globalThis.fetch;
  readonly originalListen: typeof http.Server.prototype.listen;
  readonly originalClose: typeof http.Server.prototype.close;
  readonly originalAddress: typeof http.Server.prototype.address;
  readonly originalRequest: typeof httpDefault.request;
  readonly originalGet: typeof httpDefault.get;
  readonly internalFetches: Set<typeof globalThis.fetch>;
};

const INSTALL_KEY = "__kotaLoopbackFetchInstalled";
const REAL_LOOPBACK_KEY = "__kotaRealLoopbackAvailable";
const STATE_KEY = "__kotaLoopbackFetchState";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type LoopbackGlobal = typeof globalThis & {
  [INSTALL_KEY]?: true;
  [REAL_LOOPBACK_KEY]?: boolean;
  [STATE_KEY]?: LoopbackState;
};

const loopbackGlobal = globalThis as LoopbackGlobal;

if (!loopbackGlobal[INSTALL_KEY]) {
  const state: LoopbackState = {
    nextPort: 10_000,
    serversByPort: new Map(),
    portsByServer: new WeakMap(),
    originalFetch: globalThis.fetch.bind(globalThis),
    originalListen: http.Server.prototype.listen,
    originalClose: http.Server.prototype.close,
    originalAddress: http.Server.prototype.address,
    originalRequest: httpDefault.request,
    originalGet: httpDefault.get,
    internalFetches: new Set(),
  };
  state.internalFetches.add(state.originalFetch);
  loopbackGlobal[INSTALL_KEY] = true;
  loopbackGlobal[STATE_KEY] = state;
  const realLoopbackAvailable = await realLoopbackWorks(state.originalFetch);
  loopbackGlobal[REAL_LOOPBACK_KEY] = realLoopbackAvailable;
  if (!realLoopbackAvailable) {
    installLoopback(state);
  }
  installMockFetchRequestBridge(state);
}

async function realLoopbackWorks(fetchImpl: typeof globalThis.fetch): Promise<boolean> {
  const probe = httpDefault.createServer((_req, res) => {
    res.end("ok");
  });
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      probe.close(() => resolve(ok));
    };
    probe.once("error", () => finish(false));
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      fetchImpl(`http://127.0.0.1:${port}`)
        .then(async (res) => finish(res.status === 200 && (await res.text()) === "ok"))
        .catch(() => finish(false));
    });
  });
}

function installLoopback(state: LoopbackState): void {
  http.Server.prototype.listen = function patchedListen(
    this: http.Server,
    ...args: ListenArgs
  ): http.Server {
    const parsed = parseListenArgs(args);
    if (!parsed.loopback) {
      return Reflect.apply(state.originalListen, this, args) as http.Server;
    }

    const port = parsed.port && parsed.port > 0 ? parsed.port : allocatePort(state);
    if (state.serversByPort.has(port)) {
      queueMicrotask(() => {
        const err = Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`), {
          code: "EADDRINUSE",
          errno: -48,
          syscall: "listen",
          address: "127.0.0.1",
          port,
        });
        this.emit("error", err);
      });
      return this;
    }

    state.serversByPort.set(port, { server: this, port });
    state.portsByServer.set(this, port);
    Object.defineProperty(this, "listening", {
      configurable: true,
      get: () => state.portsByServer.has(this),
    });

    queueMicrotask(() => {
      this.emit("listening");
      parsed.callback?.();
    });
    return this;
  } as typeof http.Server.prototype.listen;

  http.Server.prototype.close = function patchedClose(
    this: http.Server,
    callback?: (err?: Error) => void,
  ): http.Server {
    const port = state.portsByServer.get(this);
    if (port === undefined) {
      return Reflect.apply(state.originalClose, this, callback ? [callback] : []) as http.Server;
    }

    state.serversByPort.delete(port);
    state.portsByServer.delete(this);
    Object.defineProperty(this, "listening", {
      configurable: true,
      get: () => false,
    });
    queueMicrotask(() => {
      this.emit("close");
      callback?.();
    });
    return this;
  } as typeof http.Server.prototype.close;

  http.Server.prototype.address = function patchedAddress(
    this: http.Server,
  ): ReturnType<typeof http.Server.prototype.address> {
    const port = state.portsByServer.get(this);
    if (port !== undefined) {
      return { address: "127.0.0.1", family: "IPv4", port };
    }
    return Reflect.apply(state.originalAddress, this, []) as ReturnType<typeof http.Server.prototype.address>;
  };

  const loopbackFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const port = Number.parseInt(url.port, 10);
    if (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      Number.isInteger(port) &&
      state.serversByPort.has(port)
    ) {
      return dispatchLoopbackRequest(state.serversByPort.get(port)!.server, request, url);
    }
    return state.originalFetch(input, init);
  };
  globalThis.fetch = loopbackFetch;
  state.internalFetches.add(loopbackFetch);

  httpDefault.request = function patchedRequest(
    ...args: Parameters<typeof httpDefault.request>
  ): ClientRequest {
    const parsed = parseHttpRequestArgs(args);
    const port = Number.parseInt(parsed.url.port, 10);
    if (
      parsed.url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(parsed.url.hostname) &&
      Number.isInteger(port) &&
      state.serversByPort.has(port)
    ) {
      return createLoopbackClientRequest(
        state.serversByPort.get(port)!.server,
        parsed.url,
        parsed.options,
        parsed.callback,
      );
    }
    return Reflect.apply(state.originalRequest, httpDefault, args) as ClientRequest;
  } as typeof httpDefault.request;

  httpDefault.get = function patchedGet(
    ...args: Parameters<typeof httpDefault.get>
  ): ClientRequest {
    const req = Reflect.apply(httpDefault.request, httpDefault, args) as ClientRequest;
    req.end();
    return req;
  } as typeof httpDefault.get;

  syncBuiltinESMExports();
}

function installMockFetchRequestBridge(state: LoopbackState): void {
  const downstreamHttpRequest = httpDefault.request;
  const downstreamHttpsRequest = httpsDefault.request;

  httpDefault.request = function patchedRequest(
    ...args: Parameters<typeof httpDefault.request>
  ): ClientRequest {
    const parsed = parseHttpRequestArgs(args);
    if (shouldBridgeToMockFetch(state)) {
      return createFetchBackedClientRequest(parsed.url, parsed.options, parsed.callback);
    }
    return Reflect.apply(downstreamHttpRequest, httpDefault, args) as ClientRequest;
  } as typeof httpDefault.request;

  httpsDefault.request = function patchedHttpsRequest(
    ...args: Parameters<typeof httpsDefault.request>
  ): ClientRequest {
    const parsed = parseHttpRequestArgs(args as Parameters<typeof httpDefault.request>);
    if (shouldBridgeToMockFetch(state)) {
      return createFetchBackedClientRequest(parsed.url, parsed.options, parsed.callback);
    }
    return Reflect.apply(downstreamHttpsRequest, httpsDefault, args) as ClientRequest;
  } as typeof httpsDefault.request;

  syncBuiltinESMExports();
}

function shouldBridgeToMockFetch(state: LoopbackState): boolean {
  return !state.internalFetches.has(globalThis.fetch);
}

function parseListenArgs(args: ListenArgs): {
  callback?: () => void;
  loopback: boolean;
  port?: number;
} {
  const callback = args.findLast((arg): arg is () => void => typeof arg === "function");
  const first = args[0];

  if (typeof first === "object" && first !== null) {
    if (first.path !== undefined) return { callback, loopback: false };
    const host = first.host ?? "127.0.0.1";
    return {
      callback,
      loopback: isLoopbackHost(host),
      port: first.port ?? 0,
    };
  }

  if (typeof first === "number") {
    const hostArg = args.find((arg): arg is string => typeof arg === "string");
    const host = hostArg ?? "127.0.0.1";
    return { callback, loopback: isLoopbackHost(host), port: first };
  }

  return { callback, loopback: false };
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

function parseHttpRequestArgs(args: Parameters<typeof httpDefault.request>): {
  callback?: (res: IncomingMessage) => void;
  options: RequestOptions;
  url: URL;
} {
  const callback = args.findLast((arg): arg is (res: IncomingMessage) => void => typeof arg === "function");
  const first = args[0];
  const second = args[1];
  const options = isRequestOptions(second)
    ? second
    : isRequestOptions(first)
      ? first
      : {};

  if (first instanceof URL) {
    return { callback, options, url: applyRequestOptions(first, options) };
  }
  if (typeof first === "string") {
    return { callback, options, url: applyRequestOptions(new URL(first), options) };
  }

  const protocol = options.protocol ?? "http:";
  const host = options.hostname ?? options.host ?? "localhost";
  const port = options.port === undefined ? "" : `:${String(options.port)}`;
  const path = options.path ?? "/";
  return { callback, options, url: new URL(`${protocol}//${String(host)}${port}${path}`) };
}

function isRequestOptions(value: unknown): value is RequestOptions {
  return typeof value === "object" && value !== null && !(value instanceof URL);
}

function applyRequestOptions(url: URL, options: RequestOptions): URL {
  const next = new URL(url);
  if (options.protocol) next.protocol = options.protocol;
  if (options.hostname) next.hostname = String(options.hostname);
  if (options.host) next.host = String(options.host);
  if (options.port !== undefined) next.port = String(options.port);
  if (options.path) {
    const path = String(options.path);
    const splitAt = path.indexOf("?");
    if (splitAt === -1) {
      next.pathname = path;
      next.search = "";
    } else {
      next.pathname = path.slice(0, splitAt);
      next.search = path.slice(splitAt);
    }
  }
  return next;
}

function allocatePort(state: LoopbackState): number {
  while (state.serversByPort.has(state.nextPort)) {
    state.nextPort += 1;
  }
  const port = state.nextPort;
  state.nextPort += 1;
  return port;
}

async function dispatchLoopbackRequest(
  server: http.Server,
  request: Request,
  url: URL,
): Promise<Response> {
  const req = await createIncomingMessage(request, url);
  return new Promise<Response>((resolve, reject) => {
    const response = createServerResponse(resolve);
    const abort = () => {
      req.destroy();
      response.res.emit("close");
      response.closeBody();
    };
    if (request.signal.aborted) {
      abort();
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    request.signal.addEventListener("abort", abort, { once: true });
    response.onDone(() => {
      request.signal.removeEventListener("abort", abort);
    });
    try {
      server.emit("request", req, response.res);
    } catch (err) {
      response.closeBody();
      reject(err);
    }
  });
}

function createLoopbackClientRequest(
  server: http.Server,
  url: URL,
  options: RequestOptions,
  callback?: (res: IncomingMessage) => void,
): ClientRequest {
  const chunks: Buffer[] = [];
  const controller = new AbortController();
  let ended = false;
  const req = new EventEmitter() as ClientRequest;

  req.write = (chunk: string | Uint8Array) => {
    chunks.push(Buffer.from(toBytes(chunk)));
    return true;
  };
  req.end = (chunk?: string | Uint8Array) => {
    if (chunk !== undefined) req.write(chunk);
    if (ended) return req;
    ended = true;
    const method = String(options.method ?? "GET");
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const headers = headersInitFromRequestOptions(options.headers);
    const request = new Request(url, {
      body,
      headers,
      method,
      signal: controller.signal,
    });
    dispatchLoopbackRequest(server, request, url)
      .then((response) => {
        const incoming = incomingMessageFromResponse(response, controller);
        callback?.(incoming);
        req.emit("response", incoming);
      })
      .catch((err) => {
        req.emit("error", err);
      });
    return req;
  };
  req.destroy = (err?: Error) => {
    controller.abort();
    if (err) req.emit("error", err);
    req.emit("close");
    return req;
  };
  return req;
}

function createFetchBackedClientRequest(
  url: URL,
  options: RequestOptions,
  callback?: (res: IncomingMessage) => void,
): ClientRequest {
  const chunks: Buffer[] = [];
  const controller = new AbortController();
  let ended = false;
  const req = new EventEmitter() as ClientRequest;
  const written: Array<string | Uint8Array> = [];

  req.write = (chunk: string | Uint8Array) => {
    written.push(chunk);
    chunks.push(Buffer.from(toBytes(chunk)));
    return true;
  };
  req.end = (chunk?: string | Uint8Array) => {
    if (chunk !== undefined) req.write(chunk);
    if (ended) return req;
    ended = true;
    const method = String(options.method ?? "GET");
    const body = requestBodyFromWrittenChunks(written, chunks);
    const headers = headersObjectFromRequestOptions(options.headers);
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    const init: RequestInit = { headers, method };
    if (body !== undefined) init.body = body;
    if (controller.signal.aborted || options.signal) init.signal = controller.signal;
    validateRequestLookup(url, options)
      .then(() => globalThis.fetch(url.toString(), init))
      .then((response) => {
        const incoming = incomingMessageFromFetchResponse(response, controller);
        callback?.(incoming);
        req.emit("response", incoming);
      })
      .catch((err) => {
        req.emit("error", err);
      });
    return req;
  };
  req.destroy = (err?: Error) => {
    controller.abort();
    if (err) req.emit("error", err);
    req.emit("close");
    return req;
  };
  return req;
}

function requestBodyFromWrittenChunks(
  written: Array<string | Uint8Array>,
  chunks: Buffer[],
): BodyInit | undefined {
  if (written.length === 0) return undefined;
  if (written.length === 1 && typeof written[0] === "string") return written[0];
  return Buffer.concat(chunks);
}

function validateRequestLookup(url: URL, options: RequestOptions): Promise<void> {
  if (typeof options.lookup !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    options.lookup!(url.hostname, {}, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function headersInitFromRequestOptions(headers: RequestOptions["headers"]): HeadersInit {
  const out = new Headers();
  if (!headers) return out;
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out.set(name, value.map(String).join(", "));
    } else {
      out.set(name, String(value));
    }
  }
  return out;
}

function headersObjectFromRequestOptions(headers: RequestOptions["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[name] = value.map(String).join(", ");
    } else {
      out[name] = String(value);
    }
  }
  return out;
}

function incomingMessageFromResponse(
  response: Response,
  controller: AbortController,
): IncomingMessage {
  const readable = response.body
    ? Readable.fromWeb(response.body)
    : Readable.from([]);
  const incoming = readable as IncomingMessage;
  incoming.statusCode = response.status;
  incoming.statusMessage = response.statusText;
  incoming.headers = incomingHeadersFromResponse(response.headers);
  incoming.rawHeaders = rawHeadersFromRequest(response.headers);
  const originalDestroy = incoming.destroy.bind(incoming);
  incoming.destroy = (err?: Error) => {
    controller.abort();
    return originalDestroy(err);
  };
  return incoming;
}

function incomingMessageFromFetchResponse(
  response: Response,
  controller: AbortController,
): IncomingMessage {
  const incoming = lazyReadableFromFetchResponse(response) as IncomingMessage;
  incoming.statusCode = response.status;
  incoming.statusMessage = response.statusText;
  incoming.headers = incomingHeadersFromFetchHeaders(response.headers);
  incoming.rawHeaders = rawHeadersFromIncomingHeaders(incoming.headers);
  const originalDestroy = incoming.destroy.bind(incoming);
  incoming.destroy = (err?: Error) => {
    controller.abort();
    return originalDestroy(err);
  };
  return incoming;
}

function incomingHeadersFromResponse(headers: Headers): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

const FETCH_HEADER_NAMES = [
  "content-type",
  "content-length",
  "location",
  "set-cookie",
  "x-request-id",
  "x-ratelimit-remaining",
  "x-ratelimit-limit",
  "x-ratelimit-reset",
  "retry-after",
  "www-authenticate",
  "allow",
  "link",
];

function incomingHeadersFromFetchHeaders(headers: Response["headers"]): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const name of FETCH_HEADER_NAMES) {
    const value = headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function rawHeadersFromIncomingHeaders(headers: IncomingHttpHeaders): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) out.push(name, item);
    } else {
      out.push(name, value);
    }
  }
  return out;
}

function lazyReadableFromFetchResponse(response: Response): Readable {
  if (response.body instanceof ReadableStream) {
    return Readable.fromWeb(response.body);
  }

  let started = false;
  return new Readable({
    read() {
      if (started) return;
      started = true;
      readFetchResponseBody(response)
        .then((body) => {
          if (body.length > 0) this.push(body);
          this.push(null);
        })
        .catch((err) => {
          this.destroy(err);
        });
    },
    destroy(err, callback) {
      cancelFetchResponseBody(response);
      callback(err);
    },
  });
}

async function readFetchResponseBody(response: Response): Promise<Buffer> {
  if (typeof response.arrayBuffer === "function") {
    const buffer = await response.arrayBuffer();
    if (buffer !== undefined) return Buffer.from(buffer);
  }
  if (typeof response.text === "function") {
    return Buffer.from(await response.text());
  }
  return Buffer.alloc(0);
}

function cancelFetchResponseBody(response: Response): void {
  const body = response.body as { readonly locked?: boolean; cancel?: () => Promise<unknown> } | null;
  if (!body?.cancel || body.locked) return;
  const cancelled = body.cancel();
  if (cancelled && typeof cancelled.catch === "function") {
    void cancelled.catch(() => undefined);
  }
}

async function createIncomingMessage(request: Request, url: URL): Promise<IncomingMessage> {
  const bodyBuffer = Buffer.from(await request.arrayBuffer());
  const chunks = bodyBuffer.length > 0 ? [bodyBuffer] : [];
  const req = Readable.from(chunks) as IncomingMessage;
  req.method = request.method;
  req.url = `${url.pathname}${url.search}`;
  req.headers = headersFromRequest(request.headers);
  req.rawHeaders = rawHeadersFromRequest(request.headers);
  return req;
}

function headersFromRequest(headers: Headers): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function rawHeadersFromRequest(headers: Headers): string[] {
  const out: string[] = [];
  headers.forEach((value, key) => {
    out.push(key, value);
  });
  return out;
}

function createServerResponse(resolve: (response: Response) => void): {
  closeBody: () => void;
  onDone: (fn: () => void) => void;
  res: ServerResponse;
} {
  const headers = new Headers();
  const headerValues = new Map<string, OutgoingHttpHeader>();
  const doneCallbacks: Array<() => void> = [];
  let status = 200;
  let headersSent = false;
  let closed = false;
  let resolved = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
    },
  });

  const res = new http.ServerResponse({ method: "GET" } as IncomingMessage);

  const resolveOnce = () => {
    if (resolved) return;
    resolved = true;
    headersSent = true;
    const responseBody = status === 204 || status === 205 || status === 304 ? null : body;
    resolve(new Response(responseBody, { headers, status }));
  };

  const closeBody = () => {
    if (closed) return;
    closed = true;
    resolveOnce();
    controller.close();
    for (const fn of doneCallbacks) fn();
  };

  res.setHeader = (name: string, value: number | string | readonly string[]) => {
    setHeaderValue(headers, headerValues, name, value);
    return res;
  };
  res.getHeader = (name: string) => headerValues.get(name.toLowerCase());
  res.getHeaders = () => Object.fromEntries(headerValues);
  res.hasHeader = (name: string) => headerValues.has(name.toLowerCase());
  res.removeHeader = (name: string) => {
    headerValues.delete(name.toLowerCase());
    headers.delete(name);
  };
  res.writeHead = (
    statusCode: number,
    statusMessageOrHeaders?: string | OutgoingHttpHeaders | readonly [string, string][],
    headersArg?: OutgoingHttpHeaders | readonly [string, string][],
  ) => {
    status = statusCode;
    const nextHeaders = typeof statusMessageOrHeaders === "string" ? headersArg : statusMessageOrHeaders;
    if (nextHeaders) applyHeaders(headers, headerValues, nextHeaders);
    resolveOnce();
    return res;
  };
  res.write = (chunk: string | Uint8Array) => {
    resolveOnce();
    if (!closed) controller.enqueue(toBytes(chunk));
    return true;
  };
  res.end = (chunk?: string | Uint8Array) => {
    if (chunk !== undefined) res.write(chunk);
    closeBody();
    return res;
  };

  Object.defineProperty(res, "headersSent", {
    configurable: true,
    get: () => headersSent,
  });
  Object.defineProperty(res, "writableEnded", {
    configurable: true,
    get: () => closed,
  });

  return {
    closeBody,
    onDone: (fn) => {
      doneCallbacks.push(fn);
    },
    res,
  };
}

function applyHeaders(
  headers: Headers,
  headerValues: Map<string, OutgoingHttpHeader>,
  values: OutgoingHttpHeaders | readonly [string, string][],
): void {
  if (Array.isArray(values)) {
    for (const [name, value] of values) setHeaderValue(headers, headerValues, name, value);
    return;
  }
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) setHeaderValue(headers, headerValues, name, value);
  }
}

function setHeaderValue(
  headers: Headers,
  headerValues: Map<string, OutgoingHttpHeader>,
  name: string,
  value: OutgoingHttpHeader,
): void {
  headerValues.set(name.toLowerCase(), value);
  if (Array.isArray(value)) {
    headers.set(name, value.join(", "));
  } else {
    headers.set(name, String(value));
  }
}

function toBytes(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
}
