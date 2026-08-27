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
import { callSlackApi } from "./client.js";
import {
  dispatchSlackSlashCommand,
  parseSlackSlashCommand,
  type SlackCommandClients,
} from "./commands.js";

vi.mock("./client.js", async () => {
  const actual =
    await vi.importActual<typeof import("./client.js")>("./client.js");
  return { ...actual, callSlackApi: vi.fn() };
});

const mockedCallSlackApi = vi.mocked(callSlackApi);
const TOKEN = "xoxb-test";
const CHANNEL_ID = "D-CAPTURE";

function makeClients(capture: CaptureClient["capture"]): SlackCommandClients {
  return {
    recall: {} as RecallClient,
    answer: {} as AnswerClient,
    capture: { capture },
    retract: {} as RetractClient,
    memory: {} as MemoryClient,
    knowledge: {} as KnowledgeClient,
    history: {} as HistoryClient,
    tasks: {} as RepoTasksClient,
    attention: { snapshot: () => ({ text: "" }) },
    digest: { snapshot: () => ({ text: "" }) },
  };
}

function evidenceDirectory(): string | null {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return null;
  return join(
    runDir,
    "capture-consolidation",
    "surface-runtime-evidence",
    "slack",
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
  reply: { channel: string; text: string };
  captureCalls: unknown[][];
}> {
  mockedCallSlackApi.mockClear();
  const parsed = parseSlackSlashCommand(command);
  if (!parsed) throw new Error(`expected parsed slash command for ${command}`);

  const capture = vi.fn();
  if (result) capture.mockResolvedValue(result);

  const handled = await dispatchSlackSlashCommand({
    token: TOKEN,
    channelId: CHANNEL_ID,
    parsed,
    clients: makeClients(capture),
  });

  const postCall = mockedCallSlackApi.mock.calls.find(
    (call) => call[1] === "chat.postMessage",
  );
  if (!postCall) throw new Error(`expected chat.postMessage for ${command}`);
  return {
    command,
    handled,
    reply: postCall[2] as { channel: string; text: string },
    captureCalls: capture.mock.calls,
  };
}

describe("Slack /capture runtime evidence", () => {
  beforeEach(() => {
    mockedCallSlackApi.mockReset();
    mockedCallSlackApi.mockResolvedValue({ ok: true } as never);
  });

  it("routes capture commands through the shared dispatcher and writes rendered evidence", async () => {
    const cases = [
      await runCaptureCommand("/capture remember to call alice", {
        ok: true,
        record: { target: "memory", recordId: "mem-42" },
      }),
      await runCaptureCommand("/capture-to-knowledge architecture decision", {
        ok: true,
        record: { target: "knowledge", recordId: "kn-slack-001" },
      }),
      await runCaptureCommand("/capture-to-tasks fix the login redirect", {
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-fix-redirect",
          path: "data/tasks/task-fix-redirect.md",
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
      await runCaptureCommand("/capture-to-inbox raw thought", {
        ok: false,
        reason: "contributor_failed",
        target: "inbox",
        message: "permission denied",
      }),
      await runCaptureCommand("/capture   "),
    ];

    for (const entry of cases) {
      expect(entry.handled).toBe(true);
      expect(entry.reply.channel).toBe(CHANNEL_ID);
    }
    expect(cases[0].captureCalls).toEqual([
      ["remember to call alice", undefined],
    ]);
    expect(cases[1].captureCalls).toEqual([
      ["architecture decision", { target: "knowledge" }],
    ]);
    expect(cases[2].reply.text).toBe(
      "Captured to tasks: task-fix-redirect (data/tasks/task-fix-redirect.md)",
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
            "src/modules/slack-channel/commands-capture-runtime.test.ts",
          surface: "src/modules/slack-channel/commands.ts",
          path:
            "parseSlackSlashCommand -> dispatchSlackSlashCommand -> capture.capture -> renderCaptureReplyPlain -> callSlackApi(chat.postMessage)",
          cases,
        },
        null,
        2,
      )}\n`,
    );
    writeEvidenceFile(
      "capture-command-runtime.md",
      [
        "# Slack /capture Runtime Evidence",
        "",
        "Generated by `commands-capture-runtime.test.ts` from the shared Slack slash-command dispatcher and `renderCaptureReplyPlain`. The Slack API transport is mocked.",
        "",
        ...cases.flatMap((entry) => [
          `## ${entry.command.trimEnd()}`,
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
            "src/modules/slack-channel/commands-capture-runtime.test.ts",
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
