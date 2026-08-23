import { vi } from "vitest";

export type RecordedClientHttpRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: {
    readonly id?: number;
    readonly method?: string;
  };
};

export function mockClientHttpFetch(
  handler: (request: RecordedClientHttpRequest) => Response,
): { readonly requests: RecordedClientHttpRequest[] } {
  const requests: RecordedClientHttpRequest[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const bodyText = String(init?.body ?? "");
    const request: RecordedClientHttpRequest = {
      url: typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: bodyText.startsWith("{") ? JSON.parse(bodyText) : {},
    };
    requests.push(request);
    return handler(request);
  });
  return { requests };
}

export function jsonRpcHttpResponse(
  id: number | undefined,
  result: object,
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function waitForAssertion(
  assertion: () => void,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  let lastError: Error | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError ?? new Error("Timed out waiting for assertion");
}
