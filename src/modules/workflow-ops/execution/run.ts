import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowDefinitionError } from "#core/workflow/validation.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import { buildDryRunPlan, formatDryRunResult } from "./dry-run.js";

export function registerRunCommand(wfCmd: Command, ctx: ModuleContext): void {
  const runCmd = wfCmd
    .command("run")
    .description("Workflow run operations: validate a plan or abort an active run");

  runCmd
    .command("abort <run-id>")
    .description("Abort a specific active workflow run by ID")
    .action(async (runId: string) => {
      const result = await ctx.client.workflow.abortRun(runId);
      if (result.ok) {
        console.log(`Aborted run ${runId}.`);
        return;
      }
      if (result.reason === "daemon_required") {
        console.error("No running daemon found. Cannot abort a run without a daemon.");
        process.exit(1);
      }
      if (result.reason === "queued") {
        console.error(
          `Run "${runId}" is queued, not active. Use \`kota workflow cancel ${runId}\` to cancel it.`,
        );
        process.exit(1);
      }
      console.error(`Run "${runId}" not found or not active.`);
      process.exit(1);
    });

  runCmd
    .command("<name>", { isDefault: true })
    .description("Validate and preview a workflow execution plan")
    .option("--dry-run", "Validate the workflow and print the step execution plan without executing")
    .option("--payload <json>", "JSON payload to test trigger resolution against")
    .action(async (name: string, opts: { dryRun?: boolean; payload?: string }) => {
      if (!opts.dryRun) {
        console.error(
          "kota workflow run requires --dry-run.\n" +
            "To enqueue a workflow for execution, use: kota workflow trigger <name>",
        );
        process.exit(1);
      }

      let payload: Record<string, unknown> | undefined;
      if (opts.payload) {
        try {
          payload = JSON.parse(opts.payload) as Record<string, unknown>;
        } catch {
          console.error("--payload must be valid JSON");
          process.exit(1);
        }
      }

      let definitions: ReturnType<typeof getValidatedWorkflowDefinitions>;
      try {
        definitions = getValidatedWorkflowDefinitions(ctx);
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

      const availableToolNames = new Set(ctx.listTools());

      const result = await buildDryRunPlan(definition, {
        payload,
        availableToolNames,
      });

      console.log(formatDryRunResult(result));

      if (!result.pass) {
        process.exit(1);
      }
    });
}
