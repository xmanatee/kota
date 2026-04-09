import type { Command } from "commander";
import type { ModuleContext } from "../../module-types.js";
import { DaemonControlClient } from "../../server/daemon-client.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "../../workflow/validation.js";
import { buildDryRunPlan, formatDryRunPlan } from "./dry-run.js";
import { getWorkflowDefinitions } from "./definitions-source.js";

export function registerRunCommand(wfCmd: Command, ctx: ModuleContext): void {
  const runCmd = wfCmd
    .command("run")
    .description("Workflow run operations: validate a plan or abort an active run");

  runCmd
    .command("abort <run-id>")
    .description("Abort a specific active workflow run by ID")
    .action(async (runId: string) => {
      const client = DaemonControlClient.fromStateDir();
      if (!client) {
        console.error("No running daemon found. Cannot abort a run without a daemon.");
        process.exit(1);
      }
      const result = await client.abortRun(runId);
      if (!result) {
        console.error("Failed to reach daemon.");
        process.exit(1);
      }
      if (result.notFound) {
        console.error(`Run "${runId}" not found or not active.`);
        process.exit(1);
      }
      if (result.queued) {
        console.error(`Run "${runId}" is queued, not active. Use \`kota workflow cancel ${runId}\` to cancel it.`);
        process.exit(1);
      }
      console.log(`Aborted run ${runId}.`);
    });

  runCmd
    .command("<name>", { isDefault: true })
    .description("Validate and preview a workflow execution plan")
    .option("--dry-run", "Validate the workflow and print the step execution plan without executing")
    .action(async (name: string, opts: { dryRun?: boolean }) => {
      if (!opts.dryRun) {
        console.error(
          "kota workflow run requires --dry-run.\n" +
            "To enqueue a workflow for execution, use: kota workflow trigger <name>",
        );
        process.exit(1);
      }

      let definitions;
      try {
        definitions = validateWorkflowDefinitions(
          getWorkflowDefinitions(ctx),
          process.cwd(),
        );
      } catch (err) {
        if (err instanceof WorkflowDefinitionError) {
          console.error(`Definition error: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }

      const definition = definitions.find((d) => d.name === name);
      if (!definition) {
        const names = definitions.map((d) => d.name).join(", ");
        console.error(`Unknown workflow "${name}". Available: ${names}`);
        process.exit(1);
      }

      const plan = await buildDryRunPlan(definition);
      console.log(formatDryRunPlan(plan));
    });
}
