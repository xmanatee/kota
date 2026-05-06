import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "#core/workflow/run-types.js";
import {
  blank,
  columns,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDuration, statusIcon } from "../utils.js";

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

function deltaRole(a: number | null, b: number | null): SemanticRole {
  if (a === null || b === null) return "muted";
  const delta = b - a;
  if (delta === 0) return "muted";
  return delta > 0 ? "warn" : "success";
}

export function formatRunDiff(a: WorkflowRunMetadata, b: WorkflowRunMetadata): RenderNode {
  const diffs = buildRunDiff(a, b);
  const hasCost = diffs.some((d) => d.costA !== null || d.costB !== null);

  const baseSpecs: Array<{
    header: string;
    align?: "left" | "right";
    minWidth?: number;
    maxWidth?: number;
    role?: SemanticRole;
  }> = [
    { header: "Step", role: "accent", maxWidth: 24 },
    { header: "Status", minWidth: 5 },
    { header: "A Dur", align: "right", minWidth: 6 },
    { header: "B Dur", align: "right", minWidth: 6 },
    { header: "Δ Dur", align: "right", minWidth: 6 },
  ];
  if (hasCost) {
    baseSpecs.push(
      { header: "A Cost", align: "right", minWidth: 7 },
      { header: "B Cost", align: "right", minWidth: 7 },
      { header: "Δ Cost", align: "right", minWidth: 7 },
    );
  }

  const rows = diffs.map((d) => {
    const statusStr = `${fmtStatus(d.statusA)}→${fmtStatus(d.statusB)}`;
    const durA = d.durMsA === null ? "N/A" : formatDuration(d.durMsA);
    const durB = d.durMsB === null ? "N/A" : formatDuration(d.durMsB);
    const durDelta = fmtDelta(d.durMsA, d.durMsB, (n) => formatDuration(Math.abs(n)));

    const cells: Array<{ spans: Array<{ text: string; role?: SemanticRole }> }> = [
      { spans: [{ text: d.id, role: "accent" }] },
      { spans: [{ text: statusStr }] },
      { spans: [{ text: durA }] },
      { spans: [{ text: durB }] },
      { spans: [{ text: durDelta, role: deltaRole(d.durMsA, d.durMsB) }] },
    ];
    if (hasCost) {
      cells.push(
        { spans: [{ text: fmtCost(d.costA), role: "muted" }] },
        { spans: [{ text: fmtCost(d.costB), role: "muted" }] },
        {
          spans: [
            {
              text: fmtDelta(d.costA, d.costB, (n) => `$${Math.abs(n).toFixed(3)}`),
              role: deltaRole(d.costA, d.costB),
            },
          ],
        },
      );
    }
    return { cells };
  });

  return stack(
    line(plain("Run A: "), { text: a.id, role: "accent" }, plain(`  (${a.workflow})`)),
    line(plain("Run B: "), { text: b.id, role: "accent" }, plain(`  (${b.workflow})`)),
    blank(),
    columns(baseSpecs, rows),
  );
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
        print(line(span((err as Error).message, "error")));
        process.exit(1);
      }
      try {
        runB = loadRun(store, runIdB);
      } catch (err: unknown) {
        print(line(span((err as Error).message, "error")));
        process.exit(1);
      }
      print(formatRunDiff(runA, runB));
    });
}
