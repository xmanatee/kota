import type { Command } from "commander";
import type { ModuleContext } from "../../core/modules/module-types.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowStepInput,
  WorkflowTriggerInput,
} from "../../core/workflow/types.js";
import { getWorkflowDefinitions } from "./definitions-source.js";

type WorkflowNode = {
  name: string;
  listensTo: { event: string; filter?: string }[];
  emits: string[];
  triggers: string[];
};

function describeTriggerFilter(t: WorkflowTriggerInput): string | undefined {
  if (!t.filter || Object.keys(t.filter).length === 0) return undefined;
  return Object.entries(t.filter)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(",");
}

function collectEmittedEvents(steps: WorkflowStepInput[]): {
  emits: string[];
  triggers: string[];
} {
  const emits: string[] = [];
  const triggers: string[] = [];
  for (const step of steps) {
    if (step.type === "emit") {
      emits.push(step.event);
    } else if (step.type === "trigger") {
      triggers.push(step.workflow);
    } else if (step.type === "branch") {
      const ifTrue = collectEmittedEvents(step.ifTrue);
      emits.push(...ifTrue.emits);
      triggers.push(...ifTrue.triggers);
      if (step.ifFalse) {
        const ifFalse = collectEmittedEvents(step.ifFalse);
        emits.push(...ifFalse.emits);
        triggers.push(...ifFalse.triggers);
      }
    }
    // parallel and foreach inner steps cannot contain emit/trigger steps per type constraints
  }
  return { emits: [...new Set(emits)], triggers: [...new Set(triggers)] };
}

function buildGraph(
  definitions: RegisteredWorkflowDefinitionInput[],
): WorkflowNode[] {
  return definitions.map((def) => {
    const listensTo = def.triggers.map((t) => {
      let event: string;
      if (t.watch) event = "files.changed";
      else if (t.schedule) event = `schedule(${t.schedule})`;
      else if (t.intervalMs) event = `interval(${t.intervalMs}ms)`;
      else event = t.event ?? "?";
      return { event, filter: describeTriggerFilter(t) };
    });
    const { emits, triggers } = collectEmittedEvents(def.steps);
    return { name: def.name, listensTo, emits, triggers };
  });
}

function formatTable(nodes: WorkflowNode[]): string {
  const lines: string[] = [];

  // Build event-to-consumer map for showing the chain
  const eventConsumers = new Map<string, string[]>();
  for (const node of nodes) {
    for (const t of node.listensTo) {
      const consumers = eventConsumers.get(t.event) ?? [];
      consumers.push(node.name);
      eventConsumers.set(t.event, consumers);
    }
  }

  lines.push("Workflow Dependency Graph");
  lines.push("=".repeat(60));
  lines.push("");

  for (const node of nodes) {
    lines.push(`${node.name}`);
    lines.push(`${"─".repeat(node.name.length)}`);

    // Listens to
    lines.push("  listens to:");
    if (node.listensTo.length === 0) {
      lines.push("    (none)");
    } else {
      for (const t of node.listensTo) {
        const filter = t.filter ? ` [${t.filter}]` : "";
        lines.push(`    ${t.event}${filter}`);
      }
    }

    // Emits
    if (node.emits.length > 0) {
      lines.push("  emits:");
      for (const e of node.emits) {
        const downstream = eventConsumers.get(e);
        const arrow = downstream ? ` → ${downstream.join(", ")}` : "";
        lines.push(`    ${e}${arrow}`);
      }
    }

    // Triggers (direct workflow invocations)
    if (node.triggers.length > 0) {
      lines.push("  triggers:");
      for (const t of node.triggers) {
        lines.push(`    ${t}`);
      }
    }

    lines.push("");
  }

  // Event chain summary
  const allEvents = new Set<string>();
  for (const node of nodes) {
    for (const e of node.emits) allEvents.add(e);
    for (const t of node.listensTo) {
      if (!t.event.startsWith("schedule(") && !t.event.startsWith("interval(")) {
        allEvents.add(t.event);
      }
    }
  }

  if (allEvents.size > 0) {
    lines.push("Event Chain");
    lines.push("─".repeat(40));
    for (const event of [...allEvents].sort()) {
      const producers = nodes
        .filter((n) => n.emits.includes(event))
        .map((n) => n.name);
      const consumers = eventConsumers.get(event) ?? [];
      const from = producers.length > 0 ? producers.join(", ") : "(external)";
      const to = consumers.length > 0 ? consumers.join(", ") : "(none)";
      lines.push(`  ${event}`);
      lines.push(`    ${from} → ${to}`);
    }
  }

  return lines.join("\n");
}

function formatDot(nodes: WorkflowNode[]): string {
  const lines: string[] = [];
  lines.push("digraph workflows {");
  lines.push("  rankdir=LR;");
  lines.push('  node [shape=box, style=filled, fillcolor="#e8e8e8"];');
  lines.push('  edge [color="#555555"];');
  lines.push("");

  // Workflow nodes
  for (const node of nodes) {
    lines.push(`  "${node.name}" [fillcolor="#b3d9ff"];`);
  }
  lines.push("");

  // Event nodes (diamonds)
  const allEvents = new Set<string>();
  for (const node of nodes) {
    for (const e of node.emits) allEvents.add(e);
    for (const t of node.listensTo) {
      if (!t.event.startsWith("schedule(") && !t.event.startsWith("interval(")) {
        allEvents.add(t.event);
      }
    }
  }
  for (const event of allEvents) {
    lines.push(`  "${event}" [shape=diamond, fillcolor="#ffe0b3", fontsize=10];`);
  }
  lines.push("");

  // Edges: event → workflow (listens)
  for (const node of nodes) {
    for (const t of node.listensTo) {
      if (t.event.startsWith("schedule(") || t.event.startsWith("interval(")) {
        lines.push(`  "${t.event}" [shape=oval, fillcolor="#d4edda", fontsize=10];`);
        lines.push(`  "${t.event}" -> "${node.name}";`);
      } else {
        const label = t.filter ? ` [label="[${t.filter}]", fontsize=8]` : "";
        lines.push(`  "${t.event}" -> "${node.name}"${label};`);
      }
    }
  }
  lines.push("");

  // Edges: workflow → event (emits)
  for (const node of nodes) {
    for (const e of node.emits) {
      lines.push(`  "${node.name}" -> "${e}";`);
    }
  }
  lines.push("");

  // Edges: workflow → workflow (direct triggers)
  for (const node of nodes) {
    for (const t of node.triggers) {
      lines.push(`  "${node.name}" -> "${t}" [style=dashed, label="trigger"];`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

export function registerDepsCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("deps")
    .description(
      "Show workflow trigger dependency graph — which events trigger which workflows and what they emit",
    )
    .option(
      "--format <format>",
      "Output format: table (default) or dot (Graphviz DOT)",
      "table",
    )
    .action((opts: { format: string }) => {
      const definitions = getWorkflowDefinitions(ctx);
      if (definitions.length === 0) {
        console.log("No workflow definitions loaded.");
        return;
      }

      const nodes = buildGraph(definitions);

      if (opts.format === "dot") {
        console.log(formatDot(nodes));
      } else if (opts.format === "table") {
        console.log(formatTable(nodes));
      } else {
        console.error(`Unknown format "${opts.format}". Use "table" or "dot".`);
        process.exit(1);
      }
    });
}
