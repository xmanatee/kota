import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KotaContentBlock } from "#core/agent-harness/message-protocol.js";
import { runShell } from "#modules/execution/shell.js";
import { runFileEdit } from "#modules/filesystem/file-edit.js";
import { runFileRead } from "#modules/filesystem/file-read.js";
import {
  executeToolMock,
  makeStubStream,
  messagesStreamMock,
  openaiToolsScaffoldAgentHarness,
  queueEnd,
  queueToolUse,
  streamCallSnapshots,
  streamReturnQueue,
} from "./adapter-scaffold-test-support.js";
import { OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME } from "./constants.js";

function textBlock(text: string): KotaContentBlock {
  return { type: "text", text, citations: null } as KotaContentBlock;
}

describe("openaiToolsScaffoldAgentHarness scaffold mode", () => {
  it("registers scaffold identity, tools, and guidance", async () => {
    queueEnd("done");

    await openaiToolsScaffoldAgentHarness.run({
      prompt: "fix the repo",
      model: "openai/local-small",
      modelOutputTokenLimits: { "openai/local-small": 2048 },
      effort: "low",
      systemPrompt: "base instructions",
    });

    expect(openaiToolsScaffoldAgentHarness.name).toBe(
      OPENAI_TOOLS_SCAFFOLD_AGENT_HARNESS_NAME,
    );
    expect(openaiToolsScaffoldAgentHarness.supportsMultiTurn).toBe(true);
    expect(openaiToolsScaffoldAgentHarness.emitsAgentMessageStream).toBe(true);
    const firstStreamParams = messagesStreamMock.mock.calls[0]?.[0];
    expect(firstStreamParams?.system).toContain("base instructions");
    expect(firstStreamParams?.system).toContain("KOTA scaffold mode is active");
    expect(streamCallSnapshots[0]?.tools?.map((tool) => tool.name)).toEqual([
      "scaffold_inspect",
      "scaffold_search_read",
      "scaffold_edit",
      "scaffold_apply_patch",
      "scaffold_run",
      "scaffold_verify",
    ]);
  });

  it("completes a constrained edit-and-verify fixture through scaffold tools and JSON-action fallback", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "openai-tools-scaffold-fixture-"));
    try {
      writeFileSync(
        join(projectDir, "math.cjs"),
        "function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n",
      );
      writeFileSync(
        join(projectDir, "test.cjs"),
        "const { add } = require('./math.cjs');\nif (add(2, 3) !== 5) process.exit(1);\n",
      );
      queueToolUse("scaffold_read", "scaffold_search_read", {
        read_paths: ["math.cjs", "test.cjs"],
      });
      const editAction = JSON.stringify({
        action: "scaffold_edit",
        input: {
          path: "math.cjs",
          old_string: "return a - b;",
          new_string: "return a + b;",
        },
      });
      streamReturnQueue.push(
        makeStubStream({
          id: "msg_scaffold_json_edit",
          stop_reason: "end_turn",
          content: [textBlock(editAction)],
        }),
      );
      queueToolUse("scaffold_verify", "scaffold_verify", {
        command: "node test.cjs",
      });
      queueEnd("verified");
      executeToolMock.mockImplementation(async (name, input, context) => {
        const toolContext = { cwd: context?.cwd ?? projectDir };
        if (name === "file_read") return runFileRead(input, toolContext);
        if (name === "file_edit") return runFileEdit(input, toolContext);
        if (name === "shell") return runShell(input, toolContext);
        if (name === "git") return { content: "diff -- math.cjs" };
        throw new Error(`unexpected scaffold underlying tool call: ${name}`);
      });

      const result = await openaiToolsScaffoldAgentHarness.run({
        prompt: "Fix add and verify with node test.cjs.",
        model: "ollama/qwen2.5-coder",
        modelOutputTokenLimits: { "ollama/qwen2.5-coder": 2048 },
        effort: "low",
        cwd: projectDir,
      });

      expect(result).toMatchObject({ text: "verified", turns: 4, isError: false });
      expect(readFileSync(join(projectDir, "math.cjs"), "utf-8")).toContain(
        "return a + b;",
      );
      expect(executeToolMock.mock.calls.map(([name]) => name)).toEqual([
        "file_read",
        "file_read",
        "file_edit",
        "shell",
        "git",
      ]);
      const verifyTurnTranscript = JSON.stringify(
        streamCallSnapshots[2]?.messages,
      );
      expect(verifyTurnTranscript).toContain('"id":"json_action_2"');
      expect(verifyTurnTranscript).toContain('"name":"scaffold_edit"');
      expect(verifyTurnTranscript).toContain('"tool_use_id":"json_action_2"');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
