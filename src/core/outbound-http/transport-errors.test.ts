import { describe, expect, it } from "vitest";
import {
  OUTBOUND_HTTP_PROFILES,
  type OutboundHttpDispatcher,
  OutboundHttpError,
  type OutboundHttpTelemetryEvent,
  OutboundHttpTransport,
  redactOutboundHttpText,
  requireOutboundHttpSuccess,
} from "#core/outbound-http/index.js";

const PUBLIC_ADDRESS = [{ address: "93.184.216.34", family: 4 as const }];

function publicTransport(dispatcher: OutboundHttpDispatcher): OutboundHttpTransport {
  return new OutboundHttpTransport({
    dispatcher,
    resolveAddresses: async () => PUBLIC_ADDRESS,
  });
}

describe("OutboundHttpTransport errors and telemetry", () => {
  it("cancels and returns a typed error when the response exceeds its body limit", async () => {
    const transport = publicTransport(async () => new Response("12345"));
    await expect(
      transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "body-limit-fixture",
        url: "https://api.example/large",
        limits: { responseBytes: 4 },
      }),
    ).rejects.toMatchObject({
      failure: { code: "response-too-large", retry: { eligible: false } },
    });
  });

  it("redacts telemetry URLs and headers without changing the adapter result", async () => {
    const events: OutboundHttpTelemetryEvent[] = [];
    const transport = new OutboundHttpTransport({
      dispatcher: async () => new Response("ok"),
      telemetry: (event) => events.push(event),
    });
    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://provider.example"]),
      operation: "telemetry-fixture",
      url: "https://provider.example/v1?api_key=secret&visible=yes",
      headers: { Authorization: "Bearer secret", "X-Trace": "visible" },
    });

    expect(result.url).toContain("api_key=secret");
    expect(events[0]).toMatchObject({
      type: "request-started",
      url: expect.stringContaining("api_key=%5Bredacted%5D"),
      headers: { authorization: "[redacted]", "x-trace": "visible" },
    });
    expect(JSON.stringify(events)).not.toContain("Bearer secret");
  });

  it("produces redacted typed provider errors with centralized retry eligibility", async () => {
    const transport = new OutboundHttpTransport({
      dispatcher: async () =>
        new Response(
          JSON.stringify({
            access_token: "access-secret",
            refresh_token: "refresh-secret",
            client_secret: "client-secret",
            "x-api-key": "api-secret",
            error: "Authorization: Bearer top-secret",
          }),
          {
            status: 503,
            statusText: "Authorization: Bearer status-secret",
            headers: { "retry-after": "2" },
          },
        ),
    });
    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://provider.example"]),
      operation: "provider-error-fixture",
      url: "https://provider.example/v1",
    });

    let error: OutboundHttpError | undefined;
    try {
      await requireOutboundHttpSuccess(result);
    } catch (caught) {
      if (caught instanceof OutboundHttpError) error = caught;
    }
    expect(error?.failure).toMatchObject({
      code: "http-status",
      status: 503,
      statusText: "Authorization: [redacted]",
      responseBody:
        '{"access_token":"[redacted]","refresh_token":"[redacted]","client_secret":"[redacted]","x-api-key":"[redacted]","error":"Authorization: [redacted]"}',
      retry: {
        eligible: true,
        reason: "transient-response",
        retryAfterMs: 2_000,
      },
    });
    expect(`${error?.message}\n${JSON.stringify(error?.failure)}`).not.toMatch(
      /access-secret|refresh-secret|client-secret|api-secret|top-secret|status-secret/,
    );
  });

  it("does not retain an unredacted dispatcher error as a cause", async () => {
    const transport = publicTransport(async () => {
      throw new Error("Authorization: Bearer dispatcher-secret");
    });

    let error: OutboundHttpError | undefined;
    try {
      await transport.request({
        profile: OUTBOUND_HTTP_PROFILES.publicUntrusted,
        operation: "network-redaction-fixture",
        url: "https://api.example/failure",
      });
    } catch (caught) {
      if (caught instanceof OutboundHttpError) error = caught;
    }

    expect(error?.message).toContain("Authorization: [redacted]");
    expect(error?.message).not.toContain("dispatcher-secret");
    expect(error?.cause).toBeUndefined();
  });

  it("does not mark a non-idempotent provider write retryable without an idempotency key", async () => {
    const transport = new OutboundHttpTransport({
      dispatcher: async () => new Response("down", { status: 503 }),
    });
    const result = await transport.request({
      profile: OUTBOUND_HTTP_PROFILES.configuredProvider(["https://provider.example"]),
      operation: "provider-write-fixture",
      url: "https://provider.example/v1/messages",
      method: "POST",
      body: "payload",
    });
    expect(result.retry).toEqual({
      eligible: false,
      reason: "method-not-idempotent",
    });
    expect(redactOutboundHttpText("token=secret")).toBe("token=[redacted]");
  });
});
