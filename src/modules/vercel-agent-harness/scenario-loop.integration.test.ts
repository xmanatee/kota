/**
 * Integration test: drive the vercel agent harness through the harness-parity
 * `fix-arithmetic-bug` scenario with the Vercel AI SDK mocked. The point is
 * to prove the adapter wires the parity scenario's prompt + tool dispatch
 * through `streamText` cleanly without hitting a live API endpoint.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((n: number) => ({ __stepCountIs: n }));
const jsonSchemaMock = vi.fn((schema: unknown) => ({ __jsonSchema: schema }));
const dynamicToolMock = vi.fn((definition: unknown) => definition);
const createOpenAIMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  stepCountIs: (n: number) => stepCountIsMock(n),
  jsonSchema: (schema: unknown) => jsonSchemaMock(schema),
  dynamicTool: (definition: unknown) => dynamicToolMock(definition),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import { loadScenario } from "#modules/harness-parity/scenario.js";
import { vercelAgentHarness } from "./adapter.js";

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

describe("vercel agent harness × fix-arithmetic-bug scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    streamTextMock.mockReset();
    stepCountIsMock.mockReset();
    stepCountIsMock.mockImplementation((n: number) => ({ __stepCountIs: n }));
    jsonSchemaMock.mockReset();
    jsonSchemaMock.mockImplementation((schema: unknown) => ({ __jsonSchema: schema }));
    dynamicToolMock.mockReset();
    dynamicToolMock.mockImplementation((definition: unknown) => definition);
    createOpenAIMock.mockReset();
    createOpenAIMock.mockImplementation(() => (modelId: string) => ({
      __languageModel: true,
      modelId,
    }));
    executeToolMock.mockReset();
    getAllToolsMock.mockReset();
    getAllToolsMock.mockReturnValue([FILE_READ_TOOL, FILE_WRITE_TOOL, SHELL_TOOL]);

    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");
    workingDir = mkdtempSync(join(tmpdir(), "kota-vercel-scenario-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("dispatches the scenario's tool calls through executeTool, ending with end_turn-equivalent", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");

    streamTextMock.mockImplementation(
      (args: {
        tools: Record<
          string,
          { execute: (input: unknown, ctx: { toolCallId: string }) => Promise<unknown> }
        >;
        onChunk: (event: { chunk: { type: string; text?: string } }) => void;
      }) => {
        // Simulate the SDK's internal multi-step tool loop: read → write → shell.
        const reads = [
          args.tools.file_read.execute({ path: "src/add.js" }, { toolCallId: "r1" }),
          args.tools.file_read.execute({ path: "test.js" }, { toolCallId: "r2" }),
        ];
        const writes = Promise.all(reads).then(() =>
          args.tools.file_write.execute(
            {
              path: "src/add.js",
              content: "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
            },
            { toolCallId: "w1" },
          ),
        );
        const verify = writes.then(() =>
          args.tools.shell.execute(
            { command: loaded.spec.verification.command },
            { toolCallId: "s1" },
          ),
        );
        const finalDeltaEmitted = verify.then(() => {
          args.onChunk({ chunk: { type: "text-delta", text: "Scenario solved." } });
        });

        return {
          text: finalDeltaEmitted.then(() => "Scenario solved."),
          totalUsage: finalDeltaEmitted.then(() => ({
            inputTokens: 10,
            outputTokens: 5,
          })),
          steps: finalDeltaEmitted.then(() => [
            { response: { id: "step-final" } } as never,
          ]),
          finishReason: finalDeltaEmitted.then(() => "stop"),
        } as unknown as never;
      },
    );

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
        throw new Error(`unexpected tool call in vercel scenario test: ${name}`);
      },
    );

    const result = await vercelAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "openai/gpt-4o-mini",
      effort: "xhigh",
      cwd: workingDir,
    });

    expect(result.isError).toBe(false);
    expect(result.text).toBe("Scenario solved.");
    expect(result.streamedText).toBe("Scenario solved.");

    // The verification command the adapter dispatched matches the scenario's
    // declared verification — load-bearing for parity-evidence comparisons.
    const shellCall = executeToolMock.mock.calls.find(([name]) => name === "shell");
    expect(shellCall).toBeDefined();
    expect(shellCall?.[1]).toEqual({ command: "node test.js" });

    // Every scripted tool call reached the tool registry.
    const callNames = executeToolMock.mock.calls.map(([name]) => name);
    expect(callNames).toEqual(["file_read", "file_read", "file_write", "shell"]);

    // The adapter exposed the scenario tool set to the SDK.
    const args = streamTextMock.mock.calls[0][0] as { tools: Record<string, unknown> };
    expect(Object.keys(args.tools).sort()).toEqual([
      "file_read",
      "file_write",
      "shell",
    ]);
  });
});
