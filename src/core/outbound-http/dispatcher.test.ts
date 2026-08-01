import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OUTBOUND_HTTP_PROFILES, OutboundHttpTransport } from "#core/outbound-http/index.js";

vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

const mockHttpRequest = vi.mocked(httpRequest);

beforeEach(() => {
  mockHttpRequest.mockReset();
});

describe("public-untrusted Node dispatcher", () => {
  it("pins the connection lookup to a revalidated public address", async () => {
    let connectedAddress = "";
    mockHttpRequest.mockImplementation(((_url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      let errorHandler: (error: Error) => void = () => {};
      return {
        on: vi.fn((event: string, handler: (error: Error) => void) => {
          if (event === "error") errorHandler = handler;
          return this;
        }),
        end: vi.fn(() => {
          options.lookup?.("public.example", { all: false }, (error, address) => {
            if (error) {
              errorHandler(error);
              return;
            }
            connectedAddress = String(address);
            callback(readableResponse("ok"));
          });
        }),
      };
    }) as never);
    const resolveAddresses = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const transport = new OutboundHttpTransport({ resolveAddresses });

    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
      operation: "dns-pin-fixture",
      url: "http://public.example/resource",
    });

    expect(await result.response.text()).toBe("ok");
    expect(resolveAddresses).toHaveBeenCalledTimes(2);
    expect(connectedAddress).toBe("93.184.216.34");
  });

  it("rejects DNS rebinding before a private connection can be selected", async () => {
    mockHttpRequest.mockImplementation(((_url: URL, options: RequestOptions) => {
      let errorHandler: (error: Error) => void = () => {};
      return {
        on: vi.fn((event: string, handler: (error: Error) => void) => {
          if (event === "error") errorHandler = handler;
          return this;
        }),
        end: vi.fn(() => {
          options.lookup?.("public.example", { all: false }, (error) => {
            if (error) errorHandler(error);
          });
        }),
      };
    }) as never);
    const resolveAddresses = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const transport = new OutboundHttpTransport({ resolveAddresses });

    await expect(
      transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "dns-rebinding-fixture",
        url: "http://public.example/resource",
      }),
    ).rejects.toMatchObject({ failure: { code: "target-denied" } });
    expect(resolveAddresses).toHaveBeenCalledTimes(2);
  });
});

function readableResponse(body: string): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  Object.assign(stream, {
    statusCode: 200,
    statusMessage: "OK",
    headers: { "content-type": "text/plain" },
  });
  return stream as IncomingMessage;
}
