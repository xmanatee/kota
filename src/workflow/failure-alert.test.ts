import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { callTelegramApi } from "../telegram-client.js";
import { subscribeWorkflowFailureAlert } from "./failure-alert.js";

vi.mock("../telegram-client.js", () => ({
  callTelegramApi: vi.fn(),
}));

const mockedCallTelegramApi = vi.mocked(callTelegramApi);

const FAKE_TOKEN = "bot-token-123";
const FAKE_CHAT_ID = "987654321";

function makePayload(
  status: "success" | "failed" | "interrupted",
  overrides: Partial<{
    workflow: string;
    runId: string;
    durationMs: number;
    runDir: string;
  }> = {},
) {
  return {
    workflow: overrides.workflow ?? "builder",
    runId: overrides.runId ?? "run-abc",
    status,
    triggerEvent: "runtime.idle",
    durationMs: overrides.durationMs ?? 5000,
    definitionPath: "src/workflows/builder/workflow.ts",
    runDir: overrides.runDir ?? ".kota/runs/run-abc",
  };
}

describe("subscribeWorkflowFailureAlert", () => {
  let projectDir: string;
  let bus: EventBus;
  let unsubscribe: () => void;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    bus = new EventBus();
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true, result: {} } as never);
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    process.env.TELEGRAM_ALERT_CHAT_ID = FAKE_CHAT_ID;
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir);
  });

  afterEach(() => {
    unsubscribe();
    rmSync(projectDir, { recursive: true, force: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
  });

  it("sends alert on failed workflow", async () => {
    const payload = makePayload("failed");
    bus.emit("workflow.completed", payload);
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledWith(
      FAKE_TOKEN,
      "sendMessage",
      expect.objectContaining({
        chat_id: FAKE_CHAT_ID,
        parse_mode: "Markdown",
      }),
    );
    const call = mockedCallTelegramApi.mock.calls[0];
    const body = call[2] as { text: string };
    expect(body.text).toContain("failed");
    expect(body.text).toContain("builder");
    expect(body.text).toContain("run-abc");
    expect(body.text).toContain("5.0s");
  });

  it("sends alert on interrupted workflow", async () => {
    bus.emit("workflow.completed", makePayload("interrupted"));
    await Promise.resolve();
    expect(mockedCallTelegramApi).toHaveBeenCalledOnce();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("interrupted");
  });

  it("does not send alert on success", async () => {
    bus.emit("workflow.completed", makePayload("success"));
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("does not send alert when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    bus.emit("workflow.completed", makePayload("failed"));
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("does not send alert when TELEGRAM_ALERT_CHAT_ID is missing", async () => {
    delete process.env.TELEGRAM_ALERT_CHAT_ID;
    bus.emit("workflow.completed", makePayload("failed"));
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });

  it("includes error summary when error.txt exists", async () => {
    const runDir = ".kota/runs/run-with-error";
    const runDirPath = join(projectDir, runDir);
    mkdirSync(runDirPath, { recursive: true });
    writeFileSync(join(runDirPath, "error.txt"), "Agent exceeded token budget");
    bus.emit("workflow.completed", makePayload("failed", { runDir }));
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("Agent exceeded token budget");
  });

  it("omits error line when error.txt is absent", async () => {
    bus.emit("workflow.completed", makePayload("failed"));
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).not.toContain("Error:");
  });

  it("truncates long error summaries", async () => {
    const runDir = ".kota/runs/run-long-error";
    const runDirPath = join(projectDir, runDir);
    mkdirSync(runDirPath, { recursive: true });
    writeFileSync(join(runDirPath, "error.txt"), "x".repeat(500));
    bus.emit("workflow.completed", makePayload("failed", { runDir }));
    await Promise.resolve();
    const body = mockedCallTelegramApi.mock.calls[0][2] as { text: string };
    expect(body.text).toContain("...");
    expect(body.text.length).toBeLessThan(600);
  });

  it("catches and logs Telegram API errors without throwing", async () => {
    const logs: string[] = [];
    unsubscribe();
    unsubscribe = subscribeWorkflowFailureAlert(bus, projectDir, (msg) =>
      logs.push(msg),
    );
    mockedCallTelegramApi.mockRejectedValue(new Error("network failure"));
    bus.emit("workflow.completed", makePayload("failed"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("network failure");
  });

  it("unsubscribes correctly and stops receiving events", async () => {
    unsubscribe();
    bus.emit("workflow.completed", makePayload("failed"));
    await Promise.resolve();
    expect(mockedCallTelegramApi).not.toHaveBeenCalled();
  });
});
