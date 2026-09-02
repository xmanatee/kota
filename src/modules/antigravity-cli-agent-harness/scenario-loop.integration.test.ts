/**
 * Integration test: drive the Antigravity CLI agent harness through the
 * harness-parity `builder-scoped-fix` scenario. The point is to prove the
 * adapter wires the parity scenario's prompt, tool dispatch, and verification
 * contract through `stream-json` cleanly, rejecting out-of-scope edits, skipped
 * verification, missing commit messages, and incomplete CLI outputs.
 */

import "./adapter-test-support.js";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type KotaAgentMessage,
  WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION,
} from "#core/agent-harness/index.js";
import { loadScenario } from "#modules/harness-parity/scenario.js";
import { antigravityCliAgentHarness } from "./adapter.js";
import {
  adapterTestMocks,
  mockAgyProcess,
  successfulAgyOutput,
} from "./adapter-test-support.js";

const { spawnMock, sandboxLaunchMock } = adapterTestMocks();

const SHIPPED_SCENARIOS_ROOT = join(
  import.meta.dirname,
  "..",
  "harness-parity",
  "scenarios",
);

function buildAgyToolUpdateEvents(
  conversationId: string,
  toolName: string,
  params: Record<string, unknown>,
  state = "COMPLETED",
): Record<string, unknown>[] {
  return [
    {
      event: "step_update",
      step_update: {
        conversation_id: conversationId,
        step_type: "tool",
        state,
        tool_name: toolName,
        tool_info: {
          name: toolName,
          parameters: params,
        },
      },
    },
  ];
}

function buildAgyFullBuilderStream(options: {
  conversationId: string;
  response: string;
  inputTokens?: number;
  outputTokens?: number;
}): string {
  const cid = options.conversationId;
  const events: Record<string, unknown>[] = [
    { event: "init", conversation_id: cid },
    ...buildAgyToolUpdateEvents(cid, "run_command", {
      command: "cat src/calc.js",
    }),
    ...buildAgyToolUpdateEvents(cid, "run_command", {
      command: "cat test.js",
    }),
    ...buildAgyToolUpdateEvents(cid, "run_command", {
      command: "node test.js",
    }),
    {
      event: "step_update",
      step_update: {
        conversation_id: cid,
        step_type: "agent_response",
        text_delta: "Fixing multiply in src/calc.js and writing commit-message.txt.",
      },
    },
    {
      event: "result",
      result: {
        conversation_id: cid,
        status: "SUCCESS",
        response: options.response,
        num_turns: 4,
        usage: {
          input_tokens: options.inputTokens ?? 150,
          output_tokens: options.outputTokens ?? 45,
        },
      },
    },
  ];
  return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

describe("antigravity-cli agent harness × builder-scoped-fix scenario", () => {
  let workingDir: string;

  beforeEach(() => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "builder-scoped-fix");
    workingDir = mkdtempSync(join(tmpdir(), "kota-agy-scenario-"));
    cpSync(loaded.initialStateDir, workingDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workingDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("passes prompt, workflow rails, model/effort, and produces valid fix + commit artifact", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "builder-scoped-fix");
    const conversationId = "conv-builder-parity-1";

    mockAgyProcess({
      stdout: buildAgyFullBuilderStream({
        conversationId,
        response: "Fix complete. Multiplication corrected and commit message written.",
      }),
    });

    const messages: KotaAgentMessage[] = [];
    const result = await antigravityCliAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gemini-3.7-flash",
      effort: "xhigh",
      cwd: workingDir,
      agentWriteScope: [workingDir],
      onMessage: (msg) => {
        messages.push(msg);
      },
    });

    expect(result.isError).toBe(false);
    expect(result.sessionId).toBe(conversationId);
    expect(result.turns).toBe(4);
    expect(result.usage).toEqual({
      tokens: { state: "complete", inputTokens: 150, outputTokens: 45 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });

    // Check arguments passed to spawn
    expect(spawnMock).toHaveBeenCalledWith(
      "authority-sandbox",
      expect.arrayContaining([
        "agy",
        "--new-project",
        "--print",
        expect.stringContaining(loaded.spec.prompt),
        "--model",
        "gemini-3.7-flash",
        "--effort",
        "high",
        "--mode",
        "accept-edits",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
      ]),
      expect.objectContaining({ cwd: workingDir }),
    );

    expect(sandboxLaunchMock).toHaveBeenCalledWith(
      "agy",
      expect.any(Array),
      expect.objectContaining({ cwd: workingDir, writableRoots: [workingDir] }),
      expect.any(Function),
    );

    const commandArgs = spawnMock.mock.calls[0][1] as string[];
    const promptArg = commandArgs[commandArgs.indexOf("--print") + 1]!;
    expect(promptArg).toContain("## KOTA workflow rails");
    expect(promptArg).toContain(WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION);
    expect(promptArg).toContain("Antigravity CLI owns its native tool loop");
    expect(promptArg).toContain("## Task");
    expect(promptArg).toContain(loaded.spec.prompt);

    // Apply the fix that AGY simulates performing
    writeFileSync(
      join(workingDir, "src/calc.js"),
      "function multiply(a, b) {\n  return a * b;\n}\nfunction divide(a, b) {\n  if (b === 0) throw new Error(\"Cannot divide by zero\");\n  return a / b;\n}\nmodule.exports = { multiply, divide };\n",
    );
    writeFileSync(
      join(workingDir, "commit-message.txt"),
      "fix: multiply returns product instead of sum\n",
    );

    // Run scenario verification
    const verification = spawnSync(loaded.spec.verification.command, {
      shell: true,
      cwd: workingDir,
      timeout: loaded.spec.verification.timeoutMs,
      encoding: "utf-8",
    });
    expect(verification.status).toBe(0);
    expect(verification.stdout).toContain(
      "ok — functional fix correct, scope respected, commit message written",
    );

    // Verify command traces captured in status messages
    const commandTraces = messages
      .filter((m) => m.type === "status" && m.commandTrace !== undefined)
      .map((m) => m.type === "status" ? m.commandTrace : null);
    expect(commandTraces.length).toBeGreaterThanOrEqual(3);
  });

  it("fails verification when AGY performs an out-of-scope edit even if AGY reports success", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "builder-scoped-fix");
    mockAgyProcess({
      stdout: successfulAgyOutput("Modified test.js to pass."),
    });

    const result = await antigravityCliAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gemini-3.7-flash",
      effort: "xhigh",
      cwd: workingDir,
    });
    expect(result.isError).toBe(false);

    // Simulate AGY improperly modifying test.js
    writeFileSync(join(workingDir, "test.js"), "// overwritten test.js\n");
    writeFileSync(join(workingDir, "commit-message.txt"), "fix: update test\n");

    const verification = spawnSync(loaded.spec.verification.command, {
      shell: true,
      cwd: workingDir,
      timeout: loaded.spec.verification.timeoutMs,
      encoding: "utf-8",
    });
    expect(verification.status).not.toBe(0);
    expect(`${verification.stdout}\n${verification.stderr}`).toContain(
      "protected file test.js was modified",
    );
  });

  it("fails verification when AGY omits the commit-message artifact", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "builder-scoped-fix");
    mockAgyProcess({
      stdout: successfulAgyOutput("Fixed src/calc.js"),
    });

    await antigravityCliAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gemini-3.7-flash",
      effort: "xhigh",
      cwd: workingDir,
    });

    // Fix src/calc.js but omit commit-message.txt
    writeFileSync(
      join(workingDir, "src/calc.js"),
      "function multiply(a, b) { return a * b; }\nfunction divide(a, b) { if (b === 0) throw new Error('Cannot divide by zero'); return a / b; }\nmodule.exports = { multiply, divide };\n",
    );

    const verification = spawnSync(loaded.spec.verification.command, {
      shell: true,
      cwd: workingDir,
      timeout: loaded.spec.verification.timeoutMs,
      encoding: "utf-8",
    });
    expect(verification.status).not.toBe(0);
    expect(`${verification.stdout}\n${verification.stderr}`).toContain(
      "commit-message.txt is required but was not written",
    );
  });

  it("returns an error result when AGY exits without a terminal result event", async () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "builder-scoped-fix");
    // Stream terminates after init without result event
    mockAgyProcess({
      stdout: `${JSON.stringify({ event: "init", conversation_id: "conv-incomplete" })}\n`,
    });

    const result = await antigravityCliAgentHarness.run({
      prompt: loaded.spec.prompt,
      model: "gemini-3.7-flash",
      effort: "xhigh",
      cwd: workingDir,
    });

    expect(result.isError).toBe(true);
    expect(result.subtype).toBe("antigravity_cli_incomplete_output");
    expect(result.text).toContain("exited without a terminal result event");
  });
});
