import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import notificationModule from "#modules/notification/index.js";
import { createSlackModule } from "./index.js";

const mockFetch = vi.fn();
const slackModule = createSlackModule(outboundHttpRequestPort((request) =>
  mockFetch(String(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  })
));

const FAKE_WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";

const hosts: { loader: ModuleLoader; cwd: string }[] = [];
async function loadSlack(bus: EventBus, config?: { webhookUrl: string; events?: string[]; retries?: number; retryDelayMs?: number }) {
  const cwd = mkdtempSync(join(tmpdir(), "slack-notifications-"));
  const loader = new ModuleLoader(config ? { modules: { slack: config } } : {});
  hosts.push({ loader, cwd });
  loader.setCwd(cwd);
  loader.setBus(bus);
  await loader.load(notificationModule);
  await loader.load(slackModule);
  return loader;
}
afterEach(async () => {
  for (const { loader, cwd } of hosts.splice(0)) {
    await loader.unloadAll();
    rmSync(cwd, { recursive: true, force: true });
  }
});


describe("slackModule notifications", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  it("POSTs Block Kit to webhook on workflow.failure.alert", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK });
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
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK });
    bus.emit("approval.requested", {
      id: "appr-123",
      tool: "bash",
      risk: "high",
      reason: "running rm command",
      source: "",
      sessionId: "",
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
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.failure.alert"] });
    bus.emit("workflow.attention.digest", { items: [], text: "digest" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("always fires approval.requested regardless of events filter", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.failure.alert"] });
    bus.emit("approval.requested", { id: "x", tool: "bash", risk: "low", reason: "test", source: "", sessionId: "" });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("POSTs Block Kit on owner.question.asked with answer/dismiss commands", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK });
    bus.emit("owner.question.asked", {
      id: "oq-42",
      question: "Promote explorer to dispatcher?",
      reason: "Architectural branch decision",
      source: "explorer",
      context: "The explorer found a branch decision that needs owner input.",
      answerBehavior: "record-only",
      origin: { kind: "manual", source: "explorer" },
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
    expect(text).toContain("The explorer found a branch decision");
    expect(text).toContain("Answer is recorded only");
    expect(text).toContain("kota owner-question show oq-42");
    expect(text).toContain("kota owner-question answer oq-42");
    expect(text).toContain("kota owner-question dismiss oq-42");
  });

  it("always fires owner.question.asked regardless of events filter", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK, events: ["workflow.failure.alert"] });
    bus.emit("owner.question.asked", {
      id: "oq-always",
      question: "Q?",
      reason: "R",
      source: "agent",
    });
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("POSTs Block Kit on workflow.daily.digest with rendered text", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK });
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
    ) as { blocks: unknown[] };
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("Daily Digest");
    expect(text).toContain("Daily digest body");
  });

  it("labels quiet daily digest distinctly", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK });
    bus.emit("workflow.daily.digest", {
      windowStartedAt: "2026-04-25T08:00:00.000Z",
      windowEndedAt: "2026-04-26T08:00:00.000Z",
      text: "No autonomy activity in this window.",
      quiet: true,
    });
    await Promise.resolve();
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { blocks: unknown[] };
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("Daily Digest (quiet)");
  });

  it("is a no-op when config is absent", async () => {
    const bus = new EventBus();
    await loadSlack(bus, undefined);
    bus.emit("workflow.failure.alert", { text: "alert" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("warns and is a no-op when webhookUrl is missing", async () => {
    const bus = new EventBus();
    await loadSlack(bus, { webhookUrl: "" });
    bus.emit("workflow.failure.alert", { text: "alert" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("unloads cleanly and stops receiving events", async () => {
    const bus = new EventBus();
    const loader = await loadSlack(bus, { webhookUrl: FAKE_WEBHOOK });
    await loader.unloadAll();
    bus.emit("workflow.failure.alert", { text: "alert" });
    await Promise.resolve();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
