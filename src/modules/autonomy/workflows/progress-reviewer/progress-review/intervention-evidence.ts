import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { progressReviewProposalKey } from "./action-writers.js";
import { decodeProgressReviewAgentOutput } from "./agent-output-schema.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type { ProgressReviewDirectorySource, ProgressReviewEvidenceRef, ScopedRunEvidence } from "./types.js";

/** Follow original hypotheses through canonical task state, including archived work. */
export function listInterventionEvidence(source: ProgressReviewDirectorySource, runs: readonly ScopedRunEvidence[], excluded: string[]): ProgressReviewEvidenceRef[] {
  const evidence: ProgressReviewEvidenceRef[] = [];
  for (const run of runs) {
    const path = join(".kota", "runs", run.runId, PROGRESS_REVIEW_ARTIFACT);
    let raw: unknown;
    try { raw = readOptionalJsonFile<unknown>(join(source.stateDir, "runs", run.runId, PROGRESS_REVIEW_ARTIFACT)); }
    catch { excluded.push(`${path}: retained intervention evidence is unreadable`); continue; }
    if (raw === null) continue;
    if (typeof raw !== "object" || !("review" in raw)) {
      excluded.push(`${path}: intervention review is unavailable`);
      continue;
    }
    let review: ReturnType<typeof decodeProgressReviewAgentOutput>;
    try { review = decodeProgressReviewAgentOutput(raw.review); }
    catch { excluded.push(`${path}: intervention review cannot be decoded`); continue; }
    const proposals = [
      ...[review.findings.localScope, review.findings.crossScope].flatMap((group) => group.followUpTasks.map((task) => ({
        key: progressReviewProposalKey(task.topicKey), hypothesis: task.problem, outcome: task.howWeWillKnow,
      }))),
      ...(review.handoffs ?? []).map((handoff) => ({ key: handoff.topicKey, hypothesis: handoff.reason, outcome: `handoff to ${handoff.owner}` })),
    ];
    for (const proposal of proposals) {
      const task = findGeneratedWorkTask(source.workspaceRoot, proposal.key)?.task;
      const id = `intervention:${run.runId}:${proposal.key}`;
      evidence.push({
        id: sourceEvidenceId(source, id), kind: "state", path,
        summary: sourceSummary(source,
          `${proposal.key}: hypothesis=${proposal.hypothesis}; expected outcome=${proposal.outcome}; ` +
          `current task=${task ? `${task.id}/${task.state}` : "not materialized"}. ` +
          "Task creation or completion is not measured improvement: inspect the integrated diff and subsequent outcome, including counterevidence."),
      });
      if (task) evidence.push({
        id: sourceEvidenceId(source, `${id}:task`), kind: "state",
        path: join("data", "tasks", ...(task.state === "done" || task.state === "dropped" ? ["archive"] : []), `${task.id}.md`),
        summary: sourceSummary(source, `${proposal.key}: canonical ${task.state} intervention ${task.id}`),
      });
    }
  }
  return evidence;
}
