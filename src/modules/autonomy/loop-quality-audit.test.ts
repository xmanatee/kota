import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import { setTerminalTransport, TerminalTransport } from "#modules/rendering/transport.js";
import {
  auditLoopQuality,
  type LoopQualityFindingId,
  type LoopQualityWorkflowInput,
} from "./loop-quality-audit.js";
import { buildLoopQualityAuditCommand } from "./loop-quality-audit-cli.js";
import autonomyHealthReviewerWorkflow from "./workflows/autonomy-health-reviewer/workflow.js";
import builderWorkflow from "./workflows/builder/workflow.js";
import dispatcherWorkflow from "./workflows/dispatcher/workflow.js";
import improverWorkflow from "./workflows/improver/workflow.js";
import researchRetryWorkflow from "./workflows/research-retry/workflow.js";

type AgentStepInput = Extract<WorkflowStepInput, { type: "agent" }>;
type ToolStepInput = Extract<WorkflowStepInput, { type: "tool" }>;

function withDefinition(
  workflow: LoopQualityWorkflowInput,
  name: string,
): LoopQualityWorkflowInput {
  return {
    ...workflow,
    definitionPath: `src/modules/autonomy/workflows/${name}/workflow.ts`,
  };
}

function workflow(
  name: string,
  steps: WorkflowStepInput[],
  overrides: Partial<LoopQualityWorkflowInput> = {},
): LoopQualityWorkflowInput {
  return {
    name,
    triggers: [{ event: "fixture.tick" }],
    steps,
    definitionPath: `fixtures/${name}/workflow.ts`,
    ...overrides,
  };
}

function agentStep(overrides: Partial<AgentStepInput> = {}): AgentStepInput {
  return {
    id: "act",
    type: "agent",
    promptPath: "prompt.md",
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    ...overrides,
  };
}

function toolStep(overrides: Partial<ToolStepInput> = {}): ToolStepInput {
  return {
    id: "tool",
    type: "tool",
    tool: "fixture.tool",
    ...overrides,
  };
}

function codeCheck(id: string) {
  return {
    id,
    type: "code" as const,
    run: () => "ok",
  };
}

function findingIds(workflows: readonly LoopQualityWorkflowInput[]): LoopQualityFindingId[] {
  return auditLoopQuality(workflows).findings.map((finding) => finding.id);
}

describe("loop quality audit", () => {
  afterEach(() => {
    setTerminalTransport(null);
  });

  it("covers representative shipped autonomy workflows without name-inventory logic", () => {
    const report = auditLoopQuality([
      withDefinition(builderWorkflow, "builder"),
      withDefinition(improverWorkflow, "improver"),
      withDefinition(dispatcherWorkflow, "dispatcher"),
      withDefinition(researchRetryWorkflow, "research-retry"),
      withDefinition(autonomyHealthReviewerWorkflow, "autonomy-health-reviewer"),
    ]);

    expect(report.workflows.map((item) => item.workflow)).toEqual([
      "autonomy-health-reviewer",
      "builder",
      "dispatcher",
      "improver",
      "research-retry",
    ]);
    expect(report.findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(report.findings.map((finding) => finding.id)).not.toContain(
      "loop.workflow-completed.self-trigger",
    );
    expect(
      report.workflows
        .find((item) => item.workflow === "builder")
        ?.checks.find((check) => check.check === "independent-verifier")
        ?.status,
    ).toBe("pass");
    expect(
      report.workflows
        .find((item) => item.workflow === "dispatcher")
        ?.checks.find((check) => check.check === "completion-evidence")
        ?.status,
    ).toBe("pass");
  });

  it("detects representative missing rails", () => {
    const missingCompletion = workflow("missing-completion", [
      agentStep({ timeoutMs: 1_000, when: () => true }),
    ]);
    const spinning = workflow("spinning", [
      { id: "run", type: "code", run: () => ({ ok: true }) },
    ]);
    const mutatingWithoutPosture = workflow("mutating-without-posture", [
      toolStep({
        id: "publish-release",
        tool: "release.publish",
        retry: { maxAttempts: 3, initialDelayMs: 10, backoffFactor: 2 },
      }),
    ]);
    const verifierless = workflow("verifierless", [
      agentStep({
        timeoutMs: 1_000,
        when: () => true,
        repairLoop: {
          checks: [
            codeCheck("success-criteria-declared"),
            codeCheck("commit-stageable"),
          ],
        },
      }),
    ]);

    expect(findingIds([
      missingCompletion,
      spinning,
      mutatingWithoutPosture,
      verifierless,
    ])).toEqual(expect.arrayContaining([
      "loop.completion-evidence.missing",
      "loop.repeatable-without-brake",
      "loop.mutating-retry-safety.missing",
      "loop.verifier.missing",
    ]));
  });

  it("keeps workflow.completed self-trigger protection explicit", () => {
    const selfTriggering = workflow(
      "self-triggering",
      [{ id: "finish", type: "code", run: () => ({ ok: true }) }],
      {
        tags: ["monitored"],
        triggers: [{ event: "workflow.completed", filter: { tags: ["monitored"] } }],
      },
    );
    const narrowed = workflow(
      "narrowed",
      [{ id: "finish", type: "code", run: () => ({ ok: true }) }],
      {
        tags: ["monitored"],
        triggers: [{ event: "workflow.completed", filter: { workflow: ["builder"] } }],
      },
    );

    expect(findingIds([selfTriggering])).toContain(
      "loop.workflow-completed.self-trigger",
    );
    expect(findingIds([narrowed])).not.toContain(
      "loop.workflow-completed.self-trigger",
    );
  });

  it("returns deterministic structured output", () => {
    const fixtures = [
      workflow("stable-a", [
        agentStep({
          timeoutMs: 1_000,
          repairLoop: {
            checks: [
              codeCheck("task-queue-valid"),
              codeCheck("critic-review"),
            ],
          },
        }),
      ]),
      workflow("stable-b", [
        { id: "assess", type: "code", run: () => ({ ok: true }) },
      ], {
        triggers: [{ event: "fixture.tick", cooldownMs: 1_000 }],
      }),
    ];

    expect(auditLoopQuality(fixtures)).toEqual(auditLoopQuality(fixtures));
  });

  it("renders stable finding ids from the CLI command", async () => {
    const chunks: string[] = [];
    setTerminalTransport(new TerminalTransport({
      stream: {
        write: (chunk) => {
          chunks.push(chunk);
          return true;
        },
        isTTY: false,
      },
    }));
    const program = new Command();
    program.exitOverride();
    program.addCommand(buildLoopQualityAuditCommand(() => [
      workflow("missing-completion", [
        agentStep({ timeoutMs: 1_000, when: () => true }),
      ]),
    ]));

    await program.parseAsync(["node", "kota", "loop-quality"]);

    expect(chunks.join("")).toContain("loop.completion-evidence.missing");
  });
});
