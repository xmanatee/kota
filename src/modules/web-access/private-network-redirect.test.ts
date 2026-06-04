import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPublicWebAccessUrl, WebAccessTargetError } from "./private-network.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

vi.mock("node:http", () => ({
  request: vi.fn(),
}));

vi.mock("node:https", () => ({
  request: vi.fn(),
}));

type QueuedResponse = {
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body?: string;
};

type CapturedRequest = {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | Uint8Array | undefined;
};

const mockLookup = vi.mocked(lookup);
const mockHttpRequest = vi.mocked(httpRequest);
const mockHttpsRequest = vi.mocked(httpsRequest);

beforeEach(() => {
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  mockHttpRequest.mockReset();
  mockHttpsRequest.mockReset();
});

describe("fetchPublicWebAccessUrl redirects", () => {
  it("rejects a cross-origin 307 POST redirect before replaying the body", async () => {
    const requests = mockHttpResponses([
      {
        status: 307,
        statusText: "Temporary Redirect",
        headers: { location: "http://uploads.example.test/final" },
      },
      { status: 200, statusText: "OK", body: "ok" },
    ]);

    await expect(fetchPublicWebAccessUrl("http://api.example.test/start", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: '{"secret":"token"}',
    })).rejects.toThrow(WebAccessTargetError);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "http://api.example.test/start",
      method: "POST",
      body: '{"secret":"token"}',
    });
  });

  it("rejects a cross-origin 308 PATCH redirect before replaying the body", async () => {
    const requests = mockHttpResponses([
      {
        status: 308,
        statusText: "Permanent Redirect",
        headers: { location: "http://uploads.example.test/final" },
      },
      { status: 200, statusText: "OK", body: "ok" },
    ]);

    await expect(fetchPublicWebAccessUrl("http://api.example.test/start", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/merge-patch+json",
      },
      body: '{"secret":"token"}',
    })).rejects.toThrow(WebAccessTargetError);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "http://api.example.test/start",
      method: "PATCH",
      body: '{"secret":"token"}',
    });
  });

  it("drops body and content-type when a cross-origin 302 POST redirects as GET", async () => {
    const requests = mockHttpResponses([
      {
        status: 302,
        statusText: "Found",
        headers: { location: "http://uploads.example.test/final" },
      },
      { status: 200, statusText: "OK", body: "ok" },
    ]);

    const result = await fetchPublicWebAccessUrl("http://api.example.test/start", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: '{"secret":"token"}',
    });

    expect(result.url).toBe("http://uploads.example.test/final");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.method).toBe("GET");
    expect(requests[1]?.body).toBeUndefined();
    expect(requests[1]?.headers.Accept).toBe("application/json");
    expect(requests[1]?.headers.Authorization).toBeUndefined();
    expect(requests[1]?.headers["Content-Type"]).toBeUndefined();
  });
});

function mockHttpResponses(responses: QueuedResponse[]): CapturedRequest[] {
  const queued = [...responses];
  const requests: CapturedRequest[] = [];
  mockHttpRequest.mockImplementation(((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const response = queued.shift();
    if (!response) throw new Error(`unexpected request to ${url.toString()}`);

    return {
      on: vi.fn().mockReturnThis(),
      end: vi.fn((body: string | Uint8Array | undefined) => {
        requests.push({
          url: url.toString(),
          method: options.method,
          headers: options.headers as Record<string, string>,
          body,
        });
        callback(readableResponse(response));
      }),
    };
  }) as never);
  return requests;
}

function readableResponse(response: QueuedResponse): IncomingMessage {
  const stream = Readable.from(response.body ? [response.body] : []);
  Object.assign(stream, {
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: response.headers ?? {},
  });
  return stream as IncomingMessage;
}
