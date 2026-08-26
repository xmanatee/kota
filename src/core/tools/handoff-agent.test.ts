import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { createDelegateBudget } from "./delegate-budget.js";
import { setDelegateConfig } from "./delegate-config.js";
import { runHandoffAgent } from "./handoff-agent.js";
import { withHandoffAgentRuntime } from "./handoff-agent-runtime.js";

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

describe("handoff_agent", () => {
  let scopeRoot: string;
  let reviewer: AgentDef;
  let receivedOptions: AgentHarnessRunOptions[];
  const delegateModelProvider = {
    provider: "openai-compatible",
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-delegate-provider",
  };

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-handoff-agent-"));
    mkdirSync(join(scopeRoot, "agents"), { recursive: true });
    writeFileSync(join(scopeRoot, "agents", "reviewer.md"), "Reviewer prompt.\n");
    initGit(scopeRoot);
    reviewer = {
      name: "reviewer",
      role: "Review structured handoff work.",
      promptPath: "agents/reviewer.md",
      model: "test-review-model",
      effort: "medium",
      skills: ["review-guidance"],
      tools: {
        allowed: ["Read", "Grep"],
        disallowed: ["Bash"],
      },
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
          text: 'review complete\n```json\n{"verdict":"pass","notes":"linked"}\n```',
          streamedText: "review complete",
          sessionId: "child-session-1",
          turns: 2,
          isError: false,
        };
      }),
    });
    setDelegateConfig({
      model: "unused",
      modelProvider: delegateModelProvider,
      cwd: scopeRoot,
      harness: "handoff-test",
      resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
      resolveSkillsPrompt: () => "Skill prompt.",
    });
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    clearAgentHarnessRegistryForTest();
    setDelegateConfig({ model: "gpt-5.6-sol" });
  });

  it("dispatches a registered agent with trace links, workflow metadata, and validated structured output", async () => {
    const scope = scopeInput(scopeRoot);
    const workflowMetadata = {
      workflowName: "builder",
      runId: "run-observable",
      stepId: "build",
      spanId: "run-observable:build",
      scopeId: scope.scope_id,
    };

    const result = await runHandoffAgent(
      {
        agent: "reviewer",
        mode: "transfer",
        input: { task: "Review the patch." },
        input_schema: {
          type: "object",
          properties: { task: { type: "string" } },
          required: ["task"],
          additionalProperties: false,
        },
        reason: "Need specialist review.",
        autonomy_mode: "autonomous",
        budget: { max_turns: 3 },
        scope,
        output_schema: {
          type: "object",
          properties: {
            verdict: { type: "string" },
            notes: { type: "string" },
          },
          required: ["verdict", "notes"],
          additionalProperties: false,
        },
        parent: { run_id: "parent-run", step_id: "parent-step" },
        allowed_tools: ["Read"],
      },
      {
        sessionId: "parent-session",
        toolUseId: "tool-use-1",
        workflow: workflowMetadata,
      },
    );

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toHaveLength(1);
    expect(receivedOptions[0]).toMatchObject({
      model: "test-review-model",
      effort: "medium",
      maxTurns: 3,
      autonomyMode: "autonomous",
      persistSession: true,
      allowedTools: ["Read"],
      disallowedTools: ["Bash"],
      modelProvider: delegateModelProvider,
      workflowContext: workflowMetadata,
    });
    expect(receivedOptions[0].systemPrompt).toContain("Reviewer prompt.");
    expect(receivedOptions[0].systemPrompt).toContain("Skill prompt.");
    expect(result.structuredContent).toMatchObject({
      kind: "completed",
      agentName: "reviewer",
      mode: "transfer",
      childSessionId: "child-session-1",
      content: 'review complete\n```json\n{"verdict":"pass","notes":"linked"}\n```',
      structuredOutput: { verdict: "pass", notes: "linked" },
      trace: {
        parentSessionId: "parent-session",
        parentToolUseId: "tool-use-1",
        parentRunId: "parent-run",
        parentStepId: "parent-step",
        childSessionId: "child-session-1",
      },
    });
  });

  it("passes scoped runtime model provider selection into child harness dispatch", async () => {
    const scopedModelProvider = {
      provider: "anthropic-compatible",
      baseUrl: "https://scoped-models.example.test/v1",
      apiKey: "sk-scoped-provider",
    };

    const result = await withHandoffAgentRuntime(
      {
        cwd: scopeRoot,
        harness: "handoff-test",
        resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
        modelProvider: scopedModelProvider,
        delegateBudget: createDelegateBudget(),
      },
      () =>
        runHandoffAgent({
          agent: "reviewer",
          mode: "call",
          input: { task: "Review the scoped provider path." },
          reason: "Need specialist review.",
          autonomy_mode: "autonomous",
          budget: { max_turns: 3 },
          scope: scopeInput(scopeRoot),
        }),
    );

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toHaveLength(1);
    expect(receivedOptions[0].modelProvider).toEqual(scopedModelProvider);
  });

  it("rejects an empty allowed_tools list before child dispatch", async () => {
    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Do not widen the registered child policy." },
      reason: "Prove an empty allowlist cannot mean unrestricted.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(scopeRoot),
      allowed_tools: [],
    });

    expect(result).toMatchObject({ is_error: true });
    expect(result.content).toContain(
      "allowed_tools must contain at least one tool when provided",
    );
    expect(receivedOptions).toHaveLength(0);
  });

  it("uses the runner context cwd for approved selected-project handoffs", async () => {
    const selectedScopeRoot = mkdtempSync(join(tmpdir(), "kota-handoff-selected-project-"));
    mkdirSync(join(selectedScopeRoot, "agents"), { recursive: true });
    writeFileSync(join(selectedScopeRoot, "agents", "reviewer.md"), "Selected scope prompt.\n");
    initGit(selectedScopeRoot);
    const selectedScope = scopeInput(selectedScopeRoot);

    try {
      const result = await runHandoffAgent(
        {
          agent: "reviewer",
          mode: "call",
          input: { task: "Review the selected scope." },
          reason: "Approved selected-project handoff.",
          autonomy_mode: "autonomous",
          budget: { max_turns: 3 },
          scope: selectedScope,
        },
        {
          cwd: selectedScopeRoot,
          scopeId: selectedScope.scope_id,
          sessionId: "session-b",
        },
      );

      expect(result.is_error).toBeUndefined();
      expect(receivedOptions).toHaveLength(1);
      expect(receivedOptions[0].cwd).toBe(selectedScopeRoot);
      expect(receivedOptions[0].systemPrompt).toContain("Selected scope prompt.");
      expect(receivedOptions[0].systemPrompt).not.toContain("Reviewer prompt.");
    } finally {
      rmSync(selectedScopeRoot, { recursive: true, force: true });
    }
  });

  it("applies passive read-only tool scope before child harness dispatch", async () => {
    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch without editing." },
      reason: "Need passive specialist review.",
      autonomy_mode: "passive",
      budget: { max_turns: 3 },
      scope: scopeInput(scopeRoot),
    });

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toHaveLength(1);
    expect(receivedOptions[0].autonomyMode).toBe("passive");
    expect(receivedOptions[0].allowedTools).toEqual(["Grep", "Read"]);
    expect(receivedOptions[0].disallowedTools).toBeUndefined();
  });

  it("rejects passive named agents that allow mutating tools before dispatch", async () => {
    reviewer = {
      ...reviewer,
      tools: {
        allowed: ["Bash", "Read"],
      },
    };

    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch without editing." },
      reason: "Need passive specialist review.",
      autonomy_mode: "passive",
      budget: { max_turns: 3 },
      scope: scopeInput(scopeRoot),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Passive agent steps may only allow read-only tools");
    expect(result.content).toContain("Bash");
    expect(receivedOptions).toHaveLength(0);
  });

});
