import type {
  DurableEffectValue,
  RunContext,
  TransactionalRunState,
} from "../run-context.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";

const DEFAULT_TRIGGER: WorkflowRunTrigger = {
  event: "test.requested",
  schemaRef: null,
  payload: {},
};

export function createTestTransactionalRunState(): TransactionalRunState {
  const values = new Map<
    string,
    { revision: number; value: DurableEffectValue }
  >();
  return {
    read<T extends DurableEffectValue>(key: string) {
      const current = values.get(key);
      return current === undefined
        ? { revision: 0, value: null }
        : {
            revision: current.revision,
            value: structuredClone(current.value) as T,
          };
    },
    compareAndSet(key, expectedRevision, value) {
      const currentRevision = values.get(key)?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(
          `Test state revision mismatch for "${key}": expected ${expectedRevision}, received ${currentRevision}`,
        );
      }
      values.set(key, {
        revision: currentRevision + 1,
        value: structuredClone(value),
      });
    },
  };
}

export function createTestRunContext(
  projectDir: string,
  trigger: WorkflowRunTrigger = DEFAULT_TRIGGER,
): RunContext {
  const runId = `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rootDir = join(projectDir, ".kota", "test-runtime", runId);
  const tempDir = join(rootDir, "tmp");
  const artifactDir = join(rootDir, "artifacts");
  const agentDir = join(rootDir, "agent");
  const packageCacheDir = join(tempDir, "package-cache");
  for (const path of [tempDir, artifactDir, agentDir, packageCacheDir]) {
    mkdirSync(path, { recursive: true });
  }
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    project: { id: "test-project", root: projectDir },
    workflow: "test-workflow",
    trigger,
    sandbox: {
      repository: "read",
      runId,
      rootDir,
      workspaceDir: projectDir,
      tempDir,
      artifactDir,
      baseCommit: "0".repeat(40),
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir: projectDir,
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
    state: createTestTransactionalRunState(),
  };
}

import { mkdirSync } from "node:fs";
import { join } from "node:path";
