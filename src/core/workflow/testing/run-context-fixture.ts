import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import type {
  DurableEffectValue,
  RunContext,
  TransactionalRunState,
} from "../run-context.js";
import { RunStateDatabase } from "../run-state-database.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";

const DEFAULT_TRIGGER: WorkflowRunTrigger = {
  event: "test.requested",
  schemaRef: null,
  payload: {},
};

/** Fixture seeding and inspection use the real scope-state owner. Scenario runs
 * receive the location and stage mutations through createRunContext instead. */
export function createTestTransactionalRunState(
  stateRoot: string,
  scopeId = "test-scope",
): TransactionalRunState & { stateDir: string; scopeId: string } {
  mkdirSync(stateRoot, { recursive: true });
  const stateDir = mkdtempSync(join(stateRoot, "state-"));
  function withDatabase<T>(run: (database: RunStateDatabase) => T): T {
    const database = new RunStateDatabase(stateDir);
    try {
      return run(database);
    } finally {
      database.close();
    }
  }
  withDatabase((database) => database.registerScope({ id: scopeId, rootPath: stateDir, createdAt: new Date().toISOString() }));
  return {
    stateDir,
    scopeId,
    read<T extends DurableEffectValue>(key: string) {
      return withDatabase((database) => database.readScopeStateValue<T>(scopeId, key));
    },
    compareAndSet(key, expectedRevision, value) {
      withDatabase((database) => database.compareAndSetScopeStateValue({
        scopeId, key, expectedRevision, value, updatedAt: new Date().toISOString(),
      }));
    },
  };
}

export function createTestRunContext(
  workspaceRoot: string,
  trigger: WorkflowRunTrigger = DEFAULT_TRIGGER,
): RunContext {
  const runId = `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rootDir = join(workspaceRoot, ".kota", "test-runtime", runId);
  const tempDir = join(rootDir, "tmp");
  const artifactDir = join(rootDir, "artifacts");
  const agentDir = join(rootDir, "agent");
  const packageCacheDir = join(tempDir, "package-cache");
  for (const path of [tempDir, artifactDir, agentDir, packageCacheDir]) {
    mkdirSync(path, { recursive: true });
  }
  return {
    runtimeStateDir: join(workspaceRoot, ".kota"),
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    scope: { id: "test-scope", root: workspaceRoot },
    workflow: "test-workflow",
    trigger,
    sandbox: {
      repository: "read",
      runId,
      rootDir,
      workspaceDir: workspaceRoot,
      tempDir,
      artifactDir,
      baseCommit: "0".repeat(40),
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir: workspaceRoot,
      runDir: rootDir,
      tempDir,
      artifactDir,
      agentDir,
      packageCacheDir,
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {
        TMPDIR: tempDir,
        KOTA_RUN_DIR: agentDir,
        KOTA_RUN_ARTIFACT_DIR: artifactDir,
      },
    },
    signal: new AbortController().signal,
    processes: { register: () => undefined },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: () => undefined },
    state: createTestTransactionalRunState(join(rootDir, "state")),
  };
}
