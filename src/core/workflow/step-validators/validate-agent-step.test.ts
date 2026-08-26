import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "../validation.js";

const definitionPath = "src/modules/test/workflows/agent-resolution/workflow.ts";

describe("validateAgentStep registered agent resolution", () => {
  let workspaceRoot: string;
  let reviewer: AgentDef;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-agent-step-resolution-"));
    mkdirSync(join(workspaceRoot, "agents"), { recursive: true });
    writeFileSync(join(workspaceRoot, "agents", "reviewer.md"), "Review carefully.\n");
    reviewer = {
      name: "reviewer",
      role: "Review implementation diffs.",
      promptPath: "agents/reviewer.md",
      model: "test-review-model",
      effort: "high",
      tools: {
        allowed: ["Read", "Grep"],
        disallowed: ["Bash"],
      },
      writeScope: ["reviews/"],
    };
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("compiles prompt, model, effort, and tool policy from a registered agent", () => {
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(definitionPath, {
          repository: "read",
          name: "review-workflow",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "review",
              type: "agent",
              agentName: "reviewer",
              harness: "test-harness",
              autonomyMode: "autonomous",
            },
          ],
        }),
      ],
      workspaceRoot,
      {
        resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
      },
    );

    expect(definition.steps[0]).toMatchObject({
      id: "review",
      type: "agent",
      agentName: "reviewer",
      promptPath: "agents/reviewer.md",
      model: "test-review-model",
      effort: "high",
      allowedTools: ["Grep", "Read"],
      disallowedTools: ["Bash"],
    });
  });

  it("normalizes a valid per-step token budget", () => {
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(definitionPath, {
          repository: "read",
          name: "review-workflow",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "review",
              type: "agent",
              agentName: "reviewer",
              harness: "test-harness",
              autonomyMode: "autonomous",
              tokenBudget: { maxTotalTokens: 10_000 },
            },
          ],
        }),
      ],
      workspaceRoot,
      {
        resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
      },
    );

    expect(definition.steps[0]).toMatchObject({
      id: "review",
      type: "agent",
      tokenBudget: { maxTotalTokens: 10_000 },
    });
  });

  it("rejects malformed per-step token budgets", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition(definitionPath, {
            repository: "read",
            name: "review-workflow",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "review",
                type: "agent",
                agentName: "reviewer",
                harness: "test-harness",
                autonomyMode: "autonomous",
                tokenBudget: { maxTotalTokens: 0 },
              },
            ],
          }),
        ],
        workspaceRoot,
        {
          resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
        },
      ),
    ).toThrow(/tokenBudget\.maxTotalTokens/);
  });

  it("rejects an unknown registered agent name when an agent resolver is available", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition(definitionPath, {
            repository: "read",
            name: "review-workflow",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "review",
                type: "agent",
                agentName: "missing-reviewer",
                harness: "test-harness",
                autonomyMode: "autonomous",
              },
            ],
          }),
        ],
        workspaceRoot,
        { resolveAgentDef: () => undefined },
      ),
    ).toThrow(/agentName references unknown registered agent "missing-reviewer"/);
  });

  it("rejects tool allow-list overrides that exceed the registered agent policy", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition(definitionPath, {
            repository: "read",
            name: "review-workflow",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "review",
                type: "agent",
                agentName: "reviewer",
                harness: "test-harness",
                autonomyMode: "autonomous",
                allowedTools: ["Read", "Write"],
              },
            ],
          }),
        ],
        workspaceRoot,
        {
          resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
        },
      ),
    ).toThrow(/requested allowed tool\(s\) exceed the registered agent policy: Write/);
  });

  it.each([
    {
      field: "allowedTools",
      policy: { allowedTools: ["Read"] },
      writeScope: [] as const,
    },
    {
      field: "allowedTools",
      policy: { allowedTools: [] },
      writeScope: ["reviews/"] as const,
    },
    {
      field: "disallowedTools",
      policy: { disallowedTools: ["Bash"] },
      writeScope: "deny-all" as const,
    },
  ])(
    "rejects $field restrictions for every write scope when the selected native harness cannot honor them",
    ({ field, policy, writeScope }) => {
      const nativeHarness: AgentHarness = {
        name: "native-tool-policy-fixture",
        description: "Native harness fixture without KOTA tool control.",
        supportsMultiTurn: false,
        supportedHookKinds: [],
        askOwnerToolName: null,
        emitsAgentMessageStream: false,
        toolControl: "native",
        nativeAbortQuarantine: "confirmed-stop",
        async run() {
          return {
            text: "unused",
            streamedText: "",
            turns: 1,
            usage: UNKNOWN_AGENT_USAGE,
            isError: false,
          };
        },
      };
      registerAgentHarness(nativeHarness);
      const nativeReviewer: AgentDef = {
        ...reviewer,
        tools: undefined,
        writeScope,
      };

      expect(() =>
        validateWorkflowDefinitions(
          [
            registerWorkflowDefinition(definitionPath, {
              repository: "read",
              name: "native-review-workflow",
              triggers: [{ event: "runtime.idle" }],
              steps: [
                {
                  id: "review",
                  type: "agent",
                  agentName: nativeReviewer.name,
                  harness: nativeHarness.name,
                  autonomyMode: "passive",
                  ...policy,
                },
              ],
            }),
          ],
          workspaceRoot,
          {
            resolveAgentDef: (name) =>
              name === nativeReviewer.name ? nativeReviewer : undefined,
          },
        ),
      ).toThrow(
        new RegExp(`${field}.*native-tool-policy-fixture.*cannot honor`),
      );
    },
  );
});
