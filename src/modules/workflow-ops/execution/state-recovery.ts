import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import type {
  WorkflowStateRecoveryAction,
  WorkflowStateRecoveryClaim,
  WorkflowStateRecoveryDeadLetterLink,
  WorkflowStateRecoveryWorktree,
} from "../state-recovery-provider.js";

type JsonOption = {
  json?: boolean;
};

type ResolveOptions = JsonOption & {
  action: string;
  reason: string;
  runId?: string;
  actor?: string;
  artifactRunId?: string;
  supersededBy?: string;
  cleanupWorktree?: boolean;
  discardWorktreeChanges?: boolean;
  dismissDeadLetters?: boolean;
  completeTask?: boolean;
};

function parseAction(value: string): WorkflowStateRecoveryAction {
  if (value === "release" || value === "supersede") return value;
  printWorkflowError(`Unknown recovery action "${value}". Valid: release, supersede`);
  process.exit(1);
}

function actionLabel(claim: WorkflowStateRecoveryClaim): string {
  const action = claim.recommendedAction;
  return `${action.kind}: ${action.reason}`;
}

function printClaimSummary(claim: WorkflowStateRecoveryClaim): void {
  printWorkflowText(`${claim.claim.taskId}`);
  printWorkflowText(`  claim:     ${claim.claim.status} (${claim.recoveryStatus})`);
  printWorkflowText(`  owner:     ${claim.claim.owner}`);
  printWorkflowText(`  run:       ${claim.claim.workflowId}/${claim.claim.runId}`);
  printWorkflowText(`  worktree:  ${claim.worktree.state ?? "unknown"} (${claim.worktree.dirtyState ?? "unknown"})`);
  printWorkflowText(`  action:    ${actionLabel(claim)}`);
  if (claim.relatedDeadLetters.length > 0) {
    printWorkflowText(
      `  dlq:       ${claim.relatedDeadLetters.map((item) => item.id).join(", ")}`,
    );
  }
  if (claim.worktree.uniqueCommitCount > 0) {
    printWorkflowText(`  commits:   ${claim.worktree.uniqueCommits.join("; ")}`);
  }
  if (claim.worktree.uniqueCommitError !== undefined) {
    printWorkflowText(`  commit check: ${claim.worktree.uniqueCommitError}`);
  }
}

function printWorktreeSummary(worktree: WorkflowStateRecoveryWorktree): void {
  printWorkflowText(`${worktree.taskId}`);
  printWorkflowText(`  run:       ${worktree.workflowId}/${worktree.runId}`);
  printWorkflowText(`  worktree:  ${worktree.state} (${worktree.dirtyState})`);
  printWorkflowText(`  action:    ${worktree.recommendedAction.kind}: ${worktree.recommendedAction.reason}`);
  if (worktree.uniqueCommitCount > 0) {
    printWorkflowText(`  commits:   ${worktree.uniqueCommits.join("; ")}`);
  }
  if (worktree.uniqueCommitError !== undefined) {
    printWorkflowText(`  commit check: ${worktree.uniqueCommitError}`);
  }
  if (worktree.relatedDeadLetters.length > 0) {
    printWorkflowText(
      `  dlq:       ${worktree.relatedDeadLetters.map((item) => item.id).join(", ")}`,
    );
  }
}

function printDeadLetterSummary(item: WorkflowStateRecoveryDeadLetterLink): void {
  const action = item.recommendedAction;
  printWorkflowText(`${item.id}`);
  printWorkflowText(`  workflow:  ${item.workflowName ?? item.affectedWorkflowNames.join(",")}`);
  printWorkflowText(`  failure:   ${item.failureClass ?? "unknown"} (${item.sourceKind ?? item.type})`);
  printWorkflowText(`  action:    ${action ? `${action.kind}: ${action.reason}` : "needs-review"}`);
  if (item.duplicateCount && item.duplicateCount > 1) {
    printWorkflowText(`  dupes:     ${item.duplicateCount}${item.duplicateOf ? `; duplicate of ${item.duplicateOf}` : ""}`);
  }
}

export function registerStateRecoveryCommand(wfCmd: Command, ctx: ModuleContext): void {
  const recovery = wfCmd
    .command("state-recovery")
    .description("Inspect and resolve stale workflow task-claim recovery state");

  recovery
    .command("list")
    .description("List workflow recovery claims, worktrees, DLQs, and safe next actions")
    .option("--json", "Print JSON")
    .action(async (opts: JsonOption) => {
      const result = await ctx.client.workflow.listStateRecoveryActions();
      if (!result.ok) {
        printWorkflowError(result.message);
        process.exit(1);
      }
      if (opts.json) {
        printWorkflowText(JSON.stringify(result, null, 2));
        return;
      }
      const hasWork = result.claims.length > 0 ||
        result.worktrees.length > 0 ||
        result.deadLetters.length > 0;
      if (!hasWork) {
        printWorkflowText("No unresolved workflow recovery state found.");
        return;
      }
      printWorkflowText(`Unresolved task claims: ${result.claims.length}`);
      for (const claim of result.claims) {
        printClaimSummary(claim);
      }
      printWorkflowText(`Automation worktrees: ${result.worktrees.length}`);
      for (const worktree of result.worktrees) {
        printWorktreeSummary(worktree);
      }
      printWorkflowText(`Open dead-letter items: ${result.deadLetters.length}`);
      for (const item of result.deadLetters) {
        printDeadLetterSummary(item);
      }
    });

  recovery
    .command("resolve <task-id>")
    .description("Release or supersede one unresolved task claim")
    .requiredOption("--action <action>", "Recovery action: release or supersede")
    .requiredOption("--reason <reason>", "Required recovery rationale")
    .option("--run-id <runId>", "Require the active claim to belong to this run id")
    .option("--actor <actor>", "Actor recorded in the recovery artifact")
    .option("--artifact-run-id <runId>", "Run directory used for the recovery artifact")
    .option("--superseded-by <commit>", "Canonical commit that supersedes unique branch work")
    .option("--cleanup-worktree", "Remove the related automation worktree after the accepted disposition")
    .option("--discard-worktree-changes", "Allow discarding local changes in a superseded worktree")
    .option("--dismiss-dead-letters", "Dismiss related open DLQ items after the accepted disposition")
    .option("--complete-task", "Move the recovered task to done/ through the task state mover")
    .option("--json", "Print JSON")
    .action(async (taskId: string, opts: ResolveOptions) => {
      const result = await ctx.client.workflow.resolveStateRecovery({
        taskId,
        action: parseAction(opts.action),
        rationale: opts.reason,
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
        ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
        ...(opts.artifactRunId !== undefined ? { artifactRunId: opts.artifactRunId } : {}),
        ...(opts.supersededBy !== undefined ? { supersededByCommit: opts.supersededBy } : {}),
        ...(opts.cleanupWorktree === true ? { cleanupWorktree: true } : {}),
        ...(opts.discardWorktreeChanges === true ? { discardWorktreeChanges: true } : {}),
        ...(opts.dismissDeadLetters === true ? { dismissDeadLetters: true } : {}),
        ...(opts.completeTask === true ? { completeTask: true } : {}),
      });
      if (opts.json) {
        printWorkflowText(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 1;
        return;
      }
      if (!result.ok) {
        printWorkflowError(result.message);
        if (result.artifactPath) {
          printWorkflowError(`Recovery artifact: ${result.artifactPath}`);
        }
        process.exit(1);
      }
      printWorkflowText(result.message);
      printWorkflowText(`Recovery artifact: ${result.artifactPath}`);
    });
}
