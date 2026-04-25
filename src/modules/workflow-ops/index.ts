/**
 * Workflow ops module — owns the `kota workflow` CLI surface.
 *
 * Registers all workflow subcommands: run list/show/step-inspect/follow/trigger,
 * control (pause/resume/abort/reload), validate, definitions, logs, gc, export,
 * diff, cost, and stats.
 */

import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowClient } from "#core/server/kota-client.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { registerDefinitionLogCommand } from "./definitions/definition-log.js";
import { registerDefinitionsCommand } from "./definitions/definitions.js";
import { registerDepsCommand } from "./definitions/deps.js";
import { registerValidateCommand } from "./definitions/validate.js";
import { registerControlCommands } from "./execution/control.js";
import { registerExecCommand } from "./execution/exec.js";
import { registerGcCommand } from "./execution/gc.js";
import { registerRunCommand } from "./execution/run.js";
import { registerTriggerCommands } from "./execution/trigger.js";
import { registerTriggersCommand } from "./execution/triggers.js";
import { workflowRoutes } from "./routes/routes.js";
import { registerFollowCommand } from "./runs/follow.js";
import { registerLogsCommand } from "./runs/logs.js";
import { registerCostCommand } from "./runs/run-cost.js";
import { registerRunDiffCommand } from "./runs/run-diff.js";
import { registerExportCommand } from "./runs/run-export.js";
import { registerRunListCommands } from "./runs/run-list.js";
import { registerRunShowCommand } from "./runs/run-show.js";
import { registerStatsCommand } from "./runs/run-stats.js";
import { registerStepInspectCommand } from "./runs/step-inspect.js";
import { listRuns } from "./utils.js";

export function buildWorkflowCommand(ctx: ModuleContext): Command {
  const wfCmd = new Command("workflow")
    .alias("wf")
    .description(
      "Inspect workflow runs and control the daemon.\n\n" +
        "  Control commands (status, pause, resume, abort, reload) use the daemon\n" +
        "  control API when a daemon is running, and fall back to signal files when\n" +
        "  no daemon is reachable.\n\n" +
        "  Inspection commands (list, show, definitions, logs, follow) read artifacts\n" +
        "  or static definitions directly.",
    );

  registerRunListCommands(wfCmd, ctx);
  registerStatsCommand(wfCmd);
  registerExportCommand(wfCmd);
  registerRunShowCommand(wfCmd);
  registerStepInspectCommand(wfCmd);
  registerRunDiffCommand(wfCmd);
  registerDefinitionsCommand(wfCmd, ctx);
  registerDepsCommand(wfCmd, ctx);
  registerDefinitionLogCommand(wfCmd, ctx);
  registerCostCommand(wfCmd);
  registerLogsCommand(wfCmd);
  registerFollowCommand(wfCmd);
  registerTriggerCommands(wfCmd, ctx);
  registerTriggersCommand(wfCmd, ctx);
  registerExecCommand(wfCmd, ctx);
  registerValidateCommand(wfCmd, ctx);
  registerControlCommands(wfCmd);
  registerRunCommand(wfCmd, ctx);
  registerGcCommand(wfCmd);

  return wfCmd;
}

const workflowModule: KotaModule = {
  name: "workflow-ops",
  version: "1.0.0",
  description: "Workflow CLI surface — kota workflow list/show/run/control/validate/definitions/deps/logs/gc/export/diff/cost/stats",
  dependencies: ["rendering"],
  commands: (ctx) => [buildWorkflowCommand(ctx)],
  routes: (ctx) => workflowRoutes(ctx),
  localClient: () => {
    const handler: WorkflowClient = {
      async listRuns(filter) {
        const store = new WorkflowRunStore();
        const limit = filter?.limit ?? 60;
        const runs = filter?.causedByRunId
          ? store.listRuns({ causedByRunId: filter.causedByRunId, limit })
          : listRuns(store, limit);
        const filtered = filter?.workflow
          ? runs.filter((r) => r.workflow === filter.workflow)
          : runs;
        const tagFiltered = filter?.tag
          ? filtered.filter((r) => (r.tags ?? []).includes(filter.tag as string))
          : filtered;
        return {
          runs: tagFiltered.map((r) => ({
            id: r.id,
            workflow: r.workflow,
            status: r.status,
            triggerEvent: r.trigger.event,
            startedAt: r.startedAt,
            durationMs: r.durationMs,
            totalCostUsd: r.totalCostUsd,
            triggeredByRunId: r.triggeredByRunId,
            causedBy: r.causedBy,
            retryOf: r.retryOf,
            resumedFromRunId: r.resumedFromRunId,
            tags: r.tags,
          })),
        };
      },
    };
    return { workflow: handler };
  },
};

export default workflowModule;
