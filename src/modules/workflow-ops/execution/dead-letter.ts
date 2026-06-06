import { writeFileSync } from "node:fs";
import type { Command } from "commander";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";

type ListOptions = {
  status?: string;
  type?: string;
  workflow?: string;
  limit: string;
  json?: boolean;
};

type JsonOption = {
  json?: boolean;
};

type ReasonOption = {
  reason: string;
};

type RedriveOptions = ReasonOption & {
  simulation?: boolean;
  json?: boolean;
};

type ExportOptions = {
  out?: string;
};

const STATUSES = ["open", "dismissed", "redriven"] as const;
const TYPES = [
  "event-envelope",
  "batch-envelope",
  "workflow-dispatch",
  "confirmed-action-dispatch",
] as const;

function parseLimit(value: string): number {
  const limit = Number.parseInt(value, 10);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20;
}

function parseStatus(value: string | undefined): (typeof STATUSES)[number] | undefined {
  if (value === undefined) return undefined;
  if ((STATUSES as readonly string[]).includes(value)) {
    return value as (typeof STATUSES)[number];
  }
  console.error(`Unknown DLQ status "${value}". Valid: ${STATUSES.join(", ")}`);
  process.exit(1);
}

function parseType(value: string | undefined): (typeof TYPES)[number] | undefined {
  if (value === undefined) return undefined;
  if ((TYPES as readonly string[]).includes(value)) {
    return value as (typeof TYPES)[number];
  }
  console.error(`Unknown DLQ type "${value}". Valid: ${TYPES.join(", ")}`);
  process.exit(1);
}

function workflowLabel(item: DeadLetterItem): string {
  return item.affectedWorkflowNames.length > 0
    ? item.affectedWorkflowNames.join(",")
    : "(none)";
}

function printItemSummary(item: DeadLetterItem): void {
  console.log(`${item.id}`);
  console.log(`  type:      ${item.type}`);
  console.log(`  status:    ${item.status}`);
  console.log(`  scope:     ${item.scopeId}`);
  console.log(`  workflow:  ${workflowLabel(item)}`);
  console.log(`  reason:    ${item.failure.reason}`);
  console.log(`  error:     ${item.failure.lastErrorClass}`);
  console.log(`  failed:    ${item.failure.firstFailedAt}`);
  console.log(`  source:    ${item.source.kind}`);
  if (item.sourceEventIds.length > 0) {
    console.log(`  events:    ${item.sourceEventIds.join(",")}`);
  }
}

function printItemDetail(item: DeadLetterItem): void {
  printItemSummary(item);
  console.log("  projection:");
  for (const [key, value] of Object.entries(item.redactedProjection)) {
    console.log(`    ${key}: ${JSON.stringify(value)}`);
  }
  if (item.redriveAttempts.length > 0) {
    console.log("  redrive attempts:");
    for (const attempt of item.redriveAttempts) {
      console.log(
        `    ${attempt.attemptedAt} ${attempt.target} ${attempt.result.status}`,
      );
    }
  }
}

export function registerDeadLetterCommand(wfCmd: Command, ctx: ModuleContext): void {
  const dlq = wfCmd
    .command("dlq")
    .alias("dead-letter")
    .description("Inspect and control workflow dead-letter queue items");

  dlq
    .command("list")
    .description("List dead-letter queue items")
    .option("--status <status>", "Filter by status: open, dismissed, redriven")
    .option("--type <type>", "Filter by DLQ item type")
    .option("--workflow <name>", "Filter by affected workflow name")
    .option("--limit <n>", "Maximum items to show", "20")
    .option("--json", "Print JSON")
    .action(async (opts: ListOptions) => {
      const result = await ctx.client.workflow.listDeadLetters({
        status: parseStatus(opts.status),
        type: parseType(opts.type),
        workflow: opts.workflow,
        limit: parseLimit(opts.limit),
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      console.log(
        `Dead letters: open=${result.counts.open} dismissed=${result.counts.dismissed} redriven=${result.counts.redriven}`,
      );
      if (result.items.length === 0) {
        console.log("No dead-letter items found.");
        return;
      }
      for (const item of result.items) {
        console.log(
          `${item.id}  ${item.status.padEnd(9)} ${item.type.padEnd(27)} ${workflowLabel(item).padEnd(24)} ${item.failure.lastErrorClass}  ${item.failure.reason}`,
        );
      }
    });

  dlq
    .command("show <id>")
    .description("Show one dead-letter queue item")
    .option("--json", "Print JSON")
    .action(async (id: string, opts: JsonOption) => {
      const result = await ctx.client.workflow.getDeadLetter(id);
      if (!result.found) {
        console.error(`Dead-letter item "${id}" not found.`);
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.item, null, 2)}\n`);
        return;
      }
      printItemDetail(result.item);
    });

  dlq
    .command("dismiss <id>")
    .description("Dismiss a dead-letter queue item")
    .requiredOption("--reason <reason>", "Dismissal reason")
    .action(async (id: string, opts: ReasonOption) => {
      const result = await ctx.client.workflow.dismissDeadLetter(id, opts.reason);
      if (!result.ok) {
        console.error(`Dead-letter item "${id}" not found.`);
        process.exit(1);
      }
      console.log(`Dismissed dead-letter item ${id}.`);
    });

  dlq
    .command("redrive <id>")
    .description("Redrive a dead-letter item")
    .requiredOption("--reason <reason>", "Redrive reason")
    .option("--simulation", "Record a simulation redrive without dispatching")
    .option("--json", "Print JSON")
    .action(async (id: string, opts: RedriveOptions) => {
      const result = await ctx.client.workflow.redriveDeadLetter(id, {
        reason: opts.reason,
        target: opts.simulation ? "simulation" : "original",
      });
      if (!result.ok) {
        const message =
          result.reason === "unknown_workflow"
            ? "redrive workflow is not available"
            : result.reason === "not_redrivable"
              ? "item is not redrivable"
              : "item was not found";
        console.error(`Cannot redrive ${id}: ${message}.`);
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      if (result.runId !== undefined) {
        console.log(
          `Redriven dead-letter item ${id}; queued ${result.workflowName} as ${result.runId}.`,
        );
      } else if (result.event !== undefined) {
        console.log(`Redriven dead-letter item ${id}; emitted ${result.event}.`);
      } else {
        console.log(`Simulated redrive for dead-letter item ${id}.`);
      }
    });

  dlq
    .command("export <id>")
    .description("Export dead-letter diagnostics")
    .option("--out <path>", "Write diagnostics JSON to a file")
    .action(async (id: string, opts: ExportOptions) => {
      const diagnostics = await ctx.client.workflow.exportDeadLetterDiagnostics(id);
      if (diagnostics === null) {
        console.error(`Dead-letter item "${id}" not found.`);
        process.exit(1);
      }
      const serialized = `${JSON.stringify(diagnostics, null, 2)}\n`;
      if (opts.out !== undefined) {
        writeFileSync(opts.out, serialized, "utf-8");
        console.log(`Exported dead-letter diagnostics to ${opts.out}.`);
        return;
      }
      process.stdout.write(serialized);
    });
}
