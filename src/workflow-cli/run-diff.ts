import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "../json-file.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "../workflow/run-types.js";
import { formatDuration, statusIcon } from "./utils.js";

type StepDiff = {
  id: string;
  statusA: string | null;
  statusB: string | null;
  durMsA: number | null;
  durMsB: number | null;
  costA: number | null;
  costB: number | null;
};

function stepCost(step: WorkflowStepResult): number | null {
  const out = step.output as { totalCostUsd?: unknown } | null | undefined;
  return typeof out?.totalCostUsd === "number" ? out.totalCostUsd : null;
}

export function buildRunDiff(a: WorkflowRunMetadata, b: WorkflowRunMetadata): StepDiff[] {
  const stepsA = new Map(a.steps.map((s) => [s.id, s]));
  const stepsB = new Map(b.steps.map((s) => [s.id, s]));

  const seen = new Set<string>();
  const diffs: StepDiff[] = [];

  for (const step of a.steps) {
    seen.add(step.id);
    const stepB = stepsB.get(step.id) ?? null;
    diffs.push({
      id: step.id,
      statusA: step.status,
      statusB: stepB?.status ?? null,
      durMsA: step.durationMs,
      durMsB: stepB?.durationMs ?? null,
      costA: stepCost(step),
      costB: stepB ? stepCost(stepB) : null,
    });
  }

  for (const step of b.steps) {
    if (seen.has(step.id)) continue;
    diffs.push({
      id: step.id,
      statusA: stepsA.has(step.id) ? stepsA.get(step.id)!.status : null,
      statusB: step.status,
      durMsA: stepsA.get(step.id)?.durationMs ?? null,
      durMsB: step.durationMs,
      costA: stepsA.has(step.id) ? stepCost(stepsA.get(step.id)!) : null,
      costB: stepCost(step),
    });
  }

  return diffs;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function fmtStatus(status: string | null): string {
  return status === null ? "N/A" : statusIcon(status);
}

function fmtDelta(a: number | null, b: number | null, fmt: (n: number) => string): string {
  if (a === null || b === null) return "N/A";
  const delta = b - a;
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "=";
  return delta === 0 ? "=" : `${sign}${fmt(delta)}`;
}

function fmtCost(cost: number | null): string {
  return cost === null ? "—" : `$${cost.toFixed(3)}`;
}

export function formatRunDiff(a: WorkflowRunMetadata, b: WorkflowRunMetadata): string {
  const diffs = buildRunDiff(a, b);
  const hasCost = diffs.some((d) => d.costA !== null || d.costB !== null);

  const COL = { step: 20, status: 7, dur: 10, delta: 11, cost: 9, cdelta: 10 };

  const header = [
    pad("Step", COL.step),
    pad("Status", COL.status),
    pad("A Dur", COL.dur),
    pad("B Dur", COL.dur),
    pad("Δ Dur", COL.delta),
    ...(hasCost ? [pad("A Cost", COL.cost), pad("B Cost", COL.cost), pad("Δ Cost", COL.cdelta)] : []),
  ].join(" ").trimEnd();

  const sep = "-".repeat(header.length);

  const rows = diffs.map((d) => {
    const stepLabel = d.id.length > COL.step ? `${d.id.slice(0, COL.step - 1)}…` : d.id;
    const statusStr = `${fmtStatus(d.statusA)}→${fmtStatus(d.statusB)}`;
    const durA = d.durMsA === null ? "N/A" : formatDuration(d.durMsA);
    const durB = d.durMsB === null ? "N/A" : formatDuration(d.durMsB);
    const durDelta = fmtDelta(d.durMsA, d.durMsB, (n) => formatDuration(Math.abs(n)));

    const cols = [
      pad(stepLabel, COL.step),
      pad(statusStr, COL.status),
      pad(durA, COL.dur),
      pad(durB, COL.dur),
      pad(durDelta, COL.delta),
      ...(hasCost ? [
        pad(fmtCost(d.costA), COL.cost),
        pad(fmtCost(d.costB), COL.cost),
        pad(fmtDelta(d.costA, d.costB, (n) => `$${Math.abs(n).toFixed(3)}`), COL.cdelta),
      ] : []),
    ];
    return cols.join(" ").trimEnd();
  });

  return [
    `Run A: ${a.id}  (${a.workflow})`,
    `Run B: ${b.id}  (${b.workflow})`,
    "",
    header,
    sep,
    ...rows,
  ].join("\n");
}

function resolveRunId(store: WorkflowRunStore, runId: string): string {
  if (runId.includes("Z-")) return runId;
  const dirs = readdirSync(store.runsDir).sort().reverse();
  const match = dirs.find((d) => d.startsWith(runId));
  if (!match) throw new Error(`Run "${runId}" not found.`);
  return match;
}

function loadRun(store: WorkflowRunStore, runId: string): WorkflowRunMetadata {
  const resolved = resolveRunId(store, runId);
  const path = join(store.runsDir, resolved, "metadata.json");
  const meta = readOptionalJsonFile<WorkflowRunMetadata>(path);
  if (!meta) throw new Error(`Run "${runId}" not found.`);
  return meta;
}

export function registerRunDiffCommand(wfCmd: Command): void {
  wfCmd
    .command("diff <run-id-a> <run-id-b>")
    .description("Compare two workflow runs step-by-step")
    .action((runIdA: string, runIdB: string) => {
      const store = new WorkflowRunStore();
      let runA: WorkflowRunMetadata;
      let runB: WorkflowRunMetadata;
      try {
        runA = loadRun(store, runIdA);
      } catch (err: unknown) {
        console.error((err as Error).message);
        process.exit(1);
      }
      try {
        runB = loadRun(store, runIdB);
      } catch (err: unknown) {
        console.error((err as Error).message);
        process.exit(1);
      }
      console.log(formatRunDiff(runA, runB));
    });
}
