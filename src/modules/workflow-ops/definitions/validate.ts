import type { Command } from "commander";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ModelTiers } from "#core/model/model-router.js";
import { PRESET_ENV_VAR, type Preset, resolvePreset } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import { getWorkflowDefinitions } from "../definitions-source.js";

type ValidationResult = {
  name: string;
  valid: boolean;
  scope: "definition" | "global";
  error?: string;
};

type ValidateDefinitionsOptions = {
  workflow?: string;
  projectDir?: string;
  defaultAgentHarness?: string;
  preset?: Preset;
  modelTiers?: ModelTiers;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
};

export function validateDefinitions(
  definitions: readonly RegisteredWorkflowDefinitionInput[],
  options: ValidateDefinitionsOptions = {},
): ValidationResult[] {
  const allDefs = [...definitions];
  const defs = options.workflow
    ? allDefs.filter((d) => d.name === options.workflow)
    : allDefs;

  if (options.workflow && defs.length === 0) {
    const known = allDefs.map((d) => d.name).join(", ");
    throw new Error(`Unknown workflow "${options.workflow}". Known: ${known}`);
  }

  const definitionResults = defs.map((def) => {
    try {
      validateWorkflowDefinitions(
        [def],
        options.projectDir,
        {
          defaultAgentHarness: options.defaultAgentHarness,
          preset: options.preset,
          modelTiers: options.modelTiers,
          resolveAgentDef: options.resolveAgentDef,
        },
      );
      return { name: def.name, valid: true, scope: "definition" as const };
    } catch (err) {
      const message = err instanceof WorkflowDefinitionError ? err.message : String(err);
      return {
        name: def.name,
        valid: false,
        scope: "definition" as const,
        error: message,
      };
    }
  });

  const results: ValidationResult[] = [];
  if (!options.workflow) {
    try {
      validateWorkflowDefinitions(
        allDefs,
        options.projectDir,
        {
          defaultAgentHarness: options.defaultAgentHarness,
          preset: options.preset,
          modelTiers: options.modelTiers,
          resolveAgentDef: options.resolveAgentDef,
        },
      );
    } catch (err) {
      if (definitionResults.every((result) => result.valid)) {
        const message = err instanceof WorkflowDefinitionError ? err.message : String(err);
        results.push({
          name: "<global>",
          valid: false,
          scope: "global",
          error: message,
        });
      }
    }
  }

  return results.concat(definitionResults);
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
        const { preset } = resolvePreset({
          env: process.env[PRESET_ENV_VAR],
          config: ctx.config.defaultPreset,
        });
        results = validateDefinitions(getWorkflowDefinitions(ctx), {
          workflow: opts.workflow,
          projectDir: ctx.cwd,
          defaultAgentHarness: ctx.config.defaultAgentHarness ?? preset.harness,
          preset,
          modelTiers: ctx.config.modelTiers,
          resolveAgentDef: ctx.resolveAgentDef,
        });
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

      const definitionResults = results.filter((r) => r.scope === "definition");
      const definitionFailures = definitionResults.filter((r) => !r.valid).length;
      const globalFailures = results.filter((r) => r.scope === "global" && !r.valid).length;
      if (definitionResults.length > 1) {
        console.log(
          `\n${definitionResults.length - definitionFailures}/${definitionResults.length} definitions valid.`,
        );
      }
      if (globalFailures > 0) {
        console.log(`${globalFailures} global validation issue(s).`);
      }

      if (results.some((r) => !r.valid)) process.exit(1);
    });
}
