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
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const messagesStreamMock = vi.fn();
const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly Anthropic.Tool[]>();

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: (...args: unknown[]) => createModelClientMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import { loadScenario } from "#modules/harness-parity/scenario.js";
import { openaiToolsAgentHarness } from "./adapter.js";

const SHIPPED_SCENARIOS_ROOT = join(
  import.meta.dirname,
  "..",
  "harness-parity",
  "scenarios",
);

const FILE_READ_TOOL: Anthropic.Tool = {
  name: "file_read",
  description: "Read a file from the working directory",
  input_schema: {
    type: "object" as const,
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

const FILE_WRITE_TOOL: Anthropic.Tool = {
  name: "file_write",
  description: "Write a file to the working directory",
  input_schema: {
    type: "object" as const,
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
};

const SHELL_TOOL: Anthropic.Tool = {
  name: "shell",
  description: "Run a shell command in the working directory",
  input_schema: {
    type: "object" as const,
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

type StubFinalMessage = Pick<
  Anthropic.Message,
  "id" | "content" | "stop_reason"
> & {
  usage?: { input_tokens: number; output_tokens: number };
};

function makeStubStream(opts: {
  textChunks?: string[];
  final: StubFinalMessage;
}) {
  return {
    on(event: "text" | "thinking", cb: (delta: string) => void) {
      if (event === "text" && opts.textChunks) {
        for (const chunk of opts.textChunks) cb(chunk);
      }
      return this;
    },
    finalMessage: async (): Promise<Anthropic.Message> => ({
      id: opts.final.id,
      type: "message",
      role: "assistant",
      model: "stub-model",
      content: opts.final.content,
      stop_reason: opts.final.stop_reason ?? "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: opts.final.usage?.input_tokens ?? 0,
        output_tokens: opts.final.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    } as Anthropic.Message),
  };
}

type StreamCallSnapshot = { messages: Anthropic.MessageParam[] };
type StreamBuilder = (
  messages: Anthropic.MessageParam[],
) => ReturnType<typeof makeStubStream>;

const streamCallSnapshots: StreamCallSnapshot[] = [];
const streamBuilderQueue: StreamBuilder[] = [];

function queueStreamBuilder(builder: StreamBuilder): void {
  streamBuilderQueue.push(builder);
}

function concatToolResultContent(messages: Anthropic.MessageParam[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const content = block.content;
      if (typeof content === "string") {
        parts.push(content);
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const inner of content) {
        if (inner.type === "text" && typeof inner.text === "string") {
          parts.push(inner.text);
        }
      }
    }
  }
  return parts.join("\n");
}

const EXPECTED_PATTERN = /must return exactly "([^"]+)"/;

function extractExpectedFromToolResult(
  messages: Anthropic.MessageParam[],
): string {
  const blob = concatToolResultContent(messages);
  const match = EXPECTED_PATTERN.exec(blob);
  if (!match) {
    throw new Error(
      "stubbed revise turn could not find expected value in prior tool_result content — " +
        "adapter may have dropped tool_result.content bytes. Blob was:\n" +
        (blob.length > 0 ? blob : "<empty>"),
    );
  }
  return match[1];
}

describe("openai-tools harness × revise-from-test-output scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    messagesStreamMock.mockReset();
    messagesCreateMock.mockReset();
    createModelClientMock.mockReset();
    executeToolMock.mockReset();
    getAllToolsMock.mockReset();
    streamCallSnapshots.length = 0;
    streamBuilderQueue.length = 0;

    messagesStreamMock.mockImplementation(
      (params: { messages: Anthropic.MessageParam[] }) => {
        const snapshot = JSON.parse(
          JSON.stringify(params.messages),
        ) as Anthropic.MessageParam[];
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
          ] as Anthropic.ContentBlock[],
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
          ] as Anthropic.ContentBlock[],
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
          ] as Anthropic.ContentBlock[],
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
            { type: "text", text: "Scenario solved.", citations: null },
          ] as Anthropic.ContentBlock[],
          usage: { input_tokens: 6, output_tokens: 3 },
        },
      }),
    );

    const result = await openaiToolsAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "openai/gpt-4o-mini",
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
