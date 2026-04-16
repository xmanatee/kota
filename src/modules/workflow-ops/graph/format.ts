/**
 * Formatters for rendering a WorkflowGraph to text.
 *
 * Each formatter is a pure function: graph in, string out.
 */

import { formatDuration } from "../utils.js";
import type { StepSummary, WorkflowGraph, WorkflowNode } from "./types.js";

function formatStepLine(step: StepSummary, indent: string): string[] {
  const lines: string[] = [];
  const extras: string[] = [];
  const cond = step.hasCondition ? " (conditional)" : "";

  switch (step.type) {
    case "agent":
      if (step.agentName) extras.push(step.agentName);
      if (step.model) extras.push(step.model);
      break;
    case "tool":
      if (step.tool) extras.push(step.tool);
      break;
    case "emit":
      if (step.event) extras.push(`→ ${step.event}`);
      break;
    case "trigger":
      if (step.targetWorkflow) extras.push(`→ ${step.targetWorkflow}`);
      break;
  }

  const detail = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  lines.push(`${indent}[${step.type}] ${step.id}${detail}${cond}`);

  if (step.children) {
    for (const child of step.children) {
      lines.push(...formatStepLine(child, `${indent}  `));
    }
  }

  return lines;
}

function formatWorkflowBlock(wf: WorkflowNode, graph: WorkflowGraph): string[] {
  const lines: string[] = [];
  const enabled = wf.enabled ? "" : " (disabled)";
  lines.push(`${wf.name}${enabled}`);
  lines.push("─".repeat(wf.name.length + enabled.length));

  if (wf.description) {
    lines.push(`  ${wf.description}`);
  }

  // Triggers
  lines.push("  listens to:");
  if (wf.listensTo.length === 0) {
    lines.push("    (none)");
  } else {
    for (const t of wf.triggers) {
      const parts: string[] = [];
      if (t.schedule) {
        parts.push(`cron: ${t.schedule}`);
      } else if (t.intervalMs) {
        parts.push(`interval: ${formatDuration(t.intervalMs)}`);
      } else if (t.watch) {
        parts.push(`watch: ${t.watch.join(", ")}`);
      } else if (t.webhook) {
        parts.push(`webhook: ${t.event}`);
      } else {
        parts.push(t.event);
      }
      if (t.filter) parts.push(`[${t.filter}]`);
      if (t.cooldownMs) parts.push(`cooldown=${formatDuration(t.cooldownMs)}`);
      lines.push(`    ${parts.join(" ")}`);
    }
  }

  // Emits
  if (wf.emits.length > 0) {
    lines.push("  emits:");
    for (const e of wf.emits) {
      const downstream = graph.events.find((ev) => ev.name === e);
      const arrow = downstream && downstream.consumers.length > 0
        ? ` → ${downstream.consumers.join(", ")}`
        : "";
      lines.push(`    ${e}${arrow}`);
    }
  }

  // Direct triggers
  if (wf.directTriggers.length > 0) {
    lines.push("  triggers:");
    for (const t of wf.directTriggers) {
      lines.push(`    ${t}`);
    }
  }

  // Agents
  if (wf.agents.length > 0) {
    lines.push(`  agents: ${wf.agents.join(", ")}`);
  }

  // Steps
  lines.push(`  steps (${wf.steps.length}):`);
  for (const step of wf.steps) {
    lines.push(...formatStepLine(step, "    "));
  }

  // Budget info
  const budget: string[] = [];
  if (wf.dailyBudgetUsd != null) budget.push(`$${wf.dailyBudgetUsd}/day`);
  if (wf.costLimitUsd != null) budget.push(`$${wf.costLimitUsd}/run`);
  if (budget.length > 0) {
    lines.push(`  budget: ${budget.join(", ")}`);
  }

  return lines;
}

export function formatTable(graph: WorkflowGraph): string {
  const lines: string[] = [];

  lines.push("Workflow Graph");
  lines.push("=".repeat(60));
  lines.push("");

  for (const wf of graph.workflows) {
    lines.push(...formatWorkflowBlock(wf, graph));
    lines.push("");
  }

  // Event chain summary
  if (graph.events.length > 0) {
    lines.push("Event Chain");
    lines.push("─".repeat(40));
    for (const event of graph.events) {
      const from = event.producers.length > 0 ? event.producers.join(", ") : "(external)";
      const to = event.consumers.length > 0 ? event.consumers.join(", ") : "(none)";
      lines.push(`  ${event.name}`);
      lines.push(`    ${from} → ${to}`);
    }
    lines.push("");
  }

  // Agent summary
  if (graph.agents.length > 0) {
    lines.push("Agents");
    lines.push("─".repeat(40));
    for (const agent of graph.agents) {
      const usedBy = graph.workflows
        .filter((w) => w.agents.includes(agent))
        .map((w) => w.name);
      lines.push(`  ${agent} — used by: ${usedBy.join(", ")}`);
    }
    lines.push("");
  }

  lines.push(`${graph.workflows.length} workflow(s), ${graph.events.length} event(s), ${graph.agents.length} agent(s).`);

  return lines.join("\n");
}

export function formatDot(graph: WorkflowGraph): string {
  const lines: string[] = [];
  lines.push("digraph workflows {");
  lines.push("  rankdir=LR;");
  lines.push('  node [shape=box, style=filled, fillcolor="#e8e8e8"];');
  lines.push('  edge [color="#555555"];');
  lines.push("");

  // Workflow nodes
  for (const wf of graph.workflows) {
    const color = wf.enabled ? "#b3d9ff" : "#cccccc";
    const label = wf.agents.length > 0
      ? `${wf.name}\\n[${wf.agents.join(", ")}]`
      : wf.name;
    lines.push(`  "${wf.name}" [label="${label}", fillcolor="${color}"];`);
  }
  lines.push("");

  // Event nodes (diamonds)
  for (const event of graph.events) {
    lines.push(
      `  "${event.name}" [shape=diamond, fillcolor="#ffe0b3", fontsize=10];`,
    );
  }
  lines.push("");

  // Schedule/interval nodes (ovals)
  for (const wf of graph.workflows) {
    for (const t of wf.listensTo) {
      if (t.event.startsWith("schedule(") || t.event.startsWith("interval(")) {
        lines.push(
          `  "${t.event}" [shape=oval, fillcolor="#d4edda", fontsize=10];`,
        );
        lines.push(`  "${t.event}" -> "${wf.name}";`);
      }
    }
  }
  lines.push("");

  // Edges: event → workflow (listens)
  for (const wf of graph.workflows) {
    for (const t of wf.listensTo) {
      if (t.event.startsWith("schedule(") || t.event.startsWith("interval(")) {
        continue; // already handled above
      }
      const label = t.filter ? ` [label="[${t.filter}]", fontsize=8]` : "";
      lines.push(`  "${t.event}" -> "${wf.name}"${label};`);
    }
  }
  lines.push("");

  // Edges: workflow → event (emits)
  for (const wf of graph.workflows) {
    for (const e of wf.emits) {
      lines.push(`  "${wf.name}" -> "${e}";`);
    }
  }
  lines.push("");

  // Edges: workflow → workflow (direct triggers)
  for (const wf of graph.workflows) {
    for (const t of wf.directTriggers) {
      lines.push(
        `  "${wf.name}" -> "${t}" [style=dashed, label="trigger"];`,
      );
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Compact overview: one row per workflow with trigger/emit/agent columns.
 * Useful for quick orientation without the full detail of formatTable.
 */
export function formatCompact(graph: WorkflowGraph): string {
  const lines: string[] = [];

  const nameW = Math.max(...graph.workflows.map((w) => w.name.length), 8);
  const agentW = Math.max(
    ...graph.workflows.map((w) => (w.agents.length > 0 ? w.agents.join(",").length : 1)),
    6,
  );

  lines.push(
    `${"Name".padEnd(nameW)}  ${"Agents".padEnd(agentW)}  ${"Steps".padEnd(5)}  Triggers → Emits`,
  );
  lines.push("-".repeat(nameW + agentW + 40));

  for (const wf of graph.workflows) {
    const name = wf.name.padEnd(nameW);
    const agents = (wf.agents.length > 0 ? wf.agents.join(",") : "-").padEnd(agentW);
    const steps = String(wf.steps.length).padEnd(5);
    const triggerStr = wf.triggers
      .map((t) => {
        if (t.schedule) return `cron(${t.schedule})`;
        if (t.intervalMs) return `interval(${formatDuration(t.intervalMs)})`;
        if (t.watch) return `watch(${t.watch.join(",")})`;
        return t.event;
      })
      .join(" | ");
    const emitStr = wf.emits.length > 0 ? ` → ${wf.emits.join(", ")}` : "";
    lines.push(`${name}  ${agents}  ${steps}  ${triggerStr}${emitStr}`);
  }

  lines.push("");
  lines.push(
    `${graph.workflows.length} workflow(s), ${graph.events.length} event(s), ${graph.agents.length} agent(s).`,
  );

  return lines.join("\n");
}
