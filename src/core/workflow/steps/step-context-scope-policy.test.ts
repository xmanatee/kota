import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { localWriteEffect, networkWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import { unexpectedWorkflowAgentHarnessRun } from "../testing/agent-harness-runner.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createStepContext } from "./step-context.js";
import { executeToolStep } from "./step-executor.js";

const POLICY_WRITE_TOOL = "workflow_scope_policy_write_fixture";
const POLICY_NETWORK_TOOL = "workflow_scope_policy_network_fixture";

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
          projectDir,
          bus,
          pbus,
          store: new WorkflowRunStore(projectDir),
          approvalQueue: new ApprovalQueue(
            join(projectDir, ".kota", "approvals"),
            pbus,
            { scopeId: "scope-a" },
          ),
          runTool,
          resolveScopePolicy: () => policy,
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
          projectDir,
          bus,
          pbus,
          store: new WorkflowRunStore(projectDir),
          approvalQueue,
          runTool,
          resolveScopePolicy: () => policy,
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
});
