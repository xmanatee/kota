import { afterEach, describe, expect, it } from "vitest";
import {
  type AgentHarness,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

describe("code-step agent run-contract validation", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  it("validates a nested code-step launch against the active runtime", () => {
    const harness: AgentHarness = {
      name: "code-step-agent-fixture",
      description: "code-step contract fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      unsupportedRunOptions: [{
        runOption: "thinking",
        option: "thinkingEnabled/thinkingBudget",
        reason: "The code-step fixture cannot honor thinking controls.",
      }],
      run: async () => ({
        text: "unused",
        streamedText: "",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      }),
    };
    registerAgentHarness(harness);
    const definition = registerWorkflowDefinition(
      "src/core/workflow/code-step-agent-contract-validation.test.ts",
      {
        repository: "read",
        name: "nested-code-step-contract-fixture",
        moduleRoot: process.cwd(),
        triggers: [{ event: "manual" }],
        steps: [{
          id: "review-items",
          type: "foreach",
          items: ["one"],
          as: "item",
          steps: [{
            id: "shadow-review",
            type: "code",
            resolveAgentContract: (runtime) => ({
              harness: runtime.harness,
              model: runtime.tiers.capable,
              effort: runtime.effort,
              autonomyMode: "autonomous",
              ownerQuestionAccess: "disabled",
              thinkingEnabled: true,
            }),
            run: () => "unused",
          }],
        }],
      },
    );

    expect(() => validateWorkflowDefinitions(
      [definition],
      process.cwd(),
      { defaultAgentHarness: harness.name },
    )).toThrow(
      /nested-code-step-contract-fixture.*steps\[0\]\.steps\[0\].*code-step-agent-fixture.*thinkingEnabled\/thinkingBudget.*cannot honor thinking controls/,
    );
  });

  it("preserves the exact branch-arm path in code-step contract diagnostics", () => {
    const harness: AgentHarness = {
      name: "branch-code-step-agent-fixture",
      description: "branch code-step contract fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      unsupportedRunOptions: [{
        runOption: "thinking",
        option: "thinkingEnabled/thinkingBudget",
        reason: "The branch code-step fixture cannot honor thinking controls.",
      }],
      run: async () => ({
        text: "unused",
        streamedText: "",
        turns: 1,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      }),
    };
    registerAgentHarness(harness);
    const definition = registerWorkflowDefinition(
      "src/core/workflow/code-step-agent-contract-validation.test.ts",
      {
        repository: "read",
        name: "branch-code-step-contract-fixture",
        moduleRoot: process.cwd(),
        triggers: [{ event: "manual" }],
        steps: [{
          id: "choose-review",
          type: "branch",
          condition: () => true,
          ifTrue: [{
            id: "shadow-review",
            type: "code",
            resolveAgentContract: (runtime) => ({
              harness: runtime.harness,
              model: runtime.tiers.capable,
              effort: runtime.effort,
              autonomyMode: "autonomous",
              ownerQuestionAccess: "disabled",
              thinkingEnabled: true,
            }),
            run: () => "unused",
          }],
          ifFalse: [],
        }],
      },
    );

    expect(() => validateWorkflowDefinitions(
      [definition],
      process.cwd(),
      { defaultAgentHarness: harness.name },
    )).toThrow(
      /branch-code-step-contract-fixture.*steps\[0\]\.ifTrue\[0\].*branch-code-step-agent-fixture.*thinkingEnabled\/thinkingBudget.*cannot honor thinking controls/,
    );
  });
});
