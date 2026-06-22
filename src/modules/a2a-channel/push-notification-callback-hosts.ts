import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type CallbackResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type CallbackAddressResolver = (
  hostname: string,
) => Promise<readonly CallbackResolvedAddress[]>;

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

export function isPrivateCallbackHost(hostname: string): boolean {
  const normalized = normalizeCallbackHostname(hostname);
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const version = isIP(normalized);
  if (version === 4) return isNonPublicIpv4(normalized);
  if (version === 6) return isNonPublicIpv6(normalized);
  return false;
}

export async function resolvePublicCallbackAddresses(
  hostname: string,
  resolver: CallbackAddressResolver = defaultCallbackAddressResolver,
): Promise<readonly CallbackResolvedAddress[]> {
  const normalized = normalizeCallbackHostname(hostname);
  if (isPrivateCallbackHost(normalized)) {
    throw new Error("callback host is not public");
  }

  const addresses = await resolver(normalized);
  if (addresses.length === 0) {
    throw new Error("callback host did not resolve to an address");
  }

  for (const resolved of addresses) {
    if (isIP(resolved.address) !== resolved.family) {
      throw new Error("callback host resolved to an invalid address record");
    }
    if (isPrivateCallbackHost(resolved.address)) {
      throw new Error("callback host resolved to a non-public address");
    }
  }
  return addresses;
}

async function defaultCallbackAddressResolver(
  hostname: string,
): Promise<readonly CallbackResolvedAddress[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => {
    if (record.family !== 4 && record.family !== 6) {
      throw new Error("callback host resolved to an unsupported address family");
    }
    return {
      address: record.address,
      family: record.family,
    };
  });
}

function normalizeCallbackHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

function isNonPublicIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  const [first, second] = parts;
  if (first === undefined || second === undefined) return false;

  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224;
}

function isNonPublicIpv6(hostname: string): boolean {
  const hextets = parseIpv6Hextets(hostname);
  if (!hextets) return false;

  const mappedIpv4 = parseIpv4MappedIpv6(hextets);
  if (mappedIpv4 !== null) return isNonPublicIpv4(mappedIpv4);

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

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
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
