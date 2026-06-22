import { Buffer } from "node:buffer";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import {
  type CallbackAddressResolver,
  type CallbackResolvedAddress,
  resolvePublicCallbackAddresses,
} from "./push-notification-callback-hosts.js";

type CallbackDeliveryFetchOptions = {
  fetchImpl?: typeof fetch;
  resolver?: CallbackAddressResolver;
};

export async function createCallbackDeliveryFetch(
  rawUrl: string,
  options: CallbackDeliveryFetchOptions = {},
): Promise<typeof fetch> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("callback URL must use http or https");
  }

  const shouldResolve = options.fetchImpl === undefined || options.resolver !== undefined;
  const resolved = shouldResolve
    ? firstResolvedAddress(await resolvePublicCallbackAddresses(parsed.hostname, options.resolver))
    : null;

  const injectedFetch = options.fetchImpl;
  if (injectedFetch) {
    return async (input, init) => {
      assertSameCallbackUrl(input, parsed);
      return injectedFetch(parsed.toString(), {
        ...init,
        redirect: "manual",
      });
    };
  }

  return async (input, init) => {
    assertSameCallbackUrl(input, parsed);
    return requestPinnedCallback(parsed, init, resolved);
  };
}

function firstResolvedAddress(addresses: readonly CallbackResolvedAddress[]): CallbackResolvedAddress {
  const [first] = addresses;
  if (!first) throw new Error("callback host did not resolve to an address");
  return first;
}

function assertSameCallbackUrl(input: Parameters<typeof fetch>[0], expected: URL): void {
  const actual = urlFromFetchInput(input);
  if (actual.toString() !== expected.toString()) {
    throw new Error("callback delivery fetch received an unexpected URL");
  }
}

function urlFromFetchInput(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  return new URL(input.url);
}

function requestPinnedCallback(
  url: URL,
  init: Parameters<typeof fetch>[1],
  resolved: CallbackResolvedAddress | null,
): Promise<Response> {
  if (!resolved) throw new Error("callback host did not resolve to an address");
  const body = requestBody(init?.body);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestOptions: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
    method: init?.method ?? "GET",
    headers: requestHeaders(init?.headers),
    lookup: pinnedLookup(resolved),
  };

  return new Promise<Response>((resolve, reject) => {
    const req = requestFn(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer | string) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: res.statusCode ?? 500,
          statusText: res.statusMessage,
          headers: responseHeaders(res.headers),
        }));
      });
    });

    const abort = (): void => {
      req.destroy(new Error("callback delivery aborted"));
    };
    if (init?.signal?.aborted) {
      abort();
      return;
    }
    init?.signal?.addEventListener("abort", abort, { once: true });
    req.on("error", reject);
    req.on("close", () => init?.signal?.removeEventListener("abort", abort));
    if (body === undefined) {
      req.end();
    } else {
      req.end(body);
    }
  });
}

function pinnedLookup(resolved: CallbackResolvedAddress): LookupFunction {
  return (_hostname, _options, callback) => {
    callback(null, resolved.address, resolved.family);
  };
}

function requestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const normalized = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) normalized.append(name, item);
      continue;
    }
    normalized.set(name, value);
  }
  return normalized;
}

function requestBody(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new Error("callback delivery fetch received an unsupported request body");
}
