import { describe, expect, it } from "vitest";
import type { BusEnvelope } from "#core/events/event-bus.js";
import { enqueueMatchingWorkflows, workflowUsesAgent } from "./run-executor-utils.js";
import { safeJsonStringify } from "./run-io.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

function workflow(name: string): WorkflowDefinition {
  return validateWorkflowDefinitions(
    [
      registerWorkflowDefinition(`test/${name}.ts`, {
        name,
        triggers: [
          {
            event: "workflow.completed",
            filter: { tags: ["monitored"] },
          },
        ],
        steps: [
          {
            id: "mark",
            type: "emit",
            event: `${name}.done`,
          },
        ],
      }),
    ],
    process.cwd(),
  )[0]!;
}

describe("enqueueMatchingWorkflows", () => {
  it("clones matched trigger payloads so queued runs do not share nested references", () => {
    const enqueued: WorkflowRunTrigger[] = [];
    const envelope: BusEnvelope = {
      type: "workflow.completed",
      payload: {
        workflow: "explorer",
        runId: "run-1",
        status: "interrupted",
        triggerEvent: "autonomy.queue.thin",
        durationMs: 1000,
        definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
        runDir: ".kota/runs/run-1",
        tags: ["monitored"],
        nested: { paths: ["data/tasks/ready/task.md"] },
      },
    };

    enqueueMatchingWorkflows(
      envelope,
      [workflow("attention-digest"), workflow("improver")],
      (_def, _trigger, run) => enqueued.push(run),
    );

    expect(enqueued).toHaveLength(2);
    expect(enqueued[0]?.payload.tags).toEqual(["monitored"]);
    expect(enqueued[1]?.payload.tags).toEqual(["monitored"]);
    expect(enqueued[0]?.payload.tags).not.toBe(enqueued[1]?.payload.tags);

    const firstNested = enqueued[0]?.payload.nested as { paths: string[] };
    const secondNested = enqueued[1]?.payload.nested as { paths: string[] };
    expect(firstNested.paths).toEqual(["data/tasks/ready/task.md"]);
    expect(secondNested.paths).toEqual(["data/tasks/ready/task.md"]);
    expect(firstNested.paths).not.toBe(secondNested.paths);

    const serialized = safeJsonStringify({ pendingRuns: enqueued }, 2);
    expect(serialized).not.toContain("[Circular]");
  });

  it("rejects circular trigger payloads before they enter the queue", () => {
    const payload: Record<string, unknown> = {
      workflow: "explorer",
      tags: ["monitored"],
    };
    payload.self = payload;

    const envelope: BusEnvelope = {
      type: "workflow.completed",
      payload,
    };

    expect(() =>
      enqueueMatchingWorkflows(
        envelope,
        [workflow("attention-digest")],
        () => {},
      ),
    ).toThrow("Workflow trigger payload cannot contain circular references");
  });
});

describe("workflowUsesAgent", () => {
  function definitionWithStep(step: WorkflowDefinition["steps"][number]): WorkflowDefinition {
    return {
      name: "test",
      enabled: true,
      recoveryCapable: false,
      definitionPath: "test.ts",
      moduleRoot: process.cwd(),
      triggers: [],
      steps: [step],
      tags: [],
    };
  }

  const agentStep = {
    id: "agent",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot: process.cwd(),
    harness: "test-harness",
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
  } satisfies WorkflowDefinition["steps"][number];

  it("detects agent steps nested in foreach", () => {
    expect(
      workflowUsesAgent(
        definitionWithStep({
          id: "loop",
          type: "foreach",
          items: () => [],
          as: "item",
          steps: [agentStep],
        }),
      ),
    ).toBe(true);
  });

  it("detects agent steps nested in branch arms", () => {
    expect(
      workflowUsesAgent(
        definitionWithStep({
          id: "branch",
          type: "branch",
          condition: () => true,
          ifTrue: [],
          ifFalse: [agentStep],
        }),
      ),
    ).toBe(true);
  });

  it("leaves code-only nested steps classified as code workflows", () => {
    expect(
      workflowUsesAgent(
        definitionWithStep({
          id: "loop",
          type: "foreach",
          items: () => [],
          as: "item",
          steps: [{ id: "code", type: "code", run: () => "ok" }],
        }),
      ),
    ).toBe(false);
  });
});
