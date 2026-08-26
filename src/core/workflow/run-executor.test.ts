import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { DEFAULT_STEP_TIMEOUT_MS } from "./run-executor-step.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    repository: "none",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", schemaRef: null, payload: {} };

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  usage: {
    tokens: { state: "unknown" },
    cost: { state: "unknown" },
  },
  isError: false,
};
const AGENT_IDLE_TIMEOUT_MS = 100;
const AGENT_IDLE_DELAY_MS = 500;
const AGENT_STEP_TIMEOUT_MS = 1_500;

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function registerWorkflowScenarioDriver(
  name: string,
  run: AgentHarness["run"],
): void {
  registerAgentHarness({
    name,
    description: "workflow test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: true,
    toolControl: "kota",
    run,
  });
}

function makeRunContext(workspaceRoot: string): RunContext {
  const runId = "test-run";
  const rootDir = join(workspaceRoot, ".kota", "runtime", runId);
  const workspaceDir = join(rootDir, "workspace");
  const tempDir = join(rootDir, "tmp");
  const artifactDir = join(rootDir, "artifacts");
  const agentDir = join(rootDir, "agent");
  const packageCacheDir = join(tempDir, "package-cache");
  for (const path of [workspaceDir, tempDir, artifactDir, agentDir, packageCacheDir]) {
    mkdirSync(path, { recursive: true });
  }

  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    scope: { id: "test-scope", root: workspaceRoot },
    workflow: "test",
    trigger: TRIGGER,
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
      ports: { start: 41_000, end: 41_003, size: 4, values: [41_000, 41_001, 41_002, 41_003] },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}

function makeAgentStep(
  workspaceRoot: string,
  harness: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  writeFileSync(join(workspaceRoot, "prompt.md"), "Run.\n");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: workspaceRoot,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    ...overrides,
  };
}

let workspaceRoot: string;
let store: WorkflowRunStore;
let bus: EventBus;
let runContext: RunContext;
const log = vi.fn();

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `kota-run-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  store = new WorkflowRunStore(workspaceRoot);
  bus = new EventBus();
  runContext = makeRunContext(workspaceRoot);
  log.mockReset();
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe("continueOnFailure", () => {
  it("subsequent steps run when a continueOnFailure step fails", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            executed.push("optional-step");
            throw new Error("transient failure");
          },
        },
        {
          id: "next-step",
          type: "code",
          run: () => {
            executed.push("next-step");
            return { ok: true };
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    await promise;

    expect(executed).toEqual(["optional-step", "next-step"]);
  });

  it("run finishes with completed-with-warnings when a continueOnFailure step fails", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            throw new Error("non-critical error");
          },
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(completed).toEqual([]);
  });

  it("failed continueOnFailure step result has continueOnFailure flag set in stored metadata", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            throw new Error("boom");
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    await promise;

    const runDirs = readdirSync(join(workspaceRoot, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(join(workspaceRoot, ".kota", "runs", runDirs[0], "metadata.json"), "utf-8"),
    ) as { steps: Array<{ status: string; continueOnFailure?: boolean; error?: string }> };

    expect(metadata.steps).toHaveLength(1);
    expect(metadata.steps[0].status).toBe("failed");
    expect(metadata.steps[0].continueOnFailure).toBe(true);
    expect(metadata.steps[0].error).toBe("boom");
  });

  it("run aborts normally when a step without continueOnFailure fails", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "critical-step",
          type: "code",
          run: () => {
            executed.push("critical-step");
            throw new Error("critical failure");
          },
        },
        {
          id: "unreachable-step",
          type: "code",
          run: () => {
            executed.push("unreachable-step");
          },
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(executed).toEqual(["critical-step"]);
    expect(result.metadata.status).toBe("failed");
    expect(completed).toEqual([]);
  });

  it("run finishes with success when no steps fail", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "normal-step",
          type: "code",
          continueOnFailure: true,
          run: () => "ok",
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(completed).toEqual([]);
  });

  it("next step can inspect failed continueOnFailure step result via stepResults", async () => {
    let capturedResult: unknown;
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            throw new Error("non-critical");
          },
        },
        {
          id: "check-step",
          type: "code",
          run: (ctx) => {
            capturedResult = ctx.stepResults["optional-step"];
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    await promise;

    expect((capturedResult as { status: string }).status).toBe("failed");
    expect((capturedResult as { error: string }).error).toBe("non-critical");
  });
});

describe("step timeout", () => {
  it("DEFAULT_STEP_TIMEOUT_MS is a hang rail, not a task-size limit", () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("fails the run when a step exceeds its timeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "hanging-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}), // never resolves
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]?.errorKind).toBe("step-timeout");
    const errorLog = (log.mock.calls as string[][]).flat().find((msg) => msg.includes("Failed"));
    expect(errorLog).toContain("hanging-step");
    expect(errorLog).toContain("timed out");
  }, 10_000);

  it("run status is 'failed' (not 'interrupted') on step timeout", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
  }, 10_000);

  it("subsequent steps do not run after a timeout failure", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
        {
          id: "unreachable-step",
          type: "code",
          run: () => { executed.push("unreachable-step"); },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    await promise;

    expect(executed).toEqual([]);
  }, 10_000);

  it("defers workflow failure publication on step timeout to the terminal rail", async () => {
    const alerts: unknown[] = [];
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    const definition = makeDefinition({
      steps: [
        {
          id: "stuck-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(alerts).toEqual([]);
  }, 10_000);

  it("lets code steps exceed idleTimeoutMs when they report typed progress", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "heartbeat-step",
          type: "code",
          idleTimeoutMs: 25,
          run: async (ctx) => {
            await delayWithAbort(15);
            ctx.reportProgress({ kind: "code-heartbeat", label: "first" });
            await delayWithAbort(15);
            ctx.reportProgress({ kind: "code-heartbeat", label: "second" });
            await delayWithAbort(15);
            return { ok: true };
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.output).toEqual({ ok: true });
  }, 10_000);

  it("keeps await-event steps governed by awaitTimeoutMs, not idleTimeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "wait",
          type: "await-event",
          event: "owner.answer",
          matchField: "id",
          matchValue: "question-1",
          awaitTimeoutMs: 25,
          idleTimeoutMs: 5,
        } as WorkflowDefinition["steps"][number],
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.output).toMatchObject({
      kind: "timeout",
      awaitTimeoutMs: 25,
    });
    expect(result.metadata.steps[0]?.errorKind).toBeUndefined();
  }, 10_000);

  it("lets streaming agent steps exceed idleTimeoutMs while typed messages arrive", async () => {
    const harness = "workflow-idle-productive";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      const signal = options.abortController?.signal;
      await delayWithAbort(100, signal);
      await options.onMessage?.({ type: "text", text: "one" });
      await delayWithAbort(100, signal);
      await options.onMessage?.({ type: "tool_call", toolUseId: "t1", toolName: "read", input: {} });
      await delayWithAbort(100, signal);
      await options.onMessage?.({ type: "tool_result", toolUseId: "t1", isError: false, content: "ok" });
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          idleTimeoutMs: 250,
          timeoutMs: 2000,
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.harness).toBe(harness);
  }, 10_000);

  it("governs an unbounded agent step only by trusted idle progress", async () => {
    const harness = "workflow-idle-governed";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      const signal = options.abortController?.signal;
      await delayWithAbort(30, signal);
      await options.onMessage?.({ type: "text", text: "one" });
      await delayWithAbort(30, signal);
      await options.onMessage?.({ type: "text", text: "two" });
      await delayWithAbort(30, signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          timeoutMs: null,
          idleTimeoutMs: 50,
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.activeDurationMs).toBeUndefined();
  }, 10_000);

  it("validates agent output before recording step output or streamed agent frames", async () => {
    const harness = "workflow-agent-output-validator";
    const token = `${"ghp"}_${"A".repeat(36)}`;
    const responseText = ["```json", JSON.stringify({ body: `token: ${token}` }), "```"].join("\n");
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await options.onMessage?.({ type: "text", text: responseText });
      return {
        text: responseText,
        streamedText: responseText,
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          validate: (raw) => {
            if (JSON.stringify(raw).includes(token)) {
              throw new Error("github-token");
            }
            return raw as object;
          },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;
    const step = result.metadata.steps[0];
    const runDirPath = join(workspaceRoot, result.metadata.runDir);

    expect(result.metadata.status).toBe("failed");
    expect(step?.status).toBe("failed");
    expect(step?.output).toBeUndefined();
    expect(step?.error).toContain("github-token");
    expect(step?.error).not.toContain(token);
    expect(existsSync(join(runDirPath, "steps", "agent.events.jsonl"))).toBe(false);
    expect(readFileSync(join(runDirPath, "metadata.json"), "utf-8")).not.toContain(token);
    expect(readFileSync(join(runDirPath, "error.txt"), "utf-8")).not.toContain(token);
  }, 10_000);

  it("retries invalid fenced JSON output with a targeted correction prompt", async () => {
    const harness = "workflow-agent-invalid-json-retry";
    const prompts: string[] = [];
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      prompts.push(options.prompt);
      const attempt = prompts.length;
      const text = prompts.length === 1
        ? "```json\n{ invalid\n```"
        : ["```json", JSON.stringify({ body: "ok" }), "```"].join("\n");
      return {
        text,
        streamedText: text,
        turns: 1,
        usage: {
          tokens: {
            state: "complete",
            inputTokens: attempt === 1 ? 10 : 20,
            outputTokens: attempt === 1 ? 2 : 3,
          },
          cost: { state: "unavailable", reason: "provider-does-not-report" },
        },
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Previous JSON output was invalid: the fenced block contains invalid JSON");
    expect(result.metadata.steps[0]?.output).toEqual({ body: "ok" });
    expect(result.metadata.steps[0]?.usage).toEqual({
      tokens: { state: "complete", inputTokens: 30, outputTokens: 5 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
  }, 10_000);

  it("retries missing fenced JSON output with a targeted correction prompt", async () => {
    const harness = "workflow-agent-missing-json-fence-retry";
    const prompts: string[] = [];
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      prompts.push(options.prompt);
      const text = prompts.length === 1
        ? JSON.stringify({ body: "ok" })
        : ["```json", JSON.stringify({ body: "ok" }), "```"].join("\n");
      return {
        text,
        streamedText: text,
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      "Previous output was missing usable structured JSON: no fenced JSON block was found in the response",
    );
    expect(result.metadata.steps[0]?.output).toEqual({ body: "ok" });
  }, 10_000);

  it("retries agent idle timeouts through the agent retry classifier", async () => {
    const harness = "workflow-idle-retry";
    let attempts = 0;
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      attempts += 1;
      const signal = options.abortController?.signal;
      if (attempts === 1) {
        await delayWithAbort(AGENT_IDLE_DELAY_MS, signal);
      }
      await options.onMessage?.({ type: "text", text: "recovered" });
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
          timeoutMs: AGENT_STEP_TIMEOUT_MS,
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(attempts).toBe(2);
  }, 10_000);

  it("records structured idle-timeout failure details before terminal publication", async () => {
    const alerts: unknown[] = [];
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    const harness = "workflow-idle-failure";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
          timeoutMs: null,
          retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
    expect(alerts).toEqual([]);
  }, 10_000);

  it("records structured idle-timeout failure details from repair agents", async () => {
    const harness = "workflow-repair-idle-failure";
    let attempts = 0;
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      attempts += 1;
      if (attempts === 1) return AGENT_OK_RESULT;
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
          timeoutMs: AGENT_STEP_TIMEOUT_MS,
          retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
          repairLoop: {
            maxRepairAttempts: 1,
            checks: [
              {
                id: "post-check",
                type: "code",
                run: () => {
                  throw new Error("still failing");
                },
              },
            ],
          },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
    expect(attempts).toBe(2);
  }, 10_000);

  it("records structured repair-loop exhaustion", async () => {
    const harness = "workflow-repair-exhausted";
    registerWorkflowScenarioDriver(harness, async () => AGENT_OK_RESULT);

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            maxRepairAttempts: 1,
            checks: [
              {
                id: "post-check",
                type: "code",
                run: () => {
                  throw new Error("still failing");
                },
              },
            ],
          },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      errorKind: "repair-attempts-exhausted",
    });
  }, 10_000);

  it("applies idleTimeoutMs to code children in parallel groups", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "fanout",
          type: "parallel",
          steps: [
            {
              id: "inner-code",
              type: "code",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-code");
    expect(result.metadata.status).toBe("failed");
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("applies idleTimeoutMs to code children in foreach groups", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [1],
          as: "item",
          steps: [
            {
              id: "inner-code",
              type: "code",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-code");
    expect(result.metadata.status).toBe("failed");
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("preserves agent idle-timeout details and backoff from parallel groups", async () => {
    const harness = "workflow-parallel-idle-failure";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        {
          id: "fanout",
          type: "parallel",
          steps: [
            makeAgentStep(workspaceRoot, harness, {
              id: "inner-agent",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
            }),
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-agent");
    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("preserves agent idle-timeout details and backoff from foreach groups", async () => {
    const harness = "workflow-foreach-idle-failure";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [1],
          as: "item",
          steps: [
            makeAgentStep(workspaceRoot, harness, {
              id: "inner-agent",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
            }),
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-agent");
    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("lets hard timeoutMs win before an idle timeout deadline", async () => {
    const harness = "workflow-hard-timeout-wins";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          idleTimeoutMs: 100,
          timeoutMs: 20,
          retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]?.error).toContain("timed out after 20ms");
    expect(result.metadata.steps[0]?.errorKind).toBe("step-timeout");
  }, 10_000);
});

describe("foreach step timeout", () => {
  it("fails the run when a foreach step exceeds its timeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "hanging-foreach",
          type: "foreach",
          timeoutMs: 50,
          items: [1, 2, 3],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => new Promise(() => {}), // never resolves
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const errorLog = (log.mock.calls as string[][]).flat().find((msg) => msg.includes("Failed"));
    expect(errorLog).toContain("hanging-foreach");
    expect(errorLog).toContain("timed out");
  }, 10_000);

  it("run status is 'failed' (not 'interrupted') on foreach step timeout", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-foreach",
          type: "foreach",
          timeoutMs: 50,
          items: [1],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
  }, 10_000);
});

describe("outputSchema validation", () => {
  it("run succeeds when last step output matches outputSchema", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ value: 42 }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.warnings).toBeUndefined();
  });

  it("run is completed-with-warnings when last step output mismatches outputSchema", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ value: "not-a-number" }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(result.metadata.warnings).toHaveLength(1);
    expect(result.metadata.warnings![0].type).toBe("output-schema-mismatch");
    expect(result.metadata.warnings![0].message).toContain("value");
  });

  it("run succeeds with no warnings when outputSchema is absent", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ whatever: true }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.warnings).toBeUndefined();
  });

  it("output schema mismatch warning is persisted in metadata.json", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", required: ["name"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ notName: "oops" }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    await promise;

    const runDirs = readdirSync(join(workspaceRoot, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(join(workspaceRoot, ".kota", "runs", runDirs[0], "metadata.json"), "utf-8"),
    ) as { status: string; warnings?: Array<{ type: string; message: string }> };

    expect(metadata.status).toBe("completed-with-warnings");
    expect(metadata.warnings).toHaveLength(1);
    expect(metadata.warnings![0].type).toBe("output-schema-mismatch");
  });

  it("output schema is not validated when run fails", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => { throw new Error("step failed"); },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState, runContext, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.warnings).toBeUndefined();
  });
});
