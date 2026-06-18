import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerClient } from "#modules/answer/client.js";
import type { CaptureClient } from "#modules/capture/client.js";
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

function writeRunMetadata(
  runsDir: string,
  id: string,
  metadata: Record<string, unknown>,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      definitionPath: `src/modules/autonomy/workflows/${metadata.workflow}/workflow.ts`,
      trigger: { event: "manual", payload: {} },
      runDir: `.kota/runs/${id}`,
      ...metadata,
    }),
    "utf-8",
  );
}

function writeBuilderRunSummary(
  runsDir: string,
  id: string,
  summary: Record<string, unknown>,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "run-summary.json"),
    JSON.stringify({
      runId: id,
      workflow: "builder",
      taskId: null,
      taskTitle: null,
      outcome: "success",
      commitSha: "abc",
      commitMessage: "x",
      filesChanged: [],
      costUsd: null,
      durationMs: null,
      completedAt: new Date().toISOString(),
      ...summary,
    }),
    "utf-8",
  );
}

function makeProject(active: boolean): string {
  const projectDir = mkdtempSync(join(tmpdir(), "telegram-digest-runtime-"));
  const runsDir = join(projectDir, ".kota", "runs");
  mkdirSync(runsDir, { recursive: true });
  for (const state of ["backlog", "ready", "doing", "blocked"]) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  if (!active) return projectDir;

  const now = Date.now();
  const runId = "2026-06-18T14-00-00-000Z-builder-digest";
  writeRunMetadata(runsDir, runId, {
    workflow: "builder",
    status: "success",
    startedAt: new Date(now - 60_000).toISOString(),
    completedAt: new Date(now - 30_000).toISOString(),
    durationMs: 30_000,
    steps: [],
  });
  writeBuilderRunSummary(runsDir, runId, {
    taskId: "task-foo",
    taskTitle: "Add foo",
    commitMessage: "Add foo\n\nBody",
    durationMs: 30_000,
  });
  writeFileSync(
    join(projectDir, "data", "tasks", "ready", "task-ready.md"),
    "---\nid: task-ready\nstatus: ready\n---\n",
    "utf-8",
  );
  return projectDir;
}

function makeScope(projectDir: string): TelegramStatusScope {
  return {
    projectDir,
    getStatusInfo: async () => ({
      runtimeState: {
        activeRuns: [],
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      },
      dispatchPaused: false,
      runsDir: join(projectDir, ".kota", "runs"),
    }),
    knowledge: {} as KnowledgeClient,
    memory: {} as MemoryClient,
    history: {} as HistoryClient,
    tasks: {} as RepoTasksClient,
    recall: {} as RecallClient,
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
    "digest-consolidation",
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

describe("Telegram /digest runtime evidence", () => {
  const projectDirs: string[] = [];

  beforeEach(() => {
    mockedCallTelegramApi.mockReset();
    mockedCallTelegramApi.mockResolvedValue({ ok: true } as never);
  });

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("routes /digest through the real on-demand renderer and sends plain text", async () => {
    const activeProjectDir = makeProject(true);
    const quietProjectDir = makeProject(false);
    projectDirs.push(activeProjectDir, quietProjectDir);

    const activeHandled = await handleTelegramStatusCommand({
      token: TOKEN,
      messageChatId: CHAT_ID,
      text: "/digest",
      defaultScope: makeScope(activeProjectDir),
    });
    const quietHandled = await handleTelegramStatusCommand({
      token: TOKEN,
      messageChatId: CHAT_ID,
      text: "/digest",
      defaultScope: makeScope(quietProjectDir),
    });

    expect(activeHandled).toBe(true);
    expect(quietHandled).toBe(true);

    const sendCalls = mockedCallTelegramApi.mock.calls.filter(
      (call) => call[1] === "sendMessage",
    );
    expect(sendCalls).toHaveLength(2);

    const activeBody = sendCalls[0]?.[2] as {
      chat_id: number;
      text: string;
      parse_mode?: string;
    };
    const quietBody = sendCalls[1]?.[2] as {
      chat_id: number;
      text: string;
      parse_mode?: string;
    };

    expect(activeBody.chat_id).toBe(CHAT_ID);
    expect(activeBody.text).toContain("Daily digest");
    expect(activeBody.text).toContain("Builder commits");
    expect(activeBody.text).toContain("task-foo");
    expect(activeBody.text).toContain("Queue state");
    expect(activeBody.parse_mode).toBeUndefined();

    expect(quietBody.chat_id).toBe(CHAT_ID);
    expect(quietBody.text).toContain("Daily digest");
    expect(quietBody.text).toContain("No autonomy activity in this window.");
    expect(quietBody.parse_mode).toBeUndefined();

    writeEvidenceFile(
      "digest-command-runtime.json",
      `${JSON.stringify(
        {
          generatedBy:
            "src/modules/telegram/status-poll-digest-runtime.test.ts",
          surface: "src/modules/telegram/status-poll.ts",
          command: "/digest",
          path:
            "handleTelegramStatusCommand -> renderOnDemandDigest -> callTelegramApi(sendMessage)",
          active: activeBody,
          quiet: quietBody,
        },
        null,
        2,
      )}\n`,
    );
    writeEvidenceFile(
      "digest-command-runtime.md",
      [
        "# Telegram /digest Runtime Evidence",
        "",
        "Generated by `status-poll-digest-runtime.test.ts` from the real command handler and real on-demand renderer. The Bot API transport is mocked.",
        "",
        "## Active Reply",
        "",
        "```text",
        activeBody.text,
        "```",
        "",
        "## Quiet Reply",
        "",
        "```text",
        quietBody.text,
        "```",
        "",
      ].join("\n"),
    );

    const dir = evidenceDirectory();
    if (dir) {
      writeEvidenceFile(
        "digest-command-runtime-manifest.json",
        `${JSON.stringify(
          {
            generatedBy:
              "src/modules/telegram/status-poll-digest-runtime.test.ts",
            artifacts: [
              {
                path: "digest-command-runtime.json",
                bytes: statSync(join(dir, "digest-command-runtime.json")).size,
              },
              {
                path: "digest-command-runtime.md",
                bytes: statSync(join(dir, "digest-command-runtime.md")).size,
              },
            ],
          },
          null,
          2,
        )}\n`,
      );
    }
  });
});
