import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import { getWorkflowDefinitions } from "./definitions-source.js";

type ValidationResult = { name: string; valid: boolean; error?: string };

export function validateDefinitions(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  workflowFilter?: string,
): ValidationResult[] {
  const allDefs = [...definitions];
  const defs = workflowFilter ? allDefs.filter((d) => d.name === workflowFilter) : allDefs;

  if (workflowFilter && defs.length === 0) {
    const known = allDefs.map((d) => d.name).join(", ");
    throw new Error(`Unknown workflow "${workflowFilter}". Known: ${known}`);
  }

  return defs.map((def) => {
    try {
      validateWorkflowDefinitions([def]);
      return { name: def.name, valid: true };
    } catch (err) {
      const message = err instanceof WorkflowDefinitionError ? err.message : String(err);
      return { name: def.name, valid: false, error: message };
    }
  });
}

export function registerValidateCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("validate")
    .description("Validate workflow definitions and exit non-zero if any fail")
    .option("--workflow <name>", "Validate a single definition by name")
    .option("--json", "Output structured JSON array of results")
    .action((opts: { workflow?: string; json?: boolean }) => {
      let results: ValidationResult[];
      try {
        results = validateDefinitions(getWorkflowDefinitions(ctx), opts.workflow);
      } catch (err) {
        console.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        const allValid = results.every((r) => r.valid);
        if (!allValid) process.exit(1);
        return;
      }

      for (const r of results) {
        if (r.valid) {
          console.log(`PASS  ${r.name}`);
        } else {
          console.log(`FAIL  ${r.name}: ${r.error}`);
        }
      }

      const failCount = results.filter((r) => !r.valid).length;
      if (results.length > 1) {
        console.log(`\n${results.length - failCount}/${results.length} definitions valid.`);
      }

      if (failCount > 0) process.exit(1);
    });
}
