/**
 * Integration test: drive the openai-tools harness through the multi-file
 * coding scenario shipped by the harness-parity module (`extract-shared-helper`),
 * using a stubbed tool loop instead of a real model endpoint.
 *
 * The point is to prove the adapter's multi-turn loop can accept the
 * scenario's prompt shape, fan out through a typical read → write → verify
 * sequence, execute the verification command through the tool registry, and
 * close cleanly with `end_turn`. No live API budget, no real file edits.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const messagesStreamMock = vi.fn();
const messagesCreateMock = vi.fn();
const createModelClientMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

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

const FILE_READ_TOOL: KotaTool = {
  name: "file_read",
  description: "Read a file from the working directory",
  input_schema: {
    type: "object" as const,
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

const FILE_WRITE_TOOL: KotaTool = {
  name: "file_write",
  description: "Write a file to the working directory",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
};

const SHELL_TOOL: KotaTool = {
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

type StreamCallSnapshot = {
  messages: Anthropic.MessageParam[];
};

const streamCallSnapshots: StreamCallSnapshot[] = [];
const streamReturnQueue: ReturnType<typeof makeStubStream>[] = [];

function queueStream(stream: ReturnType<typeof makeStubStream>): void {
  streamReturnQueue.push(stream);
}

describe("openai-tools harness × extract-shared-helper scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    messagesStreamMock.mockReset();
    messagesCreateMock.mockReset();
    createModelClientMock.mockReset();
    executeToolMock.mockReset();
    getAllToolsMock.mockReset();
    streamCallSnapshots.length = 0;
    streamReturnQueue.length = 0;

    messagesStreamMock.mockImplementation(
      (params: { messages: Anthropic.MessageParam[] }) => {
        streamCallSnapshots.push({
          messages: JSON.parse(JSON.stringify(params.messages)) as Anthropic.MessageParam[],
        });
        const next = streamReturnQueue.shift();
        if (!next) throw new Error("messagesStreamMock: no scripted return value");
        return next;
      },
    );
    createModelClientMock.mockImplementation(({ model }: { model: string }) => ({
      client: { messages: { create: messagesCreateMock, stream: messagesStreamMock } },
      model,
      providerName: "openai",
    }));
    getAllToolsMock.mockReturnValue([FILE_READ_TOOL, FILE_WRITE_TOOL, SHELL_TOOL]);

    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "extract-shared-helper");
    workingDir = mkdtempSync(join(tmpdir(), "kota-scenario-loop-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("runs a four-turn read → write → verify → end_turn loop against the scenario prompt", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "extract-shared-helper");

    // Turn 1: model requests the three files mentioned in the prompt.
    queueStream(
      makeStubStream({
        final: {
          id: "msg_reads",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "read_greet",
              name: "file_read",
              input: { path: "src/greet.js" },
            },
            {
              type: "tool_use",
              id: "read_farewell",
              name: "file_read",
              input: { path: "src/farewell.js" },
            },
            {
              type: "tool_use",
              id: "read_test",
              name: "file_read",
              input: { path: "test.js" },
            },
          ] as Anthropic.ContentBlock[],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      }),
    );

    // Turn 2: model writes the new helper and wires both callers through it.
    queueStream(
      makeStubStream({
        final: {
          id: "msg_writes",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "write_sanitize",
              name: "file_write",
              input: {
                path: "src/sanitize.js",
                content:
                  'function sanitize(raw) {\n' +
                  '  return String(raw).trim().replace(/[^a-zA-Z0-9 ]/g, "");\n' +
                  "}\nmodule.exports = { sanitize };\n",
              },
            },
            {
              type: "tool_use",
              id: "write_greet",
              name: "file_write",
              input: {
                path: "src/greet.js",
                content:
                  'const { sanitize } = require("./sanitize.js");\n' +
                  "function greet(raw) { return `Hello, ${sanitize(raw)}!`; }\n" +
                  "module.exports = { greet };\n",
              },
            },
            {
              type: "tool_use",
              id: "write_farewell",
              name: "file_write",
              input: {
                path: "src/farewell.js",
                content:
                  'const { sanitize } = require("./sanitize.js");\n' +
                  "function farewell(raw) { return `Goodbye, ${sanitize(raw)}!`; }\n" +
                  "module.exports = { farewell };\n",
              },
            },
          ] as Anthropic.ContentBlock[],
          usage: { input_tokens: 30, output_tokens: 20 },
        },
      }),
    );

    // Turn 3: model runs the scenario verification command through the shell tool.
    queueStream(
      makeStubStream({
        final: {
          id: "msg_verify",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "run_verify",
              name: "shell",
              input: { command: loaded.spec.verification.command },
            },
          ] as Anthropic.ContentBlock[],
          usage: { input_tokens: 8, output_tokens: 4 },
        },
      }),
    );

    // Turn 4: model reports success and closes the loop.
    queueStream(
      makeStubStream({
        textChunks: ["Scenario solved."],
        final: {
          id: "msg_done",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "Scenario solved.",
              citations: null,
            },
          ] as Anthropic.ContentBlock[],
          usage: { input_tokens: 6, output_tokens: 3 },
        },
      }),
    );

    executeToolMock.mockImplementation(async (name: string, input: Record<string, unknown>) => {
      if (name === "file_read") {
        return { content: `<stub content for ${String(input.path)}>` };
      }
      if (name === "file_write") {
        return { content: `wrote ${String(input.path)}` };
      }
      if (name === "shell") {
        return { content: "ok\n" };
      }
      throw new Error(`unexpected tool call in scenario-loop test: ${name}`);
    });

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
    expect(result.streamedText).toBe("Scenario solved.");

    // The very first turn received the scenario prompt verbatim.
    expect(streamCallSnapshots[0].messages).toEqual([
      { role: "user", content: loaded.spec.prompt },
    ]);

    // Every scripted tool call reached the tool registry.
    const toolCallNames = executeToolMock.mock.calls.map(([name]) => name);
    expect(toolCallNames).toEqual([
      "file_read",
      "file_read",
      "file_read",
      "file_write",
      "file_write",
      "file_write",
      "shell",
    ]);

    // The verification command the adapter dispatched matches the scenario's
    // declared verification — this is the load-bearing check: a later real-
    // API run captures the same command through the same path.
    const shellCall = executeToolMock.mock.calls.find(([name]) => name === "shell");
    expect(shellCall).toBeDefined();
    expect(shellCall?.[1]).toEqual({ command: "node test.js" });
  });
});
