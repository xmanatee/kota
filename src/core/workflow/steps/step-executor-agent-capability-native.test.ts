import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarnessReadiness,
  AgentHarnessUnsupportedOption,
} from "#core/agent-harness/index.js";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  resetHarnessHooks,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "../run-executor.js";
import { WorkflowRunStore } from "../run-store.js";
import {
  AGENT_OK_RESULT,
  makeAgentStep,
  makeDefinition,
  makeHarness,
  makeProjectDir,
  readCapabilityArtifact,
  removeProjectDir,
  TRIGGER,
} from "./step-executor-agent-capability-fixtures.integration.js";

describe("workflow native-harness capability artifacts", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    projectDir = makeProjectDir();
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    removeProjectDir(projectDir);
  });

  it("writes the artifact before unsupported native-harness options reject launch", async () => {
    const unsupportedToolOptions: readonly AgentHarnessUnsupportedOption[] = [
      {
        runOption: "allowedTools",
        option: "allowedTools",
        reason: "Native fake harness owns its allowlist.",
      },
      {
        runOption: "canUseTool",
        option: "canUseTool",
        reason: "Native fake harness does not route tool calls through KOTA.",
      },
    ];
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
      optionalRuntimes: [
        {
          kind: "node-package",
          status: "error",
          required: false,
          packageName: "fake-sandbox-helper",
          detail: "sandbox helper probe failed locally",
          summary: "fake-sandbox-helper version probe failed",
        },
      ],
      unsupportedOptions: unsupportedToolOptions,
    };
    const run = vi.fn(async () => AGENT_OK_RESULT);
    const harnessName = "capability-native";
    registerAgentHarness(
      makeHarness(harnessName, run, {
        toolControl: "native",
        unsupportedRunOptions: [
          ...unsupportedToolOptions,
          {
            runOption: "thinking",
            option: "thinking",
            reason: "Native fake harness cannot honor KOTA thinking controls.",
          },
        ],
        readiness: () => readiness,
      }),
    );

    const step = makeAgentStep(projectDir, harnessName, {
      allowedTools: ["Read"],
      thinkingEnabled: true,
    });
    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, step),
      TRIGGER,
      { projectDir, bus, store, log: () => {} },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]).toMatchObject({
      id: "agent",
      status: "failed",
    });
    expect(result.metadata.steps[0]?.error).toContain(
      'allowedTools selects native harness "capability-native", which cannot honor KOTA named tool restrictions',
    );
    expect(run).not.toHaveBeenCalled();

    const artifact = readCapabilityArtifact(
      projectDir,
      result.metadata.runDir,
      "agent",
    );
    expect(artifact).toMatchObject({
      harnessName,
      toolControl: "native",
      supportsOwnerQuestions: false,
      emitsAgentMessageStream: false,
      unsupportedRunOptions: [
        {
          option: "allowedTools",
          runOption: "allowedTools",
          reason: "Native fake harness owns its allowlist.",
        },
        {
          option: "canUseTool",
          runOption: "canUseTool",
          reason: "Native fake harness does not route tool calls through KOTA.",
        },
        {
          option: "thinking",
          runOption: "thinking",
          reason: "Native fake harness cannot honor KOTA thinking controls.",
        },
      ],
      localReadiness: {
        adapterKind: "native-cli",
        localRuntime: {
          kind: "native-cli",
          status: "ready",
          required: true,
          summary: "fake-native 1.0.0 at /opt/bin/fake-native",
        },
        optionalRuntimes: [
          {
            kind: "node-package",
            status: "error",
            required: false,
            summary: "fake-sandbox-helper version probe failed",
          },
        ],
      },
    });
    expect(
      (artifact.localReadiness as { optionalRuntimes: Record<string, unknown>[] })
        .optionalRuntimes[0],
    ).not.toHaveProperty("detail");
  });

  it("fails before native harness launch when required readiness is missing", async () => {
    const readiness: AgentHarnessReadiness = {
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        status: "missing",
        required: true,
        command: "fake-native --version",
        binaryName: "fake-native",
        summary: "fake-native executable not found on PATH",
      },
      optionalRuntimes: [],
      unsupportedOptions: [],
    };
    const run = vi.fn(async () => AGENT_OK_RESULT);
    const harnessName = "capability-native-missing";
    registerAgentHarness(
      makeHarness(harnessName, run, {
        toolControl: "native",
        readiness: () => readiness,
      }),
    );

    const step = makeAgentStep(projectDir, harnessName);
    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, step),
      TRIGGER,
      { projectDir, bus, store, log: () => {} },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "auth" });
    expect(result.metadata.steps[0]).toMatchObject({
      id: "agent",
      status: "failed",
    });
    expect(result.metadata.steps[0]?.error).toContain("(harness_readiness)");
    expect(result.metadata.steps[0]?.error).toContain(
      "fake-native executable not found on PATH",
    );
    expect(run).not.toHaveBeenCalled();

    const artifact = readCapabilityArtifact(
      projectDir,
      result.metadata.runDir,
      "agent",
    );
    expect(artifact).toMatchObject({
      harnessName,
      localReadiness: {
        localRuntime: {
          status: "missing",
          required: true,
          summary: "fake-native executable not found on PATH",
        },
      },
    });
  });
});
