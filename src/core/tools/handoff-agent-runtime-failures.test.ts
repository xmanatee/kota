import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

describe("handoff_agent runtime failure handling", () => {
  let projectDir: string;
  let reviewer: AgentDef;
  let receivedOptions: AgentHarnessRunOptions[];

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-handoff-agent-"));
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, "agents", "reviewer.md"), "Reviewer prompt.\n");
    initGit(projectDir);
    reviewer = {
      name: "reviewer",
      role: "Review structured handoff work.",
      promptPath: "agents/reviewer.md",
      model: "test-review-model",
      effort: "medium",
      skills: ["review-guidance"],
      tools: { allowed: ["Read", "Grep"], disallowed: ["Bash"] },
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
      cwd: projectDir,
      harness: "handoff-test",
      resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
      resolveSkillsPrompt: () => "Skill prompt.",
    });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    clearAgentHarnessRegistryForTest();
    setDelegateConfig({ model: "gpt-5.6-sol" });
  });

  it("routes transfer handoffs to an existing child session when resume_session_id is set", async () => {
    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "transfer",
      input: { task: "Resume review." },
      reason: "Continue specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(projectDir),
      resume_session_id: "child-session-existing",
    });

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions[0]).toMatchObject({
      persistSession: true,
      resumeSessionId: "child-session-existing",
    });
    expect(result.structuredContent).toMatchObject({
      resumedSessionId: "child-session-existing",
      childSessionId: "child-session-1",
    });
  });

  it("uses the shared delegate budget for recursive depth rejection", async () => {
    const budget = createDelegateBudget({ maxDepth: 1, maxActiveChildren: 4 });
    setDelegateConfig({
      model: "unused",
      cwd: projectDir,
      harness: "handoff-test",
      resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
      delegateBudget: budget,
    });
    const parent = budget.tryStart();
    if (!parent.ok) throw new Error(parent.failure.message);

    try {
      const result = await parent.lease.run(() =>
        runHandoffAgent({
          agent: "reviewer",
          mode: "call",
          input: { task: "Review the patch." },
          reason: "Need specialist review.",
          autonomy_mode: "autonomous",
          budget: { max_turns: 3 },
          scope: scopeInput(projectDir),
        }),
      );

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("maximum recursive depth 1 exceeded");
      expect(receivedOptions).toHaveLength(0);
    } finally {
      parent.lease.release();
    }
  });

  it("propagates child harness failures", async () => {
    clearAgentHarnessRegistryForTest();
    registerAgentHarness({
      name: "handoff-test",
      description: "handoff test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: vi.fn(async () => ({
        text: "provider failed",
        streamedText: "provider failed",
        turns: 1,
        subtype: "error_during_execution",
        isError: true,
      })),
    });

    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch." },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(projectDir),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('child agent "reviewer" failed');
    expect(result.content).toContain("provider failed");
  });

  it("rejects child structured output that does not match the requested schema", async () => {
    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch." },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(projectDir),
      output_schema: {
        type: "object",
        properties: { verdict: { type: "string" } },
        required: ["verdict"],
        additionalProperties: false,
      },
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("child structured output validation failed");
  });

  it("rejects writes outside the registered agent write scope", async () => {
    clearAgentHarnessRegistryForTest();
    registerAgentHarness({
      name: "handoff-test",
      description: "handoff test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: vi.fn(async () => {
        const escapePath = join(projectDir, "src", "escape.ts");
        mkdirSync(dirname(escapePath), { recursive: true });
        writeFileSync(escapePath, "export const escape = true;\n");
        return {
          text: "wrote file",
          streamedText: "wrote file",
          turns: 1,
          isError: false,
        };
      }),
    });

    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch." },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(projectDir),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("wrote outside writeScope");
    expect(result.content).toContain("src/escape.ts");
  });
});
