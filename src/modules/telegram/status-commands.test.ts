import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import { renderOnDemandDigest } from "#modules/autonomy/workflows/daily-digest/on-demand.js";
import { callTelegramApi } from "./client.js";
import { handleTelegramStatusCommand } from "./status-commands.js";
import type { StatusInfo, TelegramStatusScope } from "./status-types.js";

vi.mock("./client.js", async () => ({
  ...await vi.importActual<typeof import("./client.js")>("./client.js"),
  callTelegramApi: vi.fn(),
}));
vi.mock("#modules/autonomy/shared.js", () => ({
  loadRecentRuns: vi.fn().mockReturnValue([]),
  computeCostByWorkflow: vi.fn().mockReturnValue({}),
}));
vi.mock("#modules/autonomy/workflows/daily-digest/on-demand.js", () => ({
  renderOnDemandDigest: vi.fn(),
}));
vi.mock("#modules/autonomy/workflows/attention-digest/step.js", () => ({
  renderOnDemandAttention: vi.fn(),
}));

const status: StatusInfo = {
  runtimeState: { activeRuns: [], pendingRuns: [], completedRuns: 0, workflows: {} },
  dispatchPaused: false,
  runsDir: "/scope/.kota/runs",
  runAuthority: {
    authorityCriticalRunIds: new Set(),
    operationallyActiveRunIds: new Set(),
    terminalRunIds: new Set(),
  },
};

function scope(): TelegramStatusScope {
  return {
    ...createKotaClientTestDouble(),
    scopeRoot: "/scope",
    getStatusInfo: () => status,
  };
}

function command(text: string, defaultScope = scope()) {
  return handleTelegramStatusCommand({
    token: "token",
    messageChatId: 99,
    text,
    defaultScope,
  });
}

beforeEach(() => vi.clearAllMocks());

// Owner cadence: command text enters the production adapter; the Bot API payload
// proves parsing/delivery. Shared owners retain domain result/lifecycle matrices.
describe("Telegram status command delivery", () => {
  it("addresses status to the requesting chat using Telegram Markdown", async () => {
    expect(await command("/status")).toBe(true);
    expect(callTelegramApi).toHaveBeenCalledExactlyOnceWith("token", "sendMessage", {
      chat_id: 99,
      text: expect.stringContaining("*Dispatch:* idle"),
      parse_mode: "Markdown",
    });
  });

  it("leaves unknown commands and command-prefix collisions for interactive routing", async () => {
    for (const text of ["hello", "/unknown", "/memory-extra query", "/capture-extra note"]) {
      expect(await command(text)).toBe(false);
    }
    expect(callTelegramApi).not.toHaveBeenCalled();
  });

  it("trims a search query and sends its result as plain Telegram text", async () => {
    const memory = { ...scope().memory, search: vi.fn(async () => ({ ok: true as const, entries: [] })) };
    await command("/memory   two words  ", { ...scope(), memory });
    expect(memory.search).toHaveBeenCalledExactlyOnceWith("two words", { semantic: true, limit: 10 });
    expect(callTelegramApi).toHaveBeenCalledExactlyOnceWith("token", "sendMessage", {
      chat_id: 99, text: "No matching memory entries.",
    });
  });

  it("short-circuits missing command arguments before calling a client namespace", async () => {
    // Unconfigured client methods throw, so an accidental namespace call fails.
    for (const text of [
      "/knowledge", "/memory  ", "/history", "/tasks ", "/recall ",
      "/answer ", "/answer-show", "/capture ", "/capture-to-memory ",
      "/retract-memory ", "/retract",
    ]) {
      vi.mocked(callTelegramApi).mockClear();
      expect(await command(text)).toBe(true);
      expect(callTelegramApi).toHaveBeenCalledExactlyOnceWith("token", "sendMessage", {
        chat_id: 99, text: expect.any(String),
      });
    }
  });

  it("parses an answer-log limit and rejects malformed numeric arguments", async () => {
    const answer = { ...scope().answer, log: vi.fn(async () => ({ entries: [] })) };
    await command("/answer-log 7", { ...scope(), answer });
    expect(answer.log).toHaveBeenCalledExactlyOnceWith({ limit: 7 });
    answer.log.mockClear();
    for (const arg of ["nope", "0", "-1", "1.5", "7tail"]) {
      await command(`/answer-log ${arg}`, { ...scope(), answer });
      expect(callTelegramApi).toHaveBeenLastCalledWith("token", "sendMessage", {
        chat_id: 99, text: "Usage: /answer-log [N]",
      });
    }
    expect(answer.log).not.toHaveBeenCalled();
  });

  it("preserves an untargeted capture body without selecting a domain target", async () => {
    const capture = { capture: vi.fn(async () => ({ ok: false as const, reason: "ambiguous" as const, suggestions: [] })) };
    await command("/capture  two words ", { ...scope(), capture });
    expect(capture.capture).toHaveBeenCalledExactlyOnceWith("two words", undefined);
    expect(callTelegramApi).toHaveBeenCalledOnce();
  });

  it("bounds on-demand digest delivery to Telegram's message limit", async () => {
    vi.mocked(renderOnDemandDigest).mockReturnValue({ text: "x".repeat(5000) } as ReturnType<typeof renderOnDemandDigest>);
    await command("/digest");
    expect(renderOnDemandDigest).toHaveBeenCalledExactlyOnceWith({ scopeRoot: "/scope", stateDir: "/scope/.kota" });
    const body = vi.mocked(callTelegramApi).mock.calls[0]?.[2];
    expect(callTelegramApi).toHaveBeenCalledOnce();
    expect(body).toEqual({ chat_id: 99, text: expect.stringContaining("xxx") });
    expect(String(body?.text).length).toBeLessThanOrEqual(4096);
  });

  it("sends on-demand attention in-band using the selected scope's authority", async () => {
    vi.mocked(renderOnDemandAttention).mockReturnValue({ items: [], text: "attention body" });
    await command("/attention");
    expect(renderOnDemandAttention).toHaveBeenCalledExactlyOnceWith({
      scopeRoot: "/scope", runsDir: status.runsDir, authority: status.runAuthority,
    });
    expect(callTelegramApi).toHaveBeenCalledExactlyOnceWith("token", "sendMessage", {
      chat_id: 99, text: "attention body",
    });
  });
});
