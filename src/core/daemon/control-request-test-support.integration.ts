import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import type { DaemonRawRequestInit } from "#core/server/daemon-transport.js";
import type { DaemonControlServer } from "./daemon-control.js";

// Replace only HTTP byte transport when a sandbox cannot bind a listener.
type InProcessControlDispatcher = {
  handleRequest(req: IncomingMessage, res: ServerResponse): void;
};

function responseHeaderValue(value: number | string | readonly string[]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export async function dispatchControlRequest(
  server: DaemonControlServer,
  token: string,
  method: string,
  path: string,
  init: DaemonRawRequestInit = {},
): Promise<Response> {
  const suppliedHeaders = new Headers(init.headers);
  if (!suppliedHeaders.has("authorization")) {
    suppliedHeaders.set("authorization", `Bearer ${token}`);
  }
  const requestHeaders: Record<string, string> = {};
  suppliedHeaders.forEach((value, name) => {
    requestHeaders[name.toLowerCase()] = value;
  });
  const requestBody = init.body === undefined || init.body === null
    ? []
    : [Buffer.from(String(init.body))];
  const req = Object.assign(Readable.from(requestBody), {
    headers: requestHeaders,
    method,
    url: path,
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;

  return await new Promise<Response>((resolveResponse, rejectResponse) => {
    const chunks: Buffer[] = [];
    const headers = new Headers();
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    }) as unknown as ServerResponse;
    res.statusCode = 200;
    let headersSent = false;
    Object.defineProperty(res, "headersSent", {
      configurable: true,
      get: () => headersSent,
    });
    res.setHeader = (name, value) => {
      headers.set(name, responseHeaderValue(value));
      return res;
    };
    res.getHeader = (name) => headers.get(name) ?? undefined;
    res.hasHeader = (name) => headers.has(name);
    res.removeHeader = (name) => headers.delete(name);
    res.writeHead = ((statusCode: number, reasonOrHeaders?: unknown, maybeHeaders?: unknown) => {
      res.statusCode = statusCode;
      headersSent = true;
      const rawHeaders = typeof reasonOrHeaders === "object" && reasonOrHeaders !== null
        ? reasonOrHeaders
        : maybeHeaders;
      if (typeof rawHeaders === "object" && rawHeaders !== null) {
        for (const [name, value] of Object.entries(rawHeaders)) {
          if (value !== undefined) headers.set(name, responseHeaderValue(value));
        }
      }
      return res;
    }) as ServerResponse["writeHead"];
    res.once("finish", () => {
      resolveResponse(new Response(Buffer.concat(chunks), {
        status: res.statusCode,
        headers,
      }));
    });
    res.once("error", rejectResponse);
    try {
      (server as unknown as InProcessControlDispatcher).handleRequest(req, res);
    } catch (error) {
      rejectResponse(error);
    }
  });
}

