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
  await rejectOversizedDeclaredResponse(response, limit);
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

export async function boundedStreamingResponseFrom(
  response: Response,
  limit: number | null,
  onComplete: (byteLength: number) => void,
  onLimitExceeded: () => Error,
): Promise<Response> {
  if (!response.body) {
    onComplete(0);
    return responseWithBodyFrom(response, null);
  }

  const reader = response.body.getReader();
  let total = 0;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          release();
          onComplete(total);
          controller.close();
          return;
        }
        total += next.value.byteLength;
        if (limit !== null && total > limit) {
          await reader.cancel();
          release();
          controller.error(onLimitExceeded());
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        release();
        throw error;
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
  return responseWithBodyFrom(response, body);
}

export function boundedResponseFrom(response: Response, bytes: Uint8Array): Response {
  const bodyAllowed = response.status !== 204 && response.status !== 205 && response.status !== 304;
  let body: ArrayBuffer | null = null;
  if (bodyAllowed) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    body = copy.buffer;
  }
  return responseWithBodyFrom(response, body);
}

async function rejectOversizedDeclaredResponse(response: Response, limit: number): Promise<void> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength === null) return;
  const parsedLength = Number.parseInt(declaredLength, 10);
  if (!Number.isFinite(parsedLength) || parsedLength <= limit) return;
  await response.body?.cancel();
  throw new OutboundHttpBodyLimitError(limit, "Content-Length");
}

function responseWithBodyFrom(response: Response, body: BodyInit | null): Response {
  const bodyAllowed = response.status !== 204 && response.status !== 205 && response.status !== 304;
  return new Response(bodyAllowed ? body : null, {
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
    "www-authenticate",
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
