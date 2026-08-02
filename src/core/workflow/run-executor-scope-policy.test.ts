import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

const POLICY_WRITE_TOOL = "run_executor_scope_policy_write_fixture";
const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

describe("workflow scope policy execution", () => {
  it("threads live scope policy into workflow tool execution", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-run-executor-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    try {
      registerTool(
        {
          name: POLICY_WRITE_TOOL,
          description: "writes a run-executor scope-policy fixture",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
        async () => ({ content: "registered runner should not execute" }),
        "run-executor-scope-policy-test",
        { effect: localWriteEffect() },
      );
      const scopeId = deriveDirectoryScopeId(projectDir);
      const policy = resolveScopePolicy({
        projection: {
          rootScopeId: "global",
          defaultScopeId: scopeId,
          scopes: [
            { scopeId: "global", displayName: "Global" },
            {
              scopeId,
              displayName: "Fixture",
              parentScopeId: "global",
              directoryRoot: projectDir,
            },
          ],
        },
        scopeId,
        fragments: [{
          scopeId,
          reason: "Workflow fixture is read-only.",
          writes: { mode: "none" },
        }],
      });
      const runTool = vi.fn(async () => ({ content: "bypassed policy" }));
      const definition: WorkflowDefinition = {
        name: "scope-policy-test",
        enabled: true,
        recoveryCapable: false,
        definitionPath: "src/modules/test/workflows/scope-policy/workflow.ts",
        moduleRoot: projectDir,
        triggers: [],
        steps: [{
          id: "write",
          type: "tool",
          tool: POLICY_WRITE_TOOL,
          input: { path: join(projectDir, "output.txt") },
        }],
        tags: [],
      };

      const { promise } = executeWorkflowRun(definition, TRIGGER, {
        projectDir,
        bus: new EventBus(),
        store: new WorkflowRunStore(projectDir),
        log: vi.fn(),
        runTool,
        resolveScopePolicy: () => policy,
      });
      const result = await promise;

      expect(result.metadata.status).toBe("failed");
      expect(result.metadata.steps[0]?.error).toMatch(
        /Blocked by scope policy.*writes are disabled/,
      );
      expect(runTool).not.toHaveBeenCalled();
    } finally {
      deregisterTool(POLICY_WRITE_TOOL);
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
