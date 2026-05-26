import type { LookupAddress } from "node:dns";
import { lookup as lookupDns } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export type WebAccessTargetValidation =
  | { ok: true }
  | { ok: false; error: string };
type BlockedWebAccessTarget = { ok: false; error: string };

export type PublicWebAccessFetchResult = {
  response: Response;
  url: string;
  redirected: boolean;
};

export class WebAccessTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAccessTargetError";
  }
}

const MAX_WEB_ACCESS_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

export async function validatePublicWebAccessUrl(rawUrl: string): Promise<WebAccessTargetValidation> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Error: url must be a valid http:// or https:// URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Error: url must start with http:// or https://" };
  }

  try {
    await resolvePublicAddresses(url.hostname);
  } catch (err) {
    if (err instanceof WebAccessTargetError) return { ok: false, error: err.message };
    throw err;
  }

  return { ok: true };
}

export async function fetchPublicWebAccessUrl(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = MAX_WEB_ACCESS_REDIRECTS,
): Promise<PublicWebAccessFetchResult> {
  let currentUrl = rawUrl;
  let method = typeof init.method === "string" ? init.method.toUpperCase() : undefined;
  let body = init.body;
  let headers = init.headers;
  let redirected = false;

  for (let redirectCount = 0; ; redirectCount++) {
    const validation = await validatePublicWebAccessUrl(currentUrl);
    if (!validation.ok) {
      throw new WebAccessTargetError(validation.error);
    }

    const requestInit: RequestInit = {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
    };
    const response = await fetchWithPublicAddressLookup(currentUrl, requestInit);
    if (!REDIRECT_STATUSES.has(response.status)) {
      const responseUrl = response.url || currentUrl;
      return {
        response,
        url: responseUrl,
        redirected: redirected || (response.redirected && responseUrl !== rawUrl),
      };
    }

    const location = response.headers.get("location");
    if (!location) {
      const responseUrl = response.url || currentUrl;
      return {
        response,
        url: responseUrl,
        redirected: redirected || (response.redirected && responseUrl !== rawUrl),
      };
    }

    await response.body?.cancel();
    if (redirectCount >= maxRedirects) {
      throw new Error(`too many redirects while fetching ${rawUrl}`);
    }

    const nextUrl = new URL(location, currentUrl).toString();
    if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
      headers = stripCrossOriginCredentialHeaders(headers);
    }
    const normalizedMethod = (method ?? "GET").toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && normalizedMethod === "POST")) {
      method = "GET";
      body = undefined;
    }
    currentUrl = nextUrl;
    redirected = true;
  }
}

function stripCrossOriginCredentialHeaders(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!headers) return headers;

  if (headers instanceof Headers) {
    const stripped = new Headers(headers);
    for (const name of CROSS_ORIGIN_CREDENTIAL_HEADERS) stripped.delete(name);
    return stripped;
  }

  if (Array.isArray(headers)) {
    return headers.filter(([name]) => !CROSS_ORIGIN_CREDENTIAL_HEADERS.has(name.toLowerCase()));
  }

  const stripped: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (CROSS_ORIGIN_CREDENTIAL_HEADERS.has(name.toLowerCase())) continue;
    stripped[name] = value;
  }
  return stripped;
}

type PublicLookupOptions = number | {
  all?: boolean;
  family?: number | "IPv4" | "IPv6";
};

type PublicLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

async function fetchWithPublicAddressLookup(rawUrl: string, init: RequestInit): Promise<Response> {
  const url = new URL(rawUrl);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = requestHeadersFromInit(init.headers);
  const body = requestBodyFromInit(init.body);
  const options: RequestOptions = {
    method: init.method,
    headers,
    lookup: lookupPublicAddress,
  };
  if (init.signal) options.signal = init.signal;

  return new Promise((resolve, reject) => {
    const req = request(url, options, (response) => {
      const status = response.statusCode ?? 500;
      const responseBody = responseBodyAllowed(status)
        ? Readable.toWeb(response) as ReadableStream<Uint8Array>
        : null;
      resolve(new Response(responseBody, {
        status,
        statusText: response.statusMessage,
        headers: headersFromIncoming(response.headers),
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function lookupPublicAddress(
  hostname: string,
  options: PublicLookupOptions,
  callback: PublicLookupCallback,
): void {
  void resolvePublicAddresses(hostname).then(
    (addresses) => {
      const requestedFamily = lookupFamilyFromOptions(options);
      const candidates = requestedFamily === 4 || requestedFamily === 6
        ? addresses.filter((address) => address.family === requestedFamily)
        : addresses;
      const selected = candidates[0];
      if (!selected) {
        callback(new WebAccessTargetError(
          `Error: unable to resolve web access target ${normalizeHostname(hostname)}: no public address matched requested address family`,
        ), "", 0);
        return;
      }
      if (typeof options === "object" && options.all === true) {
        callback(null, candidates);
        return;
      }
      callback(null, selected.address, selected.family);
    },
    (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      callback(error, "", 0);
    },
  );
}

function lookupFamilyFromOptions(options: PublicLookupOptions): number | undefined {
  if (typeof options === "number") return options;
  if (options.family === "IPv4") return 4;
  if (options.family === "IPv6") return 6;
  return options.family;
}

async function resolvePublicAddresses(hostname: string): Promise<LookupAddress[]> {
  const normalized = normalizeHostname(hostname);
  const literalValidation = validateLiteralHost(normalized);
  if (!literalValidation.ok) throw new WebAccessTargetError(literalValidation.error);

  const version = isIP(normalized);
  if (version !== 0) return [{ address: normalized, family: version }];

  let addresses: LookupAddress[];
  try {
    addresses = await lookupDns(normalized, { all: true, verbatim: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WebAccessTargetError(`Error: unable to resolve web access target ${normalized}: ${msg}`);
  }

  const blockedAddress = addresses.find((address) =>
    isLoopbackOrPrivateAddress(normalizeHostname(address.address))
  );
  if (blockedAddress) {
    throw new WebAccessTargetError(blockedTarget(normalized, blockedAddress.address).error);
  }
  if (addresses.length === 0) {
    throw new WebAccessTargetError(`Error: unable to resolve web access target ${normalized}: no addresses returned`);
  }

  return addresses;
}

function requestHeadersFromInit(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      result[name] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) result[name] = value;
    return result;
  }
  for (const [name, value] of Object.entries(headers)) result[name] = value;
  return result;
}

function requestBodyFromInit(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("unsupported request body type for public web access fetch");
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

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

function validateLiteralHost(hostname: string): WebAccessTargetValidation {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return blockedTarget(hostname);
  }

  const version = isIP(hostname);
  if (version !== 0 && isLoopbackOrPrivateAddress(hostname)) {
    return blockedTarget(hostname);
  }

  return { ok: true };
}

function blockedTarget(hostname: string, resolvedAddress?: string): BlockedWebAccessTarget {
  const target = resolvedAddress ? `${hostname} -> ${resolvedAddress}` : hostname;
  return {
    ok: false,
    error: `Error: web access to loopback/private-network targets is blocked: ${target}`,
  };
}

function isLoopbackOrPrivateAddress(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) return isPrivateIpv4(hostname);
  if (version === 6) return isPrivateIpv6(hostname);

  return false;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === "::" || hostname === "::1") return true;
  if (hostname.startsWith("::ffff:")) {
    const mappedIpv4 = parseIpv4MappedIpv6(hostname);
    return mappedIpv4 !== null && isPrivateIpv4(mappedIpv4);
  }

  const firstHextet = Number.parseInt(hostname.split(":")[0] ?? "", 16);
  if (Number.isNaN(firstHextet)) return false;

  const firstByte = firstHextet >> 8;
  const uniqueLocal = (firstByte & 0xfe) === 0xfc;
  const linkLocal = firstHextet >= 0xfe80 && firstHextet <= 0xfebf;
  return uniqueLocal || linkLocal;
}

function parseIpv4MappedIpv6(hostname: string): string | null {
  const suffix = hostname.slice("::ffff:".length);
  if (suffix.includes(".")) return suffix;

  const hextets = suffix.split(":");
  if (hextets.length !== 2) return null;

  const high = Number.parseInt(hextets[0] ?? "", 16);
  const low = Number.parseInt(hextets[1] ?? "", 16);
  if (
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }

  return [
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join(".");
}
