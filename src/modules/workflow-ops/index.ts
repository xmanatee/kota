/**
 * Workflow ops module — owns the `kota workflow` / `kota automation` CLI surface.
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
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  isWithinDispatchWindow,
  msUntilDispatchWindowOpens,
} from "#core/workflow/dispatch-window.js";
import { formatRunId } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  ABORT_SIGNAL_FILE,
  PAUSE_SIGNAL_FILE,
  RELOAD_SIGNAL_FILE,
} from "#core/workflow/runtime.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { buildTriggerHttpPayload, type WorkflowClient } from "./client.js";
import { registerDefinitionLogCommand } from "./definitions/definition-log.js";
import { registerDefinitionsCommand } from "./definitions/definitions.js";
import { registerDepsCommand } from "./definitions/deps.js";
import { registerValidateCommand } from "./definitions/validate.js";
import { getValidatedWorkflowDefinitions } from "./definitions-source.js";
import { registerControlCommands } from "./execution/control.js";
import { registerExecCommand } from "./execution/exec.js";
import { registerGcCommand } from "./execution/gc.js";
import { registerRunCommand } from "./execution/run.js";
import {
  registerTrialCommand,
  runLocalWorkflowTrial,
  workflowTrialControlRoutes,
} from "./execution/trial.js";
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
    .aliases(["wf", "automation"])
    .description(
      "Inspect automation workflow runs and control the daemon.\n\n" +
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
  registerTrialCommand(wfCmd, ctx);
  registerGcCommand(wfCmd, ctx);

  return wfCmd;
}

const workflowModule: KotaModule = {
  name: "workflow-ops",
  version: "1.0.0",
  description: "Automation workflow CLI surface — kota workflow/automation list/show/run/trial/control/validate/definitions/deps/logs/gc/export/diff/cost/stats",
  dependencies: ["rendering"],
  commands: (ctx) => [buildWorkflowCommand(ctx)],
  routes: (ctx) => workflowRoutes(ctx),
  controlRoutes: (ctx) => workflowTrialControlRoutes(ctx),
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
      async trial(name, options) {
        return runLocalWorkflowTrial(ctx, name, options);
      },
    };
    return { workflow: handler };
  },
  daemonClient: (link) => ({ workflow: buildWorkflowDaemonHandler(link) }),
};

/**
 * Daemon-side `WorkflowClient` backed by the typed `DaemonTransport`. Routes
 * the fourteen `workflow` namespace methods through the daemon HTTP control
 * routes.
 *
 * Wire contract per method (preserved byte-for-byte from the prior core stub):
 *
 *  - `listRuns(filter)` → `GET /workflow/runs[?workflow=...&limit=...&tag=...&causedByRunId=...]`.
 *    Soft-falls through on transport failure: returns `{ runs: [] }`.
 *  - `status(filter?)` → `GET /workflow/status[?projectId=...]`. Throws
 *    `"Daemon unreachable while reading workflow status"` on transport
 *    failure and preserves typed unknown-project route errors. Wraps the daemon's
 *    `WorkflowLiveStatus` with `pendingAbort: false` (the daemon-up branch
 *    never observes a stale abort signal file).
 *  - `pause()` / `resume()` → `POST /workflow/pause` / `/workflow/resume`.
 *    Throws on transport failure.
 *  - `abort()` → `POST /workflow/abort`. Throws on transport failure;
 *    success returns `{ status: "applied", count }`. The `signaled` arm is
 *    daemon-down only.
 *  - `reload()` → `POST /workflow/reload`. Throws on transport failure;
 *    success returns `{ status: "applied", count }`. The `signaled` arm is
 *    daemon-down only.
 *  - `enable(name)` / `disable(name)` → `POST
 *    /workflow/definitions/<encodeURIComponent(name)>/enable` / `/disable`.
 *    Throws on transport failure; 404 → `{ ok: false, reason: "not_found" }`.
 *  - `cancelRun(id)` → `DELETE /workflow/runs/<encodeURIComponent(id)>`.
 *    Throws on transport failure; 404 → `{ ok: false, reason: "not_found" }`,
 *    409 → `{ ok: false, reason: "active" }`.
 *  - `abortRun(id)` → `POST /workflow/runs/<encodeURIComponent(id)>/abort`.
 *    Throws on transport failure; 404 → `{ ok: false, reason: "not_found" }`,
 *    409 → `{ ok: false, reason: "queued" }`.
 *  - `getRun(id)` → `GET /workflow/runs/<encodeURIComponent(id)>`. Soft-falls
 *    through on transport failure: returns `{ found: false }`.
 *  - `listDefinitions()` → `GET /workflow/definitions`. Throws on transport
 *    failure; success returns `{ source: "daemon", definitions }`.
 *  - `triggerByName(name, options)` → `POST /workflow/trigger` with body
 *    `{ name, ...(tags && tags.length > 0 && { tags }), ...(payload && { payload }) }`.
 *    Only the user-extension `payload` survives `buildTriggerHttpPayload`.
 *    Throws on transport failure; 409 → `{ ok: false, reason: "already_queued" }`;
 *    success returns `{ ok: true, path: "daemon", queued: result.queued ?? name,
 *    ...(result.runId !== undefined && { runId: result.runId }) }`.
 *  - `trial(name, options)` → `POST /workflow/trial` with body
 *    `{ name, ...options }`. Transport failure returns the daemon_required arm
 *    so the CLI can use the local isolated-project runner.
 */
export function buildWorkflowDaemonHandler(
  link: DaemonTransport,
): WorkflowClient {
  const fetchJson = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response | null> => {
    try {
      return await link.fetchRaw(path, {
        method,
        ...(body !== undefined && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
    } catch {
      return null;
    }
  };

  return {
    listRuns: async (filter) => {
      const params = new URLSearchParams();
      if (filter?.workflow) params.set("workflow", filter.workflow);
      if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
      if (filter?.tag) params.set("tag", filter.tag);
      if (filter?.causedByRunId) params.set("causedByRunId", filter.causedByRunId);
      if (filter?.projectId) params.set("projectId", filter.projectId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const result = await link.request<{ runs: WorkflowRunSummary[] }>(
        "GET",
        `/workflow/runs${query}`,
      );
      return { runs: result?.runs ?? [] };
    },
    status: async (filter) => {
      const params = new URLSearchParams();
      if (filter?.projectId) params.set("projectId", filter.projectId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const result = await fetchWorkflowStatus(link, `/workflow/status${query}`);
      return { ...result, pendingAbort: false };
    },
    pause: async () => {
      const result = await link.request<{ paused: boolean; already?: boolean }>(
        "POST",
        "/workflow/pause",
      );
      if (!result) throw new Error("Daemon unreachable while pausing dispatch");
      return { paused: result.paused, already: result.already ?? false };
    },
    resume: async () => {
      const result = await link.request<{ paused: boolean; already?: boolean }>(
        "POST",
        "/workflow/resume",
      );
      if (!result) throw new Error("Daemon unreachable while resuming dispatch");
      return { paused: result.paused, already: result.already ?? false };
    },
    abort: async () => {
      const result = await link.request<{ aborted: number }>(
        "POST",
        "/workflow/abort",
      );
      if (!result) {
        throw new Error("Daemon unreachable while aborting active runs");
      }
      return { status: "applied", count: result.aborted };
    },
    reload: async () => {
      const result = await link.request<{ count: number }>(
        "POST",
        "/workflow/reload",
      );
      if (!result) {
        throw new Error("Daemon unreachable while reloading definitions");
      }
      return { status: "applied", count: result.count };
    },
    enable: async (name) => {
      const resp = await fetchJson(
        "POST",
        `/workflow/definitions/${encodeURIComponent(name)}/enable`,
      );
      if (!resp) {
        throw new Error(`Daemon unreachable while enabling workflow "${name}"`);
      }
      if (resp.status === 404) return { ok: false, reason: "not_found" };
      if (!resp.ok) {
        throw new Error(`Daemon unreachable while enabling workflow "${name}"`);
      }
      return { ok: true };
    },
    disable: async (name) => {
      const resp = await fetchJson(
        "POST",
        `/workflow/definitions/${encodeURIComponent(name)}/disable`,
      );
      if (!resp) {
        throw new Error(`Daemon unreachable while disabling workflow "${name}"`);
      }
      if (resp.status === 404) return { ok: false, reason: "not_found" };
      if (!resp.ok) {
        throw new Error(`Daemon unreachable while disabling workflow "${name}"`);
      }
      return { ok: true };
    },
    cancelRun: async (id) => {
      const resp = await fetchJson(
        "DELETE",
        `/workflow/runs/${encodeURIComponent(id)}`,
      );
      if (!resp) {
        throw new Error(`Daemon unreachable while cancelling run "${id}"`);
      }
      if (resp.status === 404) return { ok: false, reason: "not_found" };
      if (resp.status === 409) return { ok: false, reason: "active" };
      if (!resp.ok) {
        throw new Error(`Daemon unreachable while cancelling run "${id}"`);
      }
      return { ok: true };
    },
    abortRun: async (id) => {
      const resp = await fetchJson(
        "POST",
        `/workflow/runs/${encodeURIComponent(id)}/abort`,
      );
      if (!resp) {
        throw new Error(`Daemon unreachable while aborting run "${id}"`);
      }
      if (resp.status === 404) return { ok: false, reason: "not_found" };
      if (resp.status === 409) return { ok: false, reason: "queued" };
      if (!resp.ok) {
        throw new Error(`Daemon unreachable while aborting run "${id}"`);
      }
      return { ok: true };
    },
    getRun: async (id) => {
      const run = await link.request<WorkflowRunDetail>(
        "GET",
        `/workflow/runs/${encodeURIComponent(id)}`,
      );
      return run ? { found: true, run } : { found: false };
    },
    listDefinitions: async () => {
      const result = await link.request<{
        definitions: WorkflowDefinitionSummary[];
      }>("GET", "/workflow/definitions");
      if (!result) {
        throw new Error("Daemon unreachable while listing workflow definitions");
      }
      return { source: "daemon", definitions: result.definitions };
    },
    triggerByName: async (name, options) => {
      const tags = options?.tags;
      const payload = buildTriggerHttpPayload(options);
      const body = {
        name,
        ...(tags && tags.length > 0 && { tags }),
        ...(payload && { payload }),
      };
      const resp = await fetchJson("POST", "/workflow/trigger", body);
      if (!resp) {
        throw new Error(`Daemon unreachable while triggering workflow "${name}"`);
      }
      if (resp.status === 409) {
        return { ok: false, reason: "already_queued" };
      }
      if (!resp.ok) {
        throw new Error(`Daemon unreachable while triggering workflow "${name}"`);
      }
      const result = (await resp.json()) as {
        queued?: string;
        runId?: string;
      };
      return {
        ok: true,
        path: "daemon",
        queued: result.queued ?? name,
        ...(result.runId !== undefined && { runId: result.runId }),
      };
    },
    trial: async (name, options) => {
      const body = {
        name,
        ...(options?.payload !== undefined && { payload: options.payload }),
        ...(options?.repeat !== undefined && { repeat: options.repeat }),
        ...(options?.compareWorkflows !== undefined && { compareWorkflows: options.compareWorkflows }),
        ...(options?.comparePayloads !== undefined && { comparePayloads: options.comparePayloads }),
        ...(options?.projectId !== undefined && { projectId: options.projectId }),
      };
      const resp = await fetchJson("POST", "/workflow/trial", body);
      if (!resp) {
        return {
          ok: false,
          reason: "daemon_required",
          message: `Daemon unreachable while running workflow trial "${name}"`,
        };
      }
      if (!resp.ok) {
        let message = `Workflow trial "${name}" failed`;
        let reason: "invalid_request" | "unknown_workflow" | "unknown_project" = "invalid_request";
        let unknownProjectId: string | undefined;
        try {
          const errorBody = (await resp.json()) as {
            error?: string;
            reason?: "invalid_request" | "unknown_workflow" | "unknown_project";
            projectId?: string;
          };
          if (
            errorBody.reason === "unknown_project" &&
            typeof errorBody.projectId === "string"
          ) {
            unknownProjectId = errorBody.projectId;
          }
          if (typeof errorBody.error === "string") message = errorBody.error;
          if (
            errorBody.reason === "invalid_request" ||
            errorBody.reason === "unknown_workflow" ||
            errorBody.reason === "unknown_project"
          ) {
            reason = errorBody.reason;
          }
        } catch {
          // Use the generic message when the daemon returned a non-JSON body.
        }
        if (unknownProjectId !== undefined) {
          throw new Error(`Unknown project: ${unknownProjectId}`);
        }
        return { ok: false, reason, message };
      }
      return (await resp.json()) as Awaited<ReturnType<WorkflowClient["trial"]>>;
    },
  };
}

type WorkflowRouteErrorBody = {
  error?: string;
  reason?: string;
  projectId?: string;
};

async function fetchWorkflowStatus(
  link: DaemonTransport,
  path: string,
): Promise<WorkflowLiveStatus> {
  let res: Response;
  try {
    res = await link.fetchRaw(path, { method: "GET" });
  } catch {
    throw new Error("Daemon unreachable while reading workflow status");
  }
  if (res.status === 404) {
    const body = await readWorkflowRouteError(res);
    if (body?.reason === "unknown_project" && body.projectId) {
      throw new Error(`Unknown project: ${body.projectId}`);
    }
  }
  if (!res.ok) {
    throw new Error("Daemon unreachable while reading workflow status");
  }
  return (await res.json()) as WorkflowLiveStatus;
}

async function readWorkflowRouteError(
  res: Response,
): Promise<WorkflowRouteErrorBody | null> {
  try {
    const parsed = (await res.json()) as WorkflowRouteErrorBody;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

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
