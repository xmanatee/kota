import type { Command } from "commander";
import { deriveProjectId } from "#core/daemon/project-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";

/**
 * `kota workflow exec <name>` — synchronously execute one workflow run to
 * terminal status without going through the daemon control plane or the
 * pending-runs queue. The process exits 0 when the run finishes successfully
 * (including `completed-with-warnings`) and non-zero otherwise.
 *
 * This exists so the eval-harness subprocess executor has a single CLI entry
 * point that actually drives a workflow to completion inside the fixture's
 * isolated working directory. The `trigger` command only enqueues a pending
 * run and is inert without a daemon.
 */
export function registerExecCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("exec <name>")
    .description(
      "Synchronously execute one workflow run to terminal status without a daemon.",
    )
    .option("--event <event>", "Trigger event name", "manual")
    .option("--payload <json>", "JSON object merged into the trigger payload")
    .action(async (
      name: string,
      opts: { event: string; payload?: string },
    ) => {
      let extraPayload: Record<string, unknown> | undefined;
      if (opts.payload !== undefined) {
        try {
          const parsed: unknown = JSON.parse(opts.payload);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("payload must be a JSON object");
          }
          extraPayload = parsed as Record<string, unknown>;
        } catch (err) {
          console.error(`Invalid --payload JSON: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      const definitions = getValidatedWorkflowDefinitions(ctx);
      const definition = definitions.find((d) => d.name === name);
      if (!definition) {
        const names = definitions.map((d) => d.name).join(", ");
        console.error(`Unknown workflow "${name}". Available: ${names}`);
        process.exit(1);
      }
      if (!definition.enabled) {
        console.error(`Workflow "${name}" is disabled.`);
        process.exit(1);
      }

      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, deriveProjectId(ctx.cwd));
      const store = new WorkflowRunStore(ctx.cwd);
      const trigger: WorkflowRunTrigger = {
        event: opts.event,
        payload: {
          ...(extraPayload ?? {}),
          triggeredAt: new Date().toISOString(),
        },
      };

      const { promise } = executeWorkflowRun(definition, trigger, {
        projectDir: ctx.cwd,
        bus,
        pbus,
        store,
        config: ctx.config,
        log: (msg) => console.error(msg),
        resolveAgentDef: ctx.resolveAgentDef,
        resolveSkillsPrompt: ctx.resolveSkillsPrompt,
      });

      const result = await promise;
      console.log(result.metadata.id);
      if (
        result.metadata.status !== "success" &&
        result.metadata.status !== "completed-with-warnings"
      ) {
        process.exitCode = 1;
      }
    });
}
