import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssue,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyIssueOwnerFingerprint } from "#modules/autonomy/autonomy-issue-reconciliation.js";

export type IssueDecisionInput = {
  eligible: boolean;
  reason: string;
  issue: AutonomyIssue | null;
  evidencePath?: string;
};

export function selectIssueForProjection(args: {
  trigger: WorkflowStepContext["trigger"];
  projection: AutonomyIssueProjection;
}): IssueDecisionInput {
  const { trigger, projection } = args;
  if (trigger.event !== autonomyIssueDecisionRequested.name) {
    return {
      eligible: false,
      reason: "recovery reconciles worktree state without replaying AI review",
      issue: null,
    };
  }
  const issueKey = trigger.payload.issueKey;
  const semanticRevision = trigger.payload.semanticRevision;
  if (typeof issueKey !== "string" || typeof semanticRevision !== "number") {
    throw new Error("autonomy issue decision trigger is malformed");
  }
  const issue = projection.issues.find(
    (candidate) => candidate.issueKey === issueKey,
  ) ?? null;
  if (!issue) {
    return { eligible: false, reason: "issue no longer exists", issue: null };
  }
  if (issue.semanticRevision !== semanticRevision) {
    return {
      eligible: false,
      reason: "issue advanced beyond the queued semantic revision",
      issue,
    };
  }
  if (
    issue.status === "resolved" ||
    issue.disposition.semanticRevision !== semanticRevision ||
    (trigger.payload.requestKind !== "reconciliation" &&
      issue.disposition.kind !== "needs-decision")
  ) {
    return {
      eligible: false,
      reason: "issue revision already has a current disposition",
      issue,
    };
  }
  if (
    trigger.payload.requestKind === "reconciliation" &&
    (typeof trigger.payload.ownerFingerprint !== "string" ||
      trigger.payload.ownerFingerprint !== autonomyIssueOwnerFingerprint(issue))
  ) {
    return {
      eligible: false,
      reason: "issue disposition ownership changed after reconciliation",
      issue,
    };
  }
  return {
    eligible: true,
    reason: "issue revision requires one disposition",
    issue,
  };
}

export function triggerIssue(
  ctx: Pick<WorkflowStepContext, "trigger" | "state">,
): IssueDecisionInput {
  const projection = decodeAutonomyIssueProjection(
    ctx.state.read<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    ).value,
  );
  return selectIssueForProjection({ trigger: ctx.trigger, projection });
}

export const selectIssue = typedCodeStep<IssueDecisionInput>({
  id: "select-issue",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) =>
    expectStructuredOutput<IssueDecisionInput>(raw, [
      "eligible",
      "reason",
      "issue",
    ]),
  run: (ctx) => {
    const selected = triggerIssue(ctx);
    if (!selected.eligible || !selected.issue) return selected;
    const refs = selected.issue.evidenceRefs.filter((ref) => ref.kind === "dead-letter");
    if (refs.length === 0) return selected;
    const store = new DeadLetterQueueStore(join(ctx.stateDir, "dead-letter-queue"));
    const evidence = refs.map(({ ref }) => {
      const match = /^\.kota\/dead-letter-queue\/items\.json#(dlq-[a-f0-9-]+)$/.exec(ref);
      if (!match) throw new Error(`Invalid dead-letter evidence reference: ${ref}`);
      const item = store.get(match[1]!);
      if (item && item.scopeId !== ctx.scopeId) {
        throw new Error("Issue evidence belongs to another scope");
      }
      return { ref, item };
    });
    const agentDir = resolveAgentRunDirFromContext(ctx);
    mkdirSync(agentDir, { recursive: true });
    const evidencePath = join(agentDir, "issue-evidence.json");
    const content = `${JSON.stringify({ capturedAt: new Date().toISOString(), evidence }, null, 2)}\n`;
    writeFileSync(evidencePath, content, { mode: 0o600 });
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(join(ctx.workflow.runDirPath, "issue-evidence.json"), content, { mode: 0o600 });
    return { ...selected, evidencePath };
  },
});
