import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  resetHarnessHooks,
} from "#core/agent-harness/index.js";
import {
  type ResolvedScopePolicy,
  resolveScopePolicy,
  type ScopePolicyAuthority,
} from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { executeWorkflowRun } from "../run-executor.js";
import { WorkflowRunStore } from "../run-store.js";
import { createTestRunContext } from "../testing/run-context-fixture.js";
import {
  AGENT_OK_RESULT,
  makeAgentStep,
  makeDefinition,
  makeHarness,
  makeScopeRoot,
  removeScopeRoot,
  TRIGGER,
} from "./step-executor-agent-capability-fixtures.integration.js";

describe("native workflow agent scope policy", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;
  let bus: EventBus;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    workspaceRoot = makeScopeRoot();
    store = new WorkflowRunStore(workspaceRoot);
    bus = new EventBus();
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    removeScopeRoot(workspaceRoot);
  });

  it.each([
    {
      restriction: "writes disabled",
      policyFragment: { writes: { mode: "none" as const } },
    },
    {
      restriction: "writes path-bounded",
      policyFragment: {
        writes: { mode: "paths" as const, paths: ["generated"] },
      },
    },
    {
      restriction: "network reads and writes denied",
      policyFragment: {
        externalEffects: {
          networkRead: "deny" as const,
          networkWrite: "deny" as const,
        },
      },
    },
    {
      restriction: "modules disabled",
      policyFragment: {
        modules: { defaultAvailability: "disabled" as const },
      },
    },
    {
      restriction: "local writes require confirmation",
      policyFragment: {
        ownerConfirmation: { localWrite: "confirm" as const },
      },
    },
  ])("fails closed before native launch when $restriction cannot be enforced", async ({
    policyFragment,
  }) => {
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const scopePolicy = resolveScopePolicy({
      projection: {
        rootScopeId: "global",
        defaultScopeId: scopeId,
        scopes: [
          { scopeId: "global", displayName: "Global" },
          { scopeId, displayName: "Fixture", parentScopeId: "global", directoryRoot: workspaceRoot },
        ],
      },
      scopeId,
      fragments: [{
        scopeId,
        reason: "Native fixture carries a restrictive execution policy.",
        autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
        ...policyFragment,
      }],
    });
    const run = vi.fn(async () => AGENT_OK_RESULT);
    const harnessName = "scope-policy-native";
    registerAgentHarness(
      makeHarness(harnessName, run, {
        toolControl: "native",
        unsupportedRunOptions: [{
          runOption: "scopePolicy",
          option: "scopePolicy",
          reason: "Native fixture cannot enforce the resolved scope policy.",
        }],
      }),
    );

    const { promise } = executeWorkflowRun(
      makeDefinition(workspaceRoot, makeAgentStep(workspaceRoot, harnessName)),
      TRIGGER,
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: createTestRunContext(workspaceRoot, TRIGGER),
        bus,
        store,
        log: () => {},
        scopePolicyAuthority: authorityFor(scopePolicy),
      },
    );

    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]?.error).toMatch(
      /scope-policy-native.*scopePolicy.*cannot enforce the resolved scope policy/,
    );
    expect(run).not.toHaveBeenCalled();
  });
});

function authorityFor(policy: ResolvedScopePolicy): ScopePolicyAuthority {
  return {
    getSnapshot: () => ({ revision: 0, policy }),
    subscribeRestrictiveChanges: () => () => {},
  };
}
