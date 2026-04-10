import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { readOptionalJsonFile } from "#root/json-file.js";

export type RunSummary = {
  id: string;
  workflow: string;
  status: string;
  triggerEvent: string;
  startedAt: string;
  durationMs: number | null;
  stepCount: number;
  totalCostUsd: number | null;
};

const CSV_HEADERS: (keyof RunSummary)[] = [
  "id",
  "workflow",
  "status",
  "triggerEvent",
  "startedAt",
  "durationMs",
  "stepCount",
  "totalCostUsd",
];

export function loadRunSummaries(
  runsDir: string,
  opts: {
    workflow?: string;
    status?: string;
    sinceMs?: number;
    last?: number;
  },
): RunSummary[] {
  let dirs: string[];
  try {
    dirs = readdirSync(runsDir).sort().reverse();
  } catch {
    return [];
  }

  const summaries: RunSummary[] = [];
  for (const dir of dirs) {
    const meta = readOptionalJsonFile<WorkflowRunMetadata>(join(runsDir, dir, "metadata.json"));
    if (!meta) continue;
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
      totalCostUsd: meta.totalCostUsd ?? null,
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

export function registerExportCommand(wfCmd: Command): void {
  wfCmd
    .command("export")
    .description("Export run summaries as JSON or CSV")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("-s, --status <status>", "Filter by run status")
    .option("--since <date>", "Include runs started on or after this date (ISO 8601 or date string)")
    .option("-n, --last <N>", "Limit to the N most recent runs")
    .option("--format <fmt>", "Output format: json (default) or csv", "json")
    .option("-o, --output <file>", "Write output to a file instead of stdout")
    .action((opts: { workflow?: string; status?: string; since?: string; last?: string; format: string; output?: string }) => {
      const sinceMs = opts.since ? new Date(opts.since).getTime() : undefined;
      const last = opts.last ? (Number.parseInt(opts.last, 10) || undefined) : undefined;

      if (opts.format !== "json" && opts.format !== "csv") {
        console.error(`Unknown format "${opts.format}". Valid values: json, csv`);
        process.exit(1);
      }

      if (opts.since && sinceMs !== undefined && Number.isNaN(sinceMs)) {
        console.error(`Invalid --since value: "${opts.since}"`);
        process.exit(1);
      }

      const store = new WorkflowRunStore();
      const summaries = loadRunSummaries(store.runsDir, {
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
        process.stdout.write(output);
      }
    });
}
