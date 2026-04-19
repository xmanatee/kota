import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import webhookModule from "./index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeStubCtx(bus?: EventBus, webhookConfig?: unknown): ModuleContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "webhook"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
  getModuleSummaries: () => [],
    getModuleConfig: () => webhookConfig as never,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: (event, payload) => b.emit(event, payload as never),
      subscribe: (event, handler) => b.on(event, handler as never),
    },
    createSession: () => ({ send: async () => "", close: () => {} }),
    registerProvider: () => {},
    getProvider: () => null,
    callTool: async () => ({ content: "" }),
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
  };
}

describe("webhookModule", () => {
  it("has correct metadata", () => {
    expect(webhookModule.name).toBe("webhook");
    expect(webhookModule.version).toBe("1.0.0");
    expect(webhookModule.description).toBeTruthy();
  });

  it("has no tools, routes, channels, or workflows", () => {
    expect(webhookModule.tools).toBeUndefined();
    expect(webhookModule.routes).toBeUndefined();
    expect(webhookModule.channels).toBeUndefined();
    expect(webhookModule.workflows).toBeUndefined();
  });
});

describe("webhookModule notifications", () => {
  const FAKE_URL = "https://hooks.example.com/notify";

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(async () => {
    await webhookModule.onUnload?.();
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
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL] }));
    await webhookModule.onUnload?.();
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

  it("retries on non-2xx and eventually succeeds", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, status: 200 });
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL], retries: 3, retryDelayMs: 100 }));
    bus.emit("workflow.failure.alert", { text: "alert" });
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("POSTs on all default notification events", async () => {
    const bus = new EventBus();
    webhookModule.onLoad!(makeStubCtx(bus, { urls: [FAKE_URL] }));

    bus.emit("workflow.failure.alert", { text: "failure" });
    bus.emit("workflow.attention.digest", { text: "digest" });

    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(2);
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
