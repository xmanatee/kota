import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import {
  type ResolvedScopePolicy,
  resolveScopePolicy,
  type ScopePolicyAuthority,
} from "#core/daemon/scope-policy.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowRunMetadata } from "../run-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { createStepContext } from "./step-context.js";
import { createWorkflowAgentHarnessRunner } from "./workflow-agent-harness-runner.js";

const trigger: WorkflowRunTrigger = {
  event: "manual",
  schemaRef: null,
  payload: {},
};

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "native-scope-policy-test",
    definitionPath: "workflow.ts",
    trigger,
    startedAt: "2026-08-05T00:00:00.000Z",
    status: "running",
    runDir: ".kota/runs/run-1",
    steps: [],
  };
}

function authorityFor(policy: ResolvedScopePolicy): ScopePolicyAuthority {
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}

describe("direct workflow native harness scope policy", () => {
  it.each([
    {
      restriction: "writes are disabled",
      policyFragment: { writes: { mode: "none" as const } },
    },
    {
      restriction: "network reads and writes are denied",
      policyFragment: {
        externalEffects: {
          networkRead: "deny" as const,
          networkWrite: "deny" as const,
        },
      },
    },
  ])("rejects before native launch when $restriction", async ({ policyFragment }) => {
    const projectDir = join(
      tmpdir(),
      `kota-direct-native-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    try {
      const run = vi.fn(async () => ({
        text: "unexpected",
        streamedText: "unexpected",
        turns: 1,
        isError: false,
      }));
      const harness: AgentHarness = {
        name: "direct-workflow-native-policy-test",
        description: "tests direct native workflow harness policy rejection",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: false,
        toolControl: "native",
        nativeAbortQuarantine: "confirmed-stop",
        unsupportedRunOptions: [{
          runOption: "scopePolicy",
          option: "scopePolicy",
          reason: "native tool calls cannot pass through KOTA scope policy",
        }],
        run,
      };
      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, "scope-a");
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
          reason: "Direct native harness policy fixture.",
          ...policyFragment,
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
          scopePolicyAuthority: authorityFor(policy),
          runAgentHarness: createWorkflowAgentHarnessRunner(undefined),
          currentStepId: "review",
        },
      );

      await expect(
        context.runAgentHarness(harness, {
          prompt: "Exercise direct native authorization.",
          cwd: projectDir,
          effort: "low",
          autonomyMode: "autonomous",
        }),
      ).rejects.toThrow(
        /direct-workflow-native-policy-test.*scopePolicy.*cannot pass through/,
      );
      expect(run).not.toHaveBeenCalled();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
