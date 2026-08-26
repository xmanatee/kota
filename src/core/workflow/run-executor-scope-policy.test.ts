import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarnessRunOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
  NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
  signalNativeCliProcessGroup,
} from "#core/agent-harness/native-cli-process-group.js";
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
  workspaceDir = projectDir,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    project: { id: "test-project", root: projectDir },
    workflow: "test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: projectDir,
      workspaceDir,
      tempDir: projectDir,
      artifactDir: projectDir,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: projectDir,
      tempDir: projectDir,
      artifactDir: projectDir,
      agentDir: projectDir,
      packageCacheDir: projectDir,
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
        repository: "none",
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
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(projectDir, TRIGGER),
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

  it("cancels and quarantines an opaque native harness after a restrictive revision", async () => {
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
      let markHarnessFinished = () => {};
      const harnessFinished = new Promise<void>((resolve) => {
        markHarnessFinished = resolve;
      });
      let lateWriterAccepted: boolean | undefined;
      let childTerminationSignal: NodeJS.Signals | null = null;
      const childStartedPath = join(projectDir, "native-child-started.txt");
      const lateMutationPath = join(projectDir, "after-restriction.txt");
      registerAgentHarness({
        name: harnessName,
        description: "runs an opaque native process with a confirmed stop barrier",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: true,
        toolControl: "native",
        nativeAbortQuarantine: "confirmed-stop",
        run: async (options: AgentHarnessRunOptions, writer) => {
          const child = spawn(
            process.execPath,
            [
              "-e",
              [
                'const { spawn } = require("node:child_process");',
                'const { writeFileSync } = require("node:fs");',
                "const mutation = [",
                "  'setTimeout(() => require(\"node:fs\").writeFileSync(process.argv[1], \"late mutation\"), 250);',",
                "  'setTimeout(() => process.exit(0), 500);',",
                "].join(' ');",
                "const worker = spawn(process.execPath, ['-e', mutation, process.argv[2]], { stdio: ['pipe', 'pipe', 'pipe'] });",
                "worker.stdin.end();",
                "worker.stdout.resume();",
                "worker.stderr.resume();",
                "worker.unref();",
                "writeFileSync(process.argv[1], 'started');",
                "process.stdout.write('ready\\n');",
                "setTimeout(() => process.exit(0), 500);",
              ].join(" "),
              childStartedPath,
              lateMutationPath,
            ],
            {
              cwd: projectDir,
              ...NATIVE_CLI_PROCESS_GROUP_SPAWN_OPTIONS,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          child.stdin.end();
          child.stderr.resume();
          const childReady = new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.stdout.once("data", () => resolve());
          });
          const childClosed = new Promise<void>((resolve, reject) => {
            let settled = false;
            child.once("error", (error) => {
              if (settled) return;
              settled = true;
              reject(error);
            });
            child.once("close", (_code, signal) => {
              if (settled) return;
              settled = true;
              childTerminationSignal = signal;
              resolve();
            });
          });
          options.abortQuarantine?.register(async () => {
            signalNativeCliProcessGroup(child, "SIGKILL");
            await childClosed;
          });
          await childReady;
          await options.onMessage?.({ type: "status", category: "agent.started" });
          markHarnessStarted();
          await childClosed;
          lateWriterAccepted = writer?.write("stale native stdout");
          await options.onMessage?.({
            type: "tool_call",
            toolUseId: "late-native-write",
            toolName: "native_write",
            input: { path: "after-restriction.txt" },
          });
          await options.onMessage?.({
            type: "result",
            text: "stale success",
            isError: false,
            usage: {
              tokens: { state: "unknown" },
              cost: { state: "unknown" },
            },
          });
          markHarnessFinished();
          return {
            text: "stale success",
            streamedText: "stale success",
            turns: 1,
            usage: {
              tokens: { state: "unknown" },
              cost: { state: "unknown" },
            },
            isError: false,
          };
        },
      });
      writeFileSync(join(projectDir, "prompt.md"), "Wait for policy changes.\n");
      const scopeId = deriveDirectoryScopeId(projectDir);
      const authority = mutableAuthority(scopeId, policyFor(projectDir, false));
      const definition: WorkflowDefinition = {
        name: "live-scope-policy-test",
        enabled: true,
        repository: "none",
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
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(projectDir, TRIGGER),
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
      expect(existsSync(childStartedPath)).toBe(true);
      authority.restrict(policyFor(projectDir, true));
      const result = await promise;
      await harnessFinished;
      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(result.metadata.status).toBe("failed");
      expect(result.metadata.steps[0]?.error).toMatch(
        /scope policy became more restrictive.*revision 0 -> 1.*areas: writes/,
      );
      expect(result.metadata.steps[0]?.errorKind).toBeUndefined();
      expect(result.metadata.steps[0]).not.toHaveProperty("output");
      expect(authority.listenerCount()).toBe(0);
      expect(lateWriterAccepted).toBe(false);
      expect(childTerminationSignal).toBe("SIGKILL");
      expect(existsSync(lateMutationPath)).toBe(false);
      const eventsPath = join(
        projectDir,
        result.metadata.runDir,
        "steps",
        "agent.events.jsonl",
      );
      const events = readFileSync(eventsPath, "utf-8");
      expect(events).toContain("agent.started");
      expect(events).not.toContain("late-native-write");
      expect(events).not.toContain("stale success");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("releases authority listeners when a KOTA-controlled harness ignores a step timeout", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-run-executor-policy-timeout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    try {
      const harnessName = "run-executor-opaque-timeout";
      let markHarnessStarted = () => {};
      const harnessStarted = new Promise<void>((resolve) => {
        markHarnessStarted = resolve;
      });
      let releaseHarness = () => {};
      const harnessRelease = new Promise<void>((resolve) => {
        releaseHarness = resolve;
      });
      let markHarnessFinished = () => {};
      const harnessFinished = new Promise<void>((resolve) => {
        markHarnessFinished = resolve;
      });
      registerAgentHarness({
        name: harnessName,
        description: "KOTA-controlled harness that ignores step timeout cancellation",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: true,
        toolControl: "kota",
        run: async (options: AgentHarnessRunOptions) => {
          await options.onMessage?.({ type: "status", category: "agent.started" });
          markHarnessStarted();
          await harnessRelease;
          await options.onMessage?.({ type: "status", category: "late.after-timeout" });
          markHarnessFinished();
          return {
            text: "stale success after timeout",
            streamedText: "stale success after timeout",
            turns: 1,
            usage: {
              tokens: { state: "unknown" },
              cost: { state: "unknown" },
            },
            isError: false,
          };
        },
      });
      writeFileSync(join(projectDir, "prompt.md"), "Wait past the timeout.\n");
      const scopeId = deriveDirectoryScopeId(projectDir);
      const authority = mutableAuthority(scopeId, policyFor(projectDir, false));
      const definition: WorkflowDefinition = {
        name: "opaque-timeout-policy-test",
        enabled: true,
        repository: "none",
        definitionPath: "src/modules/test/workflows/opaque-timeout/workflow.ts",
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
          timeoutMs: 10,
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
      await harnessStarted;
      const result = await promise;

      expect(result.metadata.status).toBe("failed");
      expect(result.metadata.steps[0]?.errorKind).toBe("step-timeout");
      expect(authority.listenerCount()).toBe(0);
      releaseHarness();
      await harnessFinished;
      const events = readFileSync(
        join(projectDir, result.metadata.runDir, "steps", "agent.events.jsonl"),
        "utf-8",
      );
      expect(events).toContain("agent.started");
      expect(events).not.toContain("late.after-timeout");
      expect(events).not.toContain("stale success after timeout");
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
