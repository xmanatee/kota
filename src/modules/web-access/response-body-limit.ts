export class WebAccessResponseBodyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAccessResponseBodyLimitError";
  }
}

export type ResponseBodyLimitName =
  | "max_length"
  | "max_response_length"
  | "search_response_limit";

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  limitName: ResponseBodyLimitName,
): Promise<string> {
  const { bytes } = await readResponseBytes(response, maxBytes, limitName, "error");
  return new TextDecoder().decode(bytes);
}

export async function readResponseTextPrefixWithLimit(
  response: Response,
  maxBytes: number,
  limitName: ResponseBodyLimitName,
): Promise<{ text: string; truncated: boolean }> {
  const { bytes, truncated } = await readResponseBytes(response, maxBytes, limitName, "truncate");
  return { text: new TextDecoder().decode(bytes), truncated };
}

export async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
  limitName: ResponseBodyLimitName,
): Promise<Uint8Array> {
  const { bytes } = await readResponseBytes(response, maxBytes, limitName, "error");
  return bytes;
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  limitName: ResponseBodyLimitName,
  mode: "error" | "truncate",
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const limit = normalizeMaxBytes(maxBytes, limitName);
  const declaredLength = parseContentLength(response.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > limit) {
    await cancelUnlockedBody(response);
    throw new WebAccessResponseBodyLimitError(
      `Error: response body exceeded ${limitName} (${formatBytes(limit)}); Content-Length was ${formatBytes(declaredLength)}.`,
    );
  }

  if (!response.body) return { bytes: new Uint8Array(), truncated: false };

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
        if (mode === "truncate") {
          const remainingBytes = limit - totalBytes;
          if (remainingBytes > 0) {
            chunks.push(value.slice(0, remainingBytes));
            totalBytes = limit;
          }
          await reader.cancel().catch(() => undefined);
          return { bytes: concatChunks(chunks, totalBytes), truncated: true };
        }
        await reader.cancel().catch(() => undefined);
        throw new WebAccessResponseBodyLimitError(
          `Error: response body exceeded ${limitName} (${formatBytes(limit)}) while streaming response.`,
        );
      }

      chunks.push(value);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  return { bytes: concatChunks(chunks, totalBytes), truncated: false };
}

function normalizeMaxBytes(maxBytes: number, limitName: ResponseBodyLimitName): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new WebAccessResponseBodyLimitError(
      `Error: ${limitName} must resolve to a positive safe integer byte limit.`,
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
    // Best effort: the important boundary is rejecting before reading.
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

function formatBytes(bytes: number): string {
  return bytes === 1 ? "1 byte" : `${bytes} bytes`;
}
