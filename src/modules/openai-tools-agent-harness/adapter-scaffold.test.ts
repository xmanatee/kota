import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KotaContentBlock } from "#core/agent-harness/message-protocol.js";
import {
  makeStubStream,
  messagesStreamMock,
  openaiToolsScaffoldAgentHarness,
  queueEnd,
  queueToolUse,
  streamCallSnapshots,
  streamReturnQueue,
} from "./adapter-scaffold-test-support.js";

function textBlock(text: string): KotaContentBlock {
  return { type: "text", text, citations: null } as KotaContentBlock;
}

describe("openaiToolsScaffoldAgentHarness scaffold mode", () => {
  it("adds scaffold guidance to the run", async () => {
    queueEnd("done");

    await openaiToolsScaffoldAgentHarness.run({
      prompt: "fix the repo",
      model: "openai/local-small",
      modelOutputTokenLimits: { "openai/local-small": 2048 },
      effort: "low",
      systemPrompt: "base instructions",
    });

    const firstStreamParams = messagesStreamMock.mock.calls[0]?.[0];
    expect(firstStreamParams?.system).toContain("base instructions");
    expect(firstStreamParams?.system).toContain("KOTA scaffold mode is active");
  });

  it("completes a constrained edit-and-verify fixture through scaffold tools and JSON-action fallback", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "openai-tools-scaffold-fixture-"));
    try {
      writeFileSync(
        join(scopeRoot, "math.cjs"),
        "function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n",
      );
      writeFileSync(
        join(scopeRoot, "test.cjs"),
        "const { add } = require('./math.cjs');\nrequire('node:assert/strict').equal(add(2, 3), 5);\n",
      );
      queueToolUse("scaffold_verify_before", "scaffold_verify", {
        command: "node test.cjs",
      });
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

      const result = await openaiToolsScaffoldAgentHarness.run({
        prompt: "Fix add and verify with node test.cjs.",
        model: "ollama/qwen2.5-coder",
        modelOutputTokenLimits: { "ollama/qwen2.5-coder": 2048 },
        effort: "low",
        cwd: scopeRoot,
      });

      expect(result).toMatchObject({ text: "verified", turns: 5, isError: false });
      expect(readFileSync(join(scopeRoot, "math.cjs"), "utf-8")).toContain(
        "return a + b;",
      );
      expect(JSON.stringify(streamCallSnapshots[1]?.messages)).toContain("scaffold_verify.1 error");
      const finalTranscript = JSON.stringify(streamCallSnapshots[4]?.messages);
      expect(finalTranscript).toContain("scaffold_verify.1 ok");
      const verifyTurnTranscript = JSON.stringify(
        streamCallSnapshots[3]?.messages,
      );
      expect(verifyTurnTranscript).toContain('"id":"json_action_3"');
      expect(verifyTurnTranscript).toContain('"name":"scaffold_edit"');
      expect(verifyTurnTranscript).toContain('"tool_use_id":"json_action_3"');
    } finally {
      rmSync(scopeRoot, { recursive: true, force: true });
    }
  });
});
