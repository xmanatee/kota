import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerClient } from "#modules/answer/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { HistoryClient } from "#modules/history/client.js";
import type { KnowledgeClient } from "#modules/knowledge/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RecallClient, RecallResult } from "#modules/recall/client.js";
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

function makeScope(recall: RecallClient["recall"]): TelegramStatusScope {
  return {
    scopeRoot: "/tmp/kota-telegram-recall-runtime",
    getStatusInfo: async () => ({
      runtimeState: {
        activeRuns: [],
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      },
      dispatchPaused: false,
      runsDir: "/tmp/kota-telegram-recall-runtime/.kota/runs",
      runAuthority: {
        authorityCriticalRunIds: new Set(),
        operationallyActiveRunIds: new Set(),
        terminalRunIds: new Set(),
      },
    }),
    knowledge: {} as KnowledgeClient,
    memory: {} as MemoryClient,
    history: {} as HistoryClient,
    tasks: {} as RepoTasksClient,
    recall: { recall },
    answer: {} as AnswerClient,
    capture: {} as CaptureClient,
    retract: {} as RetractClient,
  };
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    "recall-consolidation",
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

function summarizeRecallResult(result: RecallResult): Record<string, unknown> {
  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    sources: result.hits.map((hit) => hit.source),
    answerOutcomes: result.hits.flatMap((hit) => {
      if (hit.source !== "answer") return [];
      return [hit.citationCount > 0 ? "answered" : "failed"];
    }),
  };
}

async function runRecallCommand(
  command: string,
  contractResult: RecallResult,
): Promise<{
  command: string;
  handled: boolean;
  reply: { chat_id: number; text: string; parse_mode?: string };
  recallCalls: unknown[][];
  contractResult: Record<string, unknown>;
}> {
  mockedCallTelegramApi.mockClear();
  const recall = vi.fn(async () => contractResult);

  const handled = await handleTelegramStatusCommand({
    token: TOKEN,
    messageChatId: CHAT_ID,
    text: command,
    defaultScope: makeScope(recall),
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
    recallCalls: recall.mock.calls,
    contractResult: summarizeRecallResult(contractResult),
  };
}

describe("Telegram /recall runtime evidence", () => {
  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true } as never);
  });

  it("routes recall contract arms through the real handler and writes evidence", async () => {
    const cases = [
      await runRecallCommand("/recall harness boundary", {
        ok: true,
        hits: [
          {
            source: "knowledge",
            score: 0.91,
            id: "kn-42",
            title: "Pluggable harness protocol",
            preview: "The harness boundary is a typed protocol with...",
            updated: "2026-04-20T12:00:00.000Z",
          },
          {
            source: "memory",
            score: 0.78,
            id: "mem-7",
            preview: "User prefers terse end-of-turn summaries.",
            created: "2026-04-15T09:30:00.000Z",
          },
          {
            source: "history",
            score: 0.66,
            id: "conv-12",
            title: "Daemon review 2026-04-28",
            cwd: "/Users/operator/scopes/kota",
            updatedAt: "2026-04-28T18:30:00.000Z",
          },
          {
            source: "tasks",
            score: 0.55,
            id: "task-share-or-conformance-test-daemon-wire-contracts-ac",
            title: "Share or conformance-test daemon wire contracts across clients",
            state: "open",
            priority: "p1",
          },
          {
            source: "answer",
            score: 0.49,
            id: "ans-1",
            query: "How does the harness boundary work?",
            preview: "The harness boundary is a typed protocol; see kn-42.",
            citationCount: 1,
            createdAt: "2026-05-01T12:00:00.000Z",
          },
        ],
      }),
      await runRecallCommand("/recall deploy status", {
        ok: true,
        hits: [
          {
            source: "answer",
            score: 0.31,
            id: "ans-2",
            query: "What is the latest deploy status?",
            preview: "Recall returned no hits for this question.",
            citationCount: 0,
            createdAt: "2026-05-01T12:05:00.000Z",
          },
        ],
      }),
      await runRecallCommand("/recall anything", {
        ok: false,
        reason: "semantic_unavailable",
      }),
      await runRecallCommand("/recall nothing", { ok: true, hits: [] }),
    ];

    for (const entry of cases) {
      expect(entry.handled).toBe(true);
      expect(entry.reply.chat_id).toBe(CHAT_ID);
      expect(entry.reply.parse_mode).toBeUndefined();
    }

    expect(cases[0].recallCalls).toEqual([["harness boundary"]]);
    expect(cases[0].contractResult).toMatchObject({
      ok: true,
      sources: ["knowledge", "memory", "history", "tasks", "answer"],
      answerOutcomes: ["answered"],
    });
    expect(cases[0].reply.text).toContain("knowledge");
    expect(cases[0].reply.text).toContain("memory");
    expect(cases[0].reply.text).toContain("history");
    expect(cases[0].reply.text).toContain("tasks");
    expect(cases[0].reply.text).toContain("answer");
    expect(cases[0].reply.text).toContain("[ok(1)] How does the harness boundary work?");

    expect(cases[1].recallCalls).toEqual([["deploy status"]]);
    expect(cases[1].contractResult).toMatchObject({
      ok: true,
      sources: ["answer"],
      answerOutcomes: ["failed"],
    });
    expect(cases[1].reply.text).toContain("[failed] What is the latest deploy status?");

    expect(cases[2].recallCalls).toEqual([["anything"]]);
    expect(cases[2].reply.text).toBe(
      "Cross-store recall is not configured: no contributors are registered.",
    );

    expect(cases[3].recallCalls).toEqual([["nothing"]]);
    expect(cases[3].reply.text).toBe("No matching items.");

    const dir = evidenceDirectory();
    if (!dir) return;

    writeEvidenceFile(
      "recall-command-runtime.json",
      `${JSON.stringify(
        {
          generatedBy:
            "src/modules/telegram/status-poll-recall-runtime.test.ts",
          surface: "src/modules/telegram/status-poll.ts",
          path:
            "handleTelegramStatusCommand -> scope.recall.recall -> renderRecallHitsPlain -> callTelegramApi(sendMessage)",
          contractProbeCases: [
            "mixed-source-success",
            "answer-hit-failure-arm",
            "semantic-unavailable",
          ],
          cases,
        },
        null,
        2,
      )}\n`,
    );
    writeEvidenceFile(
      "recall-command-runtime.md",
      [
        "# Telegram /recall Runtime Evidence",
        "",
        "Generated by `status-poll-recall-runtime.test.ts` from the real `handleTelegramStatusCommand` path. The Bot API transport is mocked.",
        "",
        ...cases.flatMap((entry) => [
          `## ${entry.command}`,
          "",
          "Recall client request:",
          "",
          "```json",
          JSON.stringify(entry.recallCalls[0] ?? [], null, 2),
          "```",
          "",
          "Decoded contract result:",
          "",
          "```json",
          JSON.stringify(entry.contractResult, null, 2),
          "```",
          "",
          "Telegram sendMessage:",
          "",
          "```text",
          entry.reply.text,
          "```",
          "",
        ]),
      ].join("\n"),
    );
    writeEvidenceFile(
      "recall-command-runtime-manifest.json",
      `${JSON.stringify(
        {
          generatedBy:
            "src/modules/telegram/status-poll-recall-runtime.test.ts",
          artifacts: [
            {
              path: "recall-command-runtime.json",
              bytes: statSync(join(dir, "recall-command-runtime.json")).size,
            },
            {
              path: "recall-command-runtime.md",
              bytes: statSync(join(dir, "recall-command-runtime.md")).size,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });
});
