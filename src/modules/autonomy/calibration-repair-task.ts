import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import type { CalibrationRepairContext } from "./calibration-repair.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Render the deterministic queue task emitted when calibration drift gates. */
export function buildCalibrationRepairTaskFile(
  taskId: string,
  state: "ready",
  ctx: CalibrationRepairContext,
): string {
  const attrs: Record<string, string> = {
    id: taskId,
    title: "Repair evaluator calibration drift",
    status: state,
    priority: "p1",
    area: "autonomy",
    summary:
      "Restore the live-run evaluator calibration loop to within threshold by tightening critic guidance, repair-loop checks, or the calibration gate itself.",
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  };
  const { aggregate, driftKinds } = ctx;
  const context = [
    `Auto-created by evaluator-calibration-monitor at ${ctx.nowIso}.`,
    `Drift kinds: ${driftKinds.join(", ")}.`,
    `Decision: ${ctx.decisionReason}`,
    "",
    "### Calibration snapshot",
    `- Window: ${new Date(aggregate.windowStartMs).toISOString()} → ${new Date(aggregate.windowEndMs).toISOString()}`,
    `- Total runs: ${aggregate.totalRuns}`,
    `- Verdicts: pass=${aggregate.byVerdict.pass}, pass_with_warnings=${aggregate.byVerdict.pass_with_warnings}, fail=${aggregate.byVerdict.fail}, absent=${aggregate.byVerdict.absent}`,
    `- Pass-contradiction rate: ${pct(aggregate.passContradictionRate)} (${aggregate.passContradictionCount} of ${aggregate.byVerdict.pass}); threshold ${pct(ctx.thresholdRate)}.`,
    `- Pass-with-warnings follow-up rate: ${pct(aggregate.passWithWarningsFollowUpRate)} (${aggregate.passWithWarningsFollowUpCount} of ${aggregate.byVerdict.pass_with_warnings}); threshold ${pct(ctx.passWithWarningsThresholdRate)}.`,
  ].join("\n");
  return serializeFlatFrontMatter(attrs, renderRepoTaskIntent({
    problem:
      "The live-run evaluator calibration gate detected drift after a successful builder run.",
    desiredOutcome:
      "Restore the affected rate to under-threshold or insufficient-sample, or deliberately retune the threshold with a durable rationale.",
    constraints: [
      "Keep critic input artifact-only; do not feed thinking traces or self-reports.",
      "Do not raise a threshold without committing the rationale for the new healthy floor.",
      "Keep operator notification working and do not add a parallel lessons or audit store.",
    ],
    doneWhen: [
      "The named drift no longer fires on the latest sample, or the threshold has an explicit recorded rationale.",
      "Weak pass or pass-with-warnings classifications are corrected by guidance, checks, or explicit follow-up.",
      "A run artifact records the post-fix aggregate and disposition.",
    ],
    context,
    acceptanceEvidence: [
      "Focused calibration or critic behavior evidence.",
      "A monitor artifact showing recovery or the recorded retuning rationale.",
    ],
  }));
}
