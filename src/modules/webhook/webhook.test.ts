import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { createWebhookModule } from "./index.js";

const mockFetch = vi.fn();
const webhookModule = createWebhookModule(outboundHttpRequestPort((request) =>
  mockFetch(String(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  })
));

function makeStubCtx(bus?: EventBus, webhookConfig?: unknown): Parameters<ReturnType<typeof createWebhookModule>["onLoad"]>[0] {
  const b = bus ?? new EventBus();
  return {
    getModuleConfig: () => webhookConfig as never,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: makeStubEventProxy(b),
  };
}



describe("webhookModule notifications", () => {
  const FAKE_URL = "https://hooks.example.com/notify";

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  it("POSTs to configured URL on workflow.failure.alert", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL] }));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 5000,
      errorSummary: "",
      text: "Workflow failed: builder",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FAKE_URL);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.event).toBe("workflow.failure.alert");
    expect(body.workflow).toBe("builder");
    expect(body.text).toBe("Workflow failed: builder");
    expect(typeof body.timestamp).toBe("string");
  });

  it("POSTs to all configured URLs", async () => {
    const URL2 = "https://hooks.example.com/secondary";
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL, URL2] }));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 1000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain(FAKE_URL);
    expect(urls).toContain(URL2);
  });

  it("respects events filter — skips unincluded events", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(
      makeStubCtx(bus, { urls: [FAKE_URL], events: ["workflow.failure.alert"] }),
    );
    bus.emit("workflow.attention.digest", { items: [], text: "digest" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("respects events filter — fires included events", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(
      makeStubCtx(bus, { urls: [FAKE_URL], events: ["workflow.attention.digest"] }),
    );
    bus.emit("workflow.attention.digest", { items: [], text: "digest" });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("forwards workflow.daily.digest by default", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL] }));
    bus.emit("workflow.daily.digest", {
      windowStartedAt: "2026-04-25T08:00:00.000Z",
      windowEndedAt: "2026-04-26T08:00:00.000Z",
      text: "Daily digest body",
      quiet: false,
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { event: string; text: string; quiet: boolean };
    expect(body.event).toBe("workflow.daily.digest");
    expect(body.text).toBe("Daily digest body");
    expect(body.quiet).toBe(false);
  });

  it("is a no-op when urls is empty", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [] }));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 1000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is a no-op when config is absent", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, undefined));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 1000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("unloads cleanly and stops receiving events", async () => {
    const bus = new EventBus();
    const activation = await webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL] }));
    await activation?.dispose();
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 1000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("logs a warning when POST returns non-OK status (no retries)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { urls: [FAKE_URL], retries: 0 });
    ctx.log.warn = warnSpy;
    webhookModule.onLoad!(ctx);
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 1000,
      errorSummary: "",
      text: "alert",
    });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  it("forwards approval.requested regardless of events filter", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(
      makeStubCtx(bus, { urls: [FAKE_URL], events: ["workflow.failure.alert"] }),
    );
    bus.emit("approval.requested", {
      id: "approval-1",
      tool: "bash",
      risk: "high",
      reason: "destructive command",
      source: "builder",
      sessionId: "",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FAKE_URL);
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.event).toBe("approval.requested");
    expect(body.id).toBe("approval-1");
    expect(body.tool).toBe("bash");
    expect(typeof body.timestamp).toBe("string");
  });

  it("forwards approval.requested even when urls are configured without events", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL] }));
    bus.emit("approval.requested", {
      id: "approval-2",
      tool: "write",
      risk: "medium",
      reason: "file write",
      source: "builder",
      sessionId: "",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body.event).toBe("approval.requested");
  });

  it("forwards owner.question.asked regardless of events filter", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(
      makeStubCtx(bus, { urls: [FAKE_URL], events: ["workflow.failure.alert"] }),
    );
    bus.emit("owner.question.asked", {
      id: "oq-1",
      question: "Proceed with refactor?",
      reason: "high-risk surface",
      source: "builder",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FAKE_URL);
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.event).toBe("owner.question.asked");
    expect(body.id).toBe("oq-1");
    expect(body.question).toBe("Proceed with refactor?");
    expect(body.reason).toBe("high-risk surface");
    expect(body.source).toBe("builder");
    expect(typeof body.timestamp).toBe("string");
  });
});
