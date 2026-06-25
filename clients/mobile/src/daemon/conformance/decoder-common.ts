/**
 * Strict TypeScript decoders for the thin-client contract conformance
 * fixture (`./contract-fixture.json`).
 *
 * Each decoder parses a wire-shaped JSON value through a typed runtime
 * check that mirrors the macOS Swift `Codable` decoders one-to-one:
 * unknown discriminator values (`source`, `target`, `reason`) throw a
 * `ContractDecodeError` instead of silently passing as `unknown`. This
 * keeps the negative-fixture cases (`negative_unknownReason`,
 * `negative_unknownSource`, `negative_unknownTarget`) honest across the
 * web Vitest and mobile Jest decoder suites alongside the macOS Swift
 * conformance suite.
 *
 * The decoders are deliberately scoped to the surfaces named on
 * `task-share-or-conformance-test-daemon-wire-contracts-ac` (recall,
 * answer, answer-history, capture, retract, per-store semantic search,
 * attention, digest, voice failure envelopes). The web client's
 * `clients/web/src/api/client.ts` and the mobile client's
 * `clients/mobile/src/daemon/{digest,attention,…}.ts` import these
 * decoders directly so the same strict-decode contract that backs the
 * conformance fixture suite also gates the production runtime path.
 */

export class ContractDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractDecodeError";
  }
}

export function fail(message: string): never {
  throw new ContractDecodeError(message);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`expected string at ${field}`);
  return value;
}

export function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") fail(`expected number at ${field}`);
  return value;
}

export function asInt(value: unknown, field: string): number {
  const n = asNumber(value, field);
  if (!Number.isInteger(n)) fail(`expected integer at ${field}`);
  return n;
}

export function asBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`expected boolean at ${field}`);
  return value;
}

export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) fail(`expected object at ${field}`);
  return value;
}

export function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`expected array at ${field}`);
  return value;
}

export function asOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, field);
}

export function asOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return asInt(value, field);
}

export function asOptionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  return asNumber(value, field);
}

export function asOptionalStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  return asArray(value, field).map((entry, index) =>
    asString(entry, `${field}[${index}]`),
  );
}

export type KnownLiteral<T extends readonly string[]> = T[number];

export function asKnown<T extends readonly string[]>(
  value: unknown,
  field: string,
  known: T,
): KnownLiteral<T> {
  const raw = asString(value, field);
  if (!known.includes(raw)) {
    return fail(`unknown ${field}: ${raw}`);
  }
  return raw;
}
