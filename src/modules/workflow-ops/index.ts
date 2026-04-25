/**
 * Workflow ops module — owns the `kota workflow` CLI surface.
 *
 * Registers all workflow subcommands: run list/show/step-inspect/follow/trigger,
 * control (pause/resume/abort/reload), validate, definitions, logs, gc, export,
 * diff, cost, and stats.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type {
  WorkflowDefinitionSummary,
  WorkflowDefinitionTriggerSummary,
  WorkflowRunDetail,
} from "#core/daemon/daemon-control.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowClient } from "#core/server/kota-client.js";
import {
  isWithinDispatchWindow,
  msUntilDispatchWindowOpens,
} from "#core/workflow/dispatch-window.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { formatRunId } from "#core/workflow/run-store-helpers.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "#core/workflow/runtime.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowRunTrigger,
} from "#core/workflow/types.js";
import { registerDefinitionLogCommand } from "./definitions/definition-log.js";
import { registerDefinitionsCommand } from "./definitions/definitions.js";
import { registerDepsCommand } from "./definitions/deps.js";
import { registerValidateCommand } from "./definitions/validate.js";
import { getValidatedWorkflowDefinitions } from "./definitions-source.js";
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
  registerRunShowCommand(wfCmd, ctx);
  registerStepInspectCommand(wfCmd);
  registerRunDiffCommand(wfCmd);
  registerDefinitionsCommand(wfCmd, ctx);
  registerDepsCommand(wfCmd, ctx);
  registerDefinitionLogCommand(wfCmd, ctx);
  registerCostCommand(wfCmd, ctx);
  registerLogsCommand(wfCmd);
  registerFollowCommand(wfCmd);
  registerTriggerCommands(wfCmd, ctx);
  registerTriggersCommand(wfCmd, ctx);
  registerExecCommand(wfCmd, ctx);
  registerValidateCommand(wfCmd, ctx);
  registerControlCommands(wfCmd, ctx);
  registerRunCommand(wfCmd, ctx);
  registerGcCommand(wfCmd, ctx);

  return wfCmd;
}

const workflowModule: KotaModule = {
  name: "workflow-ops",
  version: "1.0.0",
  description: "Workflow CLI surface — kota workflow list/show/run/control/validate/definitions/deps/logs/gc/export/diff/cost/stats",
  dependencies: ["rendering"],
  commands: (ctx) => [buildWorkflowCommand(ctx)],
  routes: (ctx) => workflowRoutes(ctx),
  localClient: (ctx) => {
    const handler: WorkflowClient = {
      async listRuns(filter) {
        const store = new WorkflowRunStore(ctx.cwd);
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
      async status() {
        const store = new WorkflowRunStore(ctx.cwd);
        const state = store.readState();
        const config = loadConfig(ctx.cwd);
        const dispatchWindow = config.scheduler?.dispatchWindow;
        const windowBlocked = dispatchWindow ? !isWithinDispatchWindow(dispatchWindow) : false;
        const windowOpensAt =
          windowBlocked && dispatchWindow
            ? new Date(Date.now() + msUntilDispatchWindowOpens(dispatchWindow)).toISOString()
            : undefined;
        const activeRuns = state.activeRuns ?? [];
        return {
          activeRuns,
          pendingRuns: state.pendingRuns,
          queueLength: state.pendingRuns.length,
          completedRuns: state.completedRuns,
          ...(state.totalCostUsd !== undefined && { totalCostUsd: state.totalCostUsd }),
          ...(state.agentBackoff && { agentBackoff: state.agentBackoff }),
          ...(state.definitionsLoadedAt && { definitionsLoadedAt: state.definitionsLoadedAt }),
          workflows: state.workflows,
          paused: existsSync(join(store.rootDir, PAUSE_SIGNAL_FILE)),
          pendingAbort: existsSync(join(store.rootDir, ABORT_SIGNAL_FILE)),
          ...(windowBlocked && { dispatchWindowBlocked: true }),
          ...(windowOpensAt && { dispatchWindowOpensAt: windowOpensAt }),
          agentConcurrency: config.scheduler?.agentConcurrency ?? 1,
          codeConcurrency: config.scheduler?.codeConcurrency ?? 4,
        };
      },
      async pause() {
        const store = new WorkflowRunStore(ctx.cwd);
        const pausePath = join(store.rootDir, PAUSE_SIGNAL_FILE);
        if (existsSync(pausePath)) return { paused: true, already: true };
        writeFileSync(pausePath, "");
        return { paused: true, already: false };
      },
      async resume() {
        const store = new WorkflowRunStore(ctx.cwd);
        const pausePath = join(store.rootDir, PAUSE_SIGNAL_FILE);
        if (!existsSync(pausePath)) return { paused: false, already: true };
        rmSync(pausePath);
        return { paused: false, already: false };
      },
      async abort() {
        const store = new WorkflowRunStore(ctx.cwd);
        const state = store.readState();
        const activeRuns = state.activeRuns ?? [];
        if (activeRuns.length === 0) {
          return { status: "signaled", runs: [] };
        }
        const signalPath = join(store.rootDir, ABORT_SIGNAL_FILE);
        writeFileSync(signalPath, "");
        return {
          status: "signaled",
          runs: activeRuns.map((r) => ({ runId: r.runId, workflow: r.workflow })),
        };
      },
      async reload() {
        const store = new WorkflowRunStore(ctx.cwd);
        const reloadPath = join(store.rootDir, RELOAD_SIGNAL_FILE);
        writeFileSync(reloadPath, "");
        return { status: "signaled" };
      },
      async enable(_name) {
        return { ok: false, reason: "daemon_required" };
      },
      async disable(_name) {
        return { ok: false, reason: "daemon_required" };
      },
      async cancelRun(_id) {
        return { ok: false, reason: "daemon_required" };
      },
      async abortRun(_id) {
        return { ok: false, reason: "daemon_required" };
      },
      async getRun(id) {
        const store = new WorkflowRunStore(ctx.cwd);
        const meta = readRunMetadata(store, id);
        if (!meta) return { found: false };
        return { found: true, run: runDetailFromMetadata(meta) };
      },
      async listDefinitions() {
        const definitions = getValidatedWorkflowDefinitions(ctx);
        return {
          source: "static",
          definitions: definitions.map(toDefinitionSummary),
        };
      },
      async triggerByName(name, options) {
        const store = new WorkflowRunStore(ctx.cwd);
        const state = store.readState();
        if (state.pendingRuns.some((r) => r.workflowName === name)) {
          return { ok: false, reason: "already_queued" };
        }
        const now = Date.now();
        const runId = options?.runId ?? formatRunId(name);
        const tags = options?.tags;
        const trigger: WorkflowRunTrigger = {
          event: options?.event ?? "manual",
          payload: {
            ...(options?.payload ?? {}),
            triggeredAt: new Date().toISOString(),
            ...(tags && tags.length > 0 && { tags }),
          },
        };
        const notBeforeMs = options?.notBeforeMs ?? now;
        store.setPendingRuns([
          ...state.pendingRuns,
          { runId, workflowName: name, trigger, enqueuedAtMs: now, notBeforeMs },
        ]);
        return { ok: true, path: "queue", queued: name, runId };
      },
    };
    return { workflow: handler };
  },
};

/**
 * Read a single run's `metadata.json`. The CLI's `run show` and chain-tree
 * code accept either daemon `WorkflowRunDetail` or store `WorkflowRunMetadata`,
 * so the local handler returns the metadata file as-is and the caller maps it
 * onto the contract's discriminated result.
 */
function readRunMetadata(
  store: WorkflowRunStore,
  id: string,
): WorkflowRunMetadata | null {
  return store.getRun(id);
}

/**
 * Project a stored `WorkflowRunMetadata` onto the daemon-shaped
 * `WorkflowRunDetail` so callers consume one shape regardless of source.
 * Step `error`/`costUsd`/`skipReason` round-trip; `definitionPath` and the
 * step `startedAt`/`completedAt` timestamps are not part of `WorkflowRunDetail`
 * so they drop out of the projection.
 */
function runDetailFromMetadata(meta: WorkflowRunMetadata): WorkflowRunDetail {
  const steps = meta.steps.map((step) => ({
    id: step.id,
    type: step.type,
    status: step.status,
    durationMs: step.durationMs,
    ...(step.error !== undefined && { error: step.error }),
    ...(step.costUsd !== undefined && { costUsd: step.costUsd }),
    ...(step.skipReason !== undefined && { skipReason: step.skipReason }),
  }));
  return {
    id: meta.id,
    workflow: meta.workflow,
    status: meta.status,
    triggerEvent: meta.trigger.event,
    startedAt: meta.startedAt,
    ...(meta.completedAt !== undefined && { completedAt: meta.completedAt }),
    ...(meta.durationMs !== undefined && { durationMs: meta.durationMs }),
    ...(meta.totalCostUsd !== undefined && { totalCostUsd: meta.totalCostUsd }),
    ...(meta.triggeredByRunId !== undefined && { triggeredByRunId: meta.triggeredByRunId }),
    ...(meta.causedBy !== undefined && { causedBy: meta.causedBy }),
    ...(meta.retryOf !== undefined && { retryOf: meta.retryOf }),
    ...(meta.resumedFromRunId !== undefined && { resumedFromRunId: meta.resumedFromRunId }),
    ...(meta.tags !== undefined && { tags: meta.tags }),
    ...(meta.trigger.payload && { triggerPayload: meta.trigger.payload }),
    steps,
    ...(meta.warnings !== undefined && { warnings: meta.warnings }),
  };
}

/**
 * Project a registered (static) workflow definition onto the daemon
 * `WorkflowDefinitionSummary` shape. The static view has no runtime override,
 * so `runtimeEnabled` is omitted; `inputSchema`/`outputSchema` round-trip
 * unchanged when present on the definition.
 */
function toDefinitionSummary(
  def: RegisteredWorkflowDefinitionInput,
): WorkflowDefinitionSummary {
  const triggers: WorkflowDefinitionTriggerSummary[] = def.triggers.map(
    (t): WorkflowDefinitionTriggerSummary => {
      if (t.schedule) return { type: "cron", schedule: t.schedule };
      if (t.intervalMs !== undefined) return { type: "interval", intervalMs: t.intervalMs };
      if (t.webhook === true) return { type: "webhook" };
      if (t.watch !== undefined) {
        const patterns = Array.isArray(t.watch) ? t.watch : [t.watch];
        return { type: "watch", patterns, debounceMs: t.debounceMs ?? 500 };
      }
      return {
        type: "event",
        event: t.event ?? "",
        ...(t.filter !== undefined && { filter: stringifyFilter(t.filter) }),
      };
    },
  );
  return {
    name: def.name,
    enabled: def.enabled !== false,
    stepCount: def.steps.length,
    triggers,
    ...(def.inputSchema !== undefined && { inputSchema: def.inputSchema }),
    ...(def.outputSchema !== undefined && { outputSchema: def.outputSchema }),
  };
}

/**
 * Daemon `WorkflowDefinitionTriggerSummary.filter` is `Record<string, string |
 * string[]>`; the static `WorkflowTriggerInput.filter` allows numeric and
 * boolean scalars too. Coerce non-string scalars to their string form so the
 * static-source listing serializes through the same shape the daemon-up
 * listing would carry. Loss-of-fidelity only matters for display; runtime
 * filter matching is owned by the daemon, never by this listing.
 */
function stringifyFilter(
  filter: NonNullable<RegisteredWorkflowDefinitionInput["triggers"][number]["filter"]>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value)) {
      out[key] = value.map(String);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

export default workflowModule;
