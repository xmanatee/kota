import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import slackModule from "./index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const FAKE_WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";

function makeStubCtx(bus?: EventBus, slackConfig?: unknown): ModuleContext {
  const b = bus ?? new EventBus();
  return {
    cwd: "/tmp/test",
    verbose: false,
    config: {} as ModuleContext["config"],
    storage: new ModuleStorage("/tmp/test", "slack"),
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getContributedControlRoutes: () => [],
    getModuleSummaries: () => [],
    getModuleConfig: () => slackConfig as never,
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
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    probeHealthChecks: async () => ({}),
    getRegisteredConfigKeys: () => new Set<string>(),
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
    bus.emit("workflow.attention.digest", { items: [], text: "digest" });
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

  it("POSTs Block Kit on owner.question.asked with answer/dismiss commands", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("owner.question.asked", {
      id: "oq-42",
      question: "Promote explorer to dispatcher?",
      reason: "Architectural branch decision",
      source: "explorer",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { blocks: unknown[] };
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("Owner Question");
    expect(text).toContain("oq-42");
    expect(text).toContain("explorer");
    expect(text).toContain("Promote explorer to dispatcher?");
    expect(text).toContain("Architectural branch decision");
    expect(text).toContain("kota owner-question answer oq-42");
    expect(text).toContain("kota owner-question dismiss oq-42");
  });

  it("always fires owner.question.asked regardless of events filter", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(
      makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.failure.alert"] }),
    );
    bus.emit("owner.question.asked", {
      id: "oq-always",
      question: "Q?",
      reason: "R",
      source: "agent",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("POSTs Block Kit on workflow.build.committed when explicitly opted in", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(
      makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.build.committed"] }),
    );
    bus.emit("workflow.build.committed", {
      runId: "run-abc",
      taskId: "task-foo-bar",
      commitMessage: "Add foo bar support",
      costUsd: 0.42,
      durationMs: 480000,
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { blocks: unknown[] };
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("Builder committed");
    expect(text).toContain("Add foo bar support");
    expect(text).toContain("task-foo-bar");
    expect(text).toContain("0.42");
  });

  it("does not fire workflow.build.committed by default (opt-in)", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("workflow.build.committed", {
      runId: "run-abc",
      taskId: "task-foo",
      commitMessage: "Some commit",
      costUsd: 0.1,
      durationMs: 60000,
    });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fires all default notification events", async () => {
    const bus = new EventBus();
    slackModule.onLoad!(makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK }));
    bus.emit("workflow.failure.alert", { text: "failure" });
    bus.emit("workflow.attention.digest", { text: "digest" });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

  it("logs a warning when POST returns non-OK status (no retries)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const bus = new EventBus();
    const warnSpy = vi.fn();
    const ctx = makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK, retries: 0 });
    ctx.log.warn = warnSpy;
    slackModule.onLoad!(ctx);
    bus.emit("workflow.failure.alert", { workflow: "builder", text: "alert" });
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
    slackModule.onLoad!(
      makeStubCtx(bus, { webhookUrl: FAKE_WEBHOOK, retries: 3, retryDelayMs: 100 }),
    );
    bus.emit("workflow.failure.alert", { workflow: "builder", text: "alert" });
    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
