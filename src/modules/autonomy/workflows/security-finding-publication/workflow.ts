import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { inspectRepoWorkSupply, resolveRepoWorkSupplyInput } from "#modules/repo-tasks/work-supply.js";
import { createSecurityFindingTasksOperation } from "../security-review/blocking-operations.js";
import { securityFindingPublicationRequested } from "../security-review/events.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_RESOURCE, SECURITY_REVIEW_STATE_KEY } from "../security-review/review-state.js";
import { resolveSecurityFindingTaskTarget } from "../security-review/security-review-task-identity.js";

const requestSchema = z.object({ taskId: z.string().regex(/^task-[a-z0-9][a-z0-9-]*$/) });
const workflow: WorkflowDefinitionInput = {
  name: "security-finding-publication",
  repository: "write",
  integration: {
    validationCommand: ["pnpm", "validate-tasks"],
    postReconcile: ({ repoRoot, trigger, readState }) => {
      const { taskId } = requestSchema.parse(trigger.payload);
      const state = decodeSecurityReviewState(readState(SECURITY_REVIEW_STATE_KEY).value);
      try {
        const selected = state.pending.filter((entry) => resolveSecurityFindingTaskTarget(repoRoot, entry.finding).id === taskId);
        return selected.length ? { satisfied: true }
          : { satisfied: false, reason: "Security publication target no longer matches pending evidence" };
      } catch (error) {
        return { satisfied: false, reason: String(error) };
      }
    },
  },
  description: "Publish pending confirmed security variants while holding their task resource.",
  triggers: [{ event: securityFindingPublicationRequested.name, queueMode: "all" }],
  resources: ({ trigger }) => [SECURITY_REVIEW_RESOURCE, `task:${requestSchema.parse(trigger.payload).taskId}`],
  triggerAdmission: ({ scopeRoot, stateDir, trigger }) => {
    const { taskId } = requestSchema.parse(trigger.payload);
    const supply = inspectRepoWorkSupply(resolveRepoWorkSupplyInput({ workspaceRoot: scopeRoot, scopeRoot, stateDir }));
    return supply.ownershipAvailable && !supply.owners.some((owner) => owner.taskId === taskId)
      ? { admitted: true }
      : { admitted: false, reason: "Security evidence remains pending until task ownership is available" };
  },
  steps: [{
    id: "publish-findings", type: "code",
    run: async (ctx) => {
      const { taskId } = requestSchema.parse(ctx.trigger.payload);
      const snapshot = ctx.state.read(SECURITY_REVIEW_STATE_KEY);
      const state = decodeSecurityReviewState(snapshot.value);
      const pending = state.pending.filter((entry) => resolveSecurityFindingTaskTarget(ctx.workspaceRoot, entry.finding).id === taskId);
      const results = [];
      for (const entry of pending) {
        results.push(await ctx.runBlocking(createSecurityFindingTasksOperation, {
          workspaceRoot: ctx.workspaceRoot, runId: entry.runId, findings: [entry.finding],
        }));
      }
      if (pending.length) {
        ctx.state.compareAndSet(SECURITY_REVIEW_STATE_KEY, snapshot.revision, {
          ...state, pending: state.pending.filter((entry) => !pending.includes(entry)),
        });
      }
      if (results.some((result) => result.createdTaskIds.length + result.updatedTaskIds.length > 0)) {
        writeFileSync(join(ctx.workflow.runDirPath, "commit-message.txt"), `security-review: reconcile confirmed evidence for ${taskId}\n`);
      }
      return { taskId, results };
    },
  }],
};
export default workflow;
