import { writeFileSync } from "node:fs";
import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  enumerateWorkflowRunMetadata,
  type WorkflowRunMetadataEnumeration,
} from "#core/workflow/run-metadata.js";
import {
  enumerateWorkflowRunMetadataWithDurableAuthority,
} from "#core/workflow/run-operational-projection.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { line, span } from "#modules/rendering/primitives.js";
import { printToStderr, writeStdout } from "#modules/rendering/transport.js";
import {
  requireWorkflowRunDurableAuthority,
  type WorkflowRunDurableAuthority,
} from "./workflow-history.js";

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  triggerEvent: string;
  startedAt: string;
  durationMs: number | null;
  stepCount: number;
  tokenState: "complete" | "partial" | "unknown" | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costState: "complete" | "partial" | "unavailable" | "unknown" | null;
  costUsd: number | null;
};

const CSV_HEADERS: (keyof RunSummary)[] = [
  "id",
  "workflow",
  "status",
  "triggerEvent",
  "startedAt",
  "durationMs",
  "stepCount",
  "tokenState",
  "inputTokens",
  "outputTokens",
  "costState",
  "costUsd",
];

export function loadRunSummaries(
  runsDir: string,
  opts: {
    authority: WorkflowRunDurableAuthority;
    workflow?: string;
    status?: string;
    sinceMs?: number;
    last?: number;
  },
): RunSummary[] {
  const summaries: RunSummary[] = [];
  let enumeration: WorkflowRunMetadataEnumeration;
  if ("authorityCriticalRunIds" in opts.authority) {
    enumeration = enumerateWorkflowRunMetadata(runsDir, {
      authorityCriticalRunIds: opts.authority.authorityCriticalRunIds,
      operationallyActiveRunIds: opts.authority.operationallyActiveRunIds,
      terminalRunIds: opts.authority.terminalRunIds,
    });
  } else {
    enumeration = enumerateWorkflowRunMetadataWithDurableAuthority({
      runsDir,
      stateDir: opts.authority.stateDir,
      scopeRoot: opts.authority.scopeRoot,
    });
  }
  const runs = [...enumeration.runs].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id),
  );
  for (const meta of runs) {
    if (opts.workflow && meta.workflow !== opts.workflow) continue;
    if (opts.status && meta.status !== opts.status) continue;
    if (opts.sinceMs !== undefined && new Date(meta.startedAt).getTime() < opts.sinceMs) continue;
    summaries.push({
      id: meta.id,
      workflow: meta.workflow,
      status: meta.status,
      triggerEvent: meta.trigger?.event ?? "",
      startedAt: meta.startedAt,
      durationMs: meta.durationMs ?? null,
      stepCount: meta.steps?.length ?? 0,
      tokenState: meta.usage?.tokens.state ?? null,
      inputTokens: meta.usage?.tokens.state === "complete" || meta.usage?.tokens.state === "partial"
        ? meta.usage.tokens.inputTokens
        : null,
      outputTokens: meta.usage?.tokens.state === "complete" || meta.usage?.tokens.state === "partial"
        ? meta.usage.tokens.outputTokens
        : null,
      costState: meta.usage?.cost.state ?? null,
      costUsd:
        meta.usage?.cost.state === "complete" ||
        meta.usage?.cost.state === "partial"
          ? meta.usage.cost.usd
          : null,
    });
    if (opts.last !== undefined && summaries.length >= opts.last) break;
  }

  return summaries;
}

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatCsv(summaries: RunSummary[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const row of summaries) {
    lines.push(CSV_HEADERS.map((h) => csvValue(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function registerExportCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("export")
    .description("Export run summaries as JSON or CSV")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("-s, --status <status>", "Filter by run status")
    .option("--since <date>", "Include runs started on or after this date (ISO 8601 or date string)")
    .option("-n, --last <N>", "Limit to the N most recent runs")
    .option("--format <fmt>", "Output format: json (default) or csv", "json")
    .option("-o, --output <file>", "Write output to a file instead of stdout")
    .action(async (opts: { workflow?: string; status?: string; since?: string; last?: string; format: string; output?: string }) => {
      const sinceMs = opts.since ? new Date(opts.since).getTime() : undefined;
      const last = opts.last ? (Number.parseInt(opts.last, 10) || undefined) : undefined;

      if (opts.format !== "json" && opts.format !== "csv") {
        printToStderr(line(span(`Unknown format "${opts.format}". Valid values: json, csv`, "error")));
        process.exit(1);
      }

      if (opts.since && sinceMs !== undefined && Number.isNaN(sinceMs)) {
        printToStderr(line(span(`Invalid --since value: "${opts.since}"`, "error")));
        process.exit(1);
      }

      const store = new WorkflowRunStore(ctx.cwd);
      const status = await ctx.client.workflow.status();
      const authority = requireWorkflowRunDurableAuthority(
        status.authorityCriticalRunIds,
        status.operationallyActiveRunIds,
        status.terminalRunIds,
      );
      const summaries = loadRunSummaries(store.runsDir, {
        authority,
        workflow: opts.workflow,
        status: opts.status,
        sinceMs,
        last,
      });

      const output =
        opts.format === "csv"
          ? formatCsv(summaries)
          : `${JSON.stringify(summaries, null, 2)}\n`;

      if (opts.output) {
        writeFileSync(opts.output, output, "utf-8");
      } else {
        writeStdout(output);
      }
    });
}
