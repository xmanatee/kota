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
  const problem = [
    "The live-run evaluator calibration gate fired after the latest successful builder run.",
    "Determine whether the observation is a real regression, a changed workload,",
    "or noise before changing the critic, prompt, or threshold.",
    "",
    `Drift kind(s): ${driftKinds.join(", ")}.`,
    "",
    "Decision reason from the monitor:",
    "",
    `> ${ctx.decisionReason.replace(/\n/g, "\n> ")}`,
  ].join("\n");
  const context = [
    "Calibration snapshot:",
    "",
    `- Window: ${new Date(aggregate.windowStartMs).toISOString()} → ${new Date(aggregate.windowEndMs).toISOString()}`,
    `- Total runs in window: ${aggregate.totalRuns}`,
    `- Pass verdicts: ${aggregate.byVerdict.pass}`,
    `- Pass-with-warnings verdicts: ${aggregate.byVerdict.pass_with_warnings}`,
    `- Fail verdicts: ${aggregate.byVerdict.fail}`,
    `- Absent verdicts: ${aggregate.byVerdict.absent}`,
    `- Pass-contradiction rate: ${pct(aggregate.passContradictionRate)} (${aggregate.passContradictionCount} of ${aggregate.byVerdict.pass}); threshold ${pct(ctx.thresholdRate)}.`,
    `- Pass-with-warnings follow-up rate: ${pct(aggregate.passWithWarningsFollowUpRate)} (${aggregate.passWithWarningsFollowUpCount} of ${aggregate.byVerdict.pass_with_warnings}); threshold ${pct(ctx.passWithWarningsThresholdRate)}.`,
    "",
    `Observed by evaluator-calibration-monitor at ${ctx.nowIso}.`,
  ].join("\n");
  const body = renderRepoTaskIntent({
    problem,
    desiredOutcome: [
    "Either:",
    "",
    "- the underlying calibration drift is fixed (tighten critic guidance,",
    "  introduce a sharper repair-loop check, raise the bar for accepted",
    "  warnings, fix a prompt that lets the critic accept weak evidence); or",
    "- the threshold is intentionally widened with a recorded reason (the",
    "  current rate is the new healthy floor for the changed workload).",
    "",
    "Either way, the next monitor run should land back at `under-threshold` or",
    "`insufficient-sample` for the relevant kind, and that result must be",
    "visible in the run artifact rather than only in attention digests.",
    ].join("\n"),
    constraints: [
    "- Keep critic input artifact-only (diff, repo state, run artifacts,",
    "  optional runtime probe). Do not feed thinking traces or self-reports.",
    "- Do not silence the gate by raising the threshold without a documented",
    "  rationale committed alongside the threshold change.",
    "- Keep operator-facing notification surfaces (attention digest) working —",
    "  this task is in addition to that bridge, not instead of it.",
    "- Do not add a parallel lessons store or audit surface.",
    ].join("\n"),
    howWeWillKnow: [
    "1. The drift kind named above is no longer firing on the last calibration",
    "   sample, OR the gate config has been deliberately retuned with a",
    "   recorded rationale.",
    "2. Recent critic verdicts that were treated as `pass`/`pass_with_warnings`",
    "   despite weak evidence have been re-classified by tighter guidance, a",
    "   sharper repair-loop check, or follow-up tasks created for accepted",
    "   trade-offs.",
    "3. The subsequent calibration observation supports the chosen disposition.",
    ].join("\n"),
    context,
  });
  return serializeFlatFrontMatter(attrs, body);
}
