import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerClient } from "#modules/answer/client.js";
import type { CaptureClient, CaptureResult } from "#modules/capture/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RecallClient } from "#modules/recall/client.js";
import type { RepoTasksClient } from "#modules/repo-tasks/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import { callTelegramApi } from "./client.js";
import {
  handleTelegramStatusCommand,
  type TelegramStatusScope,
} from "./status-poll.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callTelegramApi: vi.fn() };
});

const mockedCallTelegramApi = vi.mocked(callTelegramApi);
const TOKEN = "bot-token";
const CHAT_ID = 987654321;

function makeScope(capture: CaptureClient["capture"]): TelegramStatusScope {
  return {
    scopeRoot: "/tmp/kota-telegram-capture-runtime",
    getStatusInfo: async () => ({
      runtimeState: {
        activeRuns: [],
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      },
      dispatchPaused: false,
      runsDir: "/tmp/kota-telegram-capture-runtime/.kota/runs",
    }),
    knowledge: {} as KnowledgeClient,
    memory: {} as MemoryClient,
    history: {} as HistoryClient,
    tasks: {} as RepoTasksClient,
    recall: {} as RecallClient,
    answer: {} as AnswerClient,
    capture: { capture },
    retract: {} as RetractClient,
  };
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    "capture-consolidation",
    "surface-runtime-evidence",
    "telegram",
  );
}

function writeEvidenceFile(fileName: string, body: string): void {
  const dir = evidenceDirectory();
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), body, "utf-8");
}

async function runCaptureCommand(
  command: string,
  result?: CaptureResult,
): Promise<{
  command: string;
  handled: boolean;
  reply: { chat_id: number; text: string; parse_mode?: string };
  captureCalls: unknown[][];
}> {
  mockedCallTelegramApi.mockClear();
  const capture = vi.fn();
  if (result) capture.mockResolvedValue(result);

  const handled = await handleTelegramStatusCommand({
    token: TOKEN,
    messageChatId: CHAT_ID,
    text: command,
    defaultScope: makeScope(capture),
  });

  const sendCall = mockedCallTelegramApi.mock.calls.find(
    (call) => call[1] === "sendMessage",
  );
  if (!sendCall) throw new Error(`expected sendMessage for ${command}`);
  return {
    command,
    handled,
    reply: sendCall[2] as {
      chat_id: number;
      text: string;
      parse_mode?: string;
    },
    captureCalls: capture.mock.calls,
  };
}

describe("Telegram /capture runtime evidence", () => {
  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true } as never);
  });

  it("routes capture commands through the real handler and writes rendered evidence", async () => {
    const cases = [
      await runCaptureCommand("/capture remember to call alice", {
        ok: true,
        record: { target: "memory", recordId: "mem-001" },
      }),
      await runCaptureCommand("/capture-to-knowledge architecture decision", {
        ok: true,
        record: { target: "knowledge", recordId: "kn-arch-001" },
      }),
      await runCaptureCommand("/capture-to-tasks fix the login redirect", {
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-fix-login",
          path: "data/tasks/inbox/task-fix-login.md",
        },
      }),
      await runCaptureCommand("/capture-to-inbox raw morning thought", {
        ok: true,
        record: {
          target: "inbox",
          recordId: "thoughts-2026-04-28",
          path: "data/inbox/thoughts-2026-04-28.md",
        },
      }),
      await runCaptureCommand("/capture something vague", {
        ok: false,
        reason: "ambiguous",
        suggestions: ["memory", "knowledge", "tasks", "inbox"],
      }),
      await runCaptureCommand("/capture-to-memory anything", {
        ok: false,
        reason: "no_contributors",
      }),
      await runCaptureCommand("/capture-to-tasks file the bug", {
        ok: false,
        reason: "contributor_failed",
        target: "tasks",
        message: "ENOENT: data/tasks/inbox missing",
      }),
      await runCaptureCommand("/capture"),
    ];

    for (const entry of cases) {
      expect(entry.handled).toBe(true);
      expect(entry.reply.chat_id).toBe(CHAT_ID);
      expect(entry.reply.parse_mode).toBeUndefined();
    }
    expect(cases[0].captureCalls).toEqual([
      ["remember to call alice", undefined],
    ]);
    expect(cases[1].captureCalls).toEqual([
      ["architecture decision", { target: "knowledge" }],
    ]);
    expect(cases[2].reply.text).toBe(
      "Captured to tasks: task-fix-login (data/tasks/inbox/task-fix-login.md)",
    );
    expect(cases[4].reply.text).toBe(
      "Capture target ambiguous. Suggestions: memory, knowledge, tasks, inbox. Re-run with one of: /capture-to-memory, /capture-to-knowledge, /capture-to-tasks, /capture-to-inbox.",
    );
    expect(cases[7].captureCalls).toEqual([]);

    const dir = evidenceDirectory();
    if (!dir) return;

    writeEvidenceFile(
      "capture-command-runtime.json",
      `${JSON.stringify(
        {
          generatedBy:
            "src/modules/telegram/status-poll-capture-runtime.test.ts",
          surface: "src/modules/telegram/status-poll.ts",
          path:
            "handleTelegramStatusCommand -> scope.capture.capture -> renderCaptureReplyPlain -> callTelegramApi(sendMessage)",
          cases,
        },
        null,
        2,
      )}\n`,
    );
    writeEvidenceFile(
      "capture-command-runtime.md",
      [
        "# Telegram /capture Runtime Evidence",
        "",
        "Generated by `status-poll-capture-runtime.test.ts` from the real command handler and `renderCaptureReplyPlain`. The Bot API transport is mocked.",
        "",
        ...cases.flatMap((entry) => [
          `## ${entry.command}`,
          "",
          "```text",
          entry.reply.text,
          "```",
          "",
        ]),
      ].join("\n"),
    );
    writeEvidenceFile(
      "capture-command-runtime-manifest.json",
      `${JSON.stringify(
        {
          generatedBy:
            "src/modules/telegram/status-poll-capture-runtime.test.ts",
          artifacts: [
            {
              path: "capture-command-runtime.json",
              bytes: statSync(join(dir, "capture-command-runtime.json")).size,
            },
            {
              path: "capture-command-runtime.md",
              bytes: statSync(join(dir, "capture-command-runtime.md")).size,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });
});
