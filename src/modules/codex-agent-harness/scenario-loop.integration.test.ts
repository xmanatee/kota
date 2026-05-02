/**
 * Integration test: drive the codex agent harness through the harness-parity
 * `fix-arithmetic-bug` scenario with the OpenAI Agents SDK mocked. The point
 * is to prove the adapter wires the parity scenario's prompt + tool dispatch
 * through `Agent` + `run` cleanly without hitting a live API endpoint.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

type CapturedToolDefinition = {
  name: string;
  description: string;
  parameters: unknown;
  strict: boolean;
  execute: (
    input: Record<string, unknown>,
    runContext: unknown,
    details: { toolCall?: { callId?: string } } | undefined,
  ) => Promise<unknown>;
};

type CapturedAgent = {
  name: string;
  instructions: string;
  model: string;
  modelSettings: { reasoning: { effort: string } };
  tools: CapturedToolDefinition[];
};

const runMock = vi.fn();
const toolMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("@openai/agents", () => ({
  Agent: function MockAgent(this: unknown, config: CapturedAgent) {
    Object.assign(this as Record<string, unknown>, config);
  },
  run: (...args: unknown[]) => runMock(...args),
  tool: (definition: CapturedToolDefinition) => {
    toolMock(definition);
    return definition;
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import { loadScenario } from "#modules/harness-parity/scenario.js";
import { codexAgentHarness } from "./adapter.js";

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
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

const FILE_WRITE_TOOL: KotaTool = {
  name: "file_write",
  description: "Write a file to the working directory",
  input_schema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
};

const SHELL_TOOL: KotaTool = {
  name: "shell",
  description: "Run a shell command in the working directory",
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

describe("codex agent harness × fix-arithmetic-bug scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    runMock.mockReset();
    toolMock.mockReset();
    executeToolMock.mockReset();
    getAllToolsMock.mockReset();
    getAllToolsMock.mockReturnValue([FILE_READ_TOOL, FILE_WRITE_TOOL, SHELL_TOOL]);

    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");
    workingDir = mkdtempSync(join(tmpdir(), "kota-codex-scenario-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("dispatches the scenario's tool calls through executeTool, ending on final output", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");

    runMock.mockImplementation(async (agent: CapturedAgent) => {
      // The Agents SDK runs the multi-step loop internally. Simulate the
      // five tool-call turns the model would drive against this scenario by
      // invoking each tool's execute through the captured definition list.
      const tools = new Map(agent.tools.map((t) => [t.name, t.execute]));
      const fileRead = tools.get("file_read");
      const fileWrite = tools.get("file_write");
      const shell = tools.get("shell");
      if (!fileRead || !fileWrite || !shell) {
        throw new Error("scenario tools missing from agent");
      }

      await fileRead({ path: "src/add.js" }, undefined, {
        toolCall: { callId: "r1" },
      });
      await fileRead({ path: "test.js" }, undefined, {
        toolCall: { callId: "r2" },
      });
      await fileWrite(
        {
          path: "src/add.js",
          content:
            "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
        },
        undefined,
        { toolCall: { callId: "w1" } },
      );
      await shell({ command: loaded.spec.verification.command }, undefined, {
        toolCall: { callId: "s1" },
      });

      return {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: "raw_model_stream_event",
            data: {
              type: "output_text_delta",
              delta: "Scenario solved.",
            },
          };
        },
        completed: Promise.resolve(),
        finalOutput: "Scenario solved.",
        rawResponses: [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }],
        lastResponseId: "t5",
        runContext: { usage: { inputTokens: 100, outputTokens: 50 } },
      };
    });

    executeToolMock.mockImplementation(
      async (name: string, input: Record<string, unknown>) => {
        if (name === "file_read") {
          return { content: `<stub content for ${String(input.path)}>` };
        }
        if (name === "file_write") {
          return { content: `wrote ${String(input.path)}` };
        }
        if (name === "shell") {
          return { content: "ok\n" };
        }
        throw new Error(`unexpected tool call in codex scenario test: ${name}`);
      },
    );

    const result = await codexAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gpt-5-codex",
      effort: "xhigh",
      cwd: workingDir,
    });

    expect(result.isError).toBe(false);
    expect(result.text).toBe("Scenario solved.");
    expect(result.streamedText).toBe("Scenario solved.");

    // Every scripted tool call reached the tool registry, including the
    // verification command exactly as the scenario declared it.
    const callNames = executeToolMock.mock.calls.map(([name]) => name);
    expect(callNames).toEqual(["file_read", "file_read", "file_write", "shell"]);
    const shellCall = executeToolMock.mock.calls.find(([name]) => name === "shell");
    expect(shellCall?.[1]).toEqual({ command: "node test.js" });
  });
});
