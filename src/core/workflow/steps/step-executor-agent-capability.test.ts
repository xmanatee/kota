import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHarness,
  AgentHarnessReadiness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
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
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", schemaRef: null, payload: {} };

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-agent-capability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
  return projectDir;
}

function makeAgentStep(
  projectDir: string,
  harness: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    ...overrides,
  };
}

function makeDefinition(
  projectDir: string,
  step: WorkflowAgentStep,
): WorkflowDefinition {
  return {
    name: "capability-artifact-test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/capability/workflow.ts",
    moduleRoot: projectDir,
    triggers: [],
    steps: [step],
    tags: [],
  };
}

function makeHarness(
  name: string,
  run: AgentHarness["run"],
  overrides: Partial<
    Pick<
      AgentHarness,
      | "askOwnerToolName"
      | "emitsAgentMessageStream"
      | "readiness"
      | "supportedHookKinds"
      | "supportsMultiTurn"
      | "toolControl"
      | "unsupportedRunOptions"
    >
  > = {},
): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: overrides.supportsMultiTurn ?? true,
    supportedHookKinds: overrides.supportedHookKinds ?? [],
    askOwnerToolName: overrides.askOwnerToolName ?? null,
    emitsAgentMessageStream: overrides.emitsAgentMessageStream ?? false,
    toolControl: overrides.toolControl ?? "kota",
    ...(overrides.readiness !== undefined
      ? { readiness: overrides.readiness }
      : {}),
    ...(overrides.unsupportedRunOptions !== undefined
      ? { unsupportedRunOptions: overrides.unsupportedRunOptions }
      : {}),
    run,
  };
}

function readCapabilityArtifact(
  projectDir: string,
  runDir: string,
  stepId: string,
): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(projectDir, runDir, "steps", `${stepId}.harness-capability.json`),
      "utf-8",
    ),
  ) as Record<string, unknown>;
}

describe("workflow agent-step harness capability artifacts", () => {
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
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes a bounded capability artifact before a KOTA-controlled harness runs", async () => {
    const readiness: AgentHarnessReadiness = {
      adapterKind: "agent-sdk",
      localRuntime: {
        kind: "node-package",
        status: "ready",
        required: true,
        packageName: "fake-agent-sdk",
        version: "1.2.3",
        summary: "fake-agent-sdk@1.2.3",
      },
      optionalRuntimes: [],
      unsupportedOptions: [],
    };
    const run = vi.fn(async (options: AgentHarnessRunOptions) => {
      expect(options.allowedTools).toEqual(["Read", "ask_owner"]);
      expect(options.disallowedTools).toEqual(["Write"]);
      expect(options.canUseTool).toBeTypeOf("function");
      expect(options.askOwner).toEqual({
        source: expect.stringContaining("workflow:capability-artifact-test/"),
      });
      await options.onMessage?.({ type: "text", text: "progress" });
      return AGENT_OK_RESULT;
    });
    const harnessName = "capability-kota";
    registerAgentHarness(
      makeHarness(harnessName, run, {
        askOwnerToolName: "ask_owner",
        emitsAgentMessageStream: true,
        supportedHookKinds: ["preRun"],
        readiness: () => readiness,
      }),
    );

    const step = makeAgentStep(projectDir, harnessName, {
      allowedTools: ["Read"],
      disallowedTools: ["Write"],
    });
    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, step),
      TRIGGER,
      { projectDir, bus, store, log: () => {} },
    );
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]).toMatchObject({
      id: "agent",
      status: "success",
      harness: harnessName,
      model: "test-model",
    });
    expect(run).toHaveBeenCalledTimes(1);

    const artifact = readCapabilityArtifact(
      projectDir,
      result.metadata.runDir,
      "agent",
    );
    expect(artifact).toMatchObject({
      harnessName,
      toolControl: "kota",
      supportsMultiTurn: true,
      supportsOwnerQuestions: true,
      askOwnerToolName: "ask_owner",
      emitsAgentMessageStream: true,
      supportedHookKinds: ["preRun"],
      unsupportedRunOptions: [],
      localReadiness: {
        adapterKind: "agent-sdk",
        localRuntime: {
          kind: "node-package",
          status: "ready",
          required: true,
          summary: "fake-agent-sdk@1.2.3",
        },
        optionalRuntimes: [],
        unsupportedOptions: [],
      },
    });
    expect(
      (artifact.localReadiness as { localRuntime: Record<string, unknown> })
        .localRuntime,
    ).not.toHaveProperty("version");
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
    expect(result.metadata.steps[0]?.error).toContain("thinking");
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
