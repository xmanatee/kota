import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { createDelegateBudget } from "#core/tools/delegate-budget.js";
import { runHandoffAgent } from "#core/tools/handoff-agent.js";
import { withHandoffAgentRuntime } from "#core/tools/handoff-agent-runtime.js";
import { codexAgentHarness } from "./adapter.js";

describe("Codex handoff portability", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("runs a KOTA-owned handoff without routing an unsupported turn bound", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-codex-handoff-"));
    scopeRoots.push(workspaceRoot);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: workspaceRoot });
    writeFileSync(join(workspaceRoot, "agent.md"), "Handle the inbound signal.\n");
    execFileSync("git", ["add", "agent.md"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: workspaceRoot });

    const receivedOptions: AgentHarnessRunOptions[] = [];
    registerAgentHarness({
      ...codexAgentHarness,
      run: vi.fn(async (options) => {
        receivedOptions.push(options);
        options.abortQuarantine?.register(async () => {});
        return {
          text: "signal handled",
          streamedText: "signal handled",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      }),
    });
    const agent: AgentDef = {
      name: "owner-triage",
      role: "Handle an inbound signal.",
      promptPath: "agent.md",
      model: "gpt-5.6-sol",
      effort: "xhigh",
      writeScope: "deny-all",
    };
    const scopeId = deriveDirectoryScopeId(workspaceRoot);

    const result = await withHandoffAgentRuntime(
      {
        cwd: workspaceRoot,
        harness: codexAgentHarness.name,
        resolveAgentDef: (name) => name === agent.name ? agent : undefined,
        delegateBudget: createDelegateBudget(),
        autonomyMode: "autonomous",
        scopeId,
      },
      () => runHandoffAgent({
        agent: agent.name,
        mode: "call",
        input: { signal: "review" },
        reason: "Inbound signal route matched this agent.",
        autonomy_mode: "autonomous",
        budget: { max_turns: 4 },
        scope: { scope_id: scopeId },
      }),
    );

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("signal handled");
    expect(receivedOptions).toHaveLength(1);
    expect(receivedOptions[0]?.maxTurns).toBeUndefined();
  });
});
