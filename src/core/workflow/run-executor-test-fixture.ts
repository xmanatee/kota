import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarness, AgentHarnessResult } from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import {
  AgentBackoffAdmissionError,
  type AgentBackoffManager,
} from "./agent-backoff.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type {
  WorkflowAgentBackoffSignal,
  WorkflowAgentBackoffState,
  WorkflowRunTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

export const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  usage: {
    tokens: { state: "unknown" },
    cost: { state: "unknown" },
  },
  isError: false,
};

export const AGENT_IDLE_TIMEOUT_MS = 100;
export const AGENT_IDLE_DELAY_MS = 500;
export const AGENT_STEP_TIMEOUT_MS = 1_500;

function createLog() {
  return vi.fn<(message: string) => void>();
}

export interface RunExecutorTestFixture {
  workspaceRoot: string;
  store: WorkflowRunStore;
  bus: EventBus;
  runContext: RunContext;
  log: ReturnType<typeof createLog>;
  execute(
    definition: WorkflowDefinition,
    options?: {
      runContext?: RunContext;
      agentBackoff?: AgentBackoffManager;
    },
  ): ReturnType<typeof executeWorkflowRun>;
  dispose(): void;
}

export function createRunExecutorTestFixture(): RunExecutorTestFixture {
  const workspaceRoot = join(
    tmpdir(),
    `kota-run-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  const store = new WorkflowRunStore(workspaceRoot);
  const bus = new EventBus();
  const runContext = makeRunContext(workspaceRoot);
  const log = createLog();
  return {
    workspaceRoot,
    store,
    bus,
    runContext,
    log,
    execute: (definition, options = {}) =>
      executeWorkflowRun(definition, TRIGGER, {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: options.runContext ?? runContext,
        bus,
        store,
        log,
        agentBackoff: options.agentBackoff,
      }),
    dispose: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

export function makeDefinition(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
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

export function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
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

export function registerWorkflowScenarioDriver(
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

export function createPrimaryAgentBackoffFixture(): {
  manager: AgentBackoffManager;
  apply: ReturnType<typeof vi.fn>;
  registerAttempt: ReturnType<typeof vi.fn>;
} {
  let active: WorkflowAgentBackoffState | null = null;
  const attempts = new Set<AbortController>();
  const registerAttempt = vi.fn((controller: AbortController) => {
    if (active !== null) throw new AgentBackoffAdmissionError(active);
    attempts.add(controller);
    return () => attempts.delete(controller);
  });
  const apply = vi.fn((signal: WorkflowAgentBackoffSignal) => {
    const next: WorkflowAgentBackoffState = {
      runtimeId: "agy:antigravity-cli",
      kind: signal.kind,
      failureCount: 1,
      until: "2026-09-02T18:00:00.000Z",
      updatedAt: "2026-09-02T17:55:00.000Z",
      reason: signal.reason,
    };
    active = next;
    for (const controller of attempts) {
      controller.abort(new AgentBackoffAdmissionError(next, signal));
    }
    attempts.clear();
    return next;
  });
  return {
    manager: { registerAttempt, apply } as unknown as AgentBackoffManager,
    apply,
    registerAttempt,
  };
}

export function makeRunContext(workspaceRoot: string, attempt = 1): RunContext {
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
    run: { id: runId, attempt, daemonEpoch: 1 },
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
      attempt,
      daemonEpoch: 1,
      workspaceDir,
      runDir: rootDir,
      tempDir,
      artifactDir,
      agentDir,
      packageCacheDir,
      ports: {
        start: 41_000,
        end: 41_003,
        size: 4,
        values: [41_000, 41_001, 41_002, 41_003],
      },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}

export function makeAgentStep(
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
