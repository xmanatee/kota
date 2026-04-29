/**
 * Typed decoder for the daemon's JSON error envelope.
 *
 * The daemon emits `{ "error": "<message>" }` for plain HTTP errors and
 * may also include `code`, `reason`, or `message` for typed failures
 * (voice routes, semantic-search routes, etc.). The thin-client contract
 * promises this exact set of fields and nothing else; clients should
 * decode through this helper instead of inventing their own JSON
 * walkers, so a payload-shape change lands in one place.
 */

/**
 * Decoded shape of a daemon error response body.
 *
 * - `error` — primary human-facing message (preferred for display).
 * - `code` — short machine-readable failure code (e.g. `stt-unavailable`).
 * - `reason` — typed-failure discriminator on `ok: false` envelopes
 *   (e.g. `semantic_unavailable`).
 * - `message` — secondary description some routes attach.
 * - `raw` — raw body text when the body was not JSON; used as a
 *   last-resort display source.
 */
export type DaemonClientErrorBody = {
  error?: string;
  code?: string;
  reason?: string;
  message?: string;
  raw?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse a daemon error response body. Accepts either the raw response
 * text (string) or a pre-parsed JSON object. Returns `null` when the
 * input is empty.
 *
 * The parser is permissive about input shape — it is the only place a
 * client should *normalize* a response — but emits a strict typed shape
 * so downstream code can treat the result as the contract.
 */
export function parseDaemonClientErrorBody(
  input: string | unknown,
): DaemonClientErrorBody | null {
  if (typeof input === "string") {
    if (input.length === 0) return null;
    try {
      const parsed = JSON.parse(input);
      if (!isObject(parsed)) return { raw: input };
      return readErrorFields(parsed, input);
    } catch {
      return { raw: input };
    }
  }
  if (!isObject(input)) return null;
  return readErrorFields(input, undefined);
}

function readErrorFields(
  obj: Record<string, unknown>,
  raw: string | undefined,
): DaemonClientErrorBody {
  const out: DaemonClientErrorBody = {};
  const error = pickString(obj.error);
  const code = pickString(obj.code);
  const reason = pickString(obj.reason);
  const message = pickString(obj.message);
  if (error !== undefined) out.error = error;
  if (code !== undefined) out.code = code;
  if (reason !== undefined) out.reason = reason;
  if (message !== undefined) out.message = message;
  if (raw !== undefined) out.raw = raw;
  return out;
}

/**
 * One human-facing line summarizing what the daemon said. Returns `null`
 * when the body had no recognizable content.
 *
 * Mirrors the macOS `DaemonErrorBody.displaySummary` ordering so the
 * SwiftUI surface and TypeScript callers render the same line for the
 * same body.
 */
export function summarizeDaemonClientErrorBody(
  body: DaemonClientErrorBody | null,
): string | null {
  if (!body) return null;
  return body.error ?? body.message ?? body.reason ?? body.raw ?? null;
}
