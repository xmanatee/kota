import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarnessRunOptions,
  agentHarnessToolExecutionOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
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
import { setDelegateConfig } from "#core/tools/delegate.js";
import { localWriteEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import {
  executeToolCalls,
  type ToolResultEntry,
} from "#core/tools/tool-runner.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";

function makeRunContext(
  projectDir: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = join(projectDir, ".kota", "runtime", runId, "workspace"),
): RunContext {
  const rootDir = join(projectDir, ".kota", "runtime", runId);
  const tempDir = join(rootDir, "tmp");
  const artifactDir = join(rootDir, "artifacts");
  const agentDir = join(rootDir, "agent");
  const packageCacheDir = join(tempDir, "package-cache");
  for (const path of [workspaceDir, tempDir, artifactDir, agentDir, packageCacheDir]) {
    mkdirSync(path, { recursive: true });
  }
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    project: { id: "test-project", root: projectDir },
    workflow: "hosted-live-scope-policy-test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir,
      workspaceDir,
      tempDir,
      artifactDir,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: rootDir,
      tempDir,
      artifactDir,
      agentDir,
      packageCacheDir,
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}



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

const TOOL_NAME = "Write";
const HARNESS_NAME = "run-executor-hosted-live-scope-policy";
const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

afterEach(() => {
  clearAgentHarnessRegistryForTest();
  deregisterTool(TOOL_NAME);
  setDelegateConfig({ model: "gpt-5.6-sol" });
});

describe("workflow hosted tool live scope policy", () => {
  it("keeps a generic agent-harness delegate active and denies its next identical call after revocation", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-hosted-live-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    try {
      const hostedRunner = vi.fn(async () => ({ content: "executed" }));
      registerTool(
        {
          name: TOOL_NAME,
          description: "writes a hosted live-policy fixture",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
        hostedRunner,
        "hosted-live-policy-test",
        { effect: localWriteEffect() },
      );

      let finishFirstCall = () => {};
      const firstCallFinished = new Promise<void>((resolve) => {
        finishFirstCall = resolve;
      });
      let allowSecondCall = () => {};
      const secondCallAllowed = new Promise<void>((resolve) => {
        allowSecondCall = resolve;
      });
      let firstResult: ToolResultEntry | undefined;
      let secondResult: ToolResultEntry | undefined;
      let childOptions: AgentHarnessRunOptions | undefined;
      let harnessRunCount = 0;
      const scopeId = deriveDirectoryScopeId(projectDir);
      const authority = mutableAuthority(scopeId, policyFor(projectDir, false));
      registerAgentHarness({
        name: HARNESS_NAME,
        description: "runs hosted calls around an authority revision",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: false,
        toolControl: "kota",
        run: async (options: AgentHarnessRunOptions) => {
          harnessRunCount++;
          if (harnessRunCount === 1) {
            const executionOptions = agentHarnessToolExecutionOptions(options, {
              resultLimit: 50_000,
            });
            const [delegateResult] = await executeToolCalls(
              [{
                type: "tool_use",
                id: "delegate-call",
                name: "delegate",
                input: {
                  task: "Exercise delegated hosted authorization.",
                  mode: "execute",
                },
              }],
              executionOptions,
            );
            return {
              text: delegateResult?.content ?? "delegate returned no result",
              streamedText: delegateResult?.content ?? "delegate returned no result",
              turns: 1,
              usage: UNKNOWN_AGENT_USAGE,
              isError: delegateResult?.is_error === true,
            };
          }

          childOptions = options;
          const executionOptions = agentHarnessToolExecutionOptions(options, {
            resultLimit: 50_000,
          });
          const call = {
            type: "tool_use" as const,
            id: "same-hosted-call",
            name: TOOL_NAME,
            input: { path: join(projectDir, "output.txt") },
          };
          [firstResult] = await executeToolCalls([call], executionOptions);
          finishFirstCall();
          await secondCallAllowed;
          [secondResult] = await executeToolCalls([call], executionOptions);
          return {
            text: "hosted calls complete",
            streamedText: "hosted calls complete",
            turns: 1,
            usage: UNKNOWN_AGENT_USAGE,
            isError: false,
          };
        },
      });
      setDelegateConfig({
        model: "test-model",
        backend: "agent-sdk",
        harness: HARNESS_NAME,
      });
      writeFileSync(join(projectDir, "prompt.md"), "Exercise hosted authorization.\n");
      const definition: WorkflowDefinition = {
        name: "hosted-live-scope-policy-test",
        enabled: true,
        repository: "none",
        definitionPath: "src/modules/test/workflows/hosted-policy/workflow.ts",
        moduleRoot: projectDir,
        triggers: [],
        steps: [{
          id: "agent",
          type: "agent",
          harness: HARNESS_NAME,
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
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(projectDir, TRIGGER),
        bus: new EventBus(),
        store: new WorkflowRunStore(projectDir),
        log: vi.fn(),
        scopePolicyAuthority: authority,
      });
      const firstCallOutcome = await Promise.race([
        firstCallFinished.then(() => ({ kind: "called" as const })),
        promise.then((result) => ({ kind: "completed" as const, result })),
      ]);
      expect(firstCallOutcome).toEqual({ kind: "called" });
      expect(firstResult).toMatchObject({ content: "executed" });
      expect(hostedRunner).toHaveBeenCalledTimes(1);

      authority.restrict(policyFor(projectDir, true));
      allowSecondCall();
      const result = await promise;

      expect(result.metadata.status).toBe("success");
      expect(secondResult).toMatchObject({ is_error: true });
      expect(secondResult?.content).toMatch(/Blocked by scope policy.*writes are disabled/);
      expect(hostedRunner).toHaveBeenCalledTimes(1);
      expect(harnessRunCount).toBe(2);
      expect(childOptions?.scopePolicy).toBeDefined();
      expect(childOptions?.scopePolicyAuthority).toBe(authority);
      expect(childOptions?.getScopePolicySnapshot).toEqual(expect.any(Function));
      expect(authority.readCount()).toBeGreaterThanOrEqual(3);
      expect(authority.listenerCount()).toBe(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

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
      reason: readOnly ? "Writes revoked." : "Writes allowed.",
      ...(readOnly ? { writes: { mode: "none" as const } } : {}),
    }],
  });
}

function mutableAuthority(scopeId: string, policy: ResolvedScopePolicy): ScopePolicyAuthority & {
  restrict: (nextPolicy: ResolvedScopePolicy) => void;
  listenerCount: () => number;
  readCount: () => number;
} {
  let snapshot = { revision: 0, policy };
  let reads = 0;
  const listeners = new Set<RestrictiveScopePolicyChangeListener>();
  return {
    getSnapshot: (requestedScopeId) => {
      if (requestedScopeId !== scopeId) throw new Error(`Unexpected scope ${requestedScopeId}`);
      reads++;
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
      for (const listener of [...listeners]) {
        listener({ scopeId, previous, current: snapshot, restrictiveAreas });
      }
    },
    listenerCount: () => listeners.size,
    readCount: () => reads,
  };
}
