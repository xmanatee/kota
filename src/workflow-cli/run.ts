import type { Command } from "commander";
import { getBuiltinWorkflowDefinitions } from "../workflow/registry.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "../workflow/validation.js";
import { buildDryRunPlan, formatDryRunPlan } from "./dry-run.js";

export function registerRunCommand(wfCmd: Command): void {
  wfCmd
    .command("run <name>")
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
          getBuiltinWorkflowDefinitions(),
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
