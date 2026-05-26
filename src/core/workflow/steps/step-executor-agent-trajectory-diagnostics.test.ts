import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearAgentHarnessRegistryForTest,
  type KotaAgentMessage,
  registerAgentHarness,
  resetHarnessHooks,
} from "#core/agent-harness/index.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "../run-executor.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "../run-types.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

type TrajectoryDiagnosticsArtifactForTest = {
  status: "supported" | "unsupported";
  emitsAgentMessageStream: boolean;
  counts: {
    warningCount: number;
    unsupportedTrajectoryCount: number;
    missingStreamingFramesCount: number;
    missingFinalVerificationAfterEditCount: number;
    repeatedIdenticalFailingCommandCount: number;
    editAfterSuccessfulVerificationCount: number;
  };
  diagnostics: Array<{
    code: string;
    frameIndexes: number[];
  }>;
};

function toolCall(
  index: number,
  toolName: string,
  input: Extract<KotaAgentMessage, { type: "tool_call" }>["input"],
): KotaAgentMessage {
  return {
    type: "tool_call",
    toolUseId: `tool-${index}`,
    toolName,
    input,
  };
}

function toolResult(index: number, isError: boolean): KotaAgentMessage {
  return {
    type: "tool_result",
    toolUseId: `tool-${index}`,
    isError,
    content: isError ? "failed" : "ok",
  };
}

function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-agent-trajectory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
  return projectDir;
}

function makeAgentStep(
  projectDir: string,
  harness: string,
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
  };
}

function makeDefinition(
  projectDir: string,
  step: WorkflowAgentStep,
): WorkflowDefinition {
  return {
    name: "trajectory-diagnostics-test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/trajectory/workflow.ts",
    moduleRoot: projectDir,
    triggers: [],
    steps: [step],
    tags: [],
  };
}

function makeHarness(
  name: string,
  messages: readonly KotaAgentMessage[],
  emitsAgentMessageStream = true,
): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream,
    toolControl: "kota",
    async run(options: AgentHarnessRunOptions) {
      for (const message of messages) {
        await options.onMessage?.(message);
      }
      return AGENT_OK_RESULT;
    },
  };
}

function readDiagnosticsArtifact(
  projectDir: string,
  metadata: WorkflowRunMetadata,
): {
  step: WorkflowStepResult;
  artifactPath: string;
  artifact: TrajectoryDiagnosticsArtifactForTest;
} {
  const step = metadata.steps[0];
  if (step === undefined) throw new Error("missing step result");
  const artifactPath = step.trajectoryDiagnostics?.artifactPath;
  if (artifactPath === undefined) throw new Error("missing diagnostics path");
  const absolutePath = join(projectDir, artifactPath);
  return {
    step,
    artifactPath: absolutePath,
    artifact: JSON.parse(
      readFileSync(absolutePath, "utf-8"),
    ) as TrajectoryDiagnosticsArtifactForTest,
  };
}

async function runDiagnosticScenario(args: {
  projectDir: string;
  messages: readonly KotaAgentMessage[];
  emitsAgentMessageStream?: boolean;
}): Promise<{
  step: WorkflowStepResult;
  artifactPath: string;
  artifact: TrajectoryDiagnosticsArtifactForTest;
}> {
  const harness = `trajectory-${Math.random().toString(36).slice(2, 8)}`;
  registerAgentHarness(
    makeHarness(harness, args.messages, args.emitsAgentMessageStream ?? true),
  );
  const store = new WorkflowRunStore(args.projectDir);
  const bus = new EventBus();
  const { promise } = executeWorkflowRun(
    makeDefinition(args.projectDir, makeAgentStep(args.projectDir, harness)),
    TRIGGER,
    { projectDir: args.projectDir, bus, store, log: () => {} },
  );
  const result = await promise;
  expect(result.metadata.status).toBe("success");
  return readDiagnosticsArtifact(args.projectDir, result.metadata);
}

describe("workflow agent-step trajectory diagnostics", () => {
  let projectDir: string;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    resetHarnessHooks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes clean supported diagnostics beside the agent step artifacts", async () => {
    const { step, artifactPath, artifact } = await runDiagnosticScenario({
      projectDir,
      messages: [
        toolCall(1, "Edit", { path: "add.js" }),
        toolResult(1, false),
        toolCall(2, "Bash", { command: "pnpm test add.test.ts" }),
        toolResult(2, false),
      ],
    });

    expect(existsSync(artifactPath)).toBe(true);
    expect(artifact).toMatchObject({
      status: "supported",
      emitsAgentMessageStream: true,
      counts: { warningCount: 0 },
      diagnostics: [],
    });
    expect(step.trajectoryDiagnostics).toMatchObject({
      warningCount: 0,
      artifactPath: expect.stringContaining(
        "steps/agent.trajectory-diagnostics.json",
      ),
    });
    expect(step.output).not.toHaveProperty("trajectoryDiagnostics");
  });

  it("warns when a workflow edit has no later verification-like command", async () => {
    const { artifact } = await runDiagnosticScenario({
      projectDir,
      messages: [
        toolCall(1, "Edit", { path: "add.js" }),
        toolResult(1, false),
      ],
    });

    expect(
      artifact.counts.missingFinalVerificationAfterEditCount,
    ).toBe(1);
    expect(artifact.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing_final_verification_after_edit",
    );
  });

  it("warns on repeated identical failing commands without an intervening edit", async () => {
    const { artifact } = await runDiagnosticScenario({
      projectDir,
      messages: [
        toolCall(1, "Bash", { command: "pnpm test add.test.ts" }),
        toolResult(1, true),
        toolCall(2, "Bash", { command: "pnpm   test   add.test.ts" }),
        toolResult(2, true),
      ],
    });

    expect(artifact.counts.repeatedIdenticalFailingCommandCount).toBe(1);
    expect(artifact.diagnostics[0]?.frameIndexes).toEqual([0, 1, 2, 3]);
  });

  it("warns when a successful verification is followed by another edit", async () => {
    const { artifact } = await runDiagnosticScenario({
      projectDir,
      messages: [
        toolCall(1, "Bash", { command: "pnpm test add.test.ts" }),
        toolResult(1, false),
        toolCall(2, "Edit", { path: "add.js" }),
        toolResult(2, false),
      ],
    });

    const codes = artifact.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("edit_after_successful_verification");
    expect(codes).toContain("missing_final_verification_after_edit");
  });

  it("writes bounded unsupported diagnostics for non-streaming harnesses", async () => {
    const { step, artifact } = await runDiagnosticScenario({
      projectDir,
      messages: [],
      emitsAgentMessageStream: false,
    });

    expect(artifact).toMatchObject({
      status: "unsupported",
      emitsAgentMessageStream: false,
      counts: {
        warningCount: 1,
        unsupportedTrajectoryCount: 1,
      },
      diagnostics: [
        {
          code: "unsupported_trajectory",
          frameIndexes: [],
        },
      ],
    });
    expect(step.trajectoryDiagnostics).toMatchObject({
      warningCount: 1,
      unsupportedTrajectoryCount: 1,
    });
  });

  it("rewrites diagnostics from combined initial and repair-loop frames", async () => {
    const harness = "trajectory-repair-loop";
    let runCount = 0;
    registerAgentHarness({
      ...makeHarness(harness, []),
      async run(options: AgentHarnessRunOptions) {
        runCount += 1;
        const messages =
          runCount === 1
            ? [
                toolCall(1, "Edit", { path: "add.js" }),
                toolResult(1, false),
              ]
            : [
                toolCall(2, "Bash", { command: "pnpm test add.test.ts" }),
                toolResult(2, false),
              ];
        for (const message of messages) {
          await options.onMessage?.(message);
        }
        return AGENT_OK_RESULT;
      },
    });

    let checkAttempts = 0;
    const store = new WorkflowRunStore(projectDir);
    const bus = new EventBus();
    const step = {
      ...makeAgentStep(projectDir, harness),
      repairLoop: {
        maxRepairAttempts: 1,
        checks: [
          {
            id: "needs-repair",
            type: "code" as const,
            run: () => {
              checkAttempts += 1;
              if (checkAttempts === 1) throw new Error("needs verification");
              return "ok";
            },
          },
        ],
      },
    };
    const { promise } = executeWorkflowRun(
      makeDefinition(projectDir, step),
      TRIGGER,
      { projectDir, bus, store, log: () => {} },
    );
    const result = await promise;
    const { step: completedStep, artifact } = readDiagnosticsArtifact(
      projectDir,
      result.metadata,
    );

    expect(result.metadata.status).toBe("success");
    expect(runCount).toBe(2);
    expect(completedStep.output).toMatchObject({ repairIterations: [{ attempt: 1 }] });
    expect(artifact.counts.warningCount).toBe(0);
    expect(artifact.diagnostics).toEqual([]);
  });
});
