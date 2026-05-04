import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HistoryClient,
  KnowledgeClient,
  MemoryClient,
  RecallClient,
  RepoTasksClient,
} from "#core/server/kota-client.js";
import type {
  AnswerClient,
  AnswerHistoryEntry,
  AnswerHistoryRecord,
} from "#modules/answer/client.js";
import { renderAnswerReplyPlain } from "#modules/answer/render.js";
import type { CaptureClient, CaptureResult } from "#modules/capture/client.js";
import type {
  RetractClient,
  RetractResult,
} from "#modules/retract/client.js";
import { callTelegramApi } from "./client.js";
import {
  buildStatusText,
  type StatusInfo,
  startTelegramStatusPoll,
} from "./status-poll.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callTelegramApi: vi.fn() };
});

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

function makeHistoryStub(
  search: HistoryClient["search"] = vi.fn(),
): HistoryClient {
  return {
    list: vi.fn(),
    show: vi.fn(),
    delete: vi.fn(),
    search,
    reindex: vi.fn(),
  } as unknown as HistoryClient;
}

function makeTasksStub(
  search: RepoTasksClient["search"] = vi.fn(),
): RepoTasksClient {
  return {
    list: vi.fn(),
    show: vi.fn(),
    move: vi.fn(),
    create: vi.fn(),
    capture: vi.fn(),
    gc: vi.fn(),
    search,
    reindex: vi.fn(),
  } as unknown as RepoTasksClient;
}

function makeRecallStub(
  recall: RecallClient["recall"] = vi.fn(),
): RecallClient {
  return { recall };
}

function makeAnswerStub(
  answer: AnswerClient["answer"] = vi.fn(),
): AnswerClient {
  return {
    answer,
    log: vi.fn(async () => ({ entries: [] })),
    show: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
  };
}

function makeCaptureStub(
  capture: CaptureClient["capture"] = vi.fn(),
): CaptureClient {
  return { capture };
}

function makeRetractStub(
  retract: RetractClient["retract"] = vi.fn(),
): RetractClient {
  return { retract };
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("responds to /history <query> with a plain-text rendered conversation list", async () => {
    const search = vi.fn().mockResolvedValue({
      ok: true,
      conversations: [
        {
          id: "conv-001",
          title: "Telegram fan-out plan",
          createdAt: "2026-04-10T08:00:00Z",
          updatedAt: "2026-04-10T08:30:00Z",
          model: "claude-opus-4-7",
          messageCount: 12,
          cwd: "/repo",
        },
        {
          id: "conv-002",
          title: "Conversation recall design",
          createdAt: "2026-04-12T13:00:00Z",
          updatedAt: "2026-04-12T14:05:00Z",
          model: "claude-opus-4-7",
          messageCount: 7,
          cwd: "/repo",
        },
      ],
    });
    const history = makeHistoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/history fan-out"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      history,
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("fan-out", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    const payload = sendCall?.[2] as {
      text: string;
      parse_mode?: string;
      chat_id: string;
    };
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    // Plain text — id, formatted date, message count, title, one entry per line.
    expect(payload.text).toContain("conv-001");
    expect(payload.text).toContain("conv-002");
    expect(payload.text).toContain("2026-04-10 08:30");
    expect(payload.text).toContain("2026-04-12 14:05");
    expect(payload.text).toContain("Telegram fan-out plan");
    expect(payload.text).toContain("Conversation recall design");
    expect(payload.text.split("\n")).toHaveLength(2);
  });

  it("replies 'No matching conversations.' when /history returns no results", async () => {
    const search = vi.fn().mockResolvedValue({ ok: true, conversations: [] });
    const history = makeHistoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/history nothing"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      history,
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("nothing", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "No matching conversations.",
    });
  });

  it("replies with a usage hint for empty or whitespace-only /history queries", async () => {
    const search = vi.fn();
    const history = makeHistoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/history"),
        makeUpdate(2, Number(FAKE_CHAT_ID), "/history    "),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      history,
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(2);
    for (const call of sendCalls) {
      expect(call[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "Usage: /history <query>",
      });
    }
  });

  it("explicitly explains when /history has no embedding-backed provider", async () => {
    const search = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
    const history = makeHistoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/history anything"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      history,
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("anything", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "Semantic conversation search requires an embedding-backed history provider.",
    });
  });

  it("ignores /history from chats outside the allowlist", async () => {
    const search = vi.fn();
    const history = makeHistoryStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/history anything")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      history,
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("responds to /tasks <query> with a plain-text rendered task list", async () => {
    const search = vi.fn().mockResolvedValue({
      ok: true,
      tasks: [
        {
          id: "task-add-telegram-tasks-command",
          title: "Add Telegram /tasks command",
          state: "ready",
          priority: "p2",
          area: "modules",
          summary: "fan-out",
          updatedAt: "2026-04-27T05:57:05.496Z",
          score: 0.92,
        },
        {
          id: "task-tasks-semantic-seam",
          title: "Add tasks-semantic provider",
          state: "done",
          priority: "p2",
          area: "modules",
          summary: "seed",
          updatedAt: "2026-04-26T08:00:00.000Z",
          score: 0.81,
        },
      ],
    });
    const tasks = makeTasksStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/tasks telegram"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      tasks,
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("telegram", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    const payload = sendCall?.[2] as {
      text: string;
      parse_mode?: string;
      chat_id: string;
    };
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    // Plain text — id, state, priority, title, one entry per line.
    expect(payload.text).toContain("task-add-telegram-tasks-command");
    expect(payload.text).toContain("task-tasks-semantic-seam");
    expect(payload.text).toContain("ready");
    expect(payload.text).toContain("done");
    expect(payload.text).toContain("p2");
    expect(payload.text).toContain("Add Telegram /tasks command");
    expect(payload.text).toContain("Add tasks-semantic provider");
    expect(payload.text.split("\n")).toHaveLength(2);
  });

  it("replies 'No matching tasks.' when /tasks returns no results", async () => {
    const search = vi.fn().mockResolvedValue({ ok: true, tasks: [] });
    const tasks = makeTasksStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/tasks nothing"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      tasks,
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledWith("nothing", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "No matching tasks.",
    });
  });

  it("replies with a usage hint for empty or whitespace-only /tasks queries", async () => {
    const search = vi.fn();
    const tasks = makeTasksStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/tasks"),
        makeUpdate(2, Number(FAKE_CHAT_ID), "/tasks    "),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      tasks,
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(2);
    for (const call of sendCalls) {
      expect(call[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "Usage: /tasks <query>",
      });
    }
  });

  it("explicitly explains when /tasks has no embedding-backed provider", async () => {
    const search = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
    const tasks = makeTasksStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/tasks anything"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      tasks,
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("anything", { semantic: true, limit: 10 });
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "Semantic task search requires an embedding-backed repo-tasks provider.",
    });
  });

  it("ignores /tasks from chats outside the allowlist", async () => {
    const search = vi.fn();
    const tasks = makeTasksStub(search);
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/tasks anything")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      tasks,
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(search).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("responds to /recall <query> with one ranked, source-tagged hit list across stores", async () => {
    const recallFn = vi.fn().mockResolvedValue({
      ok: true,
      hits: [
        {
          source: "knowledge",
          score: 0.95,
          id: "kn-001",
          title: "Recall design",
          preview: "...",
          updated: "2026-04-26",
        },
        {
          source: "memory",
          score: 0.7,
          id: "mem-002",
          preview: "owner prefers strict typed protocols",
          created: "2026-04-25",
        },
        {
          source: "tasks",
          score: 0.55,
          id: "task-recall-seam",
          title: "Add recall seam",
          state: "doing",
          priority: "p2",
          updatedAt: "2026-04-27",
        },
      ],
    });
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/recall protocols"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(recallFn),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(recallFn).toHaveBeenCalledWith("protocols");
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    const payload = sendCall?.[2] as {
      text: string;
      parse_mode?: string;
      chat_id: string;
    };
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    const lines = payload.text.split("\n");
    expect(lines).toHaveLength(3);
    // Source-tag ordering follows normalized score (knowledge 0.95 > memory 0.7 > tasks 0.55).
    expect(lines[0]).toMatch(/^knowledge\s/);
    expect(lines[0]).toContain("kn-001");
    expect(lines[0]).toContain("Recall design");
    expect(lines[1]).toMatch(/^memory\s/);
    expect(lines[1]).toContain("mem-002");
    expect(lines[1]).toContain("owner prefers strict typed protocols");
    expect(lines[2]).toMatch(/^tasks\s/);
    expect(lines[2]).toContain("task-recall-seam");
    expect(lines[2]).toContain("Add recall seam");
  });

  it("replies 'No matching items.' when /recall returns ok:true with zero hits", async () => {
    const recallFn = vi.fn().mockResolvedValue({ ok: true, hits: [] });
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/recall nothing"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(recallFn),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(recallFn).toHaveBeenCalledWith("nothing");
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "No matching items.",
    });
  });

  it("replies with a usage hint for empty or whitespace-only /recall queries", async () => {
    const recallFn = vi.fn();
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/recall"),
        makeUpdate(2, Number(FAKE_CHAT_ID), "/recall    "),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(recallFn),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(recallFn).not.toHaveBeenCalled();
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(2);
    for (const call of sendCalls) {
      expect(call[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "Usage: /recall <query>",
      });
    }
  });

  it("explicitly explains when /recall has no registered contributors", async () => {
    const recallFn = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/recall anything"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(recallFn),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(recallFn).toHaveBeenCalledTimes(1);
    expect(recallFn).toHaveBeenCalledWith("anything");
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      text: "Cross-store recall is not configured: no contributors are registered.",
    });
  });

  it("ignores /recall from chats outside the allowlist", async () => {
    const recallFn = vi.fn();
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/recall anything")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(recallFn),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(recallFn).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("responds to /answer <query> with the synthesized prose followed by a typed citation block", async () => {
    const answerFn = vi.fn().mockResolvedValue({
      ok: true,
      answer:
        "Strict typed protocols are the project standard [knowledge:kn-001]; the owner reaffirmed this preference in memory [memory:mem-002].",
      citations: [
        { source: "knowledge", id: "kn-001" },
        { source: "memory", id: "mem-002" },
      ],
      hits: [
        {
          source: "knowledge",
          score: 0.92,
          id: "kn-001",
          title: "Project conventions",
          preview: "Strict by default...",
          updated: "2026-04-26",
        },
        {
          source: "memory",
          score: 0.71,
          id: "mem-002",
          preview: "owner prefers strict typed protocols",
          created: "2026-04-25",
        },
      ],
    });
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/answer typed protocols"),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(answerFn),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(answerFn).toHaveBeenCalledWith("typed protocols");
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    const payload = sendCall?.[2] as {
      text: string;
      parse_mode?: string;
      chat_id: string;
    };
    expect(payload.parse_mode).toBeUndefined();
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    // Prose appears first with markers preserved inline.
    expect(payload.text).toMatch(
      /^Strict typed protocols are the project standard \[knowledge:kn-001\]; the owner reaffirmed this preference in memory \[memory:mem-002\]\./,
    );
    // Citation block follows the prose, separated by a blank line and a header.
    expect(payload.text).toContain("\n\nCitations\n");
    // Each cited source resolves to a row with source, score, id, and a per-source descriptor.
    const lines = payload.text.split("\n");
    const knowledgeRow = lines.find((l) => l.startsWith("knowledge"));
    const memoryRow = lines.find((l) => l.startsWith("memory"));
    expect(knowledgeRow).toBeDefined();
    expect(memoryRow).toBeDefined();
    expect(knowledgeRow).toContain("kn-001");
    expect(knowledgeRow).toContain("0.920");
    expect(knowledgeRow).toContain("Project conventions");
    expect(memoryRow).toContain("mem-002");
    expect(memoryRow).toContain("0.710");
    expect(memoryRow).toContain("owner prefers strict typed protocols");
  });

  it("replies with a usage hint for empty or whitespace-only /answer queries", async () => {
    const answerFn = vi.fn();
    mockedCallTelegramApi
      .mockResolvedValueOnce([
        makeUpdate(1, Number(FAKE_CHAT_ID), "/answer"),
        makeUpdate(2, Number(FAKE_CHAT_ID), "/answer    "),
      ])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(answerFn),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(answerFn).not.toHaveBeenCalled();
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(2);
    for (const call of sendCalls) {
      expect(call[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "Usage: /answer <query>",
      });
    }
  });

  it("replies with a fixed body for each /answer failure reason so the operator can disambiguate", async () => {
    expect(renderAnswerReplyPlain({ ok: false, reason: "no_hits" })).toBe(
      "No matching sources across the second brain — nothing to synthesize.",
    );
    expect(
      renderAnswerReplyPlain({ ok: false, reason: "semantic_unavailable" }),
    ).toBe("Cross-store recall has no registered contributors.");
    expect(
      renderAnswerReplyPlain({ ok: false, reason: "synthesis_failed" }),
    ).toBe(
      "Synthesis failed (model unreachable or unable to cite resolvable sources).",
    );
  });

  it("delivers each /answer ok:false reason as a Telegram reply", async () => {
    for (const reason of [
      "no_hits",
      "semantic_unavailable",
      "synthesis_failed",
    ] as const) {
      mockedCallTelegramApi.mockReset();
      const answerFn = vi.fn().mockResolvedValue({ ok: false, reason });
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer anything"),
        ])
        .mockResolvedValue([]);
      const localStop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(answerFn),
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));
      const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
      expect(answerFn).toHaveBeenCalledWith("anything");
      expect(sendCall?.[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: renderAnswerReplyPlain({ ok: false, reason }),
      });
      localStop();
    }
  });

  it("ignores /answer from chats outside the allowlist", async () => {
    const answerFn = vi.fn();
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/answer anything")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(
      FAKE_TOKEN,
      FAKE_CHAT_ID,
      FAKE_PROJECT_DIR,
      makeStatusInfo,
      makeKnowledgeStub(),
      makeMemoryStub(),
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(answerFn),
      makeCaptureStub(),
      makeRetractStub(),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(answerFn).not.toHaveBeenCalled();
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("truncates an oversized digest body to fit Telegram's 4096-char limit", async () => {
    const oversize = `${"x".repeat(5000)}`;
    mockedRenderOnDemandDigest.mockReturnValue({ data: {}, text: oversize });
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/digest")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    const text = (sendCall?.[2] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith("…(truncated)")).toBe(true);
  });

  describe("/answer-log", () => {
    const okEntry: AnswerHistoryEntry = {
      id: "2026-04-28T00-00-02-000Z-aaaaaa",
      createdAt: "2026-04-28T00:00:02.000Z",
      query: "How does recall work?",
      result: { ok: true, citationCount: 2 },
    };
    const failEntry: AnswerHistoryEntry = {
      id: "2026-04-28T00-00-01-000Z-bbbbbb",
      createdAt: "2026-04-28T00:00:01.000Z",
      query: "What about nothing in the brain?",
      result: { ok: false, reason: "no_hits" },
    };
    const olderEntry: AnswerHistoryEntry = {
      id: "2026-04-28T00-00-00-000Z-cccccc",
      createdAt: "2026-04-28T00:00:00.000Z",
      query: "First ever question",
      result: { ok: true, citationCount: 1 },
    };

    it("renders newest-first one-row-per-entry projection with badge, id, and truncated query", async () => {
      const log = vi
        .fn()
        .mockResolvedValue({ entries: [okEntry, failEntry, olderEntry] });
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log,
        show: vi.fn(),
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer-log"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(log).toHaveBeenCalledWith({ limit: 5 });
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall).toBeDefined();
      const payload = sendCall?.[2] as {
        text: string;
        parse_mode?: string;
        chat_id: string;
      };
      expect(payload.parse_mode).toBeUndefined();
      expect(payload.chat_id).toBe(FAKE_CHAT_ID);
      const lines = payload.text.split("\n");
      expect(lines).toHaveLength(3);
      // Newest first: okEntry, then failEntry, then olderEntry.
      expect(lines[0]).toContain(okEntry.id);
      expect(lines[0]).toContain("ok(2)");
      expect(lines[0]).toContain("How does recall work?");
      expect(lines[0]).toContain("2026-04-28T00:00:02Z");
      expect(lines[1]).toContain(failEntry.id);
      expect(lines[1]).toContain("no_hits");
      expect(lines[1]).toContain("What about nothing in the brain?");
      expect(lines[2]).toContain(olderEntry.id);
      expect(lines[2]).toContain("ok(1)");
      expect(lines[2]).toContain("First ever question");
    });

    it("replies 'No past answer records yet.' when /answer-log returns an empty store", async () => {
      const log = vi.fn().mockResolvedValue({ entries: [] });
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log,
        show: vi.fn(),
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer-log"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(log).toHaveBeenCalledWith({ limit: 5 });
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall?.[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: "No past answer records yet.",
      });
    });

    it("honors an explicit positive integer limit", async () => {
      const log = vi.fn().mockResolvedValue({ entries: [] });
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log,
        show: vi.fn(),
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer-log 3"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(log).toHaveBeenCalledWith({ limit: 3 });
    });

    it("emits a fixed usage hint and never calls the namespace for non-numeric limits", async () => {
      const log = vi.fn();
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log,
        show: vi.fn(),
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer-log abc"),
          makeUpdate(2, Number(FAKE_CHAT_ID), "/answer-log 0"),
          makeUpdate(3, Number(FAKE_CHAT_ID), "/answer-log -1"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(log).not.toHaveBeenCalled();
      const sendCalls = mockedCallTelegramApi.mock.calls.filter(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCalls).toHaveLength(3);
      for (const call of sendCalls) {
        expect(call[2]).toMatchObject({
          chat_id: FAKE_CHAT_ID,
          text: "Usage: /answer-log [N]",
        });
      }
    });

    it("ignores /answer-log from chats outside the allowlist", async () => {
      const log = vi.fn();
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log,
        show: vi.fn(),
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([makeUpdate(1, 111111, "/answer-log")])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(log).not.toHaveBeenCalled();
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall).toBeUndefined();
    });
  });

  describe("/answer-show", () => {
    const okRecord: AnswerHistoryRecord = {
      id: "2026-04-28T00-00-00-000Z-eeeeee",
      createdAt: "2026-04-28T00:00:00.000Z",
      query: "How does recall rank across stores?",
      filter: { topK: 8 },
      recallHits: [
        {
          source: "knowledge",
          score: 0.92,
          id: "kn-001",
          title: "Project conventions",
          preview: "Strict by default...",
          updated: "2026-04-26",
        },
      ],
      result: {
        ok: true,
        answer:
          "Recall ranks across stores [knowledge:kn-001].",
        citations: [{ source: "knowledge", id: "kn-001" }],
        hits: [
          {
            source: "knowledge",
            score: 0.92,
            id: "kn-001",
            title: "Project conventions",
            preview: "Strict by default...",
            updated: "2026-04-26",
          },
        ],
      },
    };

    const failRecord: AnswerHistoryRecord = {
      id: "2026-04-28T00-00-01-000Z-ffffff",
      createdAt: "2026-04-28T00:00:01.000Z",
      query: "What about nothing?",
      filter: { topK: 8 },
      recallHits: [],
      result: { ok: false, reason: "no_hits" },
    };

    it("renders an ok:true record byte-identically to /answer's reply for the same envelope", async () => {
      const expectedAnswerBody = renderAnswerReplyPlain(okRecord.result);
      const show = vi.fn().mockResolvedValue({ ok: true, record: okRecord });
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log: vi.fn(),
        show,
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(
            1,
            Number(FAKE_CHAT_ID),
            `/answer-show ${okRecord.id}`,
          ),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(show).toHaveBeenCalledWith(okRecord.id);
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall?.[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: expectedAnswerBody,
      });
      expect((sendCall?.[2] as { text: string }).text).toContain(
        "[knowledge:kn-001]",
      );
      expect((sendCall?.[2] as { text: string }).text).toContain("Citations");
      expect((sendCall?.[2] as { text: string }).text).toContain(
        "Project conventions",
      );
    });

    it("renders the typed failure reason for an ok:false record without a synthesized body", async () => {
      const show = vi.fn().mockResolvedValue({ ok: true, record: failRecord });
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log: vi.fn(),
        show,
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(
            1,
            Number(FAKE_CHAT_ID),
            `/answer-show ${failRecord.id}`,
          ),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(show).toHaveBeenCalledWith(failRecord.id);
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall?.[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: renderAnswerReplyPlain({ ok: false, reason: "no_hits" }),
      });
      expect((sendCall?.[2] as { text: string }).text).not.toContain(
        "Citations",
      );
    });

    it("replies with a fixed-body 'not found' message and does not throw for an unknown id", async () => {
      const show = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: "not_found" });
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log: vi.fn(),
        show,
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer-show missing"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(show).toHaveBeenCalledWith("missing");
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall?.[2]).toMatchObject({
        chat_id: FAKE_CHAT_ID,
        text: 'No answer record found for id "missing".',
      });
    });

    it("emits a fixed usage hint and never calls the namespace when no id is given", async () => {
      const show = vi.fn();
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log: vi.fn(),
        show,
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/answer-show"),
          makeUpdate(2, Number(FAKE_CHAT_ID), "/answer-show    "),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(show).not.toHaveBeenCalled();
      const sendCalls = mockedCallTelegramApi.mock.calls.filter(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCalls).toHaveLength(2);
      for (const call of sendCalls) {
        expect(call[2]).toMatchObject({
          chat_id: FAKE_CHAT_ID,
          text: "Usage: /answer-show <id>",
        });
      }
    });

    it("ignores /answer-show from chats outside the allowlist", async () => {
      const show = vi.fn();
      const answerClient: AnswerClient = {
        answer: vi.fn(),
        log: vi.fn(),
        show,
      };
      mockedCallTelegramApi
        .mockResolvedValueOnce([makeUpdate(1, 111111, "/answer-show abc")])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        answerClient,
        makeCaptureStub(),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(show).not.toHaveBeenCalled();
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall).toBeUndefined();
    });
  });

  describe("/capture", () => {
    async function runCaptureCase(
      command: string,
      captureFn: CaptureClient["capture"],
    ): Promise<{ text: string; parse_mode?: string; chat_id: string }> {
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), command),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(captureFn),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      if (!sendCall) throw new Error("expected one sendMessage call");
      return sendCall[2] as { text: string; parse_mode?: string; chat_id: string };
    }

    it("/capture <text> calls the seam without an explicit target and renders the memory success arm", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "memory", recordId: "mem-001" },
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture remember to call alice",
        captureFn,
      );
      expect(captureFn).toHaveBeenCalledWith(
        "remember to call alice",
        undefined,
      );
      expect(payload.parse_mode).toBeUndefined();
      expect(payload.chat_id).toBe(FAKE_CHAT_ID);
      expect(payload.text).toBe("Captured to memory: mem-001");
    });

    it("/capture-to-knowledge <text> dispatches with target=knowledge and renders the knowledge success arm", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "knowledge", recordId: "kn-arch-001" },
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture-to-knowledge architecture decision",
        captureFn,
      );
      expect(captureFn).toHaveBeenCalledWith("architecture decision", {
        target: "knowledge",
      });
      expect(payload.text).toBe("Captured to knowledge: kn-arch-001");
    });

    it("/capture-to-memory dispatches with target=memory", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "memory", recordId: "mem-007" },
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture-to-memory owner prefers strict types",
        captureFn,
      );
      expect(captureFn).toHaveBeenCalledWith(
        "owner prefers strict types",
        { target: "memory" },
      );
      expect(payload.text).toBe("Captured to memory: mem-007");
    });

    it("/capture-to-tasks dispatches with target=tasks and renders the tasks success arm with path", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-fix-login",
          path: "data/tasks/inbox/task-fix-login.md",
        },
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture-to-tasks fix the login redirect",
        captureFn,
      );
      expect(captureFn).toHaveBeenCalledWith(
        "fix the login redirect",
        { target: "tasks" },
      );
      expect(payload.text).toBe(
        "Captured to tasks: task-fix-login (data/tasks/inbox/task-fix-login.md)",
      );
    });

    it("/capture-to-inbox dispatches with target=inbox and renders the inbox success arm with path", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: true,
        record: {
          target: "inbox",
          recordId: "thoughts-2026-04-28",
          path: "data/inbox/thoughts-2026-04-28.md",
        },
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture-to-inbox raw morning thought",
        captureFn,
      );
      expect(captureFn).toHaveBeenCalledWith(
        "raw morning thought",
        { target: "inbox" },
      );
      expect(payload.text).toBe(
        "Captured to inbox: thoughts-2026-04-28 (data/inbox/thoughts-2026-04-28.md)",
      );
    });

    it("renders the ambiguous arm pointing at the four /capture-to-* commands", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: false,
        reason: "ambiguous",
        suggestions: ["memory", "knowledge", "tasks", "inbox"],
      } satisfies CaptureResult);
      const payload = await runCaptureCase("/capture something vague", captureFn);
      expect(captureFn).toHaveBeenCalledWith("something vague", undefined);
      expect(payload.text).toBe(
        "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
      );
    });

    it("renders the no_contributors arm with a fixed unconfigured body", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: false,
        reason: "no_contributors",
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture-to-memory anything",
        captureFn,
      );
      expect(payload.text).toBe(
        "Cross-store capture has no registered contributors.",
      );
    });

    it("renders the contributor_failed arm with the target and verbatim error message", async () => {
      const captureFn = vi.fn().mockResolvedValue({
        ok: false,
        reason: "contributor_failed",
        target: "tasks",
        message: "ENOENT: data/tasks/inbox missing",
      } satisfies CaptureResult);
      const payload = await runCaptureCase(
        "/capture-to-tasks file the bug",
        captureFn,
      );
      expect(payload.text).toBe(
        "Capture into tasks failed: ENOENT: data/tasks/inbox missing",
      );
    });

    it("short-circuits empty-text /capture and /capture-to-* without calling the seam, surfacing the ambiguous body", async () => {
      const captureFn = vi.fn();
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/capture"),
          makeUpdate(2, Number(FAKE_CHAT_ID), "/capture    "),
          makeUpdate(3, Number(FAKE_CHAT_ID), "/capture-to-memory"),
          makeUpdate(4, Number(FAKE_CHAT_ID), "/capture-to-knowledge   "),
          makeUpdate(5, Number(FAKE_CHAT_ID), "/capture-to-tasks"),
          makeUpdate(6, Number(FAKE_CHAT_ID), "/capture-to-inbox  "),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(captureFn),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(captureFn).not.toHaveBeenCalled();
      const sendCalls = mockedCallTelegramApi.mock.calls.filter(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCalls).toHaveLength(6);
      const expectedBody =
        "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.";
      for (const call of sendCalls) {
        expect(call[2]).toMatchObject({
          chat_id: FAKE_CHAT_ID,
          text: expectedBody,
        });
      }
    });

    it("ignores all five capture commands from chats outside the allowlist", async () => {
      const captureFn = vi.fn();
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, 111111, "/capture remember this"),
          makeUpdate(2, 111111, "/capture-to-memory remember this"),
          makeUpdate(3, 111111, "/capture-to-knowledge file this"),
          makeUpdate(4, 111111, "/capture-to-tasks file this"),
          makeUpdate(5, 111111, "/capture-to-inbox file this"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(captureFn),
        makeRetractStub(),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(captureFn).not.toHaveBeenCalled();
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall).toBeUndefined();
    });
  });

  describe("/retract", () => {
    async function runRetractCase(
      command: string,
      retractFn: RetractClient["retract"],
    ): Promise<{ text: string; parse_mode?: string; chat_id: string }> {
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), command),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(),
        makeRetractStub(retractFn),
      );
      await new Promise((r) => setTimeout(r, 20));
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      if (!sendCall) throw new Error("expected one sendMessage call");
      return sendCall[2] as { text: string; parse_mode?: string; chat_id: string };
    }

    it("/retract-memory <id> dispatches with target=memory and renders the memory success arm", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "memory", recordId: "mem-001" },
      } satisfies RetractResult);
      const payload = await runRetractCase("/retract-memory mem-001", retractFn);
      expect(retractFn).toHaveBeenCalledWith({ target: "memory", id: "mem-001" });
      expect(payload.parse_mode).toBeUndefined();
      expect(payload.chat_id).toBe(FAKE_CHAT_ID);
      expect(payload.text).toBe("Retracted: memory  mem-001");
    });

    it("/retract-knowledge <slug> dispatches with target=knowledge and renders the knowledge success arm", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: true,
        record: { target: "knowledge", recordId: "discriminated-unions" },
      } satisfies RetractResult);
      const payload = await runRetractCase(
        "/retract-knowledge discriminated-unions",
        retractFn,
      );
      expect(retractFn).toHaveBeenCalledWith({
        target: "knowledge",
        slug: "discriminated-unions",
      });
      expect(payload.text).toBe("Retracted: knowledge  discriminated-unions");
    });

    it("/retract-tasks <id> dispatches with target=tasks and renders the moved-to-dropped arm", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-x",
          previousPath: "data/tasks/backlog/task-x.md",
          path: "data/tasks/dropped/task-x.md",
          toState: "dropped",
        },
      } satisfies RetractResult);
      const payload = await runRetractCase("/retract-tasks task-x", retractFn);
      expect(retractFn).toHaveBeenCalledWith({ target: "tasks", id: "task-x" });
      expect(payload.text).toBe(
        "Retracted: tasks  task-x  data/tasks/backlog/task-x.md -> data/tasks/dropped/task-x.md (dropped)",
      );
    });

    it("/retract-inbox <path> dispatches with target=inbox and renders the inbox success arm with path", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: true,
        record: {
          target: "inbox",
          recordId: "note-foo",
          path: "data/inbox/note-foo.md",
        },
      } satisfies RetractResult);
      const payload = await runRetractCase(
        "/retract-inbox data/inbox/note-foo.md",
        retractFn,
      );
      expect(retractFn).toHaveBeenCalledWith({
        target: "inbox",
        path: "data/inbox/note-foo.md",
      });
      expect(payload.text).toBe(
        "Retracted: inbox  note-foo  data/inbox/note-foo.md",
      );
    });

    it("renders the no_contributors arm with a fixed unconfigured body", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: false,
        reason: "no_contributors",
      } satisfies RetractResult);
      const payload = await runRetractCase(
        "/retract-memory mem-001",
        retractFn,
      );
      expect(payload.text).toBe(
        "Cross-store retract has no registered contributors for the named target.",
      );
    });

    it("renders the not_found arm naming the target and the verbatim identifier", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: false,
        reason: "not_found",
        target: "memory",
        identifier: "mem-does-not-exist",
      } satisfies RetractResult);
      const payload = await runRetractCase(
        "/retract-memory mem-does-not-exist",
        retractFn,
      );
      expect(payload.text).toBe(
        'Retract memory: no record with identifier "mem-does-not-exist".',
      );
    });

    it("renders the contributor_failed arm with the target and verbatim error message", async () => {
      const retractFn = vi.fn().mockResolvedValue({
        ok: false,
        reason: "contributor_failed",
        target: "tasks",
        message: "ENOENT: data/tasks/dropped missing",
      } satisfies RetractResult);
      const payload = await runRetractCase(
        "/retract-tasks task-x",
        retractFn,
      );
      expect(payload.text).toBe(
        "Retract from tasks failed: ENOENT: data/tasks/dropped missing",
      );
    });

    it("short-circuits empty-argument /retract-<target> without calling the seam, surfacing the per-target usage body", async () => {
      const retractFn = vi.fn();
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/retract-memory"),
          makeUpdate(2, Number(FAKE_CHAT_ID), "/retract-memory   "),
          makeUpdate(3, Number(FAKE_CHAT_ID), "/retract-knowledge"),
          makeUpdate(4, Number(FAKE_CHAT_ID), "/retract-knowledge   "),
          makeUpdate(5, Number(FAKE_CHAT_ID), "/retract-tasks"),
          makeUpdate(6, Number(FAKE_CHAT_ID), "/retract-inbox  "),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(),
        makeRetractStub(retractFn),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(retractFn).not.toHaveBeenCalled();
      const sendCalls = mockedCallTelegramApi.mock.calls.filter(
        (c) => c[1] === "sendMessage",
      );
      const bodies = sendCalls.map((c) => (c[2] as { text: string }).text);
      expect(bodies).toEqual([
        "Usage: /retract-memory <id>",
        "Usage: /retract-memory <id>",
        "Usage: /retract-knowledge <slug>",
        "Usage: /retract-knowledge <slug>",
        "Usage: /retract-tasks <id>",
        "Usage: /retract-inbox <path>",
      ]);
    });

    it("renders the umbrella /retract help body without calling the seam", async () => {
      const retractFn = vi.fn();
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, Number(FAKE_CHAT_ID), "/retract"),
          makeUpdate(2, Number(FAKE_CHAT_ID), "/retract memory mem-001"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(),
        makeRetractStub(retractFn),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(retractFn).not.toHaveBeenCalled();
      const sendCalls = mockedCallTelegramApi.mock.calls.filter(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCalls).toHaveLength(2);
      for (const call of sendCalls) {
        const body = (call[2] as { text: string }).text;
        expect(body).toContain(
          "Retract removes one record from one named store. The seam has no classifier",
        );
        expect(body).toContain("/retract-memory <id>");
        expect(body).toContain("/retract-knowledge <slug>");
        expect(body).toContain("/retract-tasks <id>");
        expect(body).toContain("/retract-inbox <path>");
      }
    });

    it("ignores all five retract commands from chats outside the allowlist", async () => {
      const retractFn = vi.fn();
      mockedCallTelegramApi
        .mockResolvedValueOnce([
          makeUpdate(1, 111111, "/retract"),
          makeUpdate(2, 111111, "/retract-memory mem-001"),
          makeUpdate(3, 111111, "/retract-knowledge slug"),
          makeUpdate(4, 111111, "/retract-tasks task-x"),
          makeUpdate(5, 111111, "/retract-inbox data/inbox/note.md"),
        ])
        .mockResolvedValue([]);
      stop = startTelegramStatusPoll(
        FAKE_TOKEN,
        FAKE_CHAT_ID,
        FAKE_PROJECT_DIR,
        makeStatusInfo,
        makeKnowledgeStub(),
        makeMemoryStub(),
        makeHistoryStub(),
        makeTasksStub(),
        makeRecallStub(),
        makeAnswerStub(),
        makeCaptureStub(),
        makeRetractStub(retractFn),
      );
      await new Promise((r) => setTimeout(r, 20));

      expect(retractFn).not.toHaveBeenCalled();
      const sendCall = mockedCallTelegramApi.mock.calls.find(
        (c) => c[1] === "sendMessage",
      );
      expect(sendCall).toBeUndefined();
    });
  });

  it("ignores messages from other chat IDs", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("ignores unknown commands silently", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/help")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("advances offset so already-seen updates are not reprocessed", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(42, Number(FAKE_CHAT_ID), "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
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
      makeHistoryStub(),
      makeTasksStub(),
      makeRecallStub(),
      makeAnswerStub(),
      makeCaptureStub(),
      makeRetractStub(),
      (msg) => logs.push(msg),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(logs.some((l) => l.includes("network timeout"))).toBe(true);
  });

  it("stops polling after stop() is called", async () => {
    mockedCallTelegramApi.mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, FAKE_PROJECT_DIR, makeStatusInfo, makeKnowledgeStub(), makeMemoryStub(), makeHistoryStub(), makeTasksStub(), makeRecallStub(), makeAnswerStub(), makeCaptureStub(), makeRetractStub());
    await new Promise((r) => setTimeout(r, 10));
    const callsBefore = mockedCallTelegramApi.mock.calls.length;
    stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedCallTelegramApi.mock.calls.length).toBe(callsBefore);
  });
});
