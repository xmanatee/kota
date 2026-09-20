import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  unpricedAgentUsage,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { DelegationRuntime } from "#core/tools/delegation-runtime.js";
import { runDelegate } from "./delegate.js";
import { resolveDelegateConfig } from "./delegate-config.js";
import { runHandoffAgent } from "./handoff-agent.js";

let delegationConfig: DelegationRuntime;

function initGit(scopeRoot: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scopeRoot });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: scopeRoot });
  execFileSync("git", ["config", "user.name", "test"], { cwd: scopeRoot });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: scopeRoot });
  writeFileSync(join(scopeRoot, "seed.txt"), "seed\n");
  execFileSync("git", ["add", "-A"], { cwd: scopeRoot });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: scopeRoot });
}

function scopeInput(scopeRoot: string): { scope_id: string } {
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  return { scope_id: scopeId };
}

describe("handoff_agent token budgets", () => {
  let scopeRoot: string;
  let reviewer: AgentDef;
  let receivedOptions: AgentHarnessRunOptions[];

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-handoff-agent-budget-"));
    mkdirSync(join(scopeRoot, "agents"), { recursive: true });
    writeFileSync(join(scopeRoot, "agents", "reviewer.md"), "Reviewer prompt.\n");
    initGit(scopeRoot);
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
        if (receivedOptions.length === 1) {
          const nested = await runDelegate({ task: "Inspect the review context", mode: "explore" });
          expect(nested.is_error, nested.content).toBeUndefined();
          expect(nested.content).toContain("review complete");
        }
        return {
          text: "review complete",
          streamedText: "review complete",
          sessionId: "child-session-1",
          turns: 2,
          usage: unpricedAgentUsage(4, 2),
          isError: false,
        };
      }),
    });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    clearAgentHarnessRegistryForTest();

  });

  it("binds a generic grandchild to the named child settings and narrower token ledger", async () => {
    const parentTokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 100 });
    delegationConfig = resolveDelegateConfig({ effort: "low",
      model: "unused",
      backend: "thin",
      modelProvider: { provider: "openai", baseUrl: "https://review.invalid", apiKey: "fixture-review-key" },
      instructionContext: "Outer session instructions.",
      mcpServers: { review: { command: "review-mcp" } },
      mcpScopeConfigPolicy: "disabled",
      cwd: scopeRoot,
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
      budget: { max_turns: 3, max_total_tokens: 16 },
      scope: scopeInput(scopeRoot),
    }, undefined, delegationConfig);

    expect(result.is_error, result.content).toBeUndefined();
    expect(receivedOptions).toHaveLength(2);
    for (const options of receivedOptions) {
      expect(options.model).toBe("test-review-model");
      expect(options.effort).toBe("medium");
      expect(options.modelProvider).toEqual(delegationConfig.modelProvider);
      expect(options.mcpServers).toEqual(delegationConfig.mcpServers);
      expect(options.mcpScopeConfigPolicy).toBe("disabled");
      expect(options.systemPrompt).toContain("Reviewer prompt.");
      expect(options.systemPrompt).not.toContain("Outer session instructions.");
      expect(options.cwd).toBe(scopeRoot);
    }
    expect(receivedOptions[1].tokenBudget).toBe(receivedOptions[0].tokenBudget);
    const childTokenBudget = receivedOptions[0].tokenBudget;
    expect(childTokenBudget).toBeDefined();
    expect(childTokenBudget).not.toBe(parentTokenBudget);
    expect(childTokenBudget?.snapshot()).toMatchObject({
      budget: { maxTotalTokens: 16 },
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
    expect(parentTokenBudget.snapshot()).toMatchObject({
      budget: { maxTotalTokens: 100 },
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
  });
});
