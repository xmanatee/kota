import { createHmac, timingSafeEqual } from "node:crypto";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const BODY_ONLY_SIGNATURE_PREFIX = "sha256=";
const TIMESTAMPED_SIGNATURE_PREFIX = "sha256-v2=";
const HEX_SIGNATURE_PATTERN = /^[0-9a-fA-F]+$/;

type WebhookSignatureScheme = "body-only" | "timestamped";
type ParsedWebhookSignature = {
  scheme: WebhookSignatureScheme;
  hex: string;
};

export type VerifiedWebhookSignature =
  | { ok: true; scheme: "body-only" }
  | { ok: true; scheme: "timestamped"; timestamp: string }
  | { ok: false };

export type WebhookSignatureHeaderPrecheck = { ok: true } | { ok: false };

function parseWebhookSignature(signature: string): ParsedWebhookSignature {
  const trimmed = signature.trim();
  if (trimmed.startsWith(TIMESTAMPED_SIGNATURE_PREFIX)) {
    return {
      scheme: "timestamped",
      hex: trimmed.slice(TIMESTAMPED_SIGNATURE_PREFIX.length),
    };
  }
  if (trimmed.startsWith(BODY_ONLY_SIGNATURE_PREFIX)) {
    return {
      scheme: "body-only",
      hex: trimmed.slice(BODY_ONLY_SIGNATURE_PREFIX.length),
    };
  }
  return { scheme: "body-only", hex: trimmed };
}

export function precheckWebhookSignatureHeaders(
  signature: string,
  timestampHeader: string | string[] | undefined,
  now: number,
): WebhookSignatureHeaderPrecheck {
  const parsed = parseWebhookSignature(signature);
  if (parsed.hex.length !== 64 || !HEX_SIGNATURE_PATTERN.test(parsed.hex)) {
    return { ok: false };
  }

  if (parsed.scheme === "body-only") {
    return timestampHeader === undefined ? { ok: true } : { ok: false };
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

function bodyOnlySignature(secret: string, rawBody: Buffer): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
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
  if (parsed.scheme === "body-only") {
    if (timestampHeader !== undefined) return { ok: false };
    const expected = bodyOnlySignature(secret, rawBody);
    return timingSafeHexEqual(parsed.hex, expected)
      ? { ok: true, scheme: "body-only" }
      : { ok: false };
  }

  if (typeof timestampHeader !== "string") return { ok: false };
  const timestamp = timestampHeader.trim();
  if (timestamp.length === 0) return { ok: false };
  const expected = timestampedSignature(secret, timestamp, rawBody);
  return timingSafeHexEqual(parsed.hex, expected)
    ? { ok: true, scheme: "timestamped", timestamp }
    : { ok: false };
}

export function timestampWithinWebhookWindow(
  headerValue: string,
  now: number,
): boolean {
  const ts = parseInt(headerValue, 10);
  if (Number.isNaN(ts)) return false;
  return Math.abs(now - ts) <= TIMESTAMP_TOLERANCE_MS;
}
