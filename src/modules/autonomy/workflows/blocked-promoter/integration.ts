import { join } from "node:path";
import { z } from "zod";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import type { WorkflowPostReconcileInvariant } from "#core/workflow/types.js";
import { evidenceDigest } from "./evidence.js";
import { listBlockedTasksWithPreconditions } from "./promotion.js";

const inspection = z.object({ contracts: z.array(z.object({ taskId: z.string(), digest: z.string() })) });

/** The review and the mutation must refer to the same canonical blocker contract. */
export const verifyBlockedContracts: WorkflowPostReconcileInvariant = (input) => {
  const metadata = readWorkflowRunMetadataFile(join(input.stateDir, "runs", input.runId, "metadata.json"));
  const selected = inspection.safeParse(metadata?.steps.find((step) => step.id === "inspect-blocked")?.output);
  if (!selected.success) return { satisfied: false, reason: "Blocked promotion lacks its source contracts" };
  const current = new Map(listBlockedTasksWithPreconditions(input.repoRoot).map((task) => [task.id, task]));
  for (const contract of selected.data.contracts) {
    const task = current.get(contract.taskId);
    if (!task || evidenceDigest({ body: task.body, dependsOn: task.dependsOn }) !== contract.digest) {
      return { satisfied: false, reason: `Blocked task ${contract.taskId} changed after assessment` };
    }
  }
  return { satisfied: true };
};
