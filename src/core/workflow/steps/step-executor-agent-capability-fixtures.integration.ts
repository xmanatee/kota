import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHarness,
  AgentHarnessResult,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";

export const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

export const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

export const RESTRICTED_AGENT: AgentDef = {
  name: "restricted-reviewer",
  role: "Review evidence without mutating source files.",
  promptPath: "prompt.md",
  model: "test-model",
  effort: "low",
  writeScope: [".kota/runs/"],
};

export function makeProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-agent-capability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
  return projectDir;
}

export function removeProjectDir(projectDir: string): void {
  rmSync(projectDir, { recursive: true, force: true });
}

export function makeAgentStep(
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

export function makeDefinition(
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

export function makeHarness(
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

export function readCapabilityArtifact(
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
