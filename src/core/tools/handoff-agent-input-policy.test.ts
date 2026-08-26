import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { setDelegateConfig } from "./delegate-config.js";
import { runHandoffAgent } from "./handoff-agent.js";

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

describe("handoff_agent input and policy rejection", () => {
  let scopeRoot: string;
  let reviewer: AgentDef;
  let receivedOptions: AgentHarnessRunOptions[];

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
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      }),
    });
    setDelegateConfig({
      model: "unused",
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

  it("rejects passive handoffs on harnesses that cannot enforce KOTA tool scope", async () => {
    clearAgentHarnessRegistryForTest();
    registerAgentHarness({
      name: "handoff-test",
      description: "native handoff test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      run: vi.fn(async (options) => {
        receivedOptions.push(options);
        return {
          text: "native complete",
          streamedText: "native complete",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      }),
    });
    reviewer = { ...reviewer, tools: undefined };

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
    expect(result.content).toContain('agent harness "handoff-test" cannot honor named handoff tool policy');
    expect(receivedOptions).toHaveLength(0);
  });

  it("rejects missing registered agents before harness dispatch", async () => {
    const result = await runHandoffAgent({
      agent: "missing",
      mode: "call",
      input: { task: "Review the patch." },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(scopeRoot),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('unknown registered agent "missing"');
    expect(receivedOptions).toHaveLength(0);
  });

  it("rejects structured input that does not match input_schema", async () => {
    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: 42 },
      input_schema: {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
        additionalProperties: false,
      },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: scopeInput(scopeRoot),
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("input failed input_schema validation");
    expect(receivedOptions).toHaveLength(0);
  });

  it("rejects requested scope outside the current scope", async () => {
    const result = await runHandoffAgent({
      agent: "reviewer",
      mode: "call",
      input: { task: "Review the patch." },
      reason: "Need specialist review.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 3 },
      scope: { scope_id: "other-scope" },
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("does not match current scope");
    expect(receivedOptions).toHaveLength(0);
  });

});
