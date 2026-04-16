/**
 * Assembles a WorkflowGraph from workflow definitions.
 *
 * Pure function — no side effects, no I/O. Takes definitions in, returns
 * a graph out. This makes it testable and reusable by any consumer.
 */

import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowStepInput,
  WorkflowTriggerInput,
} from "#core/workflow/types.js";
import type {
  EventNode,
  StepSummary,
  TriggerSummary,
  WorkflowGraph,
  WorkflowNode,
} from "./types.js";

function summarizeTrigger(t: WorkflowTriggerInput): TriggerSummary {
  const summary: TriggerSummary = { event: triggerEventName(t) };
  if (t.filter && Object.keys(t.filter).length > 0) {
    summary.filter = Object.entries(t.filter)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(",");
  }
  if (t.schedule) summary.schedule = t.schedule;
  if (t.intervalMs) summary.intervalMs = t.intervalMs;
  if (t.watch) summary.watch = Array.isArray(t.watch) ? t.watch : [t.watch];
  if (t.cooldownMs) summary.cooldownMs = t.cooldownMs;
  if (t.webhook) summary.webhook = t.webhook;
  return summary;
}

function triggerEventName(t: WorkflowTriggerInput): string {
  if (t.watch) return "files.changed";
  if (t.schedule) return `schedule(${t.schedule})`;
  if (t.intervalMs) return `interval(${t.intervalMs}ms)`;
  return t.event ?? "?";
}

function summarizeStep(step: WorkflowStepInput): StepSummary {
  const base: StepSummary = {
    id: step.type === "parallel" ? step.id : step.id,
    type: step.type,
    hasCondition: step.type === "parallel"
      ? step.when != null
      : step.when != null,
  };

  switch (step.type) {
    case "agent":
      if (step.agentName) base.agentName = step.agentName;
      base.model = step.model;
      break;
    case "tool":
      base.tool = step.tool;
      break;
    case "emit":
      base.event = step.event;
      break;
    case "trigger":
      base.targetWorkflow = step.workflow;
      break;
    case "parallel":
      base.children = step.steps.map(summarizeStep);
      break;
    case "branch":
      base.children = [
        ...step.ifTrue.map(summarizeStep),
        ...(step.ifFalse ?? []).map(summarizeStep),
      ];
      break;
    case "foreach":
      base.children = step.steps.map(summarizeStep);
      break;
  }

  return base;
}

function collectEmittedEvents(steps: WorkflowStepInput[]): {
  emits: string[];
  directTriggers: string[];
} {
  const emits = new Set<string>();
  const directTriggers = new Set<string>();

  function walk(items: WorkflowStepInput[]): void {
    for (const step of items) {
      if (step.type === "emit") {
        emits.add(step.event);
      } else if (step.type === "trigger") {
        directTriggers.add(step.workflow);
      } else if (step.type === "branch") {
        walk(step.ifTrue);
        if (step.ifFalse) walk(step.ifFalse);
      }
      // parallel and foreach inner steps cannot contain emit/trigger
    }
  }

  walk(steps);
  return { emits: [...emits], directTriggers: [...directTriggers] };
}

function collectAgents(steps: WorkflowStepInput[]): string[] {
  const agents = new Set<string>();

  function walk(items: WorkflowStepInput[]): void {
    for (const step of items) {
      if (step.type === "agent" && step.agentName) {
        agents.add(step.agentName);
      } else if (step.type === "parallel" || step.type === "foreach") {
        walk(step.steps);
      } else if (step.type === "branch") {
        walk(step.ifTrue);
        if (step.ifFalse) walk(step.ifFalse);
      }
    }
  }

  walk(steps);
  return [...agents];
}

function buildWorkflowNode(
  def: RegisteredWorkflowDefinitionInput,
): WorkflowNode {
  const triggers = def.triggers.map(summarizeTrigger);
  const listensTo = def.triggers.map((t) => {
    const event = triggerEventName(t);
    const filter =
      t.filter && Object.keys(t.filter).length > 0
        ? Object.entries(t.filter)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(",")
        : undefined;
    return { event, filter };
  });
  const { emits, directTriggers } = collectEmittedEvents(def.steps);
  const agents = collectAgents(def.steps);
  const steps = def.steps.map(summarizeStep);

  return {
    name: def.name,
    description: def.description,
    enabled: def.enabled !== false,
    tags: def.tags ?? [],
    dailyBudgetUsd: def.dailyBudgetUsd,
    costLimitUsd: def.costLimitUsd,
    concurrencyGroup: def.concurrencyGroup,
    triggers,
    steps,
    listensTo,
    emits,
    directTriggers,
    agents,
  };
}

function buildEventNodes(workflows: WorkflowNode[]): EventNode[] {
  const eventMap = new Map<string, { producers: Set<string>; consumers: Set<string> }>();

  function getOrCreate(event: string) {
    let entry = eventMap.get(event);
    if (!entry) {
      entry = { producers: new Set(), consumers: new Set() };
      eventMap.set(event, entry);
    }
    return entry;
  }

  for (const wf of workflows) {
    for (const e of wf.emits) {
      getOrCreate(e).producers.add(wf.name);
    }
    for (const t of wf.listensTo) {
      if (!t.event.startsWith("schedule(") && !t.event.startsWith("interval(")) {
        getOrCreate(t.event).consumers.add(wf.name);
      }
    }
  }

  return [...eventMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { producers, consumers }]) => ({
      name,
      producers: [...producers].sort(),
      consumers: [...consumers].sort(),
    }));
}

export function assembleWorkflowGraph(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
): WorkflowGraph {
  const workflows = definitions.map(buildWorkflowNode);
  const events = buildEventNodes(workflows);
  const agents = [
    ...new Set(workflows.flatMap((w) => w.agents)),
  ].sort();

  return { workflows, events, agents };
}
