import { createHmac, timingSafeEqual } from "node:crypto";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const TIMESTAMPED_SIGNATURE_PREFIX = "sha256-v2=";
const HEX_SIGNATURE_PATTERN = /^[0-9a-fA-F]+$/;
const UNIX_MILLISECONDS_PATTERN = /^[0-9]+$/;

type ParsedWebhookSignature = {
  hex: string;
};

export type VerifiedWebhookSignature =
  | { ok: true; timestamp: string }
  | { ok: false };

export type WebhookSignatureHeaderPrecheck = { ok: true } | { ok: false };

function parseWebhookSignature(
  signature: string,
): ParsedWebhookSignature | null {
  const trimmed = signature.trim();
  if (!trimmed.startsWith(TIMESTAMPED_SIGNATURE_PREFIX)) {
    return null;
  }
  return {
    hex: trimmed.slice(TIMESTAMPED_SIGNATURE_PREFIX.length),
  };
}

export function precheckWebhookSignatureHeaders(
  signature: string,
  timestampHeader: string | string[] | undefined,
  now: number,
): WebhookSignatureHeaderPrecheck {
  const parsed = parseWebhookSignature(signature);
  if (
    parsed === null ||
    parsed.hex.length !== 64 ||
    !HEX_SIGNATURE_PATTERN.test(parsed.hex)
  ) {
    return { ok: false };
  }

  if (typeof timestampHeader !== "string") return { ok: false };
  const timestamp = timestampHeader.trim();
  if (timestamp.length === 0) return { ok: false };
  return timestampWithinWebhookWindow(timestamp, now) ? { ok: true } : { ok: false };
}

function timingSafeHexEqual(actualHex: string, expectedHex: string): boolean {
  if (
    actualHex.length !== expectedHex.length ||
    !HEX_SIGNATURE_PATTERN.test(actualHex)
  ) {
    return false;
  }
  try {
    const actual = Buffer.from(actualHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function timestampedSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  return createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer,
  signature: string,
  timestampHeader: string | string[] | undefined,
): VerifiedWebhookSignature {
  const parsed = parseWebhookSignature(signature);
  if (parsed === null) return { ok: false };
  if (typeof timestampHeader !== "string") return { ok: false };
  const timestamp = timestampHeader.trim();
  if (timestamp.length === 0) return { ok: false };
  const expected = timestampedSignature(secret, timestamp, rawBody);
  return timingSafeHexEqual(parsed.hex, expected)
    ? { ok: true, timestamp }
    : { ok: false };
}

export function timestampWithinWebhookWindow(
  headerValue: string,
  now: number,
): boolean {
  if (!UNIX_MILLISECONDS_PATTERN.test(headerValue)) return false;
  const ts = Number(headerValue);
  if (!Number.isSafeInteger(ts)) return false;
  return Math.abs(now - ts) <= TIMESTAMP_TOLERANCE_MS;
}
