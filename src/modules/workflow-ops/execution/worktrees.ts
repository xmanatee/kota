import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { reconcileAutomationWorktrees } from "#modules/git/worktree-lifecycle.js";
import { printWorkflowText } from "../cli-output.js";

type WorktreeReconcileOptions = {
  json?: boolean;
};

export function registerWorktreesCommand(wfCmd: Command, ctx: ModuleContext): void {
  const worktrees = wfCmd
    .command("worktrees")
    .description("Inspect and reconcile automation worktree lifecycle state");

  worktrees
    .command("reconcile")
    .description("Unlock terminal stale locks and remove only cleanup-eligible automation worktrees")
    .option("--json", "Print JSON")
    .action((opts: WorktreeReconcileOptions) => {
      const result = reconcileAutomationWorktrees(ctx.cwd);
      if (opts.json) {
        printWorkflowText(JSON.stringify(result, null, 2));
        return;
      }
      printWorkflowText(
        [
          `inspected=${result.inspected}`,
          `active=${result.active}`,
          `unlocked=${result.unlocked}`,
          `removed=${result.removed}`,
          `preserved=${result.preserved}`,
          `preservedDirty=${result.preservedDirty}`,
          `preservedBlocked=${result.preservedBlocked}`,
        ].join(" "),
      );
      for (const item of result.items) {
        printWorkflowText(`${item.action} ${item.taskId}/${item.runId}: ${item.message}`);
        if (item.blockers.length > 0) {
          printWorkflowText(`  blockers: ${item.blockers.join("; ")}`);
        }
      }
    });
}
