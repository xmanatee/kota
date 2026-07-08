import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import type {
  WorkflowStateRecoveryAction,
  WorkflowStateRecoveryClaim,
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
}

export function registerStateRecoveryCommand(wfCmd: Command, ctx: ModuleContext): void {
  const recovery = wfCmd
    .command("state-recovery")
    .description("Inspect and resolve stale workflow task-claim recovery state");

  recovery
    .command("list")
    .description("List pending-merge workflow task claims and safe next actions")
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
      if (result.claims.length === 0) {
        printWorkflowText("No pending-merge task claims found.");
        return;
      }
      printWorkflowText(`Pending-merge task claims: ${result.claims.length}`);
      for (const claim of result.claims) {
        printClaimSummary(claim);
      }
    });

  recovery
    .command("resolve <task-id>")
    .description("Release or supersede one stale pending-merge task claim")
    .requiredOption("--action <action>", "Recovery action: release or supersede")
    .requiredOption("--reason <reason>", "Required recovery rationale")
    .option("--run-id <runId>", "Require the active claim to belong to this run id")
    .option("--actor <actor>", "Actor recorded in the recovery artifact")
    .option("--artifact-run-id <runId>", "Run directory used for the recovery artifact")
    .option("--json", "Print JSON")
    .action(async (taskId: string, opts: ResolveOptions) => {
      const result = await ctx.client.workflow.resolveStateRecovery({
        taskId,
        action: parseAction(opts.action),
        rationale: opts.reason,
        ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
        ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
        ...(opts.artifactRunId !== undefined ? { artifactRunId: opts.artifactRunId } : {}),
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
