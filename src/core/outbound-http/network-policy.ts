import { lookup as lookupDns } from "node:dns/promises";
import { isIP } from "node:net";
import type { OutboundHttpAddressResolver, OutboundHttpProfile, ResolvedOutboundAddress } from "#core/outbound-http/types.js";

export class OutboundHttpTargetPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundHttpTargetPolicyError";
  }
}

export const resolveOutboundAddresses: OutboundHttpAddressResolver = async (hostname) => {
  const addresses = await lookupDns(hostname, { all: true, verbatim: true });
  return addresses.flatMap((address): ResolvedOutboundAddress[] =>
    address.family === 4 || address.family === 6 ? [{ address: address.address, family: address.family }] : [],
  );
};

export async function validateOutboundHttpTarget(
  url: URL,
  profile: OutboundHttpProfile,
  resolveAddresses: OutboundHttpAddressResolver,
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundHttpTargetPolicyError("outbound HTTP targets must use http:// or https://");
  }
  if (url.username || url.password) {
    throw new OutboundHttpTargetPolicyError("outbound HTTP targets must not contain URL credentials");
  }

  switch (profile.name) {
    case "public-untrusted":
      await resolvePublicOutboundAddresses(url.hostname, resolveAddresses);
      return;
    case "configured-provider":
    case "oauth-protected-resource":
      if (!profile.allowedOrigins.includes(url.origin)) {
        throw new OutboundHttpTargetPolicyError(`target origin ${url.origin} is not selected by the ${profile.name} profile`);
      }
      return;
    case "daemon-loopback":
      if (!isLoopbackHost(normalizeHostname(url.hostname))) {
        throw new OutboundHttpTargetPolicyError("daemon-loopback requests require a literal loopback target");
      }
      return;
    case "explicit-callback": {
      const normalized = new URL(url);
      normalized.hash = "";
      if (!profile.allowedUrls.includes(normalized.toString())) {
        throw new OutboundHttpTargetPolicyError("callback request target does not match an explicitly selected callback URL");
      }
      return;
    }
  }
}

export async function resolvePublicOutboundAddresses(
  hostname: string,
  resolveAddresses: OutboundHttpAddressResolver,
): Promise<readonly ResolvedOutboundAddress[]> {
  const normalized = normalizeHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    throw blockedPublicTarget(normalized);
  }

  const version = isIP(normalized);
  if (version === 4 || version === 6) {
    if (isNonPublicAddress(normalized)) throw blockedPublicTarget(normalized);
    return [{ address: normalized, family: version }];
  }

  let addresses: readonly ResolvedOutboundAddress[];
  try {
    addresses = await resolveAddresses(normalized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OutboundHttpTargetPolicyError(`unable to resolve public outbound target ${normalized}: ${message}`);
  }
  if (addresses.length === 0) {
    throw new OutboundHttpTargetPolicyError(`unable to resolve public outbound target ${normalized}: no addresses returned`);
  }
  const blocked = addresses.find((address) => isNonPublicAddress(normalizeHostname(address.address)));
  if (blocked) throw blockedPublicTarget(normalized, blocked.address);
  return addresses;
}

function blockedPublicTarget(hostname: string, resolvedAddress?: string): OutboundHttpTargetPolicyError {
  const target = resolvedAddress ? `${hostname} -> ${resolvedAddress}` : hostname;
  return new OutboundHttpTargetPolicyError(`public-untrusted access to loopback/private-network targets is blocked: ${target}`);
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (isIP(hostname) === 4) return hostname.startsWith("127.");
  if (isIP(hostname) === 6) {
    const hextets = parseIpv6Hextets(hostname);
    return hextets?.slice(0, 7).every((value) => value === 0) === true && hextets[7] === 1;
  }
  return false;
}

function isNonPublicAddress(hostname: string): boolean {
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
  readonly prefix: readonly number[];
  readonly prefixBits: number;
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
  if (hextets.length !== 8 || hextets.slice(0, 5).some((hextet) => hextet !== 0) || hextets[5] !== 0xffff) return null;
  const high = hextets[6] ?? 0;
  const low = hextets[7] ?? 0;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
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
  const compressed = address.split("::");
  if (compressed.length > 2) return null;
  const head = parseIpv6HextetList(compressed[0] ?? "");
  const tail = parseIpv6HextetList(compressed[1] ?? "");
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length - ipv4Tail.length;
  if (compressed.length === 1 && missing !== 0) return null;
  if (compressed.length === 2 && missing < 1) return null;
  const zeroFill = compressed.length === 2 ? Array<number>(missing).fill(0) : [];
  const hextets = [...head, ...zeroFill, ...tail, ...ipv4Tail];
  return hextets.length === 8 ? hextets : null;
}

function parseIpv6HextetList(value: string): number[] | null {
  if (value.length === 0) return [];
  const hextets: number[] = [];
  for (const part of value.split(":")) {
    if (part.length === 0 || !/^[0-9a-f]{1,4}$/i.test(part)) return null;
    hextets.push(Number.parseInt(part, 16));
  }
  return hextets;
}

function parseIpv4Tail(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return [((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)];
}

function ipv6MatchesPrefix(hextets: readonly number[], block: Ipv6Block): boolean {
  let remainingBits = block.prefixBits;
  for (let index = 0; remainingBits > 0; index++) {
    const bits = Math.min(remainingBits, 16);
    const mask = (0xffff << (16 - bits)) & 0xffff;
    if ((hextets[index] & mask) !== ((block.prefix[index] ?? 0) & mask)) return false;
    remainingBits -= bits;
  }
  return true;
}
