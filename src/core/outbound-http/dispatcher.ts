import type { LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { resolveOutboundAddresses, resolvePublicOutboundAddresses } from "#core/outbound-http/network-policy.js";
import type { OutboundHttpAddressResolver, OutboundHttpDispatcher } from "#core/outbound-http/types.js";

type PublicLookupOptions =
  | number
  | {
      readonly all?: boolean;
      readonly family?: number | "IPv4" | "IPv6";
    };

type PublicLookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export function createDefaultOutboundHttpDispatcher(
  resolveAddresses: OutboundHttpAddressResolver = resolveOutboundAddresses,
): OutboundHttpDispatcher {
  return async (url, init, context) =>
    context.profile === "public-untrusted" ? dispatchPublicRequest(url, init, resolveAddresses) : globalThis.fetch(url, init);
}

async function dispatchPublicRequest(url: URL, init: RequestInit, resolveAddresses: OutboundHttpAddressResolver): Promise<Response> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = requestHeadersFromInit(init.headers);
  const body = await requestBodyFromInit(init.body);
  const options: RequestOptions = {
    method: init.method,
    headers,
    lookup: (hostname, lookupOptions, callback) => {
      lookupPublicAddress(hostname, lookupOptions, callback, resolveAddresses);
    },
  };
  if (init.signal) options.signal = init.signal;

  return new Promise((resolve, reject) => {
    const outgoing = request(url, options, (incoming) => {
      const status = incoming.statusCode ?? 500;
      const responseBody = responseBodyAllowed(status) ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>) : null;
      resolve(
        new Response(responseBody, {
          status,
          statusText: incoming.statusMessage,
          headers: headersFromIncoming(incoming.headers),
        }),
      );
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function lookupPublicAddress(
  hostname: string,
  options: PublicLookupOptions,
  callback: PublicLookupCallback,
  resolveAddresses: OutboundHttpAddressResolver,
): void {
  void resolvePublicOutboundAddresses(hostname, resolveAddresses).then(
    (addresses) => {
      const requestedFamily = lookupFamilyFromOptions(options);
      const candidates =
        requestedFamily === 4 || requestedFamily === 6 ? addresses.filter((address) => address.family === requestedFamily) : addresses;
      const selected = candidates[0];
      if (!selected) {
        callback(new Error("public target has no address for the requested family"), "", 0);
        return;
      }
      if (typeof options === "object" && options.all === true) {
        callback(null, [...candidates]);
        return;
      }
      callback(null, selected.address, selected.family);
    },
    (error) => callback(error instanceof Error ? error : new Error(String(error)), "", 0),
  );
}

function lookupFamilyFromOptions(options: PublicLookupOptions): number | undefined {
  if (typeof options === "number") return options;
  if (options.family === "IPv4") return 4;
  if (options.family === "IPv6") return 6;
  return options.family;
}

function requestHeadersFromInit(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name] = value;
  });
  return result;
}

async function requestBodyFromInit(body: BodyInit | null | undefined): Promise<string | Uint8Array | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new TypeError("public-untrusted request body must be a string, URLSearchParams, Blob, or byte buffer");
}

function headersFromIncoming(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

function responseBodyAllowed(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}
