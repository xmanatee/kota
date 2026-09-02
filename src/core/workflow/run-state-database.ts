import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import type { RunSandbox } from "./run-sandbox.js";
import {
  initializeRunStateSchema,
  RUN_STATE_SCHEMA_VERSION,
} from "./run-state-schema.js";
import {
  AdmissionKeyConflictError,
  type AdmittedRun,
  type DurableRunState,
  type PendingRunPublication,
  PublicationIntentConflictError,
  type RestartRecoveryAttempt,
  type RunAdmissionDisposition,
  type RunAdmissionIdentity,
  type RunPublication,
  type RunSuspensionState,
  type ScopeStateValue,
  StaleDaemonEpochError,
  StateValueConflictError,
  type StoredExternalEffect,
  type StoredRun,
  type TerminalRunState,
} from "./run-state-types.js";
import type {
  WorkflowRunStatus,
  WorkflowRuntimeSummary,
} from "./runtime-state-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export type {
  AdmittedRun,
  DurableRunState,
  RunAdmissionDisposition,
  StoredRun,
} from "./run-state-types.js";
export {
  AdmissionKeyConflictError,
  PublicationIntentConflictError,
  StaleDaemonEpochError,
  StateValueConflictError,
} from "./run-state-types.js";

type RunRow = {
  id: string;
  scope_id: string;
  workflow: string;
  trigger_json: string;
  repository_access: StoredRun["repository"];
  state: DurableRunState;
  admitted_at: string;
  not_before_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  sandbox_json: string | null;
  integration_json: string | null;
  wait_json: string | null;
  last_error: string | null;
  result_status: WorkflowRunStatus | null;
};

type AdmissionResolution =
  | { disposition: "new" }
  | { disposition: "duplicate"; runId: string }
  | { disposition: "redelivery"; previousRunId: string };

function terminalResultStatus(state: TerminalRunState): WorkflowRunStatus {
  if (state === "succeeded") return "success";
  if (state === "cancelled") return "interrupted";
  return "failed";
}

export class RunStateDatabase {
  readonly path: string;
  private readonly database: Database.Database;

  constructor(
    stateDir: string,
    mode: "create-or-migrate" | "existing" | "read-only" = "create-or-migrate",
  ) {
    if (mode === "create-or-migrate") mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, "kota.sqlite");
    this.database = new Database(this.path, {
      fileMustExist: mode !== "create-or-migrate",
      readonly: mode === "read-only",
    });
    if (mode === "create-or-migrate") {
      this.database.pragma("journal_mode = WAL");
    }
    this.database.pragma("foreign_keys = ON");
    if (mode !== "read-only") this.database.pragma("synchronous = FULL");
    if (mode === "create-or-migrate") {
      initializeRunStateSchema(this.database);
    } else {
      const version = this.database.pragma("user_version", { simple: true }) as number;
      if (version !== RUN_STATE_SCHEMA_VERSION) {
        this.database.close();
        throw new Error(
          `Run state schema version ${version} requires daemon-owned migration to ${RUN_STATE_SCHEMA_VERSION}`,
        );
      }
    }
  }

  static openExisting(stateDir: string): RunStateDatabase {
    return new RunStateDatabase(stateDir, "existing");
  }

  static openReadOnly(stateDir: string): RunStateDatabase {
    return new RunStateDatabase(stateDir, "read-only");
  }

  close(): void {
    this.database.close();
  }

  registerScope(input: {
    id: string;
    rootPath: string;
    displayName?: string;
    createdAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO scopes (id, root_path, display_name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           root_path = excluded.root_path,
           display_name = excluded.display_name`,
      )
      .run(input.id, resolve(input.rootPath), input.displayName ?? null, input.createdAt);
  }

  /** Remove a prepared scope only when it never admitted durable work. */
  removeUnadmittedScope(scopeId: string): boolean {
    return this.database.transaction(() => {
      const run = this.database
        .prepare("SELECT id FROM runs WHERE scope_id = ? LIMIT 1")
        .get(scopeId) as { id: string } | undefined;
      if (run !== undefined) {
        throw new Error(
          `Cannot remove prepared run-state scope ${scopeId}: durable run ${run.id} exists`,
        );
      }
      return this.database
        .prepare("DELETE FROM scopes WHERE id = ?")
        .run(scopeId).changes === 1;
    })();
  }

  getScopeIdByRootPath(rootPath: string): string | null {
    const row = this.database
      .prepare("SELECT id FROM scopes WHERE root_path = ?")
      .get(resolve(rootPath)) as { id: string } | undefined;
    return row?.id ?? null;
  }

  beginDaemonSession(startedAt: string): {
    epoch: number;
    recovered: RestartRecoveryAttempt[];
  } {
    return this.database.transaction((): {
      epoch: number;
      recovered: RestartRecoveryAttempt[];
    } => {
      const epoch = this.currentEpoch() + 1;
      this.database
        .prepare("UPDATE daemon_state SET epoch = ?, started_at = ? WHERE singleton = 1")
        .run(epoch, startedAt);
      const recovered = this.database
        .prepare(
          `SELECT r.id AS run_id,
                  COALESCE(a.daemon_epoch, r.daemon_epoch, 0) AS previous_epoch,
                  a.attempt
           FROM runs r
           LEFT JOIN run_attempts a ON a.run_id = r.id AND (
             (r.state IN ('running', 'integrating') AND a.state = 'running') OR
             (r.state = 'needs_attention'
               AND json_extract(r.wait_json, '$.reason') = 'daemon-restart-process-recovery'
               AND a.state = 'recovery-pending')
           )
           WHERE r.state IN ('running', 'integrating') OR (
             r.state = 'needs_attention'
             AND json_extract(r.wait_json, '$.reason') = 'daemon-restart-process-recovery'
           )
           ORDER BY r.id`,
        )
        .all()
        .map((row) => {
          const value = row as {
            run_id: string;
            previous_epoch: number;
            attempt: number | null;
          };
          return {
            runId: value.run_id,
            previousEpoch: value.previous_epoch,
            processes: value.attempt === null
              ? []
              : this.database
                  .prepare(
                    `SELECT identity_json FROM run_processes
                     WHERE run_id = ? AND attempt = ? ORDER BY process_key`,
                  )
                  .all(value.run_id, value.attempt)
                  .map((processRow) =>
                    JSON.parse((processRow as { identity_json: string }).identity_json) as Record<string, unknown>
                  ),
          } satisfies RestartRecoveryAttempt;
        });
      this.database
        .prepare(
          "UPDATE run_attempts SET state = 'recovery-pending' WHERE state = 'running'",
        )
        .run();
      this.database
        .prepare(
          `UPDATE runs
           SET state = 'needs_attention', daemon_epoch = NULL,
               wait_json = '{"reason":"daemon-restart-process-recovery"}'
           WHERE state IN ('running', 'integrating')`,
        )
        .run();
      return { epoch, recovered };
    })();
  }

  completeRestartRecovery(runId: string, epoch: number, recoveredAt: string): void {
    this.database.transaction(() => {
      this.assertCurrentEpoch(epoch);
      const attempt = this.database
        .prepare(
          `UPDATE run_attempts
           SET state = 'lost', finished_at = ?
           WHERE run_id = ? AND state = 'recovery-pending'`,
        )
        .run(recoveredAt, runId);
      if (attempt.changes !== 1) {
        throw new Error(`Run "${runId}" has no restart recovery pending`);
      }
      this.database.prepare("DELETE FROM run_processes WHERE run_id = ?").run(runId);
      this.releaseAttemptResources(runId);
      const run = this.database
        .prepare(
          `UPDATE runs
           SET state = 'queued', not_before_at = ?, wait_json = NULL,
               finished_at = NULL, last_error = NULL
           WHERE id = ? AND state = 'needs_attention'
             AND json_extract(wait_json, '$.reason') = 'daemon-restart-process-recovery'`,
        )
        .run(recoveredAt, runId);
      if (run.changes !== 1) {
        throw new Error(`Run "${runId}" is not awaiting restart recovery`);
      }
    })();
  }

  preserveBlockedRestartRecovery(runId: string): void {
    const recovery = this.database
      .prepare(
        `SELECT 1 FROM runs
         WHERE id = ? AND state = 'needs_attention'
           AND json_extract(wait_json, '$.reason') = 'daemon-restart-process-recovery'`,
      )
      .get(runId);
    if (recovery === undefined) {
      throw new Error(`Run "${runId}" is not awaiting restart recovery`);
    }
  }

  admitRun(input: AdmittedRun): RunAdmissionDisposition {
    return this.database.transaction((): RunAdmissionDisposition => {
      const admission = input.admission
        ? this.resolveAdmission(input.admission)
        : ({ disposition: "new" } as const);
      if (admission.disposition === "duplicate") {
        return { status: "duplicate", runId: admission.runId };
      }
      const existing = this.getRun(input.id);
      if (existing) {
        if (admission.disposition === "redelivery") {
          throw new Error(
            `Terminal admission redelivery requires a fresh run id; "${input.id}" already exists`,
          );
        }
        const sameContract =
          existing.scopeId === input.scopeId &&
          existing.workflow === input.workflow &&
          existing.repository === input.repository &&
          JSON.stringify(existing.trigger) === JSON.stringify(input.trigger) &&
          JSON.stringify(this.requestedResources(input.id, existing.scopeId)) ===
            JSON.stringify([...new Set(input.resources)].sort());
        if (!sameContract) {
          throw new Error(`Run id "${input.id}" was reused with a different contract`);
        }
        if (input.admission !== undefined) {
          this.insertAdmission(input.admission, input.id, input.admittedAt);
        }
        return { status: "duplicate", runId: input.id };
      }
      this.database
        .prepare(
          `INSERT INTO runs
            (id, scope_id, workflow, trigger_json, repository_access, state,
             admitted_at, not_before_at)
           VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
        )
        .run(
          input.id,
          input.scopeId,
          input.workflow,
          JSON.stringify(input.trigger),
          input.repository,
          input.admittedAt,
          input.notBeforeAt ?? null,
        );

      const insert = this.database.prepare(
        `INSERT INTO run_resource_requests (run_id, resource_key)
         VALUES (?, ?)`,
      );
      for (const logicalKey of [...new Set(input.resources)].sort()) {
        const resourceKey = this.scopeResourceKey(input.scopeId, logicalKey);
        insert.run(input.id, resourceKey);
      }
      if (input.admission !== undefined) {
        if (admission.disposition === "redelivery") {
          this.replaceAdmission(
            input.admission,
            admission.previousRunId,
            input.id,
            input.admittedAt,
          );
        } else {
          this.insertAdmission(input.admission, input.id, input.admittedAt);
        }
      }
      return { status: "admitted", runId: input.id };
    })();
  }

  listDispatchableRuns(input: {
    now: string;
    limit: number;
    excludedScopeIds: readonly string[];
    includedRunIds?: readonly string[];
  }): StoredRun[] {
    if (!Number.isInteger(input.limit) || input.limit < 0) {
      throw new Error("limit must be a non-negative integer");
    }
    if (input.limit === 0) return [];
    const excludedScopeIds = [...new Set(input.excludedScopeIds)].sort();
    const excludedScopes = excludedScopeIds.length === 0
      ? ""
      : `AND scope_id NOT IN (${excludedScopeIds.map(() => "?").join(", ")})`;
    const includedRunIds = input.includedRunIds === undefined
      ? undefined
      : [...new Set(input.includedRunIds)].sort();
    if (includedRunIds?.length === 0) return [];
    const includedRuns = includedRunIds === undefined
      ? ""
      : `AND id IN (${includedRunIds.map(() => "?").join(", ")})`;
    const rows = this.database
      .prepare(
        `SELECT id FROM runs
         WHERE state = 'queued' AND (not_before_at IS NULL OR not_before_at <= ?)
         ${excludedScopes}
         ${includedRuns}
         ORDER BY admitted_at, rowid`,
      )
      .all(input.now, ...excludedScopeIds, ...(includedRunIds ?? []));
    const owners = new Map(
      (this.database.prepare("SELECT resource_key, run_id FROM run_resources").all() as Array<{
        resource_key: string;
        run_id: string;
      }>).map((owner) => [owner.resource_key, owner.run_id]),
    );
    const earlierRequests = new Set<string>();
    const dispatchable: StoredRun[] = [];
    for (const row of rows) {
      const runId = (row as { id: string }).id;
      const requested = this.requestedResourceKeys(runId);
      const waitsBehindEarlierRun = requested.some((key) => earlierRequests.has(key));
      for (const key of requested) earlierRequests.add(key);
      if (waitsBehindEarlierRun) continue;
      if (requested.some((key) => owners.has(key) && owners.get(key) !== runId)) continue;
      dispatchable.push(this.getRun(runId)!);
      if (dispatchable.length >= input.limit) break;
    }
    return dispatchable;
  }

  nextQueuedEligibility(input: {
    after: string;
    excludedScopeIds: readonly string[];
    includedRunIds?: readonly string[];
  }): string | null {
    const excludedScopeIds = [...new Set(input.excludedScopeIds)].sort();
    const excludedScopes = excludedScopeIds.length === 0
      ? ""
      : `AND scope_id NOT IN (${excludedScopeIds.map(() => "?").join(", ")})`;
    const includedRunIds = input.includedRunIds === undefined
      ? undefined
      : [...new Set(input.includedRunIds)].sort();
    if (includedRunIds?.length === 0) return null;
    const includedRuns = includedRunIds === undefined
      ? ""
      : `AND id IN (${includedRunIds.map(() => "?").join(", ")})`;
    const row = this.database
      .prepare(
        `SELECT MIN(not_before_at) AS value FROM runs
         WHERE state = 'queued' AND not_before_at > ?
         ${excludedScopes}
         ${includedRuns}`,
      )
      .get(input.after, ...excludedScopeIds, ...(includedRunIds ?? [])) as {
        value: string | null;
      };
    return row.value;
  }

  getScopeRoot(scopeId: string): string | null {
    const row = this.database
      .prepare("SELECT root_path FROM scopes WHERE id = ?")
      .get(scopeId) as { root_path: string } | undefined;
    return row?.root_path ?? null;
  }

  findQueuedRun(input: {
    scopeId: string;
    workflow: string;
    triggerEvent: string;
  }): StoredRun | null {
    const rows = this.database
      .prepare(
        `SELECT id FROM runs
         WHERE scope_id = ? AND workflow = ? AND state = 'queued'
         ORDER BY admitted_at, rowid`,
      )
      .all(input.scopeId, input.workflow);
    for (const row of rows) {
      const run = this.getRun((row as { id: string }).id)!;
      if (run.trigger.event === input.triggerEvent) return run;
    }
    return null;
  }

  updateQueuedRun(input: {
    runId: string;
    trigger: WorkflowRunTrigger;
    notBeforeAt?: string;
    admission?: RunAdmissionIdentity;
    admittedAt: string;
  }): RunAdmissionDisposition {
    return this.database.transaction((): RunAdmissionDisposition => {
      const admission = input.admission
        ? this.resolveAdmission(input.admission)
        : ({ disposition: "new" } as const);
      if (admission.disposition === "duplicate") {
        return { status: "duplicate", runId: admission.runId };
      }
      const updated = this.database
        .prepare(
          `UPDATE runs SET trigger_json = ?, not_before_at = ?
           WHERE id = ? AND state = 'queued'`,
        )
        .run(JSON.stringify(input.trigger), input.notBeforeAt ?? null, input.runId);
      if (updated.changes !== 1) {
        throw new Error(`Run "${input.runId}" is not queued`);
      }
      if (input.admission !== undefined) {
        if (admission.disposition === "redelivery") {
          this.replaceAdmission(
            input.admission,
            admission.previousRunId,
            input.runId,
            input.admittedAt,
          );
        } else {
          this.insertAdmission(input.admission, input.runId, input.admittedAt);
        }
      }
      return { status: "updated", runId: input.runId };
    })();
  }

  deferQueuedRuns(runIds: readonly string[], notBeforeAt: string): number {
    const ids = [...new Set(runIds)];
    if (ids.length === 0) return 0;
    return this.database.transaction(() => {
      const update = this.database.prepare(
        `UPDATE runs SET not_before_at = ?
         WHERE id = ? AND state = 'queued'
           AND (not_before_at IS NULL OR not_before_at < ?)`,
      );
      let deferred = 0;
      for (const runId of ids) {
        deferred += update.run(notBeforeAt, runId, notBeforeAt).changes;
      }
      return deferred;
    })();
  }

  releaseQueuedRunsDeferredUntil(
    scopeId: string,
    deferredUntil: string,
    releasedAt: string,
  ): number {
    return this.database
      .prepare(
        `UPDATE runs SET not_before_at = ?
         WHERE scope_id = ? AND state = 'queued' AND not_before_at = ?`,
      )
      .run(releasedAt, scopeId, deferredUntil).changes;
  }

  releaseAllQueuedRunsDeferredUntil(
    deferredUntil: string,
    releasedAt: string,
  ): number {
    return this.database
      .prepare(
        `UPDATE runs SET not_before_at = ?
         WHERE state = 'queued' AND not_before_at = ?`,
      )
      .run(releasedAt, deferredUntil).changes;
  }

  startRun(runId: string, epoch: number, startedAt: string): number | null {
    const start = this.database.transaction(() => {
      this.assertCurrentEpoch(epoch);
      const run = this.database
        .prepare(
          `SELECT scope_id FROM runs
           WHERE id = ? AND state = 'queued'
             AND (not_before_at IS NULL OR not_before_at <= ?)`,
        )
        .get(runId, startedAt) as { scope_id: string } | undefined;
      if (!run) throw new Error(`Run "${runId}" is not queued`);
      const ownerQuery = this.database.prepare(
        "SELECT run_id FROM run_resources WHERE resource_key = ?",
      );
      const requested = this.requestedResourceKeys(runId);
      for (const resourceKey of requested) {
        const owner = ownerQuery.get(resourceKey) as { run_id: string } | undefined;
        if (owner !== undefined && owner.run_id !== runId) return null;
      }
      const acquire = this.database.prepare(
        `INSERT INTO run_resources
          (resource_key, run_id, lifetime, daemon_epoch, acquired_at)
         VALUES (?, ?, 'run', NULL, ?)
         ON CONFLICT(resource_key) DO NOTHING`,
      );
      for (const resourceKey of requested) {
        const acquired = acquire.run(resourceKey, runId, startedAt);
        if (acquired.changes === 0) {
          const owner = ownerQuery.get(resourceKey) as { run_id: string } | undefined;
          if (owner?.run_id !== runId) return null;
        }
      }
      const updated = this.database
        .prepare(
          `UPDATE runs
           SET state = 'running', started_at = ?, finished_at = NULL, daemon_epoch = ?
           WHERE id = ? AND state = 'queued'
             AND (not_before_at IS NULL OR not_before_at <= ?)`,
        )
        .run(startedAt, epoch, runId, startedAt);
      if (updated.changes !== 1) {
        throw new Error(`Run "${runId}" is not queued`);
      }
      const attempt = (
        this.database
          .prepare("SELECT COALESCE(MAX(attempt), 0) + 1 AS value FROM run_attempts WHERE run_id = ?")
          .get(runId) as { value: number }
      ).value;
      this.database
        .prepare(
          `INSERT INTO run_attempts
            (run_id, attempt, daemon_epoch, state, started_at)
           VALUES (?, ?, ?, 'running', ?)`,
        )
        .run(runId, attempt, epoch, startedAt);
      return attempt;
    });
    return start.immediate();
  }

  beginIntegration(
    runId: string,
    epoch: number,
    integration: Record<string, unknown>,
  ): void {
    this.database.transaction(() => {
      this.assertCurrentEpoch(epoch);
      const updated = this.database
        .prepare(
          `UPDATE runs
           SET state = 'integrating', integration_json = ?
           WHERE id = ? AND state = 'running' AND daemon_epoch = ?`,
        )
        .run(JSON.stringify(integration), runId, epoch);
      if (updated.changes !== 1) {
        throw new Error(`Run "${runId}" is not running in daemon epoch ${epoch}`);
      }
    })();
  }

  suspendRun(input: {
    runId: string;
    epoch: number;
    state: RunSuspensionState;
    suspendedAt: string;
    wait?: Record<string, unknown>;
    error?: string;
  }): void {
    this.database.transaction(() => {
      this.assertCurrentEpoch(input.epoch);
      const updated = this.database
        .prepare(
          `UPDATE runs
           SET state = ?, daemon_epoch = NULL, wait_json = ?, last_error = ?
           WHERE id = ? AND state IN ('running', 'integrating') AND daemon_epoch = ?`,
        )
        .run(
          input.state,
          input.wait === undefined ? null : JSON.stringify(input.wait),
          input.error ?? null,
          input.runId,
          input.epoch,
        );
      if (updated.changes !== 1) {
        throw new Error(`Run "${input.runId}" is not active in daemon epoch ${input.epoch}`);
      }
      this.finishAttempt(input.runId, input.epoch, input.state, input.suspendedAt);
      this.releaseAttemptResources(input.runId);
    })();
  }

  deferRun(input: {
    runId: string;
    epoch: number;
    deferredAt: string;
    resumeAt: string;
  }): void {
    this.database.transaction(() => {
      this.assertCurrentEpoch(input.epoch);
      const updated = this.database
        .prepare(
          `UPDATE runs
           SET state = 'queued', daemon_epoch = NULL, not_before_at = ?,
               wait_json = NULL, last_error = NULL
           WHERE id = ? AND state IN ('running', 'integrating') AND daemon_epoch = ?`,
        )
        .run(input.resumeAt, input.runId, input.epoch);
      if (updated.changes !== 1) {
        throw new Error(`Run "${input.runId}" is not active in daemon epoch ${input.epoch}`);
      }
      this.finishAttempt(input.runId, input.epoch, "waiting", input.deferredAt);
      this.releaseAttemptResources(input.runId);
    })();
  }

  resumeRun(runId: string, resumedAt: string): void {
    const updated = this.database
      .prepare(
        `UPDATE runs
         SET state = 'queued', not_before_at = ?, wait_json = NULL,
             finished_at = NULL, last_error = NULL
         WHERE id = ? AND state IN ('waiting', 'needs_attention')`,
      )
      .run(resumedAt, runId);
    if (updated.changes !== 1) throw new Error(`Run "${runId}" is not suspended`);
  }

  requireRunAttention(runId: string, reason: string, evidence: readonly string[]): void {
    const updated = this.database
      .prepare(
        `UPDATE runs
         SET state = 'needs_attention', daemon_epoch = NULL, not_before_at = NULL,
             wait_json = ?, last_error = ?
         WHERE id = ? AND state IN ('queued', 'waiting', 'needs_attention')`,
      )
      .run(JSON.stringify({ reason, evidence: [...evidence] }), reason, runId);
    if (updated.changes !== 1) {
      throw new Error(`Run "${runId}" cannot move to attention from its current state`);
    }
  }

  setSandbox(runId: string, epoch: number, sandbox: RunSandbox): void {
    this.assertCurrentEpoch(epoch);
    const updated = this.database
      .prepare(
        `UPDATE runs SET sandbox_json = ?
         WHERE id = ? AND state IN ('running', 'integrating') AND daemon_epoch = ?`,
      )
      .run(JSON.stringify(sandbox), runId, epoch);
    if (updated.changes !== 1) {
      throw new Error(`Run "${runId}" is not active in daemon epoch ${epoch}`);
    }
  }

  clearSandbox(runId: string, epoch: number): void {
    this.assertCurrentEpoch(epoch);
    const updated = this.database
      .prepare(
        `UPDATE runs SET sandbox_json = NULL
         WHERE id = ? AND state IN ('running', 'integrating') AND daemon_epoch = ?`,
      )
      .run(runId, epoch);
    if (updated.changes !== 1) {
      throw new Error(`Run "${runId}" is not active in daemon epoch ${epoch}`);
    }
  }

  requireActiveRunSandbox(input: {
    runId: string;
    attempt: number;
    epoch: number;
  }): RunSandbox {
    this.assertCurrentEpoch(input.epoch);
    const row = this.database
      .prepare(
        `SELECT r.sandbox_json
         FROM runs r
         WHERE r.id = ?
           AND r.state IN ('running', 'integrating')
           AND r.daemon_epoch = ?
           AND EXISTS (
             SELECT 1 FROM run_attempts a
             WHERE a.run_id = r.id
               AND a.attempt = ?
               AND a.daemon_epoch = ?
               AND a.state = 'running'
           )`,
      )
      .get(input.runId, input.epoch, input.attempt, input.epoch) as
        | { sandbox_json: string | null }
        | undefined;
    if (row === undefined) {
      throw new Error(
        `Run "${input.runId}" attempt ${input.attempt} is not active in daemon epoch ${input.epoch}`,
      );
    }
    if (row.sandbox_json === null) {
      throw new Error(`Run "${input.runId}" has no active sandbox`);
    }
    return JSON.parse(row.sandbox_json) as RunSandbox;
  }

  updateIntegration(
    runId: string,
    epoch: number,
    integration: Record<string, unknown>,
  ): void {
    this.assertCurrentEpoch(epoch);
    const updated = this.database
      .prepare(
        `UPDATE runs SET integration_json = ?
         WHERE id = ? AND state = 'integrating' AND daemon_epoch = ?`,
      )
      .run(JSON.stringify(integration), runId, epoch);
    if (updated.changes !== 1) {
      throw new Error(`Run "${runId}" is not integrating in daemon epoch ${epoch}`);
    }
  }

  registerAttemptProcess(input: {
    runId: string;
    epoch: number;
    processKey: string;
    identity: Record<string, unknown>;
    registeredAt: string;
  }): void {
    this.assertCurrentEpoch(input.epoch);
    const attempt = this.database
      .prepare(
        `SELECT attempt FROM run_attempts
         WHERE run_id = ? AND daemon_epoch = ? AND state = 'running'`,
      )
      .get(input.runId, input.epoch) as { attempt: number } | undefined;
    if (!attempt) {
      throw new Error(
        `Run "${input.runId}" has no active attempt in daemon epoch ${input.epoch}`,
      );
    }
    this.database
      .prepare(
        `INSERT INTO run_processes
          (run_id, attempt, process_key, identity_json, registered_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(run_id, attempt, process_key) DO UPDATE SET
           identity_json = excluded.identity_json,
           registered_at = excluded.registered_at`,
      )
      .run(
        input.runId,
        attempt.attempt,
        input.processKey,
        JSON.stringify(input.identity),
        input.registeredAt,
      );
  }

  tryAcquireResource(input: {
    runId: string;
    resourceKey: string;
    lifetime: "run" | "attempt";
    epoch: number;
    acquiredAt: string;
  }): boolean {
    return this.database.transaction(() => {
      this.assertCurrentEpoch(input.epoch);
      const run = this.database
        .prepare(
          `SELECT scope_id FROM runs
           WHERE id = ? AND state IN ('running', 'integrating') AND daemon_epoch = ?`,
        )
        .get(input.runId, input.epoch) as { scope_id: string } | undefined;
      if (!run) {
        const exists = this.database
          .prepare("SELECT 1 FROM runs WHERE id = ?")
          .get(input.runId);
        if (!exists) throw new Error(`Unknown run "${input.runId}"`);
        throw new Error(
          `Run "${input.runId}" is not active in daemon epoch ${input.epoch}`,
        );
      }
      const resourceKey = this.scopeResourceKey(run.scope_id, input.resourceKey);
      const owner = this.database
        .prepare("SELECT run_id FROM run_resources WHERE resource_key = ?")
        .get(resourceKey);
      if (owner) return false;
      this.database
        .prepare(
          `INSERT INTO run_resources
            (resource_key, run_id, lifetime, daemon_epoch, acquired_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          resourceKey,
          input.runId,
          input.lifetime,
          input.lifetime === "attempt" ? input.epoch : null,
          input.acquiredAt,
        );
      return true;
    })();
  }

  releaseResource(runId: string, resourceKey: string, epoch: number): boolean {
    return this.database.transaction(() => {
      this.assertCurrentEpoch(epoch);
      const run = this.database
        .prepare("SELECT scope_id FROM runs WHERE id = ?")
        .get(runId) as { scope_id: string } | undefined;
      if (!run) throw new Error(`Unknown run "${runId}"`);
      const scopedKey = this.scopeResourceKey(run.scope_id, resourceKey);
      const released = this.database
        .prepare("DELETE FROM run_resources WHERE resource_key = ? AND run_id = ?")
        .run(scopedKey, runId);
      return released.changes === 1;
    })();
  }

  readScopeStateValue<T = unknown>(
    scopeId: string,
    key: string,
  ): ScopeStateValue<T> {
    this.assertStateKey(key);
    const row = this.database
      .prepare(
        `SELECT revision, value_json
         FROM scope_state_values
         WHERE scope_id = ? AND state_key = ?`,
      )
      .get(scopeId, key) as {
        revision: number;
        value_json: string;
      } | undefined;
    return row === undefined
      ? { revision: 0, value: null }
      : {
          revision: row.revision,
          value: JSON.parse(row.value_json) as T,
        };
  }

  readDaemonStateValue<T = unknown>(key: string): ScopeStateValue<T> {
    this.assertStateKey(key);
    const row = this.database
      .prepare(
        `SELECT revision, value_json
         FROM daemon_state_values
         WHERE state_key = ?`,
      )
      .get(key) as { revision: number; value_json: string } | undefined;
    return row === undefined
      ? { revision: 0, value: null }
      : { revision: row.revision, value: JSON.parse(row.value_json) as T };
  }

  compareAndSetDaemonStateValue(input: {
    key: string;
    expectedRevision: number;
    value: unknown;
    updatedAt: string;
  }): void {
    this.assertStateKey(input.key);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("Expected state revision must be a non-negative integer");
    }
    const valueJson = JSON.stringify(input.value);
    if (valueJson === undefined) throw new Error("State values must be durable JSON");
    const durableValue = JSON.parse(valueJson) as unknown;
    if (!isDeepStrictEqual(input.value, durableValue)) {
      throw new Error("State values must contain only durable JSON values");
    }

    this.database.transaction(() => {
      const current = this.readDaemonStateValue(input.key);
      if (current.revision !== input.expectedRevision) {
        throw new StateValueConflictError(
          "daemon",
          input.key,
          input.expectedRevision,
          current.revision,
        );
      }
      this.database
        .prepare(
          `INSERT INTO daemon_state_values
            (state_key, revision, value_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(state_key) DO UPDATE SET
             revision = excluded.revision,
             value_json = excluded.value_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.key,
          input.expectedRevision + 1,
          valueJson,
          input.updatedAt,
        );
    })();
  }

  compareAndSetScopeStateValue(input: {
    scopeId: string;
    key: string;
    expectedRevision: number;
    value: unknown;
    updatedAt: string;
  }): void {
    this.assertStateKey(input.key);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("Expected state revision must be a non-negative integer");
    }
    const valueJson = JSON.stringify(input.value);
    if (valueJson === undefined) throw new Error("State values must be durable JSON");
    const durableValue = JSON.parse(valueJson) as unknown;
    if (!isDeepStrictEqual(input.value, durableValue)) {
      throw new Error("State values must contain only durable JSON values");
    }

    this.database.transaction(() => {
      const current = this.readScopeStateValue(input.scopeId, input.key);
      if (current.revision !== input.expectedRevision) {
        throw new StateValueConflictError(
          input.scopeId,
          input.key,
          input.expectedRevision,
          current.revision,
        );
      }
      const pending = this.database
        .prepare(
          `SELECT run_id FROM run_state_mutations
           WHERE scope_id = ? AND state_key = ?`,
        )
        .get(input.scopeId, input.key) as { run_id: string } | undefined;
      if (pending !== undefined) {
        throw new StateValueConflictError(
          input.scopeId,
          input.key,
          input.expectedRevision,
          current.revision,
          pending.run_id,
        );
      }
      this.database
        .prepare(
          `INSERT INTO scope_state_values
            (scope_id, state_key, revision, value_json, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(scope_id, state_key) DO UPDATE SET
             revision = excluded.revision,
             value_json = excluded.value_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.scopeId,
          input.key,
          input.expectedRevision + 1,
          valueJson,
          input.updatedAt,
        );
    })();
  }

  readWorkflowSummary(scopeId: string): WorkflowRuntimeSummary {
    const workflows: WorkflowRuntimeSummary["workflows"] = {};
    let completedRuns = 0;
    for (const run of this.listRuns(scopeId)) {
      if (run.startedAt !== undefined) {
        const current = workflows[run.workflow]?.lastStarted;
        if (
          current === undefined ||
          Date.parse(run.startedAt) >= Date.parse(current.startedAt)
        ) {
          workflows[run.workflow] = {
            ...workflows[run.workflow],
            lastStarted: { runId: run.id, startedAt: run.startedAt },
          };
        }
      }
      if (
        run.finishedAt === undefined ||
        run.startedAt === undefined ||
        run.resultStatus === undefined
      ) {
        continue;
      }
      completedRuns += 1;
      const current = workflows[run.workflow]?.lastCompletion;
      if (
        current === undefined ||
        Date.parse(run.finishedAt) >= Date.parse(current.completedAt)
      ) {
        workflows[run.workflow] = {
          ...workflows[run.workflow],
          lastCompletion: {
            runId: run.id,
            startedAt: run.startedAt,
            completedAt: run.finishedAt,
            status: run.resultStatus,
          },
        };
      }
    }
    return { completedRuns, workflows };
  }

  stageScopeStateMutation(input: {
    runId: string;
    key: string;
    expectedRevision: number;
    value: unknown;
    stagedAt: string;
  }): void {
    this.assertStateKey(input.key);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("Expected state revision must be a non-negative integer");
    }
    const valueJson = JSON.stringify(input.value);
    if (valueJson === undefined) throw new Error("State values must be durable JSON");
    const durableValue = JSON.parse(valueJson) as unknown;
    if (!isDeepStrictEqual(input.value, durableValue)) {
      throw new Error("State values must contain only durable JSON values");
    }

    this.database.transaction(() => {
      const run = this.database
        .prepare("SELECT scope_id, state FROM runs WHERE id = ?")
        .get(input.runId) as {
          scope_id: string;
          state: DurableRunState;
        } | undefined;
      if (!run) throw new Error(`Unknown run "${input.runId}"`);
      if (run.state !== "running") {
        throw new Error(
          `Run "${input.runId}" cannot stage state mutations while ${run.state}`,
        );
      }

      const existing = this.database
        .prepare(
          `SELECT expected_revision, value_json
           FROM run_state_mutations
           WHERE run_id = ? AND state_key = ?`,
        )
        .get(input.runId, input.key) as {
          expected_revision: number;
          value_json: string;
        } | undefined;
      if (existing !== undefined) {
        if (
          existing.expected_revision === input.expectedRevision &&
          isDeepStrictEqual(JSON.parse(existing.value_json), durableValue)
        ) {
          return;
        }
        throw new StateValueConflictError(
          run.scope_id,
          input.key,
          input.expectedRevision,
          this.readScopeStateValue(run.scope_id, input.key).revision,
          input.runId,
        );
      }

      const current = this.readScopeStateValue(run.scope_id, input.key);
      if (current.revision !== input.expectedRevision) {
        throw new StateValueConflictError(
          run.scope_id,
          input.key,
          input.expectedRevision,
          current.revision,
        );
      }
      const pending = this.database
        .prepare(
          `SELECT run_id FROM run_state_mutations
           WHERE scope_id = ? AND state_key = ?`,
        )
        .get(run.scope_id, input.key) as { run_id: string } | undefined;
      if (pending !== undefined) {
        throw new StateValueConflictError(
          run.scope_id,
          input.key,
          input.expectedRevision,
          current.revision,
          pending.run_id,
        );
      }
      this.database
        .prepare(
          `INSERT INTO run_state_mutations
            (run_id, scope_id, state_key, expected_revision, value_json, staged_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          run.scope_id,
          input.key,
          input.expectedRevision,
          valueJson,
          input.stagedAt,
        );
    })();
  }

  finishRun(
    runId: string,
    epoch: number,
    state: TerminalRunState,
    finishedAt: string,
    error?: string,
    publication?: Omit<RunPublication, "createdAt" | "deliveredAt">,
    resultStatus?: WorkflowRunStatus,
  ): void {
    this.database.transaction(() => {
      this.assertCurrentEpoch(epoch);
      const updated = this.database
        .prepare(
          `UPDATE runs
           SET state = ?, finished_at = ?, daemon_epoch = NULL, wait_json = NULL,
               last_error = ?, result_status = ?
           WHERE id = ? AND state IN ('running', 'integrating') AND daemon_epoch = ?`,
        )
        .run(
          state,
          finishedAt,
          error ?? null,
          resultStatus ?? terminalResultStatus(state),
          runId,
          epoch,
        );
      if (updated.changes !== 1) {
        throw new Error(`Run "${runId}" is not running in daemon epoch ${epoch}`);
      }
      this.finishAttempt(runId, epoch, state, finishedAt);
      this.database.prepare("DELETE FROM run_resources WHERE run_id = ?").run(runId);
      let publicationSequence = 0;
      if (state === "succeeded") {
        this.applyStagedStateMutations(runId, finishedAt);
        const intents = this.database
          .prepare(
            `SELECT publication_id, scope_id, event_name, payload_json, intent_sequence
             FROM run_emit_intents
             WHERE run_id = ?
             ORDER BY intent_sequence`,
          )
          .all(runId) as Array<{
            publication_id: string;
            scope_id: string;
            event_name: string;
            payload_json: string;
            intent_sequence: number;
          }>;
        const insertPublication = this.database.prepare(
          `INSERT INTO run_publications
            (publication_id, run_id, scope_id, event_name, payload_json,
             publication_sequence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const intent of intents) {
          insertPublication.run(
            intent.publication_id,
            runId,
            intent.scope_id,
            intent.event_name,
            intent.payload_json,
            publicationSequence,
            finishedAt,
          );
          publicationSequence += 1;
        }
      }
      this.database.prepare("DELETE FROM run_emit_intents WHERE run_id = ?").run(runId);
      this.database.prepare("DELETE FROM run_state_mutations WHERE run_id = ?").run(runId);
      if (publication !== undefined) {
        if (publication.runId !== runId) {
          throw new Error(`Publication "${publication.id}" does not belong to run "${runId}"`);
        }
        this.database
          .prepare(
            `INSERT INTO run_publications
              (publication_id, run_id, scope_id, event_name, payload_json,
               publication_sequence, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            publication.id,
            publication.runId,
            publication.scopeId,
            publication.event,
            JSON.stringify(publication.payload),
            publicationSequence,
            finishedAt,
          );
      }
    })();
  }

  stageEmitIntent(input: {
    runId: string;
    stepId: string;
    event: string;
    payload: Readonly<Record<string, unknown>>;
    stagedAt: string;
  }): void {
    if (!input.stepId.trim()) throw new Error("Emit intent step id must not be empty");
    if (!input.event.trim()) throw new Error("Emit intent event must not be empty");
    const payloadJson = JSON.stringify(input.payload);
    if (payloadJson === undefined) throw new Error("Emit intent payload must be durable JSON");
    const durablePayload = JSON.parse(payloadJson) as Record<string, unknown>;

    this.database.transaction(() => {
      const run = this.database
        .prepare("SELECT scope_id, state FROM runs WHERE id = ?")
        .get(input.runId) as { scope_id: string; state: DurableRunState } | undefined;
      if (!run) throw new Error(`Unknown run "${input.runId}"`);
      if (run.state !== "running") {
        throw new Error(`Run "${input.runId}" cannot stage emit intents while ${run.state}`);
      }
      const existing = this.database
        .prepare(
          `SELECT event_name, payload_json FROM run_emit_intents
           WHERE run_id = ? AND step_id = ?`,
        )
        .get(input.runId, input.stepId) as {
          event_name: string;
          payload_json: string;
        } | undefined;
      if (existing !== undefined) {
        const sameIntent =
          existing.event_name === input.event &&
          isDeepStrictEqual(
            JSON.parse(existing.payload_json) as Record<string, unknown>,
            durablePayload,
          );
        if (sameIntent) return;
        throw new PublicationIntentConflictError(input.runId, input.stepId);
      }
      const next = this.database
        .prepare(
          `SELECT COALESCE(MAX(intent_sequence), -1) + 1 AS next_sequence
           FROM run_emit_intents WHERE run_id = ?`,
        )
        .get(input.runId) as { next_sequence: number };
      this.database
        .prepare(
          `INSERT INTO run_emit_intents
            (run_id, step_id, publication_id, scope_id, event_name, payload_json,
             intent_sequence, staged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          input.stepId,
          `workflow:${input.runId}:emit:${input.stepId}`,
          run.scope_id,
          input.event,
          payloadJson,
          next.next_sequence,
          input.stagedAt,
        );
    })();
  }

  listPendingPublications(limit = 100): PendingRunPublication[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("Publication limit must be a positive integer");
    }
    return this.database
      .prepare(
        `SELECT publication_id, run_id, scope_id, event_name, payload_json, created_at
         FROM run_publications
         WHERE delivered_at IS NULL
         ORDER BY created_at, run_id, publication_sequence, publication_id
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => {
        const value = row as {
          publication_id: string;
          run_id: string;
          scope_id: string;
          event_name: string;
          payload_json: string;
          created_at: string;
        };
        return {
          id: value.publication_id,
          runId: value.run_id,
          scopeId: value.scope_id,
          event: value.event_name,
          payload: JSON.parse(value.payload_json) as Record<string, unknown>,
          createdAt: value.created_at,
        };
      });
  }

  /** Returns the earliest undelivered publication for every run. */
  listPendingPublicationHeads(): PendingRunPublication[] {
    return this.database
      .prepare(
        `SELECT publication_id, run_id, scope_id, event_name, payload_json, created_at
         FROM run_publications AS candidate
         WHERE delivered_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM run_publications AS predecessor
             WHERE predecessor.run_id = candidate.run_id
               AND predecessor.delivered_at IS NULL
               AND predecessor.publication_sequence < candidate.publication_sequence
           )
         ORDER BY created_at, run_id, publication_sequence, publication_id`,
      )
      .all()
      .map((row) => {
        const value = row as {
          publication_id: string;
          run_id: string;
          scope_id: string;
          event_name: string;
          payload_json: string;
          created_at: string;
        };
        return {
          id: value.publication_id,
          runId: value.run_id,
          scopeId: value.scope_id,
          event: value.event_name,
          payload: JSON.parse(value.payload_json) as Record<string, unknown>,
          createdAt: value.created_at,
        };
      });
  }

  markPublicationDelivered(publicationId: string, deliveredAt: string): boolean {
    const updated = this.database
      .prepare(
        `UPDATE run_publications SET delivered_at = ?
         WHERE publication_id = ? AND delivered_at IS NULL`,
      )
      .run(deliveredAt, publicationId);
    return updated.changes === 1;
  }

  cancelQueuedRun(runId: string, cancelledAt: string): boolean {
    return this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE runs
           SET state = 'cancelled', finished_at = ?, result_status = 'interrupted',
               sandbox_json = NULL
           WHERE id = ? AND state IN ('queued', 'waiting', 'needs_attention')`,
        )
        .run(cancelledAt, runId);
      if (updated.changes === 0) return false;
      this.database.prepare("DELETE FROM run_resources WHERE run_id = ?").run(runId);
      this.database.prepare("DELETE FROM run_emit_intents WHERE run_id = ?").run(runId);
      this.database.prepare("DELETE FROM run_state_mutations WHERE run_id = ?").run(runId);
      return true;
    })();
  }

  prepareExternalEffect(input: {
    key: string;
    runId: string;
    requestFingerprint: string;
    preparedAt: string;
  }): { disposition: "execute" } | { disposition: "completed"; result: unknown } | { disposition: "ambiguous" } {
    return this.database.transaction(() => {
      const existing = this.getExternalEffect(input.key);
      if (existing) {
        if (
          existing.runId !== input.runId ||
          existing.requestFingerprint !== input.requestFingerprint
        ) {
          throw new Error(`External effect key "${input.key}" was reused with a different request`);
        }
        if (existing.state === "completed") {
          return { disposition: "completed" as const, result: existing.result };
        }
        return { disposition: "ambiguous" as const };
      }
      this.database
        .prepare(
          `INSERT INTO external_effects
            (effect_key, run_id, request_fingerprint, state, prepared_at)
           VALUES (?, ?, ?, 'prepared', ?)`,
        )
        .run(input.key, input.runId, input.requestFingerprint, input.preparedAt);
      return { disposition: "execute" as const };
    })();
  }

  completeExternalEffect(input: {
    key: string;
    runId: string;
    completedAt: string;
    result: unknown;
  }): void {
    const updated = this.database
      .prepare(
        `UPDATE external_effects
         SET state = 'completed', completed_at = ?, result_json = ?
         WHERE effect_key = ? AND run_id = ? AND state = 'prepared'`,
      )
      .run(input.completedAt, JSON.stringify(input.result), input.key, input.runId);
    if (updated.changes !== 1) {
      throw new Error(`External effect "${input.key}" is not prepared for run "${input.runId}"`);
    }
  }

  markExternalEffectUnknown(key: string, runId: string): void {
    const updated = this.database
      .prepare(
        `UPDATE external_effects SET state = 'unknown'
         WHERE effect_key = ? AND run_id = ? AND state = 'prepared'`,
      )
      .run(key, runId);
    if (updated.changes !== 1) {
      throw new Error(`External effect "${key}" is not prepared for run "${runId}"`);
    }
  }

  getExternalEffect(key: string): StoredExternalEffect | null {
    const row = this.database
      .prepare("SELECT * FROM external_effects WHERE effect_key = ?")
      .get(key) as
      | {
          effect_key: string;
          run_id: string;
          request_fingerprint: string;
          state: StoredExternalEffect["state"];
          prepared_at: string;
          completed_at: string | null;
          result_json: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      key: row.effect_key,
      runId: row.run_id,
      requestFingerprint: row.request_fingerprint,
      state: row.state,
      preparedAt: row.prepared_at,
      ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
      ...(row.result_json !== null ? { result: JSON.parse(row.result_json) as unknown } : {}),
    };
  }

  getRun(runId: string): StoredRun | null {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as
      | RunRow
      | undefined;
    if (!row) return null;
    const resourcePrefix = `scope:${row.scope_id}:`;
    const resources = (row.state === "succeeded" || row.state === "failed" || row.state === "cancelled"
      ? []
      : [...new Set([
          ...this.requestedResourceKeys(runId),
          ...(this.database
            .prepare("SELECT resource_key FROM run_resources WHERE run_id = ? ORDER BY resource_key")
            .all(runId)
            .map((resource) => (resource as { resource_key: string }).resource_key)),
        ])].sort())
      .map((resourceKey) =>
        resourceKey.startsWith(resourcePrefix)
          ? resourceKey.slice(resourcePrefix.length)
          : resourceKey,
      );
    return {
      id: row.id,
      scopeId: row.scope_id,
      workflow: row.workflow,
      trigger: JSON.parse(row.trigger_json) as WorkflowRunTrigger,
      repository: row.repository_access,
      state: row.state,
      resources,
      admittedAt: row.admitted_at,
      attempt: (
        this.database
          .prepare("SELECT COALESCE(MAX(attempt), 0) AS value FROM run_attempts WHERE run_id = ?")
          .get(runId) as { value: number }
      ).value,
      ...(row.not_before_at !== null ? { notBeforeAt: row.not_before_at } : {}),
      ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
      ...(row.finished_at !== null ? { finishedAt: row.finished_at } : {}),
      ...(row.sandbox_json !== null
        ? { sandbox: JSON.parse(row.sandbox_json) as RunSandbox }
        : {}),
      ...(row.integration_json !== null
        ? { integration: JSON.parse(row.integration_json) as Record<string, unknown> }
        : {}),
      processes: this.getAttemptProcesses(runId),
      ...(row.wait_json !== null
        ? { wait: JSON.parse(row.wait_json) as Record<string, unknown> }
        : {}),
      ...(row.last_error !== null ? { lastError: row.last_error } : {}),
      ...(row.result_status !== null ? { resultStatus: row.result_status } : {}),
    };
  }

  listRuns(scopeId: string, states?: readonly DurableRunState[]): StoredRun[] {
    const rows = states && states.length > 0
      ? this.database
          .prepare(
            `SELECT id FROM runs WHERE scope_id = ? AND state IN (${states.map(() => "?").join(",")})
             ORDER BY admitted_at, rowid`,
          )
          .all(scopeId, ...states)
      : this.database
          .prepare("SELECT id FROM runs WHERE scope_id = ? ORDER BY admitted_at, rowid")
          .all(scopeId);
    return rows.map((row) => this.getRun((row as { id: string }).id)!);
  }

  getEpoch(): number {
    return this.currentEpoch();
  }

  private getAttemptProcesses(runId: string): Record<string, unknown>[] {
    return this.database
      .prepare(
        `SELECT p.identity_json FROM run_processes p
         JOIN (
           SELECT run_id, MAX(attempt) AS attempt
           FROM run_attempts WHERE run_id = ? GROUP BY run_id
         ) latest ON latest.run_id = p.run_id AND latest.attempt = p.attempt
         ORDER BY p.process_key`,
      )
      .all(runId)
      .map((row) => JSON.parse((row as { identity_json: string }).identity_json) as Record<string, unknown>);
  }

  private requestedResourceKeys(runId: string): string[] {
    return this.database
      .prepare(
        "SELECT resource_key FROM run_resource_requests WHERE run_id = ? ORDER BY resource_key",
      )
      .all(runId)
      .map((resource) => (resource as { resource_key: string }).resource_key);
  }

  private requestedResources(runId: string, scopeId: string): string[] {
    const resourcePrefix = `scope:${scopeId}:`;
    return this.requestedResourceKeys(runId).map((resourceKey) =>
      resourceKey.startsWith(resourcePrefix)
        ? resourceKey.slice(resourcePrefix.length)
        : resourceKey,
    );
  }

  private resolveAdmission(admission: RunAdmissionIdentity): AdmissionResolution {
    const existing = this.database
      .prepare(
        `SELECT a.run_id, a.parameter_fingerprint, r.state
         FROM run_admissions a
         JOIN runs r ON r.id = a.run_id
         WHERE a.scope_id = ? AND a.admission_key = ?`,
      )
      .get(admission.scopeId, admission.key) as
      | {
          run_id: string;
          parameter_fingerprint: string;
          state: DurableRunState;
        }
      | undefined;
    if (!existing) return { disposition: "new" };
    if (existing.parameter_fingerprint !== admission.parameterFingerprint) {
      throw new AdmissionKeyConflictError(admission.scopeId, admission.key);
    }
    return existing.state === "failed" || existing.state === "cancelled"
      ? { disposition: "redelivery", previousRunId: existing.run_id }
      : { disposition: "duplicate", runId: existing.run_id };
  }

  private insertAdmission(
    admission: RunAdmissionIdentity,
    runId: string,
    admittedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO run_admissions
          (scope_id, admission_key, parameter_fingerprint, run_id, admitted_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        admission.scopeId,
        admission.key,
        admission.parameterFingerprint,
        runId,
        admittedAt,
      );
  }

  private replaceAdmission(
    admission: RunAdmissionIdentity,
    previousRunId: string,
    runId: string,
    admittedAt: string,
  ): void {
    const updated = this.database
      .prepare(
        `UPDATE run_admissions
         SET run_id = ?, admitted_at = ?
         WHERE scope_id = ? AND admission_key = ?
           AND parameter_fingerprint = ? AND run_id = ?`,
      )
      .run(
        runId,
        admittedAt,
        admission.scopeId,
        admission.key,
        admission.parameterFingerprint,
        previousRunId,
      );
    if (updated.changes !== 1) {
      throw new Error(
        `Admission "${admission.key}" in scope "${admission.scopeId}" changed during redelivery`,
      );
    }
  }

  private currentEpoch(): number {
    return (
      this.database.prepare("SELECT epoch FROM daemon_state WHERE singleton = 1").get() as {
        epoch: number;
      }
    ).epoch;
  }

  private applyStagedStateMutations(runId: string, updatedAt: string): void {
    const mutations = this.database
      .prepare(
        `SELECT scope_id, state_key, expected_revision, value_json
         FROM run_state_mutations
         WHERE run_id = ?
         ORDER BY state_key`,
      )
      .all(runId) as Array<{
        scope_id: string;
        state_key: string;
        expected_revision: number;
        value_json: string;
      }>;
    const upsert = this.database.prepare(
      `INSERT INTO scope_state_values
        (scope_id, state_key, revision, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope_id, state_key) DO UPDATE SET
         revision = excluded.revision,
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    );
    for (const mutation of mutations) {
      const current = this.readScopeStateValue(
        mutation.scope_id,
        mutation.state_key,
      );
      if (current.revision !== mutation.expected_revision) {
        throw new StateValueConflictError(
          mutation.scope_id,
          mutation.state_key,
          mutation.expected_revision,
          current.revision,
        );
      }
      upsert.run(
        mutation.scope_id,
        mutation.state_key,
        mutation.expected_revision + 1,
        mutation.value_json,
        updatedAt,
      );
    }
  }

  private assertStateKey(key: string): void {
    if (key !== key.trim() || key.length === 0 || key.length > 256 || key.includes("\0")) {
      throw new Error(`Invalid state key "${key}"`);
    }
  }

  private assertCurrentEpoch(epoch: number): void {
    const currentEpoch = this.currentEpoch();
    if (epoch !== currentEpoch) throw new StaleDaemonEpochError(epoch, currentEpoch);
  }

  private finishAttempt(
    runId: string,
    epoch: number,
    state: string,
    finishedAt: string,
  ): void {
    this.database
      .prepare(
        `UPDATE run_attempts
         SET state = ?, finished_at = ?
         WHERE run_id = ? AND daemon_epoch = ? AND state = 'running'`,
      )
      .run(state, finishedAt, runId, epoch);
    this.database.prepare("DELETE FROM run_processes WHERE run_id = ?").run(runId);
  }

  private releaseAttemptResources(runId: string): void {
    this.database
      .prepare("DELETE FROM run_resources WHERE run_id = ? AND lifetime = 'attempt'")
      .run(runId);
  }

  private scopeResourceKey(scopeId: string, resourceKey: string): string {
    const logicalKey = resourceKey.trim();
    if (!logicalKey || logicalKey.startsWith("scope:")) {
      throw new Error(`Invalid resource key "${resourceKey}"`);
    }
    if (logicalKey.startsWith("global:")) {
      const globalKey = logicalKey.slice("global:".length).trim();
      if (!globalKey) throw new Error(`Invalid global resource key "${resourceKey}"`);
      return `global:${globalKey}`;
    }
    return `scope:${scopeId}:${logicalKey}`;
  }

  pruneDeliveredPublications(deliveredBefore: string): { count: number } {
    const result = this.database
      .prepare(
        `DELETE FROM run_publications
         WHERE delivered_at IS NOT NULL AND delivered_at <= ?`,
      )
      .run(deliveredBefore);
    return { count: result.changes };
  }

  pruneTerminalRuns(input: {
    finishedBefore: string;
    excludedRunIds?: readonly string[];
  }): { count: number; runIds: string[] } {
    const excluded = new Set(input.excludedRunIds ?? []);
    const candidateRuns = this.database
      .prepare(
        `SELECT id FROM runs
         WHERE state IN ('succeeded', 'failed', 'cancelled')
           AND finished_at IS NOT NULL
           AND finished_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM run_publications
             WHERE run_publications.run_id = runs.id
               AND run_publications.delivered_at IS NULL
           )`,
      )
      .all(input.finishedBefore) as Array<{ id: string }>;
    const runIds = candidateRuns.map((r) => r.id).filter((id) => !excluded.has(id));
    if (runIds.length === 0) return { count: 0, runIds: [] };

    const deleteTx = this.database.transaction((ids: string[]) => {
      const stmt = this.database.prepare("DELETE FROM runs WHERE id = ?");
      for (const id of ids) {
        stmt.run(id);
      }
    });
    deleteTx(runIds);
    return { count: runIds.length, runIds };
  }

  cleanStaleProcesses(): { count: number } {
    const result = this.database
      .prepare(
        `DELETE FROM run_processes
         WHERE run_id NOT IN (
           SELECT id FROM runs WHERE state IN ('running', 'integrating')
         )`,
      )
      .run();
    return { count: result.changes };
  }

  compact(): { bytesReclaimed: number } {
    const sizeBefore = existsSync(this.path) ? statSync(this.path).size : 0;
    this.database.pragma("wal_checkpoint(TRUNCATE)");
    this.database.pragma("incremental_vacuum");
    const sizeAfter = existsSync(this.path) ? statSync(this.path).size : 0;
    return { bytesReclaimed: Math.max(0, sizeBefore - sizeAfter) };
  }
}
