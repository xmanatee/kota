import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { setDelegateConfig } from "./delegate-config.js";
import { runHandoffAgent } from "./handoff-agent.js";

function initGit(projectDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: projectDir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: projectDir });
  writeFileSync(join(projectDir, "seed.txt"), "seed\n");
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
}

function scopeInput(projectDir: string): { scope_id: string; project_id: string } {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return { scope_id: scopeId, project_id: scopeId };
}

describe("handoff_agent token budgets", () => {
  let projectDir: string;
  let reviewer: AgentDef;
  let receivedOptions: AgentHarnessRunOptions[];

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-handoff-agent-budget-"));
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, "agents", "reviewer.md"), "Reviewer prompt.\n");
    initGit(projectDir);
    reviewer = {
      name: "reviewer",
      role: "Review structured handoff work.",
      promptPath: "agents/reviewer.md",
      model: "test-review-model",
      effort: "medium",
      writeScope: ["reviews/"],
    };
    receivedOptions = [];
    registerAgentHarness({
      name: "handoff-test",
      description: "handoff test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: vi.fn(async (options) => {
        receivedOptions.push(options);
        return {
          text: "review complete",
          streamedText: "review complete",
          sessionId: "child-session-1",
          turns: 2,
          inputTokens: 4,
          outputTokens: 2,
          isError: false,
        };
      }),
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    clearAgentHarnessRegistryForTest();
    setDelegateConfig({ model: "gpt-5.5" });
  });

  it("passes a narrower child token budget that still debits the parent ledger", async () => {
    const parentTokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    setDelegateConfig({
      model: "unused",
      cwd: projectDir,
      harness: "handoff-test",
      resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
      resolveSkillsPrompt: () => "Skill prompt.",
      tokenBudget: parentTokenBudget,
    });

    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch." },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3, max_total_tokens: 8 },
      scope: scopeInput(projectDir),
    });

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toHaveLength(1);
    const childTokenBudget = receivedOptions[0].tokenBudget;
    expect(childTokenBudget).toBeDefined();
    expect(childTokenBudget).not.toBe(parentTokenBudget);
    expect(childTokenBudget?.snapshot()).toMatchObject({
      budget: { maxTotalTokens: 8 },
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
    expect(parentTokenBudget.snapshot()).toMatchObject({
      budget: { maxTotalTokens: 100 },
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
  });
});
