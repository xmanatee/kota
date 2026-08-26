import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  type AgentHarnessUnsupportedOption,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { executeAgentStep } from "./steps/step-executor-agent.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "./validation.js";

const DEFINITION_PATH = "src/core/workflow/agent-run-contract-validation.test.ts";

function harnessFixture(
  name: string,
  unsupportedRunOptions: readonly AgentHarnessUnsupportedOption[],
  overrides: Partial<AgentHarness> = {},
): { harness: AgentHarness; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (options: AgentHarnessRunOptions) => {
    options.abortQuarantine?.register(() => {});
    return {
      text: "unused",
      streamedText: "",
      turns: 1,
      usage: UNKNOWN_AGENT_USAGE,
      isError: false,
    };
  });
  return {
    harness: {
      name,
      description: `${name} fixture`,
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      unsupportedRunOptions,
      ...overrides,
      run,
    },
    run,
  };
}

function unsupported(
  runOption: AgentHarnessUnsupportedOption["runOption"],
  option: string,
  reason: string,
): AgentHarnessUnsupportedOption {
  return { runOption, option, reason };
}

describe("resolved workflow agent run-contract validation", () => {
  let scopeRoot: string;
  let agent: AgentDef;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-workflow-agent-contract-"));
    mkdirSync(join(scopeRoot, "agents"), { recursive: true });
    writeFileSync(join(scopeRoot, "agents", "reviewer.md"), "Review the input.\n");
    agent = {
      name: "reviewer",
      role: "Review structured input.",
      promptPath: "agents/reviewer.md",
      model: "declared-model",
      effort: "high",
      writeScope: "deny-all",
    };
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  function definition(
    harness: string,
    step: Record<string, unknown>,
  ): RegisteredWorkflowDefinitionInput {
    return registerWorkflowDefinition(DEFINITION_PATH, {
      repository: "read",
      name: "contract-fixture",
      moduleRoot: scopeRoot,
      triggers: [{ event: "manual" }],
      steps: [{
        id: "review",
        type: "agent",
        agentName: agent.name,
        harness,
        autonomyMode: "autonomous",
        ...step,
      }],
    });
  }

  const options = () => ({
    resolveAgentDef: (name: string) => (name === agent.name ? agent : undefined),
  });
  it("rejects an unsupported autonomy mode with workflow, step, harness, option, and reason", () => {
    const { harness } = harnessFixture("native-passive-fixture", [
      unsupported(
        "autonomyMode.passive",
        'autonomyMode="passive"',
        "The native fixture cannot enforce read-only tool effects.",
      ),
    ]);
    registerAgentHarness(harness);

    expect(() => validateWorkflowDefinitions([
      definition(harness.name, { autonomyMode: "passive" }),
    ], scopeRoot, options())).toThrow(
      /contract-fixture.*steps\[0\].*native-passive-fixture.*autonomyMode="passive".*cannot enforce read-only tool effects/,
    );
  });

  it("rejects another unsupported resolved run option", () => {
    const { harness } = harnessFixture("native-thinking-fixture", [
      unsupported(
        "thinking",
        "thinkingEnabled/thinkingBudget",
        "Portable thinking controls are unavailable.",
      ),
    ]);
    registerAgentHarness(harness);

    expect(() => validateWorkflowDefinitions([
      definition(harness.name, { thinkingEnabled: true }),
    ], scopeRoot, options())).toThrow(
      /native-thinking-fixture.*thinkingEnabled\/thinkingBudget.*Portable thinking controls are unavailable/,
    );
  });

  it("accepts and executes a supported native contract with the same resolved options", async () => {
    const validateModelId = vi.fn();
    const { harness, run } = harnessFixture("supported-native-fixture", [
      unsupported(
        "autonomyMode.passive",
        'autonomyMode="passive"',
        "Passive mode is unsupported.",
      ),
    ]);
    registerAgentHarness({ ...harness, validateModelId });

    const [validated] = validateWorkflowDefinitions(
      [definition(harness.name, { model: "step-model" })],
      scopeRoot,
      { ...options(), agentModels: { reviewer: "operator-model" } },
    );

    expect(validated.steps[0]).toMatchObject({
      type: "agent",
      harness: harness.name,
      model: "operator-model",
      autonomyMode: "autonomous",
    });
    expect(validateModelId).toHaveBeenCalledWith("operator-model");

    const metadata: WorkflowRunMetadata = {
      id: "supported-parity-run",
      workflow: validated.name,
      runDir: ".kota/runs/supported-parity-run",
      definitionPath: validated.definitionPath,
      trigger: { event: "manual", schemaRef: null, payload: {} },
      startedAt: new Date().toISOString(),
      status: "running",
      steps: [],
    };
    const result = await executeAgentStep(
      validated,
      validated.steps[0] as WorkflowAgentStep,
      metadata,
      metadata.trigger,
      new AbortController(),
      () => {},
      () => {},
      {
        scopeRoot,
        config: { agentModels: { reviewer: "operator-model" } } as never,
        log: () => {},
      },
    );

    expect(result).toMatchObject({
      harness: harness.name,
      model: "operator-model",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      model: "operator-model",
      autonomyMode: "autonomous",
      persistSession: false,
      enableFileCheckpointing: false,
    });
  });

  it("leaves dynamic harness readiness out of definition validation", () => {
    const readiness = vi.fn(() => {
      throw new Error("dynamic readiness must not run during definition validation");
    });
    const { harness } = harnessFixture("dynamic-readiness-fixture", [], {
      readiness,
    });
    registerAgentHarness(harness);

    expect(() => validateWorkflowDefinitions(
      [definition(harness.name, {})],
      scopeRoot,
      options(),
    )).not.toThrow();
    expect(readiness).not.toHaveBeenCalled();
  });

  it("names the exact nested agent path", () => {
    const { harness } = harnessFixture("nested-passive-fixture", [
      unsupported(
        "autonomyMode.passive",
        'autonomyMode="passive"',
        "Nested passive execution is unavailable.",
      ),
    ]);
    registerAgentHarness(harness);
    const nested = registerWorkflowDefinition(DEFINITION_PATH, {
      repository: "read",
      name: "nested-contract-fixture",
      moduleRoot: scopeRoot,
      triggers: [{ event: "manual" }],
      steps: [{
        id: "for-each-review",
        type: "foreach",
        as: "item",
        items: ["one"],
        steps: [{
          id: "review-item",
          type: "agent",
          agentName: agent.name,
          harness: harness.name,
          autonomyMode: "passive",
        }],
      }],
    });

    expect(() => validateWorkflowDefinitions(
      [nested],
      scopeRoot,
      options(),
    )).toThrow(/nested-contract-fixture.*steps\[0\]\.steps\[0\].*nested-passive-fixture/);
  });

  it("validates a declared repair-loop judge contract", () => {
    const { harness } = harnessFixture(
      "hosted-judge-fixture",
      [
        unsupported(
          "disallowedTools",
          "disallowedTools",
          "The hosted fixture cannot filter judge tools.",
        ),
      ],
      { toolControl: "kota", nativeAbortQuarantine: undefined },
    );
    registerAgentHarness(harness);

    expect(() => validateWorkflowDefinitions([
      definition(harness.name, {
        repairLoop: {
          checks: [{
            id: "judge",
            type: "code",
            resolveAgentContract: () => ({
              harness: harness.name,
              model: "judge-model",
              effort: "high",
              autonomyMode: "autonomous",
              disallowedTools: ["Bash"],
              ownerQuestionAccess: "disabled",
            }),
            run: () => "ok",
          }],
        },
      }),
    ], scopeRoot, options())).toThrow(
      /steps\[0\]\.repairLoop\.checks\[0\].*hosted-judge-fixture.*disallowedTools.*cannot filter judge tools/,
    );
  });
});
