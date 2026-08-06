import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import { createDelegateBudget } from "./delegate-budget.js";
import { runHandoffAgent } from "./handoff-agent.js";
import {
  type HandoffAgentRuntime,
  withHandoffAgentRuntime,
} from "./handoff-agent-runtime.js";
import {
  HANDOFF_POLICY_HARNESS as HARNESS,
  handoffApprovalQueue,
  handoffScopePolicy,
  handoffScopePolicyAuthority,
  initHandoffPolicyGitProject,
} from "./handoff-agent-scope-policy-test-support.js";

describe("handoff_agent nested autonomy inheritance", () => {
  let projectDir: string;
  let scopeId: string;
  let approvalQueue: ApprovalQueue;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-handoff-nested-autonomy-"));
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, "agents", "child.md"), "Child prompt.\n");
    writeFileSync(join(projectDir, "agents", "grandchild.md"), "Grandchild prompt.\n");
    initHandoffPolicyGitProject(projectDir);
    scopeId = deriveDirectoryScopeId(projectDir);
    approvalQueue = handoffApprovalQueue(projectDir, scopeId);
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("caps a grandchild against its immediate supervised parent", async () => {
    const policy = handoffScopePolicy(projectDir);
    const authority = handoffScopePolicyAuthority(policy);
    const agents: AgentDef[] = [
      {
        name: "child",
        role: "Delegate under supervision.",
        promptPath: "agents/child.md",
        model: "test-model",
        effort: "low",
        tools: { allowed: ["Read", "handoff_agent"] },
        writeScope: "deny-all",
      },
      {
        name: "grandchild",
        role: "Inspect without escalating posture.",
        promptPath: "agents/grandchild.md",
        model: "test-model",
        effort: "low",
        tools: { allowed: ["Read"] },
        writeScope: "deny-all",
      },
    ];
    const receivedModes: AutonomyMode[] = [];
    registerAgentHarness({
      name: HARNESS,
      description: "nested autonomy inheritance fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        if (options.autonomyMode === undefined) {
          throw new Error("nested handoff must receive an explicit autonomy mode");
        }
        receivedModes.push(options.autonomyMode);
        if (receivedModes.length === 1) {
          const nested = await runHandoffAgent(
            {
              agent: "grandchild",
              mode: "call",
              input: { task: "Inspect under the immediate parent posture." },
              reason: "Prove transitive autonomy capping.",
              autonomy_mode: "autonomous",
              budget: { max_turns: 1 },
              scope: { scope_id: scopeId, project_id: scopeId },
              allowed_tools: ["Read"],
            },
            { scopeId, projectId: scopeId, sessionId: "child-session" },
          );
          return {
            text: nested.content,
            streamedText: nested.content,
            turns: 1,
            isError: nested.is_error === true,
          };
        }
        return {
          text: "grandchild inspected",
          streamedText: "grandchild inspected",
          turns: 1,
          isError: false,
        };
      },
    });
    const runtime: HandoffAgentRuntime = {
      cwd: projectDir,
      harness: HARNESS,
      resolveAgentDef: (name) => agents.find((agent) => agent.name === name),
      delegateBudget: createDelegateBudget(),
      autonomyMode: "autonomous",
      scopeId,
      projectId: scopeId,
      scopePolicy: policy,
      scopePolicyAuthority: authority,
      getScopePolicySnapshot: () => authority.getSnapshot(scopeId),
      approvalQueue,
    };

    const result = await withHandoffAgentRuntime(runtime, () =>
      runHandoffAgent(
        {
          agent: "child",
          mode: "call",
          input: { task: "Delegate without escalating posture." },
          reason: "Prove immediate-parent inheritance.",
          autonomy_mode: "supervised",
          budget: { max_turns: 2 },
          scope: { scope_id: scopeId, project_id: scopeId },
          allowed_tools: ["Read", "handoff_agent"],
        },
        { scopeId, projectId: scopeId, sessionId: "workflow-parent" },
      )
    );

    expect(result.is_error).toBeUndefined();
    expect(receivedModes).toEqual(["supervised", "supervised"]);
  });
});
