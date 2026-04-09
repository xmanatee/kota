import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTelegramApi } from "./client.js";
import { buildStatusText, type StatusInfo, startTelegramStatusPoll } from "./status-poll.js";

vi.mock("./client.js", () => ({
  callTelegramApi: vi.fn(),
}));

vi.mock("../../workflows/shared.js", () => ({
  loadRecentRuns: vi.fn().mockReturnValue([]),
  computeCostByWorkflow: vi.fn().mockReturnValue({}),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const FAKE_TOKEN = "bot-token-123";
const FAKE_CHAT_ID = "987654321";

function makeStatusInfo(overrides: Partial<StatusInfo> = {}): StatusInfo {
  return {
    runtimeState: {
      completedRuns: 5,
      pendingRuns: [],
      workflows: {
        builder: { lastStatus: "success", lastRunId: "run-abc" },
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
  });

  afterEach(() => {
    stop?.();
  });

  it("polls getUpdates on start", async () => {
    mockedCallTelegramApi.mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo);
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
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo);
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeDefined();
    expect(sendCall?.[2]).toMatchObject({
      chat_id: FAKE_CHAT_ID,
      parse_mode: "Markdown",
    });
    expect((sendCall?.[2] as { text: string }).text).toContain("*Dispatch:*");
  });

  it("ignores messages from other chat IDs", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, 111111, "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo);
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("ignores unknown commands silently", async () => {
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(1, Number(FAKE_CHAT_ID), "/help")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo);
    await new Promise((r) => setTimeout(r, 20));
    const sendCall = mockedCallTelegramApi.mock.calls.find((c) => c[1] === "sendMessage");
    expect(sendCall).toBeUndefined();
  });

  it("advances offset so already-seen updates are not reprocessed", async () => {
    // Return update_id=42, then nothing on subsequent polls
    mockedCallTelegramApi
      .mockResolvedValueOnce([makeUpdate(42, Number(FAKE_CHAT_ID), "/status")])
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo);
    await new Promise((r) => setTimeout(r, 20));
    // /status was sent exactly once (not duplicated)
    const sendCalls = mockedCallTelegramApi.mock.calls.filter((c) => c[1] === "sendMessage");
    expect(sendCalls).toHaveLength(1);
  });

  it("logs and continues on poll error", async () => {
    const logs: string[] = [];
    mockedCallTelegramApi
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo, (msg) =>
      logs.push(msg),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(logs.some((l) => l.includes("network timeout"))).toBe(true);
  });

  it("stops polling after stop() is called", async () => {
    mockedCallTelegramApi.mockResolvedValue([]);
    stop = startTelegramStatusPoll(FAKE_TOKEN, FAKE_CHAT_ID, makeStatusInfo);
    await new Promise((r) => setTimeout(r, 10));
    const callsBefore = mockedCallTelegramApi.mock.calls.length;
    stop();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedCallTelegramApi.mock.calls.length).toBe(callsBefore);
  });
});
