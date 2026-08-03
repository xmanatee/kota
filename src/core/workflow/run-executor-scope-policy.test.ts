import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarnessRunOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
  type ResolvedScopePolicy,
  type RestrictiveScopePolicyChangeListener,
  resolveScopePolicy,
  type ScopePolicyAuthority,
  scopePolicyRestrictiveAreas,
} from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

vi.mock("#core/workflow/steps/agent-write-scope.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("#core/workflow/steps/agent-write-scope.js")
  >();
  return {
    ...actual,
    removeWorkflowScratchArtifacts: () => [],
    tryListWorkflowMutatedPaths: () => [],
  };
});

const POLICY_WRITE_TOOL = "run_executor_scope_policy_write_fixture";
const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

afterEach(() => {
  clearAgentHarnessRegistryForTest();
});

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
      const policy = policyFor(projectDir, true);
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
        scopePolicyAuthority: authorityFor(policy),
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

  it("stops an in-flight agent when authority publishes a restrictive revision", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-run-executor-live-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    try {
      const harnessName = "run-executor-live-scope-policy";
      let markHarnessStarted = () => {};
      const harnessStarted = new Promise<void>((resolve) => {
        markHarnessStarted = resolve;
      });
      registerAgentHarness({
        name: harnessName,
        description: "waits for a live scope-policy restriction",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: false,
        toolControl: "kota",
        run: async (options: AgentHarnessRunOptions) => {
          const signal = options.abortController?.signal;
          if (signal === undefined) throw new Error("missing agent abort signal");
          markHarnessStarted();
          await new Promise<void>((_resolve, reject) => {
            const rejectWithReason = () => reject(signal.reason);
            if (signal.aborted) {
              rejectWithReason();
              return;
            }
            signal.addEventListener("abort", rejectWithReason, { once: true });
          });
          throw new Error("unreachable harness completion");
        },
      });
      writeFileSync(join(projectDir, "prompt.md"), "Wait for policy changes.\n");
      const scopeId = deriveDirectoryScopeId(projectDir);
      const authority = mutableAuthority(scopeId, policyFor(projectDir, false));
      const definition: WorkflowDefinition = {
        name: "live-scope-policy-test",
        enabled: true,
        recoveryCapable: false,
        definitionPath: "src/modules/test/workflows/live-scope-policy/workflow.ts",
        moduleRoot: projectDir,
        triggers: [],
        steps: [{
          id: "agent",
          type: "agent",
          harness: harnessName,
          promptPath: "prompt.md",
          moduleRoot: projectDir,
          model: "test-model",
          effort: "low",
          autonomyMode: "autonomous",
          timeoutMs: 2_000,
        }],
        tags: [],
      };

      const { promise } = executeWorkflowRun(definition, TRIGGER, {
        projectDir,
        bus: new EventBus(),
        store: new WorkflowRunStore(projectDir),
        log: vi.fn(),
        scopePolicyAuthority: authority,
      });
      await Promise.race([
        harnessStarted,
        promise.then((result) => {
          const stepError = result.metadata.steps[0]?.error ?? "without a step error";
          throw new Error(
            `Workflow finished before the harness started: ${result.metadata.status} ` +
              stepError,
          );
        }),
      ]);
      authority.restrict(policyFor(projectDir, true));
      const result = await promise;

      expect(result.metadata.status).toBe("failed");
      expect(result.metadata.steps[0]?.error).toMatch(
        /scope policy became more restrictive.*revision 0 -> 1.*areas: writes/,
      );
      expect(result.metadata.steps[0]?.errorKind).toBeUndefined();
      expect(authority.listenerCount()).toBe(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

function authorityFor(policy: ResolvedScopePolicy): ScopePolicyAuthority {
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}

function policyFor(projectDir: string, readOnly: boolean): ResolvedScopePolicy {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return resolveScopePolicy({
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
      reason: readOnly ? "Workflow fixture is read-only." : "Workflow fixture is writable.",
      ...(readOnly ? { writes: { mode: "none" as const } } : {}),
    }],
  });
}

function mutableAuthority(scopeId: string, policy: ResolvedScopePolicy): ScopePolicyAuthority & {
  restrict: (nextPolicy: ResolvedScopePolicy) => void;
  listenerCount: () => number;
} {
  let snapshot = { revision: 0, policy };
  const listeners = new Set<RestrictiveScopePolicyChangeListener>();
  return {
    getSnapshot: (requestedScopeId) => {
      if (requestedScopeId !== scopeId) throw new Error(`Unexpected scope ${requestedScopeId}`);
      return snapshot;
    },
    subscribeRestrictiveChanges: (requestedScopeId, listener) => {
      if (requestedScopeId !== scopeId) throw new Error(`Unexpected scope ${requestedScopeId}`);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restrict: (nextPolicy) => {
      const previous = snapshot;
      snapshot = { revision: previous.revision + 1, policy: nextPolicy };
      const restrictiveAreas = scopePolicyRestrictiveAreas(previous.policy, nextPolicy);
      if (restrictiveAreas.length === 0) return;
      for (const listener of [...listeners]) {
        listener({ scopeId, previous, current: snapshot, restrictiveAreas });
      }
    },
    listenerCount: () => listeners.size,
  };
}
