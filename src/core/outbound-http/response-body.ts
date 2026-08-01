export class OutboundHttpBodyLimitError extends Error {
  constructor(
    readonly limit: number,
    source = "body",
  ) {
    super(`outbound HTTP response ${source} exceeded the ${limit}-byte profile limit`);
    this.name = "OutboundHttpBodyLimitError";
  }
}

export async function readOutboundHttpResponseBytes(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > limit) {
      await response.body?.cancel();
      throw new OutboundHttpBodyLimitError(limit, "Content-Length");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    return readResponseWithoutStream(response, limit);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new OutboundHttpBodyLimitError(limit);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function boundedResponseFrom(response: Response, bytes: Uint8Array): Response {
  const bodyAllowed = response.status !== 204 && response.status !== 205 && response.status !== 304;
  let body: ArrayBuffer | null = null;
  if (bodyAllowed) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    body = copy.buffer;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: normalizeResponseHeaders(response.headers),
  });
}

async function readResponseWithoutStream(response: Response, limit: number): Promise<Uint8Array> {
  const contentType = response.headers.get("content-type") ?? "";
  if (/^(?:image|audio|video|font)\//i.test(contentType) || /pdf|zip|octet-stream/i.test(contentType)) {
    if (typeof response.arrayBuffer !== "function") return new Uint8Array();
    return boundedBytes(new Uint8Array(await response.arrayBuffer()), limit);
  }
  if (typeof response.arrayBuffer === "function") {
    return boundedBytes(new Uint8Array(await response.arrayBuffer()), limit);
  }
  if (typeof response.text === "function") {
    return boundedBytes(new TextEncoder().encode(await response.text()), limit);
  }
  return new Uint8Array();
}

function boundedBytes(bytes: Uint8Array, limit: number): Uint8Array {
  if (bytes.byteLength > limit) throw new OutboundHttpBodyLimitError(limit);
  return bytes;
}

function normalizeResponseHeaders(headers: Headers): Headers {
  if (Object.getPrototypeOf(headers) === Headers.prototype) return headers;
  const headerGetter = headers as { get(name: string): string | null };
  const normalized = new Headers();
  for (const name of [
    "cache-control",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
    "link",
    "location",
    "retry-after",
    "server",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-request-id",
  ]) {
    const value = headerGetter.get(name);
    if (value !== null) normalized.set(name, value);
  }
  return normalized;
}
