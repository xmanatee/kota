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
  if (version === 6) return isNonPublicIpv6(hostname);

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

type Ipv6Block = {
  prefix: readonly number[];
  prefixBits: number;
};

const NON_PUBLIC_IPV6_BLOCKS: readonly Ipv6Block[] = [
  { prefix: [0x0000], prefixBits: 8 },
  { prefix: [0x0064, 0xff9b, 0, 0, 0, 0], prefixBits: 96 },
  { prefix: [0x0064, 0xff9b, 0x0001], prefixBits: 48 },
  { prefix: [0x0100, 0, 0, 0], prefixBits: 64 },
  { prefix: [0x2001, 0], prefixBits: 32 },
  { prefix: [0x2001, 0x0002, 0], prefixBits: 48 },
  { prefix: [0x2001, 0x0010], prefixBits: 28 },
  { prefix: [0x2001, 0x0020], prefixBits: 28 },
  { prefix: [0x2001, 0x0db8], prefixBits: 32 },
  { prefix: [0x2002], prefixBits: 16 },
  { prefix: [0x3fff, 0], prefixBits: 20 },
  { prefix: [0x5f00], prefixBits: 16 },
  { prefix: [0xfc00], prefixBits: 7 },
  { prefix: [0xfe80], prefixBits: 10 },
  { prefix: [0xfec0], prefixBits: 10 },
  { prefix: [0xff00], prefixBits: 8 },
];

function isNonPublicIpv6(hostname: string): boolean {
  const hextets = parseIpv6Hextets(hostname);
  if (!hextets) return false;

  const mappedIpv4 = parseIpv4MappedIpv6(hextets);
  if (mappedIpv4 !== null) return isPrivateIpv4(mappedIpv4);

  return NON_PUBLIC_IPV6_BLOCKS.some((block) => ipv6MatchesPrefix(hextets, block));
}

function parseIpv4MappedIpv6(hextets: readonly number[]): string | null {
  if (
    hextets.length !== 8 ||
    hextets.slice(0, 5).some((hextet) => hextet !== 0) ||
    hextets[5] !== 0xffff
  ) {
    return null;
  }

  const high = hextets[6] ?? 0;
  const low = hextets[7] ?? 0;
  return [
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join(".");
}

function parseIpv6Hextets(hostname: string): number[] | null {
  let address = hostname;
  let ipv4Tail: number[] = [];

  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon === -1) return null;
    const parsedTail = parseIpv4Tail(address.slice(lastColon + 1));
    if (!parsedTail) return null;
    ipv4Tail = parsedTail;
    address = address.slice(0, lastColon);
  }

  const compressedParts = address.split("::");
  if (compressedParts.length > 2) return null;

  const head = parseIpv6HextetList(compressedParts[0] ?? "");
  const tail = parseIpv6HextetList(compressedParts[1] ?? "");
  if (!head || !tail) return null;

  const missingCount = 8 - head.length - tail.length - ipv4Tail.length;
  if (compressedParts.length === 1 && missingCount !== 0) return null;
  if (compressedParts.length === 2 && missingCount < 1) return null;

  const zeroFill = compressedParts.length === 2 ? Array<number>(missingCount).fill(0) : [];
  const hextets = [...head, ...zeroFill, ...tail, ...ipv4Tail];
  return hextets.length === 8 ? hextets : null;
}

function parseIpv6HextetList(value: string): number[] | null {
  if (value.length === 0) return [];

  const hextets: number[] = [];
  for (const part of value.split(":")) {
    if (part.length === 0) return null;
    const hextet = Number.parseInt(part, 16);
    if (Number.isNaN(hextet) || hextet < 0 || hextet > 0xffff) return null;
    hextets.push(hextet);
  }
  return hextets;
}

function parseIpv4Tail(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return [
    ((octets[0] ?? 0) << 8) | (octets[1] ?? 0),
    ((octets[2] ?? 0) << 8) | (octets[3] ?? 0),
  ];
}

function ipv6MatchesPrefix(hextets: readonly number[], block: Ipv6Block): boolean {
  let remainingBits = block.prefixBits;
  for (let index = 0; remainingBits > 0; index++) {
    const bits = Math.min(remainingBits, 16);
    const mask = (0xffff << (16 - bits)) & 0xffff;
    const expected = (block.prefix[index] ?? 0) & mask;
    if ((hextets[index] & mask) !== expected) return false;
    remainingBits -= bits;
  }
  return true;
}
