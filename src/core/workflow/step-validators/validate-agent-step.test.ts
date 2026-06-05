import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDef } from "#core/agents/agent-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "../validation.js";

const definitionPath = "src/modules/test/workflows/agent-resolution/workflow.ts";

describe("validateAgentStep registered agent resolution", () => {
  let projectDir: string;
  let reviewer: AgentDef;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-agent-step-resolution-"));
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, "agents", "reviewer.md"), "Review carefully.\n");
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
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("compiles prompt, model, effort, and tool policy from a registered agent", () => {
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition(definitionPath, {
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
      projectDir,
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

  it("rejects an unknown registered agent name when an agent resolver is available", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition(definitionPath, {
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
        projectDir,
        { resolveAgentDef: () => undefined },
      ),
    ).toThrow(/agentName references unknown registered agent "missing-reviewer"/);
  });

  it("rejects tool allow-list overrides that exceed the registered agent policy", () => {
    expect(() =>
      validateWorkflowDefinitions(
        [
          registerWorkflowDefinition(definitionPath, {
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
        projectDir,
        {
          resolveAgentDef: (name) => (name === reviewer.name ? reviewer : undefined),
        },
      ),
    ).toThrow(/requested allowed tool\(s\) exceed the registered agent policy: Write/);
  });
});
