import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { createDelegateBudget } from "./delegate-budget.js";
import { networkReadEffect } from "./effect.js";
import {
  type HandoffAgentRuntime,
  withHandoffAgentRuntime,
} from "./handoff-agent-runtime.js";
import {
  HANDOFF_POLICY_HARNESS as HARNESS,
  handoffApprovalQueue,
  handoffScopePolicy,
  handoffScopePolicyAuthority,
  initHandoffPolicyGitRepository,
  registerHandoffPolicyTool,
} from "./handoff-agent-scope-policy-test-support.js";
import {
  clearCustomTools,
  getToolEffect,
  type ToolRunner,
} from "./index.js";
import { executeToolCalls } from "./tool-runner.js";

const NETWORK_TOOL = "handoff_policy_network";

describe("handoff_agent aggregate effect policy", () => {
  let scopeRoot: string;
  let scopeId: string;
  let approvalQueue: ApprovalQueue;

  beforeEach(() => {
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-handoff-effect-policy-"));
    mkdirSync(join(scopeRoot, "agents"), { recursive: true });
    writeFileSync(join(scopeRoot, "agents", "child.md"), "Child prompt.\n");
    initHandoffPolicyGitRepository(scopeRoot);
    scopeId = deriveDirectoryScopeId(scopeRoot);
    approvalQueue = handoffApprovalQueue(scopeRoot, scopeId);
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    clearCustomTools();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("classifies declared network capability before the child starts", async () => {
    const runner = vi.fn<ToolRunner>(async () => ({ content: "must not execute" }));
    registerHandoffPolicyTool(NETWORK_TOOL, networkReadEffect(), runner);
    const policy = handoffScopePolicy(scopeRoot, {
      externalEffects: {
        networkRead: "deny",
        networkWrite: "deny",
        networkDestructive: "deny",
      },
    });
    const authority = handoffScopePolicyAuthority(policy);
    const agent: AgentDef = {
      name: "child",
      role: "Network policy fixture.",
      promptPath: "agents/child.md",
      model: "test-model",
      effort: "low",
      tools: { allowed: [NETWORK_TOOL] },
      writeScope: "deny-all",
    };
    const harnessRun = vi.fn(async () => ({
      text: "must not start",
      streamedText: "must not start",
      turns: 1,
      usage: UNKNOWN_AGENT_USAGE,
      isError: false,
    }));
    registerAgentHarness({
      name: HARNESS,
      description: "outer effect fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: harnessRun,
    });
    const input = {
      agent: "child",
      mode: "call",
      input: { task: "Do not reach the network." },
      reason: "Prove outer effect classification.",
      autonomy_mode: "autonomous",
      budget: { max_turns: 2 },
      scope: { scope_id: scopeId },
      allowed_tools: [NETWORK_TOOL],
    };
    expect(getToolEffect("handoff_agent", input)).toMatchObject({
      kind: "write",
      scope: "external-network",
      openWorld: true,
    });

    const runtime: HandoffAgentRuntime = {
      cwd: scopeRoot,
      harness: HARNESS,
      resolveAgentDef: (name) => (name === agent.name ? agent : undefined),
      delegateBudget: createDelegateBudget(),
      autonomyMode: "autonomous",
      scopeId,
      scopePolicy: policy,
      scopePolicyAuthority: authority,
      getScopePolicySnapshot: () => authority.getSnapshot(scopeId),
      approvalQueue,
    };
    const [result] = await withHandoffAgentRuntime(runtime, () =>
      executeToolCalls(
        [{ type: "tool_use", id: "outer-handoff", name: "handoff_agent", input }],
        {
          resultLimit: 50_000,
          verbose: false,
          autonomyMode: "autonomous",
          scopePolicy: policy,
          scopePolicyAuthority: authority,
          getScopePolicySnapshot: () => authority.getSnapshot(scopeId),
          approvalQueue,
          cwd: scopeRoot,
          scopeId,
        },
      )
    );

    expect(result).toMatchObject({ is_error: true });
    expect(result?.content).toMatch(
      /Blocked by scope policy.*write on external-network -> deny/,
    );
    expect(harnessRun).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([
    ["omitted", {}],
    ["empty", { allowed_tools: [] }],
  ])(
    "treats an %s child tool envelope as externally destructive",
    (_label, input) => {
      expect(getToolEffect("handoff_agent", input)).toMatchObject({
        kind: "destructive",
        scope: "external-network",
        openWorld: true,
      });
    },
  );
});
