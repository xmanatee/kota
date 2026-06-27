import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runFileEdit } from "#modules/filesystem/file-edit.js";
import {
  executeToolMock,
  openaiToolsScaffoldAgentHarness,
  queueEnd,
  queueToolUse,
  streamCallSnapshots,
} from "./adapter-scaffold-test-support.js";

describe("openaiToolsScaffoldAgentHarness verifier enforcement", () => {
  it("rejects a final scaffold response after an edit path without verifier evidence", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "openai-tools-scaffold-unverified-"));
    try {
      writeFileSync(join(projectDir, "math.js"), "module.exports = 1;\n");
      queueToolUse("scaffold_edit", "scaffold_edit", {
        path: "math.js",
        old_string: "module.exports = 1;",
        new_string: "module.exports = 2;",
      });
      queueEnd("done");
      executeToolMock.mockImplementation(async (name, input, context) => {
        if (name === "file_edit") {
          return runFileEdit(input, { cwd: context?.cwd ?? projectDir });
        }
        throw new Error(`unexpected scaffold underlying tool call: ${name}`);
      });

      const result = await openaiToolsScaffoldAgentHarness.run({
        prompt: "Edit math.js.",
        model: "ollama/qwen2.5-coder",
        modelOutputTokenLimits: { "ollama/qwen2.5-coder": 2048 },
        effort: "low",
        cwd: projectDir,
      });

      expect(result).toMatchObject({
        isError: true,
        subtype: "scaffold_verification_required",
      });
      expect(result.text).toContain("scaffold_verify is required");
      expect(readFileSync(join(projectDir, "math.js"), "utf-8")).toContain(
        "module.exports = 2;",
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("feeds failed verifier output back to the model before a bounded repair turn", async () => {
    queueToolUse("scaffold_verify_bad", "scaffold_verify", {
      command: "node test.js",
    });
    queueEnd("repairing");
    executeToolMock.mockImplementation(async (name) => {
      if (name === "shell") {
        return { content: "AssertionError: expected 5", is_error: true };
      }
      if (name === "git") return { content: "diff -- math.js" };
      throw new Error(`unexpected scaffold verify tool call: ${name}`);
    });

    await openaiToolsScaffoldAgentHarness.run({
      prompt: "verify",
      model: "ollama/qwen2.5-coder",
      modelOutputTokenLimits: { "ollama/qwen2.5-coder": 2048 },
      effort: "low",
      maxTurns: 2,
    });

    const secondTurnMessages = JSON.stringify(streamCallSnapshots[1]?.messages);
    expect(secondTurnMessages).toContain("AssertionError: expected 5");
    expect(secondTurnMessages).toContain("scaffold_verify.1 error");
  });
});
