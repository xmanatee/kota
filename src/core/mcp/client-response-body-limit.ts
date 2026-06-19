import { Buffer } from "node:buffer";

export const MCP_HTTP_RESPONSE_BODY_MAX_BYTES = 1_048_576;
export const MCP_HTTP_SSE_RESPONSE_BODY_MAX_BYTES = 4 * MCP_HTTP_RESPONSE_BODY_MAX_BYTES;
export const MCP_HTTP_SSE_MESSAGE_MAX_BYTES = MCP_HTTP_RESPONSE_BODY_MAX_BYTES;

export class McpResponseBodyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpResponseBodyLimitError";
  }
}

export function assertMcpResponseContentLength(
  response: Response,
  maxBytes: number,
  label: string,
): void {
  const limit = normalizeMcpMaxBytes(maxBytes, label);
  const declaredLength = parseContentLength(response.headers.get("content-length"));
  if (declaredLength === null || declaredLength <= limit) return;

  void cancelUnlockedBody(response);
  throw new McpResponseBodyLimitError(
    `${label} exceeded ${formatMcpBytes(limit)}; Content-Length was ${formatMcpBytes(declaredLength)}.`,
  );
}

export async function readMcpResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const bytes = await readMcpResponseBytesWithLimit(response, maxBytes, label);
  return new TextDecoder().decode(bytes);
}

export async function readMcpResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const limit = normalizeMcpMaxBytes(maxBytes, label);
  assertMcpResponseContentLength(response, limit, label);
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;

      const nextTotal = totalBytes + value.byteLength;
      if (nextTotal > limit) {
        await reader.cancel().catch(() => undefined);
        throw new McpResponseBodyLimitError(
          `${label} exceeded ${formatMcpBytes(limit)} while streaming response.`,
        );
      }
      chunks.push(value);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  return concatChunks(chunks, totalBytes);
}

export function assertMcpTextWithinByteLimit(
  text: string,
  maxBytes: number,
  label: string,
): void {
  const limit = normalizeMcpMaxBytes(maxBytes, label);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength <= limit) return;
  throw new McpResponseBodyLimitError(
    `${label} exceeded ${formatMcpBytes(limit)}.`,
  );
}

export function mcpUtf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export function formatMcpBytes(bytes: number): string {
  return bytes === 1 ? "1 byte" : `${bytes} bytes`;
}

function normalizeMcpMaxBytes(maxBytes: number, label: string): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new McpResponseBodyLimitError(
      `${label} byte limit must be a positive safe integer.`,
    );
  }
  return maxBytes;
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function cancelUnlockedBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: the boundary is rejecting before reading an oversized body.
  }
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0] ?? new Uint8Array();

  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
