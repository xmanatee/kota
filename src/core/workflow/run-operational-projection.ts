import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { RunSandbox } from "./run-sandbox.js";
import type { StoredRun } from "./run-state-database.js";
import type { DurableRunState } from "./run-state-types.js";
import type { WorkflowRuntimeOperationalState } from "./runtime-state-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export type OperationalRun = {
  runId: string;
  scopeId: string;
  workflow: string;
  state: DurableRunState;
  resources: string[];
  sandbox: RunSandbox | null;
  wait: Record<string, unknown> | null;
  processes: Record<string, unknown>[];
  lastError: string | null;
};

export type RunOperationalProjection = {
  available: boolean;
  databasePath: string;
  runs: OperationalRun[];
};

type RunProjectionRow = {
  id: string;
  scope_id: string;
  workflow: string;
  state: DurableRunState;
  sandbox_json: string | null;
  wait_json: string | null;
  last_error: string | null;
};

type WorkflowOperationalRow = {
  id: string;
  workflow: string;
  state: Extract<DurableRunState, "queued" | "running" | "integrating">;
  trigger: WorkflowRunTrigger;
  admittedAt: string;
  notBeforeAt?: string;
  startedAt?: string;
};

export type ReadWorkflowOperationalState = WorkflowRuntimeOperationalState & {
  available: boolean;
  databasePath: string;
};

function canonicalPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function timestampMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return parsed;
}

function deriveWorkflowOperationalState(
  runs: readonly WorkflowOperationalRow[],
): WorkflowRuntimeOperationalState {
  return {
    activeRuns: runs.flatMap((run) => {
      if (run.state === "queued") return [];
      if (run.startedAt === undefined) {
        throw new Error(`Active durable run "${run.id}" is missing startedAt`);
      }
      return [{
        runId: run.id,
        workflow: run.workflow,
        startedAt: run.startedAt,
      }];
    }),
    pendingRuns: runs.flatMap((run) => {
      if (run.state !== "queued") return [];
      const enqueuedAtMs = timestampMs(
        run.admittedAt,
        `Durable run "${run.id}" admittedAt`,
      );
      return [{
        runId: run.id,
        workflowName: run.workflow,
        trigger: run.trigger,
        enqueuedAtMs,
        notBeforeMs: run.notBeforeAt === undefined
          ? enqueuedAtMs
          : timestampMs(
              run.notBeforeAt,
              `Durable run "${run.id}" notBeforeAt`,
            ),
      }];
    }),
  };
}

export function deriveStoredWorkflowOperationalState(
  runs: readonly StoredRun[],
): WorkflowRuntimeOperationalState {
  return deriveWorkflowOperationalState(
    runs.flatMap((run): WorkflowOperationalRow[] => {
      if (
        run.state !== "queued" &&
        run.state !== "running" &&
        run.state !== "integrating"
      ) {
        return [];
      }
      return [{
        id: run.id,
        workflow: run.workflow,
        state: run.state,
        trigger: run.trigger,
        admittedAt: run.admittedAt,
        ...(run.notBeforeAt !== undefined
          ? { notBeforeAt: run.notBeforeAt }
          : {}),
        ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
      }];
    }),
  );
}

/** Read queued and active workflow status without mutating the durable database. */
export function readWorkflowOperationalState(input: {
  stateDir: string;
  scopeRoot: string;
}): ReadWorkflowOperationalState {
  const databasePath = join(input.stateDir, "kota.sqlite");
  if (!existsSync(databasePath)) {
    return {
      available: false,
      databasePath,
      activeRuns: [],
      pendingRuns: [],
    };
  }

  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const scope = database
      .prepare("SELECT id FROM scopes WHERE root_path = ?")
      .get(canonicalPath(input.scopeRoot)) as { id: string } | undefined;
    if (scope === undefined) {
      return {
        available: true,
        databasePath,
        activeRuns: [],
        pendingRuns: [],
      };
    }
    const rows = database
      .prepare(
        `SELECT id, workflow, state, trigger_json, admitted_at,
                not_before_at, started_at
         FROM runs
         WHERE scope_id = ? AND state IN ('queued', 'running', 'integrating')
         ORDER BY admitted_at, rowid`,
      )
      .all(scope.id) as Array<{
        id: string;
        workflow: string;
        state: WorkflowOperationalRow["state"];
        trigger_json: string;
        admitted_at: string;
        not_before_at: string | null;
        started_at: string | null;
      }>;
    return {
      available: true,
      databasePath,
      ...deriveWorkflowOperationalState(
        rows.map((row) => ({
          id: row.id,
          workflow: row.workflow,
          state: row.state,
          trigger: JSON.parse(row.trigger_json) as WorkflowRunTrigger,
          admittedAt: row.admitted_at,
          ...(row.not_before_at !== null
            ? { notBeforeAt: row.not_before_at }
            : {}),
          ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
        })),
      ),
    };
  } finally {
    database.close();
  }
}

/** Read operational state without creating or migrating the authoritative database. */
export function readRunOperationalProjection(input: {
  stateDir: string;
  scopeRoot: string;
  states?: readonly DurableRunState[];
}): RunOperationalProjection {
  const databasePath = join(input.stateDir, "kota.sqlite");
  if (!existsSync(databasePath)) {
    return { available: false, databasePath, runs: [] };
  }

  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const scope = database
      .prepare("SELECT id FROM scopes WHERE root_path = ?")
      .get(canonicalPath(input.scopeRoot)) as { id: string } | undefined;
    if (scope === undefined) {
      return { available: true, databasePath, runs: [] };
    }
    const states = input.states ?? [
      "queued",
      "running",
      "integrating",
      "waiting",
      "needs_attention",
    ];
    if (states.length === 0) {
      return { available: true, databasePath, runs: [] };
    }
    const rows = database
      .prepare(
        `SELECT id, scope_id, workflow, state, sandbox_json, wait_json, last_error
         FROM runs
         WHERE scope_id = ? AND state IN (${states.map(() => "?").join(",")})
         ORDER BY admitted_at, rowid`,
      )
      .all(scope.id, ...states) as RunProjectionRow[];
    const resourceQuery = database.prepare(
      `SELECT resource_key FROM run_resource_requests WHERE run_id = ?
       UNION
       SELECT resource_key FROM run_resources WHERE run_id = ?
       ORDER BY resource_key`,
    );
    const processQuery = database.prepare(
      `SELECT p.identity_json FROM run_processes p
       JOIN (
         SELECT run_id, MAX(attempt) AS attempt
         FROM run_attempts WHERE run_id = ? GROUP BY run_id
       ) latest ON latest.run_id = p.run_id AND latest.attempt = p.attempt
       ORDER BY p.process_key`,
    );
    return {
      available: true,
      databasePath,
      runs: rows.map((row) => {
        const resourcePrefix = `scope:${row.scope_id}:`;
        return {
          runId: row.id,
          scopeId: row.scope_id,
          workflow: row.workflow,
          state: row.state,
          resources: resourceQuery
            .all(row.id, row.id)
            .map((item) => (item as { resource_key: string }).resource_key)
            .map((resource) =>
              resource.startsWith(resourcePrefix)
                ? resource.slice(resourcePrefix.length)
                : resource,
            ),
          sandbox: row.sandbox_json === null
            ? null
            : JSON.parse(row.sandbox_json) as RunSandbox,
          wait: row.wait_json === null
            ? null
            : JSON.parse(row.wait_json) as Record<string, unknown>,
          processes: processQuery
            .all(row.id)
            .map((item) =>
              JSON.parse((item as { identity_json: string }).identity_json) as Record<string, unknown>
            ),
          lastError: row.last_error,
        };
      }),
    };
  } finally {
    database.close();
  }
}
