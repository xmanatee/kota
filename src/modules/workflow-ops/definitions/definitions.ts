import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import { formatDuration } from "../utils.js";

function describeInputSchema(schema: Record<string, unknown>): string | null {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props || Object.keys(props).length === 0) return null;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props)
    .map(([key, propSchema]) => {
      const type = typeof propSchema.type === "string" ? propSchema.type : "any";
      const req = required.has(key) ? "*" : "?";
      return `${key}${req}: ${type}`;
    })
    .join(", ");
}

function describeTrigger(def: RegisteredWorkflowDefinitionInput): string {
  return def.triggers
    .map((t) => {
      if (t.watch) {
        const patterns = Array.isArray(t.watch) ? t.watch.join(",") : t.watch;
        return `watch(${patterns})`;
      }
      if (t.schedule) return `cron(${t.schedule})`;
      if (t.intervalMs) return `interval(${formatDuration(t.intervalMs)})`;
      const event = t.event ?? "?";
      const filter = t.filter ? ` [${Object.entries(t.filter).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(",")}]` : "";
      const cooldown = t.cooldownMs ? ` cooldown=${formatDuration(t.cooldownMs)}` : "";
      return `${event}${filter}${cooldown}`;
    })
    .join(" | ");
}

function describeStep(step: WorkflowStepInput): string {
  if (step.type === "parallel") {
    return `parallel[${step.steps.map((s) => s.id).join(",")}]`;
  }
  const extras: string[] = [];
  if (step.type === "agent") {
    if (step.agentName) extras.push(`agent=${step.agentName}`);
    else if (step.promptPath) extras.push(`prompt=${step.promptPath}`);
    extras.push(`effort=${step.effort}`);
    if (step.timeoutMs != null) extras.push(`timeout=${formatDuration(step.timeoutMs)}`);
  }
  if (step.type === "tool") extras.push(`tool=${step.tool}`);
  if (step.type === "emit") extras.push(`event=${step.event}`);
  if (step.continueOnFailure) extras.push("continueOnFailure");
  const suffix = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  return `[${step.type}] ${step.id}${suffix}`;
}

export function registerDefinitionsCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("definitions")
    .description("List loaded workflow definitions with triggers and configuration")
    .option("-n, --name <name>", "Show full detail for a single definition")
    .option("--json", "Output as JSON")
    .action((opts: { name?: string; json?: boolean }) => {
      let definitions: ReturnType<typeof getValidatedWorkflowDefinitions>;
      try {
        definitions = getValidatedWorkflowDefinitions(ctx);
      } catch (err) {
        printWorkflowError(String(err instanceof Error ? err.message : err));
        process.exit(1);
      }

      if (opts.name) {
        const def = definitions.find((d) => d.name === opts.name);
        if (!def) {
          const names = definitions.map((d) => d.name).join(", ");
          printWorkflowError(`Unknown workflow "${opts.name}". Known: ${names}`);
          process.exit(1);
        }
        if (opts.json) {
          printWorkflowText(JSON.stringify(def, null, 2));
          return;
        }
        printWorkflowText(`Name:        ${def.name}`);
        printWorkflowText(`Enabled:     ${def.enabled !== false ? "yes" : "no"}`);
        if (def.description) printWorkflowText(`Description: ${def.description}`);
        printWorkflowText(`Source:      ${def.definitionPath}`);
        if (def.runTimeoutMs != null) printWorkflowText(`Run timeout:  ${formatDuration(def.runTimeoutMs)}`);
        if (def.inputSchema) {
          const fields = describeInputSchema(def.inputSchema);
          printWorkflowText(`\nInputs:`);
          if (fields) {
            const props = (def.inputSchema.properties as Record<string, Record<string, unknown>>) ?? {};
            const required = new Set(((def.inputSchema.required as string[] | undefined) ?? []));
            for (const [key, propSchema] of Object.entries(props)) {
              const type = typeof propSchema.type === "string" ? propSchema.type : "any";
              const req = required.has(key) ? " (required)" : " (optional)";
              const desc = typeof propSchema.description === "string" ? ` — ${propSchema.description}` : "";
              printWorkflowText(`  ${key}: ${type}${req}${desc}`);
            }
          } else {
            printWorkflowText(`  (no properties defined)`);
          }
        }
        if (def.concurrencyGroup) printWorkflowText(`Concurrency: ${def.concurrencyGroup}`);
        printWorkflowText(`\nTriggers (${def.triggers.length}):`);
        for (const t of def.triggers) {
          const cooldown = t.cooldownMs ? ` cooldown=${formatDuration(t.cooldownMs)}` : "";
          if (t.watch) {
            const patterns = Array.isArray(t.watch) ? t.watch.join(", ") : t.watch;
            const debounce = t.debounceMs ? ` debounce=${formatDuration(t.debounceMs)}` : "";
            printWorkflowText(`  watch: ${patterns}${debounce}`);
          } else if (t.schedule) {
            printWorkflowText(`  cron: ${t.schedule}${cooldown}`);
          } else if (t.intervalMs) {
            printWorkflowText(`  interval: ${formatDuration(t.intervalMs)}${cooldown}`);
          } else {
            const filter = t.filter
              ? `\n    filter: ${JSON.stringify(t.filter)}`
              : "";
            printWorkflowText(`  event: ${t.event ?? "?"}${cooldown}${filter}`);
          }
        }
        printWorkflowText(`\nSteps (${def.steps.length}):`);
        for (const step of def.steps) {
          printWorkflowText(`  ${describeStep(step)}`);
          if (step.type === "parallel") {
            for (const s of step.steps) printWorkflowText(`    ║ ${describeStep(s)}`);
          }
        }
        return;
      }

      if (opts.json) {
        printWorkflowText(JSON.stringify(definitions, null, 2));
        return;
      }

      const nameWidth = Math.max(...definitions.map((d) => d.name.length), 8);
      const enWidth = 7;
      const stepsWidth = 5;
      printWorkflowText(
        `${"Name".padEnd(nameWidth)}  ${"Enabled".padEnd(enWidth)}  ${"Steps".padEnd(stepsWidth)}  Triggers`,
      );
      printWorkflowText("-".repeat(nameWidth + enWidth + stepsWidth + 20));
      for (const def of definitions) {
        const name = def.name.padEnd(nameWidth);
        const enabled = (def.enabled !== false ? "yes" : "no").padEnd(enWidth);
        const steps = String(def.steps.length).padEnd(stepsWidth);
        const triggers = describeTrigger(def);
        printWorkflowText(`${name}  ${enabled}  ${steps}  ${triggers}`);
      }
      printWorkflowText(`\n${definitions.length} definition(s) loaded.`);
      if (definitions.some((d) => d.runTimeoutMs != null)) {
        printWorkflowText("\nConfig:");
        for (const def of definitions) {
          if (def.runTimeoutMs != null) {
            printWorkflowText(`  ${def.name}: timeout=${formatDuration(def.runTimeoutMs)}`);
          }
        }
      }
      if (definitions.some((d) => d.inputSchema != null)) {
        printWorkflowText("\nInputs:");
        for (const def of definitions) {
          if (def.inputSchema != null) {
            const fields = describeInputSchema(def.inputSchema);
            printWorkflowText(`  ${def.name}: ${fields ?? "(no properties defined)"}`);
          }
        }
      }
    });
}
