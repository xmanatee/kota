import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeClient, MemoryClient } from "#core/server/kota-client.js";
import { callTelegramApi } from "./client.js";
import { buildStatusText, type StatusInfo, startTelegramStatusPoll } from "./status-poll.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

vi.mock("#modules/autonomy/shared.js", () => ({
  loadRecentRuns: vi.fn().mockReturnValue([]),
  computeCostByWorkflow: vi.fn().mockReturnValue({}),
}));

const mockedRenderOnDemandDigest = vi.fn();
vi.mock("#modules/autonomy/workflows/daily-digest/on-demand.js", () => ({
  renderOnDemandDigest: (...args: unknown[]) => mockedRenderOnDemandDigest(...args),
}));

const mockedRenderOnDemandAttention = vi.fn();
vi.mock("#modules/autonomy/workflows/attention-digest/step.js", () => ({
  renderOnDemandAttention: (...args: unknown[]) =>
    mockedRenderOnDemandAttention(...args),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const FAKE_TOKEN = "bot-token-123";
const FAKE_CHAT_ID = "987654321";
const FAKE_PROJECT_DIR = "/fake/project";

function makeKnowledgeStub(
  search: KnowledgeClient["search"] = vi.fn(),
): KnowledgeClient {
  return {
    list: vi.fn(),
    show: vi.fn(),
    search,
    add: vi.fn(),
    delete: vi.fn(),
    reindex: vi.fn(),
  } as unknown as KnowledgeClient;
}

function makeMemoryStub(
  search: MemoryClient["search"] = vi.fn(),
): MemoryClient {
  return {
    list: vi.fn(),
    add: vi.fn(),
    delete: vi.fn(),
    search,
    reindex: vi.fn(),
  } as unknown as MemoryClient;
}

function makeStatusInfo(overrides: Partial<StatusInfo> = {}): StatusInfo {
  return {
    runtimeState: {
      completedRuns: 5,
      pendingRuns: [],
      workflows: {
        builder: {
          lastStarted: { runId: "run-abc", startedAt: "2026-01-01T00:00:00Z" },
          lastCompletion: {
            runId: "run-abc",
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:10Z",
            status: "success",
          },
        },
      },
      ...overrides.runtimeState,
    },
    dispatchPaused: false,
    runsDir: "/fake/runs",
    ...overrides,
  };
}

function makeUpdate(
  updateId: number,
  chatId: number,
  text: string,
): { update_id: number; message: { chat: { id: number }; text: string } } {
  return { update_id: updateId, message: { chat: { id: chatId }, text } };
}

describe("buildStatusText", () => {
  it("shows idle dispatch when no active runs", () => {
    const text = buildStatusText(makeStatusInfo());
    expect(text).toContain("*Dispatch:* idle");
  });

  it("shows active dispatch when activeRuns present", () => {
    const text = buildStatusText(
      makeStatusInfo({
        runtimeState: {
          completedRuns: 1,
          pendingRuns: [],
          workflows: {},
          activeRuns: [{ runId: "run-xyz", workflow: "builder", startedAt: "2026-01-01T00:00:00Z" }],
        },
      }),
    );
    expect(text).toContain("*Dispatch:* active");
    expect(text).toContain("`run-xyz`");
    expect(text).toContain("builder");
  });

  it("shows paused dispatch when dispatchPaused is true", () => {
    const text = buildStatusText(makeStatusInfo({ dispatchPaused: true }));
    expect(text).toContain("*Dispatch:* paused");
  });

  it("includes today's spend", () => {
    const text = buildStatusText(makeStatusInfo());
    expect(text).toContain("*Today's spend:*");
    expect(text).toContain("$0.0000");
  });

  it("includes last status per workflow", () => {
    const text = buildStatusText(makeStatusInfo());
    expect(text).toContain("*Last status:*");
    expect(text).toContain("builder: success");
  });

  it("omits last status section when no workflows have status", () => {
    const text = buildStatusText(
      makeStatusInfo({
        runtimeState: { completedRuns: 0, pendingRuns: [], workflows: {} },
      }),
    );
    expect(text).not.toContain("*Last status:*");
  });
});

describe("startTelegramStatusPoll", () => {
  let stop: () => void;

  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedRenderOnDemandDigest.mockReset();
    mockedRenderOnDemandAttention.mockReset();
  });

  afterEach(() => {
    stop?.();
  });

  it("polls getUpdates on start", async () => {
    mockedCallTelegramApi.mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "getUpdates",
      expect.objectContaining({ offset: 0, allowed_updates: ["message"] }),
    );
  });

  it("responds to /status from the configured chat", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      parse_mode: "Markdown",
    });
    expect((sendCall?.[2] as { text: string }).text).toContain("*Dispatch:*");
  });

  it("responds to /digest from the configured chat with rendered digest text", async () => {
    const renderedBody =
      "Daily digest (2026-04-25 08:00Z → 2026-04-26 08:00Z)\n----------------------------------------\n\nNo autonomy activity in this window.\n\nQueue state --------------------------------------------------------------------\n- ready: 2 (=)";
    mockedRenderOnDemandDigest.mockReturnValue({
      data: { quiet: true, windowStartedAt: "x", windowEndedAt: "y" },
      text: renderedBody,
    });
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/digest")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));

    expect(mockedRenderOnDemandDigest).toHaveBeenCalledWith({ projectDir: FAKE_PROJECT_DIR });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: renderedBody,
    });
    expect((sendCall?.[2] as { parse_mode?: string }).parse_mode).toBeUndefined();
  });

  it("responds to /attention from the configured chat with rendered attention text", async () => {
    const renderedBody =
      "Attention digest (1 item):\n• *Stalled work*: 2 tasks stuck in doing";
    mockedRenderOnDemandAttention.mockReturnValue({
      items: [{ label: "Stalled work", detail: "2 tasks stuck in doing" }],
      text: renderedBody,
    });
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/attention")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));

    expect(mockedRenderOnDemandAttention).toHaveBeenCalledWith({
      projectDir: FAKE_PROJECT_DIR,
      runsDir: `${FAKE_PROJECT_DIR}/.kota/runs`,
    });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: renderedBody,
    });
    expect((sendCall?.[2] as { parse_mode?: string }).parse_mode).toBeUndefined();
  });

  it("ignores /attention from chats outside the allowlist", async () => {
    mockedRenderOnDemandAttention.mockReturnValue({
      items: [],
      text: "should not be sent",
    });
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/attention")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    expect(mockedRenderOnDemandAttention).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("ignores /digest from chats outside the allowlist", async () => {
    mockedRenderOnDemandDigest.mockReturnValue({ data: {}, text: "should not be sent" });
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/digest")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    expect(mockedRenderOnDemandDigest).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("responds to /knowledge <query> with a plain-text rendered match list", async () => {
    const search = vi.fn().mockResolvedValue({
      ok: true,
      entries: [
        {
          id: "kn-001",
          title: "Project vision",
          type: "note",
          tags: [],
          status: "active",
          created: "2026-04-01T00:00:00Z",
          updated: "2026-04-10T00:00:00Z",
          content: "body",
          meta: {},
        },
        {
          id: "kn-002",
          title: "Architecture decisions",
          type: "reference",
          tags: ["arch"],
          status: "draft",
          created: "2026-04-02T00:00:00Z",
          updated: "2026-04-12T00:00:00Z",
          content: "body",
          meta: {},
        },
      ],
    });
    const knowledge = makeKnowledgeStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/knowledge architecture"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      knowledge,
      makeMemoryStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("architecture", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    const payload = sendCall?.[2] as {
      text: string;
      parse_mode?: string;
      chat_id: string;
    };
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    // Plain text — id, type, status, title, one entry per line.
    expect(payload.text).toContain("kn-001");
    expect(payload.text).toContain("Project vision");
    expect(payload.text).toContain("kn-002");
    expect(payload.text).toContain("Architecture decisions");
    expect(payload.text).toContain("note");
    expect(payload.text).toContain("active");
    expect(payload.text).toContain("draft");
    expect(payload.text.split("\n")).toHaveLength(2);
  });

  it("replies 'No matching knowledge entries.' when /knowledge returns no results", async () => {
    const search = vi.fn().mockResolvedValue({ ok: true, entries: [] });
    const knowledge = makeKnowledgeStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/knowledge nothing"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      knowledge,
      makeMemoryStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("nothing", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "No matching knowledge entries.",
    });
  });

  it("replies with a usage hint for empty or whitespace-only /knowledge queries", async () => {
    const search = vi.fn();
    const knowledge = makeKnowledgeStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/knowledge"),
        makeUpdate(2, Number(FAKE_CHAT_ID), "/knowledge    "),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      knowledge,
      makeMemoryStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(2);
    for (const call of sendCalls) {
      expect(call[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "Usage: /knowledge <query>",
      });
    }
  });

  it("explicitly explains when /knowledge has no embedding-backed provider", async () => {
    const search = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
    const knowledge = makeKnowledgeStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/knowledge anything"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      knowledge,
      makeMemoryStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("anything", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "Semantic knowledge search requires an embedding-backed knowledge provider.",
    });
  });

  it("ignores /knowledge from chats outside the allowlist", async () => {
    const search = vi.fn();
    const knowledge = makeKnowledgeStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/knowledge anything")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      knowledge,
      makeMemoryStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("responds to /memory <query> with a plain-text rendered match list", async () => {
    const search = vi.fn().mockResolvedValue({
      ok: true,
      entries: [
        {
          id: "mem-001",
          created: "2026-04-10T08:30:00Z",
          content: "Owner prefers strict typed protocols.",
        },
        {
          id: "mem-002",
          created: "2026-04-12T14:05:00Z",
          content: "Builder closed the knowledge fan-out for mobile.",
        },
      ],
    });
    const memory = makeMemoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/memory protocols"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      memory,
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("protocols", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    const payload = sendCall?.[2] as {
      text: string;
      parse_mode?: string;
      chat_id: string;
    };
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    // Plain text — id, formatted date, content snippet, one entry per line.
    expect(payload.text).toContain("mem-001");
    expect(payload.text).toContain("mem-002");
    expect(payload.text).toContain("2026-04-10 08:30");
    expect(payload.text).toContain("2026-04-12 14:05");
    expect(payload.text).toContain("Owner prefers strict typed protocols.");
    expect(payload.text).toContain("Builder closed the knowledge fan-out for mobile.");
    expect(payload.text.split("\n")).toHaveLength(2);
  });

  it("replies 'No matching memory entries.' when /memory returns no results", async () => {
    const search = vi.fn().mockResolvedValue({ ok: true, entries: [] });
    const memory = makeMemoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/memory nothing"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      memory,
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("nothing", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "No matching memory entries.",
    });
  });

  it("replies with a usage hint for empty or whitespace-only /memory queries", async () => {
    const search = vi.fn();
    const memory = makeMemoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/memory"),
        makeUpdate(2, Number(FAKE_CHAT_ID), "/memory    "),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      memory,
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(2);
    for (const call of sendCalls) {
      expect(call[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "Usage: /memory <query>",
      });
    }
  });

  it("explicitly explains when /memory has no embedding-backed provider", async () => {
    const search = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
    const memory = makeMemoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/memory anything"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      memory,
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("anything", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "Semantic memory search requires an embedding-backed memory provider.",
    });
  });

  it("ignores /memory from chats outside the allowlist", async () => {
    const search = vi.fn();
    const memory = makeMemoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/memory anything")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      memory,
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("truncates an oversized digest body to fit Telegram's 4096-char limit", async () => {
    const oversize = `${"x".repeat(5000)}`;
    mockedRenderOnDemandDigest.mockReturnValue({ data: {}, text: oversize });
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/digest")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    const text = (sendCall?.[2] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith("…(truncated)")).toBe(true);
  });

  it("ignores messages from other chat IDs", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("ignores unknown commands silently", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/help")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("advances offset so already-seen updates are not reprocessed", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(42, Number(FAKE_CHAT_ID), "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(1);
  });

  it("logs and continues on poll error", async () => {
    const logs: string[] = [];
    mockedCallTelegramApi
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      (msg) => logs.push(msg),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(logs.some((l) => l.includes("network timeout"))).toBe(true);
  });

  it("stops polling after stop() is called", async () => {
    mockedCallTelegramApi.mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub());
    await new Promise((r) => setTimeout(r, 10));
    const callsBefore = mockedCallTelegramApi.mock.calls.length;
    stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedCallTelegramApi.mock.calls.length).toBe(callsBefore);
  });
});
