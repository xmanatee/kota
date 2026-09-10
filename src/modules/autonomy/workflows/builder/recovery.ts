import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { allocationName } from "#core/workflow/run-sandbox.js";
import type { WorkflowRecoveryResolver, WorkflowTriggerAdmissionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { getCriticPromptHash } from "#modules/autonomy/critic.js";
import { readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import { collectBlockedEvidenceOperation } from "../blocked-promoter/evidence.js";
import { recoveryEvidenceOutcomes } from "../blocked-promoter/evidence-relevance.js";
import { listBuilderTaskDispatches, readBuilderTaskPayload } from "./task-contract.js";

/** Stable semantic inputs, excluding observation times, run counts, and unrelated tasks. */
export async function builderRecoveryRevision(input: Pick<WorkflowTriggerAdmissionInput, "trigger" | "state" | "scopeRoot"> & { runId: string }): Promise<string> {
  const task = readBuilderTaskPayload(input.trigger.payload);
  const issues = decodeAutonomyIssueProjection(input.state.read(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value);
  const source = readVerifiedRepoTaskFile(input.scopeRoot, "open", task.taskId);
  // Existing scoped exports include execution results and capability observations.
  // Exclude this writer: its own attempt artifacts cannot authorize another attempt.
  const collection = await runWorkflowBlockingOperation(collectBlockedEvidenceOperation, {
    scopeRoot: input.scopeRoot, hint: ".kota/runs", excludedRunIds: [input.runId],
  });
  const evidence = recoveryEvidenceOutcomes(collection, { id: task.taskId, body: source?.content ?? "" });
  return createHash("sha256").update(JSON.stringify({
    taskDigest: task.taskDigest,
    critic: getCriticPromptHash(),
    issues: issues.issues.filter((issue) => issue.links.taskIds.includes(task.taskId))
      .map((issue) => [issue.issueKey, issue.semanticRevision]).sort(),
    evidence,
  })).digest("hex");
}

export const assessBuilderRecovery: WorkflowRecoveryResolver = async (input) => {
  const admitted = readBuilderTaskPayload(input.trigger.payload);
  const current = listBuilderTaskDispatches(input.scopeRoot)
    .find((task) => task.taskId === admitted.taskId);
  if (!current) return { resume: false, reason: "Target is no longer open and dependency-clear" };
  const trigger = { ...input.trigger, payload: { ...input.trigger.payload, ...current } };
  const revision = await builderRecoveryRevision({ ...input, trigger });
  const previous = readWorkflowRunMetadataFile(join(input.stateDir, "runs", input.runId, "metadata.json"));
  const observation = previous?.steps.find((step) => step.id === "inspect-target-task")?.output;
  const recovered = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).nullable()
    .parse(input.state.read(`workflow:recovery:${input.runId}`).value);
  const observedRevision = typeof observation === "object" && observation !== null && "recoveryRevision" in observation
    ? z.string().regex(/^[a-f0-9]{64}$/).parse(observation.recoveryRevision) : undefined;
  const baseline = recovered?.revision ?? observedRevision;
  let changedReview = false;
  if (baseline === undefined) {
    try {
      const review = z.object({ reviewerPromptHash: z.string().regex(/^[a-f0-9]{12}$/) }).safeParse(
        readOptionalJsonFile(join(input.scopeRoot, ".kota", "runtime", allocationName(input.runId), "agent", "critic-review.json")),
      );
      changedReview = review.success && review.data.reviewerPromptHash !== getCriticPromptHash();
    } catch { /* Unavailable historical evidence cannot establish a relevant change. */ }
  }
  // An older run without an attributable baseline may reconcile a changed task,
  // but absence of a baseline is not itself new evidence or permission to retry.
  if (baseline === revision || (baseline === undefined && admitted.taskDigest === current.taskDigest && !changedReview)) {
    return { resume: false, reason: baseline === undefined
      ? "No attributable recovery baseline; retain for owner review or a changed task contract"
      : "Task contract and relevant review inputs are unchanged" };
  }
  return { resume: true, trigger, revision };
};
