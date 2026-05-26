import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type WebAccessTargetValidation =
  | { ok: true }
  | { ok: false; error: string };

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

  const hostname = normalizeHostname(url.hostname);
  const literalValidation = validateLiteralHost(hostname);
  if (!literalValidation.ok) return literalValidation;

  const version = isIP(hostname);
  if (version !== 0) return { ok: true };

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const blockedAddress = addresses.find((address) =>
      isLoopbackOrPrivateAddress(normalizeHostname(address.address))
    );
    if (blockedAddress) {
      return blockedTarget(hostname, blockedAddress.address);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Error: unable to resolve web access target ${hostname}: ${msg}`,
    };
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
      redirect: "manual",
    };
    const response = await fetch(currentUrl, requestInit);
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
    const normalizedMethod = (method ?? "GET").toUpperCase();
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && normalizedMethod === "POST")) {
      method = "GET";
      body = undefined;
    }
    currentUrl = nextUrl;
    redirected = true;
  }
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

function blockedTarget(hostname: string, resolvedAddress?: string): WebAccessTargetValidation {
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
