import type { Command } from "commander";
import { getApprovalQueue } from "./approval-queue.js";
import { executeTool } from "./tools/index.js";

export function registerApprovalCommands(program: Command): void {
  const approvalCmd = program
    .command("approval")
    .description("Manage the tool-call approval queue");

  approvalCmd
    .command("list")
    .description("List all pending approval items")
    .action(() => {
      const queue = getApprovalQueue();
      const items = queue.list("pending");
      if (items.length === 0) {
        console.log("No pending approvals.");
        return;
      }
      console.log(`${items.length} pending approval(s):\n`);
      for (const item of items) {
        const inputSummary = JSON.stringify(item.input).slice(0, 80);
        console.log(`  [${item.id}] ${item.tool}`);
        console.log(`    Input:  ${inputSummary}`);
        console.log(`    Risk:   ${item.risk}`);
        console.log(`    Reason: ${item.reason}`);
        if (item.source) console.log(`    Source: ${item.source}`);
        console.log();
      }
    });

  approvalCmd
    .command("approve <id>")
    .description("Approve and execute a queued tool call")
    .action(async (id: string) => {
      const queue = getApprovalQueue();
      const item = queue.approve(id);
      if (!item) {
        console.error(`Error: approval "${id}" not found or already resolved.`);
        process.exit(1);
      }
      const result = await executeTool(item.tool, item.input);
      if (result.is_error) {
        console.error(`Tool execution failed:\n${result.content}`);
        process.exit(1);
      }
      console.log(`Approved and executed ${item.tool}:\n${result.content}`);
    });

  approvalCmd
    .command("reject <id>")
    .description("Reject a queued tool call")
    .option("-r, --reason <text>", "Reason for rejection")
    .action((id: string, opts: { reason?: string }) => {
      const queue = getApprovalQueue();
      const item = queue.reject(id, opts.reason);
      if (!item) {
        console.error(`Error: approval "${id}" not found or already resolved.`);
        process.exit(1);
      }
      const suffix = opts.reason ? ` — ${opts.reason}` : "";
      console.log(`Rejected: ${item.tool} [${id}]${suffix}`);
    });

  approvalCmd
    .command("count")
    .description("Print the number of pending approval items")
    .action(() => {
      const queue = getApprovalQueue();
      console.log(String(queue.count("pending")));
    });
}
