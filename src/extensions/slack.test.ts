import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { ExtensionStorage } from "../extension-storage.js";
import type { ExtensionContext } from "../extension-types.js";
import slackModule from "./slack.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const FAKE_WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";

function makeStubCtx(bus?: EventBus, slackConfig?: unknown): ExtensionContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ExtensionContext["config"],
    storage: new ExtensionStorage("/tmp/test", "slack"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getExtensionSummaries: () => [],
    getExtensionConfig: () => slackConfig as never,
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
  };
}

describe("slackModule", () => {
  it("has correct metadata", () => {
    expect(slackModule.name).toBe("slack");
    expect(slackModule.version).toBe("1.0.0");
    expect(slackModule.description).toBeTruthy();
  });

  it("has no tools, routes, commands, channels, or workflows", () => {
    expect(slackModule.tools).toBeUndefined();
    expect(slackModule.routes).toBeUndefined();
    expect(slackModule.commands).toBeUndefined();
    expect(slackModule.channels).toBeUndefined();
    expect(slackModule.workflows).toBeUndefined();
  });
});

describe("slackModule notifications", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(async () => {
    await slackModule.onUnload?.();
  });

  it("POSTs Block Kit to webhook on workflow.failure.alert", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("workflow.failure.alert", {
      workflow: "builder",
      runId: "run-abc",
      status: "failed",
      durationMs: 5000,
      errorSummary: "out of memory",
      text: "Workflow failed: builder",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FAKE_WEBHOOK);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as { blocks: unknown[] };
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
    const headerBlock = body.blocks[0] as { type: string; text: { text: string } };
    expect(headerBlock.type).toBe("header");
    expect(headerBlock.text.text).toContain("builder");
    const bodyText = JSON.stringify(body.blocks);
    expect(bodyText).toContain("run-abc");
    expect(bodyText).toContain("out of memory");
  });

  it("POSTs Block Kit on workflow.budget.exceeded", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("workflow.budget.exceeded", { dailySpend: 30.5, budget: 25, text: "over budget" });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      blocks: unknown[];
    };
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("Budget");
    expect(text).toContain("30.50");
    expect(text).toContain("25.00");
  });

  it("POSTs Block Kit on approval.requested", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("approval.requested", {
      id: "appr-123",
      tool: "bash",
      risk: "high",
      reason: "running rm command",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      blocks: unknown[];
    };
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("Approval Required");
    expect(text).toContain("appr-123");
    expect(text).toContain("bash");
    expect(text).toContain("high");
    expect(text).toContain("kota approval approve");
  });

  it("respects events filter — skips unincluded notification events", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(
      makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.failure.alert"] }),
    );
    bus.emit("workflow.budget.exceeded", { dailySpend: 30, budget: 25, text: "over" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("always fires approval.requested regardless of events filter", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(
      makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.failure.alert"] }),
    );
    bus.emit("approval.requested", { id: "x", tool: "bash", risk: "low", reason: "test" });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("fires all four default notification events", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("workflow.failure.alert", { text: "failure" });
    bus.emit("workflow.budget.exceeded", { text: "budget" });
    bus.emit("workflow.attention.digest", { text: "digest" });
    bus.emit("workflow.cost.limit.reached", { text: "cost" });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("is a no-op when config is absent", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, undefined));
    bus.emit("workflow.failure.alert", { text: "alert" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("warns and is a no-op when webhookUrl is missing", async () => {
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { webhookUrl: "" });
    ctx.log.warn = warnSpy;
    slackModule.onLoad!(ctx);
    bus.emit("workflow.failure.alert", { text: "alert" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("webhookUrl"));
  });

  it("unloads cleanly and stops receiving events", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    await slackModule.onUnload?.();
    bus.emit("workflow.failure.alert", { text: "alert" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("logs a warning when POST returns non-OK status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK });
    ctx.log.warn = warnSpy;
    slackModule.onLoad!(ctx);
    bus.emit("workflow.failure.alert", { workflow: "builder", text: "alert" });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("500"));
  });
});
