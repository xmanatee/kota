/**
 * Integration test: drive the openai-tools harness through the
 * `revise-from-test-output` scenario using a stubbed tool loop.
 *
 * The scenario is tool-result-fidelity bait — the expected return value only
 * surfaces in the verification failure output. The stubbed "revise" turn
 * extracts that value out of the prior tool_result via regex rather than
 * encoding it as a test constant, so a regression in the adapter's
 * hand-composed tool_result path starves the regex and fails the test.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KotaContentBlock,
  KotaMessage,
  KotaTool,
} from "#core/agent-harness/message-protocol.js";

const messagesStreamMock = vi.fn();
const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();
const getToolEffectMock = vi.fn();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
  getToolEffect: (...args: unknown[]) => getToolEffectMock(...args),
}));

import { loadScenario } from "#modules/harness-parity/scenario.js";
import { openaiToolsAgentHarness } from "./adapter.js";
import {
  concatToolResultContent,
  EXPECTED_PATTERN,
  extractExpectedFromToolResult,
  FILE_READ_TOOL,
  FILE_WRITE_TOOL,
  makeStubStream,
  SHELL_TOOL,
  SHIPPED_SCENARIOS_ROOT,
  type StubStream,
} from "./scenario-loop-test-support.js";

type StreamCallSnapshot = { messages: KotaMessage[] };
type StreamBuilder = (messages: KotaMessage[]) => StubStream;

const streamCallSnapshots: StreamCallSnapshot[] = [];
const streamBuilderQueue: StreamBuilder[] = [];

function queueStreamBuilder(builder: StreamBuilder): void {
  streamBuilderQueue.push(builder);
}

describe("openai-tools harness × revise-from-test-output scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    messagesStreamMock.mockReset();
    messagesCreateMock.mockReset();
    createModelClientMock.mockReset();
    executeToolMock.mockReset();
    getAllToolsMock.mockReset();
    getToolEffectMock.mockReset();
    streamCallSnapshots.length = 0;
    streamBuilderQueue.length = 0;

    messagesStreamMock.mockImplementation(
      (params: { messages: KotaMessage[] }) => {
        const snapshot = JSON.parse(
          JSON.stringify(params.messages),
        ) as KotaMessage[];
        streamCallSnapshots.push({ messages: snapshot });
        const next = streamBuilderQueue.shift();
        if (!next) throw new Error("messagesStreamMock: no scripted builder for this turn");
        return next(snapshot);
      },
    );
    createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
      client: { messages: { create: messagesCreateMock, stream: messagesStreamMock } },
      model,
      providerName: "openai",
    }));
    getAllToolsMock.mockReturnValue([FILE_READ_TOOL, FILE_WRITE_TOOL, SHELL_TOOL]);

    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "revise-from-test-output");
    workingDir = mkdtempSync(join(tmpdir(), "kota-scenario-loop-revise-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("extracts the expected value from the failing shell tool_result and revises src/secret.js", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "revise-from-test-output");

    executeToolMock.mockImplementation(
      async (name: string, input: Record<string, unknown>) => {
        if (name === "file_read") {
          return { content: readFileSync(join(workingDir, String(input.path)), "utf-8") };
        }
        if (name === "file_write") {
          const target = join(workingDir, String(input.path));
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, String(input.content));
          return { content: `wrote ${String(input.path)}` };
        }
        if (name === "shell") {
          const result = spawnSync(String(input.command), {
            shell: true,
            cwd: workingDir,
            encoding: "utf-8",
            timeout: 15_000,
          });
          const combined = [result.stdout, result.stderr]
            .filter((part) => part && part.length > 0)
            .join("\n");
          return { content: combined, is_error: (result.status ?? 1) !== 0 };
        }
        throw new Error(`unexpected tool call in revise scenario test: ${name}`);
      },
    );

    // Turn 1: run the verification command so the assertion failure (which
    // carries the expected value) flows back through the adapter's
    // tool_result composition.
    queueStreamBuilder(() =>
      makeStubStream({
        final: {
          id: "msg_first_run",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "run_failing",
              name: "shell",
              input: { command: loaded.spec.verification.command },
            },
          ] as KotaContentBlock[],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      }),
    );

    // Turn 2 is load-bearing: it reads the expected value out of the
    // messages the adapter handed back, not a test constant.
    queueStreamBuilder((messages) => {
      const expected = extractExpectedFromToolResult(messages);
      const fixedSecret =
        `function secret() {\n  return ${JSON.stringify(expected)};\n}\n\n` +
        `module.exports = { secret };\n`;
      return makeStubStream({
        final: {
          id: "msg_revise",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "write_secret",
              name: "file_write",
              input: { path: "src/secret.js", content: fixedSecret },
            },
          ] as KotaContentBlock[],
          usage: { input_tokens: 20, output_tokens: 10 },
        },
      });
    });

    queueStreamBuilder(() =>
      makeStubStream({
        final: {
          id: "msg_reverify",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "run_passing",
              name: "shell",
              input: { command: loaded.spec.verification.command },
            },
          ] as KotaContentBlock[],
          usage: { input_tokens: 8, output_tokens: 4 },
        },
      }),
    );

    queueStreamBuilder(() =>
      makeStubStream({
        textChunks: ["Scenario solved."],
        final: {
          id: "msg_done",
          stop_reason: "end_turn",
          content: [
            { type: "text", text: "Scenario solved." },
          ] as KotaContentBlock[],
          usage: { input_tokens: 6, output_tokens: 3 },
        },
      }),
    );

    const result = await openaiToolsAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "openai/gpt-5.4-mini",
      effort: "xhigh",
      cwd: workingDir,
    });

    expect(streamCallSnapshots).toHaveLength(4);
    expect(result.turns).toBe(4);
    expect(result.isError).toBe(false);
    expect(result.text).toBe("Scenario solved.");

    expect(streamCallSnapshots[0].messages).toEqual([
      { role: "user", content: loaded.spec.prompt },
    ]);

    const toolCallNames = executeToolMock.mock.calls.map(([name]) => name);
    expect(toolCallNames).toEqual(["shell", "file_write", "shell"]);

    const shellCalls = executeToolMock.mock.calls.filter(
      ([name]) => name === "shell",
    );
    expect(shellCalls).toHaveLength(2);
    for (const [, input] of shellCalls) {
      expect(input).toEqual({ command: loaded.spec.verification.command });
    }

    // Prove the failure-output bytes flowed through the harness's message
    // history into the revise turn — this is the tool-result-fidelity check.
    const reviseTurnMessages = streamCallSnapshots[1].messages;
    const blobAtReviseTurn = concatToolResultContent(reviseTurnMessages);
    const expectedMatch = EXPECTED_PATTERN.exec(blobAtReviseTurn);
    expect(
      expectedMatch,
      "revise-turn tool_result content must carry the assertion failure bytes",
    ).not.toBeNull();
    const expectedValue = expectedMatch?.[1] ?? "";
    expect(expectedValue.length).toBeGreaterThan(0);
    expect(blobAtReviseTurn).toContain(`must return exactly "${expectedValue}"`);

    const writeCall = executeToolMock.mock.calls.find(
      ([name]) => name === "file_write",
    );
    expect(writeCall).toBeDefined();
    const [, writeInput] = writeCall as [string, Record<string, unknown>];
    expect(writeInput.path).toBe("src/secret.js");
    expect(String(writeInput.content)).toContain(JSON.stringify(expectedValue));

    const verify = spawnSync(loaded.spec.verification.command, {
      shell: true,
      cwd: workingDir,
      encoding: "utf-8",
      timeout: loaded.spec.verification.timeoutMs,
    });
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("ok");
  });
});
