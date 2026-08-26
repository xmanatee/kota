import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessResult,
  agentHarnessToolExecutionOptions,
} from "#core/agent-harness/index.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import {
  type ResolvedScopePolicy,
  resolveScopePolicy,
  type ScopePolicyAuthority,
} from "#core/daemon/scope-policy.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { MessageStreamParams } from "#core/model/model-client.js";
import { setDelegateConfig } from "#core/tools/delegate.js";
import {
  modelClient,
  modelResponse,
  TestStream,
} from "#core/tools/delegate-test-support.js";
import { localWriteEffect, networkWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, executeTool, registerTool } from "#core/tools/index.js";
import {
  executeToolCalls,
  type ToolResultEntry,
} from "#core/tools/tool-runner.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { WorkflowRunStore } from "../run-store.js";
import type {
  WorkflowAgentHarnessRunner,
  WorkflowRunMetadata,
} from "../run-types.js";
import { unexpectedWorkflowAgentHarnessRun } from "../testing/agent-harness-runner.js";
import { createTestRunContext } from "../testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createStepContext } from "./step-context.js";
import { executeToolStep } from "./step-executor.js";

const POLICY_WRITE_TOOL = "workflow_scope_policy_write_fixture";
const POLICY_NETWORK_TOOL = "workflow_scope_policy_network_fixture";
const POLICY_DELEGATE_CHILD_TOOL = "workflow_scope_policy_delegate_child_fixture";

const trigger: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

function tempProject(): string {
  const dir = join(
    tmpdir(),
    `kota-step-context-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "scope-policy-test",
    definitionPath: "workflow.ts",
    trigger,
    startedAt: "2026-08-02T00:00:00.000Z",
    status: "running",
    runDir: ".kota/runs/run-1",
    steps: [],
  };
}

afterEach(() => {
  deregisterTool(POLICY_WRITE_TOOL);
  deregisterTool(POLICY_NETWORK_TOOL);
  deregisterTool(POLICY_DELEGATE_CHILD_TOOL);
  setDelegateConfig({ model: "gpt-5.6-sol" });
});

describe("workflow step context scope policy", () => {
  it("enforces live policy for tool steps and code-step runTool calls", async () => {
    const projectDir = tempProject();
    try {
      registerTool(
        {
          name: POLICY_WRITE_TOOL,
          description: "writes a workflow policy fixture",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
        async () => ({ content: "registered runner should not execute" }),
        "workflow-scope-policy-test",
        { effect: localWriteEffect() },
      );
      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const runTool = vi.fn(async () => ({ content: "bypassed policy" }));
      const policy = resolveScopePolicy({
        projection: {
          rootScopeId: "global",
          defaultScopeId: "scope-a",
          scopes: [
            { scopeId: "global", displayName: "Global" },
            {
              scopeId: "scope-a",
              displayName: "Fixture",
              parentScopeId: "global",
              directoryRoot: projectDir,
            },
          ],
        },
        scopeId: "scope-a",
        fragments: [{
          scopeId: "scope-a",
          reason: "Workflow fixture is read-only.",
          writes: { mode: "none" },
        }],
      });
      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          projectDir,
          scopeDir: projectDir,
          bus,
          pbus,
          store: new WorkflowRunStore(projectDir),
          approvalQueue: new ApprovalQueue(
            join(projectDir, ".kota", "approvals"),
            pbus,
            { scopeId: "scope-a" },
          ),
          runTool,
          scopePolicyAuthority: authorityFor(policy),
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
          currentStepId: "build",
        },
      );
      const input = { path: join(projectDir, "output.txt") };

      await expect(
        executeToolStep(
          { id: "tool-write", type: "tool", tool: POLICY_WRITE_TOOL, input },
          context,
        ),
      ).rejects.toThrow(/Blocked by scope policy.*writes are disabled/);
      await expect(context.runTool(POLICY_WRITE_TOOL, input)).rejects.toThrow(
        /Blocked by scope policy.*writes are disabled/,
      );
      expect(runTool).not.toHaveBeenCalled();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("queues external effects that require policy confirmation", async () => {
    const projectDir = tempProject();
    try {
      registerTool(
        {
          name: POLICY_NETWORK_TOOL,
          description: "sends a workflow policy fixture",
          input_schema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        async () => ({ content: "registered runner should not execute" }),
        "workflow-scope-policy-test",
        { effect: networkWriteEffect() },
      );
      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const approvalQueue = new ApprovalQueue(
        join(projectDir, ".kota", "approvals"),
        pbus,
        { scopeId: "scope-a" },
      );
      const runTool = vi.fn(async () => ({ content: "bypassed policy" }));
      const policy = resolveScopePolicy({
        projection: {
          rootScopeId: "global",
          defaultScopeId: "scope-a",
          scopes: [
            { scopeId: "global", displayName: "Global" },
            {
              scopeId: "scope-a",
              displayName: "Fixture",
              parentScopeId: "global",
              directoryRoot: projectDir,
            },
          ],
        },
        scopeId: "scope-a",
      });
      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          projectDir,
          scopeDir: projectDir,
          bus,
          pbus,
          store: new WorkflowRunStore(projectDir),
          approvalQueue,
          runTool,
          scopePolicyAuthority: authorityFor(policy),
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
          currentStepId: "notify",
        },
      );

      await expect(context.runTool(POLICY_NETWORK_TOOL, {})).rejects.toThrow(
        /Queued for approval.*external-network.*confirm/,
      );
      expect(runTool).not.toHaveBeenCalled();
      expect(approvalQueue.list("pending")).toEqual([
        expect.objectContaining({
          tool: POLICY_NETWORK_TOOL,
          risk: "moderate",
          status: "pending",
        }),
      ]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("propagates live authority through direct runTool delegates", async () => {
    const projectDir = tempProject();
    try {
      let snapshot = {
        revision: 0,
        policy: delegatedWritePolicy(projectDir, false),
      };
      const authority: ScopePolicyAuthority = {
        getSnapshot: (scopeId) => {
          if (scopeId !== "scope-a") throw new Error(`Unexpected scope ${scopeId}`);
          return snapshot;
        },
        subscribeRestrictiveChanges: () => () => {},
      };
      const childRunner = vi.fn(async () => {
        snapshot = {
          revision: snapshot.revision + 1,
          policy: delegatedWritePolicy(projectDir, true),
        };
        return { content: "executed before revocation" };
      });
      registerTool(
        {
          name: POLICY_DELEGATE_CHILD_TOOL,
          description: "writes a delegated workflow policy fixture",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
        childRunner,
        "workflow-scope-policy-test",
        { effect: localWriteEffect() },
      );
      const childCall = (id: string) => ({
        type: "tool_use" as const,
        id,
        name: POLICY_DELEGATE_CHILD_TOOL,
        input: { path: join(projectDir, "output.txt") },
      });
      const responses = [
        modelResponse([childCall("child-call-1")]),
        modelResponse([childCall("child-call-2")]),
        modelResponse([{ type: "text", text: "delegate complete" }]),
      ];
      const requests: MessageStreamParams[] = [];
      const stream = vi.fn((request: MessageStreamParams) => {
        requests.push(request);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected delegate turn");
        return new TestStream(response);
      });
      setDelegateConfig({
        model: "test-model",
        modelOutputTokenLimits: { "test-model": 1_024 },
        client: modelClient(stream),
      });
      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          projectDir,
          scopeDir: projectDir,
          bus,
          pbus,
          store: new WorkflowRunStore(projectDir),
          approvalQueue: new ApprovalQueue(
            join(projectDir, ".kota", "approvals"),
            pbus,
            { scopeId: "scope-a" },
          ),
          runTool: executeTool,
          runContext: createTestRunContext(projectDir, trigger),
          scopePolicyAuthority: authority,
          runAgentHarness: unexpectedWorkflowAgentHarnessRun,
          currentStepId: "delegate",
        },
      );

      const result = await context.runTool("delegate", {
        task: "Exercise delegated live authorization.",
        mode: "execute",
      });

      expect(result).toMatchObject({ content: expect.stringContaining("delegate complete") });
      expect(childRunner).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(3);
      expect(JSON.stringify(requests[2]?.messages)).toMatch(
        /Blocked by scope policy.*writes are disabled/,
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("injects live authority into direct KOTA-hosted harness runs", async () => {
    const projectDir = tempProject();
    try {
      const hostedRunner = vi.fn(async () => ({ content: "executed" }));
      registerTool(
        {
          name: POLICY_WRITE_TOOL,
          description: "writes a direct harness policy fixture",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
        hostedRunner,
        "workflow-scope-policy-test",
        { effect: localWriteEffect() },
      );
      let snapshot = {
        revision: 0,
        policy: delegatedWritePolicy(projectDir, false),
      };
      const authority: ScopePolicyAuthority = {
        getSnapshot: (scopeId) => {
          if (scopeId !== "scope-a") throw new Error(`Unexpected scope ${scopeId}`);
          return snapshot;
        },
        subscribeRestrictiveChanges: () => () => {},
      };
      let firstResult: ToolResultEntry | undefined;
      let secondResult: ToolResultEntry | undefined;
      const runAgentHarness: WorkflowAgentHarnessRunner = vi.fn(
        async (_harness, options): Promise<AgentHarnessResult> => {
          expect(options.scopePolicy).toBe(snapshot.policy);
          expect(options.getScopePolicySnapshot).toEqual(expect.any(Function));
          expect(options.approvalQueue).toBeDefined();
          expect(options.workflowContext).toMatchObject({
            workflowName: "scope-policy-test",
            runId: "run-1",
            stepId: "merge",
            scopeId: "scope-a",
          });
          const executionOptions = agentHarnessToolExecutionOptions(options, {
            resultLimit: 50_000,
          });
          const call = {
            type: "tool_use" as const,
            id: "same-direct-harness-call",
            name: POLICY_WRITE_TOOL,
            input: { path: join(projectDir, "output.txt") },
          };
          [firstResult] = await executeToolCalls([call], executionOptions);
          snapshot = {
            revision: snapshot.revision + 1,
            policy: delegatedWritePolicy(projectDir, true),
          };
          [secondResult] = await executeToolCalls([call], executionOptions);
          return {
            text: "direct harness complete",
            streamedText: "direct harness complete",
            turns: 1,
            usage: {
              tokens: { state: "unknown" },
              cost: { state: "unknown" },
            },
            isError: false,
          };
        },
      );
      const harness: AgentHarness = {
        name: "direct-workflow-hosted-policy-test",
        description: "tests direct workflow harness policy routing",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: false,
        toolControl: "kota",
        run: async () => {
          throw new Error("The workflow harness runner should own dispatch");
        },
      };
      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
      const approvalQueue = new ApprovalQueue(
        join(projectDir, ".kota", "approvals"),
        pbus,
        { scopeId: "scope-a" },
      );
      const context = createStepContext(
        makeMetadata(),
        trigger,
        undefined,
        {},
        {},
        [],
        {
          readRuntimeState: readEmptyTestWorkflowRuntimeState,
          projectDir,
          scopeDir: projectDir,
          bus,
          pbus,
          store: new WorkflowRunStore(projectDir),
          approvalQueue,
          scopePolicyAuthority: authority,
          runAgentHarness,
          currentStepId: "merge",
        },
      );

      const result = await context.runAgentHarness(harness, {
        prompt: "Exercise direct hosted authorization.",
        cwd: projectDir,
        effort: "low",
        autonomyMode: "autonomous",
      });

      expect(result.text).toBe("direct harness complete");
      expect(firstResult).toMatchObject({ content: "executed" });
      expect(secondResult).toMatchObject({ is_error: true });
      expect(secondResult?.content).toMatch(
        /Blocked by scope policy.*writes are disabled/,
      );
      expect(hostedRunner).toHaveBeenCalledTimes(1);
      expect(runAgentHarness).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function delegatedWritePolicy(
  projectDir: string,
  readOnly: boolean,
): ResolvedScopePolicy {
  return resolveScopePolicy({
    projection: {
      rootScopeId: "global",
      defaultScopeId: "scope-a",
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId: "scope-a",
          displayName: "Fixture",
          parentScopeId: "global",
          directoryRoot: projectDir,
        },
      ],
    },
    scopeId: "scope-a",
    fragments: [{
      scopeId: "scope-a",
      reason: readOnly ? "Writes revoked." : "Writes allowed.",
      ...(readOnly ? { writes: { mode: "none" as const } } : {}),
    }],
  });
}

function authorityFor(policy: ResolvedScopePolicy): ScopePolicyAuthority {
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}
