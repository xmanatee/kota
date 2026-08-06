import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AutonomyHealthEvidenceRef } from "#modules/autonomy/health-signal.js";
import {
  loadRunsInWindow,
  storedWorkflowRunDirectory,
} from "#modules/workflow-ops/runs/workflow-history.js";
import { scanControlCoverageGaps } from "./runtime-health-audit-control-coverage.js";
import {
  addPattern,
  MAX_RUN_ERROR_TEXT_BYTES,
  normalizeLogCode,
  type PatternInput,
  type RuntimeHealthAuditContext,
  truncateSingleLine,
} from "./runtime-health-audit-model.js";

type WorkflowHistoryRun = ReturnType<typeof loadRunsInWindow>[number];

type InterruptedRunCause =
  | "unknown-local"
  | "daemon-restart"
  | "harness-abort";

type InterruptedRunObservation = {
  run: WorkflowHistoryRun;
  cause: InterruptedRunCause;
  errorSummary: string | null;
};

function readInterruptedRunErrorSummary(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRun,
): string | null {
  const errorPath = join(
    storedWorkflowRunDirectory(
      join(ctx.projectDir, ".kota", "runs"),
      run,
    ),
    "error.txt",
  );
  if (!existsSync(errorPath)) return null;
  const text = readFileSync(errorPath, "utf-8").slice(0, MAX_RUN_ERROR_TEXT_BYTES);
  return truncateSingleLine(text);
}

function classifyInterruptedRunCause(
  errorSummary: string | null,
): InterruptedRunCause {
  if (!errorSummary) return "unknown-local";
  const normalized = normalizeLogCode(errorSummary);
  if (/daemon restarted while run was in progress/.test(normalized)) {
    return "daemon-restart";
  }
  if (
    /codex cli run aborted/.test(normalized) ||
    /agent step "[^"]+" failed \(aborted\)/.test(normalized)
  ) {
    return "harness-abort";
  }
  return "unknown-local";
}

function interruptedRunEvidenceRefs(
  observation: InterruptedRunObservation,
): AutonomyHealthEvidenceRef[] {
  const runRef = `.kota/runs/${observation.run.id}/metadata.json`;
  const refs: AutonomyHealthEvidenceRef[] = [
    {
      kind: "run",
      ref: runRef,
      summary: observation.errorSummary
        ? `${observation.run.workflow} ${observation.run.status} at ${observation.run.startedAt}: ${observation.errorSummary}`
        : `${observation.run.workflow} ${observation.run.status} at ${observation.run.startedAt}`,
    },
  ];
  if (observation.errorSummary) {
    refs.push({
      kind: "artifact",
      ref: `.kota/runs/${observation.run.id}/error.txt`,
      summary: observation.errorSummary,
    });
  }
  return refs;
}

function interruptedRunPattern(
  workflow: string,
  cause: InterruptedRunCause,
  observations: readonly InterruptedRunObservation[],
): PatternInput {
  const count = observations.length;
  const evidenceRefs = observations.flatMap((observation) =>
    interruptedRunEvidenceRefs(observation)
  );
  if (cause === "daemon-restart") {
    return {
      dedupeKey: `workflow:${workflow}:interrupted-run:daemon-restart`,
      category: "operator-action",
      severity: "warning",
      actionability: "owner-action",
      labels: [
        "daemon-restart",
        "interrupted-run",
        "operator-action",
        "runtime",
        workflow,
      ],
      summary:
        `${workflow} has ${count} recent interrupted runs caused by daemon restart/recovery; inspect runtime lifecycle evidence before opening a local-code repair.`,
      source: { kind: "workflow", id: workflow, workflow },
      observationCount: count,
      evidenceRefs,
    };
  }
  if (cause === "harness-abort") {
    return {
      dedupeKey: `workflow:${workflow}:interrupted-run:harness-abort`,
      category: "operator-action",
      severity: "warning",
      actionability: "owner-action",
      labels: [
        "harness-abort",
        "interrupted-run",
        "operator-action",
        "runtime",
        workflow,
      ],
      summary:
        `${workflow} has ${count} recent interrupted runs caused by agent harness aborts; inspect the abort source before opening a local-code repair.`,
      source: { kind: "workflow", id: workflow, workflow },
      observationCount: count,
      evidenceRefs,
    };
  }
  return {
    dedupeKey: `workflow:${workflow}:interrupted-run`,
    category: "local-code",
    severity: "error",
    actionability: "local-code",
    labels: ["interrupted-run", "local-code", "runtime", workflow],
    summary:
      `${workflow} has ${count} recent interrupted runs that need root-cause review.`,
    source: { kind: "workflow", id: workflow, workflow },
    observationCount: count,
    evidenceRefs,
  };
}

export function scanRuns(ctx: RuntimeHealthAuditContext): void {
  const runsDir = join(ctx.projectDir, ".kota", "runs");
  const runs = loadRunsInWindow(runsDir, ctx.windowStartMs);
  ctx.inspected.recentRuns = runs.length;

  const interruptedByWorkflowAndCause = new Map<
    string,
    {
      workflow: string;
      cause: InterruptedRunCause;
      observations: InterruptedRunObservation[];
    }
  >();
  const workflowsWithNewerSuccess = new Set<string>();
  for (const run of runs) {
    if (run.status === "success") {
      workflowsWithNewerSuccess.add(run.workflow);
      continue;
    }
    if (run.status !== "interrupted") continue;
    ctx.inspected.interruptedRuns += 1;
    if (workflowsWithNewerSuccess.has(run.workflow)) continue;
    const errorSummary = readInterruptedRunErrorSummary(ctx, run);
    const cause = classifyInterruptedRunCause(errorSummary);
    const key = `${run.workflow}\0${cause}`;
    const existing = interruptedByWorkflowAndCause.get(key) ?? {
      workflow: run.workflow,
      cause,
      observations: [],
    };
    existing.observations.push({ run, cause, errorSummary });
    interruptedByWorkflowAndCause.set(key, existing);
  }

  for (const group of interruptedByWorkflowAndCause.values()) {
    if (group.observations.length < ctx.interruptedRunMinCount) continue;
    addPattern(
      ctx,
      interruptedRunPattern(group.workflow, group.cause, group.observations),
    );
  }
  scanControlCoverageGaps(ctx, runs);
}
