import { describe, expect, it } from "vitest";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { assembleWorkflowGraph } from "./assemble.js";

function makeDef(
  overrides: Partial<RegisteredWorkflowDefinitionInput> &
    Pick<RegisteredWorkflowDefinitionInput, "name">,
): RegisteredWorkflowDefinitionInput {
  return {
    definitionPath: `src/modules/test/workflows/${overrides.name}/workflow.ts`,
    triggers: [{ event: "runtime.idle" }],
    steps: [],
    ...overrides,
  };
}

describe("assembleWorkflowGraph", () => {
  it("returns empty graph for no definitions", () => {
    const graph = assembleWorkflowGraph([]);
    expect(graph.workflows).toHaveLength(0);
    expect(graph.events).toHaveLength(0);
    expect(graph.agents).toHaveLength(0);
  });

  it("builds workflow nodes with metadata", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "builder",
        description: "Builds things",
        enabled: true,
        tags: ["monitored"],
      }),
    ]);
    expect(graph.workflows).toHaveLength(1);
    const wf = graph.workflows[0];
    expect(wf.name).toBe("builder");
    expect(wf.description).toBe("Builds things");
    expect(wf.enabled).toBe(true);
    expect(wf.tags).toEqual(["monitored"]);
  });

  it("defaults enabled to true when omitted", () => {
    const graph = assembleWorkflowGraph([makeDef({ name: "test" })]);
    expect(graph.workflows[0].enabled).toBe(true);
  });

  it("respects enabled: false", () => {
    const graph = assembleWorkflowGraph([
      makeDef({ name: "test", enabled: false }),
    ]);
    expect(graph.workflows[0].enabled).toBe(false);
  });

  it("extracts trigger summaries from event triggers", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "test",
        triggers: [
          { event: "autonomy.queue.available", cooldownMs: 5000 },
        ],
      }),
    ]);
    const wf = graph.workflows[0];
    expect(wf.triggers).toHaveLength(1);
    expect(wf.triggers[0].event).toBe("autonomy.queue.available");
    expect(wf.triggers[0].cooldownMs).toBe(5000);
    expect(wf.listensTo).toEqual([
      { event: "autonomy.queue.available", filter: undefined },
    ]);
  });

  it("extracts trigger summaries from schedule triggers", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "cron-job",
        triggers: [{ event: "schedule", schedule: "0 9 * * *" }],
      }),
    ]);
    const wf = graph.workflows[0];
    expect(wf.triggers[0].event).toBe("schedule(0 9 * * *)");
    expect(wf.triggers[0].schedule).toBe("0 9 * * *");
  });

  it("extracts trigger summaries from watch triggers", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "watcher",
        triggers: [{ event: "files.changed", watch: ["src/**/*.ts"] }],
      }),
    ]);
    const wf = graph.workflows[0];
    expect(wf.triggers[0].event).toBe("files.changed");
    expect(wf.triggers[0].watch).toEqual(["src/**/*.ts"]);
  });

  it("extracts trigger summaries from interval triggers", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "poller",
        triggers: [{ event: "interval", intervalMs: 60_000 }],
      }),
    ]);
    const wf = graph.workflows[0];
    expect(wf.triggers[0].event).toBe("interval(60000ms)");
    expect(wf.triggers[0].intervalMs).toBe(60_000);
  });

  it("includes trigger filter in summary", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "filtered",
        triggers: [
          { event: "workflow.completed", filter: { workflowName: "builder" } },
        ],
      }),
    ]);
    const wf = graph.workflows[0];
    expect(wf.triggers[0].filter).toBe('workflowName="builder"');
    expect(wf.listensTo[0].filter).toBe('workflowName="builder"');
  });

  it("collects emitted events from emit steps", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "emitter",
        steps: [
          { type: "emit", id: "notify", event: "workflow.build.committed" },
          { type: "emit", id: "alert", event: "workflow.failure.alert" },
        ],
      }),
    ]);
    const wf = graph.workflows[0];
    expect(wf.emits).toEqual(["workflow.build.committed", "workflow.failure.alert"]);
  });

  it("deduplicates emitted events", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "emitter",
        steps: [
          { type: "emit", id: "a", event: "same.event" },
          { type: "emit", id: "b", event: "same.event" },
        ],
      }),
    ]);
    expect(graph.workflows[0].emits).toEqual(["same.event"]);
  });

  it("collects emitted events from branch steps", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "brancher",
        steps: [
          {
            type: "branch",
            id: "check",
            condition: () => true,
            ifTrue: [{ type: "emit", id: "yes", event: "branch.true" }],
            ifFalse: [{ type: "emit", id: "no", event: "branch.false" }],
          },
        ],
      }),
    ]);
    expect(graph.workflows[0].emits).toContain("branch.true");
    expect(graph.workflows[0].emits).toContain("branch.false");
  });

  it("collects direct workflow triggers from trigger steps", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "orchestrator",
        steps: [
          { type: "trigger", id: "kick", workflow: "builder" },
        ],
      }),
    ]);
    expect(graph.workflows[0].directTriggers).toEqual(["builder"]);
  });

  it("collects agent names from agent steps", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "builder",
        steps: [
          {
            type: "agent",
            id: "build",
            agentName: "builder",
            model: "claude-opus-4-7",
            effort: "xhigh",
          },
        ],
      }),
    ]);
    expect(graph.workflows[0].agents).toEqual(["builder"]);
    expect(graph.agents).toEqual(["builder"]);
  });

  it("collects agents from parallel steps", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "parallel-wf",
        steps: [
          {
            type: "parallel",
            id: "group",
            steps: [
              { type: "agent", id: "a", agentName: "alpha", model: "m", effort: "xhigh" },
              { type: "agent", id: "b", agentName: "beta", model: "m", effort: "xhigh" },
            ],
          },
        ],
      }),
    ]);
    expect(graph.workflows[0].agents).toEqual(["alpha", "beta"]);
  });

  it("summarizes step types and agent details", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "multi-step",
        steps: [
          { type: "code", id: "init", run: () => {} },
          {
            type: "agent",
            id: "build",
            agentName: "builder",
            model: "opus",
            effort: "xhigh",
          },
          { type: "emit", id: "done", event: "complete" },
        ],
      }),
    ]);
    const steps = graph.workflows[0].steps;
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ id: "init", type: "code" });
    expect(steps[1]).toMatchObject({
      id: "build",
      type: "agent",
      agentName: "builder",
      model: "opus",
    });
    expect(steps[2]).toMatchObject({
      id: "done",
      type: "emit",
      event: "complete",
    });
  });

  it("marks steps with when predicates as conditional", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "conditional",
        steps: [
          { type: "code", id: "always", run: () => {} },
          { type: "code", id: "maybe", run: () => {}, when: () => true },
        ],
      }),
    ]);
    const steps = graph.workflows[0].steps;
    expect(steps[0].hasCondition).toBe(false);
    expect(steps[1].hasCondition).toBe(true);
  });

  it("builds event nodes linking producers to consumers", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "dispatcher",
        triggers: [{ event: "runtime.idle" }],
        steps: [
          { type: "emit", id: "e1", event: "autonomy.queue.available" },
        ],
      }),
      makeDef({
        name: "builder",
        triggers: [{ event: "autonomy.queue.available" }],
        steps: [],
      }),
    ]);

    const queueEvent = graph.events.find(
      (e) => e.name === "autonomy.queue.available",
    );
    expect(queueEvent).toBeDefined();
    expect(queueEvent!.producers).toEqual(["dispatcher"]);
    expect(queueEvent!.consumers).toEqual(["builder"]);
  });

  it("shows external events with no producers", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "listener",
        triggers: [{ event: "external.webhook" }],
        steps: [],
      }),
    ]);

    const event = graph.events.find((e) => e.name === "external.webhook");
    expect(event).toBeDefined();
    expect(event!.producers).toEqual([]);
    expect(event!.consumers).toEqual(["listener"]);
  });

  it("excludes schedule/interval from event nodes", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "cron-job",
        triggers: [{ event: "schedule", schedule: "0 9 * * *" }],
        steps: [],
      }),
    ]);
    expect(graph.events).toHaveLength(0);
  });

  it("aggregates agents across multiple workflows", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "wf1",
        steps: [
          { type: "agent", id: "a", agentName: "builder", model: "m", effort: "xhigh" },
        ],
      }),
      makeDef({
        name: "wf2",
        steps: [
          { type: "agent", id: "b", agentName: "explorer", model: "m", effort: "xhigh" },
          { type: "agent", id: "c", agentName: "builder", model: "m", effort: "xhigh" },
        ],
      }),
    ]);
    expect(graph.agents).toEqual(["builder", "explorer"]);
  });

  it("handles parallel step children in summary", () => {
    const graph = assembleWorkflowGraph([
      makeDef({
        name: "par",
        steps: [
          {
            type: "parallel",
            id: "group",
            steps: [
              { type: "code", id: "x", run: () => {} },
              { type: "agent", id: "y", agentName: "a", model: "m", effort: "xhigh" },
            ],
          },
        ],
      }),
    ]);
    const step = graph.workflows[0].steps[0];
    expect(step.type).toBe("parallel");
    expect(step.children).toHaveLength(2);
    expect(step.children![0].id).toBe("x");
    expect(step.children![1].agentName).toBe("a");
  });
});
