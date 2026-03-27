import {
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";
import { subscribeAttentionDigest } from "./attention-digest.js";

vi.mock("../telegram-client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const FAKE_TOKEN = "bot-token-test";
const FAKE_CHAT_ID = "123456789";

function makePayload(
  workflow: string,
  status: "success" | "failed" | "interrupted" = "success",
) {
  return {
    workflow,
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    status,
    triggerEvent: "runtime.idle" as const,
    durationMs: 1000,
    definitionPath: `src/workflows/${workflow}/workflow.ts`,
    runDir: `.kota/runs/run-test`,
  };
}

function writeRunMetadata(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
  totalCostUsd = 0,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      workflow,
      definitionPath: `src/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: now,
      completedAt: now,
      status,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [],
      totalCostUsd,
    }),
    "utf-8",
  );
}

function makeTaskDir(projectDir: string, state: string, count: number): void {
  const dir = join(projectDir, "tasks", state);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `task-test-${i}.md`), `# task ${i}\n`, "utf-8");
  }
}

describe("subscribeAttentionDigest", () => {
  let projectDir: string;
  let runsDir: string;
  let bus: EventBus;
  let unsubscribe: () => void;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-digest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    bus = new EventBus();
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true, result: {} } as never);
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_ALERT_CHAT_ID = FAKE_CHAT_ID;
    unsubscribe = subscribeAttentionDigest(bus, projectDir, runsDir);
  });

  afterEach(() => {
    unsubscribe();
    rmSync(projectDir, { recursive: true, force: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    delete process.env.KOTA_DIGEST_COST_THRESHOLD;
  });

  function emitCompletions(n: number, workflow = "builder", status: "success" | "failed" | "interrupted" = "success"): void {
    for (let i = 0; i < n; i++) {
      bus.emit("workflow.completed", makePayload(workflow, status));
    }
  }

  it("does not send digest before 10 completions", async () => {
    emitCompletions(9);
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("does not send digest at 10 completions when nothing warrants attention", async () => {
    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("sends digest at exactly 10 completions when builder failure streak >= 3", async () => {
    // Seed 3 consecutive builder failures in runsDir (most-recent-first by name)
    writeRunMetadata(runsDir, "2026-03-27-run-c", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-b", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "failed");

    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Builder failure streak");
    expect(body.text).toContain("consecutive failures");
  });

  it("does not send digest at 10 completions when builder failures < 3", async () => {
    writeRunMetadata(runsDir, "2026-03-27-run-b", "builder", "failed");
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "failed");

    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("sends digest for high spend when total exceeds threshold", async () => {
    process.env.KOTA_DIGEST_COST_THRESHOLD = "5";
    writeRunMetadata(runsDir, "2026-03-27-run-a", "builder", "success", 10);

    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Budget pressure");
    expect(body.text).toContain("$10.00");
  });

  it("sends digest for stalled work when doing count >= 2", async () => {
    makeTaskDir(projectDir, "doing", 2);

    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Stalled work");
    expect(body.text).toContain("2 tasks stuck in doing");
  });

  it("sends digest for blocked backlog when blocked count >= 2", async () => {
    makeTaskDir(projectDir, "blocked", 2);

    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Blocked backlog");
    expect(body.text).toContain("2 blocked tasks");
  });

  it("includes multiple attention items in one digest", async () => {
    makeTaskDir(projectDir, "doing", 3);
    makeTaskDir(projectDir, "blocked", 2);

    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Stalled work");
    expect(body.text).toContain("Blocked backlog");
    expect(body.text).toContain("2 items");
  });

  it("sends digest every 10 completions, not just once", async () => {
    makeTaskDir(projectDir, "doing", 2);

    emitCompletions(20);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledTimes(2);
  });

  it("does not send when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    makeTaskDir(projectDir, "doing", 2);
    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("does not send when TELEGRAM_ALERT_CHAT_ID is missing", async () => {
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    makeTaskDir(projectDir, "doing", 2);
    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("uses correct chat_id and parse_mode", async () => {
    makeTaskDir(projectDir, "doing", 2);
    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({
        chat_id: FAKE_CHAT_ID,
        parse_mode: "Markdown",
      }),
    );
  });

  it("catches and logs Telegram API errors without throwing", async () => {
    const logs: string[] = [];
    unsubscribe();
    unsubscribe = subscribeAttentionDigest(bus, projectDir, runsDir, (msg) =>
      logs.push(msg),
    );
    makeTaskDir(projectDir, "doing", 2);
    mockedCallTelegramApi.mockRejectedValue(new Error("timeout"));
    emitCompletions(10);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("timeout");
  });

  it("unsubscribes correctly and stops receiving events", async () => {
    makeTaskDir(projectDir, "doing", 2);
    unsubscribe();
    emitCompletions(10);
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("digest text starts with attention digest header", async () => {
    makeTaskDir(projectDir, "doing", 2);
    emitCompletions(10);
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toMatch(/^Attention digest \(\d+ items?\):/);
  });

  it("lists all run dirs to verify test isolation", () => {
    // Sanity check: each test starts with a fresh runsDir
    const entries = readdirSync(runsDir);
    expect(entries).toHaveLength(0);
  });
});
