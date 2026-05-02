/**
 * Integration test: drive the gemini agent harness through the harness-parity
 * `fix-arithmetic-bug` scenario with the Google Gen AI SDK mocked. The point
 * is to prove the adapter wires the parity scenario's prompt + tool dispatch
 * through `models.generateContentStream` cleanly without hitting a live API
 * endpoint.
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";

const generateContentStreamMock = vi.fn();
const executeToolMock = vi.fn();
const getAllToolsMock = vi.fn<() => readonly KotaTool[]>();

vi.mock("@google/genai", () => ({
  GoogleGenAI: function MockGoogleGenAI(this: unknown) {
    (this as { models: unknown }).models = {
      generateContentStream: (...args: unknown[]) =>
        generateContentStreamMock(...args),
    };
  },
}));

vi.mock("#core/tools/index.js", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
  getAllTools: () => getAllToolsMock(),
}));

import { loadScenario } from "#modules/harness-parity/scenario.js";
import { geminiAgentHarness } from "./adapter.js";

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

function streamOf(chunks: ReadonlyArray<Record<string, unknown>>) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

function functionCallChunk(
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ functionCall: { id, name, args } }],
        },
      },
    ],
  };
}

function finalTextChunk(text: string) {
  return {
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
  };
}

describe("gemini agent harness × fix-arithmetic-bug scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    generateContentStreamMock.mockReset();
    executeToolMock.mockReset();
    getAllToolsMock.mockReset();
    getAllToolsMock.mockReturnValue([FILE_READ_TOOL, FILE_WRITE_TOOL, SHELL_TOOL]);

    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");
    workingDir = mkdtempSync(join(tmpdir(), "kota-gemini-scenario-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("dispatches the scenario's tool calls through executeTool, ending on STOP", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "fix-arithmetic-bug");

    // Script the multi-step tool loop the model would drive: read add.js,
    // read test.js, write the fix, run the verification command, then end
    // with the final STOP turn.
    generateContentStreamMock
      .mockResolvedValueOnce(
        Promise.resolve(
          streamOf([functionCallChunk("r1", "file_read", { path: "src/add.js" })]),
        ),
      )
      .mockResolvedValueOnce(
        Promise.resolve(
          streamOf([functionCallChunk("r2", "file_read", { path: "test.js" })]),
        ),
      )
      .mockResolvedValueOnce(
        Promise.resolve(
          streamOf([
            functionCallChunk("w1", "file_write", {
              path: "src/add.js",
              content:
                "function add(a, b) { return a + b; }\nmodule.exports = { add };\n",
            }),
          ]),
        ),
      )
      .mockResolvedValueOnce(
        Promise.resolve(
          streamOf([
            functionCallChunk("s1", "shell", {
              command: loaded.spec.verification.command,
            }),
          ]),
        ),
      )
      .mockResolvedValueOnce(
        Promise.resolve(streamOf([finalTextChunk("Scenario solved.")])),
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
        throw new Error(`unexpected tool call in gemini scenario test: ${name}`);
      },
    );

    const result = await geminiAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gemini-2.5-flash",
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

    // The adapter exposed the scenario tool set on the very first turn.
    const firstArgs = generateContentStreamMock.mock.calls[0][0] as {
      config: { tools: Array<{ functionDeclarations: Array<{ name: string }> }> };
    };
    expect(
      firstArgs.config.tools[0].functionDeclarations.map((d) => d.name).sort(),
    ).toEqual(["file_read", "file_write", "shell"]);
  });
});
