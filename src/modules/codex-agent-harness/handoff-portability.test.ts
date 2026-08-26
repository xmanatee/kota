import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { createDelegateBudget } from "#core/tools/delegate-budget.js";
import { runHandoffAgent } from "#core/tools/handoff-agent.js";
import { withHandoffAgentRuntime } from "#core/tools/handoff-agent-runtime.js";
import { codexAgentHarness } from "./adapter.js";

describe("Codex handoff portability", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("runs a KOTA-owned handoff without routing an unsupported turn bound", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-codex-handoff-"));
    projectDirs.push(projectDir);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: projectDir,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectDir });
    writeFileSync(join(projectDir, "agent.md"), "Handle the inbound signal.\n");
    execFileSync("git", ["add", "agent.md"], { cwd: projectDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });

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
    const scopeId = deriveDirectoryScopeId(projectDir);

    const result = await withHandoffAgentRuntime(
      {
        cwd: projectDir,
        projectDir,
        harness: codexAgentHarness.name,
        resolveAgentDef: (name) => name === agent.name ? agent : undefined,
        delegateBudget: createDelegateBudget(),
        autonomyMode: "autonomous",
        scopeId,
        projectId: scopeId,
      },
      () => runHandoffAgent({
        agent: agent.name,
        mode: "call",
        input: { signal: "review" },
        reason: "Inbound signal route matched this agent.",
        autonomy_mode: "autonomous",
        budget: { max_turns: 4 },
        scope: { scope_id: scopeId, project_id: scopeId },
      }),
    );

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("signal handled");
    expect(receivedOptions).toHaveLength(1);
    expect(receivedOptions[0]?.maxTurns).toBeUndefined();
  });
});
