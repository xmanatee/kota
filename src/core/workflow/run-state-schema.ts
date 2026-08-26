import type Database from "better-sqlite3";

function createRunPublicationsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE run_publications (
      publication_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL REFERENCES scopes(id),
      event_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      publication_sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE (run_id, publication_sequence)
    );
  `);
}

function migrateRunPublications(database: Database.Database): void {
  const columns = database.pragma("table_info(run_publications)") as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === "publication_sequence")) return;

  database.transaction(() => {
    database.exec(`
      DROP INDEX IF EXISTS run_publications_pending_idx;
      ALTER TABLE run_publications RENAME TO run_publications_legacy;
    `);
    createRunPublicationsTable(database);
    database.exec(`
      INSERT INTO run_publications
        (publication_id, run_id, scope_id, event_name, payload_json,
         publication_sequence, created_at, delivered_at)
      SELECT publication_id, run_id, scope_id, event_name, payload_json,
             0, created_at, delivered_at
      FROM run_publications_legacy;
      DROP TABLE run_publications_legacy;
    `);
  })();
}

export function initializeRunStateSchema(database: Database.Database): void {
  const hadResourceRequests = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_resource_requests'",
    )
    .get() !== undefined;
  database.exec(`
    CREATE TABLE IF NOT EXISTS daemon_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      epoch INTEGER NOT NULL,
      started_at TEXT
    );
    INSERT OR IGNORE INTO daemon_state (singleton, epoch) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS scopes (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL REFERENCES scopes(id),
      workflow TEXT NOT NULL,
      trigger_json TEXT NOT NULL,
      repository_access TEXT NOT NULL CHECK (repository_access IN ('none', 'read', 'write')),
      state TEXT NOT NULL CHECK (state IN (
        'queued', 'running', 'waiting', 'integrating',
        'succeeded', 'failed', 'cancelled', 'needs_attention'
      )),
      admitted_at TEXT NOT NULL,
      not_before_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      daemon_epoch INTEGER,
      sandbox_json TEXT,
      integration_json TEXT,
      wait_json TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS run_attempts (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL,
      daemon_epoch INTEGER NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY (run_id, attempt)
    );

    CREATE TABLE IF NOT EXISTS run_processes (
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      process_key TEXT NOT NULL,
      identity_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      PRIMARY KEY (run_id, attempt, process_key),
      FOREIGN KEY (run_id, attempt)
        REFERENCES run_attempts(run_id, attempt) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_admissions (
      scope_id TEXT NOT NULL,
      admission_key TEXT NOT NULL,
      parameter_fingerprint TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      admitted_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, admission_key)
    );

    CREATE TABLE IF NOT EXISTS run_resource_requests (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      resource_key TEXT NOT NULL,
      PRIMARY KEY (run_id, resource_key)
    );

    CREATE TABLE IF NOT EXISTS run_resources (
      resource_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      lifetime TEXT NOT NULL DEFAULT 'run' CHECK (lifetime IN ('run', 'attempt')),
      daemon_epoch INTEGER,
      acquired_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS external_effects (
      effect_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      request_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared', 'completed', 'unknown')),
      prepared_at TEXT NOT NULL,
      completed_at TEXT,
      result_json TEXT
    );

    CREATE TABLE IF NOT EXISTS run_publications (
      publication_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL REFERENCES scopes(id),
      event_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      publication_sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      UNIQUE (run_id, publication_sequence)
    );

    CREATE TABLE IF NOT EXISTS run_emit_intents (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL,
      publication_id TEXT NOT NULL UNIQUE,
      scope_id TEXT NOT NULL REFERENCES scopes(id),
      event_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      intent_sequence INTEGER NOT NULL,
      staged_at TEXT NOT NULL,
      PRIMARY KEY (run_id, step_id),
      UNIQUE (run_id, intent_sequence)
    );

    CREATE TABLE IF NOT EXISTS scope_state_values (
      scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
      state_key TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, state_key)
    );

    CREATE TABLE IF NOT EXISTS run_state_mutations (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
      state_key TEXT NOT NULL,
      expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
      value_json TEXT NOT NULL,
      staged_at TEXT NOT NULL,
      PRIMARY KEY (run_id, state_key),
      UNIQUE (scope_id, state_key)
    );

    CREATE INDEX IF NOT EXISTS runs_dispatch_idx
      ON runs (state, not_before_at, admitted_at, id);
    CREATE INDEX IF NOT EXISTS run_resources_owner_idx
      ON run_resources (run_id);
    CREATE INDEX IF NOT EXISTS run_resource_requests_key_idx
      ON run_resource_requests (resource_key, run_id);
    CREATE INDEX IF NOT EXISTS run_admissions_run_idx
      ON run_admissions (run_id);
    CREATE INDEX IF NOT EXISTS run_processes_run_idx
      ON run_processes (run_id, attempt);
    CREATE INDEX IF NOT EXISTS run_state_mutations_run_idx
      ON run_state_mutations (run_id);
  `);
  if (!hadResourceRequests) {
    database.exec(`
      INSERT OR IGNORE INTO run_resource_requests (run_id, resource_key)
      SELECT run_id, resource_key
      FROM run_resources
      WHERE lifetime = 'run';
    `);
  }
  migrateRunPublications(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS run_publications_pending_idx
      ON run_publications
        (delivered_at, created_at, run_id, publication_sequence, publication_id);
  `);
}
