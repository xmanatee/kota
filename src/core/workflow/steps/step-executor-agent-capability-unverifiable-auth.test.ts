import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
} from "#core/agent-harness/index.js";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  resetHarnessHooks,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "../run-executor.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowAgentStep } from "../step-types.js";
import { createTestRunContext } from "../testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";

const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

function makeScopeRoot(): string {
  const workspaceRoot = join(
    tmpdir(),
    `kota-agent-capability-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, "prompt.md"), "Run.\n");
  return workspaceRoot;
}

function makeAgentStep(workspaceRoot: string, harness: string): WorkflowAgentStep {
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: workspaceRoot,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
  };
}

function makeDefinition(
  workspaceRoot: string,
  step: WorkflowAgentStep,
): WorkflowDefinition {
  return {
    name: "capability-unverifiable-auth-test",
    enabled: true,
    repository: "read",
    definitionPath: "src/modules/test/workflows/capability/workflow.ts",
    moduleRoot: workspaceRoot,
    triggers: [],
    steps: [step],
    tags: [],
  };
}

function makeHarness(
  name: string,
  run: AgentHarness["run"],
  readiness: AgentHarnessReadiness,
): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: true,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    nativeAbortQuarantine: "confirmed-stop",
    readiness: () => readiness,
    run: async (options, writer) => {
      options.abortQuarantine?.register(() => {});
      return run(options, writer);
    },
  };
}

function readCapabilityArtifact(
  workspaceRoot: string,
  runDir: string,
): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(workspaceRoot, runDir, "steps", "agent.harness-capability.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;
}

describe("workflow agent-step capability artifacts for unverifiable auth", () => {
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
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("serializes unverifiable required auth and fails before native harness launch", async () => {
    const readiness: AgentHarnessReadiness = {
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        status: "ready",
        required: true,
        command: "fake-native --version",
        binaryName: "fake-native",
        executablePath: "/opt/bin/fake-native",
        version: "fake-native 1.0.0",
        summary: "fake-native 1.0.0 at /opt/bin/fake-native",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "unverifiable",
        required: true,
        command: "fake-native",
        detail: "no non-interactive auth-status command",
        summary: "Fake native auth cannot be verified non-interactively",
      },
      optionalRuntimes: [],
      unsupportedOptions: [],
    };
    const run = vi.fn(async () => AGENT_OK_RESULT);
    const harnessName = "capability-native-unverifiable-auth";
    registerAgentHarness(makeHarness(harnessName, run, readiness));

    const step = makeAgentStep(workspaceRoot, harnessName);
    const { promise } = executeWorkflowRun(
      makeDefinition(workspaceRoot, step),
      TRIGGER,
      { runContext: createTestRunContext(workspaceRoot, TRIGGER), bus, store, log: () => {} },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "auth" });
    expect(result.metadata.steps[0]?.error).toContain(
      "localAuth unverifiable",
    );
    expect(run).not.toHaveBeenCalled();

    expect(readCapabilityArtifact(workspaceRoot, result.metadata.runDir)).toMatchObject({
      harnessName,
      localReadiness: {
        localRuntime: {
          status: "ready",
          required: true,
          summary: "fake-native 1.0.0 at /opt/bin/fake-native",
        },
        localAuth: {
          kind: "harness-managed-login",
          status: "unverifiable",
          required: true,
          summary: "Fake native auth cannot be verified non-interactively",
        },
      },
    });
  });

  it("serializes expiring required auth without blocking native harness launch", async () => {
    const readiness: AgentHarnessReadiness = {
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        status: "ready",
        required: true,
        command: "fake-native --version",
        binaryName: "fake-native",
        executablePath: "/opt/bin/fake-native",
        version: "fake-native 1.0.0",
        summary: "fake-native 1.0.0 at /opt/bin/fake-native",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "expiring",
        required: true,
        command: "fake-native auth status",
        detail:
          "Fake native login expires at 2026-06-22T00:30:00.000Z",
        summary: "Fake native login expires soon",
        expiresAt: "2026-06-22T00:30:00.000Z",
        renewalSummary: "run `fake-native login` before unattended runs",
      },
      optionalRuntimes: [],
      unsupportedOptions: [],
    };
    const run = vi.fn(async () => AGENT_OK_RESULT);
    const harnessName = "capability-native-expiring-auth";
    registerAgentHarness(makeHarness(harnessName, run, readiness));

    const step = makeAgentStep(workspaceRoot, harnessName);
    const { promise } = executeWorkflowRun(
      makeDefinition(workspaceRoot, step),
      TRIGGER,
      { runContext: createTestRunContext(workspaceRoot, TRIGGER), bus, store, log: () => {} },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(run).toHaveBeenCalledTimes(1);

    expect(readCapabilityArtifact(workspaceRoot, result.metadata.runDir)).toMatchObject({
      harnessName,
      localReadiness: {
        localAuth: {
          kind: "harness-managed-login",
          status: "expiring",
          required: true,
          summary: "Fake native login expires soon",
          expiresAt: "2026-06-22T00:30:00.000Z",
          renewalSummary: "run `fake-native login` before unattended runs",
        },
      },
    });
  });
});
