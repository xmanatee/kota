import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarnessRunOptions,
  agentHarnessToolExecutionOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentDef, AgentWriteScope } from "#core/agents/agent-types.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { createDelegateBudget } from "./delegate-budget.js";
import {
  localWriteEffect,
  networkReadEffect,
  readOnlyLocalEffect,
  type ToolEffect,
} from "./effect.js";
import { runHandoffAgent } from "./handoff-agent.js";
import {
  type HandoffAgentRuntime,
  withHandoffAgentRuntime,
} from "./handoff-agent-runtime.js";
import {
  handoffScopePolicyAuthority as authorityFor,
  HANDOFF_POLICY_HARNESS as HARNESS,
  handoffApprovalQueue,
  initHandoffPolicyGitProject,
  handoffScopePolicy as policyFor,
  registerHandoffPolicyManifest,
  registerHandoffPolicyTool,
} from "./handoff-agent-scope-policy-test-support.js";
import {
  clearCustomTools,
  type ToolRunner,
} from "./index.js";
import {
  executeToolCalls,
  type ToolResultEntry,
} from "./tool-runner.js";

const WRITE_TOOL = "handoff_policy_write";
const NETWORK_TOOL = "handoff_policy_network";
const MODULE_TOOL = "handoff_policy_module";

describe("handoff_agent hosted scope-policy inheritance", () => {
  let projectDir: string;
  let scopeId: string;
  let approvalQueue: ApprovalQueue;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-handoff-policy-"));
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, "agents", "child.md"), "Child prompt.\n");
    initHandoffPolicyGitProject(projectDir);
    scopeId = deriveDirectoryScopeId(projectDir);
    approvalQueue = handoffApprovalQueue(projectDir, scopeId);
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    clearCustomTools();
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function runDeniedChild(args: {
    toolName: string;
    effect: ToolEffect;
    policy: ResolvedScopePolicy;
    writeScope: AgentWriteScope;
    expected: RegExp;
    manifest?: boolean;
  }): Promise<void> {
    const runner = vi.fn<ToolRunner>(async () => ({ content: "must not execute" }));
    registerHandoffPolicyTool(args.toolName, args.effect, runner);
    if (args.manifest) registerHandoffPolicyManifest(args.toolName, args.effect);
    const agent: AgentDef = {
      name: "child",
      role: "Exercise inherited scope policy.",
      promptPath: "agents/child.md",
      model: "test-model",
      effort: "low",
      tools: { allowed: [args.toolName] },
      writeScope: args.writeScope,
    };
    let childResult: ToolResultEntry | undefined;
    let receivedOptions: AgentHarnessRunOptions | undefined;
    registerAgentHarness({
      name: HARNESS,
      description: "KOTA-hosted handoff policy fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        receivedOptions = options;
        [childResult] = await executeToolCalls(
          [{
            type: "tool_use",
            id: `child-${args.toolName}`,
            name: args.toolName,
            input: { path: join(projectDir, "allowed", "output.txt") },
          }],
          agentHarnessToolExecutionOptions(options, { resultLimit: 50_000 }),
        );
        return {
          text: childResult?.content ?? "missing child result",
          streamedText: childResult?.content ?? "missing child result",
          turns: 1,
          isError: false,
        };
      },
    });
    const authority = authorityFor(args.policy);
    const runtime: HandoffAgentRuntime = {
      cwd: projectDir,
      harness: HARNESS,
      resolveAgentDef: (name) => (name === agent.name ? agent : undefined),
      delegateBudget: createDelegateBudget(),
      autonomyMode: "autonomous",
      scopeId,
      projectId: scopeId,
      scopePolicy: args.policy,
      scopePolicyAuthority: authority,
      getScopePolicySnapshot: () => authority.getSnapshot(scopeId),
      authorityConfigPath: join(projectDir, ".machine", "config.json"),
      approvalQueue,
    };

    const result = await withHandoffAgentRuntime(runtime, () =>
      runHandoffAgent(
        {
          agent: "child",
          mode: "call",
          input: { task: "Exercise inherited policy." },
          reason: "Regression fixture.",
          autonomy_mode: "autonomous",
          budget: { max_turns: 2 },
          scope: { scope_id: scopeId, project_id: scopeId },
          allowed_tools: [args.toolName],
        },
        { scopeId, projectId: scopeId, sessionId: "parent-session" },
      )
    );

    expect(result.is_error).toBeUndefined();
    expect(childResult).toMatchObject({ is_error: true });
    expect(childResult?.content).toMatch(args.expected);
    expect(runner).not.toHaveBeenCalled();
    expect(receivedOptions).toMatchObject({
      scopePolicy: args.policy,
      scopePolicyAuthority: authority,
      approvalQueue,
      authorityConfigPath: join(projectDir, ".machine", "config.json"),
      sessionContext: {
        scopeId,
        projectId: scopeId,
      },
    });
  }

  it("keeps local writes denied inside the hosted child", async () => {
    await runDeniedChild({
      toolName: WRITE_TOOL,
      effect: localWriteEffect(),
      policy: policyFor(projectDir, { writes: { mode: "none" } }),
      writeScope: ["allowed/"],
      expected: /Blocked by scope policy.*writes are disabled/,
    });
  });

  it("keeps network access denied inside the hosted child", async () => {
    await runDeniedChild({
      toolName: NETWORK_TOOL,
      effect: networkReadEffect(),
      policy: policyFor(projectDir, {
        externalEffects: {
          networkRead: "deny",
          networkWrite: "deny",
          networkDestructive: "deny",
        },
      }),
      writeScope: "deny-all",
      expected: /Blocked by scope policy.*read on external-network -> deny/,
    });
  });

  it("keeps disabled module tools denied inside the hosted child", async () => {
    await runDeniedChild({
      toolName: MODULE_TOOL,
      effect: readOnlyLocalEffect(),
      policy: policyFor(projectDir, {
        modules: { defaultAvailability: "disabled" },
      }),
      writeScope: "deny-all",
      expected: /Blocked by scope policy: module handoff-policy-fixture is disabled/,
      manifest: true,
    });
  });

  it("caps child autonomy at the parent and carries hosted authority identity", async () => {
    const policy = policyFor(projectDir, {});
    const authority = authorityFor(policy);
    const agent: AgentDef = {
      name: "child",
      role: "Inspect inherited authorization context.",
      promptPath: "agents/child.md",
      model: "test-model",
      effort: "low",
      tools: { allowed: ["Read"] },
      writeScope: "deny-all",
    };
    let receivedOptions: AgentHarnessRunOptions | undefined;
    registerAgentHarness({
      name: HARNESS,
      description: "hosted authority identity fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        receivedOptions = options;
        return {
          text: "inspected inherited context",
          streamedText: "inspected inherited context",
          turns: 1,
          isError: false,
        };
      },
    });
    const authorityConfigPath = join(projectDir, ".machine", "config.json");

    const result = await withHandoffAgentRuntime(
      {
        cwd: projectDir,
        harness: HARNESS,
        resolveAgentDef: (name) => (name === agent.name ? agent : undefined),
        delegateBudget: createDelegateBudget(),
        autonomyMode: "supervised",
        scopeId,
        projectId: scopeId,
        scopePolicy: policy,
        scopePolicyAuthority: authority,
        getScopePolicySnapshot: () => authority.getSnapshot(scopeId),
        authorityConfigPath,
        approvalQueue,
      },
      () =>
        runHandoffAgent(
          {
            agent: "child",
            mode: "call",
            input: { task: "Inspect inherited context." },
            reason: "Regression fixture.",
            autonomy_mode: "autonomous",
            budget: { max_turns: 2 },
            scope: { scope_id: scopeId, project_id: scopeId },
            allowed_tools: ["Read"],
          },
          { scopeId, projectId: scopeId, sessionId: "parent-session" },
        ),
    );

    expect(result.is_error).toBeUndefined();
    expect(receivedOptions).toMatchObject({
      autonomyMode: "supervised",
      scopePolicy: policy,
      scopePolicyAuthority: authority,
      approvalQueue,
      authorityConfigPath,
      sessionContext: {
        scopeId,
        projectId: scopeId,
        sessionId: expect.stringMatching(/^handoff:/),
      },
    });
  });

});
